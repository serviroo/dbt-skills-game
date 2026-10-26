// Moving through the companion like any app, with real taps and real keys on a returning save at 390x844:
//   back-forward        the browser's Back and Forward (Android's back gesture is the same history step) follow the
//                       companion: Skills, a skill's steps with what was typed kept, back to Skills, forward again,
//                       never a second credit for the skill, the heading of each screen focused, and Back from Home
//                       still leaves the game; a reload opens Home with nothing credited
//   back-closes-first   Back closes what is open on top of a screen before it leaves the screen: a Lantern window
//                       on Home, the Story Room's chapter list, its More menu and the co-writer, the Art room's name
//                       sheet; Escape closes each of them too and puts focus back where it was. The story editor and
//                       the drawing page keep what was written or drawn across Back and Forward
//   safe-zone-back      Back leaves the Safe Zone in one step and lands where the player was, typed text kept;
//                       Leave still goes straight Home with nothing asked, and nothing in there credits anything
//   lantern-back        the companion's own Lantern button never opens a finished skill again or credits it twice
//   radio-keys          every radio group is one Tab stop; arrows, Home and End move through it and pick (a group
//                       whose pick also acts, like Today's line or how strong a feeling is, moves first and picks on
//                       Space or Enter); locked looks are skipped, and a tap still picks and clears as before
//   holds-let-go        a hold ends when focus leaves it (Tab, Shift+Tab), the window loses focus or the page is
//                       hidden: it never completes later on its own; a deliberate hold still completes
//   safe-zone-guidance  the Safe Zone with keys and a screen reader: every control has a name that says what it does,
//                       each screen starts at the top with "Talk to someone now" one Tab away (on Talk itself, the
//                       first line's button), and each step is said politely as it shows. Then at 200% browser zoom
//                       on 390x844 and 320x568 (the page laid out at half the size with twice the pixels, which is
//                       what browser zoom does): nothing scrolls sideways or cuts text off, every control can be
//                       scrolled to and tapped clear of the pinned bars, and "Talk to someone now" stays on screen
//   focus-shows         at 390x844, 320x568, 844x390 and 1280x800, focus moved by keys always shows: a radio group
//                       moved with the arrows, and "Talk to someone now" one Tab from the top of the Safe Zone
//   back-keeps-steps    Back keeps a tier list's ranks, gives a finished skill's header its name back on earlier steps,
//                       and Save again after Back keeps one saved map
//   clear-elsewhere     another tab clears the game's data while this one sits on Home: this tab shows Settings, and
//                       Back, Forward and the Safe Zone still move inside the game, with or without a page before it
import { boot, settle } from './layout-fit.e2e.mjs';

const PHONE = { width: 390, height: 844 };
// a plain page on the game's own address, so the harness's seed script runs there as on any page
const BEFORE = (url) => new URL('/robots.txt', url).href;
const left = (u) => String(u).endsWith('/robots.txt');

const screenOf = (page) => page.evaluate(() => document.querySelector('.dq')?.dataset.screen ?? null);
const onScreen = (page, name) => page.waitForFunction((n) => document.querySelector('.dq')?.dataset.screen === n && !!document.querySelector('#dq-main > *'), name, { timeout: 10000 });
const home = (page) => page.waitForFunction(() => window.__daily?.route.name === 'hub' && !!document.querySelector('.dq-tile') && !document.querySelector('.dq-sw'), null, { timeout: 30000 });
const events = (page, SAVE, k) => page.evaluate(({ key, k }) => JSON.parse(localStorage.getItem(key) ?? '{"events":[]}').events.filter((e) => !k || e.k === k).length, { key: SAVE, k });
const xpOf = (page, SAVE) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{"events":[]}').events.reduce((n, e) => n + (e.xp ?? 0), 0), SAVE);
/** What has focus, as a short description, or "body" when nothing does. */
const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'body';
    return `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).trim().split(/\s+/).join('.') : ''} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}"`;
  });
const stepText = (page) => page.evaluate(() => document.querySelector('.dq-step-body')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '');
const field = (page) => page.locator('.dq-step-body textarea, .dq-step-body input.dq-input').first();

/** The returning save, opened after another page so Back from Home has somewhere to go. */
async function start(h, o = {}) {
  const { ctx, page, errors } = await boot(h, o.viewport ?? PHONE, o);
  const url = page.url();
  await page.goto(BEFORE(url));
  await page.goto(url);
  await home(page);
  return { ctx, page, errors, url };
}

async function openSkill(page, sl) {
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await onScreen(page, 'library');
  await page.locator('.dq-librow').filter({ has: page.locator('.dq-librow-n', { hasText: new RegExp(`^${sl}$`) }) }).click();
  await onScreen(page, 'skill');
}

async function back(page) {
  await page.goBack({ waitUntil: 'commit' });
  await settle(page);
}
async function forward(page) {
  await page.goForward({ waitUntil: 'commit' });
  await settle(page);
}

async function typeInto(page, loc, text) {
  await loc.click();
  await page.keyboard.type(text);
}

/** Walks every Safe Zone screen from its start, calling `at(screen)` on each once it has settled. */
async function walkSafe(page, at) {
  const main = page.locator('.dq-sz-main');
  const tap = (name) => main.getByRole('button', { name, exact: typeof name === 'string' }).click();
  const step = async (name) => {
    await settle(page);
    await at(name);
  };
  await step('start');
  await tap('Calm my body first');
  for (const [name, next] of [['breathe', 'Next'], ['squeeze', 'Next'], ['cold', 'Next'], ['check', 'About the same']]) {
    await step(name);
    await tap(next);
  }
  await step('stop');
  while (await main.getByRole('button', { name: 'Next line', exact: true }).count()) await tap('Next line');
  await tap('Next');
  for (const name of ['reasons', 'comfort', 'people', 'talk']) {
    await step(name);
    await tap('Next');
  }
  await step('close');
}

