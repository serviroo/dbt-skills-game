# Credits

Everything in The Lantern is original to this project or comes from the permissively licensed sources below.

## 3D character

The hooded wanderer in the intro (`public/models/hero.glb`) is built by `scripts/build-hero.mjs` from three free packs by
[Quaternius](https://quaternius.com), all released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (public domain):

| Pack | What's used |
| --- | --- |
| Modular Character Outfits - Fantasy [Standard] | The ranger outfit: hood, coat, arms, legs and boots, recoloured to night tones |
| Universal Base Characters [Standard] | The head, eyes and brows of one base body |
| Universal Animation Library [Standard] | The idle, walk and spell clips |

CC0 doesn't require credit, but Quaternius made this possible, so here it is.

## Night Watch figures

The watchers in the Night Watch's camp (`public/models/watch.glb`) are original to this project: modelled, textured and
baked in [Blender](https://www.blender.org) by `scripts/build-watch.py`, then packed for the web by
`scripts/build-watch.mjs`.

## Fonts

- [Jost](https://github.com/indestructible-type/Jost) by indestructible type*, SIL Open Font License 1.1.
- [Bodoni Moda](https://github.com/indestructible-type/Bodoni) by indestructible type*, SIL Open Font License 1.1.

Both are self-hosted and subset by `scripts/fonts.mjs`.

## Code libraries

- [three.js](https://threejs.org), MIT.
- [postprocessing](https://github.com/pmndrs/postprocessing), Zlib.
- Build tools only: [glTF Transform](https://gltf-transform.dev) (MIT), [sharp](https://sharp.pixelplumbing.com)
  (Apache-2.0), [subset-font](https://github.com/papandreou/subset-font) (BSD-3-Clause),
  [Playwright](https://playwright.dev) (Apache-2.0), [Vite](https://vite.dev) (MIT) and
  [TypeScript](https://www.typescriptlang.org) (Apache-2.0).

## Made in Blender for this project

- The river stone in Wise Mind's calm scene (`public/models/stone.glb`): modelled, textured and baked in Blender for
  this game, then packed with its colour, roughness and normal maps as WebP.

## Skies

Home's four skies (`public/sky/`) are original, made for this project in Blender: one sky and three ridges of hills
with mist between them, lit for dawn, day, dusk and night, then graded and sized for phones and desktops. No photos
or outside assets went into them.

## Made in code for this project

- Every other 3D scene (the gate, the knight, the Night Watch's camp and banner, the chest, the Lantern resting in
  mist, rubble, smoke and particles), built from three.js primitives and shaders.
- All 2D art: icons, the moth, the Night Watch cards, the pebble, the moonflower, the flourish and the app icons and
  splash screens (`scripts/icons.mjs`).
- The open hands in Willing Hands and Radical Acceptance: a stylised hand modelled in code as a smooth shape round its
  bones, meshed when the scene first opens and posed joint by joint (`src/scene/vignettes/scenes/hands.ts`).
- All sound and music, synthesised live with Web Audio (`src/audio/`). There are no sample files.
- All writing.
