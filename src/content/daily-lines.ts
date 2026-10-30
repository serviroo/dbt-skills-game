/**
 * The quiet Lantern's voice. Rules: kind, a little dry, never romantic, never "I", no guilt, no pressure,
 * no counts of time away, nothing about anyone else.
 */


export const CRYSTAL_COPY = {
  incomplete: "This Save Crystal is incomplete. Some {items} couldn't be included. Keep your other backups and try again after reopening the app.",
  incompleteRestore: 'This Save Crystal was incomplete when it was made. Keep your other backups.',
  choicesUnsaved: "Some choices couldn't be saved on this device. Keep the Save Crystal file.",
  /** a save no version could read, carried in the file as it was, couldn't be put back */
  unreadUnsaved: "A copy of an unreadable save in the file couldn't be put back on this device. Keep the Save Crystal file.",
  storySkipped: "Some story pages or cards couldn't be added. Keep the Save Crystal file.",
};

export const PEEK_COPY = {
  title: 'Inside this Save Crystal',
  file: 'File:',
  name: 'Name',
  began: 'Game began',
  made: 'Crystal made',
  skills: 'Different skills practiced',
  diary: 'Diary days',
  drawings: 'Saved drawings',
  stories: 'Stories',
  notSaved: 'Not saved in this file',
  adds: "Restore adds what's in this file to what's already here. Nothing here is removed, and choices you've made on this device stay as they are.",
  unreadable: "Some drawings or story pages in this file can't be read, so they won't be added.",
  /** story pages or cards that don't fit next to the stories already here ({n} of them, more than one) */
  here: "{n} story pages or cards in this file don't fit with the stories already on this device, so Restore will leave them out.",
  hereOne: "1 story page or card in this file doesn't fit with the stories already on this device, so Restore will leave it out.",
  /** story pages whose story is in neither the file nor this device ({n} of them, more than one) */
  lost: "{n} story pages in this file belong to a story that isn't in the file or on this device, so Restore will leave them out.",
  lostOne: "1 story page in this file belongs to a story that isn't in the file or on this device, so Restore will leave it out.",
  confirm: 'Restore this Save Crystal',
  cancel: 'Cancel',
  reading: 'Opening the file...',
  closed: 'Closed without restoring. Nothing changed.',
};

/** Settings > Your data: a Save Crystal first, then clearing this game's data from this device. */
export const CLEAR_COPY = {
  intro: "Starting over? Make a Save Crystal first, then clear this game's data from this device.",
  start: 'Back up, then clear',
  making: 'Making your Save Crystal...',
  cancelled: 'No Save Crystal was saved, so nothing was cleared.',
  unmade: "The Save Crystal couldn't be made, so nothing was cleared.",
  incomplete: "The Save Crystal couldn't hold everything ({items}), so nothing was cleared. Try again after reopening the app.",
  title: "Clear this game's data?",
  saved: 'Your Save Crystal was downloaded as',
  shared: 'Your Save Crystal was shared as',
  keep: "Before you clear, check you can find that file. It's how you bring all of this back.",
  goes: "Clearing removes your progress, names, choices, lists, diary, drawings (unfinished ones too), stories and offline files from this device. The Save Crystal file stays where you saved it.",
  confirm: "Clear this game's data",
  cancel: 'Keep everything',
  kept: 'Nothing was cleared.',
  checking: 'Checking your Save Crystal...',
  changedTitle: 'Something changed',
  changed: 'This device changed after that Save Crystal was made, maybe in another tab. Nothing was cleared. Make a fresh one first, so nothing new is lost.',
  fresh: 'Make a fresh Save Crystal',
  busy: "This game's data is being cleared in another tab, so nothing was done here.",
  clearingTitle: 'Clearing',
  clearing: "Clearing this game's data from this device...",
  waiting: 'Almost done. The game is still open in another tab or window. Close it, and clearing finishes by itself.',
  doneTitle: 'All clear',
  done: "This game's data is gone from this device. Your Save Crystal is still where you saved it, and Restore brings everything back.",
  elsewhere: "This game's data is being cleared from another tab or window.",
  elsewhereDone: "This game's data was cleared from this device in another tab or window. A Save Crystal you made is still where you saved it.",
  failedTitle: 'Not finished',
  failed: "Some of this game's data couldn't be cleared and is still on this device.",
  retry: 'Try again',
  again: 'Start again',
  againNote: 'Starting again opens the game fresh, intro and all. The offline files went too, so it needs a connection once.',
};