/** Problems with what a screen reader says for each control the player can see on the Safe Zone and its top bar. */
async function spoken(page, cdp) {
  const items = await page.evaluate(() => {
    const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=radio], [role=checkbox], [role=switch]';
    const els = [...document.querySelectorAll(`.dq-top :is(${SEL}), .dq-safezone :is(${SEL})`)].filter((e) => e.checkVisibility({ visibilityProperty: true }));
    window.__szProbe = els;
    return els.map((e) => ({ what: `${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').trim().split(/\s+/)[0]}`, href: e.getAttribute('href') }));
  });
  const found = [];
  const seen = new Map();
  for (const [i, it] of items.entries()) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__szProbe[${i}]`, objectGroup: 'sz' });
    const {
      nodes: [n],
    } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    if (n.ignored) continue;
    const name = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(name)) {
      found.push(`${it.what} has no name a screen reader can say`);
      continue;
    }
    // two controls that do different things never sound the same
    const key = `${n.role?.value} "${name}"`;
    if (seen.has(key) && (it.href === null || seen.get(key) !== it.href)) found.push(`two controls both say ${key}`);
    seen.set(key, it.href);
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'sz' });
  await page.evaluate(() => delete window.__szProbe);
  return found;
}

/**
 * What doesn't fit on the Safe Zone screen as it stands: sideways scrolling, anything past the sides, text cut off, a
 * control that sits under the pinned bars when scrolled to, or "Talk to someone now" off screen at either end.
 */
function fits(page, at) {
  return page.evaluate(async (at) => {
    const out = [];
    const W = innerWidth;
    const H = innerHeight;
    const root = document.querySelector('.dq');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tag = (e) => `${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').trim().split(/\s+/).join('.')} "${(e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`;
    const shown = (e) => e.checkVisibility({ visibilityProperty: true }) && !e.closest('.dq-sr');
    const covered = (e) => {
      // a link that wraps is tested on its first line
      const r = e.getClientRects()[0] ?? e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !hit || !(e === hit || e.contains(hit));
    };
    const wide = Math.max(document.scrollingElement.scrollWidth, root.scrollWidth);
    if (wide > W + 1) out.push(`the page scrolls sideways (${wide} px wide in ${W})`);
    for (const e of [...document.querySelectorAll('.dq-top *, .dq-safezone *')].filter(shown)) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < -1 || r.right > W + 1) out.push(`${tag(e)} runs past the side (${Math.round(r.left)} to ${Math.round(r.right)} of ${W})`);
      const cs = getComputedStyle(e);
      const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const scrolls = /auto|scroll/.test(cs.overflowY);
      if (text && (/hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) out.push(`${tag(e)} cuts its text off at the side`);
      if (text && /hidden|clip/.test(cs.overflowY) && !scrolls && e.scrollHeight > e.clientHeight + 1) out.push(`${tag(e)} cuts its text off below`);
    }
    for (const e of [...document.querySelectorAll('.dq-safezone :is(button, a[href], input, select, textarea, [role=radio])')].filter(shown)) {
      if (e.closest('.dq-sz-foot')) continue;
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      await frame();
      if (covered(e)) out.push(`${tag(e)} sits under something when scrolled to`);
    }
    const talk = document.querySelector('.dq-sz-talk:not(.is-hidden)');
    if (at !== 'talk') {
      if (!talk) out.push('"Talk to someone now" is missing');
      else
        for (const end of ['top', 'bottom']) {
          root.scrollTo({ top: end === 'top' ? 0 : root.scrollHeight, behavior: 'instant' });
          await frame();
          const r = talk.getBoundingClientRect();
          if (r.top < -0.5 || r.bottom > H + 0.5 || covered(talk)) out.push(`"Talk to someone now" is off screen with the page scrolled to the ${end}`);
        }
    }
    root.scrollTo({ top: 0, behavior: 'instant' });
    return out;
  }, at);
}

