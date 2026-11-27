"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { k, locale, tr, useLang } from "@/lib/i18n";
import SeriesChart, { toCsv } from "@/components/SeriesChart";
import { analysisApi, loadSession } from "@/lib/api";
import { DISEASES } from "@/lib/cases";
import { ANTIGENS } from "@/lib/lab";
import type { AnalysisDashboard, AnalysisQuery, AnalysisSource, Catalog, ChartKind, QueryResult, Session, Widget } from "@/lib/types";
import "../analysis.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);

const METRIC_GROUPS: { label: string; match: (k: string) => boolean }[] = [
  { label: k("산란"), match: (k) => ["lay_rate", "total_eggs", "egg_weight"].includes(k) },
  { label: k("규격 비율"), match: (k) => k.startsWith("share_") },
  { label: k("사료·물"), match: (k) => k.startsWith("feed_") || k.startsWith("water_") },
  { label: k("수수·폐사"), match: (k) => ["bird_count", "mortality", "mortality_per_10k"].includes(k) },
  { label: k("환경"), match: (k) => ["temp_max", "temp_min", "humidity"].includes(k) },
];

const DEFAULT_Q: AnalysisQuery = {
  source: "production",
  metric: "lay_rate",
  x: "age_weeks",
  group: "flock",
  farm_ids: [],
  program: "any",
  house_kind: "laying",
  smooth: false,
  date_from: null,
  date_to: null,
  age_from: null,
  age_to: null,
};

const uid = () => Math.random().toString(36).slice(2, 9);

/** 데이터 출처별 지표·축·묶음 */
function specOf(c: Catalog, source: AnalysisSource) {
  if (source !== "production" && c.events?.[source]) return c.events[source];
  return { label: tr("생산 기록"), metrics: c.metrics, x_axes: c.x_axes, groups: c.groups };
}

const EVENT_DEFAULTS: Record<string, Partial<AnalysisQuery>> = {
  necropsy: { metric: "cases", x: "month", group: "disease" },
  lab: { metric: "tests", x: "month", group: "disease" },
  vaccination: { metric: "vaccinations", x: "month", group: "vaccine" },
};

function autoTitle(q: AnalysisQuery, c: Catalog | null) {
  if (!c) return "";
  const sp = specOf(c, q.source);
  const m = sp.metrics[q.metric]?.label ?? q.metric;
  const x = sp.x_axes[q.x] ?? q.x;
  const g = sp.groups[q.group] ?? q.group;
  return tr("{x}별 {m} ({g})", { x, m, g });
}

