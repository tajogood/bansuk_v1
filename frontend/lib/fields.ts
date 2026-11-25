/**
 * 입력 항목 정의. 농장 설정(InputConfig)에 따라 화면에 나올 항목과 순서를 만든다.
 * 필수 항목(폐사, 규격별 산란, 사료)이 먼저, 선택 항목이 뒤에 온다.
 */
import type { DailyRecord, InputConfig } from "./types";

export type Field = {
  key: string; // API 필드명
  label: string;
  unit: string;
  decimal: boolean;
  scale: number; // 화면 값 × scale = 저장 값 (판 → 개)
  optional: boolean;
  isEgg: boolean;
};

export function buildFields(cfg: InputConfig, houseKind: string = "laying"): Field[] {
  const tray = cfg.egg_unit === "tray";
  const rearing = houseKind === "rearing";
  const f: Field[] = [
    { key: "mortality", label: "폐사", unit: "수", decimal: false, scale: 1, optional: false, isEgg: false },
  ];
  // 육성사는 산란 전이라 규격 칸이 없다
  for (const g of rearing ? [] : cfg.grades) {
    f.push({
      key: `egg_${g.code}`,
      label: g.label,
      unit: tray ? "판" : "개",
      decimal: false,
      scale: tray ? cfg.eggs_per_tray : 1,
      optional: false,
      isEgg: true,
    });
  }
  if (cfg.show_feed)
    f.push({ key: "feed_kg", label: "사료 소비", unit: "kg", decimal: true, scale: 1, optional: false, isEgg: false });
  if (cfg.show_water)
    f.push({ key: "water_l", label: "급수", unit: "L", decimal: true, scale: 1, optional: true, isEgg: false });
  if (cfg.show_temp) {
    f.push({ key: "temp_min", label: "최저 온도", unit: "℃", decimal: true, scale: 1, optional: true, isEgg: false });
    f.push({ key: "temp_max", label: "최고 온도", unit: "℃", decimal: true, scale: 1, optional: true, isEgg: false });
  }
  if (cfg.show_humidity)
    f.push({ key: "humidity", label: "습도", unit: "%", decimal: true, scale: 1, optional: true, isEgg: false });
  if (cfg.show_egg_weight && !rearing)
    f.push({ key: "egg_weight", label: "난중", unit: "g", decimal: true, scale: 1, optional: true, isEgg: false });
  if (rearing)
    f.push({ key: "body_weight", label: "체중", unit: "g", decimal: true, scale: 1, optional: true, isEgg: false });
  if (cfg.show_cull)
    f.push({ key: "cull", label: "도태", unit: "수", decimal: false, scale: 1, optional: true, isEgg: false });
  return f;
}

/** 저장된 기록 값을 화면 문자열로 (판 단위면 나눔). */
export function display(field: Field, rec: DailyRecord | null): string {
  if (!rec) return "";
  const v = rec[field.key];
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v) / field.scale;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** 화면 문자열을 저장 값으로. 빈칸은 null. */
export function toApi(field: Field, s: string): number | null {
  if (s === "" || s === ".") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  const v = n * field.scale;
  return field.decimal ? Math.round(v * 10) / 10 : Math.round(v);
}
