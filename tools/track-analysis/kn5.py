"""Minimal KN5 reader (Assetto Corsa models): skips textures, reads materials and the node tree,
returns meshes with world-space vertices (node transforms applied)."""
import struct, sys

class R:
    def __init__(self, f): self.f = f
    def i32(self): return struct.unpack('<i', self.f.read(4))[0]
    def u32(self): return struct.unpack('<I', self.f.read(4))[0]
    def f32(self): return struct.unpack('<f', self.f.read(4))[0]
    def byte(self): return self.f.read(1)[0]
    def s(self): n = self.i32(); return self.f.read(n).decode('utf8', 'replace')
    def skip(self, n): self.f.seek(n, 1)

def mat_mul(a, b):  # row-major 4x4, row vectors (DirectX style): v * a * b
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4)) for r in range(4) for c in range(4)]

IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

def read(path, want=lambda name: True, with_geometry=True):
    f = open(path, 'rb')
    r = R(f)
    magic = f.read(6)
    assert magic == b'sc6969', magic
    version = r.i32()
    if version > 5: r.i32()
    ntex = r.i32()
    # some exporters write a 4-byte pad after the count (0, then the first record's type 1)
    pos = f.tell(); a, b = struct.unpack('<ii', f.read(8)); f.seek(pos)
    if ntex and a == 0 and b in (0, 1):
        r.skip(4)  # empty placeholder entry counted in ntex
        ntex -= 1
    for _ in range(ntex):  # textures
        r.i32(); r.s(); size = r.i32(); r.skip(size)
    materials = []
    for _ in range(r.i32()):
        name = r.s(); shader = r.s(); r.byte()
        if version > 4: r.byte()
        r.i32()
        for _ in range(r.i32()): r.s(); r.skip(4 + 8 + 12 + 16)
        for _ in range(r.i32()): r.s(); r.i32(); r.s()
        materials.append((name, shader))
    meshes = []
    dummies = []

    def node(parent):
        kind = r.i32(); name = r.s(); children = r.i32(); r.byte()
        world = parent
        if kind == 1:
            m = [r.f32() for _ in range(16)]
            world = mat_mul(m, parent)
            if name.upper().startswith('AC_'):
                dummies.append({'name': name, 'pos': (world[12], world[13], world[14]), 'z': (world[8], world[9], world[10]), 'x': (world[0], world[1], world[2])})
        elif kind in (2, 3):
            r.byte(); r.byte(); r.byte()
            if kind == 3:
                for _ in range(r.i32()): r.s(); r.skip(64)
            n = r.i32()
            stride = 44 if kind == 2 else 44 + 32
            raw = f.read(n * stride)
            ni = r.i32()
            idx = f.read(ni * 2)
            mat = r.i32(); r.i32(); r.f32(); r.f32(); r.skip(16); r.byte()
            if kind == 2 and want(name) and with_geometry:
                verts = []
                for k in range(n):
                    x, y, z = struct.unpack_from('<fff', raw, k * stride)
                    verts.append((x * world[0] + y * world[4] + z * world[8] + world[12],
                                  x * world[1] + y * world[5] + z * world[9] + world[13],
                                  x * world[2] + y * world[6] + z * world[10] + world[14]))
                tris = struct.unpack('<%dH' % ni, idx)
                meshes.append({'name': name, 'material': materials[mat][0] if 0 <= mat < len(materials) else '', 'verts': verts, 'tris': tris})
            elif kind == 2:
                meshes.append({'name': name, 'material': materials[mat][0] if 0 <= mat < len(materials) else '', 'nverts': n})
        for _ in range(children): node(world)

    node(IDENT)
    return {'version': version, 'materials': materials, 'meshes': meshes, 'dummies': dummies}

if __name__ == '__main__':
    import re, collections
    d = read(sys.argv[1], with_geometry=False)
    print('version', d['version'], 'meshes', len(d['meshes']))
    phys = [m for m in d['meshes'] if re.match(r'^\d+[A-Z]', m['name'])]
    c = collections.Counter(re.sub(r'[\d_.\-]+$', '', re.match(r'^\d+([A-Za-z]+)', m['name']).group(1).upper()) for m in phys)
    print('physics meshes', len(phys), c.most_common(20))
    for m in phys[:15]: print(' ', m['name'], m.get('nverts'))
