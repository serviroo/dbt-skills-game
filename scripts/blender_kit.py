import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

TAU = math.tau


def start():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = 'GPU'
                break
        except TypeError:
            continue
    return scene


def V(x, y=None, z=None):
    """a point in page space"""
    return Vector(x) if y is None else Vector((x, y, z))


def B(p):
    """page space to Blender space (glTF export turns Blender's +z up back into +y up)"""
    return Vector((p[0], -p[2], p[1]))


def hexrgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


class Mat:
    """A procedural surface: colour, roughness, metalness and a bump, each a socket the baker can route to emission."""

    def __init__(self, name, color, rough, metal, detail, wear=0.0, bump=0.4, scale=30.0, var=0.12):
        self.name = name
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        self.m, self.nt = m, nt
        N = nt.nodes.new
        L = nt.links.new
        tc = N('ShaderNodeTexCoord')
        obj = tc.outputs['Object']
        # colour wander: a soft cloud
        n1 = N('ShaderNodeTexNoise')
        n1.inputs['Scale'].default_value = scale * 0.18
        n1.inputs['Detail'].default_value = 4
        L(obj, n1.inputs['Vector'])
        base = hexrgb(color)
        lo = N('ShaderNodeValToRGB')
        lo.color_ramp.elements[0].color = (*[c * (1 - var) for c in base], 1)
        lo.color_ramp.elements[1].color = (*[c * (1 + var) for c in base], 1)
        L(n1.outputs['Fac'], lo.inputs['Fac'])
        col = lo.outputs['Color']
        height = self.detail(detail, obj, scale)
        # worn edges catch the light: a bevelled normal against the true one marks every edge
        if wear > 0:
            bev = N('ShaderNodeBevel')
            bev.inputs['Radius'].default_value = 0.012
            geo = N('ShaderNodeNewGeometry')
            dot = N('ShaderNodeVectorMath')
            dot.operation = 'DOT_PRODUCT'
            L(bev.outputs['Normal'], dot.inputs[0])
            L(geo.outputs['Normal'], dot.inputs[1])
            edge = N('ShaderNodeMapRange')
            edge.inputs['From Min'].default_value = 0.985
            edge.inputs['From Max'].default_value = 0.9
            L(dot.outputs['Value'], edge.inputs['Value'])
            n2 = N('ShaderNodeTexNoise')
            n2.inputs['Scale'].default_value = scale * 0.9
            L(obj, n2.inputs['Vector'])
            mul = N('ShaderNodeMath')
            mul.operation = 'MULTIPLY'
            L(edge.outputs['Result'], mul.inputs[0])
            L(n2.outputs['Fac'], mul.inputs[1])
            mul2 = N('ShaderNodeMath')
            mul2.operation = 'MULTIPLY'
            mul2.use_clamp = True
            L(mul.outputs['Value'], mul2.inputs[0])
            mul2.inputs[1].default_value = 2.2 * wear
            mix = N('ShaderNodeMix')
            mix.data_type = 'RGBA'
            L(mul2.outputs['Value'], mix.inputs[0])
            L(col, mix.inputs[6])
            mix.inputs[7].default_value = (*[min(1, c * 2.4 + 0.02) for c in base], 1)
            col = mix.outputs[2]
            self.wear = mul2.outputs['Value']
        else:
            self.wear = None
        # roughness wanders a little, and polished where worn
        rv = N('ShaderNodeMapRange')
        rv.inputs['To Min'].default_value = rough - 0.08
        rv.inputs['To Max'].default_value = rough + 0.08
        L(n1.outputs['Fac'], rv.inputs['Value'])
        r = rv.outputs['Result']
        if self.wear is not None:
            sub = N('ShaderNodeMath')
            sub.operation = 'MULTIPLY_ADD'
            L(self.wear, sub.inputs[0])
            sub.inputs[1].default_value = -0.18
            L(r, sub.inputs[2])
            r = sub.outputs['Value']
        val = N('ShaderNodeValue')
        val.outputs[0].default_value = metal
        bn = N('ShaderNodeBump')
        bn.inputs['Strength'].default_value = bump
        bn.inputs['Distance'].default_value = 0.004
        L(height, bn.inputs['Height'])
        bsdf = N('ShaderNodeBsdfPrincipled')
        L(col, bsdf.inputs['Base Color'])
        L(r, bsdf.inputs['Roughness'])
        L(val.outputs[0], bsdf.inputs['Metallic'])
        L(bn.outputs['Normal'], bsdf.inputs['Normal'])
        out = N('ShaderNodeOutputMaterial')
        L(bsdf.outputs['BSDF'], out.inputs['Surface'])
        emit = N('ShaderNodeEmission')
        self.sock = {'color': col, 'rough': r, 'metal': val.outputs[0]}
        self.bsdf, self.out, self.emit = bsdf, out, emit
        self.img = N('ShaderNodeTexImage')

    def detail(self, kind, obj, s):
        N = self.nt.nodes.new
        L = self.nt.links.new
        def mapped(sx, sy, sz):
            mp = N('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (sx, sy, sz)
            L(obj, mp.inputs['Vector'])
            return mp.outputs['Vector']
        if kind == 'hammer':
            v = N('ShaderNodeTexVoronoi')
            v.feature = 'SMOOTH_F1'
            v.inputs['Scale'].default_value = s
            L(obj, v.inputs['Vector'])
            return v.outputs['Distance']
        if kind == 'mail':
            v = N('ShaderNodeTexVoronoi')
            v.feature = 'DISTANCE_TO_EDGE'
            v.inputs['Scale'].default_value = s
            L(mapped(1, 1, 1.6), v.inputs['Vector'])
            return v.outputs['Distance']
        if kind in ('weave', 'leather', 'smooth'):
            n = N('ShaderNodeTexNoise')
            n.inputs['Scale'].default_value = s
            n.inputs['Detail'].default_value = 6 if kind == 'leather' else 2
            if kind == 'weave':
                w1 = N('ShaderNodeTexWave')
                w1.inputs['Scale'].default_value = s
                w1.bands_direction = 'X'
                L(obj, w1.inputs['Vector'])
                w2 = N('ShaderNodeTexWave')
                w2.inputs['Scale'].default_value = s
                w2.bands_direction = 'Z'
                L(obj, w2.inputs['Vector'])
                add = N('ShaderNodeMath')
                add.operation = 'ADD'
                L(w1.outputs['Fac'], add.inputs[0])
                L(w2.outputs['Fac'], add.inputs[1])
                return add.outputs['Value']
            L(obj, n.inputs['Vector'])
            return n.outputs['Fac']
        if kind in ('fur', 'feather', 'grain', 'brushed'):
            # long strands: noise stretched along one axis, bent by a second noise
            axis = {'fur': (1, 4, 4), 'feather': (5, 5, 1), 'grain': (5, 5, 0.6), 'brushed': (1, 1, 8)}[kind]
            w = N('ShaderNodeTexWave')
            w.wave_type = 'BANDS'
            w.bands_direction = 'X' if kind in ('fur',) else 'Z' if kind in ('grain',) else 'Y'
            w.inputs['Scale'].default_value = s
            w.inputs['Distortion'].default_value = 6 if kind != 'brushed' else 1
            w.inputs['Detail'].default_value = 3
            w.inputs['Detail Scale'].default_value = 2
            L(mapped(*axis), w.inputs['Vector'])
            return w.outputs['Fac']
        if kind == 'scale':
            v = N('ShaderNodeTexVoronoi')
            v.feature = 'F1'
            v.inputs['Scale'].default_value = s
            L(obj, v.inputs['Vector'])
            return v.outputs['Distance']
        if kind == 'veins':
            v = N('ShaderNodeTexVoronoi')
            v.feature = 'DISTANCE_TO_EDGE'
            v.inputs['Scale'].default_value = s
            L(mapped(1, 1, 3), v.inputs['Vector'])
            return v.outputs['Distance']
        if kind == 'stone':
            v = N('ShaderNodeTexVoronoi')
            v.inputs['Scale'].default_value = s
            L(obj, v.inputs['Vector'])
            n = N('ShaderNodeTexNoise')
            n.inputs['Scale'].default_value = s * 3
            n.inputs['Detail'].default_value = 8
            L(obj, n.inputs['Vector'])
            add = N('ShaderNodeMath')
            add.operation = 'MULTIPLY_ADD'
            L(n.outputs['Fac'], add.inputs[0])
            add.inputs[1].default_value = 0.5
            L(v.outputs['Distance'], add.inputs[2])
            return add.outputs['Value']
        if kind == 'rings':
            w = N('ShaderNodeTexWave')
            w.wave_type = 'RINGS'
            w.rings_direction = 'Z'
            w.inputs['Scale'].default_value = s
            w.inputs['Distortion'].default_value = 3
            L(obj, w.inputs['Vector'])
            return w.outputs['Fac']
        raise ValueError(kind)

    def route(self, what):
        """sends one channel to the output as emission, or (None) puts the BSDF back"""
        L = self.nt.links.new
        if what is None:
            L(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])
            return
        L(self.sock[what], self.emit.inputs['Color'])
        L(self.emit.outputs['Emission'], self.out.inputs['Surface'])


