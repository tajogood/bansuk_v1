"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import TiterChart from "@/components/TiterChart";
import { casesApi, flocksApi, labApi, loadSession } from "@/lib/api";
import { DISEASES, label } from "@/lib/cases";
import { k, tr, useLang, useT } from "@/lib/i18n";
import { ANTIGENS, LAB_KINDS, MAX_GROUP, RESULTS, antigenName, kindName, meanOf, resultName } from "@/lib/lab";
import type { LabBrief, LabDetail, LabIn, LabKind, LabSampleRow, SeroRow, Session, TiterSeries } from "@/lib/types";
import "../cases.css";
import "../lab.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);
const GROUPS = Array.from({ length: MAX_GROUP + 1 }, (_, i) => i);

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

type Mode = { kind: "list" } | { kind: "view"; id: number } | { kind: "edit"; id: number | null; caseId: number | null; farmId: number | null };

function readMode(): Mode {
  const q = new URLSearchParams(window.location.search);
  if (q.get("id")) return { kind: "view", id: Number(q.get("id")) };
  if (q.get("edit")) return { kind: "edit", id: Number(q.get("edit")), caseId: null, farmId: null };
  if (q.get("new")) return { kind: "edit", id: null, caseId: Number(q.get("case")) || null, farmId: Number(q.get("farm")) || null };
  return { kind: "list" };
}

function Badge({ r }: { r: LabBrief }) {
  const t = useT();
  if (r.status === "draft") return <span className="lb-badge is-draft">{t("작성 중")}</span>;
  if (r.positive === true) return <span className="lb-badge is-pos">{t("양성")}</span>;
  if (r.positive === false) return <span className="lb-badge is-neg">{t("음성")}</span>;
  return null;
}

function whatOf(r: LabBrief): string {
  if (r.kind === "serology") return r.antigens.map(antigenName).join(", ") || kindName(r.kind);
  return r.target || (r.disease ? label(DISEASES, r.disease) : kindName(r.kind));
}

// ---------------------------------------------------------------- 목록

