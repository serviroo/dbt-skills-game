import type { Stage } from './core/stage';
import { params } from './core/params';
import { endCard, introWays, letterView, namePrompt, rewardCards, showTitle, uiSounds, unlessLeft, type Way } from './ui/cutscene-ui';
import { lanternMessage, windowSounds, type WindowKind } from './ui/lantern-window';
import { useRealClock, useStageClock } from './ui/anim';
import type { AudioLike } from './cutscene/director';
import { loggingAudio } from './cutscene/audio-log';
import { INTRO, NEW_VERSION, REWARDS } from './content/intro';
import type { VolumeCtrl } from './audio/prefs';
import { volumeButton, type VolumeButton } from './ui/volume';
import { readYou } from './core/you';
import { APP_KEY } from './core/stored-names';
import { write } from './core/cleared';
import { SCORE } from './motion/tokens';

const dailyMods = import.meta.glob('./daily/index.ts');
const pwaMods = import.meta.glob('./pwa/register.ts');
const hintMods = import.meta.glob('./pwa/install-hint.ts');
const artMods = import.meta.glob('./daily/art.ts');

interface AppState {
  seenCutscene: boolean;
}
function load(): AppState {
  try {
    const raw = JSON.parse(localStorage.getItem(APP_KEY) || '{}');
    return { seenCutscene: raw && raw.seenCutscene === true };
  } catch {
    return { seenCutscene: false };
  }
}
function save(s: AppState) {
  const out = JSON.stringify(s);
  write(() => {
    try {
      localStorage.setItem(APP_KEY, out);
    } catch {
      /* storage blocked: the intro still plays, it just shows again next time */
    }
  });
}

type Engine = import('./audio/engine').AudioEngine;
interface AppAudio extends AudioLike {
  engine?: Engine;
  unlock?(): void;
  /** Their levels (the speaker control); absent in capture and shot modes. */
  volume?: VolumeCtrl;
}

/** Adapts the audio engine to the director's surface (beds start at the requested level, no jump). */
async function makeAudio(): Promise<AppAudio | null> {
  if (params.capture) {
    const log = loggingAudio();
    windowSounds.open = (kind: WindowKind) => log.play(kind === 'reward' ? 'reward_chime' : 'ui_open', kind === 'level' ? { detune: 500 } : undefined);
    windowSounds.close = () => log.play('ui_close');
    windowSounds.tap = () => log.play('ui_tap');
    uiSounds.play = (c, o) => log.play(c, o);
    return log;
  }
  try {
    const { AudioEngine } = await import('./audio/engine');
    const { wireWindowSounds } = await import('./audio/wire');
    const { createVolume, loadPrefs } = await import('./audio/prefs');
    const prefs = loadPrefs();
    const initial = { master: prefs.master, music: prefs.music, sfx: prefs.sfx, hum: prefs.hum, muted: prefs.muted };
    // ?mute silences this visit only: it is never written to their stored levels
    const e = new AudioEngine(undefined, { user: { ...initial, muted: initial.muted || params.mute } });
    const volume = params.shot ? undefined : createVolume(e, { fresh: prefs.fresh, initial, forceMute: params.mute });
    if (volume && (import.meta.env.DEV || params.debug))
      (window as unknown as { __dbtVolume?: unknown }).__dbtVolume = { get: () => volume.get(), gains: () => e.levels };
    e.autoUnlock();
    wireWindowSounds(e);
    const a: AppAudio = {
      engine: e,
      volume,
      unlock: () => void e.unlock(),
      play: (c, o) => e.play(c, o),
      bed: (n) => ({
        level: (v: number, r = 0.5) => void e.bed(n as never, { level: v, fadeIn: r }),
        stop: (r = 0.5) => {
          const b = (e as unknown as { beds: Map<string, { stopped?: boolean; stop(r?: number): void }> }).beds.get(n);
          if (b && !b.stopped) b.stop(r);
        },
      }),
      chargeLoop: () => e.chargeLoop(),
      music: { to: (s, f, o) => e.music.to(s as never, f, o), stop: (f) => e.music.stop(f) },
      hush: (from, to) => e.hush(from, to),
      unhush: () => e.unhush(),
      duck: (db, r) => e.duck(db, r),
    };
    uiSounds.play = (c, o) => a.play(c, o);
    return a;
  } catch (err) {
    console.warn('audio unavailable', err);
    return null;
  }
}

