/**
 * Everything the intro cutscene says lives here, so it can be edited in one place.
 * Copy rules: give, never ask; nothing can be failed; no pressure, no dates, no streaks.
 */

export const INTRO = {
  name: 'Player',
  /** Set a number to show "Level N" in the level-up window. null = "LEVEL UP" with no number. */
  levelNumber: null as number | null,
  /** ISO date (YYYY-MM-DD) before which the gate stays sealed. null = unlocked right away. */
  unlockOn: null as string | null,
};

export const WINDOWS = {
  chosen: {
    title: 'Notification',
    html: `<p>[A Gate has opened.]</p><p>[You have been chosen as its <b>Player</b>.]</p><p class="sys">Player name: ${INTRO.name}.</p>`,
  },
  level: {
    title: 'Notification',
    banner: '[Level Up!]',
    big: INTRO.levelNumber ? `LEVEL ${INTRO.levelNumber}` : 'LEVEL UP',
    rows: [
      ['Strength', 'already high'],
      ['Honesty', 'S-rank'],
      ['Sleepiness', 'max'],
    ] as [string, string][],
    footer: `Tutorial event: unlocked.<br>Rewards here don't expire.`,
  },
  /** The manhwa's QUEST INFO window, parodied: every goal is already done or optional, and nothing happens if not. */
  quest: {
    title: 'Quest Info',
    arrived: '[Daily Quest: Take It Easy has arrived.]',
    goal: 'Goal',
    rows: [
      ['Push-ups', '0/0', true],
      ['Nap', '1/1', true],
      ['Snack', '0/1', false],
      [`Hear that you're doing fine`, '1/1', true],
    ] as [string, string, boolean][],
    warning: 'Failure to complete the daily quest will result in',
    punch: 'nothing.',
    after: 'The System is on your side.',
  },
  army: {
    title: 'Notification',
    html: `<p>[Shadow army assembled.]</p><p class="sys">Reason: a new Player has arrived.</p>`,
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
  id: 'letter' | 'seahorse' | 'system' | 'butterfly';
  rarity: 'legendary' | 'epic' | 'rare';
  name: string;
  kind: string;
  desc: string;
}

export const REWARDS: RewardItem[] = [
  { id: 'letter', rarity: 'legendary', name: 'A welcome note', kind: 'Item', desc: 'From the System. Open it whenever.' },
  { id: 'seahorse', rarity: 'epic', name: 'Shadow Seahorse', kind: 'Shadow', desc: 'Your first shadow. Sleeps a lot. Extremely loyal.' },
  { id: 'system', rarity: 'epic', name: 'The System', kind: 'Skill', desc: 'Small daily skills for loud days and slow ones. Saved only on this device.' },
  { id: 'butterfly', rarity: 'rare', name: 'Leaf butterfly', kind: 'Charm', desc: 'Folded for luck. Keeps bad days at a distance.' },
];

/** The welcome note at the end of the intro. */
export const LETTER = {
  greeting: `Welcome, ${INTRO.name}.`,
  paragraphs: [
    `This is a quiet corner for practising DBT skills: one small skill a day, a calm Safe Zone for hard moments, and a one-tap check-in.`,
    `Nothing here leaves your device, nothing keeps score, and you can't do it wrong. Open it on loud days, slow days, or never.`,
    `It's practice, not therapy. If you have a therapist, the diary card is yours to share with them if you want.`,
    `The seahorse will keep watch, when it's awake.`,
  ],
  signoff: `The System`,
};

export const END_CARD = {
  title: `Welcome, ${INTRO.name}`,
  line: `Status: already strong.`,
};

export const TITLE_SCREEN = {
  prompt: 'Tap to begin',
  promptMouse: 'Click to begin',
  hint: 'Best with sound on',
};
