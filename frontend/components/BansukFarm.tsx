"use client";

/* 농장 하나의 운영 대시보드 (데스크탑).
   반석 (/?farm=ID) 과 농장주 PC 화면이 같이 쓴다. 농장주에게는 입력·업로드·신고 바로가기가 보인다.
   위: 요약 띠 8개 (생산·사료·계란)
   가운데: 지표 추이 (동별) + 오른쪽 접종·부검
   아래: 동별 현황 표 (모든 지표), 규격 분포, 일별 상세 기록 (CSV 내려받기) */
import { useEffect, useMemo, useRef, useState } from "react";
import Dashboard from "./Dashboard";
import HomeCases from "./HomeCases";
import UpcomingVaccinations from "./UpcomingVaccinations";
import LineChart from "./viz/LineChart";
import ScopeSwitch from "./ScopeSwitch";
import { api } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { usePref } from "@/lib/usePref";
import { shiftISO, todayISO } from "@/lib/format";
import { aggregate, between, dayValue, fmt, GRADE_GROUPS, int, lastDate, m, type MetricKey, type Rec } from "@/lib/farmstats";
import type { DayView } from "@/lib/types";

type Who = "bansuk" | "farm";

export default function BansukFarm({ token, farmId, farms, who = "bansuk" }: { token: string; farmId: number; farms: { id: number; name: string }[]; who?: Who }) {
  const t = useT();
  const lang = useLang();
  const today = todayISO();
  const [range, setRange] = usePref("farm_range", 90);
  const [metric, setMetric] = usePref<MetricKey>("farm_metric2", "lay");
  const [day, setDay] = useState<DayView | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [hi, setHi] = useState<string | number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | "all">("all");
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api.day(token, farmId, today).then(setDay, (e) => setErr((e as Error).message));
  }, [token, farmId, today, lang]);
  useEffect(() => {
    setRecs(null);
    // 표·요약은 최근 기록 기준이라 차트 기간보다 2주 더 받아 둔다
    api.dailyRange(token, farmId, shiftISO(today, -Math.max(range, 30) - 14), today).then((r) => setRecs(r.records as Rec[]), (e) => setErr((e as Error).message));
  }, [token, farmId, today, range]);

  const dates = useMemo(() => Array.from({ length: range }, (_, i) => shiftISO(today, i - range + 1)), [today, range]);
  const allHouses = day?.houses ?? [];
  const laying = allHouses.filter((h) => h.house.kind === "laying");

  const series = useMemo(() => {
    if (!recs) return [];
    const idx = new Map(dates.map((d, i) => [d, i]));
    const hs = metric === "lay" || metric === "fcr" || metric === "eggw" || metric === "mass" ? laying : allHouses;
    return hs.map((h) => {
      const vals: (number | null)[] = dates.map(() => null);
      for (const r of recs) if (r.house_id === h.house.id && idx.has(r.date)) vals[idx.get(r.date)!] = dayValue(r, metric);
      return { id: h.house.id, name: h.house.name, values: vals };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, dates, day, metric]);

  // 요약 기준일: 기록이 있는 마지막 날
  const last = recs ? lastDate(recs) : null;
  const w0 = last ? shiftISO(last, -6) : null;
  const p0 = last ? shiftISO(last, -13) : null;
  const layIds = new Set(laying.map((h) => h.house.id));
  const wk = useMemo(() => (recs && last ? aggregate(between(recs, w0!, last).filter((r) => layIds.has(r.house_id))) : null), [recs, last, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const pw = useMemo(() => (recs && last ? aggregate(between(recs, p0!, shiftISO(w0!, -1)).filter((r) => layIds.has(r.house_id))) : null), [recs, last, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const allWk = useMemo(() => (recs && last ? aggregate(between(recs, w0!, last)) : null), [recs, last]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = farms.find((f) => f.id === farmId)?.name ?? day?.farm.name ?? "";
  const entered = day?.houses.filter((h) => h.record).length ?? 0;
  const metricLabel: Record<MetricKey, string> = {
    lay: t("산란율"), mort: t("폐사"), feed: t("수당 사료"), fcr: t("사료요구율"), eggw: t("난중"),
    mass: t("산란 중량"), wf: t("수사비"), water: t("수당 급수"), temp: t("계사 최고온도"),
  };
  const unit: Record<MetricKey, string> = { lay: "%", mort: "", feed: "g", fcr: "", eggw: "g", mass: "g", wf: "", water: "ml", temp: "℃" };

  const delta = (a: number | null | undefined, b: number | null | undefined, d = 1, goodUp = true, suffix = "") => {
    if (a == null || b == null) return null;
    const v = a - b;
    const good = goodUp ? v >= 0 : v <= 0;
    return <em className={good ? "up" : "down"}>{v > 0 ? "+" : ""}{v.toFixed(d)}{suffix} {t("지난주 대비")}</em>;
  };

  if (err) return <div className="bh"><p className="bh-err">{err}</p></div>;

  const stats: { k: string; label: string; value: string; unit?: string; sub?: React.ReactNode }[] = [
    { k: "birds", label: t("현재 수수"), value: int(allWk?.birds), unit: t("수"), sub: <em>{t("산란계 {a} · 육성 {b}", { a: int(wk?.birds), b: int((allWk?.birds ?? 0) - (wk?.birds ?? 0)) })}</em> },
    { k: "lay", label: t("산란율"), value: fmt(wk?.lay), unit: "%", sub: delta(wk?.lay, pw?.lay, 1, true, "%p") },
    { k: "eggs", label: t("하루 산란수"), value: wk && wk.days ? int(wk.eggs / wk.days) : "–", unit: t("개"), sub: <em>{t("{n}판", { n: wk && wk.days ? int(wk.eggs / wk.days / 30) : "–" })}</em> },
    { k: "mort", label: t("폐사"), value: int(allWk?.deaths), unit: t("수"), sub: <em>{t("수수 대비 {p}%", { p: fmt(allWk?.deathPct, 2) })}</em> },
    { k: "feed", label: t("수당 사료"), value: fmt(wk?.feedG), unit: "g", sub: delta(wk?.feedG, pw?.feedG, 1, false, "g") },
    { k: "fcr", label: t("사료요구율"), value: fmt(wk?.fcr, 2), sub: delta(wk?.fcr, pw?.fcr, 2, false) ?? <em>{t("사료 kg ÷ 계란 kg")}</em> },
    { k: "eggw", label: t("평균 난중"), value: fmt(wk?.eggW, 1), unit: "g", sub: <em>{t("산란 중량 {g}g/수", { g: fmt(wk?.massG) })}</em> },
    { k: "wf", label: t("수사비"), value: fmt(wk?.wf, 2), sub: <em>{t("수당 급수 {ml}ml", { ml: int(wk?.waterMl) })}</em> },
  ];

  return (
    <div className="bh bf">
      <header className="bh-head">
        <div>
          <div className="bh-title-row">
            <h1>{name}</h1>
            {who === "bansuk" && <ScopeSwitch farms={farms} current={farmId} />}
          </div>
          <p className="bh-date">
            {t("계사 {n}동", { n: allHouses.length })}, {t("오늘 입력 {a}/{b}", { a: entered, b: allHouses.length })}
            {last && <> · {t("요약은 최근 7일 ({a} ~ {b}) 기준", { a: w0!.slice(5).replace("-", "/"), b: last.slice(5).replace("-", "/") })}</>}
          </p>
        </div>
        <div className="bh-head-actions">
          {who === "farm" ? (
            <>
              <a className="btn-ghost" href={`/cases/?new=1&farm=${farmId}`}>{t("폐사 신고")}</a>
              <a className="btn-ghost" href="/upload/">{t("엑셀 올리기")}</a>
              <a className="btn-primary" href={`/?farm=${farmId}&mode=input`}>{t("오늘 기록 입력")}</a>
            </>
          ) : (
            <>
              <a className="btn-ghost" href={`/flocks/?farm=${farmId}`}>{t("계군 관리")}</a>
              <a className="btn-primary" href={`/report/?farm=${farmId}`}>{t("성적 보고서")}</a>
            </>
          )}
        </div>
      </header>

      <section className="bh-stats bf-stats bf-stats8">
        {stats.map((s) => (
          <div key={s.k}>
            <span>{s.label}</span>
            <strong>{recs ? s.value : "–"}{s.unit && <small>{s.unit}</small>}</strong>
            {s.sub}
          </div>
        ))}
      </section>

      <div className="bh-top">
        <section className="panel bh-chart">
          <div className="panel-head">
            <div className="seg seg-wrap" role="group" aria-label={t("지표")}>
              {(Object.keys(metricLabel) as MetricKey[]).map((k) => (
                <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)}>
                  {metricLabel[k]}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label={t("기간")}>
              {[30, 90, 180, 365].map((n) => (
                <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>
                  {n === 365 ? t("1년") : t("{n}일", { n })}
                </button>
              ))}
            </div>
          </div>
          {recs ? (
            <LineChart dates={dates} series={series} highlight={hi} onHighlight={setHi} height={400} unit={unit[metric]} label={t("동별 {m} 추이", { m: metricLabel[metric] })} />
          ) : (
            <div className="bh-skeleton" style={{ height: 400 }} />
          )}
          <div className="legend">
            {series.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`legend-item${hi === s.id ? " is-on" : ""}${hi !== null && hi !== s.id ? " is-dim" : ""}`}
                onMouseEnter={() => setHi(s.id)}
                onMouseLeave={() => setHi(null)}
              >
                <i style={{ background: `var(--bs-c${i % 8})` }} />
                {s.name}
              </button>
            ))}
          </div>
        </section>
        <aside className="bf-side">
          <section className="panel">
            <UpcomingVaccinations token={token} farmId={farmId} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>{t("폐사·부검")}</h2>
              <a className="link-s" href={`/cases/?farm=${farmId}`}>{t("전체")}</a>
            </div>
            <HomeCases token={token} farmId={farmId} isBansuk={who === "bansuk"} />
          </section>
        </aside>
      </div>

      <section className="panel bf-table-panel">
        <div className="panel-head">
          <h2>{t("동별 현황")} <small className="muted-c">{t("최근 7일 평균, 폐사는 7일 합계")}</small></h2>
        </div>
        <div className="bf-scroll">
          <table className="dt bf-ht">
            <thead>
              <tr>
                <th>{t("동")}</th>
                <th>{t("계군")}</th>
                <th className="num">{t("수수")}</th>
                <th className="num">{t("산란율")}</th>
                <th className="num">{t("폐사")}</th>
                <th className="num">{t("수당 사료")}</th>
                <th className="num">{t("사료요구율")}</th>
                <th className="num">{t("난중")}</th>
                <th className="num">{t("산란 중량")}</th>
                <th className="num">{t("수사비")}</th>
                <th className="num">{t("수당 급수")}</th>
                <th>{t("사료")}</th>
                <th className="num">{t("계사온도")}</th>
                <th>{t("규격 분포")}</th>
              </tr>
            </thead>
            <tbody>
              {allHouses.map((h) => {
                const a = recs && last ? aggregate(between(recs, w0!, last, h.house.id)) : null;
                const b = recs && last ? aggregate(between(recs, p0!, shiftISO(w0!, -1), h.house.id)) : null;
                const rearing = h.house.kind === "rearing";
                const dl = a?.lay != null && b?.lay != null ? a.lay - b.lay : null;
                return (
                  <tr
                    key={h.house.id}
                    className={sel === h.house.id ? "is-hi" : ""}
                    onMouseEnter={() => setHi(h.house.id)}
                    onMouseLeave={() => setHi(null)}
                    onClick={() => {
                      setSel(h.house.id);
                      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <td className="strong">{h.house.name}</td>
                    <td>
                      {h.flock ? (
                        <span className="bf-flock">
                          {t("{n}주령", { n: h.flock.age_weeks })}
                          <small>{t("{n}일령", { n: h.flock.age_days })}</small>
                        </span>
                      ) : <span className="muted-c">{t("계군 없음")}</span>}
                    </td>
                    <td className="num">{int(a?.birds)}</td>
                    <td className="num strong">
                      {rearing ? "–" : fmt(a?.lay)}
                      {!rearing && dl !== null && <span className={`delta ${dl <= -2 ? "bad" : dl < 0 ? "soft" : "good"}`}> {dl > 0 ? "▲" : dl < 0 ? "▼" : ""}{Math.abs(dl).toFixed(1)}</span>}
                    </td>
                    <td className="num">{int(a?.deaths)}<small className="muted-c"> {a?.deathPct != null ? `${a.deathPct.toFixed(2)}%` : ""}</small></td>
                    <td className="num">{fmt(a?.feedG)}g</td>
                    <td className="num">{rearing ? "–" : fmt(a?.fcr, 2)}</td>
                    <td className="num">{rearing ? "–" : fmt(a?.eggW)}</td>
                    <td className="num">{rearing ? "–" : `${fmt(a?.massG)}g`}</td>
                    <td className="num">{fmt(a?.wf, 2)}</td>
                    <td className="num">{int(a?.waterMl)}ml</td>
                    <td className="bf-feed">{a?.feedBrand || a?.feedType ? <>{a.feedType}<small>{a.feedBrand}</small></> : "–"}</td>
                    <td className="num">{a?.tmin != null ? `${a.tmin.toFixed(1)} / ${a.tmax?.toFixed(1)}` : "–"}</td>
                    <td>{rearing || !a ? "–" : <GradeBar grades={a.grades} />}</td>
                  </tr>
                );
              })}
              {allHouses.length > 1 && wk && (
                <tr className="bf-total">
                  <td className="strong">{t("농장 전체")}</td>
                  <td />
                  <td className="num">{int(allWk?.birds)}</td>
                  <td className="num strong">{fmt(wk.lay)}</td>
                  <td className="num">{int(allWk?.deaths)}</td>
                  <td className="num">{fmt(wk.feedG)}g</td>
                  <td className="num">{fmt(wk.fcr, 2)}</td>
                  <td className="num">{fmt(wk.eggW)}</td>
                  <td className="num">{fmt(wk.massG)}g</td>
                  <td className="num">{fmt(wk.wf, 2)}</td>
                  <td className="num">{int(wk.waterMl)}ml</td>
                  <td />
                  <td className="num">{wk.tmin != null ? `${wk.tmin.toFixed(1)} / ${wk.tmax?.toFixed(1)}` : "–"}</td>
                  <td><GradeBar grades={wk.grades} /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="gm-legend">
          {GRADE_GROUPS.map((g, i) => (
            <span key={g.key}><i style={{ background: `var(--gm-${i})` }} />{t(g.label)}</span>
          ))}
        </div>
      </section>

      <FeedPanel recs={recs} houses={allHouses.map((h) => ({ id: h.house.id, name: h.house.name }))} last={last} />

      <section ref={detailRef} className="panel bf-detail">
        <DailyDetail recs={recs} houses={allHouses.map((h) => ({ id: h.house.id, name: h.house.name }))} sel={sel} onSel={setSel} farmName={name} />
      </section>

      <section className="bf-houses">
        <h2>{t("같은 일령 과거 계군과 비교")}</h2>
        <Dashboard token={token} farmId={farmId} date={today} />
      </section>
    </div>
  );
}

export function GradeBar({ grades }: { grades: Record<string, number> }) {
  const t = useT();
  const parts = GRADE_GROUPS.map((g, i) => ({ ...g, i, v: grades[g.key] ?? 0 })).filter((p) => p.v > 0.2);
  if (!parts.length) return <span className="muted-c">–</span>;
  return (
    <span className="gm-bar" title={parts.map((p) => `${t(p.label)} ${p.v.toFixed(1)}%`).join(", ")}>
      {parts.map((p) => (
        <i key={p.key} style={{ width: `${p.v}%`, background: `var(--gm-${p.i})` }}>
          {p.v >= 14 ? <b>{t(p.label).slice(0, 1)} {Math.round(p.v)}</b> : null}
        </i>
      ))}
    </span>
  );
}

/* 사료: 최근 30일 동별 입고·소비, 사료 종류 */
function FeedPanel({ recs, houses, last }: { recs: Rec[] | null; houses: { id: number; name: string }[]; last: string | null }) {
  const t = useT();
  if (!recs || !last) return null;
  const from = shiftISO(last, -29);
  const rows = houses.map((h) => {
    const rs = between(recs, from, last, h.id);
    const a = aggregate(rs);
    const types = [...new Set(rs.map((r) => r.feed_type).filter((x): x is string => typeof x === "string"))];
    return { h, a, types };
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a.feedKg, r.a.feedIn)));
  return (
    <section className="panel bf-feedp">
      <div className="panel-head">
        <h2>{t("사료 입고와 소비")} <small className="muted-c">{t("최근 30일")}</small></h2>
        <div className="gm-legend">
          <span><i className="fd-in" />{t("입고")}</span>
          <span><i className="fd-use" />{t("소비")}</span>
        </div>
      </div>
      <ul className="fd-list">
        {rows.map(({ h, a, types }) => (
          <li key={h.id}>
            <span className="fd-name">{h.name}<small>{a.feedBrand ?? ""}</small></span>
            <span className="fd-bars">
              <i className="fd-in" style={{ width: `${(a.feedIn / max) * 100}%` }} />
              <i className="fd-use" style={{ width: `${(a.feedKg / max) * 100}%` }} />
            </span>
            <span className="fd-num">
              {t("입고 {a}t", { a: (a.feedIn / 1000).toFixed(1) })} · {t("소비 {b}t", { b: (a.feedKg / 1000).toFixed(1) })}
            </span>
            <span className="fd-type">{types.join(" → ") || "–"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 일별 상세: 동 하나 또는 전체, 기간, 모든 항목. CSV로 내려받기 */
function DailyDetail({ recs, houses, sel, onSel, farmName }: { recs: Rec[] | null; houses: { id: number; name: string }[]; sel: number | "all"; onSel: (v: number | "all") => void; farmName: string }) {
  const t = useT();
  const [days, setDays] = usePref("farm_detail_days", 14);
  const last = recs ? lastDate(recs) : null;
  const hname = new Map(houses.map((h) => [h.id, h.name]));
  const rows = useMemo(() => {
    if (!recs || !last) return [];
    const from = shiftISO(last, -days + 1);
    return recs
      .filter((r) => r.date >= from && (sel === "all" || r.house_id === sel))
      .sort((a, b) => (a.date === b.date ? (hname.get(a.house_id) ?? "").localeCompare(hname.get(b.house_id) ?? "", "ko", { numeric: true }) : a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, last, days, sel, houses]);

  const nv = (v: unknown, d = 0) => (typeof v === "number" ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "");
  const cols: { h: string; v: (r: Rec) => string; num?: boolean }[] = [
    { h: t("날짜"), v: (r) => r.date.slice(5).replace("-", "/") },
    ...(sel === "all" ? [{ h: t("동"), v: (r: Rec) => hname.get(r.house_id) ?? "" }] : []),
    { h: t("수수"), v: (r) => nv(r.bird_count), num: true },
    { h: t("폐사"), v: (r) => nv(r.mortality), num: true },
    { h: t("산란수"), v: (r) => nv(m(r, "total_eggs")), num: true },
    { h: t("산란율"), v: (r) => nv(m(r, "lay_rate"), 1), num: true },
    { h: t("왕란"), v: (r) => nv(r.egg_jumbo), num: true },
    { h: t("특란"), v: (r) => nv(r.egg_xl), num: true },
    { h: t("대란"), v: (r) => nv(r.egg_l), num: true },
    { h: t("중란"), v: (r) => nv(r.egg_m), num: true },
    { h: t("소란"), v: (r) => nv(r.egg_s), num: true },
    { h: t("쌍란"), v: (r) => nv(r.egg_double), num: true },
    { h: t("무대"), v: (r) => nv(r.egg_mudae), num: true },
    { h: t("파란"), v: (r) => nv(r.egg_broken), num: true },
    { h: t("난중"), v: (r) => nv(r.egg_weight, 2), num: true },
    { h: t("사료 kg"), v: (r) => nv(r.feed_kg), num: true },
    { h: t("수당 사료 g"), v: (r) => nv(m(r, "feed_per_bird_g"), 1), num: true },
    { h: t("사료요구율"), v: (r) => nv(m(r, "fcr"), 2), num: true },
    { h: t("사료 입고 kg"), v: (r) => nv(r.feed_in_kg), num: true },
    { h: t("사료 종류"), v: (r) => [r.feed_type, r.feed_brand].filter(Boolean).join(" · ") },
    { h: t("급수 L"), v: (r) => nv(r.water_l), num: true },
    { h: t("수사비"), v: (r) => nv(m(r, "water_feed_ratio"), 2), num: true },
    { h: t("계사온도"), v: (r) => (typeof r.temp_min === "number" ? `${r.temp_min}/${r.temp_max ?? ""}` : "") },
    { h: t("외기온도"), v: (r) => (typeof r.out_temp_min === "number" ? `${r.out_temp_min}/${r.out_temp_max ?? ""}` : "") },
    { h: t("체중 g"), v: (r) => nv(r.body_weight), num: true },
    { h: t("균일도"), v: (r) => (typeof r.uniformity === "number" ? `${r.uniformity}%` : "") },
    { h: t("메모"), v: (r) => (typeof r.memo === "string" ? r.memo : "") },
  ];

  const csv = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const body = [cols.map((c) => c.h), ...rows.map((r) => cols.map((c, i) => (i === 0 ? r.date : c.v(r).replace(/,/g, ""))))]
      .map((l) => l.map(esc).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
    a.download = `${farmName}_${sel === "all" ? "전체" : hname.get(sel)}_${last}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="panel-head">
        <h2>{t("일별 상세 기록")}</h2>
        <div className="bf-detail-tools">
          <div className="seg" role="group" aria-label={t("동")}>
            <button type="button" aria-pressed={sel === "all"} onClick={() => onSel("all")}>{t("전체")}</button>
            {houses.map((h) => (
              <button key={h.id} type="button" aria-pressed={sel === h.id} onClick={() => onSel(h.id)}>{h.name}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={t("기간")}>
            {[7, 14, 30, 60].map((n) => (
              <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{t("{n}일", { n })}</button>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-s" onClick={csv} disabled={!rows.length}>{t("CSV 내려받기")}</button>
        </div>
      </div>
      {!recs ? (
        <div className="bh-skeleton" style={{ height: 240 }} />
      ) : rows.length === 0 ? (
        <p className="muted-c" style={{ padding: 16 }}>{t("이 기간에 기록이 없습니다")}</p>
      ) : (
        <div className="bf-scroll bf-scroll-y">
          <table className="dt bf-dd">
            <thead>
              <tr>{cols.map((c) => <th key={c.h} className={c.num ? "num" : ""}>{c.h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.house_id}-${r.date}`}>
                  {cols.map((c) => <td key={c.h} className={c.num ? "num" : ""}>{c.v(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
