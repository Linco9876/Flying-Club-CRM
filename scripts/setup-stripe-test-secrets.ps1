param(
  [string]$ProjectRef = "joarmzswpufrduectjse",
  [string]$EnvPath = ".\stripe-secrets.env",
  [string]$WebhookUrl = "https://joarmzswpufrduectjse.supabase.co/functions/v1/trial-voucher-stripe-webhook"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv($Path) {
  $result = @{}
  if (-not (Test-Path $Path)) {
    throw "Missing $Path. Copy stripe-secrets.env.example to stripe-secrets.env first."
  }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $name, $value = $trimmed.Split("=", 2)
    $result[$name.Trim()] = $value.Trim()
  }
  return $result
}

function Get-EnvValue($Values, [string]$Name) {
  if ($Values.ContainsKey($Name)) { return [string]$Values[$Name] }
  return ""
}

function Test-Placeholder([string]$Value) {
  return -not $Value -or $Value -like "*replace_me*"
}

function Write-DotEnv($Path, $Values) {
  $lines = @(
    "# Stripe secrets for Supabase Edge Functions.",
    "# This file is ignored by git. Do not commit real keys.",
    "",
    "STRIPE_TEST_SECRET_KEY=$(Get-EnvValue $Values 'STRIPE_TEST_SECRET_KEY')",
    "STRIPE_TEST_PUBLISHABLE_KEY=$(Get-EnvValue $Values 'STRIPE_TEST_PUBLISHABLE_KEY')",
    "STRIPE_TEST_WEBHOOK_SECRET=$(Get-EnvValue $Values 'STRIPE_TEST_WEBHOOK_SECRET')",
    "",
    "STRIPE_LIVE_SECRET_KEY=$(Get-EnvValue $Values 'STRIPE_LIVE_SECRET_KEY')",
    "STRIPE_LIVE_PUBLISHABLE_KEY=$(Get-EnvValue $Values 'STRIPE_LIVE_PUBLISHABLE_KEY')",
    "STRIPE_LIVE_WEBHOOK_SECRET=$(Get-EnvValue $Values 'STRIPE_LIVE_WEBHOOK_SECRET')"
  )
  Set-Content -Path $Path -Value $lines -Encoding UTF8
}

$envValues = Read-DotEnv $EnvPath

if ((Test-Placeholder (Get-EnvValue $envValues "STRIPE_TEST_SECRET_KEY")) -or -not (Get-EnvValue $envValues "STRIPE_TEST_SECRET_KEY").StartsWith("sk_test_")) {
  throw "STRIPE_TEST_SECRET_KEY must be filled with a Stripe sandbox secret key starting with sk_test_."
}

if ((Test-Placeholder (Get-EnvValue $envValues "STRIPE_TEST_PUBLISHABLE_KEY")) -or -not (Get-EnvValue $envValues "STRIPE_TEST_PUBLISHABLE_KEY").StartsWith("pk_test_")) {
  throw "STRIPE_TEST_PUBLISHABLE_KEY must be filled with a Stripe sandbox publishable key starting with pk_test_."
}

function Ensure-StripeWebhookSecret($Mode, $SecretName, $WebhookName, $ExpectedPrefix) {
  $secretKey = Get-EnvValue $envValues $SecretName
  $webhookSecret = Get-EnvValue $envValues $WebhookName
  if (Test-Placeholder $secretKey) { return }
  if (-not $secretKey.StartsWith($ExpectedPrefix)) {
    throw "$SecretName must start with $ExpectedPrefix."
  }
  if (-not (Test-Placeholder $webhookSecret)) { return }

  Write-Host "Creating Stripe $Mode webhook endpoint..."
  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${secretKey}:"))
  $description = if ($Mode -eq "live") { "Bendigo Flying Club CRM live webhook" } else { "Bendigo Flying Club CRM test webhook" }
  $formPairs = @(
    "url=$([Uri]::EscapeDataString($WebhookUrl))",
    "enabled_events%5B%5D=checkout.session.completed",
    "enabled_events%5B%5D=payment_intent.succeeded",
    "enabled_events%5B%5D=payment_intent.payment_failed",
    "description=$([Uri]::EscapeDataString($description))"
  )
  $body = $formPairs -join "&"
  $response = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.stripe.com/v1/webhook_endpoints" `
    -Headers @{ Authorization = "Basic $basic" } `
    -ContentType "application/x-www-form-urlencoded" `
    -Body $body

  if (-not $response.secret -or -not $response.secret.StartsWith("whsec_")) {
    throw "Stripe webhook endpoint was created but no signing secret was returned."
  }
  $envValues[$WebhookName] = $response.secret
  Write-DotEnv $EnvPath $envValues
  Write-Host "Stripe $Mode webhook endpoint created and signing secret saved locally."
}

