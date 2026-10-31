// Open screens follow what another open copy of the game changes, the moment it lands, at 390x844 and 320x568:
//   home-follows-tabs         Home shows the XP, stats, allies, today's line and the opened daily gift that another
//                             tab earned or chose, and its check-in follows a heavy check-in there and a lighter one
//                             after it; an open line history follows too. Nothing here plays, counts up or opens a
//                             window, focus and scroll stay where they were (focus on a check-in answer that goes moves
//                             to Check in again, seen whole), a check-in there after one answered here takes over,
//                             and an older copy of the save arriving after never lowers a number
//   night-watch-follows-tabs  the Night Watch's skill shadows take a skill met and one practised again in another tab,
//                             focus stays on the same skill's card, nothing plays, and an older copy arriving after
//                             never takes a shadow or a count away
//   moment-follows-tabs       How long chosen in another tab shows on a running moment, which goes on unbroken (its
//                             low hum still on, focus on Done) and lasts that long from the change, never ending early
//   home-looks-follow-tabs    a name plate, card back and title kept in another tab show on Home, and the open title
//                             list stays open with focus on the same title; names changed there show here without
//                             Home being drawn again: Stats stay open, focus and scroll stay put
//   restored-days-follow-tabs visit days restored in another tab deal the gift, today's card (and where Begin goes), the
//                             Art room's prompt on Home and in the Art room, and the Stealth room's line as a fresh
//                             visit would, while the card stays face down
//   night-watch-arrivals-tabs visit days restored in another tab bring their watchers into the row and the camp and the
//                             pebble into the Inventory, building the camp once and keeping a half-typed name and its
//                             focus; nothing unrelated builds it again, the companion renamed there is renamed here, and
//                             focus on a watcher in camp comes back to them, seen whole, once the camp built again shows
//   skill-list-follows-tabs   Trade Places' Activities, open in a skill, takes an activity added and one removed in
//                             another tab, staying on its step with what is typed and focus on the same choice
//   stealth-look-follows-tabs the aquarium and Breathing words turned on in another tab's Stealth room turn on here, the
//                             words joining the room's own breath, which goes on unbroken, and Bramble, arriving with
//                             visit days restored there, settles in here, focus staying where it was
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
/** A visit on each of `n` days, the latest two days ago. */
const visits = (n) =>
  Array.from({ length: n }, (_, i) => {
    const t = Date.now() - (i + 2) * 86400e3;
    const d = new Date(t);
    return { id: `v${i}`, k: 'visit', day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, t, xp: 10 };
  });
const TIPP = 'Frost Rune, TIPP. Practise it.';

async function open(h, viewport, prepare, save = SAVE) {
  const { ctx, page, errors } = await h.open({ [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: T, companionAt: T }), 'dbt.app.v1': h.SEEN, [h.SAVE]: save }, '?mute', viewport, prepare);
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
    };
  });
/**
 * Where things are on screen: the box of what has focus, and the top of each heading and section in view, so a check can
 * tell that what the player is looking at did not move or change size.
 */
const layout = (page) =>
  page.evaluate(() => {
    const box = (e) => Object.values(e.getBoundingClientRect().toJSON()).slice(0, 4);
    const top = document.querySelector('.dq-top')?.getBoundingClientRect().bottom ?? 0;
    const seen = [...document.querySelectorAll('.dq-view h1, .dq-view h2, .dq-view section')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height && r.bottom > top && r.top < innerHeight;
    });
    return { focus: document.activeElement === document.body ? null : box(document.activeElement), seen: Object.fromEntries(seen.map((e) => [`${e.tagName} ${e.id} ${e.className} ${e.textContent.slice(0, 24)}`, e.getBoundingClientRect().top])) };
  });
