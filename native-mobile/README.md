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

The build uses the root app version by default and generates a UTC timestamp build number. Override it when needed:

```sh
MOBILE_BUILD_NUMBER=202606220101 npm run ios:archive
```

If you only need part of the lane:

```sh
npm run ios:archive
npm run ios:export
npm run ios:validate
npm run ios:upload
```
