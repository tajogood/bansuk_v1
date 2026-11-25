"use client";

import { useEffect, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { epidemicApi, loadSession } from "@/lib/api";
import { DISEASES, label } from "@/lib/cases";
import { k, tr, useLang, useT } from "@/lib/i18n";
import type { Epidemic, EpidemicDisease, Session } from "@/lib/types";
import "../cases.css";
import "../lab.css";

const PERIODS = [30, 90, 180, 365];
const RECENT_WEEKS = 2;

function Spark({ d, weeks }: { d: EpidemicDisease; weeks: string[] }) {
  const t = useT();
  const max = Math.max(1, ...d.weekly);
  const W = 150, H = 34, n = d.weekly.length;
  const bw = W / n;
  return (
    <svg className="ep-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("주별 발생: {list}", { list: d.weekly.join(", ") })}>
      {d.weekly.map((v, i) => {
        const h = v ? Math.max(3, (v / max) * (H - 2)) : 0;
        return (
          <rect key={i} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} className={i >= n - RECENT_WEEKS ? "is-recent" : ""}>
            <title>{`${weeks[i]}: ${v}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Trend({ d, days }: { d: EpidemicDisease; days: number }) {
  const t = useT();
  if (!d.previous && d.count) return <span className="ep-trend is-up">{t("새로 발생")}</span>;
  const diff = d.count - d.previous;
  if (diff > 0) return <span className="ep-trend is-up" title={t("직전 {n}일 대비", { n: days })}>▲ {diff}</span>;
  if (diff < 0) return <span className="ep-trend is-down" title={t("직전 {n}일 대비", { n: days })}>▼ {-diff}</span>;
  return <span className="ep-trend">{t("변화 없음")}</span>;
}

const SOURCE: Record<string, string> = { necropsy: k("부검"), lab: k("검사"), both: k("부검+검사") };

export default function EpidemicPage() {
  const t = useT();
  const lang = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [days, setDays] = useState(90);
  const [region, setRegion] = useState("");
  const [data, setData] = useState<Epidemic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allRecent, setAllRecent] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!session) return;
    setError(null);
    epidemicApi.get(session.token, days, region || null).then(setData).catch((e) => setError(e.message));
  }, [session, days, region, lang]);

  if (!ready) return null;
  if (!session)
    return (
      <main className="cs-wrap"><p className="cs-pad">{t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a></p></main>
    );
  const d = data;
  return (
    <main className="cs-wrap">
      <header className="cs-head">
        <a href="/" className="cs-back">‹ {t("처음 화면")}</a>
        <h1>{t("최근 유행 질병")}</h1>
        <span className="cs-spacer" />
        <a href="/lab/" className="lb-head-link">{t("검사 결과")}</a>
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <div className="cs-body lb-body">
        <p className="cs-muted lb-note">
          {t("반석이 부검에서 의심한 질병과 PCR·배양 양성 결과를 모았습니다. 같은 농장의 같은 질병은 7일 안이면 한 번만 셉니다. 혈청 항체가는 백신 영향이 있어 넣지 않았습니다.")}
          {d && !d.show_farms && " " + t("농장 이름은 보여 주지 않습니다.")}
        </p>
        <div className="lb-filters">
          <div className="lb-chips" role="radiogroup" aria-label={t("기간")}>
            {PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>
                {p === 365 ? t("1년") : t("최근 {n}일", { n: p })}
              </button>
            ))}
          </div>
          {d && d.all_regions.length > 0 && (
            <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t("지역")}>
              <option value="">{t("전체 지역")}</option>
              {d.all_regions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="warn warn-error">{error}</p>}
        {!d ? (
          <p className="cs-muted">{t("불러오는 중")}</p>
        ) : (
          <>
            <dl className="ep-summary">
              <div><dt>{t("발생")}</dt><dd>{d.total}</dd></div>
              <div><dt>{t("농장")}</dt><dd>{d.farms}</dd></div>
              <div><dt>{t("검사로 확인")}</dt><dd>{d.confirmed}</dd></div>
            </dl>
            <div className="ep-cols">
              <section className="cs-sec">
                <div className="cs-sec-head">
                  <h2>{t("질병별")}</h2>
                  <span className="cs-muted">{t("최근 2주 발생이 많은 순")}</span>
                </div>
                {d.diseases.length === 0 ? (
                  <p className="cs-muted">{t("이 기간에 기록된 발생이 없습니다.")}</p>
                ) : (
                  <ul className="ep-list">
                    {d.diseases.map((x) => (
                      <li key={x.disease} className="ep-item">
                        <div className="ep-name">
                          <strong>{label(DISEASES, x.disease)}</strong>
                          <span>{t("{n}건", { n: x.count })}</span>
                          <Trend d={x} days={d.days} />
                        </div>
                        <Spark d={x} weeks={d.weeks} />
                        <p className="ep-meta">
                          {[
                            t("농장 {n}곳", { n: x.farms }),
                            x.recent ? t("최근 2주 {n}건", { n: x.recent }) : "",
                            x.confirmed ? t("검사 확인 {n}건", { n: x.confirmed }) : "",
                            x.regions.length ? x.regions.map((r) => `${r.region} ${r.count}`).join(", ") : "",
                            x.last ? t("마지막 {d}", { d: x.last }) : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <div className="cs-col-side">
                {d.regions.length > 0 && (
                  <section className="cs-sec">
                    <h2>{t("지역별")}</h2>
                    <table className="cs-table ep-region">
                      <thead>
                        <tr><th scope="col">{t("지역")}</th><th scope="col">{t("발생")}</th><th scope="col">{t("많은 질병")}</th></tr>
                      </thead>
                      <tbody>
                        {d.regions.map((r) => (
                          <tr key={r.region}>
                            <td>
                              <button type="button" className="link-btn" onClick={() => setRegion(region === r.region ? "" : r.region)}>{r.region}</button>
                            </td>
                            <td>{r.count}</td>
                            <td>{r.top.map((x) => `${label(DISEASES, x.disease)} ${x.count}`).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
                <section className="cs-sec">
                  <h2>{t("최근 발생")}</h2>
                  {d.recent.length === 0 ? (
                    <p className="cs-muted">{t("없음")}</p>
                  ) : (
                    <ul className="ep-recent">
                      {(allRecent ? d.recent : d.recent.slice(0, 12)).map((r, i) => {
                        const href = r.lab_id ? `/lab/?id=${r.lab_id}` : r.case_id ? `/cases/?id=${r.case_id}` : null;
                        const name = label(DISEASES, r.disease);
                        return (
                          <li key={i}>
                            <time>{r.date}</time>
                            {href ? <a href={href}>{name}</a> : <strong>{name}</strong>}
                            <small>
                              {[r.farm, r.region, tr(SOURCE[r.source])].filter(Boolean).join(" · ")}
                            </small>
                            {r.confirmed && <small className="ep-conf">{t("검사 확인")}</small>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!allRecent && d.recent.length > 12 && (
                    <button type="button" className="link-btn" onClick={() => setAllRecent(true)}>
                      {t("{n}건 더 보기", { n: d.recent.length - 12 })}
                    </button>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
