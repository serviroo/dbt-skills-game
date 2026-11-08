import type { Answers, Visual } from './dbt';

const PICTURES = {
  clouds: 'Each thought is a cloud. Watch it drift in, cross the sky and drift out.',
  cars: 'Each thought is a car going past. Watch it come and go. No need to get in.',
  leaves: 'Each thought sits on a leaf. Watch the stream carry it away.',
};

export type ThoughtPic = keyof typeof PICTURES;

export type TimerPicture =
  | { visual?: Exclude<Visual, 'thoughts'>; scene?: undefined }
  | { visual: 'thoughts'; scene: (a: Answers) => ThoughtPic };

export const thoughtPic = (pic: string): ThoughtPic => (Object.hasOwn(PICTURES, pic) ? (pic as ThoughtPic) : 'clouds');

export const watchThoughts = (pic: string) =>
  `${PICTURES[thoughtPic(pic)]} If you get pulled into one, that's normal. Step back and watch again.`;