class Materials:
    def __init__(self, spec):
        self.spec = spec
        self.made = {}

    def __call__(self, name):
        if name not in self.made:
            c, r, m, d, w, b, s = self.spec[name]
            self.made[name] = Mat(name, c, r, m, d, wear=w, bump=b, scale=s)
        return self.made[name].m


def frame(t, front):
    t = t.normalized()
    v = (front - t * front.dot(t))
    if v.length < 1e-6:
        v = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, 1, 0))
        v = (v - t * v.dot(t))
    v.normalize()
    return t.cross(v), v


def ring(c, t, front, rx, rz, n, a0=0.0, a1=TAU, shape=None):
    u, v = frame(t, front)
    closed = abs((a1 - a0) - TAU) < 1e-6
    m = n if closed else n + 1
    pts = []
    for i in range(m):
        a = a0 + (a1 - a0) * i / n
        k, push = shape(a) if shape else (1.0, 0.0)
        pts.append(c + u * (rx * math.cos(a) * k) + v * (rz * math.sin(a) * k + push))
    return pts, closed


def ridge(depth, width=0.45, at=math.pi / 2):
    """a raised line down the front (a=pi/2), like a breastplate's medial ridge"""
    def f(a):
        d = (a - at + math.pi) % TAU - math.pi
        return 1.0, depth * math.exp(-(d / width) ** 2)
    return f


