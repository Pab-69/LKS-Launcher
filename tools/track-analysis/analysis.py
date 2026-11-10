"""Precise course analysis, version 2.

For one layout:
  - valid track surface (physics meshes whose surface has IS_VALID_TRACK=1, from data/surfaces.ini),
    rasterised at 0.1 m around the course, walls as barriers
  - ground markings (flat visual meshes lying on the track: paint, decals, skid marks)
  - track limits left/right along a smooth base path (rays every 0.5 m, 0.05 m steps)
  - drift line = path of the CAR CENTRE such that the front bumper touches each corde (inner clip)
    and the rear bumper each outer clip / zone at a typical drift angle, smooth (curvature + jerk),
    the whole car body inside the limits
"""
import sys, os, re, json, configparser, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import kn5, geom, course as C, drift_line as DL

HERE = os.path.dirname(os.path.abspath(__file__))
TR = os.environ.get('LKS_TRACKS', os.path.join(HERE, 'tracks'))        # unpacked tracks (fetch.py downloads them)
OUT = os.environ.get('LKS_ANALYSIS_OUT', os.path.join(HERE, 'out'))    # control images
COURSES = os.path.join(HERE, '..', '..', 'src', 'main', 'telemetry', 'courses') + os.sep
os.makedirs(OUT, exist_ok=True)

RES = 0.1
HALF_LENGTH = 2.0      # centre -> bumper, as the launcher judges (drift.js HALF_LENGTH)
HALF_WIDTH = 0.95      # half width of a drift car
DRIFT_ANGLE = 35.0     # typical drift angle used to place the centre line around the clips

LAYOUTS = {
    'arg23': dict(track='Circuit_Du_Val_Argenton', layout='val_dargenton_layout_2023', models='models_val_dargenton_layout_2023.ini', surf='val_dargenton_layout_2023/data/surfaces.ini', ai='val_dargenton_layout_2023/ai/fast_lane.ai', json='Circuit_Du_Val_Argenton.val_dargenton_layout_2023.json'),
    'arg24': dict(track='Circuit_Du_Val_Argenton', layout='val_dargenton_layout_2024', models='models_val_dargenton_layout_2024.ini', surf='val_dargenton_layout_2024/data/surfaces.ini', ai='val_dargenton_layout_2023/ai/fast_lane.ai', json='Circuit_Du_Val_Argenton.val_dargenton_layout_2024.json'),
    'cal': dict(track='cfd_calmont_2023', layout='Calmont', models='models_Calmont.ini', surf='Calmont/data/surfaces.ini', ai=None, json='cfd_calmont_2023.Calmont.json'),
    'cha': dict(track='cfd_circuit_charade_2025', layout='', models='models.ini', surf='data/surfaces.ini', ai='ai/fast_lane.ai', json='cfd_circuit_charade_2025.json'),
    'cro': dict(track='cfd_croix_en_ternois_2025', layout='', models='models.ini', surf='data/surfaces.ini', ai='ai_for_cam/fast_lane.ai', json='cfd_croix_en_ternois_2025.json'),
    'vdv': dict(track='cfd_val_de_vienne_2022', layout='', models=None, surf='data/surfaces.ini', ai='ai/fast_lane.ai', json='cfd_val_de_vienne_2022.json'),
    'eng': dict(track='englishtown_gambler_esda', layout='', models=None, surf='data/surfaces.ini', ai='ai-for replays/fast_lane.ai', json='englishtown_gambler_esda.json'),
    'kart': dict(track='kart_volan_championship', layout='', models='models.ini', surf='data/surfaces.ini', ai='ai/fast_lane.ai', json='kart_volan_championship.json'),
    'pge': dict(track='poland_pge_narodowy_v3', layout='', models='models.ini', surf='data/surfaces.ini', ai='ai0/fast_lane.ai', json='poland_pge_narodowy_v3.json'),
    'bik': dict(track='vdc_bikernieki_2022', layout='drift_vdc', models='models_drift_vdc.ini', surf='drift_vdc/data/surfaces.ini', ai='drift_vdc/ai/fast_lane.ai', json='vdc_bikernieki_2022.drift_vdc.json'),
}

# ground paint (name or material) and clip posts / boards of each layout, found by surveying the meshes under every clip
PAINT = {'arg23': ('Line White', '^clip_\\d+'), 'arg24': ('Line White', '^clip_\\d+'), 'cal': ('Line White', '^OBJ5\\d'), 'cha': ('STRIPES', None), 'cro': ('Line White|BANDE_BLANCH', None), 'vdv': ('STRP_BLL_BLANCHE', None), 'eng': ('lineas', '^cp\\d+'), 'kart': ('^line', None), 'pge': ('^Plane$', '^tyrn'), 'bik': ('whiteline|yellowline|tiza|yellow marker', 'Inner Clip')}
SKID = re.compile(r'skid', re.I)

DEFAULT_SURF = {'ROAD': (True, False), 'KERB': (True, False), 'GRASS': (False, False), 'SAND': (False, False), 'WALL': (False, True), 'PIT': (True, False)}


def kn5_files(cfg):
    d = os.path.join(TR, cfg['track'])
    if cfg['models']:
        cp = configparser.ConfigParser(strict=False)
        cp.read(os.path.join(d, cfg['models']))
        files = [cp[s]['FILE'] for s in cp.sections() if s.upper().startswith('MODEL') and 'FILE' in cp[s]]
    else:
        files = [f for f in os.listdir(d) if f.endswith('.kn5')]
    return [os.path.join(d, f) for f in files if os.path.exists(os.path.join(d, f))]


def surfaces(cfg):
    """KEY -> (valid track, wall)."""
    out = dict(DEFAULT_SURF)
    p = os.path.join(TR, cfg['track'], cfg['surf'])
    if os.path.exists(p):
        cp = configparser.ConfigParser(strict=False)
        cp.read(p)
        for s in cp.sections():
            if 'KEY' not in cp[s]: continue
            k = cp[s]['KEY'].strip().upper()
            valid = cp[s].get('IS_VALID_TRACK', '1').strip() == '1'
            wall = k.startswith('WALL') or cp[s].get('FRICTION', '1').strip() in ('0', '0.0')
            out[k] = (valid, wall)
    return out


