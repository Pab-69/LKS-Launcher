"""Rendering and checks of a v2 analysis."""
import sys, os, math, json, numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import analysis as v2, course as C, drift_line as DL

FONT = None
for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
    if os.path.exists(f): FONT = f; break
def font(n): return ImageFont.truetype(FONT, n) if FONT else ImageFont.load_default()

COL = dict(bg=(18, 18, 20), road=(78, 78, 82), wall=(200, 50, 50), paint=(245, 245, 240), skid=(28, 28, 30), post=(255, 150, 40),
           limit=(255, 170, 60), line=(60, 255, 140), inner=(80, 200, 255), outer=(255, 80, 220), staging=(175, 110, 255), start=(255, 215, 0), finish=(255, 60, 60), car=(255, 255, 255))


def comps(tri, merge=0.03):
    """Connected pieces of a triangle soup (n,3,3) -> list of index arrays."""
    keys = np.round(tri.reshape(-1, 3) / merge).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1, 3)
    parent = np.arange(inv.max() + 1)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b, c in inv:
        ra = find(a); parent[find(b)] = ra; parent[find(c)] = ra
    roots = np.array([find(a) for a in inv[:, 0]])
    return [np.where(roots == r)[0] for r in np.unique(roots)]


def paint_pieces(res):
    out = []
    for tri, kind, nm, mat, area in res['marks']:
        if kind == 'skid': continue
        for idx in comps(tri):
            t = tri[idx]
            a = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1) / 2
            if a.sum() <= 0: continue
            cen = (t.mean(1)[:, [0, 2]] * a[:, None]).sum(0) / a.sum()
            xz = t[:, :, [0, 2]].reshape(-1, 2)
            out.append(dict(kind=kind, name=nm, c=cen, area=float(a.sum()), size=float(np.ptp(xz, 0).max()), tris=t))
    return out


def check_clips(res, pieces):
    rows = []
    for cl in res['course']['course']['clips']:
        p = np.array([cl['x'], cl['z']])
        if cl.get('path'):
            # zone: mean distance from its path to the nearest painted triangle (strip, band or arc)
            T = np.vstack([q['tris'].mean(1)[:, [0, 2]] for q in pieces if q['kind'] == 'paint'] or [np.zeros((0, 2))])
            path = np.array(cl['path'])
            if len(T):
                dd = np.array([np.min(np.hypot(*(T - q).T)) for q in path])
                rows.append((cl['name'], cl['kind'], 'zone', round(float(np.median(dd)), 2), 'paint', f'max {dd.max():.2f}', None))
                continue
        near = [q for q in pieces if np.hypot(*(q['c'] - p)) < 6 and q['size'] < 25]
        best = min(near, key=lambda q: np.hypot(*(q['c'] - p))) if near else None
        d = float(np.hypot(*(best['c'] - p))) if best else None
        rows.append((cl['name'], cl['kind'], 'zone' if cl.get('path') else 'point', None if d is None else round(d, 2), best['kind'] if best else None, best['name'] if best else None, None if not best else round(best['size'], 1)))
    return rows


class View:
    def __init__(self, box, ppm):
        self.x0, self.z0, self.x1, self.z1 = box; self.ppm = ppm
        self.W = int((self.x1 - self.x0) * ppm); self.H = int((self.z1 - self.z0) * ppm)
    def p(self, x, z): return ((x - self.x0) * self.ppm, (self.z1 - z) * self.ppm)


def draw(res, box, ppm, labels=True, cars=None, title=None, pieces=None):
    v = View(box, ppm)
    g = res['g']
    # surfaces from the 0.1 m raster
    u0 = int((v.x0 - g.x0) / g.res); u1 = int((v.x1 - g.x0) / g.res); w0 = int((g.z1 - v.z1) / g.res); w1 = int((g.z1 - v.z0) / g.res)
    pad = lambda a, lo, hi: (max(lo, a), )
    valid = np.zeros((max(1, w1 - w0), max(1, u1 - u0)), bool); wall = valid.copy()
    su0, su1, sw0, sw1 = max(0, u0), min(g.w, u1), max(0, w0), min(g.h, w1)
    if su1 > su0 and sw1 > sw0:
        valid[sw0 - w0:sw1 - w0, su0 - u0:su1 - u0] = res['valid'][sw0:sw1, su0:su1]
        wall[sw0 - w0:sw1 - w0, su0 - u0:su1 - u0] = res['wall'][sw0:sw1, su0:su1]
    rgb = np.zeros(valid.shape + (3,), np.uint8); rgb[:] = COL['bg']; rgb[valid] = COL['road']; rgb[wall] = COL['wall']
    im = Image.fromarray(rgb).resize((v.W, v.H), Image.NEAREST if ppm >= 10 else Image.BILINEAR)
    d = ImageDraw.Draw(im, 'RGBA')
    # ground marks
    for tri, kind, nm, mat, area in sorted(res['marks'], key=lambda m: {'skid': 0, 'paint': 1, 'post': 2}[m[1]]):
        col = COL[kind] + ((150,) if kind == 'skid' else (255,))
        for t in tri:
            d.polygon([v.p(t[0, 0], t[0, 2]), v.p(t[1, 0], t[1, 2]), v.p(t[2, 0], t[2, 2])], fill=col)
    lw = max(1, int(ppm * 0.12))
    # limits
    for L in res['limits']: d.line([v.p(x, z) for x, z in L], fill=COL['limit'] + (255,), width=max(2, lw))
    # clips
    c = res['course']['course']
    for cl in c['clips']:
        col = COL['inner' if cl['kind'] != 'outer' else 'outer']
        if cl.get('path'):
            pts = [v.p(x, z) for x, z in cl['path']]
            d.line(pts, fill=col + (90,), width=max(2, int(cl['r'] * 2 * ppm)))
            d.line(pts, fill=col + (255,), width=max(1, lw))
        a, b = v.p(cl['x'], cl['z']); rr = cl['r'] * ppm
        d.ellipse([a - rr, b - rr, a + rr, b + rr], outline=col + (255,), width=max(2, lw))
        d.ellipse([a - 3, b - 3, a + 3, b + 3], fill=col + (255,))
        if labels: d.text((a + rr + 4, b - 10), cl['name'], fill=col + (255,), font=font(max(12, min(22, int(ppm * 1.2)))))
    # gates
    GATE = {'staging': 'Départ', 'start': 'Début du drift', 'finish': 'Arrivée'}
    for k in ('staging', 'start', 'finish'):
        if not c.get(k): continue
        d.line([v.p(*q) for q in c[k]], fill=COL[k] + (255,), width=max(3, int(ppm * 0.3)))
        if labels:
            a, b = v.p(*c[k][1]); d.text((a + 6, b - 8), GATE[k], fill=COL[k] + (255,), font=font(max(13, min(22, int(ppm * 1.2)))))
    # line
    d.line([v.p(x, z) for x, z in res['line']], fill=COL['line'] + (255,), width=max(2, int(ppm * 0.18)))
    for car in cars or []:
        d.polygon([v.p(x, z) for x, z in car], outline=COL['car'] + (255,), width=2)
    if title: d.text((10, 8), title, fill=(255, 255, 255, 255), font=font(22))
    return im


