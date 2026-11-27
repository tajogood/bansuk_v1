/* 농장 대시보드 공통 계산: 일일 기록 묶음 → 기간 합계·평균.
   합계로 나눈 값(가중 평균)을 쓴다: 산란율 = 계란 합 ÷ 수수 합, 수당 사료 = 사료 합 ÷ 수수 합 등. */
import type { DailyRecord } from "./types";

export type Rec = DailyRecord & { house_id: number };

export const GRADES = ["jumbo", "xl", "l", "m", "s", "double", "mudae", "muzung", "crack", "broken"] as const;
export const GRADE_LABEL: Record<string, string> = {
  jumbo: "왕란", xl: "특란", l: "대란", m: "중란", s: "소란", double: "쌍란", mudae: "무대", muzung: "무중", crack: "크랙", broken: "파란",
};
/* 규격 막대에 쓰는 묶음: 왕·특·대·중·소, 나머지는 기타 */
export const GRADE_GROUPS: { key: string; label: string; grades: string[] }[] = [
  { key: "jumbo", label: "왕란", grades: ["jumbo"] },
  { key: "xl", label: "특란", grades: ["xl"] },
  { key: "l", label: "대란", grades: ["l"] },
  { key: "m", label: "중란", grades: ["m"] },
  { key: "s", label: "소란", grades: ["s"] },
  { key: "etc", label: "기타", grades: ["double", "mudae", "muzung", "crack", "broken"] },
];

const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
export const m = (r: Rec, k: string): number | null => n(((r.metrics ?? {}) as Record<string, unknown>)[k]);

export type Agg = {
  days: number;
  birds: number | null; // 마지막 기록 수수 합
  eggs: number;
  lay: number | null;
  deaths: number;
  deathPct: number | null;
  feedKg: number;
  feedG: number | null;
  feedIn: number;
  fcr: number | null;
  eggW: number | null;
  massG: number | null;
  wf: number | null;
  waterMl: number | null;
  tmin: number | null;
  tmax: number | null;
  grades: Record<string, number>; // 묶음별 비율 %
  feedType: string | null;
  feedBrand: string | null;
  bodyW: number | null;
  uniformity: number | null;
};

export function aggregate(recs: Rec[]): Agg {
  let eggs = 0, birdsForEggs = 0, deaths = 0, feed = 0, birdsForFeed = 0, feedIn = 0;
  let mass = 0, feedForMass = 0, eggWsum = 0, eggWn = 0, massBirds = 0, water = 0, feedForWater = 0, waterBirds = 0;
  let tmin = 0, tminN = 0, tmax = 0, tmaxN = 0;
  const g: Record<string, number> = {};
  const lastByHouse = new Map<number, Rec>();
  let feedType: string | null = null, feedBrand: string | null = null, bodyW: number | null = null, uniformity: number | null = null;
  const days = new Set<string>();
  for (const r of recs) {
    days.add(r.date);
    const b = n(r.bird_count);
    const e = m(r, "total_eggs");
    const prev = lastByHouse.get(r.house_id);
    if (!prev || prev.date <= r.date) lastByHouse.set(r.house_id, r);
    if (e !== null && b) {
      eggs += e;
      birdsForEggs += b;
      for (const gr of GRADES) g[gr] = (g[gr] ?? 0) + (n(r[`egg_${gr}`]) ?? 0);
      const w = n(r.egg_weight);
      if (w) {
        eggWsum += w * e;
        eggWn += e;
        mass += (e * w) / 1000;
        massBirds += b;
        if (n(r.feed_kg)) feedForMass += r.feed_kg as number;
      }
    }
    deaths += n(r.mortality) ?? 0;
    const f = n(r.feed_kg);
    if (f && b) {
      feed += f;
      birdsForFeed += b;
    }
    feedIn += n(r.feed_in_kg) ?? 0;
    const wl = n(r.water_l);
    if (wl && f) {
      water += wl;
      feedForWater += f;
    }
    if (wl && b) waterBirds += b;
    if (n(r.temp_min) !== null) { tmin += r.temp_min as number; tminN++; }
    if (n(r.temp_max) !== null) { tmax += r.temp_max as number; tmaxN++; }
    if (typeof r.feed_type === "string") feedType = r.feed_type;
    if (typeof r.feed_brand === "string") feedBrand = r.feed_brand;
    if (n(r.body_weight)) bodyW = r.body_weight as number;
    if (n(r.uniformity)) uniformity = r.uniformity as number;
  }
  const birds = lastByHouse.size ? [...lastByHouse.values()].reduce((a, r) => a + (n(r.bird_count) ?? 0), 0) : null;
  const totalG = Object.values(g).reduce((a, b) => a + b, 0);
  const grades: Record<string, number> = {};
  if (totalG) for (const grp of GRADE_GROUPS) grades[grp.key] = (grp.grades.reduce((a, k) => a + (g[k] ?? 0), 0) / totalG) * 100;
  let waterAll = 0;
  for (const r of recs) if (n(r.water_l) && n(r.bird_count)) waterAll += r.water_l as number;
  return {
    days: days.size,
    birds,
    eggs,
    lay: birdsForEggs ? (eggs / birdsForEggs) * 100 : null,
    deaths,
    deathPct: birds ? (deaths / birds) * 100 : null,
    feedKg: feed,
    feedG: birdsForFeed ? (feed * 1000) / birdsForFeed : null,
    feedIn,
    fcr: mass && feedForMass ? feedForMass / mass : null,
    eggW: eggWn ? eggWsum / eggWn : null,
    massG: massBirds ? (mass * 1000) / massBirds : null,
    wf: feedForWater ? water / feedForWater : null,
    waterMl: waterBirds ? (waterAll * 1000) / waterBirds : null,
    tmin: tminN ? tmin / tminN : null,
    tmax: tmaxN ? tmax / tmaxN : null,
    grades,
    feedType,
    feedBrand,
    bodyW,
    uniformity,
  };
}

/* 기록이 있는 마지막 날 (오늘 입력 전이면 어제·그저께가 된다) */
export function lastDate(recs: Rec[]): string | null {
  let d: string | null = null;
  for (const r of recs) if (m(r, "total_eggs") !== null || n(r.feed_kg) !== null) if (!d || r.date > d) d = r.date;
  return d;
}

export function between(recs: Rec[], from: string, to: string, houseId?: number) {
  return recs.filter((r) => r.date >= from && r.date <= to && (houseId === undefined || r.house_id === houseId));
}

/* 하루 값 하나 (차트용) */
export type MetricKey = "lay" | "mort" | "feed" | "fcr" | "eggw" | "mass" | "wf" | "water" | "temp";
export function dayValue(r: Rec, k: MetricKey): number | null {
  switch (k) {
    case "lay": {
      const v = m(r, "lay_rate");
      return v && v > 0 && v <= 100 ? v : null;
    }
    case "mort": return n(r.mortality);
    case "feed": return m(r, "feed_per_bird_g");
    case "fcr": {
      const v = m(r, "fcr");
      return v && v < 5 ? v : null;
    }
    case "eggw": return n(r.egg_weight);
    case "mass": return m(r, "egg_mass_per_bird_g");
    case "wf": {
      const v = m(r, "water_feed_ratio");
      return v && v < 5 ? v : null;
    }
    case "water": return m(r, "water_per_bird_ml");
    case "temp": return n(r.temp_max);
  }
}

export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !isFinite(v) ? "–" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
export const int = (v: number | null | undefined) => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString());
