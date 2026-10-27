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

export const STORY_READ = {
  open: 'Read',
  size: 'Text size',
  // each name starts with the "A" the button shows, so voice control finds it by what it says
  sizes: { regular: 'A regular', large: 'A larger', largest: 'A largest' },
  empty: 'Nothing to read yet. Write a few lines and they will be here.',
  back: 'Back to writing',
  gone: 'This story isn’t on this device any more.',
};

/** Searching the shelf: every story, chapter and note, matched on this device. */
export const STORY_FIND = {
  label: 'Search your stories and notes',
  none: 'Nothing matches that yet.',
  found: (n: number) => `Found in ${n} ${n === 1 ? 'story' : 'stories'}`,
  notes: 'Notes',
  here: 'What you searched for is marked on the page.',
  more: (n: number) => `Show ${n} more ${n === 1 ? 'place' : 'places'} in this story`,
};
