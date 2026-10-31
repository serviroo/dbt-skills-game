// An open Safe Zone follows what another open copy of the game changes, the moment it lands, at 390x844 and 320x568:
//   safe-zone-tabs-clear      the game's data cleared in another tab while Your people, Things that are yours and the
//                             comfort kit are open: each shows the cleared state at once (no person, number or list
//                             item anywhere on the page, the closed "Copy your lists" preview and what was being
//                             typed in included), at Regular text with the light down, "Talk to someone now" still pinned, focus that was on a Call link at
//                             the top of the Safe Zone, nothing shown or played, and Leave still leaves at once
//   safe-zone-tabs-remove     one person removed in another tab while Your people is open: they go at once with their
//                             Call and Text, focus on someone else's Call stays on it, focus on the last one's goes to
//                             the top, what is being typed stays, and nothing is credited, shown or played
//   safe-zone-tabs-lists      list items added and removed in another tab reach Things that are yours and the comfort
//                             kit as they land, and a half-typed new item stays
//   comfort-page-tabs         the Comfort page follows another tab too: a removed person or item goes with its buttons,
//                             what is being typed stays, and focus on a Remove that went moves to that list's Add
//   diary-skills-today-tabs   a skill practised in another tab shows in the open Diary card's Skills today
//   tabs-same-name            two people with the same name: removing the one whose Call or Remove has focus in another
//                             tab never hands focus to the other one's, in the Safe Zone or on the Comfort page
//   safe-zone-tabs-text-size  Text size chosen in another tab reaches an open Safe Zone, Settings and a story being read,
//                             and the Safe Zone's light turned up in another tab turns up here
//   safe-zone-tabs-held       where storage refuses them, a text size and light held for the visit give way to a size
//                             stored later in another tab, and a clear there takes both
import { boot } from './layout-fit.e2e.mjs';

const SIZES = [
  ['390x844', { width: 390, height: 844 }],
  ['320x568', { width: 320, height: 568 }],
];
const T = Date.now() - 86400e3;
const LISTS = {
  reasons: [{ id: 'r1', text: 'Quillfeather walks', at: T }, { id: 'r2', text: 'Lanternfish facts', at: T }],
  comfort: [{ id: 'c1', text: 'Marmalade toast tins', at: T }],
  activities: [],
  people: [{ id: 'p1', name: 'Wren Okafor', phone: '+44 20 7946 0958', at: T }, { id: 'p2', name: 'Juno Pell', phone: '+44 20 7946 0123', at: T }],
};
/** Everything personal in the seeded save, as typed and as the Call and Text links carry the numbers. */
const PERSONAL = ['Wren Okafor', 'Juno Pell', '7946 0958', '79460958', '7946 0123', '79460123', 'Quillfeather', 'Lanternfish', 'Marmalade'];
const EMPTY = {
  people: 'You can add people you trust here whenever you like.',
  reasons: 'Nothing here yet. Here’s one to start: you came here to look after yourself.',
  comfort: 'Nothing saved yet. A blanket, a warm drink and a slow song are good places to start.',
};
const HEADING = { people: 'Your people', reasons: 'Things that are yours', comfort: 'Your comfort kit' };

