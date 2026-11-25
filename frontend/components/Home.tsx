"use client";

import Dashboard from "./Dashboard";
import { dateLabel, num, relDay, shiftISO, todayISO } from "@/lib/format";
import type { DayView, Farm } from "@/lib/types";

type Props = {
  tab: "input" | "status";
  onTab: (t: "input" | "status") => void;
  token: string;
  isBansuk: boolean;
  isAdmin?: boolean;
  day: DayView | null;
  date: string;
  farms: Farm[];
  farmId: number;
  queued: Set<number>; // 전송 대기 중인 house_id
  pendingCount: number;
  loading: boolean;
  error: string | null;
  onDate: (iso: string) => void;
  onFarm: (id: number) => void;
  onOpen: (houseId: number) => void;
  onRetry: () => void;
  onLogout: () => void;
};

export default function Home(p: Props) {
  const rel = relDay(p.date);
  const canNext = p.date < todayISO();

  return (
    <div className="home">
      <header className="home-head">
        {p.farms.length > 1 ? (
          <select
            className="farm-select"
            value={p.farmId}
            onChange={(e) => p.onFarm(Number(e.target.value))}
            aria-label="농장 선택"
          >
            {p.farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="farm-name">{p.day?.farm.name ?? p.farms[0]?.name}</h1>
        )}
        <button type="button" className="link" onClick={p.onLogout}>
          로그아웃
        </button>
      </header>

      <nav className="date-step" aria-label="날짜">
        <button type="button" onClick={() => p.onDate(shiftISO(p.date, -1))} aria-label="전날">
          ‹
        </button>
        <div className="date-now">
          <strong>{dateLabel(p.date)}</strong>
          {rel && <span>{rel}</span>}
        </div>
        <button type="button" onClick={() => p.onDate(shiftISO(p.date, 1))} disabled={!canNext} aria-label="다음 날">
          ›
        </button>
      </nav>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={p.tab === "input"} onClick={() => p.onTab("input")}>
          입력
        </button>
        <button type="button" role="tab" aria-selected={p.tab === "status"} onClick={() => p.onTab("status")}>
          현황
        </button>
      </div>

      {p.tab === "status" ? (
        <>
          <Dashboard token={p.token} farmId={p.farmId} date={p.date} />
          {p.isBansuk && (
            <>
              <a className="report-link" href={`/report/?farm=${p.farmId}`}>
                계군 성적 보고서 만들기
              </a>
              <a className="report-link" href="/analysis/">
                데이터 분석기 열기
              </a>
              {p.isAdmin && (
                <a className="report-link" href="/admin/">
                  계정·농장 관리
                </a>
              )}
            </>
          )}
        </>
      ) : (
        <InputList {...p} />
      )}
    </div>
  );
}

function InputList(p: Props) {
  const houses = p.day?.houses ?? [];
  const firstTodo = houses.find((h) => !h.record && !p.queued.has(h.house.id));
  const done = houses.filter((h) => h.record || p.queued.has(h.house.id)).length;
  return (
    <>
      {p.error && (
        <div className="banner banner-error">
          <span>{p.error}</span>
          <button type="button" onClick={p.onRetry}>
            다시 불러오기
          </button>
        </div>
      )}
      {p.pendingCount > 0 && (
        <div className="banner banner-queue">
          전송 대기 {p.pendingCount}건. 연결되면 자동으로 보냅니다.
        </div>
      )}

      {houses.length > 0 && (
        <div className="progress" aria-label={`${houses.length}개 동 중 ${done}개 입력`}>
          <div className="progress-text">
            <strong>
              {done}/{houses.length}
            </strong>
            <span>동 입력</span>
          </div>
          <div className="progress-bar">
            <i style={{ width: `${(done / houses.length) * 100}%` }} />
          </div>
        </div>
      )}

      <ul className="houses">
        {houses.map((h) => {
          const q = p.queued.has(h.house.id);
          const rate = h.record?.metrics.lay_rate;
          const hasWarn = h.warnings.length > 0;
          return (
            <li key={h.house.id}>
              <button
                type="button"
                className={`house ${h.record ? "is-done" : ""} ${q ? "is-queued" : ""}`}
                onClick={() => p.onOpen(h.house.id)}
              >
                <span className="house-name">{h.house.name}</span>
                <span className="house-meta">
                  {h.flock ? `${h.flock.age_weeks}주령` : "계군 없음"}
                  {h.expected_start_count !== null && <span className="sep">{num(h.expected_start_count)}수</span>}
                </span>
                <span className="house-status">
                  {q ? (
                    "전송 대기"
                  ) : h.record ? (
                    <>
                      {hasWarn && <span className="house-flag">확인 필요</span>}
                      <b>{rate !== null && rate !== undefined ? `${rate.toFixed(1)}%` : "입력됨"}</b>
                      <i aria-label="입력 완료">✓</i>
                    </>
                  ) : (
                    "입력하기"
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {p.loading && <p className="muted center">불러오는 중</p>}

      {houses.length > 0 && (
        <div className="home-cta">
          {firstTodo ? (
            <button type="button" className="btn-primary" onClick={() => p.onOpen(firstTodo.house.id)}>
              {firstTodo.house.name}부터 입력
            </button>
          ) : (
            <p className="all-done">오늘 입력을 모두 마쳤습니다.</p>
          )}
        </div>
      )}
    </>
  );
}
