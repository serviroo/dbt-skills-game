export interface ReadCount { readonly fails: number }

export function reading(store: ReadCount): { failed(): boolean } {
  const before = store.fails;
  return { failed: () => store.fails !== before };
}
