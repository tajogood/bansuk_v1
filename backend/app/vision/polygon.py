"""마스크·상자 → 다각형 (numpy만 사용). 결과는 수의사가 고칠 '제안'이라 대략이면 된다."""
from __future__ import annotations

import math

MAX_POINTS = 60


def box_polygon(box, w: int, h: int) -> list[list[float]]:
    x1, y1, x2, y2 = (float(v) for v in box)
    x1, x2 = max(0.0, x1 / w), min(1.0, x2 / w)
    y1, y2 = max(0.0, y1 / h), min(1.0, y2 / h)
    return [[round(x1, 4), round(y1, 4)], [round(x2, 4), round(y1, 4)], [round(x2, 4), round(y2, 4)], [round(x1, 4), round(y2, 4)]]


def simplify(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas–Peucker (닫힌 다각형은 호출 전에 첫 점을 끝에 붙이지 않는다)."""
    if len(points) < 4:
        return points

    def dp(pts):
        a, b = pts[0], pts[-1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        norm = math.hypot(dx, dy)
        best, idx = 0.0, 0
        for i in range(1, len(pts) - 1):
            if norm < 1e-9:  # 닫힌 선: 시작점에서의 거리
                d = math.hypot(pts[i][0] - a[0], pts[i][1] - a[1])
            else:
                d = abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / norm
            if d > best:
                best, idx = d, i
        if best <= tol:
            return [a, b]
        return dp(pts[: idx + 1])[:-1] + dp(pts[idx:])

    return dp(points)


def mask_polygon(mask) -> list[tuple[float, float]] | None:
    """가장 큰 덩어리의 바깥 경계를 따라 다각형을 만든다 (무어 이웃 추적). 좌표는 마스크 픽셀 단위."""
    import numpy as np

    m = np.asarray(mask, dtype=bool)
    if not m.any():
        return None
    H, W = m.shape
    step = max(1, int(max(H, W) / 160))  # 큰 마스크는 줄여서 추적
    small = m[::step, ::step]
    small = _largest_component(small)
    if small is None:
        return None
    pad = np.zeros((small.shape[0] + 2, small.shape[1] + 2), dtype=bool)
    pad[1:-1, 1:-1] = small
    ys, xs = np.nonzero(pad)
    start = (int(ys[0]), int(xs[0]))  # 맨 위 줄의 가장 왼쪽 점
    nbrs = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    contour = [start]
    cur, back = start, 6  # 왼쪽에서 들어왔다고 본다
    for _ in range(pad.size * 2):
        found = False
        for k in range(8):
            d = (back + 1 + k) % 8
            ny, nx = cur[0] + nbrs[d][0], cur[1] + nbrs[d][1]
            if pad[ny, nx]:
                back = (d + 4) % 8
                cur = (ny, nx)
                found = True
                break
        if not found or cur == start:
            break
        contour.append(cur)
    if len(contour) < 3:
        return None
    pts = [((x - 1 + 0.5) * step, (y - 1 + 0.5) * step) for y, x in contour]
    tol = max(1.0, step * 1.5)
    out = simplify(pts, tol)
    while len(out) > MAX_POINTS:
        tol *= 1.5
        out = simplify(pts, tol)
    return out if len(out) >= 3 else None


def _largest_component(m):
    """4-연결 덩어리 중 가장 큰 것만 남긴다."""
    import numpy as np

    H, W = m.shape
    seen = np.zeros_like(m, dtype=bool)
    best, best_pts = 0, None
    for y0, x0 in zip(*np.nonzero(m)):
        if seen[y0, x0]:
            continue
        stack, pts = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(pts) > best:
            best, best_pts = len(pts), pts
    if not best_pts:
        return None
    out = np.zeros_like(m, dtype=bool)
    ys, xs = zip(*best_pts)
    out[list(ys), list(xs)] = True
    return out
