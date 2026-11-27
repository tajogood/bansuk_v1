"use client";

/* 접종 일정 추가: 접종 일정판(달력·목록)에서 연다.
   - 한 번 접종: 계군 하나에 날짜·백신을 정해 개별 일정을 잡는다 (달력 빈 칸을 누르면 계군·날짜가 채워져 열린다)
   - 프로그램 적용: 계군에 반석 프로그램을 적용하면 주령별 일정이 한꺼번에 생긴다 */
import { useEffect, useMemo, useState } from "react";
import { vaccinesApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { PlanTarget, ProgramSummary, VaccineItem } from "@/lib/types";

type Mode = "once" | "program";

export default function PlanDialog({
  token,
  today,
  init,
  onClose,
  onSaved,
}: {
  token: string;
  today: string;
  init?: { flockId?: number; date?: string };
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("once");
  const [targets, setTargets] = useState<PlanTarget[] | null>(null);
  const [vaccines, setVaccines] = useState<VaccineItem[]>([]);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [farmId, setFarmId] = useState<number | "">("");
  const [flockIds, setFlockIds] = useState<number[]>(init?.flockId ? [init.flockId] : []);
  const [date, setDate] = useState(init?.date ?? today);
  const [vaccineId, setVaccineId] = useState<number | "">("");
  const [programId, setProgramId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([vaccinesApi.targets(token), vaccinesApi.vaccines(token), vaccinesApi.programs(token)])
      .then(([tg, vs, ps]) => {
        setTargets(tg.farms);
        setVaccines(vs.vaccines.filter((v) => v.active !== false));
        setPrograms(ps.programs.filter((p) => p.active));
        if (init?.flockId) {
          const f = tg.farms.find((x) => x.flocks.some((fl) => fl.id === init.flockId));
          if (f) setFarmId(f.farm.id);
        } else if (tg.farms[0]) setFarmId(tg.farms[0].farm.id);
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const farm = useMemo(() => targets?.find((f) => f.farm.id === farmId) ?? null, [targets, farmId]);
  const toggleFlock = (id: number) =>
    setFlockIds((ids) => (mode === "once" && ids.includes(id) ? ids.filter((x) => x !== id) : ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flockIds.length) return setErr(t("계군을 하나 이상 고르세요"));
    setBusy(true);
    setErr(null);
    try {
      if (mode === "once") {
        for (const id of flockIds) await vaccinesApi.plan(token, id, { vaccine_id: Number(vaccineId), planned_on: date, note: note || null });
        onSaved(t("접종 일정 {n}건을 잡았습니다", { n: flockIds.length }));
      } else {
        for (const id of flockIds) await vaccinesApi.assign(token, id, { program_id: Number(programId), from_date: date, reason: note || null });
        onSaved(t("계군 {n}개에 프로그램을 적용했습니다", { n: flockIds.length }));
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pd-backdrop" onMouseDown={onClose}>
      <form className="pd" role="dialog" aria-modal="true" aria-label={t("접종 일정 추가")} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="pd-head">
          <h2>{t("접종 일정 추가")}</h2>
          <button type="button" className="pd-x" onClick={onClose} aria-label={t("닫기")}>
            ×
          </button>
        </header>
        <div className="seg pd-mode" role="group">
          <button type="button" aria-pressed={mode === "once"} onClick={() => setMode("once")}>
            {t("한 번 접종")}
          </button>
          <button type="button" aria-pressed={mode === "program"} onClick={() => setMode("program")}>
            {t("프로그램 적용")}
          </button>
        </div>
        <p className="pd-help">
          {mode === "once"
            ? t("프로그램과 별개로 날짜와 백신을 정해 일정을 잡습니다. 여러 계군을 고르면 한꺼번에 잡힙니다.")
            : t("고른 계군에 반석 프로그램을 적용하면 주령별 접종 일정이 한꺼번에 생깁니다. 이미 다른 프로그램이 있으면 이 날짜부터 바뀝니다.")}
        </p>

        {!targets ? (
          <div className="sk" style={{ height: 180 }} />
        ) : (
          <>
            <label className="pd-field">
              <span>{t("농장")}</span>
              <select
                value={farmId}
                onChange={(e) => {
                  setFarmId(Number(e.target.value));
                  setFlockIds([]);
                }}
              >
                {targets.map((f) => (
                  <option key={f.farm.id} value={f.farm.id}>
                    {f.farm.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="pd-field">
              <legend>{t("계군")}</legend>
              {farm && farm.flocks.length > 0 ? (
                <div className="pd-flocks">
                  {farm.flocks.map((fl) => (
                    <label key={fl.id} className={`pd-flock${flockIds.includes(fl.id) ? " is-on" : ""}`}>
                      <input type="checkbox" checked={flockIds.includes(fl.id)} onChange={() => toggleFlock(fl.id)} />
                      <strong>{fl.house ?? fl.name}</strong>
                      <span>
                        {t("{w}주령", { w: Math.floor(fl.age_days / 7) })}
                        {fl.program ? `, ${fl.program}` : `, ${t("프로그램 없음")}`}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="pd-help">{t("이 농장에는 지금 계사에 있는 계군이 없습니다. 계군 관리에서 입추를 먼저 등록하세요.")}</p>
              )}
            </fieldset>
            <div className="pd-row">
              <label className="pd-field">
                <span>{mode === "once" ? t("접종 예정일") : t("적용 시작일")}</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              {mode === "once" ? (
                <label className="pd-field">
                  <span>{t("백신")}</span>
                  <select value={vaccineId} onChange={(e) => setVaccineId(Number(e.target.value))} required>
                    <option value="">{t("백신 선택")}</option>
                    {vaccines.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="pd-field">
                  <span>{t("프로그램")}</span>
                  <select value={programId} onChange={(e) => setProgramId(Number(e.target.value))} required>
                    <option value="">{t("프로그램 선택")}</option>
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label className="pd-field">
              <span>{mode === "once" ? t("메모 (선택)") : t("적용 사유 (선택)")}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "once" ? t("예: 최근 IB 유행으로 보강") : ""} />
            </label>
          </>
        )}
        {err && <p className="pd-err">{err}</p>}
        <footer className="pd-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("취소")}
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !flockIds.length || (mode === "once" ? !vaccineId : !programId)}>
            {busy ? t("저장 중") : mode === "once" ? t("일정 잡기") : t("프로그램 적용")}
          </button>
        </footer>
      </form>
    </div>
  );
}
