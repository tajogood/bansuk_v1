"use client";

import { useCallback, useEffect, useState } from "react";
import LangToggle from "@/components/LangToggle";
import VaccineCalendar from "@/components/viz/VaccineCalendar";
import NotificationBell from "@/components/NotificationBell";
import { ApiError, loadSession, vaccinesApi } from "@/lib/api";
import { DISEASES, label } from "@/lib/cases";
import { tr, useLang, useT } from "@/lib/i18n";
import type { DueRow, ProgramItemRow, ProgramSummary, Session, VaccineComponent, VaccineItem } from "@/lib/types";
import { KINDS, ROUTES, SCHEDULE_STATUS, ageWeeks, diseasesText } from "@/lib/vaccines";
import "../cases.css";
import "../flocks.css";
import "../vaccines.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);
type Tab = "due" | "programs" | "vaccines";

function DueBoard({ token }: { token: string }) {
  const t = useT();
  const lang = useLang();
  const [items, setItems] = useState<DueRow[] | null>(null);
  const [today, setToday] = useState("");
  const [days, setDays] = useState(30);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  useEffect(() => {
    vaccinesApi
      .due(token, days)
      .then((r) => {
        setItems(r.items);
        setToday(r.today);
      })
      .catch(() => setItems([]));
  }, [token, days, lang]);
  if (!items) return <p className="cs-muted">{t("불러오는 중")}</p>;
  const groups: [string, DueRow[]][] = [
    [t("밀린 접종"), items.filter((i) => i.status === "overdue")],
    [t("이번 주"), items.filter((i) => i.status === "due")],
    [t("그다음"), items.filter((i) => i.status === "upcoming")],
  ];
  return (
    <div>
      <div className="vx-viewtoggle">
        <div className="vx-days">
          {[7, 14, 30, 60].map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>
              {t("앞으로 {n}일", { n })}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={t("보기")}>
          <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>
            {t("달력")}
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            {t("목록")}
          </button>
        </div>
      </div>
      {view === "calendar" && today && (
        <section className="panel">
          <VaccineCalendar items={items} today={today} days={days} />
        </section>
      )}
      {view === "list" && groups.map(([title, list]) => (
        <section key={title} className="vx-group">
          <h2>
            {title} <span>{list.length}</span>
          </h2>
          {list.length === 0 ? (
            <p className="cs-empty">{t("없음")}</p>
          ) : (
            <ul className="vx-schedule">
              {list.map((s) => (
                <li key={`${s.flock_id}-${s.item_id}`} className={`st-${s.status}`}>
                  <div className="vx-when">
                    <strong>{s.planned.slice(5)}</strong>
                    <span>{ageWeeks(s.age_days)}</span>
                  </div>
                  <div className="vx-what">
                    <strong>
                      {s.farm.name} · {s.house}
                    </strong>
                    <span>
                      {s.vaccine?.name}
                      {s.route ? ` · ${label(ROUTES, s.route)}` : ""}
                    </span>
                    <span className="cs-muted">{s.program}</span>
                  </div>
                  <div className="vx-state">
                    <span className={`vx-badge vb-${s.status}`}>{t(SCHEDULE_STATUS[s.status])}</span>
                    <a className="vx-do" href={`/vaccination/?flock=${s.flock_id}`}>
                      {t("열기")}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ProgramEditor({
  token,
  program,
  vaccines,
  onSaved,
  onClose,
}: {
  token: string;
  program: ProgramSummary | null;
  vaccines: VaccineItem[];
  onSaved: (p: ProgramSummary, msg: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(program?.name ?? "");
  const [desc, setDesc] = useState(program?.description ?? "");
  const [active, setActive] = useState(program?.active ?? true);
  const [items, setItems] = useState<ProgramItemRow[]>(program?.items ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needVersion, setNeedVersion] = useState(false);
  const patch = (i: number, p: Partial<ProgramItemRow>) => setItems(items.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const body = () => ({
    name,
    description: desc || null,
    active,
    items: items.map((i) => ({ age_days: i.age_days, vaccine_id: i.vaccine_id, route: i.route || null, note: i.note || null })),
  });

  const save = async (asNew = false) => {
    setBusy(true);
    setError(null);
    try {
      if (!program) onSaved(await vaccinesApi.createProgram(token, body()), t("프로그램을 만들었습니다"));
      else if (asNew) onSaved(await vaccinesApi.newVersion(token, program.id, body()), t("새 버전을 만들었습니다. 계군에 적용하려면 계군 화면에서 바꾸세요."));
      else onSaved(await vaccinesApi.updateProgram(token, program.id, body()), t("저장했습니다"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNeedVersion(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fl-sheet-bg" onClick={onClose}>
      <div className="fl-sheet vx-editor" onClick={(e) => e.stopPropagation()}>
        <h2>{program ? t("{label} 고치기", { label: program.label }) : t("새 백신 프로그램")}</h2>
        {program && program.flocks > 0 && <p className="warn">{t("계군 {n}개에 적용된 프로그램입니다. 일정을 바꾸면 새 버전으로 저장됩니다.", { n: program.flocks })}</p>}
        <label>
          {t("이름")}
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!!program && program.flocks > 0} />
        </label>
        <label>
          {t("설명 (선택)")}
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <label className="vx-toggle">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("사용 중 (끄면 새 계군에 고를 수 없음)")}
        </label>
        <fieldset>
          <legend>{t("접종 일정")}</legend>
          <div className="vx-items">
            {items.map((it, i) => (
              <div key={i} className="vx-item">
                <div className="vx-age">
                  <input
                    inputMode="numeric"
                    aria-label={t("주령")}
                    value={Math.floor(it.age_days / 7)}
                    onChange={(e) => patch(i, { age_days: (Number(e.target.value.replace(/\D/g, "")) || 0) * 7 + (it.age_days % 7) })}
                  />
                  <span>{t("주")}</span>
                  <input
                    inputMode="numeric"
                    aria-label={t("일")}
                    value={it.age_days % 7}
                    onChange={(e) => patch(i, { age_days: Math.floor(it.age_days / 7) * 7 + Math.min(6, Number(e.target.value.replace(/\D/g, "")) || 0) })}
                  />
                  <span>{t("일")}</span>
                </div>
                <select value={it.vaccine_id} onChange={(e) => patch(i, { vaccine_id: Number(e.target.value) })} aria-label={t("백신")}>
                  {vaccines.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <select value={it.route ?? ""} onChange={(e) => patch(i, { route: e.target.value || null })} aria-label={t("접종 경로")}>
                  <option value="">{t("기본 경로")}</option>
                  {ROUTES.map((r) => (
                    <option key={r.code} value={r.code}>
                      {tr(r.label)}
                    </option>
                  ))}
                </select>
                <input placeholder={t("메모")} value={it.note ?? ""} onChange={(e) => patch(i, { note: e.target.value })} />
                <button type="button" className="link-btn cs-danger" onClick={() => setItems(items.filter((_, k) => k !== i))}>
                  {t("빼기")}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="link-btn"
            disabled={!vaccines.length}
            onClick={() => setItems([...items, { age_days: (items.length ? items[items.length - 1].age_days : 0) + 7, vaccine_id: vaccines[0]?.id, route: null, note: null }])}
          >
            {t("접종 항목 추가")}
          </button>
          {!vaccines.length && <p className="cs-muted">{t("먼저 '백신' 탭에서 백신을 등록하세요.")}</p>}
        </fieldset>
        {needVersion && (
          <div className="cs-callout">
            {t("계군에 적용된 프로그램이라 일정은 새 버전으로 저장해야 합니다.")}
            <button type="button" className="cs-primary" onClick={() => save(true)} disabled={busy}>
              {t("새 버전으로 저장")}
            </button>
          </div>
        )}
        {error && <p className="warn warn-error">{error}</p>}
        <div className="cs-actions">
          <button type="button" onClick={onClose}>
            {t("취소")}
          </button>
          {program && program.flocks > 0 && (
            <button type="button" onClick={() => save(true)} disabled={busy}>
              {t("새 버전으로 저장")}
            </button>
          )}
          <button type="button" className="cs-primary" onClick={() => save(false)} disabled={busy || !name.trim()}>
            {t("저장")}
          </button>
        </div>
      </div>
    </div>
  );
}

function VaccineEditor({ token, vaccine, onSaved, onClose }: { token: string; vaccine: VaccineItem | null; onSaved: (msg: string) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(vaccine?.name ?? "");
  const [maker, setMaker] = useState(vaccine?.maker ?? "");
  const [kind, setKind] = useState(vaccine?.kind ?? "live");
  const [route, setRoute] = useState(vaccine?.route ?? "spray");
  const [comps, setComps] = useState<VaccineComponent[]>(vaccine?.components?.length ? vaccine.components : [{ disease: "nd", strain: "" }]);
  const [note, setNote] = useState(vaccine?.note ?? "");
  const [active, setActive] = useState(vaccine?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const body = { name, maker: maker || null, kind, route, components: comps.filter((c) => c.disease).map((c) => ({ disease: c.disease, strain: c.strain || null })), note: note || null, active };
    try {
      if (vaccine) await vaccinesApi.updateVaccine(token, vaccine.id, body);
      else await vaccinesApi.createVaccine(token, body);
      onSaved(t("백신을 저장했습니다"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="fl-sheet-bg" onClick={onClose}>
      <div className="fl-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{vaccine ? t("백신 고치기") : t("백신 등록")}</h2>
        <label>
          {t("제품명")}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t("제조사 (선택)")}
          <input value={maker} onChange={(e) => setMaker(e.target.value)} />
        </label>
        <fieldset>
          <legend>{t("종류")}</legend>
          <div className="cs-chips">
            {KINDS.map((k) => (
              <button key={k.code} type="button" aria-pressed={kind === k.code} onClick={() => setKind(k.code)}>
                {tr(k.label)}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          {t("기본 접종 경로")}
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            {ROUTES.map((r) => (
              <option key={r.code} value={r.code}>
                {tr(r.label)}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t("성분 (혼합백신은 여러 줄)")}</legend>
          {comps.map((c, i) => (
            <div key={i} className="vx-comp">
              <select value={c.disease} onChange={(e) => setComps(comps.map((x, k) => (k === i ? { ...x, disease: e.target.value } : x)))} aria-label={t("대상 질병")}>
                {DISEASES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {tr(d.label)}
                  </option>
                ))}
              </select>
              <input placeholder={t("균주 (선택)")} value={c.strain ?? ""} onChange={(e) => setComps(comps.map((x, k) => (k === i ? { ...x, strain: e.target.value } : x)))} />
              {comps.length > 1 && (
                <button type="button" className="link-btn cs-danger" onClick={() => setComps(comps.filter((_, k) => k !== i))}>
                  {t("빼기")}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => setComps([...comps, { disease: "ib", strain: "" }])}>
            {t("성분 추가")}
          </button>
        </fieldset>
        <label>
          {t("메모 (선택)")}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="vx-toggle">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("사용 중")}
        </label>
        {error && <p className="warn warn-error">{error}</p>}
        <div className="cs-actions">
          <button type="button" onClick={onClose}>
            {t("취소")}
          </button>
          <button type="button" className="cs-primary" onClick={save} disabled={!name.trim()}>
            {t("저장")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VaccinesPage() {
  const t = useT();
  const lang = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("due");
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [vaccines, setVaccines] = useState<VaccineItem[]>([]);
  const [editProgram, setEditProgram] = useState<ProgramSummary | null | "new">(null);
  const [editVaccine, setEditVaccine] = useState<VaccineItem | null | "new">(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setSession(loadSession()), []);
  const reload = useCallback(() => {
    if (!session || !BANSUK.has(session.user.role)) return;
    vaccinesApi.programs(session.token).then((r) => setPrograms(r.programs)).catch(() => {});
    vaccinesApi.vaccines(session.token).then((r) => setVaccines(r.vaccines)).catch(() => {});
  }, [session]);
  useEffect(() => reload(), [reload, lang]);
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  };

  if (!session) return null;
  if (!BANSUK.has(session.user.role))
    return (
      <main className="cs-wrap">
        <p className="cs-pad">{t("반석 계정에서 사용할 수 있습니다.")}</p>
      </main>
    );

  return (
    <main className="cs-wrap">
      <header className="cs-head">
        <a href="/" className="cs-back">
          ‹ {t("생산 기록")}
        </a>
        <h1>{t("백신 프로그램")}</h1>
        <span className="cs-spacer" />
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <nav className="ad-tabs vx-tabs" role="tablist">
        {(
          [
            ["due", t("접종 일정")],
            ["programs", t("프로그램 {n}", { n: programs.length })],
            ["vaccines", t("백신 {n}", { n: vaccines.length })],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </nav>
      <div className="cs-body vx-body">
        {tab === "due" && <DueBoard token={session.token} />}
        {tab === "programs" && (
          <>
            <button type="button" className="btn-primary vx-new" onClick={() => setEditProgram("new")}>
              {t("새 프로그램")}
            </button>
            <ul className="vx-list">
              {programs.map((p) => (
                <li key={p.id} className={p.active ? "" : "is-off"}>
                  <div>
                    <strong>{p.label}</strong>
                    <span className="cs-muted">
                      {t("접종 {n}회", { n: p.item_count })} · {t("계군 {n}개 적용", { n: p.flocks })}
                      {p.active ? "" : ` · ${t("사용 안 함")}`}
                    </span>
                    {p.description && <span className="cs-muted">{p.description}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setEditProgram(await vaccinesApi.program(session.token, p.id));
                    }}
                  >
                    {t("일정 보기·고치기")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {tab === "vaccines" && (
          <>
            <button type="button" className="btn-primary vx-new" onClick={() => setEditVaccine("new")}>
              {t("백신 등록")}
            </button>
            <ul className="vx-list">
              {vaccines.map((v) => (
                <li key={v.id} className={v.active ? "" : "is-off"}>
                  <div>
                    <strong>{v.name}</strong>
                    <span className="cs-muted">
                      {label(KINDS, v.kind)} · {label(ROUTES, v.route)}
                      {v.maker ? ` · ${v.maker}` : ""}
                    </span>
                    <span>{diseasesText(v.components)}</span>
                  </div>
                  <button type="button" onClick={() => setEditVaccine(v)}>
                    {t("고치기")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {editProgram && (
        <ProgramEditor
          token={session.token}
          program={editProgram === "new" ? null : editProgram}
          vaccines={vaccines.filter((v) => v.active)}
          onClose={() => setEditProgram(null)}
          onSaved={(_, m) => {
            setEditProgram(null);
            flash(m);
            reload();
          }}
        />
      )}
      {editVaccine && (
        <VaccineEditor
          token={session.token}
          vaccine={editVaccine === "new" ? null : editVaccine}
          onClose={() => setEditVaccine(null)}
          onSaved={(m) => {
            setEditVaccine(null);
            flash(m);
            reload();
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
