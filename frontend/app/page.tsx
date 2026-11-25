"use client";

import { useCallback, useEffect, useState } from "react";
import Home from "@/components/Home";
import HouseEntry from "@/components/HouseEntry";
import Login from "@/components/Login";
import { api, ApiError, loadSession, saveSession } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { enqueue, flush, isNetworkError, pending } from "@/lib/queue";
import type { DayView, HouseView, Session, Warning } from "@/lib/types";

type Sheet = { houseName: string; warnings: Warning[]; nextId: number | null };

export default function Page() {
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
      setError(isNetworkError(e) ? "연결이 안 됩니다. 전파가 닿는 곳에서 다시 불러와 주세요." : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, farmId, date]);

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
      if (rejected.length) showToast(`${rejected[0].item.houseName} 저장이 거부됐습니다: ${rejected[0].message}`);
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
        setSheet({ houseName: hv.house.name, warnings: updated.warnings, nextId });
      } else {
        showToast(`${hv.house.name} 저장했습니다`);
        proceed(nextId);
      }
    } catch (e) {
      if (isNetworkError(e) || (e instanceof ApiError && e.status >= 500)) {
        enqueue({ farmId: day.farm.id, houseId, houseName: hv.house.name, date: day.date, body, queuedAt: Date.now() });
        const q = new Set(queued).add(houseId);
        setQueued(q);
        setPendingCount(pending().length);
        showToast(`${hv.house.name} 입력을 휴대폰에 보관했습니다. 연결되면 보냅니다.`);
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
        onLogin={(s) => {
          saveSession(s);
          setSession(s);
          setFarmId(s.farms[0]?.id ?? null);
        }}
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
          onLogout={() => {
            saveSession(null);
            setSession(null);
            setDay(null);
          }}
        />
      )}

      {sheet && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div className="sheet">
            <h2 id="sheet-title">{sheet.houseName} 저장했습니다. 확인할 것이 있습니다.</h2>
            <ul>
              {sheet.warnings.map((w) => (
                <li key={w.code} className={`warn warn-${w.level}`}>
                  {w.message}
                </li>
              ))}
            </ul>
            <p className="muted">반석에도 같은 내용이 전달됩니다.</p>
            <div className="sheet-actions">
              <button type="button" className="btn-ghost" onClick={() => setSheet(null)}>
                다시 고치기
              </button>
              <button type="button" className="btn-primary" onClick={() => proceed(sheet.nextId)}>
                {sheet.nextId !== null ? "확인, 다음 동" : "확인"}
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
