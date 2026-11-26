"use client";

/* 인터랙티브 꺾은선 차트 (SVG, 외부 라이브러리 없음)
   - 마우스를 올리면 그날의 값이 툴팁으로 나오고, 가장 가까운 선이 강조된다
   - highlight / onHighlight 로 바깥 목록(표, 범례)과 강조를 맞춘다 */
import { useEffect, useMemo, useRef, useState } from "react";

export type Series = { id: string | number; name: string; values: (number | null)[]; color?: string; dashed?: boolean };

const PALETTE = ["#1f6b4f", "#d99a00", "#3a7ca5", "#b5523b", "#6d5ba8", "#4f8f3a", "#8a6d3b", "#2a9d8f"];

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export default function LineChart({
  dates,
  series,
  highlight = null,
  onHighlight,
  height = 300,
  unit = "",
  fmtDate = (d) => d.slice(5).replace("-", "/"),
  yMin,
  yMax,
  label,
}: {
  dates: string[];
  series: Series[];
  highlight?: string | number | null;
  onHighlight?: (id: string | number | null) => void;
  height?: number;
  unit?: string;
  fmtDate?: (d: string) => string;
  yMin?: number;
  yMax?: number;
  label?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const [localHi, setLocalHi] = useState<string | number | null>(null);
  const hi = highlight ?? localHi;

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 44, r: 16, t: 14, b: 28 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const { lo, hiY, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
    let a = yMin ?? (all.length ? Math.min(...all) : 0);
    let b = yMax ?? (all.length ? Math.max(...all) : 100);
    if (yMin === undefined) a = Math.floor(a - (b - a) * 0.08);
    if (yMax === undefined) b = Math.ceil(b + (b - a) * 0.05);
    if (a === b) b = a + 1;
    return { lo: a, hiY: b, ticks: niceTicks(a, b) };
  }, [series, yMin, yMax]);

  const n = dates.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - lo) / (hiY - lo)) * ih;

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        });
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, w, height, lo, hiY, n],
  );

  const colorOf = (s: Series, i: number) => s.color ?? PALETTE[i % PALETTE.length];
  const xTicks = useMemo(() => {
    const k = Math.max(2, Math.min(8, Math.floor(iw / 90)));
    return Array.from({ length: k }, (_, j) => Math.round((j / (k - 1)) * (n - 1)));
  }, [iw, n]);

  const move = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (px < pad.l - 4 || px > w - pad.r + 4 || n === 0) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / iw) * (n - 1))));
    setHover(i);
    let best: Series | null = null;
    let bd = 28;
    for (const s of series) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      const d = Math.abs(y(v) - py);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    const id = best ? best.id : null;
    if (onHighlight) onHighlight(id);
    else setLocalHi(id);
  };
  const leave = () => {
    setHover(null);
    if (onHighlight) onHighlight(null);
    else setLocalHi(null);
  };

  const tip =
    hover !== null
      ? series
          .map((s, i) => ({ s, i, v: s.values[hover] }))
          .filter((r) => r.v !== null && r.v !== undefined)
          .sort((a, b) => (b.v as number) - (a.v as number))
      : [];
  const tipLeft = hover !== null ? x(hover) : 0;
  const flip = tipLeft > w - 230;

  return (
    <div className="lc" ref={wrap} style={{ height }}>
      <svg width={w} height={height} onMouseMove={move} onMouseLeave={leave} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="lc-grid" x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />
            <text className="lc-ytick" x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {t}
              {unit}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} className="lc-xtick" x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
            {dates[i] ? fmtDate(dates[i]) : ""}
          </text>
        ))}
        {series.map((s, i) => {
          const isHi = hi !== null && s.id === hi;
          const dim = hi !== null && !isHi;
          return (
            <path
              key={s.id}
              d={paths[i]}
              fill="none"
              stroke={colorOf(s, i)}
              strokeWidth={isHi ? 3 : 1.8}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={dim ? 0.16 : 1}
              className="lc-line"
            />
          );
        })}
        {hover !== null && (
          <g>
            <line className="lc-rule" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />
            {series.map((s, i) => {
              const v = s.values[hover];
              if (v === null || v === undefined) return null;
              const isHi = hi !== null && s.id === hi;
              if (hi !== null && !isHi) return null;
              return <circle key={s.id} cx={x(hover)} cy={y(v)} r={isHi ? 5 : 3.5} fill="#fff" stroke={colorOf(s, i)} strokeWidth={2.4} />;
            })}
          </g>
        )}
      </svg>
      {hover !== null && tip.length > 0 && (
        <div className="lc-tip" style={{ left: flip ? undefined : tipLeft + 14, right: flip ? w - tipLeft + 14 : undefined }}>
          <div className="lc-tip-date">{dates[hover]}</div>
          {tip.slice(0, 9).map(({ s, i, v }) => (
            <div key={s.id} className={`lc-tip-row${hi === s.id ? " is-hi" : ""}`}>
              <span className="lc-swatch" style={{ background: colorOf(s, i) }} />
              <span className="lc-tip-name">{s.name}</span>
              <b>
                {(v as number).toFixed(1)}
                {unit}
              </b>
            </div>
          ))}
          {tip.length > 9 && <div className="lc-tip-more">+{tip.length - 9}</div>}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, w = 120, h = 32, color }: { values: (number | null)[]; w?: number; h?: number; color?: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <svg width={w} height={h} className="spark" aria-hidden />;
  const vs = pts.map((p) => p[1]);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const n = values.length - 1 || 1;
  const X = (i: number) => 2 + (i / n) * (w - 6);
  const Y = (v: number) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  const first = pts[0];
  const c = color ?? (last[1] < first[1] - 2 ? "#b42318" : "#1f6b4f");
  const area = `${d}L${X(last[0]).toFixed(1)},${h}L${X(first[0]).toFixed(1)},${h}Z`;
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <path d={area} fill={c} opacity={0.08} />
      <path d={d} fill="none" stroke={c} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={X(last[0])} cy={Y(last[1])} r={2.6} fill={c} />
    </svg>
  );
}
