import { companionName, playerName } from '../core/you';
import { onMotion, params, releaseMotion, setMotion } from '../core/params';
import { cleared, onClear } from '../core/cleared';
import { animate } from '../ui/anim';
import { BUZZ, BUZZ_GAP, SKY, WINDOW } from '../motion/tokens';
import { DISMISSED, dismissWindows, LanternWindow, windowSounds, type WindowSpec } from '../ui/lantern-window';
import { revealRank } from '../ui/rank-reveal';
import { isHeavy, MODULE_ORDER, MODULES, type Next, type StatId } from '../content/dbt';
import { RANK_UP, RANKS, SAFE_CREDIT } from '../content/daily-lines';
import { icon } from './art';
import { Bubbles, scratchTexture } from './bubbles';
import { Sky } from './sky';
import { wait } from './clock';
import type { InkPad } from './ink';
import { dayDiff, Store, type State } from './store';
import { h, typo } from './ui';
import { volumeButton, type VolumeButton, type VolumeCtrl } from '../ui/volume';
import { wireWardrobe } from './wardrobe';
import { vesperLap } from './roster';

export type Route =
  | { name: 'hub' }
  | { name: 'skill'; id: string; entry?: string }
  | { name: 'safe'; at?: string }
  | { name: 'rest' }
  | { name: 'shadows' }
  | { name: 'library' }
  | { name: 'diary' }
  | { name: 'comfort' }
  | { name: 'settings' }
  | { name: 'art' }
  | { name: 'draw'; kind: 'today' | 'ally'; id?: string; draft?: string }
  | { name: 'piece'; id: string }
  | { name: 'stories' }
  | { name: 'write'; id: string; ch?: string; find?: { at: number } }
  | { name: 'read'; id: string; ch?: string }
  | { name: 'lines' }
  | { name: 'ease'; next?: Next }
  | { name: 'moment'; then?: string };

/** Where a screen stands inside one visit: a skill's step number, or a named spot such as 'end'. */
export type Place = number | string;

/**
 * One visit to a screen, as Back and Forward see it. `again` is true when the player comes back to a visit already
 * made (Back, Forward, the Lantern button): nothing is credited a second time. `kept` is what the screen's keep() gave
 * when the player last left this visit, held in memory only. `handed` is what the screen this visit was opened from
 * passed it (words typed there), in memory only, on that first showing alone: Back and Forward never bring it again.
 * `at` is the place to open on. The screen calls mark(place) when the player moves to a new place inside it, so Back
 * steps back through those places.
 */
export interface Visit {
  again: boolean;
  kept?: unknown;
  handed?: unknown;
  at?: Place;
  mark(place: Place): void;
}

export interface ScreenOut {
  el: HTMLElement;
  title: string;
  mode: 'hub' | 'sub' | 'skill' | 'safe';
  bubbles?: [number, number];
  tools?: HTMLElement[];
  /** a bar the screen pins over the bottom of the page, which a scroll or focus then stops above */
  foot?: HTMLElement;
  leave?: () => void;
  after?: () => void;
  /** Focus waits for this, so a heading filled in from storage is read out whole, never empty and then changed unannounced. */
  ready?: Promise<unknown>;
  /** The Safe Zone is opening: stop this screen's own sound at once (leave still follows). */
  silence?: () => void;
  /** What this visit keeps for Back and Forward (answers, typed text). Memory only: never in history or storage. */
  keep?: () => unknown;
  /** Back or Forward moved inside this visit: show that place without marking it again. */
  moveTo?: (place: Place | undefined) => void;
}
export type ScreenFn = (app: App, route: Route, visit: Visit) => ScreenOut;

/** One of the companion's entries in the browser's history: a route and a place, never anything typed. */
interface Entry {
  dq: 1;
  /** position from the companion's first entry, which is always Home */
  i: number;
  /** one visit to a screen; its places and anything open over it share the key */
  key: string;
  route: Route;
  place?: Place;
  /** a window, sheet, menu or panel open over the screen */
  sheet?: true;
}
const HOME: Entry = { dq: 1, i: 0, key: 'home', route: { name: 'hub' } };
const isEntry = (s: unknown): s is Entry => !!s && typeof s === 'object' && (s as Entry).dq === 1 && Number.isInteger((s as Entry).i) && !!(s as Entry).route;
/** Rooms a move goes back to when they are already behind the player, so moving around never grows history. */
const ROOMS = new Set<Route['name']>(['library', 'art', 'stories', 'shadows', 'settings', 'diary', 'comfort', 'lines', 'safe', 'rest']);
const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);
/** What is still to play of a vibration pattern `ms` after it began, opening with a pulse (0 ms between pulses); [] once it is over. */
const buzzLeft = (pattern: readonly number[], ms: number) => {
  let end = 0;
  for (let i = 0; i < pattern.length; i++) {
    end += pattern[i];
    if (end > ms) return [...(i % 2 ? [0] : []), end - ms, ...pattern.slice(i + 1)];
  }
  return [];
};