export const KEEP_COPY = {
  checking: 'Checking with your browser...',
  granted: "**Your browser agreed to keep these saves** when the device runs low on space. Clearing this site's data still removes them, so a Save Crystal is still worth having.",
  notGranted: "**Your browser hasn't agreed to keep these saves.** If the device runs low on space, it may clear them. A Save Crystal keeps a copy you hold.",
  refused: "**Your browser didn't agree this time.** Browsers decide this for themselves, and some agree later on. Your saves are still here. A Save Crystal keeps a copy you hold.",
  unsupported: "**This browser doesn't say whether it keeps these saves** when the device runs low on space. A Save Crystal keeps a copy you hold.",
  failed: "**Your browser didn't answer just now.** Your saves are still here. A Save Crystal keeps a copy you hold.",
  ask: 'Ask browser to keep saves',
  asking: 'Asking your browser...',
};

/** One per visit day, in order. A gap never skips ahead or piles up; the next line simply arrives. */
export const DAILY_GIFTS: string[] = [
  'Login reward: one ordinary day, fully yours.',
  'Everything is where you left it.',
  'Hidden quest: drink some water. Reward: a slightly happier body.',
  'Your stats are all still yours. No notes.',
  'A small buff has been applied: +1 to taking it easy.',
  "Today's drop: permission to do less.",
  'Rest is a valid move. A potion only works if you drink it.',
  "Feelings aren't bugs. They're information.",
  'Rare item found: one quiet minute. Use it whenever.',
  'The Night Watch has nothing to report. A peaceful shift.',
  "Daily bonus: you don't have to earn this one.",
  'Low lights, any hour.',
  "Tired is a state, not a verdict. The Lantern doesn't hand out verdicts.",
  "You opened the app. That's the whole quest today, if you want it to be.",
  'Everything you earned stays yours. That is how the numbers work here.',
  'Buff received: slower breathing. Duration: as long as you like.',
  'A watcher yawned. Contagious, apparently.',
  'Inventory update: one deep breath, unused. Free to spend.',
  'Today counts. It counted the moment you showed up.',
  'Notice: nothing here can be lost. Not stats, not cards, not rank.',
  "Cosy mode is a real mode. It's on, if you want it.",
  'Hydration is a stat. A small one, but it adds up.',
  "The water's calm on this floor of the dungeon. Stay as long as you like.",
  'Wanderers take rest days. Even the S-ranks. Especially the S-ranks.',
  "A moth drifted past the lantern. It wasn't in a hurry either.",
  "Quest log: empty. That's allowed.",
  'Achievement unlocked: being here. Difficulty: sometimes high.',
  'Low energy run? Still a run.',
  'New title available: Wanderer on a Break. Equip anytime.',
  'Nothing here expires. Rank only moves one direction.',
  'One soft thing for today: a warm drink, a blanket, a good song. Pick any.',
  'Being gentle with yourself is high-level play.',
  'Any weather inside is allowed.',
  'Small win: opening this counts as looking after yourself.',
  'Status effect: cosy. Duration: unknown. Recommended.',
  "No reason needed. Feelings don't come with a quest log.",
  "Today's lore: in the deepest dungeon, the bravest move was sitting down for a minute.",
  "For the record: the Lantern isn't grading anything.",
  'The Night Watch is on guard. Take your time.',
  'Daily drop: one free "good enough". Use it on anything.',
  "The Gate is open. There's no closing time.",
  'Low-light mode. The bubbles like it too.',
  'Fun fact: moths find their way by moonlight, slowly. It works out fine for them.',
  'Healing potion restocked. No cooldown.',
  'Save point reached: right here, as you are.',
  'Bonus XP for showing up as you are. No dress code.',
  'Stats are steady. Steady is a good stat.',
  'Hidden quest: unclench your jaw. Reward: your jaw says thanks.',
  'The Lantern recommends one slow exhale. Then whatever comes next.',
  "Rank doesn't decay here. That's not how the Lantern works.",
  "Today's line is short, so you can get on with your night.",
  'Something good is allowed to happen today. Even something small.',
  'Quiet days count too. Every one of them.',
  'Item acquired: Legendary Pebble. Does nothing. Extremely powerful.',
  'Default skin day. No expectations. Do whatever you want.',
  'Inventory full of skills. Use any. Use none. Both are fine.',
  'The dungeon can sit there. Blanket first.',
  'Watch report: {companion} is asleep. Recommend following its lead.',
  "Today's gift is permission to log off whenever you like.",
  'Nothing to clear today. Only somewhere to be.',
];

