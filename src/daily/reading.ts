export interface ReadCount { readonly fails: number }

export function reading(store: ReadCount): { failed(): boolean } {
  const before = store.fails;
  return { failed: () => store.fails !== before };
}

export async function outcome<T extends object>(
  store: ReadCount, fn: (failed: () => boolean) => Promise<T | null>,
): Promise<T | 'unread' | null> {
  const read = reading(store);
  try {
    const value = await fn(read.failed);
    return value ?? (read.failed() ? 'unread' : null);
  } catch {
    return 'unread';
  }
}