export interface DailyOpts {
  onReplay(): void;
  /** The player asked for help in the intro: the companion opens on the Safe Zone, with Home's entry behind it. */
  help?: boolean;
  sound?: { play(cue: string): void; setMuted?(muted: boolean): void; quiet?(on: boolean): void };
  /** Their levels (the speaker control). When present it owns mute; the old Sound switch goes away. */
  volume?: VolumeCtrl;
  /** localStorage key (the lab uses its own so it never touches real progress) */
  storageKey?: string;
  /** clock override for testing day turnover */
  now?: () => number;
  initialState?: State;
}

export class App {
  readonly root: HTMLDivElement;
  /**
   * Where screens put their sheets (a card, a chapter list, a naming sheet): next to the page, not in it, so the page's
   * own entrance animation never moves them, and under the top bar, so Back and the Safe Zone stay above them. A route
   * change empties it, after the screen's own leave.
   */
  readonly sheetLayer: HTMLElement;
  /** Where Lantern windows open: beside the page and below its top bar, so the Safe Zone button is never under one. */
  private winLayer: HTMLElement;
  readonly store: Store;
  readonly bubbles: Bubbles;
  private top: HTMLElement;
  private view: HTMLElement;
  private scrim: HTMLElement;
  private toastEl: HTMLElement;
  private sky: Sky;
  /** keeps --dq-top and --dq-foot at the pinned bars' real heights (scroll-padding in daily.css), on the host so the
   * window layer beside the page reads them too */
  private pins: ResizeObserver;
  route: Route = { name: 'hub' };
  /** The companion's history entries from Home at 0, forward ones included; `at` is the one the player is on. */
  private trail: Entry[] = [HOME];
  private at = 0;
  private visitKey = HOME.key;
  private keyN = 0;
  /** What each visit kept when the player left it, by visit key, in memory only. */
  private kept = new Map<string, unknown>();
  /** What is open over the screen, lowest first, each on its own history entry. */
  private sheets: { i: number; close(): void }[] = [];
  /** History calls wait while a history.go() is on its way; the popstate it brings is ours, not a Back press. */
  private travelling = false;
  private queue: (() => void)[] = [];
  private current: ScreenOut | null = null;
  private offs: (() => void)[] = [];
  private motionFns = new Set<() => void>();
  /** whether the page was last shown still, so each turn of motion on or off is applied once */
  private stillShown: boolean | null = null;
  /** numbers already shown on the status panel, so new gains count up once */
  shown: { xp: number; stats: Record<StatId, number> } | null = null;
  /** the drawing page while it is open */
  ink: InkPad | null = null;
  private busy = false;
  private greeting = false;
  private winChain: Promise<unknown> = Promise.resolve();
  private winGen = 0;
  private dropScrim: (() => void) | null = null;
  /** One speaker for every screen, so an open popover survives a re-render of the top bar. */
  private volBtn: VolumeButton | null = null;

