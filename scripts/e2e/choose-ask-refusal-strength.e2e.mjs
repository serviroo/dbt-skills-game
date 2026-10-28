// Steady Voice (How Intensely to Ask or Say No), the Interpersonal skill of picking how firmly to ask for something or
// say no this time. On a returning save it opens from the Skills list, under Interpersonal.
// steady-levels: asking and saying no each show their own ten levels, softest first, and the two lists differ. Every
// level opens its own explanation and a line to try; low, middle and high levels in both directions finish on the
// skill's end screen. Opening credits it once and finishing adds nothing; typed words never leave the page or the tab.
// steady-safety: "I don't feel safe with them" leads with people to talk to, which opens the Safe Zone talk screen.
// steady-leave: "Leave this skill" on the first screen, the level list and a half-typed line goes straight Home with no
// confirm and one credit each time; the Safe Zone opens in one tap from the middle of the skill.
// steady-sizes: every screen at 390x844, 320x568, 844x390 and 1280x800, picked with the keyboard, with long words
// typed: nothing sticks out sideways or clips, the level details stay readable, and the Safe Zone button stays on
// screen.
import { credits, returning, toHub } from './skill-check.e2e.mjs';

const ID = 'asking-intensity';
const NAME = 'Steady Voice';
const REAL = 'How Intensely to Ask or Say No';
const PHONE = { width: 390, height: 844 };
export const SIZES = [PHONE, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }];

// [what the list offers, the name on the next screen, what it means there, the line to try], softest first
const LEVELS = {
  ask: [
    ["Don't ask or hint this time", 'Leave it for now', 'Not asking is a real choice. It can fit when the timing is off or it matters less to you.', 'Not this time. I can come back to it.'],
    ['Drop a small hint, let it go if missed', 'A small hint', "Mention it lightly. If they don't pick it up, you let it go.", "That looks good. I'd love to try it sometime."],
    ['Hint clearly, and accept a no', 'A clear hint', 'Make the hint easy to notice. If they say no, you accept it.', "I've been hoping we could sort that out."],
    ['Ask gently, and accept a no', 'A gentle ask', 'Ask, and leave them lots of room. If they say no, you accept it.', 'Would it be okay if...?'],
    ['Ask clearly and kindly, accept a no', 'A plain ask', 'Ask clearly and kindly. If they say no, you take it with good grace.', "Could you...? It's okay if you can't."],
    ['Ask with confidence, accept a no', 'A confident ask', "Ask like it's a fair request, because it is. If they say no, you accept it.", "I'd like you to... Can you do that?"],
    ['Ask with confidence, ask again after a no', 'Ask again', 'Ask with confidence. If they say no, ask once more, calmly, before you let it go.', 'I hear you. It still matters to me. Could we try?'],
    ['Ask firmly, and hold your ground', 'A firm ask', 'Ask firmly, and keep it on the table when they hesitate.', 'This matters to me. I am asking you to...'],
    ['Ask firmly, and negotiate', 'Negotiate', 'Ask firmly and keep working at it. Offer a trade, or look for a middle way.', 'What if I..., and you...? Can we meet halfway?'],
    ["Ask, and don't settle for no", "Don't settle for no", "Keep coming back to it calmly until it's sorted. This fits things you have a clear right to.", "I need this sorted. I'll keep asking until we find a way."],
  ],
  no: [
    ['Do it before they even ask', 'Offer first', 'You do it before they ask. It fits when giving is easy and you want to.', "I'll take care of that for you."],
    ['Say yes gladly', 'A glad yes', 'You say yes and do it without complaint.', 'Sure, happy to.'],
    ['Say yes, even if not gladly', 'A quiet yes', "You do it, even though you'd rather not, and keep that to yourself.", "Okay, I'll do it."],
    ["Say yes, and show you're unsure", 'An unsure yes', "You do it, and let them see you're unsure.", "I can, though I'm not sure about it."],
    ["Say you'd rather not, then do it", 'A reluctant yes', "You say you'd rather not, then do it with good grace.", "I'd rather not, but I'll do it this time."],
    ['Say no gently, open to changing your mind', 'A soft no', "You say no gently, and you're open to changing your mind.", "I don't think I can. Let me think about it."],
    ['Say no clearly, willing to rethink it', 'A clear no', "You say no with confidence, and you're still willing to think again.", "No, not this time. I'll tell you if that changes."],
    ["Say no firmly, and don't get talked round", 'A firm no', "You say no firmly, and you don't get talked round.", "No. I've thought about it, and my answer is no."],
    ['Hold your no, and negotiate', 'No, with a trade', 'You hold your no, and look for a trade or middle ground if there is one.', "No, I can't do that. I could do something smaller instead."],
    ["Don't do it. Your no stands", 'A final no', "You don't do it. Your no stands, however often it comes up.", "My answer is no, and it won't change."],
  ],
};
const WAY = { ask: 'Asking for something', no: 'Saying no to something' };
const LEAN = {
  ask: ["They're able to give it", 'I have a right to ask for this', 'Asking fits our roles', "It's a fair ask for our relationship", "I've given plenty to them too"],
  no: ["I can't give what they want", "I don't owe them this", "It isn't their place to ask me", "It's too much to ask in our relationship", "I've done more than my share"],
};
const LONG_ASK = 'whether my flatmate could take the bins out on Thursdays while my shifts run late this month';
const LONG_LINE = "I know it's a busy week for you too. Could you take the bins out on Thursdays this month? I'll do Sundays.";

