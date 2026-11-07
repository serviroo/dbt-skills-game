class CleanupAfterCheck {
  openInTime(voices, openedAt) {
    if (openedAt <= rendered()) return this.drop(voices);
    for (const voice of voices) voice.discardBefore(openedAt);
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
class MissingCheck {
  openInTime(voices, openedAt) {
    for (const voice of voices) voice.discardBefore(openedAt);
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
class CheckedAfterCleanup {
  openInTime(voices, openedAt) {
    for (const voice of voices) voice.discardBefore(openedAt);
    if (openedAt <= rendered()) return this.drop(voices);
    this.gate.offset.setValueAtTime(1, openedAt);
  }
}