PHYS = re.compile(r'^\d+_?([A-Za-z].*)$')
DRIVABLE = re.compile(r'^(ROAD|ASPH|CONCRETE|KERB|CURB|PIT|TARMAC|CARPET)', re.I)


def norm_key(k): return re.sub(r'^[\d_]+', '', k.upper())


def surface_of(name, surf):
    """Surface of a physics mesh ('1ROAD_xx', '1ASPH_NEW', '2_KERB') -> (valid, wall), None for a visual mesh."""
    m = PHYS.match(name)
    if not m: return None
    w = m.group(1).upper()
    keys = sorted(((norm_key(k), v) for k, v in surf.items()), key=lambda kv: -len(kv[0]))
    for k, v in keys:
        if k and w.startswith(k): return v
    if w.startswith('WALL'): return (False, True)
    return (bool(DRIVABLE.match(w)), False)


_LOADED = {}


def load(key):
    if key in _LOADED: return _LOADED[key]
    _LOADED[key] = _load(key)
    return _LOADED[key]


def _load(key):
    cfg = LAYOUTS[key]
    surf = surfaces(cfg)
    course = json.load(open(COURSES + cfg['json']))
    phys, vis = [], []
    for f in kn5_files(cfg):
        for m in kn5.read(f, lambda n: True)['meshes']:
            if 'verts' not in m or not m['tris']: continue
            m['file'] = os.path.basename(f)
            (phys if surface_of(m['name'], surf) else vis).append(m)
    return cfg, surf, course, phys, vis


class Grid:
    def __init__(self, box, res=RES):
        self.x0, self.z0, self.x1, self.z1 = box
        self.res = res
        self.w = int((self.x1 - self.x0) / res) + 1
        self.h = int((self.z1 - self.z0) / res) + 1

    def px(self, x, z): return ((x - self.x0) / self.res, (self.z1 - z) / self.res)


def tris_xz(m, box):
    V = np.asarray(m['verts']); T = np.asarray(m['tris']).reshape(-1, 3)
    tri = V[T]  # (n,3,3)
    x, z = tri[:, :, 0], tri[:, :, 2]
    keep = (x.max(1) >= box[0]) & (x.min(1) <= box[2]) & (z.max(1) >= box[1]) & (z.min(1) <= box[3])
    return tri[keep]


def raster(g, tris, line=False):
    img = Image.new('L', (g.w, g.h), 0)
    d = ImageDraw.Draw(img)
    for t in tris:
        poly = [g.px(t[0, 0], t[0, 2]), g.px(t[1, 0], t[1, 2]), g.px(t[2, 0], t[2, 2])]
        if line: d.line(poly + [poly[0]], fill=1, width=2)
        else: d.polygon(poly, fill=1)
    return np.array(img, dtype=bool)


def base_path(cfg, course, step=0.5):
    """Smooth base path covering staging -> finish (+ margins): the course line itself (it follows the drift
    layout, which is not always the racing lap of the AI line), the AI line only from the staging to the start."""
    c = course['course']
    ref = np.array(c['refLine'], float)
    mid = lambda k: np.mean(np.array(c[k]), 0)
    st = mid('staging') if c.get('staging') else ref[0]
    head = np.zeros((0, 2))
    if np.hypot(*(ref[0] - st)) > 3:
        straight = np.array([st + (ref[0] - st) * k for k in np.linspace(0, 1, 40)[:-1]])
        head = straight
        if cfg['ai']:
            pts, _ = geom.read_ai(os.path.join(TR, cfg['track'], cfg['ai']))
            A = pts[:, [0, 2]]
            i_a = int(np.hypot(*(A - st).T).argmin()); i_b = int(np.hypot(*(A - ref[0]).T).argmin())
            seg = A[i_a:i_b + 1] if i_b > i_a else None
            if seg is not None and len(seg) > 2 and np.hypot(*(A[i_a] - st)) < 12 and np.hypot(*(A[i_b] - ref[0])) < 12:
                ln = np.hypot(*np.diff(seg, axis=0).T).sum()
                if ln < 2.0 * np.hypot(*(ref[0] - st)) + 20:
                    head = seg[:-1]
    f = st - (head[1] if len(head) > 1 else ref[0]); f = f / (np.linalg.norm(f) or 1)
    pre = np.array([st + f * k for k in (20, 15, 10, 5)])
    e = ref[-1] - ref[-4]; e /= np.linalg.norm(e)
    post = np.array([ref[-1] + e * k for k in (5, 10, 15, 20, 25)])
    P = np.vstack([pre, head, ref, post])
    P = C.resample(P, step)
    sig = 6 / step
    P = np.stack([C.smooth(P[:, 0], sig), C.smooth(P[:, 1], sig)], 1)
    return P


def edges(g, valid, wall, P, N, maxd=35.0, step=0.05, gap=2):
    """Distance along +N / -N to the end of the valid surface (or a wall). `gap` invalid pixels in a row to stop
    (mesh seams are one pixel wide)."""
    H, W = valid.shape
    ds = np.arange(0, maxd, step)
    out = np.zeros((len(P), 2))
    for j, sgn in enumerate((1, -1)):
        X = P[:, None, 0] + N[:, None, 0] * sgn * ds[None, :]
        Z = P[:, None, 1] + N[:, None, 1] * sgn * ds[None, :]
        u = ((X - g.x0) / g.res).astype(int); v = ((g.z1 - Z) / g.res).astype(int)
        inside = (u >= 0) & (u < W) & (v >= 0) & (v < H)
        u = np.clip(u, 0, W - 1); v = np.clip(v, 0, H - 1)
        ok = valid[v, u] & ~wall[v, u] & inside
        for i in range(len(P)):
            bad = ~ok[i]
            run = 0; stop = len(ds) - 1
            for k in range(len(ds)):
                if bad[k]:
                    run += 1
                    if run >= gap: stop = k - gap + 1; break
                else: run = 0
            out[i, j] = ds[max(0, stop)]
    return out[:, 0], -out[:, 1]  # hi (+N side), lo (-N side, negative)


