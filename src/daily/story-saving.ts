export function storySaving(
  commit: () => void,
  live: (force: boolean) => void,
  pending: () => Promise<void> | null,
  dirty: () => boolean,
  liveTimer: () => boolean,
  save: () => Promise<void>,
) {
  const pinLive = () => {
    if (dirty() || pending() || liveTimer()) live(true);
  };
  const flushAll = async () => {
    commit();
    pinLive();
    for (let i = 0; i < 6 && (pending() || dirty()); i++) await (pending() ?? save());
  };
  return { pinLive, flushAll };
}
