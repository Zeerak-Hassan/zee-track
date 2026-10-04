# Logbook Android — 1.4.1

Offline Android package of the mobile design update. Requires Android 7.0 (API 24) or later and a functioning Android System WebView.

All HTML, CSS, JavaScript and icons are compiled into the APK. WebViewAssetLoader provides a stable local HTTPS origin for IndexedDB. There is no INTERNET permission, remote server URL, account, advertising SDK, or runtime download. The app retains workouts and drafts in its own local storage. Android's document picker exports/imports JSON backups without broad storage permission.

The branch workflow builds unsigned release APKs and runs an Android 15 emulator test with Wi-Fi/mobile data disabled. The test creates and saves a workout, rejects a malformed backup without losing records, checks unit-aware prefill, opens history details, destroys/relaunches the Activity, restores a draft, and verifies persisted history and no horizontal overflow.

Release signing happens locally. The private signing key is never committed to the repository or uploaded in build artifacts. Keep that key to sign updates; changing it prevents an in-place update. Uninstalling the application removes its local records. Browser/PWA storage is separate; export/import existing website records to migrate them.

Use Gradle 8.9, JDK 17 and Android SDK 35 to build without Android Studio:

```sh
gradle assembleRelease assembleDebugAndroidTest lintRelease
```

The application ID is `app.zeerak.logbook`. Target SDK is 35. Preserve the ID, storage origin and release signing key across updates.

Open Sans is bundled locally under the SIL Open Font License; headings, controls, labels, and numbers use the same font without an online font service.
