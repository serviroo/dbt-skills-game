// Open screens follow what another open copy of the game changes, the moment it lands, at 390x844 and 320x568:
//   home-follows-tabs         Home shows the XP, stats, allies, today's line and the opened daily gift that another
//                             tab earned or chose, and its check-in follows a heavy check-in there and a lighter one
//                             after it; an open line history follows too. Nothing here plays, counts up or opens a
//                             window, focus and scroll stay where they were (focus on a check-in answer that goes moves
//                             to Check in again, seen whole), and an older copy of the save arriving after never lowers
//                             a number
//   night-watch-follows-tabs  the Night Watch's skill shadows take a skill met and one practised again in another tab,
//                             focus stays on the same skill's card, nothing plays, and an older copy arriving after
//                             never takes a shadow or a count away
//   moment-follows-tabs       How long chosen in another tab shows on a running moment, which goes on unbroken (its
//                             low hum still on, focus on Done) and lasts that long from the change, never ending early
import { another, focusOn, go, until } from './safe-zone-tabs.e2e.mjs';

const SIZES = [
  ['390x844', { width: 390, height: 844 }],
  ['320x568', { width: 320, height: 568 }],
];
const T = Date.now() - 86400e3;
const pad = (n) => String(n).padStart(2, '0');
const DAY = `${new Date(T).getFullYear()}-${pad(new Date(T).getMonth() + 1)}-${pad(new Date(T).getDate())}`;
/** A returning save: a visit yesterday and Wise Mind practised once. */
const SAVE = JSON.stringify({
  v: 1,
  created: T,
  events: [
    { id: 'v1', k: 'visit', day: DAY, t: T, xp: 10 },
    { id: 's1', k: 'skill', day: DAY, t: T + 1000, xp: 20, stat: 'sense', skill: 'wise-mind' },
  ],
});
const WISE = 'Still Center, Wise Mind. Practise it.';
const TIPP = 'Frost Rune, TIPP. Practise it.';

async function open(h, viewport, prepare) {
  const { ctx, page, errors } = await h.open({ [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: T, companionAt: T }), 'dbt.app.v1': h.SEEN, [h.SAVE]: SAVE }, '?mute', viewport, prepare);
  await h.reachHub(page);
  return { ctx, page, errors };
}
/**
 * From now on, what this copy plays or shows of its own accord (sounds, buzzes, toasts, windows, a number counting up)
 * and every XP number Home shows, in order.
 */
const watch = (page) =>
  page.evaluate(() => {
    const a = window.__daily;
    window.__fx = [];
    window.__xps = [];
    for (const k of ['sound', 'buzz', 'toast', 'window']) {
      const f = a[k].bind(a);
      a[k] = (...x) => (window.__fx.push(`${k}: ${x[0]?.title ?? x[0]}`), f(...x));
    }
    const xp = () => [...document.querySelectorAll('.dq-status .dq-kv')].find((r) => r.querySelector('dt')?.textContent === 'XP')?.querySelector('.dq-num')?.textContent;
    new MutationObserver((ms) => {
      if (ms.some((m) => m.type === 'attributes' && m.target.classList.contains('is-up'))) window.__fx.push('a number counted up');
      const n = Number(xp());
      if (Number.isFinite(n) && n !== window.__xps.at(-1)) window.__xps.push(n);
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  });
/** What Home shows right now, next to what this copy's save holds. */
const home = (page) =>
  page.evaluate(() => {
    const a = window.__daily;
    const d = a.store.derived();
    const kv = (k) => [...document.querySelectorAll('.dq-status .dq-kv')].find((r) => r.querySelector('dt')?.textContent === k);
    return {
      route: a.route.name,
      xp: Number(kv('XP')?.querySelector('.dq-num')?.textContent),
      stamina: Number(document.querySelector('.dq-status .dq-mod-dt .dq-stat-n')?.textContent),
      held: { xp: d.xp, stamina: d.stats.stamina, met: d.collection.size },
      allies: [...document.querySelectorAll('.dq-tile')].find((t) => t.querySelector('.dq-tile-t')?.textContent === 'Shadows')?.querySelector('.dq-tile-s')?.textContent,
      gift: !!document.querySelector('.dq-chest.is-open') && !!document.querySelector('.dq-gift')?.checkVisibility(),
      line: document.querySelector('.dq-lines-pin')?.textContent ?? null,
      checkin: document.querySelector('.dq-checkin .dq-after') ? 'after' : document.querySelector('.dq-checkin .dq-ask') ? 'ask' : 'other',
      fx: window.__fx,
      xps: window.__xps,
      y: scrollY,
    };
  });
/** Marks what has focus now, so it can be told apart from a control drawn again in its place. */
const mark = (page) => page.evaluate(() => document.activeElement?.setAttribute('data-had-focus', ''));
const kept = (page) => page.evaluate(() => !!document.activeElement?.hasAttribute('data-had-focus'));
/** An older copy of the save, from before any of this, lands as if another tab wrote it. */
const older = (page, h) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, SAVE]);