/** If an unlock date is set, show a sealed gate until then (no ticking countdown). */
async function sealedUntil(): Promise<void> {
  if (!INTRO.unlockOn || params.fresh || params.shot) return;
  const open = new Date(INTRO.unlockOn + 'T00:00:00');
  if (Number.isNaN(open.getTime()) || Date.now() >= open.getTime()) return;
  const day = open.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  document.getElementById('ui')!.insertAdjacentHTML(
    'beforeend',
    `<div class="ov title-screen" style="cursor:default"><div class="title-slit" style="opacity:.35"></div><div class="title-prompt" style="letter-spacing:.18em">This Gate opens on ${day}.</div></div>`,
  );
  await new Promise(() => undefined);
}

/** `stage` is the 3D stage when boot made one up front (labs, captures); `makeStage` makes it, null without WebGL. */
export async function runApp(stage: Stage | null, makeStage: () => Stage | null) {
  await sealedUntil();
  const state = load();
  if (params.fresh) state.seenCutscene = false;
  const audio = await makeAudio();
  const pk = Object.keys(pwaMods)[0];
  if (pk)
    pwaMods[pk]()
      .then((m: any) => {
        m.registerSW?.();
        return m.requestPersistentStorage?.();
      })
      .catch(() => undefined);
  // the reward card shows the full companion drawing
  const ak = Object.keys(artMods)[0];
  if (ak)
    artMods[ak]()
      .then((m: any) => {
        if (m.mothSVG) (window as any).__companionSVG = () => m.mothSVG({ size: 120, eye: 'open', glow: true, tone: 'lilac' });
      })
      .catch(() => undefined);

  const wantCutscene = !state.seenCutscene || !!params.shot || params.cutscene;
  let help = false;
  // only the intro draws on the 3D stage: the companion is DOM only (its small scenes bring their own renderer), so a
  // returning player never sets up WebGL for it
  if (wantCutscene) {
    stage ??= makeStage();
    help = await intro(stage, audio, state);
  }
  await enterDaily(stage, audio, state, help);
}

/**
 * The intro, with the Safe Zone and Skip on every screen of it. However it ends (watched to the end card, skipped, or
 * left for help, even while a load is pending or the graphics fail), it ends here: it counts as seen, and the companion
 * opens next. True when the player left it for the Safe Zone.
 */
async function intro(stage: Stage | null, audio: AppAudio | null, state: AppState): Promise<boolean> {
  mountCutsceneVolume(audio);
  const left = new AbortController();
  let offWays = () => {};
  const way = new Promise<Way>((resolve) => {
    offWays = introWays((w) => {
      // the sound goes first, before anything else of the intro, however long the rest takes on a slow phone. Help is
      // silent from the press on, while the companion loads too, as the Safe Zone is: its gate closes under every sound
      // and echo at once. Skip lets what plays fade. Either way none of the intro sounds on after it: every cue still
      // ringing, bed, charge hum and the score stop at the press
      if (w === 'safe') audio?.engine?.quiet(true, SCORE.safeOutSec);
      audio?.engine?.stopAll(w === 'safe' ? SCORE.safeOutSec : SCORE.leaveSec);
      left.abort();
      resolve(w);
    });
  });
  const end = await Promise.race([stage ? playIntro(stage, audio, left.signal) : playWithoutStage(audio, left.signal), way]);
  offWays();
  state.seenCutscene = true;
  save(state);
  if (end === 'replay') {
    location.search = '?cutscene=1';
    await new Promise(() => undefined);
  }
  return end === 'safe';
}

/** The speaker on every cutscene beat, from the title screen to the end card (none without Web Audio or in captures). */
let cutsceneVol: VolumeButton | null = null;
function mountCutsceneVolume(audio: AppAudio | null) {
  if (!audio?.volume || cutsceneVol) return;
  cutsceneVol = volumeButton(audio.volume, { placement: 'cutscene', align: 'left' });
  document.getElementById('ui')!.append(cutsceneVol);
}

