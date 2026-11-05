import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_kit import B, V, bake, light, shipping, stage, start, unwrap  # noqa: E402
from wanderer.cloth import coat, head, hood, legs, mantle, mask_and_scarf, sleeves  # noqa: E402
from wanderer.figure import Figure  # noqa: E402
from wanderer.hands import hands  # noqa: E402
from wanderer.rig import Rig  # noqa: E402

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV and not ARGV[0].startswith('--') else '.')
DEFAULT_RIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'hero.glb')
RIG = os.path.abspath(ARGV[ARGV.index('--rig') + 1]) if '--rig' in ARGV else DEFAULT_RIG
RENDERS = '--renders' in ARGV
PREVIEW_LIGHTS = [('gate', 'AREA', (0.4, 1.6, -2.4), 0x7b8cff, 420, 2.5),
                  ('rim', 'AREA', (-1.6, 1.9, -1.2), 0x4fb8ff, 180, 1.0),
                  ('key', 'AREA', (-1.2, 2.2, 2.0), 0xc8d6ff, 160, 1.6),
                  ('fill', 'AREA', (1.4, 1.0, 1.8), 0x2a3550, 60, 2.0)]
PREVIEW_SHOTS = [('idle-front', (0.35, 1.2, 4.6), (0, 0.95, 0), 40),
                 ('idle-threequarter', (2.8, 1.5, 3.2), (0, 0.95, 0), 40),
                 ('idle-back', (-1.2, 2.2, -4.2), (0, 1.0, 0), 40),
                 ('idle-face', (-0.25, 1.68, 0.95), (0, 1.62, 0), 70),
                 ('idle-hand', (-0.65, 0.98, 0.55), (-0.24, 0.9, 0.0), 45),
                 ('idle-side', (-3.2, 1.3, 0.4), (0, 0.95, 0), 40)]


def build(fig):
    head(fig)
    mask_and_scarf(fig)
    mantle(fig, hood(fig))
    coat(fig)
    sleeves(fig)
    hands(fig)
    legs(fig)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def bake_figure(fig):
    objs = [o for o, role, _ in fig.parts if role != 'eye']
    for o in bpy.data.objects:
        o.hide_render = o.type == 'MESH' and o not in objs
    unwrap(objs, 0.003, {o.name: uv for o, role, uv in fig.parts if role != 'eye'})
    maps = bake('wanderer', list(fig.mat.made.values()), 2048, margin=8, ao_samples=128, ao_floor=0.4, out=OUT)
    ship = {'body': shipping('wanderer', maps, False), 'cloth': shipping('wanderer-cloth', maps, True)}
    for o, role, _ in fig.parts:
        if role != 'eye':
            o.data.materials.clear()
            o.data.materials.append(ship[role])


def assemble(fig):
    groups = {}
    for o, role, _ in fig.parts:
        groups.setdefault(role, []).append(o)
    out = []
    for role, objs in groups.items():
        if len(objs) > 1:
            with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
                bpy.ops.object.join()
        o = objs[0]
        o.name = o.data.name = f'wanderer-{role}'
        mw = o.matrix_world.copy()
        o.parent = fig.rig.arm
        o.matrix_world = mw
        md = o.modifiers.new('rig', 'ARMATURE')
        md.object = fig.rig.arm
        out.append(o)
    return out


def export(rig, meshes):
    for o in bpy.data.objects:
        o.hide_render = False
    rig.to_rest()
    bpy.ops.object.select_all(action='DESELECT')
    rig.arm.select_set(True)
    for o in meshes:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, 'hero-raw.glb'), export_format='GLB', use_selection=True, export_yup=True,
        export_apply=False, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='AUTO', export_skins=True, export_animations=False,
        export_cameras=False, export_lights=False, export_extras=False,
    )
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'hero.blend'))


def preview(fig, meshes):
    scene = bpy.context.scene
    fig.eye.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 6.0
    cam = stage(samples=96, width=900, height=1200, ground_color=0x0c0e1a, ground_rough=0.5)
    for name, kind, at, color, power, size in PREVIEW_LIGHTS:
        light(name, kind, at, color, power, size, aim=(0, 1.2, 0))
    for o in meshes:
        for md in o.modifiers:
            md.show_render = False
    os.makedirs(os.path.join(OUT, 'out'), exist_ok=True)
    for name, eye, look, lens in PREVIEW_SHOTS:
        cam.data.lens = lens
        cam.location = B(V(eye))
        cam.rotation_euler = (B(V(look)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, 'out', f'{name}.png')
        bpy.ops.render.render(write_still=True)


scene = start()
rig = Rig(RIG, scene)
fig = Figure(rig, scene)
build(fig)
print(f'built the Wanderer: {len(fig.parts)} pieces, {sum(triangles(o) for o, _, _ in fig.parts)} triangles')
bake_figure(fig)
meshes = assemble(fig)
for o in meshes:
    print(f'{o.name}: {triangles(o)} triangles, {len(o.vertex_groups)} bones')
export(rig, meshes)
if RENDERS:
    preview(fig, meshes)
