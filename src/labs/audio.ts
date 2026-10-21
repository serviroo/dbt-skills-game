import type { Stage } from '../core/stage';
import '../styles/lantern-window.css';
import {
  AudioEngine, BED_NAMES, CUE_NAMES, SECTIONS, bufferToWav, cueLength, lastStats, renderOffline, toBase64,
  type BedHandle, type BedName, type ChargeHandle, type Section, type SoundEvent,
} from '../audio/engine';
import { cutsceneEvents, demoEvents } from '../audio/events';

const GROUPS: [string, string[]][] = [
  ['Gate', ['gate_air', 'gate_crack', 'gate_swell']],
  ['Lantern', ['ui_open', 'ui_close', 'ui_tap', 'level_tick', 'level_ring', 'level_resolve']],
  ['Warden', ['eye_swell', 'whoosh', 'awaken_hit', 'riser', 'soldier_ignite', 'stand_swell']],
  ['Reward', ['chest_rise', 'chest_burst', 'reward_chime', 'letter_open', 'endcard']],
  ['Companion', ['card_flip', 'soft_chime', 'bubble', 'breath_in', 'breath_out', 'check']],
];

const CSS = `
.al{position:fixed;inset:0;overflow:auto;pointer-events:auto;font-family:var(--font-ui);color:var(--body);
  padding:calc(18px + var(--safe-top)) clamp(14px,4vw,40px) calc(28px + var(--safe-bottom));
  background:radial-gradient(120% 70% at 50% -10%,rgba(20,87,172,.20),transparent 60%),#07080f;}
.al h1{font:500 clamp(15px,2.2vw,18px)/1 var(--font-ui);letter-spacing:.18em;text-transform:uppercase;color:var(--title);
  margin:0 0 4px;text-shadow:0 0 10px rgba(79,184,255,.55)}
.al .sub{font-size:13px;color:var(--dim);letter-spacing:.04em;margin:0 0 18px}
.al .hd{max-width:1320px;margin:0 auto}
.al .wrap{display:grid;gap:18px;grid-template-columns:1fr;max-width:1320px;margin:0 auto}
.al .wrap>div:last-child{order:-1}
@media (min-width:1000px){.al .wrap{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}.al .wrap>div:last-child{order:0}}
.al .card{position:relative;background:rgba(5,17,31,.86);border:1px solid rgba(125,150,197,.55);border-right-color:rgba(54,66,87,.9);
  border-bottom-color:rgba(54,66,87,.9);padding:14px 14px 16px}
.al .card::before{content:'';position:absolute;left:-1px;right:-1px;top:-1px;height:2px;
  background:linear-gradient(90deg,transparent,#19c5f5 18%,#9cfbff 50%,#19c5f5 82%,transparent);box-shadow:0 0 10px rgba(79,184,255,.6)}
.al h2{font:500 12px/1 var(--font-ui);letter-spacing:.2em;text-transform:uppercase;color:#9fc6ea;margin:2px 0 12px}
.al .grp{margin:0 0 12px}.al .grp:last-child{margin:0}
.al .gl{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);margin:0 0 7px}
.al .row{display:flex;flex-wrap:wrap;gap:7px}
.al .sw-btn{font-size:12px;letter-spacing:.08em;padding:.72em 1.05em .72em 1.15em;text-transform:none}
.al .sw-btn.on{background:linear-gradient(180deg,rgba(79,184,255,.42),rgba(31,109,243,.24));border-color:#a8ddff}
.al canvas{display:block;width:100%;height:auto;background:#050a14;border:1px solid rgba(62,100,133,.6)}
.al .meta{font:12px/1.55 var(--font-ui);color:var(--body);margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:4px 14px}
.al .meta b{color:var(--title);font-weight:500}
.al input[type=range]{width:100%;accent-color:#4fb8ff;margin:10px 0 6px;height:28px}
.al .charge{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
.al .hint{font-size:12px;color:var(--dim);margin-top:6px}
`;

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

function colour(x: number) {
  const stops: [number, number, number, number][] = [
    [0, 7, 8, 15], [0.35, 13, 57, 118], [0.6, 25, 197, 245], [0.82, 156, 251, 255], [1, 230, 241, 255],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, r0, g0, b0] = stops[i - 1];
      const [b, r1, g1, b1] = stops[i];
      const k = (x - a) / (b - a);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  return [230, 241, 255];
}

function analyse(buf: AudioBuffer) {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0, end = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    if (a > 0.001) end = i;
  }
  return { peakDb: 20 * Math.log10(peak + 1e-12), len: end / buf.sampleRate };
}

