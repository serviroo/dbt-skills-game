/**
 * Rising bubbles: one 2D canvas, a few dozen rings at most, drawn at 30 fps and only while visible.
 * Positions are a pure function of time (seeded), so capture mode renders exact frames.
 */
import { mulberry32 } from '../core/math';
import { now, onFrame } from './clock';

interface Bubble {
  x: number;
  r: number;
  speed: number;
  phase: number;
  sway: number;
  a: number;
}

export class Bubbles {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private list: Bubble[] = [];
  private stop: (() => void) | null = null;
  private last = -1;
  private w = 1;
  private hgt = 1;
  private dpr = 1;
  density = 0;
  brightness = 1;

  constructor(private reduced: () => boolean) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dq-bubbles';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
  }

  /** density: bubbles per 100k css px. */
  set(density: number, brightness = 1) {
    this.density = density;
    this.brightness = brightness;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width || innerWidth);
    this.hgt = Math.max(1, r.height || innerHeight);
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.hgt * this.dpr);
    const rnd = mulberry32(7);
    const reducedK = this.reduced() ? 0.5 : 1;
    const n = Math.min(40, Math.round(((this.w * this.hgt) / 100000) * this.density * reducedK));
    this.list = [];
    for (let i = 0; i < n; i++) {
      const tiny = rnd() < 0.55;
      this.list.push({
        x: rnd(),
        r: tiny ? 1.2 + rnd() * 2.2 : 3.5 + rnd() * 6.5,
        speed: (tiny ? 9 : 14) + rnd() * 16,
        phase: rnd(),
        sway: 3 + rnd() * 9,
        a: 0.35 + rnd() * 0.65,
      });
    }
    this.last = -1;
    this.draw(now(), true);
    if (this.reduced() || !n) {
      this.stop?.();
      this.stop = null;
    } else if (!this.stop) this.stop = onFrame((t) => this.draw(t));
  }

  draw(t: number, force = false) {
    if (!force && t - this.last < 1 / 30) return;
    this.last = t;
    const { g, w, hgt, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const still = this.reduced();
    for (const b of this.list) {
      const travel = hgt + 40;
      const y = hgt + 20 - (((still ? 0 : t) * b.speed + b.phase * travel) % travel);
      const x = b.x * w + Math.sin((still ? 0 : t) * 0.35 + b.phase * 6.28) * b.sway;
      // fade in from the bottom, fade out near the top
      const life = 1 - y / hgt;
      const fade = Math.min(1, (1 - life) * 4, life * 3 + 0.25) * b.a * this.brightness;
      if (fade <= 0.01) continue;
      g.lineWidth = b.r > 3 ? 1 : 0.8;
      g.strokeStyle = `rgba(150, 205, 255, ${0.3 * fade})`;
      g.beginPath();
      g.arc(x, y, b.r, 0, Math.PI * 2);
      g.stroke();
      if (b.r > 3) {
        g.strokeStyle = `rgba(230, 241, 255, ${0.32 * fade})`;
        g.beginPath();
        g.arc(x, y, b.r * 0.62, Math.PI * 1.1, Math.PI * 1.45);
        g.stroke();
      } else {
        g.fillStyle = `rgba(170, 215, 255, ${0.16 * fade})`;
        g.fill();
      }
    }
  }

  destroy() {
    this.stop?.();
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }
}

