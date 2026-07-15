import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const requiredFiles = [
  '.github/workflows/deploy-supabase-voucher-functions.yml',
  '.github/workflows/deploy-supabase-migrations.yml',
  '.github/workflows/send-due-trial-voucher-emails.yml',
  'scripts/smoke-voucher-live.mjs',
  'supabase/functions/_shared/trialVoucherReadiness.ts',
  'supabase/functions/_shared/trialVoucherReadiness.test.ts',
  'supabase/functions/trial-voucher-public/index.ts',
  'supabase/functions/trial-voucher-admin/index.ts',
  'supabase/functions/create-trial-voucher-checkout/index.ts',
  'supabase/functions/send-trial-voucher-email/index.ts',
  'supabase/functions/trial-voucher-stripe-webhook/index.ts',
  'supabase/functions/xero-sync/index.ts',
  'supabase/functions/_shared/stripeMode.test.ts',
  'supabase/migrations/20260714024330_remote_schema_baseline.sql',
  'supabase/migrations/20260714223822_add_mode_specific_voucher_stripe_prices.sql',
  'supabase/migrations/20260715105356_fix_voucher_xero_sale_accounting.sql',
];

const supabaseFunctionSecrets = [
  'PUBLIC_SITE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'BREVO_API_KEY',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
  'TRIAL_VOUCHER_INTERNAL_SECRET',
  'TRIAL_VOUCHER_CRON_SECRET',
  'STRIPE_TEST_SECRET_KEY',
  'STRIPE_LIVE_SECRET_KEY',
  'STRIPE_TEST_PUBLISHABLE_KEY',
  'STRIPE_LIVE_PUBLISHABLE_KEY',
  'STRIPE_TEST_WEBHOOK_SECRET',
  'STRIPE_LIVE_WEBHOOK_SECRET',
];

const githubSecrets = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_URL',
  'SUPABASE_URL',
  'TRIAL_VOUCHER_CRON_SECRET',
];

const workflowExpectations = [
  {
    file: '.github/workflows/deploy-supabase-voucher-functions.yml',
    contains: [
      'supabase/functions/_shared/**',
      'deno check --node-modules-dir=false supabase/functions/trial-voucher-public/index.ts',
      'deno test --node-modules-dir=false supabase/functions/_shared/trialVoucherReadiness.test.ts',
      'deno test --node-modules-dir=false supabase/functions/_shared/stripeMode.test.ts',
      'trial-voucher-stripe-webhook',
      '--no-verify-jwt',
    ],
  },
  {
    file: '.github/workflows/send-due-trial-voucher-emails.yml',
    contains: [
      '*/10 * * * *',
      'x-cron-secret',
      'send-due',
    ],
  },
];

const checks = [];

const addCheck = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

for (const file of requiredFiles) {
  addCheck(`File exists: ${file}`, existsSync(join(root, file)));
}

for (const expectation of workflowExpectations) {
  const path = join(root, expectation.file);
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const needle of expectation.contains) {
    addCheck(`${expectation.file} contains ${needle}`, content.includes(needle));
  }
}

