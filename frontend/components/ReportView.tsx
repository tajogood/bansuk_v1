import LayCurveChart from "./LayCurveChart";
import { k, locale, tr as t, useT } from "@/lib/i18n";
import type { FlockReport, MetricRow } from "@/lib/types";

const METRIC: Record<string, { label: string; unit: string; digits: number }> = {
  lay_rate: { label: k("산란율"), unit: "%", digits: 1 },
  egg_weight_g: { label: k("평균 난중"), unit: "g", digits: 1 },
  feed_per_bird_g: { label: k("수당 사료 섭취량"), unit: k("g/일"), digits: 1 },
  feed_per_egg_g: { label: k("알 1개당 사료"), unit: "g", digits: 1 },
  feed_per_kg_egg: { label: k("계란 1kg당 사료"), unit: "kg", digits: 2 },
  water_feed_ratio: { label: k("수사비 (급수÷사료)"), unit: "", digits: 2 },
  mortality_per_10k_day: { label: k("폐사 (1만 수당 하루)"), unit: k("수"), digits: 2 },
};

const f = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : v.toFixed(d));

function rankText(m: MetricRow) {
  if (!m.rank || !m.of) return "–";
  if (m.higher_is_better === null || m.higher_is_better === undefined) return t("높은 순 {r}/{n}", { r: m.rank, n: m.of });
  return t("{r}/{n}위", { r: m.rank, n: m.of });
}

/** 요약 문장: 숫자로 결론을 먼저 말한다. 순위 표현은 비교 계군이 충분할 때만. */
function summary(r: FlockReport): string[] {
  const c = r.comparison;
  if (!c || !c.target) return [t("비교할 기록이 부족합니다.")];
  const get = (k: string) => c.metrics.find((m) => m.metric === k);
  const out: string[] = [];
  const lay = get("lay_rate");
  const span = t("{a}~{b}일령", { a: c.age_from, b: c.age_to });
  if (lay?.target != null && lay.median != null) {
    const diff = lay.target - lay.median;
    const vars = { span, v: f(lay.target), n: lay.n, m: f(lay.median), d: Math.abs(diff).toFixed(1), of: lay.of ?? 0, r: lay.rank ?? 0 };
    const ranked = lay.n >= 3 && lay.rank;
    out.push(
      diff >= 0
        ? t(ranked ? "{span} 산란율은 {v}%로, 같은 농장 과거 계군 {n}개의 같은 일령 중앙값 {m}%보다 {d}%p 높습니다 ({of}개 중 {r}위)." : "{span} 산란율은 {v}%로, 같은 농장 과거 계군 {n}개의 같은 일령 중앙값 {m}%보다 {d}%p 높습니다.", vars)
        : t(ranked ? "{span} 산란율은 {v}%로, 같은 농장 과거 계군 {n}개의 같은 일령 중앙값 {m}%보다 {d}%p 낮습니다 ({of}개 중 {r}위)." : "{span} 산란율은 {v}%로, 같은 농장 과거 계군 {n}개의 같은 일령 중앙값 {m}%보다 {d}%p 낮습니다.", vars),
    );
  }
  const cv = r.curve, bc = r.baseline_curve;
  if (cv.age_at_50 && bc.median_age_at_50)
    out.push(
      t(cv.age_at_50 <= bc.median_age_at_50 ? "산란율 50% 도달은 {a}일령으로 과거 계군 중앙값({m}일령)보다 {d}일 빨랐습니다." : "산란율 50% 도달은 {a}일령으로 과거 계군 중앙값({m}일령)보다 {d}일 늦었습니다.", {
        a: cv.age_at_50,
        m: Math.round(bc.median_age_at_50),
        d: Math.abs(Math.round(bc.median_age_at_50 - cv.age_at_50)),
      }),
    );
  const fe = get("feed_per_egg_g");
  const fb = get("feed_per_bird_g");
  if (fe?.target != null && fe.median != null && fb?.target != null && fb.median != null)
    out.push(
      t("수당 사료 섭취량은 {a}g(과거 중앙값 {b}g), 알 1개당 사료는 {c}g(과거 중앙값 {d}g)입니다.", { a: f(fb.target), b: f(fb.median), c: f(fe.target), d: f(fe.median) }),
    );
  const mo = get("mortality_per_10k_day");
  if (mo?.target != null && mo.median != null)
    out.push(
      t(mo.target <= mo.median ? "폐사는 1만 수당 하루 {a}수로 과거 중앙값 {b}수 대비 적습니다." : "폐사는 1만 수당 하루 {a}수로 과거 중앙값 {b}수 대비 많습니다.", { a: f(mo.target, 2), b: f(mo.median, 2) }),
    );
  return out;
}

