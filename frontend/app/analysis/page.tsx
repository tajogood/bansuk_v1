"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SeriesChart, { toCsv } from "@/components/SeriesChart";
import { analysisApi, loadSession } from "@/lib/api";
import type { AnalysisDashboard, AnalysisQuery, Catalog, ChartKind, QueryResult, Session, Widget } from "@/lib/types";
import "../analysis.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);

const METRIC_GROUPS: { label: string; match: (k: string) => boolean }[] = [
  { label: "산란", match: (k) => ["lay_rate", "total_eggs", "egg_weight"].includes(k) },
  { label: "규격 비율", match: (k) => k.startsWith("share_") },
  { label: "사료·물", match: (k) => k.startsWith("feed_") || k.startsWith("water_") },
  { label: "수수·폐사", match: (k) => ["bird_count", "mortality", "mortality_per_10k"].includes(k) },
  { label: "환경", match: (k) => ["temp_max", "temp_min", "humidity"].includes(k) },
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

function autoTitle(q: AnalysisQuery, c: Catalog | null) {
  if (!c) return "";
  const m = c.metrics[q.metric]?.label ?? q.metric;
  const x = c.x_axes[q.x] ?? q.x;
  const g = c.groups[q.group] ?? q.group;
  return `${x}별 ${m} (${g})`;
}

function describe(q: AnalysisQuery, farms: Session["farms"]): string {
  const parts: string[] = [];
  parts.push(q.farm_ids.length ? farms.filter((f) => q.farm_ids.includes(f.id)).map((f) => f.name).join(", ") : "전체 농장");
  if (q.house_kind !== "all") parts.push(q.house_kind === "laying" ? "산란계사" : "육성사");
  if (q.program !== "any") parts.push(q.program === "applied" ? "프로그램 적용 계군" : "미적용 계군");
  if (q.date_from || q.date_to) parts.push(`${q.date_from ?? "처음"} ~ ${q.date_to ?? "현재"}`);
  if (q.age_from || q.age_to) parts.push(`${q.age_from ?? 1}~${q.age_to ?? ""}일령`);
  if (q.smooth) parts.push("7일 평균");
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
    analysisApi.catalog(s.token).then(setCatalog).catch((e) => setError(e.message));
    analysisApi
      .list(s.token)
      .then((r) => {
        setDashboards(r.dashboards);
        if (r.dashboards[0]) setCurrent(r.dashboards[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

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
  }, [q, session, catalog]);

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
  }, [current?.id]);

  const patchQ = (p: Partial<AnalysisQuery>) => setQ((s) => ({ ...s, ...p }));

  const changeDash = (d: AnalysisDashboard) => {
    setCurrent(d);
    setDirty(true);
  };

  const addToDashboard = async () => {
    if (!session || !preview) return;
    const w: Widget = { id: editingWidget ?? uid(), title: title || autoTitle(q, catalog), chart, width: 1, query: q };
    let d = current;
    if (!d) {
      d = await analysisApi.create(session.token, { name: "새 대시보드", shared: false, widgets: [] });
      setDashboards((s) => [d!, ...s]);
    }
    const exists = d.widgets.some((x) => x.id === w.id);
    const widgets = exists ? d.widgets.map((x) => (x.id === w.id ? { ...w, width: x.width } : x)) : [...d.widgets, w];
    const next = { ...d, widgets };
    setCurrent(next);
    setResults((s) => ({ ...s, [w.id]: preview }));
    setDirty(true);
    setEditingWidget(null);
    flash(exists ? "차트를 고쳤습니다. 저장을 눌러 반영하세요." : "대시보드에 추가했습니다. 저장을 눌러 반영하세요.");
  };

  const save = async () => {
    if (!session || !current) return;
    const body = { name: current.name, shared: current.shared, widgets: current.widgets };
    const saved = current.id ? await analysisApi.update(session.token, current.id, body) : await analysisApi.create(session.token, body);
    setCurrent(saved);
    setDashboards((s) => [saved, ...s.filter((x) => x.id !== saved.id)]);
    setDirty(false);
    flash("저장했습니다");
  };

  const newDashboard = async () => {
    if (!session) return;
    const d = await analysisApi.create(session.token, { name: "새 대시보드", shared: false, widgets: [] });
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
    flash("대시보드를 지웠습니다");
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

  const metricOptions = useMemo(() => {
    if (!catalog) return [];
    return METRIC_GROUPS.map((g) => ({
      label: g.label,
      items: Object.entries(catalog.metrics).filter(([k]) => g.match(k)),
    }));
  }, [catalog]);

  if (!session)
    return (
      <main className="an-wrap">
        <p className="an-pad">
          로그인이 필요합니다. <a href="/">로그인하기</a>
        </p>
      </main>
    );
  if (!BANSUK.has(session.user.role))
    return (
      <main className="an-wrap">
        <p className="an-pad">분석기는 반석 계정에서 사용할 수 있습니다.</p>
      </main>
    );

  return (
    <main className="an-wrap">
      <header className="an-head">
        <a href="/" className="an-back">‹ 생산 기록</a>
        <h1>데이터 분석기</h1>
        <span className="an-spacer" />
        <a href="/report/" className="an-link">계군 성적 보고서</a>
      </header>

      <div className="an-body">
        {/* ---------- 차트 만들기 ---------- */}
        <aside className="an-builder" aria-label="차트 만들기">
          <h2>{editingWidget ? "차트 고치기" : "차트 만들기"}</h2>
          <label>
            데이터
            <select value={q.source} onChange={() => {}}>
              <option value="production">생산 기록</option>
              <option disabled>검사 결과 (준비 중)</option>
              <option disabled>부검 기록 (준비 중)</option>
            </select>
          </label>
          <label>
            지표
            <select value={q.metric} onChange={(e) => patchQ({ metric: e.target.value })}>
              {metricOptions.map((g) => (
                <optgroup key={g.label} label={g.label}>
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
              가로축
              <select value={q.x} onChange={(e) => patchQ({ x: e.target.value })}>
                {catalog && Object.entries(catalog.x_axes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>
              묶음
              <select value={q.group} onChange={(e) => patchQ({ group: e.target.value })}>
                {catalog && Object.entries(catalog.groups).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>농장 (선택 안 하면 전체)</legend>
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
          <div className="an-row">
            <label>
              계사
              <select value={q.house_kind} onChange={(e) => patchQ({ house_kind: e.target.value as AnalysisQuery["house_kind"] })}>
                <option value="laying">산란계사</option>
                <option value="rearing">육성사</option>
                <option value="all">전체</option>
              </select>
            </label>
            <label>
              백신프로그램
              <select value={q.program} onChange={(e) => patchQ({ program: e.target.value as AnalysisQuery["program"] })}>
                <option value="any">전체 계군</option>
                <option value="applied">적용 계군</option>
                <option value="not">미적용 계군</option>
              </select>
            </label>
          </div>
          <div className="an-row">
            <label>
              기간 시작
              <input type="date" value={q.date_from ?? ""} onChange={(e) => patchQ({ date_from: e.target.value || null })} />
            </label>
            <label>
              기간 끝
              <input type="date" value={q.date_to ?? ""} onChange={(e) => patchQ({ date_to: e.target.value || null })} />
            </label>
          </div>
          <div className="an-row">
            <label>
              일령 부터
              <input inputMode="numeric" value={q.age_from ?? ""} onChange={(e) => patchQ({ age_from: Number(e.target.value.replace(/\D/g, "")) || null })} />
            </label>
            <label>
              일령 까지
              <input inputMode="numeric" value={q.age_to ?? ""} onChange={(e) => patchQ({ age_to: Number(e.target.value.replace(/\D/g, "")) || null })} />
            </label>
          </div>
          <label className="an-check">
            <input type="checkbox" checked={q.smooth} onChange={(e) => patchQ({ smooth: e.target.checked })} disabled={!["date", "age_days"].includes(q.x)} />
            7일 이동평균 (날짜·일령 축)
          </label>
          <div className="an-seg" role="radiogroup" aria-label="차트 형태">
            {(["line", "bar", "table"] as ChartKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={chart === k} onClick={() => setChart(k)}>
                {k === "line" ? "선" : k === "bar" ? "막대" : "표"}
              </button>
            ))}
          </div>
          <label>
            제목
            <input value={title} placeholder={autoTitle(q, catalog)} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="an-actions">
            {editingWidget && (
              <button type="button" onClick={() => { setEditingWidget(null); setTitle(""); }}>
                취소
              </button>
            )}
            <button type="button" className="an-primary" onClick={addToDashboard} disabled={!preview || running}>
              {editingWidget ? "이 차트 고치기" : "대시보드에 추가"}
            </button>
          </div>
        </aside>

        {/* ---------- 미리보기 + 대시보드 ---------- */}
        <section className="an-main">
          <div className="an-card an-preview">
            <div className="an-card-head">
              <div>
                <h3>{title || autoTitle(q, catalog)}</h3>
                <p>{describe(q, session.farms)}{preview ? `. 기록 ${preview.record_count.toLocaleString("ko-KR")}건` : ""}
                  {preview?.metric.note ? `. ${preview.metric.note}` : ""}</p>
              </div>
              {preview && (
                <button type="button" className="an-mini" onClick={() => download("분석.csv", toCsv(preview))}>
                  CSV
                </button>
              )}
            </div>
            {error && <p className="an-error">{error}</p>}
            {preview ? <SeriesChart result={preview} kind={chart} /> : <p className="an-empty">{running ? "계산 중" : ""}</p>}
            {preview?.truncated && <p className="an-muted">계열이 많아 기록이 많은 60개만 표시합니다. 농장이나 기간을 좁혀 보세요.</p>}
          </div>

          <div className="an-dash-bar">
            <select
              value={current?.id ?? ""}
              onChange={(e) => {
                const d = dashboards.find((x) => x.id === Number(e.target.value));
                if (d) setCurrent(d);
              }}
              aria-label="대시보드 선택"
            >
              {!dashboards.length && <option value="">대시보드 없음</option>}
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.shared ? " (공유)" : ""}{!d.mine && d.owner ? `, ${d.owner}` : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={newDashboard}>새 대시보드</button>
            {current && (
              <>
                <button type="button" aria-pressed={editMode} onClick={() => setEditMode(!editMode)}>
                  {editMode ? "편집 끝내기" : "편집"}
                </button>
                <button type="button" className="an-primary" onClick={save} disabled={!dirty}>
                  {dirty ? "저장" : "저장됨"}
                </button>
              </>
            )}
          </div>

          {current && editMode && (
            <div className="an-dash-edit">
              <label>
                대시보드 이름
                <input value={current.name} onChange={(e) => changeDash({ ...current, name: e.target.value })} />
              </label>
              <label className="an-check">
                <input type="checkbox" checked={current.shared} disabled={!current.mine} onChange={(e) => changeDash({ ...current, shared: e.target.checked })} />
                반석 팀에 공유
              </label>
              {current.mine && (
                <button type="button" className="an-danger" onClick={removeDashboard}>
                  대시보드 지우기
                </button>
              )}
            </div>
          )}

          {current && current.widgets.length === 0 && (
            <p className="an-empty an-card">왼쪽에서 차트를 만들고 &ldquo;대시보드에 추가&rdquo;를 누르면 여기에 쌓입니다.</p>
          )}

          <div className="an-grid">
            {current?.widgets.map((w, i) => {
              const r = results[w.id];
              return (
                <article key={w.id} className={`an-card ${w.width === 2 ? "is-wide" : ""}`}>
                  <div className="an-card-head">
                    <div>
                      {editMode ? (
                        <input className="an-title-input" value={w.title} onChange={(e) => patchWidget(w.id, { title: e.target.value })} />
                      ) : (
                        <h3>{w.title}</h3>
                      )}
                      <p>
                        {describe(w.query, session.farms)}
                        {typeof r === "object" && r.metric.note ? `. ${r.metric.note}` : ""}
                      </p>
                    </div>
                    <div className="an-tools">
                      {editMode ? (
                        <>
                          <button type="button" className="an-mini" onClick={() => moveWidget(w.id, -1)} disabled={i === 0} aria-label="앞으로">←</button>
                          <button type="button" className="an-mini" onClick={() => moveWidget(w.id, 1)} disabled={i === current.widgets.length - 1} aria-label="뒤로">→</button>
                          <button type="button" className="an-mini" onClick={() => patchWidget(w.id, { width: w.width === 2 ? 1 : 2 })}>
                            {w.width === 2 ? "절반 폭" : "전체 폭"}
                          </button>
                          <select className="an-mini" value={w.chart} onChange={(e) => patchWidget(w.id, { chart: e.target.value as ChartKind })} aria-label="차트 형태">
                            <option value="line">선</option>
                            <option value="bar">막대</option>
                            <option value="table">표</option>
                          </select>
                          <button type="button" className="an-mini" onClick={() => editWidget(w)}>조건 고치기</button>
                          <button type="button" className="an-mini an-danger" onClick={() => changeDash({ ...current, widgets: current.widgets.filter((x) => x.id !== w.id) })}>
                            빼기
                          </button>
                        </>
                      ) : (
                        typeof r === "object" && (
                          <button type="button" className="an-mini" onClick={() => download(`${w.title}.csv`, toCsv(r))}>
                            CSV
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {r === "loading" || r === undefined ? (
                    <p className="an-empty">계산 중</p>
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
