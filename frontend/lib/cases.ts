/**
 * 폐사 신고·부검에 쓰는 코드 목록. 서버에는 코드만 저장하고 화면에서 이름을 붙인다 (한국어·영어).
 * 반석에서 쓰는 용어가 정해지면 여기만 고치면 된다. 목록에 없는 값은 직접 입력해 그대로 저장된다.
 */
import { k, locale, tr } from "./i18n";

export type Opt = { code: string; label: string };

/** 농장주가 고르는 증상 (쉬운 말) */
export const SYMPTOMS: Opt[] = [
  { code: "sudden_death", label: k("갑자기 여러 마리 폐사") },
  { code: "lay_drop", label: k("산란 감소") },
  { code: "feed_drop", label: k("사료를 덜 먹음") },
  { code: "water_change", label: k("물을 평소와 다르게 먹음") },
  { code: "respiratory", label: k("콧물·기침·숨소리") },
  { code: "diarrhea", label: k("설사·녹변") },
  { code: "comb_color", label: k("볏 색 변화") },
  { code: "lameness", label: k("다리를 절거나 못 일어남") },
  { code: "swollen_face", label: k("얼굴이 부음") },
  { code: "feathers", label: k("깃털 빠짐·쪼임") },
  { code: "shell", label: k("알 껍질 이상") },
  { code: "heat", label: k("더위를 많이 탐") },
];

export const ONSET: Opt[] = [
  { code: "today", label: k("오늘") },
  { code: "yesterday", label: k("어제부터") },
  { code: "days_2_3", label: k("2~3일 전부터") },
  { code: "week", label: k("일주일쯤") },
];

export const ORGANS: Opt[] = [
  { code: "trachea", label: k("기관·기관지") },
  { code: "lung", label: k("폐") },
  { code: "air_sac", label: k("기낭") },
  { code: "heart", label: k("심장") },
  { code: "liver", label: k("간") },
  { code: "spleen", label: k("비장") },
  { code: "kidney", label: k("신장") },
  { code: "ovary", label: k("난소·난관") },
  { code: "proventriculus", label: k("선위") },
  { code: "gizzard", label: k("근위") },
  { code: "intestine", label: k("소장") },
  { code: "cecum", label: k("맹장") },
  { code: "cloaca", label: k("총배설강") },
  { code: "abdomen", label: k("복강") },
  { code: "skin_comb", label: k("피부·볏") },
  { code: "leg_joint", label: k("다리·관절") },
  { code: "brain", label: k("뇌") },
  { code: "oral", label: k("구강·후두") },
  { code: "crop", label: k("식도·소낭") },
  { code: "fat", label: k("복강 지방") },
  { code: "bursa", label: k("F낭") },
];

export const LESIONS: Opt[] = [
  { code: "normal", label: k("이상 없음") },
  { code: "hemorrhage", label: k("출혈") },
  { code: "swelling", label: k("종대") },
  { code: "atrophy", label: k("위축") },
  { code: "congestion", label: k("충혈") },
  { code: "necrosis", label: k("괴사 반점") },
  { code: "nodules", label: k("백색 결절") },
  { code: "mucus", label: k("점액 과다") },
  { code: "caseous", label: k("건락성 삼출물") },
  { code: "fibrin", label: k("섬유소 삼출") },
  { code: "discolor", label: k("변색") },
  { code: "rupture", label: k("파열") },
  { code: "fat", label: k("지방 과다") },
  { code: "parasite", label: k("기생충") },
];

