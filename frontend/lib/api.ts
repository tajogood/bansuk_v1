import type {
  LabelPhoto,
  LabelPhotoBrief,
  LabelSummary,
  PhotoRegionItem,
  Epidemic,
  LabBrief,
  LabDetail,
  LabIn,
  TiterSeries,
  AdminFarm,
  AdminHouse,
  AdminUser,
  AuditItem,
  FarmConfigIn,
  Role,
  NecropsyCase,
  FlockBoard,
  VaccineItem,
  ProgramSummary,
  ProgramItemRow,
  FlockVaccination,
  DueRow,
  ImportBatchItem,
  ManagedFlock,
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
  importer: string | null;
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
  farms: (t: string) => request<{ farms: AdminFarm[]; grades: Record<string, string>; importers: Record<string, string> }>("/api/admin/farms", {}, t),
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
  result: (t: string, id: number, b: Omit<CaseResult, "performed_at" | "final_diagnosis"> & { performed_at?: string | null; final_diagnosis?: string | null }) =>
    request<NecropsyCase>(`/api/cases/${id}/result`, { method: "PUT", body: JSON.stringify(b) }, t),
  share: (t: string, id: number) => post(`/api/cases/${id}/share`, t),
  diagnosis: (t: string, id: number, b: { final_diseases: string[]; final_diagnosis: string | null }) =>
    request<NecropsyCase>(`/api/cases/${id}/diagnosis`, { method: "PUT", body: JSON.stringify(b) }, t),
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
  read: (t: string, id: number) => request<{ unread: number }>(`/api/notifications/${id}/read`, { method: "POST" }, t),
};

type FlockRes = { flock: ManagedFlock; linked_records: number };
export const flocksApi = {
  board: (t: string, farmId: number) => request<FlockBoard>(`/api/farms/${farmId}/flock-board`, {}, t),
  place: (t: string, farmId: number, b: { house_id: number; placed_on: string; placed_count: number; breed?: string | null; hatchery?: string | null; name?: string | null }) =>
    request<FlockRes>(`/api/farms/${farmId}/flocks`, { method: "POST", body: JSON.stringify(b) }, t),
  edit: (t: string, id: number, b: Partial<{ name: string; placed_on: string; placed_count: number; breed: string; hatchery: string }>) =>
    request<FlockRes>(`/api/flocks/${id}`, { method: "PATCH", body: JSON.stringify(b) }, t),
  move: (t: string, id: number, b: { to_house_id: number; date: string; count?: number | null }) =>
    request<FlockRes>(`/api/flocks/${id}/move`, { method: "POST", body: JSON.stringify(b) }, t),
  close: (t: string, id: number, b: { date: string; reason: string; note?: string | null }) =>
    request<FlockRes>(`/api/flocks/${id}/close`, { method: "POST", body: JSON.stringify(b) }, t),
  undo: (t: string, id: number) => request<FlockRes>(`/api/flocks/${id}/undo`, { method: "POST" }, t),
  remove: (t: string, id: number) => request<{ ok: boolean }>(`/api/flocks/${id}`, { method: "DELETE" }, t),
};

