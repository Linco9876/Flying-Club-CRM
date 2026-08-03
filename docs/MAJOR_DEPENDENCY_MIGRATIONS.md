# Major dependency migration projects

Review date: 3 August 2026

Major framework and toolchain upgrades are not routine dependency maintenance.
They must be developed on one dedicated `codex/migrate-*` branch and one pull
request per project. No project may share lockfile changes with another major
migration, and none may be merged merely to clear an outdated-package report.

## Required evidence for every project

Each migration pull request must include:

- the full `npm run quality` result with zero ESLint warnings and zero
  TypeScript errors;
- authenticated role journeys for admin, CFI, senior instructor, instructor,
  pilot and student against the isolated recovery project;
- light and dark visual regression evidence at desktop, iPhone and Android
  viewports for login, dashboard, calendar, booking, profile, student file,
  duty, maintenance, membership/billing and settings;
- keyboard navigation, focus visibility, zoom/reflow and horizontal-overflow
  checks on the changed UI foundation;
- successful production-backup restoration into the isolated recovery project;
- a physical iPhone and Android BrowserStack acceptance run; and
- explicit reviewer sign-off that the migration contains no unrelated product
  changes.

Any changed screenshot requires a written intentional-difference note. A failed
role or visual comparison blocks the migration even when compilation succeeds.

## MIG-REACT-19

Branch: `codex/migrate-react-19`

Upgrade `react`, `react-dom`, `@types/react` and `@types/react-dom` together.
Audit Strict Mode effect behavior, context providers, portals/modals, lazy
routes, form submission, error boundaries and third-party peer compatibility.
React Router remains on its independently reviewed v7 line unless its own
migration is approved.

## MIG-TAILWIND-4

Branch: `codex/migrate-tailwind-4`

Upgrade Tailwind and its build integration without mixing React or TypeScript
majors. Inventory configuration/plugins, migrate directives and theme tokens,
then compare every required route in light/dark and responsive layouts. Pay
particular attention to modal layers, sticky save bars, tables, print/PDF styles
and PWA safe-area behavior.

## MIG-TYPESCRIPT-7

Branch: `codex/migrate-typescript-7`

Upgrade TypeScript alone first, keeping runtime packages unchanged. Record all
new diagnostics, fix them without broad casts or disabled checks, then type-check
all portal code and every Supabase Edge Function. Node and React type-package
majors stay separate unless the compiler release requires a documented pairing.

## MIG-ICONS-1 and runtime type majors

`lucide-react` 1.x, Node type majors and any other package with a major-version
change receive their own branch and pull request. Icon migration visual evidence
must cover navigation, status icons, buttons and empty states; Node type evidence
must cover build scripts, workers and GitHub Actions.

Dependabot deliberately ignores these major ranges in its routine grouped
updates. Patch/minor upgrades continue individually after their own quality and
build checks.
