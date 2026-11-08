"""
Builds the Night Watch's camp figures in Blender and exports them as one GLB.

Each watcher is modelled from lofted, subdivided shells (armour plates with rolled edges, a folded cape, a feather
plume), metaball bodies for the bear and the drake, and bevelled blocks for the one made of cubes. Their surface
detail (hammered plate, mail, weave, fur, scales, bark) is drawn by procedural shaders and baked into one texture set
per figure: colour (with baked ambient occlusion), roughness and metalness, and a tangent-space normal map.

Coordinates in this file are the page's: x right, y up, z towards the camera, feet on y = 0, metres.

  blender -b --factory-startup --python-exit-code 1 -P scripts/build-watch.py -- <out dir> [ids] [--renders]

writes <out dir>/watch-raw.glb (and preview stills in <out dir>/out with --renders); then
node scripts/build-watch.mjs <out dir>/watch-raw.glb packs it into public/models/watch.glb.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_kit import (TAU, Materials, V, assemble, ball_mesh, bake, dress, export, glow,  # noqa: E402
                         interp, light, loft, metaball, new_mesh, on_surface, orient, path_secs, ridge, ring,
                         shipping, slim, smooth_path, stage, start, tris, tube_mesh, unwrap)

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else '.')
RENDERS = '--renders' in ARGV
IDS = [a for a in ARGV[1:] if not a.startswith('--')]
ONLY = IDS[0].split(',') if IDS else ['sable', 'anvil', 'harrow', 'bramble', 'vesper', 'block']

SCENE = start()


# ---------------------------------------------------------------------------------------------------- materials

mat = Materials({
    # name: colour, roughness, metalness, detail, edge wear, bump, detail scale, colour wander
    'plate': (0x2b3650, 0.4, 0.8, 'hammer', 0.55, 0.35, 34),
    'trim': (0x9fb1cf, 0.3, 0.95, 'brushed', 0.3, 0.2, 40),
    'steel': (0x8794ad, 0.3, 0.92, 'brushed', 0.25, 0.15, 30),
    'iron': (0x343a48, 0.5, 0.85, 'hammer', 0.5, 0.4, 40),
    'mail': (0x2c3446, 0.45, 0.85, 'mail', 0.0, 1.0, 140),
    'leather': (0x2a2a33, 0.7, 0.0, 'leather', 0.35, 0.35, 60),
    'cloth': (0x141d33, 0.9, 0.0, 'weave', 0.0, 0.25, 160),
    'cape': (0x111a31, 0.9, 0.0, 'weave', 0.0, 0.25, 160),
    'cloak': (0x101828, 0.92, 0.0, 'weave', 0.0, 0.25, 140),
    'plume': (0x1c2350, 0.8, 0.0, 'feather', 0.0, 0.5, 60),
    'fur': (0x161c2e, 0.95, 0.0, 'fur', 0.0, 0.8, 26),
    'mane': (0x1a2034, 0.95, 0.0, 'fur', 0.0, 0.8, 30),
    'horn': (0x262c3e, 0.45, 0.25, 'grain', 0.4, 0.5, 30),
    'claw': (0x9aa4b8, 0.4, 0.1, 'smooth', 0.0, 0.1, 30),
    'pad': (0x1d1f27, 0.7, 0.0, 'leather', 0.0, 0.5, 80),
    'scale': (0x1b1d36, 0.55, 0.15, 'scale', 0.35, 0.6, 70),
    'belly': (0x2a2c4a, 0.6, 0.1, 'grain', 0.3, 0.5, 20),
    'membrane': (0x1d1b3e, 0.6, 0.0, 'veins', 0.0, 0.5, 9),
    'wood': (0x3a3631, 0.82, 0.0, 'grain', 0.2, 0.6, 26),
    'bark': (0x26231f, 0.95, 0.0, 'grain', 0.0, 1.2, 14),
    'woodEnd': (0x57504a, 0.9, 0.0, 'rings', 0.0, 0.4, 30),
    'cube': (0x252e45, 0.55, 0.35, 'stone', 0.6, 0.6, 18),
    'cubeDark': (0x1a2133, 0.6, 0.3, 'stone', 0.4, 0.6, 18),
    'visor': (0x030409, 1.0, 0.0, 'smooth', 0.0, 0.0, 10),
})


EYE = glow('eye', 0xcfefff, 6)
EYE_SOFT = glow('eyeSoft', 0xa8dcff, 2)

# ---------------------------------------------------------------------------------------------------- geometry

COLL = bpy.data.collections.new('watch')
SCENE.collection.children.link(COLL)


class Fig:
    """one watcher's pieces, by role: 'body' (rigid, one texture set), 'cape' (sways), 'eye', or a named node"""

    def __init__(self, id):
        self.id = id
        self.parts = []

    def add(self, name, verts, faces, m, role='body', sub=0, solid=0.0, sharp=None, flip=False, center=None):
        me = new_mesh(f'{self.id}-{name}', verts, faces)
        orient(me, center, flip)
        o = bpy.data.objects.new(me.name, me)
        COLL.objects.link(o)
        dress(o, m if isinstance(m, bpy.types.Material) else mat(m), solid, sub)
        if sharp is not None:
            o.data.set_sharp_from_angle(angle=math.radians(sharp))
        self.parts.append((o, role))
        return o

    def tube(self, name, pts, r, m, n=8, role='body', sub=0, closed=False, steps=1, aspect=1.0, front=(0, 0, 1)):
        v, f = tube_mesh(pts, r, n, closed, steps, aspect, front)
        return self.add(name, v, f, m, role=role, sub=sub, center=None)

    def ball(self, name, at, r, m, s=(1, 1, 1), n=14, role='body', sub=0, rot=None):
        v, f = ball_mesh(at, r, s, n, rot)
        return self.add(name, v, f, m, role=role, sub=sub, center=at)


def rim(f, name, pts, r, m='trim', n=4):
    """a rolled edge along a ring of points (closed when the ring is)"""
    return f.tube(name, pts, r, m, n=n, sub=0)


def ring_pts(secs, i, n, arc=(0.0, TAU), out=0.0):
    s = secs[i]
    pts, closed = ring(V(s['c']), V(s.get('t', (0, 1, 0))), V(s.get('f', (0, 0, 1))), s['rx'] + out, s['rz'] + out, n, arc[0], arc[1], s.get('s'))
    if closed:
        pts.append(pts[0])
    return pts


# ---------------------------------------------------------------------------------------------------- knights

def band(f, name, y0, y1, r0, r1, m='plate', n=24, arc=(0.0, TAU), c=(0, 0, 0), depth=0.74, solid=0.012, trim=0.007, trims=(False, True), sh=None, zoff=0.0):
    secs = [dict(c=(c[0], y0, c[2] + zoff), rx=r0, rz=r0 * depth, s=sh), dict(c=(c[0], y1, c[2] + zoff), rx=r1, rz=r1 * depth, s=sh)]
    v, fc, _ = loft(secs, n, arc)
    f.add(name, v, fc, m, solid=solid, center=(c[0], (y0 + y1) / 2, c[2]))
    for i, want in enumerate(trims):
        if want:
            rim(f, f'{name}-rim{i}', ring_pts(secs, i, n, arc, out=0.002), trim)


def cuirass(f, rows, ridge_d=0.03, n=24):
    """rows: (y, rx, rz) from the waist up"""
    secs = [dict(c=(0, y, 0.0), rx=rx, rz=rz, s=ridge(ridge_d * min(1, (y - rows[0][0]) / 0.25 + 0.3))) for y, rx, rz in rows]
    v, fc, _ = loft(secs, n)
    f.add('cuirass', v, fc, 'plate', solid=0.014, sub=1, center=(0, (rows[0][0] + rows[-1][0]) / 2, 0))
    rim(f, 'cuirass-top', ring_pts(secs, len(secs) - 1, n, out=0.002), 0.0085)
    rim(f, 'cuirass-low', ring_pts(secs, 0, n, out=0.002), 0.009)
    # the plackart: a lower front plate over the belly, its top edge a shallow V
    y0, y1 = rows[0][0] + 0.015, rows[0][0] + 0.21
    pl = []
    for y in (y0, (y0 + y1) / 2, y1):
        rx, rz = sample(rows, y)
        pl.append(dict(c=(0, y, 0), rx=rx + 0.01, rz=rz + 0.012, s=ridge(ridge_d * 0.8)))
    v, fc, _ = loft(pl, 16, (0.16 * math.pi, 0.84 * math.pi))
    # a V at the top: pull the top ring's middle down
    top = len(v) - 17
    for j in range(17):
        # its top rises to a point at the middle
        k = abs(j - 8) / 8
        v[top + j] = v[top + j] - V(0, 0.07 * k * k, 0)
    f.add('plackart', v, fc, 'plate', solid=0.01, sub=1, center=(0, (y0 + y1) / 2, 0))
    rim(f, 'plackart-rim', [v[top + j] + V(0, 0, 0.003) for j in range(17)], 0.0065)