function drawSpectrogram(cv: HTMLCanvasElement, buf: AudioBuffer, label: string) {
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#050a14';
  g.fillRect(0, 0, W, H);
  const specH = Math.round(H * 0.74);
  const sr = buf.sampleRate;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const N = 2048;
  const fLo = 40, fHi = 16000;
  const img = g.createImageData(W, specH);
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const ln = Math.log(fHi / fLo);
  let bandIn = 0, bandAll = 0;
  const db = new Float32Array(W * specH);
  let maxDb = -200;
  for (let x = 0; x < W; x++) {
    const c = Math.floor((x / W) * (L.length - N));
    for (let i = 0; i < N; i++) {
      re[i] = ((L[c + i] ?? 0) + (R[c + i] ?? 0)) * 0.5 * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const f = (k * sr) / N;
      bandAll += p;
      if (f >= 800 && f <= 5000) bandIn += p;
    }
    for (let y = 0; y < specH; y++) {
      const f = fLo * Math.exp(ln * (1 - y / specH));
      const k = Math.min(N / 2 - 1, Math.max(1, Math.round((f * N) / sr)));
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 4);
      const d = 20 * Math.log10(mag + 1e-9);
      db[y * W + x] = d;
      if (d > maxDb) maxDb = d;
    }
  }
  for (let i = 0; i < db.length; i++) {
    const v = Math.max(0, Math.min(1, (db[i] - maxDb + 72) / 72));
    const [r, gg, b] = colour(Math.pow(v, 1.5));
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.font = "500 22px Jost, sans-serif";
  for (const f of [250, 800, 5000]) {
    const y = specH * (1 - Math.log(f / fLo) / ln);
    g.strokeStyle = f === 250 ? 'rgba(125,150,197,.35)' : 'rgba(156,251,255,.45)';
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(196,221,243,.8)';
    g.fillText(f >= 1000 ? f / 1000 + " kHz" : f + " Hz", 10, y - 7);
  }
  const wy = specH + 8, wh = H - specH - 14;
  g.strokeStyle = 'rgba(62,100,133,.6)';
  g.beginPath();
  g.moveTo(0, wy + wh / 2);
  g.lineTo(W, wy + wh / 2);
  g.stroke();
  g.fillStyle = '#4fb8ff';
  const step = L.length / W;
  for (let x = 0; x < W; x++) {
    let mx = 0;
    const s = Math.floor(x * step), e = Math.floor((x + 1) * step);
    for (let i = s; i < e; i += 2) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
    const h = Math.max(1, mx * wh);
    g.fillRect(x, wy + wh / 2 - h / 2, 1, h);
  }
  g.fillStyle = 'rgba(230,241,255,.9)';
  g.font = "500 24px Jost, sans-serif";
  g.fillText(label, W - g.measureText(label).width - 12, 30);
  return bandIn / (bandAll + 1e-12);
}

