interface Clock {
  control(at: number, apply: (time: number) => void): void;
}

const invoke = (run: () => void) => run();

export function handles(voice: Clock, gain: AudioParam) {
  const apply = (at: number) => gain.setTargetAtTime(0, at, 0.03);
  const unsafe = {
    handle: {
      level(v: number, at: number) {
        gain.cancelScheduledValues(at);
        gain.setTargetAtTime(v, at, 0.03);
      },
      set(at: number) {
        apply(at);
      },
      release(at: number) {
        apply(at);
      },
    },
  };
  const queued = {
    handle: {
      level(v: number, at: number) {
        voice.control(at, (time) => gain.setTargetAtTime(v, time, 0.03));
      },
      set(at: number) {
        voice.control(at, apply);
      },
      release(at: number) {
        voice.control(at, (time) => apply(time));
      },
    },
  };
  const helped = {
    handle: {
      level(v: number, at: number) {
        invoke(() => gain.setTargetAtTime(v, at, 0.03));
      },
      release(at: number) {
        invoke(() => voice.control(at, apply));
      },
    },
  };
  return { unsafe, queued, helped };
}