def sample(rows, y):
    for (ya, ra, za), (yb, rb, zb) in zip(rows, rows[1:]):
        if ya <= y <= yb:
            k = (y - ya) / (yb - ya)
            return ra + (rb - ra) * k, za + (zb - za) * k
    return rows[-1][1], rows[-1][2]


def faulds(f, top, r, n=3, step=0.075, flare=0.018, depth=0.74):
    for i in range(n):
        y0 = top - i * step
        band(f, f'fauld{i}', y0 + 0.012, y0 - step - 0.012, r + i * flare, r + (i + 1) * flare + 0.006, depth=depth, trims=(False, True), trim=0.0065)


def belt(f, y, r, depth=0.74, buckle=True):
    secs = [dict(c=(0, y, 0), rx=r, rz=r * depth)]
    f.tube('belt', ring_pts(secs, 0, 24), [0.022], 'leather', n=6, aspect=0.5, front=(0, 1, 0))
    if buckle:
        v, fc, _ = loft([dict(c=(0, y - 0.03, r * depth + 0.012), rx=0.04, rz=0.012), dict(c=(0, y + 0.03, r * depth + 0.012), rx=0.04, rz=0.012)], 4, (math.pi / 4, math.pi / 4 + TAU), cap0=True, cap1=True)
        f.add('buckle', v, fc, 'trim')


def pauldron(f, s, at, r, lames=3, tilt=0.42, back=0.0):
    """a domed shoulder plate with lames below it, over the outer side of the arm"""
    ax = V(s * math.sin(tilt), math.cos(tilt), 0)
    c = V(at)
    out = 0.0 if s > 0 else math.pi
    rows = [(0.78, 0.08), (0.62, 0.6), (0.4, 0.86), (0.12, 1.0), (-0.12, 1.02)]
    secs = [dict(c=c + ax * (r * h), t=ax, f=(0, 0, 1), rx=r * k * 0.95, rz=r * k * 1.05) for h, k in rows]
    v, fc, _ = loft(secs, 18, cap0=True)
    f.add(f'pauldron{s}', v, fc, 'plate', solid=0.013, sub=1, center=c)
    rim(f, f'pauldron{s}-rim', ring_pts(secs, len(secs) - 1, 18, out=0.002), 0.0075)
    arc = (out - 0.62 * math.pi, out + 0.62 * math.pi)
    for i in range(1, lames):
        h0, h1 = -0.12 - i * 0.2, -0.36 - i * 0.2
        k0, k1 = 1.02 + i * 0.03, 1.04 + i * 0.04
        ls = [dict(c=c + ax * (r * h0), t=ax, f=(0, 0, 1), rx=r * k0 * 0.95, rz=r * k0 * 1.05), dict(c=c + ax * (r * h1), t=ax, f=(0, 0, 1), rx=r * k1 * 0.95, rz=r * k1 * 1.05)]
        v, fc, _ = loft(ls, 12, arc)
        f.add(f'lame{s}{i}', v, fc, 'plate', solid=0.011, center=c)
        rim(f, f'lame{s}{i}-rim', ring_pts(ls, 1, 12, arc, out=0.002), 0.006)
    # three rivets along the dome's edge
    for a in (-0.35, 0.0, 0.35):
        p = ring(c + ax * (r * 0.02), ax, V(0, 0, 1), r * 1.0, r * 1.08, 1, out + a, out + a + 0.001)[0][0]
        f.ball(f'rivet{s}{a}', p, 0.011, 'trim', n=8, sub=0)


def arm(f, sh, el, hand, r, grip=False):
    sh, el, hand = V(sh), V(el), V(hand)
    f.tube('sleeve', [sh, el, hand], [r * 0.95, r * 0.86, r * 0.72], 'mail', n=10)
    up = el - sh
    fo = hand - el
    f.tube('rerebrace', [sh + up * 0.28, sh + up * 0.62, el - up * 0.1], [r * 1.12, r * 1.08, r * 1.02], 'plate', n=14)
    # the couter: a cup over the elbow with a fan to the outside
    out = (el - (sh + hand) / 2)
    if out.length < 1e-4:
        out = V(0, 0, -1)
    out.normalize()
    secs = [dict(c=el + out * (r * h), t=out, f=(0, 1, 0), rx=r * k, rz=r * k) for h, k in ((1.2, 0.1), (1.05, 0.75), (0.7, 1.15), (0.25, 1.3))]
    v, fc, _ = loft(secs, 14, cap0=True)
    f.add('couter', v, fc, 'plate', solid=0.01, sub=1, center=el)
    rim(f, 'couter-rim', ring_pts(secs, 3, 14, out=0.002), 0.008)
    f.tube('vambrace', [el + fo * 0.14, el + fo * 0.5, hand - fo * 0.17], [r * 1.06, r * 0.98, r * 0.86], 'plate', n=14)
    rim(f, 'vambrace-rim', ring_pts(path_secs([el + fo * 0.14, el + fo * 0.15], [r * 1.07, r * 1.07]), 0, 14), 0.007)
    # gauntlet: a flared cuff, then a closed hand
    d = fo.normalized()
    cuff = [dict(c=hand - d * (0.09 - 0.03 * i), t=d, f=(0, 0, 1), rx=r * k, rz=r * k * 0.9) for i, k in enumerate((0.92, 1.12, 1.3))]
    v, fc, _ = loft(cuff, 14)
    f.add('cuff', v, fc, 'plate', solid=0.009, center=hand - d * 0.06)
    rim(f, 'cuff-rim', ring_pts(cuff, 2, 14, out=0.002), 0.007)
    side = V(1 if hand.x >= 0 else -1, 0, 0)
    hf = (d + V(0, -0.3, 0)).normalized()
    secs = [dict(c=hand + hf * (0.07 * t), t=hf, f=side, rx=r * k1, rz=r * k2) for t, k1, k2 in ((-0.05, 0.75, 0.95), (0.2, 0.85, 1.1), (0.55, 0.85, 1.12), (0.85, 0.7, 0.95), (1.0, 0.25, 0.4))]
    v, fc, _ = loft(secs, 12, cap0=True, cap1=True)
    f.add('hand', v, fc, 'leather', center=hand + hf * 0.03)
    for i, t in enumerate((0.25, 0.5)):
        rim(f, f'knuckle{i}', ring_pts(secs, 1 + i, 12, (0.15 * math.pi, 0.85 * math.pi), out=0.004), 0.007, m='plate')


