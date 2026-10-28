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
  gone. If you only added names, it passes and tells you which. It also checks the list against the copy on `main`:
  taking a name out of both the source and the list still fails.
- Adding a skill, title or look? Pick its final id first (lowercase words joined by `-`, taken from the real skill name
  when there is one), run `npm run check:ids -- --update`, and commit the updated list with your change. New storage
  keys go in `src/core/stored-names.ts`.
- Renaming or retiring one? Keep reading the old id: turn it into the new one when a save loads (in `normalize` in
  `src/daily/store.ts`, or in the store that keeps it), add `{ "kind", "from", "to", "since" }` under `migrations` in
  the list, and add an E2E scenario that loads a save with the old id.

The first release freezes these names. Backups from unreleased development builds can contain retired skill ids or
room preferences; those test files are not supported. Saves missing newer fields still load with defaults. Sound,
motion and room preferences belong to the current device; restoring a backup keeps this device's choices. Unfinished
drawings and skill answers are included. Thumbnails, co-writer suggestions and credentials stay on this device and are
not backed up.

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

`scripts/e2e.mjs` starts its own dev server and Playwright Chromium, runs every scenario in `scripts/e2e/*.e2e.mjs`
and saves screenshots and `report.json` to `artifacts/e2e/<time>/`. It exits non-zero if any scenario fails. Scenarios
run side by side, longest first, each in a browser of its own: `--jobs=<n>` browsers, by default one for every 4 of the
machine's CPU threads and at most 4, so one on CI's 4-vCPU runners. CI runs the same checks on every pull request and
splits the scenarios into parts with `--shard=<i>/<n>`, spread by the seconds each one took on CI, kept in
`scripts/e2e/timings.json`. A scenario not listed there counts as 15 s; after adding a long one, refresh the file from
a CI run's `e2e-*` artifacts with `node scripts/e2e-timings.mjs <every part's report.json>`. For anything visual, also
look at it in a browser at phone width (390 and 320 px) with motion on and off.

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

Scenario names must be unique across all files. If two match, the runner stops before it starts anything. Scenarios
from every file run side by side in no fixed order, so a scenario must not count on another one having run or not run
yet. A file whose scenarios must run in the order they are written, one at a time, exports `serial = true`. Every
scenario gets an `h` object from `scripts/e2e/harness.mjs`, the same but for `browser` and `open` in each browser:

- `open(seed?, query = '?mute', viewport = 390x844)`: a fresh browser profile with `seed` written to localStorage
  first. Returns `{ ctx, page, errors }`; close `ctx` when done.
- `reachHub(page)`, `openSettings(page)`: tap through to Home or the Settings screen.
- `shot(page, name)`: a screenshot in the run's folder (`out`). Start the name with your file's name, and give
  whatever a scenario writes there a name no other scenario uses, as they run at once.
- `ls(page, key)`, `youOf(page)`, `deepFind(obj, key)`, `deepDrop(obj, keys)`, `expect(cond, msg)`, `sleep(ms)`.
- `SAVE`, `YOU`, `SEEN`: the save key, the names key and an app state that skips the intro.
- `browser`, `server.url`, `flags`, and `shared`, one object for the whole run, for a result worth making once (a
  build, the content). Store a promise in it (`shared.x ??= make()`) so scenarios running at once share one. A file
  that passes results from one scenario to the next must be serial.
- `out`, the run's artifact folder; `renderer`, the WebGL renderer; `stop()`, which closes every browser and the server.

The runner closes any remaining browser profiles in a scenario's browser after it, including failures. A scenario
should also work on its own: create any fixture it needs when an earlier scenario has not run. Whatever a scenario returns is kept
as its `result` in `report.json`.

### Phone layout

`node scripts/e2e.mjs --file=layout-fit` opens every companion screen at 390x844, 320x568 and 844x390 and checks that
nothing scrolls or sticks out sideways, every button, link and field takes taps across at least 44x44 px, and body
text is at least 16 px. The drawing screen is also checked at 568x320, 360x740 and 375x667, for both Draw today and
a shadow ally, with the Clear question open too, and its page must stay at least 180 px tall. Screens in its
`ENFORCED` list fail the run. Every other screen passes and prints its problems
as a todo list, also kept in `report.json`. Once a screen fits, add it to `ENFORCED`.

### Screen reader names

`node scripts/e2e.mjs --file=a11y-names` opens every companion screen at 390x844 and reads names from the browser's
own accessibility tree. It checks that every button, link, field and switch a screen reader can reach has a name, every
picture is either named or hidden from screen readers (`aria-hidden="true"`, or `alt=""` on an `img`), no id is used
twice, every `aria-labelledby` and `aria-describedby` points at an element that exists, and nothing a player can reach
with Tab is hidden from screen readers. As in the layout check, screens in its `ENFORCED` list fail the run and the
rest print a todo list. `a11y-names-planted` adds one of each problem to Home, plus look-alikes that are fine, and
fails unless the check reports exactly the problems.

To fix a screen, give each control a short, accurate name that says what it does. Hide only pictures that are purely
decorative. Never hide a control or a picture a player needs just to pass the check.

Run one file with `node scripts/e2e.mjs --file=<name>`, or one scenario with `--scenario=<scenario name>`. The browser
renders with SwiftShader by default so local runs match CI. Add `--gpu` to render on this machine's GPU instead, or
`--headed` to watch it.

`node scripts/e2e-runner-check.mjs` checks file selection, duplicate names, failure reports and cleanup through the
real command. It creates temporary scenario files and removes them when it finishes.

The intro is 3D, so for a real-GPU run on another machine, start a Playwright launch server there and pass
`--ws=<its endpoint> --host=<this machine's address>`, so the dev server is reachable from that browser.

