import math
import random

from mathutils import Vector

from blender_kit import TAU, V, catmull_rom, loft, path_secs, ridge
from wanderer.rig import blend, mix, smoothstep, top4

HEAD_C = V(0, 1.66, 0.0)
HEAD_R = (0.072, 0.112, 0.09)
TORSO = [(0.90, 0.172, 0.125, -0.03), (1.0, 0.166, 0.118, -0.025), (1.12, 0.172, 0.122, -0.015),
         (1.25, 0.186, 0.13, -0.008), (1.36, 0.19, 0.128, -0.012), (1.43, 0.175, 0.115, -0.02),
         (1.49, 0.14, 0.095, -0.028), (1.53, 0.085, 0.07, -0.032)]
SPINE = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01']
HOOD_KEYS = [
    (0.132, 0.099, 1.655, 1.762, 1.53, 0.095),
    (0.09, 0.124, 1.66, 1.81, 1.545, 0.116),
    (0.02, 0.142, 1.665, 1.83, 1.555, 0.124),
    (-0.06, 0.143, 1.665, 1.826, 1.555, 0.124),
    (-0.13, 0.128, 1.665, 1.80, 1.55, 0.11),
    (-0.185, 0.095, 1.665, 1.772, 1.54, 0.08),
    (-0.215, 0.05, 1.665, 1.752, 1.535, 0.042),
    (-0.228, 0.006, 1.665, 1.742, 1.53, 0.005),
]


def catmull(vals, n):
    v = [vals[0] * 2 - vals[1]] + list(vals) + [vals[-1] * 2 - vals[-2]]
    out = []
    for i in range(n):
        x = i / (n - 1) * (len(vals) - 1)
        k = min(int(x), len(vals) - 2)
        out.append(catmull_rom(v[k], v[k + 1], v[k + 2], v[k + 3], x - k))
    return out


def resample(loop, n):
    pts = loop + [loop[0]]
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1]
    out, k = [], 0
    for i in range(n):
        d = total * i / n
        while lens[k + 1] < d:
            k += 1
        t = (d - lens[k]) / max(1e-9, lens[k + 1] - lens[k])
        out.append(pts[k].lerp(pts[k + 1], t))
    return out


def head(fig):
    on_head = lambda p: {'Head': 1.0}
    fig.ball('head', HEAD_C, HEAD_R[2], 'skin', on_head, s=(HEAD_R[0] / HEAD_R[2], HEAD_R[1] / HEAD_R[2], 1), n=24,
             uv=2.2)
    for s in (-1, 1):
        fig.ball(f'eye{s}', (s * 0.031, 1.673, 0.0795), 0.0125, fig.eye, on_head, s=(1, 0.46, 0.5), n=12,
                 rot=(0, 0, s * -0.08), role='eye', uv=2.2)


def mask_and_scarf(fig):
    rows = [(1.658, 0.076, 0.093, 0.002, 0.016), (1.635, 0.078, 0.097, 0.0, 0.015), (1.60, 0.075, 0.097, 0.0, 0.006),
            (1.575, 0.068, 0.09, -0.003, 0.0), (1.55, 0.062, 0.076, -0.008, 0.0), (1.515, 0.062, 0.068, -0.02, 0.0)]
    secs = [dict(c=(0, y, zc), rx=rx, rz=rz, s=ridge(push, 0.32)) for y, rx, rz, zc, push in rows]
    v, f, rings = loft(secs, 22)
    w = lambda p: {'Head': smoothstep(1.53, 1.6, p.y), 'neck_01': 1 - smoothstep(1.53, 1.6, p.y)}
    fig.add('mask', v, f, 'scarf', w, solid=0.004, sub=1, center=(0, 1.6, 0), uv=2.0)
    top = [v[i] for i in rings[0]] + [v[rings[0][0]]]
    fig.tube('mask-hem', top, 0.0045, 'scarf', w, n=6, caps=False, uv=2.0)
    turns = ((1.535, 0.012, 0.084, 0.098, 0.017), (1.565, 0.02, 0.08, 0.094, 0.015))
    for i, (y, droop, rx, rz, r) in enumerate(turns):
        pts = []
        for k in range(24):
            a = TAU * k / 24
            front = max(0.0, math.sin(a))
            lift = 0.004 * math.sin(3 * a + i)
            pts.append(V(rx * math.cos(a), y - droop * front ** 2 + lift, -0.01 + rz * math.sin(a)))
        fig.tube(f'turn{i}', pts, r, 'scarf', ['neck_01', 'spine_03', 'Head'], n=8, closed=True, uv=1.6)


