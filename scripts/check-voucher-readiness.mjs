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
  'supabase/migrations/20260610152000_add_trial_flight_vouchers.sql',
  'supabase/migrations/20260610165000_schedule_trial_voucher_email_delivery.sql',
  'supabase/migrations/20260610170500_secure_trial_voucher_email_cron.sql',
  'supabase/migrations/20260610171500_add_trial_voucher_payment_tracking.sql',
  'supabase/migrations/20260610172500_add_trial_voucher_stripe_events.sql',
  'supabase/migrations/20260610195000_restrict_trial_voucher_accounts.sql',
  'supabase/migrations/20260610195500_restrict_trial_voucher_helper_execution.sql',
  'supabase/migrations/20260610213000_create_trial_voucher_cron_vault_secret.sql',
  'supabase/migrations/20260610213316_add_unique_active_trial_voucher_booking.sql',
  'supabase/migrations/20260610214500_add_trial_voucher_cron_auth_hash.sql',
  'supabase/migrations/20260611051636_restrict_trial_voucher_crm_data_access.sql',
  'supabase/migrations/20260611052241_restrict_trial_voucher_reference_data_access.sql',
  'supabase/migrations/20260611052925_activate_archer_trial_voucher_product_when_ready.sql',
  'supabase/migrations/20260611053259_add_atomic_trial_voucher_booking_function.sql',
  'supabase/migrations/20260611053619_enforce_trial_voucher_booking_overlap_guard.sql',
  'supabase/migrations/20260611062058_restrict_trial_voucher_matrix_assessments.sql',
  'supabase/migrations/20260611063226_add_trial_voucher_email_delivery_claim.sql',
  'supabase/migrations/20260611065359_enforce_trial_voucher_product_eligibility.sql',
  'supabase/migrations/20260611171811_enforce_trial_voucher_roster_windows.sql',
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
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
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

const voucherBaseMigration = readRequiredFile('supabase/migrations/20260610152000_add_trial_flight_vouchers.sql');
const restrictedAccountMigration = readRequiredFile('supabase/migrations/20260610195000_restrict_trial_voucher_accounts.sql');
const hardeningMigration = readRequiredFile('supabase/migrations/20260611051636_restrict_trial_voucher_crm_data_access.sql');
const referenceHardeningMigration = readRequiredFile('supabase/migrations/20260611052241_restrict_trial_voucher_reference_data_access.sql');
const matrixHardeningMigration = readRequiredFile('supabase/migrations/20260611062058_restrict_trial_voucher_matrix_assessments.sql');
const overlapTriggerMigration = readRequiredFile('supabase/migrations/20260611053619_enforce_trial_voucher_booking_overlap_guard.sql');
const bookingEligibilityMigration = readRequiredFile('supabase/migrations/20260611171811_enforce_trial_voucher_roster_windows.sql');

addCheck(
  'Voucher product and voucher tables have RLS enabled',
  voucherBaseMigration.includes('ALTER TABLE public.trial_flight_voucher_products ENABLE ROW LEVEL SECURITY') &&
    voucherBaseMigration.includes('ALTER TABLE public.trial_flight_vouchers ENABLE ROW LEVEL SECURITY'),
);
addCheck(
  'Voucher accounts have a restricted portal access scope',
  voucherBaseMigration.includes("CHECK (portal_access_scope IN ('full', 'trial_voucher'))") &&
    restrictedAccountMigration.includes("COALESCE(portal_access_scope, 'full') <> 'trial_voucher'"),
);
addCheck(
  'Voucher holders can only read their own redeemed voucher row',
  voucherBaseMigration.includes('Redeemed voucher holders can read own voucher') &&
    voucherBaseMigration.includes('redeemed_by_user_id = auth.uid()'),
);
addCheck(
  'Normal CRM data policies exclude trial voucher accounts',
  hardeningMigration.includes('current_user_has_full_portal_access') &&
    hardeningMigration.includes("COALESCE(portal_access_scope, 'full') <> 'trial_voucher'") &&
    hardeningMigration.includes('Full students instructors and staff can read relevant training records') &&
    hardeningMigration.includes('Full users and staff can read relevant flight logs'),
);
addCheck(
  'Reference data policies exclude trial voucher accounts',
  referenceHardeningMigration.includes('Full portal users can read training courses') &&
    referenceHardeningMigration.includes('Full portal users can read syllabus matrix rows') &&
    referenceHardeningMigration.includes('public.current_user_has_full_portal_access()'),
);
addCheck(
  'Syllabus matrix assessment data excludes trial voucher accounts',
  matrixHardeningMigration.includes('Full students and staff can read matrix assessments') &&
    matrixHardeningMigration.includes('public.current_user_has_full_portal_access()'),
);
addCheck(
  'Voucher bookings have a database overlap trigger installed',
  overlapTriggerMigration.includes('CREATE TRIGGER prevent_trial_voucher_booking_overlap') &&
    overlapTriggerMigration.includes('BEFORE INSERT OR UPDATE') &&
    overlapTriggerMigration.includes('EXECUTE FUNCTION public.prevent_trial_voucher_booking_overlap()'),
);
addCheck(
  'Voucher booking RPC enforces duration plus 30 minutes and roster availability',
  bookingEligibilityMigration.includes('CREATE OR REPLACE FUNCTION public.trial_voucher_instructor_available_for_slot') &&
    bookingEligibilityMigration.includes('CREATE OR REPLACE FUNCTION public.book_trial_flight_voucher_slot') &&
    bookingEligibilityMigration.includes("v_product.duration_minutes + 30") &&
    bookingEligibilityMigration.includes('public.trial_voucher_instructor_available_for_slot'),
);
addCheck(
  'Voucher booking RPC enforces aircraft/instructor eligibility and endorsement checks',
  bookingEligibilityMigration.includes("v_product.aircraft_mode = 'tecnam'") &&
    bookingEligibilityMigration.includes("v_product.aircraft_mode = 'archer'") &&
    bookingEligibilityMigration.includes('v_product.instructor_ids') &&
    bookingEligibilityMigration.includes('required_endorsement_type') &&
    bookingEligibilityMigration.includes('Selected instructor does not hold the required aircraft endorsement'),
);
addCheck(
  'Voucher booking functions are service-role only',
  bookingEligibilityMigration.includes('REVOKE ALL ON FUNCTION public.trial_voucher_instructor_available_for_slot(uuid, timestamptz, timestamptz) FROM authenticated') &&
    bookingEligibilityMigration.includes('REVOKE ALL ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) FROM authenticated') &&
    bookingEligibilityMigration.includes('GRANT EXECUTE ON FUNCTION public.book_trial_flight_voucher_slot(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) TO service_role') &&
    bookingEligibilityMigration.includes('REVOKE ALL ON FUNCTION public.prevent_trial_voucher_booking_overlap() FROM authenticated'),
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
