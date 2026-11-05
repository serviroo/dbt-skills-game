import bpy
import bmesh
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_kit import (
    TAU, V, Bakeable, assemble, bake, catmull_rom, dress, export, glow, hexrgb, metaball, new_mesh, on_surface,
    shipping, slim, start, tris, unwrap,
)

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else '.')
random.seed(7)

SCENE = start()
COLL = bpy.data.collections.new('moth')
SCENE.collection.children.link(COLL)


def is_socket(v):
    return hasattr(v, 'is_output')


class Nodes(Bakeable):
    def __init__(self, name):
        self.name = name
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        self.m, self.nt = m, m.node_tree
        self.nt.nodes.clear()
        self.obj = self.N('ShaderNodeTexCoord').outputs['Object']

    def N(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        for k, v in inputs.items():
            if is_socket(v):
                self.nt.links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if is_socket(v):
                self.nt.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def smooth(self, lo, hi, x):
        if hi < lo:
            return self.math('SUBTRACT', 1.0, self.smooth(hi, lo, x))
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        n.inputs['From Min'].default_value = lo
        n.inputs['From Max'].default_value = hi
        self.nt.links.new(x, n.inputs['Value'])
        return n.outputs['Result']

    def ramp(self, x, stops):
        n = self.nt.nodes.new('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = 'EASE'
        first, last = cr.elements[0], cr.elements[1]
        first.position, first.color = stops[0][0], (*hexrgb(stops[0][1]), 1)
        last.position, last.color = stops[-1][0], (*hexrgb(stops[-1][1]), 1)
        for at, col in stops[1:-1]:
            cr.elements.new(at).color = (*hexrgb(col), 1)
        self.nt.links.new(x, n.inputs['Fac'])
        return n.outputs['Color']

    def mix(self, fac, a, b):
        n = self.nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        for i, v in ((0, fac), (6, a), (7, b)):
            if is_socket(v):
                self.nt.links.new(v, n.inputs[i])
            elif i == 0:
                n.inputs[i].default_value = v
            else:
                n.inputs[i].default_value = (*hexrgb(v), 1)
        return n.outputs[2]

    def value(self, v):
        n = self.N('ShaderNodeValue')
        n.outputs[0].default_value = v
        return n.outputs[0]

    def length(self, x, y):
        c = self.N('ShaderNodeCombineXYZ', X=x, Y=y)
        n = self.N('ShaderNodeVectorMath', Vector=c.outputs['Vector'])
        n.operation = 'LENGTH'
        return n.outputs['Value']

    def finish(self, color, rough, height, bump=0.4, metal=0.0, dist=0.002):
        metal = self.value(metal)
        rough = rough if is_socket(rough) else self.value(rough)
        bn = self.N('ShaderNodeBump', Strength=bump, Distance=dist, Height=height)
        bsdf = self.wire(color, rough, metal, bn.outputs['Normal'])
        bsdf.inputs['Sheen Weight'].default_value = 0.35
        bsdf.inputs['Sheen Tint'].default_value = (*hexrgb(0xf3efff), 1)
        return self


def bands(m, vector, direction, **inputs):
    w = m.N('ShaderNodeTexWave', Vector=vector, **inputs)
    w.wave_type = 'BANDS'
    w.bands_direction = direction
    return w.outputs['Fac']


def fur_mat(name):
    m = Nodes(name)
    shade = m.N('ShaderNodeTexNoise', Vector=m.obj, Scale=9.0, Detail=4.0).outputs['Fac']
    z = m.math('MULTIPLY', m.N('ShaderNodeSeparateXYZ', Vector=m.obj).outputs['Y'], -1.0)
    thorax = m.ramp(shade, [(0.3, 0x9d8fe0), (0.7, 0xcdc2fb)])
    ruff = m.ramp(shade, [(0.3, 0xcfc5fd), (0.7, 0xe9e3ff)])
    belly = m.ramp(shade, [(0.3, 0x8f80d6), (0.7, 0xc4b8f8)])
    col = m.mix(m.smooth(0.07, 0.14, z), thorax, ruff)
    back = m.smooth(0.04, -0.03, z)
    ring = bands(m, m.obj, 'Y', Scale=13.0, Distortion=0.6)
    belly = m.mix(m.math('MULTIPLY', m.smooth(0.7, 0.98, ring), 0.08), belly, 0x5f50a8)
    col = m.mix(back, col, belly)
    along = m.N('ShaderNodeMapping', Vector=m.obj, Scale=(1.0, 1.0, 5.0)).outputs['Vector']
    strands = bands(m, along, 'X', Scale=160.0, Distortion=7.0, Detail=3.0)
    rough = m.math('MULTIPLY_ADD', shade, 0.1, 0.84)
    return m.finish(col, rough, strands, bump=0.2)


def wing_mat(name, hind, root):
    m = Nodes(name)
    uv = m.N('ShaderNodeUVMap')
    uv.uv_map = 'pattern'
    sep = m.N('ShaderNodeSeparateXYZ', Vector=uv.outputs['UV'])
    u, v = sep.outputs['X'], sep.outputs['Y']
    pos = m.N('ShaderNodeSeparateXYZ', Vector=m.obj)
    ax = m.math('SUBTRACT', m.math('ABSOLUTE', pos.outputs['X']), root[0])
    az = m.math('SUBTRACT', m.math('MULTIPLY', pos.outputs['Y'], -1.0), root[1])
    d = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', ax, ax), m.math('MULTIPLY', az, az)))
    ang = m.math('ARCTAN2', az, ax)
    dn = m.math('DIVIDE', d, 0.36 if hind else 0.56)
    base = m.ramp(dn, [(0.0, 0xeee6ff), (0.3, 0xc9bbfa), (0.62, 0xa290ec), (0.85, 0x7d69cf), (1.0, 0x6b58c0)])
    base = m.mix(m.math('MULTIPLY', m.smooth(0.3, 0.0, dn), 0.45), base, 0xf2d6f4)
    cloud = m.N('ShaderNodeTexNoise', Vector=m.obj, Scale=16.0, Detail=5.0).outputs['Fac']
    base = m.mix(m.math('MULTIPLY', cloud, 0.16), base, 0x5f4fae)
    sway = m.math('SINE', m.math('MULTIPLY', ang, 11.0 if hind else 14.0))
    wave = m.math('MULTIPLY_ADD', sway, 0.016, 0.6 if hind else 0.64)
    off = m.math('SUBTRACT', dn, wave)
    line = m.smooth(0.026, 0.006, m.math('ABSOLUTE', off))
    base = m.mix(m.math('MULTIPLY', line, 0.85), base, 0x3f3088)
    halo = m.math('MULTIPLY', m.smooth(0.0, 0.03, off), m.smooth(0.12, 0.03, off))
    base = m.mix(m.math('MULTIPLY', halo, 0.5), base, 0xd6cbfd)
    height = m.math('MULTIPLY', line, -0.4)
    k = m.math('FRACT', m.math('ADD', m.math('MULTIPLY', u, 5.0 if hind else 6.0), 0.5))
    across_vein = m.smooth(0.025, 0.0, m.math('ABSOLUTE', m.math('SUBTRACT', k, 0.5)))
    vein = m.math('MULTIPLY', across_vein, m.smooth(0.2, 0.4, v))
    vein = m.math('MULTIPLY', vein, m.smooth(0.96, 0.88, v))
    base = m.mix(m.math('MULTIPLY', vein, 0.28), base, 0x4c3d98)
    height = m.math('ADD', height, m.math('MULTIPLY', vein, -0.4))
    base = m.mix(m.math('MULTIPLY', m.smooth(0.955, 0.99, v), 0.7), base, 0xcfc4fb)
    if hind:
        r = m.length(m.math('MULTIPLY', m.math('SUBTRACT', u, 0.5), 1.3), m.math('SUBTRACT', v, 0.62))
        rim = m.math('MULTIPLY', m.smooth(0.07, 0.052, r), m.smooth(0.032, 0.048, r))
        dot = m.smooth(0.03, 0.016, r)
        base = m.mix(m.math('MULTIPLY', rim, 0.9), base, 0xf3efff)
        base = m.mix(m.math('MULTIPLY', dot, 0.9), base, 0x3f3088)
        height = m.math('ADD', height, m.math('MULTIPLY', rim, 0.4))
    else:
        r = m.length(m.math('MULTIPLY', m.math('SUBTRACT', u, 0.4), 1.5), m.math('SUBTRACT', v, 0.47))
        crescent = m.math('MULTIPLY', m.smooth(0.042, 0.03, r), m.smooth(0.45, 0.5, v))
        base = m.mix(m.math('MULTIPLY', crescent, 0.8), base, 0x4d3e9a)
    scales = m.N('ShaderNodeTexVoronoi', Vector=m.obj, Scale=420.0).outputs['Distance']
    height = m.math('ADD', height, m.math('MULTIPLY', scales, 0.5))
    rough = m.math('MULTIPLY_ADD', cloud, 0.12, 0.5)
    return m.finish(base, rough, height, bump=0.25, dist=0.001)


def plain_mat(name, color, rough, detail_scale=60.0):
    m = Nodes(name)
    n = m.N('ShaderNodeTexNoise', Vector=m.obj, Scale=detail_scale, Detail=3.0)
    col = m.ramp(n.outputs['Fac'], [(0.25, color), (0.75, color)])
    return m.finish(col, rough, n.outputs['Fac'], bump=0.2)


ROOT_X = 0.045
ROOT_Y = 0.13
FORE_ROOT_Z = 0.075
HIND_ROOT_Z = 0.0

MATS = {
    'fur': fur_mat('fur'),
    'leg': plain_mat('leg', 0xd2c8fb, 0.75),
    'antenna': plain_mat('antenna', 0xe8e0ff, 0.6, 200.0),
    'fore': wing_mat('fore', False, (ROOT_X, FORE_ROOT_Z)),
    'hind': wing_mat('hind', True, (ROOT_X, HIND_ROOT_Z)),
}
EYE = glow('eye', 0x89cf9d, 4.0)


class Fig:
    def __init__(self, id):
        self.id = id
        self.parts = []

    def mesh(self, name, verts, faces, m, role='body', uvs=None):
        me = new_mesh(f'{self.id}-{name}', verts, faces)
        if uvs is not None:
            layer = me.uv_layers.new(name='pattern')
            for poly in me.polygons:
                for li in poly.loop_indices:
                    layer.data[li].uv = uvs[me.loops[li].vertex_index]
        bm = bmesh.new()
        bm.from_mesh(me)
        if all(e.is_manifold for e in bm.edges):
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(me.name, me)
        COLL.objects.link(o)
        dress(o, m if isinstance(m, bpy.types.Material) else MATS[m].m)
        self.parts.append((o, role))
        return o

    def tube(self, name, pts, radii, m, n=6, role='body'):
        pts = [V(p) for p in pts]
        verts, faces = [], []
        side = (pts[1] - pts[0]).normalized().orthogonal().normalized()
        for i, (p, r) in enumerate(zip(pts, radii)):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = (side - t * side.dot(t)).normalized()
            up = t.cross(side)
            for k in range(n):
                a = TAU * k / n
                verts.append(p + (side * math.cos(a) + up * math.sin(a)) * max(r, 1e-4))
        for i in range(len(pts) - 1):
            for k in range(n):
                a, b = i * n + k, i * n + (k + 1) % n
                faces.append((a, b, b + n, a + n))
        verts.append(pts[0])
        verts.append(pts[-1])
        c0, c1 = len(verts) - 2, len(verts) - 1
        last = (len(pts) - 1) * n
        for k in range(n):
            faces.append((c0, (k + 1) % n, k))
            faces.append((c1, last + k, last + (k + 1) % n))
        return self.mesh(name, verts, faces, m, role=role)

    def ball(self, name, at, r, m, s=(1, 1, 1), n=12, role='body'):
        rings = max(6, n // 2)
        verts, faces = [], []
        for i in range(1, rings):
            a = -math.pi / 2 + math.pi * i / rings
            for k in range(n):
                b = TAU * k / n
                x, y, z = math.cos(a) * math.cos(b), math.sin(a), math.cos(a) * math.sin(b)
                verts.append(V(at) + V(x * r * s[0], y * r * s[1], z * r * s[2]))
        for i in range(rings - 2):
            for k in range(n):
                a, b = i * n + k, i * n + (k + 1) % n
                faces.append((a, a + n, b + n, b))
        verts += [V(at) + V(0, -r * s[1], 0), V(at) + V(0, r * s[1], 0)]
        lo, hi = len(verts) - 2, len(verts) - 1
        top = (rings - 2) * n
        for k in range(n):
            faces.append((lo, k, (k + 1) % n))
            faces.append((hi, top + (k + 1) % n, top + k))
        return self.mesh(name, verts, faces, m, role=role)


def closed_curve(ctrl, per=6):
    out = []
    n = len(ctrl)
    for i in range(n):
        p0, p1, p2, p3 = (V(*ctrl[(i + j - 1) % n], 0) for j in range(4))
        out += [catmull_rom(p0, p1, p2, p3, k / per) for k in range(per)]
    return out


HIND_OUTLINE = [
    (0.0, 0.0), (0.15, -0.02), (0.29, -0.075), (0.365, -0.16), (0.355, -0.25), (0.285, -0.315), (0.18, -0.33),
    (0.085, -0.28), (0.025, -0.16),
]
FORE_OUTLINE = [
    (0.0, 0.02), (0.14, 0.08), (0.3, 0.14), (0.44, 0.18), (0.53, 0.19), (0.57, 0.16), (0.56, 0.1), (0.52, 0.0),
    (0.47, -0.09), (0.4, -0.155), (0.3, -0.165), (0.18, -0.125), (0.08, -0.075), (0.015, -0.03),
]


def wing(f, s, hind):
    if hind:
        loop = closed_curve(HIND_OUTLINE, 5)
        root = V(ROOT_X - 0.01, ROOT_Y - 0.008, HIND_ROOT_Z)
        center = V(0.05, 0, -0.08)
    else:
        loop = closed_curve(FORE_OUTLINE, 5)
        root = V(ROOT_X, ROOT_Y, FORE_ROOT_Z)
        center = V(0.06, 0, 0.0)
    n = len(loop)
    rows = 7
    verts, uvs, faces = [center], [(0.5, 0.0)], []
    for r in range(1, rows + 1):
        t = r / rows
        for k in range(n):
            e = loop[k]
            u = k / n
            dip = 1.0 - 0.012 * (1 - math.cos(TAU * u * (5 if hind else 6))) * (t ** 6)
            p = center + (V(e.x, 0, e.y) - center) * t * dip
            p.y += 0.018 * math.sin(math.pi * min(1.0, t * 1.1)) * (1.0 - 0.4 * u)
            verts.append(p)
            uvs.append((u, t))
    for k in range(n):
        faces.append((0, 1 + k, 1 + (k + 1) % n))
    for r in range(rows - 1):
        for k in range(n):
            a = 1 + r * n + k
            b = 1 + r * n + (k + 1) % n
            faces.append((a, a + n, b + n, b))
    far = max(range(n), key=lambda k: loop[k].x)

    def across(u):
        return 0.5 * u * n / far if u * n <= far else 0.5 + 0.5 * (u * n - far) / (n - far)
    uvs = [(across(u), t) for u, t in uvs]
    verts = [V(s * (root.x + p.x), root.y + p.y, root.z + p.z) for p in verts]
    if s < 0:
        faces = [tuple(reversed(fc)) for fc in faces]
    kind = 'hind' if hind else 'fore'
    return f.mesh(f'{kind}{s}', verts, faces, kind, role=f'wing{s}', uvs=uvs)


def antenna(f, s):
    shaft = [V(s * 0.022, 0.215, 0.215), V(s * 0.05, 0.25, 0.26), V(s * 0.09, 0.28, 0.31), V(s * 0.145, 0.3, 0.365),
             V(s * 0.2, 0.305, 0.425)]
    path = [a.lerp(b, k / 5) for a, b in zip(shaft, shaft[1:]) for k in range(5)] + [shaft[-1]]
    radii = [0.0075 * (1 - 0.65 * i / (len(path) - 1)) for i in range(len(path))]
    role = f'ant{s}'
    f.tube(f'ant{s}-shaft', path, radii, 'antenna', n=6, role=role)
    for i in range(2, len(path) - 1):
        p = path[i]
        t = (path[i + 1] - path[i - 1]).normalized()
        out = V(0, 0, 1).cross(t).normalized()
        if out.length < 0.5:
            out = V(s, 0, 0)
        up = t.cross(out).normalized()
        length = 0.042 * math.sin(math.pi * (i / len(path)) ** 0.8) + 0.008
        for side in (-1, 1):
            d = (out * side * 0.5 + up * 0.62 + t * 0.4).normalized()
            if d.z < 0:
                d.z *= 0.4
            barb = [p, p + d * length * 0.55, p + d * length]
            f.tube(f'ant{s}-barb{i}{side}', barb, [0.0028, 0.002, 0.0006], 'antenna', n=4, role=role)


THORAX = ((0, 0.15, 0.1), 0.09, (1.05, 0.95, 1.05))
HEAD = ((0, 0.165, 0.19), 0.07, (1.0, 0.95, 0.9))
ABDOMEN = ((0.0, 0.13, 0.07), (-0.055, 0.12, 0.064), (-0.11, 0.108, 0.055), (-0.16, 0.097, 0.044))
TAIL = (-0.2, 0.088, 0.03)


def moth():
    f = Fig('moth')
    E = []

    def el(co, r, s=(1, 1, 1), stiff=10.0):
        E.append(dict(co=co, r=r, s=s, stiff=stiff))
    for co, r, sz in (HEAD, THORAX):
        el(co, r, sz)
    for z, y, r in (*ABDOMEN, TAIL):
        el((0, y, z), r, (1.0, 0.9, 0.9))

    def clumps(c, r, sz, n, size, up):
        for _ in range(n):
            while True:
                d = V(random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1)).normalized()
                if d.y > up:
                    break
            p = V(c) + V(d.x * r * sz[0], d.y * r * sz[1], d.z * r * sz[2]) * 0.92
            el(tuple(p), size * random.uniform(0.75, 1.15), (1.0, 0.85, 1.0), stiff=3.0)
    clumps(*THORAX, 26, 0.036, up=-0.35)
    clumps((0, 0.175, 0.145), 0.085, (1.2, 0.85, 0.7), 16, 0.04, up=-0.1)
    clumps(*HEAD, 12, 0.028, up=-0.45)
    for z, y, r in ABDOMEN:
        clumps((0, y, z), r, (1.0, 0.9, 0.9), 6, r * 0.4, up=-0.5)
    body = metaball(COLL, 'moth-body', E, MATS['fur'].m, 0.007, fur=0.003, grain=0.012)
    f.parts.append((body, 'body'))
    for s in (-1, 1):
        p, n = on_surface(body, V(0, 0.17, 0.19), V(s * 0.4, 0.4, 0.62))
        f.ball(f'eye{s}', p - n * 0.012, 0.032, EYE, s=(0.9, 1.0, 0.9), n=14, role='eye')
    for s in (-1, 1):
        for j, z in enumerate((0.15, 0.1, 0.05)):
            hip = V(s * 0.03, 0.08, z)
            knee = V(s * (0.07 + 0.008 * j), 0.05, z + 0.015 - 0.015 * j)
            foot = V(s * (0.078 + 0.01 * j), 0.004, z + 0.025 - 0.03 * j)
            f.tube(f'leg{s}{j}', [hip, knee, foot], [0.016, 0.013, 0.008], 'leg', n=8)
    for s in (-1, 1):
        antenna(f, s)
        wing(f, s, False)
        wing(f, s, True)
    return f


SIZE = 1024
TARGET = 12000


def bake_texture(root):
    objs = [o for o in root.children if not o.name.endswith('-eye')]
    for o in objs:
        bake_uv = o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers.active = bake_uv
        bake_uv.active_render = True
    ants = [o for o in objs if '-ant' in o.name]
    unwrap([o for o in objs if o not in ants], 0.004)
    unwrap(ants, 0.004)
    for o in objs:
        corner = o in ants
        for d in o.data.uv_layers['UVMap'].data:
            d.uv = (0.976 + d.uv.x * 0.02, 0.976 + d.uv.y * 0.02) if corner else (d.uv.x * 0.97, d.uv.y)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    maps = bake('moth', list(MATS.values()), SIZE, margin=6, ao_samples=96, ao_floor=0.55, out=OUT)
    m = shipping('moth', maps, True)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(m)
        if 'pattern' in o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers['pattern'])


f = moth()
print(f'built moth: {len(f.parts)} pieces')
slim(f.parts, TARGET, big=400, delimit=('NORMAL', 'SHARP', 'SEAM', 'UV'), slims=lambda role: role == 'body')
root = assemble(COLL, f)
bake_texture(root)
print(f'moth: {tris(root)} triangles; parts: {", ".join(c.name for c in root.children)}')
export([root], OUT, 'moth')
print('done')
