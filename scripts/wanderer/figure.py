import bpy

from blender_kit import B, Materials, V, ball_mesh, dress, hexrgb, new_mesh, orient, tube_mesh
from wanderer.rig import top4

SURFACES = {
    'coat': (0x172036, 0.86, 0.0, 'weave', 0.0, 0.3, 190),
    'mantle': (0x121a2e, 0.9, 0.0, 'weave', 0.0, 0.35, 150),
    'hood': (0x131b30, 0.9, 0.0, 'weave', 0.0, 0.35, 150),
    'scarf': (0x222a3d, 0.95, 0.0, 'weave', 0.0, 0.5, 95),
    'trousers': (0x181c29, 0.85, 0.0, 'weave', 0.0, 0.3, 200),
    'stitch': (0x2b3753, 0.8, 0.0, 'weave', 0.0, 0.2, 260),
    'leather': (0x2b2a31, 0.6, 0.0, 'leather', 0.35, 0.35, 70),
    'glove': (0x66647a, 0.55, 0.0, 'leather', 0.5, 0.3, 120),
    'boot': (0x232229, 0.62, 0.0, 'leather', 0.45, 0.4, 60),
    'iron': (0x353b49, 0.48, 0.85, 'hammer', 0.5, 0.35, 60),
    'glass': (0x0e1a2c, 0.12, 0.0, 'smooth', 0.0, 0.0, 10),
    'skin': (0x3f3431, 0.62, 0.0, 'smooth', 0.0, 0.08, 120),
}


def eye_material():
    m = bpy.data.materials.new('wanderer-eye')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hexrgb(0x0b1422), 1)
    b.inputs['Roughness'].default_value = 0.3
    b.inputs['Emission Color'].default_value = (*hexrgb(0x9fe6ff), 1)
    b.inputs['Emission Strength'].default_value = 0.0
    return m


class Figure:
    def __init__(self, rig, scene):
        self.rig = rig
        self.mat = Materials(SURFACES)
        self.eye = eye_material()
        self.coll = bpy.data.collections.new('wanderer')
        scene.collection.children.link(self.coll)
        self.parts = []

    def add(self, name, verts, faces, m, w, role='body', sub=0, solid=0.0, uv=1.0, center=None, flip=False,
            posed=False):
        me = new_mesh(f'wanderer-{name}', verts, faces)
        o = bpy.data.objects.new(me.name, me)
        self.coll.objects.link(o)
        groups = {}
        for i, v in enumerate(verts):
            p = V(v)
            if isinstance(w, (list, tuple)) and w and isinstance(w[0], dict):
                ws = top4(w[i])
            elif callable(w):
                ws = top4(w(p))
            else:
                ws = top4(self.rig.near(p, w, posed=posed))
            for b, x in ws.items():
                if b not in groups:
                    groups[b] = o.vertex_groups.new(name=b)
                groups[b].add([i], x, 'REPLACE')
            if not posed:
                me.vertices[i].co = B(self.rig.deform(p, ws))
        orient(me, center, flip)
        dress(o, m if isinstance(m, bpy.types.Material) else self.mat(m), solid, sub)
        self.parts.append((o, role, uv))
        return o

    def tube(self, name, pts, r, m, w, n=8, role='body', sub=0, closed=False, steps=1, aspect=1.0, front=(0, 0, 1),
             uv=1.0, caps=True, posed=False):
        v, f = tube_mesh(pts, r, n, closed, steps, aspect, front, caps)
        return self.add(name, v, f, m, w, role=role, sub=sub, uv=uv, posed=posed)

    def ball(self, name, at, r, m, w, s=(1, 1, 1), n=14, sub=0, rot=None, uv=1.0, role='body', posed=False):
        v, f = ball_mesh(at, r, s, n, rot)
        return self.add(name, v, f, m, w, sub=sub, center=at, uv=uv, role=role, posed=posed)

    def grid(self, name, rows, m, w, role='cloth', solid=0.0, closed=True, sub=0, uv=1.0, center=None, posed=False):
        verts = [p for row in rows for p in row]
        n = len(rows[0])
        faces = []
        for i in range(len(rows) - 1):
            for j in range(n if closed else n - 1):
                j2 = (j + 1) % n
                faces.append((i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j))
        return self.add(name, verts, faces, m, w, role=role, solid=solid, sub=sub, uv=uv, center=center, posed=posed)
