import os, sys, collections, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analysis as v2
key = sys.argv[1]
cfg, surf, course, phys, vis = v2.load(key)
c = course['course']
pts = []
for cl in c['clips']:
    pts.append((cl['name'], cl['x'], cl['z']))
for k in ('staging', 'start', 'finish'):
    if c.get(k): m = np.mean(np.array(c[k]), 0); pts.append((k, m[0], m[1]))
cnt = collections.Counter()
for name, x, z in pts:
    hits = []
    for m in phys + vis:
        if m['name'].upper().startswith('AC_'): continue
        V = np.asarray(m['verts']); T = np.asarray(m['tris']).reshape(-1, 3)
        cen = V[T].mean(1)
        near = np.hypot(cen[:, 0] - x, cen[:, 2] - z) < 3.0
        if not near.any(): continue
        tri = V[T[near]]
        a = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); area = np.linalg.norm(a, axis=1).sum() / 2
        tot = np.linalg.norm(np.cross(V[T][:, 1] - V[T][:, 0], V[T][:, 2] - V[T][:, 0]), axis=1).sum() / 2
        hits.append((round(tot, 1), m['name'], m.get('material', ''), m['file'], int(near.sum())))
    hits.sort()
    print(name, [h for h in hits if h[0] < 3000][:8])
