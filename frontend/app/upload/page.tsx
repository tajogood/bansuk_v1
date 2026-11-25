"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { importsApi, loadSession } from "@/lib/api";
import { fmtDateTime } from "@/lib/cases";
import { k, tr, useLang, useT } from "@/lib/i18n";
import type { ImportBatchItem, Session } from "@/lib/types";
import "../cases.css";
import "../upload.css";

function warningText(w: { code: string } & Record<string, string | number>): string {
  switch (w.code) {
    case "unknown_houses":
      return tr("농장에 없는 계사 이름이라 건너뜁니다: {houses} ({rows}행). 계사 이름이 다르게 적혀 있으면 반석에 알려 주세요.", { houses: w.houses, rows: w.rows });
    case "skip_manual":
      return tr("앱에서 직접 입력한 {n}일은 그대로 둡니다. 엑셀 값으로 바꾸려면 '직접 입력한 날도 덮어쓰기'를 켜고 다시 올리세요.", { n: w.n });
    case "no_flock":
      return tr("계군이 등록되지 않은 날이 {n}건 있습니다. 기록은 들어가지만, 일령과 비교에 쓰려면 계군 관리에서 입추를 등록하세요.", { n: w.n });
    case "future":
      return tr("오늘 이후 날짜 {n}건은 건너뜁니다.", { n: w.n });
    case "missing_months":
      return tr("파일에 없는 달: {months}", { months: w.months });
    case "skipped_sheets":
      return tr("연월을 알 수 없어 건너뛴 시트: {sheets}", { sheets: w.sheets });
    case "duplicate_sheets":
      return tr("같은 달이 이미 있어 건너뛴 시트: {sheets}", { sheets: w.sheets });
    case "lay_over_100":
      return tr("산란율이 100%를 넘는 날이 {n}건 있습니다 (집란 시간 차이로 보이며 그대로 넣습니다).", { n: w.n });
    default:
      return w.code;
  }
}

const STATUS: Record<string, string> = {
  preview: k("미리보기"),
  applied: k("반영됨"),
  reverted: k("되돌림"),
  discarded: k("취소"),
};

