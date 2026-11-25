import type {
  AdminFarm,
  AdminHouse,
  AdminUser,
  AuditItem,
  FarmConfigIn,
  Role,
  NecropsyCase,
  NotificationItem,
  CaseResult,
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
  SessionUser,
  Widget,
} from "./types";
import { storedLang, tr } from "./i18n";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SESSION_KEY = "bansuk.session";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
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
      "Accept-Language": storedLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = tr("요청을 처리하지 못했습니다 ({status})", { status: res.status });
    let code: string | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      else if (body.detail?.message) {
        msg = body.detail.message;
        code = body.detail.code;
      }
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(res.status, msg, code);
  }
  return res.json() as Promise<T>;
}

export async function downloadCsv(token: string, flockId: number, filename: string) {
  const res = await fetch(`${API_URL}/api/reports/flocks/${flockId}/data.csv`, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": storedLang() },
  });
  if (!res.ok) throw new ApiError(res.status, tr("원자료를 받지 못했습니다"));
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
  changePin: (token: string, current: string, next: string) =>
    request<{ user: SessionUser; farms: Session["farms"] }>(
      "/api/auth/change-pin",
      { method: "POST", body: JSON.stringify({ current, new: next }) },
      token,
    ),
  logout: (token: string) => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }, token),
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

type UserIn = { name: string; phone: string; role: Role; farm_ids: number[] };
type FarmIn = {
  name: string;
  region: string | null;
  contract_type: "program" | "test_only";
  active: boolean;
  houses: AdminHouse[];
  config: FarmConfigIn | null;
};

export const adminApi = {
  users: (t: string) => request<{ users: AdminUser[]; roles: Record<Role, string> }>("/api/admin/users", {}, t),
  createUser: (t: string, b: UserIn) =>
    request<{ user: AdminUser; temp_pin: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(b) }, t),
  updateUser: (t: string, id: number, b: Partial<UserIn> & { active?: boolean }) =>
    request<{ user: AdminUser }>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(b) }, t),
  resetPin: (t: string, id: number) =>
    request<{ user: AdminUser; temp_pin: string }>(`/api/admin/users/${id}/reset-pin`, { method: "POST" }, t),
  unlock: (t: string, id: number) => request<{ user: AdminUser }>(`/api/admin/users/${id}/unlock`, { method: "POST" }, t),
  farms: (t: string) => request<{ farms: AdminFarm[]; grades: Record<string, string> }>("/api/admin/farms", {}, t),
  createFarm: (t: string, b: FarmIn) =>
    request<{ farm: AdminFarm }>("/api/admin/farms", { method: "POST", body: JSON.stringify(b) }, t),
  updateFarm: (t: string, id: number, b: FarmIn) =>
    request<{ farm: AdminFarm }>(`/api/admin/farms/${id}`, { method: "PUT", body: JSON.stringify(b) }, t),
  audit: (t: string) => request<{ items: AuditItem[] }>("/api/admin/audit", {}, t),
};

const post = (path: string, t: string, body: object = {}) =>
  request<NecropsyCase>(path, { method: "POST", body: JSON.stringify(body) }, t);

export const casesApi = {
  list: (t: string, q: { status?: string; farm_id?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.status) p.set("status", q.status);
    if (q.farm_id) p.set("farm_id", String(q.farm_id));
    return request<{ cases: NecropsyCase[] }>(`/api/cases?${p}`, {}, t);
  },
  get: (t: string, id: number) => request<NecropsyCase>(`/api/cases/${id}`, {}, t),
  report: (t: string, b: { farm_id: number; house_id: number | null; dead_count: number | null; onset: string | null; symptoms: string[]; note: string | null }) =>
    post("/api/cases", t, b),
  propose: (t: string, id: number, b: { slots: string[]; vet_id?: number | null; message?: string | null }) => post(`/api/cases/${id}/propose`, t, b),
  accept: (t: string, id: number, at: string) => post(`/api/cases/${id}/accept`, t, { at }),
  request: (t: string, id: number, b: { at?: string | null; message?: string | null }) => post(`/api/cases/${id}/request`, t, b),
  confirm: (t: string, id: number, b: { at: string; vet_id?: number | null; message?: string | null }) => post(`/api/cases/${id}/confirm`, t, b),
  message: (t: string, id: number, text: string) => post(`/api/cases/${id}/message`, t, { text }),
  cancel: (t: string, id: number, reason: string | null) => post(`/api/cases/${id}/cancel`, t, { reason }),
  result: (t: string, id: number, b: Omit<CaseResult, "performed_at"> & { performed_at?: string | null }) =>
    request<NecropsyCase>(`/api/cases/${id}/result`, { method: "PUT", body: JSON.stringify(b) }, t),
  share: (t: string, id: number) => post(`/api/cases/${id}/share`, t),
  deletePhoto: (t: string, id: number, photoId: number) =>
    request<NecropsyCase>(`/api/cases/${id}/photos/${photoId}`, { method: "DELETE" }, t),
  /** 사진 올리기. FormData라 Content-Type은 브라우저가 정한다. */
  uploadPhotos: async (t: string, id: number, files: Blob[]) => {
    const fd = new FormData();
    files.forEach((f, i) => fd.append("files", f, `photo-${i}.jpg`));
    const res = await fetch(`${API_URL}/api/cases/${id}/photos`, {
      method: "POST",
      body: fd,
      headers: { Authorization: `Bearer ${t}`, "Accept-Language": storedLang() },
    });
    if (!res.ok) {
      let msg = tr("요청을 처리하지 못했습니다 ({status})", { status: res.status });
      try {
        const b = await res.json();
        if (typeof b.detail === "string") msg = b.detail;
      } catch {
        /* 본문 없음 */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as NecropsyCase;
  },
};

export const notificationsApi = {
  list: (t: string) => request<{ unread: number; items: NotificationItem[] }>("/api/notifications", {}, t),
  count: (t: string) => request<{ unread: number }>("/api/notifications/count", {}, t),
  readAll: (t: string) => request<{ unread: number }>("/api/notifications/read-all", { method: "POST" }, t),
};