export async function lab(stage: Stage) {
  void stage;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'al';
  document.getElementById('ui')!.append(root);

  let eng: AudioEngine | null = null;
  const engine = () => {
    if (!eng) eng = new AudioEngine();
    void eng.unlock();
    return eng;
  };

  root.innerHTML = `
    <div class="hd"><h1>Sound of the Lantern</h1>
      <p class="sub">Every sound is synthesized live. Tap to audition; the view shows its offline render.</p></div>
    <div class="wrap">
      <div>
        <div class="card"><h2>Cues</h2><div id="cues"></div></div>
        <div class="card" style="margin-top:18px"><h2>Score</h2><div class="row" id="music"></div>
          <div class="gl" style="margin-top:14px">Beds</div><div class="row" id="beds"></div></div>
      </div>
      <div>
        <div class="card"><h2 id="sl">Spectrum</h2><canvas id="cv" width="1200" height="560"></canvas><div class="meta" id="meta"></div></div>
        <div class="card" style="margin-top:18px"><h2>Hold to charge</h2>
          <div class="charge"><input id="cs" type="range" min="0" max="1" step="0.001" value="0"><button class="sw-btn gold" id="burst">Burst</button></div>
          <div class="hint">Drag and hold. Let go early and it drains back, no penalty sound.</div>
          <div class="gl" style="margin-top:16px">Sequences</div>
          <div class="row"><button class="sw-btn" id="demo">20 s demo</button><button class="sw-btn" id="cut">Full cutscene</button><button class="sw-btn quiet" id="halt">Stop all</button></div>
        </div>
      </div>
    </div>`;

  const cues = root.querySelector('#cues')!;
  for (const [name, list] of GROUPS) {
    const grp = document.createElement('div');
    grp.className = 'grp';
    grp.innerHTML = `<div class="gl">${name}</div><div class="row"></div>`;
    for (const c of list) {
      const b = document.createElement('button');
      b.className = 'sw-btn';
      b.textContent = c;
      b.addEventListener('click', () => {
        engine().play(c);
        void show(c);
      });
      grp.lastElementChild!.append(b);
    }
    cues.append(grp);
  }

  const mus = root.querySelector('#music')!;
  const mbtn = new Map<string, HTMLButtonElement>();
  for (const s of [...SECTIONS, 'stop'] as (Section | 'stop')[]) {
    const b = document.createElement('button');
    b.className = 'sw-btn' + (s === 'stop' ? ' quiet' : '');
    b.textContent = s;
    b.addEventListener('click', () => {
      const e = engine();
      if (s === 'stop') e.music.stop(1.5);
      else e.music.to(s, 2.5, { at: e.now + 0.05 });
      for (const [k, x] of mbtn) x.classList.toggle('on', k === s);
    });
    mbtn.set(s, b);
    mus.append(b);
  }

  const beds = root.querySelector('#beds')!;
  const running = new Map<BedName, BedHandle>();
  for (const n of BED_NAMES) {
    const b = document.createElement('button');
    b.className = 'sw-btn';
    b.textContent = n;
    b.addEventListener('click', () => {
      const e = engine();
      const h = running.get(n);
      if (h) {
        h.stop(1.2);
        running.delete(n);
      } else running.set(n, e.bed(n, { fadeIn: 1.2 }));
      b.classList.toggle('on', running.has(n));
    });
    beds.append(b);
  }

  const cs = root.querySelector<HTMLInputElement>('#cs')!;
  let ch: ChargeHandle | null = null;
  cs.addEventListener('pointerdown', () => {
    ch = engine().chargeLoop();
  });
  cs.addEventListener('input', () => ch?.set(Number(cs.value)));
  const rel = () => {
    if (!ch) return;
    ch.release();
    const start = Number(cs.value);
    const t0 = performance.now();
    const drain = () => {
      const k = Math.min(1, (performance.now() - t0) / 350);
      cs.value = String(start * (1 - k));
      if (k < 1) requestAnimationFrame(drain);
    };
    requestAnimationFrame(drain);
  };
  cs.addEventListener('pointerup', rel);
  cs.addEventListener('pointercancel', rel);
  root.querySelector('#burst')!.addEventListener('click', () => {
    const e = engine();
    const h = ch ?? e.chargeLoop();
    h.stop(e.now, 0.03);
    ch = null;
    e.play('chest_burst', { at: e.now + 0.2 });
    cs.value = '0';
  });

  root.querySelector('#demo')!.addEventListener('click', () => {
    const e = engine();
    e.stopAll(0.2);
    e.schedule(demoEvents(), e.now + 0.3);
    void showEvents(demoEvents(), 20, 'demo');
  });
  root.querySelector('#cut')!.addEventListener('click', () => {
    const e = engine();
    e.stopAll(0.2);
    e.schedule(cutsceneEvents(), e.now + 0.3);
  });
  root.querySelector('#halt')!.addEventListener('click', () => {
    eng?.stopAll(0.3);
    running.clear();
    for (const x of root.querySelectorAll('.sw-btn.on')) x.classList.remove('on');
  });

  const cv = root.querySelector<HTMLCanvasElement>('#cv')!;
  const meta = root.querySelector('#meta')!;
  const sl = root.querySelector('#sl')!;
  const render = (events: SoundEvent[], dur: number) => renderOffline(events, dur, 48000);
  async function showBuf(buf: AudioBuffer, label: string) {
    const share = drawSpectrogram(cv, buf, label);
    const a = analyse(buf);
    sl.textContent = 'Spectrum: ' + label;
    meta.innerHTML = `<span>peak <b>${a.peakDb.toFixed(1)} dBFS</b></span><span>audible <b>${a.len.toFixed(2)} s</b></span><span>0.8-5 kHz <b>${(share * 100).toFixed(0)} %</b></span><span>sources <b>${lastStats?.peakSources ?? '-'}</b></span>`;
  }
  async function show(c: string) {
    const buf = await render([{ t: 0.02, cue: c }], cueLength(c) + 0.3);
    await showBuf(buf, c);
  }
  async function showEvents(ev: SoundEvent[], dur: number, label: string) {
    await showBuf(await render(ev, dur), label);
  }

  const w = window as any;
  w.__audioEngine = () => engine();
  w.__renderCue = async (name: string, opts: Record<string, unknown> = {}) => {
    const buf = await render([{ t: 0.02, cue: name, opts }], cueLength(name) + 0.3);
    return toBase64(bufferToWav(buf));
  };
  w.__renderEvents = async (events: SoundEvent[], dur: number, float = false) => toBase64(bufferToWav(await render(events, dur), { float }));
  w.__renderDemo = async () => toBase64(bufferToWav(await render(demoEvents(), 20)));
  w.__renderCutscene = async (o?: Parameters<typeof cutsceneEvents>[0], dur = 88) => toBase64(bufferToWav(await render(cutsceneEvents(o), dur)));
  w.__renderStats = () => lastStats;
  w.__cues = [...CUE_NAMES];
  w.__show = show;
  await show(new URLSearchParams(location.search).get('cue') ?? 'ui_open');
  w.__lab = true;
}