export const plain = (t) => (t ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
export const exact = (t) => new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]")}\\s*$`);
export const has = (text, want) => plain(text).toLowerCase().includes(plain(want).toLowerCase());
const skillEvents = async (h, page) => (JSON.parse((await h.ls(page, h.SAVE)) ?? 'null')?.events ?? []).filter((e) => e.k === 'skill');

/** Opens a skill from the Skills list, the way a player finds it, and checks it sits once under its module. */
export async function openFromList(h, page, sl, real, module = 'Interpersonal') {
  await toHub(h, page);
  await page.locator('.dq-tile').filter({ hasText: 'All of them, any time' }).first().click();
  await page.locator('.dq-library').waitFor({ timeout: 10000 });
  const rows = await page.evaluate(({ sl, real }) => {
    const plain = (t) => t.replace(/[‘’]/g, "'").trim();
    document.querySelectorAll('[data-ask-row]').forEach((r) => r.removeAttribute('data-ask-row'));
    const found = [...document.querySelectorAll('.dq-librow')].filter((r) => plain(r.querySelector('.dq-librow-n').textContent) === sl && plain(r.querySelector('.dq-librow-r').textContent) === real);
    found.forEach((r) => r.setAttribute('data-ask-row', ''));
    return found.map((r) => r.closest('section')?.querySelector('.dq-libsec-h')?.textContent ?? '');
  }, { sl, real });
  h.expect(rows.length === 1, `the Skills list shows ${rows.length} rows for ${sl} (${real}), not one`);
  h.expect(rows[0]?.includes(module), `${sl} is listed under "${rows[0]}", not ${module}`);
  await page.locator('[data-ask-row]').click();
  await page.locator('.dq-skill .dq-step-body > *').first().waitFor({ timeout: 10000 });
}

/** The current screen: where the app is, whether it is the end screen, the step's text and what it offers. */
export const screen = (page) =>
  page.evaluate(() => {
    const body = document.querySelector('.dq-step-body');
    const offers = [...(body?.querySelectorAll('.dq-opt, button') ?? [])].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim());
    return { at: document.querySelector('.dq')?.dataset.screen, end: !!body?.querySelector('.dq-intro--end'), text: body?.innerText ?? '', offers };
  });

/** Taps an answer or button on the step and waits until the step has moved on. */
export async function tap(page, label) {
  await page.evaluate(() => document.querySelector('.dq-step-body')?.firstElementChild?.setAttribute('data-ask-step', ''));
  await page.locator('.dq-step-body').locator('.dq-opt, button').filter({ hasText: exact(label) }).first().click();
  await page.waitForFunction(() => !document.querySelector('[data-ask-step]') || document.querySelector('.dq')?.dataset.screen !== 'skill', null, { timeout: 10000 });
}

/** Picks or unpicks one of several answers; the step stays. */
export async function toggle(page, label) {
  const chip = page.locator('.dq-step-body .dq-opt[aria-pressed]').filter({ hasText: exact(label) }).first();
  const was = await chip.getAttribute('aria-pressed');
  await chip.click();
  await page.waitForFunction(([el, was]) => el.getAttribute('aria-pressed') !== was, [await chip.elementHandle(), was], { timeout: 5000 });
}

/** Tabs through the page to the answer or button and presses Enter, as a keyboard player would. With stay, the step
 * doesn't move on (one of several answers). */
