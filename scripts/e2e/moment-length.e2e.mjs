// Give me a moment: the player chooses how long it lasts (about 1 minute, about 3 minutes, or until they're ready).
// A timed moment ends softly with one calm line and never counts down; until-ready never ends on its own; leaving
// early never asks; the rest credit stays once a day; the choice is kept on this device; the low hum stops at the end.
// A Save Crystal carries the choice, and a newer build's choices beside the save, even ones this build doesn't offer.
// Time runs on Playwright's clock, so the long waits are fast-forwarded.
import fs from 'node:fs';
import path from 'node:path';
import { settled } from './harness.mjs';
import { crystal, restore } from './newer-save-safety.e2e.mjs';

const KEPT_LENGTH = 'dbt.lantern.v1.moment-length';
const END = /That.s your moment/;
const COUNTDOWN = /\b\d{1,2}:\d{2}\b|\bleft\b|remaining|countdown|time.?s up|\d+\s*(s|sec|secs|seconds)\b/i;

/** Counts the hum's own tones (98, 98.6, 146.8 and 196.4 Hz) starting and stopping, and its audio context closing. */
function listenForHum() {
  window.__hum = { started: 0, stopped: 0, closed: 0 };
  const HUM = [98, 98.6, 146.8, 196.4];
  const isHum = (o) => HUM.some((f) => Math.abs(o.frequency.value - f) < 0.01);
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) {
    if (!isHum(this)) return start.apply(this, a);
    this.context.__hum = true;
    window.__hum.started++;
    return start.apply(this, a);
  };
  const stop = OscillatorNode.prototype.stop;
  OscillatorNode.prototype.stop = function (...a) {
    if (isHum(this)) window.__hum.stopped++;
    return stop.apply(this, a);
  };
  const close = AudioContext.prototype.close;
  AudioContext.prototype.close = function (...a) {
    if (this.__hum) window.__hum.closed++;
    return close.apply(this, a);
  };
}

/** A player who visited before: a first visit's welcome opens over Home a moment after it shows, under the first tap. */
const RETURNING = JSON.stringify({ v: 1, created: 946684800000, events: [{ id: 'previous-visit', k: 'visit', day: '2000-01-01', t: 946684800000, xp: 10 }] });

async function openMoment(h, seed = {}, viewport, query = '?mute') {
  const { ctx, page, errors } = await h.open({ 'dbt.app.v1': h.SEEN, [h.SAVE]: RETURNING, ...seed }, query, viewport, async (c) => {
    await c.clock.install();
    await c.addInitScript(listenForHum);
  });
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await h.reachHub(page);
  await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
  await page.locator('.dq-moment').waitFor({ timeout: 15000 });
  return { ctx, page, errors, dialogs };
}

const group = (page) => page.getByRole('radiogroup', { name: 'How long' });
const radio = (page, name) => group(page).getByRole('radio', { name });
const line = (page) => page.locator('.dq-mo-line').innerText();
const ended = async (page) => END.test(await line(page));
const restToday = async (h, page) => {
  const save = JSON.parse((await h.ls(page, h.SAVE)) ?? '{}');
  const day = await page.evaluate(() => window.__daily?.store.today());
  return (save.events ?? []).filter((e) => e.k === 'rest' && e.day === day).length;
};
const safeOneTap = (page) => page.locator('.dq-top').getByRole('button', { name: /Safe Zone/ }).isVisible();

async function noCountdown(h, page, where) {
  const text = await page.locator('.dq-moment').innerText();
  h.expect(!COUNTDOWN.test(text.replace(/\b[13] minutes?\b/g, '')), `${where}: something counts down: ${JSON.stringify(text)}`);
}

