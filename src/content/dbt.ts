/**
 * DBT skills content for the daily companion. All copy is original, written for this app in plain words
 * (Linehan's handouts are named and taught, never reproduced). Voice: the Lantern, kind and brief.
 */

export type ModuleId = 'mind' | 'dt' | 'er' | 'ie';
export type StatId = 'sense' | 'stamina' | 'intelligence' | 'agility';

export const MODULES: Record<ModuleId, { name: string; stat: StatId; statName: string }> = {
  mind: { name: 'Mindfulness', stat: 'sense', statName: 'Sense' },
  dt: { name: 'Distress Tolerance', stat: 'stamina', statName: 'Stamina' },
  er: { name: 'Emotion Regulation', stat: 'intelligence', statName: 'Intelligence' },
  ie: { name: 'Interpersonal', stat: 'agility', statName: 'Agility' },
};
export const MODULE_ORDER: ModuleId[] = ['mind', 'dt', 'er', 'ie'];

export type Answers = Record<string, string | string[] | number | undefined>;
export type Txt = string | ((a: Answers) => string);
/** step id, or 'end' | 'safe' | 'safe:people' (Safe Zone resources) | 'skill:<id>' */
export type Go = string;

export interface Opt {
  label: string;
  value?: string;
  go?: Go;
  /** shown as a quiet lead line on the next screen */
  reply?: string;
}

export type ListId = 'comfort' | 'activities' | 'reasons';
export type Effect = 'saveSoothe' | 'saveMap';
export type Visual = 'ring' | 'drift' | 'wave' | 'tide' | 'hands' | 'cold' | 'glow';

interface Base {
  id?: string;
  title?: Txt;
  go?: Go;
}
export type Step =
  | (Base & { kind: 'intro'; text: string; small?: string; cta?: string })
  | (Base & { kind: 'say'; text: Txt; small?: string; cta?: string; options?: Opt[] })
  | (Base & { kind: 'choice'; text: Txt; key: string; options: Opt[] | ((a: Answers) => Opt[]); multi?: boolean; max?: number; other?: string; small?: string; grid?: boolean })
  | (Base & { kind: 'input'; text: Txt; key: string; placeholder?: string; fills?: string[]; skip?: string; cta?: string; lines?: number; prefix?: (a: Answers) => string })
  | (Base & { kind: 'slider'; text: Txt; key: string; min: number; max: number; ends?: [string, string]; words?: string[] })
  | (Base & { kind: 'breath'; text: Txt; inhale: number; exhale: number; rounds: number; alt?: [number, number]; words?: [string, string] })
  | (Base & { kind: 'timer'; text: Txt; seconds: number | ((a: Answers) => number); start?: string; visual?: Visual; extend?: number; small?: string; options?: Opt[]; big?: Txt; dim?: boolean })
  | (Base & { kind: 'hold'; text: Txt; seconds: number; label: string; done: string; tone?: 'heal' })
  | (Base & { kind: 'tier'; text: Txt; key: string; from: string; tiers: string[] })
  | (Base & { kind: 'count'; text: Txt; n: number; label: string })
  | (Base & { kind: 'pmr'; text: Txt; rounds: number })
  | (Base & { kind: 'cards'; text: Txt; cards: [string, string][] })
  | (Base & { kind: 'list'; text: Txt; list: ListId; key: string; empty: string; fallback: string[] })
  | (Base & { kind: 'checks'; text: Txt; rows: string[] })
  | (Base & { kind: 'draft'; text: Txt; parts: string[] })
  | (Base & { kind: 'map'; text: Txt; options: Opt[] })
  | (Base & { kind: 'highlight'; text: Txt; key: string; words: string[] })
  | (Base & { kind: 'save'; text: Txt; effect: Effect; yes: string; no: string })
  | (Base & { kind: 'branch'; pick: (a: Answers) => Go });

export interface Skill {
  id: string;
  /** game-flavoured name */
  sl: string;
  /** the real DBT skill name, always visible next to it */
  real: string;
  module: ModuleId;
  minutes: string;
  /** one line on the card face */
  card: string;
  steps: Step[];
  /** one of the moves the player already makes (shown as "Your loadout") */
  loadout?: boolean;
  /** card art drawn by widgets.loadoutArt */
  art?: 'mittens' | 'lobby' | 'heal' | 'scroll' | 'tier' | 'air' | 'volume' | 'supplies' | 'queue' | 'lowlight';
}

export const TIPP_CAUTION =
  'Skip cold water and hard exercise if you have a heart condition, take a beta-blocker or a medicine that slows your heart, are allergic to cold, or have an eating disorder. Breathing works for everyone.';
/** Hard movement always comes last, behind "More", with this line. */
export const MOVE_CAUTION = "Skip if you're dizzy, sick or sore. Standing only, easy on the knees.";
/** "Not this time" is always an answer on a loadout card. */
const NOT_THIS_TIME: Opt = { label: 'Not this time', go: 'end:quiet' };

export const LOADOUT_COPY = { title: 'Your loadout', sub: 'Moves you already make.', tag: 'Your loadout' };

const BODY = ['Chest', 'Stomach', 'Throat', 'Face', 'Shoulders', 'Hands', 'Everywhere', 'Not sure'];
const o = (...labels: string[]): Opt[] => labels.map((label) => ({ label }));
const s = (a: Answers, k: string, fb = '') => {
  const v = a[k];
  if (Array.isArray(v)) return v.join(', ') || fb;
  return v === undefined || v === '' ? fb : String(v);
};

const FAMILIES: Record<string, string[]> = {
  Anger: ['Irritated', 'Frustrated', 'Resentful', 'Furious', 'Bitter'],
  Disgust: ['Grossed out', 'Repulsed', 'Contempt', 'Uneasy'],
  Envy: ['Wanting what they have', 'Left out', 'Bitter'],
  Fear: ['Worried', 'Nervous', 'Panicky', 'Dread', 'Overwhelmed'],
  Happiness: ['Content', 'Relieved', 'Proud', 'Excited', 'Cosy'],
  Jealousy: ['Protective', 'Insecure', 'Suspicious', 'Threatened'],
  Love: ['Caring', 'Fond', 'Warm', 'Attached', 'Tender'],
  Sadness: ['Down', 'Lonely', 'Disappointed', 'Hurt', 'Heavy'],
  Shame: ['Embarrassed', 'Exposed', 'Small', 'Humiliated'],
  Guilt: ['Sorry', 'Regretful', 'Remorseful'],
  'Empty or numb': ['Flat', 'Blank', 'Far away', 'Hollow'],
  Mixed: ['A bit of everything', 'Conflicted', 'Foggy'],
};

function appraisal(a: Answers) {
  const sub = Array.isArray(a.sub) && a.sub.length && a.sub[0] !== 'That word is right' ? (a.sub as string[]).join(' and ').toLowerCase() : s(a, 'fam', 'A feeling').toLowerCase();
  const size = typeof a.size === 'number' ? `, ${a.size} of 5` : '';
  const where = a.where && a.where !== 'Not sure' ? (a.where === 'Everywhere' ? ', everywhere' : `, in your ${String(a.where).toLowerCase()}`) : '';
  const head = sub.charAt(0).toUpperCase() + sub.slice(1);
  return `${head}${size}${where}. That's a real feeling, and it makes sense that it's here.`;
}

const feelWord = (a: Answers) => {
  const e = s(a, 'emo', '');
  return !e || e === 'Not sure' ? 'this way' : e.toLowerCase();
};
function healLine(a: Answers) {
  const because = s(a, 'because', 'it mattered.');
  const duo = s(a, 'duo', '');
  return `"It makes sense that I feel ${feelWord(a)} because ${because}"${duo ? ` And the duo line, for you: "${duo}"` : ''} Hold to heal.`;
}
function tierLine(a: Answers) {
  const rows = Array.isArray(a.tiers) ? (a.tiers as string[]) : [];
  const top = rows.filter((r) => r.startsWith('S|')).map((r) => r.slice(2).toLowerCase());
  if (top.length) return `S-tier: ${top.join(' and ')}. Official ruling. The Lantern accepts it.`;
  if (rows.length) return 'Sorted and filed. No S-tier today. Tough crowd.';
  return 'Tasted, if not sorted. That still counts.';
}
const said = (a: Answers, k: string, fb = '') => {
  const v = s(a, k).trim().replace(/[\s.!?]+$/, '') || fb;
  return v.charAt(0).toUpperCase() + v.slice(1);
};
const THOUGHT_PICS: Record<string, string> = {
  clouds: 'Each thought is a cloud. Watch it drift in, cross the sky and drift out.',
  cars: 'Each thought is a car going past. Watch it come and go. No need to get in.',
  leaves: 'Each thought sits on a leaf. Watch the stream carry it away.',
};

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const fullStop = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

const GOALS: Record<string, string[]> = {
  'Being kind': ['Do one kind thing a week', 'Be a bit kinder to myself', 'Help out with something'],
  'Making things': ['Finish one small project', 'Make something each week', 'Learn a new technique'],
  Learning: ['Read one book', 'Start a free course or guide', 'Learn the basics of something new'],
  'Fun and play': ['Try a new game', 'Plan one fun day', 'Pick up an old hobby'],
  Connection: ['Message someone more often', 'Join a club or a server', 'Plan a hangout'],
  'Looking after me': ['Get outside more', 'Wind down earlier at night', 'Make my space cosier'],
  'Doing good work': ['Get on top of one task', 'Finish something I put off', 'Learn one thing for work or school'],
  Adventure: ['Visit somewhere new nearby', "Try something I've never done", 'Take a new route somewhere'],
};
function questLog(a: Answers) {
  const goal = s(a, 'goal');
  const first = s(a, 'first');
  return `**What matters:** ${fullStop(cap(s(a, 'value', 'Something that matters to you')))} ${goal ? `**Goal:** ${fullStop(cap(goal))} ` : ''}**First step:** ${first ? fullStop(cap(first)) : "Pick one when you're ready."}`;
}

const MYTHS: Record<string, string> = {
  "I shouldn't feel this way": "There's no right way to feel. Two people can feel different things about the same moment, and both make sense.",
  "Feeling bad means I'm weak": "Hard feelings come with being a person. They aren't weakness, and saying them out loud takes strength.",
  'This feeling is stupid': 'Every feeling makes sense somewhere. Even an awkward one is usually pointing at something that matters to you.',
  "If they disapprove, I shouldn't feel it": "Your feelings are yours. Someone else not getting them doesn't make them wrong.",
  'Painful feelings should be ignored': "Painful feelings carry information. You don't have to act on them, and you don't have to pretend they aren't there.",
  "Big feelings mean I'm out of control": 'You can feel a lot and still choose what you do next. That part is what skills are for.',
};
const ruleOf = (a: Answers) => s(a, 'myth', 'An old rule').trim();
const patchOf = (a: Answers) => (Object.hasOwn(MYTHS, ruleOf(a)) ? MYTHS[ruleOf(a)] : undefined) ?? "Feelings aren't rules or verdicts. Every one makes sense somewhere, and you still get to choose what you do next.";
const bothAnd = (a: Answers) => s(a, 'pair', "I'm doing my best, but I want to do better.").trim().replace(/,?\s+but\s+/i, ', and ');

