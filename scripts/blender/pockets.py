import math
import bpy
from mesh_tools import collection, sweep, mesh, tube


def make_pocket(name, center, radius, angle_start, angle_end, materials, transform):
    group = collection('Pocket_' + name)
    path, radial = [], []
    for i in range(49):
        angle = angle_start + (angle_end - angle_start) * i / 48
        direction = (math.cos(angle), math.sin(angle))
        local = (center[0] + radius[0] * direction[0], center[1] + radius[1] * direction[1])
        x, y = transform(*local)
        path.append((x, y, .918))
        radial.append(transform(*direction))
    profile = [(math.cos(i * math.tau / 16) * .013, math.sin(i * math.tau / 16) * .0055)
               for i in range(16)]
    rim = sweep(name + '_LeatherRim', path, profile, materials['leather'], group)
    rim['construction'] = 'Leather wrapped over U-shaped pocket iron; open on the playing side'
    tube(name + '_Iron', [(x, y, z - .0065) for x, y, z in path], .0052, materials['iron'], group, 2)
    vertices, faces, uv = [], [], []
    for i, ((x, y, z), (dx, dy)) in enumerate(zip(path, radial)):
        for j in range(9):
            t = j / 8
            drop = .025 + .065 * math.sin(math.pi * i / 48) ** .65
            fold = .0025 * math.sin(i / 48 * math.pi * 8) * t * t
            bulge = .008 * math.sin(math.pi * t) + fold
            vertices.append((x + dx * (.012 + bulge), y + dy * (.012 + bulge), z - .002 - t * drop))
            uv.append((i / 48 * 2, t))
    for i in range(48):
        for j in range(8):
            a = i * 9 + j
            faces.append((a, a + 9, a + 10, a + 1))
    apron = mesh(name + '_LeatherApron', vertices, faces, materials['leather'], group, uv)
    smooth = apron.modifiers.new('Soft leather drape', 'SUBSURF')
    smooth.levels = 1
    smooth.render_levels = 2
    solid = apron.modifiers.new('Leather thickness 2.2 mm', 'SOLIDIFY')
    solid.thickness = .0022
    solid.offset = 0
    edge = apron.modifiers.new('Rounded leather cut edge', 'BEVEL')
    edge.width = .0008
    edge.segments = 2
    edge.limit_method = 'ANGLE'
    for fraction in [.15, .90]:
        points = [(x + dx * .016, y + dy * .016,
                   z - .002 - fraction * (.025 + .065 * math.sin(math.pi * i / 48) ** .65))
                  for i, ((x, y, z), (dx, dy)) in enumerate(zip(path, radial))]
        tube(name + '_Stitch_' + str(fraction), points, .00045, materials['net'], group, 0)
    net_radius = .061 if name.startswith('Middle') else .072
    cx, cy = transform(*center)
    for winding in [-1, 1]:
        for strand in range(16):
            points = []
            for j in range(41):
                t = j / 40
                angle = strand / 16 * math.tau + winding * t * math.tau * 1.25
                radius_at = net_radius * (1 - .23 * t - .70 * t ** 5)
                weave = .0005 * math.sin(t * math.tau * 20 + strand * math.pi) * winding
                radius_at += weave
                x, y = transform(center[0] + radius_at * math.cos(angle), center[1] + radius_at * math.sin(angle))
                points.append((x, y, .902 - .285 * t))
            tube(name + '_Cord_' + str(winding) + '_' + str(strand), points, .00085, materials['net'], group, 0)
    for height, ring_radius in [(.902, net_radius), (.617, .0045)]:
        points = [(cx + ring_radius * math.cos(i * math.tau / 64), cy + ring_radius * math.sin(i * math.tau / 64), height)
                  for i in range(64)]
        tube(name + '_Binding_' + str(height), points, .0014, materials['net'], group, 1, True)
    return group


def pockets(materials):
    groups = []
    for sy in [-1, 1]:
        groups.append(make_pocket('Middle_' + str(sy), (0, .973), (.071, .059), 0, math.pi,
                                  materials, lambda x, y, sy=sy: (x, sy * y)))
    for sx in [-1, 1]:
        for sy in [-1, 1]:
            groups.append(make_pocket('Corner_' + str(sx) + '_' + str(sy), (1.827, .9266), (.095, .095),
                                      -math.pi / 4, 3 * math.pi / 4, materials,
                                      lambda x, y, sx=sx, sy=sy: (sx * x, sy * y)))
    return groups
