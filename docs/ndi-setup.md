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

The current output pump supports **macOS only**, with both the optional native
NDI addon and the NDI runtime installed. It sends **one full composition**, not
individually cropped/warped screen outputs. If several screens request NDI, the
first screen supplies the sender name. Windows NDI composite output is not yet
implemented; installing NDI Tools alone will not enable it. Use Spout for local
app-to-app output on Windows.

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
- Windows: `C:\Program Files\NDI\NDI Advanced SDK`,
  `C:\Program Files\NDI\NDI SDK`, or `C:\Program Files\NewTek\NDI SDK`
- Linux: `/opt/NDI Advanced SDK for Linux` or `/opt/NDI SDK for Linux`

You can also set `NDI_SDK_DIR` to an SDK root before running:

```sh
cd electron/native
npm run build
```

Longer term, prefer NDI's dynamic-loading model so the app can ship a stable
native bridge without bundling the SDK/runtime. The official dynamic-loading
reference is:

https://docs.ndi.video/all/developing-with-ndi/sdk/dynamic-loading-of-ndi-libraries

## Attribution

Use the trademark attribution anywhere NDI appears in product UI, docs, or web
copy:

`NDI® is a registered trademark of Vizrt NDI AB`.
