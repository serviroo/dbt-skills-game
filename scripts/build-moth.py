"""
Builds the companion, a small night moth, in Blender and exports it as one GLB.

The body is metaball masses (head, a fluffy thorax with its collar, a ringed abdomen) with tufts of fur over the thorax
and head, six short legs folded under, and two feathered antennae. Each wing is a thin fan of panels from its root out to
a rounded edge, with its own pattern coordinates: across the wing (front edge to back) and out from the root. Its
pattern (soft lilac shading darker towards the edge, a wavy line, a pale fringe, faint veins, a ring on each hind wing)
is drawn by procedural shaders from those coordinates and baked with the body's fur into one texture set: colour (with
baked ambient occlusion), roughness and metalness, and a tangent-space normal map. The eyes are lit, mint, and unbaked.

Coordinates in this file are the page's: x right, y up, z towards the camera, the moth facing +z, feet on y = 0, metres
of a moth about a metre across (the page scales it).

  blender -b --factory-startup --python-exit-code 1 -P scripts/build-moth.py -- <out dir> [--renders]

writes <out dir>/moth-raw.glb (and preview stills in <out dir>/out with --renders); then
node scripts/build-moth.mjs <out dir>/moth-raw.glb packs it into public/models/moth.glb.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Matrix, Vector

TAU = math.tau
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV else '.')
RENDERS = '--renders' in ARGV
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
SCENE.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = kind
        prefs.refresh_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            SCENE.cycles.device = 'GPU'
            break
    except TypeError:
        continue
COLL = bpy.data.collections.new('moth')
SCENE.collection.children.link(COLL)


def V(x, y=None, z=None):
    """a point in page space"""
    return Vector(x) if y is None else Vector((x, y, z))


def B(p):
    """page space to Blender space (glTF export turns Blender's +z up back into +y up)"""
    return Vector((p[0], -p[2], p[1]))


def hexrgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---------------------------------------------------------------------------------------------------- materials

class Mat:
    """
    A procedural surface. Its colour, roughness and metalness are sockets the baker routes to emission one at a time;
    its height drives a bump the normal bake picks up.
    """

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
            if hasattr(v, 'is_output'):
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
            if hasattr(v, 'is_output'):
                self.nt.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def smooth(self, lo, hi, x):
        """0 below lo, 1 above hi, smooth between (hi may be below lo for the reverse)"""
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
            if hasattr(v, 'is_output'):
                self.nt.links.new(v, n.inputs[i])
            elif i == 0:
                n.inputs[i].default_value = v
            else:
                n.inputs[i].default_value = (*hexrgb(v), 1)
        return n.outputs[2]

    def finish(self, color, rough, height, bump=0.4, metal=0.0, dist=0.002):
        val = self.N('ShaderNodeValue')
        val.outputs[0].default_value = metal
        rv = rough if hasattr(rough, 'is_output') else self.N('ShaderNodeValue').outputs[0]
        if not hasattr(rough, 'is_output'):
            rv.node.outputs[0].default_value = rough
        bn = self.N('ShaderNodeBump', Strength=bump, Distance=dist, Height=height)
        bsdf = self.N('ShaderNodeBsdfPrincipled')
        self.nt.links.new(color, bsdf.inputs['Base Color'])
        self.nt.links.new(rv, bsdf.inputs['Roughness'])
        self.nt.links.new(val.outputs[0], bsdf.inputs['Metallic'])
        self.nt.links.new(bn.outputs['Normal'], bsdf.inputs['Normal'])
        # the scales and fur have a soft sheen at grazing angles
        bsdf.inputs['Sheen Weight'].default_value = 0.35
        bsdf.inputs['Sheen Tint'].default_value = (*hexrgb(0xf3efff), 1)
        self.out = self.N('ShaderNodeOutputMaterial')
        self.nt.links.new(bsdf.outputs['BSDF'], self.out.inputs['Surface'])
        self.bsdf = bsdf
        self.emit = self.N('ShaderNodeEmission')
        self.sock = {'color': color, 'rough': rv, 'metal': val.outputs[0]}
        self.img = self.N('ShaderNodeTexImage')
        return self

    def route(self, what):
        """sends one channel to the output as emission, or (None) puts the BSDF back"""
        L = self.nt.links.new
        if what is None:
            L(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])
            return
        L(self.sock[what], self.emit.inputs['Color'])
        L(self.emit.outputs['Emission'], self.out.inputs['Surface'])


