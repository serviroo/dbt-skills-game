/**
 * Wave 2: the Night Watch roster, titles, wardrobe and inventory. Everything here unlocks from what the player has already done
 * (distinct visit days, skills, rest, rank) and nothing is ever taken back. The Lantern's voice: dry, kind, no orders.
 * Lore lines say who a watcher is, never how it joined. Crest is only ever an emblem.
 */

export const SHADOW_IDS = ['sable', 'anvil', 'bramble', 'vesper', 'crest', 'block', 'harrow'] as const;
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
  { id: 'sable', name: 'Sable', role: 'Captain of the Watch', idle: "Sable has the night shift. You're off duty.", at: 1 },
  { id: 'anvil', name: 'Anvil', role: 'Heavy knight', idle: "Anvil volunteered to take today's damage. He's thrilled.", at: 3 },
  { id: 'bramble', name: 'Bramble', role: 'Bear, mostly asleep', idle: "Bramble found the corner of the Stealth room. He's not moving, and nobody is asking him to.", at: 6 },
  { id: 'vesper', name: 'Vesper', role: 'Sky escort', idle: 'Vesper is circling. When your rank goes up, he flies one lap.', at: 9 },
  {
    id: 'crest',
    name: 'Crest',
    role: 'The Watch emblem',
    idle: "Crest would like it on record that you are doing magnificently. The Lantern has asked it to tone it down.",
    at: 13,
  },
  { id: 'block', name: 'Unlisted', role: 'Made of cubes', idle: "One watcher is made entirely of cubes. It wasn't in the plan. It's staying.", at: 17, hidden: true },
  { id: 'harrow', name: 'Harrow', role: 'Grand marshal', idle: 'Harrow reports that everything is in order. He checked twice. It was already in order.', at: 28 },
];

export const ROSTER_COPY = {
  title: 'The Night Watch',
  sub: 'One arrives every few visits. They stay.',
  nameLabel: 'Your name for them',
  namePlaceholder: 'Optional',
  arrives: (n: number) => (n <= 1 ? 'Arrives next visit' : n > 10 ? 'Arrives in its own time' : `Arrives in ${n} visits`),
};

/** Titles are earned by using things and never lost. 'night-warden' keeps its own rank window. */
export const TITLE_IDS = ['professional-lurker', 'left-the-lobby', 'self-healer', 'default-skin-day', 'night-warden'] as const;
export type TitleId = (typeof TITLE_IDS)[number];
export const TITLES: Record<TitleId, { name: string; line: string }> = {
  'professional-lurker': { name: 'Professional Lurker', line: 'Nobody is watching. Not even the Lantern.' },
  'left-the-lobby': { name: 'Left the Lobby', line: 'Stepped out between matches. The queue will survive.' },
  'self-healer': { name: 'Self-Healer', line: 'No healer in range. You covered it yourself.' },
  'default-skin-day': { name: 'Default Skin Day', line: 'No expectations equipped. Do whatever you want.' },
  'night-warden': { name: 'Night Warden', line: 'The Night Watch answers to you.' },
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
export const ACCENT_IDS = ['blue', 'green', 'violet', 'rose', 'honey'] as const;
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
  gold: { name: 'Gold', days: 12, rank: 2 },
};
export const ACCENTS: Record<AccentId, Look> = {
  blue: { name: 'Lantern blue', days: 0 },
  green: { name: 'Green', days: 0 },
  violet: { name: 'Violet', days: 0 },
  rose: { name: 'Rose', days: 0 },
  honey: { name: 'Honey', days: 0 },
};
export const CARD_BACKS: Record<CardBackId, Look> = {
  ring: { name: 'Tick ring', days: 0 },
  gate: { name: 'Gate', days: 4 },
  crown: { name: 'Warden sigil', days: 10 },
};
export const PLATES: Record<PlateId, Look> = {
  plain: { name: 'Plain', days: 0 },
  ticks: { name: 'Corner ticks', days: 2 },
  gold: { name: 'Gold trim', days: 15 },
};

export const WARDROBE_COPY = {
  title: 'Wardrobe',
  sub: 'Looks you have unlocked. They stay unlocked.',
  theme: 'Lantern window',
  accent: 'Accent',
  cardBack: 'Card back',
  plate: 'Name plate',
  preview: 'Notification',
  previewLine: 'Everything is where you left it.',
  locked: (n: number, rank?: string) => (rank ? `Arrives at ${rank}-Rank, or in ${n} ${n === 1 ? 'visit' : 'visits'}` : `Arrives in ${n} ${n === 1 ? 'visit' : 'visits'}`),
};

export const MOONFLOWER = {
  label: (n: number) => `Moonflower, ${n} ${n === 1 ? 'petal' : 'petals'}. It only grows.`,
  toast: '[ITEM] Moonflower. One petal for every day you have visited. It only grows.',
  petalCap: 21,
};

export const INVENTORY = {
  title: 'Inventory',
  sub: 'Items picked up along the way.',
  pebbleAt: 5,
  pebble: { name: 'Legendary Pebble', line: 'Item acquired: Legendary Pebble. Does nothing. Extremely powerful.', rarity: 'Legendary' },
  empty: 'Empty slot. Something turns up eventually.',
};
