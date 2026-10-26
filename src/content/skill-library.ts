/**
 * Finding a skill in the Skills list: what each filter offers and which skills it shows. Everything here is scripted
 * browsing the player chooses. A need is a way in, never a reading of how someone is doing.
 */
import { MODULES, MODULE_ORDER, type ModuleId } from './dbt';

export type NeedId = 'pause' | 'feelings' | 'talk' | 'kind' | 'ahead' | 'accept' | 'present';

/** Each need, in the order the list offers them, with the skills that fit it. A skill can fit several, or none. */
export const NEEDS: { id: NeedId; label: string; skills: string[] }[] = [
  { id: 'pause', label: 'A pause', skills: ['stop', 'leave-lobby', 'wise-mind', 'tipp', 'body-scan', 'mindful-thoughts', 'lie-low', 'cool-air', 'supplies', 'volume-down', 'queue-up'] },
  {
    id: 'feelings',
    label: 'Strong feelings',
    skills: ['tipp', 'stop', 'leave-lobby', 'accepts', 'self-soothe', 'improve', 'pros-cons', 'radical-acceptance', 'urge-surf', 'alternate-rebellion', 'name-emotion', 'check-facts', 'opposite-action', 'current-emotion', 'emotion-myths', 'cool-air', 'absurd-scroll', 'queue-up'],
  },
  { id: 'talk', label: 'A difficult conversation', skills: ['dear-man', 'give', 'fast', 'validation', 'clarifying-priorities', 'asking-intensity', 'interpersonal-myths', 'reinforcement', 'dialectics', 'mindfulness-of-others', 'cope-ahead'] },
  { id: 'kind', label: 'Kindness for myself', skills: ['loving-kindness', 'self-validation', 'self-soothe', 'clear-sight', 'abc-please', 'warm-hands', 'volume-down', 'supplies', 'flavour-tier', 'lie-low'] },
  { id: 'ahead', label: 'Something coming up', skills: ['cope-ahead', 'problem-solving', 'pros-cons', 'check-facts', 'effectively', 'dear-man', 'clarifying-priorities', 'asking-intensity', 'long-term-positives', 'absurd-scroll'] },
  { id: 'accept', label: 'Accepting what is', skills: ['radical-acceptance', 'turning-the-mind', 'willingness', 'willing-hands', 'dialectics', 'improve', 'current-emotion', 'clear-sight'] },
  { id: 'present', label: 'Being present', skills: ['wise-mind', 'sense-up', 'one-mindfully', 'mindful-thoughts', 'body-scan', 'current-emotion', 'flavour-tier', 'mindfulness-of-others'] },
];

export type TimeId = 'up1' | 'up2' | 'up3' | 'open';
/** Time budgets, after Any time. A budget holds a skill whose longest estimate fits inside it. */
export const TIMES: { id: TimeId; label: string; upTo?: number }[] = [
  { id: 'up1', label: 'Up to 1 minute', upTo: 60 },
  { id: 'up2', label: 'Up to 2 minutes', upTo: 120 },
  { id: 'up3', label: 'Up to 3 minutes', upTo: 180 },
  { id: 'open', label: 'No set time' },
];

/**
 * The longest a skill's time label means, in seconds; a range counts as its upper end. Labels that measure something
 * other than the clock (songs, taps, a match) are left out on purpose: those skills, and any with a label not listed
 * here, show under No set time. An estimate is only for finding a skill; it never becomes a countdown.
 */
export const LABEL_SECONDS: Record<string, number> = {
  '30 s': 30,
  '60 s': 60,
  '1 min': 60,
  '90 s': 90,
  '1-2 min': 120,
  '2 min': 120,
  '2.5 min': 150,
  '1-3 min': 180,
  '3 min': 180,
};

export const TOPICS: { id: ModuleId; label: string }[] = MODULE_ORDER.map((id) => ({ id, label: MODULES[id].name }));

export const LIBRARY_COPY = {
  title: 'Skills',
  sub: 'Any skill, any time. Each one counts the moment you open it.',
  find: 'Find a skill',
  search: 'Search',
  searchHint: 'Game or DBT name',
  need: 'Need',
  needAll: 'Anything',
  topic: 'Topic',
  topicAll: 'All topics',
  time: 'Time',
  timeAll: 'Any time',
  all: (n: number) => `All ${n} skills`,
  some: (n: number, of: number) => `${n} of ${of} skills`,
  showAll: 'Show all skills',
  empty: 'Nothing fits all of that.',
  emptySub: 'Try fewer filters, or clear them to see every skill.',
  clear: 'Clear filters',
  favourites: 'Your favourites',
  favouritesSub: 'Pinned by you',
  pin: (sl: string, real: string) => `Pin ${sl} (${real})`,
};
