# Contributing

Thanks for wanting to help. A few things matter more than anything else here.

## What can never break

1. **The Safe Zone** stays one tap from every screen, with "Talk to someone now" on every Safe Zone screen and no XP,
   sound or effects inside.
2. **You can't fail.** Nothing lowers XP, stats, ranks or the collection. No streaks, day counts or timers that run
   out.
3. **Saves.** Old saves keep loading, and a Save Crystal backup restores everything. Storage keys and stored ids never
   get renamed without a migration (see [Stored names and ids](#stored-names-and-ids)).
4. **Privacy.** No network requests except links the player taps. No analytics, accounts, remote fonts or
   third-party scripts.
5. **Original or permissive assets only.** New art, models, sound or fonts must be original or CC0/MIT/OFL, and go
   in [CREDITS.md](CREDITS.md).

## Writing and design

Read [DESIGN.md](DESIGN.md) first. Every line of skill text follows its DBT content principles: validation first, no
diagnosis words, no guilt, safe wording, scripted only. Use `{name}` and `{companion}` in copy instead of a fixed
name.

## Stored names and ids

A player's progress is saved under the names in `scripts/stored-ids.json`: storage keys, IndexedDB stores, the save's
fields and every id a save holds (skills, titles, Night Watch members, looks, lines, feelings). Names only get added to
that list, never taken out.

- `npm run check:ids` reads the names from the source and compares them with the list. It fails if a listed one is
  gone. If you only added names, it passes and tells you which.
- Adding a skill, title or look? Pick its final id first (lowercase words joined by `-`, taken from the real skill name
  when there is one), run `npm run check:ids -- --update`, and commit the updated list with your change. New storage
  keys go in `src/core/stored-names.ts`.
- Renaming or retiring one? Keep reading the old id: turn it into the new one when a save loads (in `normalize` in
  `src/daily/store.ts`, or in the store that keeps it), add `{ "kind", "from", "to", "since" }` under `migrations` in
  the list, and add an E2E scenario that loads a save with the old id.

The first release freezes these names. Backups from unreleased development builds can contain retired skill ids or
room preferences; those test files are not supported. Saves missing newer fields still load with defaults. Sound,
motion and room preferences belong to the current device; restoring a backup keeps this device's choices. Drafts,
thumbnails, co-writer suggestions and credentials are local working data, separate from the backup.

## Checking a change

```sh
npm ci
npx tsc --noEmit -p .
npm run build
node scripts/pwa-verify.mjs --check
node scripts/pwa-verify.mjs --update --check
node scripts/pwa-csp-sweep.mjs --check
node scripts/e2e.mjs
node scripts/e2e-runner-check.mjs
```

The PWA checks test the build in `dist/`. `pwa-verify` runs in both Chromium and WebKit; on a machine where WebKit
can't run, add `--browser=chromium`.

`scripts/e2e.mjs` starts its own dev server and a Playwright Chromium, runs every scenario in `scripts/e2e/*.e2e.mjs`
and saves screenshots and `report.json` to `artifacts/e2e/<time>/`. It exits non-zero if any scenario fails. CI runs
the same checks on every pull request. For anything visual, also look at it in a browser at phone width (390 and
320 px) with motion on and off.

### E2E scenarios

Each file in `scripts/e2e/` named `<name>.e2e.mjs` exports its scenarios:

```js
export const scenarios = {
  async 'my-feature-saves'({ open, reachHub, expect, ls, SAVE, SEEN }) {
    const { ctx, page, errors } = await open({ 'dbt.app.v1': SEEN });
    await reachHub(page);
    expect(JSON.parse(await ls(page, SAVE)), 'nothing saved');
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
  },
};
```

Scenario names must be unique across all files. If two match, the runner stops before it starts anything. Files run in
name order, and each file's scenarios run in the order they are written. Every scenario gets the same `h` object from
`scripts/e2e/harness.mjs`:

- `open(seed?, query = '?mute', viewport = 390x844)`: a fresh browser profile with `seed` written to localStorage
  first. Returns `{ ctx, page, errors }`; close `ctx` when done.
- `reachHub(page)`, `openSettings(page)`: tap through to Home or the Settings screen.
- `shot(page, name)`: a screenshot in the run's folder (`out`). Start the name with your file's name.
- `ls(page, key)`, `youOf(page)`, `deepFind(obj, key)`, `deepDrop(obj, keys)`, `expect(cond, msg)`, `sleep(ms)`.
- `SAVE`, `YOU`, `SEEN`: the save key, the names key and an app state that skips the intro.
- `browser`, `server.url`, `flags`, and `shared`, an object scenarios can use to pass results to later ones.
- `out`, the run's artifact folder; `renderer`, the WebGL renderer; `stop()`, which closes the browser and server.

The runner closes any remaining browser profiles after each scenario, including failures. A scenario should also
work on its own: create any fixture it needs when an earlier scenario has not run.

Run one file with `node scripts/e2e.mjs --file=<name>`, or one scenario with `--scenario=<scenario name>`. The browser
renders with SwiftShader by default so local runs match CI. Add `--gpu` to render on this machine's GPU instead, or
`--headed` to watch it.

`node scripts/e2e-runner-check.mjs` checks file selection, duplicate names, failure reports and cleanup through the
real command. It creates temporary scenario files and removes them when it finishes.

The intro is 3D, so for a real-GPU run on another machine, start a Playwright launch server there and pass
`--ws=<its endpoint> --host=<this machine's address>`, so the dev server is reachable from that browser.
