import math
import bpy
import numpy as np


def image(name, data, output, linear=False):
    height, width, _ = data.shape
    value = bpy.data.images.new('T_' + name, width=width, height=height, alpha=True)
    if linear:
        value.colorspace_settings.name = 'Non-Color'
    value.pixels.foreach_set(np.asarray(data, dtype=np.float32).ravel())
    value.filepath_raw = str(output / ('T_' + name + '.png'))
    value.file_format = 'PNG'
    value.save()
    value.pack()
    return value


def rgba(rgb):
    return np.concatenate((rgb, np.ones((*rgb.shape[:2], 1))), axis=2)


def normal(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
    n /= np.linalg.norm(n, axis=2)[:, :, None]
    return rgba(n * .5 + .5)


def material(name, color, roughness, metallic=0):
    value = bpy.data.materials.new('MAT_' + name)
    value.use_nodes = True
    bsdf = value.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return value


def texture(mat, image, socket, normal_map=False):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    source = nodes.new('ShaderNodeTexImage')
    source.image = image
    source.label = image.name
    output = source.outputs['Color']
    if normal_map:
        convert = nodes.new('ShaderNodeNormalMap')
        links.new(output, convert.inputs['Color'])
        output = convert.outputs['Normal']
    links.new(output, nodes.get('Principled BSDF').inputs[socket])


def make_materials(output):
    rng = np.random.default_rng(731)
    y, x = np.mgrid[0:512, 0:2048]
    u, v = x / 2048, y / 512
    warp = .012 * np.sin(u * 11) + .009 * np.sin(u * 29 + v * 9)
    fibers = np.sin((v + warp) * 430 + 4 * np.sin(u * 9))
    pores = np.maximum(0, fibers) ** 14 * (.4 + .6 * np.sin(u * 85 + v * 12) ** 2)
    growth = np.sin((v + warp) * 70 + 3 * np.sin(u * 4))
    grain = .90 + .08 * growth - .17 * pores + rng.normal(0, .012, u.shape)
    wood = material('Rosewood', (1, 1, 1), .24)
    base = grain[:, :, None] * np.array([.29, .075, .043])[None, None, :]
    texture(wood, image('Rosewood_BaseColor', rgba(base), output), 'Base Color')
    texture(wood, image('Rosewood_Normal', normal(pores, .12), output, True), 'Normal', True)
    rough = np.repeat((.23 + pores * .065)[:, :, None], 3, axis=2)
    texture(wood, image('Rosewood_Roughness', rgba(rough), output, True), 'Roughness')

    leather = material('BuffLeather', (1, 1, 1), .64)
    y, x = np.mgrid[0:512, 0:512]
    seeds = rng.uniform(.1, .9, (32, 32, 2))
    px, py = x / 16, y / 16
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    distance = np.full(x.shape, 10.0)
    for dx in [-1, 0, 1]:
        for dy in [-1, 0, 1]:
            offset = seeds[(iy + dy) % 32, (ix + dx) % 32]
            squared = (px - ix - dx - offset[:, :, 0]) ** 2 + (py - iy - dy - offset[:, :, 1]) ** 2
            distance = np.minimum(distance, squared)
    cells = np.exp(-distance * 2.8) + rng.normal(0, .025, x.shape)
    grain = .94 + .045 * cells + rng.normal(0, .008, cells.shape)
    texture(leather, image('Leather_BaseColor', rgba(grain[:, :, None] * np.array([.72, .58, .38])), output), 'Base Color')
    texture(leather, image('Leather_Normal', normal(cells, .55), output, True), 'Normal', True)

    cloth = material('Cloth', (1, 1, 1), .88)
    y, x = np.mgrid[0:1024, 0:2048]
    px, py = (x / 2047 - .5) * 3.92, (y / 1023 - .5) * 2.14
    grain = .99 + rng.normal(0, .008, x.shape)
    base = grain[:, :, None] * np.array([.028, .57, .13])
    distance = np.sqrt((px + 1.04) ** 2 + py ** 2)
    lines = ((np.abs(px + 1.04) < .0012) | ((px <= -1.04) & (np.abs(distance - .29) < .0012)))
    for cx, cy in [(-1.04, -.29), (-1.04, 0), (-1.04, .29), (0, 0), (.86, 0), (1.42, 0)]:
        lines |= (px - cx) ** 2 + (py - cy) ** 2 < .0018 ** 2
    base[lines] = base[lines] * .55 + np.array([.77, .78, .55]) * .45
    texture(cloth, image('Cloth_BaseColor', rgba(base), output), 'Base Color')
    cushion = material('CushionCloth', (.0019, .285, .015), .88)
    y, x = np.mgrid[0:512, 0:512]
    nap = np.sin(x * math.pi) * np.cos(y * math.pi) + rng.normal(0, .22, x.shape)
    nap_image = image('Cloth_Normal', normal(nap, .07), output, True)
    for mat in (cloth, cushion):
        texture(mat, nap_image, 'Normal', True)

    ash = material('AshCue', (1, 1, 1), .31)
    y, x = np.mgrid[0:2048, 0:256]
    along, around = y / 2047, x / 255
    phase = around * 123 + .9 * np.sin(along * 17) + .35 * np.sin(along * 49 + around * 13)
    streaks = np.maximum(0, np.sin(phase)) ** 20
    base = np.array([.84, .72, .49])[None, None, :] - streaks[:, :, None] * np.array([.21, .22, .19])
    base += rng.normal(0, .005, streaks.shape)[:, :, None]
    splice = along < .25 + .17 * np.maximum(0, np.cos(around * math.pi * 8)) ** 6
    base[splice] *= np.array([.10, .07, .05])
    texture(ash, image('Ash_BaseColor', rgba(base), output), 'Base Color')
    return dict(wood=wood, leather=leather, cloth=cloth, cushion=cushion, ash=ash,
                net=material('CottonCord', (.58, .51, .36), .85),
                iron=material('PocketIron', (.09, .085, .07), .31, 1),
                brass=material('Brass', (.55, .32, .09), .26, 1),
                rubber=material('Rubber', (.006, .007, .008), .82),
                tip=material('CueTip', (.025, .08, .10), .88))
