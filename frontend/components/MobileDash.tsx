"use client";

/* 농장주 모바일 대시보드 ('현황' 탭).
   위: 농장 요약 (최근 7일, 지난주 대비)
   가운데: 동별 산란율 4주 추이
   아래: 동 카드 (산란율·폐사·사료·난중·수사비·사료 종류·규격). 누르면 최근 7일 표가 펼쳐진다. */
import { useEffect, useMemo, useState } from "react";
import LineChart from "./viz/LineChart";
import { GradeBar } from "./BansukFarm";
import { api } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { shiftISO, todayISO } from "@/lib/format";
import { aggregate, between, dayValue, fmt, int, lastDate, m, type MetricKey, type Rec } from "@/lib/farmstats";
import type { DayView } from "@/lib/types";

export default function MobileDash({ token, farmId }: { token: string; farmId: number }) {
  const t = useT();
  const lang = useLang();
  const today = todayISO();
  const [day, setDay] = useState<DayView | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [metric, setMetric] = useState<MetricKey>("lay");

  useEffect(() => {
    setRecs(null);
    api.day(token, farmId, today).then(setDay, (e) => setErr((e as Error).message));
    api.dailyRange(token, farmId, shiftISO(today, -45), today).then((r) => setRecs(r.records as Rec[]), (e) => setErr((e as Error).message));
  }, [token, farmId, today, lang]);

  const last = recs ? lastDate(recs) : null;
  const houses = day?.houses ?? [];
  const layIds = new Set(houses.filter((h) => h.house.kind === "laying").map((h) => h.house.id));
  const w0 = last ? shiftISO(last, -6) : "";
  const p0 = last ? shiftISO(last, -13) : "";
  const wk = recs && last ? aggregate(between(recs, w0, last).filter((r) => layIds.has(r.house_id))) : null;
  const pw = recs && last ? aggregate(between(recs, p0, shiftISO(w0, -1)).filter((r) => layIds.has(r.house_id))) : null;
  const all = recs && last ? aggregate(between(recs, w0, last)) : null;

  const dates = useMemo(() => (last ? Array.from({ length: 28 }, (_, i) => shiftISO(last, i - 27)) : []), [last]);
  const series = useMemo(() => {
    if (!recs) return [];
    const idx = new Map(dates.map((d, i) => [d, i]));
    return houses
      .filter((h) => metric !== "lay" || h.house.kind === "laying")
      .map((h) => {
        const vals: (number | null)[] = dates.map(() => null);
        for (const r of recs) if (r.house_id === h.house.id && idx.has(r.date)) vals[idx.get(r.date)!] = dayValue(r, metric);
        return { id: h.house.id, name: h.house.name, values: vals };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, dates, day, metric]);

  if (err) return <p className="warn warn-error">{err}</p>;
  if (!recs || !day) return <p className="muted center">{t("불러오는 중")}</p>;
  if (!last) return <p className="muted center">{t("아직 기록이 없습니다")}</p>;

  const d = (a: number | null | undefined, b: number | null | undefined, digits = 1, goodUp = true) => {
    if (a == null || b == null) return null;
    const v = a - b;
    return <small className={(goodUp ? v >= 0 : v <= 0) ? "md-up" : "md-down"}>{v > 0 ? "▲" : v < 0 ? "▼" : ""}{Math.abs(v).toFixed(digits)}</small>;
  };

  return (
    <div className="md">
      <p className="md-when">{t("최근 7일 ({a} ~ {b})", { a: w0.slice(5).replace("-", "/"), b: last.slice(5).replace("-", "/") })}</p>
      <section className="md-sum">
        <div className="md-hero">
          <span>{t("산란율")}</span>
          <strong>{fmt(wk?.lay)}<small>%</small></strong>
          {d(wk?.lay, pw?.lay)}
          <em>{t("하루 {n}판", { n: wk && wk.days ? int(wk.eggs / wk.days / 30) : "–" })}</em>
        </div>
        <div><span>{t("현재 수수")}</span><strong>{int(all?.birds)}</strong></div>
        <div><span>{t("7일 폐사")}</span><strong>{int(all?.deaths)}</strong><em>{fmt(all?.deathPct, 2)}%</em></div>
        <div><span>{t("수당 사료")}</span><strong>{fmt(wk?.feedG)}<small>g</small></strong>{d(wk?.feedG, pw?.feedG, 1, false)}</div>
        <div><span>{t("사료요구율")}</span><strong>{fmt(wk?.fcr, 2)}</strong>{d(wk?.fcr, pw?.fcr, 2, false)}</div>
        <div><span>{t("평균 난중")}</span><strong>{fmt(wk?.eggW)}<small>g</small></strong></div>
        <div><span>{t("수사비")}</span><strong>{fmt(wk?.wf, 2)}</strong></div>
      </section>

      <section className="md-chart">
        <div className="md-seg" role="group" aria-label={t("지표")}>
          {(
            [
              ["lay", t("산란율")],
              ["feed", t("사료")],
              ["mort", t("폐사")],
              ["eggw", t("난중")],
            ] as [MetricKey, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>
          ))}
        </div>
        <LineChart dates={dates} series={series} height={190} unit={metric === "lay" ? "%" : metric === "mort" ? "" : "g"} label={t("4주 추이")} />
        <div className="md-legend">
          {series.map((s, i) => (
            <span key={s.id}><i style={{ background: `var(--bs-c${i % 8})` }} />{s.name}</span>
          ))}
        </div>
      </section>

      <h2 className="md-h">{t("동별 현황")}</h2>
      <ul className="md-houses">
        {houses.map((h) => {
          const a = aggregate(between(recs, w0, last, h.house.id));
          const b = aggregate(between(recs, p0, shiftISO(w0, -1), h.house.id));
          const rearing = h.house.kind === "rearing";
          const isOpen = open === h.house.id;
          const rows = between(recs, shiftISO(last, -6), last, h.house.id).sort((x, y) => (x.date < y.date ? 1 : -1));
          return (
            <li key={h.house.id} className={isOpen ? "is-open" : ""}>
              <button type="button" className="md-house" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.house.id)}>
                <span className="md-hname">
                  <strong>{h.house.name}</strong>
                  <small>{h.flock ? t("{n}주령", { n: h.flock.age_weeks }) : t("계군 없음")} · {int(a.birds)}{t("수")}</small>
                </span>
                <span className="md-hlay">
                  {rearing ? <em>{t("육성")}</em> : <>{fmt(a.lay)}<small>%</small>{d(a.lay, b.lay)}</>}
                </span>
              </button>
              <div className="md-hgrid">
                <span>{t("폐사")}<b>{int(a.deaths)}</b></span>
                <span>{t("수당 사료")}<b>{fmt(a.feedG)}g</b></span>
                {!rearing && <span>{t("난중")}<b>{fmt(a.eggW)}g</b></span>}
                {!rearing && <span>{t("사료요구율")}<b>{fmt(a.fcr, 2)}</b></span>}
                <span>{t("수사비")}<b>{fmt(a.wf, 2)}</b></span>
                <span>{t("사료")}<b>{a.feedType ?? "–"}</b></span>
              </div>
              {!rearing && <div className="md-grade"><GradeBar grades={a.grades} /></div>}
              {isOpen && (
                <table className="md-days">
                  <thead>
                    <tr>
                      <th>{t("날짜")}</th>
                      <th>{rearing ? t("수수") : t("산란율")}</th>
                      <th>{t("폐사")}</th>
                      <th>{t("사료 g")}</th>
                      <th>{rearing ? t("급수 L") : t("난중")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.date}>
                        <td>{r.date.slice(5).replace("-", "/")}</td>
                        <td>{rearing ? int(r.bird_count) : fmt(m(r, "lay_rate"))}</td>
                        <td>{int(typeof r.mortality === "number" ? r.mortality : null)}</td>
                        <td>{fmt(m(r, "feed_per_bird_g"))}</td>
                        <td>{rearing ? int(typeof r.water_l === "number" ? r.water_l : null) : fmt(typeof r.egg_weight === "number" ? r.egg_weight : null, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