def strands(m, scale, along):
    """fine fur strands: bands stretched along one axis, bent by noise; returns a 0..1 height"""
    mp = m.N('ShaderNodeMapping', Vector=m.obj, Scale=along)
    w = m.N('ShaderNodeTexWave', Vector=mp.outputs['Vector'], Scale=scale, Distortion=7.0, Detail=3.0)
    w.wave_type = 'BANDS'
    w.bands_direction = 'X'
    return w.outputs['Fac']


def fur_mat(name):
    """
    The body's one coat of fur, its colour following the body with no seams: lilac over the thorax, paler and nearly
    white over the ruff and the head, deeper down the abdomen, which has the faintest rings. Each part's colour is shaded
    from its hollows to its tops by a soft cloud.
    """
    m = Mat(name)
    n = m.N('ShaderNodeTexNoise', Vector=m.obj, Scale=9.0, Detail=4.0)
    shade = n.outputs['Fac']
    # page z (forwards along the body) is Blender -y
    z = m.math('MULTIPLY', m.N('ShaderNodeSeparateXYZ', Vector=m.obj).outputs['Y'], -1.0)
    thorax = m.ramp(shade, [(0.3, 0x9d8fe0), (0.7, 0xcdc2fb)])
    ruff = m.ramp(shade, [(0.3, 0xd9d0ff), (0.7, 0xf6f3ff)])
    belly = m.ramp(shade, [(0.3, 0x8f80d6), (0.7, 0xc4b8f8)])
    col = m.mix(m.smooth(0.07, 0.14, z), thorax, ruff)
    back = m.smooth(0.04, -0.03, z)
    ring = m.N('ShaderNodeTexWave', Vector=m.obj, Scale=13.0, Distortion=0.6)
    ring.wave_type = 'BANDS'
    ring.bands_direction = 'Y'
    belly = m.mix(m.math('MULTIPLY', m.smooth(0.7, 0.98, ring.outputs['Fac']), 0.08), belly, 0x5f50a8)
    col = m.mix(back, col, belly)
    h = strands(m, 160.0, (1.0, 1.0, 5.0))
    rough = m.math('MULTIPLY_ADD', shade, 0.1, 0.84)
    return m.finish(col, rough, h, bump=0.2)


