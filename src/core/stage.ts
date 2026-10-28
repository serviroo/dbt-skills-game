import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { params } from './params';

const gradeFrag = /* glsl */ `
uniform vec3 lift;
uniform vec3 gain;
uniform float gammaV;
uniform float saturation;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform vec3 flashColor;
uniform float flashAmount;
uniform float fade;
uniform vec3 fadeColor;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c += shadowTint * (1.0 - smoothstep(0.0, 0.25, l)) * 0.6;
  c += highlightTint * smoothstep(0.55, 1.0, l) * 0.5;
  c = c * gain + lift * (1.0 - c);
  c = pow(max(c, 0.0), vec3(1.0 / gammaV));
  c = mix(c, flashColor, clamp(flashAmount, 0.0, 1.0));
  c = mix(c, fadeColor, clamp(fade, 0.0, 1.0));
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(new THREE.Color(0.0012, 0.0015, 0.0036))],
        ['gain', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['gammaV', new THREE.Uniform(1.0)],
        ['saturation', new THREE.Uniform(1.0)],
        ['shadowTint', new THREE.Uniform(new THREE.Color(0.0018, 0.0018, 0.006))],
        ['highlightTint', new THREE.Uniform(new THREE.Color(0.0, 0.01, 0.03))],
        ['flashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['flashAmount', new THREE.Uniform(0)],
        ['fade', new THREE.Uniform(0)],
        ['fadeColor', new THREE.Uniform(new THREE.Color(0x07080f))],
      ]),
    });
  }
  u(name: string) {
    return this.uniforms.get(name)!;
  }
}

export type UpdateFn = (t: number, dt: number) => void;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  readonly bloom: BloomEffect;
  readonly grade: GradeEffect;
  readonly vignette: VignetteEffect;
  readonly noise: NoiseEffect;
  readonly toneMapping: ToneMappingEffect;
  private renderPass: RenderPass;
  private updates: UpdateFn[] = [];
  private raf = 0;
  private last = 0;
  time = 0;
  timeScale = 1;
  paused = false;
  dpr: number;
  readonly maxDpr: number;
  minDpr: number;
  private frameEMA = 1 / 60;
  private goodFor = 0;
  private badFor = 0;
  private statsEl: HTMLDivElement | null = null;
  readonly capture: boolean;
  width = 1;
  height = 1;
  /** recent frame durations (s), for perf evidence */
  readonly frameLog: number[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.capture = params.capture;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.capture,
    });
    renderer.setClearColor(0x07080f, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    this.renderer = renderer;

    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    this.maxDpr = params.dpr ?? Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 2);
    this.minDpr = Math.min(this.maxDpr, isMobile ? 1.0 : 0.85);
    this.dpr = this.maxDpr;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
    this.scene.background = new THREE.Color(0x07080f);

    const halfFloat = renderer.capabilities.isWebGL2 && !!renderer.extensions.has('EXT_color_buffer_half_float') || !!renderer.extensions.has('EXT_color_buffer_float');
    this.composer = new EffectComposer(renderer, {
      frameBufferType: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      multisampling: params.msaa ?? (isMobile ? 4 : 4),
    });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.18,
      intensity: 1.15,
      radius: 0.72,
      levels: isMobile ? 6 : 8,
    });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.72 });
    this.noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    this.noise.blendMode.opacity.value = 0.14;
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.toneMapping, this.grade, this.vignette, this.noise));

    if (params.debug) {
      this.statsEl = document.createElement('div');
      this.statsEl.style.cssText =
        'position:fixed;left:6px;bottom:6px;z-index:999;font:11px/1.3 monospace;color:#9fe;background:#0008;padding:4px 6px;pointer-events:none;white-space:pre';
      document.body.appendChild(this.statsEl);
    }

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setCamera(cam: THREE.PerspectiveCamera) {
    this.camera = cam;
    this.renderPass.mainCamera = cam;
    this.composer.setMainCamera(cam);
    this.resize();
  }

  onUpdate(fn: UpdateFn) {
    this.updates.push(fn);
    return () => {
      this.updates = this.updates.filter((f) => f !== fn);
    };
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** real-time loads a capture is waiting on (see loading) */
  private loads = 0;

  /**
   * Waits for a real-time load (a module, a model). A capture holds its clock until the load lands, so the scene starts
   * at the same stage time however long the load took or how many frames were stepped meanwhile, and every effect that
   * follows the stage clock draws the same in a given frame every run.
   */
  async loading<T>(p: Promise<T>): Promise<T> {
    if (!this.capture) return p;
    this.loads++;
    try {
      return await p;
    } finally {
      this.loads--;
    }
  }

  /** Advance the world by dt seconds and render one frame. */
  step(dt: number) {
    if (this.loads) dt = 0;
    if (!this.paused) this.time += dt * this.timeScale;
    for (const f of this.updates) f(this.time, dt * this.timeScale);
    if (params.nopost) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  start() {
    if (this.capture) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const frame = (now - this.last) / 1000;
      this.last = now;
      // quality follows the real frame time; the world never moves more than 0.1 s in one frame
      this.adapt(frame);
      this.step(Math.min(frame, 0.1));
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /** 0 full quality, 1 MSAA off, 2 lower resolution floor; only ever steps down. */
  private tier = 0;
  /** real durations of the slow frames since the last quality change */
  private slow: number[] = [];

  private adapt(frame: number) {
    this.frameLog.push(frame);
    if (this.frameLog.length > 20000) this.frameLog.splice(0, 10000);
    // a lone stall (a shader compile, a hidden tab) counts for at most a quarter second, so it never decides alone
    const dt = Math.min(frame, 0.25);
    this.frameEMA = this.frameEMA * 0.92 + dt * 0.08;
    if (params.dpr) return;
    if (this.frameEMA > 1 / 52) {
      this.badFor += dt;
      this.goodFor = 0;
      if (this.dpr > this.minDpr || this.tier < 2) this.slow.push(frame);
    } else if (this.frameEMA < 1 / 58.5) {
      this.goodFor += dt;
      this.badFor = 0;
      this.slow = [];
    } else {
      this.goodFor = 0;
      this.badFor = 0;
      this.slow = [];
    }
    const s = this.badFor > 0.6 && this.slow.length ? [...this.slow].sort((a, b) => a - b) : [];
    const typical = s[s.length >> 1];
    if (typical <= 1 / 52) {
      // a few long stalls lifted the average but the typical frame keeps up: a smaller size wouldn't shorten them
      this.badFor = 0;
      this.slow = [];
    } else if (this.badFor > 0.6 && this.dpr > this.minDpr) {
      // pixels cost about dpr squared: go straight to the resolution the typical slow frame fits, at least one step,
      // so a slow device settles in a few frames instead of drawing dozens at a size it can't keep up with
      const fit = this.dpr * Math.sqrt(1 / 55 / typical);
      this.dpr = Math.max(this.minDpr, Math.min(this.dpr - 0.15, fit));
      this.changed();
      this.resize();
    } else if (this.badFor > 1.2 && this.dpr <= this.minDpr && this.tier < 2) {
      this.tier++;
      if (this.tier === 1) this.composer.multisampling = 0;
      else this.minDpr = Math.max(0.75, this.minDpr - 0.25);
      this.changed();
    } else if (this.goodFor > 4 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.1);
      this.changed();
      this.resize();
    }
    if (this.statsEl) {
      const info = this.renderer.info.render;
      this.statsEl.textContent = `${(1 / this.frameEMA).toFixed(0)} fps  dpr ${this.dpr.toFixed(2)}  tier ${this.tier}\n${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris  t ${this.time.toFixed(2)}`;
    }
  }

  /** After a quality change the old frame times say nothing about the new cost: measure afresh from the budget. */
  private changed() {
    this.frameEMA = 1 / 55;
    this.badFor = 0;
    this.goodFor = 0;
    this.slow = [];
  }
}