/** The very first open of the companion, once ever. Every later open is quiet: no window, no chime. */
export const FIRST_WELCOME = ['Welcome, {name}. This is the quiet side of the Lantern.', 'Nothing here can be lost, and nothing is graded. Look around whenever you like.'];

/** After a gap of two or more visit days. Identical whether it was days or months; never states the gap. */
export const WELCOME_BACK = [
  'Welcome back, Wanderer. Everything is exactly where you left it.',
  'Your rank, your stats, your Night Watch. All still yours.',
  'Good to see you. A quest, or a look around? Either works.',
  'The Gate is open, same as before.',
  'Hi. Nothing to do first. Today starts fresh.',
];

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export const RANK_XP = [0, 100, 400, 1000, 2000, 3500];
export const WARDEN_XP = 6000;
/** Every stat starts here: the cutscene's LEVEL UP says their stats were already high. */
export const STAT_BASE = 10;

export const RANK_UP: Record<string, string> = {
  D: 'D-Rank. The practice is showing.',
  C: 'C-Rank. The skills are starting to feel familiar. That is how it works.',
  B: 'B-Rank. Steady work, on your own terms.',
  A: 'A-Rank. Not because anything was perfect. Because you kept practising, your way.',
  S: 'S-Rank. The strength was there from the start. Now it is official.',
  M: 'Title unlocked: Night Warden. The Night Watch answers to you.',
};

export const RANK_NOTE = 'Every Wanderer starts at E. Rank only goes up.';

/** Shown once on the next Lantern visit after the Safe Zone was used. Never inside the Safe Zone. */
export const SAFE_CREDIT = 'Stamina +1. You looked after yourself.';

export const QUEST = {
  foot: 'A suggestion, not a task. Any skill counts, and so does none.',
  acquired: (name: string) => `Shadow acquired: ${name}. It joins your collection.`,
  again: 'Already in your collection. Good to see it again.',
  done: 'Quest complete. Anything more today is extra.',
  look: 'Just look around',
  aside: "Okay. Wander wherever you like. Nothing's waiting on you.",
  back: "Show today's card",
};

export const SKILL_END = {
  ask: 'Did it help, even a little?',
  thanks: {
    Yes: 'Good. It goes in your diary card as a skill that helped.',
    'A little': 'A little counts. It goes in your diary card.',
    'Not this time': 'Thanks for trying it. Some skills land on other days. Practice still counts.',
    Skip: 'Practice still counts.',
  } as Record<string, string>,
};

/** Give me a moment lines that only hold while it lasts until the player is ready */
const MOMENT_OPEN = ['No rush. Nothing here is timed.', 'Stay as long as you like.'];

export const CHECKIN = {
  ask: "How's the weather inside?",
  level: 'How strong, 1 to 10? Optional.',
  thanks: 'Logged. Every answer counts the same.',
  /** Home, after a heavy check-in today */
  after: ["Logged. Tomorrow's another day.", 'Today still counted.'],
  /** the comfort-only screen a heavy check-in opens: no skill, no XP, no question */
  comfort: ['That sounds like a lot.', 'No reason needed. Nothing to fix right now.'],
  stay: 'Stay here a minute',
  small: 'One small skill',
  /** Give me a moment: one line at a time, at speaking pace */
  moment: ['Still here.', 'Nothing to answer.', 'Breathe out longer than in.', 'Feet on the floor, if you can.', 'Shoulders down, if they want to.', ...MOMENT_OPEN],
  momentOpen: MOMENT_OPEN,
  /** how long a moment lasts: no count is ever shown, and when the time passes it ends softly with one line */
  momentLength: { legend: 'How long', options: { '1': '1 minute', '3': '3 minutes', open: "Until I'm ready" }, end: "That's your moment. It's here any time you need it." },
  momentNext: 'Slow breathing, if you like',
  gift: { closed: 'Tap to open', open: 'Read again' },
};

