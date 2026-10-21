/**
 * Wave 2: the shadow roster, titles, wardrobe and inventory. Everything here unlocks from what she has already done
 * (distinct visit days, skills, rest, rank) and nothing is ever taken back. The System's voice: dry, kind, no orders.
 * Lore lines say who a shadow is, never how it joined. Beru is only ever an emblem.
 */

export const SHADOW_IDS = ['igris', 'iron', 'tank', 'kaisel', 'beru', 'block', 'bellion'] as const;
export type ShadowId = (typeof SHADOW_IDS)[number];

export interface ShadowDef {
  id: ShadowId;
  /** lore name; the blocky one has none */
  name: string;
  role: string;
  idle: string;
  /** distinct visit days it arrives on */
  at: number;
  /** not shown as a locked outline: it simply turns up */
  hidden?: boolean;
}

export const ROSTER: ShadowDef[] = [
  { id: 'igris', name: 'Igris', role: 'Knight commander', idle: "Igris has the night shift. You're off duty.", at: 1 },
  { id: 'iron', name: 'Iron', role: 'Heavy knight', idle: "Iron volunteered to take today's damage. He's thrilled.", at: 3 },
  { id: 'tank', name: 'Tank', role: 'Bear, mostly asleep', idle: "Tank found the corner of the Stealth room. He's not moving, and nobody is asking him to.", at: 6 },
  { id: 'kaisel', name: 'Kaisel', role: 'Sky escort', idle: 'Kaisel is circling. When your rank goes up, he flies one lap.', at: 9 },
  {
    id: 'beru',
    name: 'Beru',
    role: 'Royal guard, emblem only',
    idle: "Beru would like it on record that you are 'magnificent, my Monarch.' The System has asked him to tone it down.",
    at: 13,
  },
  { id: 'block', name: 'Unlisted', role: 'Made of cubes', idle: "One shadow is made entirely of cubes. It wasn't in the plan. It's staying.", at: 17, hidden: true },
  { id: 'bellion', name: 'Bellion', role: 'Grand marshal', idle: 'Bellion reports that everything is in order. He checked twice. It was already in order.', at: 28 },
];

export const ROSTER_COPY = {
  title: 'Shadow roster',
  sub: 'One arrives every few visits. They stay.',
  nameLabel: 'Your name for them',
  namePlaceholder: 'Optional',
  arrives: (n: number) => (n <= 1 ? 'Arrives next visit' : n > 10 ? 'Arrives in its own time' : `Arrives in ${n} visits`),
};

/** Titles are earned by using things and never lost. 'shadow-monarch' keeps its own rank window. */
export const TITLE_IDS = ['professional-lurker', 'left-the-lobby', 'self-healer', 'default-skin-day', 'shadow-monarch'] as const;
export type TitleId = (typeof TITLE_IDS)[number];
export const TITLES: Record<TitleId, { name: string; line: string }> = {
  'professional-lurker': { name: 'Professional Lurker', line: 'Nobody is watching. Not even the System.' },
  'left-the-lobby': { name: 'Left the Lobby', line: 'Stepped out between matches. The queue will survive.' },
  'self-healer': { name: 'Self-Healer', line: 'No healer in range. You covered it yourself.' },
  'default-skin-day': { name: 'Default Skin Day', line: 'No expectations equipped. Do whatever you want.' },
  'shadow-monarch': { name: 'Shadow Monarch', line: 'The shadows answer to you.' },
};
export const TITLE_COPY = {
  kicker: '[TITLE UNLOCKED]',
  label: 'Title',
  choose: 'Equip a title',
  none: 'No title yet',
  newest: 'Newest',
};

export const CLASS_LINE = { k: 'Class', v: 'Support', specialty: 'Specialty: keeping the party standing.' };

/** Wardrobe: looks that unlock with distinct visit days (or rank) and stay. Defaults are always there. */
export const THEME_IDS = ['classic', 'mint', 'night', 'gold'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const ACCENT_IDS = ['blue', 'green'] as const;
export type AccentId = (typeof ACCENT_IDS)[number];
export const CARD_BACK_IDS = ['ring', 'gate', 'crown'] as const;
export type CardBackId = (typeof CARD_BACK_IDS)[number];
export const PLATE_IDS = ['plain', 'ticks', 'gold'] as const;
export type PlateId = (typeof PLATE_IDS)[number];

export interface Look {
  name: string;
  /** distinct visit days; 0 = from the start */
  days: number;
  /** or this rank index (0 E .. 5 S), whichever comes first */
  rank?: number;
}
export const THEMES: Record<ThemeId, Look> = {
  classic: { name: 'Classic blue', days: 0 },
  mint: { name: 'Mint', days: 3 },
  night: { name: 'Night', days: 7 },
  gold: { name: 'Gold cloud', days: 12, rank: 2 },
};
export const ACCENTS: Record<AccentId, Look> = {
  blue: { name: 'System blue', days: 0 },
  green: { name: 'Green', days: 5 },
};
export const CARD_BACKS: Record<CardBackId, Look> = {
  ring: { name: 'Tick ring', days: 0 },
  gate: { name: 'Gate', days: 4 },
  crown: { name: 'Monarch sigil', days: 10 },
};
export const PLATES: Record<PlateId, Look> = {
  plain: { name: 'Plain', days: 0 },
  ticks: { name: 'Corner ticks', days: 2 },
  gold: { name: 'Gold trim', days: 15 },
};

export const WARDROBE_COPY = {
  title: 'Wardrobe',
  sub: 'Looks you have unlocked. They stay unlocked.',
  theme: 'System window',
  accent: 'Accent',
  cardBack: 'Card back',
  plate: 'Name plate',
  preview: 'Notification',
  previewLine: 'Everything is where you left it.',
  locked: (n: number, rank?: string) => (rank ? `Arrives at ${rank}-Rank, or in ${n} ${n === 1 ? 'visit' : 'visits'}` : `Arrives in ${n} ${n === 1 ? 'visit' : 'visits'}`),
};

export const SUNFLOWER = {
  label: (n: number) => `Sunflower, ${n} ${n === 1 ? 'petal' : 'petals'}. It only grows.`,
  toast: '[ITEM] Sunflower. One petal for every day you have visited. It only grows.',
  petalCap: 21,
};

export const INVENTORY = {
  title: 'Inventory',
  sub: 'Items picked up along the way.',
  tacoAt: 5,
  taco: { name: 'Legendary Taco', line: 'Item acquired: Legendary Taco. Does nothing. Extremely powerful.', rarity: 'Legendary' },
  empty: 'Empty slot. Something turns up eventually.',
};
