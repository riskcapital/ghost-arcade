# Windows A/B deck fixes

## Causes and corrections

The core rendered deck textures on Windows but reported their metadata as
unsupported. Electron also rejected Windows monitor attachment and only called
the Mac IOSurface API. The core now exports both named DXGI textures; Electron
attaches both Windows views and presents each new frame at up to 30 fps. Geometry
uses device pixels and updates when display scale changes. Detach releases each
named view, and stale requests cannot restart a detached monitor.

Windows Chromium can supply a thumbnail JPEG in a drag's file list alongside
the application's shader payload. The cell drop handler imported files first,
turning a live shader into a still image. Internal clip and shader payloads now
take priority, and thumbnail images in draggable cards disable native image
dragging. Genuine external file imports still work. This applies to both decks.
Already-created JPEG clips are unchanged: replace them with the intended shader.

## Verification

- 15 unit/contract tests passed: shader drag onto A and B with accompanying JPEG,
  serialized payload, media-tray payload, genuine external file import, Windows
  presentation updates, attach failures, detach races, Mac binding and geometry.
- Real D3D12/Media Foundation test passed: both bank textures showed at least
  four different numbered video frames, including deck B at zero program opacity.
- Isolated Electron/native presenter smoke passed: two native views attached,
  60 presentation calls succeeded, both views detached. See
  `windows-deck-presenter-2026-09-23.json`.
- Native release build passed. Desktop typecheck: zero errors, 1044 existing
  warnings. Frontend production build passed.
- Geometry source-contract checks initially failed on CRLF checkout text;
  normalizing line endings in those tests resolved the Windows-only test issue.

Local test build:
`C:\Users\justi\AppData\Local\Temp\ghost-arcade-decks-20260923\win-unpacked\Ghost-Arcade.exe`

The current user session is left running so its project can be saved before
restarting into this build. Source changes remain uncommitted.

Follow-up: deck underlay visibility and empty-deck backing
- Auxiliary Windows surfaces now occupy their own rectangles; the primary
  backdrop excludes those rectangles so it cannot cover the deck outputs.
- User confirmed deck previews work, but empty decks exposed the desktop.
- Deck attach now creates and presents an opaque backing frame before its
  rectangle is excluded from the primary backdrop. Failed initialization keeps
  the primary backdrop intact. This does not depend on a clip being loaded.
- Native addon rebuilt successfully; two-deck native smoke passed 60 presents
  and both detach operations. Initial empty-deck appearance still needs visual
  verification in the packaged app.
- Updated local package: C:\Users\justi\AppData\Local\Temp\ghost-arcade-deck-backdrop-20260923\win-unpacked\Ghost-Arcade.exe
