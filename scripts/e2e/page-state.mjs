/** The page's state for evidence(), read inside the page. */
export function pageState() {
  const trail = window.__e2eTrail;
  trail?.flush();
  return {
    path: location.pathname + location.search,
    readyState: document.readyState,
    visibility: document.visibilityState,
    ready: document.documentElement.dataset.ready ?? null,
    mounted: !!window.__daily,
    route: window.__daily?.route.name ?? null,
    title: !!document.querySelector('.title-screen'),
    prompt: !!document.querySelector('#np-name'),
    windows: [...document.querySelectorAll('.sw, .dq-sw')].map((w) => {
      const r = w.getBoundingClientRect();
      const box = [r.left, r.top, r.width, r.height].map(Math.round);
      return { label: w.getAttribute('aria-label'), visible: w.checkVisibility(), box };
    }),
    stage: window.__stage ? {
      frames: trail?.frames ?? null,
      lastFrameAgo: trail?.lastFrame == null ? null : Math.round(performance.now() - trail.lastFrame),
    } : null,
    origin: performance.timeOrigin,
    trail: trail?.ev ?? null,
  };
}
