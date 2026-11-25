"use client";

import { useState } from "react";
import LangToggle from "@/components/LangToggle";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Session } from "@/lib/types";

/** 첫 로그인(임시 비밀번호)에서 본인 비밀번호를 정하는 화면. 다른 화면보다 먼저 나온다. */
export default function SetPin({
  session,
  tempPin,
  onDone,
  onCancel,
}: {
  session: Session;
  tempPin: string | null;
  onDone: (s: Session) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const digits = session.user.pin_rule.kind === "digits6";
  const [current, setCurrent] = useState(tempPin ?? "");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clean = (v: string) => (digits ? v.replace(/\D/g, "").slice(0, 6) : v);
  const ready = current && next && again && (!digits || next.length === 6);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) {
      setError(t("새 비밀번호 두 번이 서로 다릅니다"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.changePin(session.token, current, next);
      onDone({ ...session, user: r.user, farms: r.farms });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("바꾸지 못했습니다"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="brand">
        <span className="brand-mark" aria-hidden>반석</span>
        <span>{t("{name}님", { name: session.user.name })}</span>
        <span className="an-spacer" />
        <LangToggle />
      </div>
      <h1>{t("비밀번호 정하기")}</h1>
      <p className="muted">
        {t("받은 임시 비밀번호 대신 본인만 아는 비밀번호를 정해 주세요. 규칙: {rule}.", { rule: session.user.pin_rule.rule })}
      </p>
      {!tempPin && (
        <label>
          {t("임시 비밀번호")}
          <input type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label>
        {t("새 비밀번호")}
        <input
          type="password"
          inputMode={digits ? "numeric" : "text"}
          autoComplete="new-password"
          maxLength={digits ? 6 : 64}
          value={next}
          onChange={(e) => setNext(clean(e.target.value))}
          autoFocus
        />
      </label>
      <label>
        {t("한 번 더")}
        <input
          type="password"
          inputMode={digits ? "numeric" : "text"}
          autoComplete="new-password"
          maxLength={digits ? 6 : 64}
          value={again}
          onChange={(e) => setAgain(clean(e.target.value))}
        />
      </label>
      {digits && <p className="login-help">{t("같은 숫자 반복(111111), 연속 숫자(123456), 휴대폰 번호 일부는 쓸 수 없습니다.")}</p>}
      {error && <p className="warn warn-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={busy || !ready}>
        {busy ? t("저장 중") : t("비밀번호 저장")}
      </button>
      <button type="button" className="link-btn center" onClick={onCancel}>
        {t("다른 계정으로 로그인")}
      </button>
    </form>
  );
}
