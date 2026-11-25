"use client";

import { antigenName, LINE_COLORS } from "@/lib/lab";
import { useT } from "@/lib/i18n";
import type { TiterSeries } from "@/lib/types";

/** 항원 하나의 평균 역가군 추이. 가로축은 채혈일(일령), 줄은 구분(층·차량)마다 하나. */
function One({ s }: { s: TiterSeries }) {
  const t = useT();
  const dates = Array.from(new Set(s.points.map((p) => p.sampled_on ?? ""))).sort();
  const groups = Array.from(new Set(s.points.map((p) => p.group_label ?? "")));
  const ageOf = (d: string) => s.points.find((p) => p.sampled_on === d)?.age_days ?? null;
  const means = s.points.map((p) => p.mean ?? 0);
  const top = Math.max(4, Math.ceil(Math.max(...means, 0) + 1));
  const W = 320, H = 170, L = 34, R = 28, T = 10, B = 34;
  const X = (i: number) => (dates.length === 1 ? (L + W - R) / 2 : L + (i / (dates.length - 1)) * (W - L - R));
  const Y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = Array.from({ length: Math.floor(top / 2) + 1 }, (_, i) => i * 2);
  return (
    <figure className="tc-card">
      <figcaption>{antigenName(s.antigen)}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("{a} 평균 역가군 추이", { a: antigenName(s.antigen) })}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e4e9e5" />
            <text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize="10" fill="#6b776f">{v}</text>
          </g>
        ))}
        {dates.map((d, i) => {
          const age = ageOf(d);
          return (
            <text key={d} x={X(i)} y={H - B + 14} textAnchor="middle" fontSize="10" fill="#4a554e">
              {d.slice(5).replace("-", "/")}
              {age !== null && <tspan x={X(i)} dy="12" fill="#6b776f">{t("{d}일령", { d: age })}</tspan>}
            </text>
          );
        })}
        {groups.map((g, gi) => {
          const pts = dates
            .map((d, i) => {
              const p = s.points.find((x) => x.sampled_on === d && (x.group_label ?? "") === g);
              return p && p.mean !== null ? ([X(i), Y(p.mean), p] as const) : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          const color = LINE_COLORS[gi % LINE_COLORS.length];
          return (
            <g key={g}>
              {pts.length > 1 && <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={color} strokeWidth="2" />}
              {pts.map(([x, y, p]) => (
                <circle key={`${x}`} cx={x} cy={y} r="3.5" fill={color}>
                  <title>
                    {`${p.sampled_on} ${g || t("전체")}: ${p.mean} (${t("시료 {n}", { n: p.n })})`}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {(groups.length > 1 || groups[0]) && (
        <ul className="tc-legend">
          {groups.map((g, gi) => (
            <li key={g}>
              <i style={{ background: LINE_COLORS[gi % LINE_COLORS.length] }} />
              {g || t("전체")}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export default function TiterChart({ series }: { series: TiterSeries[] }) {
  const t = useT();
  if (!series.length) return <p className="cs-muted">{t("이 계사의 혈청 검사 결과가 아직 없습니다.")}</p>;
  return (
    <div className="tc-grid">
      {series.map((s) => (
        <One key={s.antigen} s={s} />
      ))}
    </div>
  );
}
