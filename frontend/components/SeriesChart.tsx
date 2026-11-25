"use client";

import { useMemo, useState } from "react";
import { locale, useT } from "@/lib/i18n";
import type { ChartKind, QueryResult } from "@/lib/types";

// 계열 색: 8개까지 구분색, 그 이상은 회색으로 두고 범례에서 골라 강조한다.
export const PALETTE = ["#1F5F45", "#C98A00", "#3B6EA8", "#B5473A", "#7A5C9E", "#2F8F8A", "#8C6D46", "#D0679D"];
const GREY = "#B7C0BA";

function fmt(v: number, unit: string) {
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toLocaleString(locale(), { maximumFractionDigits: d })}${unit}`;
}

export function toCsv(r: QueryResult): string {
  const xs = Array.from(new Set(r.series.flatMap((s) => s.points.map((p) => p[0])))).sort((a, b) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
  );
  const maps = r.series.map((s) => new Map(s.points.map(([x, y]) => [x, y])));
  const head = [r.x.label, ...r.series.map((s) => `"${s.label.replace(/"/g, '""')}"`)].join(",");
  const rows = xs.map((x) => [x, ...maps.map((m) => m.get(x) ?? "")].join(","));
  return "﻿" + [head, ...rows].join("\n");
}

export default function SeriesChart({ result, kind, height = 280 }: { result: QueryResult; kind: ChartKind; height?: number }) {
  const t = useT();
  const [focus, setFocus] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const xs = useMemo(() => {
    const all = Array.from(new Set(result.series.flatMap((s) => s.points.map((p) => p[0]))));
    return all.sort((a, b) =>
      typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
    );
  }, [result]);
  const xIndex = useMemo(() => new Map(xs.map((x, i) => [x, i])), [xs]);
  const many = result.series.length > PALETTE.length;
  const colorOf = (i: number, key: string) => (many && focus !== key ? GREY : PALETTE[i % PALETTE.length]);
  const visible = result.series.filter((s) => !hidden.has(s.key));
  const unit = result.metric.unit;

  if (!result.series.length) return <p className="an-empty">{t("조건에 맞는 기록이 없습니다. 기간이나 농장을 넓혀 보세요.")}</p>;

  if (kind === "table") {
    const maps = result.series.map((s) => new Map(s.points.map(([x, y]) => [x, y])));
    return (
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>{result.x.label}</th>
              {result.series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xs.map((x) => (
              <tr key={String(x)}>
                <td>{x}</td>
                {maps.map((m, i) => (
                  <td key={i} className="num">
                    {m.has(x) ? fmt(m.get(x)!, "") : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const W = 760, H = height, L = 56, R = 16, T = 12, B = 34;
  const vals = visible.flatMap((s) => s.points.map((p) => p[1]));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (kind === "bar") lo = Math.min(0, lo);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.06;
  if (kind !== "bar") lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  hi += pad;
  const n = Math.max(1, xs.length - 1);
  const X = (i: number) => L + (kind === "bar" ? ((i + 0.5) / xs.length) * (W - L - R) : (i / n) * (W - L - R));
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * k) / 4);
  const xtickEvery = Math.max(1, Math.ceil(xs.length / 8));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = kind === "bar" ? Math.floor(((px - L) / (W - L - R)) * xs.length) : Math.round(((px - L) / (W - L - R)) * n);
    setHover(i >= 0 && i < xs.length ? i : null);
  };
  const hoverRows =
    hover !== null
      ? visible
          .map((s) => ({ s, v: s.points.find((p) => p[0] === xs[hover])?.[1] }))
          .filter((r) => r.v !== undefined)
          .sort((a, b) => (b.v as number) - (a.v as number))
      : [];

  const barW = kind === "bar" ? Math.max(1, ((W - L - R) / xs.length / Math.max(1, visible.length)) * 0.8) : 0;

  return (
    <div className="an-chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${result.x.label} / ${result.metric.label}`}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke="#E6EBE7" />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end" className="an-axis">{fmt(t, "")}</text>
          </g>
        ))}
        {xs.map((x, i) =>
          i % xtickEvery === 0 ? (
            <text key={String(x)} x={X(i)} y={H - B + 18} textAnchor="middle" className="an-axis">
              {String(x).length > 7 ? String(x).slice(2) : x}
            </text>
          ) : null,
        )}
        {kind === "bar" && lo < 0 && <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="#8A968E" />}
        {visible.map((s) => {
          const i = result.series.indexOf(s);
          const c = colorOf(i, s.key);
          const front = !many || focus === s.key;
          if (kind === "bar") {
            const k = visible.indexOf(s);
            return (
              <g key={s.key}>
                {s.points.map(([x, y]) => {
                  const xi = xIndex.get(x)!;
                  const x0 = X(xi) - (barW * visible.length) / 2 + k * barW;
                  return <rect key={String(x)} x={x0} y={Math.min(Y(y), Y(Math.max(0, lo)))} width={barW} height={Math.abs(Y(y) - Y(Math.max(0, lo)))} fill={c} opacity={front ? 0.9 : 0.5} />;
                })}
              </g>
            );
          }
          let d = "";
          let prev = -2;
          for (const [x, y] of s.points) {
            const xi = xIndex.get(x)!;
            d += `${xi === prev + 1 ? "L" : "M"}${X(xi).toFixed(1)},${Y(y).toFixed(1)}`;
            prev = xi;
          }
          return <path key={s.key} d={d} fill="none" stroke={c} strokeWidth={front ? 2.2 : 1.1} opacity={front ? 1 : 0.8} />;
        })}
        {/* 강조 계열을 맨 위에 다시 그림 */}
        {many && focus && kind === "line" && (() => {
          const s = visible.find((v) => v.key === focus);
          if (!s) return null;
          const i = result.series.indexOf(s);
          let d = "";
          let prev = -2;
          for (const [x, y] of s.points) {
            const xi = xIndex.get(x)!;
            d += `${xi === prev + 1 ? "L" : "M"}${X(xi).toFixed(1)},${Y(y).toFixed(1)}`;
            prev = xi;
          }
          return <path d={d} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.8} />;
        })()}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} stroke="#18211C" strokeDasharray="3 3" opacity={0.5} />}
      </svg>
      {hover !== null && hoverRows.length > 0 && (
        <div className="an-tip" style={{ left: `${(X(hover) / W) * 100}%` }}>
          <b>
            {result.x.label} {xs[hover]}
          </b>
          {hoverRows.slice(0, 8).map(({ s, v }) => (
            <span key={s.key}>
              <i style={{ background: colorOf(result.series.indexOf(s), s.key) === GREY ? GREY : PALETTE[result.series.indexOf(s) % PALETTE.length] }} />
              {s.label} <em>{fmt(v as number, unit)}</em>
            </span>
          ))}
          {hoverRows.length > 8 && <span className="an-muted">{t("외 {n}개", { n: hoverRows.length - 8 })}</span>}
        </div>
      )}
      <div className="an-legend">
        {result.series.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={`${hidden.has(s.key) ? "is-off" : ""} ${focus === s.key ? "is-focus" : ""}`}
            onClick={() => setFocus(focus === s.key ? null : s.key)}
            onDoubleClick={() => {
              const h = new Set(hidden);
              h.has(s.key) ? h.delete(s.key) : h.add(s.key);
              setHidden(h);
            }}
            title={t("클릭: 강조 / 두 번 클릭: 숨기기")}
          >
            <i style={{ background: PALETTE[i % PALETTE.length], opacity: many && focus !== s.key ? 0.35 : 1 }} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