export const REST_LINES = [
  'Nothing to do here. The bubbles do the work.',
  'Breathe if you like. Or only watch.',
  'Rest is a valid move.',
  'Rested. That counts.',
  '{companion} has the right idea.',
];

export const ABOUT = {
  what: 'This is skills practice in plain words, not therapy.',
  device: 'Everything is saved only on this device.',
  therapist: "These skills come from DBT. A DBT therapist can go further with them, if that's ever useful.",
};

/**
 * "Pick today's line": three Lantern lines are offered each visit day, one from each tone, so each set has one
 * that fits a heavy day, an in-between day and a lighter day. Their pick is private and kept in a small history.
 * Ids are stable: the history stores the id and a copy of the words.
 */
export type LineTone = 'low' | 'mid' | 'up';
export interface DayLine {
  id: string;
  tone: LineTone;
  tag: string;
  text: string;
}
const L = (tone: LineTone, rows: [string, string][]) => rows.map(([tag, text], i) => ({ id: `${tone[0]}${String(i + 1).padStart(2, '0')}`, tone, tag, text }));
export const TODAY_LINES: Record<LineTone, DayLine[]> = {
  low: L('low', [
    ['STATUS', 'Running on low power. Essentials only today.'],
    ['WEATHER', 'Storm inside. Shelter mode on.'],
    ['STATUS', 'Heavy day. Carrying it counts as training.'],
    ['LANTERN', 'Today is a rest-and-recover floor.'],
    ['STATUS', 'Everything is loud. Volume down where possible.'],
    ['QUEST LOG', "Main quest today: get through it. That's plenty."],
    ['WEATHER', 'Fog in every direction. Moving slowly is still moving.'],
    ['LANTERN', 'Not okay today. That is a valid status.'],
    ['STATUS', 'Shields up. Small steps, soft landings.'],
    ['WEATHER', 'Grey skies, no forecast. Taking it hour by hour.'],
    ['STATUS', "Tired in a way sleep doesn't touch. Going gently."],
    ['LANTERN', 'Hard mode, unasked for. Still playing.'],
    ['NOTICE', 'Feelings at full volume. Riding the wave, not fighting it.'],
    ['BUFF', 'Blanket equipped. Defence up, expectations down.'],
    ['INVENTORY', 'Low energy. Potions allowed, no questions asked.'],
  ]),
  mid: L('mid', [
    ['STATUS', 'Steady. Nothing to prove today.'],
    ['LANTERN', 'Quiet run today. No boss fights scheduled.'],
    ['WEATHER', 'Partly cloudy. Some sun, some not. Both fine.'],
    ['STATUS', 'Somewhere in the middle. The middle is a real place.'],
    ['QUEST LOG', 'Side-quest day. The main story can wait.'],
    ['NOTICE', 'Mixed feelings, all of them valid. Holding more than one.'],
    ['STATUS', 'Wanderer on standby. Recharging between floors.'],
    ['LANTERN', 'Ordinary day. Ordinary is underrated.'],
    ['LANTERN', 'Thinking a lot, saying a little. Both allowed.'],
    ['WEATHER', 'Light drizzle inside. Hood up, carrying on.'],
    ['STATUS', 'Half-charged and fine with it.'],
    ['LANTERN', 'One room of the dungeon at a time.'],
    ['STATUS', 'Neutral. A good place to set the controller down.'],
    ['NOTICE', 'Low-key mode. Something comfy and a good show recommended.'],
    ['NOTICE', 'Not great, not bad. Honest, though.'],
  ]),
  up: L('up', [
    ['STATUS', 'Good day. Enjoy it, no strings attached.'],
    ['BUFF', 'Main-character energy, mild. Duration: today.'],
    ['WEATHER', 'Clear skies inside. Visibility excellent.'],
    ['RANK', 'S-rank mood today. The Lantern agrees.'],
    ['LANTERN', 'Something small went right. Logged and kept.'],
    ['STATUS', 'Cosy and content. No notes.'],
    ['BUFF', 'Laughed today. Morale +5.'],
    ['LANTERN', 'Creative mode on. Making something today.'],
    ['QUEST LOG', 'Good game today. GG.'],
    ['STATUS', 'Soft day. Warm drink, good music, no rush.'],
    ['LANTERN', 'Energy restored. Spending it on things worth it.'],
    ['STATUS', 'Brave enough today. That counts double.'],
    ['WEATHER', 'Sun breaking through. Windows open.'],
    ['NOTICE', 'Grateful for one small thing. One is plenty.'],
    ['BUFF', 'Moth luck. Drifting toward the light today.'],
  ]),
};

