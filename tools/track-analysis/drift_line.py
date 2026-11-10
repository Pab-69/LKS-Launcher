"""Smooth drift line through the painted clips.

The line is L_i = P_i + N_i * q_i along a corridor (base line P, normals N,
road bounds lo/hi). We minimise the 2D curvature (squared second differences
of L) plus a little jerk (third differences), with
  - q fixed at every clip: centre of a small clip, centre line of a long zone
    along its whole length,
  - lo + margin <= q <= hi - margin (active set: violating points get pinned
    to the bound and the system is solved again).
"""
import json, sys
import numpy as np


def diff_matrix(n, order):
    D = np.eye(n)
    for _ in range(order):
        D = D[1:] - D[:-1]
    return D


def solve(P, N, lo, hi, fixed, w3=4.0, margin=(1.4, 1.4), wc=3.0):
    """fixed: {station: offset} (soft, weight wc). Returns q."""
    n = len(P)
    D2 = diff_matrix(n, 2)
    D3 = diff_matrix(n, 3)
    blocks, rhs = [], []
    for D, w in ((D2, 1.0), (D3, w3)):
        for k in (0, 1):
            blocks.append(w * D * N[:, k][None, :])
            rhs.append(-w * D @ P[:, k])
    # clips: pull the line onto them
    idx = np.array(sorted(fixed), dtype=int)
    C = np.zeros((len(idx), n)); C[np.arange(len(idx)), idx] = wc
    blocks.append(C); rhs.append(wc * np.array([fixed[i] for i in idx]))
    A = np.vstack(blocks)
    b = np.concatenate(rhs)
    lo_b = lo + margin[0]
    hi_b = hi - margin[1]
    # near a clip the road bound must not fight it
    lo0, hi0 = lo_b.copy(), hi_b.copy()
    for i, t in fixed.items():
        for j in range(max(0, i - 25), min(n, i + 26)):
            k = 1.0 if abs(j - i) <= 5 else max(0.0, 1 - (abs(j - i) - 5) / 20)
            lo_b[j] = min(lo_b[j], lo0[j] - max(0.0, lo0[j] - (t - 0.3)) * k)
            hi_b[j] = max(hi_b[j], hi0[j] + max(0.0, (t + 0.3) - hi0[j]) * k)
    pins = {}
    for _ in range(60):
        idx_c = np.array(sorted(pins), dtype=int)
        idx_f = np.array([i for i in range(n) if i not in pins], dtype=int)
        qc = np.array([pins[i] for i in idx_c]) if len(idx_c) else np.zeros(0)
        Af = A[:, idx_f]
        bb = b - (A[:, idx_c] @ qc if len(idx_c) else 0)
        qf = np.linalg.solve(Af.T @ Af + 1e-9 * np.eye(len(idx_f)), Af.T @ bb)
        q = np.zeros(n)
        q[idx_f] = qf
        if len(idx_c): q[idx_c] = qc
        bad = [i for i in idx_f if q[i] < lo_b[i] - 1e-3 or q[i] > hi_b[i] + 1e-3]
        if not bad:
            return q
        for i in bad:
            pins[i] = float(np.clip(q[i], lo_b[i], hi_b[i]))
    return q


def station_of(P, x, z, lo_i=0, hi_i=None):
    hi_i = len(P) if hi_i is None else hi_i
    d = np.hypot(P[lo_i:hi_i, 0] - x, P[lo_i:hi_i, 1] - z)
    return lo_i + int(d.argmin())


def offset_at(P, N, i, x, z):
    return float((np.array([x, z]) - P[i]) @ N[i])


def clip_targets(P, N, clips, s_from, s_to):
    """Station -> offset constraints for the clips, in course order."""
    fixed = {}
    cursor = s_from
    for c in clips:
        if c.get('path') and len(c['path']) > 1:
            path = np.array(c['path'], float)
            # densify the zone centre line every 0.5 m
            seg = np.hypot(*np.diff(path, axis=0).T)
            s = np.concatenate([[0], np.cumsum(seg)])
            t = np.arange(0, s[-1] + 1e-6, 0.5)
            dense = np.stack([np.interp(t, s, path[:, 0]), np.interp(t, s, path[:, 1])], 1)
            st = [station_of(P, x, z, cursor, s_to) for x, z in dense]
            # each station of the zone: offset of the zone centre line there
            per = {}
            for (x, z), i in zip(dense, st):
                per.setdefault(i, []).append(offset_at(P, N, i, x, z))
            for i, offs in per.items():
                fixed[i] = float(np.mean(offs))
            cursor = min(st)
        else:
            i = station_of(P, c['x'], c['z'], cursor, s_to)
            # a small clip: the line goes through its centre (pinned over ±2 m)
            for j in range(max(0, i - 2), min(len(P), i + 3)):
                fixed[j] = offset_at(P, N, j, c['x'], c['z'])
            cursor = i
    return fixed


def build(P, N, lo, hi, clips, start, finish, step=2, w3=4.0, s1_from=None):
    mid = lambda g: ((g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2)
    s0 = station_of(P, *mid(start))
    s1 = station_of(P, *mid(finish), s1_from if s1_from is not None else s0)
    # a bit of road before and after so the line enters the gates smoothly
    a, b = max(0, s0 - 25), min(len(P), s1 + 15)
    Ps, Ns, los, his = P[a:b], N[a:b], lo[a:b], hi[a:b]
    fixed = clip_targets(Ps, Ns, clips, s0 - a, s1 - a + 1)
    q = solve(Ps, Ns, los, his, fixed, w3=w3)
    L = Ps + Ns * q[:, None]
    line = L[s0 - a:s1 - a + 1]
    # cut exactly at the gates
    out = [list(map(float, p)) for p in line[::step]]
    if (len(line) - 1) % step:
        out.append(list(map(float, line[-1])))
    k = np.gradient(np.gradient(L, axis=0), axis=0)
    return out, L, q, fixed, float(np.abs(k).max())