def wing_mat(name, hind, root):
    """
    The wing's pattern. Its bands are arcs round the wing's root (`root`, page x and z), as a moth's lines curve across
    its wing: pale at the root with a rose blush, a fine pale line, a dark wavy line with a pale glow outside it, and the
    outer wing deeper violet. The fringe, the veins and the hind wing's ring follow the wing's own coordinates (UV map
    'pattern'): u across the wing from the front edge (0) to the back (1), v out from the root (0) to the edge (1).
    """
    m = Mat(name)
    uv = m.N('ShaderNodeUVMap')
    uv.uv_map = 'pattern'
    sep = m.N('ShaderNodeSeparateXYZ', Vector=uv.outputs['UV'])
    u, v = sep.outputs['X'], sep.outputs['Y']
    pos = m.N('ShaderNodeSeparateXYZ', Vector=m.obj)
    # page x is Blender x (either side, so its size), page z is Blender -y
    ax = m.math('SUBTRACT', m.math('ABSOLUTE', pos.outputs['X']), root[0])
    az = m.math('SUBTRACT', m.math('MULTIPLY', pos.outputs['Y'], -1.0), root[1])
    d = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', ax, ax), m.math('MULTIPLY', az, az)))
    ang = m.math('ARCTAN2', az, ax)
    span = 0.36 if hind else 0.56
    dn = m.math('DIVIDE', d, span)
    base = m.ramp(dn, [(0.0, 0xeee6ff), (0.3, 0xc9bbfa), (0.62, 0xa290ec), (0.85, 0x7d69cf), (1.0, 0x6b58c0)])
    # a rose blush at the root
    base = m.mix(m.math('MULTIPLY', m.smooth(0.3, 0.0, dn), 0.45), base, 0xf2d6f4)
    # a cloud of scales: the colour wanders a little
    cloud = m.N('ShaderNodeTexNoise', Vector=m.obj, Scale=16.0, Detail=5.0)
    base = m.mix(m.math('MULTIPLY', cloud.outputs['Fac'], 0.16), base, 0x5f4fae)
    # the fine pale line nearer the root
    if not hind:
        near = m.math('ABSOLUTE', m.math('SUBTRACT', dn, 0.3))
        base = m.mix(m.math('MULTIPLY', m.smooth(0.02, 0.004, near), 0.6), base, 0xf4f0ff)
    # the dark wavy line, and the pale glow of scales just outside it
    wave = m.math('MULTIPLY_ADD', m.math('SINE', m.math('MULTIPLY', ang, 11.0 if hind else 14.0)), 0.016, 0.6 if hind else 0.64)
    off = m.math('SUBTRACT', dn, wave)
    line = m.smooth(0.026, 0.006, m.math('ABSOLUTE', off))
    base = m.mix(m.math('MULTIPLY', line, 0.85), base, 0x3f3088)
    glow_ = m.math('MULTIPLY', m.smooth(0.0, 0.03, off), m.smooth(0.12, 0.03, off))
    base = m.mix(m.math('MULTIPLY', glow_, 0.5), base, 0xd6cbfd)
    height = m.math('MULTIPLY', line, -0.4)
    # faint veins running out from the root
    k = m.math('FRACT', m.math('ADD', m.math('MULTIPLY', u, 5.0 if hind else 6.0), 0.5))
    vein = m.math('MULTIPLY', m.smooth(0.025, 0.0, m.math('ABSOLUTE', m.math('SUBTRACT', k, 0.5))), m.smooth(0.2, 0.4, v))
    vein = m.math('MULTIPLY', vein, m.smooth(0.96, 0.88, v))
    base = m.mix(m.math('MULTIPLY', vein, 0.28), base, 0x4c3d98)
    height = m.math('ADD', height, m.math('MULTIPLY', vein, -0.4))
    # a soft pale fringe right at the edge
    base = m.mix(m.math('MULTIPLY', m.smooth(0.955, 0.99, v), 0.7), base, 0xcfc4fb)
    if hind:
        # the ring the drawing has: an ice rim round a deep violet dot
        c = m.N('ShaderNodeCombineXYZ', X=m.math('MULTIPLY', m.math('SUBTRACT', u, 0.5), 1.3), Y=m.math('SUBTRACT', v, 0.62))
        dd = m.N('ShaderNodeVectorMath', Vector=c.outputs['Vector'])
        dd.operation = 'LENGTH'
        r = dd.outputs['Value']
        rim = m.math('MULTIPLY', m.smooth(0.07, 0.052, r), m.smooth(0.032, 0.048, r))
        dot = m.smooth(0.03, 0.016, r)
        base = m.mix(m.math('MULTIPLY', rim, 0.9), base, 0xf3efff)
        base = m.mix(m.math('MULTIPLY', dot, 0.9), base, 0x3f3088)
        height = m.math('ADD', height, m.math('MULTIPLY', rim, 0.4))
    else:
        # a small dark crescent in the middle of each fore wing
        c = m.N('ShaderNodeCombineXYZ', X=m.math('MULTIPLY', m.math('SUBTRACT', u, 0.4), 1.5), Y=m.math('SUBTRACT', v, 0.47))
        dd = m.N('ShaderNodeVectorMath', Vector=c.outputs['Vector'])
        dd.operation = 'LENGTH'
        cres = m.math('MULTIPLY', m.smooth(0.042, 0.03, dd.outputs['Value']), m.smooth(0.45, 0.5, v))
        base = m.mix(m.math('MULTIPLY', cres, 0.8), base, 0x4d3e9a)
    # the scales themselves, tiny and overlapping
    sc = m.N('ShaderNodeTexVoronoi', Vector=m.obj, Scale=420.0)
    height = m.math('ADD', height, m.math('MULTIPLY', sc.outputs['Distance'], 0.5))
    rough = m.math('MULTIPLY_ADD', cloud.outputs['Fac'], 0.12, 0.5)
    return m.finish(base, rough, height, bump=0.25, dist=0.001)


