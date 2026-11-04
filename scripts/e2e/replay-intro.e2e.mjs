const day = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const seed = (h) => ({
  [h.SAVE]: JSON.stringify({
    v: 1,
    events: [{ id: 'replay-visit', k: 'visit', xp: 10, t: 1, day: day() }],
    flags: { greetDay: day(), therapistLineShown: true },
  }),
  [h.YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: 1, companionAt: 1 }),
  'dbt.app.v1': h.SEEN,
});

const screenOf = () => {
  if (!window.__daily || !document.querySelector('#dq-main > *')) return null;
  return document.querySelector('.dq')?.dataset.screen;
};
const shown = () => {
  if (document.querySelector('.title-screen')) return 'intro';
  if (!window.__daily || !document.querySelector('#dq-main > *')) return null;
  return document.querySelector('.dq')?.dataset.screen;
};

const logHistory = () => {
  const note = (what) => {
    const log = sessionStorage.getItem('replay-history') ?? '';
    sessionStorage.setItem('replay-history', `${log}${what} `);
  };
  const { go, pushState } = History.prototype;
  window.__pushes = 0;
  history.pushState = (...a) => {
    window.__pushes++;
    note(navigator.userActivation.isActive ? 'push' : 'push-untapped');
    return pushState.apply(history, a);
  };
  history.go = (by) => {
    note('go');
    return go.call(history, by);
  };
};

async function settings(h, viewport) {
  const { ctx, page, errors } = await h.open(seed(h), '?mute&reduced', viewport, (c) => c.addInitScript(logHistory));
  await h.openSettings(page);
  return { ctx, page, errors, before: new URL(page.url()).search };
}

async function replay(h, page, tag, { started, double } = {}) {
  await page.evaluate(() => sessionStorage.removeItem('replay-history'));
  const button = page.getByRole('button', { name: 'Replay cutscene' });
  await (double ? button.dblclick() : button.click());
  await (started ?? page.getByRole('button', { name: 'Skip intro' }).waitFor({ timeout: 30000 }));
  const log = await page.evaluate(() => sessionStorage.getItem('replay-history')?.trim());
  h.expect(log === 'push', `${tag}: Replay cutscene changed history as "${log}", not one push inside the tap`);
}

async function backOnSettings(h, page, before, tag) {
  const at = await h.until(page, screenOf, null, { timeout: 30000 });
  h.expect(at === 'settings', `${tag}: the replay ended on ${at}, not back on Settings where it was played from`);
  const search = new URL(page.url()).search;
  h.expect(search === before, `${tag}: the address is ${search} after the replay, not ${before} as before it`);
  const focus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  h.expect(focus === 'Replay cutscene', `${tag}: focus is on "${focus}" after the replay, not on Replay cutscene`);
  await h.shot(page, `${tag}-settings`);
}

async function move(h, page, step, to, moves) {
  await page.evaluate(() => {
    window.__moves = 0;
  });
  await (step === 'back' ? page.goBack({ waitUntil: 'commit' }) : page.goForward({ waitUntil: 'commit' }));
  await h.until(page, (n) => !window.__samePage || window.__moves >= n, moves);
  const settled = (n) => document.querySelector('.title-screen') || document.querySelector('.dq')?.dataset.screen === n;
  await h.until(page, settled, to).catch(() => undefined);
  return page.evaluate(shown).catch(() => 'a new page');
}

async function neverAgain(h, page, before, tag) {
  await page.evaluate(() => {
    window.__samePage = true;
    window.addEventListener('popstate', () => window.__moves++);
  });
  for (const [step, to, moves] of [['back', 'hub', 1], ['forward', 'settings', 1], ['forward', 'settings', 2]]) {
    const at = await move(h, page, step, to, moves);
    h.expect(at === to, `${tag}: ${step} after the replay showed ${at}, not ${to}`);
    const same = await page.evaluate(() => window.__samePage === true);
    h.expect(same, `${tag}: ${step} after the replay loaded the page again`);
  }
  await page.reload();
  const at = await h.until(page, shown, null, { timeout: 30000 });
  h.expect(at !== 'intro', `${tag}: a reload after the replay played the intro again`);
  const search = new URL(page.url()).search;
  h.expect(search === before, `${tag}: the address is ${search} after a reload, not ${before}`);
  await h.shot(page, `${tag}-reloaded`);
}

