import type { Route, Visit } from './app';
import type { ArtStore, Draft } from './artstore';
import type { Paper } from './ink';

/** A draft untouched this long was left by an earlier session (iOS can hand a relaunched app a new tab id). */
const ORPHAN_MS = 120e3;

export interface DrawKept {
  readonly id: string | null;
  readonly key: string | undefined;
  readonly pending: Promise<unknown> | null;
}

export class DrawVisit {
  private readonly was: DrawKept | undefined;
  private held = false;
  occupied = false;

  get editId() {
    return this.was?.id ?? this.route.id;
  }
  get from() {
    return this.was ? this.was.key : this.route.draft;
  }
  get pending() {
    return this.was?.pending;
  }

  constructor(private readonly route: Extract<Route, { name: 'draw' }>, visit: Visit) {
    this.was = visit.again ? (visit.kept as DrawKept | undefined) : undefined;
  }

  async draft(as: ArtStore, kind: Paper, tab: string, own: string): Promise<Draft | null | undefined> {
    const kept = this.from ? await as.getDraft(this.from) : null;
    if (kept === undefined) return undefined;
    const ours = kept && (!this.editId || this.same(kept)) ? kept : null;
    const candidate = !ours || !ours.key.endsWith(`:${tab}`) ? await as.getDraft(own) : null;
    if (candidate === undefined) return undefined;
    this.occupied = !!candidate && (!!ours || !this.same(candidate));
    const draft = ours ?? (this.occupied ? null : candidate);
    if (draft || this.from) return draft;
    const id = this.editId;
    // this tab's other draft of the same page (a page first saved from a fresh screen), else one an earlier session
    // left; a younger draft may belong to a tab that is still open, so it only waits in the Art room
    const same = (await as.drafts()).filter((d) => (id ? d.editId === id : d.kind === kind && !d.editId));
    const mine = same.find((d) => d.key.endsWith(`:${tab}`));
    return mine ?? same.find((d) => !(Date.now() - d.t < ORPHAN_MS)) ?? null;
  }

  private same(d: Draft) {
    return d.editId === this.editId || (!d.editId && d.key.startsWith(`edit:${this.editId}:`));
  }

  hold() {
    this.held = true;
  }

  keep(id: () => string | null, key: () => string, pending: () => Promise<unknown> | null): DrawKept {
    const v = this;
    return {
      get pending() {
        return pending();
      },
      get id() {
        return v.held ? id() : (v.editId ?? null);
      },
      get key() {
        return v.held ? key() : v.from;
      },
    };
  }
}