def hood_weights(p):
    h = smoothstep(1.565, 1.665, p.y)
    return {'Head': h, 'neck_01': (1 - h) * 0.55, 'spine_03': (1 - h) * 0.45}


def hood(fig):
    R = 15
    cols = [catmull([k[i] for k in HOOD_KEYS], R) for i in range(6)]
    NS, NA = 6, 16
    rows = []
    for r in range(R):
        z, rx, yc, yt, yb, xb = (c[r] for c in cols)
        peak = smoothstep(0.5, 1.0, r / (R - 1))
        side = [((xb + (rx - xb) * (1 - (1 - t) ** 2)), yb + (yc - yb) * t) for t in (i / NS for i in range(NS))]
        prof = [(-x, y, 0.0) for x, y in side]
        for i in range(NA + 1):
            a = math.pi - math.pi * i / NA
            crown = math.sin(a) ** 6
            prof.append((rx * math.cos(a), yc + (yt - yc) * math.sin(a) + 0.028 * peak * crown, -0.06 * peak * crown))
        prof += [(x, y, 0.0) for x, y in reversed(side)]
        rows.append([V(x, y, z + dz) for x, y, dz in prof])
    crease(rows)
    yc0 = cols[2][0]
    out = [(V(p.x, p.y - yc0, 0).normalized() if V(p.x, p.y - yc0, 0).length > 1e-6 else V(0, 1, 0)) for p in rows[0]]
    yb0 = cols[4][0]
    fade = [smoothstep(yb0, yb0 + 0.06, p.y) for p in rows[0]]
    fold = [[p + o * 0.012 * f + V(0, 0, 0.003 * f) for p, o, f in zip(rows[0], out, fade)],
            [p + o * 0.025 * f + V(0, 0, -0.003 * f) for p, o, f in zip(rows[0], out, fade)]]
    fig.grid('hood', fold[::-1] + rows, 'hood', hood_weights, solid=0.011, closed=False, sub=1,
             center=(0, 1.665, -0.05))
    return rows


def crease(rows):
    rnd = random.Random(3)
    phase = [rnd.random() * TAU for _ in range(4)]
    for r, row in enumerate(rows):
        u = r / (len(rows) - 1)
        for j, p in enumerate(row):
            s = j / (len(row) - 1)
            d = (p - V(0, 1.665, p.z))
            d.z = 0
            if d.length > 1e-6:
                d.normalize()
            amp = 0.006 * math.sin(math.pi * u) * (0.4 + 0.6 * abs(math.cos(math.pi * s)))
            row[j] = p + d * amp * math.sin(9 * math.pi * s + phase[r % 4] * 0.3 + 4 * u)


