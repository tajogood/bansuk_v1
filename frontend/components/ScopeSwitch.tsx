"use client";

/* 제목 옆 전환: [전체 농장] ↔ [농장 하나]. 농장을 고르면 그 농장 현황으로, '전체 농장'을 누르면 전체 현황으로. */
import { useT } from "@/lib/i18n";

export default function ScopeSwitch({ farms, current }: { farms: { id: number; name: string }[]; current: number | null }) {
  const t = useT();
  return (
    <div className="scope" role="group" aria-label={t("보기 범위")}>
      <a href="/" className={current === null ? "is-on" : ""} aria-current={current === null ? "page" : undefined}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        {t("전체 농장")}
      </a>
      <label className={`scope-farm${current !== null ? " is-on" : ""}`}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 21V10l6-4 6 4v11M15 21V13l3-2 3 2v8M2 21h20" />
        </svg>
        <select
          value={current ?? ""}
          aria-label={t("농장 선택")}
          onChange={(e) => {
            if (e.target.value) window.location.href = `/?farm=${e.target.value}`;
          }}
        >
          {current === null && <option value="">{t("농장 선택")}</option>}
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
