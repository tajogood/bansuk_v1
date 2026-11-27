"use client";

/* 이 브라우저에서만 기억하는 화면 설정 (기간, 필터, 보기 방식). 저장소를 못 쓰면 이번 접속 동안만 유지. */
import { useEffect, useState } from "react";

export function usePref<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const k = `bansuk_pref_${key}`;
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(k);
      if (raw !== null) setV(JSON.parse(raw) as T);
    } catch {
      /* 무시 */
    }
  }, [k]);
  const set = (nv: T | ((p: T) => T)) =>
    setV((prev) => {
      const next = typeof nv === "function" ? (nv as (p: T) => T)(prev) : nv;
      try {
        localStorage.setItem(k, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });
  return [v, set];
}

/* 숫자가 처음 나타날 때 한 번만 0에서 올라가는 효과 (움직임 줄이기 설정이면 바로 표시) */
export function useCountUp(target: number | null, ms = 700): number | null {
  const [v, setV] = useState<number | null>(target);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (target === null) return;
    if (done || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)) {
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - p) ** 3;
      setV(target * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    // 탭이 숨겨져 있어 애니메이션이 멈춰도 값은 반드시 제자리로
    const fallback = setTimeout(() => {
      setV(target);
      setDone(true);
    }, ms + 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}