def leg(f, s, hip, hipY, thigh, shin, spread=0.0, knee_fwd=0.035):
    H = V(s * hip, hipY, 0)
    K = V(s * (hip + 0.015 + spread * 0.5), hipY * 0.53, knee_fwd)
    A = V(s * (hip + spread), 0.1, 0)
    f.tube('hose', [H, K, A], [thigh * 0.98, shin * 0.95, shin * 0.82], 'mail', n=10)
    up = K - H
    # cuisse over the front and outside of the thigh
    arc = (-0.25 * math.pi, 1.2 * math.pi) if s > 0 else (-0.2 * math.pi, 1.25 * math.pi)
    secs = path_secs([H + up * 0.12, H + up * 0.5, K - up * 0.06], [thigh * 1.18, thigh * 1.12, thigh * 0.98])
    for x in secs:
        x['f'] = (0, 0, 1)
    v, fc, _ = loft(secs, 14, arc)
    f.add(f'cuisse{s}', v, fc, 'plate', solid=0.011, center=H + up * 0.5)
    rim(f, f'cuisse{s}-rim', ring_pts(secs, 2, 14, arc, out=0.002), 0.008)
    # poleyn: a cup on the knee and a fan to the outside
    kn = V(0, 0.05, 1).normalized()
    secs = [dict(c=K + kn * (shin * h), t=kn, f=(0, 1, 0), rx=shin * k, rz=shin * k * 1.1) for h, k in ((1.55, 0.12), (1.38, 0.8), (1.02, 1.22), (0.55, 1.36))]
    v, fc, _ = loft(secs, 14, cap0=True)
    f.add(f'poleyn{s}', v, fc, 'plate', solid=0.01, sub=1, center=K)
    rim(f, f'poleyn{s}-rim', ring_pts(secs, 3, 14, out=0.002), 0.008)
    fan = K + V(s * shin * 1.05, 0, 0.01)
    f.ball(f'fan{s}', fan, shin * 0.95, 'plate', s=(0.25, 1.0, 0.85), n=12)
    # greave with a front ridge, calf swelling behind
    lo = A - K
    pts = [K + lo * 0.12, K + lo * 0.35, K + lo * 0.7, A + V(0, 0.025, 0)]
    secs = path_secs(pts, [shin * 1.16, shin * 1.2, shin * 1.04, shin * 0.98], shape=ridge(shin * 0.12))
    for x in secs:
        x['f'] = (0, 0, 1)
    v, fc, _ = loft(secs, 16)
    f.add(f'greave{s}', v, fc, 'plate', solid=0.011, center=K + lo * 0.5)
    rim(f, f'greave{s}-rim0', ring_pts(secs, 0, 16, out=0.002), 0.008)
    rim(f, f'greave{s}-rim1', ring_pts(secs, 3, 16, out=0.002), 0.008)
    # sabaton: a pointed foot in lames, flat underneath
    toe = V(s * 0.012, 0, 0.21)
    pts = [A + V(0, -0.045, -0.07), A + V(0, -0.04, 0.0), A + V(0, -0.055, 0.08) + toe * 0.3, A + V(0, -0.07, 0.0) + toe * 0.8, A + V(0, -0.082, 0) + toe]
    rs = [shin * 0.85, shin * 1.0, shin * 0.92, shin * 0.6, shin * 0.15]
    secs = path_secs(pts, rs, front=(0, 1, 0), aspect=0.72)
    v, fc, rings = loft(secs, 14, cap0=True, cap1=True)
    v = [V(p.x, max(p.y, 0.004), p.z) for p in v]
    f.add(f'sabaton{s}', v, fc, 'plate', center=A + V(0, -0.05, 0.06))
    for i in (1, 2):
        rim(f, f'sabaton{s}-lame{i}', [V(p.x, max(p.y, 0.006), p.z) for p in ring_pts(secs, i, 14, (0.05 * math.pi, 0.95 * math.pi), out=0.004)], 0.006)


def gorget(f, y0, y1, r0, r1, depth=0.85):
    band(f, 'gorget', y0, y1, r0, r1, depth=depth, trims=(True, True), trim=0.009, solid=0.012)


def slit_eyes(f, c, gap, w=0.026, h=0.009, fwd=0.0):
    for s in (-1, 1):
        f.ball(f'eye{s}', V(c) + V(s * gap, 0, fwd), w, EYE, s=(1, h / w, 0.5), n=10, role='eye')


def cape(f, top, bottom, rx0, rx1, rz0, rz1, zc, arc=(-math.pi * 1.04, math.pi * 0.04), folds=7, amp=0.07, m='cape', n=40, rows=12):
    """a cape hung around the back of the shoulders, its folds deepening and its hem wavering towards the ground"""
    secs = []
    for i in range(rows + 1):
        k = i / rows
        y = top + (bottom - top) * k
        a_amp = amp * (0.15 + 0.85 * k ** 0.9)
        ph = 0.6 + 0.9 * k
        def shape(a, a_amp=a_amp, ph=ph, k=k):
            u = (a - arc[0]) / (arc[1] - arc[0])
            # deeper folds at the back, fading at the sides where the cape turns
            w = math.sin(math.pi * min(1, max(0, u))) ** 0.6
            return 1.0 + a_amp * w * math.sin(folds * TAU * u + ph), 0.0
        secs.append(dict(c=(0, y, zc - 0.02 * k), rx=rx0 + (rx1 - rx0) * (k ** 0.8), rz=rz0 + (rz1 - rz0) * (k ** 0.9), s=shape))
    v, fc, rings = loft(secs, n, arc)
    # an uneven hem: the bottom row rises and falls with the folds
    last = rings[-1]
    for j, vi in enumerate(last):
        u = j / (len(last) - 1)
        v[vi] = v[vi] + V(0, 0.025 * math.sin(folds * TAU * u * 0.5 + 0.8) + 0.02 * math.sin(u * 23.0), 0)
    return f.add('cape', v, fc, m, role='cape', solid=0.009, sub=0, center=(0, (top + bottom) / 2, zc + 0.6))


def plume(f, base, n=13, length=1.0, spread=0.035, m='plume'):
    rnd = random.Random(7)
    B0 = V(base)
    for i in range(n):
        u = (i / (n - 1)) * 2 - 1
        L = length * (0.86 + 0.18 * rnd.random()) * (1 - 0.12 * abs(u))
        x = u * spread
        pts = [B0 + V(x * 0.3, 0, 0.02), B0 + V(x * 0.7, 0.075 * L, -0.04 * L), B0 + V(x, 0.11 * L, -0.15 * L), B0 + V(x * 1.4, 0.075 * L, -0.27 * L), B0 + V(x * 1.9, -0.02 * L - 0.03 * abs(u), -0.35 * L), B0 + V(x * 2.2, -0.1 * L - 0.05 * abs(u), -0.38 * L)]
        f.tube(f'feather{i}', pts, [0.016, 0.03, 0.034, 0.028, 0.016, 0.003], m, n=6, steps=3, aspect=0.32, front=(1, 0, 0), sub=0)


# ---------------------------------------------------------------------------------------------------- the watchers