Ensure-StripeWebhookSecret "test" "STRIPE_TEST_SECRET_KEY" "STRIPE_TEST_WEBHOOK_SECRET" "sk_test_"

if (-not (Test-Placeholder (Get-EnvValue $envValues "STRIPE_LIVE_SECRET_KEY")) -or -not (Test-Placeholder (Get-EnvValue $envValues "STRIPE_LIVE_PUBLISHABLE_KEY"))) {
  if ((Test-Placeholder (Get-EnvValue $envValues "STRIPE_LIVE_SECRET_KEY")) -or -not (Get-EnvValue $envValues "STRIPE_LIVE_SECRET_KEY").StartsWith("sk_live_")) {
    throw "STRIPE_LIVE_SECRET_KEY must start with sk_live_ if live Stripe secrets are being configured."
  }
  if ((Test-Placeholder (Get-EnvValue $envValues "STRIPE_LIVE_PUBLISHABLE_KEY")) -or -not (Get-EnvValue $envValues "STRIPE_LIVE_PUBLISHABLE_KEY").StartsWith("pk_live_")) {
    throw "STRIPE_LIVE_PUBLISHABLE_KEY must start with pk_live_ if live Stripe secrets are being configured."
  }
  Ensure-StripeWebhookSecret "live" "STRIPE_LIVE_SECRET_KEY" "STRIPE_LIVE_WEBHOOK_SECRET" "sk_live_"
}

$supabaseEnvPath = Join-Path ([IO.Path]::GetTempPath()) "bfc-stripe-supabase-secrets.env"
$secretLines = @()
foreach ($name in @(
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_TEST_PUBLISHABLE_KEY",
  "STRIPE_TEST_WEBHOOK_SECRET",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_LIVE_PUBLISHABLE_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET"
)) {
  $value = Get-EnvValue $envValues $name
  if (-not (Test-Placeholder $value)) {
    $secretLines += "$name=$value"
  }
}
$secretLines | Set-Content -Path $supabaseEnvPath -Encoding UTF8

Write-Host "Pushing Stripe secrets to Supabase..."
supabase secrets set --project-ref $ProjectRef --env-file $supabaseEnvPath
Remove-Item -LiteralPath $supabaseEnvPath -Force

Write-Host "Verifying Supabase secret names..."
$secretJson = supabase secrets list --project-ref $ProjectRef --output json | ConvertFrom-Json
$names = @($secretJson | ForEach-Object { $_.name })
$required = @("STRIPE_TEST_SECRET_KEY", "STRIPE_TEST_PUBLISHABLE_KEY", "STRIPE_TEST_WEBHOOK_SECRET")
if (-not (Test-Placeholder (Get-EnvValue $envValues "STRIPE_LIVE_SECRET_KEY"))) {
  $required += @("STRIPE_LIVE_SECRET_KEY", "STRIPE_LIVE_PUBLISHABLE_KEY", "STRIPE_LIVE_WEBHOOK_SECRET")
}
$missing = @($required | Where-Object { $names -notcontains $_ })
if ($missing.Count -gt 0) {
  throw "Supabase still does not show required secret names: $($missing -join ', ')"
}

Write-Host "Done. Stripe secrets are configured in Supabase."
