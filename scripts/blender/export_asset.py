import json
import math
import bpy
import bmesh
from mathutils import Matrix, Vector
from mesh_tools import collection


def evaluated_copy(obj, target, cue=False):
    levels = [(modifier, modifier.levels) for modifier in obj.modifiers if modifier.type == 'SUBSURF']
    for modifier, _ in levels:
        modifier.levels = 0
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(graph)
    data = bpy.data.meshes.new_from_object(evaluated, depsgraph=graph)
    for modifier, level in levels:
        modifier.levels = level
    data.transform(Matrix.Identity(4) if cue else obj.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.0000001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    data.update()
    if not data.uv_layers:
        uv = data.uv_layers.new(name='UVMap')
        for loop in data.loops:
            p = data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (p.x, p.z)
    copy = bpy.data.objects.new(obj.name + '_Export', data)
    target.objects.link(copy)
    return copy


def audit(objects, limit):
    total = 0
    problems = []
    counts = []
    for obj in objects:
        data = obj.data
        data.calc_loop_triangles()
        total += len(data.loop_triangles)
        counts.append((len(data.loop_triangles), obj.name))
        if not data.uv_layers or not data.materials:
            problems.append(obj.name + ': missing UV/material')
        if any(not all(math.isfinite(v) for v in vertex.co) for vertex in data.vertices):
            problems.append(obj.name + ': nonfinite vertex')
        if any(triangle.area < 1e-14 for triangle in data.loop_triangles):
            problems.append(obj.name + ': degenerate face')
        if any(vertex.normal.length < .5 for vertex in data.vertices):
            problems.append(obj.name + ': invalid normal')
        bm = bmesh.new()
        bm.from_mesh(data)
        if any(not edge.is_manifold for edge in bm.edges):
            problems.append(obj.name + ': nonmanifold edge')
        bm.free()
    if total > limit:
        problems.append(f'Triangle budget {total} > {limit}')
    print('KVB_AUDIT', total, json.dumps(problems))
    print('KVB_LARGEST', sorted(counts, reverse=True)[:12])
    if problems:
        raise RuntimeError('; '.join(problems[:15]))
    return total


def merge(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def glb(obj, destination):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    triangulate = obj.modifiers.new('Export triangulation', 'TRIANGULATE')
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_animations=False,
                              export_tangents=True, export_extras=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False)
    obj.modifiers.remove(triangulate)


def pocket_rays(objects):
    from mathutils.bvhtree import BVHTree
    trees = []
    for obj in objects:
        if 'Leather' in obj.name or 'Iron' in obj.name:
            trees.append(BVHTree.FromPolygons([v.co for v in obj.data.vertices], [p.vertices for p in obj.data.polygons]))
    centers = [(0, sy * .973) for sy in [-1, 1]]
    centers += [(sx * 1.827, sy * .9266) for sx in [-1, 1] for sy in [-1, 1]]
    for x, y in centers:
        origin, direction = Vector((x, y, 1.2)), Vector((0, 0, -1))
        assert all(tree.ray_cast(origin, direction, .35)[0] is None for tree in trees), 'Blocked pocket opening'


def export_all(output, table, pockets, cue, geometry):
    temporary = collection('Export')
    source = list(table.objects) + [obj for group in pockets for obj in group.objects]
    copies = [evaluated_copy(obj, temporary) for obj in source]
    triangles = audit(copies, 150000)
    pocket_rays(copies)
    merged = merge(copies, 'SM_Table_LOD0')
    glb(merged, output / 'table.glb')
    modifier = merged.modifiers.new('LOD1 reduction', 'DECIMATE')
    modifier.ratio = .48
    lod_triangles = len(merged.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons)
    glb(merged, output / 'table-lod1.glb')
    bpy.data.objects.remove(merged, do_unlink=True)
    cue_copy = evaluated_copy(cue, temporary, cue=True)
    cue_triangles = audit([cue_copy], 6000)
    glb(cue_copy, output / 'cue.glb')
    bpy.data.objects.remove(cue_copy, do_unlink=True)
    bpy.data.collections.remove(temporary)
    manifest = dict(geometry, blender=bpy.app.version_string, tableTriangles=triangles,
                    cueTriangles=cue_triangles, lod1Faces=lod_triangles, scale=1,
                    coordinateMap='Blender X,Y,Z -> Babylon X,Z,Y; calibrated loader root',
                    checks=['finite vertices', 'manifold', 'nondegenerate faces', 'UV/material', 'unit normals',
                            'six open leather centers', 'triangle budget'])
    (output / 'asset.json').write_text(json.dumps(manifest, indent=2))