def clean_edge(e, sign, k=14, cap=0.8):
    """Rays that leak into a side road (junctions) or stop on a seam give jumps: the room is kept within
    `cap` m of its running median over +-k samples (7 m), then lightly smoothed."""
    a = np.abs(e)
    m = np.array([np.median(a[max(0, i - k):i + k + 1]) for i in range(len(a))])
    a = np.clip(a, m - cap, m + cap)
    return sign * C.smooth(a, 1.5)


def turn_angle(L, cl, angle):
    """Drift angle to aim this clip with: `angle` where the line turns towards the clip side for a corde
    (away from it for an outer clip), 8 deg where it turns the other way (a transition)."""
    i = int(np.hypot(L[:, 0] - cl['x'], L[:, 1] - cl['z']).argmin())
    p, s, q = L[max(0, i - 8)], L[i], L[min(len(L) - 1, i + 8)]
    cross = (s[0] - p[0]) * (q[1] - s[1]) - (s[1] - p[1]) * (q[0] - s[0])
    f = q - p; off = (np.array([cl['x'], cl['z']]) - s) @ np.array([-f[1], f[0]])
    towards = np.sign(cross) == np.sign(off)
    ok = towards if cl['kind'] != 'outer' else not towards
    return angle if ok else 8.0


def first_pass(P, x, z, lo, hi, tol=8.0):
    """Station of (x, z) on the FIRST pass of the path near it after `lo` (a figure of eight passes twice)."""
    d = np.hypot(P[lo:hi, 0] - x, P[lo:hi, 1] - z)
    if not len(d): return lo
    lim = max(tol, d.min() + 1.0)
    idx = np.where(d <= lim)[0]
    run = [idx[0]]
    for k in idx[1:]:
        if k - run[-1] > 3: break
        run.append(k)
    run = np.array(run)
    return lo + int(run[d[run].argmin()])


CLIP_SPLINE = os.environ.get('LKS_LINE', 'clips') == 'clips'  # line from the clips only (LKS_LINE=road: older method along the road)  # the line is the smoothest curve through the clips only (not tied to the road's middle)
W1 = 0.0  # weight of the path length (a shorter line keeps to the inside of the bends)
JUNCTION_CAP = 0.8  # m of room above the running median the line may use (a junction mouth is cut off)
TURN_RULE = False  # the line turns the right way at every clip
TOL = {}      # station -> tolerance of its target (m), filled by drift_targets
W2, W3 = 1.0, 30.0  # weights of the curvature and of its change along the line
LINE_MARGIN = 0.5  # m between the line and the track limits
THROUGH_CLIPS = True  # the line goes through each clip (centre of a clip, centre line of a zone)
TOL_K = 0.35  # share of the clip radius the line may miss its target by (the bumper stays well inside the clip)


def drift_targets(P, N, F, lo, hi, clips, s0, s1, angle=DRIFT_ANGLE, angles=None):
    """Station -> centre offset. Front bumper on a corde, rear bumper on an outer clip or zone, at `angle`."""
    th = math.radians(angle)
    d_lat = HALF_LENGTH * math.sin(th)
    d_long = HALF_LENGTH * math.cos(th)
    fixed, info = {}, []
    cursor = s0
    step = np.hypot(*(P[1] - P[0]))
    for ci, c in enumerate(clips):
        a_c = math.radians(angles[ci]) if angles else th
        d_lat = HALF_LENGTH * math.sin(a_c); d_long = HALF_LENGTH * math.cos(a_c)
        if THROUGH_CLIPS: d_lat = d_long = 0.0
        sgn_long = -1 if c['kind'] != 'outer' else 1  # centre behind a corde, ahead of an outer clip
        pts = np.array(c['path'], float) if c.get('path') and len(c['path']) > 1 else np.array([[c['x'], c['z']]])
        if len(pts) > 1:
            seg = np.hypot(*np.diff(pts, axis=0).T); s = np.concatenate([[0], np.cumsum(seg)])
            t = np.arange(0, s[-1] + 1e-6, 0.5)
            pts = np.stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])], 1)
        per = {}
        sts = []
        i0 = first_pass(P, *pts[0], cursor, s1 + 1)
        for x, z in pts:
            i = DL.station_of(P, x, z, max(cursor, i0 - 15), min(s1 + 1, i0 + 15 + int(len(pts) * 0.5 / step) + 10))
            off = float((np.array([x, z]) - P[i]) @ N[i])
            side = 1.0 if off > 0 else -1.0  # the clip's side of the course path
            j = int(round(i + sgn_long * d_long / step))
            j = min(max(j, s0), s1)
            per.setdefault(j, []).append(off - side * d_lat)
            sts.append(i)
        for j, v in per.items():
            fixed[j] = float(np.mean(v))
            TOL[j] = 0.15 if THROUGH_CLIPS else TOL_K * c['r']
            if len(pts) == 1 and not THROUGH_CLIPS:  # a small clip: the same offset over +-1.5 m around it
                for dj in (-2, -1, 1, 2):
                    if s0 <= j + dj <= s1 and (j + dj) not in fixed: fixed[j + dj] = float(np.mean(v)); TOL[j + dj] = 0.15 if THROUGH_CLIPS else TOL_K * c['r']
        info.append((c['name'], min(sts), max(sts)))
        cursor = min(sts)
    return fixed, info


def solve_line_old(P, N, lo, hi, fixed, w2=6.0, w3=30.0, wc=2.0, margin=HALF_WIDTH + 0.25):
    n = len(P)
    D2 = DL.diff_matrix(n, 2); D3 = DL.diff_matrix(n, 3)
    blocks, rhs = [], []
    for D, w in ((D2, w2), (D3, w3)):
        for k in (0, 1):
            blocks.append(w * D * N[:, k][None, :]); rhs.append(-w * D @ P[:, k])
    idx = np.array(sorted(fixed), dtype=int)
    Cm = np.zeros((len(idx), n)); Cm[np.arange(len(idx)), idx] = wc
    blocks.append(Cm); rhs.append(wc * np.array([fixed[i] for i in idx]))
    A = np.vstack(blocks); b = np.concatenate(rhs)
    lo_b, hi_b = lo + margin, hi - margin
    # a target closer to the edge than the margin (a clip right at the edge) widens the bound there
    for i, t in fixed.items():
        for j in range(max(0, i - 8), min(n, i + 9)):
            lo_b[j] = min(lo_b[j], t - 0.05); hi_b[j] = max(hi_b[j], t + 0.05)
    ATA = A.T @ A; ATb = A.T @ b
    pins = {}
    for _ in range(80):
        free = np.array([i for i in range(n) if i not in pins], dtype=int)
        pc = np.array(sorted(pins), dtype=int)
        q = np.zeros(n)
        if len(pc): q[pc] = [pins[i] for i in pc]
        rhs_f = ATb[free] - (ATA[np.ix_(free, pc)] @ q[pc] if len(pc) else 0)
        q[free] = np.linalg.solve(ATA[np.ix_(free, free)] + 1e-9 * np.eye(len(free)), rhs_f)
        bad = [i for i in free if q[i] < lo_b[i] - 1e-3 or q[i] > hi_b[i] + 1e-3]
        if not bad: break
        for i in bad: pins[i] = float(np.clip(q[i], lo_b[i], hi_b[i]))
    return q


