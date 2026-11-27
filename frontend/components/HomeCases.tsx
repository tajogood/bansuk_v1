"use client";

import { useEffect, useState } from "react";
import { casesApi } from "@/lib/api";
import { STATUS_LABEL, fmtDateTime, timeAgo } from "@/lib/cases";
import { useLang, useT } from "@/lib/i18n";
import type { NecropsyCase } from "@/lib/types";

/** 동 목록 화면의 '폐사·부검' 탭: 진행 중인 건과 신고 버튼. */
export default function HomeCases({ token, farmId, isBansuk }: { token: string; farmId: number; isBansuk: boolean }) {
  const t = useT();
  const lang = useLang();
  const [cases, setCases] = useState<NecropsyCase[] | null>(null);
  useEffect(() => {
    casesApi
      .list(token, { farm_id: farmId })
      .then((r) => setCases(r.cases))
      .catch(() => setCases([]));
  }, [token, farmId, lang]);
  const open = (cases ?? []).filter((c) => !["shared", "cancelled"].includes(c.status));
  const past = (cases ?? []).filter((c) => ["shared", "cancelled"].includes(c.status)).slice(0, 5);
  const row = (c: NecropsyCase) => (
    <li key={c.id}>
      <a className={`hc-row ${c.awaiting === (isBansuk ? "bansuk" : "farm") ? "is-action" : ""}`} href={`/cases/?id=${c.id}`}>
        <span className="hc-main">
          <strong>
            {c.house?.name ?? ""} {c.dead_count !== null ? t("폐사 {n}수", { n: c.dead_count.toLocaleString() }) : t("폐사 신고")}
          </strong>
          <small>{c.status === "scheduled" ? t("부검 {at}", { at: fmtDateTime(c.scheduled_at) }) : t("신고 {ago}", { ago: timeAgo(c.reported_at) })}</small>
        </span>
        <span className={`cs-badge s-${c.status}`}>
          {c.awaiting === (isBansuk ? "bansuk" : "farm") ? t("확인 필요") : t(STATUS_LABEL[c.status])}
        </span>
      </a>
    </li>
  );
  return (
    <div className="hc">
      {/* 폐사 신고는 농장이 한다. 반석 화면에서는 진행 상황만 본다. */}
      {!isBansuk && (
        <>
          <a className="btn-primary hc-new" href={`/cases/?new=1&farm=${farmId}`}>
            {t("폐사 신고하기")}
          </a>
          <p className="muted hc-help">{t("죽은 닭이 평소보다 많으면 신고해 주세요. 반석이 확인하고 부검 일정을 잡아 드립니다.")}</p>
        </>
      )}
      {cases === null ? (
        <p className="muted center">{t("불러오는 중")}</p>
      ) : (
        <>
          <h2 className="hc-title">{t("진행 중")}</h2>
          {open.length ? <ul className="hc-list">{open.map(row)}</ul> : <p className="muted">{t("진행 중인 신고가 없습니다.")}</p>}
          {past.length > 0 && (
            <>
              <h2 className="hc-title">{t("지난 기록")}</h2>
              <ul className="hc-list">{past.map(row)}</ul>
            </>
          )}
          <a className="report-link" href="/cases/">
            {t("부검 관리 전체 보기")}
          </a>
        </>
      )}
    </div>
  );
}
