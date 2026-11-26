"use client";

import { useState } from "react";
import LangToggle from "@/components/LangToggle";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Session } from "@/lib/types";

export function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

export default function Login({ onLogin }: { onLogin: (s: Session, pin: string) => void }) {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [letters, setLetters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(phone, pin), pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("로그인하지 못했습니다"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden>
        <div className="auth-brand">
          <svg viewBox="0 0 32 32" width="36" height="36">
            <ellipse cx="16" cy="17" rx="10" ry="12.5" fill="#f6f2e4" />
            <circle cx="16" cy="19" r="5.2" fill="#e8a900" />
          </svg>
          <strong>반석LTC</strong>
        </div>
        <div className="auth-copy">
          <p className="auth-lead">{t("농장의 매일 기록과 반석의 진단을 한곳에서 봅니다.")}</p>
          <p>{t("산란율, 폐사, 접종, 부검 결과까지 계군 하나의 이력으로 이어집니다.")}</p>
        </div>
        <svg className="auth-curve" viewBox="0 0 600 260" preserveAspectRatio="none">
          <defs>
            <linearGradient id="ac" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#e8a900" stopOpacity="0.35" />
              <stop offset="1" stopColor="#e8a900" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[60, 110, 160, 210].map((y) => (
            <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#2b5a48" strokeWidth="1" />
          ))}
          <path className="auth-curve-area" d="M0,250 C60,250 90,248 120,240 C150,230 165,120 200,70 C230,40 260,34 300,36 C380,40 460,58 600,92 L600,260 L0,260 Z" fill="url(#ac)" />
          <path className="auth-curve-line" d="M0,250 C60,250 90,248 120,240 C150,230 165,120 200,70 C230,40 260,34 300,36 C380,40 460,58 600,92" fill="none" stroke="#e8a900" strokeWidth="3" />
          <path d="M0,250 C70,250 100,249 130,244 C165,236 185,150 220,104 C250,72 280,64 320,66 C400,72 470,92 600,128" fill="none" stroke="#7fa08e" strokeWidth="1.6" strokeDasharray="5 5" />
        </svg>
        <p className="auth-legend">
          <span><i className="lg-y" />{t("이번 계군")}</span>
          <span><i className="lg-g" />{t("같은 일령 과거 계군")}</span>
        </p>
      </aside>
    <form className="login" onSubmit={submit}>
      <div className="brand">
        <span className="brand-mark" aria-hidden>반석</span>
        <span>{t("반석LTC")}</span>
        <span className="an-spacer" />
        <LangToggle />
      </div>
      <h1>{t("로그인")}</h1>
      <p className="muted">{t("한 번 로그인하면 이 기기에서는 다시 묻지 않습니다.")}</p>
      <label>
        {t("휴대폰 번호")}
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          placeholder="010-0000-0000"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          required
        />
      </label>
      <label>
        <span className="label-row">
          {t("비밀번호")}
          <button type="button" className="link-btn" onClick={() => setLetters(!letters)}>
            {letters ? t("숫자 키패드로") : t("영문이 들어 있어요")}
          </button>
        </span>
        <input
          type="password"
          inputMode={letters ? "text" : "numeric"}
          autoComplete="current-password"
          maxLength={64}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
        />
      </label>
      {error && <p className="warn warn-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10 || !pin}>
        {busy ? t("확인 중") : t("로그인")}
      </button>
      <p className="login-help">
        {t("계정은 반석에서 만들어 드립니다. 비밀번호를 잊었으면 반석 담당자에게 초기화를 요청하세요.")}
      </p>
    </form>
    </div>
  );
}
