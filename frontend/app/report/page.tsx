"use client";

import { useCallback, useEffect, useState } from "react";
import ReportView from "@/components/ReportView";
import { api, downloadCsv, loadSession } from "@/lib/api";
import type { FlockItem, FlockReport, Session } from "@/lib/types";
import "../report.css";

const BANSUK = new Set(["bansuk_vet", "bansuk_staff", "admin"]);

export default function ReportPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [farmId, setFarmId] = useState<number | null>(null);
  const [flocks, setFlocks] = useState<FlockItem[]>([]);
  const [flockId, setFlockId] = useState<number | null>(null);
  const [ageFrom, setAgeFrom] = useState("");
  const [ageTo, setAgeTo] = useState("");
  const [baseline, setBaseline] = useState("past");
  const [report, setReport] = useState<FlockReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    const q = new URLSearchParams(window.location.search);
    const no = q.get("no");
    if (s && no) {
      api.issued(s.token, no).then(setReport).catch((e) => setError(e.message));
      return;
    }
    if (s?.farms.length) setFarmId(Number(q.get("farm")) || s.farms[0].id);
    if (q.get("flock")) setFlockId(Number(q.get("flock")));
    if (q.get("from")) setAgeFrom(q.get("from")!);
    if (q.get("to")) setAgeTo(q.get("to")!);
  }, []);

  useEffect(() => {
    if (!session || farmId === null) return;
    api
      .flocks(session.token, farmId)
      .then((r) => {
        const usable = r.flocks.filter((f) => f.records > 0);
        setFlocks(usable);
        setFlockId((cur) => (cur && usable.some((f) => f.id === cur) ? cur : usable[0]?.id ?? null));
      })
      .catch((e) => setError(e.message));
  }, [session, farmId]);

  const load = useCallback(async () => {
    if (!session || flockId === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.report(session.token, flockId, {
        age_from: ageFrom ? Number(ageFrom) : undefined,
        age_to: ageTo ? Number(ageTo) : undefined,
        baseline,
      });
      setReport(r);
      if (!ageFrom && r.comparison) setAgeFrom(String(r.comparison.age_from));
      if (!ageTo && r.comparison) setAgeTo(String(r.comparison.age_to));
      const q = new URLSearchParams({ farm: String(farmId), flock: String(flockId) });
      if (ageFrom) q.set("from", ageFrom);
      if (ageTo) q.set("to", ageTo);
      window.history.replaceState(null, "", `?${q}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [session, flockId, ageFrom, ageTo, baseline, farmId]);

  useEffect(() => {
    if (flockId !== null && !report) load();
    // 처음 계군이 정해졌을 때만 자동으로 불러온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flockId]);

  const issue = async () => {
    if (!session || flockId === null) return;
    setBusy(true);
    try {
      const r = await api.issue(session.token, flockId, {
        age_from: ageFrom ? Number(ageFrom) : null,
        age_to: ageTo ? Number(ageTo) : null,
        baseline,
        reviewer_note: note || null,
      });
      setReport(r);
      setIssueOpen(false);
      window.history.replaceState(null, "", `?no=${r.meta.report_no}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session)
    return (
      <main className="rp-wrap">
        <p>
          로그인이 필요합니다. <a href="/">로그인하기</a>
        </p>
      </main>
    );

  const isBansuk = BANSUK.has(session.user.role);
  const issued = report?.meta.status === "issued";

  return (
    <main className="rp-wrap">
      <div className="rp-toolbar no-print">
        <a href="/" className="rp-back">‹ 입력 화면</a>
        {!issued && (
          <>
            {session.farms.length > 1 && (
              <label>
                농장
                <select value={farmId ?? ""} onChange={(e) => { setFarmId(Number(e.target.value)); setReport(null); }}>
                  {session.farms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              계군
              <select value={flockId ?? ""} onChange={(e) => { setFlockId(Number(e.target.value)); setAgeFrom(""); setAgeTo(""); setReport(null); }}>
                {flocks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.placed_on} 입추 · {f.houses.join("→")}{f.program ? " · 프로그램 적용" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="rp-short">
              일령 부터
              <input inputMode="numeric" value={ageFrom} onChange={(e) => setAgeFrom(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="rp-short">
              까지
              <input inputMode="numeric" value={ageTo} onChange={(e) => setAgeTo(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label>
              비교 기준
              <select value={baseline} onChange={(e) => setBaseline(e.target.value)}>
                <option value="past">먼저 입추한 계군</option>
                <option value="all">농장 전체 계군</option>
              </select>
            </label>
            <button type="button" onClick={load} disabled={busy}>다시 계산</button>
          </>
        )}
        <span className="rp-spacer" />
        {report && (
          <>
            <button type="button" onClick={() => downloadCsv(session.token, report.flock.id, `원자료_${report.flock.placed_on}.csv`)}>
              원자료 CSV
            </button>
            <button type="button" onClick={() => window.print()}>인쇄 · PDF 저장</button>
            {isBansuk && !issued && (
              <button type="button" className="rp-primary" onClick={() => setIssueOpen(true)} disabled={busy}>
                정식 발행
              </button>
            )}
          </>
        )}
      </div>

      {issueOpen && (
        <div className="rp-issue no-print">
          <p>
            발행하면 보고서 번호가 매겨지고 지금 결과가 그대로 저장됩니다. 나중에 원자료가 바뀌어도 같은 번호의 보고서 내용은 바뀌지 않습니다.
          </p>
          <textarea placeholder="검토 의견 (보고서에 함께 인쇄됩니다)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div>
            <button type="button" onClick={() => setIssueOpen(false)}>취소</button>
            <button type="button" className="rp-primary" onClick={issue} disabled={busy}>발행</button>
          </div>
        </div>
      )}

      {error && <p className="rp-error no-print">{error}</p>}
      {busy && !report && <p className="no-print">계산 중</p>}
      {report && <ReportView r={report} />}
    </main>
  );
}
