import math
from mesh_tools import mesh


def make_cue(materials, group):
    profile = [(-1.45, .0138), (-1.448, .0145), (-1.435, .0145)]
    for i in range(33):
        x = -1.433 + i / 32 * 1.410
        r = .00515 + .0093 * ((-x - .023) / 1.410) ** .83
        profile.append((x, r))
    profile += [(-.022, .00515), (-.008, .00515), (-.0065, .005), (-.001, .005), (0, .0044)]
    vertices, faces, uv = [], [], []
    for x, r in profile:
        for j in range(49):
            angle = j / 48 * math.tau
            vertices.append((x, r * math.cos(angle), r * math.sin(angle)))
            uv.append((j / 48, (x + 1.45) / 1.45))
    for i in range(len(profile) - 1):
        for j in range(48):
            a = i * 49 + j
            faces.append((a, a + 1, a + 50, a + 49))
    faces += [tuple(reversed(range(48))), tuple((len(profile) - 1) * 49 + j for j in range(48))]
    obj = mesh('Cue', vertices, faces, materials['ash'], group, uv)
    for name in ['brass', 'tip', 'rubber']:
        obj.data.materials.append(materials[name])
    for polygon in obj.data.polygons:
        x = sum(obj.data.vertices[i].co.x for i in polygon.vertices) / len(polygon.vertices)
        polygon.material_index = 3 if x < -1.434 else 2 if x > -.008 else 1 if x > -.023 else 0
    obj['tip_origin'] = True
    obj['length_m'] = 1.45
    return obj
