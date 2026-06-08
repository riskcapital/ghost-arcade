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
