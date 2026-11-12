type Operation = {
  t: number;
  absolute: boolean;
  place: (at: number) => void;
  after?: Operation;
  done: boolean;
};

export class Moment {
  private relative: Operation[] = [];
  private absolute: Operation[] = [];
  private last = new Map<object, Operation>();

  add(t: number, place: (at: number) => void, key?: object, absolute = false, after?: Operation) {
    const op: Operation = { t, absolute, place, after: after ?? (key ? this.last.get(key) : undefined), done: false };
    if (key) this.last.set(key, op);
    (absolute ? this.absolute : this.relative).push(op);
    return op;
  }

  prepare() {
    this.relative.sort((a, b) => a.t - b.t);
    this.absolute.sort((a, b) => a.t - b.t);
  }

  place(at: number) {
    const relative = this.relative;
    const absolute = this.absolute;
    let ri = 0;
    let ai = 0;
    let left = relative.length + absolute.length;
    while (left) {
      while (relative[ri]?.done) ri++;
      while (absolute[ai]?.done) ai++;
      let next: Operation | undefined;
      for (let i = ri; i < relative.length; i++) {
        const op = relative[i];
        if (op.done || (op.after && !op.after.done)) continue;
        next = op;
        break;
      }
      for (let i = ai; i < absolute.length; i++) {
        const op = absolute[i];
        if (op.done || (op.after && !op.after.done)) continue;
        if (!next || op.t < next.t + at) next = op;
        break;
      }
      if (!next) throw new Error('Audio moment has an ordering cycle');
      next.place(at);
      next.done = true;
      left--;
    }
  }
}
