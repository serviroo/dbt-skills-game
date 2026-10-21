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

## Made in code for this project

- Every other 3D scene (the gate, the knight, the Night Watch, the chest, rubble, smoke and particles), built from
  three.js primitives and shaders.
- All 2D art: icons, the moth, the Night Watch cards, the pebble, the moonflower, the flourish and the app icons and
  splash screens (`scripts/icons.mjs`).
- All sound and music, synthesised live with Web Audio (`src/audio/`). There are no sample files.
- All writing.
