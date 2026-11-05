import math

from blender_kit import TAU
from wanderer.rig import smoothstep

FINGER_RING = [135, 90, 45, 0, -45, -90, -135, 180]
FINGER_NAMES = ('pinky', 'ring', 'middle', 'index')
FINGER_SIZES = (0.86, 0.97, 1.03, 1.0)
FIRST_PALM_RING = 7


class Glove:
    def __init__(self, rig, s, x):
        self.rig, self.s, self.x = rig, s, x
        J = rig.rest
        self.h = J[self.bone('hand')]
        d = (J[self.bone('middle_01')] - self.h).normalized()
        wv = J[self.bone('index_01')] - J[self.bone('pinky_01')]
        self.d = d
        self.wv = (wv - d * wv.dot(d)).normalized()
        self.back = d.cross(self.wv) * -x
        self.verts, self.ws, self.faces = [], [], []
        base = [(J[self.bone(f'{k}_01')] - self.h) for k in FINGER_NAMES]
        across = [p.dot(self.wv) for p in base]
        along = [p.dot(d) for p in base]
        self.level = sum(p.dot(self.back) for p in base) / 4
        self.cols = [across[0] - 0.009]
        self.knuckle_a = [along[0] - 0.017]
        for k in range(4):
            self.cols.append(across[k])
            self.cols.append((across[k] + across[k + 1]) / 2 if k < 3 else across[3] + 0.01)
            self.knuckle_a.append(along[k] - 0.013)
            self.knuckle_a.append((along[k] + along[k + 1]) / 2 - 0.013 if k < 3 else along[3] - 0.017)
        self.mid = (self.cols[0] + self.cols[-1]) / 2
        self.half = (self.cols[-1] - self.cols[0]) / 2

    def bone(self, name):
        return f'{name}_{self.s}'

    def at(self, a, u, v):
        return self.h + self.d * a + self.wv * u + self.back * v

    def vert(self, p, w):
        self.verts.append(p)
        self.ws.append(w)
        return len(self.verts) - 1

    def quads(self, r0, r1, skip=()):
        n = len(r0)
        self.faces.extend((r0[j], r0[(j + 1) % n], r1[(j + 1) % n], r1[j]) for j in range(n) if j not in skip)

    def cap(self, ring, end, w):
        tip = self.vert(end, w)
        for j in (7, 1, 3, 5):
            self.faces.append((tip, ring[j], ring[(j + 1) % 8], ring[(j + 2) % 8]))

    def palm_ring(self, a, scale, tb, tp, oy, w, knuckles=False):
        ox = self.mid * scale
        top, bot = [], []
        for c in range(9):
            u = (self.cols[c] - self.mid) / self.half
            y = ox + (self.cols[c] - self.mid) * scale
            bump = (0.006 if c % 2 else -0.004 if 0 < c < 8 else 0.0) if knuckles else 0.0
            heel = 0.0 if knuckles else 0.003 * smoothstep(0.3, 0.9, -u)
            top.append(self.vert(self.at(a[c], y, oy + tb * (1 - 0.45 * u * u) + bump), w(c)))
            bot.append(self.vert(self.at(a[c], y, oy - (tp + heel) * (1 - 0.4 * u * u)), w(c)))
        side = lambda c, o: self.vert(self.at(a[c], ox + (self.cols[c] - self.mid) * scale + o * 0.0045, oy - 0.002),
                                      w(c))
        return top + [side(8, 1)] + bot[::-1] + [side(0, -1)]

    def round_ring(self, a, rx, ry, w):
        fd = (self.h - self.rig.rest[self.bone('lowerarm')]).normalized()
        ax = (self.wv - fd * self.wv.dot(fd)).normalized()
        up = fd.cross(ax) * -self.x
        phis = [math.pi - (c + 1) * math.pi / 10 for c in range(9)]
        phis = phis + [0.0] + [-p for p in phis[::-1]] + [math.pi]
        return [self.vert(self.h + fd * a + ax * (rx * math.cos(p)) + up * (ry * math.sin(p)), w) for p in phis]

    def hand_and_cuff(self):
        fb = self.bone
        arm = {fb('lowerarm'): 1.0}
        rings = [self.round_ring(-0.046, 0.0535, 0.0535, arm),
                 self.round_ring(-0.074, 0.0545, 0.0545, arm),
                 self.round_ring(-0.081, 0.0585, 0.0585, arm),
                 self.round_ring(-0.076, 0.0625, 0.0625, arm),
                 self.round_ring(-0.052, 0.056, 0.055, arm),
                 self.round_ring(-0.032, 0.045, 0.041, {fb('lowerarm'): 0.7, fb('hand'): 0.3}),
                 self.palm_ring([-0.014] * 9, 0.62, 0.017, 0.017, -0.001,
                                lambda c: {fb('lowerarm'): 0.3, fb('hand'): 0.7})]
        thenar = lambda c: {fb('hand'): 0.75, fb('thumb_01'): 0.25} if c >= 6 else {fb('hand'): 1.0}
        for a, scale, tb, tp, oy in ((0.006, 0.78, 0.017, 0.019, -0.002), (0.03, 0.9, 0.017, 0.021, -0.003),
                                     (0.054, 0.97, 0.016, 0.023, -0.004)):
            rings.append(self.palm_ring([a] * 9, scale, tb, tp, oy, thenar))
        hand_w = lambda c: {fb('hand'): 1.0}
        knuckle_a = self.knuckle_a
        rings.append(self.palm_ring([0.054 + 0.55 * (k - 0.054) for k in knuckle_a], 1.0, 0.015, 0.021,
                                    (self.level - 0.004) * 0.6, hand_w))
        rings.append(self.palm_ring(knuckle_a, 1.0, 0.012, 0.016, self.level, hand_w, knuckles=True))
        self.faces.append(tuple(rings[0]))
        for i in range(len(rings) - 1):
            thumb_patch = (10, 11) if i in (FIRST_PALM_RING, FIRST_PALM_RING + 1) else ()
            self.quads(rings[i], rings[i + 1], skip=thumb_patch)
        return rings

    def fingers(self, knuck):
        fb, J = self.bone, self.rig.rest
        top = knuck[:9]
        bot = knuck[10:19][::-1]
        m = {0: knuck[19], 8: knuck[9]}
        for c in (2, 4, 6):
            m[c] = self.vert(self.at(self.knuckle_a[c] - 0.006, self.cols[c], self.level), {fb('hand'): 1.0})
        for k, (name, size) in enumerate(zip(FINGER_NAMES, FINGER_SIZES)):
            c0, c1, c2 = (J[fb(f'{name}_0{i}')] for i in (1, 2, 3))
            leaf = J[fb(f'{name}_04_leaf')]
            b1, b2, b3 = (fb(f'{name}_0{i}') for i in (1, 2, 3))
            t = (leaf - c0).normalized()
            r = [x * size for x in (0.0108, 0.0104, 0.01, 0.0097, 0.0093, 0.0089, 0.0078)]
            chain = [(c0, t, r[0], {fb('hand'): 0.5, b1: 0.5}, 0.0055),
                     (c0.lerp(c1, 0.5), t, r[1], {b1: 1.0}, 0.0),
                     (c1, t, r[2], {b1: 0.5, b2: 0.5}, 0.0055),
                     (c1.lerp(c2, 0.5), t, r[3], {b2: 1.0}, 0.0),
                     (c2, t, r[4], {b2: 0.5, b3: 0.5}, 0.003),
                     (c2.lerp(leaf, 0.45), t, r[5], {b3: 1.0}, 0.0),
                     (leaf - t * 0.004, t, r[6], {b3: 1.0}, 0.0)]
            root = [top[2 * k], top[2 * k + 1], top[2 * k + 2], m[2 * k + 2], bot[2 * k + 2], bot[2 * k + 1],
                    bot[2 * k], m[2 * k]]
            self.finger(chain, root, 1.05, leaf + t * 0.003, {b3: 1.0}, 0.002)

    def finger(self, chain, root, aspect, end, end_w, crease):
        prev = root
        for c, t, r, w, knuckle in chain:
            a = (self.wv - t * self.wv.dot(t)).normalized()
            u = (self.back - t * self.back.dot(t) - a * self.back.dot(a)).normalized()
            ring = []
            for deg in FINGER_RING:
                th = math.radians(deg)
                k = 1.1 if knuckle else 1.0
                off = 0.0
                if deg in (135, 90, 45):
                    off = knuckle * (1.0 if deg == 90 else 0.6)
                if knuckle and deg == -90:
                    off = -crease
                ring.append(self.vert(c + a * (r * k * math.cos(th)) + u * (r * k * aspect * math.sin(th) + off), w))
            self.quads(prev, ring)
            prev = ring
        self.cap(prev, end, end_w)

    def thumb(self, rings):
        fb, J, JP, rig = self.bone, self.rig.rest, self.rig.posed, self.rig
        back = self.back
        r1, r2, r3 = rings[FIRST_PALM_RING], rings[FIRST_PALM_RING + 1], rings[FIRST_PALM_RING + 2]
        root = [r1[10], r1[11], r1[12], r2[12], r3[12], r3[11], r3[10], r2[10]]
        t1, t2 = J[fb('thumb_01')], J[fb('thumb_02')]
        tt = (J[fb('thumb_04_leaf')] - t1).normalized()
        e1 = (back * -1 - tt * (back * -1).dot(tt)).normalized()
        e2 = tt.cross(e1)
        ca = t1.lerp(t2, 0.5) - back * 0.006
        ang = [math.atan2((self.verts[i] - ca).dot(e2), (self.verts[i] - ca).dot(e1)) for i in root]
        steps = [(ang[(j + 1) % 8] - ang[j] + math.pi) % TAU - math.pi for j in range(8)]
        sign = 1 if sum(steps) > 0 else -1
        phi0 = math.atan2(sum(math.sin(a - sign * j * math.pi / 4) for j, a in enumerate(ang)),
                          sum(math.cos(a - sign * j * math.pi / 4) for j, a in enumerate(ang)))
        b1, b2, b3 = fb('thumb_01'), fb('thumb_02'), fb('thumb_03')
        across_idle = (JP[fb('index_01')] - JP[fb('pinky_01')]).normalized()
        middle = JP[fb('index_02')].lerp(JP[fb('index_03')], 0.5)
        root_idle = JP[fb('thumb_02')].lerp(middle, 0.25)
        rest_on = middle + across_idle * 0.021
        ball = JP[fb('thumb_01')].lerp(JP[fb('thumb_02')], 0.55).lerp(middle, 0.2)
        ball_w = {fb('hand'): 0.35, b1: 0.65}
        stations = [(rig.unpose(ball, ball_w), 0.025, ball_w, False)]
        for f, r, w, joint in ((0.0, 0.017, {b1: 0.5, b2: 0.5}, True),
                               (0.28, 0.0158, {b2: 1.0}, False),
                               (0.5, 0.0148, {b2: 0.5, b3: 0.5}, True),
                               (0.72, 0.0138, {b3: 1.0}, False),
                               (0.86, 0.0118, {b3: 1.0}, False)):
            stations.append((rig.unpose(root_idle.lerp(rest_on, f), w), r, w, joint))
        end = rig.unpose(rest_on, {b3: 1.0})
        prev = root
        for i, (c, r, w, joint) in enumerate(stations):
            ahead = stations[i + 1][0] if i + 1 < len(stations) else end
            behind = stations[i - 1][0] if i else t1
            ax = (ahead - behind).normalized()
            f1 = (back * -1 - ax * (back * -1).dot(ax)).normalized()
            f2 = ax.cross(f1)
            k = 1.1 if joint else 1.0
            ring = []
            for j in range(8):
                phi = phi0 + sign * j * math.pi / 4
                ring.append(self.vert(c + f1 * (r * k * 0.88 * math.cos(phi)) + f2 * (r * k * math.sin(phi)), w))
            self.quads(prev, ring)
            prev = ring
        tt = (end - stations[-1][0]).normalized()
        self.cap(prev, end + tt * 0.003, {b3: 1.0})

    def build(self, fig):
        rings = self.hand_and_cuff()
        self.fingers(rings[-1])
        self.thumb(rings)
        used = sorted({i for f in self.faces for i in f})
        keep = {i: n for n, i in enumerate(used)}
        faces = [tuple(keep[i] for i in f) for f in self.faces]
        fig.add(f'glove-{self.s}', [self.verts[i] for i in used], faces, 'glove', [self.ws[i] for i in used], sub=1,
                uv=2.6)


def hands(fig):
    for s, x in (('l', 1), ('r', -1)):
        Glove(fig.rig, s, x).build(fig)
