import math
import bpy
import bmesh
from mathutils import Vector


def collection(name):
    value = bpy.data.collections.new('COL_' + name)
    bpy.context.scene.collection.children.link(value)
    return value


def relocate(obj, target):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    target.objects.link(obj)


def mesh(name, vertices, faces, material, target, uv=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new('SM_' + name, data)
    target.objects.link(obj)
    data.materials.append(material)
    layer = data.uv_layers.new(name='UVMap')
    for poly in data.polygons:
        poly.use_smooth = smooth
        for loop in poly.loop_indices:
            index = data.loops[loop].vertex_index
            layer.data[loop].uv = uv[index] if uv else (vertices[index][0], vertices[index][1])
    return obj


def bevel(obj, width=.002, segments=3):
    mod = obj.modifiers.new('Edge radius', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = .65
    normal = obj.modifiers.new('Face weighted normals', 'WEIGHTED_NORMAL')
    normal.keep_sharp = True


def sweep(name, path, profile, material, target, cap=True):
    vertices, faces, uv = [], [], []
    distance = 0
    for i, point in enumerate(path):
        before, after = Vector(path[max(0, i - 1)]), Vector(path[min(len(path) - 1, i + 1)])
        direction = after - before
        direction.z = 0
        direction.normalize()
        across = Vector((-direction.y, direction.x, 0))
        if i:
            distance += (Vector(point) - Vector(path[i - 1])).length
        for j, (offset, height) in enumerate(profile):
            vertices.append(Vector(point) + offset * across + Vector((0, 0, height)))
            uv.append((distance / .85, j / len(profile)))
    count = len(profile)
    for i in range(len(path) - 1):
        for j in range(count):
            a, b = i * count + j, i * count + (j + 1) % count
            faces.append((a, b, b + count, a + count))
    if cap:
        faces.extend([tuple(reversed(range(count))), tuple((len(path) - 1) * count + j for j in range(count))])
    return mesh(name, vertices, faces, material, target, uv)


def tube(name, points, radius, material, target, resolution=2, cyclic=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 12
    data.bevel_depth = radius
    data.bevel_resolution = resolution
    data.use_fill_caps = True
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new('SM_' + name, data)
    target.objects.link(obj)
    data.materials.append(material)
    return obj


def lathe(name, profile, material, target, center=(0, 0), segments=48):
    vertices, faces, uv = [], [], []
    for i, (height, radius) in enumerate(profile):
        for j in range(segments):
            angle = 2 * math.pi * j / segments
            vertices.append((center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle), height))
            uv.append((j / segments, height))
    for i in range(len(profile) - 1):
        for j in range(segments):
            a, b = i * segments + j, i * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.extend([tuple(reversed(range(segments))), tuple((len(profile) - 1) * segments + j for j in range(segments))])
    return mesh(name, vertices, faces, material, target, uv)


def rounded_panel(name, center, dimensions, material, target, radius=.005):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = 'SM_' + name
    relocate(obj, target)
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bevel(obj, radius)
    return obj


def camera(name, eye, target, target_collection, lens=45):
    data = bpy.data.cameras.new('CAM_' + name)
    data.lens = lens
    data.clip_start = .01
    obj = bpy.data.objects.new('CAM_' + name, data)
    target_collection.objects.link(obj)
    obj.location = eye
    marker = bpy.data.objects.new('EMPTY_CamTarget_' + name, None)
    marker.location = target
    target_collection.objects.link(marker)
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj
