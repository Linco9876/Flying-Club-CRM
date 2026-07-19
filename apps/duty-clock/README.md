# BFC Duty Clock

Lightweight Expo app for Bendigo Flying Club instructors on iOS and Android. It uses the portal's Supabase authentication and duty records.

## What instructors can do

- Sign in with their existing portal account.
- Start duty with an adjustable start time (up to two hours back).
- Confirm GPS-derived location or edit the location name.
- Add mandatory context when outside a configured club geofence.
- Complete the pre-duty fitness, external-duty, sleep, and optional sleepiness declaration.
- Start and end breaks during the day.
- End duty with flight time prefilled from that day's flight logs and edit it before saving.

The app requests foreground location only when Start duty is opened. It does not request or perform background location tracking.

## Local device testing

Requirements: Node.js, npm, and the Expo Go app on the test phone.

```powershell
npm install
Copy-Item .env.example .env
npm run start
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env`. These are public client settings; never put a Supabase service-role key in the app.

Scan the Expo QR code from an iPhone or Android phone on the same network. Only users with an admin, senior instructor, or instructor role can clock duty.

## Club location setup

An administrator can manage duty-clock geofences in the web portal under **Settings -> Duty & Supervision -> Duty clock locations**. Bendigo Airport is seeded as the primary location with a 1.2 km radius; review the radius before rollout.

## Signed iOS and Android builds

The production identifiers are:

- iOS: `au.com.bendigoflyingclub.dutyclock`
- Android: `au.com.bendigoflyingclub.dutyclock`

Sign in to the club's Expo account and initialise its EAS project once:

```powershell
npx eas-cli login
npx eas-cli build:configure
```

Create internal test builds:

```powershell
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

Create store builds:

```powershell
npx eas-cli build --platform all --profile production
```

Apple requires an Apple Developer team and signing credentials. Google Play requires a Play Console developer account. EAS can manage signing credentials interactively, but those accounts must be supplied by the club account owner.

Before public store submission, add the final club-approved app icon, screenshots, support/privacy URLs, and complete Apple and Google location-data disclosures. Use `eas submit` after the store listings exist.

## Checks

```powershell
npm run typecheck
npx expo-doctor
npx expo export --platform android
npx expo export --platform ios
```
