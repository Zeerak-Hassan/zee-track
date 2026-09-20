# Logbook

A minimal offline gym tracker. Build routines, log sets and reps, track per-exercise units, and review progress over time. No accounts, no servers, no tracking. Your data lives in your browser.

## Current features

- **Offline-first PWA:** installable, fast-loading, and usable without a network connection after the first visit.
- **Routines and workouts:** create reusable routines, start a session from any routine, and resume an in-progress workout draft.
- **Per-exercise units:** track each exercise in **kg** or **plates**, with unit preferences saved per exercise.
- **Workout history:** review saved workouts, inspect completed sets, and edit or delete past sessions.
- **Exercise progress:** see per-exercise session history and best saved sets over time.
- **Session memory:** prefill exercises from the last matching workout, resume active sessions, and flag new weight PRs when a workout is saved.
- **Local-only backup:** export and import your data as JSON whenever you want a manual backup.

## Deploy to Netlify

### Easiest: drag-and-drop

1. Go to https://app.netlify.com/drop
2. Drag this entire folder into the page
3. Done. You'll get a URL like `random-name-12345.netlify.app`

### From your dashboard

1. Sign in at https://app.netlify.com
2. Click **Add new site** -> **Deploy manually**
3. Drag this folder in
4. Optional: rename the site to something memorable (Site settings -> Change site name)

### Custom subdomain (optional)

In Netlify: **Domain management** -> **Options** -> **Edit site name**. Pick something like `logbook-zeerak` and your URL becomes `logbook-zeerak.netlify.app`. Free, HTTPS automatic.

## Install on your phone

After the site is live, open the URL on your phone:

- **iOS Safari:** Share -> "Add to Home Screen"
- **Android Chrome:** Menu (...) -> "Install app" or "Add to Home Screen". You may also see an automatic install banner inside the app.

Once installed, it runs full-screen, fully offline, behaves like a native app.

## Files in this project

- `index.html` -> the app shell
- `assets/css/styles.css` -> all styling
- `assets/js/app.js` -> IndexedDB storage and UI logic
- `assets/icons/` -> app icons (180, 192, 512, maskable, and SVG)
- `sw.js` -> root service worker for offline support and caching
- `manifest.webmanifest` -> root PWA metadata
- `netlify.toml` -> Netlify headers config

## Updating the app

When you change any app shell file:

1. Bump `CACHE_VERSION` in `sw.js` (for example, `v1.2.0` -> `v1.2.1`)
2. Bump `APP_VERSION` in `assets/js/app.js` to match
3. Re-deploy to Netlify

The service worker is configured `no-cache` in `netlify.toml`, so the new version is detected on the next launch. Users see an update toast and can refresh into the new version.

If you forget to bump `CACHE_VERSION`, users can stay on stale cached assets.

## How offline works

After first load on the live site:

1. The service worker installs and caches `index.html`, `assets/css/styles.css`, `assets/js/app.js`, manifest, and icons.
2. On later launches, even without internet, the cached app shell loads instantly.
3. Your routines, workouts, and exercises live in IndexedDB.
4. The app requests persistent storage so the browser is less likely to evict local data under storage pressure.

## Backup is your responsibility

Export your data regularly via **Settings -> Export All Data**. If you uninstall the app, clear browser data, or lose the device, only the export survives.

There is no cloud backup and no sync between devices. That tradeoff keeps the app account-less and server-less.

## Known limitations

- **Single device by default:** use export/import to move data between devices.
- **No service worker on `file://`:** deploy it over HTTPS for install and offline support.
- **iOS install flow is manual:** Safari does not support the same install prompt as Chromium browsers.
