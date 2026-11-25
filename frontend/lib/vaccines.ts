/** 백신 종류·접종 경로 이름 (서버에는 코드만 저장). 대상 질병 이름은 lib/cases.ts의 DISEASES를 쓴다. */
import { DISEASES, type Opt, label } from "./cases";
import { k, tr } from "./i18n";

export const KINDS: Opt[] = [
  { code: "live", label: k("생독") },
  { code: "inactivated", label: k("사독") },
  { code: "vector", label: k("벡터") },
  { code: "other", label: k("기타") },
];

export const ROUTES: Opt[] = [
  { code: "spray", label: k("분무") },
  { code: "drinking", label: k("음수") },
  { code: "eye_drop", label: k("점안") },
  { code: "nasal", label: k("점비") },
  { code: "injection_im", label: k("근육 주사") },
  { code: "injection_sc", label: k("피하 주사") },
  { code: "wing_web", label: k("익막 천자") },
  { code: "in_ovo", label: k("난내 접종") },
  { code: "other", label: k("기타") },
];

export const SCHEDULE_STATUS: Record<string, string> = {
  done: k("접종 완료"),
  overdue: k("밀림"),
  due: k("이번 주"),
  upcoming: k("예정"),
};

export function diseasesText(components: { disease: string; strain?: string | null }[]): string {
  return components.map((c) => label(DISEASES, c.disease) + (c.strain ? ` (${c.strain})` : "")).join(" + ");
}

export function ageWeeks(days: number): string {
  const w = Math.floor(days / 7);
  const d = days % 7;
  return d ? tr("{w}주 {d}일", { w, d }) : tr("{w}주", { w });
}