async function closingCards(audio: AppAudio | null, left: AbortSignal) {
  audio?.music?.to('reward', 1.5);
  await rewardCards(REWARDS, { left });
  await letterView(left);
  audio?.music?.to('end', 2);
  return endCard(left);
}

/** Offered in the intro, it goes with the intro when the player leaves it (`left`), and nothing reloads. */
async function offerReload(err: unknown, left?: AbortSignal): Promise<never> {
  console.warn('[app] a file for this version is gone, offering a reload', err);
  await unlessLeft(lanternMessage({ kind: 'info', icon: 'info', title: NEW_VERSION.title, html: NEW_VERSION.html, actions: [{ label: NEW_VERSION.action, value: 'reload' }] }, { left }), left);
  location.reload();
  return new Promise<never>(() => undefined);
}

/** No WebGL on this device: the title, rewards, letter and end card are DOM only, so the player still gets every word. */
async function playWithoutStage(audio: AppAudio | null, left: AbortSignal) {
  await showTitle(() => audio?.unlock?.(), left);
  await askNames(left);
  return closingCards(audio, left);
}

async function playIntro(stage: Stage, audio: AppAudio | null, left: AbortSignal) {
  stage.paused = false;
  // the title and name prompt are DOM only: one still frame of the empty scene behind them, the 3D frames start with
  // the cinematic
  if (!params.capture) stage.step(0);
  await showTitle(() => audio?.unlock?.(), left);
  await askNames(left);
  useStageClock(stage);
  stage.start();
  const { playCutscene } = await unlessLeft(stage.loading(import('./cutscene/director')), left).catch((err) => offerReload(err, left));
  try {
    return await unlessLeft(playCutscene(stage, audio ?? undefined, left), left);
  } catch (err) {
    console.warn('[intro] the scene failed, finishing without it', err);
    useRealClock();
    stage.stop();
    stage.canvas.style.opacity = '0';
    document.getElementById('ui')!.querySelectorAll('.ov, .lb, .sw-layer').forEach((n) => n.remove());
    return closingCards(audio, left);
  }
}

async function enterDaily(stage: Stage | null, audio: AppAudio | null, state: AppState, help: boolean) {
  // the companion is DOM only: stop the WebGL loop to save battery and keep UI timing on the page clock
  useRealClock();
  if (stage && !params.capture) stage.stop();
  if (stage) stage.canvas.style.opacity = '0';
  audio?.engine?.setSession('ambient');
  audio?.engine?.setVolume(0.6);
  audio?.music?.to('calm', SCORE.inSec);
  const root = document.getElementById('ui')!;
  root.querySelectorAll('.ov, .lb').forEach((n) => n.remove());
  cutsceneVol?.dispose();
  cutsceneVol = null;
  const k = Object.keys(dailyMods)[0];
  if (!k) return;
  const m = (await dailyMods[k]().catch(offerReload)) as { mountDaily:(r: HTMLElement, o: unknown) => { unmount(): void; settled: Promise<void>; route(): string } };
  const daily = m.mountDaily(root, {
    help,
    onReplay: () => {
      state.seenCutscene = true;
      save(state);
      location.search = '?cutscene=1';
    },
    sound: audio
      ? {
          play: (c: string) => audio.play(c),
          setMuted: (m: boolean) => audio.engine?.setMuted(m),
          quiet: (on: boolean) => audio.engine?.quiet(on, on ? SCORE.safeOutSec : SCORE.safeBackSec),
        }
      : undefined,
    volume: audio?.volume,
  });
  const onHome = () => daily.route() === 'hub';
  const hk = Object.keys(hintMods)[0];
  if (hk)
    void daily.settled
      .then(() => (onHome() ? hintMods[hk]() : null))
      .then((m: any) => m?.maybeShowInstallHint?.({ delay: 1.5, still: onHome }))
      .catch(() => undefined);
}

/** The first run asks for the two names once (the dev shot and capture flags go straight to the scene). */
async function askNames(left: AbortSignal) {
  if (readYou() || params.shot || params.capture) return;
  await namePrompt(left);
}