async function toEndCard(page) {
  await page.locator('.title-screen').click();
  await page.locator('.lb').first().waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => window.__stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  for (const button of ['.rw .sw-btn', '.letter .sw-btn']) await page.locator(button).first().click({ timeout: 30000 });
  await page.locator('.endcard').waitFor({ timeout: 30000 });
}

async function backWhileLoading(h, file) {
  const { ctx, page, errors, before } = await settings(h);
  const tag = `back while ${file} loads`;
  let release;
  const held = new Promise((r) => (release = r));
  try {
    let reached;
    const asked = new Promise((r) => (reached = r));
    await ctx.route(`**/${file}*`, (r) => {
      reached();
      return held.then(() => r.fallback());
    });
    await replay(h, page, tag, { started: asked });
    await page.goBack({ waitUntil: 'commit' });
    release();
    await backOnSettings(h, page, before, tag);
    const intro = await page.evaluate(() => !!document.querySelector('.title-screen'));
    h.expect(!intro, `${tag}: Back before the replay had loaded still played the intro`);
    h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
  } catch (e) {
    await h.evidence(page, 'replay-back-while-loading-fail');
    throw e;
  } finally {
    release();
    await ctx.close();
  }
}

export const scenarios = {
  async 'replay-skip-reload'(h) {
    const { ctx, page, errors, before } = await settings(h);
    try {
      await replay(h, page, 'skip', { double: true });
      await h.shot(page, 'skip-replaying');
      await page.getByRole('button', { name: 'Skip intro' }).click();
      await backOnSettings(h, page, before, 'skip');
      await neverAgain(h, page, before, 'skip');
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-skip-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },

  async 'replay-end-card-reload'(h) {
    const { ctx, page, errors, before } = await settings(h);
    try {
      await replay(h, page, 'end-card');
      await toEndCard(page);
      await page.locator('.ec-actions [data-v="replay"]').click();
      await page.locator('.title-screen').waitFor({ timeout: 30000 });
      await toEndCard(page);
      await h.shot(page, 'end-card');
      await page.locator('.ec-actions .sw-btn.gold').click();
      await backOnSettings(h, page, before, 'end-card');
      await neverAgain(h, page, before, 'end-card');
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-end-card-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },

  async 'replay-back'(h) {
    const { ctx, page, errors, before } = await settings(h, { width: 320, height: 568 });
    try {
      await replay(h, page, 'back');
      await page.goBack({ waitUntil: 'commit' });
      await backOnSettings(h, page, before, 'back');
      const pushes = await page.evaluate(() => window.__pushes);
      h.expect(pushes === 0, `back: the page playing the replay, never touched, added ${pushes} history entries`);
      await neverAgain(h, page, before, 'back');
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-back-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },

  async 'replay-help'(h) {
    const { ctx, page, errors, before } = await settings(h);
    try {
      await replay(h, page, 'help');
      await page.locator('.ui-safe').click();
      const at = await h.until(page, screenOf, null, { timeout: 30000 });
      h.expect(at === 'safe', `help: the Safe Zone button in the replay opened ${at}`);
      const pushes = await page.evaluate(() => window.__pushes);
      h.expect(pushes === 0, `help: the page playing the replay added ${pushes} history entries for the Safe Zone`);
      const search = new URL(page.url()).search;
      h.expect(search === before, `help: the address is ${search} in the Safe Zone, not ${before}`);
      await h.shot(page, 'help-safe');
      await page.goBack({ waitUntil: 'commit' });
      await h.until(page, () => document.querySelector('.dq')?.dataset.screen !== 'safe');
      const back = await page.evaluate(screenOf);
      h.expect(back === 'settings', `help: Back from the Safe Zone showed ${back}, not Settings`);
      h.expect(!errors.length, 'page errors: ' + errors.join(' | '));
    } catch (e) {
      await h.evidence(page, 'replay-help-fail');
      throw e;
    } finally {
      await ctx.close();
    }
  },

  async 'replay-back-while-loading'(h) {
    for (const file of ['src/main.ts', 'src/audio/engine.ts']) await backWhileLoading(h, file);
  },
};
