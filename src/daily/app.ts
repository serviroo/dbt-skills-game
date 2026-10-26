import { companionName, playerName } from '../core/you';
import { params } from '../core/params';
import { cleared, onClear } from '../core/cleared';
import { animate } from '../ui/anim';
import { WINDOW } from '../motion/tokens';
import { DISMISSED, dismissWindows, LanternWindow, lanternLayer, windowSounds, type WindowSpec } from '../ui/lantern-window';
import { revealRank } from '../ui/rank-reveal';
import { isHeavy, MODULE_ORDER, MODULES, type Next, type StatId } from '../content/dbt';
import { RANK_UP, RANKS, SAFE_CREDIT } from '../content/daily-lines';
import { icon } from './art';
import { Bubbles, scratchTexture } from './bubbles';
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
  | { name: 'write'; id: string; ch?: string }
  | { name: 'read'; id: string; ch?: string }
  | { name: 'lines' }
  | { name: 'ease'; next?: Next }
  | { name: 'moment'; then?: string };

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
}
export type ScreenFn = (app: App, route: Route) => ScreenOut;

export interface DailyOpts {
  onReplay(): void;
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
  readonly store: Store;
  readonly bubbles: Bubbles;
  private top: HTMLElement;
  private view: HTMLElement;
  private scrim: HTMLElement;
  private toastEl: HTMLElement;
  /** keeps --dq-top and --dq-foot at the pinned bars' real heights (scroll-padding in daily.css) */
  private pins: ResizeObserver;
  route: Route = { name: 'hub' };
  private stack: Route[] = [];
  private current: ScreenOut | null = null;
  private offs: (() => void)[] = [];
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
    this.bubbles = new Bubbles(() => this.reduced());
    this.top = h('header', { class: 'dq-top' });
    this.view = h('main', { class: 'dq-view', id: 'dq-main' });
    this.scrim = h('div', { class: 'dq-scrim', 'aria-hidden': 'true' });
    this.toastEl = h('div', { class: 'dq-toast', role: 'status', 'aria-live': 'polite' });
    this.root.append(this.bubbles.canvas, h('div', { class: 'dq-vignette', 'aria-hidden': 'true' }), this.top, this.view, this.toastEl, this.scrim);
    host.append(this.root);
    this.pins = new ResizeObserver(() => {
      this.root.style.setProperty('--dq-top', `${this.top.offsetHeight}px`);
      this.root.style.setProperty('--dq-foot', `${this.current?.foot?.offsetHeight ?? 0}px`);
    });
    this.pins.observe(this.top);
    if (opts.volume) {
      // first launch with the speaker: an earlier Sound off carries over as mute
      if (opts.volume.fresh && this.store.state.settings.sound === false) opts.volume.set({ muted: true });
      this.volBtn = volumeButton(opts.volume, { placement: 'top', align: 'right' });
    }
    this.applyMotion();
    // names chosen in another open copy: Home is redrawn, name plates elsewhere take the new name in place
    let shown = `${playerName()}\n${companionName()}`;
    this.store.onChange(() => {
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
  }

  /** This game's data is being cleared (here or in another tab): windows close and every screen but the Safe Zone shows it. */
  private afterClear() {
    this.clearForSafe();
    this.toastEl.classList.remove('is-on');
    if (this.route.name !== 'safe') this.go({ name: 'settings' }, { replace: true });
  }

  reduced() {
    const m = this.store.state.settings.motion;
    return m === 'reduce' || (m === 'system' && params.reduced);
  }
  applyMotion() {
    this.root.classList.toggle('is-still', this.reduced());
    this.bubbles.resize();
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

  /** Resolves once the opening greeting (first open ever only) is done. */
  settled: Promise<void> = Promise.resolve();

  /**
   * Opening is always quiet: Home, no window, no chime. The daily gift waits in the chest on Home. Only the very
   * first open ever gets one short, silent welcome window. Rank-ups wait until the player moves around the app.
   */
  start() {
    const day = this.store.openDay();
    this.lastDay = this.store.today();
    this.greeting = true;
    this.go({ name: 'hub' }, { replace: true });
    this.greeting = false;
    if (day.kind !== 'first') return;
    this.greeting = true;
    this.settled = this.welcome().finally(() => {
      this.greeting = false;
    });
  }

  private lastDay = '';
  private dayCheck() {
    const today = this.store.today();
    if (this.lastDay && this.lastDay !== today) {
      this.store.openDay();
      if (this.route.name === 'hub') this.go({ name: 'hub' }, { replace: true, quiet: true });
    }
    this.lastDay = today;
  }

  private async welcome() {
    const { FIRST_WELCOME } = await import('../content/daily-lines');
    await wait(this.reduced() ? 0.2 : 0.7);
    if (this.route.name !== 'hub') return;
    await this.window({ kind: 'notification', title: 'Notification', html: FIRST_WELCOME.map((l) => `<p>${typo(l)}</p>`).join(''), tapToContinue: true }, true);
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

  /** Shows a Lantern window over a dim scrim. Does not depend on the WebGL stage loop running. */
  window(spec: WindowSpec, silentOpen = false): Promise<string> {
    const gen = this.winGen;
    const run = this.winChain.then(async () => {
      if (gen !== this.winGen || this.route.name === 'safe') return DISMISSED;
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
      this.scrim.classList.remove('is-on');
      this.root.classList.remove('is-windowed');
      this.view.inert = false;
    };
    this.dropScrim = drop;
    this.scrim.classList.add('is-on');
    this.root.classList.add('is-windowed');
    this.view.inert = true;
    const w = new LanternWindow(lanternLayer(), { width: 'min(92vw, 540px)', ...spec });
    w.root.classList.add('dq-sw');
    if (this.reduced()) w.root.classList.add('dq-sw--still');
    w.root.tabIndex = -1;
    void w.open();
    w.root.focus({ preventScroll: true });
    const v = await w.waitForInput();
    drop();
    if (v !== DISMISSED) {
      void w.close();
      if (before?.isConnected && !this.root.contains(document.activeElement)) before.focus({ preventScroll: true });
      await wait(this.reduced() ? 0.25 : 0.45);
      w.destroy();
    }
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
  toast(text: string, action?: { label: string; run(): void }) {
    if (this.route.name === 'safe') return;
    const n = ++this.toastN;
    this.toastEl.replaceChildren(h('span', { text: typo(text) }));
    if (action)
      this.toastEl.append(
        h('button', {
            type: 'button',
            class: 'dq-toast-btn',
            text: action.label,
            onclick: () => {
              this.toastN++;
              this.toastEl.classList.remove('is-on');
              action.run();
            },
          }),
      );
    this.toastEl.classList.add('is-on');
    const a = animate(this.toastEl, [{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: this.reduced() ? 1 : 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    void a;
    void wait(action ? 6 : 5).then(() => {
      if (n !== this.toastN) return;
      animate(this.toastEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in' }).finished.then(() => this.toastEl.classList.remove('is-on'));
    });
  }

  go(route: Route, o: { replace?: boolean; quiet?: boolean } = {}) {
    if (!Object.prototype.hasOwnProperty.call(this.screens, route.name)) route = { name: 'hub' };
    // after clearing, Settings shows how it went; only the Safe Zone opens as ever
    if (cleared() && route.name !== 'safe') route = { name: 'settings' };
    const safe = route.name === 'safe';
    const wasSafe = this.route.name === 'safe';
    const fromSkill = this.route.name === 'skill';
    if (safe) this.clearForSafe();
    if (!o.replace && this.current) this.stack.push(this.route);
    if (route.name === 'hub') this.stack = [];
    this.current?.leave?.();
    if (this.current?.foot) this.pins.unobserve(this.current.foot);
    if (route.name !== 'hub') this.toastEl.classList.remove('is-on');
    this.route = route;
    if (safe !== wasSafe) this.quietScore(safe);
    const out = this.screens[route.name](this, route);
    this.current = out;
    this.root.style.setProperty('--dq-foot', '0px');
    if (out.foot) this.pins.observe(out.foot);
    this.root.dataset.mode = out.mode;
    this.root.dataset.screen = route.name;
    this.renderTop(out);
    this.view.replaceChildren(out.el);
    this.root.scrollTop = 0;
    const [dens, bright] = out.bubbles ?? [3, 0.8];
    if (dens !== this.bubbles.density || bright !== this.bubbles.brightness) this.bubbles.set(dens, bright);
    if (!o.quiet) {
      animate(out.el, this.reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
        duration: this.reduced() ? WINDOW.reducedFadeMs : 300,
        easing: 'cubic-bezier(.16,1,.3,1)',
      });
    }
    const focus = out.el.querySelector<HTMLElement>('[data-focus]') ?? out.el.querySelector<HTMLElement>('h1');
    if (focus && !o.quiet) {
      focus.setAttribute('tabindex', '-1');
      focus.focus({ preventScroll: true });
    }
    out.after?.();
    if (route.name === 'hub' && !o.quiet && !fromSkill) void this.celebrate();
  }

  private clearForSafe() {
    this.winGen++;
    dismissWindows();
    this.dropScrim?.();
    document.querySelectorAll('[data-fx]').forEach((n) => n.remove());
  }

  private quietScore(on: boolean) {
    try {
      this.opts.sound?.quiet?.(on);
    } catch {
      /* sound is optional */
    }
  }

  back() {
    const prev = this.stack.pop();
    this.go(prev ?? { name: 'hub' }, { replace: true });
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
    else left = h('button', { type: 'button', class: 'dq-back', onclick: () => this.back() }, h('span', { html: icon('back') }), h('span', { text: 'Lantern' }));
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
    this.pins.disconnect();
    this.volBtn?.dispose();
    this.store.dispose();
    this.offs.forEach((f) => f());
    this.bubbles.destroy();
    this.root.remove();
    document.querySelectorAll('.dq-sw').forEach((n) => n.remove());
  }
}
