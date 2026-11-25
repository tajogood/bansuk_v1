/**
 * 화면 언어 (한국어 기본, 영어 지원).
 * 한국어 문구를 그대로 키로 쓴다: t("저장했습니다") → 영어면 EN 사전의 값.
 * {name} 자리는 vars로 채운다: t("{n}동 저장", { n: 3 }).
 * 빠진 번역은 npm run check-i18n 이 잡는다 (빌드 전에 자동 실행).
 */
"use client";

import { useEffect, useSyncExternalStore } from "react";
import { EN } from "./en";

export type Lang = "ko" | "en";
const KEY = "bansuk.lang";
let lang: Lang = "ko";
let loaded = false;
// 정적 HTML은 한국어로 미리 만들어져 있어, 첫 렌더(하이드레이션)는 한국어로 맞추고 직후에 바꾼다.
let hydrated = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ko" || v === "en") lang = v;
  } catch {
    /* 저장소 없음 */
  }
  document.documentElement.lang = lang;
}

/** 화면에 쓸 언어 (하이드레이션 전에는 ko). */
export function getLang(): Lang {
  load();
  return hydrated ? lang : "ko";
}

/** 저장된 언어 그대로 (API 요청 헤더용). */
export function storedLang(): Lang {
  load();
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  loaded = true;
  hydrated = true;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 저장소 없음 */
  }
  document.documentElement.lang = l;
  subs.forEach((f) => f());
}

export function locale(): string {
  return getLang() === "en" ? "en-US" : "ko-KR";
}

export function tr(ko: string, vars?: Record<string, string | number>): string {
  const s = getLang() === "en" ? (EN[ko] ?? ko) : ko;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

export function useLang(): Lang {
  useEffect(() => {
    if (!hydrated) {
      hydrated = true;
      load();
      if (lang !== "ko") subs.forEach((f) => f());
    }
  }, []);
  return useSyncExternalStore(subscribe, getLang, () => "ko");
}

/** 번역 키 표시만 한다 (나중에 t(label)로 번역할 상수에 붙인다. 검사 스크립트가 찾는다). */
export const k = (ko: string) => ko;

/** 컴포넌트에서: const t = useT(); 언어가 바뀌면 다시 그린다. */
export function useT() {
  useLang();
  return tr;
}