def mantle(fig, hood_rows):
    rig = fig.rig
    R = len(hood_rows)
    loop = [hood_rows[r][0] for r in range(R)] + [hood_rows[r][-1] for r in reversed(range(R))]
    a0, b0 = hood_rows[0][-1], hood_rows[0][0]
    loop += [a0.lerp(b0, t) + V(0, -0.006 * math.sin(math.pi * t), 0.012 * math.sin(math.pi * t))
             for t in (k / 6 for k in range(1, 6))]
    M, K = 80, 13
    collar = [rig.deform(c + V(0, 0.008, 0), hood_weights(c)) for c in resample(loop, M)]
    i0 = min(range(M), key=lambda i: (collar[i].z, abs(collar[i].x)))
    collar = collar[i0:] + collar[:i0]
    cz = -0.05
    rows = []
    for k in range(K):
        t = k / (K - 1)
        row = []
        for c in collar:
            a = math.atan2(c.z - cz, c.x)
            side = abs(math.cos(a))
            hem = V(math.cos(a) * 0.32, 1.305 - 0.025 * side, cz + math.sin(a) * 0.235)
            out = V(math.cos(a), 0, math.sin(a))
            p = c.lerp(hem, 1 - (1 - t) ** 1.5) + out * ((0.018 + 0.025 * side) * math.sin(math.pi * t))
            p += out * (0.004 + 0.016 * t ** 1.2) * math.sin(12 * a + 0.7)
            if k == K - 1:
                p += V(0, 0.01 * math.sin(7 * a + 1.3) + 0.004 * math.sin(23 * a), 0)
            row.append(p)
        rows.append(row)
    clear(rig, rows)
    weights = [top4(x) for row in mantle_weights(collar, K, cz) for x in row]
    piece = fig.grid('mantle', rows, 'mantle', weights, solid=0.009, center=(0, 1.3, -0.05), posed=True)
    hem = rows[-1]
    hem_w = [weights[(K - 1) * M + j] for j in range(M)]
    fig.tube('mantle-piping', hem + [hem[0]], 0.0042, 'stitch',
             lambda p: hem_w[min(range(M), key=lambda j: (hem[j] - p).length)], n=5, posed=True)
    return piece


def mantle_weights(collar, K, cz):
    M = len(collar)
    rows = []
    for k in range(K):
        t = k / (K - 1)
        e = smoothstep(0.0, 0.5, t)
        row = []
        for c in collar:
            a = math.atan2(c.z - cz, c.x)
            arm = smoothstep(0.5, 0.95, abs(math.cos(a))) * smoothstep(0.2, 0.75, t)
            s = 'l' if math.cos(a) > 0 else 'r'
            w = {'neck_01': 0.55 * (1 - e), 'spine_03': 0.45 * (1 - e) + 0.8 * e, 'spine_02': 0.2 * e}
            w = {b: x * (1 - 0.6 * arm) for b, x in w.items()}
            w[f'clavicle_{s}'] = 0.2 * arm
            w[f'upperarm_{s}'] = 0.4 * arm
            row.append(w)
        rows.append(row)
    for _ in range(2):
        rows = [[rows[k][j] if k == 0 else blend([rows[k][j], rows[k][j], rows[k][(j - 1) % M], rows[k][(j + 1) % M],
                                                   rows[k - 1][j], rows[min(K - 1, k + 1)][j]])
                 for j in range(M)] for k in range(K)]
    return rows


def clearance(rig, p):
    best = Vector((0, 0, 0))
    JP = rig.posed
    for s in ('l', 'r'):
        upper = (JP[f'upperarm_{s}'], JP[f'lowerarm_{s}'], 0.09)
        shoulder = (JP[f'clavicle_{s}'].lerp(JP[f'upperarm_{s}'], 0.7), JP[f'upperarm_{s}'], 0.088)
        for a, b, r in (upper, shoulder):
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            d = p - (a + ab * t)
            if d.length < r:
                push = d.normalized() * (r - d.length) if d.length > 1e-6 else Vector((0, 0, 0))
                if push.length > best.length:
                    best = push
    for (y0, rx0, rz0, z0), (y1, rx1, rz1, z1) in zip(TORSO, TORSO[1:]):
        if y0 <= p.y <= y1:
            f = (p.y - y0) / (y1 - y0)
            rx, rz, zc = rx0 + (rx1 - rx0) * f, rz0 + (rz1 - rz0) * f, z0 + (z1 - z0) * f
            c = rig.deform(V(0, p.y, zc), rig.near(V(0, p.y, zc), SPINE))
            dx, dz = p.x - c.x, p.z - c.z
            k = math.hypot(dx / (rx + 0.022), dz / (rz + 0.022))
            if 1e-6 < k < 1:
                push = Vector((dx / k - dx, 0, dz / k - dz))
                if push.length > best.length:
                    best = push
    return best


