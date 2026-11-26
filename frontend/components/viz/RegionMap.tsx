"use client";

/* 도별 발생 타일 지도: 실제 위치를 단순화한 격자. 색이 진할수록 발생이 많다.
   누르면 그 지역만 보고, 다시 누르면 전체로 돌아간다. */
import { useState } from "react";
import { useT } from "@/lib/i18n";

const TILES: { name: string; col: number; row: number }[] = [
  { name: "경기", col: 1, row: 0 },
  { name: "강원", col: 2, row: 0 },
  { name: "충남", col: 0, row: 1 },
  { name: "충북", col: 1, row: 1 },
  { name: "경북", col: 2, row: 1 },
  { name: "전북", col: 0, row: 2 },
  { name: "경남", col: 2, row: 2 },
  { name: "전남", col: 0, row: 3 },
  { name: "제주", col: 0, row: 4 },
];

type Row = { region: string; count: number; top?: { disease: string; count: number }[] };

export default function RegionMap({
  rows,
  selected,
  onSelect,
  diseaseLabel,
}: {
  rows: Row[];
  selected: string;
  onSelect: (r: string) => void;
  diseaseLabel: (code: string) => string;
}) {
  const t = useT();
  const [hover, setHover] = useState<string | null>(null);
  const byName = new Map(rows.map((r) => [r.region.split(" ")[0], r]));
  const max = Math.max(1, ...rows.map((r) => r.count));
  const shade = (n: number) => {
    if (!n) return "#eef2ee";
    const k = n / max;
    const stops = ["#cfe5d8", "#94c6a8", "#4f9a73", "#1f6b4f", "#11362a"];
    return stops[Math.min(stops.length - 1, Math.floor(k * (stops.length - 0.01)))];
  };
  const info = hover ? byName.get(hover) : null;
  return (
    <div className="rmap">
      <div className="rmap-grid">
        {TILES.map((tile) => {
          const r = byName.get(tile.name);
          const n = r?.count ?? 0;
          const dark = n / max > 0.55;
          return (
            <button
              key={tile.name}
              type="button"
              className={`rmap-tile${selected === tile.name ? " is-sel" : ""}${selected && selected !== tile.name ? " is-dim" : ""}`}
              style={{ gridColumn: tile.col + 1, gridRow: tile.row + 1, background: shade(n), color: dark ? "#fff" : "#17241d" }}
              onMouseEnter={() => setHover(tile.name)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(selected === tile.name ? "" : tile.name)}
              aria-pressed={selected === tile.name}
              aria-label={t("{r} {n}건", { r: tile.name, n })}
            >
              <span>{tile.name}</span>
              <strong>{n}</strong>
            </button>
          );
        })}
        <div className="rmap-info" style={{ gridColumn: "2 / 4", gridRow: "4 / 6" }}>
          {info ? (
            <>
              <strong>{info.region}</strong>
              <span>{t("발생 {n}건", { n: info.count })}</span>
              {(info.top ?? []).slice(0, 3).map((x) => (
                <span key={x.disease} className="rmap-dz">
                  {diseaseLabel(x.disease)} <b>{x.count}</b>
                </span>
              ))}
            </>
          ) : (
            <span className="rmap-hint">{selected ? t("{r}만 보는 중입니다. 다시 누르면 전체로 돌아갑니다.", { r: selected }) : t("지역을 누르면 그 지역만 봅니다.")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