def loft(secs, n=20, arc=(0.0, TAU), cap0=False, cap1=False):
    """
    A surface through rings. Each section: dict(c=centre, rx, rz, t=axis (default up), f=front (default +z), s=shape).
    Returns (verts, faces, rings) where rings are the vertex index lists of each ring, for trims and seams.
    """
    verts, faces, rings = [], [], []
    closed = False
    for s in secs:
        pts, closed = ring(V(s['c']), V(s.get('t', (0, 1, 0))), V(s.get('f', (0, 0, 1))), s['rx'], s['rz'], n,
                           arc[0], arc[1], s.get('s'))
        rings.append(list(range(len(verts), len(verts) + len(pts))))
        verts += pts
    m = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(m if closed else m - 1):
            j2 = (j + 1) % m
            faces.append((a[j], a[j2], b[j2], b[j]))
    for cap, r in ((cap0, rings[0]), (cap1, rings[-1])):
        if cap:
            c = sum((verts[i] for i in r), Vector()) / len(r)
            verts.append(c)
            ci = len(verts) - 1
            for j in range(m if closed else m - 1):
                faces.append((r[j], r[(j + 1) % m], ci))
    return verts, faces, rings


def path_secs(pts, radii, front=(0, 0, 1), aspect=1.0, shape=None):
    """sections along a polyline, each facing along the path"""
    pts = [V(p) for p in pts]
    out = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        r = radii[i]
        out.append(dict(c=p, t=(b - a), f=front, rx=r, rz=r * aspect, s=shape))
    return out


