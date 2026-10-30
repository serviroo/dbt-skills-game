// The Wardrobe tries a look on before keeping it: the screen wears it and nothing is saved until Keep this look. Go
// back, the Safe Zone, Back, a reload and another tab's choices all leave the kept look exactly as it was, and the
// other tab only ever sees kept looks.
import path from 'node:path';
import { gone } from './harness.mjs';

const dayOf = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A returning player with `days` earlier visit days (16 unlocks every look) who keeps Mint with a Green accent. */
function seed(h, days = 16) {
  const now = Date.now();
  const events = [];
  for (let i = days; i >= 0; i--) events.push({ id: `try-v${i}`, k: 'visit', xp: 10, t: now - i * 86400e3 - 60e3, day: dayOf(now - i * 86400e3) });
  const flags = { greetDay: dayOf(now), giftDay: dayOf(now), therapistLineShown: true };
  const profile = { theme: 'mint', accent: 'green', cardBack: 'ring', plate: 'plain', setAt: { theme: now - 3600e3, accent: now - 3600e3 } };
  return { [h.SAVE]: JSON.stringify({ v: 1, events, flags, profile }), 'dbt.app.v1': h.SEEN };
}

const SLOTS = ['theme', 'accent', 'cardBack', 'plate'];
/** The kept look as this device stores it: each pick and when it was made. */
async function kept(h, page) {
  const p = JSON.parse((await h.ls(page, h.SAVE)) ?? '{}').profile ?? {};
  return Object.fromEntries(SLOTS.flatMap((k) => [[k, p[k]], [`${k}At`, p.setAt?.[k]]]));
}
/** The kept look as one tab holds it in memory, in the same shape (open tabs share the stored one). */
const holds = (page) =>
  page.evaluate((slots) => {
    const { settings, setAt } = window.__daily.store.state;
    return Object.fromEntries(slots.flatMap((k) => [[k, settings[k]], [`${k}At`, setAt[k]]]));
  }, SLOTS);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** What the screen wears and what the Wardrobe and its bar show. */
const look = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.w2-try');
    return {
      theme: document.documentElement.dataset.dqTheme,
      accent: document.documentElement.dataset.dqAccent,
      route: window.__daily.route.name,
      bar: !!bar?.checkVisibility(),
      text: bar?.querySelector('.w2-try-t')?.textContent ?? '',
      gate: !!bar?.querySelector('.w2-try-back path[d^="M28 84V40"]'),
      plate: bar?.querySelector('.w2-plate')?.className ?? '',
      name: bar?.querySelector('.w2-plate')?.textContent ?? '',
      checked: [...document.querySelectorAll('.w2-wopt[aria-checked=true]')].map((b) => `${b.dataset.slot}:${b.dataset.id}`),
    };
  });
const tryOn = (page, slot, id) => page.locator(`.w2-wopt--${slot}[data-id="${id}"]`).click();
const choose = (page, name) => page.getByRole('button', { name, exact: true }).click();
const barGone = (page) => gone(page.locator('.w2-try'), 5000, { state: 'hidden' });
const routeIs = (page, name) => page.waitForFunction((n) => window.__daily?.route.name === n, name, { timeout: 10000 });

