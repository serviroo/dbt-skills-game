import type { Ctx } from './dsp';
import { trackedGain, type TrackedGain } from './curve';
import { SCORE } from '../motion/tokens';

/** Effects' and Music's sends into the echo, to the room and the hall, each at its level. */
export type Sends = { sfxRoom: TrackedGain; sfxHall: TrackedGain; musRoom: TrackedGain; musHall: TrackedGain };
/** A room and hall echo, each behind its own return level, and the sends that feed it. */
export type Echo = {
  sends: Sends;
  room: ConvolverNode;
  hall: ConvolverNode;
  input: GainNode[];
  out: TrackedGain[];
};

/** An empty room and hall echo with these responses, fed by `sends`. */
export function makeEcho(
  ctx: Ctx,
  sends: Sends,
  roomIR: AudioBuffer,
  hallIR: AudioBuffer,
  returns: [GainNode, GainNode],
  at: number,
): Echo {
  const make = (ir: AudioBuffer, from: GainNode[], hush: GainNode) => {
    const c = ctx.createConvolver();
    c.normalize = false;
    c.buffer = ir;
    const input = ctx.createGain();
    input.gain.value = 0;
    input.gain.setValueAtTime(0, at);
    input.gain.linearRampToValueAtTime(1, at + SCORE.safeOutSec);
    const out = trackedGain(ctx, 1);
    for (const g of from) g.connect(input);
    input.connect(c).connect(out).connect(hush);
    return { c, input, out };
  };
  const room = make(roomIR, [sends.sfxRoom, sends.musRoom], returns[0]);
  const hall = make(hallIR, [sends.sfxHall, sends.musHall], returns[1]);
  return { sends, room: room.c, hall: hall.c, input: [room.input, hall.input], out: [room.out, hall.out] };
}

/** Drops an echo another has replaced, with its tail: its sends no longer feed it (the new one may share them). */
export function dropEcho(old: Echo) {
  const { sends: s, room, hall, input } = old;
  const feeds = [[s.sfxRoom, input[0]], [s.musRoom, input[0]], [s.sfxHall, input[1]], [s.musHall, input[1]]];
  for (const [from, to] of feeds) from.disconnect(to);
  for (const g of input) g.disconnect();
  room.disconnect();
  hall.disconnect();
  for (const g of old.out) g.disconnect();
}