export const scenarios = {
  async 'home-follows-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport);
      const log = await another(ctx, h);
      await go(log.page, { name: 'lines' });
      await log.page.locator('.dq-lineslog').waitFor();
      const other = await another(ctx, h);
      await h.reachHub(other.page);
      await watch(page);
      const toggle = page.locator('.dq-stats-toggle');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.focus();
      await mark(page);
      const before = await home(page);
      await h.shot(page, `home-before-${tag}`);

      // another tab meets TIPP, picks today's line and opens the daily gift
      await go(other.page, { name: 'skill', id: 'tipp' });
      await go(other.page, { name: 'hub' });
      await h.reachHub(other.page);
      const picked = (await other.page.locator('.dq-lineopt .dq-line-t').first().textContent()).trim();
      await other.page.locator('.dq-lineopt').first().click();
      await other.page.locator('.dq-chest').click();
      await other.page.locator('.dq-sw').first().waitFor({ timeout: 10000 });
      await h.reachHub(other.page);
      const gained = await other.page.evaluate(() => window.__daily.store.derived().xp);
      await until(page, (xp) => window.__daily.store.derived().xp >= xp && window.__daily.store.state.flags.giftDay === window.__daily.store.today(), gained);
      await page.waitForTimeout(600);
      const after = await home(page);
      if (after.xp !== after.held.xp || after.held.xp <= before.held.xp || after.stamina !== after.held.stamina || after.held.stamina <= before.held.stamina) problems.push(`${tag}: Home shows ${after.xp} XP and Stamina ${after.stamina}, from ${before.xp} and ${before.stamina}, while the save holds ${after.held.xp} and ${after.held.stamina}`);
      if (after.allies !== '3 allies') problems.push(`${tag}: the Shadows tile says "${after.allies}" after TIPP was met in another tab`);
      if (!after.gift) problems.push(`${tag}: the daily gift opened in another tab is still closed here`);
      if (!after.line?.includes(picked)) problems.push(`${tag}: today's line picked in another tab ("${picked}") is not on Home, which shows ${JSON.stringify(after.line)}`);
      if (!(await until(log.page, (t) => document.querySelector('.dq-log')?.textContent.includes(t), picked))) problems.push(`${tag}: the open line history does not show the line picked in another tab`);
      if (!(await kept(page))) problems.push(`${tag}: focus left the Stats button for ${await page.evaluate(() => document.activeElement?.textContent)}`);
      if (Math.abs(after.y - before.y) > 1) problems.push(`${tag}: Home scrolled from ${before.y} to ${after.y}`);
      await h.shot(page, `home-after-${tag}`);
      await h.shot(log.page, `lines-history-after-${tag}`);

      // a heavy check-in there leaves only the open door here, and a lighter one after it asks again
      const calm = page.locator('.dq-checkin').getByRole('button', { name: 'Calm', exact: true });
      await calm.scrollIntoViewIfNeeded();
      await calm.focus();
      await other.page.locator('.dq-checkin').getByRole('button', { name: 'Sad', exact: true }).click();
      await other.page.waitForFunction(() => window.__daily.route.name === 'ease');
      if (await until(page, () => !!document.querySelector('.dq-checkin .dq-after'))) {
        await page.waitForTimeout(500);
        problems.push(...(await focusOn(page.locator('.dq-checkin').getByRole('button', { name: 'Check in again' }), `${tag} after a heavy check-in elsewhere`)));
      } else problems.push(`${tag}: a heavy check-in in another tab left Home's check-in asking (${(await home(page)).checkin})`);
      await h.shot(page, `home-checkin-heavy-${tag}`);
      await go(other.page, { name: 'hub' });
      await h.reachHub(other.page);
      await other.page.locator('.dq-checkin').getByRole('button', { name: 'Check in again' }).click();
      await other.page.locator('.dq-checkin').getByRole('button', { name: 'Calm', exact: true }).click();
      await page.waitForTimeout(800);
      if ((await home(page)).checkin === 'ask') problems.push(...(await focusOn(page.locator('.dq-checkin').getByRole('button', { name: 'Calm', exact: true }), `${tag} after a lighter check-in elsewhere`)));
      else problems.push(`${tag}: a lighter check-in in another tab left Home's check-in on ${(await home(page)).checkin}`);
      await h.shot(page, `home-checkin-again-${tag}`);

      // an older copy arriving changes nothing shown: the store keeps everything both had
      const now = await home(page);
      await older(other.page, h);
      await page.waitForTimeout(800);
      const last = await home(page);
      if (last.xp < now.xp || last.held.xp < now.held.xp || last.held.met < now.held.met) problems.push(`${tag}: an older copy arriving took Home from ${now.xp} XP to ${last.xp} (held ${now.held.xp} to ${last.held.xp}, met ${now.held.met} to ${last.held.met})`);
      if (last.xps.some((x, i) => i && x < last.xps[i - 1])) problems.push(`${tag}: Home's XP went down on the way: ${last.xps.join(', ')}`);
      if (last.fx.length) problems.push(`${tag}: Home played or showed this for another tab's doings: ${last.fx.join('; ')}`);
      if (last.route !== 'hub') problems.push(`${tag}: Home left for ${last.route}`);
      problems.push(...[errors, log.errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'night-watch-follows-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport);
      const other = await another(ctx, h);
      await go(page, { name: 'shadows' });
      const wise = page.getByRole('button', { name: WISE });
      await wise.waitFor();
      await watch(page);
      await wise.scrollIntoViewIfNeeded();
      await wise.focus();
      const y = await page.evaluate(() => scrollY);
      await h.shot(page, `night-watch-before-${tag}`);
      await go(other.page, { name: 'skill', id: 'wise-mind' });
      await go(other.page, { name: 'skill', id: 'tipp' });
      const cards = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dq-collection .dq-cardbtn:not(.dq-allyslot, .dq-allybtn)')].map((b) => [b.getAttribute('aria-label'), b.querySelector('.dq-cardbtn-n')?.textContent])));
      const want = { [WISE]: 'Practised 2x', [TIPP]: 'Practised 1x' };
      if (!(await until(page, (w) => Object.entries(w).every(([k, v]) => [...document.querySelectorAll('.dq-cardbtn')].some((b) => b.getAttribute('aria-label') === k && b.querySelector('.dq-cardbtn-n')?.textContent === v)), want))) problems.push(`${tag}: the skill shadows show ${JSON.stringify(await cards())} after another tab practised Wise Mind again and met TIPP`);
      await page.waitForTimeout(300);
      problems.push(...(await focusOn(page.getByRole('button', { name: WISE }), `${tag} Wise Mind's card after its count changed elsewhere`)));
      const at = await page.evaluate(() => scrollY);
      if (Math.abs(at - y) > 1) problems.push(`${tag}: the Night Watch scrolled from ${y} to ${at}`);
      await h.shot(page, `night-watch-after-${tag}`);
      const had = await cards();
      await older(other.page, h);
      await page.waitForTimeout(800);
      const now = await cards();
      if (JSON.stringify(now) !== JSON.stringify(had)) problems.push(`${tag}: an older copy arriving changed the skill shadows from ${JSON.stringify(had)} to ${JSON.stringify(now)}`);
      const fx = await page.evaluate(() => window.__fx);
      if (fx.length) problems.push(`${tag}: the Night Watch played or showed this for another tab's doings: ${fx.join('; ')}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'moment-follows-tabs'(h) {
    const problems = [];
    const END = /That.s your moment/;
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport, async (c) => {
        await c.clock.install();
        // the low hum's own tones starting and stopping
        await c.addInitScript(() => {
          window.__hum = { started: 0, stopped: 0 };
          const HUM = [98, 98.6, 146.8, 196.4];
          const isHum = (o) => HUM.some((f) => Math.abs(o.frequency.value - f) < 0.01);
          for (const k of ['start', 'stop']) {
            const f = OscillatorNode.prototype[k];
            OscillatorNode.prototype[k] = function (...a) {
              if (isHum(this)) window.__hum[k === 'start' ? 'started' : 'stopped']++;
              return f.apply(this, a);
            };
          }
        });
      });
      const other = await another(ctx, h);
      await go(other.page, { name: 'moment' });
      await go(page, { name: 'moment' });
      await page.locator('.dq-moment').waitFor();
      await other.page.locator('.dq-moment').waitFor();
      await watch(page);
      const how = (p, name) => p.getByRole('radiogroup', { name: 'How long' }).getByRole('radio', { name });
      await h.pauseClock(page);
      await how(page, '1 minute').check();
      await page.getByRole('switch', { name: 'Low hum', exact: true }).check();
      await page.getByRole('button', { name: 'Done' }).focus();
      await page.clock.fastForward(20000);
      const hum = await page.evaluate(() => ({ ...window.__hum }));
      await h.shot(page, `moment-before-${tag}`);
      await how(other.page, '3 minutes').check();
      // time stands still here, so these waits are Playwright's own
      const shows = await page.locator('.dq-mo-len input[value="3"]:checked').waitFor({ timeout: 10000 }).then(() => true, () => false);
      if (!shows) problems.push(`${tag}: 3 minutes chosen in another tab does not show on the running moment`);
      await page.clock.fastForward(45000);
      const line = (await page.locator('.dq-mo-line').textContent()) ?? '';
      if (END.test(line)) problems.push(`${tag}: the moment ended at its old minute after 3 minutes was chosen in another tab`);
      const still = await page.evaluate(() => ({ ...window.__hum }));
      if (still.started !== hum.started || still.stopped !== hum.stopped || !hum.started) problems.push(`${tag}: the low hum was stopped or started again by the change elsewhere: ${JSON.stringify({ hum, still })}`);
      problems.push(...(await focusOn(page.getByRole('button', { name: 'Done' }), `${tag} Done on the running moment`)));
      await h.shot(page, `moment-after-${tag}`);
      // three minutes from the change, not from the start or from the first choice
      await page.clock.fastForward(133000);
      if (END.test((await page.locator('.dq-mo-line').textContent()) ?? '')) problems.push(`${tag}: the moment ended before 3 minutes had passed since the change`);
      await page.clock.fastForward(3000);
      const ends = await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 }).then(() => true, () => false);
      if (!ends) problems.push(`${tag}: the moment did not end 3 minutes after the change`);
      const fx = await page.evaluate(() => window.__fx);
      if (fx.length) problems.push(`${tag}: the moment played or showed this for another tab's doings: ${fx.join('; ')}`);
      await page.clock.resume();
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
