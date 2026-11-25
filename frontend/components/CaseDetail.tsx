"use client";

import { useEffect, useState } from "react";
import CasePhotos from "./CasePhotos";
import { casesApi, labApi } from "@/lib/api";
import { DISEASES, LESIONS, ONSET, ORGANS, SAMPLES, STATUS_LABEL, SYMPTOMS, fmtDateTime, label, type Opt } from "@/lib/cases";
import { tr, useT } from "@/lib/i18n";
import { antigenName, kindName } from "@/lib/lab";
import type { CaseEventItem, CaseResult, Finding, LabBrief, NecropsyCase } from "@/lib/types";

const TIMES = Array.from({ length: 19 }, (_, i) => {
  const m = 8 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`;
}); // 08:00 ~ 17:00

function localISODate(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function SlotInput({ value, onChange }: { value: { d: string; t: string }; onChange: (v: { d: string; t: string }) => void }) {
  const t = useT();
  return (
    <div className="cs-slot">
      <input type="date" value={value.d} min={localISODate(0)} onChange={(e) => onChange({ ...value, d: e.target.value })} aria-label={t("날짜")} />
      <select value={value.t} onChange={(e) => onChange({ ...value, t: e.target.value })} aria-label={t("시간")}>
        {TIMES.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}

function Chips({ options, value, onChange }: { options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="cs-chips">
      {options.map((o) => (
        <button
          key={o.code}
          type="button"
          aria-pressed={value.includes(o.code)}
          onClick={() => onChange(value.includes(o.code) ? value.filter((x) => x !== o.code) : [...value, o.code])}
        >
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}

const STEPS = ["reported", "scheduling", "scheduled", "done", "shared"] as const;

function Steps({ status }: { status: string }) {
  const t = useT();
  const idx = status === "cancelled" ? -1 : STEPS.indexOf(status as (typeof STEPS)[number]);
  const names = [t("신고"), t("일정 조정"), t("부검 예정"), t("결과 정리"), t("결과 공유")];
  return (
    <ol className="cs-steps" aria-label={t("진행 단계")}>
      {names.map((n, i) => (
        <li key={n} className={i < idx ? "is-done" : i === idx ? "is-now" : ""}>
          <span>{n}</span>
        </li>
      ))}
    </ol>
  );
}

function Production({ c }: { c: NecropsyCase }) {
  const t = useT();
  const rows = c.production ?? [];
  if (rows.length < 3) return null;
  const W = 320, H = 70;
  const morts = rows.map((r) => r.mortality ?? 0);
  const mx = Math.max(1, ...morts);
  const bw = W / rows.length;
  const lays = rows.map((r) => r.lay_rate);
  const lv = lays.filter((v): v is number => v !== null);
  const lo = lv.length ? Math.min(...lv) - 2 : 0, hi = lv.length ? Math.max(...lv) + 2 : 100;
  let path = "";
  lays.forEach((v, i) => {
    if (v === null) return;
    path += `${path ? "L" : "M"}${(i + 0.5) * bw},${H - ((v - lo) / Math.max(1, hi - lo)) * (H - 6) - 3}`;
  });
  return (
    <section className="cs-sec">
      <h2>{t("이 계사 최근 {n}일", { n: rows.length })}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="cs-prod" role="img" aria-label={t("일별 폐사와 산란율")}>
        {morts.map((m, i) => (
          <rect key={i} x={i * bw + 1} y={H - (m / mx) * (H - 4)} width={bw - 2} height={(m / mx) * (H - 4)} fill="#E7B4AE" />
        ))}
        {path && <path d={path} fill="none" stroke="#1F5F45" strokeWidth={2} />}
      </svg>
      <p className="cs-legend">
        <i className="m" /> {t("폐사 (최대 {n}수)", { n: mx })} <i className="l" /> {t("산란율")}
        {lv.length ? ` ${lv[lv.length - 1].toFixed(1)}%` : ""}
      </p>
    </section>
  );
}

function eventText(e: CaseEventItem): string {
  const d = e.data;
  const by = e.author;
  const at = d.at ? fmtDateTime(String(d.at)) : "";
  switch (e.kind) {
    case "reported":
      return tr("{by}님이 폐사 {dead}수를 신고했습니다", { by, dead: String(d.dead ?? "?") });
    case "proposed":
      return tr("{by}님이 부검 시간을 제안했습니다: {slots}", { by, slots: ((d.slots as string[]) ?? []).map((s) => fmtDateTime(s)).join(", ") });
    case "requested":
      return at ? tr("{by}님이 다른 시간을 요청했습니다: {at}", { by, at }) : tr("{by}님이 일정 변경을 요청했습니다", { by });
    case "accepted":
      return tr("{by}님이 {at}으로 정했습니다", { by, at });
    case "confirmed":
      return tr("{by}님이 부검 일정을 확정했습니다: {at}", { by, at });
    case "photos":
      return tr("{by}님이 사진 {n}장을 올렸습니다", { by, n: String(d.count ?? "") });
    case "done":
      return tr("부검을 마쳤습니다");
    case "result_updated":
      return tr("결과를 고쳤습니다");
    case "shared":
      return tr("결과를 농장에 공유했습니다");
    case "cancelled":
      return tr("{by}님이 취소했습니다", { by });
    default:
      return e.kind;
  }
}

/** 결과 보기 (농장·반석 공통) */
function ResultView({ r, bansuk }: { r: CaseResult; bansuk: boolean }) {
  const t = useT();
  const hpai = r.suspected.includes("hpai");
  return (
    <div className="cs-result">
      {hpai && <p className="warn warn-error">{t("고병원성 조류인플루엔자가 의심됩니다. 즉시 가축방역기관(1588-9060)에 신고해야 합니다.")}</p>}
      <dl className="cs-kv">
        <div>
          <dt>{t("부검일")}</dt>
          <dd>{fmtDateTime(r.performed_at)}</dd>
        </div>
        <div>
          <dt>{t("부검 수수")}</dt>
          <dd>{r.birds_examined ?? "–"}</dd>
        </div>
      </dl>
      {r.summary && (
        <>
          <h3>{t("소견 요약")}</h3>
          <p className="cs-text">{r.summary}</p>
        </>
      )}
      {r.findings.length > 0 && (
        <>
          <h3>{t("장기별 소견")}</h3>
          <table className="cs-table">
            <tbody>
              {r.findings.map((f, i) => (
                <tr key={i}>
                  <th>{label(ORGANS, f.organ)}</th>
                  <td>
                    {f.lesions.map((l) => label(LESIONS, l)).join(", ")}
                    {f.note ? <span className="cs-muted"> · {f.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {r.suspected.length > 0 && (
        <>
          <h3>{t("의심 질병")}</h3>
          <p>{r.suspected.map((s) => label(DISEASES, s)).join(", ")}</p>
        </>
      )}
      {r.samples.length > 0 && (
        <>
          <h3>{t("의뢰한 검사")}</h3>
          <p>{r.samples.map((s) => label(SAMPLES, s)).join(", ")}</p>
        </>
      )}
      {r.final_diagnosis && (
        <>
          <h3>{t("최종 진단")}</h3>
          <p className="cs-strong">{r.final_diagnosis}</p>
        </>
      )}
      {r.advice && (
        <div className="cs-advice">
          <h3>{t("농장에 드리는 권고")}</h3>
          <p className="cs-text">{r.advice}</p>
        </div>
      )}
      {bansuk && r.internal_note && (
        <div className="cs-internal">
          <h3>{t("반석 내부 메모 (농장에 안 보임)")}</h3>
          <p className="cs-text">{r.internal_note}</p>
        </div>
      )}
    </div>
  );
}

/** 결과 쓰기 (반석) */
function ResultForm({ c, token, onSaved, onCancel }: { c: NecropsyCase; token: string; onSaved: (c: NecropsyCase) => void; onCancel: () => void }) {
  const t = useT();
  const r = c.result;
  const [birds, setBirds] = useState(r?.birds_examined?.toString() ?? "");
  const [findings, setFindings] = useState<Finding[]>(r?.findings?.length ? r.findings : []);
  const [suspected, setSuspected] = useState<string[]>(r?.suspected ?? []);
  const [other, setOther] = useState(r?.suspected.filter((s) => !DISEASES.some((d) => d.code === s)).join(", ") ?? "");
  const [samples, setSamples] = useState<string[]>(r?.samples ?? []);
  const [summary, setSummary] = useState(r?.summary ?? "");
  const [advice, setAdvice] = useState(r?.advice ?? "");
  const [internal, setInternal] = useState(r?.internal_note ?? "");
  const [finalDx, setFinalDx] = useState(r?.final_diagnosis ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addOrgan = (code: string) => !findings.some((f) => f.organ === code) && setFindings([...findings, { organ: code, lesions: [], note: "" }]);
  const patch = (i: number, p: Partial<Finding>) => setFindings(findings.map((f, k) => (k === i ? { ...f, ...p } : f)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const custom = other.split(",").map((s) => s.trim()).filter(Boolean);
      const out = await casesApi.result(token, c.id, {
        birds_examined: birds ? Number(birds) : null,
        findings: findings.filter((f) => f.lesions.length || f.note),
        suspected: [...suspected.filter((s) => DISEASES.some((d) => d.code === s)), ...custom],
        samples,
        summary: summary || null,
        advice: advice || null,
        internal_note: internal || null,
        final_diagnosis: finalDx || null,
      });
      onSaved(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-form">
      <label>
        {t("부검 수수")}
        <input inputMode="numeric" value={birds} onChange={(e) => setBirds(e.target.value.replace(/\D/g, ""))} />
      </label>
      <fieldset>
        <legend>{t("장기별 소견")}</legend>
        <p className="cs-muted">{t("이상이 있는 장기를 누르고 소견을 고르세요.")}</p>
        <div className="cs-chips cs-chips-sm">
          {ORGANS.map((o) => (
            <button key={o.code} type="button" aria-pressed={findings.some((f) => f.organ === o.code)} onClick={() => addOrgan(o.code)}>
              {tr(o.label)}
            </button>
          ))}
        </div>
        {findings.map((f, i) => (
          <div key={f.organ} className="cs-finding">
            <div className="cs-finding-head">
              <strong>{label(ORGANS, f.organ)}</strong>
              <button type="button" className="link-btn" onClick={() => setFindings(findings.filter((_, k) => k !== i))}>
                {t("빼기")}
              </button>
            </div>
            <Chips options={LESIONS} value={f.lesions} onChange={(v) => patch(i, { lesions: v })} />
            <input placeholder={t("메모 (색, 크기, 분포 등)")} value={f.note ?? ""} onChange={(e) => patch(i, { note: e.target.value })} />
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("의심 질병")}</legend>
        <Chips options={DISEASES} value={suspected} onChange={setSuspected} />
        <input placeholder={t("목록에 없는 질병 (쉼표로 구분)")} value={other} onChange={(e) => setOther(e.target.value)} />
        {suspected.includes("hpai") && <p className="warn warn-error">{t("고병원성 조류인플루엔자 의심 시 즉시 가축방역기관(1588-9060)에 신고해야 합니다.")}</p>}
      </fieldset>
      <fieldset>
        <legend>{t("의뢰한 검사")}</legend>
        <Chips options={SAMPLES} value={samples} onChange={setSamples} />
      </fieldset>
      <label>
        {t("소견 요약 (농장에 보임)")}
        <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label>
        {t("농장에 드리는 권고 (농장에 보임)")}
        <textarea rows={3} value={advice} onChange={(e) => setAdvice(e.target.value)} />
      </label>
      <label>
        {t("최종 진단 (검사 결과가 나오면)")}
        <input value={finalDx} onChange={(e) => setFinalDx(e.target.value)} />
      </label>
      <label>
        {t("반석 내부 메모 (농장에 안 보임)")}
        <textarea rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} />
      </label>
      {error && <p className="warn warn-error">{error}</p>}
      <div className="cs-actions">
        <button type="button" onClick={onCancel}>
          {t("취소")}
        </button>
        <button type="button" className="cs-primary" onClick={save} disabled={busy}>
          {busy ? t("저장 중") : t("결과 저장")}
        </button>
      </div>
    </div>
  );
}

/** 이 부검 건에서 의뢰한 검사 결과 */
function CaseLab({ c, token, bansuk }: { c: NecropsyCase; token: string; bansuk: boolean }) {
  const t = useT();
  const [items, setItems] = useState<LabBrief[] | null>(null);
  useEffect(() => {
    labApi.list(token, { case_id: c.id }).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [token, c.id]);
  if (!bansuk && (!items || items.length === 0)) return null;
  return (
    <section className="cs-sec">
      <div className="cs-sec-head">
        <h2>{t("검사 결과")}</h2>
        {bansuk && c.status !== "cancelled" && (
          <a className="link-btn" href={`/lab/?new=1&case=${c.id}&farm=${c.farm?.id ?? ""}`}>
            + {t("결과 입력")}
          </a>
        )}
      </div>
      {items === null ? (
        <p className="cs-muted">{t("불러오는 중")}</p>
      ) : items.length === 0 ? (
        <p className="cs-muted">{t("아직 입력한 검사 결과가 없습니다.")}</p>
      ) : (
        <ul className="cs-lab">
          {items.map((r) => (
            <li key={r.id}>
              <a href={`/lab/?id=${r.id}`}>
                {r.kind === "serology" ? r.antigens.map(antigenName).join(", ") : r.target || kindName(r.kind)}
              </a>
              <span className={r.status === "draft" ? "cs-muted" : r.positive ? "lb-res is-positive" : "lb-res is-negative"}>
                {r.status === "draft" ? t("작성 중") : r.positive === null ? "" : r.positive ? t("양성") : t("음성")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CaseDetail({ c, token, bansuk, onChange }: { c: NecropsyCase; token: string; bansuk: boolean; onChange: (c: NecropsyCase) => void }) {
  const t = useT();
  const [slots, setSlots] = useState([{ d: localISODate(1), t: "10:00" }]);
  const [vetId, setVetId] = useState<number | "">(c.vet?.id ?? "");
  const [note, setNote] = useState("");
  const [reqOpen, setReqOpen] = useState(false);
  const [req, setReq] = useState({ d: localISODate(1), t: "14:00" });
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<NecropsyCase>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      setNote("");
      setReqOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const iso = (s: { d: string; t: string }) => `${s.d}T${s.t}`;
  const open = ["reported", "scheduling", "scheduled"].includes(c.status);
  const farmRequest = c.proposals.find((p) => p.by === "farm");
  const offered = c.proposals.filter((p) => p.by === "bansuk");
  const age = c.flock ? t("{w}주령 ({d}일령)", { w: Math.floor(c.flock.age_days / 7), d: c.flock.age_days }) : null;

  // ---------- 반석: 일정 제안 / 확정 ----------
  const bansukSchedule = (
    <div className="cs-box">
      <h3>{c.status === "scheduled" ? t("일정 바꾸기") : t("부검 시간 제안")}</h3>
      {farmRequest && (
        <div className="cs-callout">
          {t("농장이 요청한 시간: {at}", { at: fmtDateTime(farmRequest.at) })}
          <button type="button" className="cs-primary" disabled={busy} onClick={() => run(() => casesApi.confirm(token, c.id, { at: farmRequest.at, vet_id: vetId || null }))}>
            {t("이 시간으로 확정")}
          </button>
        </div>
      )}
      <p className="cs-muted">{t("가능한 시간을 1~3개 보내면 농장이 하나를 고릅니다.")}</p>
      {slots.map((s, i) => (
        <div key={i} className="cs-slot-row">
          <SlotInput value={s} onChange={(v) => setSlots(slots.map((x, k) => (k === i ? v : x)))} />
          {slots.length > 1 && (
            <button type="button" className="link-btn" onClick={() => setSlots(slots.filter((_, k) => k !== i))}>
              {t("빼기")}
            </button>
          )}
        </div>
      ))}
      {slots.length < 3 && (
        <button type="button" className="link-btn" onClick={() => setSlots([...slots, { ...slots[slots.length - 1], t: "14:00" }])}>
          {t("시간 하나 더")}
        </button>
      )}
      <label>
        {t("담당 수의사")}
        <select value={vetId} onChange={(e) => setVetId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">{t("나")}</option>
          {c.vets?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <textarea rows={2} placeholder={t("농장에 보낼 말 (선택)")} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="cs-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => casesApi.confirm(token, c.id, { at: iso(slots[0]), vet_id: vetId || null, message: note || null }))}
          title={t("전화로 이미 정했을 때")}
        >
          {t("첫 시간으로 바로 확정")}
        </button>
        <button type="button" className="cs-primary" disabled={busy} onClick={() => run(() => casesApi.propose(token, c.id, { slots: slots.map(iso), vet_id: vetId || null, message: note || null }))}>
          {t("농장에 제안 보내기")}
        </button>
      </div>
    </div>
  );

  // ---------- 농장: 수락 / 다른 시간 요청 ----------
  const farmSchedule = (
    <div className="cs-box">
      {c.status === "reported" && <p>{t("반석에서 확인하고 있습니다. 부검 일정을 정하면 알림으로 알려 드립니다.")}</p>}
      {c.status === "scheduling" && c.awaiting === "farm" && (
        <>
          <h3>{t("반석이 부검 시간을 제안했습니다")}</h3>
          <p className="cs-muted">{t("가능한 시간을 눌러 주세요.")}</p>
          <div className="cs-offers">
            {offered.map((p) => (
              <button key={p.at} type="button" className="cs-offer" disabled={busy} onClick={() => run(() => casesApi.accept(token, c.id, p.at))}>
                <strong>{fmtDateTime(p.at)}</strong>
                <span>{t("이 시간으로 할게요")}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {c.status === "scheduling" && c.awaiting === "bansuk" && (
        <p>{farmRequest ? t("{at}을 요청했습니다. 반석의 답을 기다리고 있습니다.", { at: fmtDateTime(farmRequest.at) }) : t("요청을 보냈습니다. 반석의 답을 기다리고 있습니다.")}</p>
      )}
      {open && (
        <>
          {!reqOpen ? (
            <button type="button" className="link-btn" onClick={() => setReqOpen(true)}>
              {c.status === "scheduled" ? t("일정을 바꿔야 해요") : c.status === "reported" ? t("원하는 시간 알려 주기") : t("다른 시간이 좋아요")}
            </button>
          ) : (
            <div className="cs-request">
              <SlotInput value={req} onChange={setReq} />
              <textarea rows={2} placeholder={t("하실 말씀 (선택)")} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="cs-actions">
                <button type="button" onClick={() => setReqOpen(false)}>
                  {t("취소")}
                </button>
                <button type="button" className="cs-primary" disabled={busy} onClick={() => run(() => casesApi.request(token, c.id, { at: iso(req), message: note || null }))}>
                  {t("이 시간으로 요청")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <article className="cs-detail">
      <header className="cs-detail-head">
        <div>
          <p className="cs-muted">
            {c.farm?.name}
            {c.house ? ` · ${c.house.name}` : ""}
            {age ? ` · ${age}` : ""}
          </p>
          <h1>
            {c.dead_count !== null ? t("폐사 {n}수", { n: c.dead_count.toLocaleString() }) : t("폐사 신고")}
            <span className={`cs-badge s-${c.status}`}>{t(STATUS_LABEL[c.status])}</span>
          </h1>
          <p className="cs-muted">
            {t("신고 {at}", { at: fmtDateTime(c.reported_at) })}
            {c.onset ? ` · ${label(ONSET, c.onset)}` : ""}
          </p>
        </div>
      </header>
      <Steps status={c.status} />

      {c.status === "scheduled" && (
        <div className="cs-when">
          <span>{t("부검 일정")}</span>
          <strong>{fmtDateTime(c.scheduled_at)}</strong>
          {c.vet && <span>{t("담당 {name}", { name: c.vet.name })}</span>}
        </div>
      )}
      {c.status === "cancelled" && <p className="warn">{t("취소된 건입니다.")}</p>}

      <div className="cs-cols">
        <div className="cs-col-main">
          {(c.symptoms.length > 0 || c.report_note) && (
            <section className="cs-sec">
              <h2>{t("농장 신고 내용")}</h2>
              {c.symptoms.length > 0 && (
                <div className="cs-tags">
                  {c.symptoms.map((s) => (
                    <span key={s}>{label(SYMPTOMS, s)}</span>
                  ))}
                </div>
              )}
              {c.report_note && <p className="cs-text">{c.report_note}</p>}
            </section>
          )}

          {open && (bansuk ? bansukSchedule : farmSchedule)}

          {bansuk && c.status !== "cancelled" && (
            <section className="cs-sec">
              <div className="cs-sec-head">
                <h2>{t("부검 결과")}</h2>
                {!editing && (
                  <button type="button" className={c.result?.performed_at ? "" : "cs-primary"} onClick={() => setEditing(true)}>
                    {c.result?.performed_at ? t("결과 고치기") : t("부검 결과 쓰기")}
                  </button>
                )}
              </div>
              {editing ? (
                <ResultForm c={c} token={token} onCancel={() => setEditing(false)} onSaved={(x) => (onChange(x), setEditing(false))} />
              ) : c.result?.performed_at ? (
                <>
                  <ResultView r={c.result} bansuk />
                  {c.status === "done" && (
                    <div className="cs-share">
                      <p>{t("아직 농장에는 보이지 않습니다. 내용을 확인하고 공유하세요.")}</p>
                      <button type="button" className="cs-primary" disabled={busy} onClick={() => run(() => casesApi.share(token, c.id))}>
                        {t("농장에 결과 공유")}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="cs-muted">{t("부검을 마치면 결과를 적어 주세요. 공유하기 전까지 농장에는 보이지 않습니다.")}</p>
              )}
            </section>
          )}
          {!bansuk && c.status === "done" && <p className="cs-box">{t("부검을 마쳤습니다. 반석에서 결과를 정리하고 있습니다.")}</p>}
          {!bansuk && c.status === "shared" && c.result && (
            <section className="cs-sec">
              <h2>{t("부검 결과")}</h2>
              <ResultView r={c.result} bansuk={false} />
            </section>
          )}

          <CasePhotos token={token} c={c} canUpload={c.status !== "cancelled" && (bansuk || open)} onChange={onChange} />
          {error && <p className="warn warn-error">{error}</p>}
        </div>

        <aside className="cs-col-side">
          <CaseLab c={c} token={token} bansuk={bansuk} />
          <Production c={c} />
          <section className="cs-sec">
            <h2>{t("진행 기록과 대화")}</h2>
            <ol className="cs-timeline">
              {c.events?.map((e) => (
                <li key={e.id} className={`side-${e.side} ${e.kind === "message" ? "is-msg" : ""} ${e.mine ? "is-mine" : ""}`}>
                  {e.kind === "message" ? (
                    <div className="cs-bubble">
                      <span className="cs-who">{e.author}</span>
                      <p>{String(e.data.text ?? "")}</p>
                    </div>
                  ) : (
                    <p>{eventText(e)}</p>
                  )}
                  {e.kind !== "message" && (e.data.message || e.data.note || e.data.reason) ? (
                    <p className="cs-quote">{String(e.data.message ?? e.data.note ?? e.data.reason)}</p>
                  ) : null}
                  <time>{fmtDateTime(e.at, false)}</time>
                </li>
              ))}
            </ol>
            <form
              className="cs-msg"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (msg.trim()) run(() => casesApi.message(token, c.id, msg.trim())).then(() => setMsg(""));
              }}
            >
              <input placeholder={bansuk ? t("농장에 메시지") : t("반석에 메시지")} value={msg} onChange={(e) => setMsg(e.target.value)} />
              <button type="submit" disabled={busy || !msg.trim()}>
                {t("보내기")}
              </button>
            </form>
          </section>
          {open && (
            <button
              type="button"
              className="link-btn cs-cancel"
              onClick={() => {
                const reason = window.prompt(t("취소하는 이유 (선택)"));
                if (reason !== null) run(() => casesApi.cancel(token, c.id, reason || null));
              }}
            >
              {t("이 건 취소하기")}
            </button>
          )}
        </aside>
      </div>
    </article>
  );
}
