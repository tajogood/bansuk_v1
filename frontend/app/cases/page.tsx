"use client";

import { useCallback, useEffect, useState } from "react";
import CaseDetail from "@/components/CaseDetail";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { api, casesApi, loadSession } from "@/lib/api";
import { ONSET, STATUS_LABEL, SYMPTOMS, fmtDateTime, label, timeAgo } from "@/lib/cases";
import { todayISO } from "@/lib/format";
import { tr, useLang, useT } from "@/lib/i18n";
import type { NecropsyCase, Session } from "@/lib/types";
import "../cases.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);

type View = { kind: "list" } | { kind: "new"; farm?: number; house?: number; dead?: number } | { kind: "detail"; id: number };

function readView(): View {
  const q = new URLSearchParams(window.location.search);
  if (q.get("id")) return { kind: "detail", id: Number(q.get("id")) };
  if (q.get("new"))
    return {
      kind: "new",
      farm: Number(q.get("farm")) || undefined,
      house: Number(q.get("house")) || undefined,
      dead: q.get("dead") ? Number(q.get("dead")) : undefined,
    };
  return { kind: "list" };
}

function go(v: View) {
  const url = v.kind === "detail" ? `?id=${v.id}` : v.kind === "new" ? "?new=1" : window.location.pathname;
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function CaseCard({ c, bansuk }: { c: NecropsyCase; bansuk: boolean }) {
  const t = useT();
  return (
    <button type="button" className="cs-card" onClick={() => go({ kind: "detail", id: c.id })}>
      <div className="cs-card-top">
        <strong>
          {bansuk ? c.farm?.name : ""}
          {c.house ? `${bansuk ? " · " : ""}${c.house.name}` : ""}
        </strong>
        <span className={`cs-badge s-${c.status}`}>{t(STATUS_LABEL[c.status])}</span>
      </div>
      <div className="cs-card-main">
        <span className="cs-dead">{c.dead_count !== null ? t("폐사 {n}수", { n: c.dead_count.toLocaleString() }) : t("폐사 신고")}</span>
        {c.status === "scheduled" ? (
          <span className="cs-when-sm">{t("부검 {at}", { at: fmtDateTime(c.scheduled_at) })}</span>
        ) : (
          <span className="cs-muted">{t("신고 {ago}", { ago: timeAgo(c.reported_at) })}</span>
        )}
      </div>
      {c.symptoms.length > 0 && <p className="cs-card-sym">{c.symptoms.slice(0, 3).map((s) => label(SYMPTOMS, s)).join(" · ")}</p>}
    </button>
  );
}

function CaseList({ session, bansuk }: { session: Session; bansuk: boolean }) {
  const t = useT();
  const lang = useLang();
  const [cases, setCases] = useState<NecropsyCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    casesApi
      .list(session.token)
      .then((r) => setCases(r.cases))
      .catch((e) => setError(e.message));
  }, [session.token, lang]);

  if (error) return <p className="warn warn-error">{error}</p>;
  if (!cases) return <p className="cs-muted cs-pad">{t("불러오는 중")}</p>;

  const groups: [string, NecropsyCase[], string?][] = bansuk
    ? [
        [t("할 일"), cases.filter((c) => c.status === "reported" || (c.status === "scheduling" && c.awaiting === "bansuk") || c.status === "done"), t("새 신고, 농장의 시간 요청, 결과 작성")],
        [t("예정된 부검"), cases.filter((c) => c.status === "scheduled").sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""))],
        [t("농장 답 기다리는 중"), cases.filter((c) => c.status === "scheduling" && c.awaiting === "farm")],
        [t("최종 진단 대기"), cases.filter((c) => c.status === "shared" && c.needs_diagnosis), t("결과는 공유했지만 질병을 아직 정하지 않은 건")],
        [t("지난 기록"), cases.filter((c) => (c.status === "shared" && !c.needs_diagnosis) || c.status === "cancelled").slice(0, 30)],
      ]
    : [
        [t("확인해 주세요"), cases.filter((c) => c.status === "scheduling" && c.awaiting === "farm")],
        [t("진행 중"), cases.filter((c) => ["reported", "scheduled", "done"].includes(c.status) || (c.status === "scheduling" && c.awaiting === "bansuk"))],
        [t("지난 기록"), cases.filter((c) => c.status === "shared" || c.status === "cancelled").slice(0, 30)],
      ];

  return (
    <div className="cs-list">
      {bansuk ? (
        /* 반석은 농장이 전화로 알려 온 경우에만 대신 등록한다 (작게) */
        <button type="button" className="btn-ghost cs-proxy" onClick={() => go({ kind: "new" })}>
          {t("전화로 받은 신고 대신 등록")}
        </button>
      ) : (
        <button type="button" className="btn-primary cs-new" onClick={() => go({ kind: "new" })}>
          {t("폐사 신고하기")}
        </button>
      )}
      {!bansuk && <p className="cs-muted cs-help">{t("죽은 닭이 평소보다 많으면 신고해 주세요. 반석이 확인하고 부검 일정을 잡아 드립니다.")}</p>}
      <div className="cs-groups">
        {groups.map(([title, list, hint]) => (
          <section key={title} className="cs-group">
            <h2>
              {title} <span>{list.length}</span>
            </h2>
            {hint && <p className="cs-muted">{hint}</p>}
            {list.length === 0 ? <p className="cs-empty">{t("없음")}</p> : list.map((c) => <CaseCard key={c.id} c={c} bansuk={bansuk} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function ReportForm({ session, bansuk, init }: { session: Session; bansuk: boolean; init: Extract<View, { kind: "new" }> }) {
  const t = useT();
  const [farmId, setFarmId] = useState<number>(init.farm ?? session.farms[0]?.id ?? 0);
  const [houses, setHouses] = useState<{ id: number; name: string }[]>([]);
  const [houseId, setHouseId] = useState<number | null>(init.house ?? null);
  const [dead, setDead] = useState(init.dead?.toString() ?? "");
  const [onset, setOnset] = useState<string>("today");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!farmId) return;
    api
      .day(session.token, farmId, todayISO())
      .then((d) => setHouses(d.houses.map((h) => ({ id: h.house.id, name: h.house.name }))))
      .catch(() => setHouses([]));
  }, [farmId, session.token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(t("신고하는 중"));
    try {
      let c = await casesApi.report(session.token, { farm_id: farmId, house_id: houseId, dead_count: dead ? Number(dead) : null, onset, symptoms, note: note || null });
      if (files.length) {
        setBusy(t("사진 올리는 중 {a}/{b}", { a: 0, b: files.length }));
        try {
          c = await casesApi.uploadPhotos(session.token, c.id, files);
        } catch {
          /* 신고는 됐으니 상세 화면에서 다시 올릴 수 있다 */
        }
      }
      go({ kind: "detail", id: c.id });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <form className="cs-report" onSubmit={submit}>
      <h1>{t("폐사 신고")}</h1>
      {(bansuk || session.farms.length > 1) && (
        <label>
          {t("농장")}
          <select value={farmId} onChange={(e) => (setFarmId(Number(e.target.value)), setHouseId(null))}>
            {session.farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset>
        <legend>{t("어느 동인가요?")}</legend>
        <div className="cs-chips">
          {houses.map((h) => (
            <button key={h.id} type="button" aria-pressed={houseId === h.id} onClick={() => setHouseId(houseId === h.id ? null : h.id)}>
              {h.name}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        {t("죽은 닭 수 (오늘까지 대략)")}
        <input className="cs-big" inputMode="numeric" value={dead} onChange={(e) => setDead(e.target.value.replace(/\D/g, ""))} placeholder="0" />
      </label>
      <fieldset>
        <legend>{t("언제부터인가요?")}</legend>
        <div className="cs-chips">
          {ONSET.map((o) => (
            <button key={o.code} type="button" aria-pressed={onset === o.code} onClick={() => setOnset(o.code)}>
              {tr(o.label)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("보이는 증상 (모두 고르세요)")}</legend>
        <div className="cs-chips">
          {SYMPTOMS.map((s) => (
            <button key={s.code} type="button" aria-pressed={symptoms.includes(s.code)} onClick={() => setSymptoms(symptoms.includes(s.code) ? symptoms.filter((x) => x !== s.code) : [...symptoms, s.code])}>
              {tr(s.label)}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        {t("하실 말씀 (선택)")}
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("예: 새벽에 2층에서 많이 죽어 있었음")} />
      </label>
      <label className="cs-file">
        {t("사진 (선택)")}
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        {files.length > 0 && <span className="cs-muted">{t("{n}장 선택", { n: files.length })}</span>}
      </label>
      {error && <p className="warn warn-error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={!!busy || !farmId}>
        {busy ?? t("반석에 신고")}
      </button>
    </form>
  );
}

export default function CasesPage() {
  const t = useT();
  const lang = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [current, setCurrent] = useState<NecropsyCase | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(loadSession());
    setView(readView());
    setReady(true);
    const onPop = () => setView(readView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadCase = useCallback(
    (id: number) => {
      if (!session) return;
      setError(null);
      casesApi
        .get(session.token, id)
        .then(setCurrent)
        .catch((e) => setError(e.message));
    },
    [session],
  );
  useEffect(() => {
    if (view.kind === "detail") loadCase(view.id);
    else setCurrent(null);
  }, [view, loadCase, lang]);

  if (!ready) return null;
  if (!session)
    return (
      <main className="cs-wrap">
        <p className="cs-pad">
          {t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a>
        </p>
      </main>
    );
  const bansuk = BANSUK.has(session.user.role);

  return (
    <main className="cs-wrap">
      <header className="cs-head">
        {view.kind === "list" ? (
          <a href="/" className="cs-back">
            ‹ {t("생산 기록")}
          </a>
        ) : (
          <button type="button" className="cs-back" onClick={() => go({ kind: "list" })}>
            ‹ {t("목록")}
          </button>
        )}
        <h1>{t("폐사·부검")}</h1>
        <span className="cs-spacer" />
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <div className="cs-body">
        {error && <p className="warn warn-error">{error}</p>}
        {view.kind === "list" && <CaseList session={session} bansuk={bansuk} />}
        {view.kind === "new" && <ReportForm session={session} bansuk={bansuk} init={view} />}
        {view.kind === "detail" && current && <CaseDetail c={current} token={session.token} bansuk={bansuk} onChange={setCurrent} />}
      </div>
    </main>
  );
}
