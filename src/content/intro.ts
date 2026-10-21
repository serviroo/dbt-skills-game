/**
 * Everything the intro cutscene says lives here, so it can be edited in one place.
 * Copy rules: give, never ask; nothing can be failed; no pressure, no dates, no streaks.
 * {name} and {companion} are the player's chosen names (core/you); getters read them when the line is shown.
 */
import { fillYou } from '../core/you';

export const INTRO = {
  /** Set a number to show "Level N" in the level-up window. null = "LEVEL UP" with no number. */
  levelNumber: null as number | null,
  /** ISO date (YYYY-MM-DD) before which the gate stays sealed. null = unlocked right away. */
  unlockOn: null as string | null,
};

export const WINDOWS = {
  chosen: {
    title: 'Notification',
    get html() {
      return fillYou(`<p>[A Gate has opened.]</p><p>[The Lantern has chosen a <b>Wanderer</b>.]</p><p class="sys">Wanderer: {name}.</p>`);
    },
  },
  level: {
    title: 'Notification',
    banner: '[Level Up!]',
    big: INTRO.levelNumber ? `LEVEL ${INTRO.levelNumber}` : 'LEVEL UP',
    rows: [
      ['Strength', 'already high'],
      ['Patience', 'growing'],
      ['Kindness', 'S-rank'],
    ] as [string, string][],
    footer: `Tutorial event: unlocked.<br>Rewards here don't expire.`,
  },
  /** A quest window, played as a joke: every goal is already done or optional, and nothing happens if not. */
  quest: {
    title: 'Quest',
    arrived: "[Today's quest: Take It Easy.]",
    goal: 'Goal',
    rows: [
      ['Push-ups', '0/0', true],
      ['Nap', '1/1', true],
      ['Snack', '0/1', false],
      [`Hear that you're doing fine`, '1/1', true],
    ] as [string, string, boolean][],
    warning: 'Skipping this quest will result in',
    punch: 'nothing.',
    after: 'The Lantern is on your side.',
  },
  army: {
    title: 'Notification',
    html: `<p>[The Night Watch has gathered.]</p><p class="sys">Reason: a new Wanderer has arrived.</p>`,
  },
  chest: {
    title: 'Quest Reward',
    html: `<p class="center">[A reward has been prepared for you.]</p>`,
  },
  unlocked: {
    title: 'Reward',
    html: `<p class="center">[Reward unlocked.]</p>`,
  },
};

export interface RewardItem {
  id: 'letter' | 'companion' | 'lantern' | 'charm';
  rarity: 'legendary' | 'epic' | 'rare';
  name: string;
  kind: string;
  desc: string;
}

export const REWARDS: RewardItem[] = [
  { id: 'letter', rarity: 'legendary', name: 'A welcome note', kind: 'Item', desc: 'From the Lantern. Open it whenever.' },
  {
    id: 'companion',
    rarity: 'epic',
    get name() {
      return fillYou('{companion}');
    },
    kind: 'Companion',
    desc: 'A small night moth. Sleeps a lot. Extremely loyal.',
  },
  { id: 'lantern', rarity: 'epic', name: 'The Lantern', kind: 'Skill', desc: 'Small daily skills for loud days and slow ones. Saved only on this device.' },
  { id: 'charm', rarity: 'rare', name: 'Paper star', kind: 'Charm', desc: 'Folded for luck. Keeps bad days at a distance.' },
];

/** The welcome note at the end of the intro. */
export const LETTER = {
  get greeting() {
    return fillYou('Welcome, {name}.');
  },
  get paragraphs() {
    return [
      `This is a quiet corner for practising DBT skills: one small skill a day, a calm Safe Zone for hard moments, and a one-tap check-in.`,
      `Nothing here leaves your device, nothing keeps score, and you can't do it wrong. Open it on loud days, slow days, or never.`,
      `It's practice, not therapy. If you have a therapist, the diary card is yours to share with them if you want.`,
      fillYou(`{companion} will keep watch, when it's awake.`),
    ];
  },
  signoff: `The Lantern`,
};

export const END_CARD = {
  get title() {
    return fillYou('Welcome, {name}');
  },
  line: `Status: already strong.`,
};

export const TITLE_SCREEN = {
  prompt: 'Tap to begin',
  promptMouse: 'Click to begin',
  hint: 'Best with sound on',
};

/** The first-run question, right after the title screen. Optional: skipping keeps the defaults. */
export const NAME_PROMPT = {
  title: 'Before the Gate opens',
  line: 'What should the Lantern call you?',
  nameLabel: 'Your name',
  companionLabel: "Your companion's name",
  hint: 'Optional. You can change both in Settings.',
  go: 'Continue',
  skip: 'Skip',
};