function Preview({ b, busy, onApply, onDiscard }: { b: ImportBatchItem; busy: boolean; onApply: () => void; onDiscard: () => void }) {
  const t = useT();
  const s = b.summary;
  const tot = s.totals!;
  return (
    <section className="cs-box up-preview">
      <h2>{t("반영하기 전에 확인해 주세요")}</h2>
      <p className="cs-muted">
        {b.filename}
        {s.period ? ` · ${s.period[0]} ~ ${s.period[1]}` : ""}
      </p>
      <div className="up-totals">
        <div className="is-main">
          <strong>{tot.new.toLocaleString()}</strong>
          <span>{t("새로 들어갈 날")}</span>
        </div>
        <div className={tot.overwrite ? "is-main" : ""}>
          <strong>{tot.overwrite.toLocaleString()}</strong>
          <span>{t("엑셀 값으로 고칠 날")}</span>
        </div>
        <div>
          <strong>{tot.unchanged.toLocaleString()}</strong>
          <span>{t("이미 같아서 그대로")}</span>
        </div>
        <div>
          <strong>{tot.skip_manual.toLocaleString()}</strong>
          <span>{t("직접 입력이라 그대로")}</span>
        </div>
      </div>
      {s.houses && s.houses.length > 0 && (
        <table className="cs-table up-houses">
          <thead>
            <tr>
              <th>{t("계사")}</th>
              <th>{t("기간")}</th>
              <th className="num">{t("새로")}</th>
              <th className="num">{t("고침")}</th>
            </tr>
          </thead>
          <tbody>
            {s.houses.map((h) => (
              <tr key={h.house}>
                <th>{h.house}</th>
                <td className="cs-muted">
                  {h.first} ~ {h.last}
                </td>
                <td className="num">{h.new.toLocaleString()}</td>
                <td className="num">{h.overwrite.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.warnings && s.warnings.length > 0 && (
        <ul className="up-warnings">
          {s.warnings.map((w, i) => (
            <li key={i}>{warningText(w)}</li>
          ))}
        </ul>
      )}
      <div className="cs-actions">
        <button type="button" onClick={onDiscard} disabled={busy}>
          {t("취소")}
        </button>
        <button type="button" className="cs-primary" onClick={onApply} disabled={busy || tot.new + tot.overwrite === 0}>
          {busy ? t("반영하는 중") : t("{n}일 반영하기", { n: (tot.new + tot.overwrite).toLocaleString() })}
        </button>
      </div>
    </section>
  );
}

export default function UploadPage() {
  const t = useT();
  const lang = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [farmId, setFarmId] = useState<number | null>(null);
  const [importer, setImporter] = useState<{ code: string; label: string } | null | undefined>(undefined);
  const [batches, setBatches] = useState<ImportBatchItem[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<ImportBatchItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    const q = Number(new URLSearchParams(window.location.search).get("farm"));
    setFarmId(q || s?.farms[0]?.id || null);
    setReady(true);
  }, []);

  const load = useCallback(() => {
    if (!session || !farmId) return;
    importsApi
      .list(session.token, farmId)
      .then((r) => {
        setImporter(r.importer);
        setBatches(r.batches);
        setPreview(r.batches.find((b) => b.status === "preview") ?? null);
      })
      .catch((e) => setError(e.message));
  }, [session, farmId]);
  useEffect(() => load(), [load, lang]);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  };

  const pick = async (file: File | undefined) => {
    if (!file || !session || !farmId) return;
    setError(null);
    setBusy(t("파일을 읽는 중입니다. 큰 파일은 1분쯤 걸릴 수 있습니다."));
    try {
      const b = await importsApi.upload(session.token, farmId, file, overwrite);
      setPreview(b);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const run = async (fn: () => Promise<ImportBatchItem>, msg: (b: ImportBatchItem) => string) => {
    if (!session) return;
    setBusy(t("처리 중"));
    setError(null);
    try {
      const b = await fn();
      flash(msg(b));
      setPreview(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!ready) return null;
  if (!session)
    return (
      <main className="cs-wrap">
        <p className="cs-pad">
          {t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a>
        </p>
      </main>
    );

  return (
    <main className="cs-wrap">
      <header className="cs-head">
        <a href="/" className="cs-back">
          ‹ {t("생산 기록")}
        </a>
        <h1>{t("엑셀 업로드")}</h1>
        <span className="cs-spacer" />
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <div className="cs-body up-body">
        {session.farms.length > 1 && (
          <select className="fl-farm up-farm" value={farmId ?? ""} onChange={(e) => setFarmId(Number(e.target.value))} aria-label={t("농장 선택")}>
            {session.farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        {error && <p className="warn warn-error">{error}</p>}
        {importer === undefined ? (
          <p className="cs-muted">{t("불러오는 중")}</p>
        ) : importer === null ? (
          <section className="cs-box">
            <h2>{t("아직 이 농장의 엑셀 양식이 등록되지 않았습니다")}</h2>
            <p>{t("농장마다 엑셀 모양이 달라서, 처음 한 번은 반석에서 이 농장 양식을 읽도록 맞춰야 합니다. 쓰시는 엑셀 파일을 반석에 보내 주세요. 그 전까지는 앱에서 매일 직접 입력할 수 있습니다.")}</p>
          </section>
        ) : (
          <>
            {!preview && (
              <section className="cs-box up-pick">
                <h2>{t("농장 엑셀 파일 올리기")}</h2>
                <p className="cs-muted">{t("양식: {label}", { label: importer.label })}</p>
                <p>{t("평소 쓰시는 엑셀 파일을 그대로 올리세요. 필요한 값(수수, 폐사, 규격별 산란, 사료, 급수, 온습도 등)만 읽어서 넣고, 반영하기 전에 미리 보여 드립니다.")}</p>
                <label className="up-overwrite">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  <span>
                    {t("앱에서 직접 입력한 날도 엑셀 값으로 덮어쓰기")}
                    <small>{t("끄면 직접 입력한 날은 그대로 둡니다.")}</small>
                  </span>
                </label>
                <button type="button" className="btn-primary" onClick={() => input.current?.click()} disabled={!!busy}>
                  {busy ?? t("엑셀 파일 고르기")}
                </button>
                <input ref={input} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => pick(e.target.files?.[0])} />
              </section>
            )}
            {preview && (
              <Preview
                b={preview}
                busy={!!busy}
                onDiscard={() => run(() => importsApi.discard(session.token, preview.id), () => t("업로드를 취소했습니다"))}
                onApply={() =>
                  run(
                    () => importsApi.apply(session.token, preview.id),
                    (b) => t("반영했습니다: 새로 {a}일, 고침 {b}일", { a: b.summary.applied?.new ?? 0, b: b.summary.applied?.overwrite ?? 0 }),
                  )
                }
              />
            )}
            <details className="up-rules">
              <summary>{t("업로드 규칙")}</summary>
              <ul>
                <li>{t("같은 날짜·계사에 이미 기록이 있으면: 앱에서 직접 입력한 날은 그대로 두고, 예전에 엑셀로 들어온 날은 새 파일 값으로 고칩니다.")}</li>
                <li>{t("엑셀 칸이 비어 있으면 기존 값을 지우지 않습니다.")}</li>
                <li>{t("산란율 같은 계산값은 넣지 않고 원래 숫자만 넣습니다.")}</li>
                <li>{t("농장에 없는 계사 이름은 건너뜁니다. 계사는 자동으로 만들지 않습니다.")}</li>
                <li>{t("계군은 엑셀에서 만들지 않습니다. 계군 관리에 등록한 계군에 자동으로 붙습니다.")}</li>
                <li>{t("반영한 업로드는 되돌릴 수 있습니다. 반영 뒤에 직접 고친 날은 되돌리지 않습니다.")}</li>
                <li>{t("올린 원본 파일은 보관되어 나중에 다시 받을 수 있습니다.")}</li>
              </ul>
            </details>
          </>
        )}

        {batches.filter((b) => b.status !== "preview").length > 0 && (
          <section>
            <h2 className="fl-title">{t("업로드 기록")}</h2>
            <ul className="up-history">
              {batches
                .filter((b) => b.status !== "preview")
                .map((b) => (
                  <li key={b.id}>
                    <div>
                      <strong>{b.filename}</strong>
                      <span className="cs-muted">
                        {fmtDateTime(b.uploaded_at, false)} · {b.uploaded_by}
                        {b.summary.period ? ` · ${b.summary.period[0]} ~ ${b.summary.period[1]}` : ""}
                      </span>
                      {b.status === "applied" && b.summary.applied && (
                        <span className="cs-muted">{t("새로 {a}일, 고침 {b}일", { a: b.summary.applied.new, b: b.summary.applied.overwrite })}</span>
                      )}
                      {b.status === "reverted" && b.summary.reverted && (
                        <span className="cs-muted">
                          {t("{n}일 되돌림", { n: b.summary.reverted.restored })}
                          {b.summary.reverted.kept ? ` · ${t("직접 고친 {n}일은 그대로 둠", { n: b.summary.reverted.kept })}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="up-history-actions">
                      <span className={`cs-badge up-${b.status}`}>{t(STATUS[b.status])}</span>
                      <button type="button" className="link-btn" onClick={() => importsApi.download(session.token, b).catch((e) => setError(e.message))}>
                        {t("원본 받기")}
                      </button>
                      {b.status === "applied" && (
                        <button
                          type="button"
                          className="link-btn cs-danger"
                          onClick={() =>
                            window.confirm(t("이 업로드로 들어온 기록을 되돌릴까요?")) &&
                            run(() => importsApi.revert(session.token, b.id), () => t("업로드를 되돌렸습니다"))
                          }
                        >
                          {t("되돌리기")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