def plain_mat(name, color, rough, detail_scale=60.0):
    m = Mat(name)
    n = m.N('ShaderNodeTexNoise', Vector=m.obj, Scale=detail_scale, Detail=3.0)
    col = m.ramp(n.outputs['Fac'], [(0.25, color), (0.75, color)])
    return m.finish(col, rough, n.outputs['Fac'], bump=0.2)


def glow(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Emission Color'].default_value = (*hexrgb(color), 1)
    b.inputs['Emission Strength'].default_value = strength
    return m


# where each wing meets the thorax, and how high (page space): the page turns the wings about the line through both,
# along z, at x = ROOT_X (src/scene/vignettes/scenes/moth.ts)
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
# the eyes are the moth's own light: mint, as everything that is the player's own (DESIGN.md)
EYE = glow('eye', 0x89cf9d, 4.0)


# ---------------------------------------------------------------------------------------------------- geometry

def apply_mods(o):
    if not o.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(old)


class Fig:
    """the moth's pieces, by role: 'body' (rigid, baked), 'wing1' and 'wing-1' (each side's two wings, which open and
    close), 'ant1' and 'ant-1' (the antennae, which sway), or 'eye'"""

    def __init__(self, id):
        self.id = id
        self.parts = []

    def mesh(self, name, verts, faces, m, role='body', uvs=None):
        me = bpy.data.meshes.new(f'{self.id}-{name}')
        me.from_pydata([B(v) for v in verts], [], faces)
        me.validate()
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
        me.materials.append(m if isinstance(m, bpy.types.Material) else MATS[m].m)
        for p in me.polygons:
            p.use_smooth = True
        self.parts.append((o, role))
        return o

    def tube(self, name, pts, radii, m, n=6, role='body'):
        """a tapered tube along pts, capped at both ends"""
        pts = [V(p) for p in pts]
        if not isinstance(radii, (list, tuple)):
            radii = [radii] * len(pts)
        verts, faces = [], []
        prev_side = None
        for i, (p, r) in enumerate(zip(pts, radii)):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = prev_side if prev_side is not None else t.orthogonal().normalized()
            side = (side - t * side.dot(t)).normalized()
            prev_side = side
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
                verts.append(V(at) + V(math.cos(a) * math.cos(b) * r * s[0], math.sin(a) * r * s[1], math.cos(a) * math.sin(b) * r * s[2]))
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


def metaball_mesh(f, name, elements, m, res=0.012, fur=0.0):
    """a smooth organic body from metaball elements (each: co, surface radius r, size s, and how stiff it is)"""
    mb = bpy.data.metaballs.new(f'{f.id}-{name}')
    mb.resolution = mb.render_resolution = res
    mb.threshold = 0.6
    for e in elements:
        el = mb.elements.new()
        el.type = 'ELLIPSOID'
        el.co = B(V(e['co']))
        # a stiff element blends only where it nearly touches another and meets the threshold at 0.78 of its radius
        # alone; a soft one melts into its neighbours
        el.stiffness = e.get('stiff', 10.0)
        el.radius = e['r'] / 0.78
        sx, sy, sz = e.get('s', (1, 1, 1))
        el.size_x, el.size_y, el.size_z = sx, sz, sy
    mo = bpy.data.objects.new(mb.name, mb)
    COLL.objects.link(mo)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(mo.evaluated_get(dg))
    bpy.data.objects.remove(mo)
    o = bpy.data.objects.new(f'{f.id}-{name}', me)
    COLL.objects.link(o)
    me.materials.append(MATS[m].m)
    sm = o.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.5
    sm.iterations = 4
    if fur:
        tex = bpy.data.textures.new(f'{f.id}-{name}-furtex', 'CLOUDS')
        tex.noise_scale = 0.012
        tex.noise_depth = 2
        d = o.modifiers.new('fur', 'DISPLACE')
        d.texture = tex
        d.strength = fur
        d.mid_level = 0.5
    apply_mods(o)
    for p in o.data.polygons:
        p.use_smooth = True
    f.parts.append((o, 'body'))
    return o


def raycast(o, origin, direction):
    """ray against one object, in page space"""
    inv = o.matrix_world.inverted()
    ok, p, n, i = o.ray_cast(inv @ B(origin), (inv.to_3x3() @ B(direction)).normalized())
    if not ok:
        return False, None, None, None
    p = o.matrix_world @ p
    n = (o.matrix_world.to_3x3() @ n).normalized()
    return True, V(p.x, p.z, -p.y), V(n.x, n.z, -n.y), i


def on_surface(o, toward, frm):
    d = V(toward) - V(frm)
    ok, p, n, _ = raycast(o, V(frm), d.normalized())
    if not ok:
        raise RuntimeError(f'nothing hit on {o.name} from {frm}')
    return p, n


def closed_curve(ctrl, per=6):
    """a smooth closed loop through ctrl (Catmull-Rom), per points between each pair"""
    out = []
    n = len(ctrl)
    for i in range(n):
        p0, p1, p2, p3 = (V(*ctrl[(i + j - 1) % n], 0) for j in range(4))
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out




def wing(f, s, hind):
    """
    One wing, flat but for a gentle camber, as a fan of panels from its root out to its edge. ctrl is its outline
    (x out from the root, z forwards), starting at the front of the root and going round the edge to the back of it.
    """
    if hind:
        ctrl = [(0.0, 0.0), (0.15, -0.02), (0.29, -0.075), (0.365, -0.16), (0.355, -0.25), (0.285, -0.315), (0.18, -0.33),
                (0.085, -0.28), (0.025, -0.16)]
        root = V(ROOT_X - 0.01, ROOT_Y - 0.008, HIND_ROOT_Z)
        hub = V(0.05, 0, -0.08)
    else:
        ctrl = [(0.0, 0.02), (0.14, 0.08), (0.3, 0.14), (0.44, 0.18), (0.53, 0.19), (0.57, 0.16), (0.56, 0.1), (0.52, 0.0),
                (0.47, -0.09), (0.4, -0.155), (0.3, -0.165), (0.18, -0.125), (0.08, -0.075), (0.015, -0.03)]
        root = V(ROOT_X, ROOT_Y, FORE_ROOT_Z)
        hub = V(0.06, 0, 0.0)
    loop = closed_curve(ctrl, 5)
    # the fan's centre sits just out from the root, so every spoke reaches the edge without crossing the outline
    n = len(loop)
    rows = 7
    verts, uvs, faces = [], [], []
    center = hub
    verts.append(center)
    uvs.append((0.5, 0.0))
    # the edge's own scallops: the fringe dips a little between veins
    for r in range(1, rows + 1):
        t = r / rows
        for k in range(n):
            e = loop[k]
            u = k / n
            dip = 1.0 - 0.012 * (1 - math.cos(TAU * u * (5 if hind else 6))) * (t ** 6)
            p = center + (V(e.x, 0, e.y) - center) * t * dip
            # camber: the wing bows up a touch through its middle, and its front edge is a little stiffer
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
    # the pattern's u runs the outline once round, which closes on itself at the root: across the wing it should run
    # from the front edge to the back, so it is folded at the outline's far point
    far = max(range(n), key=lambda k: loop[k].x)
    def across(u):
        return 0.5 * u * n / far if u * n <= far else 0.5 + 0.5 * (u * n - far) / (n - far)
    uvs = [(across(u), t) for u, t in uvs]
    verts = [V(s * (root.x + p.x), root.y + p.y, root.z + p.z) for p in verts]
    if s < 0:
        faces = [tuple(reversed(fc)) for fc in faces]
    return f.mesh(f'{"hind" if hind else "fore"}{s}', verts, faces, 'hind' if hind else 'fore', role=f'wing{s}', uvs=uvs)


def antenna(f, s):
    """a feathered antenna: a shaft curving up and out from the head, with a pair of barbs at every joint"""
    shaft = [V(s * 0.022, 0.215, 0.215), V(s * 0.05, 0.27, 0.235), V(s * 0.095, 0.325, 0.23), V(s * 0.15, 0.36, 0.205), V(s * 0.2, 0.37, 0.17)]
    path = []
    for i in range(len(shaft) - 1):
        for k in range(5):
            path.append(shaft[i].lerp(shaft[i + 1], k / 5))
    path.append(shaft[-1])
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
            # the barbs sweep forwards and a little down, like a fern's leaflets
            d = (out * side * 0.5 + up * 0.62 + t * 0.4).normalized()
            if d.z < 0:
                d.z *= 0.4
            tip = p + d * length
            f.tube(f'ant{s}-barb{i}{side}', [p, p + d * length * 0.55, tip], [0.0028, 0.002, 0.0006], 'antenna', n=4, role=role)


def moth():
    f = Fig('moth')
    E = []

    def el(co, r, s=(1, 1, 1), stiff=10.0):
        E.append(dict(co=co, r=r, s=s, stiff=stiff))
    # the masses under the fluff: head, thorax and a short abdomen tapering back and down
    core = [((0, 0.165, 0.19), 0.07, (1.0, 0.95, 0.9)), ((0, 0.15, 0.1), 0.09, (1.05, 0.95, 1.05))]
    for co, r, sz in core:
        el(co, r, sz)
    for z, y, r in ((0.0, 0.13, 0.07), (-0.055, 0.12, 0.064), (-0.11, 0.108, 0.055), (-0.16, 0.097, 0.044), (-0.2, 0.088, 0.03)):
        el((0, y, z), r, (1.0, 0.9, 0.9))
    # the fluff: soft clumps all over the head and thorax, biggest in the ruff behind the head, and smaller ones down
    # the abdomen, melting into each other so the moth wears one plush coat with a gentle swell to it
    def clumps(c, r, sz, n, size, up=-0.2, back=1.0):
        for _ in range(n):
            while True:
                d = V(random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1)).normalized()
                if d.y > up:
                    break
            d.z *= back
            p = V(c) + V(d.x * r * sz[0], d.y * r * sz[1], d.z * r * sz[2]) * 0.92
            el(tuple(p), size * random.uniform(0.75, 1.15), (1.0, 0.85, 1.0), stiff=3.0)
    clumps((0, 0.15, 0.1), 0.09, (1.05, 0.95, 1.05), 26, 0.036, up=-0.35)
    clumps((0, 0.175, 0.145), 0.085, (1.2, 0.85, 0.7), 16, 0.04, up=-0.1)
    clumps((0, 0.165, 0.19), 0.07, (1.0, 0.95, 0.9), 12, 0.028, up=-0.45)
    for z, y, r in ((0.0, 0.13, 0.07), (-0.055, 0.12, 0.064), (-0.11, 0.108, 0.055), (-0.16, 0.097, 0.044)):
        clumps((0, y, z), r, (1.0, 0.9, 0.9), 6, r * 0.4, up=-0.5)
    body = metaball_mesh(f, 'body', E, 'fur', res=0.007, fur=0.003)
    # eyes: big and round, high on the front of the head's sides, so they show from above as the drawing has them
    for s in (-1, 1):
        p, n = on_surface(body, V(0, 0.17, 0.19), V(s * 0.4, 0.4, 0.62))
        f.ball(f'eye{s}', p - n * 0.012, 0.032, EYE, s=(0.9, 1.0, 0.9), n=14, role='eye')
    # legs folded under the thorax, feet just reaching the ground
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


