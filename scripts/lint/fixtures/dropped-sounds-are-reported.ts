{
  class Voice {
    static openBuilt(voices) {
      for (const v of voices) v.stop();
      return false;
    }
  }
}
{
  class Voice {
    static openBuilt(voices) {
      console.warn('[audio] sound dropped', this.sound);
      for (const v of voices) v.stop();
      return false;
    }
  }
}
