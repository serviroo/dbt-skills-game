export function inStep(glow: HTMLElement, opened: number) {
  const since = Number(document.timeline.currentTime) - opened;
  for (const a of glow.getAnimations()) a.currentTime = since % Number(a.effect?.getTiming().duration);
  for (const a of glow.getAnimations()) a.startTime = opened;
}
