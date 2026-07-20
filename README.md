# Flying Club CRM

Vite/React frontend for the Bendigo Flying Club, hosted on Cloudflare Pages and backed by Supabase.

See the [CRM capability guide](docs/CRM_CAPABILITY_GUIDE.md) for the membership lifecycle, booking controls, instructor duty/supervision capabilities and deployment checklist.

## Edit locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Edit files under `src/`; Vite refreshes the browser as files change.

## Duty Clock mobile app

The lightweight iOS and Android instructor app lives in `apps/duty-clock/`. It uses the same Supabase login and duty records as the portal.

```powershell
npm run mobile:install
Copy-Item apps/duty-clock/.env.example apps/duty-clock/.env
npm run mobile:start
```

See `apps/duty-clock/README.md` for device testing, signed builds, and store-release requirements.

## Publish the frontend

The production Cloudflare Pages project is `bendigo-flying-club-portal`. Its custom domain is `portal.bendigoflyingclub.com.au`.

Pushing a commit to `main` triggers the existing Cloudflare Git deployment. To publish the current checkout directly instead, run:

```powershell
npm run deploy:cloudflare
```

The command builds `dist/` and deploys it to the production branch. SPA fallback routing is configured in `public/_redirects`.

## Edit Supabase

This checkout is linked locally to Supabase project `joarmzswpufrduectjse` (`Flying Club CRM`). Supabase CLI link state is machine-local and intentionally ignored by Git.

Check migration state:

```powershell
npm run supabase:status
```

Create a database change as a migration, edit the generated SQL, review it, then push it:

```powershell
supabase migration new describe_your_change
supabase db push --dry-run
npm run supabase:push
```

Edge Functions live under `supabase/functions/`. Deploy them with:

```powershell
npm run supabase:functions:deploy
```

Never place service-role, database, Stripe, Xero, or other secret keys in frontend `VITE_*` variables or commit them. Supabase Edge Function secrets belong in Supabase; CI secrets belong in GitHub repository secrets.

## Supabase Auth redirects

Keep the Supabase production Site URL set to `https://portal.bendigoflyingclub.com.au` and allow `https://portal.bendigoflyingclub.com.au/reset-password` as a redirect URL. Local development can use `VITE_AUTH_REDIRECT_ORIGIN` in an ignored `.env.local` when needed.

[Edit in StackBlitz](https://stackblitz.com/~/github.com/Linco9876/Flying-Club-CRM)