export const LINE_COPY = {
  title: "Today's line",
  ask: 'Pick the one that fits today. Only you ever see it.',
  others: 'Three others',
  change: 'Change',
  history: 'Your lines',
  historySub: 'The lines you picked, newest first. They stay on this device.',
  historyEmpty: "Pick a line on the Lantern page and it's kept here.",
};

/** Art room. Every mark is a creation, never a test: no grading, no "good drawing", no scores. */
export const ART = {
  title: 'Art room',
  sub: 'Draw with Lantern light. Nothing here is graded, and it stays on this device.',
  todayTitle: 'Draw today',
  todaySub: 'A prompt to start from. Swap it or drop it, any time.',
  allyTitle: 'Design a shadow ally',
  allySub: 'Your drawing becomes the art on a new Shadow card.',
  allyHint: 'Draw an ally for the Night Watch. Any shape counts.',
  pages: 'Your pages',
  pagesEmpty: 'Nothing here yet. Scribbles count.',
  draft: 'An unfinished page is waiting for you.',
  saved: 'Saved in your Art room.',
  savedAgain: 'Saved again.',
  clearAsk: 'Clear the page? Undo can bring it back.',
  nameAsk: 'Name your ally',
  nameHint: 'Optional. You can leave it as Shadow ally.',
  risen: 'A new ally steps out of the dark. It joins the Night Watch.',
  noStore: "This browser isn't keeping drawings right now. Save to Photos keeps a copy.",
  favourite: 'Favourite',
  rename: 'Rename',
  pageNameAsk: 'Name this page',
  removed: 'Page removed.',
  released: 'Ally released.',
};

/** Optional prompts for "Draw today". Offered one at a time; "Another" moves on; "No prompt" hides it. */
export const ART_PROMPTS = [
  'Draw the weather inside.',
  'Draw something that made today a little softer.',
  'Draw a place you would like to rest.',
  'Draw today as one colour and one shape.',
  'Draw a small creature keeping you company.',
  'Draw the sound of a song you like.',
  'Draw a door to somewhere calm.',
  'Draw what a good night looks like.',
  'Draw your energy right now as a creature.',
  'Draw something you can see from where you are.',
  'Draw a tiny dungeon with a cosy room in it.',
  'Draw a shield for today.',
  'Draw a sky you would like to see.',
  'Draw a snack, very seriously.',
  'Draw a feeling as a shape. Then give it a friend.',
  'Draw a lantern for a dark floor of the dungeon.',
  'Draw {companion} on an adventure.',
  'Draw anything, with no plan at all.',
];

/** The Wardrobe's try-on bar: a tapped look shows on the screen, and nothing is saved until it is kept. */
export const TRY_ON = {
  label: 'Trying on a look',
  trying: (names: string[]) => `Trying on ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}. Nothing is saved until you keep it.`,
  keep: 'Keep this look',
  back: 'Go back',
};

/** Name ideas for a shadow ally. Original, gentle, no lore names. */
export const ALLY_NAMES = ['Ember', 'Moss', 'Drift', 'Inkling', 'Hush', 'Pebble', 'Wisp', 'Nightcap', 'Thistle', 'Tidewatch'];