def clear(rig, rows):
    K, M = len(rows), len(rows[0])
    for _ in range(8):
        moves = [[clearance(rig, p) for p in row] for row in rows]
        for _ in range(10):
            moves = [[(moves[k][j] * 2 + moves[k][(j - 1) % M] + moves[k][(j + 1) % M] + moves[max(0, k - 1)][j]
                       + moves[min(K - 1, k + 1)][j]) / 6 for j in range(M)] for k in range(K)]
        for k in range(1, K):
            for j in range(M):
                rows[k][j] = rows[k][j] + moves[k][j] * 1.5
        rows[1:K - 1] = [[rows[k][j] * 0.5 + (rows[k - 1][j] + rows[k + 1][j]) * 0.25 for j in range(M)]
                         for k in range(1, K - 1)]


def coat(fig):
    secs = [dict(c=(0, y, zc), rx=rx, rz=rz) for y, rx, rz, zc in TORSO]
    v, f, _ = loft(secs, 28)
    torso = fig.add('coat', v, f, 'coat', SPINE + ['clavicle_l', 'clavicle_r'], sub=1, center=(0, 1.2, 0))
    skirt = coat_skirt(fig)
    belt = [dict(c=(0, y, -0.025), rx=0.19, rz=0.138) for y in (0.995, 1.045)]
    v, f, _ = loft(belt, 36)
    fig.add('belt', v, f, 'leather', ['pelvis', 'spine_01'], solid=0.006, center=(0, 1.02, 0))
    fz = -0.025 + 0.138 + 0.008
    pts = [V(-0.022, 1.004, fz), V(0.022, 1.004, fz), V(0.022, 1.036, fz), V(-0.022, 1.036, fz)]
    fig.tube('buckle', pts, 0.0035, 'iron', ['pelvis'], n=6, closed=True, uv=2.0)
    return torso, skirt


def coat_skirt(fig):
    K, n = 14, 44
    g = 0.27
    arc = (math.pi / 2 + g, math.pi / 2 + TAU - g)
    rows, weights = [], []
    for k in range(K):
        t = k / (K - 1)
        y = 1.02 - 0.75 * t
        rx = 0.178 + 0.112 * t ** 1.3
        rz = 0.128 + 0.107 * t ** 1.2
        zc = -0.025 - 0.025 * t
        row = []
        for j in range(n + 1):
            u = j / n
            a = arc[0] + (arc[1] - arc[0]) * u
            back = math.sin(math.pi * u) ** 0.5
            amp = (0.004 + 0.05 * t ** 1.2) * back
            kx = 1 + amp * math.sin(9 * TAU * u * 0.5 + 0.6 + 0.8 * t)
            p = V(rx * math.cos(a) * kx, y, zc + rz * math.sin(a) * kx)
            if k == K - 1:
                p += V(0, 0.018 * math.sin(4.5 * TAU * u + 0.8) + 0.008 * math.sin(u * 31.0), 0)
            row.append(p)
            side = smoothstep(-0.07, 0.07, p.x)
            legs = {}
            for s, share in (('l', side), ('r', 1 - side)):
                for b, x in top4(fig.rig.near(p, [f'thigh_{s}', f'calf_{s}'])).items():
                    legs[b] = x * share
            weights.append(mix({'pelvis': 1.0}, legs, 0.1 + 0.55 * t))
        rows.append(row)
    skirt = fig.grid('skirt', rows, 'coat', weights, solid=0.008, closed=False, center=(0, 0.6, -0.05))
    nearest = lambda pts, p: min(range(len(pts)), key=lambda i: (pts[i] - p).length)
    for e in (0, n):
        edge = [rows[k][e] for k in range(K)]
        fig.tube(f'skirt-edge{e}', edge, 0.005, 'stitch',
                 lambda p, e=e, edge=edge: weights[nearest(edge, p) * (n + 1) + e], n=5)
    hem = rows[-1]
    fig.tube('skirt-piping', hem, 0.005, 'stitch', lambda p: weights[(K - 1) * (n + 1) + nearest(hem, p)], n=5)
    return skirt