def solve_line(P, N, lo, hi, fixed, w2=None, w3=None, wc=None, tol=0.4, w0=0.002, margin=None, tols=None, w1=None):
    margin = LINE_MARGIN if margin is None else margin
    w2 = W2 if w2 is None else w2; w3 = W3 if w3 is None else w3
    """Smoothest line (curvature and curvature change, on the positions) with box constraints:
    the car inside the track (lo + margin <= q <= hi - margin) and within `tol` m of each clip target.
    A tiny pull to the middle of the track picks a natural line where the track is wide."""
    from scipy import sparse
    from scipy.optimize import lsq_linear
    n = len(P)
    def D(order):
        M = sparse.identity(n, format='csr')
        for _ in range(order):
            M = (M[1:] - M[:-1])
        return M
    rows, rhs = [], []
    w1 = W1 if w1 is None else w1
    for M, w in ((D(1), w1), (D(2), w2), (D(3), w3)):
        if not w: continue
        for k in (0, 1):
            rows.append(w * M @ sparse.diags(N[:, k])); rhs.append(-w * (M @ P[:, k]))
    rows.append(w0 * sparse.identity(n)); rhs.append(np.zeros(n))
    A = sparse.vstack(rows).toarray(); b = np.concatenate(rhs)
    lo_b = lo + margin; hi_b = hi - margin
    lo_b = np.minimum(lo_b, -0.2); hi_b = np.maximum(hi_b, 0.2)  # a very narrow spot: the middle stays possible
    # a clip closer to the edge than the margin: the margin opens gradually around it (no kink)
    for i, t in fixed.items():
        if 0 <= i < n:
            for j in range(max(0, i - 12), min(n, i + 13)):
                lo_b[j] = min(lo_b[j], t - 0.3 - 0.12 * abs(j - i))
                hi_b[j] = max(hi_b[j], t + 0.3 + 0.12 * abs(j - i))
    for i, t in fixed.items():
        if 0 <= i < n:
            tt = tols.get(i, tol) if tols else tol
            lo_b[i] = t - tt; hi_b[i] = t + tt
    bad = lo_b > hi_b
    lo_b[bad], hi_b[bad] = hi_b[bad] - 0.01, lo_b[bad] + 0.01
    import osqp
    As = sparse.csc_matrix(A)
    H = (As.T @ As).tocsc() * 2; f = -2 * (As.T @ b)
    m = osqp.OSQP()
    m.setup(P=H, q=f, A=sparse.identity(n, format='csc'), l=lo_b, u=hi_b, verbose=False, eps_abs=1e-9, eps_rel=1e-9, max_iter=200000, polish=True)
    r = m.solve()
    if r.x is None or not np.all(np.isfinite(r.x)):
        r = lsq_linear(A, b, bounds=(lo_b, hi_b), method='bvls', max_iter=20000)
    return r.x


TURN_H = 6          # stations (m) on each side to measure the line's turn at a clip
TURN_MIN = 1 / 90.0  # the line turns at least this much (1/m) the right way at each clip


def solve_line_qp(P, N, lo, hi, fixed, turns, tols=None, w2=1.0, w3=30.0, w0=0.002, margin=HALF_WIDTH + 0.25, iters=4):
    """Smoothest line with the car inside the track, each clip target within its tolerance, AND the line
    turning the right way at every clip: towards a corde (nose in), away from an outer clip (tail out).
    turns = [(station, sign)] with sign the wanted sign of cross(L[j]-L[j-h], L[j+h]-L[j]).
    Sequential QP (the turn is linearised around the previous line)."""
    import osqp
    from scipy import sparse
    n = len(P)
    def D(order):
        M = sparse.identity(n, format='csr')
        for _ in range(order): M = (M[1:] - M[:-1])
        return M
    rows, rhs = [], []
    for M, w in ((D(1), W1), (D(2), w2), (D(3), w3)):
        if not w: continue
        for k in (0, 1):
            rows.append(w * M @ sparse.diags(N[:, k])); rhs.append(-w * (M @ P[:, k]))
    rows.append(w0 * sparse.identity(n)); rhs.append(np.zeros(n))
    A = sparse.vstack(rows).tocsc(); b = np.concatenate(rhs)
    H = (A.T @ A).tocsc() * 2; f = -2 * (A.T @ b)
    lo_b = np.minimum(lo + margin, -0.2); hi_b = np.maximum(hi - margin, 0.2)
    for i, t in fixed.items():
        if 0 <= i < n:
            tt = tols.get(i, 0.4) if tols else 0.4
            lo_b[i] = t - tt; hi_b[i] = t + tt
    bad = lo_b > hi_b
    lo_b[bad], hi_b[bad] = hi_b[bad] - 0.01, lo_b[bad] + 0.01
    q = solve_line(P, N, lo, hi, fixed, tols=tols)  # start: smoothest line without the turn rule
    h = TURN_H
    for _ in range(iters):
        L = P + N * q[:, None]
        Cr, lc = [], []
        for j, sg in turns:
            if j - h < 0 or j + h >= n: continue
            for jj in (j - 2, j, j + 2):
                if jj - h < 0 or jj + h >= n: continue
                a = L[jj] - L[jj - h]; bb = L[jj + h] - L[jj]
                cr = a[0] * bb[1] - a[1] * bb[0]
                ga = np.array([bb[1], -bb[0]]); gb = np.array([-a[1], a[0]])
                g = np.zeros(n)
                g[jj - h] = -ga @ N[jj - h]; g[jj + h] = gb @ N[jj + h]; g[jj] = (ga - gb) @ N[jj]
                # sg * (cr + g.(q' - q)) >= TURN_MIN * h^3
                Cr.append(sg * g); lc.append(TURN_MIN * h ** 3 - sg * cr + sg * g @ q)
        Cm = sparse.vstack([sparse.identity(n, format='csc')] + ([sparse.csc_matrix(np.array(Cr))] if Cr else [])).tocsc()
        l = np.concatenate([lo_b, np.array(lc)]) if Cr else lo_b
        u = np.concatenate([hi_b, np.full(len(lc), np.inf)]) if Cr else hi_b
        m = osqp.OSQP()
        m.setup(P=H, q=f, A=Cm, l=l, u=u, verbose=False, eps_abs=1e-6, eps_rel=1e-6, max_iter=40000, polish=True)
        r = m.solve()
        if r.x is None or not np.all(np.isfinite(r.x)): break
        q = r.x
    return q


