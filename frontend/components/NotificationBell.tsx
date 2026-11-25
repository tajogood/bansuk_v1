"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notificationsApi } from "@/lib/api";
import { notificationText, timeAgo } from "@/lib/cases";
import { useLang, useT } from "@/lib/i18n";
import type { NotificationItem } from "@/lib/types";

const POLL_MS = 45_000;

/** 알림 종: 안 읽은 수를 주기적으로 확인하고, 누르면 최근 알림 목록. 항목을 누르면 그 부검 건으로. */
export default function NotificationBell({ token }: { token: string }) {
  const t = useT();
  const lang = useLang();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    notificationsApi
      .count(token)
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  }, [token]);

  // 홈 화면에 설치한 앱이면 아이콘에도 빨간 표시 (지원하는 기기만)
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread > 0) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    notificationsApi
      .list(token)
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => setItems([]));
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, token, lang]);

  const readAll = async () => {
    await notificationsApi.readAll(token);
    setUnread(0);
    setItems((s) => s?.map((n) => ({ ...n, read: true })) ?? s);
  };

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="bell-btn"
        onClick={() => setOpen(!open)}
        aria-label={unread ? t("알림 {n}개", { n: unread }) : t("알림")}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path
            d="M12 3a6 6 0 0 0-6 6v3.6l-1.6 2.7A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.7L18 12.6V9a6 6 0 0 0-6-6Zm0 18a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 21Z"
            fill="currentColor"
          />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t("알림")}>
          <div className="bell-head">
            <strong>{t("알림")}</strong>
            {unread > 0 && (
              <button type="button" className="link-btn" onClick={readAll}>
                {t("모두 읽음")}
              </button>
            )}
          </div>
          {items === null ? (
            <p className="bell-empty">{t("불러오는 중")}</p>
          ) : items.length === 0 ? (
            <p className="bell-empty">{t("새 알림이 없습니다.")}</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <a href={n.case_id ? `/cases/?id=${n.case_id}` : "#"} className={n.read ? "" : "is-unread"}>
                    <span>{notificationText(n.kind, n.data)}</span>
                    <small>{timeAgo(n.at)}</small>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a className="bell-all" href="/cases/">
            {t("부검 관리 전체 보기")}
          </a>
        </div>
      )}
    </div>
  );
}