/** The Lantern plate's diagonal scratch streaks (+5 % luma), drawn once. */
let scratch = '';
export function scratchTexture() {
  if (scratch) return scratch;
  const c = document.createElement('canvas');
  c.width = c.height = 384;
  // drawn and read on the CPU: reading a GPU canvas waits for all the GPU has queued, the intro's last frames too, and
  // this is read as the companion first opens
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const r = mulberry32(19);
  g.lineCap = 'round';
  for (let i = 0; i < 150; i++) {
    const x = r() * 520 - 80, y = r() * 520 - 80;
    const len = 24 + r() * 160;
    const ang = (52 + r() * 10) * (Math.PI / 180);
    g.strokeStyle = `rgba(110,150,200,${0.02 + r() * 0.05})`;
    g.lineWidth = 0.6 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  scratch = c.toDataURL();
  return scratch;
}

/**
 * "Bubble bath": a glossy slime blob to poke and squish. No goal, no count.
 * A ring of springs around an ellipse; the loop runs only while it moves, so a still slime costs nothing.
 */
const SVGNS = 'http://www.w3.org/2000/svg';
const N = 30;
const CX = 150, CY = 98, RX = 104, RY = 44;

export class Slime {
  readonly el: HTMLButtonElement;
  private svg: SVGSVGElement;
  private body: SVGPathElement;
  private rim: SVGPathElement;
  private gloss: SVGGElement;
  private inner: SVGGElement;
  private pops: SVGGElement;
  private base: { x: number; y: number; ux: number; uy: number; r: number; a: number }[] = [];
  private d = new Float32Array(N);
  private v = new Float32Array(N);
  private hold: { a: number; s: number } | null = null;
  private stopLoop: (() => void) | null = null;
  private last = 0;
  private lastSound = 0;
  private bubbles: { x: number; y: number; t0: number; r: number; node: SVGCircleElement }[] = [];
  private id = `sl${Math.random().toString(36).slice(2, 7)}`;
  pokes = 0;

  constructor(private o: { reduced: () => boolean; label: string; onPoke?: () => void }) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const sy = Math.sin(a);
      const x = CX + RX * Math.cos(a);
      const y = CY + RY * sy * (sy > 0 ? 0.56 : 1);
      const dx = x - CX, dy = y - CY;
      const r = Math.hypot(dx, dy) || 1;
      this.base.push({ x, y, ux: dx / r, uy: dy / r, r, a });
    }
    const id = this.id;
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'dq-slime';
    this.el.setAttribute('aria-label', o.label);
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 300 150');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.innerHTML = `<defs>
<radialGradient id="${id}f" cx=".34" cy=".2" r=".95"><stop offset="0" stop-color="#e6fff0"/><stop offset=".3" stop-color="#a8ecc6"/><stop offset=".68" stop-color="#5fbf98"/><stop offset="1" stop-color="#23695f"/></radialGradient>
<radialGradient id="${id}d" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#0d2238"/><stop offset="1" stop-color="#050a14"/></radialGradient>
<linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fb8ff" stop-opacity=".15"/><stop offset=".5" stop-color="#4fb8ff" stop-opacity=".85"/><stop offset="1" stop-color="#4fb8ff" stop-opacity=".15"/></linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}c"><use href="#${id}b"/></clipPath>
</defs>
<ellipse cx="150" cy="124" rx="132" ry="21" fill="url(#${id}d)" stroke="rgba(125,150,197,.55)" stroke-width="1"/>
<ellipse cx="150" cy="121" rx="118" ry="14" fill="rgba(79,184,255,.07)"/>
<path id="${id}b" class="dq-slime-body" fill="url(#${id}f)"/>
<g clip-path="url(#${id}c)">
<g class="dq-slime-in"></g>
<path class="dq-slime-rim" fill="none" stroke="rgba(236,255,244,.55)" stroke-width="1.3" stroke-linecap="round"/>
<g class="dq-slime-gloss"><path d="M70 82Q96 56 150 54Q196 54 222 70Q180 62 150 63Q104 64 70 82Z" fill="url(#${id}s)"/><ellipse cx="118" cy="66" rx="14" ry="4.2" fill="#fff" opacity=".7" transform="rotate(-10 118 66)"/><ellipse cx="176" cy="63" rx="5" ry="2.4" fill="#fff" opacity=".65"/><path d="M196 112Q224 104 238 90" fill="none" stroke="#e6fff0" stroke-width="2" stroke-linecap="round" opacity=".35"/></g>
</g>
<g class="dq-slime-pops"></g>
<path d="M18 124Q150 158 282 124" fill="none" stroke="url(#${id}r)" stroke-width="1.2"/>
<g class="dq-slime-foam" fill="rgba(200,230,255,.08)" stroke="rgba(200,230,255,.45)" stroke-width=".8">
<circle cx="34" cy="128" r="5"/><circle cx="44" cy="133" r="3.4"/><circle cx="262" cy="129" r="5.6"/><circle cx="251" cy="134" r="3"/><circle cx="273" cy="122" r="2.6"/><circle cx="26" cy="121" r="2.4"/>
</g>`;
    this.body = this.svg.querySelector('.dq-slime-body')!;
    this.rim = this.svg.querySelector('.dq-slime-rim')!;
    this.gloss = this.svg.querySelector('.dq-slime-gloss')!;
    this.inner = this.svg.querySelector('.dq-slime-in')!;
    this.pops = this.svg.querySelector('.dq-slime-pops')!;
    const seeds = [[112, 92, 4.2], [128, 108, 2.6], [176, 100, 5], [196, 86, 2.4], [150, 84, 3.2], [92, 104, 2.2], [214, 106, 3]];
    for (const [x, y, r] of seeds) {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', String(x));
      c.setAttribute('cy', String(y));
      c.setAttribute('r', String(r));
      c.setAttribute('fill', 'rgba(236,255,244,.28)');
      c.setAttribute('stroke', 'rgba(236,255,244,.7)');
      c.setAttribute('stroke-width', '.7');
      this.inner.append(c);
    }
    this.el.append(this.svg);
    this.render();
    this.el.addEventListener('pointerdown', this.down);
    this.el.addEventListener('click', this.key);
  }

  /** True while the springs are moving (the frame loop is on). */
  get moving() {
    return !!this.stopLoop;
  }

  private toSvg(e: PointerEvent) {
    const r = this.svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 300, y: ((e.clientY - r.top) / r.height) * 150 };
  }
  private angleOf(x: number, y: number) {
    return Math.atan2((y - CY) / RY, (x - CX) / RX);
  }

  private down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = this.toSvg(e);
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* not offered */
    }
    this.poke(p.x, p.y);
    this.setHold(p.x, p.y);
    const move = (ev: PointerEvent) => {
      const q = this.toSvg(ev);
      this.setHold(q.x, q.y);
    };
    const up = () => {
      this.hold = null;
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.wake();
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  };

  /** Keyboard (Enter / Space): a poke somewhere on top. */
  private key = (e: MouseEvent) => {
    if (e.detail !== 0) return;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    this.poke(CX + Math.cos(a) * RX * 0.8, CY + Math.sin(a) * RY * 0.8);
  };

  private setHold(x: number, y: number) {
    const a = this.angleOf(x, y);
    const k = Math.hypot((x - CX) / RX, (y - CY) / RY);
    this.hold = { a, s: Math.max(-0.45, Math.min(0.6, k - 1)) };
    this.wake();
  }

  /** A dent where the finger lands, a little wobble, and a bubble or two. */
  poke(x: number, y: number) {
    this.pokes++;
    const a = this.angleOf(x, y);
    const strength = this.o.reduced() ? 90 : 200;
    for (let i = 0; i < N; i++) this.v[i] -= strength * this.weight(i, a, 0.42);
    if (!this.o.reduced()) {
      const b = this.base[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / N)) % N];
      const sx = b.y < CY ? b.x : CX + (b.x - CX) * 0.6;
      const sy = b.y < CY ? b.y : CY - RY * 0.7;
      for (let k = 0; k < 2; k++) this.spawn(sx + (k ? 8 : -6), sy - 4, k ? 3.2 : 4.6, k * 0.12);
    }
    const t = performance.now();
    if (t - this.lastSound > 700) {
      this.lastSound = t;
      this.o.onPoke?.();
    }
    this.wake();
  }

  private spawn(x: number, y: number, r: number, delay: number) {
    const node = document.createElementNS(SVGNS, 'circle');
    node.setAttribute('r', String(r));
    node.setAttribute('fill', 'rgba(220,245,255,.12)');
    node.setAttribute('stroke', 'rgba(220,245,255,.8)');
    node.setAttribute('stroke-width', '.8');
    node.setAttribute('cx', String(x));
    node.setAttribute('cy', String(y));
    node.setAttribute('opacity', '0');
    this.pops.append(node);
    this.bubbles.push({ x, y, r, node, t0: performance.now() / 1000 + delay });
  }

  private weight(i: number, a: number, width: number) {
    let da = Math.abs(this.base[i].a - a) % (Math.PI * 2);
    if (da > Math.PI) da = Math.PI * 2 - da;
    return Math.exp(-((da / width) ** 2));
  }

  private wake() {
    if (this.stopLoop) return;
    this.last = performance.now() / 1000;
    this.stopLoop = onFrame(() => this.step());
  }

  private step() {
    const t = performance.now() / 1000;
    const dt = Math.min(1 / 30, Math.max(0, t - this.last));
    this.last = t;
    const reduced = this.o.reduced();
    const K = 70, C = reduced ? 17 : 3.6, J = 140;
    const sub = 3;
    const hs = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < N; i++) {
        const l = this.d[(i + N - 1) % N], r = this.d[(i + 1) % N];
        let acc = -K * this.d[i] - C * this.v[i] + J * (l + r - 2 * this.d[i]);
        if (this.hold) {
          const w = this.weight(i, this.hold.a, 0.5);
          acc += 160 * (this.hold.s * this.base[i].r * w - this.d[i]) * w;
        }
        this.v[i] += acc * hs;
      }
      for (let i = 0; i < N; i++) this.d[i] = Math.max(-34, Math.min(40, this.d[i] + this.v[i] * hs));
    }
    let energy = 0;
    for (let i = 0; i < N; i++) energy += Math.abs(this.d[i]) + Math.abs(this.v[i]) * 0.1;
    this.bubbles = this.bubbles.filter((b) => {
      const e = t - b.t0;
      if (e > 1.4) {
        b.node.remove();
        return false;
      }
      if (e < 0) return true;
      const k = e / 1.4;
      b.node.setAttribute('cy', (b.y - k * 46).toFixed(1));
      b.node.setAttribute('cx', (b.x + Math.sin(e * 5) * 3).toFixed(1));
      b.node.setAttribute('opacity', (Math.min(1, e * 6) * (1 - k)).toFixed(2));
      return true;
    });
    if (!this.hold && energy < 0.6 && !this.bubbles.length) {
      this.d.fill(0);
      this.v.fill(0);
      this.stopLoop?.();
      this.stopLoop = null;
    }
    this.render();
  }

  private render() {
    const P = this.base.map((b, i) => [b.x + b.ux * this.d[i], b.y + b.uy * this.d[i]]);
    let path = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 0; i < N; i++) {
      const p0 = P[(i + N - 1) % N], p1 = P[i], p2 = P[(i + 1) % N], p3 = P[(i + 2) % N];
      path += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    this.body.setAttribute('d', `${path}Z`);
    const top = Math.round((N * 3) / 4);
    let rim = '';
    for (let k = -6; k <= 5; k++) {
      const q = P[(top + k + N) % N];
      rim += `${k === -6 ? 'M' : 'L'}${q[0].toFixed(1)} ${(q[1] + 3.4).toFixed(1)}`;
    }
    this.rim.setAttribute('d', rim);
    const lift = (this.d[top] + this.d[(top - 4 + N) % N] + this.d[(top + 4) % N]) / 3;
    const lean = (this.d[0] - this.d[N / 2]) * 0.25;
    this.gloss.setAttribute('transform', `translate(${lean.toFixed(1)} ${(-lift * 0.85).toFixed(1)})`);
    this.inner.setAttribute('transform', `translate(${(lean * 0.6).toFixed(1)} ${(-lift * 0.4).toFixed(1)})`);
  }

  destroy() {
    this.stopLoop?.();
    this.stopLoop = null;
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('click', this.key);
  }
}
