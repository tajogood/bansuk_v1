"use client";

import { useEffect, useState } from "react";
import { farmVaccinationApi, type UpcomingVaccination } from "@/lib/api";
import { locale, useLang, useT } from "@/lib/i18n";

/** 농장 홈 '현황' 맨 위: 밀린 접종과 2주 안 접종 예정 */
export default function UpcomingVaccinations({ token, farmId }: { token: string; farmId: number }) {
  const t = useT();
  const lang = useLang();
  const [items, setItems] = useState<UpcomingVaccination[] | null>(null);
  const [today, setToday] = useState("");
  useEffect(() => {
    farmVaccinationApi
      .upcoming(token, farmId)
      .then((r) => {
        setItems(r.items);
        setToday(r.today);
      })
      .catch(() => setItems([]));
  }, [token, farmId, lang]);
  if (!items || items.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric", weekday: "short" });
  const days = (iso: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  const when = (x: UpcomingVaccination) => {
    const d = days(x.planned);
    if (x.status === "overdue") return t("{n}일 지남", { n: -d });
    if (d === 0) return t("오늘");
    if (d === 1) return t("내일");
    return t("{n}일 뒤", { n: d });
  };
  return (
    <section className="vx-card" aria-label={t("접종 예정")}>
      <h2>{t("접종 예정")}</h2>
      <ul>
        {items.slice(0, 6).map((x) => (
          <li key={`${x.flock_id}-${x.item_id}`} className={x.status === "overdue" ? "is-overdue" : d0(x, days) ? "is-soon" : ""}>
            <a href={`/vaccination/?flock=${x.flock_id}`}>
              <span className="vx-when">{when(x)}</span>
              <span className="vx-what">
                <strong>{x.house ?? ""} · {x.vaccine?.name ?? ""}</strong>
                <small>{fmt.format(new Date(`${x.planned}T00:00:00`))} · {t("{n}일령", { n: x.age_days })}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="muted">{t("외 {n}건", { n: items.length - 6 })}</p>}
      <p className="muted vx-note">{t("접종은 반석이 직접 합니다. 일정이 맞지 않으면 반석에 알려 주세요.")}</p>
    </section>
  );
}

function d0(x: UpcomingVaccination, days: (iso: string) => number) {
  return days(x.planned) <= 3;
}
