/**
 * 전송 대기열. 계사 안은 전파가 약한 곳이 많아서, 저장이 실패하면 기기에 보관했다가
 * 연결되면 다시 보낸다. 같은 동·같은 날짜는 마지막 입력만 남긴다.
 */
import { api, ApiError } from "./api";

const KEY = "bansuk.queue";

export type QueuedSave = {
  farmId: number;
  houseId: number;
  houseName: string;
  date: string;
  body: object;
  queuedAt: number;
};

function read(): QueuedSave[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(items: QueuedSave[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 무시 */
  }
}

export function pending(): QueuedSave[] {
  return read();
}

export function enqueue(item: QueuedSave) {
  const rest = read().filter((q) => !(q.houseId === item.houseId && q.date === item.date));
  write([...rest, item]);
}

/**
 * 대기 중인 저장을 보낸다.
 * 연결 문제·서버 오류는 남겨 두고 다음에 다시 보낸다.
 * 입력값이 거부된 경우(4xx)는 다시 보내도 같으므로 대기열에서 빼고 rejected로 돌려준다.
 */
export async function flush(
  token: string,
): Promise<{ left: number; rejected: { item: QueuedSave; message: string }[] }> {
  const items = read();
  const left: QueuedSave[] = [];
  const rejected: { item: QueuedSave; message: string }[] = [];
  for (const q of items) {
    try {
      await api.saveDaily(token, q.farmId, q.houseId, q.date, q.body);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401) {
        rejected.push({ item: q, message: e.message });
      } else {
        left.push(q);
      }
    }
  }
  write(left);
  return { left: left.length, rejected };
}

export function isNetworkError(e: unknown) {
  return !(e instanceof ApiError);
}
