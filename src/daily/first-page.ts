export function firstPage(add: () => Promise<string>) {
  const missing = new Set<string>();
  let made: Promise<string | undefined> | undefined;
  return async (id: string, chapters: readonly string[]) => {
    missing.add(id);
    const next = chapters.find((c) => !missing.has(c)) ?? (await (made ??= add().catch(() => undefined)));
    return next && !missing.has(next) ? next : undefined;
  };
}
