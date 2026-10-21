// Draws every PWA image in code: a GLSL gate tear rendered in headless Chromium, read back as PNG.
// node scripts/icons.mjs [--out=public] [--only=icons|splash] [--sheet=qa/out/pwa/icon-src]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ICONS, splashImages } from './pwa-spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const outDir = path.resolve(root, flags.out ?? 'public');

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uMode;   // 0 icon, 1 splash
uniform float uScale;  // tear size (maskable icons sit inside the 80 % safe circle)
uniform float uBold;   // wider core and softer detail for tiny sizes
uniform float uSS;     // supersample grid

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

const vec3 C_CORE = vec3(0.86, 0.98, 1.0);
const vec3 C_CYAN = vec3(0.31, 0.89, 0.92);    // #96F2F6
const vec3 C_BLUE = vec3(0.045, 0.42, 0.80);   // #3CADE8
const vec3 C_ROYAL = vec3(0.0097, 0.117, 0.456); // #1960B4
const vec3 C_DEEP = vec3(0.003, 0.028, 0.133); // #0A2F66
const vec3 C_VIOLET = vec3(0.198, 0.05, 0.776); // #7B3FE4

// centre line of the tear: a slight lightning lean, not a ruler line
float centre(float y) { return 0.012 * sin(y * 5.2 + 0.9) + 0.010 * (fbm(vec2(y * 6.0, 3.1)) - 0.5); }

float crackGlow(vec2 p, vec2 tip, float dir, float k) {
  // hairline cracks that run on past the tips: the first two lines of the tear
  vec2 q = (p - tip) * vec2(1.0, dir);
  float d = seg(q, vec2(0.0), vec2(0.010 * k, 0.055));
  d = min(d, seg(q, vec2(0.010 * k, 0.055), vec2(-0.006 * k, 0.105)));
  d = min(d, seg(q, vec2(-0.006 * k, 0.105), vec2(0.004 * k, 0.15)));
  float along = clamp(q.y / 0.15, 0.0, 1.0);
  float b = min(d, seg(q, vec2(0.010 * k, 0.055), vec2(0.046 * k, 0.088)));
  float branch = seg(q, vec2(0.010 * k, 0.055), vec2(0.046 * k, 0.088));
  float main = (exp(-d / 0.0032) * 1.4 + exp(-d / 0.014) * 0.22) * (1.0 - along) * step(-0.01, q.y);
  float br = (exp(-branch / 0.0028) * 0.8 + exp(-branch / 0.01) * 0.1) * step(-0.01, q.y);
  return main + br * (1.0 - smoothstep(0.03, 0.09, q.y)) + b * 0.0;
}

// angular value noise: straight segments between random points, so the torn edge has kinks, not wobble
float lnoise(float x, float s) { float i = floor(x), f = fract(x); return mix(hash(vec2(i, s)), hash(vec2(i + 1.0, s)), f); }

vec3 gate(vec2 p) {
  float H = 0.79 * uScale;
  float W = 0.088 * uScale * uBold;
  float x0 = centre(p.y);
  float dx = p.x - x0;
  float ay = clamp(abs(p.y) / H, 0.0, 1.0);
  float side = step(0.0, dx);
  float prof = pow(max(1.0 - pow(ay, 1.75), 0.0), 1.3) * (1.0 + 0.08 * (p.y / H));
  float smoothProf = pow(max(1.0 - ay * ay, 0.0), 0.9);
  float jag = 1.0 + (0.42 * (lnoise(p.y * 8.5 / uScale, side + 3.0) - 0.5) + 0.20 * (lnoise(p.y * 23.0 / uScale, side + 11.0) - 0.5)) / uBold;
  float w = W * prof * jag;
  float d = abs(dx) - w;
  float tip = max(abs(p.y) - H, 0.0);
  float dout = length(vec2(max(d, 0.0), tip));
  float dist = length(vec2(max(abs(dx) - W * smoothProf * 0.5, 0.0), tip * 1.3));

  float inside = step(d, 0.0) * step(abs(p.y), H);
  float streak = 0.70 + 0.60 * fbm(vec2(dx * 55.0, p.y * 3.0 + 4.0));
  float hot = exp(-abs(dx) / (w * 0.40 + 1e-4));
  vec3 core = mix(C_CYAN * 1.5, C_CORE * 10.0, hot);
  vec3 c = inside * core;

  float amp = 0.25 + 0.75 * smoothProf;
  float curtain = 0.50 + 1.0 * fbm(vec2(dx * 16.0, p.y * 0.9 + 2.0));
  c += C_CYAN * exp(-dout / (0.028 * uBold)) * 1.35 * amp * streak * (1.0 - inside);
  c += C_BLUE * exp(-dout / (0.078 * sqrt(uBold))) * 0.85 * amp * mix(1.0, curtain, 0.6);
  c += C_ROYAL * exp(-dist / 0.24) * 1.15 * amp * curtain;
  // the tail of the glow turns from navy toward warden violet as it fades: a halo, never a fill
  vec3 tail = mix(C_DEEP * 1.2, C_VIOLET * 0.20, smoothstep(0.30, 0.75, dist));
  c += tail * exp(-dist / 0.34) * 0.50 * (0.5 + 0.5 * smoothProf) * mix(1.0, curtain, 0.5);
  
  float cr = 1.0 - step(1.5, uBold);
  c += C_CORE * crackGlow(p, vec2(centre(H), H - 0.012), 1.0, 1.0) * cr;
  c += C_CORE * crackGlow(vec2(-p.x, p.y), vec2(-centre(-H), -H + 0.012), -1.0, 1.0) * cr;

  return c;
}

