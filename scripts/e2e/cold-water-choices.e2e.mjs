// Cold water is only ever offered beside cool air (DESIGN.md principle 11), from one source: COOL in
// src/content/dbt.ts. cold-water-one-source: no other string the app ships (in src/, index.html and the manifest) names
// cold water, and every skill step that offers it is a cool choice. cold-water-choices: everywhere cold water is
// offered (Frost Rune from its list, Frost Rune opened straight at it as a daily card, the Safe Zone), at 390x844,
// 320x568, 844x390 and 667x375, "Cool air" and "Cold water" are two buttons of the same kind and height, whole on
// screen on arrival. The caution comes right under them, tied to "Cold water" for screen readers, whole on screen and
// as big as the screen's own words, before anything starts. Either choice (each place starts with each one at some
// size) starts the 30 seconds with nothing to confirm or dismiss and no "+N s", brings the countdown (and in a skill,
// Next) into view, and the other one only moves the mark.
import { returning, shippedStrings } from './skill-check.e2e.mjs';

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

/** Each place cold water is offered, reached the way a player gets there; resolves once its choices are on screen. */
const PLACES = {
  'Frost Rune from its list': async (page) => {
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'tipp' }));
    await page.locator('.dq-step-body .dq-intro').waitFor({ timeout: 10000 });
    await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
    await page.getByRole('button', { name: 'Cool air or cold, 30 s' }).click();
  },
  'Frost Rune as a daily card': async (page) => {
    await page.evaluate(() => window.__daily.go({ name: 'skill', id: 'tipp', entry: 'cold' }));
    await page.locator('.dq-step-body .dq-intro').waitFor({ timeout: 10000 });
    await page.locator('.dq-step-body .dq-actions .dq-btn--primary').first().click();
  },
  'Safe Zone': async (page) => {
    await page.locator('header .dq-safe').click();
    await page.evaluate(() => window.__daily.go({ name: 'safe', at: 'cold' }));
  },
};

/** The two choices, the caution and the countdown as the player sees them right now. */
const look = (page) =>
  page.evaluate(async () => {
    const { COOL } = await import('/src/content/dbt.ts');
    const top = document.querySelector('.dq-top').getBoundingClientRect().bottom;
    const foot = document.querySelector('.dq-sz-foot')?.getBoundingClientRect();
    const whole = (e) => {
      const r = e.getBoundingClientRect();
      const under = foot?.height && r.right > foot.left && r.left < foot.right && r.bottom > foot.top + 0.5;
      return r.width > 0 && r.top >= top - 0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && !under;
    };
    const hit = (e) => {
      const r = e.getBoundingClientRect();
      return [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]].every(([x, y]) => e.contains(document.elementFromPoint(x, y)));
    };
    const screen = document.querySelector('.dq-step-body, .dq-sz-body');
    const pick = screen.querySelector('.dq-cool-pick');
    const buttons = [...(pick?.querySelectorAll('button') ?? [])];
    const caution = [...screen.querySelectorAll('p')].find((e) => e.textContent.trim() === COOL.caution);
    const words = [...screen.querySelectorAll('p')].find((e) => e.textContent.trim() === COOL.text);
    const water = buttons.find((b) => b.textContent.trim() === COOL.water);
    const num = screen.querySelector('.dq-timer-num');
    const next = [...screen.querySelectorAll('.dq-step-body > .dq-actions button')].find((b) => b.textContent.trim() === 'Next');
    const px = (e) => parseFloat(getComputedStyle(e).fontSize);
    const gap = caution && pick ? caution.getBoundingClientRect().top - pick.getBoundingClientRect().bottom : NaN;
    return {
      want: [COOL.air, COOL.water],
      buttons: buttons.map((b) => ({ label: b.textContent.trim(), cls: b.className, height: Math.round(b.getBoundingClientRect().height), whole: whole(b), hit: hit(b), pressed: b.getAttribute('aria-pressed') })),
      caution: caution && { whole: whole(caution), px: px(caution), next: pick.nextElementSibling === caution, gap: Math.round(gap), tied: !!water && water.getAttribute('aria-describedby') === caution.id && !!caution.id },
      wordsPx: words ? px(words) : null,
      count: num?.textContent.trim(),
      countdown: !!num && whole(num),
      next: next ? whole(next) : null,
      more: [...screen.querySelectorAll('button')].filter((b) => /^\+\d+ s$/.test(b.textContent.trim())).length,
    };
  });

