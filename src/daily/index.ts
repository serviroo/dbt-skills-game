/**
 * The quiet Lantern: the daily DBT skills companion that follows the intro cutscene.
 *
 *   const daily = mountDaily(document.getElementById('ui')!, { onReplay: () => playCutscene(), sound: audio });
 *   daily.unmount();
 */
import './daily.css';
import './care-a.css';
import './care-b.css';
import './stealth.css';
import './story.css';
import './wave2.css';
import './print.css';
import { App, type DailyOpts } from './app';
import { hubScreen } from './hub';
import { comfortScreen, daysScreen, diaryScreen, libraryScreen, printScreen, restScreen, settingsScreen, shadowsScreen } from './pages';
import { artScreen, drawScreen, pieceScreen } from './artroom';
import { readScreen, storiesScreen, writeScreen } from './storyroom';
import { linesScreen } from './lines';
import { easeScreen, momentScreen } from './moment';
import { safeScreen } from './safe';
import { skillScreen } from './skill';

export type { DailyOpts } from './app';
export { mothSVG, catSVG } from './art';

export function mountDaily(root: HTMLElement, opts: DailyOpts): { unmount(): void; settled: Promise<void>; route(): string } {
  const app = new App(root, opts, {
    hub: hubScreen,
    skill: skillScreen,
    safe: safeScreen,
    rest: restScreen,
    shadows: shadowsScreen,
    library: libraryScreen,
    diary: diaryScreen,
    print: printScreen,
    days: daysScreen,
    comfort: comfortScreen,
    settings: settingsScreen,
    art: artScreen,
    draw: drawScreen,
    piece: pieceScreen,
    stories: storiesScreen,
    write: writeScreen,
    read: readScreen,
    lines: linesScreen,
    ease: easeScreen,
    moment: momentScreen,
  });
  app.start();
  (window as unknown as { __daily?: App }).__daily = app;
  return {
    settled: app.settled.catch(() => undefined),
    route: () => app.route.name,
    unmount() {
      app.destroy();
      delete (window as unknown as { __daily?: App }).__daily;
    },
  };
}
