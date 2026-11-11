# Contributing to Ghost Arcade

Thanks for helping. You don't need to understand the whole codebase to make a useful change: most good first pull requests touch one folder.

The full guides live on the website:

- [Contributing](https://ghostarcade.live/docs/contribute): every way to help, and how review works
- [Contributing code](https://ghostarcade.live/docs/contribute/code): a map of this repository and where to start
- [Making ISF shaders](https://ghostarcade.live/docs/contribute/shaders), [p5.js sketches](https://ghostarcade.live/docs/contribute/p5), [three.js pages](https://ghostarcade.live/docs/contribute/threejs) and [tutorials](https://ghostarcade.live/docs/contribute/tutorials)

Shaders, sketches, pages and tutorials can also be submitted through the website without a pull request. Approved ones appear in the app's Shader Library under **Find latest**, credited to you.

## Quick start

You need Node.js 20 or newer (npm 10 or newer), and Rust 1.96 or newer from [rustup](https://rustup.rs) to build the render core.

```bash
git clone https://github.com/riskcapital/ghost-arcade.git
cd ghost-arcade
npm install
npm run desktop:native   # builds the render core, then starts the app
```

After the first run, `npm run desktop` starts the app, and `npm run native:build` rebuilds the core after a Rust change.

## Checks

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest). Tests that need the render core skip themselves until it is built. |
| `npx vitest run src/lib/p5sketch` | The tests in one folder. |
| `npm run check` | Type-checks the app, Svelte components included. |
| `npm run lint` | ESLint over `src`. |
| `npm run native:test` | The Rust core's tests. |

Run `npm test`, `npm run check` and `npm run lint` before opening a pull request, and `npm run native:test` if you changed Rust.

## Where p5.js developers start

The p5.js stack is plain TypeScript with about 190 tests, and it doesn't touch the GPU or the Rust core:

- `src/lib/p5sketch/`: turns a sketch into a playable page (`wrapSketch.ts`), finds its canvas and controls without running it (`jsScan.ts`), stops runaway loops (`loopGuard.ts`)
- `src/lib/p5import/`: imports from p5.js Web Editor links, zips and folders
- `src/lib/sketchEditor/`: the in-app sketch editor
- `src/lib/components/P5SketchImport.svelte`: the import panel
- `src/lib/stores/sketchLibrary.ts`: where imported sketches are kept

A sketch that imports badly makes a good first pull request: add a small copy of it as a test in `wrapSketch.test.ts` or `jsScan.test.ts`, then fix it.

## Pull requests

1. Keep each pull request to one change.
2. Sign off every commit with `git commit -s`. This adds a `Signed-off-by` line, your statement under the [Developer Certificate of Origin](https://developercertificate.org) that you wrote the change or have the right to submit it.
3. Say what changed for someone using the app, how you tested it, and on which system. Screenshots help for anything visible.

The maintainer reviews and runs every pull request and may ask for changes. User-visible changes go into the release notes when they ship.

## Licence

Ghost Arcade is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). By contributing code, you agree that it is licensed under the same terms.

## Help

- [Forums](https://ghostarcade.live/forums) for questions and "where would I start on this?"
- [GitHub Issues](https://github.com/riskcapital/ghost-arcade/issues) for bugs, with steps to reproduce, your system and the app version