export const scenarios = {
  async 'cold-water-one-source'(h) {
    const { ctx, page, errors } = await h.open(returning(h), '?mute');
    try {
      await h.reachHub(page);
      const named = shippedStrings().filter((s) => /\bcold water\b/i.test(s.text));
      const bad = await page.evaluate(async (named) => {
        const { COOL, SKILLS } = await import('/src/content/dbt.ts');
        const allowed = new Set([COOL.title, COOL.text, COOL.caution, COOL.water]);
        const cold = /\bcold water\b/i;
        const out = named.filter((s) => !allowed.has(s.text)).map((s) => `${s.file}:${s.line}: "${s.text.trim().slice(0, 90)}"`);
        for (const sk of SKILLS) {
          sk.steps.forEach((st, i) => {
            const said = ['title', 'text', 'small', 'big'].map((k) => (typeof st[k] === 'function' ? st[k]({}) : st[k])).join(' ');
            if (cold.test(said) && st.kind !== 'cool') out.push(`${sk.id} step ${i + 1} (${st.kind}) offers cold water outside a cool choice`);
          });
        }
        return out;
      }, named);
      h.expect(!bad.length, `cold water named outside COOL:\n  ${bad.join('\n  ')}`);
      h.expect(!errors.length, errors.join('\n'));
    } finally {
      await ctx.close();
    }
  },

  async 'cold-water-choices'(h) {
    const failed = [];
    for (const [s, vp] of SIZES.entries()) {
      const size = `${vp.width}x${vp.height}`;
      const { ctx, page, errors } = await h.open(returning(h), '?mute', vp);
      const dialogs = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss().catch(() => {});
      });
      try {
        await h.reachHub(page);
        for (const [p, [place, reach]] of Object.entries(PLACES).entries()) {
          const where = `${place} at ${size}`;
          await reach(page);
          await page.locator('.dq-cool-pick').waitFor({ timeout: 10000 });
          await h.settled(page, '.dq-cool');
          const got = await look(page);
          const [air, water] = got.buttons;
          if (got.buttons.map((b) => b.label).join('|') !== got.want.join('|')) failed.push(`${where}: the choices are ${JSON.stringify(got.buttons.map((b) => b.label))}, not ${JSON.stringify(got.want)}`);
          else {
            if (air.cls !== water.cls || Math.abs(air.height - water.height) > 1) failed.push(`${where}: the choices differ in weight: ${JSON.stringify([air, water])}`);
            for (const b of got.buttons) if (!b.whole || !b.hit) failed.push(`${where}: "${b.label}" is not whole and tappable on arrival`);
          }
          if (!got.caution) failed.push(`${where}: no caution`);
          else {
            if (!got.caution.whole) failed.push(`${where}: the caution needs scrolling`);
            if (!got.caution.next || got.caution.gap < 0 || got.caution.gap > 24) failed.push(`${where}: the caution is not right under the choices (next to them: ${got.caution.next}, ${got.caution.gap} px below)`);
            if (!got.caution.tied) failed.push(`${where}: "Cold water" is not described by the caution`);
            if (got.wordsPx === null || got.caution.px < got.wordsPx) failed.push(`${where}: the caution is ${got.caution.px} px, smaller than the screen's own words (${got.wordsPx} px)`);
          }
          if (got.count !== '30') failed.push(`${where}: before a choice the countdown shows ${got.count}, not 30`);
          await h.shot(page, `cold-${place.replace(/ /g, '-').toLowerCase()}-${size}`);

          // half the time cold water goes first, so both choices are shown starting the countdown everywhere
          const [first, then] = (s + p) % 2 ? [1, 0] : [0, 1];
          const marks = (on) => got.want.map((_, k) => String(k === on)).join('|');
          await page.locator('.dq-cool-pick').getByRole('button', { name: got.want[first], exact: true }).click();
          const ran = await page
            .waitForFunction(() => Number(document.querySelector('.dq-cool .dq-timer-num')?.textContent) < 30, null, { timeout: 5000 })
            .then(() => true, () => false);
          if (!ran) failed.push(`${where}: "${got.want[first]}" did not start the countdown`);
          await h.settled(page, '.dq-cool .dq-timer-stage');
          const started = await look(page);
          if (!started.countdown) failed.push(`${where}: after "${got.want[first]}" the countdown is off screen`);
          if (started.next === false) failed.push(`${where}: after "${got.want[first]}" Next is off screen`);
          if (started.buttons.map((b) => b.pressed).join('|') !== marks(first)) failed.push(`${where}: after "${got.want[first]}" the marks are ${started.buttons.map((b) => b.pressed).join('|')}`);
          if (started.more) failed.push(`${where}: cold offers more time; it stays about 30 s`);
          await page.locator('.dq-cool-pick').getByRole('button', { name: got.want[then], exact: true }).click();
          const moved = await look(page);
          if (moved.buttons.map((b) => b.pressed).join('|') !== marks(then)) failed.push(`${where}: after "${got.want[then]}" the marks are ${moved.buttons.map((b) => b.pressed).join('|')}`);
          if (!(Number(moved.count) <= Number(started.count))) failed.push(`${where}: picking the other choice restarted the countdown (${started.count} then ${moved.count})`);
          await h.shot(page, `cold-${place.replace(/ /g, '-').toLowerCase()}-${size}-started`);
          await page.evaluate(() => window.__daily.go({ name: 'hub' }));
          await h.reachHub(page);
        }
        if (dialogs.length) failed.push(`${size}: asked something: ${dialogs.join(' | ')}`);
        if (errors.length) failed.push(`${size}: ${errors.join(' | ')}`);
      } finally {
        await ctx.close();
      }
    }
    h.expect(!failed.length, failed.join('\n'));
  },
};