def sable():
    f = Fig('sable')
    for s in (-1, 1):
        leg(f, s, 0.1, 0.9, 0.082, 0.064)
    f.tube('waist', [V(0, 0.84, 0), V(0, 1.42, 0)], [0.16, 0.17], 'mail', n=12, aspect=0.72)
    cuirass(f, [(0.9, 0.17, 0.125), (1.0, 0.178, 0.13), (1.13, 0.206, 0.152), (1.27, 0.228, 0.168), (1.37, 0.218, 0.158), (1.44, 0.15, 0.115)], ridge_d=0.028)
    belt(f, 0.915, 0.182)
    faulds(f, 0.9, 0.18, n=2, step=0.07)
    for s in (-1, 1):
        # tassets over the thighs
        band(f, f'tasset{s}', 0.77, 0.63, 0.105, 0.115, c=(s * 0.105, 0, 0.0), arc=(0.12 * math.pi, 0.88 * math.pi), depth=1.1, trim=0.006, n=10)
    gorget(f, 1.43, 1.52, 0.135, 0.09)
    for s in (-1, 1):
        pauldron(f, s, (s * 0.24, 1.37, 0), 0.118, lames=3)
        arm(f, (s * 0.26, 1.33, 0), (s * 0.25, 1.08, 0.09), (s * 0.06, 0.945, 0.24), 0.054)
    # the planted sword: a fullered blade, a curved guard, a wrapped grip and a wheel pommel
    sx, sz = 0.0, 0.27
    blade = [dict(c=(sx, y, sz), rx=w, rz=t) for y, w, t in ((0.82, 0.032, 0.011), (0.5, 0.03, 0.011), (0.2, 0.025, 0.01), (0.07, 0.014, 0.008), (0.012, 0.0015, 0.002))]
    v, fc, _ = loft(blade, 4, (0, TAU), cap0=True)
    f.add('blade', v, fc, 'steel', sub=0, sharp=20)
    f.tube('guard', [V(-0.15, 0.808, sz), V(-0.07, 0.826, sz), V(0.07, 0.826, sz), V(0.15, 0.808, sz)], [0.011, 0.017, 0.017, 0.011], 'trim', n=8, steps=3)
    for s in (-1, 1):
        f.ball(f'quillon{s}', (s * 0.155, 0.806, sz), 0.017, 'trim', n=10)
    f.tube('grip', [V(sx, 0.84, sz), V(sx, 0.98, sz)], [0.018, 0.02], 'leather', n=8)
    for i in range(5):
        rim(f, f'wrap{i}', ring_pts([dict(c=(sx, 0.85 + i * 0.03, sz), rx=0.02, rz=0.02)], 0, 8), 0.004, m='leather')
    f.ball('pommel', (sx, 0.997, sz), 0.033, 'trim', s=(1, 1, 0.45), n=14)
    # helm: a rounded armet with a pointed visor under a brow, a comb, and the plume
    H = V(0, 1.625, 0.01)
    rows = [(0.165, 0.004, 0.004), (0.15, 0.055, 0.06), (0.12, 0.098, 0.106), (0.07, 0.124, 0.13), (0.0, 0.13, 0.136), (-0.06, 0.121, 0.127), (-0.11, 0.1, 0.106), (-0.135, 0.088, 0.094)]
    skull = [dict(c=H + V(0, y, 0), rx=rx, rz=rz) for y, rx, rz in reversed(rows)]
    v, fc, _ = loft(skull, 22, cap1=True)
    f.add('helm', v, fc, 'plate', solid=0.01, sub=1, center=H)
    # the eye slit: a dark band, the brow above it and the visor below
    arc = (0.2 * math.pi, 0.8 * math.pi)
    slit = [dict(c=H + V(0, y, 0), rx=0.131 + 0.004, rz=0.137 + 0.004) for y in (-0.004, 0.034)]
    v, fc, _ = loft(slit, 14, arc)
    f.add('slit', v, fc, 'visor', center=H)
    brow = [dict(c=H + V(0, y, 0), rx=rx + 0.013, rz=rz + 0.013) for y, rx, rz in ((0.026, 0.131, 0.137), (0.07, 0.126, 0.132))]
    barc = (0.1 * math.pi, 0.9 * math.pi)
    v, fc, _ = loft(brow, 18, barc)
    f.add('brow', v, fc, 'plate', solid=0.01, sub=1, center=H)
    rim(f, 'brow-rim', ring_pts(brow, 0, 18, barc, out=0.003), 0.008)
    vis = []
    for y, rx, rz, p in ((-0.105, 0.105, 0.112, 0.012), (-0.06, 0.126, 0.132, 0.04), (-0.02, 0.134, 0.14, 0.05), (0.006, 0.134, 0.14, 0.03)):
        vis.append(dict(c=H + V(0, y, 0), rx=rx + 0.014, rz=rz + 0.014, s=ridge(p, 0.5)))
    varc = (0.14 * math.pi, 0.86 * math.pi)
    v, fc, _ = loft(vis, 18, varc)
    f.add('visor', v, fc, 'plate', solid=0.01, sub=1, center=H)
    rim(f, 'visor-rim', ring_pts(vis, 3, 18, varc, out=0.002), 0.007)
    for i in range(4):
        # breaths: small dark slots low on the visor, each side
        for s in (-1, 1):
            a = math.pi / 2 + s * (0.32 + i * 0.07)
            p = ring(H + V(0, -0.07, 0), V(0, 1, 0), V(0, 0, 1), 0.141, 0.147, 1, a, a + 0.001, ridge(0.035, 0.5))[0][0]
            f.ball(f'breath{s}{i}', p, 0.009, 'visor', s=(0.5, 1.6, 0.5), n=6, sub=0)
    slit_eyes(f, H + V(0, 0.015, 0.128), 0.046, fwd=0.004)
    f.tube('comb', [H + V(0, 0.06, 0.13), H + V(0, 0.15, 0.06), H + V(0, 0.17, -0.04), H + V(0, 0.12, -0.13)], [0.014, 0.022, 0.022, 0.012], 'trim', n=6, steps=3, aspect=0.3, front=(1, 0, 0))
    f.tube('holder', [H + V(0, 0.14, -0.05), H + V(0, 0.185, -0.065)], 0.012, 'trim', n=8)
    plume(f, H + V(0, 0.19, -0.065), n=9, length=1.05, spread=0.03)
    cape(f, 1.45, 0.07, 0.23, 0.44, 0.15, 0.32, -0.07, folds=6, amp=0.15)
    return f


