# Flying-Club-CRM

[Edit in StackBlitz](https://stackblitz.com/~/github.com/Linco9876/Flying-Club-CRM)

## Production Deployment

This app is a Vite React static site backed by Supabase. It is ready to deploy on Netlify or Vercel.

### Netlify

- Build command: `npm run build`
- Publish directory: `dist`
- SPA redirects are configured in `netlify.toml` and `public/_redirects`.

### Vercel

- Build command: `npm run build`
- Output directory: `dist`
- SPA rewrites are configured in `vercel.json`.

### Supabase Auth Redirects

After the live URL is created, add these URLs in Supabase Auth settings:

- Site URL: your production domain, for example `https://your-site.netlify.app`
- Redirect URL: `https://your-site.netlify.app/reset-password`

Do not set `VITE_AUTH_REDIRECT_ORIGIN` in production unless you want reset emails to force a specific domain. Local development can keep it in `.env.local`.