# ---------------------------------------------------------------------------------------------------- bake and export

SIZE = 1024


def bake(root):
    """bakes the joined parts under root (the eyes keep their own light) into one texture set"""
    objs = [o for o in root.children if not o.name.endswith('-eye')]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        # the bake's own map, made active; the wings keep 'pattern' for their shader until the bake is done
        bake_uv = o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers.active = bake_uv
        bake_uv.active_render = True

    def unwrap(group):
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.6, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
        bpy.ops.object.mode_set(mode='OBJECT')
    # the antennae are one even colour, hundreds of tiny barbs: they share one small square in a corner instead of an
    # island each, and everything else gets the rest of the texture
    ants = [o for o in objs if '-ant' in o.name]
    rest = [o for o in objs if o not in ants]
    unwrap(rest)
    unwrap(ants)
    for o in objs:
        corner = o in ants
        for d in o.data.uv_layers['UVMap'].data:
            d.uv = (0.976 + d.uv.x * 0.02, 0.976 + d.uv.y * 0.02) if corner else (d.uv.x * 0.97, d.uv.y)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    imgs = {}
    for k in ('color', 'rough', 'metal', 'ao', 'normal'):
        imgs[k] = bpy.data.images.new(f'moth-{k}', SIZE, SIZE, alpha=False, float_buffer=k == 'normal')
        if k != 'color':
            imgs[k].colorspace_settings.name = 'Non-Color'
    procs = list(MATS.values())

    def target(k):
        for p in procs:
            p.img.image = imgs[k]
            p.nt.nodes.active = p.img
    SCENE.render.bake.margin = 6
    SCENE.cycles.samples = 1
    for k in ('color', 'rough', 'metal'):
        target(k)
        for p in procs:
            p.route(k)
        bpy.ops.object.bake(type='EMIT', margin=6, use_clear=True)
    for p in procs:
        p.route(None)
    target('normal')
    SCENE.cycles.samples = 4
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=6, use_clear=True)
    target('ao')
    SCENE.cycles.samples = 96
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    import numpy as np

    def px(img):
        a = np.empty(SIZE * SIZE * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(-1, 4)
    col, ao, ro, me = px(imgs['color']), px(imgs['ao']), px(imgs['rough']), px(imgs['metal'])
    # the wings are thin and lit from both sides, so the occlusion is softer than a body's
    col[:, :3] *= 0.55 + 0.45 * ao[:, :1]
    orm = np.ones_like(col)
    orm[:, 1] = ro[:, 0]
    orm[:, 2] = me[:, 0]
    out_col = bpy.data.images.new('moth-basecolor', SIZE, SIZE, alpha=False)
    out_col.pixels.foreach_set(col.ravel())
    out_orm = bpy.data.images.new('moth-orm', SIZE, SIZE, alpha=False)
    out_orm.colorspace_settings.name = 'Non-Color'
    out_orm.pixels.foreach_set(orm.ravel())
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    for img, name in ((out_col, 'basecolor'), (out_orm, 'orm'), (imgs['normal'], 'normal')):
        img.filepath_raw = os.path.join(OUT, 'tex', f'moth-{name}.png')
        img.file_format = 'PNG'
        img.save()
    # the shipping material: one texture set, drawn on both sides (a wing is seen from above and below)
    m = bpy.data.materials.new('moth')
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
    m.use_backface_culling = False
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(m)
        if 'pattern' in o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers['pattern'])


