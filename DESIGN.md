# Design

How The Lantern looks, moves, sounds and talks, and the rules the DBT content follows. Read this before you change
anything a player sees or hears.

## The product in three lines

- **You can't fail.** No streaks, no "days missed", no decay, no rank-down, no lives, no timers that run out. XP,
  stats, ranks and the collection only go up. Opening a skill counts as practice, even if you close it on screen one.
- **Give, never ask.** The game hands things over (a card, a line, a small reward). It never asks for a rating, a
  review, a streak or a reason you were away.
- **Spectacle once, calm every day.** The intro cutscene is loud and cinematic. The daily companion is quiet: same
  palette and windows, slow fades, soft or no sound.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| void | `#07080F` | Background. Never pure black. |
| lantern blue | `#4FB8FF` | The main light: window edges, bars, highlights. Ramp from `#1C43A5` up to `#A4F8FF`. |
| violet | `#7B3FE4` | Glow only, never a flat fill. |
| gold | `#C9A45C` | Rewards only: the chest, ranks, titles. If everything is gold, nothing is. |
| ice | `#E6F1FF` | Text. |
| mint | `#89CF9D` | Tiny doses, only for things that belong to the player. |

The window material: a dark translucent plate (`rgba(5,17,31,.93)`), one lit hairline on top and a darker one below,
a thin blue rule under the title. Tokens live in `src/styles/tokens.css`.

## Type

- **Bodoni Moda** for display moments of one to three words (a rank, a title card). Never for body copy.
- **Jost** for all UI and body text.
- On phones: body text at least 16 px (17 px in the companion, 20 px in the Safe Zone). Contrast at least 4.5:1.
- Fonts are self-hosted and subset (`scripts/fonts.mjs`). No remote font requests.

## Light

- Two-layer glow: a tight bright core plus a wide soft halo. Nothing else glows.
- Glow only on things that are light sources: window edges, bars, eyes, the gate, the lantern.
- Overshoot (a flash brighter than the resting state) only on light, never on shapes or position.
- The 3D scenes use AgX tone mapping, bloom tuned so only light sources bloom, and a cool grade. Highlights go to
  blue-white, shadows to deep blue, never to grey.

## Motion grammar

- The camera moves; windows don't. A window opens in place and closes in place.
- Windows open in 100 to 133 ms, stepped on 2s (a new pose every 2 frames at 60 fps), then a short glitch on the
  edges only. Closing is a 167 ms collapse into a bar, then a fade.
- Effects run on 2s. Holds aren't frozen: they drift slightly.
- Visuals lead their sound by 1 or 2 frames, never the other way round.
- One camera shake per scene at most.
- Never more than 3 flashes per second, anywhere.
- With `prefers-reduced-motion` or motion turned off in Settings, every animation goes straight to its finished state
  with a short soft fade.
- The daily companion uses slow fades only: no glitch, no shake, no bloom bursts.

All timings live in `src/motion/tokens.ts`. Change them there, not in the components.

## Sound grammar

- Sound arrives before the picture it belongs to. Silence comes right before a big hit.
- Every cue is recognisable through a phone speaker: its character sits between 0.8 and 5 kHz.
- Everything is synthesised with Web Audio (`src/audio/`). No sample files.
- Sound is never required to follow anything. Mute is one tap and it sticks.

## Tone

- Short, plain, warm. Talk to the player, not about them.
- Game flavour in the frame (`[Today's quest: Take It Easy.]`), plain words in the content.
- No exclamation-mark hype, no guilt, no "we miss you".
- `{name}` and `{companion}` in any copy string are filled with the player's chosen names (`src/core/you.ts`).

## DBT content principles

1. **Can't fail.** See above. Quitting a skill on its first screen still credits it. No code path removes XP.
2. **Validation first.** Every skill opens by acknowledging how the player feels before it teaches anything. "Check
   the Facts" never implies overreacting, and "it fits the facts" is always a valid answer. "It didn't help" gets a
   thank-you, never a correction.
3. **One to three minutes.** A skill is 4 to 9 screens. Timers are 20 to 90 seconds, skippable and extendable. The
   daily visit fits in about two minutes, and every visit stands on its own.
4. **Choice.** The daily skill is a suggestion. "Pick another" and "Just look around" are always there. Free text is
   always optional. Sound, motion, the diary and every urge row can be turned off.
5. **Private, on this device only.** No accounts, server, analytics, third-party scripts or remote fonts. The only
   network calls are links the player taps. The Home Screen name and icon say nothing about mental health.
6. **The Safe Zone is one tap away** from every screen after the intro. Inside it, "Talk to someone now" is pinned on
   every screen and numbers dial with one tap. No XP, toasts, particles, glow bursts or sound effects inside, and
   leaving never asks "are you sure". The button says "Safe Zone", plainly: in a crisis, clarity beats theme.
7. **Point to real support, gently.** The framing is "skills practice that goes with real support". At most one
   therapist mention per session, never on back-to-back screens. The diary card exports plain text "for your
   therapist, if you want".
8. **No diagnosis talk.** Never say disorder, diagnosis, symptoms, patient, illness, treatment or relapse. Talk
   about feelings, urges, skills and practice.
9. **Safe wording.** Follow safe-messaging guidelines: no method or means details, no "committed suicide", no
   "successful/failed attempt". No game-death language ("you died", "game over"). No abandonment cues. No body, food
   or weight numbers. No "compare yourself to those less fortunate"; compare to a time you felt different instead.
10. **No nagging.** No push notifications (never request the permission), no badges, no "you haven't visited", no
    count of days away. Welcome back reads the same after one day or three months.
11. **Medically safe instructions.** Cold water and intense exercise always carry a short caution and an
    equal-weight "breathe instead" option, visible without scrolling. Cold, not icy (above 10 °C / 50 °F, about 30
    seconds).
12. **Nobody else in the flows.** The skills, diary and Safe Zone never mention who made the game or anyone the
    player didn't add themselves. Nothing that could feel like being watched or owing someone.
13. **Calm by default** in the companion. The cinematic language belongs to the intro.
14. **Scripted only.** No AI chat and no generated replies. Every line the player can see is written in
    `src/content/`.

## Safe Zone order

Body first, then a pause, then the player's own lists, then people and services, with services one tap away the
whole time:

1. Calm the body: cold water (with its caution), paced breathing (in 4, out 6), squeeze and release, an optional
   minute of movement.
2. "Is it even a little lower?" A "Higher" answer brings "Talk to someone now" to the top.
3. STOP: stop, step back, notice, next step. One line per tap.
4. The player's reasons, people (call or text buttons) and comfort kit, each with a kind empty state.
5. Crisis lines for the player's region, with the local emergency number first when they say they might not be safe.

Every step is skippable. The lists are set up only when the player chooses to, and stay editable in Settings.

## Accessibility checklist

- At most 3 flashes per second.
- `prefers-reduced-motion` and the in-game motion setting are both honoured.
- Text contrast at least 4.5:1; body text sizes as above.
- Nothing depends on sound.
- Every control has a label a screen reader can read, and every tap target is at least 44 px.
