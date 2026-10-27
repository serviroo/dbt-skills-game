import './styles/tokens.css';
import './styles/base.css';
import { Stage } from './core/stage';
import { params } from './core/params';
import { bindClock, tickUI, useRealClock } from './ui/anim';

const labs: Record<string, () => Promise<{ lab?: (s: Stage) => unknown; characterLab?: (s: Stage) => unknown; windowLab?: (s: Stage) => unknown }>> = {
  character: () => import('./labs/character'),
  window: () => import('./labs/window'),
  gate: () => import('./labs/gate'),
  awaken: () => import('./labs/awaken'),
  chest: () => import('./labs/chest'),
  audio: () => import('./labs/audio'),
  daily: () => import('./labs/daily'),
};

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  let stage: Stage | null = null;
  try {
    stage = new Stage(canvas);
  } catch (err) {
    console.warn('[boot] WebGL unavailable, running without the 3D stage', err);
    canvas.style.display = 'none';
  }
  const lab = stage && params.lab ? labs[params.lab] : undefined;
  if (stage) (window as any).__stage = stage;
  // labs and captures follow the stage clock from the first frame; the app keeps the stage stopped and UI timing on the
  // page clock until the cinematic starts (src/app.ts), so the DOM-only title and name prompt draw no 3D frames
  if (stage && (lab || params.capture)) {
    const s = stage;
    bindClock(() => s.time);
    s.onUpdate(() => tickUI());
  } else useRealClock();
  const fonts = ['16px Jost', 'italic 16px Jost', '700 16px "Bodoni Moda"'].map((f) => document.fonts.load(f));
  await Promise.race([Promise.allSettled([...fonts, document.fonts.ready]), new Promise((r) => setTimeout(r, 2500))]);
  if (stage && lab) {
    const m = await lab();
    await (m.lab ?? m.characterLab ?? m.windowLab)?.(stage);
    stage.start();
    document.documentElement.dataset.ready = '1';
  } else {
    const { runApp } = await import('./app');
    document.documentElement.dataset.ready = '1';
    await runApp(stage);
  }
}

boot();