export const scenarios = {
  async 'try-on-go-back'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.openSettings(page);
      const was = await kept(h, page);
      h.expect(was.theme === 'mint' && was.accent === 'green', `the seeded look did not load: ${JSON.stringify(was)}`);
      // a typed name saves as focus leaves it for the first look tapped, and that tap still counts
      await page.locator('#set-playerName').fill('Sam');
      for (const [slot, id] of [['theme', 'night'], ['accent', 'rose'], ['cardBack', 'gate'], ['plate', 'gold']]) await tryOn(page, slot, id);
      await page.locator('.w2-try').waitFor({ timeout: 5000 });
      let on = await look(page);
      h.expect(on.theme === 'night' && on.accent === 'rose', `the screen does not wear the look tried on: ${JSON.stringify(on)}`);
      h.expect(on.gate && on.plate.includes('w2-plate--gold') && on.name === 'Sam' && on.text.startsWith('Trying on Night, Rose, Gate and Gold trim.'), `the bar does not show the look tried on: ${JSON.stringify(on)}`);
      h.expect(['theme:night', 'accent:rose', 'cardBack:gate', 'plate:gold'].every((c) => on.checked.includes(c)), `the Wardrobe does not mark the look tried on: ${on.checked}`);
      h.expect(same(await kept(h, page), was), `trying a look on saved it: ${JSON.stringify(await kept(h, page))}`);
      await h.shot(page, 'try-on-trying');

      await choose(page, 'Go back');
      await barGone(page);
      on = await look(page);
      h.expect(on.theme === 'mint' && on.accent === 'green', `Go back left the screen in the look tried on: ${JSON.stringify(on)}`);
      h.expect(same(on.checked, ['theme:mint', 'accent:green', 'cardBack:ring', 'plate:plain']), `Go back left the Wardrobe marking ${on.checked}`);
      const focus = await page.evaluate(() => `${document.activeElement?.dataset.slot}:${document.activeElement?.dataset.id}`);
      h.expect(focus === 'plate:plain', `focus after Go back is on ${focus}, not the look it went back to`);
      h.expect(same(await kept(h, page), was), `Go back changed the kept look: ${JSON.stringify(await kept(h, page))}`);

      // a tap on the kept accent takes Rose off again: with nothing left tried on, the bar goes too
      await tryOn(page, 'accent', 'rose');
      await page.locator('.w2-try').waitFor({ timeout: 5000 });
      await tryOn(page, 'accent', 'green');
      await barGone(page);
      on = await look(page);
      h.expect(on.accent === 'green' && on.checked.includes('accent:green'), `tapping the kept accent did not take Rose off: ${JSON.stringify(on)}`);
      h.expect(same(await kept(h, page), was), `tapping the kept accent changed the kept look: ${JSON.stringify(await kept(h, page))}`);
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  async 'try-on-keep'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.openSettings(page);
      const was = await kept(h, page);
      for (const [slot, id] of [['theme', 'night'], ['cardBack', 'gate'], ['plate', 'ticks']]) await tryOn(page, slot, id);
      // a tap on the kept theme takes Night off again; the other two stay on
      await tryOn(page, 'theme', 'mint');
      let on = await look(page);
      h.expect(on.theme === 'mint' && on.bar && on.text.startsWith('Trying on Gate and Corner ticks.'), `tapping the kept theme did not take Night off: ${JSON.stringify(on)}`);
      await tryOn(page, 'theme', 'night');
      await choose(page, 'Keep this look');
      await barGone(page);
      const now = await kept(h, page);
      h.expect(now.theme === 'night' && now.cardBack === 'gate' && now.plate === 'ticks', `Keep this look did not save it: ${JSON.stringify(now)}`);
      h.expect(now.themeAt > was.themeAt && now.accent === 'green' && now.accentAt === was.accentAt, `Keep this look saved more than the look tried on: ${JSON.stringify(now)}`);
      on = await look(page);
      h.expect(on.theme === 'night' && on.accent === 'green', `the screen after Keep this look: ${JSON.stringify(on)}`);

      await page.goto(h.server.url + '/?mute');
      await h.reachHub(page);
      on = await look(page);
      h.expect(on.theme === 'night' && on.accent === 'green', `the kept look did not come back after a reload: ${JSON.stringify(on)}`);
      const home = await page.evaluate(() => ({
        gate: !!document.querySelector('.dq-quest .dq-cardface--back path[d^="M28 84V40"]'),
        plate: !!document.querySelector('.dq-status .w2-plate--ticks'),
      }));
      h.expect(home.gate && home.plate, `Home does not wear the kept card back and name plate: ${JSON.stringify(home)}`);
      h.expect(same(await kept(h, page), now), `the kept look changed after a reload: ${JSON.stringify(await kept(h, page))}`);
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  async 'try-on-left-unsaved'(h) {
    const { ctx, page, errors } = await h.open(seed(h));
    try {
      await h.openSettings(page);
      const was = await kept(h, page);
      const still = async (where) => {
        const on = await look(page);
        h.expect(on.theme === 'mint' && on.accent === 'green' && !on.bar, `${where}: the look tried on still shows: ${JSON.stringify(on)}`);
        h.expect(same(await kept(h, page), was), `${where}: the kept look changed: ${JSON.stringify(await kept(h, page))}`);
      };

      // another save while a look is tried on keeps it out of the save
      await tryOn(page, 'theme', 'night');
      await tryOn(page, 'accent', 'rose');
      await page.getByRole('radio', { name: 'Motion: Reduced' }).click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('dbt.lantern.v1')).settings.motion === 'reduce', null, { timeout: 5000 });
      h.expect(same(await kept(h, page), was), `a save while trying a look on kept it: ${JSON.stringify(await kept(h, page))}`);

      await page.getByRole('button', { name: 'Safe Zone, help right now' }).click();
      await routeIs(page, 'safe');
      await still('Safe Zone');
      await h.shot(page, 'try-on-safe-zone');
      await page.goBack();
      await routeIs(page, 'settings');
      await still('back from the Safe Zone');
      const on = await look(page);
      h.expect(on.checked.includes('theme:mint') && on.checked.includes('accent:green'), `the Wardrobe after the Safe Zone marks ${on.checked}`);

      await tryOn(page, 'theme', 'night');
      await page.goBack();
      await routeIs(page, 'hub');
      await still('Back to Home');

      await h.openSettings(page);
      await tryOn(page, 'theme', 'gold');
      await page.locator('.w2-try').waitFor({ timeout: 5000 });
      await page.reload();
      await page.waitForFunction(() => !!window.__daily, null, { timeout: 20000 });
      await still('reload');
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  async 'try-on-unlocked-by-restore'(h) {
    const a = await h.open(seed(h));
    const file = path.join(h.out, 'try-on-crystal.json');
    try {
      await h.openSettings(a.page);
      const pending = a.page.waitForEvent('download');
      await a.page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
      await (await pending).saveAs(file);
    } finally {
      await a.ctx.close();
    }
    // restored with the Wardrobe open on a device where Night is still locked: it opens right there and tries on
    const { ctx, page, errors } = await h.open(seed(h, 0));
    try {
      await h.openSettings(page);
      const night = page.locator('.w2-wopt--theme[data-id="night"]');
      h.expect(await night.isDisabled(), 'Night is open before the restore, so the case proves nothing');
      await page.locator('input[type=file]').setInputFiles(file);
      await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''), null, { timeout: 15000 });
      const label = await night.getAttribute('aria-label');
      h.expect(!(await night.isDisabled()) && label === 'Night', `Night is still locked after the restore: ${label}`);
      await night.click();
      const on = await look(page);
      h.expect(on.theme === 'night' && on.bar, `Night, unlocked by the restore, did not try on: ${JSON.stringify(on)}`);
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  async 'try-on-second-tab'(h) {
    const { ctx, page: a, errors } = await h.open(seed(h));
    try {
      const b = await ctx.newPage();
      b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
      await b.goto(h.server.url + '/?mute');
      await h.reachHub(b);
      await a.bringToFront();
      await h.openSettings(a);
      await tryOn(a, 'theme', 'night');
      await tryOn(a, 'accent', 'rose');
      // A saves something else while it tries the look on: B hears the save and still wears the kept look
      await a.getByRole('radio', { name: 'Motion: Reduced' }).click();
      await b.waitForFunction(() => window.__daily.store.state.settings.motion === 'reduce', null, { timeout: 5000 });
      let other = await look(b);
      h.expect(other.theme === 'mint' && other.accent === 'green', `the other tab wears a look only tried on: ${JSON.stringify(other)}`);

      // B keeps Gold and the Gate card back while A still tries Night on: A shows the Gate it would keep with Night, its
      // Go back lands on Gold, and nothing of A's try-on is saved
      await b.bringToFront();
      await h.openSettings(b);
      await tryOn(b, 'theme', 'gold');
      await tryOn(b, 'cardBack', 'gate');
      await choose(b, 'Keep this look');
      await barGone(b);
      await a.bringToFront();
      await a.waitForFunction(() => window.__daily.store.state.settings.theme === 'gold', null, { timeout: 5000 });
      let on = await look(a);
      h.expect(on.theme === 'night' && on.accent === 'rose' && on.bar, `the other tab's choice ended this tab's try-on: ${JSON.stringify(on)}`);
      h.expect(on.gate && on.checked.includes('cardBack:gate'), `this tab's try-on does not show the card back the other tab kept: ${JSON.stringify(on)}`);
      const saved = await kept(h, a);
      h.expect(saved.theme === 'gold' && saved.cardBack === 'gate' && saved.accent === 'green', `the other tab's kept look was overwritten: ${JSON.stringify(saved)}`);
      await choose(a, 'Go back');
      await barGone(a);
      on = await look(a);
      h.expect(on.theme === 'gold' && on.accent === 'green', `Go back after the other tab kept Gold shows ${JSON.stringify(on)}`);

      // A keeps Rose: now B wears it
      await tryOn(a, 'accent', 'rose');
      await choose(a, 'Keep this look');
      await barGone(a);
      on = await look(a);
      h.expect(on.theme === 'gold' && on.accent === 'rose', `this tab after Keep this look: ${JSON.stringify(on)}`);
      await b.waitForFunction(() => document.documentElement.dataset.dqAccent === 'rose', null, { timeout: 5000 });
      other = await look(b);
      h.expect(other.theme === 'gold' && other.accent === 'rose' && !other.bar, `the other tab after Keep this look: ${JSON.stringify(other)}`);
      h.expect((await kept(h, a)).cardBack === 'gate', `this tab's Keep this look dropped the other tab's card back: ${JSON.stringify(await kept(h, a))}`);
      h.expect(same(await holds(b), await holds(a)), `the two tabs keep different looks: ${JSON.stringify({ a: await holds(a), b: await holds(b) })}`);

      // B keeps the very looks A tries on: each one leaves A's bar as it is kept, the bar goes with the last, and A
      // saves nothing of its own
      await tryOn(a, 'theme', 'night');
      await tryOn(a, 'plate', 'gold');
      await b.bringToFront();
      await tryOn(b, 'theme', 'night');
      await choose(b, 'Keep this look');
      await barGone(b);
      await a.bringToFront();
      await a.waitForFunction(() => window.__daily.store.state.settings.theme === 'night', null, { timeout: 5000 });
      on = await look(a);
      h.expect(on.theme === 'night' && on.bar && on.text.startsWith('Trying on Gold trim.'), `this tab still tries on the theme the other tab kept: ${JSON.stringify(on)}`);
      await b.bringToFront();
      await tryOn(b, 'plate', 'gold');
      await choose(b, 'Keep this look');
      await barGone(b);
      const byB = await holds(b);
      await a.bringToFront();
      await barGone(a);
      on = await look(a);
      h.expect(on.checked.includes('theme:night') && on.checked.includes('plate:gold'), `this tab does not mark the looks the other tab kept: ${on.checked}`);
      h.expect(byB.theme === 'night' && byB.plate === 'gold' && same(await holds(a), byB) && same(await kept(h, a), byB), `this tab changed the looks the other tab kept: ${JSON.stringify({ b: byB, a: await holds(a), saved: await kept(h, a) })}`);
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },
};
