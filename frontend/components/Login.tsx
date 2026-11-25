"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";

export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(phone, pin));
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h1>생산 기록</h1>
      <p className="muted">한 번 로그인하면 이 휴대폰에서는 다시 묻지 않습니다.</p>
      <label>
        휴대폰 번호
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="010-0000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>
      <label>
        PIN (숫자 4자리)
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          required
        />
      </label>
      {error && <p className="warn warn-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={busy || phone.length < 10 || pin.length < 4}>
        {busy ? "확인 중" : "로그인"}
      </button>
    </form>
  );
}