### Skill check

`node scripts/e2e.mjs --file=skill-check` checks every skill in `SKILLS`. On a returning save at 390x844 it opens each
one from the Skills list and taps the first option on every screen until the skill's own end screen. Moving on to
another skill, the Safe Zone or Home first counts as a problem. That walk must take at most 12 taps and credit the skill
once, and its timers must stay skippable while they run. Then it opens the skill again for each screen of the walk,
walks back to that screen and taps "Leave this skill". Each time it must go straight to Home with no confirm and still
credit the skill. It also reads each skill's copy from `src/content/dbt.ts`: no em dashes, no diagnosis words, no set
phrases DESIGN.md rules out (unsafe wording, "less fortunate", abandonment cues, body, food or weight numbers), no
hard-coded "Player", and a caution that names the heart risk plus a "breathe instead" option on cold-water or
hard-exercise steps. Every timer runs 20 to 90 seconds and has a step id. A screen that offers another skill or the Safe
Zone also needs a step id, and its first button (and any equal button beside it) must be this skill's own way forward:
its finish, a later step or the Safe Zone, never another skill or a repeat of an earlier step. It then opens each
cold-water or hard-exercise step at 390x844, 844x390 and 320x568: the caution,
the step's own action and "Breathe instead" must show without scrolling, with "Breathe instead" the same kind and height
of button as that action. On a timer, once Start is tapped, the countdown, Next and "Breathe instead" must all still be
on screen. Skills in its `ENFORCED` list fail the run. Every other skill's problems print as a todo list, also kept in
`report.json`. Once a skill passes, add it to `ENFORCED`. Add `--skills=<id>,<id>` to check only those skills; an id
that doesn't exist fails the run.

`node scripts/e2e.mjs --file=skill-flows` opens those step ids in their real skills, on a returning save at 390x844:

- `skill-timers`: every timer offers "+15 s" once it runs (timers up to 30 seconds) or "+30 s" (longer ones). It adds
  exactly that much while the timer runs and after Done, on the same screen, with Next still there and no extra credit.
  Cold water is the one exception (about 30 seconds, no extra time), marked `extend: 0` on its step.
- `skill-exits`: on every screen that offers another skill or the Safe Zone, the first button finishes this skill on its
  own end screen, or opens the Safe Zone when that leads, and credits this skill once and no other. When an answer
  shows distress rising (a "Higher" answer), the screen it leads to puts people first: "People to talk to"
  (`safe:people`) leads and opens the Safe Zone at "Talk to someone now".
- `skill-practise-again`: a full end screen offers "Practise again", which opens the same skill fresh at the part the
  player opened, with one credit like any opening. A quiet "Not this time" end doesn't offer it.
- `skill-answers-rotate`: what the player typed or picked stays when the phone turns sideways and back.

To add a skill, add its object to `SKILLS` in `src/content/dbt.ts` (`id`, `sl`, `real`, `module`, `minutes`, `card`,
`steps`); the Skills list shows it under its module. Add its id to every need it honestly fits in `NEEDS` in
`src/content/skill-library.ts` (`find-skills` fails for a skill under no need), and use a `minutes` label from
`LABEL_SECONDS` there if it takes a set time (any other label shows under No set time). Freeze its id with
`npm run check:ids -- --update`, run
`node scripts/e2e.mjs --file=skill-check --skills=<id>` and `node scripts/e2e.mjs --file=skill-flows`, and add the id
to `ENFORCED` once it passes. Give it its own E2E file for the paths it adds.

The same file's `copy-everywhere` scenario reads every string the app ships, not only the skills: the string and
template text in `src/` (comments left out), quoted text in its CSS, `index.html` and the web app manifest. Any em dash,
diagnosis word or principle 9 phrase fails it, with the file and line.

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

GitHub Pages builds the newest commit on `main` once CI has passed on that exact commit, and `main` as it is on a
manual dispatch. A CI run that ends after a newer commit reached `main` deploys nothing; the newer commit deploys when
its own CI passes. The build job runs the checks above before the deploy job can start. The build records `BUILD_ID`
in a meta tag, using the commit SHA in Actions and the local HEAD (with `-dirty` for uncommitted changes) otherwise.
After each deploy, check the published site against that build:

```sh
node scripts/live-check.mjs https://serviroo.github.io/dbt-skills-game/ --expect="$(git rev-parse HEAD)"
```

The check waits up to three minutes for the expected build. Pass the deployed commit, which can differ from your
local HEAD after a merge. Service workers need HTTPS or localhost; for a local LAN proof, the live check trusts only
the supplied HTTP origin in its isolated browser.
