class MissedAttack {
  openInTime(voices) {
    this.settle(soon(this.ctx));
    const openedAt = soon(this.ctx);
    if (openedAt <= rendered()) return;
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
class CheckedTooEarly {
  openInTime(voices, openedAt) {
    for (const voice of voices) voice.discardBefore(openedAt);
    this.settle(soon(this.ctx));
    if (openedAt <= rendered()) return;
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
class CheckedWrongTime {
  openInTime(voices) {
    this.settle(soon(this.ctx));
    const openedAt = soon(this.ctx);
    const first = openedAt - 0.1;
    for (const voice of voices) voice.discardBefore(first);
    if (openedAt <= rendered()) return;
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
class CheckedAttack {
  openInTime(voices) {
    this.settle(soon(this.ctx));
    const openedAt = soon(this.ctx);
    for (const voice of voices) voice.discardBefore(openedAt);
    if (openedAt <= rendered()) return;
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