def assemble(f):
    """joins each role's pieces into one mesh under the moth's root"""
    root = bpy.data.objects.new(f.id, None)
    COLL.objects.link(root)
    groups = {}
    for o, role in f.parts:
        groups.setdefault(role, []).append(o)
    for key, objs in groups.items():
        if len(objs) > 1:
            with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
                bpy.ops.object.join()
        o = objs[0]
        o.name = o.data.name = f'{f.id}-{key}'
        o.parent = root
    return root


TARGET = 12000


def slim(f):
    """
    collapses the bigger body pieces evenly so the moth comes in near its triangle budget; small pieces keep their shape,
    and the wings keep their fan, which their pattern follows
    """
    count = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    sizes = [(o, count(o) if role == 'body' else 0) for o, role in f.parts]
    small = sum(count(o) for o, _ in f.parts) - sum(n for _, n in sizes if n > 400)
    big = sum(n for _, n in sizes if n > 400)
    r = max(0.2, min(1.0, (TARGET - small) / max(1, big)))
    print(f'slim: {big} big + {small} small triangles, ratio {r:.2f}')
    if r >= 0.999:
        return
    for o, n in sizes:
        if n > 400:
            d = o.modifiers.new('slim', 'DECIMATE')
            d.ratio = r
            d.delimit = {'NORMAL', 'SHARP', 'SEAM', 'UV'}
            apply_mods(o)


