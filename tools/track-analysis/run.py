"""Analyse a layout, check it, draw the control image and (with --export) write the official course.

  python3 run.py cha,cro            # analyse + images in out/
  python3 run.py cha --export       # also writes src/main/telemetry/courses/<file>.json
"""
import sys, json, copy, math, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analysis as v2, render as R, course as C

def r2(v): return round(float(v), 2)

def run(key, snap=True, export=False, **kw):
    res = v2.analyze(key, verbose=False, **kw)
    pieces = R.paint_pieces(res)
    course = copy.deepcopy(res['course'])
    moved = []
    if snap:
        for cl in course['course']['clips']:
            if cl.get('path'): continue
            p = np.array([cl['x'], cl['z']])
            near = [q for q in pieces if q['kind'] == 'paint' and q['size'] <= 6 and np.hypot(*(q['c'] - p)) < 1.5]
            if not near: continue
            q = min(near, key=lambda q: np.hypot(*(q['c'] - p)))
            d = float(np.hypot(*(q['c'] - p)))
            if d > 0.05:
                moved.append((cl['name'], round(d, 2)))
                cl['x'], cl['z'] = r2(q['c'][0]), r2(q['c'][1])
        if moved:
            res = v2.analyze(key, verbose=False, course=course, **kw)
    print(f'## {key} recalés : {moved}')
    out = v2.report(res)
    for row in R.check_clips(res, R.paint_pieces(res)): print('   marquage', row)
    R.sheet(res, os.path.join(v2.OUT, f'{key}.png'))
    if export: write(res)
    return res

def write(res):
    cfg = res['cfg']; data = copy.deepcopy(res['course']); c = data['course']
    L = res['line']
    # line every ~1.5 m
    idx = list(range(0, len(L), 3 if len(L) > 1 and np.hypot(*(L[1] - L[0])) < 0.75 else 2))
    if idx[-1] != len(L) - 1: idx.append(len(L) - 1)
    Ls = C.resample(L, 1.5)
    c['refLine'] = [[r2(x), r2(z)] for x, z in list(Ls) + [L[-1]]]
    c['limits'] = [[[round(float(x), 1), round(float(z), 1)] for x, z in L] for L in res['limits']]
    # gates a bit longer than the panels (a line along the edge still crosses them)
    for k in ('start', 'finish'):
        a, b = np.array(c[k][0], float), np.array(c[k][1], float); d = (b - a) / np.linalg.norm(b - a)
        if not c.get('gatesExtended'):
            c[k] = [[r2(x), r2(z)] for x, z in (a - d * 1.5, b + d * 1.5)]
    c['gatesExtended'] = True
    c['analysis'] = 2
    data['course'] = c
    json.dump(data, open(v2.COURSES + cfg['json'], 'w'), ensure_ascii=False, separators=(',', ':'))
    print('   écrit', cfg['json'], 'ligne', len(c['refLine']), 'pts, limites', len(c['limits'][0]), '+', len(c['limits'][1]), 'pts')

if __name__ == '__main__':
    for k in sys.argv[1].split(','):
        run(k, export='--export' in sys.argv)
