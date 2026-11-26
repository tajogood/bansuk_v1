"use client";

/* 반석이 농장 하나를 볼 때 (데스크탑, /?farm=ID)
   위: 농장 이름과 바로가기, 요약 띠
   가운데: 동별 지표 추이 (산란율·폐사·수당 사료·난중 전환, 기간 전환, 마우스 강조)
   오른쪽: 접종 예정, 폐사·부검
   아래: 동별 카드 (같은 일령 과거 계군 비교) */
import { useEffect, useMemo, useState } from "react";
import Dashboard from "./Dashboard";
import HomeCases from "./HomeCases";
import UpcomingVaccinations from "./UpcomingVaccinations";
import LineChart from "./viz/LineChart";
import { api } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { shiftISO, todayISO } from "@/lib/format";
import type { DayView } from "@/lib/types";

type Metric = "lay" | "mort" | "feed" | "eggw";

export default function BansukFarm({ token, farmId, farms }: { token: string; farmId: number; farms: { id: number; name: string }[] }) {
  const t = useT();
  const lang = useLang();
  const today = todayISO();
  const [range, setRange] = useState(90);
  const [metric, setMetric] = useState<Metric>("lay");
  const [day, setDay] = useState<DayView | null>(null);
  const [recs, setRecs] = useState<{ date: string; house_id: number; [k: string]: unknown }[] | null>(null);
  const [hi, setHi] = useState<string | number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.day(token, farmId, today).then(setDay, (e) => setErr((e as Error).message));
  }, [token, farmId, today, lang]);
  useEffect(() => {
    setRecs(null);
    api.dailyRange(token, farmId, shiftISO(today, -range + 1), today).then((r) => setRecs(r.records), (e) => setErr((e as Error).message));
  }, [token, farmId, today, range]);

  const dates = useMemo(() => Array.from({ length: range }, (_, i) => shiftISO(today, i - range + 1)), [today, range]);
  const houses = day?.houses.filter((h) => h.house.kind === "laying") ?? [];

  const pick = (r: Record<string, unknown>): number | null => {
    const m = (r.metrics ?? {}) as Record<string, number | null>;
    if (metric === "lay") return m.lay_rate && m.lay_rate > 0 && m.lay_rate <= 100 ? m.lay_rate : null;
    if (metric === "mort") return typeof r.mortality === "number" ? (r.mortality as number) : null;
    if (metric === "feed") return m.feed_per_bird_g ?? null;
    return typeof r.egg_weight === "number" ? (r.egg_weight as number) : null;
  };
  const series = useMemo(() => {
    if (!recs) return [];
    const idx = new Map(dates.map((d, i) => [d, i]));
    return houses.map((h) => {
      const vals: (number | null)[] = dates.map(() => null);
      for (const r of recs) if (r.house_id === h.house.id && idx.has(r.date)) vals[idx.get(r.date)!] = pick(r);
      return { id: h.house.id, name: h.house.name, values: vals };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, dates, day, metric]);

  // 요약: 최근 7일
  const stat = useMemo(() => {
    if (!recs) return null;
    const since = shiftISO(today, -6);
    const prevStart = shiftISO(today, -13);
    const wk = recs.filter((r) => r.date >= since);
    const pw = recs.filter((r) => r.date >= prevStart && r.date < since);
    const lay = (rs: typeof recs) => {
      let e = 0, b = 0;
      for (const r of rs) {
        const m = (r.metrics ?? {}) as Record<string, number | null>;
        if (m.total_eggs && r.bird_count) {
          e += m.total_eggs;
          b += r.bird_count as number;
        }
      }
      return b ? (e / b) * 100 : null;
    };
    const latest = new Map<number, number>();
    for (const r of recs) if (typeof r.bird_count === "number") latest.set(r.house_id, r.bird_count as number);
    const feed = wk.map((r) => ((r.metrics ?? {}) as Record<string, number | null>).feed_per_bird_g).filter((x): x is number => !!x);
    return {
      birds: [...latest.values()].reduce((a, b) => a + b, 0),
      lay: lay(wk),
      layPrev: lay(pw),
      deaths: wk.reduce((a, r) => a + ((r.mortality as number) || 0), 0),
      feed: feed.length ? feed.reduce((a, b) => a + b, 0) / feed.length : null,
    };
  }, [recs, today]);

  const name = farms.find((f) => f.id === farmId)?.name ?? day?.farm.name ?? "";
  const unit = metric === "lay" ? "%" : metric === "mort" ? "" : "g";
  const entered = day?.houses.filter((h) => h.record).length ?? 0;
  const metricLabel: Record<Metric, string> = { lay: t("산란율"), mort: t("폐사"), feed: t("수당 사료"), eggw: t("난중") };

  if (err) return <div className="bh"><p className="bh-err">{err}</p></div>;

  return (
    <div className="bh bf">
      <nav className="crumbs" aria-label={t("위치")}>
        <a href="/">{t("전체 농장 현황")}</a>
        <span aria-hidden>/</span>
        <select value={farmId} onChange={(e) => (window.location.href = `/?farm=${e.target.value}`)} aria-label={t("농장 선택")}>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </nav>
      <header className="bh-head">
        <div>
          <h1>{name}</h1>
          <p className="bh-date">
            {t("계사 {n}동", { n: houses.length })}, {t("오늘 입력 {a}/{b}", { a: entered, b: day?.houses.length ?? 0 })}
          </p>
        </div>
        <div className="bh-head-actions">
          <a className="btn-ghost" href={`/flocks/?farm=${farmId}`}>{t("계군 관리")}</a>
          <a className="btn-ghost" href={`/upload/?farm=${farmId}`}>{t("엑셀 올리기")}</a>
          <a className="btn-ghost" href={`/report/?farm=${farmId}`}>{t("성적 보고서")}</a>
          <a className="btn-primary" href={`/?farm=${farmId}&mode=input`}>{t("오늘 기록 입력")}</a>
        </div>
      </header>

      <section className="bh-stats bf-stats">
        <div>
          <span>{t("현재 수수")}</span>
          <strong>{stat ? stat.birds.toLocaleString() : "–"}<small>{t("수")}</small></strong>
          <em>{t("마지막 기록 기준")}</em>
        </div>
        <div>
          <span>{t("산란율 7일")}</span>
          <strong>{stat?.lay != null ? stat.lay.toFixed(1) : "–"}<small>%</small></strong>
          {stat?.lay != null && stat.layPrev != null && (
            <em className={stat.lay - stat.layPrev < 0 ? "down" : "up"}>
              {stat.lay - stat.layPrev > 0 ? "+" : ""}
              {(stat.lay - stat.layPrev).toFixed(1)}%p {t("지난주 대비")}
            </em>
          )}
        </div>
        <div>
          <span>{t("7일 폐사")}</span>
          <strong>{stat ? stat.deaths.toLocaleString() : "–"}<small>{t("수")}</small></strong>
          <em>{stat && stat.birds ? t("수수 대비 {p}%", { p: ((stat.deaths / stat.birds) * 100).toFixed(2) }) : ""}</em>
        </div>
        <div>
          <span>{t("수당 사료 7일")}</span>
          <strong>{stat?.feed != null ? stat.feed.toFixed(1) : "–"}<small>g</small></strong>
          <em>{t("하루 평균")}</em>
        </div>
      </section>

      <div className="bh-top">
        <section className="panel bh-chart">
          <div className="panel-head">
            <div className="seg" role="group" aria-label={t("지표")}>
              {(Object.keys(metricLabel) as Metric[]).map((k) => (
                <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)}>
                  {metricLabel[k]}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label={t("기간")}>
              {[30, 90, 180].map((n) => (
                <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>
                  {t("{n}일", { n })}
                </button>
              ))}
            </div>
          </div>
          {recs ? (
            <LineChart dates={dates} series={series} highlight={hi} onHighlight={setHi} height={320} unit={unit} label={t("동별 {m} 추이", { m: metricLabel[metric] })} />
          ) : (
            <div className="bh-skeleton" style={{ height: 320 }} />
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
                <i style={{ background: ["#1f6b4f", "#d99a00", "#3a7ca5", "#b5523b", "#6d5ba8", "#4f8f3a", "#8a6d3b", "#2a9d8f"][i % 8] }} />
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
            <HomeCases token={token} farmId={farmId} isBansuk />
          </section>
        </aside>
      </div>

      <section className="bf-houses">
        <h2>{t("동별 현황")}</h2>
        <Dashboard token={token} farmId={farmId} date={today} />
      </section>
    </div>
  );
}
