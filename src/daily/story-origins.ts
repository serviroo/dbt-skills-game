export class StoryOrigins {
  private onlyMemory = new Set<string>();
  private knownStored = new Set<string>();
  private version = 0;

  get epoch() { return this.version; }

  probe() { return { absent: new Set<string>(), origin: this.version }; }

  mark(id: string, epoch: number) {
    if (epoch === this.version && !this.knownStored.has(id)) this.onlyMemory.add(id);
  }

  stored(id: string) {
    this.version++;
    this.knownStored.add(id);
    this.onlyMemory.delete(id);
  }

  wrote() { this.version++; }

  changedElsewhere() {
    this.version++;
    this.onlyMemory.clear();
  }

  has(id: string) { return this.onlyMemory.has(id); }

  forget(id: string) {
    this.onlyMemory.delete(id);
    this.knownStored.delete(id);
  }

  clear() {
    this.version++;
    this.onlyMemory.clear();
    this.knownStored.clear();
  }
}
