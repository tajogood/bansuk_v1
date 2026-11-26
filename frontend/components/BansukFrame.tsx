"use client";

/* 반석 계정 데스크탑 틀: 왼쪽 메뉴 + 넓은 본문. 농장주 계정과 로그인 전에는 아무것도 감싸지 않는다. */
import { useEffect, useState } from "react";
import LangToggle from "./LangToggle";
import NotificationBell from "./NotificationBell";
import { api, loadSession, saveSession } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Session } from "@/lib/types";
import "../app/bansuk.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);
const ROLE: Record<string, string> = { admin: "반석 관리자", bansuk_vet: "수의사", bansuk_staff: "반석 연구원" };

export default function BansukFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [s, setS] = useState<Session | null>(null);
  const [path, setPath] = useState("");
  useEffect(() => {
    const sync = () => setS(loadSession());
    sync();
    setPath(window.location.pathname + window.location.search);
    window.addEventListener("bansuk-session", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bansuk-session", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const on = !!s && BANSUK.has(s.user.role) && !s.user.must_change_pin;
  useEffect(() => {
    document.body.classList.toggle("bs-on", on);
  }, [on]);
  if (!on || !s) return <>{children}</>;

  const items: [string, string, boolean?][] = [
    ["/", t("전체 농장 현황")],
    ["/cases/", t("폐사·부검")],
    ["/vaccines/", t("백신 프로그램·접종")],
    ["/lab/", t("질병 검사 결과")],
    ["/epidemic/", t("최근 유행 질병")],
    ["/photos/", t("부검 사진 태깅")],
    ["/analysis/", t("데이터 분석기")],
    ["/report/", t("계군 성적 보고서")],
    ["/admin/", t("계정·농장 관리"), s.user.role !== "admin"],
  ];
  const active = (href: string) =>
    href === "/" ? path === "/" || path.startsWith("/?") : path.startsWith(href);

  return (
    <div className="bs-app">
      <aside className="bs-side">
        <a className="bs-brand" href="/">
          <span className="bs-mark">반석</span>
          <span>
            <strong>반석LTC</strong>
            <small>{t("농장 관리")}</small>
          </span>
        </a>
        <nav className="bs-nav">
          {items
            .filter(([, , hide]) => !hide)
            .map(([href, label]) => (
              <a key={href} href={href} className={active(href) ? "is-on" : ""}>
                {label}
              </a>
            ))}
        </nav>
        <div className="bs-user">
          <div>
            <strong>{s.user.name}</strong>
            <small>{t(ROLE[s.user.role] ?? s.user.role)}</small>
          </div>
          <div className="bs-user-tools">
            <NotificationBell token={s.token} />
            <LangToggle className="link" />
            <button
              type="button"
              className="link"
              onClick={() => {
                api.logout(s.token).catch(() => {});
                saveSession(null);
                window.location.href = "/";
              }}
            >
              {t("로그아웃")}
            </button>
          </div>
        </div>
      </aside>
      <div className="bs-main">{children}</div>
    </div>
  );
}
