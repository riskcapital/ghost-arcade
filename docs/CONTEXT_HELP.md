# Context help and documentation

The desktop editor installs `src/lib/help/contextHelp.ts` once. Output windows do not install it. Help opens after a 650 ms hover/focus delay; F1 moves focus to the documentation link and Escape dismisses the card. Pointer operations, scrolling and window changes dismiss it. The interactive card is a non-modal dialog in the browser top layer so it also works above settings popovers. It uses the desktop external-URL bridge, not Electron's blocked `window.open` path.

There is no render-loop subscription, DOM-wide mutation observer or per-control event listener. Existing titles and accessible descriptions are restored when help closes. Author-provided text is assigned with `textContent`, never interpreted as HTML.

## Authoring

- Add `data-help-page="clip-launcher"` (or another key from `src/lib/help/topics.ts`) to a component's outer element. Shared generic controls inherit their panel's topic. If a component has separate top-level trays, annotate those too.
- Existing `title`, `aria-label`, associated labels and MIDI labels supply the control name/explanation. Add an `aria-label` for icon-only controls.
- Add `data-help="A precise explanation of this control."` to override the description, and `data-help-label="Short name"` when necessary. Known feature terms route to their specific documentation page; other controls use their panel guide and contextual guidance.
- `data-help-disabled` on a container opts its descendants out. Native disabled controls still have help explaining their authored disabled reason.
- Keep the topic catalog aligned with the website's `src/lib/docsNav.ts`. Website source is in the separate `ghostarcade-web` repository. Changing this app does not publish website content.

## Verification

- `npx vitest run src/lib/help/topics.test.ts`
- `node scripts/audit-context-help.mjs ../ghostarcade-web`
- With Vite running: `node_modules/.bin/electron scripts/context-help-smoke.cjs`. Override `GA_HELP_TEST_URL` if the server is not on port 1420. The smoke test uses an isolated Electron profile, removes its temporary public fixture, and verifies hover, focus, dismissal, literal text, disabled controls, top-layer visibility, bounds and external links.
- Run desktop checking/build and the website build after related changes.

The shared layer covers standard interactive elements and titled controls. Untitled canvas hit regions are not individual DOM controls: authors must supply a DOM help target for a distinct hit region to have distinct contextual help. Existing specialized controls without authored explanations use their panel guide; do not describe this as a hand-written glossary of every shader parameter.