def anvil():
    f = Fig('anvil')
    for s in (-1, 1):
        leg(f, s, 0.125, 0.88, 0.1, 0.08, spread=0.03)
    f.tube('waist', [V(0, 0.82, 0), V(0, 1.46, 0)], [0.2, 0.22], 'mail', n=12, aspect=0.76)
    cuirass(f, [(0.88, 0.215, 0.165), (0.99, 0.236, 0.18), (1.14, 0.276, 0.212), (1.3, 0.298, 0.226), (1.41, 0.27, 0.205), (1.49, 0.18, 0.14)], ridge_d=0.022)
    belt(f, 0.895, 0.228, depth=0.78)
    faulds(f, 0.88, 0.226, n=2, step=0.08, flare=0.02, depth=0.8)
    for s in (-1, 1):
        band(f, f'tasset{s}', 0.74, 0.57, 0.125, 0.135, c=(s * 0.135, 0, 0.0), arc=(0.12 * math.pi, 0.88 * math.pi), depth=1.1, trim=0.0065, n=10)
    gorget(f, 1.47, 1.56, 0.17, 0.11)
    for s in (-1, 1):
        pauldron(f, s, (s * 0.32, 1.42, 0), 0.158, lames=4, tilt=0.5)
    arm(f, (-0.34, 1.36, 0), (-0.39, 1.08, 0.03), (-0.36, 0.86, 0.09), 0.068)
    arm(f, (0.34, 1.36, 0), (0.43, 1.1, 0.1), (0.37, 0.98, 0.24), 0.068)
    # the flanged mace in the right hand
    f.tube('haft', [V(-0.36, 0.98, 0.1), V(-0.36, 0.44, 0.13)], [0.02, 0.019], 'wood', n=8)
    f.tube('haftwrap', [V(-0.36, 0.92, 0.104), V(-0.36, 0.8, 0.11)], 0.024, 'leather', n=8)
    hc = V(-0.36, 0.37, 0.13)
    f.ball('macehead', hc, 0.05, 'iron', s=(1, 1.3, 1), n=12)
    for i in range(7):
        a = i * TAU / 7
        d = V(math.cos(a), 0, math.sin(a))
        outline = [hc + d * 0.03 + V(0, 0.07, 0), hc + d * 0.088 + V(0, 0.045, 0), hc + d * 0.095 + V(0, -0.02, 0), hc + d * 0.04 + V(0, -0.075, 0)]
        side = V(-d.z, 0, d.x) * 0.006
        v = [p + side for p in outline] + [p - side for p in outline]
        fc = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        f.add(f'flange{i}', v, fc, 'iron', sub=0, sharp=30, center=hc)
    f.ball('maceknob', hc + V(0, -0.1, 0), 0.025, 'iron', n=10)
    # the heater shield, its foot on the ground, curved across its face
    outline = [(-0.25, 0.32), (0.25, 0.32), (0.25, -0.04), (0.17, -0.27), (0, -0.42), (-0.17, -0.27), (-0.25, -0.04)]
    outline = smooth_outline(outline)
    T = Matrix.Translation(V(0.42, 0.74, 0.3)) @ Euler((-0.12, -0.42, 0), 'XYZ').to_matrix().to_4x4()
    curve = lambda x, y, z: V(x, y, z - 0.55 * x * x)
    front = [T @ curve(x, y, 0.025) for x, y in outline]
    back = [T @ curve(x, y, -0.025) for x, y in outline]
    v = front + back
    k = len(outline)
    fan_c = len(v)
    v.append(T @ curve(0, -0.02, 0.025))
    v.append(T @ curve(0, -0.02, -0.025))
    fc = [(fan_c, i, (i + 1) % k) for i in range(k)] + [(fan_c + 1, k + (i + 1) % k, k + i) for i in range(k)] + [(i, k + i, k + (i + 1) % k, (i + 1) % k) for i in range(k)]
    f.add('shield', v, fc, 'plate', sub=0, sharp=40, center=T @ V(0, 0, -0.5))
    rimpts = [T @ curve(x * 1.0, y * 1.0, 0.03) for x, y in outline] + [T @ curve(outline[0][0], outline[0][1], 0.03)]
    f.tube('shield-rim', rimpts, 0.016, 'trim', n=6, sub=0)
    f.tube('shield-bar', [T @ curve(0, 0.27, 0.034), T @ curve(0, -0.36, 0.034)], 0.014, 'trim', n=6, aspect=0.6, front=(0, 0, 1), sub=0)
    f.tube('shield-cross', [T @ curve(-0.21, 0.12, 0.034), T @ curve(0.21, 0.12, 0.034)], 0.014, 'trim', n=6, aspect=0.6, sub=0)
    f.ball('shield-boss', T @ curve(0, 0.12, 0.04), 0.045, 'trim', s=(1, 1, 0.45), n=14)
    for x, y in ((-0.19, 0.27), (0.19, 0.27), (-0.19, -0.05), (0.19, -0.05), (0, -0.33)):
        f.ball(f'shield-rivet{x}{y}', T @ curve(x, y, 0.033), 0.012, 'trim', n=8, sub=0)
    # the great helm: flat-topped, a cross of bands on its face, an eye slit across
    H0 = 1.545
    rows = [(0.0, 0.132, 0.137), (0.06, 0.142, 0.148), (0.14, 0.146, 0.152), (0.2, 0.14, 0.146), (0.235, 0.118, 0.124), (0.255, 0.06, 0.064), (0.262, 0.002, 0.002)]
    sec = [dict(c=(0, H0 + y, 0.0), rx=rx, rz=rz, s=ridge(0.018, 0.6)) for y, rx, rz in rows]
    v, fc, _ = loft(sec, 22, cap1=True)
    f.add('helm', v, fc, 'plate', solid=0.012, sub=1, center=(0, H0 + 0.12, 0))
    rim(f, 'helm-rim', ring_pts(sec, 0, 22, out=0.004), 0.013)
    rim(f, 'helm-crown', ring_pts(sec, 4, 22, out=0.003), 0.011)
    slit = [dict(c=(0, H0 + y, 0), rx=0.149, rz=0.155 + 0.018, s=ridge(0.012, 0.6)) for y in (0.104, 0.136)]
    sarc = (0.18 * math.pi, 0.82 * math.pi)
    v, fc, _ = loft(slit, 14, sarc)
    f.add('slit', v, fc, 'visor', center=(0, H0 + 0.12, 0))
    for y in (0.098, 0.142):
        rim(f, f'slit-rim{y}', ring_pts([dict(c=(0, H0 + y, 0), rx=0.151, rz=0.157 + 0.018, s=ridge(0.012, 0.6))], 0, 14, sarc), 0.008)
    f.tube('helm-cross', [V(0, H0 + 0.02, 0.172), V(0, H0 + 0.1, 0.176)], 0.013, 'trim', n=6, aspect=0.6, sub=0)
    f.tube('helm-cross2', [V(0, H0 + 0.145, 0.176), V(0, H0 + 0.23, 0.14)], 0.013, 'trim', n=6, aspect=0.6, sub=0)
    for i in range(6):
        for s in (-1, 1):
            f.ball(f'vent{s}{i}', (s * (0.045 + 0.018 * (i % 3)), H0 + 0.035 + 0.025 * (i // 3), 0.162 - 0.006 * (i % 3)), 0.006, 'visor', n=6, sub=0)
    slit_eyes(f, (0, H0 + 0.12, 0.165), 0.055, w=0.03)
    cape(f, 1.48, 0.5, 0.29, 0.45, 0.18, 0.31, -0.09, folds=5, amp=0.13)
    return f


def smooth_outline(pts, steps=3):
    """rounds a closed polygon's corners a little"""
    P = [V(x, y, 0) for x, y in pts]
    out = []
    n = len(P)
    for i in range(n):
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        out.append(b * 0.6 + a * 0.2 + c * 0.2)
        out.append(b * 0.5 + c * 0.5)
    return [(p.x, p.y) for p in out]


def harrow():
    f = Fig('harrow')
    for s in (-1, 1):
        leg(f, s, 0.11, 0.98, 0.085, 0.066)
    f.tube('waist', [V(0, 0.92, 0), V(0, 1.52, 0)], [0.17, 0.18], 'mail', n=12, aspect=0.72)
    cuirass(f, [(0.96, 0.18, 0.132), (1.08, 0.2, 0.146), (1.24, 0.228, 0.168), (1.4, 0.244, 0.18), (1.5, 0.22, 0.162), (1.57, 0.15, 0.116)], ridge_d=0.03)
    belt(f, 0.985, 0.19)
    # a long tabard skirt instead of faulds: cloth to the knee, open at the sides
    for s, a in ((1, (0.18 * math.pi, 0.82 * math.pi)), (-1, (1.18 * math.pi, 1.82 * math.pi))):
        secs = [dict(c=(0, y, 0), rx=r, rz=r * 0.78) for y, r in ((0.99, 0.2), (0.75, 0.24), (0.52, 0.27))]
        v, fc, _ = loft(secs, 12, a)
        f.add(f'tabard{s}', v, fc, 'cloth', solid=0.008, center=(0, 0.75, 0))
        rim(f, f'tabard{s}-hem', ring_pts(secs, 2, 12, a, out=0.002), 0.008)
    gorget(f, 1.56, 1.64, 0.13, 0.085)
    for s in (-1, 1):
        pauldron(f, s, (s * 0.26, 1.5, 0), 0.122, lames=3)
    arm(f, (-0.28, 1.46, 0), (-0.38, 1.22, 0.06), (-0.43, 1.28, 0.16), 0.056)
    arm(f, (0.28, 1.46, 0), (0.31, 1.2, 0.06), (0.2, 1.03, 0.15), 0.056)
    # fur mantle over the shoulders: a thick roll and tufts that hang outward
    secs = [dict(c=(0, 1.6, -0.01), rx=0.25, rz=0.2)]
    roll = ring_pts(secs, 0, 26)
    f.tube('mantle', roll, 0.085, 'mane', n=10, sub=1, aspect=0.8, front=(0, 1, 0))
    rnd = random.Random(31)
    for i in range(54):
        a = i / 54 * TAU + rnd.uniform(-0.05, 0.05)
        c = V(math.cos(a) * 0.25, 1.6, -0.01 + math.sin(a) * 0.2)
        out = V(math.cos(a), 0, math.sin(a))
        base = c + out * 0.06 + V(0, rnd.uniform(-0.04, 0.04), 0)
        tip = base + out * rnd.uniform(0.05, 0.08) + V(0, -rnd.uniform(0.04, 0.09), 0)
        f.tube(f'tuft{i}', [base, (base + tip) / 2 + out * 0.01, tip], [0.028, 0.018, 0.002], 'mane', n=5, sub=0)
    # the halberd
    hx, hz = -0.43, 0.17
    f.tube('pole', [V(hx, 0.0, hz), V(hx, 2.3, hz)], [0.021, 0.019], 'wood', n=8)
    f.tube('polewrap', [V(hx, 1.2, hz), V(hx, 1.38, hz)], 0.025, 'leather', n=8)
    axe = [(0, 0.13), (0.07, 0.15), (0.2, 0.2), (0.25, 0.06), (0.25, -0.06), (0.21, -0.16), (0.08, -0.08), (0, -0.07)]
    T = Matrix.Translation(V(hx, 2.06, hz)) @ Euler((0, -0.5, 0), 'XYZ').to_matrix().to_4x4()
    v = [T @ V(x, y, 0.008 * (1 - x / 0.26)) for x, y in axe] + [T @ V(x, y, -0.008 * (1 - x / 0.26)) for x, y in axe]
    k = len(axe)
    fc = [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))] + [(i, k + i, k + (i + 1) % k, (i + 1) % k) for i in range(k)]
    f.add('axe', v, fc, 'steel', sub=0, sharp=25, center=T @ V(0.1, 0, -0.3))
    hook = [(0, 0.04), (-0.12, 0.02), (-0.16, -0.06), (-0.11, -0.02), (0, -0.04)]
    v = [T @ V(x, y, 0.007) for x, y in hook] + [T @ V(x, y, -0.007) for x, y in hook]
    k = len(hook)
    fc = [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))] + [(i, k + i, k + (i + 1) % k, (i + 1) % k) for i in range(k)]
    f.add('hook', v, fc, 'steel', sub=0, sharp=25, center=T @ V(-0.08, 0, -0.3))
    spike = [dict(c=(hx, y, hz), rx=w, rz=w * 0.4) for y, w in ((2.27, 0.022), (2.33, 0.026), (2.5, 0.002))]
    v, fc, _ = loft(spike, 4, cap1=True)
    f.add('spike', v, fc, 'steel', sub=0, sharp=25)
    f.tube('langet', [V(hx, 1.9, hz), V(hx, 2.28, hz)], 0.025, 'trim', n=6, sub=0)
    f.ball('collar', (hx, 1.95, hz), 0.032, 'trim', s=(1, 0.6, 1), n=10)
    # helm and horns
    H = V(0, 1.75, 0.01)
    rows = [(0.17, 0.004, 0.004), (0.155, 0.06, 0.064), (0.12, 0.104, 0.11), (0.07, 0.13, 0.136), (0.0, 0.134, 0.14), (-0.06, 0.124, 0.13), (-0.11, 0.1, 0.106), (-0.135, 0.09, 0.096)]
    skull = [dict(c=H + V(0, y, 0), rx=rx, rz=rz, s=ridge(0.012, 0.5)) for y, rx, rz in reversed(rows)]
    v, fc, _ = loft(skull, 22, cap1=True)
    f.add('helm', v, fc, 'plate', solid=0.01, sub=1, center=H)
    arc = (0.18 * math.pi, 0.82 * math.pi)
    slit = [dict(c=H + V(0, y, 0), rx=0.139, rz=0.145, s=ridge(0.012, 0.5)) for y in (-0.012, 0.022)]
    v, fc, _ = loft(slit, 14, arc)
    f.add('slit', v, fc, 'visor', center=H)
    for y in (-0.018, 0.028):
        rim(f, f'slit-rim{y}', ring_pts([dict(c=H + V(0, y, 0), rx=0.139, rz=0.145, s=ridge(0.012, 0.5))], 0, 16, (0.12 * math.pi, 0.88 * math.pi)), 0.009)
    face = [dict(c=H + V(0, y, 0), rx=rx + 0.012, rz=rz + 0.012, s=ridge(0.03, 0.45)) for y, rx, rz in ((-0.125, 0.094, 0.1), (-0.07, 0.122, 0.128), (-0.024, 0.13, 0.136))]
    farc = (0.16 * math.pi, 0.84 * math.pi)
    v, fc, _ = loft(face, 16, farc)
    f.add('faceplate', v, fc, 'plate', solid=0.01, sub=1, center=H)
    slit_eyes(f, H + V(0, 0.005, 0.138), 0.046, fwd=0.004)
    for s in (-1, 1):
        pts = [H + V(s * 0.1, 0.07, 0), H + V(s * 0.19, 0.15, -0.02), H + V(s * 0.23, 0.29, -0.07), H + V(s * 0.19, 0.4, -0.13)]
        f.tube(f'horn{s}', pts, [0.04, 0.03, 0.017, 0.003], 'horn', n=9, steps=5)
        f.ball(f'hornbase{s}', H + V(s * 0.11, 0.075, 0.0), 0.036, 'trim', s=(0.7, 1, 1), n=10)
    cape(f, 1.58, 0.03, 0.26, 0.48, 0.18, 0.36, -0.06, arc=(-math.pi * 1.1, math.pi * 0.1), folds=8, amp=0.13, m='cloak')
    return f


