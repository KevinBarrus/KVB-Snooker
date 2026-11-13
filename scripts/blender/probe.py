import bpy
import pathlib
import sys

output = pathlib.Path(sys.argv[sys.argv.index('--') + 1])
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
for name, position, color in [('AxisX', (1, 0, 0), (1, .05, .03, 1)),
                               ('AxisY', (0, 1, 0), (.03, 1, .03, 1)),
                               ('AxisZ', (0, 0, 1), (.03, .05, 1, 1))]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=.1, location=position)
    obj = bpy.context.object
    obj.name = name
    mat = bpy.data.materials.new('MAT_' + name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = .25
    obj.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, .5))
obj = bpy.context.object
obj.name = 'AlphaProbe'
mat = bpy.data.materials.new('MAT_AlphaProbe')
mat.use_nodes = True
mat.surface_render_method = 'DITHERED'
image = bpy.data.images.new('AlphaChecker', width=8, height=8, alpha=True)
image.pixels = [v for y in range(8) for x in range(8) for v in (1, .8, .5, (x + y) % 2)]
image.pack()
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = image
bsdf = mat.node_tree.nodes.get('Principled BSDF')
mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
obj.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=str(output / 'compatibility.glb'), export_format='GLB',
                          export_yup=True, export_animations=False, export_extras=True)
print('KVB_COMPATIBILITY_EXPORTED', bpy.app.version_string)
