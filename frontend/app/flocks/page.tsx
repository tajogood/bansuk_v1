"use client";

import { useCallback, useEffect, useState } from "react";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { flocksApi, loadSession } from "@/lib/api";
import { dateLabel, num } from "@/lib/format";
import { k, tr, useLang, useT } from "@/lib/i18n";
import type { FlockBoard, ManagedFlock, Session } from "@/lib/types";
import "../cases.css";
import "../flocks.css";

type Sheet =
  | { kind: "place"; houseId: number }
  | { kind: "move"; flock: ManagedFlock }
  | { kind: "close"; flock: ManagedFlock }
  | { kind: "edit"; flock: ManagedFlock };

const BREEDS = [k("갈색"), k("백색")];
const REASONS: Record<string, string> = { shipped: k("출하"), culled: k("도태"), other: k("기타") };

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function ageText(days: number) {
  return tr("{w}주령 ({d}일령)", { w: Math.floor(days / 7), d: days });
}

function FlockSheet({ sheet, board, token, farmId, onDone, onClose }: { sheet: Sheet; board: FlockBoard; token: string; farmId: number; onDone: (msg: string) => void; onClose: () => void }) {
  const t = useT();
  const f = sheet.kind === "place" ? null : sheet.flock;
  const [date, setDate] = useState(sheet.kind === "edit" ? f!.placed_on : todayLocal());
  const [count, setCount] = useState(
    sheet.kind === "move" ? String(f!.bird_count ?? f!.placed_count) : sheet.kind === "edit" ? String(f!.placed_count) : "",
  );
  const [breed, setBreed] = useState(f?.breed ?? "");
  const [hatchery, setHatchery] = useState(f?.hatchery ?? "");
  const [name, setName] = useState(f?.name ?? "");
  const empty = board.houses.filter((h) => !h.flock && h.id !== f?.current_house?.id);
  const [toHouse, setToHouse] = useState<number | "">(empty.find((h) => h.kind === "laying")?.id ?? empty[0]?.id ?? "");
  const [reason, setReason] = useState("shipped");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const house = sheet.kind === "place" ? board.houses.find((h) => h.id === sheet.houseId) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const n = count ? Number(count) : null;
      let r;
      if (sheet.kind === "place") {
        r = await flocksApi.place(token, farmId, { house_id: sheet.houseId, placed_on: date, placed_count: n ?? 0, breed: breed || null, hatchery: hatchery || null, name: name || null });
        onDone(r.linked_records ? t("입추를 등록했습니다. 기존 기록 {n}건을 이 계군에 연결했습니다.", { n: r.linked_records }) : t("입추를 등록했습니다"));
      } else if (sheet.kind === "move") {
        r = await flocksApi.move(token, f!.id, { to_house_id: Number(toHouse), date, count: n });
        onDone(t("계사를 옮겼습니다"));
      } else if (sheet.kind === "close") {
        r = await flocksApi.close(token, f!.id, { date, reason, note: note || null });
        onDone(t("계군을 종료했습니다"));
      } else {
        r = await flocksApi.edit(token, f!.id, { placed_on: date, placed_count: n ?? undefined, breed, hatchery, name });
        onDone(t("계군 정보를 고쳤습니다"));
      }
      void r;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    sheet.kind === "place"
      ? t("{house} 입추 등록", { house: house?.name ?? "" })
      : sheet.kind === "move"
        ? t("계사 이동")
        : sheet.kind === "close"
          ? t("출하·종료")
          : t("계군 정보 고치기");

  return (
    <div className="fl-sheet-bg" onClick={onClose}>
      <form className="fl-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title}</h2>
        {f && sheet.kind !== "edit" && (
          <p className="cs-muted">
            {t("{d} 입추", { d: f.placed_on })} · {f.current_house?.name} · {ageText(f.age_days)}
          </p>
        )}

        {sheet.kind === "move" && (
          <label>
            {t("옮길 계사")}
            {empty.length ? (
              <select value={toHouse} onChange={(e) => setToHouse(Number(e.target.value))}>
                {empty.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.kind === "rearing" ? t("육성") : t("산란")})
                  </option>
                ))}
              </select>
            ) : (
              <span className="warn">{t("비어 있는 계사가 없습니다.")}</span>
            )}
          </label>
        )}

        <label>
          {sheet.kind === "place" || sheet.kind === "edit" ? t("입추일") : sheet.kind === "move" ? t("새 계사에 들어간 날") : t("마지막 날 (출하·도태한 날)")}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        {(sheet.kind === "place" || sheet.kind === "edit" || sheet.kind === "move") && (
          <label>
            {sheet.kind === "move" ? t("옮긴 수수") : t("입추 수수")}
            <input className="cs-big" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} required={sheet.kind !== "move"} placeholder="0" />
            {sheet.kind === "move" && <small className="cs-muted">{t("비워 두면 마지막 기록의 수수를 씁니다.")}</small>}
          </label>
        )}

        {(sheet.kind === "place" || sheet.kind === "edit") && (
          <>
            <fieldset>
              <legend>{t("품종")}</legend>
              <div className="cs-chips">
                {BREEDS.map((b) => (
                  <button key={b} type="button" aria-pressed={breed === b} onClick={() => setBreed(breed === b ? "" : b)}>
                    {t(b)}
                  </button>
                ))}
              </div>
              <input placeholder={t("직접 입력 (예: Hy-Line Brown)")} value={BREEDS.includes(breed) ? "" : breed} onChange={(e) => setBreed(e.target.value)} />
            </fieldset>
            <label>
              {t("부화장 (선택)")}
              <input value={hatchery} onChange={(e) => setHatchery(e.target.value)} />
            </label>
            <label>
              {t("계군 이름 (선택)")}
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("비워 두면 입추일로 부릅니다")} />
            </label>
          </>
        )}

        {sheet.kind === "close" && (
          <>
            <fieldset>
              <legend>{t("종료 이유")}</legend>
              <div className="cs-chips">
                {Object.entries(REASONS).map(([k, v]) => (
                  <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}>
                    {t(v)}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              {t("메모 (선택)")}
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="cs-muted">{t("종료하면 이 계사가 비어 다음 입추를 받을 수 있습니다. 잘못 눌렀으면 '종료 취소'로 되돌릴 수 있습니다.")}</p>
          </>
        )}

        {error && <p className="warn warn-error">{error}</p>}
        <div className="cs-actions">
          <button type="button" onClick={onClose}>
            {t("취소")}
          </button>
          <button type="submit" className="cs-primary" disabled={busy || (sheet.kind === "move" && !toHouse)}>
            {busy ? t("저장 중") : t("저장")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function FlocksPage() {
  const t = useT();
  const lang = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [farmId, setFarmId] = useState<number | null>(null);
  const [board, setBoard] = useState<FlockBoard | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    const q = Number(new URLSearchParams(window.location.search).get("farm"));
    setFarmId(q || s?.farms[0]?.id || null);
    setReady(true);
  }, []);

  const load = useCallback(() => {
    if (!session || !farmId) return;
    flocksApi
      .board(session.token, farmId)
      .then(setBoard)
      .catch((e) => setError(e.message));
  }, [session, farmId]);
  useEffect(() => load(), [load, lang]);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2600);
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      flash(msg);
      load();
    } catch (e) {
      setError((e as Error).message);
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
        <h1>{t("계군 관리")}</h1>
        <span className="cs-spacer" />
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <div className="cs-body fl-body">
        {session.farms.length > 1 && (
          <select className="fl-farm" value={farmId ?? ""} onChange={(e) => setFarmId(Number(e.target.value))} aria-label={t("농장 선택")}>
            {session.farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        {error && (
          <p className="warn warn-error" onClick={() => setError(null)}>
            {error}
          </p>
        )}
        {!board ? (
          <p className="cs-muted">{t("불러오는 중")}</p>
        ) : (
          <>
            {board.unlinked_records > 0 && (
              <p className="warn">{t("계군에 연결되지 않은 기록이 {n}건 있습니다. 그 계사에 입추를 등록하면 자동으로 연결됩니다.", { n: board.unlinked_records })}</p>
            )}
            <section>
              <h2 className="fl-title">{t("계사별 지금 계군")}</h2>
              <ul className="fl-houses">
                {board.houses.map((h) => (
                  <li key={h.id} className={h.flock ? "" : "is-empty"}>
                    <div className="fl-house-head">
                      <strong>{h.name}</strong>
                      <span className="fl-kind">{h.kind === "rearing" ? t("육성") : t("산란")}</span>
                    </div>
                    {h.flock ? (
                      <>
                        <div className="fl-flock">
                          <span className="fl-age">{ageText(h.flock.age_days)}</span>
                          <span>
                            {h.flock.name ?? t("{d} 입추", { d: h.flock.placed_on })}
                            {h.flock.breed ? ` · ${t(h.flock.breed)}` : ""}
                          </span>
                          <span className="cs-muted">
                            {h.flock.bird_count !== null
                              ? t("현재 {n}수 ({d} 기준)", { n: num(h.flock.bird_count), d: dateLabel(h.flock.bird_count_date!) })
                              : t("입추 {n}수", { n: num(h.flock.placed_count) })}
                          </span>
                          {h.flock.program && <span className="dash-tag">{t("반석 프로그램")}</span>}
                        </div>
                        <div className="fl-actions">
                          <button type="button" onClick={() => setSheet({ kind: "move", flock: h.flock! })}>
                            {t("계사 이동")}
                          </button>
                          <button type="button" onClick={() => setSheet({ kind: "close", flock: h.flock! })}>
                            {t("출하·종료")}
                          </button>
                          <button type="button" onClick={() => setSheet({ kind: "edit", flock: h.flock! })}>
                            {t("고치기")}
                          </button>
                          <a className="fl-vx" href={`/vaccination/?flock=${h.flock.id}`}>
                            {t("백신 접종")}
                          </a>
                          {h.flock.locations.length > 1 && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => window.confirm(t("마지막 계사 이동을 되돌릴까요?")) && act(() => flocksApi.undo(session.token, h.flock!.id), t("계사 이동을 되돌렸습니다"))}
                            >
                              {t("이동 되돌리기")}
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="fl-empty">
                        <span className="cs-muted">{t("비어 있음")}</span>
                        <button type="button" className="cs-primary" onClick={() => setSheet({ kind: "place", houseId: h.id })}>
                          {t("입추 등록")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {board.closed.length > 0 && (
              <section>
                <h2 className="fl-title">{t("지난 계군")}</h2>
                <ul className="fl-closed">
                  {board.closed.map((f) => (
                    <li key={f.id}>
                      <div>
                        <strong>{f.name ?? t("{d} 입추", { d: f.placed_on })}</strong>
                        <span className="cs-muted">
                          {f.locations.map((l) => l.house).join(" → ")} · {f.placed_on} ~ {f.closed_on} · {t(REASONS[f.close_reason ?? "other"])}
                        </span>
                        <span className="cs-muted">{t("기록 {n}건", { n: f.records })}</span>
                      </div>
                      <div className="fl-closed-actions">
                        <a className="link-btn" href={`/report/?farm=${farmId}&flock=${f.id}`}>
                          {t("보고서")}
                        </a>
                        <a className="link-btn" href={`/vaccination/?flock=${f.id}`}>
                          {t("백신 접종")}
                        </a>
                        <button type="button" className="link-btn" onClick={() => act(() => flocksApi.undo(session.token, f.id), t("종료를 취소했습니다"))}>
                          {t("종료 취소")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {board.active.length > 0 && (
              <details className="fl-danger">
                <summary>{t("잘못 등록한 계군 지우기")}</summary>
                <p className="cs-muted">{t("일일 기록은 지워지지 않고 계군 연결만 끊깁니다.")}</p>
                {board.active.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="link-btn cs-danger"
                    onClick={() => window.confirm(t("이 계군을 지울까요?")) && act(() => flocksApi.remove(session.token, f.id), t("계군을 지웠습니다"))}
                  >
                    {f.current_house?.name} · {t("{d} 입추", { d: f.placed_on })}
                  </button>
                ))}
              </details>
            )}
          </>
        )}
      </div>
      {sheet && board && farmId && (
        <FlockSheet
          sheet={sheet}
          board={board}
          token={session.token}
          farmId={farmId}
          onClose={() => setSheet(null)}
          onDone={(m) => {
            setSheet(null);
            flash(m);
            load();
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
