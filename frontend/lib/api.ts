import type {
  AnalysisDashboard,
  AnalysisQuery,
  Catalog,
  Dashboard,
  DayView,
  FlockItem,
  FlockReport,
  HouseView,
  QueryResult,
  Session,
  Widget,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SESSION_KEY = "bansuk.session";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 저장소를 못 쓰는 환경이면 이번 접속 동안만 유지 */
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `요청을 처리하지 못했습니다 (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export async function downloadCsv(token: string, flockId: number, filename: string) {
  const res = await fetch(`${API_URL}/api/reports/flocks/${flockId}/data.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, "원자료를 받지 못했습니다");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type DashIn = { name: string; shared: boolean; widgets: Widget[] };

export const analysisApi = {
  catalog: (t: string) => request<Catalog>("/api/analysis/catalog", {}, t),
  query: (t: string, q: AnalysisQuery) =>
    request<QueryResult>("/api/analysis/query", { method: "POST", body: JSON.stringify(q) }, t),
  list: (t: string) => request<{ dashboards: AnalysisDashboard[] }>("/api/analysis/dashboards", {}, t),
  create: (t: string, d: DashIn) =>
    request<AnalysisDashboard>("/api/analysis/dashboards", { method: "POST", body: JSON.stringify(d) }, t),
  update: (t: string, id: number, d: DashIn) =>
    request<AnalysisDashboard>(`/api/analysis/dashboards/${id}`, { method: "PUT", body: JSON.stringify(d) }, t),
  remove: (t: string, id: number) => request<{ ok: boolean }>(`/api/analysis/dashboards/${id}`, { method: "DELETE" }, t),
};

export const api = {
  flocks: (token: string, farmId: number) =>
    request<{ flocks: FlockItem[] }>(`/api/farms/${farmId}/flocks`, {}, token),
  report: (token: string, flockId: number, q: { age_from?: number; age_to?: number; baseline?: string }) => {
    const p = new URLSearchParams();
    if (q.age_from) p.set("age_from", String(q.age_from));
    if (q.age_to) p.set("age_to", String(q.age_to));
    if (q.baseline) p.set("baseline", q.baseline);
    return request<FlockReport>(`/api/reports/flocks/${flockId}?${p}`, {}, token);
  },
  issue: (token: string, flockId: number, body: object) =>
    request<FlockReport>(`/api/reports/flocks/${flockId}/issue`, { method: "POST", body: JSON.stringify(body) }, token),
  issued: (token: string, reportNo: string) => request<FlockReport>(`/api/reports/issued/${reportNo}`, {}, token),
  dashboard: (token: string, farmId: number, date: string) =>
    request<Dashboard>(`/api/farms/${farmId}/dashboard?date=${date}`, {}, token),
  login: (phone: string, pin: string) =>
    request<Session>("/api/auth/login", { method: "POST", body: JSON.stringify({ phone, pin }) }),
  day: (token: string, farmId: number, date: string) =>
    request<DayView>(`/api/farms/${farmId}/day?date=${date}`, {}, token),
  saveDaily: (token: string, farmId: number, houseId: number, date: string, body: object) =>
    request<HouseView>(
      `/api/farms/${farmId}/houses/${houseId}/daily/${date}`,
      { method: "PUT", body: JSON.stringify(body) },
      token,
    ),
};
