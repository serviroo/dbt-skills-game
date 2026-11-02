"""
Builds the Wanderer, the one figure of the intro, in Blender and exports it skinned to the rig's skeleton.

The Wanderer is original to this project: a deep hood sewn to a shoulder mantle, a cloth mask over the nose and mouth
with a scarf whose end hangs down the chest, a long ink-navy coat split at the front, leather gloves and boots, and a
small iron lantern at the left hip. Every piece is a lofted shell built here; its cloth, leather and iron detail is
drawn by procedural shaders and baked into one texture set: colour (with baked ambient occlusion), roughness and
metalness, and a tangent-space normal map.

The skeleton and the idle, walk, reach and hold clips come from the rig GLB (by default the current
public/models/hero.glb, which carries them from Quaternius's CC0 Universal Animation Library; see CREDITS.md). Its meshes
are dropped. The figure is modelled in the pose it stands in, the first frame of the idle clip, so cloth that hangs over
the arms is shaped for arms at rest by the sides; build-hero.mjs binds the meshes in that frame and leaves the skeleton's
rest pose as it is. Pieces that don't hang from the arms (head, hood, coat, legs) are drawn in the rig's own rest pose and
carried into that frame by their skin weights.

Coordinates in this file are the page's: x right (the figure's left), y up, z towards the camera, feet on y = 0, metres.

  blender -b --factory-startup --python-exit-code 1 -P scripts/build-hero.py -- <out dir> [--rig <glb>] [--renders]

writes <out dir>/hero-raw.glb (and preview stills in <out dir>/out with --renders); then
node scripts/build-hero.mjs <out dir>/hero-raw.glb puts it on the rig and packs it into public/models/hero.glb.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Euler, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_kit import TAU, B, Mat, V, apply_mods, hexrgb, interp, loft, path_secs, ridge, ring, smooth_path, start  # noqa: E402

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV and not ARGV[0].startswith('--') else '.')
RIG = os.path.abspath(ARGV[ARGV.index('--rig') + 1]) if '--rig' in ARGV else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'hero.glb')
RENDERS = '--renders' in ARGV

SCENE = start()


def P(b):
    """Blender space to page space"""
    return Vector((b[0], b[2], -b[1]))


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------------- the rig

# the skeleton's rest pose as the file stores it (hero.glb binds its meshes in the idle's first frame instead)
bpy.ops.import_scene.gltf(filepath=RIG, guess_original_bind_pose=False)
ARM = max((o for o in bpy.data.objects if o.type == 'ARMATURE'), key=lambda o: len(o.data.bones))
for o in list(bpy.data.objects):
    if o is not ARM and o.type in ('MESH', 'ARMATURE', 'EMPTY') and o not in ARM.children_recursive:
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(ARM.children_recursive):
    if o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for a in bpy.data.actions:
    a.use_fake_user = True
# the rig file's own meshes, materials and images go too, so the new ones keep their names on a rebuild from hero.glb
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
ARM.animation_data_clear()
IDLE = next(a for a in bpy.data.actions if 'idle' in a.name.lower())
ARM.animation_data_create()
ARM.animation_data.action = IDLE
if getattr(IDLE, 'slots', None) and len(IDLE.slots):
    ARM.animation_data.action_slot = IDLE.slots[0]
SCENE.frame_set(int(IDLE.frame_range[0]))
bpy.context.view_layer.update()
# joint positions in the rig's rest pose (J) and in the idle's first frame (JP), page space
J = {b.name: P(ARM.matrix_world @ b.head_local) for b in ARM.data.bones}
JP = {b.name: P(ARM.matrix_world @ b.head) for b in ARM.pose.bones}
# each bone's move from the rest pose into that frame, in Blender's world space
DELTA = {b.name: ARM.matrix_world @ b.matrix @ ARM.data.bones[b.name].matrix_local.inverted() @ ARM.matrix_world.inverted() for b in ARM.pose.bones}
FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')
print('idle frame:', ', '.join(f'{k} ({JP[k].x:.3f}, {JP[k].y:.3f}, {JP[k].z:.3f})' for k in ('pelvis', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'hand_r', 'calf_l', 'foot_l')))


def tail(name, j):
    """where a bone ends: its own chain's next joint"""
    nxt = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'Head'}
    if name in nxt:
        return j[nxt[name]]
    if name == 'Head':
        return j['Head'] + (j['Head'] - j['neck_01']).normalized() * 0.17
    for s in ('l', 'r'):
        side = {f'clavicle_{s}': f'upperarm_{s}', f'upperarm_{s}': f'lowerarm_{s}', f'lowerarm_{s}': f'hand_{s}', f'hand_{s}': f'middle_01_{s}',
                f'thigh_{s}': f'calf_{s}', f'calf_{s}': f'foot_{s}', f'foot_{s}': f'ball_{s}', f'ball_{s}': f'ball_leaf_{s}'}
        if name in side:
            return j[side[name]]
        for f in FINGERS:
            for i in (1, 2, 3):
                if name == f'{f}_0{i}_{s}':
                    return j[f'{f}_0{i + 1}_{s}' if i < 3 else f'{f}_04_leaf_{s}']
    raise KeyError(name)


SEG = {}


def seg_dist(p, name, posed=False):
    key = (name, posed)
    if key not in SEG:
        j = JP if posed else J
        SEG[key] = (j[name], tail(name, j))
    a, b = SEG[key]
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


def near(p, bones, soft=0.004, posed=False):
    """weights that fall off with the distance to each bone, so a piece bends smoothly where two bones meet"""
    return {b: 1.0 / (seg_dist(p, b, posed) ** 2 + soft ** 2) ** 2 for b in bones}


def deform(p, ws):
    """a rest-pose point carried into the idle's first frame by its skin weights"""
    q = B(p)
    out = Vector((0, 0, 0))
    for b, x in top4(ws).items():
        out += (DELTA[b] @ q) * x
    return P(out)


def top4(w):
    """the four biggest weights, normalised. The fifth is taken off each first, so a bone fades out exactly where a
    neighbouring vertex trades it for another: cut off hard, neighbours jumped to different bones and tore apart"""
    items = sorted(((v, k) for k, v in w.items() if v > 0), reverse=True)
    floor = items[4][0] if len(items) > 4 else 0.0
    items = [(v - floor, k) for v, k in items[:4] if v > floor] or items[:1]
    s = sum(v for v, _ in items) or 1.0
    return {k: v / s for v, k in items}


def blend(ws):
    """the average of several vertices' weights"""
    out = {}
    for w in ws:
        for k, v in w.items():
            out[k] = out.get(k, 0.0) + v / len(ws)
    return out


def mix(a, b, t):
    """(1 - t) a + t b, each normalised first"""
    a, b = top4(a), top4(b)
    out = {k: v * (1 - t) for k, v in a.items()}
    for k, v in b.items():
        out[k] = out.get(k, 0.0) + v * t
    return out


# ---------------------------------------------------------------------------------------------------- materials

