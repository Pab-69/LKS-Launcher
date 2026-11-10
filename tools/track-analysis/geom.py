"""Physics surfaces of a track → raster masks (road, walls) in the XZ plane."""
import re, json, sys, os, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
import kn5

DRIVE = re.compile(r'^\d+_?(ROAD|ASPH|KERB|CONCRETE|CARPET|TARMAC|CURB|PITS?|PITROAD)', re.I)
WALL = re.compile(r'^\d+_?WALL', re.I)

def load_physics(paths):
    want = lambda n: bool(DRIVE.match(n) or WALL.match(n))
    meshes = []
    for p in paths:
        meshes += [m for m in kn5.read(p, want)['meshes'] if 'verts' in m]
    return meshes

class Grid:
    def __init__(self, meshes, res=0.25, pad=10):
        pts = np.array([v for m in meshes for v in m['verts']])
        self.x0, self.z0 = pts[:, 0].min() - pad, pts[:, 2].min() - pad
        self.x1, self.z1 = pts[:, 0].max() + pad, pts[:, 2].max() + pad
        self.res = res
        self.w = int((self.x1 - self.x0) / res) + 1
        self.h = int((self.z1 - self.z0) / res) + 1
    def px(self, x, z): return ((x - self.x0) / self.res, (self.z1 - z) / self.res)
    def world(self, u, v): return (self.x0 + u * self.res, self.z1 - v * self.res)

def rasterize(grid, meshes, pattern, walls=False):
    img = Image.new('1', (grid.w, grid.h), 0)
    d = ImageDraw.Draw(img)
    for m in meshes:
        if not pattern.match(m['name']): continue
        V = m['verts']; T = m['tris']
        for i in range(0, len(T) - 2, 3):
            a, b, c = V[T[i]], V[T[i + 1]], V[T[i + 2]]
            poly = [grid.px(a[0], a[2]), grid.px(b[0], b[2]), grid.px(c[0], c[2])]
            if walls: d.line(poly + [poly[0]], fill=1, width=2)
            else: d.polygon(poly, fill=1)
    return np.array(img, dtype=bool)

def read_ai(path):
    import struct
    b = open(path, 'rb').read()
    n = struct.unpack_from('<i', b, 4)[0]
    pts = [struct.unpack_from('<ffff', b, 16 + i * 20) for i in range(n)]
    o = 16 + n * 20
    sides = None
    if o + 4 <= len(b) and struct.unpack_from('<i', b, o)[0] == n:
        o += 4
        sides = [struct.unpack_from('<ff', b, o + i * 72 + 20) for i in range(n)]
    return np.array([[p[0], p[1], p[2], p[3]] for p in pts]), (np.array(sides) if sides else None)
