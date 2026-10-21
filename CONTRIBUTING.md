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
node scripts/e2e.mjs
```

`scripts/e2e.mjs` starts its own dev server, walks the first-run name prompt, the Settings fields and a Save Crystal
round trip, and saves screenshots to `artifacts/e2e/`. For anything visual, also look at it in a browser at phone
width (390 and 320 px) with motion on and off.

The intro is 3D, so run the browser on a machine with a real GPU when you can: start a Playwright launch server there
and pass `--ws=<its endpoint> --host=<this machine's address>`, so the dev server is reachable from that browser.
