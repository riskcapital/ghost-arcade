# Soak testing

The soak test runs Ghost Arcade for hours on its own, doing what people do with it, and records everything. Run it on a
Mac and on a Windows PC before every release (see "Before a release" below). It needs no one at the keyboard.

What it does, over and over, in a seeded random order:

- **Templates**: opens each starter template.
- **Mapping**: adds surfaces in every shape, moves corners, mesh warps, masks, shared surfaces ("Link to surface"),
  duplicates and deletes.
- **VJ**: opens the deck, loads shaders and real video files (dropped like a user drops them, HAP included), launches
  clips and columns, the crossfader (Auto included), layer and composition effects, groups, rows, stop all.
- **Add-ons**: Audio Lab and Analog Synth when the build has them; a fake phone camera (off by default, see below).
- **Timeline**: adds songs (generated WAVs), ✦ Auto show, transport and GO, sections, Screen FX, control lines,
  Live key takes driven by a knob, takeover and Perform pads, undo/redo storms.
- **Interactive world**: opens the Interactive Studio, clicks through its tabs, modes and tools, draws on the stage,
  adds a trigger zone.
- **Render to video**: short renders in several sizes, frame rates and codecs, each checked with ffmpeg (size and
  frame count; ffprobe is used when it is on the PATH).
- **Projects**: saves, reopens and compares.
- **Settings**, **window size**, **output window** open and close.
- **Monkey**: real mouse clicks, drags, slider moves and keys on whatever is on screen (never on anything that quits,
  opens a file dialog, buys, signs in or leaves the app).

Every action checks its own result (the store changed, the render core still draws a frame when asked, the render has
the right size and frame count, no uncaught exception) and has a timeout. Every 60 actions the run returns to a blank
project, lets it settle, collects garbage and takes a **checkpoint**: memory measured in the same state every time,
then the frame rate and GPU time of a fixed reference scene (one full-frame animated shader). Those are what the leak
and slowdown checks use.

## Running it

From a source checkout with `npm install` done and the render core built (`npm run native:build`):

```sh
npm run soak                              # 4 hours against this checkout (starts its own Vite server)
npm run soak -- --hours 1                 # shorter
npm run soak:smoke                        # 10 minutes, while developing
npm run soak -- --app <packaged app>      # against a build you are about to release
```

`--app` takes:

- **macOS**: the `.app`, or the `.dmg` itself (it is mounted read-only and run from there; nothing is installed).
- **Windows**: the `Ghost Arcade Pro.exe` inside the installed folder or the unpacked build (`dist-release/win-unpacked`),
  or that folder.
- **Linux**: the AppImage or the unpacked binary.

The packaged app still needs this checkout for the runner itself (Node 20 or later and `npm install`).

Other options:

| Option | What it does |
| --- | --- |
| `--hours N`, `--minutes N` | How long to run (default 4 hours). |
| `--seed N` | The random seed. Every run prints its seed; the same seed replays the same actions. |
| `--areas a,b` / `--exclude a,b` | Only some areas: `templates, mapping, vj, addons, timeline, interactive, render, project, settings, window, output, monkey`. |
| `--only name,name` | Only these actions (e.g. `vj.trigger,timeline.autoShow`). |
| `--steps N` | Stop after step N (for replays). |
| `--keep-open` | Leave the app running at the end, for a look around (debug port as `--port`). |
| `--hidden` | macOS: hide the app's window so the run does not cover the screen. The render core and the editor keep running; frame rates may be lower than on screen. |
| `--port N`, `--dev-port N` | The debug port (the app also takes N+1 and N+2) and the Vite port. Defaults 9420 and 1430. |
| `--out DIR` | Where the session goes. |
| `--config FILE` | Thresholds and pacing (merged over `scripts/soak/soak.config.json`). |

The app runs on a throwaway profile and temp folder inside the session folder, so it never touches the installed
app's settings, autosave or log, and two copies can run side by side on different ports.

Leave the machine awake for long runs (macOS: `caffeinate -dims npm run soak`; on a laptop keep the lid open).
On Windows, set the power plan to never sleep for the run.

### Watching a run

```sh
npm run soak:watch -- <session folder> --pid <runner pid>
```

exits 0 when the run finishes, 3 when its heartbeat stops for 10 minutes (`--stall N`), 5 when the runner died
without finishing (it rebuilds the report from the files first), and with `--on-incident`, 4 on any crash, hang or
recovery. Use it for overnight runs: a run that dies half way must not look finished.

## Results

Each run gets a folder, by default `~/.ghost-arcade/soak/<time>-seed<seed>/` (on Windows
`%USERPROFILE%\.ghost-arcade\soak\...`):

