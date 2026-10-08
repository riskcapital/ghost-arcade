# Ghost Arcade Native Mobile

This folder owns the iOS and Android Capacitor app. It intentionally stays out of the desktop installer path.

The desktop mobile companion screens remain in the main app through `src/lib/components/MobileApp.svelte` and the `#/mobile` route. The native app uses `src/native-mobile-main.ts`, `native-mobile.html`, and `vite.config.native-mobile.ts` to load either the standalone mobile VJ surface or the remote desktop companion.

From the repo root:

```sh
npm run build:native-mobile
cd native-mobile
npm install
npm run cap:sync
```

For day-to-day native work:

```sh
npm run dev
npm run sync
npm run open:ios
npm run open:android
```

## iOS TestFlight

The iOS wrapper can be archived, exported, validated, and uploaded from the command line. The lane uses Xcode automatic signing and App Store Connect API keys, so do not commit certificates, `.p8` files, or exported IPAs.

One-time Apple setup:

- Add the Apple Developer account in Xcode.
- Make sure the bundle identifier `com.ghostarcade.mobile` exists in Certificates, Identifiers & Profiles and has an App Store Connect app record.
- Create an App Store Connect API key and keep the `.p8` outside this repo.

Useful checks:

```sh
npm run ios:testflight:doctor
```

Archive, export, validate, and upload:

```sh
APPLE_TEAM_ID=YOURTEAMID \
APP_STORE_CONNECT_KEY_ID=ABC123DEFG \
APP_STORE_CONNECT_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
APP_STORE_CONNECT_API_KEY_PATH=/secure/path/AuthKey_ABC123DEFG.p8 \
npm run ios:testflight
```

The version and build number come from the Xcode project (`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` on the App target), never from the desktop `package.json`. The lane stops if either is missing or differs between Debug and Release. Check what will be built:

```sh
node scripts/ios-testflight.mjs version   # prints e.g. 1.1 (5)
```

Raise the build number in Xcode for every upload. To override for one run only:

```sh
MOBILE_BUILD_NUMBER=6 npm run ios:archive
MOBILE_MARKETING_VERSION=1.1.1 MOBILE_BUILD_NUMBER=7 npm run ios:archive
```

If you only need part of the lane:

```sh
npm run ios:archive
npm run ios:export
npm run ios:validate
npm run ios:upload
```

## iOS native bridge (StudioCapture)

The web layer talks to the iOS shell through `Capacitor.nativePromise('StudioCapture', method, args)`. Every call resolves or rejects; none waits forever. Added in 1.1:

| Call | Result | Notes |
| --- | --- | --- |
| `shareFile({ filename, base64, mimeType, anchor? })` | `{ completed: boolean }` | Writes the bytes to a temporary file with that name, shows the share sheet, removes the file afterwards. `completed` is false when the user cancels. `anchor` is optional: `{ x, y, width, height }` of the button in viewport CSS pixels (`getBoundingClientRect()`), used to point the iPad popover at it. Rejects when another native screen is open, the name or data is empty, or the data is over 250 MB. `base64` may be a `data:` URL. |
| `haptic({ type })` | `{}` | `type` is `light`, `medium`, `heavy`, `selection`, `success`, `warning` or `error`. Silent on iPad. Rejects on any other type. |
| `openAppSettings()` | `{}` | Opens this app's page in iOS Settings (camera, microphone, local network switches). The web layer shows an Open Settings button next to a "refused" message only when this method is listed in `Capacitor.PluginHeaders`. Rejects when Settings cannot be opened. |
| `takePairingLink()` | `{ url: string }` | Unchanged call. Returns a tapped `ghostarcade://pair?...` link once, then `''`. Works for links that launch the app and links that arrive while it runs. |

Window events from native:

- `ghost-pairing-link`: a pairing link has arrived. It carries no data; call `takePairingLink()` to collect it. Polling still works, the event only removes the need for it.
- `ghost-external-display`: unchanged.

Behaviour the web layer can rely on:

- The screen stays awake while the app is active. The web wake lock is no longer needed on iOS.
- Camera frames from `ghostcapture://live/<source>` follow the interface orientation. Frame flags keep their meaning (4 = rotate colour for portrait, 8 = depth frame is landscape).
- Dual-camera stills returned by `openDualCamera` are temporary. Copy them straight away, as `importCameraShots` does; they are deleted two minutes after the session ends.
- Share sheets never offer Save to Photos, because the app has no photo library permission.
- Not handled yet: opening a `.ghostset` from the Files app. The file types are declared but the app is not offered as an opener (`LSHandlerRank` None in `Info.plist`). To add it, pass the opened file to the web layer and change the rank to `Owner`.