export async function keyTap(h, page, label, where, stay = false) {
  await page.evaluate(() => document.querySelector('.dq-step-body')?.firstElementChild?.setAttribute('data-ask-step', ''));
  const want = plain(label);
  let found = false;
  for (let i = 0; i < 60 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate((want) => {
      const a = document.activeElement;
      const t = (a?.textContent ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
      return !!a?.closest('.dq-step-body') && t === want;
    }, want);
  }
  h.expect(found, `${where}: Tab never reached "${label}"`);
  if (!found) return tap(page, label);
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none' || getComputedStyle(document.activeElement).boxShadow !== 'none');
  h.expect(ring, `${where}: "${label}" has no visible focus ring`);
  await page.keyboard.press('Enter');
  if (stay) return page.evaluate(() => document.querySelector('[data-ask-step]')?.removeAttribute('data-ask-step'));
  await page.waitForFunction(() => !document.querySelector('[data-ask-step]') || document.querySelector('.dq')?.dataset.screen !== 'skill', null, { timeout: 10000 });
}

/** Checks this screen is a step of the skill showing what it should, with the Safe Zone one tap away. */
export async function sees(h, page, where, want = {}) {
  const s = await screen(page);
  h.expect(s.at === 'skill' && !s.end, `${where}: expected a step, found ${s.end ? 'the end screen' : s.at}`);
  for (const t of [].concat(want.text ?? [])) h.expect(has(s.text, t), `${where}: expected "${t}", the screen says "${plain(s.text).slice(0, 220)}"`);
  for (const t of [].concat(want.not ?? [])) h.expect(!has(s.text, t), `${where}: did not expect "${t}" on "${plain(s.text).slice(0, 220)}"`);
  if (want.offers) h.expect(s.offers.map(plain).join('|') === want.offers.map(plain).join('|'), `${where}: offers ${JSON.stringify(s.offers)}, not ${JSON.stringify(want.offers)}`);
  h.expect(await page.locator('.dq-top .dq-safe').isVisible(), `${where}: the Safe Zone button is not on screen`);
  return s;
}

/** Checks the walk ended on the skill's own end screen. */
export async function ended(h, page, where, name) {
  const s = await screen(page);
  h.expect(s.at === 'skill' && s.end, `${where}: did not reach the end screen (at ${s.at}: "${plain(s.text).slice(0, 120)}")`);
  const shown = plain(await page.locator('.dq-step-body .dq-intro--end .dq-intro-name').textContent().catch(() => ''));
  h.expect(shown === name, `${where}: ended on the end screen of "${shown}"`);
}

/** Goes straight Home with "Leave this skill", which must not ask "are you sure". */
export async function leave(h, page, where) {
  await page.locator('.dq-top [aria-label="Leave this skill"]').click();
  const home = await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'hub', null, { timeout: 5000 }).then(() => true, () => false);
  h.expect(home, `${where}: "Leave this skill" did not go straight Home`);
  await h.reachHub(page);
}

/** Opens the Safe Zone's talk screen from a "People to talk to" answer. */
export async function peopleFirst(h, page, where) {
  await page.locator('.dq-step-body .dq-actions button').first().click();
  await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 5000 });
  const talk = await page.locator('.dq-sz-t', { hasText: /^Talk to someone now$/ }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  h.expect(talk, `${where}: "People to talk to" did not open the Safe Zone at its talk screen`);
}

/** Anything in the skill or the top bar sticking out sideways, a clipped label, small step text or a lost Safe Zone button. */
export const fit = (page, where) =>
  page.evaluate((where) => {
    const bad = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`${where}: the page scrolls sideways (${document.documentElement.scrollWidth} px in ${vw} px)`);
    for (const e of document.querySelectorAll('.dq-top *, .dq-skill *')) {
      if (!e.getClientRects().length || e.closest('[aria-hidden="true"], svg, .dq-sr')) continue;
      const r = e.getBoundingClientRect();
      const name = (e.textContent || e.getAttribute('aria-label') || e.className || e.tagName).toString().trim().slice(0, 50);
      if (r.width && (r.left < -1 || r.right > vw + 1)) bad.push(`${where}: "${name}" sticks out sideways (${Math.round(r.left)} to ${Math.round(r.right)} px)`);
      if (e.matches('button, .dq-opt') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) bad.push(`${where}: "${name}" is clipped`);
      if (e.matches('textarea') && e.scrollWidth > e.clientWidth + 1) bad.push(`${where}: the field "${name}" scrolls sideways`);
    }
    for (const t of document.querySelectorAll('.dq-step-body .dq-text, .dq-step-body .dq-opt')) if (parseFloat(getComputedStyle(t).fontSize) < 16) bad.push(`${where}: "${t.textContent.trim().slice(0, 40)}" is smaller than 16 px`);
    const safe = document.querySelector('.dq-top .dq-safe')?.getBoundingClientRect();
    if (!safe || safe.top < 0 || safe.bottom > innerHeight || safe.right > vw) bad.push(`${where}: the Safe Zone button is off screen`);
    return bad;
  }, where);

