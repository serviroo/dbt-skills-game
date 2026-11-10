import { playerName } from '../core/you';
import type { DrawingRec } from './artstore';
import { PAGE, renderDrawing } from './ink';

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load('600 90px "Bodoni Moda"'), document.fonts.load('500 30px "Jost"')]);
  } catch {
    /* system fallback fonts still draw */
  }
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number) {
  let cx = x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + track;
  }
}

/** The ally card as an image: the drawing, the card frame, its name. */
export async function renderAllyCard(rec: DrawingRec) {
  await fontsReady();
  const W = PAGE.ally.w, H = PAGE.ally.h;
  const c = renderDrawing(rec.strokes, 'ally', W);
  const g = c.getContext('2d')!;
  const shade = g.createLinearGradient(0, H * 0.62, 0, H);
  shade.addColorStop(0, 'rgba(4,8,16,0)');
  shade.addColorStop(0.55, 'rgba(4,8,16,0.72)');
  shade.addColorStop(1, 'rgba(4,8,16,0.92)');
  g.fillStyle = shade;
  g.fillRect(0, H * 0.62, W, H * 0.38);
  g.strokeStyle = 'rgba(143,180,225,0.62)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  g.strokeStyle = 'rgba(125,160,205,0.3)';
  g.lineWidth = 2;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.strokeStyle = 'rgba(190,228,255,0.75)';
  g.lineWidth = 4;
  const L = 44, m = 36;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
    g.beginPath();
    g.moveTo(x, y + dy * L);
    g.lineTo(x, y);
    g.lineTo(x + dx * L, y);
    g.stroke();
  }
  const top = g.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
  top.addColorStop(0, 'rgba(164,248,255,0)');
  top.addColorStop(0.5, 'rgba(164,248,255,0.9)');
  top.addColorStop(1, 'rgba(164,248,255,0)');
  g.fillStyle = top;
  g.fillRect(W * 0.2, 0, W * 0.6, 4);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#89cf9d';
  g.font = '500 30px "Jost", system-ui, sans-serif';
  spaced(g, 'SHADOW ALLY', 76, 104, 7);
  const name = rec.name?.trim() || 'Shadow ally';
  let size = 104;
  g.font = `600 ${size}px "Bodoni Moda", Didot, serif`;
  while (g.measureText(name).width > W - 152 && size > 48) {
    size -= 4;
    g.font = `600 ${size}px "Bodoni Moda", Didot, serif`;
  }
  g.fillStyle = '#eaf6ff';
  g.shadowColor = 'rgba(79,184,255,0.45)';
  g.shadowBlur = 18;
  g.fillText(name, 76, H - 150);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(79,184,255,0.45)';
  g.fillRect(76, H - 118, W - 152, 2);
  g.fillStyle = '#7cc8ff';
  g.font = '500 28px "Jost", system-ui, sans-serif';
  spaced(g, `DRAWN BY ${playerName().toUpperCase()}`, 76, H - 72, 6);
  return c;
}
