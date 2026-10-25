// Today's skill card stays the card the player revealed, even after an update grows the rotation. Saves from before
// card events recorded their slot were dealt from a 30-card rotation, so each case picks a visit day whose card in
// that rotation differs from today's place in the current one.
import fs from 'node:fs';
import path from 'node:path';

const OLD_ROTATION = 30;
const dayOf = (ms) => {
  const d = new Date(ms - 6 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** A returning player on visit `vi` (that many earlier visit days). `card` is today's card event, already revealed. */
function seed(h, vi, card) {
  const now = Date.now(), today = dayOf(now);
  const events = [];
  for (let i = vi; i >= 1; i--) {
    const day = addDays(today, -i), t = now - i * 86400e3;
    events.push({ id: `pin-v${i}`, k: 'visit', xp: 10, t, day });
    // earlier days' cards must not pin today's
    if (i % 7 === 0) events.push({ id: `pin-c${i}`, k: 'card', xp: 0, t: t + 1000, day, data: { slot: i % OLD_ROTATION } });
  }
  events.push({ id: 'pin-v0', k: 'visit', xp: 10, t: now - 60e3, day: today });
  if (card) events.push({ id: 'pin-card', k: 'card', xp: 0, t: now - 30e3, day: today, ...card });
  const flags = { greetDay: today, giftDay: today, cardDay: card ? today : '', therapistLineShown: true };
  return { [h.SAVE]: JSON.stringify({ v: 1, events, flags }), 'dbt.app.v1': h.SEEN };
}

/** The rotation and card names from the content module the app itself loads, read once per run. */
async function content(h) {
  if (h.shared.cardPin) return h.shared.cardPin;
  const { ctx, page } = await h.open(seed(h, 0));
  try {
    await page.waitForFunction(() => !!window.__daily);
    return (h.shared.cardPin = await page.evaluate(async () => {
      const m = await import('/src/content/dbt.ts');
      return { rotation: m.ROTATION, names: Object.fromEntries(Object.entries(m.SKILL).map(([id, s]) => [id, s.sl])) };
    }));
  } finally {
    await ctx.close();
  }
}

const same = (a, b) => a.skill === b.skill && a.entry === b.entry && a.special === b.special;
const event = (q, slot) => (q.special ? { data: { slot, special: q.special } } : { skill: q.skill, data: { slot } });
const describe = (q) => `${q.special ?? q.skill}${q.entry ? ':' + q.entry : ''}`;

/** The old rotation's card for visit `vi`, checked to differ from what the current rotation deals that day. */
function oldCard(h, c, vi) {
  const slot = vi % OLD_ROTATION, q = c.rotation[slot];
  h.expect(!same(q, c.rotation[vi % c.rotation.length]), `visit ${vi} deals the same card in both rotations, so the case proves nothing`);
  return { slot, q };
}

async function face(h, page) {
  await h.reachHub(page);
  await page.locator('.dq-quest .dq-card').waitFor({ timeout: 10000 });
  return page.evaluate(() => {
    const card = document.querySelector('.dq-quest .dq-card');
    const front = card.querySelector('.dq-cardface--front');
    const acts = document.querySelector('.dq-quest-acts');
    return {
      open: card.classList.contains('is-open'),
      name: front.querySelector('.dq-cf-name')?.textContent.trim(),
      real: front.querySelector('.dq-cf-real')?.textContent.trim(),
      special: front.classList.contains('is-special'),
      primary: acts.querySelector('.dq-quest-go')?.textContent.trim(),
      shown: !!acts.querySelector('.dq-quest-go')?.checkVisibility(),
      collection: [...window.__daily.store.derived().collection],
    };
  });
}

/** Today's card shows `q` face-up, ready to open. A skill card is in the collection; a special card adds nothing. */
function expectFace(h, f, q, c, where) {
  const name = q.special === 'comfort' ? 'Comfort' : q.special === 'free' ? 'Free choice' : c.names[q.skill];
  h.expect(f.open && f.shown, `${where}: today's card is not face-up with its buttons`);
  h.expect(f.name === name && f.special === !!q.special, `${where}: expected ${describe(q)} ("${name}"), the card shows "${f.name}"`);
  if (q.label && !q.special) h.expect(f.real.includes(q.label), `${where}: expected "${q.label}" on the card, it says "${f.real}"`);
  h.expect(f.primary === (q.special ? 'Open' : 'Begin'), `${where}: the card's button says "${f.primary}"`);
  h.expect(q.special ? !f.collection.length : f.collection.includes(q.skill), `${where}: the collection is [${f.collection}] with ${describe(q)} face-up`);
}

/** Visit `vi` with today's card event from `build`: the old rotation's card shows face-up, also after a reload. */
async function pinned(h, vi, build, tag) {
  const c = await content(h);
  const { slot, q } = oldCard(h, c, vi);
  const { ctx, page, errors } = await h.open(seed(h, vi, build(q, slot, c)));
  try {
    expectFace(h, await face(h, page), q, c, tag);
    await page.reload();
    expectFace(h, await face(h, page), q, c, tag + ' after reload');
    await h.shot(page, tag);
    h.expect(!errors.length, `${tag}: ${errors.join(' | ')}`);
  } finally {
    await ctx.close();
  }
}

async function crystal(h, page, name) {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Crystal', exact: true }).click();
  const target = path.join(h.out, name + '.json');
  await (await pending).saveAs(target);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

async function restore(page, raw) {
  await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
  await page.locator('input[type=file]').setInputFiles({ name: 'crystal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
  await page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
  await page.waitForFunction(() => /Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
}

export const scenarios = {
  async 'card-pin-slot'(h) {
    await pinned(h, 40, (q, slot) => event(q, slot), 'pin-slot');
    // a slot that now holds another skill, or is past the end, still finds the recorded skill
    await pinned(h, 40, (q, slot, c) => ({ ...event(q, slot), data: { slot: c.rotation.findIndex((x) => x.skill !== q.skill && !x.special) } }), 'pin-slot-moved');
    await pinned(h, 40, (q, slot) => ({ ...event(q, slot), data: { slot: 999 } }), 'pin-slot-gone');
  },

  async 'card-pin-old-save'(h) {
    // card events from before slots: a skill card, a skill dealt three times (TIPP), and both special cards (no skill)
    for (const vi of [40, 31, 58, 59]) await pinned(h, vi, (q) => (q.special ? {} : { skill: q.skill }), `pin-old-${vi}`);
  },

  async 'card-pin-special'(h) {
    for (const vi of [58, 59]) {
      await pinned(h, vi, (q, slot) => {
        h.expect(q.special, `visit ${vi} should deal a special card in the old rotation`);
        return event(q, slot);
      }, `pin-special-${vi}`);
    }
  },

  async 'card-pin-rotation'(h) {
    const vi = 40;
    const c = await content(h);
    const slot = vi % c.rotation.length, q = c.rotation[slot];
    const { ctx, page, errors } = await h.open(seed(h, vi));
    try {
      const before = await face(h, page);
      h.expect(!before.open && !before.shown, 'with no card event today the card should start face-down');
      // the face-down card floats, so it never holds still for an actionability check
      await page.locator('.dq-quest .dq-card').click({ force: true });
      await page.locator('.dq-quest-go').waitFor({ timeout: 5000 });
      const ev = JSON.parse(await h.ls(page, h.SAVE)).events.filter((e) => e.k === 'card' && e.day === dayOf(Date.now()));
      h.expect(ev.length === 1, `revealing stored ${ev.length} card events today`);
      h.expect(ev[0].data?.slot === slot && ev[0].skill === (q.special ? undefined : q.skill) && ev[0].data?.special === q.special, `the card event does not record slot ${slot} (${describe(q)}): ${JSON.stringify(ev[0])}`);
      await page.reload();
      expectFace(h, await face(h, page), q, c, 'rotation after reload');
      await h.shot(page, 'pin-rotation');
      h.expect(!errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  },

  async 'card-pin-crystal'(h) {
    const vi = 40;
    const c = await content(h);
    const { slot, q } = oldCard(h, c, vi);
    const a = await h.open(seed(h, vi, event(q, slot)));
    let raw;
    try {
      expectFace(h, await face(h, a.page), q, c, 'crystal source');
      raw = await crystal(h, a.page, 'pin-crystal');
    } finally {
      await a.ctx.close();
    }
    const kept = raw.events.find((e) => e.id === 'pin-card');
    h.expect(kept?.data?.slot === slot && kept.skill === q.skill, `the Save Crystal lost today's card slot: ${JSON.stringify(kept)}`);

    const b = await h.open(seed(h, 0));
    try {
      h.expect(!(await face(h, b.page)).open, 'the fresh device already shows a revealed card');
      await restore(b.page, raw);
      await b.page.reload();
      expectFace(h, await face(h, b.page), q, c, 'restored on a fresh device');
      await h.shot(b.page, 'pin-crystal-restored');
      h.expect(!b.errors.length, b.errors.join(' | '));
    } finally {
      await b.ctx.close();
    }
  },
};