/** Settles the screen's fade-in, then checks its fit and keeps a screenshot. */
export async function look(h, page, problems, shots, name) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))));
  problems.push(...(await fit(page, name)));
  await h.shot(page, name);
  shots.push(name);
}

/** Everything this origin holds on the device: local and session storage and every IndexedDB store, as text. */
export const everything = (page) =>
  page.evaluate(async () => {
    const out = [JSON.stringify(Object.entries(localStorage)), JSON.stringify(Object.entries(sessionStorage))];
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const store of db.objectStoreNames)
        out.push(JSON.stringify(await new Promise((ok) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); })));
      db.close();
    }
    return out.join('\n');
  });

/** Records any request that leaves this page's own server; out.all keeps every request's URL and body, own server too. */
export function offsite(page) {
  const out = [];
  out.all = [];
  page.on('request', (r) => {
    out.all.push(`${r.url()} ${r.postData() ?? ''}`);
    const u = new URL(r.url());
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return;
    if (u.origin !== new URL(page.url()).origin) out.push(r.url());
  });
  return out;
}

/** Plays from the first screen to the level list. */
async function toLevels(h, page, way, where, what = '') {
  await sees(h, page, `${where}, intro`, { text: 'This only makes a plan. Nothing gets sent.' });
  await tap(page, 'Begin');
  await sees(h, page, `${where}, way`, { text: 'Which is it?', offers: [WAY.ask, WAY.no, "I don't feel safe with them"] });
  await tap(page, WAY[way]);
  await sees(h, page, `${where}, what`, { text: way === 'ask' ? 'What do you want to ask for?' : 'What are you being asked to do?' });
  if (what) {
    await page.locator('.dq-step-body textarea, .dq-step-body input').first().fill(what);
    await tap(page, 'Next');
  } else await tap(page, 'Skip');
  await sees(h, page, `${where}, them`, { text: way === 'ask' ? 'leans towards asking more firmly' : 'leans towards a firmer no', offers: [...LEAN[way], 'Next'] });
}

