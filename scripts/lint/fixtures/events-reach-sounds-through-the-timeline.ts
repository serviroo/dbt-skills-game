import { pendingEvents } from '../../../src/audio/pending-events';

type Handle = { stop(at: number): void };

export class OldEngine {
  private named = new Map<string, Handle>();

  stopByName(id: string, at: number) {
    this.named.get(id)?.stop(at);
  }

  plan(events: unknown[]) {
    return pendingEvents(events, 0);
  }
}
