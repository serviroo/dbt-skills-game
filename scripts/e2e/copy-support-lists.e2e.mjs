// Copy your lists: the player's own support lists as plain text, exactly as typed, from Comfort and the Safe Zone. Only
// a tap on Copy writes to the clipboard, a failed copy never says it worked, nothing is saved or sent, another open copy's
// changes show up without losing a draft, and the therapist line shows once a session.

const SIZES = [
  ['390x844', { width: 390, height: 844 }],
  ['320x568', { width: 320, height: 568 }],
  ['844x390', { width: 844, height: 390 }],
  ['1280x800', { width: 1280, height: 800 }],
];
const T = Date.now() - 86400e3;
const LISTS = {
  reasons: [{ id: 'r1', text: 'A <b>bold</b> {name} idea', at: T }, { id: 'r2', text: 'Sunrise 🌅 at the lake', at: T }],
  comfort: [{ id: 'c1', text: 'Tea, then "quiet" {{x}}', at: T }, { id: 'c2', text: 'Line one\nline two', at: T }],
  activities: [{ id: 'a1', text: '{companion} & me: café crème', at: T }],
  people: [{ id: 'p1', name: 'Ama', phone: '+44 20 7946 0958', at: T }, { id: 'p2', name: 'Sam', phone: '', at: T }],
};
const EXPECTED = [
  'Things that are yours',
  '- A <b>bold</b> {name} idea',
  '- Sunrise 🌅 at the lake',
  '',
  'Comfort kit',
  '- Tea, then "quiet" {{x}}',
  '- Line one',
  'line two',
  '',
  'Go-to activities',
  '- {companion} & me: café crème',
  '',
  'People',
  '- Ama: +44 20 7946 0958',
  '- Sam',
].join('\n');
const THERAPIST = 'For your therapist, if you want.';
const ABOUT_THERAPIST = 'A DBT therapist can go further with them';
const FAILED = "Copying didn't work here. Select the text above to copy it.";

const save = (extra = {}) => JSON.stringify({ v: 1, created: T, events: [], lists: LISTS, ...extra });

/** A browser at `viewport` on Home with `seed` saved. `clip` says what the clipboard does: 'ok', 'fallback' (the API
 * refuses, the local copy path works) or 'none' (both refuse). Records shares and writes nothing anywhere else. */
async function home(h, { viewport = { width: 390, height: 844 }, saved = save(), clip = 'ok' } = {}) {
  const seed = { [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': h.SEEN, ...(saved ? { [h.SAVE]: saved } : {}) };
  const { ctx, page, errors } = await h.open(seed, '?mute', viewport, async (c) => {
    if (clip === 'ok') await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: h.server.url });
    await c.addInitScript((mode) => {
      window.__shared = [];
      window.__copied = [];
      navigator.share = async (d) => void window.__shared.push(d);
      if (mode === 'ok') return;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } });
      document.addEventListener('copy', (e) => {
        const t = e.target;
        window.__copied.push(t && 'value' in t ? t.value.slice(t.selectionStart, t.selectionEnd) : String(getSelection()));
      }, true);
      if (mode === 'none') {
        const exec = document.execCommand.bind(document);
        document.execCommand = (cmd, ...rest) => (cmd === 'copy' ? false : exec(cmd, ...rest));
      }
    }, clip);
  });
  const outside = [];
  page.on('request', (r) => !r.url().startsWith(h.server.url) && !r.url().startsWith('data:') && outside.push(r.url()));
  await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
  return { ctx, page, errors, outside };
}

const go = (page, route) => page.evaluate((r) => window.__daily.go(r), route);
const stored = (h, page) => h.ls(page, h.SAVE);
const preview = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.dq-lists-copy');
    const pre = box?.querySelector('pre');
    return { open: !!box?.checkVisibility(), text: pre?.checkVisibility() ? pre.textContent : null, html: pre?.innerHTML ?? null, hint: box?.querySelector('.dq-small')?.textContent ?? '', copy: !!box?.querySelector('.dq-btn')?.checkVisibility(), status: box?.querySelector('.dq-hint')?.textContent ?? '' };
  });
