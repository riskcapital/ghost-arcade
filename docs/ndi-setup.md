# NDI Setup

Ghost Arcade installers do not bundle the NDI SDK or NDI runtime. NDI is an
optional integration path so release builds stay deterministic and do not get
blocked by SDK installers, redistribution terms, or stale runtime binaries.

## For Users

Install NDI from the official NDI site, then restart Ghost Arcade.

- NDI Tools install guide:
  https://docs.ndi.video/all/using-ndi/ndi-tools/installing-ndi-tools
- NDI SDK / runtime distribution notes:
  https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution

If Ghost Arcade still shows NDI as unavailable after installation, use Spout on
Windows or Syphon on macOS for bundled texture sharing. NDI support depends on
the native NDI bridge being built for the app and the NDI runtime being present
on the user machine.

## Find and configure output

Open **Settings → Output → NDI Output** to check output availability, the active
sender, and the latest startup error. Input discovery and output support are
separate capabilities; detecting an NDI source does not mean output is supported.

In Mapping, open **Screens** next to Layers, add or select a screen, choose
**Send to → sender**, then **Transport → NDI (full composition)**. Set its sender
name and select that name in your receiving app on the local network. Change
back to the local transport to stop NDI output when no other screen requests it.

The output pump supports **Windows and macOS**, with both the optional native
NDI addon and the NDI runtime installed. It sends **one full composition**, not
individually cropped/warped screen outputs. If several screens request NDI, the
first screen supplies the sender name. Installing NDI Tools alone cannot enable
output in an app build that lacks `ndi_addon.node`. Use Spout for local app-to-app
output on Windows when the NDI bridge is unavailable.

Windows reads the native composition through a pair of asynchronous D3D11
staging textures on the renderer's GPU. It does not capture the editor window.
Pending GPU copies are polled without waiting; resolution changes recreate the
capture textures. The output rate is capped at 60 fps.

## Interface size on high-resolution displays

Open **Settings → App → Appearance → Interface size**. Choose 125%, 150%, or a
larger size to increase all controls and text. This preference is saved separately
from projects and does not change projector output resolution.

## For Developers

The `ndi_addon.node` bridge is still in the source tree, but it only builds when
the NDI SDK is already installed on the build machine. CI intentionally does not
download or install NDI.

Expected SDK locations:

- macOS: `/Library/NDI Advanced SDK for Apple` or `/Library/NDI SDK for Apple`
- Windows: `C:\Program Files\NDI\NDI 6 SDK`, `C:\Program Files\NDI\NDI 5 SDK`,
  `C:\Program Files\NDI\NDI Advanced SDK`,
  `C:\Program Files\NDI\NDI SDK`, or `C:\Program Files\NewTek\NDI SDK`
- Linux: `/opt/NDI Advanced SDK for Linux` or `/opt/NDI SDK for Linux`

You can also set `NDI_SDK_DIR` to an SDK root before running:

```sh
cd electron/native
npm run build
```

On Windows, the loader also checks the installed runtime directories advertised
by `NDI_RUNTIME_DIR_V6` (and other versioned `NDI_RUNTIME_DIR_V…` variables).
After installing a runtime, restart the app from a fresh shell so it inherits
the installer's environment. Developer builds stage the SDK runtime beside the
addon; public packages continue to exclude that DLL.

To validate Windows output, build the native core and addons, run
`npx vitest run src/lib/renderer/ndiOutputPump.test.ts src/lib/renderer/nativeDxgiReadback.runtime.native.test.ts`,
then verify sender discovery and video in an NDI receiver on another machine.
The GPU readback test checks BGRA byte order, row padding, resize and recovery;
it does not replace the SDK/network test.

Longer term, prefer NDI's dynamic-loading model so the app can ship a stable
native bridge without bundling the SDK/runtime. The official dynamic-loading
reference is:

https://docs.ndi.video/all/developing-with-ndi/sdk/dynamic-loading-of-ndi-libraries

## Attribution

Use the trademark attribution anywhere NDI appears in product UI, docs, or web
copy:

`NDI® is a registered trademark of Vizrt NDI AB`.
