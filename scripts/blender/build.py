import json
import math
import pathlib
import sys
import bpy

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from mesh_tools import collection, camera, rounded_panel
from surfaces import make_materials, material
from table_geometry import bed, cushions, frame
from pockets import pockets
from cue_asset import make_cue
from export_asset import export_all

output = pathlib.Path(sys.argv[sys.argv.index('--') + 1])
data = json.loads((output / 'geometry.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
geo = collection('Table')
cutters = collection('Construction_Cutters')
cue_group = collection('Cue')
reference = collection('Reference')
cameras = collection('Cameras')
lights = collection('Lookdev_Lights')
environment = collection('Lookdev_Room')
materials = make_materials(output)

hero = camera('Hero', (4.2, -3.7, 3.1), (0, 0, .65), cameras, 45)
top = camera('Top', (0, 0, 5), (0, 0, .88), cameras, 45)
top.data.type = 'ORTHO'
top.data.ortho_scale = 4.5
camera('Aim', (-1.62, .1, 1.045), (.3, .1, .92), cameras, 35)
camera('Middle', (.32, 1.65, 1.14), (0, .97, .82), cameras, 52)
camera('Corner', (2.32, 1.54, 1.20), (1.83, .93, .81), cameras, 48)
scene.camera = hero
bed(materials, geo, cutters)
cushions(data['outline'], materials, geo)
frame(materials, geo)
pocket_groups = pockets(materials)
cue = make_cue(materials, cue_group)
cue.location = (-.45, .1, .90625)

ball_material = material('ReferenceBall', (.66, .015, .018), .11)
for i, point in enumerate([(.5, 0, .90625), (.65, .1, .90625), (-.4, .1, .90625)]):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=data['radius'], location=point)
    obj = bpy.context.object
    obj.name = 'REF_Ball_' + str(i)
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    reference.objects.link(obj)
    obj.data.materials.append(ball_material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

floor_mat = material('RoomFloor', (.025, .007, .009), .92)
board_mat = material('BlueBarrier', (.005, .015, .10), .62)
wall_mat = material('UpperWall', (.10, .105, .11), .85)
seat_mat = material('SeatVelvet', (.055, .008, .012), .9)
rounded_panel('RoomFloor', (0, 0, -.06), (14, 11, .10), floor_mat, environment)
for sy in [-1, 1]:
    rounded_panel('Barrier_' + str(sy), (0, sy * 3.5, .62), (9, .13, 1.24), board_mat, environment)
    rounded_panel('UpperWall_' + str(sy), (0, sy * 5.4, 2.7), (13, .18, 3), wall_mat, environment)
    for row in range(3):
        for seat in range(18):
            rounded_panel('Seat_' + str(sy) + '_' + str(row) + '_' + str(seat),
                          ((seat - 8.5) * .47, sy * (3.95 + row * .48), 1.05 + row * .30),
                          (.40, .14, .48), seat_mat, environment, .04)

emission = material('LampDiffuser', (1, 1, 1), .5)
bsdf = emission.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Emission Color'].default_value = (1, .96, .88, 1)
bsdf.inputs['Emission Strength'].default_value = 3
for i, y in enumerate([-.65, 0, .65]):
    rounded_panel('LampPanel_' + str(i), (0, y, 3.4), (3.7, .24, .025), emission, lights)
    data_light = bpy.data.lights.new('LGT_Key_' + str(i), 'AREA')
    data_light.energy = 220
    data_light.shape = 'RECTANGLE'
    data_light.size = 3.7
    data_light.size_y = .24
    light = bpy.data.objects.new(data_light.name, data_light)
    lights.objects.link(light)
    light.location = (0, y, 3.35)
scene.world = bpy.data.worlds.new('World_Arena')
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.12, .15, .18, 1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value = .22
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene['production_note'] = 'Babylon realtime is acceptance target; lookdev room/lights are reference-only. No collision assets exported.'
scene['geometry'] = json.dumps(data)
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'kvb-table.blend'))
export_all(output, geo, pocket_groups, cue, data)
print('KVB_BUILD_COMPLETE', bpy.app.version_string)