export const SKILLS: Skill[] = [
  // ---------------- Mindfulness (Sense) ----------------
  {
    id: 'wise-mind',
    sl: 'Still Center',
    real: 'Wise Mind',
    module: 'mind',
    minutes: '90 s',
    card: 'Find the quiet middle between what you feel and what you know.',
    steps: [
      { kind: 'intro', text: "Part of you feels everything. Part of you thinks everything through. There's a quiet place where the two meet. Let's visit it." },
      { kind: 'breath', text: 'Breathe in and think "wise". Breathe out and think "mind".', inhale: 4, exhale: 6, rounds: 4, words: ['wise', 'mind'] },
      { kind: 'timer', visual: 'drift', seconds: 15, text: 'Picture a small flat stone drifting down through clear water. Slowly. Settling on soft sand. Let your attention settle with it.' },
      { id: 'ask', kind: 'input', key: 'question', text: 'Want to ask Wise Mind something? Ask on the in-breath. Listen on the out-breath. No need to force an answer.', placeholder: 'My question (optional)', skip: 'Skip' },
      { kind: 'say', text: "Whatever came up, or didn't, is okay. Sometimes the answer shows up later.", cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'sense-up',
    sl: 'Sense Up',
    real: 'Observe, Describe, Participate',
    module: 'mind',
    minutes: '2 min',
    card: 'Notice what is here, name it plainly, then do one thing fully.',
    steps: [
      { kind: 'intro', text: 'Three small moves. Notice. Name it. Join in.' },
      { id: 'sight', kind: 'count', n: 3, label: 'Found one', text: '**Observe.** Look around. Find three things you can see. No need to like or dislike them. Only notice.', go: 'touch' },
      { id: 'sound', kind: 'count', n: 3, label: 'Heard one', text: '**Observe.** Go still for a moment and listen. Find three sounds, near or far. Only notice.', go: 'touch' },
      { id: 'touch', kind: 'count', n: 2, label: 'Found it', text: 'Now one more sound. Then one thing touching your skin.' },
      { kind: 'input', key: 'describe', text: '**Describe.** Pick one thing you noticed and describe it like a field report. Only the facts. "Blue mug. Warm. Small chip on the rim."', placeholder: 'Field report (optional)', skip: 'Said it in my head' },
      { kind: 'choice', key: 'showed', text: 'Feelings can be described the same way. "Tired showed up." "A thought that this is hard showed up."', options: o('Tired showed up', 'Worry showed up', 'Calm showed up', 'Something else') },
      { kind: 'choice', key: 'join', text: '**Participate.** Pick one small thing and give it all your attention for 30 seconds.', options: o('Sip a drink', 'Stretch', 'Hum a song', 'Look out a window') },
      { kind: 'timer', seconds: 30, visual: 'ring', text: (a) => `${s(a, 'join', 'This')}. Only this. If your mind wanders, that's normal. Bring it back.` },
      { kind: 'say', text: 'Noticing is a muscle. You used it.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'clear-sight',
    sl: 'Clear Sight',
    real: 'Nonjudgmental Stance',
    module: 'mind',
    minutes: '2 min',
    card: 'Swap one judgment word for facts and feelings. The heat drops.',
    steps: [
      { kind: 'intro', text: 'Words like "stupid", "pathetic" or "ruined" pour fuel on feelings. Facts don\'t. Let\'s swap one.' },
      { kind: 'input', key: 'judged', text: "Think of something you've been judging today. Yourself or someone else. Type it, or hold it in mind.", placeholder: 'The judgment (optional)', skip: 'Holding it in mind' },
      { kind: 'choice', key: 'word', text: 'Find the judgment word in it. "Should." "Awful." "Stupid."', options: o('Found it', 'Not sure') },
      { kind: 'input', key: 'fact', text: 'Now say the same thing as facts and feelings. "I said the wrong thing and I feel embarrassed" instead of "I\'m an idiot."', placeholder: 'Fact version (optional)', skip: 'Said it in my head' },
      { kind: 'choice', key: 'body', text: 'Read the fact version once. Notice your body.', options: o('A bit lighter', 'Same', 'Not sure') },
      { kind: 'say', text: 'If you catch yourself judging, no need to judge the judging. Notice it and return to the facts.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'one-mindfully',
    sl: 'Single Target',
    real: 'One-Mindfully',
    module: 'mind',
    minutes: '2 min',
    card: 'One thing at a time. When your mind wanders off, bring it back.',
    steps: [
      { kind: 'intro', text: "Being pulled in ten directions is tiring. Minds do that, and it isn't your fault. For the next minute, you only do one thing." },
      { kind: 'choice', key: 'one', text: 'Pick one small thing to give all your attention to.', small: 'Close other tabs and let messages wait, if you can.', options: o('Wash one cup', 'Fold a few clothes', 'Draw a little doodle', 'Just breathe'), other: 'My own' },
      { kind: 'timer', seconds: 60, visual: 'ring', extend: 30, text: (a) => `${said(a, 'one', 'This one thing')}. Only this. Your mind will wander. When it does, notice where it went and come back. Again and again.` },
      { kind: 'choice', key: 'drift', text: 'How often did your mind wander off?', options: ['Hardly', 'A few times', 'A lot', 'Lost count'].map((label) => ({ label, reply: 'Wandering is normal. Coming back is the skill, and you did it.' })) },
      { kind: 'say', text: 'Try it once more today with something ordinary. When you walk, only walk. When you listen, only listen. One thing, then the next.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'effectively',
    sl: 'Play the Map',
    real: 'Effectively',
    module: 'mind',
    minutes: '2 min',
    card: "Do what works in the situation you're in, not the one you wish you were in.",
    steps: [
      { kind: 'intro', text: "It's frustrating when being right doesn't fix anything. That feeling makes sense. Here you look for what works in the situation you're actually in." },
      {
        kind: 'choice',
        key: 'what',
        text: "Is there a situation where you're stuck between being right and getting what you need?",
        options: [{ label: 'Something small' }, { label: 'Something big' }, { label: 'Nothing right now', reply: "Then picture a small one, like a queue that won't move when you're in a hurry." }],
      },
      { kind: 'input', key: 'goal', text: 'What do you actually want out of it? Not who wins. The outcome.', placeholder: 'What I want (optional)', fills: ['To be heard', 'To get it sorted', 'To keep the peace', 'To feel okay about myself'], skip: 'Keep it in my head' },
      {
        kind: 'choice',
        key: 'way',
        text: "What's getting in the way?",
        options: [
          ...['Wanting to be right', 'Wanting to win', 'Wanting to get even', 'It should be different'].map((label) => ({ label, reply: 'That makes sense. You can feel it and still set it down for now.' })),
          { label: 'Nothing much', reply: 'Clear road, then.' },
        ],
      },
      {
        kind: 'choice',
        key: 'move',
        text: "Every situation has its own rules, fair or not. Working with them usually gets you further than fighting them. What's one move that would help, even a little?",
        small: 'If someone is hurting you, getting safe is always the move that works.',
        options: o('Ask plainly for what I need', 'Wait until I feel calmer', 'Follow the rule this once', 'Let this one go'),
        other: 'My own move',
      },
      { kind: 'say', text: (a) => `${a.move ? `"${said(a, 'move')}." ` : ''}You picked your goal over the fight. That's the skill.`, cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'mindful-thoughts',
    sl: 'Spectator Mode',
    real: 'Mindfulness of Current Thoughts',
    module: 'mind',
    minutes: '2 min',
    card: "Watch your thoughts go by. You don't have to chase them or obey them.",
    steps: [
      { kind: 'intro', text: "A busy or loud head is hard to be in. That's real. For a minute, you don't have to fix your thoughts or believe them. Only watch them go by." },
      { kind: 'choice', key: 'pic', text: 'Pick a picture for your thoughts.', options: [{ label: 'Clouds crossing the sky', value: 'clouds' }, { label: 'Cars on a quiet road', value: 'cars' }, { label: 'Leaves on a stream', value: 'leaves' }] },
      { kind: 'say', text: 'When a thought shows up, give it a plain label. "A worry." "A plan." "A memory." Then let it move on. No need to push it away or follow it.', cta: 'Ready' },
      { kind: 'timer', seconds: 60, visual: 'tide', extend: 30, text: (a) => `${THOUGHT_PICS[s(a, 'pic', 'clouds')] ?? THOUGHT_PICS.clouds} If you get pulled into one, that's normal. Step back and watch again.` },
      { kind: 'say', text: "Thoughts are only thoughts. They aren't facts, and they aren't orders. You can notice one without doing what it says." },
      {
        kind: 'choice',
        key: 'loud',
        text: 'How loud are your thoughts now?',
        options: [
          { label: 'Quieter', reply: 'You let some go by.', go: 'close' },
          { label: 'About the same', reply: "That's okay. Watching was the practice, not the quiet.", go: 'close' },
          { label: 'Louder', go: 'louder' },
        ],
      },
      { id: 'close', kind: 'say', text: 'Next time a thought grabs you, try putting "I\'m having the thought that..." in front of it. It makes a little space.', cta: 'Done', go: 'end' },
      {
        id: 'louder',
        kind: 'say',
        text: "Thanks for telling me. Some thoughts are loud and heavy, and you don't have to sit with them alone. The Safe Zone is one tap away if you want it.",
        options: [{ label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },

  // ---------------- Distress Tolerance (Stamina) ----------------
  {
    id: 'stop',
    sl: 'Shadow Step',
    real: 'STOP',
    module: 'dt',
    minutes: '60 s',
    card: 'A pause between the feeling and the action.',
    steps: [
      { kind: 'intro', text: 'For the moment right before you act on a big feeling.' },
      { kind: 'hold', seconds: 5, label: 'Hold to freeze', done: 'Frozen. Good.', text: '**S. Stop.** Freeze for a second. Hands still. Nothing needs doing right now.' },
      { kind: 'breath', inhale: 4, exhale: 6, rounds: 1, text: '**T. Take a step back.** One slow breath. If you can, put the phone down or step into another room for a minute.' },
      { kind: 'choice', key: 'inside', multi: true, text: "**O. Observe.** What's happening inside you?", options: o('Racing heart', 'Tight chest', 'Hot face', 'Strong urge', 'Numb', 'Something else') },
      { kind: 'choice', key: 'next', text: '**P. Proceed mindfully.** What would make this better, not worse, an hour from now?', options: o('Wait before replying', 'Take a break', 'Try another skill', 'Talk to someone') },
      { kind: 'say', text: "You paused. That's the hardest part, and you did it.", cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'tipp',
    sl: 'Frost Rune',
    real: 'TIPP',
    module: 'dt',
    minutes: '1-3 min',
    card: "Turn your body's volume down fast when feelings are way too loud.",
    steps: [
      { kind: 'intro', text: "Fast ways to turn your body's volume down when feelings are way too loud.", small: TIPP_CAUTION },
      {
        id: 'pick',
        kind: 'choice',
        key: 'part',
        text: 'Pick one. More can come after.',
        options: [
          { label: 'Slow breathing, 1 min', go: 'paced' },
          { label: 'Squeeze and release, 1 min', go: 'pmr' },
          { label: 'Cool air or cold, 30 s', go: 'cold' },
          { label: 'More', go: 'more' },
        ],
      },
      {
        id: 'cold',
        kind: 'timer',
        title: 'T. Temperature',
        seconds: 30,
        start: 'Start 30 s',
        visual: 'cold',
        text: 'Open a window or step outside into cool air. Or cold water on your face, or something cold over your eyes and cheeks. Cool, not icy.',
        small: TIPP_CAUTION,
        options: [{ label: "Can't right now", go: 'paced' }],
        go: 'check',
      },
      {
        id: 'more',
        kind: 'say',
        title: 'I. Intense movement',
        text: 'A minute of fast movement can burn off the rush. Only if your body is up for it today.',
        small: MOVE_CAUTION,
        options: [{ label: 'Move for 1 min', go: 'move' }, { label: 'Back to the list', go: 'pick' }],
      },
      { id: 'paced', kind: 'breath', title: 'P. Paced breathing', inhale: 4, exhale: 6, rounds: 6, alt: [5, 7], text: 'Breathe into your belly. In for 4. Out for 6. Slower out than in.', go: 'check' },
      { id: 'pmr', kind: 'pmr', title: 'P. Paired muscle relaxation', rounds: 3, text: 'Breathe in and tighten: fists, shoulders up to your ears, face scrunched. Not so hard it hurts. Breathe out, think "relax", and let it all drop.', go: 'check' },
      {
        id: 'move',
        kind: 'timer',
        title: 'I. Intense exercise',
        seconds: 60,
        start: 'Start 60 s',
        visual: 'ring',
        text: 'Standing, move fast for a minute: march or jog on the spot, shake out your arms and hands. Stop any time.',
        small: `${MOVE_CAUTION} ${TIPP_CAUTION}`,
        options: [{ label: "Can't right now", go: 'paced' }],
        go: 'check',
      },
      { id: 'check', kind: 'choice', key: 'volume', text: 'Is the volume even a little lower?', options: [{ label: 'Lower', go: 'lower' }, { label: 'Same', go: 'same' }, { label: 'Higher', go: 'same' }] },
      { id: 'lower', kind: 'say', text: 'Your body listened. This works any time you need it.', cta: 'Done', go: 'end' },
      {
        id: 'same',
        kind: 'say',
        text: 'Thanks for being honest. Some waves are big. Want to try another part, or open the Safe Zone?',
        options: [{ label: 'Another part', go: 'pick' }, { label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },
  {
    id: 'accepts',
    sl: 'Trade Places',
    real: 'Wise Mind ACCEPTS',
    module: 'dt',
    minutes: '1 min',
    card: 'Swap where your attention is until the wave is smaller.',
    steps: [
      { kind: 'intro', text: "Swap where your attention is for a while. This isn't running away. It's buying time until the wave is smaller." },
      {
        kind: 'choice',
        key: 'kind',
        grid: true,
        text: 'Pick one.',
        options: [
          { label: 'Activities', go: 'a' },
          { label: 'Contributing', go: 'c' },
          { label: 'Comparisons', go: 'c2' },
          { label: 'Emotions', go: 'e' },
          { label: 'Pushing away', go: 'p' },
          { label: 'Thoughts', go: 't' },
          { label: 'Sensations', go: 's' },
        ],
      },
      { id: 'a', kind: 'list', title: 'A. Activities', list: 'activities', key: 'pick', text: 'Something absorbing. Pick one from your list, or add one.', empty: 'Your list is empty for now. A few ideas:', fallback: ['A cosy game', 'One episode of a show', 'Tidy one shelf', 'A short walk'], go: 'timer' },
      { id: 'c', kind: 'choice', title: 'C. Contributing', key: 'pick', text: 'Something kind for someone.', options: o('Send someone a nice message', 'A small favour for someone', 'Something kind for a stranger'), other: 'My own', go: 'timer' },
      { id: 'c2', kind: 'input', title: 'C. Comparisons', key: 'that', text: "Think of a time you got through something hard. You're the same person now.", placeholder: 'That time I... (optional)', skip: 'Thought of one', go: 'timer' },
      { id: 'e', kind: 'choice', title: 'E. Emotions', key: 'pick', text: 'Put on something that brings a different feeling.', options: o('A comedy', 'A hype song', 'Cute animal videos'), other: 'My own', go: 'timer' },
      { id: 'p', kind: 'hold', title: 'P. Pushing away', seconds: 4, label: 'Hold to store', done: 'Stored. It keeps until you decide to look at it.', text: 'Put this in the vault for now. Picture it boxed up and shelved.', go: 'timer' },
      { id: 't', kind: 'choice', title: 'T. Thoughts', key: 'pick', text: 'Fill your mind with something.', options: o('Count blue things in the room', 'Name a song for every letter', 'A puzzle or a word game'), other: 'My own', go: 'timer' },
      { id: 's', kind: 'choice', title: 'S. Sensations', key: 'pick', text: 'Something strong and safe.', options: o('Hold an ice cube', 'A cool shower', 'Squeeze a stress ball', 'A strong mint'), other: 'My own', go: 'timer' },
      {
        id: 'timer',
        kind: 'choice',
        key: 'mins',
        text: 'Want a gentle timer? It only shows here. No alerts.',
        options: [
          { label: '5 min', value: '5', go: 'clock' },
          { label: '10 min', value: '10', go: 'clock' },
          { label: '20 min', value: '20', go: 'clock' },
          { label: 'No timer', go: 'go' },
        ],
      },
      { id: 'clock', kind: 'timer', seconds: (a) => Number(a.mins ?? 5) * 60, visual: 'ring', text: 'Go do it. The quest already counts.', options: [{ label: 'Done early', go: 'end' }], go: 'end' },
      { id: 'go', kind: 'say', text: 'Go do it. This quest already counts, whether or not you open the app again today.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'self-soothe',
    sl: 'Healing Potion',
    real: 'Self-Soothe',
    module: 'dt',
    minutes: '2 min',
    card: "Comfort through the five senses. You don't have to earn it.",
    steps: [
      { kind: 'intro', text: "Be gentle with yourself through your senses. You don't have to earn comfort." },
      { kind: 'choice', key: 'sense', text: 'Pick a sense.', options: o('Sight', 'Sound', 'Smell', 'Taste', 'Touch') },
      {
        kind: 'choice',
        key: 'soothe',
        other: 'My own',
        text: (a) =>
          ({
            Sight: 'Look at something beautiful.',
            Sound: 'Something that sounds like a blanket.',
            Smell: 'A smell that feels like comfort.',
            Taste: 'Something to taste slowly.',
            Touch: 'Something soft or warm.',
          })[s(a, 'sense', 'Touch')] ?? 'Pick one.',
        options: (a) =>
          o(
            ...(({
              Sight: ['The sky or a window', 'A picture you love', 'A soft lamp or a candle'],
              Sound: ['A song that feels safe', 'Rain sounds', 'Quiet, headphones on'],
              Smell: ['A favourite lotion', 'Coffee or tea', 'Fresh air from a window'],
              Taste: ['Something warm to drink', 'One sweet thing, eaten slowly', 'A mint'],
              Touch: ['A blanket', 'A warm shower', 'A soft hoodie'],
            }) as Record<string, string[]>)[s(a, 'sense', 'Touch')],
          ),
      },
      { kind: 'timer', seconds: 120, start: 'Start 2 min', visual: 'glow', text: 'Take a minute or two with it. Slowly. Let it be the only thing.', options: [{ label: "I'm doing it" }] },
      { kind: 'save', effect: 'saveSoothe', text: "Want to save this to your Comfort kit? It'll show up in the Safe Zone too.", yes: 'Save', no: 'No thanks' },
      { kind: 'say', text: 'That was care. It counts.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'improve',
    sl: 'Buff Scroll',
    real: 'IMPROVE the Moment',
    module: 'dt',
    minutes: '1-2 min',
    card: "Make a moment you can't change a little easier to carry.",
    steps: [
      { kind: 'intro', text: "You can't change the situation right now. You can make this moment a little easier to carry." },
      {
        kind: 'choice',
        key: 'buff',
        grid: true,
        text: 'Pick a buff.',
        options: [
          { label: 'Imagery', go: 'apply' },
          { label: 'Meaning', go: 'apply' },
          { label: 'Prayer or quiet', go: 'apply' },
          { label: 'Relaxing', go: 'apply' },
          { label: 'One thing', go: 'apply' },
          { label: 'Vacation', go: 'apply' },
          { label: 'Encouragement', go: 'enc' },
        ],
      },
      {
        id: 'apply',
        kind: 'timer',
        seconds: 30,
        visual: 'glow',
        title: (a) => s(a, 'buff'),
        text: (a) =>
          ({
            Imagery: 'Picture a safe room inside you. Furnish it however you like. Close the door on anything that hurts.',
            Meaning: "Is there anything in this that matters to you, or that it could teach you? It's okay if not yet.",
            'Prayer or quiet': 'If it fits you, pray, or ask your wise mind for strength to carry this for now.',
            Relaxing: 'Unclench your jaw. Drop your shoulders. A warm drink, a stretch, a slow breath.',
            'One thing': 'Only this breath. Only this sip. Only this step.',
            Vacation: 'Take a short, planned break. Twenty minutes under a blanket with a show, then back to it.',
          })[s(a, 'buff')] ?? '',
        go: 'done',
      },
      { id: 'enc', kind: 'choice', key: 'line', title: 'Encouragement', text: 'Pick a line to tell yourself.', options: o("I'm doing the best I can.", 'This feeling will pass.', "I've gotten through hard nights before.", 'I can handle one more minute.'), other: 'Write my own' },
      { kind: 'timer', seconds: 20, visual: 'glow', big: (a) => s(a, 'line'), text: 'Read it once more. Slowly.', go: 'done' },
      { id: 'done', kind: 'say', text: 'Buff applied.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'pros-cons',
    sl: 'Strategy Map',
    real: 'Pros and Cons',
    module: 'dt',
    minutes: '3 min',
    card: 'See the whole map before acting on a strong urge.',
    steps: [
      { kind: 'intro', text: "When an urge pulls hard, let's look at the whole map before you move." },
      { kind: 'input', key: 'urge', text: "What's the urge? Only you will see this. You can keep it vague.", placeholder: 'The urge (optional)', skip: 'Keep it vague' },
      { kind: 'input', key: 'p1', text: 'If you act on it: what might feel good about that?', fills: ['Relief right now', 'Getting it over with'], placeholder: 'Optional', skip: 'Skip' },
      { kind: 'input', key: 'c1', text: 'If you act on it: what might it cost later?', placeholder: 'Optional', skip: 'Skip' },
      { kind: 'input', key: 'p2', text: 'If you ride it out: what could be good about that, later?', placeholder: 'Optional', skip: 'Skip' },
      { kind: 'input', key: 'c2', text: "If you ride it out: what's hard about that?", placeholder: 'Optional', skip: 'Skip' },
      {
        kind: 'map',
        title: "That's real. It is hard.",
        text: 'Look at the whole map. What does Wise Mind say?',
        options: [
          { label: 'Ride it out', value: 'ride', go: 'strong' },
          { label: 'Not sure', value: 'unsure', go: 'honest' },
          { label: 'I still want to', value: 'want', go: 'honest' },
        ],
      },
      { id: 'strong', kind: 'say', text: "That's a strong choice.", go: 'save' },
      {
        id: 'honest',
        kind: 'say',
        text: 'Thanks for being honest. Want to try TIPP first, or open the Safe Zone?',
        options: [{ label: 'TIPP', go: 'skill:tipp' }, { label: 'Safe Zone', go: 'safe' }, { label: 'Next', go: 'save' }],
      },
      { id: 'save', kind: 'save', effect: 'saveMap', text: 'Save this map? You can reread it next time this urge shows up. It lives in your Comfort inventory.', yes: 'Save', no: 'No thanks', go: 'end' },
    ],
  },
  {
    id: 'radical-acceptance',
    sl: "Warden's Calm",
    real: 'Radical Acceptance',
    module: 'dt',
    minutes: '2.5 min',
    card: "Put down the fight with what's already real. With willing hands.",
    steps: [
      { kind: 'intro', text: "For things that already happened, or can't change right now. Accepting isn't approving. It isn't giving up. It's putting down the fight with what's already real." },
      {
        kind: 'say',
        text: 'If someone is hurting you right now, getting safe comes first. Acceptance never means staying somewhere unsafe.',
        options: [{ label: 'Okay' }, { label: 'People to talk to', go: 'safe:people' }],
      },
      { kind: 'choice', key: 'what', text: 'Is there something you keep fighting in your head? "It shouldn\'t be like this."', options: o('Something small', 'Something big', "I'd rather not name it") },
      { kind: 'say', text: 'Try saying it in your head: "This is what happened." Not good. Not fair. Only what happened.', cta: 'Said it' },
      { kind: 'say', text: 'Everything has causes. Lots of things led to this moment, even the parts that hurt.' },
      { kind: 'timer', seconds: 20, visual: 'hands', title: 'Willing hands', text: 'Let your body join in. Unclench your hands. Palms up, fingers loose.' },
      { kind: 'choice', key: 'after', text: 'When the fight stops, sadness can show up. That\'s normal. A calmer feeling usually follows.', options: [{ label: 'Okay', go: 'end' }, { label: "It's a lot", go: 'little' }] },
      { id: 'little', kind: 'say', text: "Then only a little for today. Acceptance happens again and again, one moment at a time. That's called turning the mind.", cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'willing-hands',
    sl: 'Open Gauntlets',
    real: 'Willing Hands and Half-Smile',
    module: 'dt',
    minutes: '90 s',
    card: 'Send your mind a softer message through your body.',
    steps: [
      { kind: 'intro', text: "Your body talks to your mind. Let's send it a softer message." },
      { kind: 'timer', seconds: 10, visual: 'glow', text: 'Relax your face from your forehead down to your jaw. Teeth slightly apart.' },
      { kind: 'timer', seconds: 10, visual: 'glow', text: 'Let the corners of your lips lift a tiny bit. Not a grin. Only enough to feel it. Nobody needs to see it.' },
      { kind: 'timer', seconds: 20, visual: 'hands', text: 'Hands: sitting, rest them on your thighs, palms up, fingers loose. Lying down, palms up by your sides.' },
      { kind: 'timer', seconds: 30, start: 'Start 30 s', visual: 'hands', text: "Now think about what's bothering you, while your hands stay open and your face stays soft.", options: [{ label: 'Skip' }] },
      { kind: 'choice', key: 'shift', text: 'Notice anything shift, even a little?', options: [{ label: 'A little', go: 'end' }, { label: 'Not really', go: 'end' }, { label: 'Not sure', go: 'end' }] },
    ],
  },
  {
    id: 'urge-surf',
    sl: 'Wave Rider',
    real: 'Ride the Wave (Urge Surfing)',
    module: 'dt',
    minutes: '2.5 min',
    card: 'Urges rise, peak and fall. Ride one without fighting or obeying it.',
    steps: [
      { kind: 'intro', text: "Urges rise like waves. They peak, and they fall, even when you don't act on them." },
      { kind: 'choice', key: 'where', text: 'Where do you feel the urge in your body?', options: o('Chest', 'Stomach', 'Hands', 'Throat', 'Head', 'Everywhere', 'Not sure') },
      { kind: 'slider', key: 'before', min: 0, max: 10, text: 'How strong is it right now?', ends: ['Barely there', 'Huge'] },
      { id: 'ride', kind: 'timer', seconds: 90, visual: 'wave', extend: 30, text: 'Picture yourself on a board. Breathe and watch the wave. No need to fight it or obey it. Only ride.' },
      { kind: 'slider', key: 'after', min: 0, max: 10, text: 'How strong is it now?', ends: ['Barely there', 'Huge'] },
      {
        kind: 'branch',
        pick: (a) => {
          const b = a.before, f = a.after;
          if (typeof b !== 'number' || typeof f !== 'number') return 'rode';
          return f < b ? 'lower' : 'long';
        },
      },
      { id: 'lower', kind: 'say', text: 'See? It moved. You rode it.', cta: 'Done', go: 'end' },
      { id: 'rode', kind: 'say', text: 'You stayed on the board. That counts.', cta: 'Done', go: 'end' },
      {
        id: 'long',
        kind: 'say',
        text: 'Some waves are long. You stayed on the board the whole time. Another round, TIPP, or the Safe Zone?',
        options: [{ label: 'Another round', go: 'ride' }, { label: 'TIPP', go: 'skill:tipp' }, { label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },
  {
    id: 'turning-the-mind',
    sl: 'Crossroads',
    real: 'Turning the Mind',
    module: 'dt',
    minutes: '2 min',
    card: 'Caught fighting something that already happened? Turn toward accepting it, again.',
    steps: [
      {
        kind: 'intro',
        text: "Still fighting something that already happened? That makes sense. It hurt, and part of you wants it undone. Accepting isn't one and done. You choose it, then you choose it again.",
        small: "Accepting isn't approving. It never means staying somewhere unsafe.",
      },
      { kind: 'choice', key: 'fight', multi: true, text: '**Notice the fight.** Is any of this here right now? No need to stop it. Only notice.', options: o('"Why me?"', '"This shouldn\'t be happening"', 'Bitterness', 'Wishing it away', 'Something else') },
      { kind: 'hold', seconds: 4, label: 'Hold to turn', done: 'Turned.', text: "**Turn.** Picture a fork in the road. One way keeps fighting what's real. The other accepts it, even if you hate it. Turn toward that one, only for now." },
      { kind: 'choice', key: 'sign', other: 'My own', text: "**Plan for next time.** The fight usually comes back. That's normal. What will tell you it's back?", options: o('A "why me" thought', 'A tight jaw or fists', 'Replaying it in my head', 'Feeling bitter') },
      { kind: 'breath', inhale: 4, exhale: 6, rounds: 3, words: ['notice', 'turn'], text: '**Turn again.** Breathe in and notice the fight. Breathe out and turn.' },
      { kind: 'choice', key: 'after', text: 'Every turn counts, even a small one. How is it now?', options: [{ label: 'A bit lighter', go: 'done' }, { label: 'About the same', go: 'same' }, { label: "It's a lot", go: 'lot' }] },
      { id: 'done', kind: 'say', text: 'You turned your mind. When the fight comes back, you know the move: notice it, then turn again.', cta: 'Done', go: 'end' },
      { id: 'same', kind: 'say', text: 'Thanks for trying it. Sometimes it takes a lot of turns before anything shifts. Each one still counts.', cta: 'Done', go: 'end' },
      {
        id: 'lot',
        kind: 'say',
        text: 'Thanks for being honest. Then only a little today. Some things take a lot of turning. The Safe Zone is one tap away if you want it.',
        options: [{ label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },
  {
    id: 'body-scan',
    sl: 'Quiet Scan',
    real: 'Body Scan',
    module: 'dt',
    minutes: '2 min',
    card: 'Move your attention slowly from your feet to your head. Only noticing.',
    steps: [
      { kind: 'intro', text: "Wound up, or a bit far away from yourself? That's hard, and it makes sense after a rough stretch. A slow scan can bring you back, one part at a time." },
      { kind: 'say', text: "Sit or lie down, whichever is easier. Close your eyes, or rest them on one spot. Skip any part that doesn't feel okay. If it gets to be too much, open your eyes and look around the room.", cta: 'Ready' },
      { kind: 'timer', seconds: 30, extend: 15, visual: 'glow', title: 'Feet and legs', text: 'Notice your feet. Warm, cool, heavy, tingly, or nothing much. Then slowly up your legs. No need to change anything.' },
      { kind: 'timer', seconds: 30, extend: 15, visual: 'glow', title: 'Back, hands and shoulders', text: 'Notice where your back meets the chair or the bed. Then your hands, up your arms, to your shoulders. Tight is okay. Only notice.' },
      { kind: 'timer', seconds: 30, extend: 15, visual: 'glow', title: 'Face and head', text: 'Your jaw, your cheeks, around your eyes, the top of your head. If something wants to soften, let it.' },
      { kind: 'choice', key: 'after', text: 'Now your whole body at once, for one breath. How does it feel?', options: [{ label: 'A bit calmer', go: 'done' }, { label: 'About the same', go: 'same' }, { label: 'Harder', go: 'hard' }] },
      { id: 'done', kind: 'say', text: 'You checked in with yourself, feet to head. That was care.', cta: 'Done', go: 'end' },
      { id: 'same', kind: 'say', text: "Thanks for trying it. Noticing is the whole skill, and you did it. It doesn't have to feel different yet.", cta: 'Done', go: 'end' },
      {
        id: 'hard',
        kind: 'say',
        text: "Thanks for being honest. Some days, paying attention to your body is a lot. That's okay. Noticing what's around you might fit better.",
        options: [{ label: 'Sense Up', go: 'skill:sense-up@sight' }, { label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },
  {
    id: 'alternate-rebellion',
    sl: 'Off-Script',
    real: 'Alternate Rebellion',
    module: 'dt',
    minutes: '1 min',
    card: 'Want to break the rules? Break a harmless one, on purpose.',
    steps: [
      { kind: 'intro', text: "Sick of rules, plans and being careful? That urge to break out is real, and it makes sense. You can honour it in a way that doesn't hurt you or your goals." },
      { kind: 'choice', key: 'against', other: 'My own', text: 'What are you pushing against today? Any answer makes sense.', options: o('Being told what to do', 'Being bored', 'Always being careful', 'Everything, honestly', 'Not sure') },
      {
        id: 'pick',
        kind: 'choice',
        key: 'rebel',
        other: 'My own',
        text: 'Pick a harmless rebellion. Small is fine.',
        options: o('Wear something mismatched on purpose', 'Take a totally different route', "Blast a song you'd never admit to liking", 'Write a rant, then delete it', 'Rearrange one corner of your room', 'Sit somewhere you never sit'),
      },
      {
        kind: 'choice',
        key: 'check',
        text: (a) => `${s(a, 'rebel', 'Your rebellion').replace(/[.!?\s]+$/, '')}. Quick check: could it hurt you, anyone else, or something you care about?`,
        options: [{ label: "No, it's harmless", go: 'go' }, { label: 'Maybe', go: 'swap' }],
      },
      {
        id: 'swap',
        kind: 'say',
        text: 'Good catch. Pick a gentler one. The best rebellions still feel good tomorrow.',
        options: [{ label: 'Pick again', go: 'pick' }, { label: 'Done', go: 'end' }],
      },
      { id: 'go', kind: 'say', text: 'Go do it. Small, harmless and on purpose still counts as breaking out.', cta: 'Done', go: 'end' },
    ],
  },

  // ---------------- Emotion Regulation (Intelligence) ----------------
  {
    id: 'name-emotion',
    sl: 'Appraise',
    real: 'Name the Emotion',
    module: 'er',
    minutes: '90 s',
    card: 'Name a feeling precisely. Naming turns the volume down a little.',
    steps: [
      { kind: 'intro', text: "Naming a feeling can turn the volume down a little. Let's identify it." },
      { kind: 'choice', key: 'fam', grid: true, text: 'Which kind of feeling is it closest to?', options: o(...Object.keys(FAMILIES)) },
      {
        kind: 'choice',
        key: 'sub',
        multi: true,
        max: 2,
        text: 'Any of these closer? Up to two.',
        options: (a) => o(...(FAMILIES[s(a, 'fam', 'Mixed')] ?? [])),
        other: 'That word is right',
      },
      { kind: 'slider', key: 'size', min: 0, max: 5, text: 'How strong, 0 to 5?', ends: ['Faint', 'Very strong'] },
      { kind: 'choice', key: 'where', text: 'Where is it in your body?', options: o(...BODY) },
      { kind: 'input', key: 'trigger', text: 'What set it off? Optional.', placeholder: 'Optional', skip: 'Skip' },
      // Check the Facts only for calm or mild feelings; heavy ones get comfort first, never reasoning.
      { kind: 'branch', pick: (a) => (typeof a.size === 'number' && a.size <= 2 ? 'mild' : typeof a.size === 'number' && a.size >= 4 ? 'heavy' : 'mid') },
      {
        id: 'mild',
        kind: 'say',
        title: '[Appraisal complete]',
        text: (a) => appraisal(a),
        options: [
          { label: 'Let it be', go: 'skill:current-emotion' },
          { label: 'Check the facts', go: 'skill:check-facts' },
          { label: 'Something soothing', go: 'skill:self-soothe' },
          { label: 'Done', go: 'end' },
        ],
      },
      {
        id: 'mid',
        kind: 'say',
        title: '[Appraisal complete]',
        text: (a) => appraisal(a),
        options: [
          { label: 'Let it be', go: 'skill:current-emotion' },
          { label: 'Absurd Scroll', go: 'skill:absurd-scroll' },
          { label: 'Something soothing', go: 'skill:self-soothe' },
          { label: 'Done', go: 'end' },
        ],
      },
      {
        id: 'heavy',
        kind: 'say',
        title: '[Appraisal complete]',
        text: (a) => `${appraisal(a)} Nothing to fix right now.`,
        options: [
          { label: 'Something soothing', go: 'skill:self-soothe' },
          { label: 'Self-Heal', go: 'skill:self-validation' },
          { label: 'Let it be', go: 'skill:current-emotion' },
          { label: 'Done', go: 'end' },
        ],
      },
    ],
  },
  {
    id: 'check-facts',
    sl: 'True Sight',
    real: 'Check the Facts',
    module: 'er',
    minutes: '3 min',
    card: 'See whether the size of a feeling fits what actually happened.',
    steps: [
      { kind: 'intro', text: "Not to tell you you're wrong. To see the whole picture clearly." },
      {
        kind: 'say',
        text: 'This one works best on a calm or mild day. Heavy right now? Comfort comes first. Facts can wait.',
        options: [{ label: 'Calm or mild. Go on' }, { label: 'Heavy right now', go: 'heavy' }],
      },
      { kind: 'choice', key: 'emo', text: 'Which feeling do you want to look at?', options: o('Anger', 'Fear', 'Sadness', 'Shame', 'Guilt', 'Jealousy', 'Hurt', 'Other') },
      { kind: 'slider', key: 'size', min: 0, max: 5, text: 'How strong is it?', ends: ['Faint', 'Very strong'] },
      { kind: 'input', key: 'happened', text: 'What happened? Only what a camera would have recorded. "A friend walked past without saying hi."', placeholder: 'The facts (optional)', skip: 'Skip' },
      { kind: 'input', key: 'means', text: 'What\'s your mind saying it means? "They\'re annoyed with me."', placeholder: 'Optional', skip: 'Skip' },
      { kind: 'input', key: 'else', text: 'What else could it mean? Name one or two other possibilities.', fills: ["They're busy", "They didn't notice", "They're dealing with their own stuff", 'Not sure'], placeholder: 'Optional', skip: 'Skip' },
      { kind: 'slider', key: 'likely', min: 0, max: 4, text: 'Is your mind expecting something bad to happen? How likely is it, really?', ends: ['Very unlikely', 'Very likely'], words: ['Very unlikely', 'Unlikely', 'Maybe', 'Likely', 'Very likely'] },
      { kind: 'input', key: 'cope', text: 'If the worst did happen, how would you get through it?', placeholder: "I'd use... I'd reach out to... (optional)", skip: 'Skip' },
      {
        kind: 'choice',
        key: 'fit',
        text: 'Does the size of the feeling fit the facts?',
        options: [{ label: 'Yes, it fits', go: 'fits' }, { label: 'Partly', go: 'partly' }, { label: 'Not sure', go: 'unsure' }],
      },
      {
        id: 'fits',
        kind: 'say',
        text: 'Then it fits. Your feeling is giving you real information, and it makes sense. Next could be some comfort, working on the problem, a DEAR MAN, or nothing at all.',
        options: [{ label: 'Self-Soothe', go: 'skill:self-soothe' }, { label: 'Problem Solving', go: 'skill:problem-solving' }, { label: 'DEAR MAN', go: 'skill:dear-man' }, { label: 'Done', go: 'end' }],
      },
      {
        id: 'partly',
        kind: 'say',
        text: "That makes sense. Old hurts can make a new moment feel bigger. That's not your fault.",
        options: [{ label: 'Opposite Action', go: 'skill:opposite-action' }, { label: 'Done', go: 'end' }],
      },
      { id: 'unsure', kind: 'say', text: "That's okay. You looked closely. That's the skill.", cta: 'Done', go: 'end' },
      {
        id: 'heavy',
        kind: 'say',
        text: 'Then not facts today. Heavy feelings get comfort first. No reason needed.',
        options: [{ label: 'Something soothing', go: 'skill:self-soothe' }, { label: 'Self-Heal', go: 'skill:self-validation' }, { label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end:quiet' }],
      },
    ],
  },
  {
    id: 'opposite-action',
    sl: 'Reverse Cast',
    real: 'Opposite Action',
    module: 'er',
    minutes: '2 min',
    card: 'When the urge would make it worse, the opposite move can change the feeling.',
    steps: [
      { kind: 'intro', text: 'Every emotion comes with an urge. When following the urge would make things worse, doing the opposite can change the feeling.' },
      { kind: 'choice', key: 'emo', text: 'Which emotion?', options: o('Fear', 'Anger', 'Sadness', 'Shame', 'Other') },
      {
        kind: 'choice',
        key: 'urge',
        text: 'What does it make you want to do?',
        options: (a) =>
          o(
            ...(({
              Fear: ['Avoid it', 'Run'],
              Anger: ['Snap', 'Attack with words'],
              Sadness: ['Hide in bed', 'Pull away'],
              Shame: ['Hide', 'Shrink away'],
              Other: ['Something else'],
            }) as Record<string, string[]>)[s(a, 'emo', 'Other')],
          ),
      },
      {
        kind: 'choice',
        key: 'check',
        text: 'Wise Mind check. Does the feeling fit the facts, and would following the urge actually help?',
        options: [
          { label: 'It fits, and following it helps', go: 'fits' },
          { label: "It doesn't fit, or it would make things worse", go: 'opp' },
          { label: 'Not sure', go: 'opp' },
        ],
      },
      {
        id: 'fits',
        kind: 'say',
        text: "Then this isn't the skill for now. Your feeling makes sense. Want to work on the problem, or plan what to say?",
        options: [{ label: 'Problem Solving', go: 'skill:problem-solving' }, { label: 'DEAR MAN', go: 'skill:dear-man' }, { label: 'Done', go: 'end' }],
      },
      {
        id: 'opp',
        kind: 'choice',
        key: 'move',
        other: 'My own',
        text: (a) =>
          `The opposite move: ${({
            Fear: 'approach it a little, gently.',
            Anger: 'step back, and be a little kind.',
            Sadness: 'get active, one small thing.',
            Shame: 'stay, head up, and share it with someone safe.',
            Other: 'do the opposite of the urge, one small step.',
          } as Record<string, string>)[s(a, 'emo', 'Other')]} Do it all the way: face, posture, voice. Pick one tiny action.`,
        options: (a) =>
          o(
            ...(({
              Fear: ['One small step toward it', "Open the thing I'm avoiding", 'Say yes to one small plan'],
              Anger: ['Step away and breathe', 'Say one kind thing', 'Soften my voice'],
              Sadness: ['Open the curtains', 'Do one small task', 'Step outside for a minute'],
              Shame: ['Sit up straight, chin up', 'Tell someone safe', 'Do the thing anyway'],
              Other: ['One small opposite step'],
            }) as Record<string, string[]>)[s(a, 'emo', 'Other')],
          ),
      },
      { kind: 'choice', key: 'when', text: 'Do it now, or plan it for later. Feelings follow actions, slowly. It may take a few tries.', options: [{ label: 'Now', go: 'end' }, { label: 'Later', go: 'end' }] },
    ],
  },
  {
    id: 'abc-please',
    sl: 'Status Recovery',
    real: 'ABC PLEASE',
    module: 'er',
    minutes: '2 min',
    card: 'Look after life and body so big feelings take over less often.',
    steps: [
      {
        kind: 'choice',
        key: 'piece',
        title: 'Pick any one piece today',
        text: 'Taking care of you makes big feelings a bit less likely to take over.',
        options: [
          { label: 'A. Accumulate positives', go: 'a' },
          { label: 'B. Build mastery', go: 'b' },
          { label: 'C. Cope ahead', go: 'c' },
          { label: 'PLEASE. Body check', go: 'please' },
        ],
      },
      { id: 'a', kind: 'choice', key: 'a', title: 'A. Accumulate positives', text: 'Plan one small nice thing today. When it happens, be fully there. Let "do I deserve this" float past.', options: o('A favourite song', 'A good snack', 'Some sunlight or fresh air', 'A show I like'), other: 'My own', go: 'body' },
      { id: 'b', kind: 'choice', key: 'b', title: 'B. Build mastery', text: "One thing that's a little hard but doable. Small enough to finish.", options: o('Make the bed', 'Answer one message', 'Five minutes of tidying', 'Five minutes of drawing'), other: 'My own', go: 'body' },
      { id: 'c', kind: 'input', key: 'c', title: 'C. Cope ahead', text: 'Something hard coming up? Describe it in a few words.', placeholder: 'Optional', skip: 'Keep it in my head' },
      { kind: 'choice', key: 'cskill', text: 'Pick a skill to bring with you.', options: o('STOP', 'TIPP breathing', 'Self-validation', 'DEAR MAN') },
      { kind: 'timer', seconds: 30, visual: 'glow', text: (a) => `Picture yourself in it, using ${s(a, 'cskill', 'that skill')}, step by step. See it going okay.` },
      { kind: 'timer', seconds: 10, visual: 'glow', text: 'Now let your shoulders drop. Rehearsal done.', go: 'body' },
      { id: 'please', kind: 'checks', title: 'PLEASE. Body check', text: 'No grades. Only noticing.', rows: ['Body feeling okay, or looked after if it isn\'t?', 'Eaten something today?', 'Steered clear of things that knock your mood around?', 'Sleep okay?', 'Moved your body a little?'], go: 'body' },
      { id: 'body', kind: 'choice', key: 'now', text: 'Want to do one small thing for your body right now?', options: [{ label: 'Water', go: 'end' }, { label: 'A snack', go: 'end' }, { label: 'A stretch', go: 'end' }, { label: 'A few minutes outside', go: 'end' }, { label: 'Not now', go: 'end' }] },
    ],
  },
  {
    id: 'current-emotion',
    sl: 'Ebb and Flow',
    real: 'Mindfulness of Current Emotion',
    module: 'er',
    minutes: '2 min',
    card: 'Let a feeling be here without pushing it away or feeding it.',
    steps: [
      { kind: 'intro', text: 'No fixing. Only letting a feeling be here, like a wave that comes and goes.' },
      { kind: 'choice', key: 'fam', text: 'Name the feeling.', options: o('Anger', 'Fear', 'Sadness', 'Shame', 'Guilt', 'Happiness', 'Empty or numb', 'Mixed') },
      { kind: 'choice', key: 'where', text: 'Where is it in your body? Rest your attention there.', options: o(...BODY) },
      { kind: 'timer', seconds: 60, visual: 'tide', text: "Breathe and watch it. Don't push it away. Don't hold on to it. Don't make it bigger." },
      { kind: 'say', text: "You are not your feeling. You're the one noticing it." },
      { kind: 'choice', key: 'respect', text: 'Can you respect it? It showed up for a reason.', options: [{ label: 'Yes', reply: "That's okay." }, { label: 'Trying', reply: "That's okay." }, { label: 'Not today', reply: "That's okay." }] },
      { kind: 'choice', key: 'size', text: 'Did it change size at all?', options: [{ label: 'Smaller', go: 'end' }, { label: 'Same', go: 'end' }, { label: 'Bigger', go: 'bigger' }] },
      {
        id: 'bigger',
        kind: 'say',
        text: 'Thanks for being honest. Big feelings are allowed. The Safe Zone is one tap away if you want it.',
        options: [{ label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },
  {
    id: 'problem-solving',
    sl: 'Keysmith',
    real: 'Problem Solving',
    module: 'er',
    minutes: '3 min',
    card: 'The feeling fits, so work on the problem. One small step at a time.',
    steps: [
      { kind: 'intro', text: "Something real is in the way, and it makes sense that it's getting to you. When a feeling fits the facts, the problem is the thing to work on. One small piece at a time." },
      {
        kind: 'say',
        text: 'This one needs a little thinking room. Heavy right now? Comfort comes first. The problem will keep.',
        options: [{ label: 'Calm or mild. Go on' }, { label: 'Heavy right now', go: 'heavy' }],
      },
      { kind: 'input', key: 'problem', text: "What's the problem? Stick to the facts, what a camera would see. Keep it vague if you like.", placeholder: 'The problem (optional)', skip: 'Keep it in my head' },
      { kind: 'input', key: 'goal', text: 'What would need to change for this to feel okay? Keep it small and doable. "Have a plan for Friday" beats "fix everything".', placeholder: 'My goal (optional)', skip: 'Skip' },
      { id: 'ideas', kind: 'input', key: 'ideas', lines: 3, text: 'Brainstorm. Every idea counts, even the odd ones. No judging yet. More ideas give you more to choose from.', fills: ['Ask for help', 'Do a smaller piece', 'Look it up', 'Wait a day', 'Say no to something', 'Try a different time'], placeholder: 'Ideas (optional)', skip: 'Thought of some' },
      {
        kind: 'choice',
        key: 'pick',
        text: "Pick the idea most likely to get you there. Torn between two? Go with the one that's easier to start.",
        options: [{ label: 'Got one' }, { label: 'Torn between two', reply: 'Start with the easier one. You can switch later.' }, { label: 'None of them fit', go: 'stuck' }],
      },
      { kind: 'input', key: 'first', text: "What's the first step? Small enough to do today, or even right now.", fills: ['Write it down', 'Look one thing up', 'Send one message', 'Five minutes on it'], placeholder: 'First step (optional)', skip: 'Skip' },
      { kind: 'choice', key: 'try', text: "Try it, then see how it went. If it doesn't fit, nothing's lost. Come back and try another idea.", options: [{ label: 'Trying it now', go: 'end' }, { label: 'Later', go: 'end' }, { label: 'Only planning', go: 'end' }] },
      {
        id: 'stuck',
        kind: 'say',
        text: "That happens. Some problems need more ideas, more information or a night's sleep. Coming back to it later counts as a step.",
        options: [{ label: 'More ideas', go: 'ideas' }, { label: 'Done for now', go: 'end' }],
      },
      {
        id: 'heavy',
        kind: 'say',
        text: 'Then the problem waits. Heavy feelings get comfort first. No reason needed.',
        options: [{ label: 'Something soothing', go: 'skill:self-soothe' }, { label: 'Safe Zone', go: 'safe' }, { label: 'Done', go: 'end:quiet' }],
      },
    ],
  },
  {
    id: 'long-term-positives',
    sl: 'Main Quest',
    real: 'Long-Term Positives',
    module: 'er',
    minutes: '2 min',
    card: 'Pick something that matters to you and take one small step toward it.',
    steps: [
      { kind: 'intro', text: 'If life has felt like all chores lately, that makes sense. A nice moment helps today. This one is about the longer term: one small step toward something you care about.' },
      {
        kind: 'choice',
        key: 'value',
        grid: true,
        text: 'Pick one thing that matters to you. Not what should matter. What does.',
        small: 'Not sure? Pick the one that feels closest. You can change it any time.',
        options: o(...Object.keys(GOALS)),
        other: 'My own',
      },
      {
        kind: 'choice',
        key: 'goal',
        text: (a) => `${cap(s(a, 'value', 'Something'))} matters to you. What's one goal that fits, something that could happen in the next month or so?`,
        options: (a) => o(...((Object.hasOwn(GOALS, s(a, 'value')) ? GOALS[s(a, 'value')] : undefined) ?? ['One small project', 'More time for it each week', 'Try something new with it'])),
        other: 'My own goal',
      },
      { kind: 'input', key: 'first', text: "Break it down. What's one small first step? So small it's almost too easy.", fills: ['Look something up', 'Write it down', 'Send one message', 'Ten minutes on it'], placeholder: 'First step (optional)', skip: 'Skip' },
      { kind: 'say', title: '[Quest log updated]', text: (a) => questLog(a) },
      { kind: 'choice', key: 'when', text: 'Small steps toward what matters add up. If a step starts to feel like too much, make it smaller. Smaller still counts. When will you try it?', options: [{ label: 'Today', go: 'end' }, { label: 'This week', go: 'end' }, { label: 'Only planning', go: 'end' }] },
    ],
  },
  {
    id: 'emotion-myths',
    sl: 'Patch Notes',
    real: 'Myths About Emotions',
    module: 'er',
    minutes: '2 min',
    card: 'Old rules about feelings, patched with something truer.',
    steps: [
      { kind: 'intro', text: 'Feelings are hard enough on their own. Then old rules about them pile on top, like "I shouldn\'t feel this way." Let\'s look at one and try a kinder thought.' },
      { kind: 'choice', key: 'myth', text: 'Which old rule has been loudest lately?', options: o(...Object.keys(MYTHS)), other: 'A different one' },
      {
        kind: 'timer',
        title: '[Patch notes]',
        seconds: 20,
        extend: 20,
        visual: 'glow',
        text: (a) => `**Old rule:** "${fullStop(cap(ruleOf(a)))}" **Another way to see it:** ${patchOf(a)}`,
        small: 'Read it slowly while the ring runs.',
      },
      {
        kind: 'choice',
        key: 'land',
        text: 'How does that thought sit?',
        options: [
          { label: 'Rings true', reply: 'Good. Keep it handy.' },
          { label: 'Partly', reply: 'Partly is a start. Old rules take a while to update.' },
          { label: "Doesn't fit", reply: "Thanks for being honest. You don't have to agree with it. Reading it still counts." },
        ],
      },
      { kind: 'input', key: 'mine', text: 'Want to put it in your own words? Something to tell yourself next time the old rule shows up.', placeholder: 'My version (optional)', skip: 'Skip' },
      { kind: 'say', text: "Feelings aren't right or wrong. They're information, and you get to decide what to do with them.", cta: 'Done', go: 'end' },
    ],
  },

  // ---------------- Interpersonal (Agility) ----------------
  {
    id: 'dear-man',
    sl: "Commander's Voice",
    real: 'DEAR MAN',
    module: 'ie',
    minutes: '3 min',
    card: 'Ask for something or say no, clearly and calmly. Drafts only.',
    steps: [
      { kind: 'intro', text: 'Build a clear, kind way to ask for something or say no. This only makes a draft. Nothing gets sent.' },
      { kind: 'input', key: 'who', text: 'Who is it for, and what do you want? Short is fine.', placeholder: 'Optional', skip: 'Skip' },
      { kind: 'input', key: 'd', title: 'D. Describe', text: 'The facts only. "You said you\'d send the files Friday. It\'s Monday."', placeholder: 'The facts', skip: 'Skip' },
      { kind: 'input', key: 'e', title: 'E. Express', text: 'How you feel, starting with "I". "I feel stressed about the deadline."', placeholder: 'I feel...', skip: 'Skip' },
      { kind: 'input', key: 'a', title: 'A. Assert', text: 'Ask clearly, or say no clearly. "Could you send them by tonight?"', placeholder: 'Could you... / No, I...', skip: 'Skip' },
      { kind: 'input', key: 'r', title: 'R. Reinforce', text: 'What\'s good for them if they say yes? "Then I can finish my part and we\'re both done."', placeholder: 'Then...', skip: 'Skip' },
      { kind: 'input', key: 'man', title: 'M A N', text: 'Stay on your point, even if the talk drifts. Sound steady. Be willing to meet in the middle. What could you offer?', placeholder: 'I could... (optional)', skip: 'Skip' },
      { kind: 'draft', text: "Here's your draft.", parts: ['d', 'e', 'a', 'r', 'man'] },
      { kind: 'choice', key: 'send', text: 'Wise Mind check before sending. If your feelings are at 4 or 5 right now, waiting an hour is a power move.', options: [{ label: 'Send later', go: 'end' }, { label: 'Send now', go: 'end' }, { label: 'Only practising', go: 'end' }] },
    ],
  },
  {
    id: 'give',
    sl: 'Guild Bond',
    real: 'GIVE',
    module: 'ie',
    minutes: '2 min',
    card: 'Keep the connection good while you talk.',
    steps: [
      { kind: 'intro', text: 'For when the relationship matters most. Keep the connection while you talk.' },
      { kind: 'say', title: 'G. Gentle', text: 'No attacks, threats or put-downs, even when it\'s hard. A "no" can be tolerated.' },
      { kind: 'say', title: 'I. Interested', text: 'Listen to their side. Let them finish. Be patient if they need time.' },
      { kind: 'input', key: 'v', title: 'V. Validate', text: 'Show you get how they see it. "I can see this is hard for you, and..."', placeholder: 'My validating line (optional)', skip: 'Skip' },
      { kind: 'say', title: 'E. Easy manner', text: 'A little lightness. Soft, not stiff. A small smile helps.' },
      { kind: 'choice', key: 'first', text: 'Which one will you try first?', options: [{ label: 'Gentle', go: 'end' }, { label: 'Interested', go: 'end' }, { label: 'Validate', go: 'end' }, { label: 'Easy manner', go: 'end' }] },
    ],
  },
  {
    id: 'fast',
    sl: "Wanderer's Code",
    real: 'FAST',
    module: 'ie',
    minutes: '2 min',
    card: 'Keep your self-respect when you ask or hold a line.',
    steps: [
      { kind: 'intro', text: 'For keeping your self-respect when you ask for something or hold a line.' },
      { kind: 'say', title: 'F. Fair', text: 'Fair to them, and fair to you. Your feelings count too.' },
      {
        kind: 'highlight',
        key: 'msg',
        title: 'A. No over-apologising',
        text: 'No sorry for having needs, an opinion, or for being here. Writing a message? You can paste it here. It stays on this device, and nothing gets looked at unless you ask.',
        words: ['sorry', "i know i'm annoying", "i'm annoying", "i'm too much", 'ignore me', 'my bad', 'i hate to bother', 'if it\'s not too much trouble', "i'm probably wrong", 'no worries if not', 'sorry to bother'],
      },
      { kind: 'choice', key: 'values', multi: true, title: 'S. Stick to your values', text: 'What matters to you here?', options: o('Honesty', 'Kindness', 'Fairness', 'My health', 'My time'), other: 'My own' },
      { kind: 'say', title: 'T. Truthful', text: "No exaggerating, no acting more helpless than you are, no excuses you don't need.", cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'validation',
    sl: 'Ally Shield',
    real: 'Validation',
    module: 'ie',
    minutes: '2 min',
    card: "Show someone their feelings make sense, even when you don't agree.",
    steps: [
      { kind: 'intro', text: "Showing someone their feelings make sense, even when you don't agree." },
      {
        kind: 'cards',
        text: 'Six ways to validate. Swipe through.',
        cards: [
          ['Pay attention', 'Put the phone down. Look at them. Listen to the whole thing.'],
          ['Reflect back', 'Say what you heard, in your words. "So it felt like nobody noticed."'],
          ['Read the unsaid', 'Notice what they might feel but haven\'t said. Then check: "Is that right?"'],
          ['Their story', 'Given what they\'ve lived through, it makes sense they\'d feel this.'],
          ['Valid right now', 'Anyone would feel something here. Say so.'],
          ['As an equal', 'Not fragile, not a project. A person, the same as you.'],
        ],
      },
      {
        kind: 'choice',
        key: 'pick',
        text: 'A friend says: "I threw the match for the whole team and I feel so stupid." Which reply validates?',
        options: [
          { label: "It's one match, get over it.", go: 'why' },
          { label: 'You should practise more.', go: 'why' },
          { label: "That's really frustrating, especially after how hard you played.", go: 'why' },
        ],
      },
      { id: 'why', kind: 'say', text: 'The third one. It names the feeling and shows why it makes sense. Advice can come later, if they want it.' },
      { kind: 'input', key: 'line', text: 'Want to write one for someone in your life? "It makes sense that you ___ because ___."', placeholder: 'It makes sense that you...', skip: 'Skip', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'self-validation',
    sl: 'Self-Heal',
    real: 'Self-Validation',
    module: 'ie',
    minutes: '90 s',
    card: 'No healer in range? You can still heal yourself.',
    art: 'heal',
    steps: [
      { kind: 'intro', text: 'No healer in range? You can still heal yourself.' },
      { kind: 'choice', key: 'emo', text: "What's hurting?", options: o('Sad', 'Hurt', 'Anxious', 'Angry', 'Ashamed', 'Tired', 'Lonely', 'Mixed', 'Not sure') },
      {
        kind: 'choice',
        key: 'because',
        text: (a) => `"It makes sense that I feel ${feelWord(a)} because..."`,
        small: 'Tap an ending. Any of them is true enough.',
        options: o('it mattered.', 'I tried hard.', "I'm running on empty.", "I'm not sure, and that's fine."),
        other: 'My own ending',
      },
      {
        kind: 'choice',
        key: 'duo',
        text: 'What would you tell your duo if they felt this? Optional.',
        options: [{ label: 'Take your time. No rush.' }, { label: 'That was a lot. You did fine.' }, { label: "Rest. I've got this round." }, { label: 'Skip', value: '' }],
        other: 'My own words',
      },
      { kind: 'hold', tone: 'heal', seconds: 5, label: 'Hold to heal', done: 'Self-heal landed.', text: (a) => healLine(a) },
      { kind: 'say', title: '[HEAL]', text: 'Self-heal landed. It counts.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'clarifying-priorities',
    sl: 'Priority Call',
    real: 'Clarifying Priorities',
    module: 'ie',
    minutes: '2 min',
    card: 'The result, the relationship or your self-respect. Pick which one leads this time.',
    steps: [
      { kind: 'intro', text: "Hard talks pull you three ways at once, so it makes sense if this one feels tangled. Let's find which pull matters most this time." },
      { kind: 'input', key: 'talk', text: "Think of one talk that's coming up, or one that keeps replaying in your head. Only you will see this.", placeholder: 'The talk (optional)', skip: 'Keep it in my head' },
      { kind: 'choice', key: 'want', title: 'The result', text: 'What do you want to walk away with?', options: o('A yes to something I asked for', 'My no respected', 'My point taken seriously', 'Not sure yet') },
      { kind: 'choice', key: 'bond', title: 'The relationship', text: 'How do you want things to be between you afterwards?', options: o('As close as before', 'Calm and okay', 'It matters less this time', 'Not sure yet') },
      { kind: 'choice', key: 'self', title: 'Your self-respect', text: 'How do you want to feel about yourself afterwards?', options: o('Honest', 'Fair to both of us', 'Steady, not small', 'Not sure yet') },
      {
        id: 'main',
        kind: 'choice',
        key: 'main',
        text: 'All three count. Only one gets to lead this time. Which one?',
        small: 'It can change from one talk to the next, even with the same person.',
        options: [
          { label: 'The result', go: 'result' },
          { label: 'The relationship', go: 'bond-first' },
          { label: 'My self-respect', go: 'self-first' },
          { label: "Can't pick one", go: 'tie' },
        ],
      },
      { id: 'result', kind: 'say', text: 'Then the result leads. Ask clearly, or say no clearly. Kindness and self-respect still come along, one step behind.', options: [{ label: 'Plan it with DEAR MAN', go: 'skill:dear-man' }, { label: 'Done', go: 'end' }] },
      { id: 'bond-first', kind: 'say', text: "Then the relationship leads. Keep things warm while you talk. You might push a little less today. That's your call to make.", options: [{ label: 'Practise GIVE', go: 'skill:give' }, { label: 'Done', go: 'end' }] },
      { id: 'self-first', kind: 'say', text: "Then your self-respect leads. Stay true to what you value, even if you don't get the yes.", options: [{ label: 'Practise FAST', go: 'skill:fast' }, { label: 'Done', go: 'end' }] },
      {
        id: 'tie',
        kind: 'say',
        text: "That's okay. Try this: which one would hurt most to lose? That one leads. Still a tie? Pick one for now. You can always change it.",
        options: [{ label: 'The result', go: 'result' }, { label: 'The relationship', go: 'bond-first' }, { label: 'My self-respect', go: 'self-first' }, { label: 'Done for now', go: 'end' }],
      },
    ],
  },
  {
    id: 'dialectics',
    sl: 'Split Screen',
    real: 'Dialectics: Both-And',
    module: 'ie',
    minutes: '90 s',
    card: 'Two things can be true at once. Swap "but" for "and".',
    steps: [
      { kind: 'intro', text: "Torn between two sides? That's a tiring place to be. When things are hard, the mind wants one answer: all good or all bad. Most of the time, both sides hold some truth." },
      {
        kind: 'choice',
        key: 'pair',
        text: "Two things that feel like they can't both be true. Pick the one that sounds most like you.",
        options: o("I'm doing my best, but I want to do better.", "I care about them, but I'm upset with them.", 'I want things to change, but change is scary.', 'I need help, but I want to do it myself.'),
        other: 'Write my own',
      },
      {
        kind: 'timer',
        seconds: 20,
        visual: 'glow',
        title: 'But becomes and',
        big: (a) => bothAnd(a),
        text: (a) => (bothAnd(a) === s(a, 'pair', '').trim() ? 'Say it again with an "and" in the middle. Both halves get to stay.' : 'Read it slowly. Both halves get to stay.'),
      },
      {
        kind: 'choice',
        key: 'land',
        text: 'How does the "and" version sit with you?',
        options: [{ label: 'A bit lighter' }, { label: 'Strange, and true' }, { label: 'Same as before', reply: 'That makes sense. It often takes a few tries.' }, { label: 'Not sure', reply: 'Not sure is fine.' }],
      },
      {
        kind: 'choice',
        key: 'spot',
        text: 'Words like "always", "never" and "ruined" squeeze out the other side too. Which line leaves room for both?',
        options: [{ label: '"Everything is ruined."', go: 'room' }, { label: '"This went badly, and parts of it can still be fixed."', go: 'room' }, { label: '"Nothing ever works out."', go: 'room' }],
      },
      { id: 'room', kind: 'say', text: 'The middle one. It\'s honest about the hard part and still leaves room for the rest. Next time you catch a "but", an "always" or a "never", try an "and".', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'mindfulness-of-others',
    sl: 'Co-op Mode',
    real: 'Mindfulness of Others',
    module: 'ie',
    minutes: '2 min',
    card: 'Be with someone more fully. Notice, stay curious, guess less.',
    steps: [
      { kind: 'intro', text: "Being around people can take a lot out of you. Your mind keeps a running commentary: what they think of you, what to say next. That's normal. This helps you be with them a bit more and judge a bit less." },
      {
        kind: 'choice',
        key: 'who',
        text: "Think of someone you'll see or talk to soon. Someone easy is best for practice.",
        small: "If being around someone doesn't feel safe, leave them out of this. Your safety comes first.",
        options: o('A friend', 'Family', 'A teammate', 'Someone at work or school', 'Not sure yet'),
      },
      {
        kind: 'timer',
        title: 'Observe',
        seconds: 30,
        start: 'Start 30 s',
        visual: 'glow',
        extend: 30,
        text: "Next time you're with them, give them your full attention. For now, picture them: their face, their voice, what they're into lately. If a judgment pops up, let it drift past and come back to them.",
      },
      {
        kind: 'choice',
        key: 'fact',
        title: 'Describe',
        text: 'Stick to what you can see and hear. Which one is a fact?',
        options: [{ label: 'They checked their phone twice.', go: 'guess' }, { label: "They don't want to be here.", go: 'guess' }, { label: 'Not sure', go: 'guess' }],
      },
      { id: 'guess', kind: 'say', text: "The first one. A camera could catch it. The second is a guess about what's going on inside them. Guesses can be wrong, so hold them loosely. If it matters, you can ask." },
      { kind: 'say', title: 'Participate', text: 'When you\'re together, join in all the way. Go with the flow of the chat or the game. Less planning your next line, more being there.' },
      {
        kind: 'choice',
        key: 'try',
        text: 'Which one will you try next time?',
        options: [{ label: 'Full attention', go: 'end' }, { label: 'Facts, not guesses', go: 'end' }, { label: 'Join in all the way', go: 'end' }, { label: 'Not sure yet', go: 'end' }],
      },
    ],
  },
  {
    id: 'leave-lobby',
    sl: 'Leave the Lobby',
    real: 'STOP',
    module: 'dt',
    minutes: '1 min',
    card: 'Between matches. Step out of the lobby for one breath. What comes next is your call.',
    art: 'lobby',
    steps: [
      { kind: 'intro', text: 'Rough match? Makes sense. Effort got wasted.' },
      { kind: 'hold', seconds: 3, label: 'Hold for one breath', done: 'Hands free.', text: 'Hands off the keyboard. One slow breath.' },
      { kind: 'choice', key: 'pick', text: 'Pick one.', options: o('Water run', 'Something you can carry solo', 'Stream break', 'One more, eyes open'), go: 'done' },
      {
        id: 'done',
        kind: 'say',
        title: '[QUEST COMPLETE]',
        text: (a) => (a.pick === 'One more, eyes open' ? 'Paused before queuing. Sanity +1. Your call, eyes open.' : 'Left the lobby. Sanity +1. Correct call.'),
        cta: 'Done',
        go: 'end',
      },
    ],
  },

  // ---------------- Your loadout: moves the player already makes ----------------
  {
    id: 'volume-down',
    sl: 'Volume Down',
    real: 'Self-Soothe: sound',
    module: 'dt',
    minutes: '2 songs',
    loadout: true,
    art: 'volume',
    card: 'Loud song first. Then each one a notch calmer.',
    steps: [
      { kind: 'intro', text: 'Start where the feeling is: the loud song. Then step the volume down, one track at a time.' },
      { kind: 'choice', key: 'loud', text: 'Track one: loud. Pick the kind.', options: [...o('The loudest one I have', 'A big chorus', "Whatever's already playing"), NOT_THIS_TIME] },
      { kind: 'choice', key: 'next', text: 'Track two: one notch calmer.', options: [...o('Still a beat, less shouting', 'A slow one', 'Quiet, headphones on'), NOT_THIS_TIME], go: 'go' },
      { id: 'go', kind: 'say', text: "Go play them. Loud first, then down a notch. This'll be here whenever.", cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'supplies',
    sl: 'Step Away for Supplies',
    real: 'ABC PLEASE',
    module: 'er',
    minutes: '1 tap',
    loadout: true,
    art: 'supplies',
    card: 'Water, a snack, a shower, fresh air. Stepping out is a real move.',
    steps: [
      { kind: 'intro', text: 'Step away for supplies. Water, a snack, a shower, fresh air. Leaving the room is a real move.' },
      { kind: 'choice', key: 'pick', text: 'Pick one.', options: [...o('Water', 'A snack, if it sounds okay', 'A shower', 'Fresh air', 'Lie down with water'), NOT_THIS_TIME], go: 'go' },
      { id: 'go', kind: 'say', text: 'Go. This already counts.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'cool-air',
    sl: 'Cool Air',
    real: 'TIPP: Temperature, gentle',
    module: 'dt',
    minutes: '30 s',
    loadout: true,
    art: 'air',
    card: 'A window, a step outside, or something cool on your face. Thirty seconds.',
    steps: [
      { kind: 'intro', text: 'Cool air tells your body to slow down. A window, a step outside, or something cool on your face.', small: 'Cool, not icy.' },
      { kind: 'choice', key: 'pick', text: 'Pick one.', options: [...o('Open a window', 'Step outside', 'Something cool on my face'), NOT_THIS_TIME], go: 'air' },
      { id: 'air', kind: 'timer', seconds: 30, start: 'Start 30 s', visual: 'cold', text: (a) => `${s(a, 'pick', 'Cool air')}. Breathe it in slowly. The timer is optional.`, options: [{ label: 'No timer', go: 'done' }], go: 'done' },
      { id: 'done', kind: 'say', text: 'Cool air in. Thirty seconds of reset, banked.', cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'warm-hands',
    sl: 'Warm Hands',
    real: 'Self-Soothe: touch',
    module: 'dt',
    minutes: '1 tap',
    loadout: true,
    art: 'mittens',
    card: 'Gloves, a warm mug, a blanket. Cold hands get the first heal.',
    steps: [
      { kind: 'intro', text: 'Cold hands first. Warm them up and the rest of you tends to follow.' },
      { kind: 'choice', key: 'pick', text: 'Pick one.', options: [...o('Gloves or mittens', 'A warm mug', 'A blanket', 'Hands under warm water'), NOT_THIS_TIME], go: 'go' },
      { id: 'go', kind: 'say', text: (a) => `${s(a, 'pick', 'Something warm')}. Go get cosy. This already counts.`, cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'absurd-scroll',
    sl: 'Absurd Scroll',
    real: 'Check the Facts',
    module: 'er',
    minutes: '1 min',
    loadout: true,
    art: 'scroll',
    card: 'Scroll a worry to its most ridiculous version. If it turns funny, it was exaggerating.',
    steps: [
      { kind: 'intro', text: "Take a worry and make it the most ridiculous version possible. If it gets funny, the worry was exaggerating. If it doesn't, that tells you something real." },
      { kind: 'say', text: 'Hold the worry in mind. No need to name it here.', options: [{ label: 'Holding it' }, NOT_THIS_TIME] },
      {
        kind: 'choice',
        key: 'twist',
        text: 'Now scroll it to maximum. Pick a twist.',
        options: o('It gets announced on a stadium screen', 'A nature documentary narrates it, very seriously', 'It becomes a boss fight with a full orchestra', 'Historians study it for 400 years', 'A tiny cat files a formal complaint about it'),
        other: 'My own twist',
      },
      { kind: 'say', text: (a) => `Picture it. ${s(a, 'twist', 'The full absurd version')}. Every detail. Soundtrack included.`, cta: 'Pictured it' },
      { kind: 'choice', key: 'funny', text: 'Funny?', options: [{ label: 'Yes', go: 'funny' }, { label: 'A bit', go: 'funny' }, { label: 'No', go: 'real' }] },
      { id: 'funny', kind: 'say', text: 'Then the worry was exaggerating. Scroll closed.', cta: 'Done', go: 'end' },
      {
        id: 'real',
        kind: 'say',
        text: 'Not funny means the feeling may be giving real information. That makes sense, and the scroll still counts.',
        options: [{ label: 'Self-Heal', go: 'skill:self-validation' }, { label: 'Something soothing', go: 'skill:self-soothe' }, { label: 'Done', go: 'end' }],
      },
    ],
  },
  {
    id: 'flavour-tier',
    sl: 'Flavour Tier List',
    real: 'Self-Soothe: taste, Mindfulness',
    module: 'mind',
    minutes: '2 min',
    loadout: true,
    art: 'tier',
    card: 'Two or three different flavours, tasted slowly, sorted into S, A and B.',
    steps: [
      { kind: 'intro', text: 'Two or three things with different flavours. Taste each one slowly, then rank them.', small: 'Not hungry? A cold drink counts.' },
      { kind: 'choice', key: 'lineup', multi: true, max: 3, text: 'Pick the lineup. Up to three.', options: [...o('Something sweet', 'Something sour', 'Something salty', 'Something minty', 'Something spicy', 'A cold drink', 'A warm drink'), NOT_THIS_TIME] },
      { kind: 'timer', seconds: 60, start: 'Start 1 min', visual: 'glow', text: 'Taste each one slowly. The first hit, then the after-taste.', options: [{ label: 'Skip the timer', go: 'rank' }] },
      { id: 'rank', kind: 'tier', key: 'tiers', from: 'lineup', tiers: ['S', 'A', 'B'], text: 'Rank them. Taste is law here.' },
      { kind: 'say', title: '[TIER LIST LOCKED]', text: (a) => tierLine(a), cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'queue-up',
    sl: 'Queue Up',
    real: 'ACCEPTS: Activities',
    module: 'dt',
    minutes: '1 match',
    loadout: true,
    art: 'queue',
    card: 'One match or one scroll, on purpose, as a break.',
    steps: [
      { kind: 'intro', text: 'One match or one scroll, picked on purpose as a break. Choosing it is what makes it a skill.' },
      { kind: 'choice', key: 'pick', text: 'Pick one.', options: [...o('One match', 'One scroll', 'One episode', 'One cosy-game session'), NOT_THIS_TIME], go: 'go' },
      { id: 'go', kind: 'say', text: "Go. No timer. Enjoy it. This'll be here whenever.", cta: 'Done', go: 'end' },
    ],
  },
  {
    id: 'lie-low',
    sl: 'Lie Low',
    real: 'Mindfulness: rest',
    module: 'mind',
    minutes: '1 min',
    loadout: true,
    art: 'lowlight',
    card: 'Lie down in silence for a minute. The screen goes dim with you.',
    steps: [
      { kind: 'intro', text: 'Lie down somewhere. Quiet, or close to it. One minute. Nothing to do.' },
      { kind: 'timer', seconds: 60, start: 'Dim and start', visual: 'ring', dim: true, text: 'Lie low. The ring does the counting.', options: [NOT_THIS_TIME], go: 'done' },
      { id: 'done', kind: 'say', text: 'Low and quiet. That was the whole move.', cta: 'Done', go: 'end' },
    ],
  },
];

export const SKILL = Object.fromEntries(SKILLS.map((k) => [k.id, k])) as Record<string, Skill>;
/** The loadout, in the order the cards are dealt. */
export const LOADOUT = SKILLS.filter((k) => k.loadout).map((k) => k.id);

/** Daily rotation, advanced by visit day (never by calendar day). Distress tolerance early, practised while calm. */
export interface Quest {
  skill: string;
  /** start at this step id (after the intro) */
  entry?: string;
  label?: string;
  special?: 'comfort' | 'free';
}
export const ROTATION: Quest[] = [
  { skill: 'wise-mind' },
  { skill: 'tipp', entry: 'paced', label: 'Paced breathing' },
  { skill: 'name-emotion' },
  { skill: 'self-soothe' },
  { skill: 'self-validation' },
  { skill: 'stop' },
  { skill: 'sense-up', entry: 'sight', label: 'Sight' },
  { skill: 'abc-please', entry: 'a', label: 'A: accumulate positives' },
  { skill: 'willing-hands' },
  { skill: 'give' },
  { skill: 'current-emotion' },
  { skill: 'accepts' },
  { skill: 'clear-sight' },
  { skill: 'check-facts' },
  { skill: 'tipp', entry: 'pmr', label: 'Squeeze and release' },
  { skill: 'validation' },
  { skill: 'improve' },
  { skill: 'opposite-action' },
  { skill: 'urge-surf' },
  { skill: 'fast' },
  { skill: 'abc-please', entry: 'b', label: 'B: build mastery' },
  { skill: 'pros-cons' },
  { skill: 'absurd-scroll' },
  { skill: 'radical-acceptance' },
  { skill: 'dear-man' },
  { skill: 'abc-please', entry: 'c', label: 'C: cope ahead' },
  { skill: 'tipp', entry: 'cold', label: 'Cool air or cold, practised while calm' },
  { skill: 'volume-down' },
  { skill: 'self-soothe', special: 'comfort', label: 'Add one thing to your Comfort inventory' },
  { skill: 'wise-mind', special: 'free', label: 'Free choice' },
  { skill: 'one-mindfully' },
  { skill: 'effectively' },
  { skill: 'mindful-thoughts' },
  { skill: 'emotion-myths' },
  { skill: 'long-term-positives' },
  { skill: 'problem-solving' },
  { skill: 'turning-the-mind' },
  { skill: 'body-scan' },
  { skill: 'alternate-rebellion' },
  { skill: 'clarifying-priorities' },
  { skill: 'dialectics' },
  { skill: 'mindfulness-of-others' },
];

/**
 * One-tap check-in in their own words: a feeling (optional 1-10 where strength means something), answered with one
 * gentle thing. Every answer earns the same XP. Nothing asks for a reason.
 */
export const FEELINGS = ['Calm', 'Okay', 'Tired', 'Anxious', 'Sad', 'Hurt', 'Heated', 'Numb', 'Kaboom', 'Social battery: empty', 'Not sure / a mix'] as const;
export type Feeling = (typeof FEELINGS)[number];

/** Answers where the optional 1-10 means something; anything at 7+ goes comfort-first. */
export const STRENGTH_FEELINGS: readonly Feeling[] = ['Tired', 'Anxious', 'Heated', 'Numb', 'Not sure / a mix'];
const ALWAYS_HEAVY: readonly string[] = ['Sad', 'Hurt', 'Kaboom'];

/** Heavy = the comfort-only screen comes first: Sad, Hurt, Kaboom, or any strength 7-10. */
export function isHeavy(feel: string, level: number | null) {
  return ALWAYS_HEAVY.includes(feel) || (level !== null && level >= 7 && STRENGTH_FEELINGS.includes(feel as Feeling));
}

/** Where a check-in leads. Skill ids that are not in this build fall back to a skill that is. */
export type Next = { to: 'skill'; id: string; entry?: string } | { to: 'rest' } | { to: 'moment'; then?: string };
export interface Suggestion {
  heavy: boolean;
  /** shown first in place of echoing the answer back */
  lead?: string;
  next: Next;
  why: string;
  alt?: { label: string; next: Next };
}

const sk = (id: string, entry?: string): Next => ({ to: 'skill', id, entry });
/** Their own-tool cards (another set of skills) when present; the classic skill otherwise. */
const own = (id: string, fallback: Next): Next => (SKILL[id] ? sk(id) : fallback);

export function suggestFor(feel: Feeling, level: number | null, todaySkill: string): Suggestion {
  const heavy = isHeavy(feel, level);
  switch (feel) {
    case 'Calm':
      return { heavy, next: sk(todaySkill), why: "Calm is a good time to practise. Today's card fits." };
    case 'Okay':
      return { heavy, next: sk('sense-up', 'sight'), why: 'A small warm-up for an ordinary day.' };
    case 'Tired':
      return heavy ? { heavy, next: own('lie-low', { to: 'rest' }), why: 'Lie low. Rested still counts.' } : { heavy, next: { to: 'rest' }, why: 'No task in there. Rested still counts.' };
    case 'Social battery: empty':
      return { heavy, lead: 'Nothing needed from you here.', next: { to: 'rest' }, why: 'The quiet room. No task, nobody to answer.' };
    case 'Not sure / a mix':
      return {
        heavy,
        lead: 'Not sure is a real answer.',
        next: own('lie-low', { to: 'rest' }),
        why: 'Lie low for a minute. Nothing to sort out.',
        alt: heavy ? undefined : { label: 'Name it, if you want', next: sk('name-emotion') },
      };
    case 'Anxious':
      return { heavy, next: sk('tipp', 'paced'), why: 'Slower out than in. Your body listens to that.', alt: heavy ? undefined : { label: 'Give me a moment', next: { to: 'moment' } } };
    case 'Sad':
      return { heavy, next: own('volume-down', sk('self-soothe')), why: "Something gentle. You don't have to earn it." };
    case 'Hurt':
      return { heavy, next: sk('self-validation'), why: 'No healer in range? Self-heal still counts.' };
    case 'Heated': {
      const lobby = !!SKILL['leave-lobby'];
      return {
        heavy,
        next: own('leave-lobby', sk('stop')),
        why: lobby ? 'Between matches. One breath out of the lobby, then your call.' : 'A pause between the feeling and the action.',
        alt: lobby && !heavy ? { label: `${SKILL.stop.sl} instead`, next: sk('stop') } : undefined,
      };
    }
    case 'Numb':
      return { heavy, next: sk('sense-up', 'touch'), why: 'Small, real sensations. One at a time.' };
    case 'Kaboom':
      return { heavy: true, next: sk('tipp', 'paced'), why: 'A quiet minute first. Slow breathing after, if you like.' };
  }
}

/** Safe Zone copy (plain words; theme stays out of the way here). */
export const SAFE = {
  intro: ["You're here.", 'One small step at a time.'],
  breathe: { title: 'Breathe with the light', text: 'In for 4. Out for 6. Slower out than in.' },
  cold: {
    title: 'Cool air, or something cool',
    text: 'Open a window or step outside for cool air. Or cold water on your face, or something cold over your eyes and cheeks. Thirty seconds.',
    small: 'Cool, not icy. Skip cold water if you have a heart condition, take a beta-blocker, are allergic to cold, or have an eating disorder.',
    during: 'Cool tells your body to slow down.',
  },
  light: { up: 'Lights up', down: 'Lights down', hint: 'Dim or bright. Whichever sits better right now.' },
  squeeze: { title: 'Squeeze and release', text: 'Breathe in and squeeze your fists and shoulders. Hold. Breathe out, think "relax", and let everything drop.' },
  check: 'Is it even a little lower?',
  stop: [
    ['Stop.', "You don't have to do anything right now."],
    ['Step back.', 'Put some space between you and the urge. Phone down, or another room, if you can.'],
    ['Notice.', "What's happening inside you? Only notice."],
    ['Next step.', 'What will help you an hour from now?'],
  ] as [string, string][],
  reasons: {
    title: 'Things that are yours',
    text: 'Things you like, want to see, want to do, want to try.',
    empty: "Nothing here yet. Here's one to start: you came here to look after yourself.",
    add: 'Something you like',
  },
  people: { title: 'Your people', text: "Reaching out is allowed. People who care want to know.", empty: 'You can add people you trust here whenever you like.' },
  comfort: { title: 'Your comfort kit', text: 'Pick one and do it now.', empty: 'Nothing saved yet. A blanket, a warm drink and a slow song are good places to start.' },
  talk: {
    title: 'Talk to someone now',
    text: "These are private, and there for exactly this. You don't have to be in danger to reach out.",
    danger: 'If you are in danger right now, call {num}.',
    dangerElsewhere: 'If you are in danger right now, call your local emergency number.',
    emergency: 'If you are in danger right now.',
    country: 'Lines for',
    countryHint: "Change it if this isn't where you are. Nothing is looked up online.",
    elsewhere: 'lists free lines in many countries.',
  },
  settings: { label: 'Country', hint: 'The Safe Zone shows crisis lines for this country. Nothing is looked up online.' },
  close: ['This is here any time, on every screen.', "Go do your thing. This'll be here whenever."],
};

