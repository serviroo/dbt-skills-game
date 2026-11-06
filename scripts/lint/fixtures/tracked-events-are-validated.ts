export class UncheckedCurve {
  setValueAtTime(value, t) {
    this.param.setValueAtTime(value, t);
    return this.record('set', value, t);
  }

  linearRampToValueAtTime(value, t) {
    this.param.linearRampToValueAtTime(value, t);
    return this.record('linear', value, t);
  }

  setTargetAtTime(value, t, tau) {
    this.param.setTargetAtTime(value, t, tau);
    return this.record('target', value, t, tau);
  }

  lateGuard(value, t) {
    this.param.setValueAtTime(value, t);
    this.checkEvent('set', t);
    return this.record('set', value, t);
  }
}

export class CheckedCurve {
  setValueAtTime(value, t) {
    this.checkEvent('set', t);
    this.param.setValueAtTime(value, t);
    return this.record('set', value, t);
  }

  linearRampToValueAtTime(value, t) {
    this.checkEvent('linear', t);
    this.param.linearRampToValueAtTime(value, t);
    return this.record('linear', value, t);
  }

  setTargetAtTime(value, t, tau) {
    this.checkEvent('target', t);
    this.param.setTargetAtTime(value, t, tau);
    return this.record('target', value, t, tau);
  }
}
