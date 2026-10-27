const CONTROL = 'button, a[href], input, select, textarea, label, [contenteditable]';

/** Calls `on` for every tap from now on (a main-button press that starts and ends off the page's controls, `true`) and
 *  every Enter or Space off a control (`false`). Input that began before this call, like the press or key that opened
 *  a window and is still on its way, never counts. */
export function onTaps(on: (tap: boolean) => void) {
  const since = performance.now();
  const fresh = (e: Event) => e.timeStamp >= since;
  const pressed = new Set<number>();
  const free = (e: Event) => !(e.target as Element | null)?.closest?.(CONTROL);
  const onDown = (e: PointerEvent) => {
    if (e.button === 0 && fresh(e) && free(e)) pressed.add(e.pointerId);
  };
  const onUp = (e: PointerEvent) => {
    if (pressed.delete(e.pointerId) && free(e)) on(true);
  };
  const onCancel = (e: PointerEvent) => {
    pressed.delete(e.pointerId);
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && fresh(e) && free(e)) on(false);
  };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
  };
}

/** A button that hasn't shown yet takes no press, focus or key: `el` stays inert until `shown` settles. */
export function inertUntil(el: HTMLElement, shown: Promise<unknown>) {
  el.inert = true;
  const live = () => (el.inert = false);
  shown.then(live, live);
}
