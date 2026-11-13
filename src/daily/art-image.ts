import { playerName } from '../core/you';
import { renderAllyCard } from './ally-card';
import type { DrawingRec } from './artstore';
import { canvasBlob, PAGE, renderDrawing } from './ink';
import { shareOrSave } from './ui';

const prepared = new Map<string, Promise<Blob | null>>();
/** Renders the export ahead of the tap, so the share sheet opens inside the tap's user activation on iPhone. */
export function prepImage(rec: DrawingRec) {
  const k = `${rec.id}:${rec.updated}:${rec.name ?? ''}:${playerName()}`;
  let pr = prepared.get(k);
  if (!pr) {
    if (prepared.size > 6) prepared.clear();
    pr = (async () => canvasBlob(
      rec.kind === 'ally' ? await renderAllyCard(rec) : renderDrawing(rec.strokes, rec.kind, PAGE[rec.kind].w),
      'image/png',
    ))();
    prepared.set(k, pr);
  }
  return pr;
}

export async function saveImage(rec: DrawingRec) {
  const blob = await prepImage(rec);
  if (!blob) return 'failed';
  const base = rec.kind === 'ally'
    ? `shadow-ally-${(rec.name || 'ally').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ally'}`
    : `art-room-${rec.day}`;
  return shareOrSave(blob, `${base}.png`, 'image/png');
}
export const savedText = (r: string) => (r === 'saved' ? 'Image saved to your downloads.'
  : r === 'shared' ? 'Image ready. Pick Save Image to keep it in Photos.'
    : r === 'failed' ? "That image couldn't be made. Your drawing is still saved here." : '');
