import type { DayView, HouseView, Session } from "./types";

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

export const api = {
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
