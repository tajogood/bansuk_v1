"use client";

import { setLang, useLang } from "@/lib/i18n";

/** 한국어 ↔ English. 고른 언어는 이 기기에 기억한다. */
export default function LangToggle({ className = "" }: { className?: string }) {
  const lang = useLang();
  const next = lang === "ko" ? "en" : "ko";
  return (
    <button
      type="button"
      className={`lang-toggle ${className}`}
      onClick={() => setLang(next)}
      aria-label={lang === "ko" ? "Switch to English" : "한국어로 바꾸기"}
      lang={next}
    >
      {lang === "ko" ? "English" : "한국어"}
    </button>
  );
}
