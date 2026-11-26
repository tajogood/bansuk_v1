"use client";

/* 반석 첫 화면 (데스크탑): 오늘 할 일 + 전체 농장 표. 농장을 누르면 그 농장 화면으로 간다. */
import { useEffect, useMemo, useState } from "react";
import { overviewApi, type Overview, type OverviewFarm } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";

type SortKey = "name" | "lay_rate_7d" | "lay_rate_change" | "mortality_7d" | "open_cases";

export default function BansukHome({ token }: { token: string }) {
  const t = useT();
  const lang = useLang();
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "name", desc: false });
  const [q, setQ] = useState("");

  useEffect(() => {
    overviewApi.get(token).then(setD, (e) => setErr((e as Error).message));
  }, [token, lang]);

  const rows = useMemo(() => {
    if (!d) return [];
    const list = d.farms.filter((f) => !q || f.name.includes(q) || (f.region ?? "").includes(q));
    const v = (f: OverviewFarm) => (sort.k === "name" ? f.name : (f[sort.k] as number | null) ?? -Infinity);
    return [...list].sort((a, b) => {
      const x = v(a), y = v(b);
      const c = typeof x === "string" ? x.localeCompare(y as string, "ko") : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
  }, [d, q, sort]);

  if (err) return <div className="bh"><p className="bh-err">{err}</p></div>;
  if (!d) return <div className="bh"><p className="bh-muted">{t("불러오는 중")}</p></div>;

  const active = d.farms.filter((f) => f.houses > 0);
  const lays = active.map((f) => f.lay_rate_7d).filter((x): x is number => x !== null);
  const avgLay = lays.length ? (lays.reduce((a, b) => a + b, 0) / lays.length).toFixed(1) : "–";
  const overdue = d.todo.vaccinations.filter((v) => v.status === "overdue").length;
  const th = (k: SortKey, label: string, num = false) => (
    <th
      className={num ? "num" : ""}
      aria-sort={sort.k === k ? (sort.desc ? "descending" : "ascending") : "none"}
      onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== "name" }))}
    >
      {label}
      {sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div className="bh">
      <header className="bh-head">
        <div>
          <h1>{t("전체 농장 현황")}</h1>
          <p className="bh-muted">{d.today}</p>
        </div>
        <a className="bh-btn" href="/admin/">{t("농장 추가")}</a>
      </header>

      <section className="bh-kpis">
        <div><span>{t("관리 농장")}</span><strong>{d.farms.length}</strong><small>{t("계군 있는 농장 {n}", { n: active.length })}</small></div>
        <div><span>{t("평균 산란율 (7일)")}</span><strong>{avgLay}{avgLay !== "–" && "%"}</strong><small>{t("계군 있는 농장 기준")}</small></div>
        <div className={d.todo.cases.length ? "is-alert" : ""}><span>{t("반석 답변 대기 부검")}</span><strong>{d.todo.cases.length}</strong><small>{t("신고·일정 조정")}</small></div>
        <div className={overdue ? "is-alert" : ""}><span>{t("밀린 접종")}</span><strong>{overdue}</strong><small>{t("7일 안 예정 {n}", { n: d.todo.vaccinations.length - overdue })}</small></div>
        <div className={d.todo.missing_input.length ? "is-warn" : ""}><span>{t("오늘 입력 안 된 농장")}</span><strong>{d.todo.missing_input.length}</strong><small>{d.todo.missing_input.slice(0, 3).join(", ") || t("모두 입력됨")}</small></div>
      </section>

      <div className="bh-grid">
        <section className="bh-card bh-farms">
          <div className="bh-card-head">
            <h2>{t("농장")}</h2>
            <input placeholder={t("농장·지역 검색")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <table className="bh-table">
            <thead>
              <tr>
                {th("name", t("농장"))}
                <th>{t("지역")}</th>
                <th className="num">{t("오늘 입력")}</th>
                {th("lay_rate_7d", t("산란율 7일"), true)}
                {th("lay_rate_change", t("전주 대비"), true)}
                {th("mortality_7d", t("폐사 7일"), true)}
                {th("open_cases", t("부검 진행"), true)}
                <th className="num">{t("접종")}</th>
                <th>{t("마지막 입력")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} onClick={() => (window.location.href = `/?farm=${f.id}`)}>
                  <td><a href={`/?farm=${f.id}`}>{f.name}</a></td>
                  <td>{f.region ?? ""}</td>
                  <td className="num">{f.houses ? <span className={f.entered_today < f.houses ? "is-warn" : "is-ok"}>{f.entered_today}/{f.houses}</span> : <span className="bh-muted">{t("계군 없음")}</span>}</td>
                  <td className="num">{f.lay_rate_7d !== null ? `${f.lay_rate_7d}%` : "–"}</td>
                  <td className={`num ${f.lay_rate_change === null ? "" : f.lay_rate_change < -2 ? "is-bad" : f.lay_rate_change > 0 ? "is-ok" : ""}`}>
                    {f.lay_rate_change === null ? "–" : `${f.lay_rate_change > 0 ? "+" : ""}${f.lay_rate_change}%p`}
                  </td>
                  <td className="num">{f.mortality_7d.toLocaleString()}</td>
                  <td className="num">{f.open_cases ? <span className={f.cases_awaiting_bansuk ? "is-bad" : ""}>{f.open_cases}</span> : "–"}</td>
                  <td className="num">{f.vacc_overdue ? <span className="is-bad">{t("밀림 {n}", { n: f.vacc_overdue })}</span> : f.vacc_week ? t("{n}건", { n: f.vacc_week }) : "–"}</td>
                  <td>{f.last_input ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="bh-side">
          <section className="bh-card">
            <div className="bh-card-head"><h2>{t("반석 답변 대기 부검")}</h2><a href="/cases/">{t("전체")}</a></div>
            {d.todo.cases.length === 0 ? <p className="bh-muted">{t("없음")}</p> : (
              <ul className="bh-list">
                {d.todo.cases.map((c) => (
                  <li key={c.id}><a href={`/cases/?id=${c.id}`}><strong>{c.farm}</strong><span>{c.dead_count != null ? t("폐사 {n}수", { n: c.dead_count }) : ""} · {c.reported_at?.slice(0, 10)}</span></a></li>
                ))}
              </ul>
            )}
          </section>
          <section className="bh-card">
            <div className="bh-card-head"><h2>{t("접종 일정 (7일)")}</h2><a href="/vaccines/">{t("전체")}</a></div>
            {d.todo.vaccinations.length === 0 ? <p className="bh-muted">{t("없음")}</p> : (
              <ul className="bh-list">
                {d.todo.vaccinations.map((v) => (
                  <li key={`${v.flock_id}-${v.planned}-${v.vaccine}`} className={v.status === "overdue" ? "is-bad" : ""}>
                    <a href={`/vaccination/?flock=${v.flock_id}`}><strong>{v.farm} · {v.house}</strong><span>{v.planned.slice(5)} · {v.vaccine}{v.status === "overdue" ? ` · ${t("밀림")}` : ""}</span></a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
