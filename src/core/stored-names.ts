export const SAVE_KEY = 'dbt.lantern.v1';
export const LAB_SAVE_KEY = 'dbt.lantern.lab';
export const APP_KEY = 'dbt.app.v1';
export const YOU_KEY = 'dbt.you.v1';
export const AUDIO_KEY = 'dbt.audio.v1';
export const COWRITER_KEY = 'dbt.cowriter.v1';
export const INSTALL_HINT_KEY = 'dbt.install-hint.v1';

export const BESIDE = {
  art: '.art',
  story: '.story',
  storyLive: '.story.live',
  unreadable: '.unreadable',
  stealth: '.stealth',
  safeLight: '.safe-light',
  readSize: '.read-size',
  momentLength: '.moment-length',
  /** what was typed in a skill left part way, one key per skill: `<save>.skill-draft.<skill id>` */
  skillDraft: '.skill-draft',
} as const;

/** How long Give me a moment lasts, kept beside the save on this device: about 1 or 3 minutes, or until the player leaves. */
export const MOMENT_LENGTHS = ['1', '3', 'open'] as const;
export type MomentLength = (typeof MOMENT_LENGTHS)[number];

export const ART_DB = { version: 1, stores: ['meta', 'strokes', 'thumbs', 'drafts'] } as const;
export const STORY_DB = { version: 1, stores: ['stories', 'chapters', 'cards', 'days'], chapterIndex: 'story' } as const;

/** The Story Room's reading text sizes, stored beside a save under BESIDE.readSize. Nothing stored reads as the first. */
export const READ_SIZES = ['regular', 'large', 'largest'] as const;
export type ReadSize = (typeof READ_SIZES)[number];

export const TAB_KEY = 'dbt.tab';
export const CARE_KEY = 'dbt.story.care';

/** The offline worker's caches: the names src/pwa/sw-template.js uses (scripts/check-stored-ids.mjs checks they match). */
export const SW_CACHE = { prefix: 'dbt.precache.', meta: 'dbt.precache-meta' } as const;

export const APP_ID = 'the-quiet-lantern';
