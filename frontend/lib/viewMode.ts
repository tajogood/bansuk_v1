/* 농장주 화면 방식: 휴대폰이면 모바일, 그 밖이면 PC. 위쪽 전환 버튼으로 바꾸면 이 기기에 기억한다. */
export type ViewMode = "mobile" | "pc";
const KEY = "farm_view";

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  // iPad(데스크탑 UA) 등: 터치 + 좁은 화면
  return !!window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth < 900;
}

export function getViewMode(): ViewMode {
  if (typeof window === "undefined") return "mobile";
  try {
    const v = localStorage.getItem(KEY);
    if (v === "mobile" || v === "pc") return v;
  } catch {
    /* 무시 */
  }
  return isMobileDevice() ? "mobile" : "pc";
}

export function setViewMode(v: ViewMode) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event("farm-view"));
}
