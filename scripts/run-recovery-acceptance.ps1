param(
  [string]$RecoveryProjectRef = 'hohmmwvtisnuuoumipjq',
  [string]$Project,
  [string]$Grep,
  [string]$SupabaseAccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [switch]$BrowserStack
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Invoke-RestMethod:TimeoutSec'] = 30

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BfcAcceptanceCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);

  [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
  public static extern void Free(IntPtr credential);
}
'@

function Get-SupabaseManagementToken {
  $pointer = [IntPtr]::Zero
  if (-not [BfcAcceptanceCredential]::Read('Supabase CLI:supabase', 1, 0, [ref]$pointer)) {
    throw 'Supabase CLI is not authenticated in Windows Credential Manager.'
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $pointer,
      [type][BfcAcceptanceCredential+Credential]
    )
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
    return [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
  } finally {
    [BfcAcceptanceCredential]::Free($pointer)
  }
}

function New-RandomPassword {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'b')) + '!7z'
  } finally {
    $generator.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

$token = if ($SupabaseAccessToken) {
  $SupabaseAccessToken
} else {
  Get-SupabaseManagementToken
}
$managementHeaders = @{ Authorization = "Bearer $token" }
$keys = Invoke-RestMethod `
  -Uri "https://api.supabase.com/v1/projects/$RecoveryProjectRef/api-keys" `
  -Headers $managementHeaders
$serviceKey = [string](@($keys) | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1).api_key
$anonKey = [string](@($keys) | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key
if (-not $serviceKey -or -not $anonKey) {
  throw 'Recovery API keys were not returned by Supabase.'
}

$projectUrl = "https://$RecoveryProjectRef.supabase.co"
$serviceHeaders = @{
  apikey = $serviceKey
  Authorization = "Bearer $serviceKey"
  'Content-Type' = 'application/json'
}
$roles = @('admin', 'cfi', 'senior_instructor', 'instructor', 'pilot', 'student')
$devices = if ($BrowserStack) {
  @('real-iphone', 'real-android')
} else {
  @('iphone-emulation', 'android-emulation')
}
$createdUserIds = New-Object Collections.Generic.List[string]
$credentials = @{}
$runId = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$temporaryOriginsConfigured = $false
$previousSupabaseAccessToken = $env:SUPABASE_ACCESS_TOKEN

try {
  $existingSecrets = npx supabase secrets list `
    --project-ref $RecoveryProjectRef `
    --output json 2>$null |
    ConvertFrom-Json
  if ($existingSecrets | Where-Object { $_.name -eq 'ADDITIONAL_ALLOWED_ORIGINS' }) {
    throw 'The acceptance project already has ADDITIONAL_ALLOWED_ORIGINS configured; refusing to overwrite it.'
  }
  $env:SUPABASE_ACCESS_TOKEN = $token
  npx supabase secrets set `
    --project-ref $RecoveryProjectRef `
    'ADDITIONAL_ALLOWED_ORIGINS=http://127.0.0.1:4178,http://bs-local.com:4178' |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not configure the temporary acceptance-test browser origins.'
  }
  $temporaryOriginsConfigured = $true

  $corsOrigin = if ($BrowserStack) { 'http://bs-local.com:4178' } else { 'http://127.0.0.1:4178' }
  $corsReady = $false
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    try {
      $preflight = Invoke-WebRequest `
        -Method Options `
        -Uri "$projectUrl/functions/v1/financial-provider-status" `
        -Headers @{
          Origin = $corsOrigin
          'Access-Control-Request-Method' = 'POST'
          'Access-Control-Request-Headers' = 'authorization,apikey,content-type'
        } `
        -UseBasicParsing
      if ($preflight.Headers['Access-Control-Allow-Origin'] -eq $corsOrigin) {
        $corsReady = $true
        break
      }
    } catch {
      # Edge Function secret propagation can briefly restart the function.
    }
    Start-Sleep -Seconds 2
  }
  if (-not $corsReady) {
    throw 'The temporary acceptance-test browser origins did not become active.'
  }

  $providerStatus = $null
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    try {
      $providerStatus = Invoke-RestMethod `
        -Method Post `
        -Uri "$projectUrl/functions/v1/financial-provider-status" `
        -Headers $serviceHeaders `
        -Body '{}'
      break
    } catch {
      # Secret changes restart the function fleet. Preflight can recover a few
      # seconds before database-backed requests are ready on every isolate.
      Start-Sleep -Seconds 2
    }
  }
  if ($null -eq $providerStatus) {
    throw 'Financial provider status did not recover after the temporary acceptance configuration change.'
  }
  $env:EXPECT_FINANCIAL_DASHBOARD = if ($providerStatus.financeEnabled) { 'true' } else { 'false' }

  $existingUsers = Invoke-RestMethod `
    -Uri "$projectUrl/auth/v1/admin/users?page=1&per_page=1000" `
    -Headers $serviceHeaders
  foreach ($existing in @($existingUsers.users) | Where-Object { $_.email -like 'bfc-acceptance+*@example.com' }) {
    Invoke-RestMethod `
      -Method Delete `
      -Uri "$projectUrl/auth/v1/admin/users/$($existing.id)?should_soft_delete=false" `
      -Headers $serviceHeaders |
      Out-Null
  }

  foreach ($device in $devices) {
    foreach ($role in $roles) {
      $emailRole = $role.Replace('_', '-')
      $email = "bfc-acceptance+$runId-$device-$emailRole@example.com"
      $password = New-RandomPassword
      $payload = @{
        email = $email
        password = $password
        email_confirm = $true
        user_metadata = @{ name = "Acceptance $role" }
      } | ConvertTo-Json -Depth 5 -Compress
      $authUser = Invoke-RestMethod `
        -Method Post `
        -Uri "$projectUrl/auth/v1/admin/users" `
        -Headers $serviceHeaders `
        -Body $payload
      $userId = [string]$authUser.id
      $createdUserIds.Add($userId)

      $profilePayload = @{
        id = $userId
        name = "Acceptance $role"
        email = $email
        role = $(if ($role -eq 'cfi') { 'instructor' } else { $role })
        is_active = $true
        portal_access_scope = 'full'
      } | ConvertTo-Json -Compress
      Invoke-RestMethod `
        -Method Post `
        -Uri "$projectUrl/rest/v1/users?on_conflict=id" `
        -Headers ($serviceHeaders + @{ Prefer = 'resolution=merge-duplicates,return=minimal' }) `
        -Body $profilePayload |
        Out-Null
      Invoke-RestMethod `
        -Method Delete `
        -Uri "$projectUrl/rest/v1/user_roles?user_id=eq.$userId" `
        -Headers $serviceHeaders |
        Out-Null

      $assignedRoles = if ($role -eq 'cfi') { @('instructor', 'cfi') } else { @($role) }
      foreach ($assignedRole in $assignedRoles) {
        try {
          Invoke-RestMethod `
            -Method Post `
            -Uri "$projectUrl/rest/v1/user_roles?on_conflict=user_id,role" `
            -Headers ($serviceHeaders + @{ Prefer = 'resolution=merge-duplicates,return=minimal' }) `
            -Body (@{ user_id = $userId; role = $assignedRole } | ConvertTo-Json -Compress) |
            Out-Null
        } catch {
          $detail = ''
          if ($_.Exception.Response) {
            $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
            try {
              $detail = $reader.ReadToEnd()
            } finally {
              $reader.Dispose()
            }
          }
          throw "Could not assign $assignedRole to the disposable $device $role account. $detail"
        }
      }
      $credentials["$device`:$role"] = @{
        id = $userId
        role = $role
        email = $email
        password = $password
      }
    }
  }

  $env:VITE_SUPABASE_URL = $projectUrl
  $env:VITE_SUPABASE_ANON_KEY = $anonKey
  $env:ACCEPTANCE_USERS_JSON = $credentials | ConvertTo-Json -Depth 5 -Compress
  if ($BrowserStack) {
    & node scripts/run-browserstack-real-device-acceptance.mjs
  } else {
    $playwrightArguments = @('playwright', 'test')
    if ($Project) {
      $playwrightArguments += @('--project', $Project)
    }
    if ($Grep) {
      $playwrightArguments += @('--grep', $Grep)
    }
    & npx.cmd @playwrightArguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticated acceptance tests failed with exit code $LASTEXITCODE."
  }
} finally {
  foreach ($userId in $createdUserIds) {
    try {
      Invoke-RestMethod `
        -Method Delete `
        -Uri "$projectUrl/auth/v1/admin/users/${userId}?should_soft_delete=false" `
        -Headers $serviceHeaders |
        Out-Null
    } catch {
      Write-Warning "Could not remove disposable acceptance user $userId."
    }
  }
  Remove-Item Env:ACCEPTANCE_USERS_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:EXPECT_FINANCIAL_DASHBOARD -ErrorAction SilentlyContinue
  if ($temporaryOriginsConfigured) {
    'y' | npx supabase secrets unset ADDITIONAL_ALLOWED_ORIGINS `
      --project-ref $RecoveryProjectRef 2>$null |
      Out-Null
  }
  if ($previousSupabaseAccessToken) {
    $env:SUPABASE_ACCESS_TOKEN = $previousSupabaseAccessToken
  } else {
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  }
}
