"use client";

import { useCallback, useEffect, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import PhotoLabeler, { organColor } from "@/components/PhotoLabeler";
import { labelingApi, loadSession } from "@/lib/api";
import { DISEASES, ORGANS, label } from "@/lib/cases";
import { k, tr, useLang, useT } from "@/lib/i18n";
import type { LabelPhoto, LabelPhotoBrief, LabelSummary, Session } from "@/lib/types";
import "../cases.css";
import "../lab.css";
import "../photos.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);
const TABS = [
  { code: "todo", label: k("할 일") },
  { code: "suggested", label: k("자동 표시 확인") },
  { code: "done", label: k("완료") },
  { code: "skip", label: k("건너뜀") },
];
const BATCH = 30;

function Summary({ s, session, onReload }: { s: LabelSummary; session: Session; onReload: () => void }) {
  const t = useT();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [farmId, setFarmId] = useState<number | "">("");
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const used = s.organs.filter((o) => o.count > 0);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list);
    setError(null);
    setMsg(null);
    let saved = 0, dup = 0;
    const failed: string[] = [];
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        setProgress(tr("올리는 중 {a}/{b}", { a: Math.min(i + BATCH, files.length), b: files.length }));
        const r = await labelingApi.upload(session.token, files.slice(i, i + BATCH), farmId || null);
        saved += r.saved;
        dup += r.duplicates;
        failed.push(...r.failed.map((f) => f.name));
      }
      setMsg(
        [tr("{n}장 올렸습니다.", { n: saved }), dup ? tr("이미 있는 사진 {n}장은 건너뛰었습니다.", { n: dup }) : "", failed.length ? tr("읽지 못한 파일: {names}", { names: failed.join(", ") }) : ""]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      onReload();
    }
  };
  return (
    <section className="cs-sec ph-summary">
      <div className="ph-progress">
        <div>
          <p className="ph-big">
            {t("완료 {done} / 전체 {total}장", { done: s.done, total: s.total })}
          </p>
          <div className="ph-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("태깅 진행")}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="cs-muted">
            {[t("할 일 {n}", { n: s.todo }), s.suggested ? t("자동 표시 확인 {n}", { n: s.suggested }) : "", s.skip ? t("건너뜀 {n}", { n: s.skip }) : "", s.normal ? t("이상 없음 {n}", { n: s.normal }) : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="ph-model">
          {s.model.enabled ? (
            <>
              <p>
                <strong>{t("자동 인식 켜짐")}</strong> <span className="cs-muted">{s.model.version}</span>
              </p>
              <p className="cs-muted">{t("새로 올리는 사진에 장기가 자동으로 표시됩니다.")}</p>
              <button type="button" className="link-btn" onClick={() => labelingApi.autoPending(session.token).then((r) => { setMsg(tr("{n}장에 자동 표시를 붙이는 중입니다. 잠시 뒤 '자동 표시 확인'에서 보세요.", { n: r.queued })); setTimeout(onReload, 4000); }).catch((e) => setError(e.message))}>
                {t("태깅 안 한 사진 자동 표시")}
              </button>
            </>
          ) : (
            <>
              <p><strong>{t("자동 인식 준비 중")}</strong></p>
              <p className="cs-muted">{t("장기마다 확인된 영역이 {n}개쯤 모이면 학습해서 자동 표시를 켤 수 있습니다.", { n: s.target_per_organ })}</p>
            </>
          )}
        </div>
      </div>

      {used.length > 0 && (
        <div className="ph-organs">
          <h3>{t("장기별 확인된 영역 (학습 목표 {n})", { n: s.target_per_organ })}</h3>
          <ul>
            {used.map((o) => (
              <li key={o.organ}>
                <span className="ph-organ"><i style={{ background: organColor(o.organ) }} />{label(ORGANS, o.organ)}</span>
                <span className="ph-mini"><span style={{ width: `${Math.min(100, (o.count / s.target_per_organ) * 100)}%`, background: organColor(o.organ) }} /></span>
                <span className="ph-n">{o.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.diseases.length > 0 && (
        <p className="cs-muted">
          {t("질병")}: {s.diseases.map((d) => `${label(DISEASES, d.disease)} ${d.count}`).join(", ")}
        </p>
      )}

      <div className="ph-tools">
        <label className="lb-btn ph-file">
          {progress ?? t("지난 부검 사진 올리기")}
          <input type="file" accept="image/*" multiple disabled={!!progress} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
        {session.farms.length > 0 && (
          <select value={farmId} onChange={(e) => setFarmId(Number(e.target.value) || "")} aria-label={t("올릴 사진의 농장")}>
            <option value="">{t("농장 모름·여러 곳")}</option>
            {session.farms.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        <button type="button" className="link-btn" disabled={!s.done} onClick={() => labelingApi.exportZip(session.token).catch((e) => setError(e.message))}>
          {t("학습 데이터 받기 (완료 {n}장)", { n: s.done })}
        </button>
      </div>
      <p className="cs-muted lb-note">{t("여러 장을 한꺼번에 고를 수 있습니다. 같은 사진은 두 번 올라가지 않습니다. 부검 건에서 올린 사진은 자동으로 여기에 들어옵니다.")}</p>
      {msg && <p className="warn">{msg}</p>}
      {error && <p className="warn warn-error">{error}</p>}
    </section>
  );
}

function Queue({ session }: { session: Session }) {
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("q")) || "todo");
  const [summary, setSummary] = useState<LabelSummary | null>(null);
  const [items, setItems] = useState<LabelPhotoBrief[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    labelingApi.summary(session.token).then(setSummary).catch((e) => setError(e.message));
    labelingApi
      .list(session.token, tab)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
  }, [session, tab]);
  useEffect(() => load(), [load, lang]);
  return (
    <div className="cs-body ph-body">
      {summary && <Summary s={summary} session={session} onReload={load} />}
      {error && <p className="warn warn-error">{error}</p>}
      <div className="lb-chips" role="tablist" aria-label={t("사진 목록")}>
        {TABS.map((x) => (
          <button key={x.code} type="button" role="tab" aria-selected={tab === x.code} aria-pressed={tab === x.code} onClick={() => { setTab(x.code); setItems(null); }}>
            {t(x.label)}
            {summary && <span className="ph-count">{x.code === "suggested" ? summary.suggested : (summary as unknown as Record<string, number>)[x.code]}</span>}
          </button>
        ))}
      </div>
      {items === null ? (
        <p className="cs-muted">{t("불러오는 중")}</p>
      ) : items.length === 0 ? (
        <p className="cs-muted ph-empty">
          {tab === "todo" ? t("태깅할 사진이 없습니다. 지난 부검 사진을 올리거나, 부검 건에서 사진을 올리면 여기에 쌓입니다.") : t("없음")}
        </p>
      ) : (
        <>
          {tab !== "done" && tab !== "skip" && (
            <a className="cs-primary lb-btn ph-start" href={`/photos/?id=${items[0].id}&q=${tab}`}>
              {t("첫 사진부터 태깅 시작")}
            </a>
          )}
          <ul className="ph-grid">
            {items.map((p) => (
              <li key={p.id}>
                <a href={`/photos/?id=${p.id}&q=${tab}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" loading="lazy" />
                  <span className="ph-meta">
                    {p.suggested > 0 && <b className="ph-auto">{t("자동 {n}", { n: p.suggested })}</b>}
                    {p.regions > 0 && <b>{t("장기 {n}", { n: p.regions })}</b>}
                    {p.normal && <b>{t("이상 없음")}</b>}
                    {p.diseases.slice(0, 1).map((d) => <b key={d} className="ph-dis">{label(DISEASES, d)}</b>)}
                  </span>
                  <small>{[p.farm, p.date].filter(Boolean).join(" · ")}</small>
                </a>
              </li>
            ))}
          </ul>
          {total > items.length && <p className="cs-muted">{t("{a}장 중 {b}장을 보여 줍니다.", { a: total, b: items.length })}</p>}
        </>
      )}
    </div>
  );
}

function Editor({ session, id, queue }: { session: Session; id: number; queue: string }) {
  const t = useT();
  const [photo, setPhoto] = useState<LabelPhoto | null>(null);
  const [modelEnabled, setModelEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const open = useCallback(
    (pid: number) => {
      setError(null);
      labelingApi
        .get(session.token, pid, queue)
        .then((p) => {
          setPhoto(p);
          window.history.replaceState(null, "", `/photos/?id=${pid}&q=${queue}`);
          window.scrollTo({ top: 0 });
        })
        .catch((e) => setError(e.message));
    },
    [session, queue],
  );
  useEffect(() => {
    open(id);
    labelingApi.summary(session.token).then((s) => setModelEnabled(s.model.enabled)).catch(() => {});
  }, [id, open, session]);
  if (!photo) return <div className="cs-body">{error ? <p className="warn warn-error">{error}</p> : <p className="cs-muted">{t("불러오는 중")}</p>}</div>;
  return (
    <div className="cs-body ph-edit">
      <div className="ph-edit-head">
        <p className="cs-muted">
          {[photo.farm, photo.house, photo.date, photo.case ? t("부검 건 #{id}", { id: photo.case.id }) : t("지난 사진")].filter(Boolean).join(" · ")}
          {photo.status === "done" && <span className="ph-done"> · {t("완료됨")}</span>}
        </p>
        <div className="ph-nav">
          <button type="button" disabled={!photo.prev_id} onClick={() => photo.prev_id && open(photo.prev_id)}>‹ {t("이전")}</button>
          <button type="button" disabled={!photo.next_id} onClick={() => photo.next_id && open(photo.next_id)}>{t("다음")} ›</button>
        </div>
      </div>
      {saved && <p className="warn">{saved}</p>}
      {error && <p className="warn warn-error">{error}</p>}
      <PhotoLabeler
        photo={photo}
        busy={busy}
        modelEnabled={modelEnabled}
        onAuto={async () => {
          setBusy(true);
          try {
            const r = await labelingApi.auto(session.token, photo.id);
            setPhoto(r);
            setSaved(tr("자동 표시 {n}개를 붙였습니다.", { n: r.added }));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        onSave={async (b) => {
          setBusy(true);
          setError(null);
          setSaved(null);
          try {
            const next = photo.next_id;
            await labelingApi.save(session.token, photo.id, b);
            if (b.status === "todo") {
              setSaved(tr("임시 저장했습니다."));
              open(photo.id);
            } else if (next) {
              setSaved(b.status === "done" ? tr("저장했습니다. 다음 사진입니다.") : tr("건너뛰었습니다. 다음 사진입니다."));
              open(next);
            } else {
              window.location.href = `/photos/?q=${queue}`;
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export default function PhotosPage() {
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<{ id: number | null; q: string }>({ id: null, q: "todo" });
  useEffect(() => {
    setSession(loadSession());
    const q = new URLSearchParams(window.location.search);
    setMode({ id: Number(q.get("id")) || null, q: q.get("q") || "todo" });
    setReady(true);
  }, []);
  if (!ready) return null;
  if (!session)
    return <main className="cs-wrap"><p className="cs-pad">{t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a></p></main>;
  const isBansuk = BANSUK.has(session.user.role);
  return (
    <main className="cs-wrap">
      <header className="cs-head">
        <a href={mode.id ? `/photos/?q=${mode.q}` : "/"} className="cs-back">‹ {mode.id ? t("사진 목록") : t("처음 화면")}</a>
        <h1>{t("부검 사진 태깅")}</h1>
        <span className="cs-spacer" />
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      {!isBansuk ? (
        <div className="cs-body"><p className="cs-muted">{t("반석 계정만 쓸 수 있습니다")}</p></div>
      ) : mode.id ? (
        <Editor session={session} id={mode.id} queue={mode.q} />
      ) : (
        <Queue session={session} />
      )}
    </main>
  );
}
