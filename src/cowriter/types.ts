export type CowriteMode = 'continue' | 'whatif' | 'polish' | 'questions';
export interface CowriteTurn {
  role: 'me' | 'cowriter';
  text: string;
}
export interface CowriteReq {
  mode: CowriteMode;
  title: string;
  before: string;
  selection: string;
  after: string;
  notes: string;
  steer: string;
  history: CowriteTurn[];
}
export type CowriteRes = { kind: 'cards'; cards: string[]; care: boolean } | { kind: 'toolong' };

export const CAPS = { title: 120, before: 4000, selection: 1200, after: 600, notes: 1500, steer: 240, history: 4, turn: 600 } as const;

export interface Cred {
  install: string;
  key: string;
}