def tris(root):
    return sum(sum(len(p.vertices) - 2 for p in c.data.polygons) for c in root.children)


def preview(root):
    """stills in the companion's night light: moonlight above, lantern blue behind, a low violet fill"""
    world = bpy.data.worlds.new('night')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexrgb(0x07080f), 1)
    SCENE.world = world
    SCENE.view_settings.view_transform = 'AgX'
    SCENE.cycles.samples = 96
    SCENE.cycles.use_denoising = True
    SCENE.render.resolution_x, SCENE.render.resolution_y = 900, 900

    def light(name, kind, at, color, power, size=0.5):
        ld = bpy.data.lights.new(name, kind)
        ld.color = hexrgb(color)
        ld.energy = power
        if kind == 'AREA':
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        SCENE.collection.objects.link(lo)
        lo.location = B(V(at))
        lo.rotation_euler = (B(V(0, 0.15, 0)) - lo.location).to_track_quat('-Z', 'Y').to_euler()
    light('moon', 'AREA', (-0.8, 1.6, 0.9), 0xdfe8ff, 38, 1.2)
    light('rim', 'AREA', (0.6, 0.8, -1.2), 0x4fb8ff, 60, 0.8)
    light('fill', 'AREA', (0.9, 0.2, 1.0), 0x7b3fe4, 18, 1.5)
    # the wings stand as the page rests them (REST in src/scene/vignettes/scenes/moth.ts): raised a little from flat
    for c in root.children:
        if c.name.startswith('moth-wing'):
            s = 1 if c.name == 'moth-wing1' else -1
            P = Matrix.Translation(B(V(s * ROOT_X, ROOT_Y, 0)))
            R = Matrix.Rotation(s * 0.14, 4, B(V(0, 0, 1)))
            c.matrix_world = P @ R @ P.inverted()
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = 85
    cam = bpy.data.objects.new('cam', cam_d)
    SCENE.collection.objects.link(cam)
    SCENE.camera = cam
    os.makedirs(os.path.join(OUT, 'out'), exist_ok=True)
    look = B(V(0, 0.15, 0.0))
    # front, three-quarter, back three-quarter, and from high in front as the page shows it
    for i, (az, el, dist) in enumerate(((0.0, 0.42, 2.4), (0.7, 0.35, 2.2), (2.6, 0.5, 2.4), (0.0, 1.35, 2.2))):
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        cam.location = look + d * dist
        cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
        SCENE.render.filepath = os.path.join(OUT, 'out', f'moth-{i}.png')
        bpy.ops.render.render(write_still=True)


f = moth()
print(f'built moth: {len(f.parts)} pieces')
slim(f)
root = assemble(f)
bake(root)
print(f'moth: {tris(root)} triangles; parts: {", ".join(c.name for c in root.children)}')
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for c in root.children:
    c.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'moth-raw.glb'), export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
    export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO',
    export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'moth.blend'))
if RENDERS:
    preview(root)
print('done')