def metaball_mesh(f, name, elements, m, res=0.025, decimate=None, fur=0.0, role='body'):
    o = metaball(COLL, f'{f.id}-{name}', elements, mat(m), res, fur=fur, decimate=decimate)
    f.parts.append((o, role))
    return o


def chain(el, pts, radii, s=(1, 1, 1), steps=3):
    """metaball elements close along a curve, so a limb or a tail is one smooth tube"""
    path = smooth_path(pts, steps)
    for p, r in zip(path, interp(list(radii), len(path))):
        el(p, r, s)


def bramble():
    """lying along x, head to +x, chin on his front paws"""
    f = Fig('bramble')
    E = []
    def el(co, r, s=(1, 1, 1), rot=(0, 0, 0)):
        E.append(dict(co=co, r=r, s=s, rot=rot))
    el((-0.12, 0.3, 0.03), 0.6, (1.05, 0.5, 0.6))           # back and belly, the belly flat on the ground
    el((0.28, 0.4, 0.03), 0.34, (0.95, 0.76, 0.95))         # shoulder hump
    el((-0.56, 0.33, 0.03), 0.36, (0.95, 0.86, 0.98))       # rump
    el((0.58, 0.31, 0.04), 0.2, (1.05, 0.9, 1.0), (0, 0, -0.2))   # neck, lower than the hump
    el((0.84, 0.28, 0.05), 0.215, (1.05, 0.9, 1.0))         # skull
    el((1.0, 0.33, 0.05), 0.13, (0.8, 0.7, 1.15))           # brow
    el((1.1, 0.22, 0.05), 0.115, (1.45, 0.8, 0.95), (0, 0, -0.12))  # muzzle
    for z in (-0.18, 0.27):
        chain(el, [(0.42, 0.18, z * 0.85), (0.62, 0.11, z), (0.86, 0.075, z)], [0.12, 0.1, 0.085])   # forelegs
        el((1.0, 0.05, z), 0.1, (1.15, 0.5, 0.95))          # paws
    el((-0.6, 0.22, 0.34), 0.2, (1.15, 0.8, 0.55))          # near hind thigh
    chain(el, [(-0.5, 0.1, 0.4), (-0.32, 0.055, 0.42)], [0.08, 0.06])   # near hind foot
    el((-0.86, 0.4, 0.03), 0.06, (1, 0.9, 1))               # tail
    body = metaball_mesh(f, 'body', E, 'fur', res=0.022, fur=0.03, decimate=0.45)
    bounds(body)
    # ears: small cupped shells on top of the skull
    for z in (-0.09, 0.19):
        c, n = on_surface(body, (0.83, 0.27, 0.05), (0.8, 0.9, z))
        secs = [dict(c=c + n * h, t=n, f=(1, 0, 0), rx=r, rz=r * 0.6) for h, r in ((-0.02, 0.062), (0.03, 0.066), (0.065, 0.045), (0.085, 0.004))]
        v, fc, _ = loft(secs, 12, cap1=True)
        f.add(f'ear{z}', v, fc, 'fur', solid=0.016, sub=1, center=c + V(-0.12, 0.0, 0))
        f.ball(f'earin{z}', c + n * 0.035 + V(0.02, 0, 0), 0.036, 'pad', s=(0.45, 1, 0.8), n=10)
    # nose on the muzzle's tip, a mouth line, closed eyes under the brow
    p, n = on_surface(body, (1.1, 0.22, 0.05), (1.6, 0.26, 0.05))
    f.ball('nose', p + n * 0.012, 0.042, 'pad', s=(0.7, 0.66, 1.15), n=12)
    p, n = on_surface(body, (1.08, 0.19, 0.05), (1.3, 0.05, 0.05))
    f.tube('mouth', [p + V(-0.03, 0.01, -0.06), p + n * 0.004, p + V(-0.03, 0.01, 0.06)], 0.006, 'pad', n=5, steps=3)
    for z in (-0.05, 0.15):
        p, n = on_surface(body, (0.9, 0.3, 0.05), (1.4, 0.36, z + (z - 0.05) * 0.8))
        side = V(0, 0, 1)
        f.tube(f'lid{z}', [p - side * 0.036 + n * 0.003, p + n * 0.007 + V(0, -0.008, 0), p + side * 0.036 + n * 0.003], 0.0038, EYE_SOFT, n=5, steps=3, role='eye')
    # claws on the front paws, the sole of the near hind foot showing
    for z in (-0.18, 0.27):
        for i in range(4):
            dz = (i - 1.5) * 0.042
            p, n = on_surface(body, (1.0, 0.05, z + dz), (1.4, 0.05, z + dz))
            f.tube(f'claw{z}{i}', [p - V(0.01, 0, 0), p + V(0.03, -0.008, 0), p + V(0.05, -0.032, 0)], [0.011, 0.007, 0.001], 'claw', n=5)
    p, n = on_surface(body, (-0.32, 0.055, 0.42), (0.2, 0.06, 0.45))
    f.ball('sole', p + n * 0.004, 0.055, 'pad', s=(0.3, 0.7, 0.8), n=12)
    return f