def radius(L):
    v1 = L[1:-1] - L[:-2]; v2 = L[2:] - L[1:-1]
    ang = np.arctan2(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0], (v1 * v2).sum(1))
    return np.hypot(*v1.T) / np.maximum(np.abs(ang), 1e-9), ang


def simplify(pts, tol=0.05):
    """Douglas-Peucker."""
    pts = np.asarray(pts)
    if len(pts) < 3: return pts
    if np.hypot(*(pts[0] - pts[-1])) < 1e-6:  # closed outline: split at the farthest point
        k = int(np.hypot(*(pts - pts[0]).T).argmax())
        if 0 < k < len(pts) - 1:
            return np.vstack([simplify(pts[:k + 1], tol), simplify(pts[k:], tol)[1:]])
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        ab = pts[b] - pts[a]; L = np.hypot(*ab) or 1e-9
        w = pts[a + 1:b] - pts[a]; d = np.abs(ab[0] * w[:, 1] - ab[1] * w[:, 0]) / L
        k = int(d.argmax())
        if d[k] > tol:
            keep[a + 1 + k] = True; stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return pts[keep]


SKIP_VIS = re.compile(r'tree|grass|bush|crowd|people|shadow|sky|cloud|fence|grill|banner|flag|light|lamp|glass|tyre|tire|cone|car_|horizon|terrain|land|mount', re.I)


def ground_marks(key, meshes, box):
    """Paint, skid marks and clip posts of the layout -> [(tris (n,3,3), kind, name, material, area)]."""
    paint_rx, post_rx = PAINT[key]
    out = []
    for m in meshes:
        nm, mat = m['name'], m.get('material', '')
        kind = None
        if re.search(paint_rx, nm, re.I) or re.search(paint_rx, mat, re.I): kind = 'paint'
        elif post_rx and (re.search(post_rx, nm, re.I) or re.search(post_rx, mat, re.I)): kind = 'post'
        elif SKID.search(nm) or SKID.search(mat): kind = 'skid'
        if not kind: continue
        tri = tris_xz(m, box)
        if not len(tri): continue
        a = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1).sum() / 2
        out.append((tri, kind, nm, mat, float(a)))
    return out


