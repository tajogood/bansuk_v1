"use client";

/* 반석 계정 데스크탑 틀: 왼쪽 메뉴 + 넓은 본문 + ⌘K 빠른 이동.
   농장주 계정과 로그인 전에는 아무것도 감싸지 않는다 (농장주 입력은 휴대폰 화면). */
import { useEffect, useMemo, useRef, useState } from "react";
import LangToggle from "./LangToggle";
import NotificationBell from "./NotificationBell";
import { api, loadSession, saveSession } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Session } from "@/lib/types";
import "../app/bansuk.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);
const ROLE: Record<string, string> = { admin: "반석 관리자", bansuk_vet: "수의사", bansuk_staff: "반석 연구원" };

type Item = { href: string; label: string; group: string; icon: string; hide?: boolean };

/* 단순한 선 아이콘 (24px 격자, stroke) */
const ICONS: Record<string, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  case: "M9 3h6M10 3v4l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 16l-5-9V3",
  vaccine: "M18 2l4 4M17 7l-9.5 9.5L4 20M14 4l6 6M11 7l6 6M7 11l3 3",
  lab: "M6 3h12M8 3v7l-4 9a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-4-9V3M7 15h10",
  map: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  photo: "M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chart: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7",
  report: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6",
  farm: "M3 21V10l6-4 6 4v11M15 21V13l3-2 3 2v8M7 21v-5h4v5M2 21h20",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

function Palette({ items, farms, onClose }: { items: Item[]; farms: { id: number; name: string }[]; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const results = useMemo(() => {
    const all = [
      ...farms.map((f) => ({ href: `/?farm=${f.id}`, label: f.name, kind: t("농장"), icon: "farm" })),
      ...items.map((i) => ({ href: i.href, label: i.label, kind: t("메뉴"), icon: i.icon })),
    ];
    const s = q.trim().toLowerCase();
    return (s ? all.filter((r) => r.label.toLowerCase().includes(s)) : all).slice(0, 12);
  }, [q, farms, items, t]);
  const go = (href: string) => {
    window.location.href = href;
  };
  return (
    <div className="pal-backdrop" onMouseDown={onClose}>
      <div className="pal" role="dialog" aria-modal="true" aria-label={t("빠른 이동")} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder={t("농장 이름이나 메뉴를 입력하세요")}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && results[sel]) go(results[sel].href);
            else if (e.key === "Escape") onClose();
          }}
        />
        <ul>
          {results.length === 0 && <li className="pal-empty">{t("찾는 항목이 없습니다")}</li>}
          {results.map((r, i) => (
            <li key={r.href + r.label}>
              <button type="button" className={i === sel ? "is-sel" : ""} onMouseEnter={() => setSel(i)} onClick={() => go(r.href)}>
                <Icon name={r.icon} />
                <span>{r.label}</span>
                <small>{r.kind}</small>
              </button>
            </li>
          ))}
        </ul>
        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("이동")}</span>
          <span><kbd>Enter</kbd> {t("열기")}</span>
          <span><kbd>Esc</kbd> {t("닫기")}</span>
        </footer>
      </div>
    </div>
  );
}

export default function BansukFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [s, setS] = useState<Session | null>(null);
  const [path, setPath] = useState("");
  const [pal, setPal] = useState(false);
  useEffect(() => {
    const sync = () => setS(loadSession());
    sync();
    setPath(window.location.pathname + window.location.search);
    const open = () => setPal(true);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPal((p) => !p);
      }
    };
    window.addEventListener("bansuk-session", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("bansuk-palette", open);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("bansuk-session", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("bansuk-palette", open);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const on = !!s && BANSUK.has(s.user.role) && !s.user.must_change_pin;
  useEffect(() => {
    document.body.classList.toggle("bs-on", on);
  }, [on]);
  if (!on || !s) return <>{children}</>;

  const items: Item[] = [
    { href: "/", label: t("전체 농장 현황"), group: t("현황"), icon: "home" },
    { href: "/cases/", label: t("폐사·부검"), group: t("현황"), icon: "case" },
    { href: "/epidemic/", label: t("최근 유행 질병"), group: t("현황"), icon: "map" },
    { href: "/vaccines/", label: t("백신 프로그램·접종"), group: t("관리"), icon: "vaccine" },
    { href: "/lab/", label: t("질병 검사 결과"), group: t("관리"), icon: "lab" },
    { href: "/photos/", label: t("부검 사진 태깅"), group: t("관리"), icon: "photo" },
    { href: "/analysis/", label: t("데이터 분석기"), group: t("분석"), icon: "chart" },
    { href: "/report/", label: t("계군 성적 보고서"), group: t("분석"), icon: "report" },
    { href: "/admin/", label: t("계정·농장 관리"), group: t("설정"), icon: "users", hide: s.user.role !== "admin" },
  ].filter((i) => !i.hide);
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/?") : path.startsWith(href));
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="bs-app">
      <aside className="bs-side">
        <a className="bs-brand" href="/">
          <span className="bs-mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="32" height="32">
              <ellipse cx="16" cy="17" rx="10" ry="12.5" fill="#f6f2e4" />
              <circle cx="16" cy="19" r="5.2" fill="#e8a900" />
            </svg>
          </span>
          <span>
            <strong>반석LTC</strong>
            <small>{t("농장 관리")}</small>
          </span>
        </a>
        <button type="button" className="bs-find" onClick={() => setPal(true)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          {t("찾기")}
          <kbd>⌘K</kbd>
        </button>
        <nav className="bs-nav">
          {groups.map((g) => (
            <div key={g} className="bs-group">
              <p>{g}</p>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <a key={i.href} href={i.href} className={active(i.href) ? "is-on" : ""} aria-current={active(i.href) ? "page" : undefined}>
                    <Icon name={i.icon} />
                    {i.label}
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className="bs-user">
          <span className="bs-avatar" aria-hidden>{s.user.name.slice(0, 1)}</span>
          <div className="bs-user-id">
            <strong>{s.user.name}</strong>
            <small>{t(ROLE[s.user.role] ?? s.user.role)}</small>
          </div>
          <NotificationBell token={s.token} />
        </div>
        <div className="bs-user-tools">
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
      </aside>
      <div className="bs-main">{children}</div>
      {pal && <Palette items={items} farms={s.farms} onClose={() => setPal(false)} />}
    </div>
  );
}