function LabList({ session, isBansuk }: { session: Session; isBansuk: boolean }) {
  const t = useT();
  const lang = useLang();
  const [farmId, setFarmId] = useState<number | "">(session.farms.length === 1 ? session.farms[0].id : "");
  const [kind, setKind] = useState<string>("");
  const [items, setItems] = useState<LabBrief[] | null>(null);
  const [houses, setHouses] = useState<{ id: number; name: string }[]>([]);
  const [houseId, setHouseId] = useState<number | "">("");
  const [titers, setTiters] = useState<TiterSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    labApi
      .list(session.token, { farm_id: farmId || undefined, kind: kind || undefined })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, [session, farmId, kind]);
  useEffect(() => load(), [load, lang]);

  useEffect(() => {
    setHouses([]);
    setHouseId("");
    setTiters(null);
    if (!farmId) return;
    flocksApi
      .board(session.token, farmId)
      .then((b) => {
        setHouses(b.houses.map((h) => ({ id: h.id, name: h.name })));
      })
      .catch(() => {});
  }, [session, farmId]);
  useEffect(() => {
    if (!farmId || !houseId) return setTiters(null);
    labApi.titers(session.token, farmId, houseId).then((r) => setTiters(r.series)).catch((e) => setError(e.message));
  }, [session, farmId, houseId, lang]);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await labApi.importFile(session.token, f);
      setMsg(
        tr("{n}건을 '작성 중'으로 만들었습니다. 확인한 뒤 하나씩 발행해 주세요.", { n: r.created.length }) +
          (r.skipped.length ? " " + tr("등록되지 않은 농장 {n}건은 건너뛰었습니다: {names}", { n: r.skipped.length, names: r.skipped.map((s) => s.farm ?? "?").join(", ") }) : ""),
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const drafts = items?.filter((i) => i.status === "draft").length ?? 0;

  return (
    <div className="cs-body lb-body">
      {isBansuk && (
        <div className="lb-tools">
          <a className="cs-primary lb-btn" href={`/lab/?new=1${farmId ? `&farm=${farmId}` : ""}`}>
            {t("결과 입력")}
          </a>
          <label className="lb-btn lb-file">
            {busy ? t("올리는 중") : t("성적서 파일 올리기")}
            <input type="file" accept=".xlsx,.xlsm" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <button type="button" className="link-btn" onClick={() => labApi.template(session.token).catch((e) => setError(e.message))}>
            {t("표준 입력 양식 받기")}
          </button>
        </div>
      )}
      {isBansuk && (
        <p className="cs-muted lb-note">
          {t("지금은 반석 표준 양식(엑셀)을 읽습니다. 성적서 원본 파일 형식이 정해지면 양식별로 읽는 기능을 붙입니다.")}
        </p>
      )}
      {msg && <p className="warn">{msg}</p>}
      {error && <p className="warn warn-error">{error}</p>}

      <div className="lb-filters">
        {session.farms.length > 1 && (
          <select value={farmId} onChange={(e) => setFarmId(Number(e.target.value) || "")} aria-label={t("농장")}>
            <option value="">{t("전체 농장")}</option>
            {session.farms.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        <div className="lb-chips" role="radiogroup" aria-label={t("검사 종류")}>
          <button type="button" aria-pressed={kind === ""} onClick={() => setKind("")}>{t("전체")}</button>
          {LAB_KINDS.map((k) => (
            <button key={k.code} type="button" aria-pressed={kind === k.code} onClick={() => setKind(k.code)}>{t(k.label)}</button>
          ))}
        </div>
      </div>

      {farmId !== "" && houses.length > 0 && (
        <section className="cs-sec lb-trend">
          <div className="cs-sec-head">
            <h2>{t("항체가 추이")}</h2>
            <select value={houseId} onChange={(e) => setHouseId(Number(e.target.value) || "")} aria-label={t("계사")}>
              <option value="">{t("계사 고르기")}</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
          {houseId === "" ? (
            <p className="cs-muted">{t("계사를 고르면 항원별 평균 역가군 변화를 보여 줍니다.")}</p>
          ) : titers === null ? (
            <p className="cs-muted">{t("불러오는 중")}</p>
          ) : (
            <TiterChart series={titers} />
          )}
        </section>
      )}

      <section className="cs-sec">
        <div className="cs-sec-head">
          <h2>{t("검사 결과")}</h2>
          {isBansuk && drafts > 0 && <span className="cs-muted">{t("작성 중 {n}건", { n: drafts })}</span>}
        </div>
        {items === null ? (
          <p className="cs-muted">{t("불러오는 중")}</p>
        ) : items.length === 0 ? (
          <p className="cs-muted">{isBansuk ? t("검사 결과가 없습니다. '결과 입력'으로 시작하세요.") : t("아직 받은 검사 결과가 없습니다.")}</p>
        ) : (
          <ul className="lb-list">
            {items.map((r) => (
              <li key={r.id}>
                <a href={`/lab/?id=${r.id}`}>
                  <span className="lb-date">{r.sampled_on ?? "—"}</span>
                  <span className="lb-main">
                    <strong>{whatOf(r)}</strong>
                    <small>
                      {[session.farms.length > 1 ? r.farm : "", r.house, r.age_days !== null ? t("{d}일령", { d: r.age_days }) : "", kindName(r.kind)].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <Badge r={r} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- 결과 보기

function SeroTable({ rows }: { rows: SeroRow[] }) {
  const t = useT();
  const max = Math.max(8, ...rows.map((r) => r.counts.length - 1));
  const cols = GROUPS.slice(0, max + 1);
  return (
    <div className="lb-scroll">
      <table className="lb-sero">
        <thead>
          <tr>
            <th scope="col">{t("항원")}</th>
            <th scope="col">{t("구분")}</th>
            <th scope="col">{t("시료수")}</th>
            {cols.map((g) => (
              <th key={g} scope="col" className="num">{g}</th>
            ))}
            <th scope="col" className="num">{t("평균")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const first = i === 0 || rows[i - 1].antigen !== r.antigen;
            return (
              <tr key={r.id ?? i} className={first ? "is-first" : ""}>
                <th scope="row">{first ? antigenName(r.antigen) : ""}</th>
                <td>{r.group_label ?? ""}</td>
                <td className="num">{r.n}</td>
                {cols.map((g) => (
                  <td key={g} className="num">{r.counts[g] || ""}</td>
                ))}
                <td className="num lb-mean">{r.mean ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LabView({ session, id }: { session: Session; id: number }) {
  const t = useT();
  const lang = useLang();
  const [d, setD] = useState<LabDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    labApi.get(session.token, id).then(setD).catch((e) => setError(e.message));
  }, [session, id, lang]);
  const act = async (fn: () => Promise<LabDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setD(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (error && !d) return <div className="cs-body"><p className="warn warn-error">{error}</p></div>;
  if (!d) return <div className="cs-body"><p className="cs-muted">{t("불러오는 중")}</p></div>;
  const real = d.samples.filter((s) => !s.control);
  const controls = d.samples.filter((s) => s.control);
  return (
    <div className="cs-body lb-body">
      <section className="cs-sec lb-sheet">
        <div className="lb-sheet-head">
          <div>
            <p className="cs-muted">{kindName(d.kind)}{d.report_no ? ` · ${d.report_no}` : ""}</p>
            <h2>{whatOf(d)}</h2>
          </div>
          <Badge r={d} />
        </div>
        <dl className="cs-kv lb-kv">
          <div><dt>{t("농장")}</dt><dd>{d.farm}</dd></div>
          <div><dt>{t("계사")}</dt><dd>{d.house || "—"}</dd></div>
          <div><dt>{t("시료 채취일")}</dt><dd>{d.sampled_on ?? "—"}</dd></div>
          <div><dt>{t("일령")}</dt><dd>{d.age_days !== null ? t("{d}일령", { d: d.age_days }) : "—"}</dd></div>
          {d.kind !== "serology" && <div><dt>{t("검사 방법")}</dt><dd>{d.method || "—"}</dd></div>}
          {d.requester && <div><dt>{t("의뢰자")}</dt><dd>{d.requester}</dd></div>}
          <div><dt>{t("발행일")}</dt><dd>{d.issued_on ?? t("아직 발행 안 함")}</dd></div>
        </dl>

        {d.kind === "serology" ? (
          d.sero.length ? <SeroTable rows={d.sero} /> : <p className="cs-muted">{t("입력한 결과가 없습니다.")}</p>
        ) : (
          <table className="cs-table lb-samples">
            <thead>
              <tr><th scope="col">{t("시료")}</th><th scope="col">{t("결과")}</th></tr>
            </thead>
            <tbody>
              {[...real, ...controls].map((s, i) => (
                <tr key={s.id ?? i} className={s.control ? "is-control" : ""}>
                  <td>{s.sample}{s.control && <small> ({t("대조")})</small>}</td>
                  <td>
                    <span className={`lb-res is-${s.result}`}>{resultName(s.result)}</span>
                    {s.value && <small> {s.value}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.opinion && (
          <div className="cs-advice">
            <h3>{t("검사 소견")}</h3>
            <p className="cs-text">{d.opinion}</p>
          </div>
        )}
        {d.kind === "serology" && <p className="cs-muted lb-note">{t("숫자는 역가군(0~18)별 마리 수입니다. 평균은 역가군 평균입니다.")}</p>}
      </section>

      {d.case && (
        <section className="cs-sec">
          <h2>{t("부검 건")}</h2>
          <p>
            <a href={`/cases/?id=${d.case.id}`}>{t("이 검사를 의뢰한 부검 건 보기")}</a>
          </p>
          {d.case.suspected.length > 0 && (
            <p className="cs-muted">{t("의심 질병")}: {d.case.suspected.map((c) => label(DISEASES, c)).join(", ")}</p>
          )}
          <p>
            <strong>{t("최종 진단")}</strong>: {d.case.final_diagnosis || t("아직 적지 않았습니다 (부검 결과 화면에서 적습니다)")}
          </p>
        </section>
      )}

      {error && <p className="warn warn-error">{error}</p>}
      {d.can_edit && (
        <div className="cs-actions lb-actions">
          {d.status === "draft" ? (
            <>
              <button type="button" className="cs-danger" disabled={busy} onClick={async () => {
                if (!window.confirm(tr("이 검사 결과를 지울까요?"))) return;
                await labApi.remove(session.token, d.id).then(() => (window.location.href = "/lab/")).catch((e) => setError(e.message));
              }}>
                {t("지우기")}
              </button>
              <a className="lb-btn" href={`/lab/?edit=${d.id}`}>{t("고치기")}</a>
              <button type="button" className="cs-primary" disabled={busy} onClick={() => act(() => labApi.issue(session.token, d.id))}>
                {t("발행하고 농장에 알리기")}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => act(() => labApi.unissue(session.token, d.id))}>
                {t("발행 취소")}
              </button>
              <a className="lb-btn" href={`/lab/?edit=${d.id}`}>{t("고치기")}</a>
            </>
          )}
        </div>
      )}
      {d.can_edit && d.status === "issued" && <p className="cs-muted lb-note">{t("발행한 결과를 고치면 농장에 '수정됨' 알림이 갑니다.")}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- 입력·고치기

const PCR_DEFAULT: LabSampleRow[] = [
  { sample: k("양성 대조"), result: "positive", control: true },
  { sample: k("음성 대조"), result: "negative", control: true },
  { sample: "", result: "negative", control: false },
];

function emptyIn(farmId: number, caseId: number | null): LabIn {
  return {
    kind: "pcr", farm_id: farmId, house_id: null, case_id: caseId, report_no: null, requester: null, requested_on: todayLocal(),
    sampled_on: todayLocal(), age_days: null, method: "PCR", target: null, disease: null, opinion: null,
    samples: PCR_DEFAULT.map((s) => ({ ...s, sample: tr(s.sample) })), sero: [],
  };
}

function SeroEditor({ rows, onChange }: { rows: SeroRow[]; onChange: (r: SeroRow[]) => void }) {
  const t = useT();
  const set = (i: number, p: Partial<SeroRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="lb-sero-edit">
      {rows.map((r, i) => {
        const n = r.counts.reduce((a, b) => a + (b || 0), 0);
        return (
          <fieldset key={i} className="cs-finding">
            <div className="lb-row">
              <select value={r.antigen} onChange={(e) => set(i, { antigen: e.target.value })} aria-label={t("항원")}>
                {ANTIGENS.map((a) => (
                  <option key={a.code} value={a.code}>{t(a.label)}</option>
                ))}
              </select>
              <input value={r.group_label ?? ""} placeholder={t("구분 (예: 1층, 선택)")} onChange={(e) => set(i, { group_label: e.target.value || null })} aria-label={t("구분")} />
              <button type="button" className="link-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>{t("빼기")}</button>
            </div>
            <div className="lb-scroll">
              <div className="lb-counts" role="group" aria-label={t("역가군별 마리 수")}>
                {GROUPS.map((g) => (
                  <label key={g}>
                    <span>{g}</span>
                    <input
                      inputMode="numeric"
                      value={r.counts[g] || ""}
                      onChange={(e) => {
                        const c = [...r.counts];
                        while (c.length <= g) c.push(0);
                        c[g] = Number(e.target.value.replace(/\D/g, "")) || 0;
                        set(i, { counts: c });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
            <p className="cs-muted">{t("시료 {n}수, 평균 {m}", { n, m: meanOf(r.counts) ?? "—" })}</p>
          </fieldset>
        );
      })}
      <button type="button" onClick={() => onChange([...rows, { antigen: rows[rows.length - 1]?.antigen ?? "nd_hi", group_label: null, counts: [] }])}>
        + {t("항원 줄 추가")}
      </button>
    </div>
  );
}

function SampleEditor({ rows, onChange }: { rows: LabSampleRow[]; onChange: (r: LabSampleRow[]) => void }) {
  const t = useT();
  const set = (i: number, p: Partial<LabSampleRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="lb-samples-edit">
      {rows.map((r, i) => (
        <div key={i} className="cs-finding">
          <div className="lb-row">
            <input value={r.sample} placeholder={t("시료 (예: 기관, 맹장편도)")} onChange={(e) => set(i, { sample: e.target.value })} aria-label={t("시료")} />
            <button type="button" className="link-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>{t("빼기")}</button>
          </div>
          <div className="lb-seg" role="radiogroup" aria-label={t("결과")}>
            {RESULTS.map((x) => (
              <button key={x.code} type="button" aria-pressed={r.result === x.code} className={`is-${x.code}`} onClick={() => set(i, { result: x.code })}>
                {t(x.label)}
              </button>
            ))}
          </div>
          <div className="lb-row">
            <label className="lb-inline">
              <input type="checkbox" checked={r.control} onChange={(e) => set(i, { control: e.target.checked })} /> {t("대조 시료")}
            </label>
            <input value={r.value ?? ""} placeholder={t("값 (Ct 등, 선택)")} onChange={(e) => set(i, { value: e.target.value || null })} aria-label={t("값")} />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { sample: "", result: "negative", control: false }])}>+ {t("시료 추가")}</button>
    </div>
  );
}

function LabEdit({ session, id, caseId, farmId }: { session: Session; id: number | null; caseId: number | null; farmId: number | null }) {
  const t = useT();
  const [b, setB] = useState<LabIn | null>(null);
  const [houses, setHouses] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      labApi
        .get(session.token, id)
        .then((d) => setB({
          kind: d.kind, farm_id: d.farm_id, house_id: d.house_id, case_id: d.case_id, report_no: d.report_no, requester: d.requester,
          requested_on: d.requested_on, sampled_on: d.sampled_on, age_days: d.age_days, method: d.method, target: d.target,
          disease: d.disease, opinion: d.opinion, samples: d.samples, sero: d.sero,
        }))
        .catch((e) => setError(e.message));
    } else {
      const f = farmId ?? session.farms[0]?.id;
      if (f) setB(emptyIn(f, caseId));
      if (caseId) {
        // 부검 건에서 왔으면 농장·계사를 맞춘다
        casesApi.get(session.token, caseId).then((c) => setB((p) => (p ? { ...p, farm_id: c.farm?.id ?? p.farm_id, house_id: c.house?.id ?? null } : p))).catch(() => {});
      }
    }
  }, [session, id, caseId, farmId]);

  useEffect(() => {
    if (!b?.farm_id) return;
    flocksApi.board(session.token, b.farm_id).then((r) => setHouses(r.houses.map((h) => ({ id: h.id, name: h.name })))).catch(() => setHouses([]));
  }, [session, b?.farm_id]);

  const set = (p: Partial<LabIn>) => setB((x) => (x ? { ...x, ...p } : x));
  const setKind = (k: LabKind) => {
    if (!b) return;
    if (k === "serology") set({ kind: k, method: "HI/ELISA", sero: b.sero.length ? b.sero : [{ antigen: "nd_hi", group_label: null, counts: [] }] });
    else set({ kind: k, method: k === "culture" ? tr("세균 배양") : b.method === "HI/ELISA" ? "PCR" : b.method, samples: b.samples.length ? b.samples : PCR_DEFAULT.map((x) => ({ ...x, sample: tr(x.sample) })) });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      const body: LabIn = {
        ...b,
        samples: b.kind === "serology" ? [] : b.samples.filter((s) => s.sample.trim()),
        sero: b.kind === "serology" ? b.sero : [],
      };
      const saved = id ? await labApi.update(session.token, id, body) : await labApi.create(session.token, body);
      window.location.href = `/lab/?id=${saved.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!b) return <div className="cs-body">{error ? <p className="warn warn-error">{error}</p> : <p className="cs-muted">{t("불러오는 중")}</p>}</div>;
  return (
    <form className="cs-body lb-body lb-form" onSubmit={submit}>
      <section className="cs-sec">
        <h2>{t("검사 종류")}</h2>
        <div className="lb-chips" role="radiogroup" aria-label={t("검사 종류")}>
          {LAB_KINDS.map((k) => (
            <button key={k.code} type="button" aria-pressed={b.kind === k.code} onClick={() => setKind(k.code)}>{t(k.label)}</button>
          ))}
        </div>
        {b.case_id && <p className="cs-muted">{t("부검 건 #{id}에서 의뢰한 검사로 연결됩니다.", { id: b.case_id })}</p>}
      </section>

      <section className="cs-sec lb-grid">
        <label>
          {t("농장")}
          <select value={b.farm_id} disabled={!!b.case_id} onChange={(e) => set({ farm_id: Number(e.target.value), house_id: null })}>
            {session.farms.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t("계사")}
          <select value={b.house_id ?? ""} onChange={(e) => set({ house_id: Number(e.target.value) || null })}>
            <option value="">{t("선택 안 함")}</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t("시료 채취일")}
          <input type="date" value={b.sampled_on ?? ""} onChange={(e) => set({ sampled_on: e.target.value || null })} />
        </label>
        <label>
          {t("일령 (비우면 계군에서 계산)")}
          <input inputMode="numeric" value={b.age_days ?? ""} onChange={(e) => set({ age_days: Number(e.target.value.replace(/\D/g, "")) || null })} />
        </label>
        <label>
          {t("접수번호 (선택)")}
          <input value={b.report_no ?? ""} onChange={(e) => set({ report_no: e.target.value || null })} />
        </label>
        <label>
          {t("의뢰자 (선택)")}
          <input value={b.requester ?? ""} onChange={(e) => set({ requester: e.target.value || null })} />
        </label>
        {b.kind !== "serology" && (
          <>
            <label>
              {t("검사 방법")}
              <input value={b.method ?? ""} placeholder="PCR, RT-PCR" onChange={(e) => set({ method: e.target.value || null })} />
            </label>
            <label>
              {t("검사 대상 (성적서 표기)")}
              <input value={b.target ?? ""} placeholder="APV (115 bp)" onChange={(e) => set({ target: e.target.value || null })} />
            </label>
            <label>
              {t("질병 (유행 질병 집계용)")}
              <select value={b.disease ?? ""} onChange={(e) => set({ disease: e.target.value || null })}>
                <option value="">{t("선택 안 함")}</option>
                {DISEASES.map((x) => (
                  <option key={x.code} value={x.code}>{t(x.label)}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      <section className="cs-sec">
        <h2>{b.kind === "serology" ? t("항원별 역가군 분포") : t("시료별 결과")}</h2>
        {b.kind === "serology" ? (
          <SeroEditor rows={b.sero} onChange={(sero) => set({ sero })} />
        ) : (
          <SampleEditor rows={b.samples} onChange={(samples) => set({ samples })} />
        )}
      </section>

      <section className="cs-sec">
        <label className="lb-block">
          {t("검사 소견 (농장에 보임)")}
          <textarea rows={3} value={b.opinion ?? ""} onChange={(e) => set({ opinion: e.target.value || null })} />
        </label>
      </section>

      {error && <p className="warn warn-error">{error}</p>}
      <div className="cs-actions lb-actions">
        <a className="lb-btn" href={id ? `/lab/?id=${id}` : "/lab/"}>{t("취소")}</a>
        <button type="submit" className="cs-primary" disabled={busy}>
          {busy ? t("저장 중") : t("저장 (작성 중으로)")}
        </button>
      </div>
      <p className="cs-muted lb-note">{t("저장해도 농장에는 아직 안 보입니다. 결과 화면에서 '발행'하면 농장에 알림이 갑니다.")}</p>
    </form>
  );
}

// ---------------------------------------------------------------- 페이지

export default function LabPage() {
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => {
    setSession(loadSession());
    setMode(readMode());
  }, []);
  const isBansuk = useMemo(() => !!session && BANSUK.has(session.user.role), [session]);
  if (!session || !mode)
    return session === null && mode ? (
      <main className="cs-wrap"><p className="cs-pad">{t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a></p></main>
    ) : null;
  const back = mode.kind === "list" ? { href: "/", label: t("처음 화면") } : { href: "/lab/", label: t("검사 결과") };
  const title = mode.kind === "edit" ? (mode.id ? t("검사 결과 고치기") : t("검사 결과 입력")) : t("질병 검사 결과");
  return (
    <main className="cs-wrap">
      <header className="cs-head">
        <a href={back.href} className="cs-back">‹ {back.label}</a>
        <h1>{title}</h1>
        <span className="cs-spacer" />
        <a href="/epidemic/" className="lb-head-link">{t("최근 유행 질병")}</a>
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      {mode.kind === "list" && <LabList session={session} isBansuk={isBansuk} />}
      {mode.kind === "view" && <LabView session={session} id={mode.id} />}
      {mode.kind === "edit" &&
        (isBansuk ? (
          <LabEdit session={session} id={mode.id} caseId={mode.caseId} farmId={mode.farmId} />
        ) : (
          <div className="cs-body"><p className="cs-muted">{t("검사 결과 입력은 반석 계정에서 할 수 있습니다.")}</p></div>
        ))}
    </main>
  );
}