def catmull_rom(p0, p1, p2, p3, t):
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def smooth_path(pts, steps=4):
    """a Catmull-Rom curve through pts"""
    P = [V(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(steps):
            t = k / steps
            out.append(catmull_rom(p0, p1, p2, p3, t))
    out.append(P[-2])
    return out


def interp(vals, n):
    """vals spread over n samples, linearly"""
    out = []
    for i in range(n):
        x = i / (n - 1) * (len(vals) - 1)
        k = min(int(x), len(vals) - 2)
        f = x - k
        out.append(vals[k] * (1 - f) + vals[k + 1] * f)
    return out


def tube_mesh(pts, r, n=8, closed=False, steps=1, aspect=1.0, front=(0, 0, 1)):
    """a tube along pts; r is one radius or one per point"""
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
        # the seam's two rings face along the loop
        secs[0]['t'] = secs[-1]['t'] = V(pts[1]) - V(pts[-2])
    v, f, rings = loft(secs, n, cap0=not closed, cap1=not closed)
    if closed:
        # weld the end ring onto the start ring
        last, first = rings[-1], rings[0]
        remap = {a: b for a, b in zip(last, first)}
        f = [tuple(remap.get(i, i) for i in face) for face in f]
    return v, f


def ball_mesh(at, r, s=(1, 1, 1), n=14, rot=None):
    rings = max(6, n // 2)
    secs = []
    for i in range(rings + 1):
        a = -math.pi / 2 + math.pi * i / rings
        y = math.sin(a) * r * s[1]
        rr = max(1e-4, math.cos(a) * r)
        secs.append(dict(c=(0, y, 0), rx=rr * s[0], rz=rr * s[2]))
    v, f, _ = loft(secs, n)
    if rot:
        R = Euler(rot, 'XYZ').to_matrix()
        v = [R @ x for x in v]
    return [x + V(at) for x in v], f


def new_mesh(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(v) for v in verts], [], faces)
    me.validate()
    return me


def orient(me, center=None, flip=False):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    # faces point away from the piece's own middle (or the given one)
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


def dress(o, m, solid=0.0, sub=0):
    o.data.materials.append(m)
    for p in o.data.polygons:
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


def apply_mods(o):
    if not o.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(old)


def unwrap(objs, margin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.6, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake(name, procs, size, margin, ao_samples, ao_floor, out):
    scene = bpy.context.scene
    imgs = {}
    for k in ('color', 'rough', 'metal', 'ao', 'normal'):
        imgs[k] = bpy.data.images.new(f'{name}-{k}', size, size, alpha=False, float_buffer=k == 'normal')
        if k != 'color':
            imgs[k].colorspace_settings.name = 'Non-Color'

    def target(k):
        for p in procs:
            p.img.image = imgs[k]
            p.nt.nodes.active = p.img
    scene.render.bake.margin = margin
    scene.cycles.samples = 1
    for k in ('color', 'rough', 'metal'):
        target(k)
        for p in procs:
            p.route(k)
        bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True)
    for p in procs:
        p.route(None)
    target('normal')
    scene.cycles.samples = 4
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=margin, use_clear=True)
    target('ao')
    scene.cycles.samples = ao_samples
    bpy.ops.object.bake(type='AO', margin=margin, use_clear=True)

    # colour carries the occlusion, softened; roughness and metalness go to G and B of one image
    def px(img):
        a = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(-1, 4)
    col, ao, ro, me = px(imgs['color']), px(imgs['ao']), px(imgs['rough']), px(imgs['metal'])
    col[:, :3] *= ao_floor + (1 - ao_floor) * ao[:, :1]
    orm = np.ones_like(col)
    orm[:, 1] = ro[:, 0]
    orm[:, 2] = me[:, 0]
    out_col = bpy.data.images.new(f'{name}-basecolor', size, size, alpha=False)
    out_col.pixels.foreach_set(col.ravel())
    out_orm = bpy.data.images.new(f'{name}-orm', size, size, alpha=False)
    out_orm.colorspace_settings.name = 'Non-Color'
    out_orm.pixels.foreach_set(orm.ravel())
    os.makedirs(os.path.join(out, 'tex'), exist_ok=True)
    for img, kind in ((out_col, 'basecolor'), (out_orm, 'orm'), (imgs['normal'], 'normal')):
        img.filepath_raw = os.path.join(out, 'tex', f'{name}-{kind}.png')
        img.file_format = 'PNG'
        img.save()
    return out_col, out_orm, imgs['normal']


def shipping(name, maps, double):
    col, orm, normal = maps
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = col
    nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    to = nt.nodes.new('ShaderNodeTexImage')
    to.image = orm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    m.use_backface_culling = not double
    return m


def stage(samples, width, height, ground_color, ground_rough):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('night')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexrgb(0x07080f), 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world
    scene.view_settings.view_transform = 'AgX'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = width, height
    ground = bpy.data.meshes.new('ground')
    ground.from_pydata([B(V(x, 0, z)) for x, z in ((-6, -6), (6, -6), (6, 6), (-6, 6))], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new('ground', ground)
    scene.collection.objects.link(go)
    gm = bpy.data.materials.new('groundm')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hexrgb(ground_color), 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = ground_rough
    ground.materials.append(gm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def light(name, kind, at, color, power, size=0.5):
    ld = bpy.data.lights.new(name, kind)
    ld.color = hexrgb(color)
    ld.energy = power
    if kind == 'AREA':
        ld.size = size
    lo = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = B(V(at))
    lo.rotation_euler = (B(V(0, 0.9, 0)) - lo.location).to_track_quat('-Z', 'Y').to_euler()
