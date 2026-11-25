import type { BandPoint } from "@/lib/types";

/**
 * 산란곡선: 같은 농장 과거 계군의 일령별 띠(하위 10%~상위 10%)와 중앙값 위에 대상 계군을 겹친다.
 * 인쇄해도 읽히도록 대상 계군만 진한 색, 나머지는 회색으로 둔다.
 */
export default function LayCurveChart({
  band,
  ageFrom,
  ageTo,
  height = 300,
}: {
  band: BandPoint[];
  ageFrom?: number;
  ageTo?: number;
  height?: number;
}) {
  const W = 720;
  const H = height;
  const L = 52, R = 124, T = 16, B = 40;
  const pts = band.filter((b) => b.target !== null || b.median !== undefined);
  if (pts.length < 2) return <p className="r-muted">곡선을 그릴 기록이 부족합니다.</p>;
  const a0 = pts[0].age, a1 = pts[pts.length - 1].age;
  const vals = pts.flatMap((p) => [p.target, p.p10, p.p90].filter((v): v is number => typeof v === "number"));
  const vMin = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10);
  const vMax = Math.min(100, Math.ceil((Math.max(...vals) + 2) / 10) * 10);
  const X = (a: number) => L + ((a - a0) / Math.max(1, a1 - a0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - vMin) / Math.max(1, vMax - vMin)) * (H - T - B);

  const banded = pts.filter((p) => p.p10 !== undefined && p.p90 !== undefined);
  const bandPath = banded.length
    ? "M" + banded.map((p) => `${X(p.age)},${Y(p.p90!)}`).join("L") +
      "L" + [...banded].reverse().map((p) => `${X(p.age)},${Y(p.p10!)}`).join("L") + "Z"
    : "";
  const line = (key: "median" | "target") => {
    let d = "";
    let pen = false;
    for (const p of pts) {
      const v = p[key];
      if (typeof v !== "number") {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${X(p.age)},${Y(v)}`;
      pen = true;
    }
    return d;
  };
  const ticksV: number[] = [];
  for (let v = vMin; v <= vMax; v += 10) ticksV.push(v);
  const step = a1 - a0 > 200 ? 28 : a1 - a0 > 80 ? 14 : 7;
  const ticksA: number[] = [];
  for (let a = Math.ceil(a0 / step) * step; a <= a1; a += step) ticksA.push(a);
  const lastT = [...pts].reverse().find((p) => typeof p.target === "number");
  const lastM = [...banded].reverse()[0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="r-chart" role="img" aria-label="일령별 산란율: 대상 계군과 같은 농장 과거 계군">
      {ageFrom !== undefined && ageTo !== undefined && (
        <rect x={X(Math.max(a0, ageFrom))} y={T} width={Math.max(0, X(Math.min(a1, ageTo)) - X(Math.max(a0, ageFrom)))} height={H - T - B} fill="#1F5F45" opacity={0.06} />
      )}
      {ticksV.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#E3E8E4" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" className="r-axis">{v}%</text>
        </g>
      ))}
      {ticksA.map((a) => (
        <text key={a} x={X(a)} y={H - B + 18} textAnchor="middle" className="r-axis">{a}</text>
      ))}
      <text x={W - R} y={H - 6} textAnchor="end" className="r-axis">일령</text>
      {bandPath && <path d={bandPath} fill="#9AA79F" opacity={0.28} />}
      <path d={line("median")} fill="none" stroke="#7C8A81" strokeWidth={1.6} strokeDasharray="5 4" />
      <path d={line("target")} fill="none" stroke="#1F5F45" strokeWidth={2.6} />
      {lastT && (
        <text x={X(lastT.age) + 8} y={Y(lastT.target!) - 6} className="r-label r-label-strong">
          이 계군 {lastT.target!.toFixed(1)}%
        </text>
      )}
      {lastM && (
        <text x={X(lastM.age) + 8} y={Y(lastM.median!) + 16} className="r-label">
          과거 중앙값 {lastM.median!.toFixed(1)}%
        </text>
      )}
    </svg>
  );
}