export default function ReportView({ r }: { r: FlockReport }) {
  useT();
  const c = r.comparison;
  const issued = r.meta.status === "issued";
  const dateOnly = (s?: string) => (s ? s.slice(0, 10) : "–");

  return (
    <article className="report">
      <header className="r-head">
        <div>
          <p className="r-org">{t("반석엘티씨 · 반석가금진료연구소")}</p>
          <h1>{t("계군 산란 성적 보고서")}</h1>
        </div>
        <dl className="r-id">
          <div>
            <dt>{t("보고서 번호")}</dt>
            <dd>{issued ? r.meta.report_no : t("미리보기 (발행 전)")}</dd>
          </div>
          <div>
            <dt>{issued ? t("발행일") : t("생성일")}</dt>
            <dd>{dateOnly(issued ? r.meta.issued_at : r.meta.generated_at)}</dd>
          </div>
        </dl>
      </header>

      {issued && r.meta.data_changed_since_issue && (
        <p className="r-alert">{t("이 보고서를 발행한 뒤 원자료가 수정되었습니다. 아래 내용은 발행 당시 기준입니다.")}</p>
      )}

      <table className="r-facts">
        <tbody>
          <tr>
            <th>{t("농장")}</th>
            <td>{r.farm.name}{r.farm.region ? ` (${r.farm.region})` : ""}</td>
            <th>{t("계군")}</th>
            <td>{t("{d} 입추, {n}수", { d: r.flock.placed_on, n: r.flock.placed_count.toLocaleString(locale()) })}</td>
          </tr>
          <tr>
            <th>{t("계사")}</th>
            <td>{r.flock.houses.join(" → ") || "–"}</td>
            <th>{t("품종")}</th>
            <td>{r.flock.breed ?? "–"}</td>
          </tr>
          <tr>
            <th>{t("백신프로그램")}</th>
            <td>{r.flock.program ?? t("미적용")}</td>
            <th>{t("비교 구간")}</th>
            <td>{c ? t("{a}~{b}일령 ({wa}~{wb}주령)", { a: c.age_from, b: c.age_to, wa: Math.floor(c.age_from / 7), wb: Math.floor(c.age_to / 7) }) : "–"}</td>
          </tr>
          <tr>
            <th>{t("비교 기준")}</th>
            <td colSpan={3}>
              {t(r.baseline === "past" ? "같은 농장의 이 계군보다 먼저 입추한 계군 {n}개, 같은 일령끼리 비교" : "같은 농장의 전체 계군 {n}개, 같은 일령끼리 비교", { n: c?.peer_count ?? 0 })}
            </td>
          </tr>
        </tbody>
      </table>

      <section className="r-sec">
        <h2>{t("요약")}</h2>
        <ul className="r-summary">
          {summary(r).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="r-sec">
        <h2>{t("일령별 산란율")}</h2>
        <LayCurveChart band={r.band} ageFrom={c?.age_from} ageTo={c?.age_to} />
        <p className="r-caption">
          {t("진한 선은 이 계군, 점선은 같은 농장 과거 계군의 일령별 중앙값, 회색 띠는 하위 10%~상위 10% 범위입니다. 모두 {n}일 이동평균이며, 옅은 녹색 구간이 비교 구간입니다.", { n: r.method.moving_average_days })}
        </p>
      </section>

      {c && (
        <section className="r-sec">
          <h2>{t("구간 지표 비교")}</h2>
          <table className="r-table">
            <thead>
              <tr>
                <th>{t("지표")}</th>
                <th className="num">{t("이 계군")}</th>
                <th className="num">{t("과거 중앙값")}</th>
                <th className="num">{t("과거 범위 (10~90%)")}</th>
                <th className="num">{t("순위")}</th>
              </tr>
            </thead>
            <tbody>
              {c.metrics.map((m) => {
                const meta = METRIC[m.metric];
                if (!meta) return null;
                return (
                  <tr key={m.metric}>
                    <td>
                      {t(meta.label)}
                      {meta.unit && <span className="r-unit"> ({t(meta.unit)})</span>}
                    </td>
                    <td className="num strong">{f(m.target, meta.digits)}</td>
                    <td className="num">{f(m.median, meta.digits)}</td>
                    <td className="num">{m.p10 != null ? `${f(m.p10, meta.digits)} ~ ${f(m.p90, meta.digits)}` : "–"}</td>
                    <td className="num">{rankText(m)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="r-caption">
            {t("구간 지표는 하루 비율의 평균이 아니라 구간 총량의 비율입니다 (예: 산란율 = 구간 총 산란수 ÷ 구간 누적 수수). 순위는 좋은 쪽이 1위이며, 사료 섭취량·수사비처럼 높고 낮음만으로 좋고 나쁨을 말할 수 없는 지표는 높은 순입니다.")}
          </p>
        </section>
      )}

      {c && c.grades.length > 0 && (
        <section className="r-sec r-avoid-break">
          <h2>{t("규격별 비율")}</h2>
          <table className="r-table r-grades">
            <thead>
              <tr>
                <th>{t("규격")}</th>
                <th>{t("비율")}</th>
                <th className="num">{t("이 계군")}</th>
                <th className="num">{t("과거 중앙값")}</th>
              </tr>
            </thead>
            <tbody>
              {c.grades.map((g) => (
                <tr key={g.grade}>
                  <td>{g.label}</td>
                  <td className="r-barcell">
                    <span className="r-bar" style={{ width: `${Math.min(100, g.target)}%` }} />
                    {g.median != null && <span className="r-bar-mark" style={{ left: `${Math.min(100, g.median)}%` }} />}
                  </td>
                  <td className="num strong">{g.target.toFixed(1)}%</td>
                  <td className="num">{g.median != null ? `${g.median.toFixed(1)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="r-caption">{t("막대는 이 계군, 세로 표시는 과거 계군 중앙값입니다.")}</p>
        </section>
      )}

      <section className="r-sec r-two">
        <div>
          <h2>{t("산란곡선 지표")}</h2>
          <table className="r-table">
            <tbody>
              <tr>
                <td>{t("산란율 50% 도달")}</td>
                <td className="num strong">{r.curve.age_at_50 ? t("{n}일령", { n: r.curve.age_at_50 }) : "–"}</td>
                <td className="num r-muted">{t("과거 {v}", { v: r.baseline_curve.median_age_at_50 ? t("{n}일령", { n: Math.round(r.baseline_curve.median_age_at_50) }) : "–" })}</td>
              </tr>
              <tr>
                <td>{t("7일 평균 피크")}</td>
                <td className="num strong">{r.curve.peak ? t("{p}% ({a}일령)", { p: r.curve.peak, a: r.curve.peak_age ?? "" }) : "–"}</td>
                <td className="num r-muted">{t("과거 {v}", { v: r.baseline_curve.median_peak ? `${r.baseline_curve.median_peak.toFixed(1)}%` : "–" })}</td>
              </tr>
              <tr>
                <td>{t("90% 이상 유지")}</td>
                <td className="num strong">{t("{n}일", { n: r.curve.days_over_90 })}</td>
                <td className="num r-muted">{t("기록 기간 중")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2>{t("데이터 출처")}</h2>
          <table className="r-table">
            <tbody>
              <tr>
                <td>{t("이 계군 기록")}</td>
                <td className="num">{t("{n}일 ({a} ~ {b})", { n: r.data.target_records.toLocaleString(locale()), a: r.data.first_date ?? "", b: r.data.last_date ?? "" })}</td>
              </tr>
              <tr>
                <td>{t("비교 계군 기록")}</td>
                <td className="num">{t("{f}개 계군, {n}일", { f: r.data.baseline_flocks, n: r.data.baseline_records.toLocaleString(locale()) })}</td>
              </tr>
              <tr>
                <td>{t("원자료 지문")}</td>
                <td className="num mono">{r.data.fingerprint}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="r-sec r-avoid-break">
        <h2>{t("방법과 한계")}</h2>
        <ul className="r-notes">
          <li>{t("원자료는 농장이 매일 입력하거나 업로드한 계사별 생산 기록(수수, 폐사, 규격별 산란수, 사료, 급수 등)이며, 산란율 등 지표는 원자료에서 매번 다시 계산합니다.")}</li>
          <li>{t("일령은 입추일을 {n}일령으로 셉니다. 계군 간 비교는 날짜가 아니라 같은 일령끼리 합니다.", { n: r.method.age_base })}</li>
          <li>
            {t("과거 계군은 비교 구간의 {p}% 이상 기록이 있는 경우만 포함하고, 일령별 띠는 그 일령에 과거 계군이 {n}개 이상일 때만 그립니다.", { p: Math.round(r.method.peer_min_coverage * 100), n: r.method.min_band_flocks })}
          </li>
          {r.cautions.map((x) => (
            <li key={x}>{x}</li>
          ))}
          <li>{t("원자료 지문이 같으면 같은 결과가 나옵니다. 원자료는 시스템에서 CSV로 내려받을 수 있습니다.")}</li>
        </ul>
      </section>

      <section className="r-sec r-sign r-avoid-break">
        <div>
          <h2>{t("검토 의견")}</h2>
          <div className="r-note-box">{r.meta.reviewer_note ?? ""}</div>
        </div>
        <div className="r-sign-box">
          <p>
            {t("작성")} <span>{issued ? r.meta.issued_by : ""}</span>
          </p>
          <p>
            {t("검토 수의사")} <span />
          </p>
          <p className="r-muted">{t("(서명)")}</p>
        </div>
      </section>

      <footer className="r-foot">
        {t("반석엘티씨 / 반석가금진료연구소 · 충청북도 음성군 대소면 대금로 54번길 8 · 본 보고서는 기록된 생산 자료에 근거한 분석이며, 기록되지 않은 사양·환경 요인은 반영하지 않았습니다.")}
      </footer>
    </article>
  );
}
