# NDI® Runtime Bundling

Ghost Arcade can ship NDI® support as a self-contained desktop feature, but the
release builder must have the NDI® SDK installed so `ndi_addon.node` can be
compiled and the runtime binary can be staged.

## What Ships

- macOS: `libndi.dylib`, staged by CMake into `electron/native/build/Release/`
  and packaged by electron-builder into `Ghost Arcade.app/Contents/Frameworks/`.
- Windows: `Processing.NDI.Lib.x64.dll`, staged by CMake next to
  `ndi_addon.node` and unpacked by electron-builder with the native addon.
- Linux: `libndi.so`, staged by CMake next to `ndi_addon.node` and unpacked
  by electron-builder with the native addon.

The app should keep these binaries inside its application folders. Do not copy
NDI® runtime DLLs/dylibs into system paths.

## Build Requirements

- Install the NDI® SDK or NDI® Advanced SDK on the build machine.
- Run `cd electron/native && npm run build`.
- Confirm `electron/native/build/Release/ndi_addon.node` exists.
- Confirm the runtime binary was staged:
  - macOS: `electron/native/build/Release/libndi.dylib`
  - Windows: `electron/native/build/Release/Processing.NDI.Lib.x64.dll`
  - Linux: `electron/native/build/Release/libndi.so`
- Build installers with the normal desktop scripts.

## License / Attribution Checklist

Before public release, verify current NDI® SDK terms from the SDK folder and
official docs. At minimum, the product needs:

- NDI® link near NDI® UI controls, on the website, and in docs.
- Trademark attribution in the app About box and relevant docs:
  `NDI® is a registered trademark of Vizrt NDI AB`.
- No redistribution of NDI® tools; link users to NDI® tools instead.
- Reasonable effort to keep redistributed NDI® runtimes current.

Official docs:

- https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution
- https://docs.ndi.video/all/developing-with-ndi/sdk/licensing
