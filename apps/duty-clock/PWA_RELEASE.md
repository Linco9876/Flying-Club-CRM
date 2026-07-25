# Duty Clock PWA

Duty Clock is distributed only as a Progressive Web App under `/duty-clock/app/`. There is no APK, native signing workflow or app-store release.

The root build installs the pinned dependencies, type-checks the app in CI, exports its web bundle, and includes the manifest, icons, service worker and install guidance. The service worker caches only the application shell. Live duty state and actions remain network-authoritative so an offline device can never falsely report that a clock event was accepted.

Test each release in current Safari on iOS and Chrome on Android:

1. Sign in with an instructor account.
2. Install from the in-app prompt/browser menu.
3. Start duty, start and end a break, and end duty.
4. Confirm reconnecting after an offline period refreshes server state.
5. Confirm light and dark themes meet contrast requirements.
