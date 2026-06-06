# Ghost Arcade Mobile — Production Build & Submission

The code is shipped — what's left are the two **external account** steps I can't do for you: Apple Developer Program ($99/yr) and Google Play Console ($25 one-time). Both are required even for a free app. Then you sign + upload + submit.

---

## iOS — TestFlight + App Store

### 1. Apple Developer Program ($99/yr)
- Sign up at https://developer.apple.com/programs/ with your Apple ID.
- Approval usually takes 24-48 hours after payment.

### 2. App Store Connect — create the app record
- https://appstoreconnect.apple.com → My Apps → +
- **Platform:** iOS
- **Name:** Ghost Arcade
- **Bundle ID:** `com.ghostarcade.mobile` (must match `capacitor.config.ts`)
- **SKU:** anything unique, e.g. `ghost-arcade-mobile-001`

### 3. Sign + archive in Xcode
```bash
npm run cap:open:ios
```
In Xcode:
1. Click the `App` project in the left sidebar → **Signing & Capabilities**
2. **Team:** select your developer team (the dropdown appears once your Apple ID is added in Xcode → Settings → Accounts)
3. **Bundle Identifier:** `com.ghostarcade.mobile`
4. Top bar: pick **Any iOS Device (arm64)** as the destination (not a sim)
5. **Product → Archive** (takes 3-5 min)
6. Once the Archives window opens → **Distribute App → App Store Connect → Upload**

### 4. TestFlight beta
- After upload finishes (~10 min processing), App Store Connect → TestFlight tab
- Add yourself as an internal tester → install via the TestFlight app on your phone

### 5. App Store review
- App Store Connect → fill in screenshots, description, privacy policy URL, age rating
- **Privacy:** Ghost Arcade Mobile uses the microphone for audio-reactive visuals. Declare this honestly in the privacy questionnaire.
- Submit for review. Apple usually responds within 24-72 hours.

### Required assets you'll need
- 1024×1024 app icon (already generated at `ios/App/App/Assets.xcassets/AppIcon.appiconset/`)
- iPhone screenshots (6.7" + 6.5" + 5.5" — at minimum the 6.7" tier)
- App description (use `PRODUCT_OVERVIEW.md` as source material — pull the mobile-relevant sections)
- Privacy policy URL (host on ghostarcade.live)

---

## Android — Play Console

### 1. Play Console account ($25 one-time)
- https://play.google.com/console → register as a developer
- Identity verification can take 24-48 hours.

### 2. Generate the signing keystore (one-time)
```bash
cd /Users/justinwood/Documents/Ghost\ Dev/ghost-arcade
keytool -genkey -v -keystore ghost-arcade-release.keystore \
  -alias ghost-arcade \
  -keyalg RSA -keysize 2048 -validity 10000
```
**Save the keystore + the passwords somewhere safe** — losing them means you can never update the app again. Add `ghost-arcade-release.keystore` to your gitignore-equivalent secret store, NOT to git.

### 3. Wire the keystore into Gradle
Create `android/keystore.properties` (already gitignored):
```properties
storeFile=../ghost-arcade-release.keystore
storePassword=YOUR_STORE_PASSWORD
keyAlias=ghost-arcade
keyPassword=YOUR_KEY_PASSWORD
```

Edit `android/app/build.gradle` and add the signing config (insert near the top of the `android { }` block):
```groovy
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
  keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

signingConfigs {
  release {
    keyAlias keystoreProperties['keyAlias']
    keyPassword keystoreProperties['keyPassword']
    storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
    storePassword keystoreProperties['storePassword']
  }
}
```

Then inside `buildTypes { release { ... } }` add:
```groovy
signingConfig signingConfigs.release
minifyEnabled true
shrinkResources true
proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
```

### 4. Build the signed bundle
```bash
cd android
./gradlew bundleRelease
```
Output: `android/app/build/outputs/bundle/release/app-release.aab` (this is what Play wants — NOT the APK).

### 5. Play Console — create the app + upload
- Play Console → All Apps → Create app
- Name: **Ghost Arcade**, default language English, free, declare it's an app (not a game)
- Internal testing track → Create new release → Upload `app-release.aab`
- Add yourself as an internal tester → install via Play link on Android

### 6. Production rollout
- After internal testing → promote to closed testing → open testing → production
- Each level has its own review (usually <24 hours)
- Required: Privacy Policy URL, target audience, content rating, store listing assets

### Required assets
- App icon 512×512 (already at `android/app/src/main/res/mipmap-*`)
- Phone screenshots (at least 2, max 8 at minimum 1080p)
- 1024×500 feature graphic
- Short + long descriptions

---

## Debug APK for ad-hoc Android install (no Play Console needed)

If you want to ship a quick build to a friend without going through the Play Store:
```bash
cd /Users/justinwood/Documents/Ghost\ Dev/ghost-arcade
npm run build:mobile
cd android && ./gradlew assembleDebug
```
APK lives at `android/app/build/outputs/apk/debug/app-debug.apk`. They have to enable "Install from unknown sources" on their phone, then sideload it via `adb install` or by emailing/Drive-sharing the APK.

iOS has no equivalent — you must use TestFlight (which needs Apple Developer Program) or Xcode-direct-install (which only works on devices registered in your developer team).

---

## Pre-submission checklist

Before hitting "Submit for review" on either store:

- [ ] Test on **at least one physical iPhone** — the simulator doesn't have real microphone input, so audio reactivity is untested on sim. Plug a phone in, deploy via `npm run cap:run:ios`, play music, confirm visuals react.
- [ ] Test on **at least one physical Android** — same reason.
- [ ] Confirm the `Capacitor.isNativePlatform()` boot branch picks the right route on a real device (sim works, but worth a real-device sanity check).
- [ ] Privacy policy hosted (microphone usage must be declared honestly).
- [ ] Test the AB crossfader, each of the 30 shaders at least briefly, the projection-mapping corner drag, Clean Output long-press, and switch-mode flow.
- [ ] Try with **mic permission denied** — confirm the app still renders (with silent uniforms) and doesn't crash.
- [ ] **Battery drain check** — leave the standalone running for ~10 min. WebGL + audio analyser is a known hotspot.
- [ ] Test on a **lower-end Android** (e.g., a 2020 device) to catch GPU surprises that don't surface on Pixel 8 / iPhone 17.

---

## Realistic timeline from here

| Step | You | Time |
|---|---|---|
| Apple Developer signup + approval | 1 hour active + 1-2 days waiting | 1-2 days |
| Play Console signup + verification | 1 hour active + 1-2 days waiting | 1-2 days |
| Generate keystore, configure signing | 30 min | — |
| Real-device testing on iPhone + Android | 1-2 hours | — |
| Screenshots + store listings | 2-3 hours | — |
| Submit to TestFlight + Play internal | 30 min | — |
| **Apple App Store review** | wait | 24-72 hours |
| **Google Play review** | wait | 24-72 hours |

Realistic shipping window from kickoff: **1-2 weeks** including review waits, mostly driven by Apple's review queue.