vec3 splash(vec2 p) {
  // void with the gate still closed: one faint seam and a low glow behind it
  float py = p.y + 0.04;
  float dx = p.x - centre(py) * 0.6;
  float H = 0.30;
  float ay = clamp(abs(py) / H, 0.0, 1.0);
  float prof = pow(max(1.0 - pow(ay, 1.8), 0.0), 1.3);
  float tip = max(abs(py) - H, 0.0);
  float d = length(vec2(abs(dx), tip * 1.4));
  float curtain = 0.55 + 0.9 * fbm(vec2(dx * 14.0, py * 0.9 + 2.0));
  vec3 c = C_CORE * exp(-abs(dx) / 0.0024) * prof * 0.26;
  c += C_CYAN * exp(-d / 0.010) * 0.06 * prof;
  c += C_BLUE * exp(-d / 0.05) * 0.075 * (0.3 + 0.7 * prof) * curtain;
  c += mix(C_ROYAL, C_VIOLET * 0.5, smoothstep(0.05, 0.35, d)) * exp(-d / 0.20) * 0.07 * curtain;
  c += C_DEEP * exp(-length(p * vec2(1.4, 0.8)) / 0.7) * 0.06;
  return c;
}

void main() {
  vec3 acc = vec3(0.0);
  float n = uSS;
  for (float i = 0.0; i < 8.0; i++) {
    if (i >= n) break;
    for (float j = 0.0; j < 8.0; j++) {
      if (j >= n) break;
      vec2 frag = gl_FragCoord.xy - 0.5 + (vec2(i, j) + 0.5) / n;
      vec2 p = (frag - 0.5 * uRes) / (0.5 * min(uRes.x, uRes.y));
      vec3 g = uMode > 0.5 ? splash(p) : gate(p);
      // void, lifted navy toward the light, darker in the corners
      vec3 bg = lin(vec3(7.0, 8.0, 15.0) / 255.0);
      float vig = 1.0 - 0.55 * smoothstep(0.45, 1.40, length(p * vec2(0.9, 1.0)));
      vec3 col = bg * vig + (1.0 - exp(-g * 1.1));
      acc += col;
    }
  }
  vec3 col = acc / (n * n);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const PAGE = `<!doctype html><html><body style="margin:0;background:#000"><canvas id="c"></canvas><script>
const FRAG = ${JSON.stringify(FRAG)};
const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
window.render = (o) => {
  const c = document.getElementById('c');
  c.width = o.w; c.height = o.h;
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, o.w, o.h);
  const u = (n) => gl.getUniformLocation(pr, n);
  gl.uniform2f(u('uRes'), o.w, o.h);
  gl.uniform1f(u('uMode'), o.mode);
  gl.uniform1f(u('uScale'), o.scale);
  gl.uniform1f(u('uBold'), o.bold);
  gl.uniform1f(u('uSS'), o.ss);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return c.toDataURL('image/png');
};
</script></body></html>`;

const ICON_LOOK = {
  any: { scale: 1.0, bold: 1.0 },
  maskable: { scale: 0.86, bold: 1.0 },
  tiny: { scale: 1.05, bold: 1.9 },
};

const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage();
await page.setContent(PAGE);
const write = (rel, dataUrl) => {
  const file = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  try {
    execFileSync('magick', [file, '-strip', '-define', 'png:compression-level=9', '-define', 'png:compression-filter=5', 'PNG24:' + file]);
  } catch {}
  return fs.statSync(file).size;
};
const jobs = [];
if (flags.only !== 'splash') for (const i of ICONS) jobs.push({ file: i.file, w: i.size, h: i.size, mode: 0, ss: i.size <= 64 ? 8 : 6, ...ICON_LOOK[i.kind] });
if (flags.only !== 'icons') for (const s of splashImages()) jobs.push({ file: s.file, w: s.width, h: s.height, mode: 1, ss: 1, scale: 1, bold: 1 });
let total = 0;
for (const j of jobs) {
  const url = await page.evaluate((o) => window.render(o), j);
  const size = write(j.file, url);
  total += size;
  if (!flags.quiet) console.log(`${j.file}  ${j.w}x${j.h}  ${(size / 1024).toFixed(1)} KB`);
}
console.log(`wrote ${jobs.length} images (${(total / 1024).toFixed(0)} KB) to ${path.relative(root, outDir) || '.'}`);
await browser.close();