| File | What is in it |
| --- | --- |
| `report.html` | The summary: pass/fail per check and per area, charts of memory, frame rate, GPU time, errors, dropped frames and folder sizes over time, every incident, every failed action with its replay command and screenshots, top console errors. |
| `report.json` | The same, for scripts. |
| `trace.jsonl` | Every step: action, arguments, result, time, warnings. |
| `telemetry.jsonl` | A sample every 15 s: memory and CPU per process (main, editor, GPU, render core, utilities), JS heap, DOM nodes, event listeners, editor and core fps, GPU and CPU ms per frame, dropped frames, audio gap counters, GPU memory, store updates per second, temp and profile folder sizes, console error counts. Checkpoints are marked `"checkpoint": true`. |
| `console.jsonl` | Every console error and warning and uncaught exception from the editor. |
| `incidents.jsonl` | Crashes, hangs (with a stack sample on macOS), editor reloads, render core restarts, child processes that died. |
| `logs/` | The app's own output and its debug log for each launch, the runner's log, Vite's log. |
| `shots/` | The editor and the render output at every failure, at checkpoints and every 10 minutes. |
| `renders/` | The last few test renders. |

An interim report is written at every checkpoint, so a run that is killed still has one. To rebuild it from the
files: `node scripts/soak/run.mjs --report-only <session folder>`.

The exit code is 0 when every check is within its threshold, 1 when one is not, and 2 when the runner itself failed.

### What fails a run

Thresholds live in `scripts/soak/soak.config.json`:

- any crash, hang, editor crash or recovery reload, render core restart, or GPU/utility process that died;
- memory growing at checkpoints faster than the per-process limit (MB per hour; needs at least 4 checkpoints over
  half an hour), DOM nodes or event listeners growing;
- the reference scene's frame rate dropping, or its GPU time rising, between early and late checkpoints, or its frame
  rate under the minimum;
- clip audio gaps, console errors or uncaught exceptions above their rates, or an error spike;
- the temp folder growing (renders that are not cleaned up, leftover decode or audio files);
- an area's actions failing more often than its limit (render and project: any failure).

Frame rates over the whole run, dropped frames and store update rates are shown for reading; they depend on what
the random actions put on screen.

## Replaying a failure

Every failed action in the report has its command, for example:

```sh
npm run soak -- --seed 1234 --steps 87 --keep-open
```

That runs the same steps with the same arguments and stops right after step 87 with the app still open. Steps
depend on the app's state, so a replay is exact while the run had no crash before that step; after a restart it is
close but not identical. To narrow it down, add `--areas` or `--only` (the step numbers then change; the seed still
makes it repeatable).

## Before a release

1. Build the release candidate (macOS `.dmg`, Windows installer).
2. On the Mac: install nothing; run `caffeinate -dims npm run soak -- --app <the .dmg>`.
3. On a Windows PC: install the candidate (or use `win-unpacked`) and run
   `npm run soak -- --app "C:\Program Files\Ghost Arcade Pro\Ghost Arcade Pro.exe"`.
4. Both must pass. For each failure: replay it, then fix it or write down why it does not block the release.
5. Keep both `report.html` files with the release notes' working files.

## Adding actions

Actions live in `scripts/soak/lib/actions.mjs`. Each is

```js
def('area', 'area.name', weight, timeoutSeconds, async (ctx) => {
  // ctx.rng for every random choice (keeps the run replayable)
  // ctx.page(js, args) runs in the editor, with G = window.__ghostArcade and S = the soak helpers
  // ctx.click / ctx.key / ctx.monkeyClick for real input; ctx.showStep for a Show Runner step
  // ctx.assert(cond, message) fails the action, ctx.warn notes a softer problem, ctx.skip when it cannot apply
}, (state) => /* when it can run, from a snapshot of the app's state */ true);
```

Draw every random number from `ctx.rng` and nothing else, check something the user would see, and leave the app in a
state the next action can use.

## Platform notes

- Process memory and CPU come from `ps` on macOS and Linux and from PowerShell (`Win32_Process`) on Windows.
- On Windows the app is stopped with `taskkill /T`; the debug log is read from the session's sandbox (the runner
  points `LOCALAPPDATA` there for a packaged app).
- `--hidden` only does something on macOS.
- The fake phone camera (`addons.phoneCameraFake`) has weight 0. Include it with a config file holding
  `{ "actionWeights": { "addons.phoneCameraFake": 1 } }` (any action's weight can be changed the same way); it joins
  the app's LAN relay from the editor itself and needs nothing else.