def analyze(key, angle=DRIFT_ANGLE, w2=15.0, w3=60.0, wc=8.0, verbose=True, course=None):
    cfg, surf, course0, phys, vis = load(key)
    course = course or course0
    c = course['course']
    ref = np.array(c['refLine'], float)
    P = base_path(cfg, course)
    allp = np.vstack([P, ref] + [np.array(c[k]) for k in ('staging', 'start', 'finish') if c.get(k)])
    box = (allp[:, 0].min() - 45, allp[:, 1].min() - 45, allp[:, 0].max() + 45, allp[:, 1].max() + 45)
    g = Grid(box)
    vt, wt = [], []
    for m in phys:
        sv = surface_of(m['name'], surf)
        t = tris_xz(m, box)
        if not len(t): continue
        if sv[1]: wt.append(t)
        elif sv[0]: vt.append(t)
    valid = raster(g, np.concatenate(vt)) if vt else np.zeros((g.h, g.w), bool)
    # walls high above the road (a bridge over the track) are not barriers for the cars
    if vt and wt:
        T = np.concatenate(vt)
        hmap = Image.new('I', (g.w, g.h), -100000)
        dh = ImageDraw.Draw(hmap)
        for t in T:
            dh.polygon([g.px(t[0, 0], t[0, 2]), g.px(t[1, 0], t[1, 2]), g.px(t[2, 0], t[2, 2])], fill=int(t[:, 1].mean() * 100))
        H = np.array(hmap)
        W = np.concatenate(wt)
        cx = ((W[:, :, 0].mean(1) - g.x0) / g.res).astype(int).clip(0, g.w - 1)
        cz = ((g.z1 - W[:, :, 2].mean(1)) / g.res).astype(int).clip(0, g.h - 1)
        road_y = H[cz, cx] / 100.0
        low = (road_y < -900) | (W[:, :, 1].min(1) - road_y < 2.0)
        wt = [W[low]]
    wall = raster(g, np.concatenate(wt), line=True) if wt and len(wt[0]) else np.zeros((g.h, g.w), bool)
    F, N = C.frames(P)
    hi, lo = edges(g, valid, wall, P, N)
    # the base path is moved to the middle of the track (twice): offsets from a base hugging an edge in a
    # hairpin would cross each other (cusps); from the centre line they cannot
    wide = np.median(hi - lo) > 22  # a paddock / stadium: the old line is the course, no middle to move to
    hi_raw, lo_raw = hi, lo
    hi = clean_edge(hi, 1); lo = clean_edge(lo, -1)
    for _ in range(0 if wide else 2):
        mid_off = C.smooth(np.clip((lo + hi) / 2, -4, 4), 8)  # not into the middle of a wide paddock
        P = P + N * mid_off[:, None]
        P = C.resample(P, 0.5); P = np.stack([C.smooth(P[:, 0], 6), C.smooth(P[:, 1], 6)], 1)
        F, N = C.frames(P)
        hi_raw, lo_raw = edges(g, valid, wall, P, N)
        hi = clean_edge(hi_raw, 1, k=40); lo = clean_edge(lo_raw, -1, k=40)  # the main road only (no junction)
    # course section on the base path (1 m stations for the line)
    P1 = C.resample(P, 1.0)
    F1, N1 = C.frames(P1)
    s_b = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    s_1 = np.arange(len(P1)) * 1.0
    lo1 = np.interp(s_1, s_b, lo); hi1 = np.interp(s_1, s_b, hi)
    # the line's bounds: the raw rays (a junction or a paddock really is room), narrowest over 12 m
    # side roads and junction mouths are not room for the line: the room is kept near its median over 20 m
    lo1r = np.interp(s_1, s_b, clean_edge(lo_raw, -1, k=40, cap=JUNCTION_CAP)); hi1r = np.interp(s_1, s_b, clean_edge(hi_raw, 1, k=40, cap=JUNCTION_CAP))
    mid = lambda gt: np.mean(np.array(gt), 0)
    # stations followed along the old line, in order (a layout can pass the same place twice)
    i = DL.station_of(P1, *ref[0], 0, len(P1) // 2)
    for x, z in ref[1:]:
        i = DL.station_of(P1, x, z, i, min(len(P1), i + 25))
    i_ref_end = i
    s0 = DL.station_of(P1, *mid(c['start']), 0, max(1, i_ref_end - 20))
    s1 = DL.station_of(P1, *mid(c['finish']), max(s0 + 5, i_ref_end - 40), min(len(P1), i_ref_end + 40))
    a, b = max(0, s0 - 30), min(len(P1), s1 + 20)
    # the line sees smooth bounds: the narrowest room over 12 m, smoothed (no kink on a notch of the edge)
    def env(e, f, k=6): return np.array([f(e[max(0, i - k):i + k + 1]) for i in range(len(e))])
    lo_l = C.smooth(env(lo1r, np.max), 4); hi_l = C.smooth(env(hi1r, np.min), 4)
    angles = None
    TOL.clear()
    for it in range(2):
        fixed, info = drift_targets(P1, N1, F1, lo1, hi1, c['clips'], s0, s1, angle, angles)
        fx = {i - a: v for i, v in fixed.items() if a <= i < b}
        tl = {i - a: v for i, v in TOL.items() if a <= i < b}
        turns = []
        for (nm, i_lo, i_hi), cl in zip(info, c['clips']):
            j = (i_lo + i_hi) // 2 - a
            off = float((np.array([cl['x'], cl['z']]) - P1[j + a]) @ N1[j + a])
            side = 1 if off > 0 else -1               # clip on the +N side of the path
            want = side if cl['kind'] != 'outer' else -side  # turn towards a corde, away from an outer clip
            # the normal N is the left of the direction of travel: cross > 0 turns left (towards +N)
            turns.append((j, want))
        q = solve_line_qp(P1[a:b], N1[a:b], lo_l[a:b], hi_l[a:b], fx, turns, tols=tl) if TURN_RULE else solve_line(P1[a:b], N1[a:b], lo_l[a:b], hi_l[a:b], fx, tols=tl)
        Lfull = P1[a:b] + N1[a:b] * q[:, None]
        line = Lfull[s0 - a:s1 - a + 1]
        # where the line turns away from a clip (a transition, e.g. the waist of a figure of eight),
        # the car is nearly straight there: the bumper is aimed with a small angle instead
        new = [turn_angle(line, cl, angle) for cl in c['clips']]
        if angles == new: break
        angles = new
    # the line runs from where it crosses the start gate to where it crosses the finish (1 m margin)
    def cross_idx(gate, rng):
        A, B = np.array(gate[0], float), np.array(gate[1], float); d = B - A; A, B = A - d * 0.2, B + d * 0.2
        o = lambda p, q, r: np.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
        for i in rng:
            p, q = Lfull[i], Lfull[i + 1]
            if o(p, q, A) != o(p, q, B) and o(A, B, p) != o(A, B, q): return i
        return None
    n = len(Lfull)
    i0 = cross_idx(c['start'], range(0, min(n - 1, s0 - a + 25)))
    i1 = cross_idx(c['finish'], range(n - 2, max(0, s1 - a - 25), -1))
    if i0 is not None and i1 is not None and i1 > i0:
        line = Lfull[max(0, i0 - 1):min(n, i1 + 3)]
    if CLIP_SPLINE:
        # the line from the clips only (see clip_line)
        line, _, _ = clip_line(g, valid, wall, c)
        Lfull = line
        a = s0
    rad, ang = radius(Lfull)
    res = dict(angles=angles, key=key, cfg=cfg, course=course, g=g, valid=valid, wall=wall, P=P, N=N, lo=lo, hi=hi, P1=P1, N1=N1, lo1=lo1, hi1=hi1,
               s0=s0, s1=s1, a=a, q=q, fixed=fixed, line=line, Lfull=Lfull, rad=rad, angle=angle, box=box)
    res['marks'] = ground_marks(key, vis + phys, box)
    res['limits'] = contours(g, valid, wall, np.vstack([P[:1], res['line'], P[-1:]]), P)
    if verbose: report(res)
    return res


def contours(g, valid, wall, line, base, near=22.0, min_len=4.0, tol=0.06):
    """Exact track limits: the outline of the valid surface (walls cut it), the parts within `near` m of the
    course, as polylines [[x, z], ...] simplified to `tol` m."""
    from scipy import ndimage
    from skimage import measure
    m = valid & ~ndimage.binary_dilation(wall, iterations=1)
    m = ndimage.binary_closing(m, iterations=2)   # mesh seams
    m = ndimage.binary_opening(m, iterations=1)   # specks
    lab, n = ndimage.label(m)
    # keep the surface the course is on
    keep = set()
    for x, z in np.vstack([line, base])[::4]:
        u, v = int((x - g.x0) / g.res), int((g.z1 - z) / g.res)
        if 0 <= v < lab.shape[0] and 0 <= u < lab.shape[1] and lab[v, u]: keep.add(int(lab[v, u]))
    m = np.isin(lab, list(keep))
    # distance to the course (coarse grid) to cut far away outlines
    pts = C.resample(np.vstack([base]), 1.0)
    out = []
    for cnt in measure.find_contours(m.astype(np.uint8), 0.5):
        xz = np.stack([g.x0 + cnt[:, 1] * g.res, g.z1 - cnt[:, 0] * g.res], 1)
        # distance of each contour point to the base path
        d = np.full(len(xz), 1e9)
        for k in range(0, len(pts), 200):
            q = pts[k:k + 200]
            d = np.minimum(d, np.min(np.hypot(xz[:, None, 0] - q[None, :, 0], xz[:, None, 1] - q[None, :, 1]), axis=1))
        ok = d <= near
        # runs of points close to the course
        i = 0
        while i < len(xz):
            if not ok[i]: i += 1; continue
            j = i
            while j < len(xz) and ok[j]: j += 1
            seg = xz[i:j]
            if len(seg) > 2 and np.hypot(*np.diff(seg, axis=0).T).sum() >= min_len:
                # the raster's 0.1 m stair steps are smoothed out (0.3 m), then the outline is simplified
                if len(seg) > 9: seg = np.stack([C.smooth(seg[:, 0], 3), C.smooth(seg[:, 1], 3)], 1)
                out.append(simplify(seg, tol))
            i = j
    return out


def dist_poly(path, x, z):
    p = np.asarray(path); best = 1e9
    for A, B in zip(p[:-1], p[1:]):
        v = B - A; k = np.clip(((x - A[0]) * v[0] + (z - A[1]) * v[1]) / max(v @ v, 1e-12), 0, 1)
        best = min(best, math.hypot(x - A[0] - v[0] * k, z - A[1] - v[1] * k))
    return best


def bumpers(L, angle, inside_sign):
    """Front/rear bumper points along the line at `angle`, nose towards the inside of the turn."""
    F, N = C.frames(L)
    th = math.radians(angle)
    H = F * math.cos(th) + N * (math.sin(th) * inside_sign[:, None])
    return L + H * HALF_LENGTH, L - H * HALF_LENGTH


def clip_side(res, cl):
    """+1/-1: the edge side (on the base path's normal) the clip is on."""
    P1, N1, lo1, hi1 = res['P1'], res['N1'], res['lo1'], res['hi1']
    i = DL.station_of(P1, cl['x'], cl['z'])
    off = float((np.array([cl['x'], cl['z']]) - P1[i]) @ N1[i])
    return 1.0 if off > 0 else -1.0


def clip_station_range(res, cl):
    """Stations of the line around this clip (its own pass)."""
    fixed = res['fixed']
    return None


def car_at(res, cl):
    """Bumper judged for this clip along the line: front for a corde (nose towards the clip),
    rear for an outer clip (tail towards the clip), at the analysis drift angle."""
    L = res['line']
    F, _ = C.frames(L)
    i = np.array([DL.station_of(res['P1'], x, z) for x, z in L])
    side = clip_side(res, cl)
    Nn = res['N1'][i] * side  # towards the clip's edge
    k = res['course']['course']['clips'].index(cl) if cl in res['course']['course']['clips'] else -1
    th = math.radians(res['angles'][k] if res.get('angles') and k >= 0 else res['angle'])
    if cl['kind'] == 'outer':
        H = F * math.cos(th) - Nn * math.sin(th)  # nose away from the outer edge
        return L - H * HALF_LENGTH
    H = F * math.cos(th) + Nn * math.sin(th)
    return L + H * HALF_LENGTH


def report(res):
    L = res['line']; c = res['course']['course']
    r = res['rad'][res['s0'] - res['a']:res['s1'] - res['a']]
    print(f"== {res['key']}: ligne {len(L)} m, rayon mini {r.min():.1f} m, {len(res['marks'])} marquages")
    out = []
    for cl in c['clips']:
        if cl.get('path'):
            ds = np.array([dist_poly(L, x, z) for x, z in cl['path']])
            out.append((cl['name'], float(ds.max())))
            print(f"  {cl['name']:8s} {cl['kind']:5s} zone: ligne→axe de la zone moyenne {ds.mean():.2f} m (max {ds.max():.2f})")
        else:
            d = dist_poly(L, cl['x'], cl['z'])
            out.append((cl['name'], d))
            print(f"  {cl['name']:8s} {cl['kind']:5s} r={cl['r']}: ligne→clip {d:.2f} m")
    return out


# ---------------------------------------------------------------------------------------------
# Line from the clips only: the smoothest curve through the start gate, every clip (centre of a
# clip, centre line of a zone) in order, and the finish gate. The track only matters where the
# curve would leave it: there it is pushed back inside (distance to the edge >= margin).

def control_points(c, step_zone=3.0):
    """[(x, z)] the line must go through, in order."""
    mid = lambda g: np.mean(np.array(g, float), 0)
    pts = [mid(c['start'])]
    for cl in c['clips']:
        if cl.get('path') and len(cl['path']) > 1:
            P = np.array(cl['path'], float)
            s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
            t = np.linspace(0, s[-1], max(2, int(round(s[-1] / step_zone)) + 1))
            pts += list(np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], 1))
        else:
            pts.append(np.array([cl['x'], cl['z']], float))
    pts.append(mid(c['finish']))
    # a zone that starts at the start gate or ends at the finish: the gate stands for its first / last point
    def gate_dist(p, g):
        a, b = np.array(g[0], float), np.array(g[1], float); v = b - a
        k = np.clip((p - a) @ v / (v @ v), 0, 1); return np.hypot(*(a + v * k - p))
    inner = [p for p in pts[1:-1] if gate_dist(p, c['start']) > 3 and gate_dist(p, c['finish']) > 3]
    return np.array([pts[0]] + inner + [pts[-1]])