/** One open copy on a returning save with lists and people, at Largest with the Safe Zone's light up unless told. */
async function first(h, viewport, { lists = LISTS, size = 'largest', light = 'up' } = {}) {
  const seed = {
    [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: T, companionAt: T }),
    'dbt.app.v1': h.SEEN,
    [h.SAVE]: JSON.stringify({ v: 1, created: T, events: [], lists }),
    ...(size ? { [`${h.SAVE}.read-size`]: size } : {}),
    ...(light ? { [`${h.SAVE}.safe-light`]: light } : {}),
  };
  const { ctx, page, errors } = await h.open(seed, '?mute', viewport);
  await h.reachHub(page);
  return { ctx, page, errors };
}
/** Another tab of the same browser, on Home. */
async function another(ctx, h) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${h.server.url}/?mute`);
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
  return { page, errors };
}
const go = (page, route) => page.evaluate((r) => window.__daily.go(r), route);
const safeAt = async (page, at) => {
  await go(page, { name: 'safe', at });
  await page.locator('.dq-sz-t', { hasText: HEADING[at] }).first().waitFor({ timeout: 10000 });
};
/** Focuses the Safe Zone's top, then tabs on to the control called `name`. */
async function tabTo(page, name) {
  await page.evaluate(() => document.querySelector('.dq-safezone h1').focus());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === name) return;
  }
  throw new Error(`Tab never reached "${name}"`);
}
/** Opens "Copy your lists", then closes it, so its preview has held the lists. */
async function peekLists(page) {
  await page.getByRole('button', { name: 'Copy your lists' }).click();
  await page.waitForFunction(() => document.querySelector('.dq-lists-copy pre')?.textContent);
  await page.locator('.dq-lists-copy').getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => !document.querySelector('.dq-lists-copy')?.checkVisibility());
}
/** Opens the screen's add form and types into it without saving: a person's name and number, or a list item. */
async function draft(page, ...words) {
  await page.getByRole('button', { name: /^(Add a person|Add one)$/ }).click();
  const fields = page.locator('.dq-safezone .dq-person-add input, .dq-safezone .dq-addrow input');
  for (const [i, w] of words.entries()) await fields.nth(i).fill(w);
}
/** What an open Safe Zone shows and holds right now. */
const zone = (page) =>
  page.evaluate((personal) => {
    const sz = document.querySelector('.dq-safezone');
    const talk = document.querySelector('.dq-sz-foot .dq-sz-talk');
    const r = talk?.getBoundingClientRect();
    const a = document.activeElement;
    return {
      route: window.__daily.route.name,
      kept: personal.filter((s) => document.documentElement.outerHTML.includes(s)),
      people: [...document.querySelectorAll('.dq-person-n')].map((e) => e.textContent),
      items: [...document.querySelectorAll('.dq-sz-list li')].map((e) => e.textContent),
      typed: [...document.querySelectorAll('.dq-safezone input.dq-input, .dq-safezone textarea')].map((i) => i.value).filter(Boolean),
      empty: document.querySelector('.dq-sz-empty')?.checkVisibility() ? document.querySelector('.dq-sz-empty').textContent : null,
      size: sz?.dataset.size,
      lit: !!sz?.classList.contains('is-lit'),
      talk: !!talk?.checkVisibility() && !talk.classList.contains('is-hidden') && r.top >= 0 && r.bottom <= innerHeight,
      focus: !a || a === document.body ? 'nothing' : a.matches('.dq-safezone h1') ? 'the top' : a.getAttribute('aria-label') ?? a.textContent.trim().slice(0, 40),
      fx: document.querySelectorAll('[data-fx], .dq-toast.is-on, .dq-sw, .lw').length,
      xp: window.__daily.store.derived().xp,
    };
  }, PERSONAL);
/** Leave goes at once, asking nothing. */
async function leaves(page) {
  await page.locator('.dq-top .dq-back').click();
  return page.evaluate(() => window.__daily.route.name !== 'safe' && !document.querySelector('.lw, .dq-sw, [role=alertdialog]'));
}
/** Settings > Your data: Back up, then clear, then clear for real, until it says All clear. */
async function clearGame(page) {
  await go(page, { name: 'settings' });
  await page.locator('.dq-clear').scrollIntoViewIfNeeded();
  await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Back up, then clear' }).click()]);
  await page.getByRole('button', { name: /^Clear this game.s data$/ }).click();
  await page.locator('.dq-cleared-h', { hasText: 'All clear' }).waitFor({ timeout: 30000 });
}
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).then(() => true, () => false);

export const scenarios = {
  async 'safe-zone-tabs-clear'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page: people, errors } = await first(h, viewport);
      await safeAt(people, 'people');
      const reasons = await another(ctx, h);
      await safeAt(reasons.page, 'reasons');
      const comfort = await another(ctx, h);
      await safeAt(comfort.page, 'comfort');
      const other = await another(ctx, h);
      await peekLists(people);
      await draft(people, 'Rook Adeyemi', '+44 20 7946 0777');
      await draft(reasons.page, 'Owl pellets');
      await tabTo(people, 'Call Wren Okafor');
      const open = { people, reasons: reasons.page, comfort: comfort.page };
      for (const [at, page] of Object.entries(open)) {
        const before = await zone(page);
        if (!before.kept.length || before.size !== 'largest' || !before.lit) problems.push(`${tag} ${at}: the seeded lists, Largest and the light are not showing before the clear: ${JSON.stringify(before)}`);
        await h.shot(page, `clear-before-${at}-${tag}`);
      }
      await clearGame(other.page);
      for (const [at, page] of Object.entries(open)) {
        await until(page, (want) => document.querySelector('.dq-sz-empty')?.textContent === want, EMPTY[at]);
        const after = await zone(page);
        if (after.route !== 'safe') problems.push(`${tag} ${at}: the Safe Zone closed when the game was cleared elsewhere`);
        if (after.kept.length) problems.push(`${tag} ${at}: still on the page after a clear elsewhere: ${after.kept.join(', ')}`);
        if (after.typed.length) problems.push(`${tag} ${at}: what was being typed is still there after a clear elsewhere: ${after.typed.join(', ')}`);
        if (after.empty !== EMPTY[at] || after.people.length || after.items.length) problems.push(`${tag} ${at}: not the cleared state: ${JSON.stringify(after)}`);
        if (after.size !== 'regular' || after.lit) problems.push(`${tag} ${at}: text ${after.size} and light ${after.lit ? 'up' : 'down'} after a clear, not Regular and down`);
        if (!after.talk) problems.push(`${tag} ${at}: "Talk to someone now" is not pinned in view after the clear`);
        if (after.fx) problems.push(`${tag} ${at}: the clear showed ${after.fx} toast, window or effect in the Safe Zone`);
        if (at === 'people' && after.focus !== 'the top') problems.push(`${tag}: focus on Call Wren Okafor went to ${after.focus}, not the top of the Safe Zone`);
        await h.shot(page, `clear-after-${at}-${tag}`);
        if (!(await leaves(page))) problems.push(`${tag} ${at}: Leave did not leave at once after the clear`);
      }
      problems.push(...[errors, reasons.errors, comfort.errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-tabs-remove'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await first(h, viewport);
      await safeAt(page, 'people');
      const other = await another(ctx, h);
      await go(other.page, { name: 'comfort' });
      await other.page.getByRole('button', { name: 'Remove Wren Okafor' }).waitFor();
      await peekLists(page);
      await draft(page, 'Half a name');
      const was = await zone(page);
      await tabTo(page, 'Call Juno Pell');
      await other.page.getByRole('button', { name: 'Remove Wren Okafor' }).click();
      await until(page, () => ![...document.querySelectorAll('.dq-person-n')].some((e) => e.textContent === 'Wren Okafor'));
      let now = await zone(page);
      const wren = now.kept.filter((s) => s.startsWith('Wren') || s.includes('0958'));
      if (wren.length) problems.push(`${tag}: removed in another tab, still on the page: ${wren.join(', ')}`);
      if (JSON.stringify(now.people) !== '["Juno Pell"]') problems.push(`${tag}: Your people shows ${JSON.stringify(now.people)} after Wren was removed elsewhere`);
      if (now.focus !== 'Call Juno Pell') problems.push(`${tag}: focus on Call Juno Pell moved to ${now.focus} when Wren went`);
      await h.shot(page, `remove-one-${tag}`);
      await other.page.getByRole('button', { name: 'Remove Juno Pell' }).click();
      await until(page, (want) => document.querySelector('.dq-sz-empty')?.textContent === want, EMPTY.people);
      now = await zone(page);
      const juno = now.kept.filter((s) => s.startsWith('Juno') || s.includes('0123'));
      if (juno.length || now.people.length || now.empty !== EMPTY.people) problems.push(`${tag}: after the last person went elsewhere: ${JSON.stringify(now)}`);
      if (now.focus !== 'the top') problems.push(`${tag}: focus on Call Juno Pell went to ${now.focus}, not the top of the Safe Zone, when Juno went`);
      if (JSON.stringify(now.typed) !== '["Half a name"]') problems.push(`${tag}: what was being typed became ${JSON.stringify(now.typed)} as people went elsewhere`);
      if (!now.talk || now.fx || now.xp !== was.xp) problems.push(`${tag}: Talk pinned ${now.talk}, ${now.fx} toast, window or effect, XP ${was.xp} to ${now.xp}`);
      await h.shot(page, `remove-last-${tag}`);
      if (!(await leaves(page))) problems.push(`${tag}: Leave did not leave at once`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-tabs-lists'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page: reasons, errors } = await first(h, viewport);
      await safeAt(reasons, 'reasons');
      const comfort = await another(ctx, h);
      await safeAt(comfort.page, 'comfort');
      const other = await another(ctx, h);
      await go(other.page, { name: 'comfort' });
      await reasons.getByRole('button', { name: 'Add one' }).click();
      await reasons.locator('.dq-addrow input').fill('Half a thought');
      const mine = other.page.locator('.dq-listp--reasons');
      await mine.locator('input').fill('Kestrel feathers');
      await mine.getByRole('button', { name: 'Add', exact: true }).click();
      await other.page.getByRole('button', { name: 'Remove Quillfeather walks' }).click();
      await until(reasons, () => {
        const items = [...document.querySelectorAll('.dq-sz-list li')].map((e) => e.textContent);
        return items.includes('Kestrel feathers') && !items.includes('Quillfeather walks');
      });
      const r = await zone(reasons);
      if (JSON.stringify(r.items) !== '["Lanternfish facts","Kestrel feathers"]') problems.push(`${tag}: Things that are yours shows ${JSON.stringify(r.items)} after an add and a removal elsewhere`);
      if (r.kept.includes('Quillfeather')) problems.push(`${tag}: Quillfeather walks, removed elsewhere, is still on the page`);
      if ((await reasons.locator('.dq-addrow input').inputValue()) !== 'Half a thought') problems.push(`${tag}: the half-typed item went when the list changed`);
      await h.shot(reasons, `lists-reasons-${tag}`);
      await other.page.getByRole('button', { name: 'Remove Marmalade toast tins' }).click();
      await until(comfort.page, (want) => document.querySelector('.dq-sz-empty')?.textContent === want, EMPTY.comfort);
      const c = await zone(comfort.page);
      if (c.items.length || c.empty !== EMPTY.comfort || c.kept.includes('Marmalade')) problems.push(`${tag}: the comfort kit after its last item went elsewhere: ${JSON.stringify(c)}`);
      if (!r.talk || !c.talk || r.fx || c.fx) problems.push(`${tag}: Talk pinned ${r.talk} and ${c.talk}, ${r.fx + c.fx} toast, window or effect`);
      await h.shot(comfort.page, `lists-comfort-${tag}`);
      problems.push(...[errors, comfort.errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'comfort-page-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await first(h, viewport);
      await go(page, { name: 'comfort' });
      const other = await another(ctx, h);
      await go(other.page, { name: 'comfort' });
      const kit = page.locator('.dq-listp--comfort input');
      await kit.fill('Warm socks');
      const remove = page.getByRole('button', { name: 'Remove Quillfeather walks' });
      await remove.focus();
      await other.page.getByRole('button', { name: 'Remove Quillfeather walks' }).click();
      await until(page, () => !document.querySelector('[aria-label="Remove Quillfeather walks"]'));
      const focus = await page.evaluate(() => (document.activeElement?.closest('.dq-listp--reasons') ? document.activeElement.textContent.trim() : document.activeElement?.tagName));
      if (focus !== 'Add') problems.push(`${tag}: focus on Remove Quillfeather walks went to ${focus}, not that list's Add`);
      await other.page.getByRole('button', { name: 'Remove Wren Okafor' }).click();
      await until(page, () => !document.documentElement.outerHTML.includes('Wren Okafor'));
      const left = await page.evaluate((personal) => personal.filter((s) => document.documentElement.outerHTML.includes(s)), PERSONAL);
      if (left.some((s) => /Quill|Wren|0958/.test(s))) problems.push(`${tag}: removed in another tab, still on the Comfort page: ${left.join(', ')}`);
      if (!left.includes('Juno Pell') || !(await page.locator('a[href="tel:+442079460123"]').count())) problems.push(`${tag}: Juno Pell, still kept, lost their Call`);
      if ((await kit.inputValue()) !== 'Warm socks') problems.push(`${tag}: what was being typed in the comfort kit went`);
      await h.shot(page, `comfort-page-${tag}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'diary-skills-today-tabs'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await first(h, viewport);
      await go(page, { name: 'diary' });
      await page.getByText('None yet today. That is fine.').waitFor({ timeout: 10000 });
      const other = await another(ctx, h);
      await go(other.page, { name: 'skill', id: 'tipp' });
      if (!(await until(page, () => [...document.querySelectorAll('.dq-skillsused li')].some((li) => li.textContent.includes('Frost Rune (TIPP)'))))) problems.push(`${tag}: TIPP practised in another tab is not in the open Diary card's Skills today`);
      await h.shot(page, `diary-skills-today-${tag}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'tabs-same-name'(h) {
    const problems = [];
    const twins = { ...LISTS, people: [{ id: 'p1', name: 'Sam Ash', phone: '+44 20 7946 0555', at: T }, { id: 'p2', name: 'Sam Ash', phone: '+44 20 7946 0555', at: T }] };
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await first(h, viewport, { lists: twins });
      await safeAt(page, 'people');
      const comfort = await another(ctx, h);
      await go(comfort.page, { name: 'comfort' });
      const other = await another(ctx, h);
      await go(other.page, { name: 'comfort' });
      await tabTo(page, 'Call Sam Ash');
      await comfort.page.getByRole('button', { name: 'Remove Sam Ash' }).first().focus();
      await other.page.getByRole('button', { name: 'Remove Sam Ash' }).first().click();
      await until(page, () => document.querySelectorAll('.dq-person-n').length === 1);
      await until(comfort.page, () => document.querySelectorAll('[aria-label="Remove Sam Ash"]').length === 1);
      const safe = await zone(page);
      const left = await comfort.page.evaluate(() => ({ n: document.querySelectorAll('[aria-label="Remove Sam Ash"]').length, focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent.trim() }));
      if (safe.people.length !== 1 || safe.focus !== 'the top') problems.push(`${tag}: the Safe Zone after one Sam Ash went elsewhere shows ${safe.people.length} and focus on ${safe.focus}, not the top`);
      if (left.n !== 1 || left.focus !== 'Add person') problems.push(`${tag}: the Comfort page after one Sam Ash went elsewhere shows ${left.n} and focus on ${left.focus}, not Add person`);
      await h.shot(page, `same-name-safe-${tag}`);
      problems.push(...[errors, comfort.errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-tabs-held'(h) {
    const problems = [];
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await first(h, viewport, { size: null, light: null });
      // this copy's storage refuses the text size and the light, as a full or blocked one does, until it recovers
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        window.__refuse = true;
        Storage.prototype.setItem = function (k, v) {
          if (window.__refuse && /\.(read-size|safe-light)$/.test(String(k))) throw new DOMException('Storage is full', 'QuotaExceededError');
          return set.call(this, k, v);
        };
      });
      await go(page, { name: 'settings' });
      const larger = page.getByRole('radio', { name: 'Text size: Larger' });
      await larger.scrollIntoViewIfNeeded();
      await larger.click();
      await go(page, { name: 'safe', at: 'start' });
      await page.locator('.dq-safezone .dq-sz-t').first().waitFor();
      await page.locator('.ca-sz-light').click();
      const held = await zone(page);
      const kept = await page.evaluate((k) => [localStorage.getItem(`${k}.read-size`), localStorage.getItem(`${k}.safe-light`)], h.SAVE);
      if (held.size !== 'large' || !held.lit || kept.some((v) => v !== null)) problems.push(`${tag}: with storage refusing them, Larger and the light did not hold for the visit: ${JSON.stringify({ size: held.size, lit: held.lit, kept })}`);
      await page.evaluate(() => (window.__refuse = false));
      const other = await another(ctx, h);
      await go(other.page, { name: 'settings' });
      const largest = other.page.getByRole('radio', { name: 'Text size: Largest' });
      await largest.scrollIntoViewIfNeeded();
      await largest.click();
      if (!(await until(page, () => document.querySelector('.dq-safezone')?.dataset.size === 'largest'))) problems.push(`${tag}: Largest stored in another tab did not take over from the size held here (${(await zone(page)).size})`);
      await clearGame(other.page);
      await until(page, () => !document.querySelector('.dq-safezone')?.classList.contains('is-lit'));
      const after = await zone(page);
      if (after.lit || after.size !== 'regular' || after.route !== 'safe') problems.push(`${tag}: after a clear elsewhere the light held for this visit is ${after.lit ? 'up' : 'down'} and the text ${after.size}, on ${after.route}`);
      await h.shot(page, `held-after-clear-${tag}`);
      problems.push(...[errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },

  async 'safe-zone-tabs-text-size'(h) {
    const problems = [];
    const px = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.dq-safezone .dq-sz-t')).fontSize));
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors } = await boot(h, viewport);
      await go(page, { name: 'safe', at: 'start' });
      await page.locator('.dq-safezone .dq-sz-t').first().waitFor();
      const regular = await px(page);
      const settings = await another(ctx, h);
      await go(settings.page, { name: 'settings' });
      const reading = await another(ctx, h);
      await go(reading.page, { name: 'read', id: 'tale-1' });
      await reading.page.locator('.st-read').waitFor();
      const other = await another(ctx, h);
      await go(other.page, { name: 'settings' });
      const largest = other.page.getByRole('radio', { name: 'Text size: Largest' });
      await largest.scrollIntoViewIfNeeded();
      await largest.click();
      await until(page, () => document.querySelector('.dq-safezone')?.dataset.size === 'largest');
      const got = {
        safe: await page.evaluate(() => document.querySelector('.dq-safezone')?.dataset.size),
        settings: await settings.page.getByRole('radio', { name: 'Text size: Largest' }).getAttribute('aria-checked'),
        reading: await reading.page.evaluate(() => `${document.querySelector('.st-read')?.dataset.size} ${document.querySelector('.st-size-b--largest')?.getAttribute('aria-pressed')}`),
      };
      if (got.safe !== 'largest' || got.settings !== 'true' || got.reading !== 'largest true') problems.push(`${tag}: Largest picked in another tab reached ${JSON.stringify(got)}`);
      const big = await px(page);
      if (big < regular * 1.29) problems.push(`${tag}: the Safe Zone heading is ${big}px after Largest elsewhere, ${regular}px before`);
      await h.shot(page, `text-size-largest-${tag}`);
      await go(other.page, { name: 'safe', at: 'start' });
      await other.page.locator('.ca-sz-light').click();
      if (!(await until(page, () => document.querySelector('.dq-safezone')?.classList.contains('is-lit')))) problems.push(`${tag}: the light turned up in another tab stayed down here`);
      const z = await zone(page);
      if (!z.talk || z.fx || z.route !== 'safe') problems.push(`${tag}: after the changes Talk pinned ${z.talk}, ${z.fx} toast, window or effect, on ${z.route}`);
      await h.shot(page, `text-size-light-${tag}`);
      problems.push(...[errors, settings.errors, reading.errors, other.errors].flat().map((e) => `${tag}: ${e}`));
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
