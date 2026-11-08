import type { Visit } from './app';
import type { Story } from './storystore';

export interface WriteKept {
  readonly ch: string;
  readonly notes: boolean;
}

interface WriteAt {
  readonly opened: boolean;
  readonly tab: 'page' | 'notes';
  readonly open: { readonly id: string; readonly kind: string } | null;
  readonly pageId: string;
}

const keptOf = (visit: Visit) => (visit.again ? (visit.kept as WriteKept | undefined) : undefined);

export function pageOf(visit: Visit, ch: string | undefined, s: Story) {
  const want = keptOf(visit)?.ch || ch;
  return want && s.chapters.includes(want) ? want : (s.chapters[0] ?? '');
}

export function notesOf(visit: Visit, ch: string | undefined, s: Story) {
  const went = keptOf(visit);
  return went ? went.notes : !!ch && ch === s.notes;
}

export function writeKept(visit: Visit, at: () => WriteAt): WriteKept | undefined {
  if (!at().opened) return keptOf(visit);
  return {
    get ch() {
      const a = at();
      return a.tab === 'notes' && a.open?.kind === 'page' ? a.open.id : a.pageId;
    },
    get notes() {
      const a = at();
      return a.tab === 'notes' && a.open?.kind !== 'page';
    },
  };
}
