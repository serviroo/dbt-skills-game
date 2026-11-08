import type { Route, Visit } from './app';
import type { ArtStore, Draft } from './artstore';
import type { Paper } from './ink';

/** A draft untouched this long was left by an earlier session (iOS can hand a relaunched app a new tab id). */
const ORPHAN_MS = 120e3;

export interface DrawKept {
  readonly id: string | null;
  readonly key: string | undefined;
}

export class DrawVisit {
  readonly editId: string | undefined;
  readonly from: string | undefined;
  private held = false;

  constructor(route: Extract<Route, { name: 'draw' }>, visit: Visit) {
    const was = visit.again ? (visit.kept as DrawKept | undefined) : undefined;
    this.editId = was?.id ?? route.id;
    this.from = was ? was.key : route.draft;
  }

  async draft(as: ArtStore, kind: Paper, tab: string, own: string): Promise<Draft | null> {
    const draft = (this.from ? await as.getDraft(this.from) : null) ?? (await as.getDraft(own));
    if (draft || this.from) return draft;
    const id = this.editId;
    // this tab's other draft of the same page (a page first saved from a fresh screen), else one an earlier session
    // left; a younger draft may belong to a tab that is still open, so it only waits in the Art room
    const same = (await as.drafts()).filter((d) => (id ? d.editId === id : d.kind === kind && !d.editId));
    const mine = same.find((d) => d.key.endsWith(`:${tab}`));
    return mine ?? same.find((d) => !(Date.now() - d.t < ORPHAN_MS)) ?? null;
  }

  hold() {
    this.held = true;
  }

  keep(id: () => string | null, key: () => string): DrawKept {
    const v = this;
    return {
      get id() {
        return v.held ? id() : (v.editId ?? null);
      },
      get key() {
        return v.held ? key() : v.from;
      },
    };
  }
}
