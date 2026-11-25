"use client";

import { useCallback, useEffect, useState } from "react";
import Home from "@/components/Home";
import HouseEntry from "@/components/HouseEntry";
import Login from "@/components/Login";
import SetPin from "@/components/SetPin";
import { useLang, useT } from "@/lib/i18n";
import { api, ApiError, loadSession, saveSession } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { enqueue, flush, isNetworkError, pending } from "@/lib/queue";
import type { DayView, HouseView, Session, Warning } from "@/lib/types";

type Sheet = { houseName: string; houseId: number; dead: number | null; warnings: Warning[]; nextId: number | null };

export default function Page() {
  const t = useT();
  const lang = useLang();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [farmId, setFarmId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [day, setDay] = useState<DayView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState<Set<number>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [tab, setTab] = useState<"input" | "status" | "cases">("input");
  const [tempPin, setTempPin] = useState<string | null>(null);

  const signOut = useCallback((s: Session | null) => {
    if (s) api.logout(s.token).catch(() => {});
    saveSession(null);
    setSession(null);
    setDay(null);
    setTempPin(null);
  }, []);

  // 시작: 저장된 로그인 불러오기
  useEffect(() => {
    const s = loadSession();
    setSession(s);
    if (s?.farms.length) setFarmId(s.farms[0].id);
    setPendingCount(pending().length);
    setReady(true);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const refreshQueued = useCallback(() => {
    const items = pending();
    setPendingCount(items.length);
    setQueued(new Set(items.filter((q) => q.date === date && q.farmId === farmId).map((q) => q.houseId)));
  }, [date, farmId]);

  const load = useCallback(async () => {
    if (!session || farmId === null) return;
    setLoading(true);
    setError(null);
    try {
      setDay(await api.day(session.token, farmId, date));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        saveSession(null);
        setSession(null);
        return;
      }
      if (e instanceof ApiError && e.code === "pin_change_required" && session) {
        setSession({ ...session, user: { ...session.user, must_change_pin: true } });
        return;
      }
      setError(isNetworkError(e) ? t("연결이 안 됩니다. 전파가 닿는 곳에서 다시 불러와 주세요.") : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, farmId, date, lang]);

  useEffect(() => {
    load();
    refreshQueued();
  }, [load, refreshQueued]);

  // 연결되면 대기열 전송
  useEffect(() => {
    if (!session) return;
    const run = async () => {
      if (pending().length === 0) return;
      const { left, rejected } = await flush(session.token);
      if (rejected.length) showToast(t("{house} 저장이 거부됐습니다: {msg}", { house: rejected[0].item.houseName, msg: rejected[0].message }));
      refreshQueued();
      if (left === 0) load();
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [session, load, refreshQueued]);

  // 휴대폰 뒤로가기 → 동 목록
  useEffect(() => {
    const onPop = () => setHouseId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = (id: number) => {
    if (houseId === null) window.history.pushState({ house: id }, "");
    setHouseId(id);
    window.scrollTo(0, 0);
  };
  const close = () => {
    if (window.history.state?.house) window.history.back();
    else setHouseId(null);
  };

  const nextTodo = (afterId: number, d: DayView, q: Set<number>): number | null => {
    const hs = d.houses;
    const i = hs.findIndex((h) => h.house.id === afterId);
    for (let k = 1; k <= hs.length; k++) {
      const h = hs[(i + k) % hs.length];
      if (!h.record && !q.has(h.house.id) && h.house.id !== afterId) return h.house.id;
    }
    return null;
  };

  const proceed = (nextId: number | null) => {
    setSheet(null);
    if (nextId !== null) open(nextId);
    else close();
  };

  const save = async (body: Record<string, number | string | null>) => {
    if (!session || !day || houseId === null) return;
    const hv = day.houses.find((h) => h.house.id === houseId)!;
    setSaving(true);
    try {
      const updated: HouseView = await api.saveDaily(session.token, day.farm.id, houseId, day.date, body);
      const nd: DayView = {
        ...day,
        houses: day.houses.map((h) => (h.house.id === houseId ? updated : h)),
      };
      setDay(nd);
      const nextId = nextTodo(houseId, nd, queued);
      if (updated.warnings.length) {
        setSheet({ houseName: hv.house.name, houseId: hv.house.id, dead: typeof updated.record?.mortality === "number" ? updated.record.mortality : null, warnings: updated.warnings, nextId });
      } else {
        showToast(t("{house} 저장했습니다", { house: hv.house.name }));
        proceed(nextId);
      }
    } catch (e) {
      if (isNetworkError(e) || (e instanceof ApiError && e.status >= 500)) {
        enqueue({ farmId: day.farm.id, houseId, houseName: hv.house.name, date: day.date, body, queuedAt: Date.now() });
        const q = new Set(queued).add(houseId);
        setQueued(q);
        setPendingCount(pending().length);
        showToast(t("{house} 입력을 휴대폰에 보관했습니다. 연결되면 보냅니다.", { house: hv.house.name }));
        proceed(nextTodo(houseId, day, q));
      } else {
        showToast((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return null;
  if (!session)
    return (
      <Login
        onLogin={(s, pin) => {
          saveSession(s);
          setSession(s);
          setTempPin(s.user.must_change_pin ? pin : null);
          setFarmId(s.farms[0]?.id ?? null);
        }}
      />
    );
  if (session.user.must_change_pin)
    return (
      <SetPin
        session={session}
        tempPin={tempPin}
        onDone={(s) => {
          saveSession(s);
          setSession(s);
          setTempPin(null);
          setFarmId(s.farms[0]?.id ?? null);
          showToast(t("비밀번호를 정했습니다"));
        }}
        onCancel={() => signOut(session)}
      />
    );

  const houseIdx = day?.houses.findIndex((h) => h.house.id === houseId) ?? -1;
  const current = houseIdx >= 0 && day ? day.houses[houseIdx] : null;

  return (
    <main>
      {current && day ? (
        <HouseEntry
          key={`${current.house.id}-${day.date}`}
          view={current}
          config={day.config}
          position={{ index: houseIdx, total: day.houses.length }}
          saving={saving}
          onBack={close}
          onSave={save}
        />
      ) : (
        <Home
          tab={tab}
          onTab={setTab}
          token={session.token}
          isBansuk={["bansuk_vet", "bansuk_staff", "admin"].includes(session.user.role)}
          day={day}
          date={date}
          farms={session.farms}
          farmId={farmId ?? 0}
          queued={queued}
          pendingCount={pendingCount}
          loading={loading}
          error={error}
          onDate={setDate}
          onFarm={setFarmId}
          onOpen={open}
          onRetry={load}
          isAdmin={session.user.role === "admin"}
          onLogout={() => signOut(session)}
        />
      )}

      {sheet && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div className="sheet">
            <h2 id="sheet-title">{t("{house} 저장했습니다. 확인할 것이 있습니다.", { house: sheet.houseName })}</h2>
            <ul>
              {sheet.warnings.map((w) => (
                <li key={w.code} className={`warn warn-${w.level}`}>
                  {w.message}
                </li>
              ))}
            </ul>
            {sheet.warnings.some((w) => w.code === "mortality_spike") && (
              <a
                className="btn-report"
                href={`/cases/?new=1&farm=${farmId}&house=${sheet.houseId}${sheet.dead !== null ? `&dead=${sheet.dead}` : ""}`}
              >
                {t("반석에 폐사 신고")}
                <small>{t("부검이 필요한지 반석이 확인하고 일정을 잡아 드립니다.")}</small>
              </a>
            )}
            <div className="sheet-actions">
              <button type="button" className="btn-ghost" onClick={() => setSheet(null)}>
                {t("다시 고치기")}
              </button>
              <button type="button" className="btn-primary" onClick={() => proceed(sheet.nextId)}>
                {sheet.nextId !== null ? t("확인, 다음 동") : t("확인")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