export const scenarios = {
  'back-forward': async (h) => {
    const { page, errors, url } = await start(h);
    const { expect } = h;
    const credits = await events(page, h.SAVE, 'skill');
    await openSkill(page, 'Clear Sight');
    expect((await events(page, h.SAVE, 'skill')) === credits + 1, 'opening Clear Sight did not credit it once');
    await page.getByRole('button', { name: 'Begin' }).click();
    await typeInto(page, field(page), 'I judged the rain');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Found it' }).click();
    await typeInto(page, field(page), 'It rained and I felt flat');
    await settle(page);
    await h.shot(page, 'back-forward-1-typed');

    // Back walks the skill's own steps, keeping what was typed
    await back(page);
    expect((await screenOf(page)) === 'skill', `Back on a skill step left the skill for ${await screenOf(page)}`);
    expect(/judgment word/.test(await stepText(page)), `Back from the fact step did not show the step before it: "${await stepText(page)}"`);
    expect(/^h3|^div\.dq-intro|^h2|^p\.dq-text/.test(await focused(page)), `after Back the step heading was not focused: ${await focused(page)}`);
    await back(page);
    expect((await field(page).inputValue()) === 'I judged the rain', `Back did not keep the typed judgment: "${await field(page).inputValue().catch(() => 'no field')}"`);
    await back(page);
    expect(await page.getByRole('button', { name: 'Begin' }).isVisible(), 'Back from the first question did not show the skill intro');
    await back(page);
    expect((await screenOf(page)) === 'library', `Back from the skill intro went to ${await screenOf(page)}, not Skills`);
    expect(page.url() === url, 'Back left the game from inside it');
    await h.shot(page, 'back-forward-2-library');

    // Forward returns to the same visit: same answers, no second credit
    await forward(page);
    expect((await screenOf(page)) === 'skill', `Forward from Skills went to ${await screenOf(page)}`);
    await forward(page);
    expect((await field(page).inputValue()) === 'I judged the rain', 'Forward lost the typed judgment');
    await forward(page);
    await forward(page);
    expect((await field(page).inputValue()) === 'It rained and I felt flat', `Forward lost the typed fact: "${await field(page).inputValue().catch(() => 'no field')}"`);
    expect((await events(page, h.SAVE, 'skill')) === credits + 1, `Back and Forward credited the skill again: ${(await events(page, h.SAVE, 'skill')) - credits} credits`);

    // Back all the way Home, then Back leaves the game; Forward comes back to Home
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');
    await h.shot(page, 'back-forward-3-home');
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForURL(left, { timeout: 10000 }).catch(() => {});
    expect(left(page.url()), `Back from Home did not leave the game: ${page.url()}`);
    await page.goForward({ waitUntil: 'commit' });
    await home(page);
    expect((await events(page, h.SAVE, 'skill')) === credits + 1, 'coming back to the game credited the skill again');

    // a reload on Skills opens Home with nothing credited, and Back from there still leaves the game
    await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
    await onScreen(page, 'library');
    await page.reload();
    await home(page);
    await settle(page);
    expect((await events(page, h.SAVE, 'skill')) === credits + 1, 'the reload credited the skill again');
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForURL(left, { timeout: 10000 }).catch(() => {});
    expect(left(page.url()), `after a reload, Back from Home did not leave the game: ${page.url()}`);
    expect(!errors.length, errors.join('\n'));
  },

  'back-closes-first': async (h) => {
    const { page, errors, url } = await start(h, { edit: (s) => (s.flags.giftDay = '') });
    const { expect } = h;

    // a Lantern window on Home: Back closes it and stays Home, Escape closes it and focus goes back to the chest
    await page.locator('.dq-chest').click();
    await page.locator('.dq-sw').first().waitFor({ timeout: 10000 });
    await settle(page);
    await h.shot(page, 'back-closes-1-gift');
    await back(page);
    expect(!(await page.locator('.dq-sw').count()), 'Back did not close the gift window');
    expect((await screenOf(page)) === 'hub' && page.url() === url, 'Back with the gift window open left Home');
    await page.locator('.dq-chest').click();
    await page.locator('.dq-sw').first().waitFor({ timeout: 10000 });
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    expect(!(await page.locator('.dq-sw').count()), 'Escape did not close the gift window');
    expect((await focused(page)).startsWith('button.dq-chest'), `after Escape focus was on ${await focused(page)}, not the chest`);
    await back(page);
    expect(left(page.url()), 'after the window closed, Back from Home did not leave the game');
    await page.goForward({ waitUntil: 'commit' });
    await home(page);

    // the Story Room: the chapter list, the More menu and the co-writer each close before the editor does
    await page.locator('.dq-tile--story').click();
    await onScreen(page, 'stories');
    await page.locator('.st-row').filter({ hasText: 'The Long Night' }).click();
    await onScreen(page, 'write');
    await page.locator('.st-ta').waitFor();
    await page.locator('.st-ta').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' The lantern kept on.');
    await page.locator('.st-chbtn').click();
    await page.locator('.st-sheet').waitFor({ timeout: 10000 });
    await back(page);
    expect(!(await page.locator('.st-sheet').count()), 'Back did not close the chapter list');
    expect((await screenOf(page)) === 'write', `Back with the chapter list open went to ${await screenOf(page)}`);
    await page.locator('.st-chbtn').click();
    await page.locator('.st-sheet').waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await settle(page);
    expect(!(await page.locator('.st-sheet').count()), 'Escape did not close the chapter list');
    expect((await focused(page)).startsWith('button.st-chbtn'), `after Escape focus was on ${await focused(page)}`);
    await page.locator('.st-more').click();
    await page.locator('.st-menu-i').first().waitFor({ state: 'visible' });
    await back(page);
    expect(!(await page.locator('.st-menu-i').first().isVisible()), 'Back did not close the More menu');
    expect((await screenOf(page)) === 'write', 'Back with the More menu open left the editor');
    await page.locator('.st-cwbtn').click();
    await page.locator('.st-cw-x').waitFor({ state: 'visible' });
    await back(page);
    await page.locator('.st-cw-x').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    expect(!(await page.locator('.st-cw-x').isVisible()), 'Back did not close the co-writer');
    expect((await screenOf(page)) === 'write', 'Back with the co-writer open left the editor');
    await page.locator('.st-cwbtn').click();
    await page.locator('.st-cw-x').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await settle(page);
    await page.locator('.st-cw-x').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    expect(!(await page.locator('.st-cw-x').isVisible()), 'Escape did not close the co-writer');
    // Co-writer pressed again while it is open opens nothing more: one Back closes it, the next leaves the editor
    await page.locator('.st-cwbtn').click();
    await page.locator('.st-cw-x').waitFor({ state: 'visible' });
    await page.locator('.st-cwbtn').focus();
    await page.keyboard.press('Enter');
    await settle(page);
    await back(page);
    await page.locator('.st-cw-x').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    expect(!(await page.locator('.st-cw-x').isVisible()), 'Back after a second Co-writer press did not close the co-writer');
    await back(page);
    expect((await screenOf(page)) === 'stories', `Back from the editor went to ${await screenOf(page)}, not the Story Room`);
    await forward(page);
    await page.locator('.st-ta').waitFor();
    await page.waitForFunction(() => document.querySelector('.st-ta')?.value.includes('The lantern kept on.'), null, { timeout: 10000 }).catch(() => {});
    expect((await page.locator('.st-ta').inputValue()).includes('The lantern kept on.'), 'Back and Forward lost what was written in the story');
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'stories');
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'hub');

    // the Art room: a drawing survives Back and Forward, the ally's name sheet closes on Back and on Escape
    await page.locator('.dq-tile--art').click();
    await onScreen(page, 'art');
    await page.locator('.dq-artentry--ally').click();
    await onScreen(page, 'draw');
    await settle(page);
    const pad = await page.locator('.dq-draw-frame').boundingBox();
    await page.mouse.move(pad.x + pad.width * 0.3, pad.y + pad.height * 0.3);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + pad.width * (0.3 + i * 0.03), pad.y + pad.height * (0.3 + i * 0.02));
    await page.mouse.up();
    expect(await page.locator('.dq-save').isEnabled(), 'the stroke did not land on the drawing page');
    await back(page);
    expect((await screenOf(page)) === 'art', `Back from the drawing page went to ${await screenOf(page)}`);
    await forward(page);
    await page.waitForFunction(() => document.querySelector('.dq-save') && !document.querySelector('.dq-save').disabled, null, { timeout: 10000 }).catch(() => {});
    expect(await page.locator('.dq-save').isEnabled(), 'Back and Forward lost the drawing');
    await page.locator('.dq-save').click();
    await page.locator('.dq-sheet:not(.is-hidden)').waitFor({ timeout: 10000 });
    await settle(page);
    await h.shot(page, 'back-closes-2-name-sheet');
    await back(page);
    expect(!(await page.locator('.dq-sheet:not(.is-hidden)').count()), 'Back did not close the name sheet');
    expect((await screenOf(page)) === 'draw', 'Back with the name sheet open left the drawing page');
    await page.locator('.dq-save').click();
    await page.locator('.dq-sheet:not(.is-hidden)').waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await settle(page);
    expect(!(await page.locator('.dq-sheet:not(.is-hidden)').count()), 'Escape did not close the name sheet');
    expect((await focused(page)).startsWith('button.dq-btn.dq-btn--primary.dq-save'), `after Escape focus was on ${await focused(page)}, not Save`);
    expect(!errors.length, errors.join('\n'));
  },

  'safe-zone-back': async (h) => {
    const { page, errors } = await start(h);
    const { expect } = h;
    await openSkill(page, 'Clear Sight');
    const xp0 = await xpOf(page, h.SAVE);
    await page.getByRole('button', { name: 'Begin' }).click();
    await typeInto(page, field(page), 'Words I typed before I needed help');

    await page.locator('.dq-top .dq-safe').click();
    await onScreen(page, 'safe');
    await page.locator('.dq-sz-talk').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Calm my body first' }).click();
    await settle(page);
    await h.shot(page, 'safe-zone-back-1-inside');
    expect(await page.locator('.dq-sz-talk').isVisible(), '"Talk to someone now" is not pinned inside the Safe Zone');
    await back(page);
    expect((await screenOf(page)) === 'skill', `one Back did not leave the Safe Zone: ${await screenOf(page)}`);
    expect((await field(page).inputValue()) === 'Words I typed before I needed help', 'leaving the Safe Zone with Back lost the typed text');
    expect((await xpOf(page, h.SAVE)) === xp0, 'the Safe Zone round trip changed XP');
    await forward(page);
    expect((await screenOf(page)) === 'safe', `Forward did not go back into the Safe Zone: ${await screenOf(page)}`);
    expect(await page.locator('.dq-sz-talk').isVisible(), '"Talk to someone now" is not there after Forward');

    // Leave: straight Home, nothing asked; Back from Home then leaves the game
    await page.locator('.dq-top .dq-back').filter({ hasText: 'Leave' }).click();
    await onScreen(page, 'hub');
    // anything that asks: a Lantern window or a dialog the player can see (the sound popover waits hidden on every screen)
    const asks = await page.evaluate(() => [...document.querySelectorAll('.dq-sw, [role=dialog], [role=alertdialog]')].filter((e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((e) => e.className || e.getAttribute('role')));
    expect(!asks.length, `leaving the Safe Zone asked something: ${asks.join(', ')}`);
    expect((await xpOf(page, h.SAVE)) === xp0, 'the Safe Zone changed XP');
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForURL(left, { timeout: 10000 }).catch(() => {});
    expect(left(page.url()), 'Back from Home after leaving the Safe Zone stayed in the game');
    await page.goForward({ waitUntil: 'commit' });
    await home(page);

    // from Home: one Back returns Home
    await page.locator('.dq-top .dq-safe').click();
    await onScreen(page, 'safe');
    await back(page);
    expect((await screenOf(page)) === 'hub', `Back from a Safe Zone opened on Home went to ${await screenOf(page)}`);

    // Safe Zone, Give me a moment, then the Safe Zone again: one Back returns to the moment
    await page.locator('.dq-top .dq-safe').click();
    await onScreen(page, 'safe');
    await page.getByRole('button', { name: 'Give me a moment' }).click();
    await onScreen(page, 'moment');
    await page.locator('.dq-top .dq-safe').click();
    await onScreen(page, 'safe');
    await back(page);
    expect((await screenOf(page)) === 'moment', `Back from a Safe Zone opened on Give me a moment went to ${await screenOf(page)}`);
    expect(!errors.length, errors.join('\n'));
  },

  'lantern-back': async (h) => {
    const { page, errors } = await start(h);
    const { expect } = h;
    const credits = await events(page, h.SAVE, 'skill');
    await openSkill(page, 'Shadow Step');
    await page.getByRole('button', { name: 'Begin' }).click();
    for (let i = 0; i < 3; i++) await page.locator('.dq-step-body').getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Wait before replying' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('.dq-feedback').waitFor();
    await page.locator('.dq-feedback').getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Another skill' }).click();
    await onScreen(page, 'library');
    await page.locator('.dq-top .dq-back').click();
    await settle(page);
    const at = await screenOf(page);
    expect(at === 'hub', `the Lantern button from Skills went to ${at}, not Home`);
    expect((await events(page, h.SAVE, 'skill')) === credits + 1, `the Lantern button credited the finished skill again: ${(await events(page, h.SAVE, 'skill')) - credits} credits`);
    expect((await events(page, h.SAVE, 'feedback')) >= 1, 'the feedback answer was not kept');
    expect(!errors.length, errors.join('\n'));
  },

  'radio-keys': async (h) => {
    const { page, errors } = await start(h);
    const { expect } = h;
    const problems = [];
    /**
     * Checks one group from its first radio: one Tab stop, then arrows, Home and End. `manual` groups move focus and
     * pick on Space; the others pick as focus moves. `name` labels the problems.
     */
    async function group(name, sel, o = {}) {
      const g = page.locator(sel).first();
      await g.scrollIntoViewIfNeeded();
      const state = () =>
        g.evaluate((el) => {
          const rs = [...el.querySelectorAll('[role=radio]')];
          return { n: rs.length, focus: rs.indexOf(document.activeElement), checked: rs.findIndex((r) => r.getAttribute('aria-checked') === 'true'), enabled: rs.map((r) => !r.disabled), tabbable: rs.filter((r) => r.tabIndex >= 0).length, inside: el.contains(document.activeElement) };
        });
      let s = await state();
      if (s.tabbable !== 1) problems.push(`${name}: ${s.tabbable} radios are Tab stops, not 1`);
      const stop = s.checked >= 0 ? s.checked : s.enabled.indexOf(true);
      await g.locator('[role=radio]').nth(stop).focus();
      await page.keyboard.press('Tab');
      s = await state();
      if (s.inside) problems.push(`${name}: Tab from the group stayed inside it`);
      await page.keyboard.press('Shift+Tab');
      s = await state();
      if (s.focus !== stop) problems.push(`${name}: Shift+Tab back into the group focused radio ${s.focus}, not ${stop}`);
      const en = s.enabled.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
      const after = (i) => en[(en.indexOf(i) + 1) % en.length];
      const before = (i) => en[(en.indexOf(i) - 1 + en.length) % en.length];
      const pick = async (key, want, label) => {
        await page.keyboard.press(key);
        if (o.rerender) await settle(page);
        let t = await state();
        if (t.focus !== want) return problems.push(`${name}: ${label} focused radio ${t.focus}, not ${want}`);
        if (o.manual) {
          if (t.checked !== s.checked && t.checked !== -1 && t.checked === want) problems.push(`${name}: ${label} picked before Space`);
          const said = await g.evaluate((el, i) => el.querySelectorAll('[role=radio]')[i].textContent.replace(/\s+/g, ' ').trim(), want);
          await page.keyboard.press('Space');
          if (o.rerender) await settle(page);
          // a group that goes away once picked (Today's line pins the line) shows the pick instead
          if (o.gone) {
            const shown = (await o.gone()).replace(/\s+/g, ' ');
            if (!shown.includes(said)) problems.push(`${name}: Space after ${label} did not pick "${said}": "${shown}"`);
            return;
          }
          t = await state();
        }
        if (t.checked !== want) problems.push(`${name}: ${label} left radio ${t.checked} checked, not ${want}`);
        s = t;
      };
      if (o.manual) return pick('ArrowRight', after(stop), 'ArrowRight');
      await pick('ArrowRight', after(stop), 'ArrowRight');
      await pick('ArrowDown', after(after(stop)), 'ArrowDown');
      await pick('ArrowLeft', after(stop), 'ArrowLeft');
      await pick('ArrowUp', stop, 'ArrowUp');
      await pick('End', en.at(-1), 'End');
      await pick('ArrowRight', en[0], 'ArrowRight from the last');
      await pick('Home', en[0], 'Home');
      await pick('ArrowLeft', en.at(-1), 'ArrowLeft from the first');
      if (o.skipped && !s.enabled.includes(false)) problems.push(`${name}: no locked option to skip`);
      return before;
    }

    // Home: Today's line picks on Space, How strong moves without leaving Home
    await group("Today's line", '.dq-lines-opts', { manual: true, rerender: true, gone: () => page.locator('.dq-lines .dq-line--pinned').textContent().catch(() => '') });
    if (!(await page.locator('.dq-lines .dq-line, .dq-lines-opts').count())) problems.push("Today's line: nothing shown after the pick");
    await page.locator('.dq-feels .dq-opt').filter({ hasText: 'Anxious' }).click();
    await page.locator('.dq-level [role=radiogroup]').waitFor();
    await page.locator('.dq-level [role=radio]').first().click();
    await group('How strong', '.dq-level [role=radiogroup]', { manual: true });
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    if ((await screenOf(page)) !== 'hub') problems.push(`How strong: arrows alone moved the player to ${await screenOf(page)}`);
    await page.locator('.w2-title-btn').click();
    await group('Title', '.w2-title-list', { manual: true });
    await h.shot(page, 'radio-keys-1-home');

    // Settings: Motion, the title list, every Wardrobe group
    await page.locator('.dq-tile').filter({ hasText: 'Settings' }).click();
    await onScreen(page, 'settings');
    await group('Motion', '.dq-settings [role=radiogroup][aria-label="Motion"]');
    const motion = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).settings.motion, h.SAVE);
    const shownMotion = await page.locator('.dq-settings [aria-label="Motion"] [aria-checked="true"]').getAttribute('aria-label');
    if (!shownMotion?.toLowerCase().includes({ system: 'auto', reduce: 'reduced', full: 'full' }[motion])) problems.push(`Motion: stored ${motion} but shows ${shownMotion}`);
    for (const slot of ['theme', 'accent', 'cardBack', 'plate']) await group(`Wardrobe ${slot}`, `.w2-wgroup--${slot} [role=radiogroup]`, { rerender: true });
    await h.shot(page, 'radio-keys-2-settings');
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'hub');

    // Diary: a feelings row and the export range; a tap on the picked value still clears it
    await page.locator('.dq-tile').filter({ hasText: 'Diary card' }).click();
    await onScreen(page, 'diary');
    await group('Diary row', '.dq-drows [role=radiogroup]');
    const row = page.locator('.dq-drows [role=radiogroup]').first();
    if (!(await row.locator('[aria-checked="true"]').count())) problems.push('Diary row: the keys left nothing picked to clear');
    else await row.locator('[aria-checked="true"]').click();
    if (await row.locator('[aria-checked="true"]').count()) problems.push('Diary row: a tap on the picked value no longer clears it');
    if ((await row.evaluate((el) => [...el.querySelectorAll('[role=radio]')].filter((r) => r.tabIndex >= 0).length)) !== 1) problems.push('Diary row: after clearing, the row is not one Tab stop');
    await group('Diary range', '.dq-export [role=radiogroup]');
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'hub');

    // the drawing page's ink and size, the Story Room's Page and Notes
    await page.locator('.dq-tile--art').click();
    await onScreen(page, 'art');
    await page.locator('.dq-artentry--today').click();
    await onScreen(page, 'draw');
    await group('Ink', '.dq-inks');
    await group('Size', '.dq-sizes');
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'art');
    await page.locator('.dq-top .dq-back').click();
    await onScreen(page, 'hub');
    await page.locator('.dq-tile--story').click();
    await onScreen(page, 'stories');
    await page.locator('.st-row').filter({ hasText: 'The Long Night' }).click();
    await onScreen(page, 'write');
    await group('Page and Notes', '.st-seg');

    // the locked looks are skipped on a newer save
    const fresh = await start(h, { edit: (s) => ((s.events = s.events.filter((e) => e.k !== 'visit' && e.k !== 'skill').slice(0, 3)), (s.flags.rankSeen = 0)) });
    const p2 = fresh.page;
    await p2.locator('.dq-tile').filter({ hasText: 'Settings' }).click();
    await onScreen(p2, 'settings');
    const locked = await p2.locator('.w2-wgroup--theme [role=radio][disabled]').count();
    if (!locked) problems.push('Wardrobe: the newer save has no locked theme to skip');
    const g = p2.locator('.w2-wgroup--theme [role=radiogroup]');
    await g.locator('[aria-checked="true"]').focus();
    for (let i = 0; i < 6; i++) {
      await p2.keyboard.press('ArrowRight');
      await settle(p2);
      const f = await p2.evaluate(() => ({ disabled: document.activeElement?.disabled ?? null, radio: document.activeElement?.getAttribute('role') }));
      if (f.radio !== 'radio' || f.disabled) problems.push(`Wardrobe: ArrowRight ${i + 1} put focus on ${f.radio === 'radio' ? 'a locked look' : 'something outside the group'}`);
    }
    expect(!problems.length, problems.join('\n'));
    expect(!errors.length && !fresh.errors.length, [...errors, ...fresh.errors].join('\n'));
  },

  'holds-let-go': async (h) => {
    const { page, errors } = await start(h);
    const { expect } = h;
    const problems = [];
    const xp0 = await xpOf(page, h.SAVE);
    await openSkill(page, 'Shadow Step');
    const credited = (await xpOf(page, h.SAVE)) - xp0;
    await page.getByRole('button', { name: 'Begin' }).click();
    const hold = page.locator('.dq-hold');
    await hold.waitFor();
    const done = () => hold.evaluate((b) => b.classList.contains('is-done') || b.getAttribute('aria-pressed') === 'true');
    const nextLit = () => page.locator('.dq-step-body .dq-btn').filter({ hasText: 'Next' }).evaluate((b) => b.classList.contains('dq-btn--primary'));
    // the hold is 5 s: each try holds 1.5 s, lets go some way other than a key-up on the hold, then waits 6 s
    const tries = [
      ['Space, then Tab away', async () => (await page.keyboard.down('Space'), await h.sleep(1500), await page.keyboard.press('Tab'), await page.keyboard.up('Space'))],
      ['Enter, then Shift+Tab away', async () => (await page.keyboard.down('Enter'), await h.sleep(1500), await page.keyboard.press('Shift+Tab'), await page.keyboard.up('Enter'))],
      ['Space, then the window loses focus', async () => (await page.keyboard.down('Space'), await h.sleep(1500), await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur'))))],
      [
        'Space, then the page is hidden',
        async () => (
          await page.keyboard.down('Space'),
          await h.sleep(1500),
          await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
          })
        ),
      ],
    ];
    for (const [name, run] of tries) {
      await hold.focus();
      await run();
      await h.sleep(6000);
      if (await done()) problems.push(`${name}: the hold completed on its own`);
      if (await nextLit()) problems.push(`${name}: Next lit up as if the hold had finished`);
      await page.keyboard.up('Space');
      await page.evaluate(() => {
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await h.shot(page, 'holds-let-go-1-not-done');
    // held on purpose for the whole time, it completes
    await hold.focus();
    await page.keyboard.down('Space');
    await h.sleep(5600);
    await page.keyboard.up('Space');
    await h.sleep(300);
    if (!(await done())) problems.push('a full Space hold did not complete');
    if (!(await nextLit())) problems.push('Next did not light up after a full hold');
    await h.shot(page, 'holds-let-go-2-done');
    if ((await xpOf(page, h.SAVE)) - xp0 !== credited) problems.push(`holding changed XP: ${(await xpOf(page, h.SAVE)) - xp0 - credited}`);

    // a finger or mouse held down for the whole hold still completes; letting go early drains
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');
    await openSkill(page, 'Shadow Step');
    await page.getByRole('button', { name: 'Begin' }).click();
    await hold.waitFor();
    const box = await hold.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await h.sleep(1500);
    await page.mouse.up();
    await h.sleep(6000);
    if (await done()) problems.push('a short press completed the hold');
    await page.mouse.down();
    await h.sleep(5600);
    await page.mouse.up();
    await h.sleep(300);
    if (!(await done())) problems.push('a full press did not complete the hold');
    expect(!problems.length, problems.join('\n'));
    expect(!errors.length, errors.join('\n'));
  },

  'safe-zone-guidance': async (h) => {
    const { expect } = h;
    // a country with lines to call, so Talk shows its call buttons
    const edit = (s) => (s.profile.region = 'us');
    const problems = [];
    const said = (page, text) =>
      page.waitForFunction((t) => document.querySelector('.dq-safezone [role=status][aria-live=polite]')?.textContent === t, text, { timeout: 3000 }).then(
        () => true,
        () => false,
      );

    // keys and a screen reader at 390x844
    {
      const { ctx, page, errors } = await start(h, { edit });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Accessibility.enable');
      await page.locator('.dq-top .dq-safe').click();
      await onScreen(page, 'safe');
      await walkSafe(page, async (at) => {
        if (!(await page.evaluate(() => document.activeElement?.tagName === 'H1' && !!document.activeElement.closest('.dq-safezone')))) problems.push(`${at}: the screen did not start at the top: focus on ${await focused(page)}`);
        const heading = (await page.locator('.dq-sz-t').first().textContent()).trim();
        if (!(await said(page, heading))) problems.push(`${at}: its heading "${heading}" was not said`);
        for (const p of await spoken(page, cdp)) problems.push(`${at}: ${p}`);
        await page.keyboard.press('Tab');
        const first = await page.evaluate(() => {
          const a = document.activeElement;
          if (a?.matches('.dq-sz-talk')) return 'talk';
          if (a && a === document.querySelector('.dq-safezone .dq-res-a')) return 'line';
          return `${a?.tagName.toLowerCase()} "${(a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 40)}"`;
        });
        const want = at === 'talk' ? 'line' : 'talk';
        if (first !== want) problems.push(`${at}: one Tab from the top went to ${first}, not ${want === 'talk' ? '"Talk to someone now"' : "the first line's button"}`);
        if (at === 'people' && !(await page.getByRole('link', { name: 'Call Sam', exact: true }).count())) problems.push('people: the Call button does not say who it calls');
        if (at !== 'stop') return;
        // each STOP line is said as it shows, and the last one leaves focus on Next rather than nowhere
        const more = page.locator('.dq-sz-main').getByRole('button', { name: 'Next line', exact: true });
        await more.focus();
        while (await more.count()) {
          await page.keyboard.press('Enter');
          const line = (await page.locator('.dq-sz-stop:not(.is-hidden)').last().textContent()).trim();
          if (!(await said(page, line))) problems.push(`stop: the line "${line}" was not said`);
        }
        const now = await focused(page);
        if (!now.endsWith('"Next"')) problems.push(`stop: after the last line focus was on ${now}, not Next`);
      });
      await h.shot(page, 'safe-zone-guidance-1-close');
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }

    // 200% browser zoom: the same page laid out at half the width and height, with twice the pixels per CSS pixel
    for (const [w, ht] of [
      [390, 844],
      [320, 568],
    ]) {
      const view = { width: w / 2, height: ht / 2 };
      const { ctx, page, errors } = await start(h, { viewport: view, edit });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...view, deviceScaleFactor: 4, mobile: false });
      const zoomed = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
      expect(zoomed.join() === [view.width, view.height, 4].join(), `200% zoom on ${w}x${ht} did not take: ${zoomed.join(' x ')}`);
      await page.locator('.dq-top .dq-safe').click();
      await onScreen(page, 'safe');
      await walkSafe(page, async (at) => {
        await h.shot(page, `safe-zone-guidance-${w}-${at}`);
        if (at === 'talk') {
          await page.locator('.dq-res-a').first().evaluate((a) => a.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await h.shot(page, `safe-zone-guidance-${w}-talk-lines`);
        }
        for (const p of await fits(page, at)) problems.push(`${w}x${ht} at 200%, ${at}: ${p}`);
      });
      expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    expect(!problems.length, problems.join('\n'));
  },

  'history-from-another-version': async (h) => {
    const { page, errors } = await start(h);
    const { expect } = h;
    // an entry another version wrote for a screen this one doesn't have: Forward onto it lands on Home
    await page.locator('.dq-tile').filter({ hasText: 'Settings' }).click();
    await onScreen(page, 'settings');
    await page.evaluate(() => history.replaceState({ ...history.state, route: { name: 'retired-room' } }, ''));
    await back(page);
    await onScreen(page, 'hub');
    await forward(page);
    expect((await screenOf(page)) === 'hub', `Forward onto a screen this version doesn't have showed ${await screenOf(page)}`);
    expect(!errors.length, errors.join('\n'));
  },

  'focus-shows': async (h) => {
    const { expect } = h;
    const problems = [];
    /** Empty when what has focus shows a ring, else what is wrong. */
    const ring = (page) =>
      page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return 'focus went nowhere';
        const cs = getComputedStyle(a);
        const r = a.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return `${a.className} has focus off screen`;
        return a.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? '' : `${a.tagName.toLowerCase()}.${a.className} shows no focus ring`;
      });
    for (const viewport of [PHONE, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const size = `${viewport.width}x${viewport.height}`;
      const { ctx, page, errors } = await start(h, { viewport });
      await page.locator('.dq-tile').filter({ hasText: 'Settings' }).click();
      await onScreen(page, 'settings');
      const motion = page.locator('.dq-settings [role=radiogroup][aria-label="Motion"]');
      await motion.scrollIntoViewIfNeeded();
      await motion.locator('[aria-checked="true"]').focus();
      await page.keyboard.press('ArrowRight');
      await settle(page);
      const moved = await motion.evaluate((g) => g.contains(document.activeElement) && document.activeElement.getAttribute('aria-checked') === 'true');
      if (!moved) problems.push(`${size}: ArrowRight in Motion did not move and pick`);
      const r1 = await ring(page);
      if (r1) problems.push(`${size}, Motion: ${r1}`);
      await h.shot(page, `focus-shows-${size}-motion`);
      await page.locator('.dq-top .dq-safe').click();
      await onScreen(page, 'safe');
      await settle(page);
      await page.keyboard.press('Tab');
      const talk = await page.evaluate(() => !!document.activeElement?.matches('.dq-sz-talk'));
      if (!talk) problems.push(`${size}: one Tab from the top of the Safe Zone went to ${await focused(page)}`);
      const r2 = await ring(page);
      if (r2) problems.push(`${size}, Safe Zone: ${r2}`);
      await h.shot(page, `focus-shows-${size}-talk`);
      if (errors.length) problems.push(...errors);
      await ctx.close();
    }
    expect(!problems.length, problems.join('\n'));
  },

  'back-keeps-steps': async (h) => {
    const { page, errors } = await start(h);
    const { expect } = h;
    const problems = [];
    const tap = (name) => page.locator('.dq-step-body').getByRole('button', { name, exact: true }).click();

    // Flavour Tier List: the ranks survive Back to "Rank them", and Back from the end names the skill again
    await openSkill(page, 'Flavour Tier List');
    await tap('Begin');
    await page.locator('.dq-step-body button', { hasText: 'Something sweet' }).click();
    await page.locator('.dq-step-body button', { hasText: 'Something sour' }).click();
    await tap('Next');
    await tap('Next');
    await page.getByRole('radio', { name: 'Something sweet: S' }).click();
    await page.getByRole('radio', { name: 'Something sour: B' }).click();
    await tap('Lock it in');
    await settle(page);
    await back(page);
    for (const name of ['Something sweet: S', 'Something sour: B']) if ((await page.getByRole('radio', { name }).getAttribute('aria-checked').catch(() => 'missing')) !== 'true') problems.push(`Back to "Rank them" lost ${name}`);
    await forward(page);
    await tap('Done');
    await page.locator('.dq-feedback').waitFor();
    await page.locator('.dq-feedback').getByRole('button', { name: 'Skip' }).click();
    await back(page);
    const head = await page.evaluate(() => ({ t: document.querySelector('.dq-chip-t')?.textContent, done: document.querySelector('.dq-stepbox')?.classList.contains('is-complete') }));
    if (head.t !== 'Flavour Tier List' || head.done) problems.push(`Back from the end left the header at "${head.t}"${head.done ? ', still marked complete' : ''}`);
    await h.shot(page, 'back-keeps-steps-1-header');
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');

    // Strategy Map: Back to the Save step and Save again keeps the one map
    const maps = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).maps.length, h.SAVE);
    const m0 = await maps();
    await openSkill(page, 'Strategy Map');
    await tap('Begin');
    await typeInto(page, field(page), 'An urge I keep vague');
    for (let i = 0; i < 5; i++) await tap('Next');
    await tap('Ride it out');
    await tap('Next');
    await tap('Save');
    await page.locator('.dq-intro--end').waitFor();
    await back(page);
    await tap('Save');
    await page.locator('.dq-intro--end').waitFor();
    if ((await maps()) !== m0 + 1) problems.push(`Save, Back and Save again stored ${(await maps()) - m0} maps, not 1`);
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');

    // Trade Places, Activities: Back from the timer brings the typed text back, and Add and pick again keeps the one item
    const added = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).lists.activities.filter((i) => i.text === 'Tidy my desk').length, h.SAVE);
    const timer = page.locator('.dq-step-body', { hasText: 'gentle timer' });
    await openSkill(page, 'Trade Places');
    await tap('Begin');
    await tap('Activities');
    await typeInto(page, field(page), 'Tidy my desk');
    await tap('Add and pick');
    await timer.waitFor();
    await back(page);
    if ((await field(page).inputValue()) !== 'Tidy my desk') problems.push('Back to Activities did not bring the typed text back');
    await tap('Add and pick');
    await timer.waitFor();
    if ((await added()) !== 1) problems.push(`Add and pick, Back and Add and pick again stored ${await added()} activities, not 1`);
    await page.locator('.dq-top [aria-label="Leave this skill"]').click();
    await onScreen(page, 'hub');

    // Flavour Tier List with nothing picked: the ranking step is passed over, so one Back returns to the timer
    await openSkill(page, 'Flavour Tier List');
    await tap('Begin');
    await tap('Next');
    await tap('Skip the timer');
    await page.locator('.dq-step-body', { hasText: 'TIER LIST LOCKED' }).waitFor();
    await back(page);
    if (!(await page.locator('.dq-step-body', { hasText: 'Taste each one slowly' }).isVisible())) problems.push('one Back past an empty ranking step did not return to the timer');
    expect(!problems.length, problems.join('\n'));
    expect(!errors.length, errors.join('\n'));
  },

  'clear-elsewhere': async (h) => {
    const { expect } = h;
    const problems = [];
    // this tab sits on Home with a page before the game; a fresh tab has nothing before it
    const { ctx, page, errors, url } = await start(h);
    const lone = await ctx.newPage();
    const loneErrors = [];
    lone.on('pageerror', (e) => loneErrors.push('pageerror: ' + e.message));
    await lone.goto(url);
    await home(lone);
    // the other tab backs up, then clears
    const other = await ctx.newPage();
    await other.goto(url);
    await home(other);
    await other.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
    await other.locator('#set-playerName').waitFor();
    await other.locator('.dq-clear').scrollIntoViewIfNeeded();
    await Promise.all([other.waitForEvent('download', { timeout: 20000 }), other.getByRole('button', { name: 'Back up, then clear' }).click()]);
    await other.locator('.dq-clear.is-asking').waitFor({ timeout: 10000 });
    await other.getByRole('button', { name: /^Clear this game.s data$/ }).click();

    for (const [name, p, before] of [
      ['with a page before', page, true],
      ['in a fresh tab', lone, false],
    ]) {
      await onScreen(p, 'settings').catch(() => {});
      await settle(p);
      if (left(p.url()) || (await screenOf(p)) !== 'settings') {
        problems.push(`${name}: the clear in another tab left ${left(p.url()) ? 'the game' : `this tab on ${await screenOf(p)}`}`);
        continue;
      }
      if (before) {
        await back(p);
        if (left(p.url()) || (await screenOf(p)) !== 'settings') problems.push(`${name}: Back after the clear went to ${left(p.url()) ? 'the page before the game' : await screenOf(p)}`);
        await forward(p);
        if (left(p.url()) || (await screenOf(p)) !== 'settings') problems.push(`${name}: Forward after the clear went to ${left(p.url()) ? 'the page before the game' : await screenOf(p)}`);
      }
      // history still moves: one tap into the Safe Zone, one Back out of it
      await p.locator('.dq-top .dq-safe').click();
      await onScreen(p, 'safe');
      await back(p);
      if (left(p.url()) || (await screenOf(p)) !== 'settings') problems.push(`${name}: Back from the Safe Zone after the clear went to ${left(p.url()) ? 'the page before the game' : await screenOf(p)}`);
    }
    await h.shot(page, 'clear-elsewhere-1-settings');
    expect(!problems.length, problems.join('\n'));
    expect(!errors.length && !loneErrors.length, [...errors, ...loneErrors].join('\n'));
    await ctx.close();
  },
};