def bounds(o):
    xs = [v.co.x for v in o.data.vertices]
    ys = [-v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    print(f'{o.name}: x {min(xs):.2f}..{max(xs):.2f}  y {min(zs):.2f}..{max(zs):.2f}  z {min(ys):.2f}..{max(ys):.2f}  {len(o.data.polygons)} faces')


def wing(f, s):
    """one of Vesper's wings in its own space: root at the origin, reaching out along s*x, folded half open"""
    X = lambda x, y, z=0.0: V(x * s, y, z)
    root = X(0, 0)
    elbow = X(0.24, 0.17, -0.01)
    wrist = X(0.5, 0.3, -0.02)
    tips = [X(0.74, 0.22, -0.03), X(0.64, 0.0, -0.03), X(0.5, -0.17, -0.02), X(0.32, -0.26, -0.015)]
    role = f'wing{s}'
    f.tube(f'w{s}-arm', [root, elbow, wrist], [0.032, 0.024, 0.018], 'scale', n=8, steps=3, role=role)
    f.ball(f'w{s}-thumb', wrist + X(0.02, 0.035, 0), 0.016, 'claw', s=(0.7, 1.6, 0.7), n=8, role=role, sub=0, rot=(0, 0, -0.6 * s))
    for i, t in enumerate(tips):
        mid = wrist + (t - wrist) * 0.5 + X(0.0, 0.02, 0.0)
        f.tube(f'w{s}-finger{i}', [wrist, mid, t], [0.013, 0.009, 0.0025], 'scale', n=6, steps=3, role=role, sub=0)
    # membrane: a fan of panels from the arm to each finger, the trailing edge scalloped between the tips
    verts = []
    faces = []
    def scallop(a, b, depth, n=5):
        out = []
        for k in range(n + 1):
            u = k / n
            p = a + (b - a) * u
            toward = (wrist - p)
            if toward.length > 1e-5:
                p = p + toward.normalized() * depth * math.sin(math.pi * u)
            out.append(p)
        return out
    rim_pts = [tips[0]]
    for a, b in zip(tips, tips[1:]):
        rim_pts += scallop(a, b, 0.05)[1:]
    rim_pts += scallop(tips[-1], X(0.1, -0.2, -0.01), 0.04)[1:]
    rim_pts += scallop(X(0.1, -0.2, -0.01), root + X(0.02, -0.05, 0), 0.025)[1:]
    # fill: rings from the arm line out to the scalloped rim
    arm_line = [root + (elbow - root) * (k / 4) for k in range(5)] + [elbow + (wrist - elbow) * (k / 4) for k in range(1, 5)]
    inner = []
    for k in range(len(rim_pts)):
        u = k / (len(rim_pts) - 1)
        inner.append(arm_line[min(len(arm_line) - 1, int(round((1 - u) * (len(arm_line) - 1))))])
    rows = 5
    for r in range(rows + 1):
        t = r / rows
        for k in range(len(rim_pts)):
            p = inner[k] + (rim_pts[k] - inner[k]) * t
            # a little sag between the bones
            p = p + V(0, 0, -0.025 * math.sin(math.pi * t) * s * 0)
            p = p + V(0, 0, -0.02 * math.sin(math.pi * t))
            verts.append(p)
    w = len(rim_pts)
    for r in range(rows):
        for k in range(w - 1):
            a = r * w + k
            faces.append((a, a + 1, a + 1 + w, a + w))
    f.add(f'w{s}-membrane', verts, faces, 'membrane', role=role, solid=0.006, sub=1, center=X(0.3, 0.0, 0.3))


def vesper():
    f = Fig('vesper')
    E = []
    def el(co, r, s=(1, 1, 1), rot=(0, 0, 0)):
        E.append(dict(co=co, r=r, s=s, rot=rot))
    el((0, 0.45, 0.05), 0.15, (0.85, 1.3, 1.0), (0.3, 0, 0))     # chest, leaning forward
    el((0, 0.28, -0.03), 0.14, (0.95, 0.85, 1.0))                # hips and belly
    for s in (-1, 1):
        el((s * 0.1, 0.24, 0.04), 0.085, (0.75, 1.15, 1.35), (-0.4, 0, 0))   # thighs
        chain(el, [(s * 0.1, 0.17, 0.11), (s * 0.095, 0.1, 0.08), (s * 0.09, 0.05, 0.1)], [0.042, 0.034, 0.03])  # shins
        el((s * 0.09, 0.025, 0.15), 0.035, (0.9, 0.6, 1.5))       # feet
    chain(el, [(0, 0.58, 0.1), (0, 0.67, 0.15), (0, 0.76, 0.15), (0, 0.83, 0.13)], [0.08, 0.066, 0.058, 0.055])   # neck
    el((0, 0.865, 0.13), 0.075, (0.95, 0.9, 1.15))                # skull
    el((0, 0.845, 0.215), 0.045, (0.85, 0.75, 1.45), (0.12, 0, 0))    # snout
    el((0, 0.818, 0.19), 0.04, (0.8, 0.55, 1.4), (-0.1, 0, 0))   # jaw
    chain(el, [(0, 0.24, -0.15), (0.02, 0.12, -0.26), (0.07, -0.02, -0.29), (0.12, -0.17, -0.24), (0.15, -0.3, -0.13)], [0.075, 0.058, 0.044, 0.034, 0.024], steps=4)   # tail, off the rock
    body = metaball_mesh(f, 'body', E, 'scale', res=0.014, decimate=0.6)
    bounds(body)
    # the tail's last stretch and its spade
    f.tube('tailtip', [V(0.15, -0.3, -0.13), V(0.16, -0.37, -0.09), V(0.165, -0.4, -0.06)], [0.022, 0.012, 0.006], 'scale', n=8, steps=3)
    spade = [(0, 0.05), (0.05, -0.02), (0, -0.05), (-0.05, -0.02)]
    T = Matrix.Translation(V(0.165, -0.42, -0.05)) @ Euler((0.3, 0.6, 0), 'XYZ').to_matrix().to_4x4()
    v = [T @ V(x, y, 0.006) for x, y in spade] + [T @ V(x, y, -0.006) for x, y in spade]
    fc = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    f.add('spade', v, fc, 'horn', sub=1)
    # belly plates down the throat and chest
    for i in range(10):
        y = 0.3 + i * 0.055
        p, n = on_surface(body, (0, y, 0.0), (0, y, 0.6))
        f.ball(f'plate{i}', p + n * 0.003, 0.05 - i * 0.002, 'belly', s=(1.0, 0.36, 0.3), n=10, rot=(-0.4 + 0.08 * i, 0, 0))
    # spines along the neck and back
    for i in range(11):
        y = 0.86 - i * 0.065
        try:
            p, n = on_surface(body, (0, y, 0.05), (0, y + 0.05, -0.6))
        except RuntimeError:
            continue
        d = (n + V(0, 0.7, -0.2)).normalized()
        f.tube(f'spine{i}', [p - n * 0.006, p + d * (0.048 - i * 0.003)], [0.017 - i * 0.0008, 0.001], 'horn', n=5)
    # head: horns, brow ridges, eyes on the surface, nostrils, claws
    for s in (-1, 1):
        f.tube(f'horn{s}', [V(s * 0.035, 0.91, 0.1), V(s * 0.065, 0.98, 0.05), V(s * 0.08, 1.05, -0.03), V(s * 0.075, 1.08, -0.1)], [0.021, 0.015, 0.008, 0.002], 'horn', n=7, steps=3)
        p, n = on_surface(body, (0, 0.87, 0.14), (s * 0.5, 0.92, 0.55))
        f.ball(f'eye{s}', p + n * 0.004, 0.016, EYE, s=(0.85, 0.6, 0.95), n=10, role='eye')
        f.tube(f'brow{s}', [p + V(-s * 0.012, 0.022, 0.012), p + V(s * 0.016, 0.026, -0.026)], [0.011, 0.014], 'scale', n=6)
        p, n = on_surface(body, (0, 0.85, 0.2), (s * 0.15, 0.87, 0.6))
        f.ball(f'nostril{s}', p, 0.007, 'visor', n=6)
        for i in range(3):
            dx = (i - 1) * 0.02
            base = V(s * 0.09 + dx, 0.025, 0.2)
            f.tube(f'toe{s}{i}', [base, base + V(0, -0.005, 0.025), base + V(0, -0.022, 0.04)], [0.008, 0.006, 0.001], 'claw', n=5)
    for s in (-1, 1):
        wing(f, s)
    return f


def block():
    """made of cubes, sitting on a log as if it had always been there"""
    f = Fig('block')
    # the log: bark with deep ridges, cut ends with rings
    secs = []
    for i in range(9):
        x = -0.34 + 0.68 * i / 8
        def bark(a, i=i):
            return 1.0 + 0.06 * math.sin(a * 9 + i * 0.7) * (0.6 + 0.4 * math.sin(a * 3 + i)), 0.0
        secs.append(dict(c=(x, 0.13, 0), t=(1, 0, 0), f=(0, 1, 0), rx=0.13 - 0.01 * abs(x), rz=0.125, s=bark))
    v, fc, _ = loft(secs, 22, cap0=True, cap1=True)
    f.add('log', v, fc, 'bark', sub=1)
    for x in (-0.338, 0.338):
        s = 1 if x > 0 else -1
        f.ball(f'logend{s}', (x + 0.004 * s, 0.13, 0), 0.118, 'woodEnd', s=(0.06, 1, 1.02), n=16)
    # cubes, each a bevelled block with chipped corners
    def cube(name, size, at, rot=(0, 0, 0), m='cube'):
        sx, sy, sz = (size, size, size) if isinstance(size, (int, float)) else size
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for vtx in bm.verts:
            vtx.co.x *= sx
            vtx.co.y *= sy
            vtx.co.z *= sz
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(sx, sy, sz) * 0.09, segments=2, affect='EDGES', profile=0.6)
        rr = random.Random(sum(map(ord, name)))
        R = Euler(rot, 'XYZ').to_matrix()
        verts = []
        for vtx in bm.verts:
            p = V(vtx.co.x, vtx.co.y, vtx.co.z)
            # a chipped, hand-cut look: corners pushed in a little, unevenly
            k = (abs(p.x) / sx + abs(p.y) / sy + abs(p.z) / sz) / 1.5
            p = p * (1 - 0.3 * max(0, k - 0.8) * rr.random())
            verts.append(R @ p + V(at))
        faces = [tuple(v.index for v in fa.verts) for fa in bm.faces]
        bm.free()
        return f.add(name, verts, faces, m, sub=0, sharp=40, center=at)
    cube('hips', (0.21, 0.13, 0.17), (0, 0.33, 0.0), (0, 0.05, 0))
    cube('chest', (0.22, 0.2, 0.17), (0.0, 0.47, 0.0), (0.0, 0.05, 0))
    cube('head', 0.2, (0.01, 0.67, 0.01), (0.03, -0.12, 0.06))
    cube('hat', 0.065, (0.07, 0.8, -0.01), (0.2, 0.4, 0.3), m='cubeDark')
    for s in (-1, 1):
        cube(f'upperarm{s}', (0.075, 0.12, 0.075), (s * 0.15, 0.48, 0.03), (0.3, 0, -0.18 * s))
        cube(f'forearm{s}', (0.07, 0.1, 0.07), (s * 0.16, 0.38, 0.09), (1.0, 0, -0.1 * s), m='cubeDark')
        cube(f'hand{s}', 0.06, (s * 0.15, 0.33, 0.15), (0.2, 0.3 * s, 0))
        cube(f'thigh{s}', (0.085, 0.085, 0.2), (s * 0.058, 0.3, 0.13), m='cubeDark')
        cube(f'shin{s}', (0.08, 0.17, 0.08), (s * 0.058, 0.18, 0.25))
        cube(f'foot{s}', (0.085, 0.05, 0.12), (s * 0.058, 0.03, 0.29), m='cubeDark')
    # a face: two lit slots
    R = Euler((0.03, -0.12, 0.06), 'XYZ').to_matrix()
    for s in (-1, 1):
        c = R @ V(s * 0.045, 0.0, 0.101) + V(0.01, 0.67, 0.01)
        f.ball(f'eye{s}', c, 0.02, EYE, s=(1, 0.6, 0.3), n=10, role='eye', rot=(0.03, -0.12, 0.06))
    return f