function describe(q: AnalysisQuery, farms: Session["farms"]): string {
  const parts: string[] = [];
  parts.push(q.farm_ids.length ? farms.filter((f) => q.farm_ids.includes(f.id)).map((f) => f.name).join(", ") : tr("전체 농장"));
  if (q.source !== "production") {
    if (q.disease) parts.push(tr(DISEASES.find((d) => d.code === q.disease)?.label ?? q.disease));
    if (q.antigen) parts.push(tr(ANTIGENS.find((d) => d.code === q.antigen)?.label ?? q.antigen));
    if (q.date_from || q.date_to) parts.push(`${q.date_from ?? tr("처음")} ~ ${q.date_to ?? tr("현재")}`);
    return parts.join(", ");
  }
  if (q.house_kind !== "all") parts.push(q.house_kind === "laying" ? tr("산란계사") : tr("육성사"));
  if (q.program !== "any") parts.push(q.program === "applied" ? tr("프로그램 적용 계군") : tr("미적용 계군"));
  if (q.date_from || q.date_to) parts.push(`${q.date_from ?? tr("처음")} ~ ${q.date_to ?? tr("현재")}`);
  if (q.age_from || q.age_to) parts.push(tr("{a}~{b}일령", { a: q.age_from ?? 1, b: q.age_to ?? "" }));
  if (q.smooth) parts.push(tr("7일 평균"));
  return parts.join(", ");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalysisPage() {
  const lang = useLang();
  const t = tr;
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [q, setQ] = useState<AnalysisQuery>(DEFAULT_Q);
  const [chart, setChart] = useState<ChartKind>("line");
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingWidget, setEditingWidget] = useState<string | null>(null);

  const [dashboards, setDashboards] = useState<AnalysisDashboard[]>([]);
  const [current, setCurrent] = useState<AnalysisDashboard | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [results, setResults] = useState<Record<string, QueryResult | "loading" | string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2000);
  };

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    if (!s || !BANSUK.has(s.user.role)) return;
    analysisApi
      .list(s.token)
      .then((r) => {
        setDashboards(r.dashboards);
        if (r.dashboards[0]) setCurrent(r.dashboards[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!session || !BANSUK.has(session.user.role)) return;
    analysisApi.catalog(session.token).then(setCatalog).catch((e) => setError(e.message));
  }, [session, lang]);

  // 조건이 바뀌면 잠시 뒤 미리보기를 다시 계산
  useEffect(() => {
    if (!session || !catalog) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setRunning(true);
      setError(null);
      try {
        setPreview(await analysisApi.query(session.token, q));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setRunning(false);
      }
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q, session, catalog, lang]);

  // 대시보드 위젯 계산
  const runWidgets = useCallback(
    async (d: AnalysisDashboard | null) => {
      if (!session || !d) return;
      const init: Record<string, QueryResult | "loading" | string> = {};
      d.widgets.forEach((w) => (init[w.id] = "loading"));
      setResults(init);
      await Promise.all(
        d.widgets.map(async (w) => {
          try {
            const r = await analysisApi.query(session.token, w.query);
            setResults((s) => ({ ...s, [w.id]: r }));
          } catch (e) {
            setResults((s) => ({ ...s, [w.id]: (e as Error).message }));
          }
        }),
      );
    },
    [session],
  );
  useEffect(() => {
    runWidgets(current);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, lang]);

  const patchQ = (p: Partial<AnalysisQuery>) => setQ((s) => ({ ...s, ...p }));

  const changeDash = (d: AnalysisDashboard) => {
    setCurrent(d);
    setDirty(true);
  };

  const addToDashboard = async () => {
    if (!session || !preview) return;
    const w: Widget = { id: editingWidget ?? uid(), title, chart, width: 1, query: q };
    let d = current;
    if (!d) {
      d = await analysisApi.create(session.token, { name: t("새 대시보드"), shared: false, widgets: [] });
      setDashboards((s) => [d!, ...s]);
    }
    const exists = d.widgets.some((x) => x.id === w.id);
    const widgets = exists ? d.widgets.map((x) => (x.id === w.id ? { ...w, width: x.width } : x)) : [...d.widgets, w];
    const next = { ...d, widgets };
    setCurrent(next);
    setResults((s) => ({ ...s, [w.id]: preview }));
    setDirty(true);
    setEditingWidget(null);
    flash(exists ? t("차트를 고쳤습니다. 저장을 눌러 반영하세요.") : t("대시보드에 추가했습니다. 저장을 눌러 반영하세요."));
  };

  const save = async () => {
    if (!session || !current) return;
    const body = { name: current.name, shared: current.shared, widgets: current.widgets };
    const saved = current.id ? await analysisApi.update(session.token, current.id, body) : await analysisApi.create(session.token, body);
    setCurrent(saved);
    setDashboards((s) => [saved, ...s.filter((x) => x.id !== saved.id)]);
    setDirty(false);
    flash(t("저장했습니다"));
  };

  const newDashboard = async () => {
    if (!session) return;
    const d = await analysisApi.create(session.token, { name: t("새 대시보드"), shared: false, widgets: [] });
    setDashboards((s) => [d, ...s]);
    setCurrent(d);
    setEditMode(true);
  };

  const removeDashboard = async () => {
    if (!session || !current) return;
    await analysisApi.remove(session.token, current.id);
    const rest = dashboards.filter((d) => d.id !== current.id);
    setDashboards(rest);
    setCurrent(rest[0] ?? null);
    flash(t("대시보드를 지웠습니다"));
  };

  const moveWidget = (id: string, dir: -1 | 1) => {
    if (!current) return;
    const ws = [...current.widgets];
    const i = ws.findIndex((w) => w.id === id);
    const j = i + dir;
    if (j < 0 || j >= ws.length) return;
    [ws[i], ws[j]] = [ws[j], ws[i]];
    changeDash({ ...current, widgets: ws });
  };
  const patchWidget = (id: string, p: Partial<Widget>) => {
    if (!current) return;
    changeDash({ ...current, widgets: current.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) });
  };
  const editWidget = (w: Widget) => {
    setQ(w.query);
    setChart(w.chart);
    setTitle(w.title);
    setEditingWidget(w.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const spec = catalog ? specOf(catalog, q.source) : null;
  const metricOptions = useMemo(() => {
    if (!catalog) return [];
    if (q.source !== "production") return [{ label: specOf(catalog, q.source).label, items: Object.entries(specOf(catalog, q.source).metrics) }];
    return METRIC_GROUPS.map((g) => ({
      label: g.label,
      items: Object.entries(catalog.metrics).filter(([k]) => g.match(k)),
    }));
  }, [catalog, q.source]);

  if (!session)
    return (
      <main className="an-wrap">
        <p className="an-pad">
          {t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a>
        </p>
      </main>
    );
  if (!BANSUK.has(session.user.role))
    return (
      <main className="an-wrap">
        <p className="an-pad">{t("분석기는 반석 계정에서 사용할 수 있습니다.")}</p>
      </main>
    );

  return (
    <main className="an-wrap">
      <header className="an-head">
        <a href="/" className="an-back">‹ {t("생산 기록")}</a>
        <h1>{t("데이터 분석기")}</h1>
        <span className="an-spacer" />
        <a href="/cases/" className="an-link">{t("폐사·부검")}</a>
        <a href="/report/" className="an-link">{t("계군 성적 보고서")}</a>
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>

      <div className="an-body">
        {/* ---------- 차트 만들기 ---------- */}
        <aside className="an-builder" aria-label={t("차트 만들기")}>
          <h2>{editingWidget ? t("차트 고치기") : t("차트 만들기")}</h2>
          <label>
            {t("데이터")}
            <select
              value={q.source}
              onChange={(e) => {
                const source = e.target.value as AnalysisSource;
                setQ(
                  source === "production"
                    ? { ...DEFAULT_Q, farm_ids: q.farm_ids, date_from: q.date_from, date_to: q.date_to }
                    : { ...q, ...EVENT_DEFAULTS[source], source, disease: null, antigen: null, smooth: false },
                );
              }}
            >
              <option value="production">{t("생산 기록")}</option>
              <option value="lab">{t("검사 결과")}</option>
              <option value="necropsy">{t("부검 기록")}</option>
              <option value="vaccination">{t("백신 접종")}</option>
            </select>
          </label>
          <label>
            {t("지표")}
            <select value={q.metric} onChange={(e) => patchQ({ metric: e.target.value })}>
              {metricOptions.map((g) => (
                <optgroup key={g.label} label={t(g.label)}>
                  {g.items.map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}{m.unit ? ` (${m.unit})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="an-row">
            <label>
              {t("가로축")}
              <select value={q.x} onChange={(e) => patchQ({ x: e.target.value })}>
                {spec && Object.entries(spec.x_axes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>
              {t("묶음")}
              <select value={q.group} onChange={(e) => patchQ({ group: e.target.value })}>
                {spec && Object.entries(spec.groups).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>{t("농장 (선택 안 하면 전체)")}</legend>
            <div className="an-checks">
              {session.farms.map((f) => (
                <label key={f.id} className="an-check">
                  <input
                    type="checkbox"
                    checked={q.farm_ids.includes(f.id)}
                    onChange={(e) =>
                      patchQ({ farm_ids: e.target.checked ? [...q.farm_ids, f.id] : q.farm_ids.filter((x) => x !== f.id) })
                    }
                  />
                  {f.name}
                </label>
              ))}
            </div>
          </fieldset>
          {q.source === "production" ? (
          <div className="an-row">
              <label>
                {t("계사")}
                <select value={q.house_kind} onChange={(e) => patchQ({ house_kind: e.target.value as AnalysisQuery["house_kind"] })}>
                  <option value="laying">{t("산란계사")}</option>
                  <option value="rearing">{t("육성사")}</option>
                  <option value="all">{t("전체")}</option>
                </select>
              </label>
              <label>
                {t("백신프로그램")}
                <select value={q.program} onChange={(e) => patchQ({ program: e.target.value as AnalysisQuery["program"] })}>
                  <option value="any">{t("전체 계군")}</option>
                  <option value="applied">{t("적용 계군")}</option>
                  <option value="not">{t("미적용 계군")}</option>
                </select>
              </label>
            </div>
          ) : (
            <div className="an-row">
              <label>
                {t("질병")}
                <select value={q.disease ?? ""} onChange={(e) => patchQ({ disease: e.target.value || null })}>
                  <option value="">{t("전체")}</option>
                  {DISEASES.map((d) => (
                    <option key={d.code} value={d.code}>{t(d.label)}</option>
                  ))}
                </select>
              </label>
              {q.source === "lab" && (
                <label>
                  {t("항원 (혈청)")}
                  <select value={q.antigen ?? ""} onChange={(e) => patchQ({ antigen: e.target.value || null })}>
                    <option value="">{t("전체")}</option>
                    {ANTIGENS.map((a) => (
                      <option key={a.code} value={a.code}>{t(a.label)}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="an-row">
            <label>
              {t("기간 시작")}
              <input type="date" value={q.date_from ?? ""} onChange={(e) => patchQ({ date_from: e.target.value || null })} />
            </label>
            <label>
              {t("기간 끝")}
              <input type="date" value={q.date_to ?? ""} onChange={(e) => patchQ({ date_to: e.target.value || null })} />
            </label>
          </div>
          <div className="an-row">
            <label>
              {t("일령 부터")}
              <input inputMode="numeric" value={q.age_from ?? ""} onChange={(e) => patchQ({ age_from: Number(e.target.value.replace(/\D/g, "")) || null })} />
            </label>
            <label>
              {t("일령 까지")}
              <input inputMode="numeric" value={q.age_to ?? ""} onChange={(e) => patchQ({ age_to: Number(e.target.value.replace(/\D/g, "")) || null })} />
            </label>
          </div>
          {q.source === "production" && <label className="an-check">
            <input type="checkbox" checked={q.smooth} onChange={(e) => patchQ({ smooth: e.target.checked })} disabled={!["date", "age_days"].includes(q.x)} />
            {t("7일 이동평균 (날짜·일령 축)")}
          </label>}
          <div className="an-seg" role="radiogroup" aria-label={t("차트 형태")}>
            {(["line", "bar", "table"] as ChartKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={chart === k} onClick={() => setChart(k)}>
                {k === "line" ? t("선") : k === "bar" ? t("막대") : t("표")}
              </button>
            ))}
          </div>
          <label>
            {t("제목")}
            <input value={title} placeholder={autoTitle(q, catalog)} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="an-actions">
            {editingWidget && (
              <button type="button" onClick={() => { setEditingWidget(null); setTitle(""); }}>
                {t("취소")}
              </button>
            )}
            <button type="button" className="an-primary" onClick={addToDashboard} disabled={!preview || running}>
              {editingWidget ? t("이 차트 고치기") : t("대시보드에 추가")}
            </button>
          </div>
        </aside>

        {/* ---------- 미리보기 + 대시보드 ---------- */}
        <section className="an-main">
          <div className="an-card an-preview">
            <div className="an-card-head">
              <div>
                <h3>{title || autoTitle(q, catalog)}</h3>
                <p>{describe(q, session.farms)}{preview ? `. ${t("기록 {n}건", { n: preview.record_count.toLocaleString(locale()) })}` : ""}
                  {preview?.metric.note ? `. ${preview.metric.note}` : ""}</p>
              </div>
              {preview && (
                <button type="button" className="an-mini" onClick={() => download(`${t("분석")}.csv`, toCsv(preview))}>
                  CSV
                </button>
              )}
            </div>
            {error && <p className="an-error">{error}</p>}
            {preview ? <SeriesChart result={preview} kind={chart} /> : <p className="an-empty">{running ? t("계산 중") : ""}</p>}
            {preview?.truncated && <p className="an-muted">{t("계열이 많아 기록이 많은 60개만 표시합니다. 농장이나 기간을 좁혀 보세요.")}</p>}
          </div>

          <div className="an-dash-bar">
            <select
              value={current?.id ?? ""}
              onChange={(e) => {
                const d = dashboards.find((x) => x.id === Number(e.target.value));
                if (d) setCurrent(d);
              }}
              aria-label={t("대시보드 선택")}
            >
              {!dashboards.length && <option value="">{t("대시보드 없음")}</option>}
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.shared ? ` (${t("공유")})` : ""}{!d.mine && d.owner ? `, ${d.owner}` : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={newDashboard}>{t("새 대시보드")}</button>
            {current && (
              <>
                <button type="button" aria-pressed={editMode} onClick={() => setEditMode(!editMode)}>
                  {editMode ? t("편집 끝내기") : t("편집")}
                </button>
                <button type="button" className="an-primary" onClick={save} disabled={!dirty}>
                  {dirty ? t("저장") : t("저장됨")}
                </button>
              </>
            )}
          </div>

          {current && editMode && (
            <div className="an-dash-edit">
              <label>
                {t("대시보드 이름")}
                <input value={current.name} onChange={(e) => changeDash({ ...current, name: e.target.value })} />
              </label>
              <label className="an-check">
                <input type="checkbox" checked={current.shared} disabled={!current.mine} onChange={(e) => changeDash({ ...current, shared: e.target.checked })} />
                {t("반석 팀에 공유")}
              </label>
              {current.mine && (
                <button type="button" className="an-danger" onClick={removeDashboard}>
                  {t("대시보드 지우기")}
                </button>
              )}
            </div>
          )}

          {current && current.widgets.length === 0 && (
            <p className="an-empty an-card">{t("왼쪽에서 차트를 만들고 “대시보드에 추가”를 누르면 여기에 쌓입니다.")}</p>
          )}

          <div className="an-grid">
            {current?.widgets.map((w, i) => {
              const r = results[w.id];
              return (
                <article key={w.id} className={`an-card ${w.width === 2 ? "is-wide" : ""}`}>
                  <div className="an-card-head">
                    <div>
                      {editMode ? (
                        <input className="an-title-input" value={w.title} placeholder={autoTitle(w.query, catalog)} onChange={(e) => patchWidget(w.id, { title: e.target.value })} />
                      ) : (
                        <h3>{w.title || autoTitle(w.query, catalog)}</h3>
                      )}
                      <p>
                        {describe(w.query, session.farms)}
                        {typeof r === "object" && r.metric.note ? `. ${r.metric.note}` : ""}
                      </p>
                    </div>
                    <div className="an-tools">
                      {editMode ? (
                        <>
                          <button type="button" className="an-mini" onClick={() => moveWidget(w.id, -1)} disabled={i === 0} aria-label={t("앞으로")}>←</button>
                          <button type="button" className="an-mini" onClick={() => moveWidget(w.id, 1)} disabled={i === current.widgets.length - 1} aria-label={t("뒤로")}>→</button>
                          <button type="button" className="an-mini" onClick={() => patchWidget(w.id, { width: w.width === 2 ? 1 : 2 })}>
                            {w.width === 2 ? t("절반 폭") : t("전체 폭")}
                          </button>
                          <select className="an-mini" value={w.chart} onChange={(e) => patchWidget(w.id, { chart: e.target.value as ChartKind })} aria-label={t("차트 형태")}>
                            <option value="line">{t("선")}</option>
                            <option value="bar">{t("막대")}</option>
                            <option value="table">{t("표")}</option>
                          </select>
                          <button type="button" className="an-mini" onClick={() => editWidget(w)}>{t("조건 고치기")}</button>
                          <button type="button" className="an-mini an-danger" onClick={() => changeDash({ ...current, widgets: current.widgets.filter((x) => x.id !== w.id) })}>
                            {t("빼기")}
                          </button>
                        </>
                      ) : (
                        typeof r === "object" && (
                          <button type="button" className="an-mini" onClick={() => download(`${w.title || autoTitle(w.query, catalog)}.csv`, toCsv(r))}>
                            CSV
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {r === "loading" || r === undefined ? (
                    <p className="an-empty">{t("계산 중")}</p>
                  ) : typeof r === "string" ? (
                    <p className="an-error">{r}</p>
                  ) : (
                    <SeriesChart result={r} kind={w.chart} height={w.width === 2 ? 280 : 240} />
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