/** What moved by more than a pixel between two layouts: the focused box, and anything in view in both. */
const moved = (a, b, landmarks = true) => [
  ...(a.focus && b.focus && a.focus.some((v, i) => Math.abs(v - b.focus[i]) > 1) ? [`the focused control went from [${a.focus.map(Math.round)}] to [${b.focus.map(Math.round)}] (x, y, width, height)`] : []),
  ...(landmarks ? Object.keys(a.seen).filter((k) => k in b.seen && Math.abs(a.seen[k] - b.seen[k]) > 1).map((k) => `"${k.trim()}" moved from ${Math.round(a.seen[k])} to ${Math.round(b.seen[k])}`) : []),
];
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
      await toggle.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await toggle.focus();
      await mark(page);
      const before = await home(page);
      const was = await layout(page);
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
      problems.push(...moved(was, await layout(page), false).map((m) => `${tag}: on Home ${m}`));
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
      // answered here, then a heavier check-in there: it takes over from the answer
      await page.locator('.dq-checkin').getByRole('button', { name: 'Calm', exact: true }).click();
      await page.locator('.dq-checkin .dq-suggest').waitFor();
      await page.evaluate(() => (window.__fx = []));
      // that tab now asks again too, as this one checked in after it
      await other.page.locator('.dq-checkin').getByRole('button', { name: 'Hurt', exact: true }).click();
      await other.page.waitForFunction(() => window.__daily.route.name === 'ease');
      if (!(await until(page, () => !!document.querySelector('.dq-checkin .dq-after')))) problems.push(`${tag}: a heavy check-in in another tab after one answered here left the answer showing (${(await home(page)).checkin})`);
      await h.shot(page, `home-checkin-answered-then-heavy-${tag}`);

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
      const was = await layout(page);
      await h.shot(page, `night-watch-before-${tag}`);
      await go(other.page, { name: 'skill', id: 'wise-mind' });
      await go(other.page, { name: 'skill', id: 'tipp' });
      const cards = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dq-collection .dq-cardbtn:not(.dq-allyslot, .dq-allybtn)')].map((b) => [b.getAttribute('aria-label'), b.querySelector('.dq-cardbtn-n')?.textContent])));
      const want = { [WISE]: 'Practised 2x', [TIPP]: 'Practised 1x' };
      if (!(await until(page, (w) => Object.entries(w).every(([k, v]) => [...document.querySelectorAll('.dq-cardbtn')].some((b) => b.getAttribute('aria-label') === k && b.querySelector('.dq-cardbtn-n')?.textContent === v)), want))) problems.push(`${tag}: the skill shadows show ${JSON.stringify(await cards())} after another tab practised Wise Mind again and met TIPP`);
      await page.waitForTimeout(300);
      problems.push(...(await focusOn(page.getByRole('button', { name: WISE }), `${tag} Wise Mind's card after its count changed elsewhere`)));
      // the second skill landing neither resizes the card the player is on nor moves what is in view
      problems.push(...moved(was, await layout(page)).map((m) => `${tag}: on the Night Watch ${m}`));
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

  async 'home-looks-follow-tabs'(h) {
    const problems = [];
    const t = Date.now() - 2 * 86400e3;
    const day = visits(1)[0].day;
    const save = JSON.stringify({
      v: 1,
      created: T,
      events: [...visits(5), { id: 'r1', k: 'rest', day, t: t + 1000, xp: 10 }, { id: 's2', k: 'skill', day, t: t + 2000, xp: 20, stat: 'stamina', skill: 'self-validation' }],
      flags: { titlesSeen: ['professional-lurker', 'self-healer'] },
    });
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport, undefined, save);
      const other = await another(ctx, h);
      await watch(page);
      const toggle = page.locator('.w2-title-btn');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      const healer = page.getByRole('radio', { name: 'Self-Healer' });
      await healer.focus();
      await mark(page);
      const looks = () =>
        page.evaluate(() => ({
          plate: document.querySelector('.dq-status [data-you-name]')?.className,
          back: document.querySelector('.dq-cardface--back svg')?.outerHTML.includes('M50 26Q53.6 54 50 82'),
          title: document.querySelector('.w2-title-t')?.textContent,
          open: document.querySelector('.w2-title-btn')?.getAttribute('aria-expanded') === 'true' && !document.querySelector('.w2-title-list')?.classList.contains('is-hidden'),
          checked: document.querySelector('.w2-title-opt[aria-checked="true"]')?.textContent,
        }));
      const before = await looks();
      await h.shot(page, `home-looks-before-${tag}`);
      // another tab keeps Corner ticks, the Gate card back and Professional Lurker
      await other.page.evaluate(() => {
        const st = window.__daily.store;
        st.sync();
        Object.assign(st.state.settings, { plate: 'ticks', cardBack: 'gate', title: 'professional-lurker' });
        for (const k of ['plate', 'cardBack', 'title']) st.touch(k);
        st.save();
      });
      await until(page, () => window.__daily.store.state.settings.title === 'professional-lurker');
      await page.waitForTimeout(400);
      const after = await looks();
      if (!after.plate?.includes('w2-plate--ticks')) problems.push(`${tag}: the name plate is ${after.plate} after Corner ticks was kept in another tab`);
      if (!after.back) problems.push(`${tag}: Home's card back is not the Gate kept in another tab`);
      if (after.title !== 'Professional Lurker' || after.checked !== 'Professional Lurker') problems.push(`${tag}: the title shows ${after.title} (checked ${after.checked}) after Professional Lurker was worn in another tab`);
      if (!before.open || !after.open) problems.push(`${tag}: the open title list ${before.open ? 'closed' : 'never opened'} when a title was worn in another tab`);
      if (!(await kept(page))) problems.push(`${tag}: focus left Self-Healer in the open list for ${await page.evaluate(() => document.activeElement?.textContent)}`);
      else problems.push(...(await focusOn(healer, `${tag} Self-Healer in the open title list`)));
      await h.shot(page, `home-looks-after-${tag}`);
      // renamed there: Home keeps its open Stats, title list, focus and scroll
      await page.locator('.dq-stats-toggle').click();
      await healer.focus();
      const was = await layout(page);
      await go(other.page, { name: 'settings' });
      for (const [label, v] of [[/^Your name/, 'Rowan'], [/companion.s name/, 'Moth']]) {
        const f = other.page.getByLabel(label);
        await f.scrollIntoViewIfNeeded();
        await f.fill(v);
        await f.press('Enter');
        await f.blur();
      }
      const named = await until(page, () => document.querySelector('.dq-status [data-you-name]')?.textContent === 'Rowan' && document.querySelector('.dq-firstshadow')?.title.startsWith('Moth') && !!document.querySelector('.dq-firstshadow svg')?.getAttribute('aria-label')?.startsWith('Moth'));
      const home_ = await page.evaluate(() => ({ stats: document.querySelector('.dq-status')?.classList.contains('is-open'), list: !document.querySelector('.w2-title-list')?.classList.contains('is-hidden') }));
      if (!named) problems.push(`${tag}: Home shows ${await page.evaluate(() => `${document.querySelector('.dq-status [data-you-name]')?.textContent} and ${document.querySelector('.dq-firstshadow')?.title}`)} after Rowan and Moth were chosen in another tab`);
      if (!home_.stats || !home_.list) problems.push(`${tag}: renaming elsewhere left Stats ${home_.stats ? 'open' : 'closed'} and the title list ${home_.list ? 'open' : 'closed'}`);
      problems.push(...moved(was, await layout(page), false).map((m) => `${tag}: renaming elsewhere, on Home ${m}`));
      problems.push(...(await focusOn(healer, `${tag} Self-Healer after renaming elsewhere`)));
      const fx = await page.evaluate(() => window.__fx);
      if (fx.length) problems.push(`${tag}: Home played or showed this for another tab's doings: ${fx.join('; ')}`);
      await h.shot(page, `home-renamed-${tag}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'night-watch-arrivals-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport, undefined, JSON.stringify({ v: 1, created: T, events: visits(2) }));
      const other = await another(ctx, h);
      await go(page, { name: 'shadows' });
      await page.locator('.w2-roster').waitFor();
      await page.waitForFunction(() => window.__camp?.builds >= 1, null, { timeout: 30000 });
      await watch(page);
      const field = page.locator('[data-shadow="sable"] input');
      await field.scrollIntoViewIfNeeded();
      await field.click();
      await page.keyboard.type('Pi');
      await mark(page);
      const roster = () =>
        page.evaluate(() => ({
          named: [...document.querySelectorAll('.w2-roster-row .w2-sh:not(.is-locked)')].map((e) => e.dataset.shadow),
          camp: [...(window.__camp?.ids ?? [])],
          builds: window.__camp?.builds,
          pebble: !!document.querySelector('.w2-inv [data-item="pebble"]'),
          typed: document.querySelector('[data-shadow="sable"] input')?.value,
          first: document.querySelector('.dq-first-n')?.textContent,
        }));
      const before = await roster();
      await h.shot(page, `night-watch-arrivals-before-${tag}`);
      // another tab restores a save with eleven visit days
      await other.page.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, JSON.stringify({ v: 1, created: T, events: visits(10) })]);
      const arrived = await until(page, () => !!document.querySelector('.w2-roster-row [data-shadow="vesper"]:not(.is-locked)'));
      await page.waitForTimeout(600);
      const after = await roster();
      if (!arrived || !['bramble', 'vesper'].every((id) => after.named.includes(id) && after.camp.includes(id))) problems.push(`${tag}: after eleven visit days arrived elsewhere the row has ${after.named} and the camp ${after.camp}`);
      if (!after.pebble) problems.push(`${tag}: the Inventory is still empty after eleven visit days arrived elsewhere`);
      if (after.builds !== before.builds + 1) problems.push(`${tag}: the camp was built ${after.builds - before.builds} times for one arrival`);
      if (after.typed !== 'Pi' || !(await kept(page))) problems.push(`${tag}: the half-typed name is "${after.typed}" and focus is on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`);
      await h.shot(page, `night-watch-arrivals-after-${tag}`);
      // something unrelated there builds nothing here; the companion renamed there is renamed here
      await go(other.page, { name: 'skill', id: 'tipp' });
      await until(page, () => document.querySelector('[aria-label="Frost Rune, TIPP. Practise it."]'));
      await go(other.page, { name: 'settings' });
      const name = other.page.getByLabel(/companion.s name/);
      await name.scrollIntoViewIfNeeded();
      await name.fill('Moth');
      await name.press('Enter');
      await name.blur();
      if (!(await until(page, () => document.querySelector('.dq-first-n')?.textContent === 'Moth'))) problems.push(`${tag}: the companion renamed Moth in another tab is still ${(await roster()).first} here`);
      const last = await roster();
      if (last.builds !== after.builds) problems.push(`${tag}: the camp was built again for a change that brought nobody (${after.builds} to ${last.builds})`);
      // Crest arrives while Sable has focus in camp: once the camp built again shows, Sable has it again
      // the camp's scene runs, and its buttons show, only while it is on screen
      await page.locator('.w2-camp').scrollIntoViewIfNeeded();
      const sable = page.locator('.w2-camp.is-scene-live .w2-camp-hit[data-shadow="sable"]');
      await sable.waitFor({ timeout: 30000 });
      await sable.focus();
      await other.page.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, JSON.stringify({ v: 1, created: T, events: visits(14) })]);
      if (!(await until(page, () => window.__camp?.ids.includes('crest') && document.activeElement?.matches('.w2-camp-hit[data-shadow="sable"]')))) problems.push(`${tag}: with Crest arrived elsewhere focus is on ${await page.evaluate(() => document.activeElement?.tagName)}, not Sable in camp (camp ${(await roster()).camp})`);
      else {
        // seen whole, ring and all, under the top bar; where Vesper stands behind him, his button lies over part of
        // Sable's box on purpose, so only Sable's middle has to be his
        const seen = await page.evaluate(() => {
          const e = document.activeElement;
          const cs = getComputedStyle(e);
          const ring = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset));
          const r = e.getBoundingClientRect();
          const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
          const mid = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          return r.top - ring >= top - 0.5 && r.bottom + ring <= innerHeight + 0.5 && r.left - ring >= -0.5 && r.right + ring <= innerWidth + 0.5 && (mid === e || e.contains(mid));
        });
        if (!seen) problems.push(`${tag}: Sable has focus again in the camp built again, but is not all in view`);
      }
      await h.shot(page, `night-watch-camp-focus-${tag}`);
      const fx = await page.evaluate(() => window.__fx);
      if (fx.length) problems.push(`${tag}: the Night Watch played or showed this for another tab's doings: ${fx.join('; ')}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'skill-list-follows-tabs'(h) {
    const problems = [];
    const lists = { comfort: [], reasons: [], people: [], activities: [{ id: 'a1', text: 'Jigsaw puzzle', at: T }, { id: 'a2', text: 'Bake bread', at: T }] };
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport, undefined, JSON.stringify({ v: 1, created: T, events: visits(1), lists }));
      const other = await another(ctx, h);
      await go(page, { name: 'skill', id: 'accepts', entry: 'a' });
      const begin = page.getByRole('button', { name: 'Begin', exact: true });
      if (await begin.isVisible().catch(() => false)) await begin.click();
      const add = page.getByRole('button', { name: 'Add and pick' });
      await add.waitFor();
      await watch(page);
      await page.locator('.dq-addrow input').fill('Kite');
      const bread = page.getByRole('button', { name: 'Bake bread', exact: true });
      await bread.focus();
      await go(other.page, { name: 'comfort' });
      await other.page.getByRole('button', { name: 'Remove Jigsaw puzzle' }).click();
      const panel = other.page.locator('.dq-listp--activities');
      await panel.locator('input').fill('Night swim');
      await panel.getByRole('button', { name: 'Add', exact: true }).click();
      const chips = () => page.evaluate(() => [...document.querySelectorAll('.dq-opts .dq-opt')].map((b) => b.textContent));
      if (!(await until(page, () => [...document.querySelectorAll('.dq-opts .dq-opt')].map((b) => b.textContent).join('|') === 'Bake bread|Night swim'))) problems.push(`${tag}: Activities shows ${(await chips()).join(', ')} after another tab removed Jigsaw puzzle and added Night swim`);
      await page.waitForTimeout(300);
      const still = await page.evaluate(() => ({ typed: document.querySelector('.dq-addrow input')?.value, route: window.__daily.route.name }));
      if (still.typed !== 'Kite' || still.route !== 'skill' || !(await page.getByText('A. Activities').first().isVisible())) problems.push(`${tag}: the step moved or lost what was typed: ${JSON.stringify(still)}`);
      problems.push(...(await focusOn(page.getByRole('button', { name: 'Bake bread', exact: true }), `${tag} Bake bread in Activities`)));
      const fx = await page.evaluate(() => window.__fx);
      if (fx.length) problems.push(`${tag}: the skill played or showed this for another tab's doings: ${fx.join('; ')}`);
      await h.shot(page, `skill-list-after-${tag}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'stealth-look-follows-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport);
      const other = await another(ctx, h);
      await go(page, { name: 'rest' });
      await page.locator('.dq-stealth').waitFor();
      await page.waitForTimeout(1200);
      await watch(page);
      await page.evaluate(() => (window.__breath = document.querySelector('.dq-st-glow').getAnimations()[0]));
      const t0 = await page.evaluate(() => window.__breath?.currentTime);
      await page.locator('.dq-st-mode').first().focus();
      await mark(page);
      await go(other.page, { name: 'rest' });
      await other.page.locator('.dq-stealth').waitFor();
      for (const b of await other.page.locator('.dq-st-mode').all()) await b.click();
      const both = await until(page, () => !!document.querySelector('.dq-stealth.is-aquarium.is-words'));
      await page.waitForTimeout(300);
      const room = await page.evaluate(() => {
        const glow = document.querySelector('.dq-st-glow').getAnimations()[0];
        const word = document.querySelector('.dq-st-word span').getAnimations()[0];
        const d = (a) => Number(a.effect.getTiming().duration);
        return {
          pressed: [...document.querySelectorAll('.dq-st-mode')].map((b) => b.getAttribute('aria-pressed')),
          same: glow === window.__breath,
          t: glow?.currentTime,
          gap: word && glow ? Math.abs((word.currentTime % d(word)) - (glow.currentTime % d(glow))) : null,
          period: glow ? d(glow) : null,
        };
      });
      if (!both || room.pressed.join() !== 'true,true') problems.push(`${tag}: the aquarium and Breathing words turned on elsewhere show ${room.pressed} here`);
      if (!room.same || !(room.t > t0)) problems.push(`${tag}: the room's breath started again (${t0} to ${room.t})`);
      if (room.gap === null || Math.min(room.gap, room.period - room.gap) > 120) problems.push(`${tag}: Breathing words are ${room.gap} ms out of step with the room's breath`);
      // visit days restored there bring Bramble here
      await other.page.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, JSON.stringify({ v: 1, created: T, events: visits(10) })]);
      if (!(await until(page, () => document.querySelector('.dq-stealth .w2-bramble')?.checkVisibility()))) problems.push(`${tag}: Bramble, arrived with visit days restored elsewhere, is not in the Stealth room`);
      const still = await page.evaluate(() => document.querySelector('.dq-st-glow').getAnimations()[0] === window.__breath);
      if (!still) problems.push(`${tag}: the room's breath started again when Bramble arrived`);
      if (!(await kept(page))) problems.push(`${tag}: focus left the Aquarium button for ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`);
      await h.shot(page, `stealth-look-after-${tag}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'restored-days-follow-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await open(h, viewport);
      const art = await another(ctx, h);
      await go(art.page, { name: 'art' });
      await art.page.locator('.dq-artentry-prompt').waitFor();
      const room = await another(ctx, h);
      await go(room.page, { name: 'rest' });
      await room.page.locator('.dq-st-line').waitFor();
      const other = await another(ctx, h);
      await h.reachHub(other.page);
      await watch(page);
      const dealt = (p) =>
        p.evaluate(() => ({
          gift: document.querySelector('.dq-gift-t')?.textContent,
          card: document.querySelector('.dq-cardface--front .dq-cf-name')?.textContent,
          prompt: document.querySelector('.dq-tile--art .dq-tile-s')?.textContent,
          faceDown: !document.querySelector('.dq-card')?.classList.contains('is-open'),
        }));
      const before = await dealt(page);
      // another tab restores ten more visit days; once every copy holds them, it draws Home afresh as the one to match
      await other.page.evaluate(([k, v]) => localStorage.setItem(k, v), [h.SAVE, JSON.stringify({ v: 1, created: T, events: visits(10) })]);
      await until(other.page, () => window.__daily.store.derived().visitDays.length >= 12);
      await other.page.reload();
      await h.reachHub(other.page);
      const fresh = await dealt(other.page);
      await page.waitForTimeout(500);
      const now = await dealt(page);
      if (['gift', 'card', 'prompt'].every((k) => before[k] === fresh[k])) problems.push(`${tag}: the restored days dealt nothing new, so this proves nothing`);
      for (const k of ['gift', 'card', 'prompt']) if (now[k] !== fresh[k]) problems.push(`${tag}: Home's ${k} is "${now[k]}", a fresh visit's "${fresh[k]}"`);
      if (!now.faceDown) problems.push(`${tag}: today's card turned over by itself`);
      const artPrompt = await art.page.locator('.dq-artentry-prompt').textContent();
      if (artPrompt !== fresh.prompt) problems.push(`${tag}: the Art room's prompt is "${artPrompt}", a fresh visit's "${fresh.prompt}"`);
      const line = await room.page.locator('.dq-st-line').textContent();
      await go(other.page, { name: 'rest' });
      const freshLine = await other.page.locator('.dq-st-line').textContent();
      if (line !== freshLine) problems.push(`${tag}: the Stealth room's line is "${line}", a fresh visit's "${freshLine}"`);
      const fx = await page.evaluate(() => window.__fx);
      if (fx.length) problems.push(`${tag}: Home played or showed this for another tab's doings: ${fx.join('; ')}`);
      await h.shot(page, `restored-days-home-${tag}`);
      // Begin opens the card now dealt
      const want = await page.evaluate(() => window.__daily.store.quest());
      await page.locator('.dq-quest .dq-card').click({ force: true });
      await page.locator('.dq-quest-go:not(.is-hidden)').waitFor();
      await page.locator('.dq-quest-go').click();
      const went = await page.evaluate(() => window.__daily.route);
      const wanted = want.special === 'comfort' ? 'comfort' : want.special === 'free' ? 'shadows' : `skill ${want.skill}`;
      const got = went.name === 'skill' ? `skill ${went.id}` : went.name;
      if (got !== wanted) problems.push(`${tag}: Begin went to ${got}, not today's ${wanted}`);
      problems.push(...[errors, art.errors, room.errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