const openPreview = async (page) => {
  await page.getByRole('button', { name: 'Copy your lists' }).click();
  await page.waitForFunction(() => document.querySelector('.dq-lists-copy')?.checkVisibility());
};
const copy = async (page) => {
  await page.locator('.dq-lists-copy').getByRole('button', { name: 'Copy', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.dq-lists-copy .dq-hint')?.textContent);
  return (await preview(page)).status;
};

export const scenarios = {
  /** Comfort: the preview and the clipboard hold exactly the four lists as typed; copying saves, sends and shares nothing */
  async 'copy-lists-exact'(h) {
    const { ctx, page, errors, outside } = await home(h);
    await go(page, { name: 'comfort' });
    await openPreview(page);
    const shown = await preview(page);
    h.expect(shown.text === EXPECTED, `the preview is not the lists as typed:\n${shown.text}`);
    h.expect(shown.html.includes('&lt;b&gt;bold&lt;/b&gt;') && !shown.html.includes('<b>'), 'the preview rendered markup from a list');
    h.expect(shown.hint.startsWith(THERAPIST), `no therapist line on the first mention this session: ${shown.hint}`);
    const before = await stored(h, page);
    h.expect((await copy(page)) === 'Copied.', 'Copy did not say Copied.');
    h.expect((await page.evaluate(() => navigator.clipboard.readText())) === EXPECTED, 'the clipboard is not the lists as typed');
    h.expect((await stored(h, page)) === before, 'copying changed the save');
    h.expect(!(await page.evaluate(() => window.__shared.length)) && !outside.length, `copying shared or sent something: ${outside.join(', ')}`);
    h.expect(!(await page.locator('.dq-toast.is-on').count()), 'copying showed a toast');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** A refused clipboard: the local copy path writes the same text, and when that is refused too it never says Copied */
  async 'copy-lists-denied'(h) {
    for (const clip of ['fallback', 'none']) {
      const { ctx, page, errors } = await home(h, { clip });
      await go(page, { name: 'comfort' });
      await openPreview(page);
      const said = await copy(page);
      const copied = await page.evaluate(() => window.__copied);
      if (clip === 'fallback') h.expect(said === 'Copied.' && copied.length === 1 && copied[0] === EXPECTED, `${clip}: said ${said}, wrote ${JSON.stringify(copied)}`);
      else h.expect(said === FAILED && !copied.length, `${clip}: said ${said} with nothing written`);
      h.expect((await preview(page)).text === EXPECTED, `${clip}: the preview to select from is gone`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** Empty lists, an old save with none, and the rest of the save (diary, maps, names) never get into the text */
  async 'copy-lists-empty-and-private'(h) {
    const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const cases = [
      ['no lists', JSON.stringify({ v: 1, created: T, events: [] })],
      ['old save', JSON.stringify({ v: 1, created: T, events: [{ id: 'old-visit', t: T, day: today, k: 'visit', xp: 10 }] })],
      ['empty lists', JSON.stringify({ v: 1, created: T, events: [], lists: { comfort: [], activities: [], reasons: [], people: [] } })],
    ];
    for (const [tag, saved] of cases) {
      const { ctx, page, errors } = await home(h, { saved });
      await go(page, { name: 'comfort' });
      await openPreview(page);
      const p = await preview(page);
      h.expect(p.text === null && !p.copy && (await page.getByText('Nothing in your lists yet.').isVisible()), `${tag}: ${JSON.stringify(p)}`);
      await go(page, { name: 'safe', at: 'reasons' });
      await openPreview(page);
      const sz = await preview(page);
      h.expect(sz.text === null && !sz.copy, `${tag}: the Safe Zone preview shows text for empty lists: ${JSON.stringify(sz)}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    const secret = save({ diary: { [today]: { emotions: { Sad: 3 }, urges: {}, skills: [], note: 'DIARY-NOTE-XYZ' } }, maps: [{ id: 'm1', urge: 'MAP-URGE-XYZ', p1: 'MAP-P1', c1: '', p2: '', c2: '', at: T }] });
    const { ctx, page } = await home(h, { saved: secret });
    await go(page, { name: 'comfort' });
    await openPreview(page);
    const text = (await preview(page)).text;
    h.expect(text === EXPECTED, `with a diary and maps saved, the text changed:\n${text}`);
    await ctx.close();
  },

  /** Safe Zone: the button on its reasons, comfort and people steps, help and Leave stay usable with the preview open,
   * Close returns to the same step, and a draft typed before survives closing and reopening */
  async 'copy-lists-safe-zone'(h) {
    for (const [tag, viewport] of SIZES) {
      const { ctx, page, errors, outside } = await home(h, { viewport });
      for (const [at, title] of [['reasons', 'Things that are yours'], ['comfort', 'Your comfort kit'], ['people', 'Your people']]) {
        await go(page, { name: 'safe', at });
        await page.locator('.dq-sz-t', { hasText: title }).waitFor();
        if (at === 'reasons') {
          await page.getByRole('button', { name: 'Add one' }).click();
          await page.locator('.dq-addrow input').fill('half typed');
        }
        await openPreview(page);
        h.expect((await preview(page)).text === EXPECTED, `${tag} ${at}: the preview is not the lists as typed`);
        const reach = await page.evaluate(() => {
          const ok = (e) => {
            if (!e?.checkVisibility()) return false;
            e.scrollIntoView({ block: 'nearest' });
            const r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return r.top >= 0 && r.bottom <= innerHeight && !!hit && e.contains(hit);
          };
          return { talk: ok(document.querySelector('.dq-sz-talk')), leave: ok(document.querySelector('.dq-top .dq-back')) };
        });
        h.expect(reach.talk && reach.leave, `${tag} ${at}: with the preview open, Talk or Leave can't be tapped: ${JSON.stringify(reach)}`);
        await page.locator('.dq-lists-copy pre').scrollIntoViewIfNeeded();
        if (at === 'reasons') await h.shot(page, `copy-lists-sz-${tag}`);
        await page.locator('.dq-lists-copy').getByRole('button', { name: 'Close' }).click();
        const after = await page.evaluate(() => ({ open: !!document.querySelector('.dq-lists-copy')?.checkVisibility(), focus: document.activeElement?.textContent?.trim(), title: document.querySelector('.dq-sz-t')?.textContent, draft: document.querySelector('.dq-addrow input')?.value ?? null }));
        h.expect(!after.open && after.focus === 'Copy your lists' && after.title.includes(title.slice(0, 10)), `${tag} ${at}: Close did not return to the same step: ${JSON.stringify(after)}`);
        if (at === 'reasons') {
          await openPreview(page);
          await page.locator('.dq-lists-copy').getByRole('button', { name: 'Close' }).click();
          h.expect((await page.locator('.dq-addrow input').inputValue()) === 'half typed', `${tag}: the typed draft was lost`);
        }
      }
      h.expect(!(await page.locator('.dq-toast.is-on').count()) && !outside.length, `${tag}: a toast or a request: ${outside.join(', ')}`);
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
    const { ctx, page } = await home(h);
    await go(page, { name: 'comfort' });
    await openPreview(page);
    await h.shot(page, 'copy-lists-comfort-390x844');
    await ctx.close();
  },

  /** At 320 px wide the preview opens below the fold: opening it brings as much of it as fits into view, at once with
   * reduced motion, in the Safe Zone and on Comfort */
  async 'copy-lists-opens-in-view'(h) {
    for (const reduced of [true, false]) {
      const { ctx, page, errors } = await home(h, { viewport: { width: 320, height: 568 } });
      // the app reads the motion preference as it starts
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.reload();
      await page.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
      for (const [tag, route] of [['Safe Zone', { name: 'safe', at: 'reasons' }], ['Comfort', { name: 'comfort' }]]) {
        const label = `${tag}${reduced ? ', reduced motion' : ''}`;
        await go(page, route);
        await page.getByRole('button', { name: 'Copy your lists' }).waitFor();
        await openPreview(page);
        const seen = () =>
          page.evaluate(() => {
            const r = document.querySelector('.dq-lists-copy').getBoundingClientRect();
            const s = (document.querySelector('.dq-lists-copy').closest('.dq-sz-body') ?? document.querySelector('.dq')).getBoundingClientRect();
            const top = Math.max(s.top, document.querySelector('.dq-top').getBoundingClientRect().bottom);
            const bottom = Math.min(s.bottom, innerHeight);
            return { seen: Math.round(Math.min(r.bottom, bottom) - Math.max(r.top, top)), fits: Math.round(Math.min(r.height, bottom - top)) };
          });
        // the scroll stops clear of the top bar (scroll-padding), so up to 16 px of what fits may stay out of view
        const inView = (v) => v.seen >= v.fits - 16;
        let v;
        if (reduced) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          v = await seen();
        } else {
          // a smooth scroll: check every frame until it has brought the preview in, for up to 5 s
          v = await seen();
          for (const end = Date.now() + 5000; !inView(v) && Date.now() < end; ) {
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
            v = await seen();
          }
        }
        h.expect(inView(v), `${label}: the opened preview shows ${v.seen} of the ${v.fits} px that fit`);
        if (reduced) await h.shot(page, `copy-lists-in-view-${tag.replace(/ /g, '-').toLowerCase()}-320x568`);
        await page.locator('.dq-lists-copy').getByRole('button', { name: 'Close' }).click();
      }
      h.expect(!errors.length, errors.join('\n'));
      await ctx.close();
    }
  },

  /** Another open copy adds and removes: the open preview follows without touching a draft or focus, and the removal sticks */
  async 'copy-lists-two-tabs'(h) {
    const { ctx, page, errors } = await home(h);
    await go(page, { name: 'comfort' });
    await openPreview(page);
    const draft = page.getByRole('textbox', { name: 'Add to Comfort kit' });
    await draft.fill('still typing');
    await draft.focus();
    const other = await ctx.newPage();
    await other.goto(h.server.url + '/?mute');
    await other.waitForFunction(() => !!window.__daily && !!document.querySelector('.dq-tile'), null, { timeout: 30000 });
    await other.evaluate(() => window.__daily.go({ name: 'comfort' }));
    await other.getByRole('textbox', { name: 'Add to Comfort kit' }).fill('From the other tab');
    await other.locator('.dq-listp--comfort').getByRole('button', { name: 'Add' }).click();
    await other.getByRole('button', { name: 'Remove Tea, then "quiet" {{x}}' }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector('.dq-lists-copy pre')?.textContent ?? '';
      return text.includes('From the other tab') && !text.includes('Tea, then');
    }, null, { timeout: 10000 });
    const now = await preview(page);
    h.expect(!now.text.includes('Tea, then') && now.text.includes('- From the other tab'), `the preview did not follow the other copy:\n${now.text}`);
    const kept = await page.evaluate(() => ({ value: document.activeElement?.value, label: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id }));
    h.expect(kept.value === 'still typing', `the draft or its focus was lost: ${JSON.stringify(kept)}`);
    h.expect((await copy(page)) === 'Copied.', 'Copy did not say Copied.');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    h.expect(clip === now.text && !clip.includes('Tea, then'), `the clipboard is not the current lists:\n${clip}`);
    const lists = await page.evaluate(() => window.__daily.store.state.lists.comfort.map((i) => i.text));
    h.expect(!lists.includes('Tea, then "quiet" {{x}}'), `the removed item came back: ${JSON.stringify(lists)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** The therapist line once a session: whichever of the copy preview, the diary card and Settings comes first says it */
  async 'copy-lists-therapist-once'(h) {
    const { ctx, page, errors } = await home(h);
    await go(page, { name: 'comfort' });
    await openPreview(page);
    h.expect((await preview(page)).hint.startsWith(THERAPIST), 'first mention: the preview has no therapist line');
    await go(page, { name: 'diary' });
    await page.locator('.dq-export').waitFor();
    h.expect(!(await page.locator('.dq-export').innerText()).includes('therapist'), 'second mention: the diary card names a therapist too');
    await go(page, { name: 'settings' });
    await page.getByText('Crisis lines in the Safe Zone were checked', { exact: false }).waitFor();
    h.expect(!(await page.getByText(ABOUT_THERAPIST, { exact: false }).count()), 'second mention: Settings names a therapist too');
    h.expect(!(await page.evaluate(() => window.__daily.store.state.flags.therapistLineShown)), 'Settings marked its line seen without showing it');

    await page.reload();
    await page.waitForFunction(() => !!window.__daily);
    await go(page, { name: 'diary' });
    await page.locator('.dq-export').waitFor();
    h.expect((await page.locator('.dq-export').innerText()).includes(THERAPIST), 'a new session: the diary card lost its therapist line');
    await go(page, { name: 'comfort' });
    await openPreview(page);
    const hint = (await preview(page)).hint;
    h.expect(!hint.includes('therapist') && hint.includes('Nothing is uploaded'), `a new session, second mention: ${hint}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