export const DISEASES: Opt[] = [
  { code: "hpai", label: k("고병원성 조류인플루엔자") },
  { code: "lpai", label: k("저병원성 조류인플루엔자 (H9N2)") },
  { code: "nd", label: k("뉴캐슬병") },
  { code: "ib", label: k("전염성 기관지염") },
  { code: "ilt", label: k("전염성 후두기관염") },
  { code: "mg_ms", label: k("마이코플라스마 (MG·MS)") },
  { code: "fowl_typhoid", label: k("가금티푸스") },
  { code: "salmonella", label: k("살모넬라") },
  { code: "colibacillosis", label: k("대장균증") },
  { code: "ne", label: k("괴사성 장염") },
  { code: "coccidiosis", label: k("콕시듐증") },
  { code: "marek", label: k("마렉병") },
  { code: "lymphoid_leukosis", label: k("림프성 백혈병") },
  { code: "fowl_pox", label: k("계두") },
  { code: "eds", label: k("산란저하증") },
  { code: "fatty_liver", label: k("지방간 출혈 증후군") },
  { code: "egg_peritonitis", label: k("난황성 복막염") },
  { code: "red_mite", label: k("닭진드기") },
  { code: "heat_stress", label: k("열 스트레스") },
  { code: "ibd", label: k("전염성 F낭병 (감보로)") },
  { code: "ae", label: k("조류뇌척수염") },
  { code: "coryza", label: k("전염성 코라이자") },
  { code: "apv", label: k("조류 메타뉴모바이러스 (APV)") },
  { code: "ciav", label: k("닭 전염성 빈혈 (CIAV)") },
  { code: "reo", label: k("레오바이러스") },
];

export const SAMPLES: Opt[] = [
  { code: "pcr", label: k("PCR") },
  { code: "elisa", label: k("혈청 ELISA") },
  { code: "culture", label: k("세균 배양") },
  { code: "histopath", label: k("조직병리") },
  { code: "virus", label: k("바이러스 분리") },
  { code: "parasite_exam", label: k("기생충 검사") },
];

export const STATUS_LABEL: Record<string, string> = {
  reported: k("신고됨"),
  scheduling: k("일정 조정 중"),
  scheduled: k("부검 예정"),
  done: k("결과 정리 중"),
  shared: k("결과 공유됨"),
  cancelled: k("취소"),
};

/** 코드 → 화면 이름 (목록에 없으면 적은 그대로) */
export function label(list: Opt[], code: string): string {
  const o = list.find((x) => x.code === code);
  return o ? tr(o.label) : code;
}

export function fmtDateTime(iso: string | null | undefined, withWeekday = true): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(locale(), {
    month: "short",
    day: "numeric",
    ...(withWeekday ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (sec < 60) return rtf.format(0, "minute");
  if (sec < 3600) return rtf.format(-Math.round(sec / 60), "minute");
  if (sec < 86400) return rtf.format(-Math.round(sec / 3600), "hour");
  return rtf.format(-Math.round(sec / 86400), "day");
}

/** 알림 한 줄 */
export function notificationText(kind: string, d: Record<string, unknown>): string {
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const at = d.at ? fmtDateTime(String(d.at)) : "";
  switch (kind) {
    case "case_reported":
      return tr("{farm} {house} 폐사 {dead}수 신고", { farm: v(d.farm), house: v(d.house), dead: v(d.dead) });
    case "case_proposed":
      return tr("반석이 부검 시간을 제안했습니다 ({house})", { house: v(d.house) || v(d.farm) });
    case "case_requested":
      return at ? tr("{farm}에서 {at}을 요청했습니다", { farm: v(d.farm), at }) : tr("{farm}에서 다른 시간을 요청했습니다", { farm: v(d.farm) });
    case "case_accepted":
      return tr("{farm}에서 {at} 부검을 수락했습니다", { farm: v(d.farm), at });
    case "case_confirmed":
      return tr("부검 일정이 확정됐습니다: {at}", { at });
    case "case_message":
      return `${v(d.by)}: ${v(d.text)}`;
    case "case_photos":
      return tr("{farm}에서 사진 {count}장을 올렸습니다", { farm: v(d.farm), count: v(d.count) });
    case "case_shared":
      return tr("부검 결과가 나왔습니다 ({house})", { house: v(d.house) || v(d.farm) });
    case "case_result_updated":
      return tr("부검 결과가 수정됐습니다 ({house})", { house: v(d.house) || v(d.farm) });
    case "lab_issued":
      return tr("검사 결과가 나왔습니다 ({what})", { what: [v(d.house), v(d.target)].filter(Boolean).join(", ") || v(d.farm) });
    case "lab_updated":
      return tr("검사 결과가 수정됐습니다 ({what})", { what: [v(d.house), v(d.target)].filter(Boolean).join(", ") || v(d.farm) });
    case "case_cancelled":
      return tr("{farm} {house} 부검 건이 취소됐습니다", { farm: v(d.farm), house: v(d.house) });
    default:
      return kind;
  }
}