export const importsApi = {
  list: (t: string, farmId: number) =>
    request<{ importer: { code: string; label: string } | null; batches: ImportBatchItem[] }>(`/api/farms/${farmId}/imports`, {}, t),
  upload: async (t: string, farmId: number, file: File, overwriteManual: boolean) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("overwrite_manual", overwriteManual ? "true" : "false");
    const res = await fetch(`${API_URL}/api/farms/${farmId}/imports`, {
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
    return (await res.json()) as ImportBatchItem;
  },
  apply: (t: string, id: number) => request<ImportBatchItem>(`/api/imports/${id}/apply`, { method: "POST" }, t),
  discard: (t: string, id: number) => request<ImportBatchItem>(`/api/imports/${id}/discard`, { method: "POST" }, t),
  revert: (t: string, id: number) => request<ImportBatchItem>(`/api/imports/${id}/revert`, { method: "POST" }, t),
  download: async (t: string, b: ImportBatchItem) => {
    const res = await fetch(`${API_URL}/api/imports/${b.id}/file`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, tr("원본 파일을 받지 못했습니다"));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = b.filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

type ProgramIn = { name: string; description?: string | null; active?: boolean; items: Omit<ProgramItemRow, "id" | "vaccine" | "kind" | "default_route">[] };
type VaccineIn = Omit<VaccineItem, "id">;
const json = (method: string, body: object) => ({ method, body: JSON.stringify(body) });
export const vaccinesApi = {
  vaccines: (t: string) => request<{ vaccines: VaccineItem[] }>("/api/vaccines", {}, t),
  createVaccine: (t: string, b: VaccineIn) => request<VaccineItem>("/api/vaccines", json("POST", b), t),
  updateVaccine: (t: string, id: number, b: VaccineIn) => request<VaccineItem>(`/api/vaccines/${id}`, json("PUT", b), t),
  programs: (t: string) => request<{ programs: ProgramSummary[] }>("/api/programs", {}, t),
  program: (t: string, id: number) => request<ProgramSummary>(`/api/programs/${id}`, {}, t),
  createProgram: (t: string, b: ProgramIn) => request<ProgramSummary>("/api/programs", json("POST", b), t),
  updateProgram: (t: string, id: number, b: ProgramIn) => request<ProgramSummary>(`/api/programs/${id}`, json("PUT", b), t),
  newVersion: (t: string, id: number, b: ProgramIn) => request<ProgramSummary>(`/api/programs/${id}/new-version`, json("POST", b), t),
  flock: (t: string, flockId: number) => request<FlockVaccination>(`/api/flocks/${flockId}/vaccination`, {}, t),
  assign: (t: string, flockId: number, b: { program_id: number | null; from_date: string; reason?: string | null }) =>
    request<FlockVaccination>(`/api/flocks/${flockId}/program`, json("POST", b), t),
  record: (t: string, flockId: number, b: { date: string; vaccine_id: number; route?: string | null; birds?: number | null; lot?: string | null; program_item_id?: number | null; note?: string | null }) =>
    request<FlockVaccination>(`/api/flocks/${flockId}/vaccinations`, json("POST", b), t),
  removeRecord: (t: string, id: number) => request<FlockVaccination>(`/api/vaccinations/${id}`, { method: "DELETE" }, t),
  due: (t: string, days = 14) => request<{ items: DueRow[]; today: string }>(`/api/vaccination/due?days=${days}`, {}, t),
};

export const labApi = {
  list: (t: string, f: { farm_id?: number; case_id?: number; kind?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return request<{ items: LabBrief[]; can_edit: boolean }>(`/api/lab?${qs}`, {}, t);
  },
  get: (t: string, id: number) => request<LabDetail>(`/api/lab/${id}`, {}, t),
  create: (t: string, b: LabIn) => request<LabDetail>("/api/lab", json("POST", b), t),
  update: (t: string, id: number, b: LabIn) => request<LabDetail>(`/api/lab/${id}`, json("PUT", b), t),
  issue: (t: string, id: number) => request<LabDetail>(`/api/lab/${id}/issue`, { method: "POST" }, t),
  unissue: (t: string, id: number) => request<LabDetail>(`/api/lab/${id}/unissue`, { method: "POST" }, t),
  remove: (t: string, id: number) => request<{ ok: boolean }>(`/api/lab/${id}`, { method: "DELETE" }, t),
  titers: (t: string, farmId: number, houseId?: number | null) =>
    request<{ series: TiterSeries[] }>(`/api/lab/titers?farm_id=${farmId}${houseId ? `&house_id=${houseId}` : ""}`, {}, t),
  /** 표준 입력 양식 내려받기 */
  template: async (t: string) => {
    const res = await fetch(`${API_URL}/api/lab/template.xlsx`, { headers: { Authorization: `Bearer ${t}`, "Accept-Language": storedLang() } });
    if (!res.ok) throw new ApiError(res.status, tr("양식을 받지 못했습니다"));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "lab-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  },
  importFile: async (t: string, file: File, format = "standard_xlsx") => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_URL}/api/lab/import?format=${format}`, {
      method: "POST",
      body: fd,
      headers: { Authorization: `Bearer ${t}`, "Accept-Language": storedLang() },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, typeof body.detail === "string" ? body.detail : tr("파일을 올리지 못했습니다"));
    return body as { created: number[]; skipped: { farm: string | null; reason: string }[] };
  },
};

export const epidemicApi = {
  get: (t: string, days: number, region?: string | null) =>
    request<Epidemic>(`/api/epidemic?days=${days}${region ? `&region=${encodeURIComponent(region)}` : ""}`, {}, t),
};

export const labelingApi = {
  summary: (t: string) => request<LabelSummary>("/api/labeling/summary", {}, t),
  list: (t: string, status: string, f: { farm_id?: number; organ?: string; disease?: string; offset?: number } = {}) => {
    const qs = new URLSearchParams({ status, limit: "60", ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])) });
    return request<{ total: number; items: LabelPhotoBrief[] }>(`/api/labeling/photos?${qs}`, {}, t);
  },
  get: (t: string, id: number, queue: string) => request<LabelPhoto>(`/api/labeling/photos/${id}?queue=${queue}`, {}, t),
  save: (
    t: string,
    id: number,
    b: { regions: PhotoRegionItem[]; diseases: string[]; normal: boolean; note: string | null; status: "done" | "todo" | "skip" },
  ) =>
    request<LabelPhoto>(
      `/api/labeling/photos/${id}`,
      json("PUT", { ...b, regions: b.regions.map((r) => ({ id: r.id, organ: r.organ, lesions: r.lesions, points: r.points, status: r.status })) }),
      t,
    ),
  auto: (t: string, id: number) => request<LabelPhoto & { added: number }>(`/api/labeling/photos/${id}/auto`, { method: "POST" }, t),
  autoPending: (t: string) => request<{ queued: number }>("/api/labeling/auto-pending", { method: "POST" }, t),
  remove: (t: string, id: number) => request<{ ok: boolean }>(`/api/labeling/photos/${id}`, { method: "DELETE" }, t),
  upload: async (t: string, files: File[], farmId?: number | null) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (farmId) fd.append("farm_id", String(farmId));
    const res = await fetch(`${API_URL}/api/labeling/upload`, {
      method: "POST",
      body: fd,
      headers: { Authorization: `Bearer ${t}`, "Accept-Language": storedLang() },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, typeof body.detail === "string" ? body.detail : tr("파일을 올리지 못했습니다"));
    return body as { saved: number; duplicates: number; failed: { name: string; error: string }[]; auto: boolean };
  },
  exportZip: async (t: string) => {
    const res = await fetch(`${API_URL}/api/labeling/export.zip`, { headers: { Authorization: `Bearer ${t}`, "Accept-Language": storedLang() } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, typeof body.detail === "string" ? body.detail : tr("학습 데이터를 받지 못했습니다"));
    }
    const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "bansuk-labels.zip";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export type UpcomingVaccination = {
  item_id: number;
  flock_id: number;
  planned: string;
  age_days: number;
  status: "overdue" | "due" | "upcoming" | "done";
  house: string | null;
  vaccine: { id: number; name: string } | null;
  route: string | null;
};
export const farmVaccinationApi = {
  upcoming: (t: string, farmId: number) => request<{ items: UpcomingVaccination[]; today: string }>(`/api/farms/${farmId}/vaccination/upcoming?days=14`, {}, t),
};
