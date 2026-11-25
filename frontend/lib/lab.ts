/** 질병 검사 결과: 항원·검사 종류·결과 이름 (백엔드 app/lab_catalog.py와 같게 유지) */
import { k, tr } from "./i18n";
import type { Opt } from "./cases";
import type { LabKind, LabResultValue } from "./types";

export const MAX_GROUP = 18;

export const ANTIGENS: Opt[] = [
  { code: "nd_hi", label: k("ND (HI)") },
  { code: "lpai_hi", label: k("LPAI H9 (HI)") },
  { code: "eds_hi", label: k("EDS (HI)") },
  { code: "sg_agg", label: k("SG 가금티푸스 (응집)") },
  { code: "ib_elisa", label: k("IB (ELISA)") },
  { code: "mg_elisa", label: k("MG (ELISA)") },
  { code: "ms_elisa", label: k("MS (ELISA)") },
  { code: "apv_elisa", label: k("APV (ELISA)") },
  { code: "ciav_elisa", label: k("CIAV (ELISA)") },
  { code: "ibd_elisa", label: k("IBD (ELISA)") },
  { code: "ae_elisa", label: k("AE (ELISA)") },
  { code: "reo_elisa", label: k("Reo (ELISA)") },
];

export const LAB_KINDS: { code: LabKind; label: string }[] = [
  { code: "pcr", label: k("PCR") },
  { code: "serology", label: k("혈청 항체가") },
  { code: "culture", label: k("세균 배양") },
  { code: "other", label: k("기타 검사") },
];

export const RESULTS: { code: LabResultValue; label: string }[] = [
  { code: "negative", label: k("음성") },
  { code: "positive", label: k("양성") },
  { code: "suspect", label: k("의심") },
  { code: "na", label: k("판정 없음") },
];

export function antigenName(code: string): string {
  const a = ANTIGENS.find((x) => x.code === code);
  return a ? tr(a.label) : code;
}

export function kindName(code: string): string {
  const a = LAB_KINDS.find((x) => x.code === code);
  return a ? tr(a.label) : code;
}

export function resultName(code: string): string {
  const a = RESULTS.find((x) => x.code === code);
  return a ? tr(a.label) : code;
}

/** 역가군 분포의 평균 (백엔드와 같은 계산, 소수 1자리) */
export function meanOf(counts: number[]): number | null {
  const n = counts.reduce((a, b) => a + (b || 0), 0);
  if (!n) return null;
  return Math.round((counts.reduce((a, c, i) => a + i * (c || 0), 0) / n) * 10) / 10;
}

/** 줄마다 다른 색 (차트용, 색만으로 구분하지 않도록 범례에 이름을 같이 쓴다) */
export const LINE_COLORS = ["#2f6b4f", "#b5651d", "#3b5ba5", "#8a3b8f", "#a33a3a", "#5b7a1e", "#00798c", "#6b5b3e"];