const publicFunctionPath = join(root, 'supabase/functions/trial-voucher-public/index.ts');
const publicFunction = existsSync(publicFunctionPath) ? readFileSync(publicFunctionPath, 'utf8') : '';
const appPath = join(root, 'src/App.tsx');
const app = existsSync(appPath) ? readFileSync(appPath, 'utf8') : '';
const resetPasswordPath = join(root, 'src/components/Auth/ResetPasswordPage.tsx');
const resetPassword = existsSync(resetPasswordPath) ? readFileSync(resetPasswordPath, 'utf8') : '';
const adminFunctionPath = join(root, 'supabase/functions/trial-voucher-admin/index.ts');
const adminFunction = existsSync(adminFunctionPath) ? readFileSync(adminFunctionPath, 'utf8') : '';
const adminVoucherPagePath = join(root, 'src/components/Vouchers/TrialFlightVouchersPage.tsx');
const adminVoucherPage = existsSync(adminVoucherPagePath) ? readFileSync(adminVoucherPagePath, 'utf8') : '';
addCheck(
  'Public voucher function restricts normal portal users from voucher account-only actions',
  publicFunction.includes('portal_access_scope') && publicFunction.includes('trial_voucher'),
);
addCheck(
  'Voucher availability uses voucher duration plus 30 minutes',
  publicFunction.includes('Number(product.duration_minutes || 0) + 30'),
);
addCheck(
  'Voucher booking uses atomic database booking creation',
  publicFunction.includes('book_trial_flight_voucher_slot'),
);
addCheck(
  'Trial voucher accounts are redirected away from normal CRM routes',
  app.includes("user?.portalAccessScope === 'trial_voucher'") &&
    app.includes("normalisedPathname !== '/trial-flight-voucher'") &&
    app.includes('Navigate to={`/trial-flight-voucher${location.search || \'\'}'),
);
addCheck(
  'Trial voucher accounts cannot browse the public sales page while signed in',
  app.includes("normalisedPathname === '/trial-flight-gift-vouchers'") &&
    app.includes("user?.portalAccessScope === 'trial_voucher'") &&
    app.includes('return <Navigate to="/trial-flight-voucher" replace />'),
);
addCheck(
  'Voucher password setup returns to the voucher booking page',
  resetPassword.includes("originalPathname === '/trial-flight-voucher'") &&
    resetPassword.includes('PASSWORD_RESET_RETURN_KEY') &&
    resetPassword.includes("profile?.portal_access_scope === 'trial_voucher'") &&
    resetPassword.includes("storedReturnTo?.startsWith('/trial-flight-voucher')"),
);
addCheck(
  'Admin voucher tools validate Stripe Price IDs without exposing the Stripe secret',
  adminFunction.includes('validate-stripe-price') &&
    adminFunction.includes('getActiveStripeMode') &&
    adminFunction.includes('https://api.stripe.com/v1/prices/') &&
    adminFunction.includes('Stripe price belongs to'),
);
addCheck(
  'Admin voucher tools can create and link Stripe Price IDs server-side',
  adminFunction.includes('create-stripe-price') &&
    adminFunction.includes('https://api.stripe.com/v1/products') &&
    adminFunction.includes('https://api.stripe.com/v1/prices') &&
    adminFunction.includes('[stripePriceColumn]: stripePrice.id') &&
    adminFunction.includes('stripe_test_price_id') &&
    adminFunction.includes('stripe_live_price_id') &&
    adminVoucherPage.includes('Create checkout price') &&
    adminVoucherPage.includes('create-stripe-price'),
);

const readinessHelperPath = join(root, 'supabase/functions/_shared/trialVoucherReadiness.ts');
const readinessHelper = existsSync(readinessHelperPath) ? readFileSync(readinessHelperPath, 'utf8') : '';
addCheck(
  'Shared readiness helper checks aircraft mode and instructor endorsements',
  readinessHelper.includes('aircraftMatchesTrialVoucherProduct') &&
    readinessHelper.includes('instructorHasTrialVoucherAircraftEndorsement'),
);