MATS = {}


def mat(name):
    if name not in MATS:
        spec = {
            # name: colour, roughness, metalness, detail, edge wear, bump, detail scale, colour wander
            'coat': (0x172036, 0.86, 0.0, 'weave', 0.0, 0.3, 190),
            'mantle': (0x121a2e, 0.9, 0.0, 'weave', 0.0, 0.35, 150),
            'hood': (0x131b30, 0.9, 0.0, 'weave', 0.0, 0.35, 150),
            'scarf': (0x222a3d, 0.95, 0.0, 'weave', 0.0, 0.5, 95),
            'trousers': (0x181c29, 0.85, 0.0, 'weave', 0.0, 0.3, 200),
            'stitch': (0x2b3753, 0.8, 0.0, 'weave', 0.0, 0.2, 260),
            'leather': (0x2b2a31, 0.6, 0.0, 'leather', 0.35, 0.35, 70),
            'glove': (0x26252c, 0.55, 0.0, 'leather', 0.3, 0.3, 120),
            'boot': (0x232229, 0.62, 0.0, 'leather', 0.45, 0.4, 60),
            'iron': (0x353b49, 0.48, 0.85, 'hammer', 0.5, 0.35, 60),
            'glass': (0x0e1a2c, 0.12, 0.0, 'smooth', 0.0, 0.0, 10),
            'skin': (0x3f3431, 0.62, 0.0, 'smooth', 0.0, 0.08, 120),
        }[name]
        c, r, m, d, w, b, s = spec
        MATS[name] = Mat(name, c, r, m, d, wear=w, bump=b, scale=s)
    return MATS[name].m


EYE = bpy.data.materials.new('wanderer-eye')
EYE.use_nodes = True
_eb = EYE.node_tree.nodes['Principled BSDF']
_eb.inputs['Base Color'].default_value = (*hexrgb(0x0b1422), 1)
_eb.inputs['Roughness'].default_value = 0.3
# the page lights the eyes (hero.ts); the preview stills switch this on to see them
_eb.inputs['Emission Color'].default_value = (*hexrgb(0x9fe6ff), 1)
_eb.inputs['Emission Strength'].default_value = 0.0

# ---------------------------------------------------------------------------------------------------- pieces

COLL = bpy.data.collections.new('wanderer')
SCENE.collection.children.link(COLL)
PARTS = []  # (object, role, uv scale)


def add(name, verts, faces, m, w, role='body', sub=0, solid=0.0, uv=1.0, center=None, flip=False, posed=False):
    """
    One piece. w gives its skin weights: a list of bone names (weights fall off with distance), a function of the
    page-space point, or one dict per vertex. A piece drawn in the rig's rest pose is then carried into the idle's first
    frame by those weights; a posed one is drawn there already. Weights go on before the solidify and subdivision, which
    carry them over.
    """
    me = bpy.data.meshes.new(f'wanderer-{name}')
    me.from_pydata([B(v) for v in verts], [], faces)
    me.validate()
    o = bpy.data.objects.new(me.name, me)
    COLL.objects.link(o)
    groups = {}
    for i, v in enumerate(verts):
        p = V(v)
        if isinstance(w, (list, tuple)) and w and isinstance(w[0], dict):
            ws = top4(w[i])
        elif callable(w):
            ws = top4(w(p))
        else:
            ws = top4(near(p, w, posed=posed))
        for b, x in ws.items():
            if b not in groups:
                groups[b] = o.vertex_groups.new(name=b)
            groups[b].add([i], x, 'REPLACE')
        if not posed:
            me.vertices[i].co = B(deform(p, ws))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if all(e.is_manifold for e in bm.edges):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    else:
        c = B(V(center)) if center is not None else sum((v.co for v in bm.verts), Vector()) / max(1, len(bm.verts))
        bm.faces.ensure_lookup_table()
        score = sum((f.calc_center_median() - c).dot(f.normal) * f.calc_area() for f in bm.faces)
        if (score < 0) != flip:
            for f in bm.faces:
                f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m if isinstance(m, bpy.types.Material) else mat(m))
    for p in me.polygons:
        p.use_smooth = True
    if solid:
        md = o.modifiers.new('solid', 'SOLIDIFY')
        md.thickness = solid
        md.offset = -1
        md.use_even_offset = True
    if sub:
        md = o.modifiers.new('sub', 'SUBSURF')
        md.levels = md.render_levels = sub
    apply_mods(o)
    PARTS.append((o, role, uv))
    return o


def tube(name, pts, r, m, w, n=8, role='body', sub=0, closed=False, steps=1, aspect=1.0, front=(0, 0, 1), uv=1.0, caps=True, posed=False):
    """
    A tube along pts. w as for add(), or ('chain', bones) with one bone per span of pts: then each ring follows the span
    it lies on, blending into the next across each joint. A curled finger's joints come close to each other and to the
    palm, so weights by distance alone pulled the base of a finger towards its middle joint.
    """
    spans = len(pts) - 1
    if steps > 1:
        pts = smooth_path(pts, steps)
    radii = r if isinstance(r, (list, tuple)) else [r] * len(pts)
    if len(radii) != len(pts):
        radii = interp(list(radii), len(pts))
    if closed:
        pts = list(pts) + [pts[0]]
        radii = list(radii) + [radii[0]]
    secs = path_secs(pts, radii, front=front, aspect=aspect)
    if closed:
        secs[0]['t'] = secs[-1]['t'] = V(pts[1]) - V(pts[-2])
    v, f, rings = loft(secs, n, cap0=caps and not closed, cap1=caps and not closed)
    if closed:
        remap = {a: b for a, b in zip(rings[-1], rings[0])}
        f = [tuple(remap.get(i, i) for i in face) for face in f]
    if isinstance(w, tuple) and w[0] == 'chain':
        bones = w[1]

        def along(x):
            # each span's bone peaks at the span's middle and hands over to its neighbour at the joint
            ws = {}
            for i, b in enumerate(bones):
                k = 1.0 if (i == 0 and x <= 0.5) or (i == spans - 1 and x >= spans - 0.5) else max(0.0, 1 - abs(x - (i + 0.5)))
                if k > 0:
                    ws[b] = ws.get(b, 0.0) + k
            return ws
        ring_w = [along(spans * r / (len(rings) - 1)) for r in range(len(rings))]
        w = [None] * len(v)
        for r, ring in enumerate(rings):
            for i in ring:
                w[i] = ring_w[r]
        for i in range(len(v)):
            if w[i] is None:
                # a cap's middle: the ring it closes
                w[i] = ring_w[0] if (v[i] - v[rings[0][0]]).length < (v[i] - v[rings[-1][0]]).length else ring_w[-1]
    return add(name, v, f, m, w, role=role, sub=sub, uv=uv, posed=posed)