export const scenarios = {
  async 'steady-levels'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const away = offsite(page);
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await h.reachHub(page);
    const seen = {};
    const finishes = [];
    let taps = 0;
    for (const way of ['ask', 'no']) {
      for (let k = 1; k <= 10; k++) {
        const where = `${way} level ${k}`;
        const before = await skillEvents(h, page);
        await openFromList(h, page, NAME, REAL);
        h.expect((await credits(h, page, ID)) === before.filter((e) => e.skill === ID).length + 1, `${where}: opening it did not credit it once`);
        const finish = k === 1 || k === 5 || k === 10;
        const what = finish && k === 5 ? (way === 'ask' ? 'a lift to the shops <b>soon</b>' : 'covering a Saturday shift') : '';
        await toLevels(h, page, way, where, what);
        if (finish && k === 10) {
          await toggle(page, LEAN[way][0]);
          await toggle(page, LEAN[way][2]);
        }
        await tap(page, 'Next');
        await sees(h, page, `${where}, now`, { text: 'And these? Pick any, or none.' });
        await tap(page, 'Next');
        const list = await sees(h, page, `${where}, levels`, { text: [`How firmly do you want to ${way === 'ask' ? 'ask' : 'say no'}?`, 'Softest first. Each one is a fair choice for the right moment, not a rank.'], offers: LEVELS[way].map(([pick]) => pick) });
        h.expect(has(list.text, k === 10 ? `Leaning firmer: ${LEAN[way][0]}. ${LEAN[way][2]}. These point the way. You make the call.` : 'Nothing you picked leans firmer, so a softer choice may fit.'), `${where}: the level list does not reflect what was picked: "${plain(list.text).slice(0, 200)}"`);
        seen[way] ??= list.offers.map(plain);
        const [pick, name, meaning, line] = LEVELS[way][k - 1];
        await tap(page, pick);
        const plan = await sees(h, page, `${where}, plan`, { text: [`${name}. ${meaning}`, `${way === 'ask' && k === 1 ? 'You might tell yourself' : 'You might say'}: "${line}"`] });
        const firm = k >= (way === 'ask' ? 7 : 8);
        h.expect(has(plan.text, way === 'ask' ? 'never pressure, threats or raised voices' : "doesn't need a long reason") === firm, `${where}: the firmness note is ${firm ? 'missing' : 'shown on a soft level'}`);
        if (what) h.expect(has(plan.text, `About: ${what.charAt(0).toUpperCase()}${what.slice(1)}.`), `${where}: the plan does not show what it's about`);
        h.expect((await page.locator('.dq-step-body b', { hasText: /^soon$/ }).count()) === 0, `${where}: typed markup became a page element`);
        // the other direction's meaning for this level never shows here
        h.expect(!has(plan.text, LEVELS[way === 'ask' ? 'no' : 'ask'][k - 1][2]), `${where}: the plan shows the other direction's meaning`);
        if (!finish) {
          await leave(h, page, where);
          h.expect((await credits(h, page, ID)) === before.filter((e) => e.skill === ID).length + 1, `${where}: leaving after the plan credited it more than once`);
          continue;
        }
        await tap(page, 'Next');
        await sees(h, page, `${where}, rehearse`, { text: 'Try it in your own words.' });
        const own = k === 10 ? `${way}: ${LONG_LINE}` : '';
        if (own) {
          await page.locator('.dq-step-body textarea, .dq-step-body input').first().fill(own);
          await tap(page, 'Next');
        } else await tap(page, k === 1 ? 'Skip' : 'Next');
        const close = await sees(h, page, `${where}, close`, { text: way === 'ask' ? "However firmly you ask, it's a choice for this moment, not a rank." : "Yes or no, and however firmly, it's a choice for this moment, not a rank.", offers: ['Done', 'Plan it with DEAR MAN'] });
        h.expect(has(close.text, `Your words: "${own}"`) === !!own, `${where}: own words ${own ? 'missing from' : 'invented on'} the close screen`);
        if (way === 'ask') h.expect(has(close.text, 'make a yes more likely, never certain'), `${where}: the close screen promises more than words can`);
        await tap(page, 'Done');
        await ended(h, page, where, NAME);
        await toHub(h, page);
        const added = (await skillEvents(h, page)).filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.skill);
        h.expect(added.length === 1 && added[0] === ID, `${where}: credited ${JSON.stringify(added)}, not ${ID} once (finishing must add nothing)`);
        finishes.push(where);
      }
    }
    h.expect(seen.ask?.length === 10 && seen.no?.length === 10, 'the level lists are not ten each');
    h.expect(seen.ask.every((t, i) => t !== seen.no[i]), 'asking and saying no share a level label, so changing direction did not change its meaning');
    // the first-option walk ends on its own end screen within 12 taps
    const before = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL);
    for (;;) {
      const s = await screen(page);
      if (s.end || s.at !== 'skill' || taps > 20) break;
      const multi = await page.locator('.dq-step-body .dq-opt[aria-pressed]').count();
      if (multi) {
        await page.locator('.dq-step-body .dq-opt[aria-pressed]').first().click();
        taps++;
        await tap(page, 'Next');
      } else await tap(page, s.offers[0]);
      taps++;
    }
    await ended(h, page, 'first-option walk', NAME);
    h.expect(taps <= 12, `the first-option walk took ${taps} taps, more than 12`);
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - before === 1, 'the first-option walk did not credit it once');
    const stored = await everything(page);
    h.expect(!stored.includes('lift to the shops') && !stored.includes('bins out on Thursdays'), 'typed words were stored');
    h.expect(!away.length, `requests left the page: ${away.join(', ')}`);
    h.expect(!away.all.some((r) => /lift to the shops|lift%20to%20the%20shops|bins out on Thursdays/.test(r)), 'typed words went out in a request');
    h.expect(!dialogs.length, `a browser dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return { finishes, firstOptionTaps: taps, levels: seen };
  },

  async 'steady-safety'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    await h.reachHub(page);
    const before = await credits(h, page, ID);
    await openFromList(h, page, NAME, REAL);
    await tap(page, 'Begin');
    await tap(page, "I don't feel safe with them");
    await sees(h, page, 'unsafe', { text: "Then your safety comes first. You don't have to ask or say no face to face with someone who might hurt you. Someone to talk to is one tap away.", offers: ['People to talk to', 'Done'] });
    await h.shot(page, 'steady-unsafe-390x844');
    await peopleFirst(h, page, 'unsafe');
    await h.shot(page, 'steady-unsafe-safe-zone-390x844');
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - before === 1, 'the safety path did not credit it once');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'steady-leave'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute', PHONE);
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await h.reachHub(page);
    const cases = {
      'the first screen': async () => {},
      'the level list': async () => {
        await toLevels(h, page, 'no', 'leave');
        await tap(page, 'Next');
        await tap(page, 'Next');
      },
      'a half-typed line': async () => {
        await toLevels(h, page, 'ask', 'leave');
        await tap(page, 'Next');
        await tap(page, 'Next');
        await tap(page, LEVELS.ask[4][0]);
        await tap(page, 'Next');
        await page.locator('.dq-step-body textarea, .dq-step-body input').first().fill('Could you');
      },
    };
    for (const [where, go] of Object.entries(cases)) {
      const had = await credits(h, page, ID);
      await openFromList(h, page, NAME, REAL);
      await go();
      await leave(h, page, where);
      h.expect((await credits(h, page, ID)) - had === 1, `${where}: opening and leaving credited it ${(await credits(h, page, ID)) - had} times, not once`);
    }
    const had = await credits(h, page, ID);
    // the half-typed line is kept, so the skill opens where it was left; Start over begins it again
    await openFromList(h, page, NAME, REAL);
    await tap(page, 'Start over');
    await toLevels(h, page, 'ask', 'Safe Zone');
    await page.locator('.dq-top .dq-safe').click();
    await page.waitForFunction(() => document.querySelector('.dq')?.dataset.screen === 'safe', null, { timeout: 5000 });
    h.expect(await page.getByRole('button', { name: 'Talk to someone now', exact: true }).isVisible(), 'the Safe Zone opened without "Talk to someone now"');
    await toHub(h, page);
    h.expect((await credits(h, page, ID)) - had === 1, `opening it and going to the Safe Zone credited it ${(await credits(h, page, ID)) - had} times, not once`);
    h.expect(!dialogs.length, `a browser dialog opened: ${dialogs.join('; ')}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  async 'steady-sizes'(h) {
    const problems = [];
    const shots = [];
    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', size);
      await h.reachHub(page);
      for (const way of ['ask', 'no']) {
        const at = (s) => `steady-${tag}-${way}-${s}`;
        await openFromList(h, page, NAME, REAL);
        await look(h, page, problems, shots, at('01-intro'));
        await keyTap(h, page, 'Begin', at('intro'));
        await look(h, page, problems, shots, at('02-way'));
        await keyTap(h, page, WAY[way], at('way'));
        await page.locator('.dq-step-body textarea, .dq-step-body input').first().fill(LONG_ASK);
        await look(h, page, problems, shots, at('03-what'));
        await tap(page, 'Next');
        await keyTap(h, page, LEAN[way][3], at('them'), true);
        await look(h, page, problems, shots, at('04-them'));
        await keyTap(h, page, 'Next', at('them'));
        await look(h, page, problems, shots, at('05-now'));
        await tap(page, 'Next');
        await look(h, page, problems, shots, at('06-levels'));
        await keyTap(h, page, LEVELS[way][8][0], at('levels'));
        await look(h, page, problems, shots, at('07-plan'));
        await tap(page, 'Next');
        await page.locator('.dq-step-body textarea, .dq-step-body input').first().fill(`${LONG_LINE}\n${LONG_LINE}`);
        await look(h, page, problems, shots, at('08-rehearse'));
        await tap(page, 'Next');
        await look(h, page, problems, shots, at('09-close'));
        await keyTap(h, page, 'Done', at('close'));
        await ended(h, page, at('end'), NAME);
        await look(h, page, problems, shots, at('10-end'));
      }
      await openFromList(h, page, NAME, REAL);
      await tap(page, 'Begin');
      await tap(page, "I don't feel safe with them");
      await look(h, page, problems, shots, `steady-${tag}-unsafe`);
      await toHub(h, page);
      h.expect(!errors.length, `${tag}: ${errors.join('\n')}`);
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
    return { shots };
  },
};