  constructor(
    readonly host: HTMLElement,
    readonly opts: DailyOpts,
    readonly screens: Record<Route['name'], ScreenFn>,
  ) {
    this.store = new Store(opts.storageKey, opts.now, opts.initialState);
    this.root = h('div', { class: 'dq', 'data-mode': 'hub' }) as HTMLDivElement;
    this.root.style.setProperty('--dq-scratch', `url(${scratchTexture()})`);
    this.sky = new Sky(this.root, () => this.reduced());
    this.bubbles = new Bubbles(() => this.reduced());
    this.top = h('header', { class: 'dq-top' });
    this.view = h('main', { class: 'dq-view', id: 'dq-main' });
    this.scrim = h('div', { class: 'dq-scrim', 'aria-hidden': 'true' });
    this.toastEl = h('div', { class: 'dq-toast', role: 'status', 'aria-live': 'polite' });
    this.sheetLayer = h('div', { class: 'dq-sheets' });
    this.root.append(this.sky.back, this.bubbles.canvas, h('div', { class: 'dq-vignette', 'aria-hidden': 'true' }), this.sheetLayer, this.sky.shade, this.top, this.view, this.toastEl, this.scrim);
    this.winLayer = h('div', { class: 'sw-layer dq-sw-layer' });
    host.append(this.root, this.winLayer);
    this.pins = new ResizeObserver(() => {
      host.style.setProperty('--dq-top', `${this.top.offsetHeight}px`);
      host.style.setProperty('--dq-foot', `${this.current?.foot?.offsetHeight ?? 0}px`);
    });
    // the whole box, padding too: a bar's padding changes on its own as the screen turns, zooms or the keyboard opens
    this.pins.observe(this.top, { box: 'border-box' });
    if (opts.volume) {
      // first launch with the speaker: an earlier Sound off carries over as mute
      if (opts.volume.fresh && this.store.state.settings.sound === false) opts.volume.set({ muted: true });
      this.volBtn = volumeButton(opts.volume, { placement: 'top', align: 'right' });
    }
    // motion turning on or off while the page is open (the device's own setting with Motion on Auto, or the Motion
    // setting here or in another open copy): every scene and animation follows it
    this.offs.push(onMotion(() => this.showMotion()), releaseMotion);
    this.applyMotion();
    // names chosen in another open copy: Home is redrawn, name plates elsewhere take the new name in place
    let shown = `${playerName()}\n${companionName()}`;
    this.store.onChange(() => {
      // Motion chosen in another open copy, merged into this store, applies here too, to the scenes already moving
      this.applyMotion();
      const now = `${playerName()}\n${companionName()}`;
      if (now === shown) return;
      shown = now;
      if (this.route.name === 'hub') this.go({ name: 'hub' }, { replace: true, quiet: true });
      else this.root.querySelectorAll('[data-you-name]').forEach((n) => (n.textContent = playerName()));
    });
    this.applySound();
    this.offs.push(wireWardrobe(this));
    const vis = () => {
      if (document.visibilityState === 'visible') this.dayCheck();
    };
    document.addEventListener('visibilitychange', vis);
    this.offs.push(() => document.removeEventListener('visibilitychange', vis));
    this.offs.push(onClear({ clear: () => this.afterClear() }));
    const pop = (e: PopStateEvent) => this.popped(e.state);
    window.addEventListener('popstate', pop);
    this.offs.push(() => window.removeEventListener('popstate', pop));
    // Escape closes what is open on top, like Back; a sheet that handles its own Escape stops it first. With nothing
    // open, it leaves the Safe Zone the way Leave does. An Escape that ends composing a word (typing Japanese, say) only
    // ends that
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (this.sheets.length) {
        e.preventDefault();
        this.closeTop();
      } else if (this.route.name === 'safe') {
        e.preventDefault();
        this.go({ name: 'hub' });
      }
    };
    window.addEventListener('keydown', esc);
    this.offs.push(() => window.removeEventListener('keydown', esc));
  }

  /** This game's data is being cleared (here or in another tab): windows close and every screen but the Safe Zone shows it. */
  private afterClear() {
    // the store is back to the defaults, Motion on Auto among them: what moves follows that from here
    this.applyMotion();
    this.clearForSafe();
    if (this.route.name !== 'safe') this.go({ name: 'settings' }, { replace: true });
    // what visits kept for Back and Forward (answers, typed text) goes too: every way back now lands on Settings
    this.kept.clear();
  }

  reduced() {
    return params.reduced;
  }
  /** Hands this store's Motion setting, as it is now, to everything that moves. */
  applyMotion() {
    setMotion(this.store.state.settings.motion);
    this.showMotion();
  }
  private showMotion() {
    const still = this.reduced();
    if (still === this.stillShown) return;
    this.stillShown = still;
    this.root.classList.toggle('is-still', still);
    this.bubbles.resize();
    this.motionFns.forEach((f) => f());
  }
  /**
   * Calls fn whenever motion turns on or off: the setting changed here or in another open copy, or the device's own
   * setting changed while Motion is on Auto. Returns the function that stops it.
   */
  onMotion(fn: () => void) {
    this.motionFns.add(fn);
    return () => void this.motionFns.delete(fn);
  }

  /** The Sound setting covers the calm score too, not only the cues. */
  applySound() {
    if (this.opts.volume) return;
    try {
      this.opts.sound?.setMuted?.(!this.store.state.settings.sound);
    } catch {
      /* sound is optional */
    }
  }

  sound(cue: string) {
    if (this.route.name === 'safe') return;
    if (this.opts.volume ? this.opts.volume.get().muted : !this.store.state.settings.sound) return;
    try {
      this.opts.sound?.play(cue);
    } catch {
      /* sound is optional */
    }
  }

  /**
   * Vibration has its own switch, shown only where a buzz can really happen: a touch-first device whose browser can
   * vibrate. Desktop Chrome and Edge have navigator.vibrate too, but nothing there buzzes.
   */
  canBuzz() {
    return typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  /** the pattern last handed to the device and when (performance.now() ms), while it may still be playing */
  private buzzing: { pattern: number[]; at: number } | null = null;

  /** A skill timer's buzz when the player turned it on (Mute is about sound): never in the Safe Zone or out of sight. */
  buzz(kind: keyof typeof BUZZ) {
    if (this.route.name === 'safe' || !this.store.state.settings.vibrate || document.visibilityState !== 'visible' || !this.canBuzz()) return;
    const at = performance.now();
    // a new pattern replaces one still playing, so a buzz right after another (a skip that starts the next timer) follows it
    const left = this.buzzing ? buzzLeft(this.buzzing.pattern, at - this.buzzing.at) : [];
    const pattern = left.length ? [...left, BUZZ_GAP, ...BUZZ[kind]] : [...BUZZ[kind]];
    try {
      this.buzzing = navigator.vibrate(pattern) ? { pattern, at } : null;
    } catch {
      /* vibration is optional */
    }
  }

  /** The Safe Zone is opening (or the data is being cleared): a buzz still playing stops at once. */
  private stopBuzz() {
    const was = this.buzzing;
    this.buzzing = null;
    if (!was || !buzzLeft(was.pattern, performance.now() - was.at).length) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* vibration is optional */
    }
  }

  /** Resolves once the opening greeting (first open ever only) is done. */
  settled: Promise<void> = Promise.resolve();

  /**
   * Opening is always quiet: Home, no window, no chime. The daily gift waits in the chest on Home. Only the very
   * first open ever gets one short, silent welcome window. Rank-ups wait until the player moves around the app.
   * Opened for help, it is the Safe Zone alone: the day, its visit and any welcome open as the player leaves (see show).
   */
  start() {
    const help = !!this.opts.help;
    if (!help) {
      this.store.openDay();
      this.lastDay = this.store.today();
    }
    // Home is always the companion's first history entry. Opened again on a later one (a reload, the intro replayed),
    // it goes back to that first entry: the page opens on Home and nothing is credited again.
    const s: unknown = history.state;
    if (isEntry(s) && s.i > 0) {
      this.travelling = true;
      try {
        history.go(-s.i);
      } catch {
        this.travelling = false;
      }
    }
    this.write('replace', HOME);
    if (help) return this.show({ name: 'safe' }, { again: false, key: this.write('push', { dq: 1, i: 1, key: this.newKey(), route: { name: 'safe' } }).key });
    this.greeting = true;
    this.go({ name: 'hub' }, { replace: true });
    this.greeting = false;
    if (this.store.state.flags.welcomeOwed) this.greet();
  }

  /** The first open's welcome, on Home: one owed since Home was left (the Safe Zone, a tile) or the page closed comes now. */
  private greet() {
    this.greeting = true;
    this.settled = this.welcome().finally(() => {
      this.greeting = false;
      // dropped before it opened (the Safe Zone closed the window it waited behind) while Home has already come back
      if (this.store.state.flags.welcomeOwed && this.route.name === 'hub') this.greet();
    });
  }

  private lastDay = '';
  /** Counts the new day's visit when the day has turned since the companion last looked (or it has not looked yet,
   *  opened on the Safe Zone). True when it had. */
  private turnDay() {
    const today = this.store.today();
    const turned = this.lastDay !== today;
    if (turned) this.store.openDay();
    this.lastDay = today;
    return turned;
  }
  private dayCheck() {
    // a day that turns in the Safe Zone waits there: its visit counts as the player leaves (see show)
    if (this.route.name === 'safe') return;
    if (this.turnDay() && this.route.name === 'hub') this.go({ name: 'hub' }, { replace: true, quiet: true });
  }

  private async welcome() {
    const { FIRST_WELCOME } = await import('../content/daily-lines');
    await wait(this.reduced() ? 0.2 : 0.7);
    if (this.route.name !== 'hub' || !this.store.state.flags.welcomeOwed) return;
    // owed until its window opens: queued behind another window that the Safe Zone then drops, it comes another time
    await this.window({ kind: 'notification', title: 'Notification', html: FIRST_WELCOME.map((l) => `<p>${typo(l)}</p>`).join(''), tapToContinue: true }, true, () => {
      this.store.state.flags.welcomeOwed = false;
      this.store.save();
    });
  }

  /** The chest on Home: today's gift (after a gap, a welcome back first) in a calm window, only when the player taps it. */
  async openGift() {
    const gen = this.winGen;
    const { WELCOME_BACK } = await import('../content/daily-lines');
    if (gen !== this.winGen || this.route.name === 'safe') return;
    const st = this.store;
    const today = st.today();
    const days = st.derived().visitDays;
    const prev = days[days.indexOf(today) - 1];
    const back = !!prev && dayDiff(prev, today) >= 2;
    const gift = `<p class="dq-sw-gift">${typo(st.giftLine())}</p>`;
    const spec: WindowSpec = back
      ? { kind: 'notification', title: 'Welcome back', icon: 'reward', html: `<p>${typo(WELCOME_BACK[st.visitIndex() % WELCOME_BACK.length])}</p>${gift}`, tapToContinue: true }
      : { kind: 'notification', title: 'Daily gift', icon: 'reward', html: gift, tapToContinue: true };
    if ((await this.window(spec)) === DISMISSED) return;
    st.state.flags.giftDay = today;
    st.save();
    void this.celebrate();
  }

  /** The latest check-in today was heavy: no celebration windows for the rest of the day (they wait, never lost). */
  hushed() {
    const today = this.store.today();
    let last: { t: number; data?: unknown } | null = null;
    for (const e of this.store.state.events) if (e.k === 'checkin' && e.day === today && (!last || e.t >= last.t)) last = e;
    const d = (last?.data ?? null) as { feel?: unknown; level?: unknown } | null;
    return !!d && typeof d.feel === 'string' && isHeavy(d.feel, typeof d.level === 'number' ? d.level : null);
  }

  /** Shows a Lantern window over a dim scrim. Does not depend on the WebGL stage loop running. `opened` runs as it opens. */
  window(spec: WindowSpec, silentOpen = false, opened?: () => void): Promise<string> {
    const gen = this.winGen;
    const run = this.winChain.then(async () => {
      if (gen !== this.winGen || this.route.name === 'safe') return DISMISSED;
      opened?.();
      const answer = await this.showWindow(spec, silentOpen);
      return gen === this.winGen ? answer : DISMISSED;
    });
    this.winChain = run.catch(() => undefined);
    return run;
  }

  private async showWindow(spec: WindowSpec, silentOpen: boolean) {
    const saved = { open: windowSounds.open, close: windowSounds.close, tap: windowSounds.tap };
    windowSounds.open = silentOpen ? undefined : () => this.sound('soft_chime');
    windowSounds.close = undefined;
    windowSounds.tap = undefined;
    this.busy = true;
    const before = document.activeElement as HTMLElement | null;
    let up = true;
    const drop = () => {
      if (!up) return;
      up = false;
      this.dropScrim = null;
      this.scrim.classList.remove('is-on', 'is-closing');
      this.root.classList.remove('is-windowed');
      this.view.inert = false;
    };
    this.dropScrim = drop;
    this.scrim.classList.add('is-on');
    this.root.classList.add('is-windowed');
    this.view.inert = true;
    const w = new LanternWindow(this.winLayer, { width: 'min(92vw, 540px)', ...spec });
    w.root.classList.add('dq-sw');
    if (this.reduced()) w.root.classList.add('dq-sw--still');
    // Motion changed while it is up, here or in another copy: the window follows
    const offMotion = this.onMotion(() => {
      w.root.classList.toggle('dq-sw--still', this.reduced());
      w.setStill(this.reduced());
    });
    w.root.tabIndex = -1;
    void w.open();
    w.root.focus({ preventScroll: true });
    // Back and Escape close it the usual way, with nothing chosen
    let shut = false;
    const done = this.sheet(() => {
      shut = true;
      w.cancel();
    });
    const v = await w.waitForInput();
    done();
    offMotion();
    if (v !== DISMISSED || shut) {
      // the scrim fades with the collapse but takes every tap, and Home stays out of reach, until the window is gone:
      // a second tap or key meant for the window never lands on what is under it (unless the Safe Zone already cleared it)
      if (up) {
        this.scrim.classList.add('is-closing');
        this.scrim.classList.remove('is-on');
      }
      const settled = wait(this.reduced() ? 0.25 : 0.45);
      await w.close();
      if (up) {
        drop();
        if (before?.isConnected && !this.root.contains(document.activeElement)) before.focus({ preventScroll: true });
      }
      await settled;
      w.destroy();
    } else drop();
    Object.assign(windowSounds, saved);
    this.busy = false;
    return v;
  }

  /** Rank-up moments and the quiet Safe Zone credit, shown only on the Lantern hub. */
  async celebrate() {
    if (this.busy || this.greeting || this.route.name !== 'hub' || this.hushed()) return;
    const st = this.store.state;
    const d = this.store.derived();
    if (st.flags.safeCredit) {
      st.flags.safeCredit = false;
      this.store.touch('safeCredit');
      this.store.save();
      this.toast(SAFE_CREDIT);
    }
    if (d.rank > st.flags.rankSeen) {
      st.flags.rankSeen = d.rank;
      this.store.save();
      const R = RANKS[d.rank];
      this.sound('soft_chime');
      vesperLap(this);
      await revealRank(R, typo(RANK_UP[R]), { open: (spec) => this.window(spec) });
      if (this.route.name === 'hub') this.go({ name: 'hub' }, { replace: true, quiet: true });
    } else if (d.warden && !st.flags.wardenSeen) {
      st.flags.wardenSeen = true;
      this.store.save();
      await revealRank('M', typo(RANK_UP.M), { open: (spec) => this.window(spec) });
      if (this.route.name === 'hub') this.go({ name: 'hub' }, { replace: true, quiet: true });
    }
  }

  private toastN = 0;
  /** what happens when the toast showing now goes without its action being taken */
  private toastEnd: (() => void) | null = null;
  /**
   * A short message at the bottom, with an optional action (Undo). Its end runs once if the toast goes without the
   * action: it ran out, another toast took its place, they left for a screen it wasn't for, or the Safe Zone opened.
   */
  toast(text: string, action?: { label: string; run(): void; end?(): void }) {
    this.endToast();
    if (this.route.name === 'safe') return action?.end?.();
    const n = ++this.toastN;
    this.toastEnd = action?.end ?? null;
    this.toastEl.replaceChildren(h('span', { text: typo(text) }));
    if (action)
      this.toastEl.append(
        h('button', {
            type: 'button',
            class: 'dq-toast-btn',
            text: action.label,
            onclick: () => {
              // once the toast has gone, what it offered to undo has landed
              if (n !== this.toastN) return;
              this.toastN++;
              this.toastEnd = null;
              this.toastEl.classList.remove('is-on');
              action.run();
            },
          }),
      );
    this.toastEl.classList.add('is-on');
    const a = animate(this.toastEl, [{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: this.reduced() ? 1 : 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    void a;
    void wait(action ? 6 : 5).then(async () => {
      if (n !== this.toastN) return;
      // the action still works while the toast fades; its end lands once the toast is gone
      animate(this.toastEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in' });
      await wait(0.24);
      if (n !== this.toastN) return;
      this.toastN++;
      this.toastEl.classList.remove('is-on');
      this.endToast();
    });
  }
  /** Takes the toast away at once: a screen it wasn't for, the Safe Zone opening, or the game being cleared. */
  private dropToast() {
    this.toastN++;
    this.toastEl.classList.remove('is-on');
    this.endToast();
  }
  private endToast() {
    const end = this.toastEnd;
    this.toastEnd = null;
    end?.();
  }

  /** Whether this build has the route's screen. A history entry can come from another version of the app. */
  private known(route: Route) {
    return Object.prototype.hasOwnProperty.call(this.screens, route.name);
  }

  /**
   * A move inside the companion. `replace` swaps the visit for a new one; `replace` with `quiet` redraws it. `hand`
   * goes to the new screen in memory (see Visit.handed); the route is written to history, so nothing typed goes in it.
   */
  go(route: Route, o: { replace?: boolean; quiet?: boolean; hand?: unknown } = {}) {
    if (!this.known(route)) route = { name: 'hub' };
    // after clearing, Settings shows how it went; only the Safe Zone opens as ever
    if (cleared() && route.name !== 'safe') route = { name: 'settings' };
    this.show(route, { again: false, key: this.record(route, o), hand: o.hand }, o);
  }

  /** Mirrors a move in the browser's history and returns the key of the visit it opens. */
  private record(route: Route, o: { replace?: boolean; quiet?: boolean }) {
    if (!this.current) return this.visitKey;
    if (route.name === 'hub') {
      if (this.route.name !== 'hub') {
        this.closeSheets();
        this.travel(0);
      }
      return HOME.key;
    }
    if (o.replace && o.quiet && route.name === this.route.name) return this.visitKey;
    // what is open over the screen goes first, so the next screen takes its entry instead of stacking past it
    if (this.sheets.length) {
      const under = this.sheets[0].i - 1;
      this.closeSheets();
      this.travel(under);
    }
    const first = this.firstOfVisit();
    if (ROOMS.has(route.name)) {
      if (route.name === this.route.name && !o.replace) return same(route, this.route) ? this.visitKey : this.write('replace', { dq: 1, i: this.at, key: this.newKey(), route }).key;
      // the Safe Zone is never gone back to: it always comes right after the screen it was opened from, so one Back returns there
      for (let j = route.name === 'safe' ? 0 : first - 1; j > 0; j--) {
        const e = this.trail[j];
        if (!e || e.sheet || e.route.name !== route.name) continue;
        const to = same(route, e.route) ? e : { ...e, key: this.newKey(), route, place: undefined };
        // the visit it replaces leaves history too, so Forward can't open it again (a removed drawing, a finished skill)
        if (o.replace) {
          this.travel(j - 1);
          return this.write('push', to).key;
        }
        this.travel(j);
        return to === e ? e.key : this.write('replace', to).key;
      }
    }
    // a new visit in place of this one (Practise again, a skill that leads to another) drops this visit's places too
    if (o.replace && first > 0) this.travel(first - 1);
    return this.write('push', { dq: 1, i: this.at + 1, key: this.newKey(), route }).key;
  }

  private newKey() {
    return `v${Date.now().toString(36)}${++this.keyN}`;
  }

  /** Where the visit the player is on began: its places and anything open over it come after. */
  private firstOfVisit() {
    let f = this.at;
    while (f > 0 && this.trail[f - 1]?.key === this.visitKey) f--;
    return f;
  }

  private write(how: 'push' | 'replace', e: Entry) {
    if (how === 'push') {
      this.trail.splice(e.i, Infinity, e);
      const live = new Set(this.trail.map((t) => t.key));
      for (const k of this.kept.keys()) if (!live.has(k) && k !== this.visitKey) this.kept.delete(k);
    } else this.trail[e.i] = e;
    this.at = e.i;
    this.later(() => {
      try {
        if (how === 'push') history.pushState(e, '');
        else history.replaceState(e, '');
      } catch {
        /* Safari limits how often history changes: the screen is right, Back just has one stop fewer */
      }
    });
    return e;
  }

  /**
   * Moves through history to an entry already there, with no screen change of its own. Never before Home, the
   * companion's first entry: nothing before it is ours, and a step past the start of history never brings a popstate.
   */
  private travel(to: number) {
    to = Math.max(0, to);
    const by = to - this.at;
    this.at = to;
    if (!by) return;
    this.later(() => {
      this.travelling = true;
      try {
        history.go(by);
      } catch {
        this.travelling = false;
      }
    });
  }

  private later(call: () => void) {
    if (this.travelling) this.queue.push(call);
    else call();
  }

  private popped(state: unknown) {
    if (this.travelling) {
      this.travelling = false;
      while (!this.travelling && this.queue.length) this.queue.shift()!();
      return;
    }
    if (isEntry(state)) this.arrive(state);
  }

  /** The player pressed Back or Forward (or the phone's back gesture) and history now stands on `s`. */
  private arrive(s: Entry) {
    const from = this.at;
    this.trail[s.i] = s;
    this.at = s.i;
    this.closeSheets(s.i);
    if (s.sheet && !this.sheets.some((x) => x.i === s.i)) {
      // a sheet closed some other way left its entry: step over it the way the player was going
      if (s.i > from) return this.travel(from);
      let to = s.i - 1;
      while (to > 0 && this.trail[to]?.sheet) to--;
      this.travel(Math.max(0, to));
      return this.land(this.trail[this.at] ?? HOME);
    }
    if (!s.sheet) this.land(s);
  }

  private land(e: Entry) {
    if (e.key === this.visitKey) return this.current?.moveTo?.(e.place);
    if (!this.known(e.route)) {
      // Home is drawn from Home's own entry, so the next Back does what Back does on Home
      this.travel(0);
      return this.go({ name: 'hub' });
    }
    this.show(e.route, { again: true, key: e.key, at: e.place });
  }

  /** Marks a new place inside the visit on screen; a place already in this visit is gone back to, so loops don't stack. */
  private mark(key: string, place: Place) {
    const cur = this.trail[this.at];
    if (key !== this.visitKey || this.sheets.length || !cur || cur.sheet || cur.key !== key || cur.place === place) return;
    if (cur.place === undefined) return void this.write('replace', { ...cur, place });
    for (let j = this.at - 1; j > 0 && this.trail[j]?.key === key; j--) if (this.trail[j].place === place) return this.travel(j);
    this.write('push', { ...cur, i: this.at + 1, place });
  }

  /**
   * Something opens over the screen (a window, a sheet, a menu, a panel): Back and Escape close it before anything
   * else, calling `close`. Call the returned done() when it closes any other way.
   */
  sheet(close: () => void): () => void {
    const cur = this.trail[this.at] ?? HOME;
    const s = { i: this.at + 1, close };
    this.sheets.push(s);
    this.write('push', { dq: 1, i: s.i, key: this.visitKey, route: cur.route, place: cur.place, sheet: true });
    return () => {
      const k = this.sheets.indexOf(s);
      if (k < 0) return;
      this.sheets.splice(k, 1);
      if (this.at === s.i) this.travel(s.i - 1);
    };
  }

  private closeSheets(above = -1) {
    while (this.sheets.length && this.sheets[this.sheets.length - 1].i > above) this.sheets.pop()!.close();
  }

  private closeTop() {
    const s = this.sheets.pop();
    if (!s) return;
    s.close();
    if (this.at === s.i) this.travel(s.i - 1);
  }

  /** Draws a screen. Every way in (a tap, Back, Forward, the Lantern button) comes through here. */
  private show(route: Route, v: { again: boolean; key: string; at?: Place; hand?: unknown }, o: { quiet?: boolean } = {}) {
    // Back, Forward and the Lantern button after clearing land on Settings too; only the Safe Zone opens as ever
    if (cleared() && route.name !== 'safe') route = { name: 'settings' };
    const safe = route.name === 'safe';
    const wasSafe = this.route.name === 'safe';
    const fromSkill = this.route.name === 'skill';
    if (safe) this.clearForSafe();
    if (this.current?.keep) this.kept.set(this.visitKey, this.current.keep());
    this.current?.leave?.();
    this.sheetLayer.replaceChildren();
    if (this.current?.foot) this.pins.unobserve(this.current.foot);
    // a toast goes with the screen it was for (Home keeps one from the screen before); leaving ends its Undo
    if (route.name !== 'hub') this.dropToast();
    this.route = route;
    const key = v.key;
    this.visitKey = key;
    if (safe !== wasSafe) this.quietScore(safe);
    if (wasSafe && !safe) this.turnDay();
    const out = this.screens[route.name](this, route, { again: v.again, kept: v.again ? this.kept.get(key) : undefined, handed: v.again ? undefined : v.hand, at: v.at, mark: (p) => this.mark(key, p) });
    this.current = out;
    this.host.style.setProperty('--dq-foot', '0px');
    if (out.foot) this.pins.observe(out.foot, { box: 'border-box' });
    this.root.dataset.mode = out.mode;
    this.root.dataset.screen = route.name;
    // only Home's sky follows the clock; the Safe Zone gets the night sky back at once
    this.sky.set(route.name === 'hub', safe ? 0 : SKY.fadeMs);
    this.renderTop(out);
    this.view.replaceChildren(out.el);
    this.root.scrollTop = 0;
    const [dens, bright] = out.bubbles ?? [3, 0.8];
    if (dens !== this.bubbles.density || bright !== this.bubbles.brightness) this.bubbles.set(dens, bright);
    if (!o.quiet) {
      const a = animate(out.el, this.reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
        duration: this.reduced() ? WINDOW.reducedFadeMs : 300,
        easing: 'cubic-bezier(.16,1,.3,1)',
      });
      // drop the entrance transform so fixed elements inside the page (the story co-writer) sit on the screen
      a.finished.then(() => a.cancel(), () => {});
    }
    const focus = out.el.querySelector<HTMLElement>('[data-focus]') ?? out.el.querySelector<HTMLElement>('h1');
    if (focus && !o.quiet) {
      focus.setAttribute('tabindex', '-1');
      // still this screen, and nothing else was focused while it waited
      const put = () => this.current === out && (!document.activeElement || document.activeElement === document.body) && focus.focus({ preventScroll: true });
      if (out.ready) void out.ready.then(put, put);
      else focus.focus({ preventScroll: true });
    }
    out.after?.();
    if (route.name === 'hub' && !o.quiet && !fromSkill) {
      // a first welcome still owed comes before anything to celebrate
      if (!this.store.state.flags.welcomeOwed) void this.celebrate();
      else if (!this.greeting) this.greet();
    }
  }

  private clearForSafe() {
    this.winGen++;
    dismissWindows();
    this.dropToast();
    this.dropScrim?.();
    document.querySelectorAll('[data-fx]').forEach((n) => n.remove());
    this.stopBuzz();
    this.current?.silence?.();
  }

  private quietScore(on: boolean) {
    try {
      this.opts.sound?.quiet?.(on);
    } catch {
      /* sound is optional */
    }
  }

  /** The Lantern button, a moment's Done, a removed story: back to where the player was before this visit. */
  back() {
    let to = this.firstOfVisit() - 1;
    while (to > 0 && this.trail[to]?.sheet) to--;
    const e = this.trail[to];
    if (to <= 0 || !e || !this.known(e.route)) return this.go({ name: 'hub' });
    this.closeSheets();
    this.travel(to);
    this.show(e.route, { again: true, key: e.key, at: e.place });
  }

  private renderTop(out: ScreenOut) {
    const safeBtn = h(
      'button',
      { type: 'button', class: 'dq-safe', onclick: () => this.go({ name: 'safe' }), 'aria-label': 'Safe Zone, help right now' },
      h('span', { class: 'dq-safe-ic', html: icon('safe') }),
      h('span', { class: 'dq-safe-t', text: 'Safe Zone' }),
    );
    let left: HTMLElement;
    if (out.mode === 'hub') left = h('div', { class: 'dq-brand' }, h('span', { class: 'dq-brand-mark', 'aria-hidden': 'true' }), h('span', { text: 'The Lantern' }));
    else if (out.mode === 'skill') left = h('button', { type: 'button', class: 'dq-icbtn', 'aria-label': 'Leave this skill', onclick: () => this.go({ name: 'hub' }), html: icon('close') });
    else if (out.mode === 'safe')
      left = h('button', { type: 'button', class: 'dq-back', onclick: () => this.go({ name: 'hub' }) }, h('span', { html: icon('close') }), h('span', { text: 'Leave' }));
    // named for a screen reader in its own right: on a phone at 200% only its arrow shows
    else left = h('button', { type: 'button', class: 'dq-back', 'aria-label': 'Lantern', onclick: () => this.back() }, h('span', { html: icon('back') }), h('span', { text: 'Lantern' }));
    const mid = h('span', { class: 'dq-sr', text: typo(out.title) });
    const tools = out.tools ?? [];
    let right: HTMLElement = out.mode === 'safe' ? (tools.length ? h('div', { class: 'dq-top-end' }, tools) : h('span', { class: 'dq-top-spacer' })) : safeBtn;
    if (this.volBtn) {
      this.volBtn.close();
      right = out.mode === 'safe' ? h('div', { class: 'dq-top-end' }, tools, this.volBtn) : h('div', { class: 'dq-top-end' }, tools, this.volBtn, safeBtn);
    }
    this.top.replaceChildren(left, mid, right);
  }

  /** Numbers for the status panel: what to start from (last shown) and where to land. */
  statFrom() {
    const d = this.store.derived();
    const from = this.shown ?? { xp: d.xp, stats: { ...d.stats } };
    this.shown = { xp: d.xp, stats: { ...d.stats } };
    return { from, to: { xp: d.xp, stats: d.stats }, order: MODULE_ORDER.map((m) => MODULES[m].stat) };
  }

  destroy() {
    this.current?.leave?.();
    this.sky.set(false, 0);
    this.pins.disconnect();
    this.volBtn?.dispose();
    this.store.dispose();
    this.offs.forEach((f) => f());
    this.bubbles.destroy();
    this.root.remove();
    this.winLayer.remove();
    for (const v of ['--dq-top', '--dq-foot']) this.host.style.removeProperty(v);
  }
}