def ball(name, at, r, m, w, s=(1, 1, 1), n=14, sub=0, rot=None, uv=1.0, role='body', posed=False):
    rings = max(6, n // 2)
    secs = []
    for i in range(rings + 1):
        a = -math.pi / 2 + math.pi * i / rings
        rr = max(1e-4, math.cos(a) * r)
        secs.append(dict(c=(0, math.sin(a) * r * s[1], 0), rx=rr * s[0], rz=rr * s[2]))
    v, f, _ = loft(secs, n)
    if rot:
        R = Euler(rot, 'XYZ').to_matrix()
        v = [R @ x for x in v]
    v = [x + V(at) for x in v]
    return add(name, v, f, m, w, sub=sub, center=at, uv=uv, role=role, posed=posed)


def grid(name, rows, m, w, role='cloth', solid=0.0, closed=True, sub=0, uv=1.0, center=None, posed=False):
    """a surface through rows of points (each row a ring around the figure when closed); w: one dict per point"""
    verts = [p for row in rows for p in row]
    n = len(rows[0])
    faces = []
    for i in range(len(rows) - 1):
        for j in range(n if closed else n - 1):
            j2 = (j + 1) % n
            faces.append((i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j))
    return add(name, verts, faces, m, w, role=role, solid=solid, sub=sub, uv=uv, center=center, posed=posed)


def surface_hit(objs, at, toward):
    """the first point of objs on the ray from at (page space) along toward"""
    dg = bpy.context.evaluated_depsgraph_get()
    best = None
    for o in objs:
        tree = BVHTree.FromObject(o, dg)
        hit = tree.ray_cast(B(V(at)), B(V(toward)).normalized())
        if hit[0] is not None:
            d = (hit[0] - B(V(at))).length
            if best is None or d < best[0]:
                best = (d, P(hit[0]))
    return best[1] if best else None


def catmull(vals, n):
    """n samples of a Catmull-Rom curve through vals (numbers)"""
    v = [vals[0] * 2 - vals[1]] + list(vals) + [vals[-1] * 2 - vals[-2]]
    out = []
    for i in range(n):
        x = i / (n - 1) * (len(vals) - 1)
        k = min(int(x), len(vals) - 2)
        t = x - k
        p0, p1, p2, p3 = v[k], v[k + 1], v[k + 2], v[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out


def resample(loop, n):
    """n points evenly spaced along a closed polyline"""
    pts = loop + [loop[0]]
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1]
    out, k = [], 0
    for i in range(n):
        d = total * i / n
        while lens[k + 1] < d:
            k += 1
        t = (d - lens[k]) / max(1e-9, lens[k + 1] - lens[k])
        out.append(pts[k].lerp(pts[k + 1], t))
    return out


# ---------------------------------------------------------------------------------------------------- the figure

HEAD_C = V(0, 1.66, 0.0)
HEAD_R = (0.072, 0.112, 0.09)
TORSO = [(0.90, 0.172, 0.125, -0.03), (1.0, 0.166, 0.118, -0.025), (1.12, 0.172, 0.122, -0.015), (1.25, 0.186, 0.13, -0.008),
         (1.36, 0.19, 0.128, -0.012), (1.43, 0.175, 0.115, -0.02), (1.49, 0.14, 0.095, -0.028), (1.53, 0.085, 0.07, -0.032)]
SPINE = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01']


def head():
    hw = lambda p: {'Head': 1.0}
    ball('head', HEAD_C, HEAD_R[2], 'skin', hw, s=(HEAD_R[0] / HEAD_R[2], HEAD_R[1] / HEAD_R[2], 1), n=24, uv=2.2)
    for s in (-1, 1):
        # calm, level eyes set just under the brow; the page lights them (hero.ts finds them by this material)
        ball(f'eye{s}', (s * 0.031, 1.673, 0.0795), 0.0125, EYE, hw, s=(1, 0.46, 0.5), n=12, rot=(0, 0, s * -0.08), role='eye', uv=2.2)


def mask_and_scarf():
    """a cloth mask from the bridge of the nose down round the neck, two loose turns of scarf, and its hanging end"""
    rows = [(1.658, 0.076, 0.093, 0.002, 0.016), (1.635, 0.078, 0.097, 0.0, 0.015), (1.60, 0.075, 0.097, 0.0, 0.006),
            (1.575, 0.068, 0.09, -0.003, 0.0), (1.55, 0.062, 0.076, -0.008, 0.0), (1.515, 0.062, 0.068, -0.02, 0.0)]
    secs = [dict(c=(0, y, zc), rx=rx, rz=rz, s=ridge(push, 0.32)) for y, rx, rz, zc, push in rows]
    v, f, rings = loft(secs, 22)
    w = lambda p: {'Head': smoothstep(1.53, 1.6, p.y), 'neck_01': 1 - smoothstep(1.53, 1.6, p.y)}
    add('mask', v, f, 'scarf', w, solid=0.004, sub=1, center=(0, 1.6, 0), uv=2.0)
    top = [v[i] for i in rings[0]] + [v[rings[0][0]]]
    tube('mask-hem', top, 0.0045, 'scarf', w, n=6, caps=False, uv=2.0)
    for i, (y, droop, rx, rz, r) in enumerate(((1.535, 0.012, 0.084, 0.098, 0.017), (1.565, 0.02, 0.08, 0.094, 0.015))):
        pts = []
        for k in range(24):
            a = TAU * k / 24
            front = max(0.0, math.sin(a))
            pts.append(V(rx * math.cos(a), y - droop * front ** 2 + 0.004 * math.sin(3 * a + i), -0.01 + rz * math.sin(a)))
        tube(f'turn{i}', pts, r, 'scarf', ['neck_01', 'spine_03', 'Head'], n=8, closed=True, uv=1.6)


def hood_and_mantle():
    """the hood and the shoulder mantle are one garment: the mantle grows out of the hood's lower edge"""
    keys = [  # z, half-width at eye height, centre height, crown height, lower edge height, lower edge half-width
        (0.132, 0.099, 1.655, 1.762, 1.53, 0.095),
        (0.09, 0.124, 1.66, 1.81, 1.545, 0.116),
        (0.02, 0.142, 1.665, 1.83, 1.555, 0.124),
        (-0.06, 0.143, 1.665, 1.826, 1.555, 0.124),
        (-0.13, 0.128, 1.665, 1.80, 1.55, 0.11),
        (-0.185, 0.095, 1.665, 1.772, 1.54, 0.08),
        (-0.215, 0.05, 1.665, 1.752, 1.535, 0.042),
        (-0.228, 0.006, 1.665, 1.742, 1.53, 0.005),
    ]
    R = 15
    cols = [catmull([k[i] for k in keys], R) for i in range(6)]
    NS, NA = 6, 16
    rows = []
    for r in range(R):
        z, rx, yc, yt, yb, xb = (c[r] for c in cols)
        u = r / (R - 1)
        peak = smoothstep(0.5, 1.0, u)
        side = [((xb + (rx - xb) * (1 - (1 - t) ** 2)), yb + (yc - yb) * t) for t in (i / NS for i in range(NS))]
        prof = [(-x, y, 0.0) for x, y in side]
        for i in range(NA + 1):
            a = math.pi - math.pi * i / NA
            top = math.sin(a) ** 6
            # a soft point at the back of the crown, falling back and a little down
            prof.append((rx * math.cos(a), yc + (yt - yc) * math.sin(a) + 0.028 * peak * top, -0.06 * peak * top))
        prof += [(x, y, 0.0) for x, y in reversed(side)]
        rows.append([V(x, y, z + dz) for x, y, dz in prof])
    # gentle creases along the hood, deepest at the sides and fading to the rim
    rnd = random.Random(3)
    phase = [rnd.random() * TAU for _ in range(4)]
    for r, row in enumerate(rows):
        u = r / (R - 1)
        for j, p in enumerate(row):
            s = j / (len(row) - 1)
            d = (p - V(0, 1.665, p.z))
            d.z = 0
            if d.length > 1e-6:
                d.normalize()
            amp = 0.006 * math.sin(math.pi * u) * (0.4 + 0.6 * abs(math.cos(math.pi * s)))
            row[j] = p + d * amp * math.sin(9 * math.pi * s + phase[r % 4] * 0.3 + 4 * u)

    def hood_w(p):
        h = smoothstep(1.565, 1.665, p.y)
        return {'Head': h, 'neck_01': (1 - h) * 0.55, 'spine_03': (1 - h) * 0.45}
    n = len(rows[0])
    verts = [p for row in rows for p in row]
    faces = [(i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j) for i in range(R - 1) for j in range(n - 1)]
    add('hood', verts, faces, 'hood', hood_w, role='cloth', solid=0.011, sub=1, center=(0, 1.665, -0.05))
    # the opening's edge folded back on itself: a flat hem sunk into the edge, deeper than it is wide
    rim = [rows[0][j] + V(0, 0, -0.003) for j in range(n)]
    tube('hood-rim', rim, 0.0085, 'hood', hood_w, n=10, steps=2, aspect=1.9, uv=1.2)

    # the mantle: from the hood's lower edge (closed across the chin) out over the shoulders to its hem. It is drawn in the
    # idle's first frame, where it hangs over arms at rest, starting from where the hood's edge is carried in that frame.
    loop = [rows[r][0] for r in range(R)] + [rows[r][-1] for r in reversed(range(R))]
    a0, b0 = rows[0][-1], rows[0][0]
    loop += [a0.lerp(b0, t) + V(0, -0.006 * math.sin(math.pi * t), 0.012 * math.sin(math.pi * t)) for t in (k / 6 for k in range(1, 6))]
    M, K = 80, 13
    collar = [deform(c + V(0, 0.008, 0), hood_w(c)) for c in resample(loop, M)]
    # start at the back seam so both halves match
    i0 = min(range(M), key=lambda i: (collar[i].z, abs(collar[i].x)))
    collar = collar[i0:] + collar[:i0]
    cz = -0.05
    rows_m = []
    for k in range(K):
        t = k / (K - 1)
        row = []
        for c in collar:
            a = math.atan2(c.z - cz, c.x)
            side = abs(math.cos(a))
            # the hem starts outside the hanging sleeves and the shoulders round out, so little has to be pushed clear
            hem = V(math.cos(a) * 0.32, 1.305 - 0.025 * side, cz + math.sin(a) * 0.235)
            out = V(math.cos(a), 0, math.sin(a))
            p = c.lerp(hem, 1 - (1 - t) ** 1.5) + out * ((0.018 + 0.025 * side) * math.sin(math.pi * t))
            p += out * (0.004 + 0.016 * t ** 1.2) * math.sin(12 * a + 0.7)
            if k == K - 1:
                p += V(0, 0.01 * math.sin(7 * a + 1.3) + 0.004 * math.sin(23 * a), 0)
            row.append(p)
        rows_m.append(row)
    clear(rows_m)
    # the spine carries the mantle; only its sides over each shoulder share in that arm's moves. By distance alone the
    # raised arm's weight reached across the back and pulled it open, and neighbours near the shoulder tore apart.
    grid_w = []
    for k in range(K):
        t = k / (K - 1)
        e = smoothstep(0.0, 0.5, t)
        row = []
        for c in collar:
            a = math.atan2(c.z - cz, c.x)
            arm = smoothstep(0.5, 0.95, abs(math.cos(a))) * smoothstep(0.2, 0.75, t)
            s = 'l' if math.cos(a) > 0 else 'r'
            w = {'neck_01': 0.55 * (1 - e), 'spine_03': 0.45 * (1 - e) + 0.8 * e, 'spine_02': 0.2 * e}
            w = {b: x * (1 - 0.6 * arm) for b, x in w.items()}
            w[f'clavicle_{s}'] = 0.2 * arm
            w[f'upperarm_{s}'] = 0.4 * arm
            row.append(w)
        grid_w.append(row)
    for _ in range(2):
        # the collar row keeps the hood's weights, so the two stay sewn together
        grid_w = [[grid_w[k][j] if k == 0 else blend([grid_w[k][j], grid_w[k][j], grid_w[k][(j - 1) % M], grid_w[k][(j + 1) % M], grid_w[k - 1][j], grid_w[min(K - 1, k + 1)][j]])
                   for j in range(M)] for k in range(K)]
    weights = [top4(x) for row in grid_w for x in row]
    mantle = add('mantle', [p for row in rows_m for p in row],
                 [(i * M + j, i * M + (j + 1) % M, (i + 1) * M + (j + 1) % M, (i + 1) * M + j) for i in range(K - 1) for j in range(M)],
                 'mantle', weights, role='cloth', solid=0.009, center=(0, 1.3, -0.05), posed=True)
    hem = rows_m[-1]
    hem_w = [weights[(K - 1) * M + j] for j in range(M)]
    tube('mantle-piping', hem + [hem[0]], 0.0042, 'stitch', lambda p: hem_w[min(range(M), key=lambda j: (hem[j] - p).length)], n=5, posed=True)
    return mantle


def clearance(p):
    """how far p must move out to clear the body and the sleeves in the idle's first frame, and which way"""
    best = Vector((0, 0, 0))
    for s in ('l', 'r'):
        for a, b, r in ((JP[f'upperarm_{s}'], JP[f'lowerarm_{s}'], 0.09), (JP[f'clavicle_{s}'].lerp(JP[f'upperarm_{s}'], 0.7), JP[f'upperarm_{s}'], 0.088)):
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            q = a + ab * t
            d = p - q
            if d.length < r:
                push = d.normalized() * (r - d.length) if d.length > 1e-6 else Vector((0, 0, 0))
                if push.length > best.length:
                    best = push
    for (y0, rx0, rz0, z0), (y1, rx1, rz1, z1) in zip(TORSO, TORSO[1:]):
        if y0 <= p.y <= y1:
            f = (p.y - y0) / (y1 - y0)
            rx, rz, zc = rx0 + (rx1 - rx0) * f, rz0 + (rz1 - rz0) * f, z0 + (z1 - z0) * f
            c = deform(V(0, p.y, zc), near(V(0, p.y, zc), SPINE))
            dx, dz = p.x - c.x, p.z - c.z
            k = math.hypot(dx / (rx + 0.022), dz / (rz + 0.022))
            if 1e-6 < k < 1:
                push = Vector((dx / k - dx, 0, dz / k - dz))
                if push.length > best.length:
                    best = push
    return best


def clear(rows):
    """
    moves a cloth grid (closed rows) off the body and sleeves in small steps, each spread over its neighbours, so the cloth
    stays smooth: a last unsmoothed push raised spikes on the mantle's hem over the shoulders
    """
    K, M = len(rows), len(rows[0])
    for _ in range(8):
        moves = [[clearance(p) for p in row] for row in rows]
        for _ in range(10):
            moves = [[(moves[k][j] * 2 + moves[k][(j - 1) % M] + moves[k][(j + 1) % M] + moves[max(0, k - 1)][j] + moves[min(K - 1, k + 1)][j]) / 6 for j in range(M)] for k in range(K)]
        for k in range(1, K):
            for j in range(M):
                rows[k][j] = rows[k][j] + moves[k][j] * 1.5


def coat():
    secs = [dict(c=(0, y, zc), rx=rx, rz=rz) for y, rx, rz, zc in TORSO]
    v, f, _ = loft(secs, 28)
    # the body of the coat follows the spine and collarbones only: the sleeves and the mantle cover the shoulders, and a
    # share of the upper arm here tore the chest open whenever an arm reached forward
    add('coat', v, f, 'coat', SPINE + ['clavicle_l', 'clavicle_r'], sub=1, center=(0, 1.2, 0))
    # the skirt: open at the front, folds deepening to the hem
    K, n = 14, 44
    g = 0.27
    arc = (math.pi / 2 + g, math.pi / 2 + TAU - g)
    rows, weights = [], []
    for k in range(K):
        t = k / (K - 1)
        y = 1.02 - 0.75 * t
        rx = 0.178 + 0.112 * t ** 1.3
        rz = 0.128 + 0.107 * t ** 1.2
        zc = -0.025 - 0.025 * t
        row = []
        for j in range(n + 1):
            u = j / n
            a = arc[0] + (arc[1] - arc[0]) * u
            back = math.sin(math.pi * u) ** 0.5
            amp = (0.004 + 0.05 * t ** 1.2) * back
            kx = 1 + amp * math.sin(9 * TAU * u * 0.5 + 0.6 + 0.8 * t)
            p = V(rx * math.cos(a) * kx, y, zc + rz * math.sin(a) * kx)
            if k == K - 1:
                p += V(0, 0.018 * math.sin(4.5 * TAU * u + 0.8) + 0.008 * math.sin(u * 31.0), 0)
            row.append(p)
            side = smoothstep(-0.07, 0.07, p.x)
            legs = {}
            for s, share in (('l', side), ('r', 1 - side)):
                for b, x in top4(near(p, [f'thigh_{s}', f'calf_{s}'])).items():
                    legs[b] = x * share
            weights.append(mix({'pelvis': 1.0}, legs, 0.1 + 0.55 * t))
        rows.append(row)
    sk = grid('skirt', rows, 'coat', weights, solid=0.008, closed=False, center=(0, 0.6, -0.05))
    for e in (0, n):
        edge = [rows[k][e] for k in range(K)]
        tube(f'skirt-edge{e}', edge, 0.005, 'stitch', lambda p, e=e: weights[min(range(K), key=lambda k: (rows[k][e] - p).length) * (n + 1) + e], n=5)
    hem = rows[-1]
    tube('skirt-piping', hem, 0.005, 'stitch', lambda p: weights[(K - 1) * (n + 1) + min(range(n + 1), key=lambda j: (hem[j] - p).length)], n=5)
    # the belt over the skirt's top
    belt = [dict(c=(0, y, -0.025), rx=0.19, rz=0.138) for y in (0.995, 1.045)]
    v, f, _ = loft(belt, 36)
    add('belt', v, f, 'leather', ['pelvis', 'spine_01'], solid=0.006, center=(0, 1.02, 0))
    fz = -0.025 + 0.138 + 0.008
    pts = [V(-0.022, 1.004, fz), V(0.022, 1.004, fz), V(0.022, 1.036, fz), V(-0.022, 1.036, fz)]
    tube('buckle', pts, 0.0035, 'iron', ['pelvis'], n=6, closed=True, uv=2.0)
    return sk


def sleeves():
    """drawn along the arms as they hang in the idle's first frame"""
    for s in ('l', 'r'):
        cl, sh, el, wr = (JP[f'{k}_{s}'] for k in ('clavicle', 'upperarm', 'lowerarm', 'hand'))
        fd = (wr - el).normalized()
        pts = [cl.lerp(sh, 0.7), sh, sh.lerp(el, 0.5), el, el.lerp(wr, 0.45), wr - fd * 0.026]
        bones = ['spine_03', f'clavicle_{s}', f'upperarm_{s}', f'lowerarm_{s}']
        tube(f'sleeve-{s}', pts, [0.07, 0.074, 0.068, 0.062, 0.058, 0.056], 'coat', bones, n=16, steps=2, sub=1, caps=False, posed=True)
        cuff = [dict(c=wr - fd * d, t=fd, rx=r, rz=r) for d, r in ((0.075, 0.057), (0.042, 0.059), (0.014, 0.061))]
        v, f, rings = loft(cuff, 18)
        add(f'cuff-{s}', v, f, 'coat', [f'lowerarm_{s}'], solid=0.006, center=wr - fd * 0.06, posed=True)
        tube(f'cuff-piping-{s}', [v[i] for i in rings[-1]] + [v[rings[-1][0]]], 0.004, 'stitch', [f'lowerarm_{s}'], n=5, caps=False, posed=True)


def hands():
    """gloved hands, drawn on the idle's first frame in each hand's own frame: along it, across it and out of the palm"""
    for s, x in (('l', 1), ('r', -1)):
        fb = lambda name: f'{name}_{s}'
        h = JP[fb('hand')]
        d = (JP[fb('middle_01')] - h).normalized()
        wv = JP[fb('index_01')] - JP[fb('pinky_01')]
        wv = (wv - d * wv.dot(d)).normalized()
        pn = d.cross(wv) * x
        fd = (h - JP[fb('lowerarm')]).normalized()
        # a leather gauntlet that flares into the coat's cuff, with a stitched band where it narrows to the wrist
        cuff = [dict(c=h - fd * dist, t=fd, f=pn, rx=r, rz=r * 0.88) for dist, r in ((0.07, 0.05), (0.035, 0.05), (0.012, 0.044), (-0.008, 0.034))]
        v, f, rings = loft(cuff, 16)
        add(f'glove-cuff-{s}', v, f, 'glove', [fb('lowerarm'), fb('hand')], solid=0.004, center=h - fd * 0.03, uv=2.6, posed=True)
        band = ring(h - fd * 0.012, fd, pn, 0.0455, 0.0455 * 0.88, 16)[0]
        tube(f'glove-seam-{s}', band, 0.0032, 'leather', [fb('lowerarm'), fb('hand')], n=5, closed=True, uv=2.6, posed=True)
        palm = [dict(c=h + d * a + wv * wo + pn * no, t=d, f=pn, rx=hw, rz=ht) for a, hw, ht, wo, no in
                # a narrow wrist, the full heel of the hand on the palm side, then flatter to the knuckles
                ((-0.02, 0.027, 0.02, -0.001, 0.0), (0.01, 0.035, 0.022, -0.002, 0.002), (0.035, 0.044, 0.025, -0.003, 0.006),
                 (0.07, 0.05, 0.021, -0.004, 0.0075), (0.1, 0.052, 0.017, -0.005, 0.008), (0.12, 0.05, 0.0155, -0.005, 0.0085),
                 (0.133, 0.043, 0.0125, -0.005, 0.0085))]
        v, f, _ = loft(palm, 16, cap0=True, cap1=True)
        pb = [fb('lowerarm'), fb('hand')] + [fb(f'{k}_01') for k in FINGERS]
        add(f'palm-{s}', v, f, 'glove', pb, sub=1, center=h + d * 0.05, uv=2.6, posed=True)
        knuckles = []
        for k, size in (('index', 1.0), ('middle', 1.03), ('ring', 0.98), ('pinky', 0.88)):
            c0, c1, c2, tip = [JP[fb(f'{k}_0{i}')] for i in (1, 2, 3)] + [JP[fb(f'{k}_04_leaf')]]
            dk = (c1 - c0).normalized()
            dt = (tip - c2).normalized()
            knuckles.append(c0 - pn * 0.0085 - dk * 0.003)
            # each joint a little narrower than the pads either side of it, flatter than round, tapering to the tip
            pts = [c0 - dk * 0.016, c0, c0.lerp(c1, 0.5), c1, c1.lerp(c2, 0.5), c2, c2.lerp(tip, 0.45), tip - dt * 0.004, tip + dt * 0.001]
            radii = [r * size for r in (0.0138, 0.0138, 0.0131, 0.0119, 0.0124, 0.0111, 0.0113, 0.0097, 0.0062)]
            bones = [fb('hand'), fb(f'{k}_01'), fb(f'{k}_01'), fb(f'{k}_02'), fb(f'{k}_02'), fb(f'{k}_03'), fb(f'{k}_03'), fb(f'{k}_03')]
            tube(f'{k}-{s}', pts, radii, 'glove', ('chain', bones), n=8, aspect=0.82, front=pn, sub=1, uv=2.6, posed=True)
        # the ridge of knuckles across the back of the hand
        ends = [knuckles[0] + (knuckles[0] - knuckles[1]) * 0.35] + knuckles + [knuckles[-1] + (knuckles[-1] - knuckles[-2]) * 0.35]
        tube(f'knuckles-{s}', ends, [0.006, 0.0088, 0.0092, 0.009, 0.0082, 0.0055], 'glove', [fb('hand')] + [fb(f'{k}_01') for k in ('index', 'middle', 'ring', 'pinky')],
             n=10, steps=3, aspect=0.7, front=pn, sub=1, uv=2.6, posed=True)
        t1, t2, t3, tip = [JP[fb(f'thumb_0{i}')] for i in (1, 2, 3)] + [JP[fb('thumb_04_leaf')]]
        dt = (tip - t3).normalized()
        pts = [t1.lerp(h, 0.35), t1, t1.lerp(t2, 0.5), t2, t2.lerp(t3, 0.5), t3, t3.lerp(tip, 0.45), tip - dt * 0.004, tip + dt * 0.001]
        bones = [fb('hand'), fb('thumb_01'), fb('thumb_01'), fb('thumb_02'), fb('thumb_02'), fb('thumb_03'), fb('thumb_03'), fb('thumb_03')]
        tube(f'thumb-{s}', pts, [0.0165, 0.0155, 0.0146, 0.0132, 0.0135, 0.0121, 0.0119, 0.0102, 0.0066], 'glove', ('chain', bones), n=8, aspect=0.86, front=pn, sub=1, uv=2.6, posed=True)
        # the ball of the thumb, joining it to the palm
        tube(f'thenar-{s}', [h.lerp(t1, 0.25) + d * 0.02, t1.lerp(t2, 0.4)], [0.019, 0.0145], 'glove',
             [fb('hand'), fb('thumb_01'), fb('thumb_02')], n=10, aspect=0.75, front=pn, sub=1, uv=2.6, posed=True)


def legs():
    for s, x in (('l', 1), ('r', -1)):
        bones = ['pelvis', f'thigh_{s}', f'calf_{s}']
        pts = [V(x * 0.093, 1.03, -0.03), V(x * 0.0906, 0.75, -0.03), V(x * 0.0906, 0.542, -0.022), V(x * 0.0906, 0.3, -0.045), V(x * 0.0906, 0.14, -0.07)]
        tube(f'trouser-{s}', pts, [0.09, 0.075, 0.056, 0.05, 0.045], 'trousers', bones, n=14, steps=2, sub=1)
        shaft = [dict(c=(x * 0.0906, y, zc), rx=r, rz=r * 1.08) for y, r, zc in ((0.37, 0.061, -0.048), (0.3, 0.056, -0.05), (0.2, 0.052, -0.058), (0.12, 0.05, -0.068), (0.07, 0.054, -0.075))]
        v, f, _ = loft(shaft, 18)
        add(f'boot-{s}', v, f, 'boot', [f'calf_{s}', f'foot_{s}'], sub=1, center=(x * 0.09, 0.2, -0.06), uv=1.3)
        fold = [dict(c=(x * 0.0906, y, -0.048), rx=r, rz=r * 1.08) for y, r in ((0.405, 0.066), (0.345, 0.068))]
        v, f, rings = loft(fold, 18)
        add(f'boot-fold-{s}', v, f, 'boot', [f'calf_{s}'], solid=0.005, center=(x * 0.09, 0.37, -0.048), uv=1.3)
        tube(f'boot-strap-{s}', [p for p in (V(x * 0.0906 + 0.054 * math.cos(a), 0.135, -0.068 + 0.058 * math.sin(a)) for a in (TAU * k / 16 for k in range(16)))],
             0.0055, 'leather', [f'calf_{s}', f'foot_{s}'], n=6, closed=True, uv=1.6)
        foot = [V(x * 0.0906, 0.052, -0.135), V(x * 0.0906, 0.066, -0.08), V(x * 0.091, 0.062, -0.01), V(x * 0.092, 0.05, 0.06), V(x * 0.093, 0.04, 0.12), V(x * 0.093, 0.032, 0.158), V(x * 0.093, 0.03, 0.172)]
        secs = path_secs(foot, [0.044, 0.054, 0.052, 0.05, 0.043, 0.03, 0.012], front=(0, 1, 0), aspect=0.62)
        v, f, _ = loft(secs, 16, cap0=True, cap1=True)
        v = [V(p.x, max(p.y, 0.004), p.z) for p in v]
        add(f'foot-{s}', v, f, 'boot', [f'calf_{s}', f'foot_{s}', f'ball_{s}'], sub=1, center=(x * 0.09, 0.05, 0.0), uv=1.3)


def gear(mantle, skirt):
    """pieces laid on the coat, mantle and skirt as they stand in the idle's first frame"""
    torso = [o for o, _, _ in PARTS if o.name == 'wanderer-coat']
    # where a rest-pose spot on the body has moved to in the idle's first frame, following one bone
    moved = lambda x, y, z, bone: V(x, y, z) + (JP[bone] - J[bone])
    # a strap from under the mantle across the chest to the left hip, and down the back the same way
    for side, toward in (('front', V(0, 0, -1)), ('back', V(0, 0, 1))):
        pts = []
        for i in range(9):
            t = i / 8
            o = moved(-0.13 + 0.29 * t, 1.36 - 0.33 * t, -toward.z * 0.6, 'spine_02')
            hit = surface_hit(torso, o, toward)
            if hit is not None:
                pts.append(hit - toward * 0.007)
        tube(f'strap-{side}', pts, 0.02, 'leather', SPINE + ['clavicle_r'], n=8, steps=2, aspect=0.22, front=(0, 0, 1), uv=1.4, posed=True)
    # the clasp that closes the mantle under the chin
    c = surface_hit([mantle], moved(0, 1.47, 0.6, 'spine_03'), V(0, 0, -1))
    if c is not None:
        ball('clasp', c + V(0, 0, 0.004), 0.016, 'iron', ['spine_03', 'neck_01'], s=(1, 1, 0.35), n=16, uv=2.0, posed=True)
        tube('clasp-ring', [c + V(0.014 * math.cos(a), 0.014 * math.sin(a), 0.008) for a in (TAU * k / 14 for k in range(14))], 0.0028, 'iron', ['spine_03'], n=6, closed=True, uv=2.0, posed=True)
    # the scarf's end over the mantle, hanging free below its hem, fringed
    path = []
    for i in range(12):
        t = i / 11
        o = moved(0.045 + 0.05 * math.sin(t * 1.6), 1.525 - 0.42 * t, 0.6, 'spine_03')
        hit = surface_hit([mantle], o, V(0, 0, -1))
        path.append(hit + V(0, 0, 0.008) if hit is not None else o)
    # below the mantle's hem it hangs free, falling a little back towards the coat
    hung = [i for i, p in enumerate(path) if p.z > 0.5]
    for i in hung:
        prev = path[i - 1]
        path[i] = V(prev.x + 0.002, path[i].y, prev.z - 0.012)
    tail_w = lambda p: near(p, ['neck_01', 'spine_03', 'spine_02'], soft=0.03, posed=True)
    end = tube('scarf-end', path, 0.034, 'scarf', tail_w, n=10, steps=2, aspect=0.12, front=(0, 0, 1), role='cloth', uv=1.6, posed=True)
    tip = path[-1]
    for k in range(7):
        fx = tip.x - 0.028 + 0.056 * k / 6
        tube(f'fringe{k}', [V(fx, tip.y + 0.002, tip.z), V(fx + 0.002 * (k % 2), tip.y - 0.028 - 0.006 * (k % 3), tip.z - 0.002)], [0.0032, 0.0022], 'scarf', tail_w, n=5, uv=1.6, posed=True)
    # the lantern, hung from the belt left of the coat's opening, clear of the hand; dark until the story lights it
    o = moved(0.07, 0.885, 0.6, 'pelvis')
    at = surface_hit([skirt], o, V(0, 0, -1)) or V(o.x, o.y, 0.1)
    L = V(o.x, o.y, at.z + 0.04)
    lw = lambda p: {'pelvis': 0.75, 'thigh_l': 0.25}
    hook = deform(V(0.068, 1.0, -0.025 + 0.138 + 0.006), {'pelvis': 1.0})
    tube('lantern-hook', [hook, hook + V(0.001, -0.015, 0.012), V(L.x, L.y + 0.075, L.z)], 0.0026, 'iron', lw, n=6, steps=3, uv=2.0, posed=True)
    tube('lantern-bail', [L + V(0.013 * math.cos(a), 0.062 + 0.013 * math.sin(a), 0) for a in (math.pi * k / 10 for k in range(11))], 0.0022, 'iron', lw, n=6, uv=2.0, posed=True)
    cap = [dict(c=L + V(0, y, 0), rx=r, rz=r) for y, r in ((0.062, 0.006), (0.055, 0.014), (0.045, 0.027), (0.04, 0.031))]
    v, f, _ = loft(cap, 16, cap0=True, cap1=True)
    add('lantern-cap', v, f, 'iron', lw, sub=1, center=L + V(0, 0.05, 0), uv=2.0, posed=True)
    glass = [dict(c=L + V(0, y, 0), rx=r, rz=r) for y, r in ((0.04, 0.021), (0.0, 0.025), (-0.04, 0.021))]
    v, f, _ = loft(glass, 16, cap0=True, cap1=True)
    add('lantern-glass', v, f, 'glass', lw, sub=1, center=L, uv=2.0, posed=True)
    for k in range(4):
        a = TAU * (k + 0.5) / 4
        o = V(0.027 * math.cos(a), 0, 0.027 * math.sin(a))
        tube(f'lantern-bar{k}', [L + o * 1.15 + V(0, 0.04, 0), L + o * 1.08, L + o * 1.15 + V(0, -0.042, 0)], 0.0024, 'iron', lw, n=5, steps=2, uv=2.0, posed=True)
    base = [dict(c=L + V(0, y, 0), rx=r, rz=r) for y, r in ((-0.04, 0.03), (-0.052, 0.03), (-0.056, 0.022))]
    v, f, _ = loft(base, 16, cap0=True, cap1=True)
    add('lantern-base', v, f, 'iron', lw, center=L + V(0, -0.048, 0), uv=2.0, posed=True)
    return end


head()
mask_and_scarf()
mantle = hood_and_mantle()
skirt = coat()
sleeves()
hands()
legs()
gear(mantle, skirt)
tri = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o, _, _ in PARTS}
print(f'built the Wanderer: {len(PARTS)} pieces, {sum(tri.values())} triangles; heaviest:', ', '.join(f'{k}={v}' for k, v in sorted(tri.items(), key=lambda x: -x[1])[:14]))