def track_distance(g, valid, wall, line):
    """Distance (m) to the edge of the track the line is on, and its gradient (towards the inside)."""
    from scipy import ndimage
    m = valid & ~ndimage.binary_dilation(wall, iterations=1)
    m = ndimage.binary_closing(m, iterations=2)
    lab, n = ndimage.label(m)
    keep = set()
    for x, z in line[::5]:
        u, v = int((x - g.x0) / g.res), int((g.z1 - z) / g.res)
        if 0 <= v < lab.shape[0] and 0 <= u < lab.shape[1] and lab[v, u]: keep.add(int(lab[v, u]))
    m = np.isin(lab, list(keep))
    din = ndimage.distance_transform_edt(m) * g.res
    dout = ndimage.distance_transform_edt(~m) * g.res
    D = np.where(m, din, -dout)
    gy, gx = np.gradient(D)
    return D, gx / g.res, gy / g.res


def sample_field(g, F, x, z):
    u = np.clip(((x - g.x0) / g.res).astype(int), 0, F.shape[1] - 1)
    v = np.clip(((g.z1 - z) / g.res).astype(int), 0, F.shape[0] - 1)
    return F[v, u]


def clip_line(g, valid, wall, c, margin=0.6, w2=1.0, w3=6.0, step=1.0, iters=25):
    import osqp
    from scipy import sparse
    Q = control_points(c)
    # stations: ~1 m apart along the polyline through the control points; each control point pinned
    seg = np.hypot(*np.diff(Q, axis=0).T)
    # lead-in before the start gate and run-out after the finish (free, so the line crosses the gates
    # wherever it flows; they are cut off afterwards)
    LEAD = 12
    f0 = (Q[1] - Q[0]) / (np.linalg.norm(Q[1] - Q[0]) or 1); f1 = (Q[-1] - Q[-2]) / (np.linalg.norm(Q[-1] - Q[-2]) or 1)
    pts = [Q[0] - f0 * step * k for k in range(LEAD, 0, -1)] + [Q[0]]
    pin = [LEAD]
    for i in range(len(Q) - 1):
        k = max(1, int(round(seg[i] / step)))
        for j in range(1, k + 1): pts.append(Q[i] + (Q[i + 1] - Q[i]) * j / k)
        pin.append(len(pts) - 1)
    pts += [Q[-1] + f1 * step * k for k in range(1, LEAD + 1)]
    L0 = np.array(pts); n = len(L0)
    # a smooth first guess (pins kept) so that the track test sees a curve, not a polyline
    def D(order):
        M = sparse.identity(n, format='csr')
        for _ in range(order): M = (M[1:] - M[:-1])
        return M
    D1, D2, D3 = D(1), D(2), D(3)
    # objective on X = [x(0..n-1), z(0..n-1)]: curvature, its change, and even spacing (tiny)
    blk = lambda M, w: sparse.block_diag([w * M, w * M])
    A = sparse.vstack([blk(D2, w2), blk(D3, w3), blk(D1, 0.05)]).tocsc()
    H = (A.T @ A).tocsc() * 2
    f = np.zeros(2 * n)
    # pins: equality on x and z for the clips; the first and last points slide along their gate
    inner = pin[1:-1]
    Ip = sparse.csr_matrix((np.ones(len(inner)), (np.arange(len(inner)), inner)), shape=(len(inner), n))
    rows = [sparse.block_diag([Ip, Ip]).tocsr()]
    lo_e = [np.concatenate([L0[inner, 0], L0[inner, 1]])]; up_e = [lo_e[0]]
    for i, gate in ((pin[0], c['start']), (pin[-1], c['finish'])):
        a, b = np.array(gate[0], float), np.array(gate[1], float)
        u = (b - a) / np.linalg.norm(b - a); nn = np.array([-u[1], u[0]])
        R = sparse.csr_matrix(([nn[0], nn[1], u[0], u[1]], ([0, 0, 1, 1], [i, n + i, i, n + i])), shape=(2, 2 * n))
        rows.append(R)
        lo_e.append(np.array([nn @ a, u @ a + 0.8])); up_e.append(np.array([nn @ a, u @ b - 0.8]))
    Apin = sparse.vstack(rows).tocsc()
    bpin = np.concatenate(lo_e); bpin_u = np.concatenate(up_e)
    D, Gx, Gy = track_distance(g, valid, wall, L0)
    X = np.concatenate([L0[:, 0], L0[:, 1]])
    pinset = set(inner)
    active = {}
    for it in range(iters):
        Cs, ls = [Apin], [bpin]; us = [bpin_u]
        if active:
            idx = sorted(active)
            rows = []
            lo = []
            for r, i in enumerate(idx):
                x, z = X[i], X[n + i]
                d = float(sample_field(g, D, np.array([x]), np.array([z]))[0])
                gx = float(sample_field(g, Gx, np.array([x]), np.array([z]))[0]); gz = -float(sample_field(g, Gy, np.array([x]), np.array([z]))[0])
                nn = np.hypot(gx, gz) or 1.0; gx, gz = gx / nn, gz / nn
                # d + grad . (p - p0) >= margin   (linearised distance to the edge)
                rows.append((r, i, gx)); rows.append((r, n + i, gz))
                lo.append(margin - d + gx * x + gz * z)
            R = sparse.csr_matrix(([v for _, _, v in rows], ([r for r, _, _ in rows], [c_ for _, c_, _ in rows])), shape=(len(idx), 2 * n))
            Cs.append(R); ls.append(np.array(lo)); us.append(np.full(len(idx), np.inf))
        Cm = sparse.vstack(Cs).tocsc()
        m = osqp.OSQP()
        m.setup(P=H, q=f, A=Cm, l=np.concatenate(ls), u=np.concatenate(us), verbose=False, eps_abs=1e-7, eps_rel=1e-7, max_iter=100000, polish=True)
        r = m.solve()
        if r.x is None: break
        X = r.x
        L = np.stack([X[:n], X[n:]], 1)
        d = sample_field(g, D, L[:, 0], L[:, 1])
        bad = [i for i in range(pin[0], pin[-1] + 1) if d[i] < margin - 0.05 and i not in pinset]
        if not bad: break
        # every point near a violation gets the constraint (a whole stretch, not a single point)
        for i in bad:
            for j in range(max(pin[0], i - 3), min(pin[-1] + 1, i + 4)):
                if j not in pinset: active[j] = True
    L = np.stack([X[:n], X[n:]], 1)
    L = L[pin[0]:pin[-1] + 1]  # from the start gate to the finish gate
    d = sample_field(g, D, L[:, 0], L[:, 1])
    return L, d, Q