BUILD = {'sable': sable, 'anvil': anvil, 'harrow': harrow, 'bramble': bramble, 'vesper': vesper, 'block': block}

# ---------------------------------------------------------------------------------------------------- bake and export

TEX = {'block': 512}


def bake_figure(f):
    objs = [o for o, role in f.parts if role != 'eye']
    for o in bpy.data.objects:
        o.hide_render = o.type == 'MESH' and o not in [p for p, _ in f.parts]
    unwrap(objs, 0.004)
    used = {s.material.name for o in objs for s in o.material_slots if s.material}
    procs = [mat.made[n] for n in used if n in mat.made]
    maps = bake(f.id, procs, TEX.get(f.id, 1024), margin=6, ao_samples=96, ao_floor=0.45, out=OUT)
    # the shipping materials: one texture set; the cape keeps its own material so it can sway
    ship = {'body': shipping(f'{f.id}', maps, False), 'cape': shipping(f'{f.id}-cape', maps, True)}
    for o, role in f.parts:
        if role == 'eye':
            continue
        o.data.materials.clear()
        o.data.materials.append(ship['cape'] if role == 'cape' else ship['body'])


TARGET = {'sable': 10000, 'anvil': 10500, 'harrow': 10500, 'bramble': 8000, 'vesper': 7000, 'block': 3000}


def heavy(f):
    rows = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o, _ in f.parts), reverse=True)
    print(f.id, 'heaviest:', ', '.join(f'{n}={t}' for t, n in rows[:12]), 'total', sum(t for t, _ in rows))


def preview(roots):
    """stills of each figure in a dark camp light: the blue fire low in front, the moon behind"""
    cam = stage(samples=64, width=600, height=800, ground_color=0x10141f, ground_rough=0.95)
    cam.data.lens = 70
    light('fire', 'POINT', (0.9, 0.45, 1.3), 0x9fdcff, 120)
    light('moon', 'AREA', (-1.4, 2.6, -1.8), 0x6fa8ff, 220, 1.5)
    light('rim', 'AREA', (1.6, 1.6, -1.4), 0x4fb8ff, 160, 1.0)
    light('fill', 'AREA', (-1.0, 1.2, 2.2), 0x2a3550, 40, 2.0)
    os.makedirs(os.path.join(OUT, 'out'), exist_ok=True)
    for root in roots:
        for r in roots:
            for c in r.children:
                c.hide_render = r is not root
        # Vesper's wings stand as the camp poses them (figures.ts)
        for c in root.children:
            if c.name.startswith('vesper-wing'):
                s = 1 if c.name.endswith('wing1') else -1
                M = Matrix.Translation(V(0.09 * s, 0.62, -0.05)) @ Euler((0.28, -0.95 * s, 0.42 * s), 'ZYX').to_matrix().to_4x4()
                C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
                c.matrix_world = C @ M @ C.inverted()
        box = [c.matrix_world @ Vector(b) for c in root.children for b in c.bound_box]
        lo = Vector((min(b.x for b in box), min(b.y for b in box), min(b.z for b in box)))
        hi = Vector((max(b.x for b in box), max(b.y for b in box), max(b.z for b in box)))
        mid = (lo + hi) / 2
        span = max(hi.z - lo.z, (hi.x - lo.x) * 0.75)
        for i, az in enumerate((0.45, -1.2, 2.6)):
            dist = span * 2.6 + 0.6
            d = Vector((math.sin(az), -math.cos(az), 0.18))
            cam.location = mid + d * dist
            cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
            SCENE.render.filepath = os.path.join(OUT, 'out', f'{root.name}-{i}.png')
            bpy.ops.render.render(write_still=True)


figs = []
for id in ONLY:
    f = BUILD[id]()
    figs.append(f)
    print(f'built {id}: {len(f.parts)} pieces')
for f in figs:
    slim(f.parts, TARGET[f.id])
    heavy(f)
    bake_figure(f)
roots = [assemble(COLL, f, lambda role: 'body' if role == 'cape' else role) for f in figs]
for r in roots:
    print(f'{r.name}: {tris(r)} triangles')
    for c in r.children:
        c.hide_render = False
export(roots, OUT, 'watch')
if RENDERS:
    preview(roots)
print('done')
