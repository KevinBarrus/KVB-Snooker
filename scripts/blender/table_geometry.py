import math
import bpy
from mathutils import Vector
from mesh_tools import mesh, sweep, lathe, tube, bevel, relocate


def bed(materials, geo, cutters):
    vertices = [(x, y, z) for z in [.876, .88] for y in [-.951, .951] for x in [-1.852, 1.852]]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    uv = [((x / 3.92) + .5, (y / 2.14) + .5) for x, y, z in vertices]
    obj = mesh('ClothBed', vertices, faces, materials['cloth'], geo, uv, smooth=False)
    holes = [(0, sy * .973, .063) for sy in [-1, 1]]
    holes += [(sx * 1.827, sy * .9266, .074) for sx in [-1, 1] for sy in [-1, 1]]
    for i, (x, y, radius) in enumerate(holes):
        bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=radius, depth=.3, location=(x, y, .86))
        cutter = bpy.context.object
        cutter.name = 'SM_Cutter_Pocket_' + str(i + 1)
        relocate(cutter, cutters)
        cutter.hide_render = True
        cutter.hide_set(True)
        modifier = obj.modifiers.new('Pocket opening ' + str(i + 1), 'BOOLEAN')
        modifier.operation = 'DIFFERENCE'
        modifier.solver = 'EXACT'
        modifier.object = cutter
    bevel(obj, .0006, 2)
    return obj


def cushions(outline, materials, geo):
    start = next(i for i, p in enumerate(outline) if p['pocket'])
    ordered = outline[start + 1:] + outline[:start + 1]
    groups, current = [], []
    for i, point in enumerate(ordered):
        if not point['pocket']:
            current.append(point)
        elif current:
            current.append(point)
            groups.append(current)
            current = []
    assert len(groups) == 6
    for index, group in enumerate(groups):
        path = []
        for a, b in zip(group, group[1:]):
            length = math.hypot(b['x'] - a['x'], b['z'] - a['z'])
            divisions = max(1, math.ceil(length / .025))
            for i in range(divisions):
                t = i / divisions
                path.append(Vector((a['x'] * (1 - t) + b['x'] * t, a['z'] * (1 - t) + b['z'] * t, 0)))
        path.append(Vector((group[-1]['x'], group[-1]['z'], 0)))
        profile = [(.007, .879), (.0045, .890), (.0013, .902), (0, .90625),
                   (.0007, .909), (.002, .912), (.0045, .915), (.008, .918),
                   (.013, .920), (.020, .9205), (.033, .9205), (.055, .9195),
                   (.058, .914), (.058, .878)]
        vertices, faces, uv = [], [], []
        along = 0
        for i, p in enumerate(path):
            direction = path[min(i + 1, len(path) - 1)] - path[max(0, i - 1)]
            direction.normalize()
            outward = Vector((direction.y, -direction.x, 0))
            if i:
                along += (p - path[i - 1]).length
            end_distance = min((p - path[0]).length, (p - path[-1]).length)
            thickness = .018 + .040 * min(1, end_distance / .105)
            for j, (offset, height) in enumerate(profile):
                back = offset / .058
                vertices.append(p + outward * offset * thickness / .058 + Vector((0, 0, height)))
                uv.append((along * 3, back))
        width = len(profile)
        for i in range(len(path) - 1):
            for j in range(width):
                a, b = i * width + j, i * width + (j + 1) % width
                faces.append((a, b, b + width, a + width))
        faces.extend([tuple(reversed(range(width))), tuple((len(path) - 1) * width + j for j in range(width))])
        obj = mesh('Cushion_' + str(index + 1), vertices, faces, materials['cushion'], geo, uv)
        obj['nose_height_m'] = .90625
        obj['source'] = 'applyTableGeometry side outline; contact row remains exact'


def frame(materials, geo):
    profile = [(-.047, .848), (-.047, .889), (-.046, .911), (-.043, .918), (-.037, .921),
               (-.018, .9217), (.012, .9215), (.034, .9205), (.044, .917), (.047, .911),
               (.048, .903), (.047, .880), (.043, .869), (.037, .861), (.037, .848)]
    for sy in [-1, 1]:
        for side in [-1, 1]:
            start, end = sorted([side * .072, side * 1.760])
            path = [(start + (end - start) * i / 20, sy * .998, 0) for i in range(21)]
            obj = sweep('LongRail_' + str(sy) + '_' + str(side), path, profile, materials['wood'], geo)
            bevel(obj, .0012, 3)
    for sx in [-1, 1]:
        path = [(sx * 1.899, -.859 + 1.718 * i / 24, 0) for i in range(25)]
        obj = sweep('EndRail_' + str(sx), path, profile, materials['wood'], geo)
        bevel(obj, .0012, 3)
    skirt = [(-.018, .842), (-.016, .846), (.018, .846), (.022, .834), (.019, .822),
             (.012, .805), (.009, .695), (.015, .676), (.014, .667), (-.014, .667)]
    for sy in [-1, 1]:
        path = [(-1.75, sy * .975, 0), (1.75, sy * .975, 0)]
        sweep('ApronLong_' + str(sy), path, skirt, materials['wood'], geo)
        tube('ApronInlayLong_' + str(sy), [(-1.74, sy * .993, .686), (1.74, sy * .993, .686)], .0017, materials['brass'], geo)
    for sx in [-1, 1]:
        path = [(sx * 1.878, -.85, 0), (sx * 1.878, .85, 0)]
        sweep('ApronEnd_' + str(sx), path, skirt, materials['wood'], geo)
        tube('ApronInlayEnd_' + str(sx), [(sx * 1.896, -.84, .686), (sx * 1.896, .84, .686)], .0017, materials['brass'], geo)
    leg_profile = [(0, .073), (.016, .073), (.025, .069), (.042, .062), (.06, .057),
                   (.079, .057), (.09, .061), (.103, .064), (.116, .062), (.13, .055),
                   (.16, .047), (.21, .043), (.27, .048), (.31, .060), (.33, .070),
                   (.35, .073), (.368, .070), (.38, .061), (.40, .058), (.44, .059),
                   (.48, .066), (.53, .073), (.56, .074), (.59, .070), (.61, .075), (.69, .075)]
    for sx in [-1.48, -.50, .50, 1.48]:
        for sy in [-.70, .70]:
            obj = lathe('TurnedLeg_' + str(sx) + '_' + str(sy), leg_profile, materials['wood'], geo, (sx, sy), 24)
            modifier = obj.modifiers.new('Turned profile smoothing', 'SUBSURF')
            modifier.levels = 1
            modifier.render_levels = 2
            lathe('LegShoe_' + str(sx) + '_' + str(sy), [(0, .074), (.006, .075), (.020, .075), (.024, .073)], materials['brass'], geo, (sx, sy), 32)
    for sy in [-1, 1]:
        for offset in [-.018, .018]:
            path = [(-1.76, sy * (1.018 + offset), .63), (-1.50, sy * (1.018 + offset), .59),
                    (1.50, sy * (1.018 + offset), .59), (1.76, sy * (1.018 + offset), .63)]
            tube('ReturnRail_' + str(sy) + '_' + str(offset), path, .005, materials['rubber'], geo, 2)