def sleeves(fig):
    for s in ('l', 'r'):
        cl, sh, el, wr = (fig.rig.posed[f'{k}_{s}'] for k in ('clavicle', 'upperarm', 'lowerarm', 'hand'))
        fd = (wr - el).normalized()
        pts = [cl.lerp(sh, 0.7), sh, sh.lerp(el, 0.5), el, el.lerp(wr, 0.45), wr - fd * 0.04]
        bones = ['spine_03', f'clavicle_{s}', f'upperarm_{s}', f'lowerarm_{s}']
        fig.tube(f'sleeve-{s}', pts, [0.07, 0.074, 0.068, 0.062, 0.054, 0.049], 'coat', bones, n=16, steps=2, sub=1,
                 caps=False, posed=True)


def legs(fig):
    for s, x in (('l', 1), ('r', -1)):
        bones = ['pelvis', f'thigh_{s}', f'calf_{s}']
        pts = [V(x * 0.093, 1.03, -0.03), V(x * 0.0906, 0.75, -0.03), V(x * 0.0906, 0.542, -0.022),
               V(x * 0.0906, 0.3, -0.045), V(x * 0.0906, 0.14, -0.07)]
        fig.tube(f'trouser-{s}', pts, [0.09, 0.075, 0.056, 0.05, 0.045], 'trousers', bones, n=14, steps=2, sub=1)
        shaft = [dict(c=(x * 0.0906, y, zc), rx=r, rz=r * 1.08)
                 for y, r, zc in ((0.37, 0.061, -0.048), (0.3, 0.056, -0.05), (0.2, 0.052, -0.058),
                                  (0.12, 0.05, -0.068), (0.07, 0.054, -0.075))]
        v, f, _ = loft(shaft, 18)
        fig.add(f'boot-{s}', v, f, 'boot', [f'calf_{s}', f'foot_{s}'], sub=1, center=(x * 0.09, 0.2, -0.06), uv=1.3)
        fold = [dict(c=(x * 0.0906, y, -0.048), rx=r, rz=r * 1.08) for y, r in ((0.405, 0.066), (0.345, 0.068))]
        v, f, _ = loft(fold, 18)
        fig.add(f'boot-fold-{s}', v, f, 'boot', [f'calf_{s}'], solid=0.005, center=(x * 0.09, 0.37, -0.048), uv=1.3)
        strap = [V(x * 0.0906 + 0.054 * math.cos(a), 0.135, -0.068 + 0.058 * math.sin(a))
                 for a in (TAU * k / 16 for k in range(16))]
        fig.tube(f'boot-strap-{s}', strap, 0.0055, 'leather', [f'calf_{s}', f'foot_{s}'], n=6, closed=True, uv=1.6)
        foot = [V(x * 0.0906, 0.052, -0.135), V(x * 0.0906, 0.066, -0.08), V(x * 0.091, 0.062, -0.01),
                V(x * 0.092, 0.05, 0.06), V(x * 0.093, 0.04, 0.12), V(x * 0.093, 0.032, 0.158),
                V(x * 0.093, 0.03, 0.172)]
        secs = path_secs(foot, [0.044, 0.054, 0.052, 0.05, 0.043, 0.03, 0.012], front=(0, 1, 0), aspect=0.62)
        v, f, _ = loft(secs, 16, cap0=True, cap1=True)
        v = [V(p.x, max(p.y, 0.004), p.z) for p in v]
        fig.add(f'foot-{s}', v, f, 'boot', [f'calf_{s}', f'foot_{s}', f'ball_{s}'], sub=1,
                center=(x * 0.09, 0.05, 0.0), uv=1.3)
