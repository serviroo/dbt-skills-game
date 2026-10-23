# Contributing

Thanks for wanting to help. A few things matter more than anything else here.

## What can never break

1. **The Safe Zone** stays one tap from every screen, with "Talk to someone now" on every Safe Zone screen and no XP,
   sound or effects inside.
2. **You can't fail.** Nothing lowers XP, stats, ranks or the collection. No streaks, day counts or timers that run
   out.
3. **Saves.** Old saves keep loading, and a Save Crystal backup restores everything. Storage keys and stored ids
   (shadows, titles, accents, the Save Crystal app id) are frozen: renaming one needs a migration.
4. **Privacy.** No network requests except links the player taps. No analytics, accounts, remote fonts or
   third-party scripts.
5. **Original or permissive assets only.** New art, models, sound or fonts must be original or CC0/MIT/OFL, and go
   in [CREDITS.md](CREDITS.md).

## Writing and design

Read [DESIGN.md](DESIGN.md) first. Every line of skill text follows its DBT content principles: validation first, no
diagnosis words, no guilt, safe wording, scripted only. Use `{name}` and `{companion}` in copy instead of a fixed
name.

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

## Static hosting

The build uses `/` by default. Set `BASE_PATH` to the folder your host serves, with a trailing slash. Use `./` for
relative URLs. The manifest and offline cache stay inside that folder; fonts, models and scripts follow the same base.

```sh
BASE_PATH=/dbt-skills-game/ npm run build
node scripts/serve-static.mjs --dir=dist --base=/dbt-skills-game/ --port=4180
```

In another terminal, check the built site:

```sh
node scripts/live-check.mjs http://localhost:4180/dbt-skills-game/
node scripts/pwa-verify.mjs --path=/dbt-skills-game/ --browser=chromium --out=artifacts/pwa --check
node scripts/pwa-verify.mjs --path=/dbt-skills-game/ --browser=chromium --update --out=artifacts/pwa --check
node scripts/pwa-csp-sweep.mjs --path=/dbt-skills-game/ --check
```

The live check opens a fresh browser profile at phone size. It checks the name prompt, Home, the one-tap Safe Zone,
offline reload and launch, query links, the CSP and requests to other origins. Screenshots and a pass/fail report go
in `artifacts/live/`. It exits with a non-zero status if a check fails.

GitHub Pages builds on pushes to `main` and manual dispatches. Its build job runs the checks above before the deploy
job can start. The build records `BUILD_ID` in a meta tag, using the commit SHA in Actions and the local HEAD
(with `-dirty` for uncommitted changes) otherwise. After each deploy, check the published site against that build:

```sh
node scripts/live-check.mjs https://serviroo.github.io/dbt-skills-game/ --expect="$(git rev-parse HEAD)"
```

The check waits up to three minutes for the expected build. Pass the deployed commit, which can differ from your
local HEAD after a merge. Service workers need HTTPS or localhost; for a local LAN proof, the live check trusts only
the supplied HTTP origin in its isolated browser.
