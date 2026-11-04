import re

import bpy
from mathutils import Vector

from blender_kit import B

FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')
SPINE_NEXT = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01',
              'neck_01': 'Head'}


def P(b):
    return Vector((b[0], b[2], -b[1]))


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def top4(w):
    items = sorted(((v, k) for k, v in w.items() if v > 0), reverse=True)
    floor = items[4][0] if len(items) > 4 else 0.0
    items = [(v - floor, k) for v, k in items[:4] if v > floor] or items[:1]
    s = sum(v for v, _ in items) or 1.0
    return {k: v / s for v, k in items}


def blend(ws):
    out = {}
    for w in ws:
        for k, v in w.items():
            out[k] = out.get(k, 0.0) + v / len(ws)
    return out


def mix(a, b, t):
    a, b = top4(a), top4(b)
    out = {k: v * (1 - t) for k, v in a.items()}
    for k, v in b.items():
        out[k] = out.get(k, 0.0) + v * t
    return out


def bone_tail(name, j):
    if name in SPINE_NEXT:
        return j[SPINE_NEXT[name]]
    if name == 'Head':
        return j['Head'] + (j['Head'] - j['neck_01']).normalized() * 0.17
    for s in ('l', 'r'):
        limb = {f'clavicle_{s}': f'upperarm_{s}', f'upperarm_{s}': f'lowerarm_{s}', f'lowerarm_{s}': f'hand_{s}',
                f'hand_{s}': f'middle_01_{s}', f'thigh_{s}': f'calf_{s}', f'calf_{s}': f'foot_{s}',
                f'foot_{s}': f'ball_{s}', f'ball_{s}': f'ball_leaf_{s}'}
        if name in limb:
            return j[limb[name]]
        for f in FINGERS:
            for i in (1, 2, 3):
                if name == f'{f}_0{i}_{s}':
                    return j[f'{f}_0{i + 1}_{s}' if i < 3 else f'{f}_04_leaf_{s}']
    raise KeyError(name)


def only_idle(path):
    idles = [a for a in bpy.data.actions if re.fullmatch(r'idle(\.\d+)?', a.name)]
    if [a.name for a in idles] != ['idle']:
        names = ', '.join(sorted(a.name for a in bpy.data.actions)) or 'none'
        raise RuntimeError(f"{path} needs exactly one animation named 'idle'; it has {names}")
    return idles[0]


class Rig:
    def __init__(self, path, scene):
        bpy.ops.import_scene.gltf(filepath=path, guess_original_bind_pose=False)
        arm = max((o for o in bpy.data.objects if o.type == 'ARMATURE'), key=lambda o: len(o.data.bones))
        for o in list(bpy.data.objects):
            if o is not arm and o.type in ('MESH', 'ARMATURE', 'EMPTY') and o not in arm.children_recursive:
                bpy.data.objects.remove(o, do_unlink=True)
        for o in list(arm.children_recursive):
            if o.type == 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        for a in bpy.data.actions:
            a.use_fake_user = True
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
        arm.animation_data_clear()
        idle = only_idle(path)
        arm.animation_data_create()
        arm.animation_data.action = idle
        if getattr(idle, 'slots', None) and len(idle.slots):
            arm.animation_data.action_slot = idle.slots[0]
        scene.frame_set(int(idle.frame_range[0]))
        bpy.context.view_layer.update()
        self.arm = arm
        self.rest = {b.name: P(arm.matrix_world @ b.head_local) for b in arm.data.bones}
        self.posed = {b.name: P(arm.matrix_world @ b.head) for b in arm.pose.bones}
        self.delta = {b.name: arm.matrix_world @ b.matrix @ arm.data.bones[b.name].matrix_local.inverted()
                      @ arm.matrix_world.inverted() for b in arm.pose.bones}
        self.segments = {}

    def seg_dist(self, p, name, posed=False):
        key = (name, posed)
        if key not in self.segments:
            j = self.posed if posed else self.rest
            self.segments[key] = (j[name], bone_tail(name, j))
        a, b = self.segments[key]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
        return (a + ab * t - p).length

    def near(self, p, bones, soft=0.004, posed=False):
        return {b: 1.0 / (self.seg_dist(p, b, posed) ** 2 + soft ** 2) ** 2 for b in bones}

    def deform(self, p, ws):
        q = B(p)
        out = Vector((0, 0, 0))
        for b, x in top4(ws).items():
            out += (self.delta[b] @ q) * x
        return P(out)

    def unpose(self, q, bone):
        return P(self.delta[bone].inverted() @ B(q))

    def to_rest(self):
        self.arm.animation_data.action = None
        for b in self.arm.pose.bones:
            b.matrix_basis.identity()
        bpy.context.view_layer.update()