# ---------------------------------------------------------------------------------------------------- bake and export

SIZE = 2048


def bake():
    objs = [o for o, role, _ in PARTS if role != 'eye']
    for o in bpy.data.objects:
        o.hide_render = o.type == 'MESH' and o not in objs
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.6, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # the hands and face are seen up close: they get more of the texture than their size alone would give them
    for o, role, uv in PARTS:
        if role == 'eye' or uv == 1.0:
            continue
        for d in o.data.uv_layers.active.data:
            d.uv = d.uv * uv
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    imgs = {}
    for k in ('color', 'rough', 'metal', 'ao', 'normal'):
        imgs[k] = bpy.data.images.new(f'wanderer-{k}', SIZE, SIZE, alpha=False, float_buffer=k == 'normal')
        if k != 'color':
            imgs[k].colorspace_settings.name = 'Non-Color'
    procs = list(MATS.values())

    def target(k):
        for p in procs:
            p.img.image = imgs[k]
            p.nt.nodes.active = p.img
    SCENE.render.bake.margin = 8
    SCENE.cycles.samples = 1
    for k in ('color', 'rough', 'metal'):
        target(k)
        for p in procs:
            p.route(k)
        bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True)
    for p in procs:
        p.route(None)
    target('normal')
    SCENE.cycles.samples = 4
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=8, use_clear=True)
    target('ao')
    SCENE.cycles.samples = 128
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
    import numpy as np

    def px(img):
        a = np.empty(SIZE * SIZE * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(-1, 4)
    col, ao, ro, me = px(imgs['color']), px(imgs['ao']), px(imgs['rough']), px(imgs['metal'])
    col[:, :3] *= 0.4 + 0.6 * ao[:, :1]
    orm = np.ones_like(col)
    orm[:, 1] = ro[:, 0]
    orm[:, 2] = me[:, 0]
    out_col = bpy.data.images.new('wanderer-basecolor', SIZE, SIZE, alpha=False)
    out_col.pixels.foreach_set(col.ravel())
    out_orm = bpy.data.images.new('wanderer-orm', SIZE, SIZE, alpha=False)
    out_orm.colorspace_settings.name = 'Non-Color'
    out_orm.pixels.foreach_set(orm.ravel())
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    for img, name in ((out_col, 'basecolor'), (out_orm, 'orm'), (imgs['normal'], 'normal')):
        img.filepath_raw = os.path.join(OUT, 'tex', f'wanderer-{name}.png')
        img.file_format = 'PNG'
        img.save()

    def shipping(name, double):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        tc = nt.nodes.new('ShaderNodeTexImage')
        tc.image = out_col
        nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
        to = nt.nodes.new('ShaderNodeTexImage')
        to.image = out_orm
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = imgs['normal']
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        m.use_backface_culling = not double
        return m
    ship = {'body': shipping('wanderer', False), 'cloth': shipping('wanderer-cloth', True)}
    for o, role, _ in PARTS:
        if role == 'eye':
            continue
        o.data.materials.clear()
        o.data.materials.append(ship[role])


def assemble():
    """one mesh per material, each skinned to the rig"""
    groups = {}
    for o, role, _ in PARTS:
        groups.setdefault(role, []).append(o)
    out = []
    for role, objs in groups.items():
        if len(objs) > 1:
            with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
                bpy.ops.object.join()
        o = objs[0]
        o.name = o.data.name = f'wanderer-{role}'
        mw = o.matrix_world.copy()
        o.parent = ARM
        o.matrix_world = mw
        md = o.modifiers.new('rig', 'ARMATURE')
        md.object = ARM
        out.append(o)
    return out


bake()
meshes = assemble()
for o in meshes:
    print(f'{o.name}: {sum(len(p.vertices) - 2 for p in o.data.polygons)} triangles, {len(o.vertex_groups)} bones')
for o in bpy.data.objects:
    o.hide_render = False
# the skeleton back in its rest pose, so the armature moves nothing the export reads
ARM.animation_data.action = None
for b in ARM.pose.bones:
    b.matrix_basis.identity()
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
ARM.select_set(True)
for o in meshes:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'hero-raw.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO',
    export_skins=True, export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'hero.blend'))


