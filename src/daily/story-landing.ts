export async function landOnAny(
  ids: string[],
  open: (id: string) => Promise<boolean>,
  readable: () => boolean,
  make: () => Promise<string | undefined>,
) {
  for (const id of ids) {
    if (!readable()) return false;
    if (await open(id)) return true;
  }
  if (!readable()) return false;
  const made = await make();
  return !!made && (await open(made));
}
