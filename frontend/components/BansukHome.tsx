"use client";

/* 반석 첫 화면 (데스크탑)
   위: 농장별 산란율 추이(인터랙티브) + 지금 볼 것
   가운데: 핵심 숫자 한 줄
   아래: 농장 표 (필터, 정렬, 미니 추이). 표에 마우스를 올리면 차트에서 그 농장이 강조된다. */
import { useEffect, useMemo, useState } from "react";
import LineChart, { Sparkline } from "./viz/LineChart";
import OsmMap, { esc } from "./viz/OsmMap";
import ScopeSwitch from "./ScopeSwitch";
import { overviewApi, type Overview, type OverviewFarm } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { useCountUp, usePref } from "@/lib/usePref";

type SortKey = "name" | "lay_rate_7d" | "lay_rate_change" | "mortality_7d" | "open_cases";
type Filter = "all" | "attention" | "missing" | "cases";

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

type Alert = { farm: OverviewFarm | null; level: "high" | "mid"; title: string; detail: string; href: string };

export default function BansukHome({ token }: { token: string }) {
  const t = useT();
  const lang = useLang();
  const [range, setRange] = usePref("home_range", 90);
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = usePref<{ k: SortKey; desc: boolean }>("home_sort", { k: "lay_rate_change", desc: false });
  const [q, setQ] = useState("");
  const [filter, setFilter] = usePref<Filter>("home_filter", "all");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hi, setHi] = useState<string | number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  const load = (quiet = false) => {
    if (quiet) setRefreshing(true);
    return overviewApi
      .get(token, range)
      .then((r) => {
        setD(r);
        setErr(null);
        setLoadedAt(new Date());
      }, (e) => setErr((e as Error).message))
      .finally(() => setRefreshing(false));
  };
  useEffect(() => {
    load();
    // 탭으로 돌아오면, 그리고 5분마다 새로 불러온다 (농장 입력이 들어오는 중이므로)
    const onVis = () => document.visibilityState === "visible" && load(true);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => document.visibilityState === "visible" && load(true), 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, lang, range]);

  const missingDays = (f: OverviewFarm) => (d && f.houses ? (f.last_input ? daysBetween(f.last_input, d.today) : 99) : 0);
  const needsAttention = (f: OverviewFarm) =>
    (f.lay_rate_change ?? 0) <= -2 || f.vacc_overdue > 0 || f.cases_awaiting_bansuk > 0 || missingDays(f) >= 2;

  const alerts = useMemo<Alert[]>(() => {
    if (!d) return [];
    const out: Alert[] = [];
    for (const f of d.farms) {
      if ((f.lay_rate_change ?? 0) <= -2)
        out.push({ farm: f, level: "high", title: t("{farm} 산란율 하락", { farm: f.name }), detail: t("지난주보다 {n}%p 낮음", { n: Math.abs(f.lay_rate_change!) }), href: `/?farm=${f.id}` });
      if (missingDays(f) >= 2)
        out.push({ farm: f, level: "mid", title: t("{farm} {n}일째 입력 없음", { farm: f.name, n: missingDays(f) }), detail: t("마지막 입력 {d}", { d: f.last_input ?? "-" }), href: `/?farm=${f.id}` });
    }
    for (const c of d.todo.cases)
      out.push({ farm: d.farms.find((f) => f.name === c.farm) ?? null, level: "high", title: t("{farm} 부검 일정 답변 필요", { farm: c.farm }), detail: c.dead_count != null ? t("폐사 {n}수 신고", { n: c.dead_count }) : t("폐사 신고"), href: `/cases/?id=${c.id}` });
    for (const v of d.todo.vaccinations.filter((v) => v.status === "overdue"))
      out.push({ farm: d.farms.find((f) => f.id === v.farm_id) ?? null, level: "mid", title: t("{farm} {house} 접종 밀림", { farm: v.farm, house: v.house ?? "" }), detail: `${v.vaccine ?? ""} (${v.planned})`, href: `/vaccination/?flock=${v.flock_id}` });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, lang]);

  const rows = useMemo(() => {
    if (!d) return [];
    const list = d.farms.filter((f) => {
      if (q && !f.name.includes(q) && !(f.region ?? "").includes(q)) return false;
      if (filter === "attention") return needsAttention(f);
      if (filter === "missing") return f.houses > 0 && f.entered_today < f.houses;
      if (filter === "cases") return f.open_cases > 0;
      return true;
    });
    const v = (f: OverviewFarm) => (sort.k === "name" ? f.name : ((f[sort.k] as number | null) ?? (sort.desc ? -1e9 : 1e9)));
    return [...list].sort((a, b) => {
      const x = v(a), y = v(b);
      const c = typeof x === "string" ? x.localeCompare(y as string, "ko") : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, q, sort, filter]);

  // 요약 숫자 (처음 나타날 때 한 번 올라가는 효과)
  const activeFarms = d ? d.farms.filter((f) => f.houses > 0) : [];
  const lay7 = activeFarms.map((f) => f.lay_rate_7d).filter((x): x is number => x !== null);
  const cuLay = useCountUp(d ? (lay7.length ? lay7.reduce((a, b) => a + b, 0) / lay7.length : null) : null);
  const cuDeaths = useCountUp(d ? activeFarms.reduce((a, f) => a + f.mortality_7d, 0) : null);

  if (err && !d) return <div className="bh"><p className="bh-err">{err}</p></div>;
  if (!d)
    return (
      <div className="bh">
        <div className="sk sk-title" />
        <div className="sk sk-strip" />
        <div className="bh-top">
          <div className="sk sk-panel" />
          <div className="sk sk-panel" />
        </div>
      </div>
    );

  const active = d.farms.filter((f) => f.houses > 0);
  const lays = active.map((f) => f.lay_rate_7d).filter((x): x is number => x !== null);
  const avgLay = lays.length ? lays.reduce((a, b) => a + b, 0) / lays.length : null;
  const chg = active.map((f) => f.lay_rate_change).filter((x): x is number => x !== null);
  const avgChg = chg.length ? chg.reduce((a, b) => a + b, 0) / chg.length : null;
  const overdue = d.todo.vaccinations.filter((v) => v.status === "overdue").length;
  const totalHouses = active.reduce((a, f) => a + f.houses, 0);
  const enteredHouses = active.reduce((a, f) => a + f.entered_today, 0);
  const deaths = active.reduce((a, f) => a + f.mortality_7d, 0);

  const chartSeries = active.map((f) => ({ id: f.id, name: f.name, values: f.series }));
  // 최근 2주 농장별 산란율: 최근 14일 평균과 그 전 14일 평균
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const twoWeek = active
    .map((f) => ({ f, now: avg(f.series.slice(-14)), prev: avg(f.series.slice(-28, -14)) }))
    .filter((r) => r.now !== null)
    .sort((a, b) => (b.now as number) - (a.now as number));
  const twMin = twoWeek.length ? Math.max(0, Math.floor((Math.min(...twoWeek.flatMap((r) => [r.now as number, r.prev ?? (r.now as number)])) - 8) / 10) * 10) : 0;
  const pctX = (v: number) => `${Math.max(0, Math.min(100, ((v - twMin) / (100 - twMin)) * 100))}%`;
  // 눈금 아래 끝: 대부분의 값이 보이도록 하위 5% 값 기준 (막 산란을 시작한 계군의 낮은 값이 차트를 누르지 않게)
  const allVals = chartSeries.flatMap((s) => s.values).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const yFloor = allVals.length ? Math.max(0, Math.floor((allVals[Math.floor(allVals.length * 0.05)] - 6) / 5) * 5) : undefined;
  const focus = pinned ?? hi;
  const counts: Record<Filter, number> = {
    all: d.farms.length,
    attention: d.farms.filter(needsAttention).length,
    missing: d.farms.filter((f) => f.houses > 0 && f.entered_today < f.houses).length,
    cases: d.farms.filter((f) => f.open_cases > 0).length,
  };
  const th = (k: SortKey, label: string, num = false) => (
    <th className={`sortable${num ? " num" : ""}`} aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== "name" && k !== "lay_rate_change" }))}>
        {label}
        <span className="sort-ind">{sort.k === k ? (sort.desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
  const dateLabel = new Date(d.today).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", { month: "long", day: "numeric", weekday: "long" });

  return (
    <div className="bh">
      <header className="bh-head">
        <div>
          <p className="bh-date">
            {dateLabel}
            {loadedAt && (
              <button type="button" className={`bh-refresh${refreshing ? " is-spin" : ""}`} onClick={() => load(true)} title={t("새로 불러오기")}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
                </svg>
                {t("{t} 기준", { t: loadedAt.toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR", { hour: "2-digit", minute: "2-digit" }) })}
              </button>
            )}
          </p>
          <div className="bh-title-row">
            <h1>{t("전체 농장 현황")}</h1>
            <ScopeSwitch farms={d.farms.map((f) => ({ id: f.id, name: f.name }))} current={null} />
          </div>
        </div>
        <div className="bh-head-actions">
          <button type="button" className="bh-search-btn" onClick={() => window.dispatchEvent(new Event("bansuk-palette"))}>
            {t("농장·메뉴 찾기")}
            <kbd>⌘K</kbd>
          </button>
        </div>
      </header>

      <section className="bh-stats" aria-label={t("요약")}>
        <div>
          <span>{t("평균 산란율 7일")}</span>
          <strong>{avgLay !== null && cuLay !== null ? cuLay.toFixed(1) : "–"}<small>%</small></strong>
          {avgChg !== null && <em className={avgChg < 0 ? "down" : "up"}>{avgChg > 0 ? "+" : ""}{avgChg.toFixed(1)}%p {t("지난주 대비")}</em>}
        </div>
        <div>
          <span>{t("오늘 입력")}</span>
          <strong>{enteredHouses}<small>/{totalHouses}{t("동")}</small></strong>
          <div className="meter"><i style={{ width: `${totalHouses ? (enteredHouses / totalHouses) * 100 : 0}%` }} /></div>
        </div>
        <div>
          <span>{t("7일 폐사")}</span>
          <strong>{Math.round(cuDeaths ?? deaths).toLocaleString()}<small>{t("수")}</small></strong>
          <em>{t("계군 있는 농장 {n}곳", { n: active.length })}</em>
        </div>
        <div className={d.todo.cases.length ? "is-alert" : ""}>
          <span>{t("부검 답변 대기")}</span>
          <strong>{d.todo.cases.length}<small>{t("건")}</small></strong>
          <a href="/cases/">{t("부검 목록")}</a>
        </div>
        <div className={overdue ? "is-alert" : ""}>
          <span>{t("밀린 접종")}</span>
          <strong>{overdue}<small>{t("건")}</small></strong>
          <a href="/vaccines/">{t("7일 안 예정 {n}건", { n: d.todo.vaccinations.length - overdue })}</a>
        </div>
      </section>

      <div className="bh-top">
        <div className="bh-left">
        <section className="panel bh-chart">
          <div className="panel-head">
            <div>
              <h2>{t("농장별 산란율 추이")}</h2>
              <p className="muted-s">{focus !== null ? d.farms.find((f) => f.id === focus)?.name : t("선이나 아래 표에 마우스를 올리면 농장이 강조됩니다")}</p>
            </div>
            <div className="seg" role="group" aria-label={t("기간")}>
              {[30, 90, 180].map((n) => (
                <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>
                  {t("{n}일", { n })}
                </button>
              ))}
            </div>
          </div>
          <LineChart dates={d.dates} series={chartSeries} highlight={focus} onHighlight={pinned === null ? setHi : undefined} height={340} unit="%" yMin={yFloor} label={t("농장별 산란율 추이")} />
          <div className="legend">
            {active.map((f, i) => (
              <button
                key={f.id}
                type="button"
                className={`legend-item${focus === f.id ? " is-on" : ""}${focus !== null && focus !== f.id ? " is-dim" : ""}`}
                onMouseEnter={() => pinned === null && setHi(f.id)}
                onMouseLeave={() => pinned === null && setHi(null)}
                onClick={() => setPinned((p) => (p === f.id ? null : f.id))}
                aria-pressed={pinned === f.id}
              >
                <i style={{ background: `var(--bs-c${i % 8})` }} />
                {f.name}
              </button>
            ))}
          </div>
        </section>

        <section className="panel bh-compare">
          <div className="panel-head">
            <div>
              <h2>{t("최근 2주 농장별 산란율")}</h2>
              <p className="muted-s">{t("막대 = 최근 14일 평균, 세로 눈금 = 그 전 14일 평균")}</p>
            </div>
          </div>
          <ol className="cmp">
            {twoWeek.map(({ f, now, prev }, i) => {
              const delta = prev !== null ? (now as number) - prev : null;
              return (
                <li
                  key={f.id}
                  className={`${focus === f.id ? "is-hi" : ""}${focus !== null && focus !== f.id ? " is-dim" : ""}`}
                  onMouseEnter={() => pinned === null && setHi(f.id)}
                  onMouseLeave={() => pinned === null && setHi(null)}
                >
                  <a href={`/?farm=${f.id}`}>
                    <span className="cmp-rank">{i + 1}</span>
                    <span className="cmp-name">{f.name}</span>
                    <span className="cmp-track">
                      <span className={`cmp-bar${delta !== null && delta <= -2 ? " is-bad" : ""}`} style={{ width: pctX(now as number) }} />
                      {prev !== null && <span className="cmp-prev" style={{ left: pctX(prev) }} title={t("그 전 14일 {v}%", { v: prev.toFixed(1) })} />}
                    </span>
                    <span className="cmp-val">{(now as number).toFixed(1)}%</span>
                    <span className={`cmp-delta ${delta === null ? "" : delta <= -2 ? "bad" : delta < 0 ? "soft" : "good"}`}>
                      {delta === null ? "–" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : ""} ${Math.abs(delta).toFixed(1)}%p`}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
          <p className="cmp-scale">
            <span>{twMin}%</span>
            <span>100%</span>
          </p>
        </section>
        </div>

        <div className="bh-right">
        <section className="panel bh-map">
          <div className="panel-head">
            <h2>{t("농장 위치")}</h2>
            <span className="muted-s">{t("빨강 주의, 노랑 오늘 미입력")}</span>
          </div>
          <OsmMap
            height={250}
            label={t("농장 위치")}
            highlight={focus}
            onHover={(id) => pinned === null && setHi(id)}
            onSelect={(id) => (window.location.href = `/?farm=${id}`)}
            points={d.farms
              .filter((f) => f.lat !== null && f.lng !== null)
              .map((f) => {
                const att = needsAttention(f);
                const miss = f.houses > 0 && f.entered_today < f.houses;
                return {
                  id: f.id,
                  lat: f.lat as number,
                  lng: f.lng as number,
                  approx: f.approx,
                  radius: f.houses ? 6 + Math.min(6, f.houses * 1.5) : 5,
                  color: !f.houses ? "#9aa8a0" : att ? "#e0442f" : miss ? "#f0b400" : "#2f9a6a",
                  tooltip:
                    `<strong>${esc(f.name)}</strong><span>${esc(f.region ?? "")}</span>` +
                    (f.lay_rate_7d !== null ? `<span>${esc(t("산란율 7일"))} ${f.lay_rate_7d.toFixed(1)}%</span>` : "") +
                    (f.houses ? `<span>${esc(t("오늘 입력"))} ${f.entered_today}/${f.houses}</span>` : `<span>${esc(t("계군 없음"))}</span>`),
                };
              })}
          />
        </section>
        <section className="panel bh-alerts">
          <div className="panel-head">
            <h2>{t("지금 볼 것")}</h2>
            <span className="count-pill">{alerts.length}</span>
          </div>
          {alerts.length === 0 ? (
            <p className="empty-note">{t("급한 일이 없습니다. 모든 농장이 정상 범위입니다.")}</p>
          ) : (
            <ul className="alert-list">
              {alerts.map((a, i) => (
                <li key={i} className={`lv-${a.level}`} onMouseEnter={() => a.farm && setHi(a.farm.id)} onMouseLeave={() => setHi(null)}>
                  <a href={a.href}>
                    <strong>{a.title}</strong>
                    <span>{a.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </div>

      <section className="panel bh-farms">
        <div className="panel-head">
          <div className="chips" role="tablist">
            {(
              [
                ["all", t("전체")],
                ["attention", t("주의 필요")],
                ["missing", t("오늘 입력 안 됨")],
                ["cases", t("부검 진행 중")],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {l}
                <span>{counts[k]}</span>
              </button>
            ))}
          </div>
          <input className="field-search" placeholder={t("농장·지역 검색")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <table className="dt">
          <thead>
            <tr>
              {th("name", t("농장"))}
              <th>{t("지역")}</th>
              <th>{t("오늘 입력")}</th>
              <th>{t("추이")}</th>
              {th("lay_rate_7d", t("산란율 7일"), true)}
              {th("lay_rate_change", t("지난주 대비"), true)}
              {th("mortality_7d", t("폐사 7일"), true)}
              {th("open_cases", t("부검"), true)}
              <th className="num">{t("접종")}</th>
              <th className="num">{t("마지막 입력")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-row">{t("조건에 맞는 농장이 없습니다")}</td>
              </tr>
            )}
            {rows.map((f) => {
              const md = missingDays(f);
              return (
                <tr
                  key={f.id}
                  className={focus === f.id ? "is-hi" : ""}
                  onMouseEnter={() => pinned === null && setHi(f.id)}
                  onMouseLeave={() => pinned === null && setHi(null)}
                  onClick={() => (window.location.href = `/?farm=${f.id}`)}
                >
                  <td>
                    <a href={`/?farm=${f.id}`} className="farm-link" onClick={(e) => e.stopPropagation()}>
                      {f.name}
                    </a>
                  </td>
                  <td className="muted-c">{f.region ?? ""}</td>
                  <td>
                    {f.houses ? (
                      <span className="bs-entry">
                        <span className="bs-dots">
                          {Array.from({ length: f.houses }, (_, i) => (
                            <i key={i} className={i < f.entered_today ? "on" : ""} />
                          ))}
                        </span>
                        {f.entered_today}/{f.houses}
                      </span>
                    ) : (
                      <span className="muted-c">{t("계군 없음")}</span>
                    )}
                  </td>
                  <td>{f.houses ? <Sparkline values={f.series.slice(-30)} color={(f.lay_rate_change ?? 0) <= -2 ? "var(--bs-bad)" : "var(--bs-barn)"} /> : null}</td>
                  <td className="num strong">{f.lay_rate_7d !== null ? `${f.lay_rate_7d.toFixed(1)}%` : "–"}</td>
                  <td className="num">
                    {f.lay_rate_change === null ? "–" : (
                      <span className={`delta ${f.lay_rate_change <= -2 ? "bad" : f.lay_rate_change < 0 ? "soft" : "good"}`}>
                        {f.lay_rate_change > 0 ? "▲" : f.lay_rate_change < 0 ? "▼" : ""} {Math.abs(f.lay_rate_change).toFixed(1)}%p
                      </span>
                    )}
                  </td>
                  <td className="num">{f.houses ? f.mortality_7d.toLocaleString() : "–"}</td>
                  <td className="num">{f.open_cases ? <span className={`tag ${f.cases_awaiting_bansuk ? "tag-bad" : ""}`}>{f.open_cases}</span> : "–"}</td>
                  <td className="num">
                    {f.vacc_overdue ? <span className="tag tag-bad">{t("밀림 {n}", { n: f.vacc_overdue })}</span> : f.vacc_week ? <span className="tag">{t("{n}건", { n: f.vacc_week })}</span> : "–"}
                  </td>
                  <td className={`num ${md >= 2 ? "warn-c" : "muted-c"}`}>{f.last_input ? (md === 0 ? t("오늘") : t("{n}일 전", { n: md })) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
