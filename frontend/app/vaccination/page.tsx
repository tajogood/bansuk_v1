"use client";

import { useCallback, useEffect, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { loadSession, vaccinesApi } from "@/lib/api";
import { label } from "@/lib/cases";
import { num } from "@/lib/format";
import { tr, useLang, useT } from "@/lib/i18n";
import type { FlockVaccination, ProgramSummary, ScheduleRow, Session, VaccineItem } from "@/lib/types";
import { ROUTES, SCHEDULE_STATUS, ageWeeks, diseasesText } from "@/lib/vaccines";
import "../cases.css";
import "../flocks.css";
import "../vaccines.css";

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function RecordSheet({
  token,
  data,
  row,
  vaccines,
  onDone,
  onClose,
}: {
  token: string;
  data: FlockVaccination;
  row: ScheduleRow | null;
  vaccines: VaccineItem[];
  onDone: (d: FlockVaccination) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [date, setDate] = useState(row && row.planned < todayLocal() ? todayLocal() : row?.planned ?? todayLocal());
  const [vaccineId, setVaccineId] = useState<number | "">(row?.vaccine?.id ?? vaccines[0]?.id ?? "");
  const [route, setRoute] = useState(row?.route ?? "");
  const [birds, setBirds] = useState("");
  const [lot, setLot] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(
        await vaccinesApi.record(token, data.flock.id, {
          date,
          vaccine_id: Number(vaccineId),
          route: route || null,
          birds: birds ? Number(birds) : null,
          lot: lot || null,
          program_item_id: row?.item_id ?? null,
          note: note || null,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fl-sheet-bg" onClick={onClose}>
      <form className="fl-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{row ? t("{age} 접종 기록", { age: ageWeeks(row.age_days) }) : t("프로그램 밖 접종 기록")}</h2>
        {row && <p className="cs-muted">{t("예정일 {d}", { d: row.planned })}</p>}
        <label>
          {t("접종일")}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          {t("백신")}
          <select value={vaccineId} onChange={(e) => setVaccineId(Number(e.target.value))} required>
            {vaccines.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("접종 경로")}
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="">{t("백신 기본 경로")}</option>
            {ROUTES.map((r) => (
              <option key={r.code} value={r.code}>
                {tr(r.label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("접종 수수 (선택)")}
          <input inputMode="numeric" value={birds} onChange={(e) => setBirds(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label>
          {t("로트 번호 (선택)")}
          <input value={lot} onChange={(e) => setLot(e.target.value)} />
        </label>
        <label>
          {t("메모 (선택)")}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="warn warn-error">{error}</p>}
        <div className="cs-actions">
          <button type="button" onClick={onClose}>
            {t("취소")}
          </button>
          <button type="submit" className="cs-primary" disabled={busy || !vaccineId}>
            {busy ? t("저장 중") : t("접종 기록 저장")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function VaccinationPage() {
  const t = useT();
  const lang = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [flockId, setFlockId] = useState<number | null>(null);
  const [data, setData] = useState<FlockVaccination | null>(null);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [vaccines, setVaccines] = useState<VaccineItem[]>([]);
  const [sheet, setSheet] = useState<{ row: ScheduleRow | null } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pick, setPick] = useState<number | "">("");
  const [from, setFrom] = useState(todayLocal());
  const [reason, setReason] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setSession(loadSession());
    setFlockId(Number(new URLSearchParams(window.location.search).get("flock")) || null);
  }, []);
  const load = useCallback(() => {
    if (!session || !flockId) return;
    vaccinesApi
      .flock(session.token, flockId)
      .then((d) => {
        setData(d);
        if (d.can_edit) {
          vaccinesApi.programs(session.token).then((r) => setPrograms(r.programs.filter((p) => p.active))).catch(() => {});
          vaccinesApi.vaccines(session.token).then((r) => setVaccines(r.vaccines.filter((v) => v.active))).catch(() => {});
        }
      })
      .catch((e) => setError(e.message));
  }, [session, flockId]);
  useEffect(() => load(), [load, lang]);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2400);
  };

  if (!session) return null;
  const d = data;
  const counts = d ? { overdue: d.schedule.filter((s) => s.status === "overdue").length, due: d.schedule.filter((s) => s.status === "due").length } : null;
  const rows = d ? d.schedule.filter((s) => showDone || s.status !== "done") : [];

  return (
    <main className="cs-wrap">
      <header className="cs-head">
        <a href={d ? `/flocks/?farm=${d.flock.farm?.id ?? ""}` : "/flocks/"} className="cs-back">
          ‹ {t("계군 관리")}
        </a>
        <h1>{t("백신 접종")}</h1>
        <span className="cs-spacer" />
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <div className="cs-body vx-body">
        {error && <p className="warn warn-error">{error}</p>}
        {!d ? (
          <p className="cs-muted">{t("불러오는 중")}</p>
        ) : (
          <>
            <section className="vx-head">
              <p className="cs-muted">
                {d.flock.farm?.name} · {d.flock.name ?? t("{d} 입추", { d: d.flock.placed_on })} · {num(d.flock.placed_count)}
                {t("수")}
              </p>
              <h2>{t("{w}주령 ({d}일령)", { w: Math.floor(d.flock.age_days / 7), d: d.flock.age_days })}</h2>
              <div className="vx-program">
                <span>{t("백신 프로그램")}</span>
                <strong>{d.current?.label ?? t("적용 안 함")}</strong>
                {d.current?.label && <small className="cs-muted">{t("{d}부터", { d: d.current.from })}</small>}
                {d.can_edit && (
                  <button type="button" className="link-btn" onClick={() => setAssignOpen(!assignOpen)}>
                    {d.current?.label ? t("프로그램 바꾸기") : t("프로그램 적용")}
                  </button>
                )}
              </div>
              {counts && (counts.overdue > 0 || counts.due > 0) && (
                <p className={counts.overdue ? "warn warn-error" : "warn"}>
                  {counts.overdue ? t("밀린 접종 {n}건", { n: counts.overdue }) : ""}
                  {counts.overdue && counts.due ? " · " : ""}
                  {counts.due ? t("이번 주 접종 {n}건", { n: counts.due }) : ""}
                </p>
              )}
            </section>

            {assignOpen && d.can_edit && (
              <section className="cs-box">
                <h3>{t("프로그램 적용·변경")}</h3>
                <label>
                  {t("프로그램")}
                  <select value={pick} onChange={(e) => setPick(e.target.value === "none" ? "" : Number(e.target.value))}>
                    <option value="">{t("고르세요")}</option>
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value="none">{t("프로그램 중단")}</option>
                  </select>
                </label>
                <label>
                  {t("적용일")}
                  <input type="date" value={from} min={d.flock.placed_on} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <textarea rows={2} placeholder={t("바꾸는 이유 (예: 지역 IB 유행으로 사독 앞당김)")} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="cs-actions">
                  <button type="button" onClick={() => setAssignOpen(false)}>
                    {t("취소")}
                  </button>
                  <button
                    type="button"
                    className="cs-primary"
                    onClick={async () => {
                      try {
                        setData(await vaccinesApi.assign(session.token, d.flock.id, { program_id: pick === "" ? null : Number(pick), from_date: from, reason: reason || null }));
                        setAssignOpen(false);
                        setReason("");
                        flash(t("프로그램을 저장했습니다"));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {t("저장")}
                  </button>
                </div>
              </section>
            )}

            <section className="cs-sec">
              <div className="cs-sec-head">
                <h2>{t("접종 일정")}</h2>
                <label className="vx-toggle">
                  <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                  {t("완료한 것도 보기")}
                </label>
              </div>
              {d.schedule.length === 0 ? (
                <p className="cs-muted">{t("적용한 프로그램이 없습니다.")}</p>
              ) : (
                <ul className="vx-schedule">
                  {rows.map((s) => (
                    <li key={s.item_id} className={`st-${s.status}`}>
                      <div className="vx-when">
                        <strong>{ageWeeks(s.age_days)}</strong>
                        <span>{s.planned}</span>
                      </div>
                      <div className="vx-what">
                        <strong>{s.vaccine?.name}</strong>
                        <span className="cs-muted">
                          {s.vaccine ? diseasesText(s.vaccine.components) : ""}
                          {s.route ? ` · ${label(ROUTES, s.route)}` : ""}
                          {s.note ? ` · ${s.note}` : ""}
                        </span>
                        {s.done && <span className="cs-muted">{t("{d} 접종", { d: s.done.date })}{s.done.lot ? ` · ${t("로트")} ${s.done.lot}` : ""}</span>}
                      </div>
                      <div className="vx-state">
                        <span className={`vx-badge vb-${s.status}`}>{t(SCHEDULE_STATUS[s.status])}</span>
                        {d.can_edit && s.status !== "done" && (
                          <button type="button" className="vx-do" onClick={() => setSheet({ row: s })}>
                            {t("접종함")}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                  {rows.length === 0 && <li className="cs-muted">{t("남은 접종이 없습니다.")}</li>}
                </ul>
              )}
            </section>

            <section className="cs-sec">
              <div className="cs-sec-head">
                <h2>{t("접종 기록")}</h2>
                {d.can_edit && (
                  <button type="button" onClick={() => setSheet({ row: null })}>
                    {t("프로그램 밖 접종 추가")}
                  </button>
                )}
              </div>
              {d.vaccinations.length === 0 ? (
                <p className="cs-muted">{t("아직 접종 기록이 없습니다.")}</p>
              ) : (
                <table className="cs-table vx-records">
                  <tbody>
                    {d.vaccinations.map((v) => (
                      <tr key={v.id}>
                        <th>{v.date}</th>
                        <td>
                          <strong>{v.vaccine?.name}</strong>
                          <span className="cs-muted">
                            {v.route ? label(ROUTES, v.route) : ""}
                            {v.birds ? ` · ${num(v.birds)}${t("수")}` : ""}
                            {v.lot ? ` · ${t("로트")} ${v.lot}` : ""}
                            {v.performed_by ? ` · ${v.performed_by}` : ""}
                            {!v.program_item_id ? ` · ${t("프로그램 밖")}` : ""}
                          </span>
                        </td>
                        {d.can_edit && (
                          <td>
                            <button
                              type="button"
                              className="link-btn cs-danger"
                              onClick={async () => {
                                if (!window.confirm(t("이 접종 기록을 지울까요?"))) return;
                                setData(await vaccinesApi.removeRecord(session.token, v.id));
                              }}
                            >
                              {t("지우기")}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {d.history.length > 0 && (
              <section className="cs-sec">
                <h2>{t("프로그램 변경 이력")}</h2>
                <ul className="vx-history">
                  {d.history.map((h) => (
                    <li key={h.id}>
                      <strong>{h.label ?? t("프로그램 중단")}</strong>
                      <span className="cs-muted">
                        {h.from} ~ {h.to ?? t("지금")}
                        {h.set_by ? ` · ${h.set_by}` : ""}
                      </span>
                      {h.reason && <span>{h.reason}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {sheet && d && (
        <RecordSheet
          token={session.token}
          data={d}
          row={sheet.row}
          vaccines={vaccines}
          onClose={() => setSheet(null)}
          onDone={(x) => {
            setData(x);
            setSheet(null);
            flash(t("접종을 기록했습니다"));
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
