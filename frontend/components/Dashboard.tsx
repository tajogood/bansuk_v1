"use client";

import { useEffect, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import type { Dashboard as DashboardData } from "@/lib/types";

/**
 * 농장주 운영 대시보드. 동마다 '지금 잘 되고 있나'를 한눈에:
 * 최근 7일 산란율, 우리 농장 과거 계군의 같은 일령과 비교한 위치, 4주 추이, 폐사·사료·급수.
 * 모든 농장이 같은 화면을 쓴다 (엑셀 양식 차이는 이관 단계에서 흡수).
 */
export default function Dashboard({ token, farmId, date }: { token: string; farmId: number; date: string }) {
  const t = useT();
  const lang = useLang();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .dashboard(token, farmId, date)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token, farmId, date, lang]);

  if (error) return <p className="warn warn-error">{error}</p>;
  if (!data) return <p className="muted center">{t("불러오는 중")}</p>;

  return (
    <div className="dash">
      {data.houses.map((h) => {
        const last7 = h.daily.slice(-7);
        const mort7 = last7.reduce((s, d) => s + (d.mortality ?? 0), 0);
        const latest = [...h.daily].reverse().find((d) => d.bird_count);
        const p = h.position;
        const rearing = h.house.kind === "rearing";
        return (
          <section key={h.house.id} className="dash-card">
            <header>
              <h2>{h.house.name}</h2>
              <span className="dash-age">{h.flock ? t("{n}주령", { n: h.flock.age_weeks }) : t("계군 없음")}</span>
              {h.flock?.program && <span className="dash-tag">{t("반석 프로그램")}</span>}
            </header>

            {!rearing && p ? (
              <div className="dash-main">
                <div className="dash-big">
                  <strong>{p.lay_7d.toFixed(1)}%</strong>
                  <span>{t("최근 7일 산란율")}</span>
                </div>
                <p className="dash-compare">
                  {p.past_median !== null ? (
                    <>
                      {t("우리 농장 과거 계군의 같은 일령 중앙값")} <b>{p.past_median.toFixed(1)}%</b>
                      <br />
                      {t("{n}개 계군 중", { n: p.past_n })}{" "}
                      <b className={p.better_than_pct! >= 50 ? "is-good" : "is-low"}>
                        {p.better_than_pct! >= 50 ? t("상위 {n}%", { n: 100 - p.better_than_pct! }) : t("하위 {n}%", { n: p.better_than_pct! })}
                      </b>
                    </>
                  ) : (
                    t("같은 일령의 과거 계군 기록이 아직 부족합니다.")
                  )}
                </p>
              </div>
            ) : null}

            {!rearing && <Spark values={h.daily.map((d) => d.lay_rate)} />}

            <dl className="dash-stats">
              <div>
                <dt>{t("현재 수수")}</dt>
                <dd>{latest?.bird_count ? num(latest.bird_count) : "–"}</dd>
              </div>
              <div>
                <dt>{t("폐사 (7일)")}</dt>
                <dd>{t("{n}수", { n: num(mort7) })}</dd>
              </div>
              <div>
                <dt>{t("수당 사료")}</dt>
                <dd>{latest?.feed_per_bird_g ? `${latest.feed_per_bird_g}g` : "–"}</dd>
              </div>
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function Spark({ values }: { values: (number | null)[] }) {
  const t = useT();
  const W = 320, H = 64, P = 4;
  const vs = values.map((v) => (v !== null && v <= 105 ? v : null));
  const nums = vs.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums) - 1, hi = Math.max(...nums) + 1;
  const X = (i: number) => P + (i / Math.max(1, vs.length - 1)) * (W - 2 * P);
  const Y = (v: number) => P + (1 - (v - lo) / Math.max(0.1, hi - lo)) * (H - 2 * P);
  let d = "";
  let pen = false;
  vs.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  });
  const lastI = vs.length - 1 - [...vs].reverse().findIndex((v) => v !== null);
  return (
    <figure className="dash-spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("최근 {n}일 산란율 추이", { n: vs.length })}>
        <path d={d} fill="none" stroke="#1F5F45" strokeWidth={2} />
        <circle cx={X(lastI)} cy={Y(vs[lastI]!)} r={3.5} fill="#1F5F45" />
      </svg>
      <figcaption>
        {t("최근 {n}일 산란율 (낮음 {lo}% · 높음 {hi}%)", { n: vs.length, lo: Math.min(...nums).toFixed(1), hi: Math.max(...nums).toFixed(1) })}
      </figcaption>
    </figure>
  );
}
