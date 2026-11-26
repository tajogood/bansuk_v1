"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISEASES, LESIONS, ORGANS, label } from "@/lib/cases";
import { tr, useT } from "@/lib/i18n";
import type { LabelPhoto, PhotoRegionItem, Pt } from "@/lib/types";

/** 장기마다 다른 색 (이름 표시를 같이 하므로 색만으로 구분하지 않는다) */
const PALETTE = ["#e4572e", "#1b998b", "#f3a712", "#6a4c93", "#2e86ab", "#c5283d", "#3bb273", "#ff7f11", "#7768ae", "#00a6a6", "#b5838d", "#4f772d"];
export function organColor(code: string) {
  const i = ORGANS.findIndex((o) => o.code === code);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

const TAP_MOVE = 0.012; // 이보다 덜 움직이면 '찍기'
const MIN_STEP = 0.006; // 손으로 그릴 때 점 간격

function area(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function inside(pt: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 손으로 그린 선을 줄인다 (Douglas–Peucker) */
function simplify(pts: Pt[], tol = 0.004): Pt[] {
  if (pts.length < 4) return pts;
  const dp = (a: number, b: number): number[] => {
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1;
    const n = Math.hypot(dx, dy);
    let best = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      // 시작과 끝이 같은 점이면(닫힌 선) 시작점에서의 거리로 본다
      const d = n < 1e-6 ? Math.hypot(pts[i][0] - x1, pts[i][1] - y1) : Math.abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / n;
      if (d > best) {
        best = d;
        idx = i;
      }
    }
    if (best <= tol || idx < 0) return [a, b];
    return [...dp(a, idx).slice(0, -1), ...dp(idx, b)];
  };
  return dp(0, pts.length - 1).map((i) => pts[i]);
}

function centroid(p: Pt[]): Pt {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

let seq = 0;
const newKey = () => `n${++seq}`;

type Props = {
  photo: LabelPhoto;
  busy: boolean;
  modelEnabled: boolean;
  onSave: (b: { regions: PhotoRegionItem[]; diseases: string[]; normal: boolean; note: string | null; status: "done" | "todo" | "skip" }) => void;
  onAuto: () => void;
};

export default function PhotoLabeler({ photo, busy, modelEnabled, onSave, onAuto }: Props) {
  const t = useT();
  const [regions, setRegions] = useState<PhotoRegionItem[]>([]);
  const [diseases, setDiseases] = useState<string[]>([]);
  const [normal, setNormal] = useState(false);
  const [note, setNote] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Pt[]>([]); // 점을 찍어 그리는 중
  const [stroke, setStroke] = useState<Pt[]>([]); // 손으로 둘러 그리는 중
  const [pending, setPending] = useState<Pt[] | null>(null); // 다 그렸고 장기를 고르는 중
  const [hide, setHide] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: Pt; moved: boolean; pts: Pt[]; vertex?: { key: string; i: number } } | null>(null);
  const [lastOrgan, setLastOrgan] = useState<string | null>(null);

  useEffect(() => {
    setRegions(photo.regions.map((r) => ({ ...r, key: r.id ? `r${r.id}` : newKey() })));
    setDiseases(photo.diseases);
    setNormal(photo.normal);
    setNote(photo.note ?? "");
    setSel(null);
    setDraft([]);
    setPending(null);
    setDrawing(photo.regions.length === 0);
  }, [photo]);

  const aspect = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  const selected = regions.find((r) => r.key === sel) ?? null;
  const suggested = regions.filter((r) => r.status === "suggested").length;

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const b = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))];
  };

  const closeDraft = useCallback((pts: Pt[]) => {
    if (pts.length < 3 || area(pts) < 0.0004) {
      setDraft([]);
      return;
    }
    setDraft([]);
    setPending(pts);
    setSel(null);
  }, []);

  const finishPending = (organ: string) => {
    if (!pending) return;
    const key = newKey();
    setRegions((rs) => [...rs, { key, organ, lesions: [], points: pending, source: "manual", status: "confirmed" }]);
    setPending(null);
    setSel(key);
    setLastOrgan(organ);
    setNormal(false);
  };

  const onDown = (e: React.PointerEvent) => {
    if (pending) return;
    const p = toPt(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const vtx = (e.target as Element).getAttribute?.("data-vertex");
    if (vtx && selected) {
      drag.current = { start: p, moved: false, pts: [], vertex: { key: selected.key!, i: Number(vtx) } };
      return;
    }
    drag.current = { start: p, moved: false, pts: [p] };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPt(e);
    if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > TAP_MOVE) d.moved = true;
    if (d.vertex) {
      const { key, i } = d.vertex;
      setRegions((rs) => rs.map((r) => (r.key === key ? { ...r, points: r.points.map((q, j) => (j === i ? p : q)), status: "confirmed" } : r)));
      return;
    }
    if (!drawing) return;
    const last = d.pts[d.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STEP) {
      d.pts.push(p);
      if (d.moved) setStroke([...d.pts]);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.vertex) return;
    const p = toPt(e);
    setStroke([]);
    if (drawing) {
      if (d.moved && d.pts.length > 6) {
        // 손으로 둘러 그림 → 바로 닫기
        closeDraft(simplify([...d.pts, p]));
        return;
      }
      if (d.moved) return; // 짧게 끈 것은 무시
      // 찍기: 점 추가. 첫 점 가까이 찍으면 닫기
      if (draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < 0.025) {
        closeDraft(draft);
        return;
      }
      setDraft((x) => [...x, p]);
      return;
    }
    if (!d.moved) {
      // 영역 고르기: 들어 있는 것 중 가장 작은 것
      const hits = regions.filter((r) => inside(p, r.points)).sort((a, b) => area(a.points) - area(b.points));
      setSel(hits[0]?.key ?? null);
    }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        setDraft([]);
        setPending(null);
        setSel(null);
      } else if (e.key === "Enter" && draft.length >= 3) {
        e.preventDefault();
        closeDraft(draft);
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        setRegions((rs) => rs.filter((r) => r.key !== sel));
        setSel(null);
      } else if (e.key === "d") {
        setDrawing((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [draft, sel, closeDraft]);

  const patchSel = (p: Partial<PhotoRegionItem>) => setRegions((rs) => rs.map((r) => (r.key === sel ? { ...r, ...p } : r)));
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const confirmAll = () => setRegions((rs) => rs.map((r) => ({ ...r, status: "confirmed" })));

  const caseHint = useMemo(() => {
    const c = photo.case;
    if (!c) return null;
    return [
      c.suspected.length ? `${tr("의심 질병")}: ${c.suspected.map((x) => label(DISEASES, x)).join(", ")}` : "",
      c.final_diagnosis ? `${tr("최종 진단")}: ${c.final_diagnosis}` : "",
    ].filter(Boolean);
  }, [photo.case]);

  const save = (status: "done" | "todo" | "skip") =>
    onSave({ regions: regions.map(({ key: _k, ...r }) => r), diseases, normal, note: note.trim() || null, status });

  return (
    <div className="pl-wrap">
      <div className="pl-stage-col">
        <div className="pl-toolbar" role="toolbar" aria-label={t("그리기 도구")}>
          <button type="button" aria-pressed={drawing} onClick={() => { setDrawing((v) => !v); setDraft([]); }}>
            {drawing ? t("그리는 중") : t("윤곽 그리기")}
          </button>
          {draft.length >= 3 && (
            <button type="button" className="is-primary" onClick={() => closeDraft(draft)}>{t("윤곽 닫기")}</button>
          )}
          {draft.length > 0 && <button type="button" onClick={() => setDraft((x) => x.slice(0, -1))}>{t("점 하나 취소")}</button>}
          <button type="button" aria-pressed={hide} onClick={() => setHide((v) => !v)}>{hide ? t("영역 보이기") : t("영역 숨기기")}</button>
          {modelEnabled && <button type="button" disabled={busy} onClick={onAuto}>{t("자동 표시 다시")}</button>}
        </div>
        <p className="pl-help">
          {drawing
            ? t("장기 둘레를 손가락이나 마우스로 한 번에 둘러 그리거나, 점을 차례로 찍고 첫 점을 다시 누르세요.")
            : t("영역을 누르면 고를 수 있고, 점을 끌어 모양을 고칠 수 있습니다.")}
        </p>
        <div className="pl-stage" style={{ aspectRatio: `${aspect}`, ["--ar" as string]: aspect } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={t("부검 사진")} draggable={false} />
          <svg
            ref={svgRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className={drawing ? "is-drawing" : ""}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            {!hide &&
              regions.map((r) => {
                const c = organColor(r.organ);
                const on = r.key === sel;
                return (
                  <g key={r.key}>
                    <polygon
                      points={r.points.map((p) => p.join(",")).join(" ")}
                      fill={c}
                      fillOpacity={on ? 0.35 : 0.18}
                      stroke={c}
                      strokeWidth={on ? 3 : 2}
                      strokeDasharray={r.status === "suggested" ? "6 4" : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                    {on &&
                      r.points.map((p, i) => (
                        <ellipse key={i} data-vertex={i} cx={p[0]} cy={p[1]} rx={0.009} ry={0.009 * aspect} fill="#fff" stroke={c} strokeWidth={2} vectorEffect="non-scaling-stroke" className="pl-vertex" />
                      ))}
                  </g>
                );
              })}
            {stroke.length > 1 && (
              <polyline points={stroke.map((p) => p.join(",")).join(" ")} fill="none" stroke="#fff" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            )}
            {(draft.length > 0 || pending) && (
              <polyline
                points={(pending ?? draft).map((p) => p.join(",")).join(" ") + (pending ? ` ${pending[0].join(",")}` : "")}
                fill={pending ? "rgba(255,255,255,0.25)" : "none"}
                stroke="#fff"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {draft.map((p, i) => (
              <ellipse key={i} cx={p[0]} cy={p[1]} rx={i === 0 ? 0.012 : 0.006} ry={(i === 0 ? 0.012 : 0.006) * aspect} fill={i === 0 ? "#ffd166" : "#fff"} stroke="#222" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {!hide &&
            regions.map((r) => {
              const [x, y] = centroid(r.points);
              return (
                <span key={r.key} className={`pl-tag${r.status === "suggested" ? " is-suggested" : ""}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: organColor(r.organ) }}>
                  {label(ORGANS, r.organ)}
                  {r.status === "suggested" && r.score ? ` ${Math.round(r.score * 100)}%` : ""}
                </span>
              );
            })}
        </div>
      </div>

      <aside className="pl-panel">
        {pending ? (
          <section className="pl-box is-focus">
            <h3>{t("이 영역은 어떤 장기인가요?")}</h3>
            <div className="pl-chips">
              {lastOrgan && (
                <button type="button" className="is-last" onClick={() => finishPending(lastOrgan)}>
                  {label(ORGANS, lastOrgan)} ({t("방금 고른 것")})
                </button>
              )}
              {ORGANS.map((o) => (
                <button key={o.code} type="button" onClick={() => finishPending(o.code)}>
                  <i style={{ background: organColor(o.code) }} />
                  {t(o.label)}
                </button>
              ))}
            </div>
            <button type="button" className="link-btn" onClick={() => setPending(null)}>{t("그린 것 취소")}</button>
          </section>
        ) : selected ? (
          <section className="pl-box is-focus">
            <div className="pl-box-head">
              <h3>
                <i style={{ background: organColor(selected.organ) }} />
                {label(ORGANS, selected.organ)}
              </h3>
              {selected.status === "suggested" && <span className="pl-badge">{t("자동 표시")}</span>}
            </div>
            {selected.status === "suggested" && (
              <div className="pl-confirm">
                <button type="button" className="is-primary" onClick={() => patchSel({ status: "confirmed" })}>{t("맞음")}</button>
                <button type="button" onClick={() => { setRegions((rs) => rs.filter((r) => r.key !== sel)); setSel(null); }}>{t("틀림 (지우기)")}</button>
              </div>
            )}
            <h4>{t("장기")}</h4>
            <select value={selected.organ} onChange={(e) => patchSel({ organ: e.target.value, status: "confirmed" })} aria-label={t("장기")}>
              {ORGANS.map((o) => (
                <option key={o.code} value={o.code}>{t(o.label)}</option>
              ))}
            </select>
            <h4>{t("이 장기의 소견")}</h4>
            <div className="pl-chips is-small">
              {LESIONS.map((l) => (
                <button key={l.code} type="button" aria-pressed={selected.lesions.includes(l.code)} onClick={() => patchSel({ lesions: toggle(selected.lesions, l.code) })}>
                  {t(l.label)}
                </button>
              ))}
            </div>
            <div className="pl-row">
              <button type="button" className="link-btn" onClick={() => setSel(null)}>{t("고르기 끝")}</button>
              <button type="button" className="link-btn is-danger" onClick={() => { setRegions((rs) => rs.filter((r) => r.key !== sel)); setSel(null); }}>
                {t("영역 지우기")}
              </button>
            </div>
          </section>
        ) : (
          <section className="pl-box">
            <div className="pl-box-head">
              <h3>{t("표시한 장기")}</h3>
              {suggested > 0 && (
                <button type="button" className="link-btn" onClick={confirmAll}>{t("자동 표시 모두 맞음")}</button>
              )}
            </div>
            {regions.length === 0 ? (
              <p className="cs-muted">{t("아직 없습니다. '윤곽 그리기'로 장기를 둘러 주세요.")}</p>
            ) : (
              <ul className="pl-list">
                {regions.map((r) => (
                  <li key={r.key}>
                    <button type="button" onClick={() => { setSel(r.key!); setDrawing(false); }}>
                      <i style={{ background: organColor(r.organ) }} />
                      <strong>{label(ORGANS, r.organ)}</strong>
                      <small>
                        {r.status === "suggested" ? t("자동 표시 · 확인 필요") : r.lesions.map((l) => label(LESIONS, l)).join(", ")}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="pl-box">
          <h3>{t("이 사진의 질병 (수의사 판단)")}</h3>
          {caseHint && caseHint.length > 0 && (
            <p className="cs-muted pl-hint">
              {t("부검 건")}: {caseHint.join(" · ")}
            </p>
          )}
          <div className="pl-chips is-small">
            <button type="button" aria-pressed={normal} onClick={() => { setNormal((v) => !v); if (!normal) setDiseases([]); }}>
              {t("이상 없음")}
            </button>
            {DISEASES.map((d) => (
              <button key={d.code} type="button" aria-pressed={diseases.includes(d.code)} onClick={() => { setDiseases((x) => toggle(x, d.code)); setNormal(false); }}>
                {t(d.label)}
              </button>
            ))}
          </div>
          <label className="pl-note">
            {t("메모 (선택)")}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>
        </section>

        <div className="pl-actions">
          <button type="button" className="cs-primary" disabled={busy || !!pending || draft.length > 0} onClick={() => save("done")}>
            {busy ? t("저장 중") : t("완료하고 다음 사진")}
          </button>
          <div className="pl-row">
            <button type="button" disabled={busy} onClick={() => save("todo")}>{t("임시 저장")}</button>
            <button type="button" disabled={busy} onClick={() => save("skip")} title={t("흐리거나 장기가 안 보이는 사진은 학습에서 뺍니다")}>
              {t("건너뛰기 (학습 제외)")}
            </button>
          </div>
          {suggested > 0 && <p className="cs-muted">{t("자동 표시 {n}개를 확인하거나 지워야 완료할 수 있습니다.", { n: suggested })}</p>}
          <p className="cs-muted pl-keys">{t("단축키: D 그리기 켜기·끄기, Enter 윤곽 닫기, Esc 취소, Delete 영역 지우기")}</p>
        </div>
      </aside>
    </div>
  );
}
