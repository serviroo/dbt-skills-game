import math

import bpy
from mathutils.bvhtree import BVHTree

from blender_kit import TAU, B, V, loft
from wanderer.cloth import SPINE
from wanderer.rig import P


def surface_hit(objs, at, toward):
    dg = bpy.context.evaluated_depsgraph_get()
    best = None
    for o in objs:
        hit = BVHTree.FromObject(o, dg).ray_cast(B(V(at)), B(V(toward)).normalized())
        if hit[0] is not None:
            d = (hit[0] - B(V(at))).length
            if best is None or d < best[0]:
                best = (d, P(hit[0]))
    return best[1] if best else None


def attach(objs, at, toward, what):
    hit = surface_hit(objs, at, toward)
    if hit is None:
        raise RuntimeError(f'the {what} found nothing to rest on from {tuple(V(at))} towards {tuple(V(toward))}')
    return hit


def gear(fig, mantle, torso, skirt):
    rig = fig.rig
    moved = lambda x, y, z, bone: V(x, y, z) + (rig.posed[bone] - rig.rest[bone])
    straps(fig, torso, moved)
    clasp(fig, mantle, moved)
    scarf_end(fig, mantle, moved)
    lantern(fig, skirt, moved)


def straps(fig, torso, moved):
    for side, toward in (('front', V(0, 0, -1)), ('back', V(0, 0, 1))):
        pts = []
        for i in range(9):
            t = i / 8
            at = moved(-0.13 + 0.29 * t, 1.36 - 0.33 * t, -toward.z * 0.6, 'spine_02')
            pts.append(attach([torso], at, toward, f'{side} strap') - toward * 0.007)
        fig.tube(f'strap-{side}', pts, 0.02, 'leather', SPINE + ['clavicle_r'], n=8, steps=2, aspect=0.22,
                 front=(0, 0, 1), uv=1.4, posed=True)


def clasp(fig, mantle, moved):
    c = attach([mantle], moved(0, 1.47, 0.6, 'spine_03'), V(0, 0, -1), 'clasp')
    fig.ball('clasp', c + V(0, 0, 0.004), 0.016, 'iron', ['spine_03', 'neck_01'], s=(1, 1, 0.35), n=16, uv=2.0,
             posed=True)
    ring = [c + V(0.014 * math.cos(a), 0.014 * math.sin(a), 0.008) for a in (TAU * k / 14 for k in range(14))]
    fig.tube('clasp-ring', ring, 0.0028, 'iron', ['spine_03'], n=6, closed=True, uv=2.0, posed=True)


def scarf_end(fig, mantle, moved):
    toward = V(0, 0, -1)
    lift = V(0, 0, 0.008)
    steps = [i / 11 for i in range(12)]
    along = [moved(0.045 + 0.05 * math.sin(t * 1.6), 1.525 - 0.42 * t, 0.6, 'spine_03') for t in steps]
    path = [attach([mantle], along[0], toward, 'scarf end') + lift]
    for o in along[1:]:
        hit = surface_hit([mantle], o, toward)
        if hit is not None:
            path.append(hit + lift)
        else:
            prev = path[-1]
            path.append(V(prev.x + 0.002, o.y, prev.z - 0.012))
    hangs = lambda p: fig.rig.near(p, ['neck_01', 'spine_03', 'spine_02'], soft=0.03, posed=True)
    fig.tube('scarf-end', path, 0.034, 'scarf', hangs, n=10, steps=2, aspect=0.12, front=(0, 0, 1), role='cloth',
             uv=1.6, posed=True)
    tip = path[-1]
    for k in range(7):
        fx = tip.x - 0.028 + 0.056 * k / 6
        strand = [V(fx, tip.y + 0.002, tip.z), V(fx + 0.002 * (k % 2), tip.y - 0.028 - 0.006 * (k % 3), tip.z - 0.002)]
        fig.tube(f'fringe{k}', strand, [0.0032, 0.0022], 'scarf', hangs, n=5, uv=1.6, posed=True)


def lantern(fig, skirt, moved):
    o = moved(0.07, 0.885, 0.6, 'pelvis')
    at = attach([skirt], o, V(0, 0, -1), 'lantern')
    L = V(o.x, o.y, at.z + 0.04)
    lw = lambda p: {'pelvis': 0.75, 'thigh_l': 0.25}
    hook = fig.rig.deform(V(0.068, 1.0, -0.025 + 0.138 + 0.006), {'pelvis': 1.0})
    fig.tube('lantern-hook', [hook, hook + V(0.001, -0.015, 0.012), V(L.x, L.y + 0.075, L.z)], 0.0026, 'iron', lw,
             n=6, steps=3, uv=2.0, posed=True)
    bail = [L + V(0.013 * math.cos(a), 0.062 + 0.013 * math.sin(a), 0) for a in (math.pi * k / 10 for k in range(11))]
    fig.tube('lantern-bail', bail, 0.0022, 'iron', lw, n=6, uv=2.0, posed=True)
    cap = [dict(c=L + V(0, y, 0), rx=r, rz=r)
           for y, r in ((0.062, 0.006), (0.055, 0.014), (0.045, 0.027), (0.04, 0.031))]
    v, f, _ = loft(cap, 16, cap0=True, cap1=True)
    fig.add('lantern-cap', v, f, 'iron', lw, sub=1, center=L + V(0, 0.05, 0), uv=2.0, posed=True)
    glass = [dict(c=L + V(0, y, 0), rx=r, rz=r) for y, r in ((0.04, 0.021), (0.0, 0.025), (-0.04, 0.021))]
    v, f, _ = loft(glass, 16, cap0=True, cap1=True)
    fig.add('lantern-glass', v, f, 'glass', lw, sub=1, center=L, uv=2.0, posed=True)
    for k in range(4):
        a = TAU * (k + 0.5) / 4
        o = V(0.027 * math.cos(a), 0, 0.027 * math.sin(a))
        bar = [L + o * 1.15 + V(0, 0.04, 0), L + o * 1.08, L + o * 1.15 + V(0, -0.042, 0)]
        fig.tube(f'lantern-bar{k}', bar, 0.0024, 'iron', lw, n=5, steps=2, uv=2.0, posed=True)
    base = [dict(c=L + V(0, y, 0), rx=r, rz=r) for y, r in ((-0.04, 0.03), (-0.052, 0.03), (-0.056, 0.022))]
    v, f, _ = loft(base, 16, cap0=True, cap1=True)
    fig.add('lantern-base', v, f, 'iron', lw, center=L + V(0, -0.048, 0), uv=2.0, posed=True)