export const scenarios = {
  /** the choice is a labelled radio group, Until I'm ready by default, and it works from the keyboard */
  async 'choice-and-default'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await h.shot(page, '01-moment-default');
    h.expect(await group(page).isVisible(), 'no How long radio group on Give me a moment');
    h.expect((await group(page).getByRole('radio').count()) === 3, 'How long does not offer three lengths');
    h.expect(await radio(page, /Until I.m ready/).isChecked(), 'Until I am ready is not the default');
    h.expect((await h.ls(page, KEPT_LENGTH)) === null, 'a length was stored before the player chose one');
    const sizes = await group(page).locator('label, legend').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    h.expect(sizes.every((s) => s >= 16), 'How long text is under 16 px: ' + sizes);
    // keyboard: focus the checked radio, arrow keys move the choice
    await radio(page, /Until I.m ready/).focus();
    await page.keyboard.press('ArrowLeft');
    h.expect(await radio(page, '3 minutes').isChecked(), 'the arrow key did not move the choice');
    h.expect((await h.ls(page, KEPT_LENGTH)) === '3', 'the keyboard choice was not kept: ' + (await h.ls(page, KEPT_LENGTH)));
    await h.shot(page, '02-moment-keyboard');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** about 1 minute ends at its time with one calm line and the way back; nothing counts down on the way */
  async 'one-minute-ends'(h) {
    const { ctx, page, errors, dialogs } = await openMoment(h);
    // time stands still between steps, so 59 s means 59 s after the choice
    await h.pauseClock(page);
    await radio(page, '1 minute').check();
    h.expect((await h.ls(page, KEPT_LENGTH)) === '1', 'the 1 minute choice was not kept on this device');
    await page.clock.fastForward(5000);
    const foot = await page.locator('.dq-mo-foot').innerText();
    await noCountdown(h, page, '5 s in');
    await page.clock.fastForward(54000);
    await noCountdown(h, page, '59 s in');
    h.expect((await page.locator('.dq-mo-foot').innerText()) === foot, 'the moment changed its controls while it ran (a count?)');
    h.expect(!(await ended(page)), 'the 1 minute moment ended before its time (59 s)');
    await page.clock.fastForward(2000);
    await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 });
    await page.clock.runFor(3000);
    await h.sleep(1600);
    h.expect(await page.getByRole('button', { name: 'Done' }).isVisible(), 'no way back after the moment ended');
    h.expect(!(await group(page).isVisible()), 'the How long choice is still up after the moment ended');
    h.expect(await safeOneTap(page), 'the Safe Zone button is not one tap away after the end');
    await noCountdown(h, page, 'ended');
    await h.shot(page, '03-one-minute-ended');
    // it stays ended: no more lines come
    await page.clock.fastForward(30000);
    h.expect(await ended(page), 'the lines started again after the end');
    await page.clock.resume();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('.dq-tile').first().waitFor({ timeout: 10000 });
    h.expect(!dialogs.length, 'leaving asked: ' + dialogs.join(' | '));
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** about 3 minutes, chosen before a reload, is still chosen after it and ends at 3 minutes, not 1 */
  async 'three-minutes-survives-reload'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await radio(page, '3 minutes').check();
    await page.reload();
    await h.reachHub(page);
    // the kept 3 minutes start as the moment opens, so time stands still from before it opens
    await h.pauseClock(page);
    await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
    await page.locator('.dq-moment').waitFor({ timeout: 15000 });
    h.expect(await radio(page, '3 minutes').isChecked(), 'the 3 minutes choice did not survive a reload');
    await page.clock.fastForward(65000);
    h.expect(!(await ended(page)), 'the 3 minute moment ended at 1 minute');
    await page.clock.fastForward(114000);
    await noCountdown(h, page, '179 s in');
    h.expect(!(await ended(page)), 'the 3 minute moment ended before its time (179 s)');
    await page.clock.fastForward(2000);
    await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 });
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** until I'm ready never ends on its own: twenty minutes later the lines still come and the choice is still there */
  async 'until-ready-never-ends'(h) {
    const { ctx, page, errors } = await openMoment(h);
    const seen = new Set();
    for (let m = 0; m < 20; m++) {
      await page.clock.fastForward(60000);
      h.expect(!(await ended(page)), `until I'm ready ended on its own after ${m + 1} minutes`);
      seen.add(await line(page));
    }
    await noCountdown(h, page, '20 minutes in');
    h.expect(seen.size > 1, 'the lines stopped coming in an open-ended moment');
    h.expect(await group(page).isVisible(), 'the How long choice went away in an open-ended moment');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** leaving early never asks, the rest credit is added once a day whatever the length, Safe Zone stays one tap away */
  async 'leave-early-and-credit'(h) {
    const { ctx, page, errors, dialogs } = await openMoment(h);
    h.expect((await restToday(h, page)) === 1, 'opening the moment did not credit rest once');
    h.expect(await safeOneTap(page), 'the Safe Zone button is not one tap away in the moment');
    await radio(page, '1 minute').check();
    await page.clock.fastForward(10000);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('.dq-tile').first().waitFor({ timeout: 10000 });
    h.expect(!dialogs.length && !(await page.getByText(/are you sure/i).count()), 'leaving early asked first');
    await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
    await page.locator('.dq-moment').waitFor({ timeout: 15000 });
    await radio(page, /Until I.m ready/).check();
    await page.clock.fastForward(70000);
    h.expect((await restToday(h, page)) === 1, 'rest was credited more than once today: ' + (await restToday(h, page)));
    await page.locator('.dq-top').getByRole('button', { name: /Safe Zone/ }).click();
    await page.getByRole('button', { name: /Talk to someone now/ }).first().waitFor({ timeout: 10000 });
    h.expect(!dialogs.length, 'the Safe Zone asked first: ' + dialogs.join(' | '));
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** the low hum stops when a timed moment ends, as it does when leaving */
  async 'hum-stops-at-end'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await radio(page, '1 minute').check();
    await page.getByRole('switch', { name: 'Low hum', exact: true }).check();
    await page.clock.runFor(500);
    const on = await page.evaluate(() => ({ ...window.__hum }));
    h.expect(on.started >= 4 && on.stopped === 0, 'the hum did not start: ' + JSON.stringify(on));
    await page.clock.fastForward(61000);
    await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 });
    await page.clock.runFor(2000);
    const off = await page.evaluate(() => ({ ...window.__hum }));
    h.expect(off.stopped >= on.started && off.closed >= 1, 'the hum kept playing after the moment ended: ' + JSON.stringify(off));
    h.expect(!(await page.getByRole('switch', { name: 'Low hum', exact: true }).isVisible()), 'the hum switch is still up after the end');
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a locked phone or hidden tab draws no frames: the moment and its hum still end on time */
  async 'hum-stops-without-frames'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await radio(page, '1 minute').check();
    await page.getByRole('switch', { name: 'Low hum', exact: true }).check();
    await page.clock.runFor(500);
    const on = await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
      return { ...window.__hum };
    });
    h.expect(on.started >= 4 && on.stopped === 0, 'the hum did not start: ' + JSON.stringify(on));
    await page.clock.runFor(1000);
    await page.clock.fastForward(61000);
    await page.clock.runFor(2000);
    const off = await page.evaluate(() => ({ ...window.__hum, line: document.querySelector('.dq-mo-line')?.textContent }));
    h.expect(off.stopped >= on.started && off.closed >= 1, 'with no frames the hum kept playing past its time: ' + JSON.stringify(off));
    h.expect(END.test(off.line ?? ''), 'with no frames the moment did not end: ' + off.line);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** once a timed moment ends, the fading Low hum and How long can't be tapped, and Done stays where it was */
  async 'ended-controls-out-of-reach'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await h.pauseClock(page);
    await radio(page, '1 minute').check();
    await settled(page, '.dq-mo-foot');
    const doneAt = await page.locator('.dq-mo-done').boundingBox();
    const sw = await page.locator('.dq-mo-hum .dq-switch').boundingBox();
    const three = await page.locator('.dq-mo-len-o').nth(1).boundingBox();
    await page.clock.fastForward(61000);
    await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 });
    // the fade has only begun: tap where the switch and 3 minutes still show, and try the switch from script too
    const reach = await page.evaluate(() => ({ len: document.querySelector('.dq-mo-len').inert, hum: document.querySelector('.dq-mo-hum').inert }));
    await page.mouse.click(sw.x + sw.width / 2, sw.y + sw.height / 2);
    await page.mouse.click(three.x + three.width / 2, three.y + three.height / 2);
    await page.evaluate(() => document.querySelector('.dq-mo-hum input')?.click());
    await page.clock.runFor(1500);
    await h.sleep(1200);
    const hum = await page.evaluate(() => ({ ...window.__hum }));
    h.expect(reach.len && reach.hum, 'the ended controls can still be reached: ' + JSON.stringify(reach));
    h.expect(hum.started === 0, 'a tap after the end started a hum: ' + JSON.stringify(hum));
    h.expect((await h.ls(page, KEPT_LENGTH)) === '1', 'a tap after the end changed the length');
    h.expect(await ended(page), 'a tap after the end restarted the moment');
    const doneEnd = await page.locator('.dq-mo-done').boundingBox();
    h.expect(Math.abs(doneEnd.x - doneAt.x) < 1 && Math.abs(doneEnd.y - doneAt.y) < 1, `Done moved after the end: ${JSON.stringify(doneAt)} to ${JSON.stringify(doneEnd)}`);
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** a real Save Crystal carries the choice: Back up, then clear takes it off this device, and Restore in Settings brings
   * it back on a fresh one, but never over a length that device already chose */
  async 'crystal-carries-length'(h) {
    const settings = async (page) => {
      await page.evaluate(() => window.__daily.go({ name: 'settings' }, { quiet: true }));
      await page.locator('#set-playerName').waitFor({ timeout: 15000 });
      await page.locator('.dq-clear').scrollIntoViewIfNeeded();
    };
    const a = await h.open({ 'dbt.app.v1': h.SEEN, [KEPT_LENGTH]: '3' });
    await h.reachHub(a.page);
    await settings(a.page);
    const [dl] = await Promise.all([a.page.waitForEvent('download', { timeout: 20000 }), a.page.getByRole('button', { name: 'Back up, then clear' }).click()]);
    const file = path.join(h.out, 'crystal-with-length.json');
    await dl.saveAs(file);
    h.expect(JSON.parse(fs.readFileSync(file, 'utf8')).preferences?.momentLength === '3', 'the Save Crystal file does not carry the length');
    await a.page.getByRole('button', { name: /^Clear this game.s data$/ }).click();
    await a.page.locator('.dq-cleared-h', { hasText: 'All clear' }).waitFor({ timeout: 30000 });
    h.expect((await h.ls(a.page, KEPT_LENGTH)) === null, 'clearing the game left the length on the device');
    h.expect(!a.errors.length, a.errors.join('\n'));
    await a.ctx.close();
    const b = await h.open({ 'dbt.app.v1': h.SEEN });
    await h.reachHub(b.page);
    await settings(b.page);
    const restore = async () => {
      await b.page.locator('input[type=file]').setInputFiles(file);
      await b.page.getByRole('button', { name: 'Restore this Save Crystal' }).click();
      await b.page.waitForFunction(() => /^Restored/.test(document.querySelector('.dq-settings .dq-hint[aria-live]')?.textContent ?? ''));
    };
    await restore();
    h.expect((await h.ls(b.page, KEPT_LENGTH)) === '3', 'restoring the Save Crystal did not bring the length back: ' + (await h.ls(b.page, KEPT_LENGTH)));
    await b.page.evaluate(() => window.__daily.go({ name: 'moment' }));
    await b.page.locator('.dq-moment').waitFor({ timeout: 15000 });
    h.expect(await radio(b.page, '3 minutes').isChecked(), 'the restored length is not chosen in the moment');
    await radio(b.page, '1 minute').check();
    await settings(b.page);
    await restore();
    h.expect((await h.ls(b.page, KEPT_LENGTH)) === '1', 'restoring again replaced the length this device chose');
    h.expect(!b.errors.length, b.errors.join('\n'));
    await b.ctx.close();
  },

  /** choosing a length while a line promises no timing takes that line down at once, not at the next line */
  async 'timed-drops-open-line'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await h.pauseClock(page);
    await page.clock.fastForward(37000);
    await page.clock.runFor(100);
    h.expect(/Nothing here is timed/.test(await line(page)), 'the open-ended line did not show 37 s in: ' + (await line(page)));
    await radio(page, '1 minute').check();
    await page.clock.runFor(100);
    h.expect(!/Nothing here is timed|Stay as long/.test(await line(page)), 'a timed moment still says nothing is timed: ' + (await line(page)));
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** with reduced motion a timed moment's end goes to its finished state with only a short soft fade, the ring too */
  async 'reduced-motion-end'(h) {
    const { ctx, page, errors } = await openMoment(h, {}, undefined, '?mute&reduced');
    await h.pauseClock(page);
    await radio(page, '1 minute').check();
    await page.clock.fastForward(61000);
    await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 });
    const long = await page.evaluate(() =>
      [...document.querySelectorAll('.dq-moment, .dq-moment *')].flatMap((e) => e.getAnimations().map((a) => [e.className.baseVal ?? e.className, a.effect.getComputedTiming().duration])).filter(([, ms]) => ms > 200),
    );
    h.expect(!long.length, 'with reduced motion the end still runs long animations: ' + JSON.stringify(long));
    h.expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },

  /** choices a newer build stored beside the save that this one doesn't offer (a length, a Safe Zone light, a reading
   * size): Until I'm ready shows, the stored length stays unless the player chooses one here, and a Save Crystal carries
   * all three to a device that has none */
  async 'newer-choices-kept'(h) {
    const kept = { [KEPT_LENGTH]: '5', 'dbt.lantern.v1.safe-light': 'auto', 'dbt.lantern.v1.read-size': 'huge' };
    const a = await openMoment(h, kept);
    h.expect(await radio(a.page, /Until I.m ready/).isChecked(), 'a length this build does not offer did not show as Until I am ready');
    await a.page.locator('.dq-mo-done').click();
    await h.reachHub(a.page);
    h.expect((await h.ls(a.page, KEPT_LENGTH)) === '5', "the moment overwrote a newer build's length: " + (await h.ls(a.page, KEPT_LENGTH)));
    const raw = await crystal(h, a.page, 'crystal-newer-choices');
    const carried = raw.preferences ?? {};
    h.expect(carried.momentLength === '5' && carried.safeLight === 'auto' && carried.readSize === 'huge', "the Save Crystal dropped a newer build's choices: " + JSON.stringify(carried));
    h.expect(!a.errors.length, a.errors.join('\n'));
    await a.ctx.close();
    const b = await h.open({ 'dbt.app.v1': h.SEEN });
    await h.reachHub(b.page);
    await restore(h, b.page, raw, 'crystal-newer-choices.json');
    const back = await Promise.all(Object.keys(kept).map((k) => h.ls(b.page, k)));
    h.expect(JSON.stringify(back) === JSON.stringify(Object.values(kept)), "restoring did not bring a newer build's choices back: " + JSON.stringify(back));
    h.expect(!b.errors.length, b.errors.join('\n'));
    await b.ctx.close();
  },

  /** phones, a sideways phone and a desktop: How long, the hum and Done fit on the first screen without clipping, before
   * and after the end. Every size is photographed first and judged after, so a run on older code still shows them all. */
  async 'sizes'(h) {
    const problems = [];
    for (const [w, ht] of [[390, 844], [320, 568], [844, 390], [1280, 800]]) {
      const where = `${w}x${ht}`;
      const { ctx, page, errors } = await openMoment(h, {}, { width: w, height: ht });
      await page.clock.fastForward(9000);
      await settled(page, '.dq-mo-foot');
      await h.shot(page, `sizes-${where}-running`);
      const fit = await page.evaluate(() => {
        const box = (s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom, x: r.x, y: r.y };
        };
        const opts = [...document.querySelectorAll('.dq-mo-len-o')].map((e) => ({ h: e.getBoundingClientRect().height, over: e.scrollWidth > e.clientWidth + 1 }));
        return { vw: innerWidth, vh: innerHeight, len: box('.dq-mo-len'), done: box('.dq-mo-done'), opts, page: document.documentElement.scrollWidth };
      });
      if (!fit.len || fit.len.left < 0 || fit.len.right > fit.vw) problems.push(`${where}: How long is missing or runs off the side`);
      if (!fit.done || fit.done.bottom > fit.vh) problems.push(`${where}: Done is below the first screen`);
      if (!fit.opts.length || fit.opts.some((o) => o.over || o.h < 44)) problems.push(`${where}: a length clips or is under 44 px tall`);
      if (fit.page > fit.vw) problems.push(`${where}: the page scrolls sideways`);
      if (await radio(page, '1 minute').count()) {
        await radio(page, '1 minute').check();
        await page.clock.fastForward(61000);
        await page.locator('.dq-mo-line', { hasText: END }).waitFor({ timeout: 5000 });
        await page.clock.runFor(3000);
        await settled(page, '.dq-mo-done');
        await h.shot(page, `sizes-${where}-ended`);
        if (!(await page.getByRole('button', { name: 'Done' }).isVisible())) problems.push(`${where}: Done is not visible after the end`);
        const doneEnd = await page.locator('.dq-mo-done').boundingBox();
        if (!doneEnd || !fit.done || Math.abs(doneEnd.x - fit.done.x) > 1 || Math.abs(doneEnd.y - fit.done.y) > 1) problems.push(`${where}: Done moved after the end`);
      }
      if (errors.length) problems.push(...errors);
      await ctx.close();
    }
    h.expect(!problems.length, problems.join('\n'));
  },
};
