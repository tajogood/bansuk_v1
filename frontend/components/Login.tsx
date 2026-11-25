"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";

export function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

export default function Login({ onLogin }: { onLogin: (s: Session, pin: string) => void }) {
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
      setError(err instanceof Error ? err.message : "로그인하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="brand">
        <span className="brand-mark" aria-hidden>반석</span>
        <span>반석LTC</span>
      </div>
      <h1>생산 기록</h1>
      <p className="muted">한 번 로그인하면 이 기기에서는 다시 묻지 않습니다.</p>
      <label>
        휴대폰 번호
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
          비밀번호
          <button type="button" className="link-btn" onClick={() => setLetters(!letters)}>
            {letters ? "숫자 키패드로" : "영문이 들어 있어요"}
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
        {busy ? "확인 중" : "로그인"}
      </button>
      <p className="login-help">
        계정은 반석에서 만들어 드립니다. 비밀번호를 잊었으면 반석 담당자에게 초기화를 요청하세요.
      </p>
    </form>
  );
}
