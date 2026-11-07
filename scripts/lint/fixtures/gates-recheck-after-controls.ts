class Gate {
  openInTime(continuing, first) {
    const openedAt = continuing ? soon(this.ctx) : first;
    this.settle(openedAt);
    this.discardBefore(openedAt);
    if (openedAt <= rendered()) return;
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
class CheckedGate {
  openInTime(continuing, first) {
    this.settle(continuing ? soon(this.ctx) : first);
    const openedAt = continuing ? soon(this.ctx) : first;
    this.discardBefore(openedAt);
    if (openedAt <= rendered()) return;
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
