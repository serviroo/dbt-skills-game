/**
 * The co-writer's only door to the network. Loaded with import() on the first Ask, never before.
 * Sends one request per Ask with the capped fields of the contract and nothing else; no analytics, no logging.
 */
import { COWRITER_KEY } from '../core/stored-names';

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
export type CowriteRes =
  | { kind: 'cards'; cards: string[]; care: boolean }
  | { kind: 'resting' }
  | { kind: 'busy' }
  | { kind: 'offline' }
  | { kind: 'down' }
  | { kind: 'toolong' };

export const CAPS = { title: 120, before: 4000, selection: 2000, after: 600, notes: 1500, steer: 240, history: 4, turn: 600 } as const;
const TIMEOUT_MS = 90000;
const MODES: CowriteMode[] = ['continue', 'whatif', 'polish', 'questions'];

const url = (p: string) => new URL(p, document.baseURI).href;
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const head = (s: string, n: number) => str(s).slice(0, n);
const tail = (s: string, n: number) => {
  const t = str(s);
  return t.length > n ? t.slice(t.length - n) : t;
};

/** Exactly the contract's body: v, mode, title, before, selection, after, notes, steer, history. */
export function body(r: CowriteReq) {
  return {
    v: 1,
    mode: MODES.includes(r.mode) ? r.mode : 'continue',
    title: head(r.title, CAPS.title),
    before: tail(r.before, CAPS.before),
    selection: head(r.selection, CAPS.selection),
    after: head(r.after, CAPS.after),
    notes: head(r.notes, CAPS.notes),
    steer: head(r.steer, CAPS.steer),
    history: (Array.isArray(r.history) ? r.history : [])
      .filter((t) => t && (t.role === 'me' || t.role === 'cowriter') && str(t.text).trim())
      .slice(-CAPS.history)
      .map((t) => ({ role: t.role, text: head(t.text, CAPS.turn) })),
  };
}

interface Cred {
  install: string;
  key: string;
}
function readCred(): Partial<Cred> {
  try {
    const v = JSON.parse(localStorage.getItem(COWRITER_KEY) ?? 'null');
    if (v && typeof v === 'object') return { install: str(v.install) || undefined, key: str(v.key) || undefined };
  } catch {
    /* unreadable: start over */
  }
  return {};
}
function writeCred(c: Cred) {
  try {
    localStorage.setItem(COWRITER_KEY, JSON.stringify(c));
  } catch {
    /* this session still has it in memory */
  }
}
let memo: Partial<Cred> | null = null;

class NetErr extends Error {}

async function post(path: string, payload: unknown, headers: Record<string, string>, signal: AbortSignal) {
  try {
    return await fetch(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new NetErr('offline');
  }
}

async function enroll(signal: AbortSignal): Promise<Cred | null> {
  const cur = memo ?? readCred();
  const install = cur.install || (crypto.randomUUID ? crypto.randomUUID() : fallbackUUID());
  const res = await post('./api/enroll', { install }, {}, signal);
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { key?: unknown } | null;
  const key = str(j?.key);
  if (!key) return null;
  memo = { install, key };
  writeCred(memo as Cred);
  return memo as Cred;
}

function fallbackUUID() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function read(res: Response): Promise<CowriteRes> {
  if (res.status === 413) return { kind: 'toolong' };
  if (res.status === 429) return { kind: 'busy' };
  if (!res.ok) return { kind: 'down' };
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j || typeof j !== 'object') return { kind: 'down' };
  if (j.resting === true) return j.reason === 'busy' ? { kind: 'busy' } : j.reason === 'down' ? { kind: 'down' } : { kind: 'resting' };
  const cards = (Array.isArray(j.cards) ? j.cards : [])
    .map((c) => (c && typeof c === 'object' ? str((c as { text?: unknown }).text).trim() : ''))
    .filter(Boolean)
    .slice(0, 4)
    .map((t) => t.slice(0, 2400));
  if (!cards.length) return { kind: 'down' };
  return { kind: 'cards', cards, care: j.care === true };
}

/** One Ask. Never throws: every outcome maps to a state the Story Room can show. */
export async function cowrite(req: CowriteReq, opts: { timeoutMs?: number } = {}): Promise<CowriteRes> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    let cred: Partial<Cred> | null = memo ?? readCred();
    if (!cred.key) cred = await enroll(ctl.signal);
    if (!cred?.key) return { kind: 'down' };
    const payload = body(req);
    let res = await post('./api/cowrite', payload, { 'X-Install-Key': cred.key }, ctl.signal);
    if (res.status === 401) {
      const again = await enroll(ctl.signal);
      if (!again) return { kind: 'down' };
      res = await post('./api/cowrite', payload, { 'X-Install-Key': again.key }, ctl.signal);
      if (res.status === 401) return { kind: 'down' };
    }
    return await read(res);
  } catch (e) {
    if (e instanceof NetErr) return { kind: 'offline' };
    return { kind: 'down' };
  } finally {
    clearTimeout(timer);
  }
}
