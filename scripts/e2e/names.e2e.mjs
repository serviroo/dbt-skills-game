// The player's names: the first-run prompt, the intro copy, Settings, a Save Crystal round trip and an old save that
// has no names yet.
import fs from 'node:fs';
import path from 'node:path';

async function saveCrystal({ open, openSettings, out, shared, expect, deepFind, YOU, SEEN }) {
  if (shared.crystal) return shared.crystal;
  const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 }), 'dbt.app.v1': SEEN });
  await openSettings(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Save Crystal' }).click()]);
  const file = path.join(out, 'save-crystal.json');
  await dl.saveAs(file);
  expect(deepFind(JSON.parse(fs.readFileSync(file, 'utf8')), 'playerName').includes('Kit'), 'the Save Crystal has no player name');
  expect(!errors.length, errors.join('\n'));
  await ctx.close();
  shared.crystal = file;
  return file;
}

export const scenarios = {
  /** first run: the prompt appears after the title, the chosen names are stored and used in the intro */
  async 'first-run'({ open, sleep, shot, youOf, expect, out, shared }) {
    const { ctx, page, errors } = await open();
    await sleep(2500);
    await page.mouse.click(195, 500);
    const name = page.locator('#np-name');
    await name.waitFor({ timeout: 15000 });
    expect((await name.getAttribute('placeholder')) === 'Player', 'name field placeholder is not Player');
    await shot(page, '01-name-prompt');
    await name.fill('  Robin <b>  ');
    await page.keyboard.press('Enter');
    expect(await page.locator('#np-comp').evaluate((el) => el === document.activeElement), 'Enter did not move to the companion field');
    await page.locator('#np-comp').fill('Pip');
    await shot(page, '02-name-prompt-filled');
    await page.keyboard.press('Enter');
    await page.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    const you = await youOf(page);
    expect(you?.name === 'Robin b' && you?.companion === 'Pip' && you.nameAt > 0 && you.companionAt > 0, 'names not stored cleanly: ' + JSON.stringify(you));
    await page.getByText('Wanderer: Robin b').first().waitFor({ timeout: 60000 }).catch(async (e) => { await shot(page, 'fail-first-run'); fs.writeFileSync(path.join(out, 'fail-first-run.txt'), await page.locator('#ui').innerText().catch(() => '')); throw e; });
    await sleep(2500);
    await shot(page, '03-intro-uses-name');
    shared.you = you;
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** skipping keeps the defaults and is never asked again */
  async 'skip-keeps-default'({ open, sleep, youOf, expect }) {
    const { ctx, page, errors } = await open();
    await sleep(2500);
    await page.mouse.click(195, 500);
    await page.locator('#np-name').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    const you = await youOf(page);
    expect(you && you.name === '' && you.companion === '' && you.nameAt === 0 && you.companionAt === 0, 'skip did not record an empty choice: ' + JSON.stringify(you));
    await page.getByText('Wanderer: Player').first().waitFor({ timeout: 60000 });
    await page.reload();
    await sleep(2500);
    await page.mouse.click(195, 500);
    await sleep(2500);
    expect(!(await page.locator('#np-name').count()), 'the prompt came back after a skip');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the companion adopts the names chosen in the intro, and Settings edits them everywhere */
  async settings({ open, sleep, shot, ls, youOf, deepFind, expect, reachHub, openSettings, shared, SAVE, YOU, SEEN }) {
    const you = shared.you ?? { name: 'Robin b', companion: 'Pip', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 };
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify(you), 'dbt.app.v1': SEEN });
    await page.getByText('Welcome, Robin b').first().waitFor({ timeout: 20000 });
    await sleep(2500);
    await shot(page, '04-welcome-uses-name');
    await reachHub(page);
    expect((await page.locator('.dq-firstshadow').getAttribute('title')) === 'Pip, asleep', 'hub companion is not named Pip');
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Robin b', 'Settings does not show the intro name');
    expect((await page.locator('#set-companion').inputValue()) === 'Pip', 'Settings does not show the companion name');
    await page.locator('#set-playerName').fill('Sam');
    await page.keyboard.press('Enter');
    await page.locator('#set-companion').fill('');
    await page.locator('#set-companion').blur();
    await sleep(300);
    await shot(page, '05-settings-you');
    const save = JSON.parse(await ls(page, SAVE));
    expect(deepFind(save, 'playerName').includes('Sam'), 'store did not save the new name');
    const mirror = await youOf(page);
    expect(mirror.name === 'Sam' && mirror.companion === '', 'mirror not updated: ' + JSON.stringify(mirror));
    await page.reload();
    await reachHub(page);
    expect((await page.locator('.dq-firstshadow').getAttribute('title')) === 'Moth, asleep', 'an empty companion name did not fall back to Moth');
    await page.reload();
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Sam', 'name lost on reload');
    shared.save = save;
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a Save Crystal carries the names to a device that never chose any */
  async 'save-crystal'(h) {
    const { open, shot, youOf, expect, openSettings, SEEN } = h;
    const file = await saveCrystal(h);

    const fresh = await open({ 'dbt.app.v1': SEEN });
    await openSettings(fresh.page);
    expect((await fresh.page.locator('#set-playerName').inputValue()) === '', 'fresh device should start with no name');
    await fresh.page.locator('input[type=file]').setInputFiles(file);
    await fresh.page.waitForFunction(() => document.querySelector('#set-playerName')?.value === 'Kit', null, { timeout: 15000 });
    expect((await fresh.page.locator('#set-companion').inputValue()) === 'Lumen', 'restore lost the companion name');
    const mirror = await youOf(fresh.page);
    expect(mirror?.name === 'Kit' && mirror?.companion === 'Lumen', 'restore did not update the mirror: ' + JSON.stringify(mirror));
    await shot(fresh.page, '06-restored-names');
    expect(!fresh.errors.length, fresh.errors.join('\n'));
    await fresh.ctx.close();
  },

  /** skipping the prompt (both names never chosen) must not beat names restored from an older Save Crystal */
  async 'skip-then-restore'(h) {
    const { open, youOf, expect, openSettings, YOU, SEEN } = h;
    const file = await saveCrystal(h);
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: '', companion: '', nameAt: 0, companionAt: 0 }), 'dbt.app.v1': SEEN });
    await openSettings(page);
    await page.locator('input[type=file]').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('#set-playerName')?.value === 'Kit', null, { timeout: 15000 });
    expect((await page.locator('#set-companion').inputValue()) === 'Lumen', 'restore after skip lost the companion name');
    await page.reload();
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Kit', 'restored name reverted after reload');
    const mirror = await youOf(page);
    expect(mirror?.name === 'Kit' && mirror?.companion === 'Lumen', 'mirror kept the skip: ' + JSON.stringify(mirror));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a stale copy of the names from another tab never reverts a newer name, and every tab settles on the same names */
  async 'two-tabs'({ server, open, sleep, ls, youOf, deepFind, expect, openSettings, SAVE, YOU, SEEN }) {
    const t0 = Date.now() - 60000;
    const { ctx, page: a, errors } = await open({ [YOU]: JSON.stringify({ name: 'Alice', companion: 'Pip', nameAt: t0, companionAt: t0 }), 'dbt.app.v1': SEEN });
    await openSettings(a);
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
    await b.goto(server.url + '/?mute');
    await openSettings(b);
    await a.locator('#set-playerName').fill('Robin');
    await a.keyboard.press('Enter');
    await sleep(300);
    // what another tab that had not yet seen Robin would have written: its old name next to its own newer companion
    await b.evaluate(([k, v]) => localStorage.setItem(k, v), [YOU, JSON.stringify({ name: 'Alice', companion: 'Lumen', nameAt: t0, companionAt: Date.now() })]);
    await sleep(800);
    for (const [p, tab] of [[a, 'A'], [b, 'B']]) {
      await p.reload();
      await openSettings(p);
      expect((await p.locator('#set-playerName').inputValue()) === 'Robin', `tab ${tab} lost the newer name`);
      expect((await p.locator('#set-companion').inputValue()) === 'Lumen', `tab ${tab} lost the newer companion`);
    }
    const mirror = await youOf(a);
    expect(mirror.name === 'Robin' && mirror.companion === 'Lumen', 'mirror did not settle: ' + JSON.stringify(mirror));
    expect(deepFind(JSON.parse(await ls(a, SAVE)), 'playerName').includes('Robin'), 'saved progress lost the newer name');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the daily lab keeps its own save; editing names there never touches the player's real names */
  async 'lab-isolated'({ server, open, sleep, youOf, expect, openSettings, YOU, SEEN }) {
    const t0 = Date.now() - 60000;
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: 'Alice', companion: 'Pip', nameAt: t0, companionAt: t0 }), 'dbt.app.v1': SEEN }, '?lab=daily&screen=settings&mute');
    await page.locator('#set-playerName').waitFor({ timeout: 20000 });
    await page.locator('#set-playerName').fill('Lab Name');
    await page.keyboard.press('Enter');
    await sleep(300);
    expect((await youOf(page))?.name === 'Alice', 'the lab wrote the real name');
    await page.goto(server.url + '/?mute');
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Alice', 'the real app shows the lab name');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** two first-run prompts open at once: a Skip in one never erases the names chosen in the other */
  async 'two-prompts'({ server, open, sleep, youOf, expect }) {
    const { ctx, page: a, errors } = await open();
    const b = await ctx.newPage();
    b.on('pageerror', (e) => errors.push('pageerror B: ' + e.message));
    await b.goto(server.url + '/?mute');
    for (const p of [a, b]) {
      await sleep(2500);
      await p.mouse.click(195, 500);
      await p.locator('#np-name').waitFor({ timeout: 15000 });
    }
    await a.locator('#np-name').fill('Robin');
    await a.locator('#np-comp').fill('Pip');
    await a.getByRole('button', { name: 'Continue' }).click();
    await a.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    await sleep(300);
    await b.getByRole('button', { name: 'Skip' }).click();
    await b.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    for (const p of [a, b]) {
      const you = await youOf(p);
      expect(you?.name === 'Robin' && you?.companion === 'Pip', 'a Skip erased the chosen names: ' + JSON.stringify(you));
    }
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a damaged or hand-edited copy of the names can't lock a name in place or wipe a real one */
  async 'bad-mirror'({ open, sleep, youOf, expect, openSettings, YOU, SEEN }) {
    const { ctx, page, errors } = await open({ [YOU]: JSON.stringify({ name: 'Zulu', companion: 'Pip', nameAt: 1e100, companionAt: 1e100 }), 'dbt.app.v1': SEEN });
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === '', 'a far-future timestamp was trusted');
    await page.locator('#set-playerName').fill('Alice');
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.evaluate(([k]) => localStorage.setItem(k, JSON.stringify({ name: {}, companion: 7, nameAt: Date.now(), companionAt: Date.now() })), [YOU]);
    await page.reload();
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === 'Alice', 'a malformed copy cleared or locked the name');
    expect((await youOf(page))?.name === 'Alice', 'the malformed copy was not repaired');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a phone on its side: the prompt's buttons are on screen and work */
  async 'landscape-prompt'({ open, sleep, shot, youOf, expect }) {
    const { ctx, page, errors } = await open({}, '?mute', { width: 568, height: 320 });
    await sleep(2500);
    await page.mouse.click(284, 160);
    await page.locator('#np-name').waitFor({ timeout: 15000 });
    await sleep(1200);
    await shot(page, '08-landscape-prompt');
    for (const label of ['Skip', 'Continue']) {
      const box = await page.getByRole('button', { name: label }).boundingBox();
      expect(box && box.y >= 0 && box.y + box.height <= 320 && box.x >= 0 && box.x + box.width <= 568, `${label} is off screen: ${JSON.stringify(box)}`);
    }
    await page.locator('#np-name').fill('Robin');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#np-name').waitFor({ state: 'detached', timeout: 10000 });
    expect((await youOf(page))?.name === 'Robin', 'landscape Continue did not store the name');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** names changed in another tab reach Home without a reload, and are shown literally (no $ patterns) */
  async 'live-names'({ browser, server, open, shot, expect, reachHub, openSettings, YOU, SEEN }) {
    const t0 = Date.now() - 60000;
    const { ctx, page: home, errors } = await open({ [YOU]: JSON.stringify({ name: 'Alice', companion: 'Pip', nameAt: t0, companionAt: t0 }), 'dbt.app.v1': SEEN });
    await reachHub(home);
    expect((await home.locator('.dq-firstshadow').getAttribute('title')) === 'Pip, asleep', 'Home did not start with Pip');
    const a = await ctx.newPage();
    a.on('pageerror', (e) => errors.push('pageerror A: ' + e.message));
    await a.goto(server.url + '/?mute');
    await openSettings(a);
    await a.locator('#set-playerName').fill('Jo$$ $` $1');
    await a.keyboard.press('Enter');
    await a.locator('#set-companion').fill('Lumen');
    await a.keyboard.press('Enter');
    await home.waitForFunction(() => document.querySelector('.dq-firstshadow')?.getAttribute('title') === 'Lumen, asleep', null, { timeout: 10000 });
    const plate = await home.locator('[data-you-name]').first().textContent();
    expect(plate === 'Jo$$ $` $1', 'Home name plate is stale or altered: ' + plate);
    await home.bringToFront();
    await shot(home, '09-live-names');
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx2.addInitScript(([k, v]) => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.setItem(k, v); localStorage.setItem('dbt.app.v1', '{"seenCutscene":true}'); } }, [YOU, JSON.stringify({ name: '{companion} $1', companion: 'Luna', nameAt: t0, companionAt: t0 })]);
    const w = await ctx2.newPage();
    await w.goto(server.url + '/?mute');
    await w.getByText('Welcome, {companion} $1').first().waitFor({ timeout: 20000 });
    expect(!(await w.getByText('Welcome, Luna').count()), 'a {companion} token inside a name was expanded');
    await ctx2.close();
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a save from before names existed loads with the defaults, keeps its progress and accepts a new name */
  async 'old-save'({ open, sleep, shot, ls, deepFind, deepDrop, expect, reachHub, openSettings, shared, SAVE, SEEN }) {
    let base = shared.save;
    if (!base) {
      const seedRun = await open({ 'dbt.app.v1': SEEN });
      await reachHub(seedRun.page);
      base = JSON.parse(await ls(seedRun.page, SAVE));
      await seedRun.ctx.close();
    }
    const old = deepDrop(structuredClone(base), ['playerName', 'companion']);
    const { ctx, page, errors } = await open({ [SAVE]: JSON.stringify(old), 'dbt.app.v1': SEEN });
    await reachHub(page);
    expect((await page.locator('.dq-firstshadow').getAttribute('title')) === 'Moth, asleep', 'old save does not show the default companion');
    await openSettings(page);
    expect((await page.locator('#set-playerName').inputValue()) === '', 'old save should have no name');
    expect((await page.locator('#set-playerName').getAttribute('placeholder')) === 'Player', 'default name is not Player');
    await page.locator('#set-playerName').fill('Ash');
    await page.keyboard.press('Enter');
    await sleep(300);
    const save = JSON.parse(await ls(page, SAVE));
    expect(deepFind(save, 'playerName').includes('Ash'), 'old save did not take a new name');
    expect(JSON.stringify(deepDrop(structuredClone(save), ['playerName', 'companion', 'setAt', 'at', 'savedAt', 'updatedAt'])).length >= JSON.stringify(deepDrop(structuredClone(old), ['setAt', 'at', 'savedAt', 'updatedAt'])).length * 0.9, 'old save lost data');
    await shot(page, '07-old-save-named');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