const readRequiredFile = (file) => {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const schemaBaseline = readRequiredFile('supabase/migrations/20260714024330_remote_schema_baseline.sql');
const stripePriceMigration = readRequiredFile('supabase/migrations/20260714223822_add_mode_specific_voucher_stripe_prices.sql');
const voucherXeroMigration = readRequiredFile('supabase/migrations/20260715105356_fix_voucher_xero_sale_accounting.sql');
const xeroSyncFunction = readRequiredFile('supabase/functions/xero-sync/index.ts');

addCheck(
  'Voucher product and voucher tables have RLS enabled',
  schemaBaseline.includes('ALTER TABLE "public"."trial_flight_voucher_products" ENABLE ROW LEVEL SECURITY') &&
    schemaBaseline.includes('ALTER TABLE "public"."trial_flight_vouchers" ENABLE ROW LEVEL SECURITY'),
);
addCheck(
  'Voucher accounts have a restricted portal access scope',
  schemaBaseline.includes("'trial_voucher'::\"text\"") &&
    schemaBaseline.includes("COALESCE(portal_access_scope, 'full') = 'trial_voucher'"),
);
addCheck(
  'Voucher holders can only read their own redeemed voucher row',
  schemaBaseline.includes('CREATE POLICY "Redeemed voucher holders can read own voucher"') &&
    schemaBaseline.includes('"redeemed_by_user_id" = "auth"."uid"()'),
);
addCheck(
  'Normal CRM data policies exclude trial voucher accounts',
  schemaBaseline.includes('current_user_has_full_portal_access') &&
    schemaBaseline.includes("COALESCE(portal_access_scope, 'full') = 'full'") &&
    schemaBaseline.includes('Full students instructors and staff can read relevant training') &&
    schemaBaseline.includes('Full users and staff can read relevant flight logs'),
);
addCheck(
  'Reference data policies exclude trial voucher accounts',
  schemaBaseline.includes('Full portal users can read training courses') &&
    schemaBaseline.includes('Full portal users can read syllabus matrix rows') &&
    schemaBaseline.includes('current_user_has_full_portal_access'),
);
addCheck(
  'Syllabus matrix assessment data excludes trial voucher accounts',
  schemaBaseline.includes('Full students and staff can read matrix assessments') &&
    schemaBaseline.includes('current_user_has_full_portal_access'),
);
addCheck(
  'Voucher bookings have a database overlap trigger installed',
  schemaBaseline.includes('CREATE OR REPLACE TRIGGER "prevent_trial_voucher_booking_overlap" BEFORE INSERT OR UPDATE') &&
    schemaBaseline.includes('EXECUTE FUNCTION "public"."prevent_trial_voucher_booking_overlap"()'),
);
addCheck(
  'Voucher booking RPC enforces duration plus 30 minutes and roster availability',
  schemaBaseline.includes('CREATE OR REPLACE FUNCTION "public"."trial_voucher_instructor_available_for_slot"') &&
    schemaBaseline.includes('CREATE OR REPLACE FUNCTION "public"."book_trial_flight_voucher_slot"') &&
    schemaBaseline.includes('v_product.duration_minutes + 30') &&
    schemaBaseline.includes('public.trial_voucher_instructor_available_for_slot'),
);
addCheck(
  'Voucher booking RPC enforces aircraft/instructor eligibility and endorsement checks',
  schemaBaseline.includes('v_product.aircraft_ids') &&
    schemaBaseline.includes('v_product.instructor_ids') &&
    schemaBaseline.includes('required_endorsement_type') &&
    schemaBaseline.includes('Selected instructor does not hold the required aircraft endorsement'),
);
addCheck(
  'Voucher booking functions are service-role only',
  schemaBaseline.includes('REVOKE ALL ON FUNCTION "public"."book_trial_flight_voucher_slot"') &&
    schemaBaseline.includes('GRANT ALL ON FUNCTION "public"."book_trial_flight_voucher_slot"') &&
    schemaBaseline.includes('TO "service_role"') &&
    schemaBaseline.includes('REVOKE ALL ON FUNCTION "public"."prevent_trial_voucher_booking_overlap"() FROM PUBLIC'),
);
addCheck(
  'Test and live Stripe voucher prices are stored separately',
  stripePriceMigration.includes('stripe_test_price_id') &&
    stripePriceMigration.includes('stripe_live_price_id') &&
    adminFunction.includes('stripePriceIdForMode'),
);
addCheck(
  'Stripe voucher sales use a Xero receive transaction into voucher liability',
  xeroSyncFunction.includes('createVoucherSaleReceipt') &&
    xeroSyncFunction.includes('path: "BankTransactions"') &&
    xeroSyncFunction.includes('Type: "RECEIVE"') &&
    xeroSyncFunction.includes('xero_sale_bank_transaction_id') &&
    xeroSyncFunction.includes('voucher-liability'),
);
addCheck(
  'Voucher purchaser contacts are linked without exposing Xero credentials',
  xeroSyncFunction.includes('syncVoucherPurchaserContact') &&
    xeroSyncFunction.includes('xero_purchaser_contact_id') &&
    xeroSyncFunction.includes('voucher-contact-${clean(voucher?.id)}'),
);
addCheck(
  'Voucher Xero mutations use idempotency keys',
  xeroSyncFunction.includes('Idempotency-Key') &&
    xeroSyncFunction.includes('voucher-sale-${voucherId}') &&
    xeroSyncFunction.includes('voucher-sale-${voucher.id}') &&
    xeroSyncFunction.includes('voucher-redemption-${voucher.id}'),
);
addCheck(
  'Voucher Xero receipt and purchaser contact IDs are persisted',
  voucherXeroMigration.includes('xero_sale_bank_transaction_id') &&
    voucherXeroMigration.includes('xero_purchaser_contact_id'),
);

const missingLocalFunctionSecrets = supabaseFunctionSecrets.filter((name) => !process.env[name]);
const missingLocalGithubSecrets = githubSecrets.filter((name) => !process.env[name]);

const failures = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.label}${check.detail ? ` - ${check.detail}` : ''}`);
}

console.log('');
console.log('Live Supabase Edge Function secrets required:');
for (const name of supabaseFunctionSecrets) {
  console.log(`- ${name}${process.env[name] ? ' (present locally)' : ''}`);
}

console.log('');
console.log('GitHub Actions secrets required:');
for (const name of githubSecrets) {
  console.log(`- ${name}${process.env[name] ? ' (present locally)' : ''}`);
}

if (missingLocalFunctionSecrets.length || missingLocalGithubSecrets.length) {
  console.log('');
  console.log('Note: missing local environment variables do not fail this check.');
  console.log('They must exist in Supabase Edge Function secrets and GitHub repository secrets before live voucher sales are enabled.');
}

if (failures.length > 0) {
  console.error('');
  console.error(`Voucher readiness repo check failed: ${failures.length} issue${failures.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}

console.log('');
console.log('Voucher readiness repo check passed.');
