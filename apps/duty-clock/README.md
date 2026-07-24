# BFC Duty Clock PWA

Duty Clock is a lightweight Progressive Web App for Bendigo Flying Club instructors. It uses the same Supabase account and duty records as the main portal and is published at `/duty-clock/app/`.

There is no native application, APK, app-store build or separate update channel. iPhone, iPad, Android and desktop users install the secure web version from their browser and receive the current release automatically.

## What instructors can do

- Sign in with their existing portal account.
- Install Duty Clock on their home screen.
- Start duty with an adjustable start time (up to two hours back).
- Confirm a GPS-derived location or edit the location name.
- Add mandatory context when outside a configured club geofence.
- Complete the pre-duty fitness, external-duty, sleep and optional sleepiness declaration.
- Start and end breaks during the day.
- End duty with flight time prefilled from that day's flight logs.
- Use the accessible light, dark or automatic appearance.

Location is requested only when Start duty is opened. There is no background location tracking. Duty writes remain server-authoritative; the service worker never queues a clock event or claims an offline write succeeded.

## Local development

```powershell
npm install
Copy-Item .env.example .env
npm run start
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env`. These are public client settings; never put a Supabase service-role key in the PWA.

## Build and checks

```powershell
npm run typecheck
npm run build
```

The repository root `npm run build` performs the supported production export and packages the manifest, icons, service worker and install guidance with the portal. Follow [PWA_RELEASE.md](./PWA_RELEASE.md) for device acceptance checks.

## Club location setup

An administrator manages duty-clock geofences under **Settings → Duty & Supervision → Duty clock locations**. Bendigo Airport is seeded as the primary location with a 1.2 km radius; review the radius before rollout.
