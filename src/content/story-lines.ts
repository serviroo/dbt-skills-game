/**
 * Story Room words around their own: the starting points it offers and the reading view. Plain and warm, game
 * flavour in the frame only, nothing that sounds like homework. Every starting point is an opening line the player
 * can keep, change or delete, so each one reads well as the first line of someone's story.
 */

export const STORY_START = {
  ask: 'Need a starting point?',
  another: 'Another',
  use: 'Use this',
  prompts: [
    'The lantern was still warm when I found it on the step.',
    'The map showed only one road, and it ended at a door in the side of a hill.',
    'Every evening at nine, the little shop at the end of the street rang its bell once.',
    'The fox at the edge of the garden had been waiting all week. Today it spoke.',
    'On the first cold morning, the river carried a paper boat with my name on the sail.',
    'The baker had a second oven at the back, and it only baked on rainy days.',
    'Halfway up the mountain there was a bench, and someone had carved a question into it.',
    'The new key fit no door in the house, until the wall in the hallway moved.',
    'Two travellers met at a crossroads with one umbrella between them.',
    'The library stayed open an hour past midnight, but only for people who knew to knock twice.',
    'A small robot woke up in a field of sunflowers with no idea how it got there.',
    'The ship’s cat was the only one on board who knew where the island was.',
    'The old recipe book had one page written in a language nobody in the village could read.',
    'The quest board in the square had one notice left: “Help wanted. Bring snacks.”',
    'At the top of the tower, the wizard was trying to teach a kettle to sing.',
    'Fresh snow covered every path but one, and it led to a tiny door at the foot of an oak.',
    'The festival lanterns drifted up into the dark, and one of them came gently back down.',
    'It was the kind of slow, bright morning when anything could start.',
  ],
};

/** Bringing a downloaded (or any plain text) story back in as a new story. */
export const STORY_IMPORT = {
  open: 'Bring in a story',
  ask: (title: string) => `Bring in “${title}”?`,
  count: (n: number, notes: boolean) => `${n} ${n === 1 ? 'chapter' : 'chapters'}${notes ? ' and notes' : ''}`,
  same: 'You already have a story with this name. Both will be kept.',
  add: 'Add as a new story',
  cancel: 'Not now',
  close: 'Close',
  more: (n: number) => `and ${n} more ${n === 1 ? 'chapter' : 'chapters'}`,
  added: (title: string) => `“${title}” is on your shelf now.`,
  tooBig: 'That file is too big to bring in. A story file can be up to 1 MB.',
  notText: 'That file isn’t plain text. Try a .txt or .md file, like the ones Download story makes.',
  empty: 'That file has no words in it yet.',
  tooMany: 'That file has more chapters than one story can hold.',
  full: 'This device already holds as many stories as it can.',
  privacy: 'The file is read here on this device and never sent anywhere.',
};

export const STORY_READ = {
  open: 'Read',
  size: 'Text size',
  sizes: { regular: 'Text size: regular', large: 'Text size: larger', largest: 'Text size: largest' },
  empty: 'Nothing to read yet. Write a few lines and they will be here.',
  back: 'Back to writing',
  gone: 'This story isn’t on this device any more.',
};
