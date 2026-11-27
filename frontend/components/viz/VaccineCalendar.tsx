"use client";

/* 접종 달력: 계사(행) × 날짜(열). 밀린 접종은 오늘 칸 왼쪽에 빨간 점으로 남는다.
   점에 마우스를 올리면 백신·일령, 누르면 그 계군 접종 화면으로 간다. 수의사가 출장 동선을 짜는 용도. */
import { useMemo, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import type { DueRow } from "@/lib/types";

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function VaccineCalendar({
  items,
  today,
  days,
  onPick,
}: {
  items: DueRow[];
  today: string;
  days: number;
  onPick?: (flockId: number, date: string) => void; // 빈 칸을 누르면 그 계군·날짜로 일정 추가
}) {
  const t = useT();
  const lang = useLang();
  const [tip, setTip] = useState<{ x: number; y: number; row: DueRow } | null>(null);
  const back = 21;
  const cols = useMemo(() => Array.from({ length: back + days + 1 }, (_, i) => addDays(today, i - back)), [today, days]);
  const rows = useMemo(() => {
    const m = new Map<string, { key: string; farm: string; house: string; flock: number; items: DueRow[] }>();
    for (const it of items) {
      const key = `${it.farm.id}-${it.flock_id}`;
      if (!m.has(key)) m.set(key, { key, farm: it.farm.name, house: it.house ?? "", flock: it.flock_id, items: [] });
      m.get(key)!.items.push(it);
    }
    return [...m.values()].sort((a, b) => a.items[0].planned.localeCompare(b.items[0].planned));
  }, [items]);
  const colOf = (iso: string) => Math.max(0, Math.min(cols.length - 1, cols.indexOf(iso) >= 0 ? cols.indexOf(iso) : iso < cols[0] ? 0 : cols.length - 1));
  const fmtDay = (iso: string) => String(Number(iso.slice(8)));
  const weekday = (iso: string) => new Date(iso + "T00:00:00").getDay();
  const month = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", { month: "short" });
  const todayIdx = cols.indexOf(today);

  if (rows.length === 0) return <p className="empty-note">{t("이 기간에 예정된 접종이 없습니다")}</p>;

  return (
    <div className="vcal" onMouseLeave={() => setTip(null)}>
      <div className="vcal-grid" style={{ gridTemplateColumns: `170px repeat(${cols.length}, minmax(18px, 1fr))` }}>
        <div className="vcal-corner" />
        {cols.map((c, i) => (
          <div key={c} className={`vcal-day${i === todayIdx ? " is-today" : ""}${weekday(c) === 0 ? " is-sun" : ""}`}>
            {(i === 0 || c.endsWith("-01")) && <span className="vcal-month">{month(c)}</span>}
            {fmtDay(c)}
          </div>
        ))}
        {rows.map((r) => (
          <div key={r.key} className="vcal-row">
            <a className="vcal-label" style={{ gridColumn: 1, gridRow: 1 }} href={`/vaccination/?flock=${r.flock}`}>
              <strong>{r.farm}</strong>
              <span>{r.house}</span>
            </a>
            {cols.map((c, i) => (
              <button
                key={c}
                type="button"
                style={{ gridColumn: i + 2, gridRow: 1 }}
                className={`vcal-cell${i === todayIdx ? " is-today" : ""}${weekday(c) === 0 ? " is-sun" : ""}${c >= today ? " is-pickable" : ""}`}
                disabled={!onPick || c < today}
                onClick={() => onPick?.(r.flock, c)}
                aria-label={t("{r} {d}에 접종 일정 추가", { r: `${r.farm} ${r.house}`, d: c })}
                title={c >= today ? t("{d} 일정 추가", { d: c.slice(5) }) : undefined}
              />
            ))}
            {r.items.map((it) => {
              const idx = colOf(it.planned);
              return (
                <a
                  key={it.item_id}
                  href={`/vaccination/?flock=${it.flock_id}`}
                  className={`vcal-dot st-${it.status}`}
                  style={{ gridColumn: idx + 2, gridRow: 1 }}
                  onMouseEnter={(e) => {
                    const box = (e.currentTarget.closest(".vcal") as HTMLElement).getBoundingClientRect();
                    const b = e.currentTarget.getBoundingClientRect();
                    setTip({ x: b.left - box.left + b.width / 2, y: b.top - box.top, row: it });
                  }}
                  aria-label={`${r.farm} ${r.house} ${it.vaccine?.name ?? ""} ${it.planned}`}
                >
                  {it.status === "overdue" ? "!" : ""}
                </a>
              );
            })}
          </div>
        ))}
      </div>
      {tip && (
        <div className="vcal-tip" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.row.vaccine?.name}</strong>
          <span>
            {tip.row.farm.name} {tip.row.house}
          </span>
          <span>
            {tip.row.planned} ({Math.floor(tip.row.age_days / 7)}
            {t("주령")})
          </span>
          {tip.row.status === "overdue" && <em>{t("예정일이 지났습니다")}</em>}
        </div>
      )}
      <p className="vcal-legend">
        <span><i className="st-overdue" />{t("밀림")}</span>
        <span><i className="st-due" />{t("이번 주")}</span>
        <span><i className="st-upcoming" />{t("예정")}</span>
        <span className="vcal-legend-today">{t("세로 띠: 오늘")}</span>
      </p>
    </div>
  );
}
