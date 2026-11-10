"""Drift course building blocks: corridor along a base line, drift line, corners, clips."""
import numpy as np


def resample(P, step=2.0):
    P = np.asarray(P, float)
    seg = np.hypot(*np.diff(P, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.arange(0, s[-1], step)
    return np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], 1)


def smooth(a, sigma):
    if sigma <= 0:
        return a.copy()
    k = int(3 * sigma)
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    w /= w.sum()
    pad = np.pad(a, (k, k), mode='edge')
    return np.convolve(pad, w, mode='valid')


def frames(P):
    """Forward unit vectors and left normals n = rot90(f) (CCW in the x/z plane)."""
    f = np.gradient(P, axis=0)
    f /= np.linalg.norm(f, axis=1)[:, None]
    n = np.stack([-f[:, 1], f[:, 0]], 1)
    return f, n


def edges(grid, road, wall, P, N, maxd=25.0, step=0.25, start=0.0):
    """Distance along +N and -N to the end of the road (or a wall)."""
    out = np.zeros((len(P), 2))
    H, W = road.shape
    for i, (p, n) in enumerate(zip(P, N)):
        for j, sgn in enumerate((1, -1)):
            d = start
            while d < maxd:
                x, z = p + n * sgn * d
                u, v = grid.px(x, z)
                u, v = int(u), int(v)
                if not (0 <= u < W and 0 <= v < H) or wall[v, u] or not road[v, u]:
                    break
                d += step
            out[i, j] = d
    return out  # [:,0] = room on +N side, [:,1] = room on -N side


def lateral(P, F, N, pts, window=3.0):
    """Station index and signed lateral offset of each point (nearest base point)."""
    idx = []
    off = []
    for q in pts:
        d = np.hypot(P[:, 0] - q[0], P[:, 1] - q[1])
        i = int(d.argmin())
        v = q - P[i]
        if abs(v @ F[i]) > window:
            continue
        idx.append(i)
        off.append(v @ N[i])
    return np.array(idx), np.array(off)


def min_curvature(P, N, lo, hi, iters=20000, q0=None, alpha=0.05):
    """Lateral offsets q (lo <= q <= hi) of a smooth, low-curvature line
    (projected gradient descent on the squared second differences)."""
    q = np.clip(q0 if q0 is not None else (lo + hi) / 2, lo, hi).astype(float)
    for _ in range(iters):
        L = P + N * q[:, None]
        d4 = np.zeros_like(L)
        d4[2:-2] = L[:-4] - 4 * L[1:-3] + 6 * L[2:-2] - 4 * L[3:-1] + L[4:]
        q = np.clip(q - alpha * np.einsum('ij,ij->i', d4, N), lo, hi)
    return q


def curvature(L, span=5):
    n = len(L)
    k = np.zeros(n)
    for i in range(n):
        a, p, c = L[max(0, i - span)], L[i], L[min(n - 1, i + span)]
        v1, v2 = p - a, c - p
        l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if l1 < 0.1 or l2 < 0.1:
            continue
        cross = (v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2)
        dot = (v1 @ v2) / (l1 * l2)
        k[i] = np.arctan2(cross, dot) / ((l1 + l2) / 2)
    return k


def corners(k, step, max_radius=90.0, min_turn=25.0, merge=10.0):
    out = []
    cur = None
    for i, c in enumerate(k):
        s = int(np.sign(c)) if abs(c) >= 1 / max_radius else 0
        if cur and (s != cur['sign'] or i == len(k) - 1):
            cur['end'] = i - 1
            out.append(cur)
            cur = None
        if s and not cur:
            cur = {'sign': s, 'start': i}
    merged = []
    for c in out:
        if merged and merged[-1]['sign'] == c['sign'] and (c['start'] - merged[-1]['end']) * step < merge:
            merged[-1]['end'] = c['end']
        else:
            merged.append(dict(c))
    res = []
    for c in merged:
        seg = k[c['start']:c['end'] + 1]
        turn = abs(np.degrees(seg.sum() * step))
        if turn >= min_turn:
            c['turn'] = turn
            c['apex'] = c['start'] + int(np.abs(seg).argmax())
            res.append(c)
    return res


def min_curvature_ms(P, N, lo, hi, steps=(8, 4, 2, 1), iters=20000):
    """Multi-scale min_curvature: coarse first (long corners), then finer."""
    n = len(P)
    q = None
    for st in steps:
        idx = np.arange(0, n, st)
        if idx[-1] != n - 1:
            idx = np.append(idx, n - 1)
        q0 = None if q is None else q[idx]
        qc = min_curvature(P[idx], N[idx], lo[idx], hi[idx], iters=iters, q0=q0)
        q = np.interp(np.arange(n), idx, qc)
    return np.clip(q, lo, hi)
