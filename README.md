# The Lantern: a DBT skills game

A small, calm game for practising DBT (Dialectical Behavior Therapy) skills. A Gate opens, the Lantern chooses you as
its Wanderer, and a short 3D intro plays. After that it becomes a quiet daily companion you can install on your phone's
Home Screen.

You can't fail at it. There are no streaks, no penalties and no "you missed a day" counts. XP only goes up, and coming
back after a long break is always fine.

## What's inside

- Daily skill: one small DBT skill a day, from all four modules (mindfulness, distress tolerance, emotion
  regulation, interpersonal effectiveness). Wise Mind, one-mindfully, effectively, mindfulness of current
  thoughts, STOP, TIPP, ACCEPTS, self-soothe, body scan, radical acceptance, turning the mind, alternate rebellion,
  check the facts, opposite action, problem solving, myths about emotions, steps toward what matters to you, DEAR MAN,
  GIVE, FAST, clarifying priorities, how firmly to ask or say no, myths in the way of asking, both-and thinking,
  mindfulness of others and more. Each one is a short guided walk-through that takes a minute or two.
- Skills list: every skill, any time. Search either name, or narrow it by what you need right now, topic or time,
  and pin your favourites to the top. Browsing and pinning never count as practice.
- Safe Zone: a calm path for hard moments, one tap from every screen. No XP, sounds, vibration or glows in there,
  and a link to crisis lines on every screen: the US, Canada, the UK, Ireland, Australia, New Zealand and India,
  picked from your device language and changeable in one tap.
- Give me a moment: a one-tap check-in when you just need to breathe.
- Diary card: a plain-text card of what you practised, made for sharing with a therapist if you want to.
- Your name and your companion's: the game asks what to call you the first time (or skip it and stay "Player"), and
  you can change both any time in Settings. Pick an accent colour in the Wardrobe.
- The Night Watch, ranks and titles: small rewards that grow as you use things. Nothing is ever taken away.
- Art room and Story Room: draw or write whatever you like. It all stays on your device. The Story Room's co-writer
  can ask you questions, toss in a what-if, suggest a next line or tidy up a messy bit. It's scripted and runs on your
  device too. Stuck on a blank page? Ask for a starting point. Read mode shows the whole story at the text size you
  pick, and remembers it. A story you downloaded can come back in as a new story.
- Save Crystal: a backup of your progress, stories, drawings (unfinished ones too) and choices. Restore keeps choices
  you already made on this device, including mute. If something could not be read, the file and the app say the backup
  is incomplete.
- Starting over: Settings makes a Save Crystal first, then clears this game's data from the device after one
  confirmation. Nothing else the browser keeps for other sites or apps is touched.

## How the practice works

Every skill is a short script: a few steps, each with a choice or an optional text box. You can skip any step, stop
halfway, or pick "not this time". Finishing a skill earns a little XP and a stat bump, and that's it. The game never
asks you to rate how you did.

The skill text is written in plain language and follows standard DBT handouts. It's scripted, not generated: there is
no AI chat in the game.

## Privacy

Everything is saved in your browser (localStorage and IndexedDB) on your own device. No accounts, no analytics, no
tracking and no third-party requests. Clearing site data or uninstalling removes it, so keep a Save Crystal if you
care about your progress. Settings > Your data can also back you up and then clear this game's data from the device:
its saves, drawings, stories, offline files and offline worker, and nothing else.

## Running it

Live: [The Lantern](https://serviroo.github.io/dbt-skills-game/).

You need Node.js 20.19 or newer.

```sh
npm ci
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview  # serves dist/ on http://localhost:4173
```

`dist/` is a plain static site with an offline service worker, so any static host works. The service worker only runs
over HTTPS (or on localhost).

Slow fonts and a broken intro model won't stop you from opening the game. Updates arrive in the background. If a
page has stayed open through several updates, it may ask you to reload before starting the intro or companion.

Handy URL flags while developing:

- `/?fresh` plays the intro cutscene again.
- `?shot=gate|windows|silhouette|awaken|chest|rewards` starts the intro at a given beat.
- `?lab=daily|window|gate|awaken|chest|audio|character` opens a single piece on its own.

All the copy lives in `src/content/`: `intro.ts` for the cutscene and welcome note, `dbt.ts` for the skills,
`daily-lines.ts` and `roster-lines.ts` for the companion. [DESIGN.md](DESIGN.md) has the look, motion, sound and
writing rules, and the principles every skill follows.

## Not a substitute for therapy

This is skills practice, not treatment. It can't diagnose anything, it doesn't know your situation, and it isn't a
crisis service. DBT works best with a trained therapist, so use this alongside real care, not instead of it.

If you're in danger or thinking about hurting yourself, contact local emergency services or a crisis line now. In the
US, call or text 988, or text HOME to 741741.

## Credits

The hooded wanderer is built from CC0 packs by Quaternius. Everything else is drawn and synthesised in code (three.js,
Web Audio), and the fonts are Jost and Bodoni Moda (SIL Open Font License). Full list in [CREDITS.md](CREDITS.md).

## License

MIT, see [LICENSE](LICENSE).