def preview():
    """stills in the intro's light: the gate's cold glow behind him, a soft key from the front left, the eyes lit"""
    _eb.inputs['Emission Strength'].default_value = 6.0
    world = bpy.data.worlds.new('void')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexrgb(0x07080f), 1)
    SCENE.world = world
    SCENE.view_settings.view_transform = 'AgX'
    SCENE.cycles.samples = 96
    SCENE.cycles.use_denoising = True
    SCENE.render.resolution_x, SCENE.render.resolution_y = 900, 1200

    def light(name, kind, at, color, power, size=0.5, aim=(0, 1.2, 0)):
        ld = bpy.data.lights.new(name, kind)
        ld.color = hexrgb(color)
        ld.energy = power
        if kind == 'AREA':
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        SCENE.collection.objects.link(lo)
        lo.location = B(V(at))
        lo.rotation_euler = (B(V(aim)) - lo.location).to_track_quat('-Z', 'Y').to_euler()
    light('gate', 'AREA', (0.4, 1.6, -2.4), 0x7b8cff, 420, 2.5)
    light('rim', 'AREA', (-1.6, 1.9, -1.2), 0x4fb8ff, 180, 1.0)
    light('key', 'AREA', (-1.2, 2.2, 2.0), 0xc8d6ff, 160, 1.6)
    light('fill', 'AREA', (1.4, 1.0, 1.8), 0x2a3550, 60, 2.0)
    ground = bpy.data.meshes.new('ground')
    ground.from_pydata([B(V(x, 0, z)) for x, z in ((-6, -6), (6, -6), (6, 6), (-6, 6))], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new('ground', ground)
    SCENE.collection.objects.link(go)
    gm = bpy.data.materials.new('groundm')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hexrgb(0x0c0e1a), 1)
    ground.materials.append(gm)
    cam_d = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_d)
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    os.makedirs(os.path.join(OUT, 'out'), exist_ok=True)

    def shot(name, eye, look, lens):
        cam_d.lens = lens
        cam.location = B(V(eye))
        cam.rotation_euler = (B(V(look)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        SCENE.render.filepath = os.path.join(OUT, 'out', f'{name}.png')
        bpy.ops.render.render(write_still=True)
    # the meshes are drawn in the idle's first frame already; the rig would move them a second time
    for o in meshes:
        for md in o.modifiers:
            md.show_render = False
    shot('idle-front', (0.35, 1.2, 4.6), (0, 0.95, 0), 40)
    shot('idle-threequarter', (2.8, 1.5, 3.2), (0, 0.95, 0), 40)
    shot('idle-back', (-1.2, 2.2, -4.2), (0, 1.0, 0), 40)
    shot('idle-face', (-0.25, 1.68, 0.95), (0, 1.62, 0), 70)
    shot('idle-hand', (-0.65, 0.98, 0.55), (-0.24, 0.9, 0.0), 45)
    shot('idle-side', (-3.2, 1.3, 0.4), (0, 0.95, 0), 40)


if RENDERS:
    preview()
print('done')