def car_box(cx, cz, hx, hz):
    """4.4 x 1.9 m rectangle, centre (cx, cz), heading unit (hx, hz)."""
    nx, nz = -hz, hx; L, W = v2.HALF_LENGTH + 0.2, v2.HALF_WIDTH
    return [(cx + hx * a + nx * b, cz + hz * a + nz * b) for a, b in ((L, W), (L, -W), (-L, -W), (-L, W))]


def closest_car(res, cl):
    bump = v2.car_at(res, cl)
    L = res['line']
    tgt = np.array(cl['path']) if cl.get('path') else np.array([[cl['x'], cl['z']]])
    dmin = np.array([np.min(np.hypot(*(tgt - b).T)) for b in bump])
    i = int(dmin.argmin())
    h = bump[i] - L[i]
    h = h / np.linalg.norm(h) * (1 if cl['kind'] != 'outer' else -1)
    return car_box(L[i][0], L[i][1], h[0], h[1]), float(dmin[i])


def sheet(res, out, tile_m=26, tile_ppm=26, cols=4):
    c = res['course']['course']
    allp = np.vstack([res['line']] + [np.array(c[k]) for k in ('staging', 'start', 'finish') if c.get(k)])
    x0, z0 = allp.min(0) - 18; x1, z1 = allp.max(0) + 18
    ppm = min(1700 / (x1 - x0), 1500 / (z1 - z0))
    top = draw(res, (x0, z0, x1, z1), ppm, title=f"{res['course']['name']} : limites de piste (orange), clips (bleu = corde, rose = extérieur), ligne (vert), départ (violet), début du drift (jaune), arrivée (rouge)")
    tiles = []
    for cl in c['clips']:
        car, dd = closest_car(res, cl)
        cx, cz = (np.mean(np.array(cl['path']), 0) if cl.get('path') and np.ptp(np.array(cl['path']), 0).max() < tile_m * 0.7 else (cl['x'], cl['z']))
        half = tile_m / 2
        if cl.get('path'):
            P = np.array(cl['path']); span = np.ptp(P, 0).max()
            if span > tile_m * 0.7: half = span / 2 + 6; cx, cz = P.mean(0)
        ppm_t = tile_ppm * (tile_m / 2) / half
        im = draw(res, (cx - half, cz - half, cx + half, cz + half), ppm_t, cars=[car], title=f"{cl['name']} ({'corde' if cl['kind'] != 'outer' else 'extérieur'}) · pare-chocs à {dd:.2f} m")
        tiles.append(im.resize((int(tile_m * tile_ppm), int(tile_m * tile_ppm))))
    for k in ('staging', 'start', 'finish'):
        if not c.get(k): continue
        cx, cz = np.mean(np.array(c[k]), 0); half = tile_m / 2
        name = {'staging': 'Ligne de départ', 'start': 'Début du drift', 'finish': 'Arrivée'}[k]
        tiles.append(draw(res, (cx - half, cz - half, cx + half, cz + half), tile_ppm, title=name).resize((int(tile_m * tile_ppm), int(tile_m * tile_ppm))))
    T = int(tile_m * tile_ppm)
    rows = math.ceil(len(tiles) / cols)
    W = max(top.width, cols * T)
    S = Image.new('RGB', (W, top.height + rows * T), COL['bg'])
    S.paste(top, (0, 0))
    for i, t in enumerate(tiles):
        S.paste(t, ((i % cols) * T, top.height + (i // cols) * T))
    S.save(out)
    return out
