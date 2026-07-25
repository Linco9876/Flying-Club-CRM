param(
  [string]$SourceProjectRef = 'joarmzswpufrduectjse',
  [string]$RecoveryProjectRef = 'hohmmwvtisnuuoumipjq',
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BfcRecoveryCredential {
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
  if ($env:SUPABASE_ACCESS_TOKEN -and $env:SUPABASE_ACCESS_TOKEN.StartsWith('sbp_')) {
    return $env:SUPABASE_ACCESS_TOKEN
  }
  if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
    throw 'SUPABASE_ACCESS_TOKEN is required outside Windows.'
  }

  $pointer = [IntPtr]::Zero
  if (-not [BfcRecoveryCredential]::Read('Supabase CLI:supabase', 1, 0, [ref]$pointer)) {
    throw 'Supabase CLI is not authenticated in Windows Credential Manager.'
  }

  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $pointer,
      [type][BfcRecoveryCredential+Credential]
    )
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy(
      $credential.CredentialBlob,
      $bytes,
      0,
      $bytes.Length
    )
    $token = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
    if (-not $token.StartsWith('sbp_')) {
      throw 'The stored Supabase CLI credential has an unexpected format.'
    }
    return $token
  } finally {
    [BfcRecoveryCredential]::Free($pointer)
  }
}

function Get-TemporaryDatabaseLogin {
  param(
    [string]$Token,
    [string]$ProjectRef,
    [bool]$ReadOnly
  )

  $headers = @{
    Authorization = "Bearer $Token"
    'Content-Type' = 'application/json'
  }
  $body = @{ read_only = $ReadOnly } | ConvertTo-Json -Compress
  return Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/cli/login-role" `
    -Headers $headers `
    -Body $body
}

function Get-SessionPoolerHost {
  param(
    [string]$Token,
    [string]$ProjectRef
  )

  $poolers = Invoke-RestMethod `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/config/database/pooler" `
    -Headers @{ Authorization = "Bearer $Token" }
  $primary = @($poolers) |
    Where-Object { $_.database_type -eq 'PRIMARY' } |
    Select-Object -First 1
  if (-not $primary.db_host) {
    throw "No primary Supavisor host was returned for $ProjectRef."
  }
  return $primary.db_host
}

function Get-ProjectServiceKey {
  param(
    [string]$Token,
    [string]$ProjectRef
  )

  $keys = Invoke-RestMethod `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/api-keys" `
    -Headers @{ Authorization = "Bearer $Token" }
  $serviceKey = @($keys) |
    Where-Object { $_.name -eq 'service_role' } |
    Select-Object -First 1
  if (-not $serviceKey.api_key) {
    $serviceKey = @($keys) |
      Where-Object { $_.type -eq 'secret' } |
      Select-Object -First 1
  }
  if (-not $serviceKey.api_key) {
    throw "No service-role or secret API key was returned for $ProjectRef."
  }
  return [string]$serviceKey.api_key
}

function Get-AuthUsers {
  param(
    [string]$ProjectRef,
    [string]$ServiceKey
  )

  $headers = @{
    apikey = $ServiceKey
    Authorization = "Bearer $ServiceKey"
  }
  $users = @()
  for ($page = 1; ; $page += 1) {
    $response = Invoke-RestMethod `
      -Uri "https://$ProjectRef.supabase.co/auth/v1/admin/users?page=$page&per_page=1000" `
      -Headers $headers
    $batch = @($response.users)
    $users += $batch
    if ($batch.Count -lt 1000) {
      break
    }
  }
  return $users
}

function Restore-AuthUsers {
  param(
    [string]$ProjectRef,
    [string]$ServiceKey,
    [array]$Users
  )

  $headers = @{
    apikey = $ServiceKey
    Authorization = "Bearer $ServiceKey"
    'Content-Type' = 'application/json'
  }
  foreach ($existing in @(Get-AuthUsers -ProjectRef $ProjectRef -ServiceKey $ServiceKey)) {
    Invoke-RestMethod `
      -Method Delete `
      -Uri "https://$ProjectRef.supabase.co/auth/v1/admin/users/$($existing.id)?should_soft_delete=false" `
      -Headers $headers |
      Out-Null
  }

  foreach ($user in $Users) {
    if ($null -eq $user) {
      continue
    }
    $userId = [string]$user.id
    $parsedUserId = [guid]::Empty
    if (-not [guid]::TryParse($userId, [ref]$parsedUserId)) {
      throw "The Auth backup contains a user without a valid UUID (type: $($user.GetType().FullName))."
    }
    $passwordBytes = New-Object byte[] 30
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $generator.GetBytes($passwordBytes)
    } finally {
      $generator.Dispose()
    }
    $payload = @{
      password = ([Convert]::ToBase64String($passwordBytes).Replace('/', 'A').Replace('+', 'B')) + '!9a'
      email_confirm = $null -ne $user.email_confirmed_at
      phone_confirm = $null -ne $user.phone_confirmed_at
      user_metadata = $user.user_metadata
      app_metadata = $user.app_metadata
    }
    if ($user.email) {
      $payload.email = [string]$user.email
    }
    if ($user.phone) {
      $payload.phone = [string]$user.phone
    }

    Invoke-RestMethod `
      -Method Post `
      -Uri "https://$ProjectRef.supabase.co/auth/v1/admin/users/$userId" `
      -Headers $headers `
      -Body ($payload | ConvertTo-Json -Depth 20 -Compress) |
      Out-Null
  }
}

function Reset-RecoveryDatabasePassword {
  param(
    [string]$Token,
    [string]$ProjectRef
  )

  $bytes = New-Object byte[] 36
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  $password = ([Convert]::ToBase64String($bytes).Replace('/', 'A').Replace('+', 'B').TrimEnd('=')) + '!9a'

  $headers = @{
    Authorization = "Bearer $Token"
    'Content-Type' = 'application/json'
  }
  Invoke-RestMethod `
    -Method Patch `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/password" `
    -Headers $headers `
    -Body (@{ password = $password } | ConvertTo-Json -Compress) |
    Out-Null

  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $password | & gh secret set SUPABASE_RECOVERY_DB_PASSWORD
    if ($LASTEXITCODE -ne 0) {
      throw 'The recovery password was rotated, but its GitHub secret could not be updated.'
    }
  }

  return [pscustomobject]@{
    role = 'postgres'
    password = $password
  }
}

function Invoke-PostgresTool {
  param(
    [string]$Executable,
    [string]$Arguments,
    [string]$HostName,
    [string]$ProjectRef,
    [object]$Login,
    [string]$Port = '5432'
  )

  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Executable
  $start.Arguments = $Arguments
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.CreateNoWindow = $true
  $start.EnvironmentVariables['PGHOST'] = $HostName
  $start.EnvironmentVariables['PGPORT'] = $Port
  $start.EnvironmentVariables['PGDATABASE'] = 'postgres'
  $start.EnvironmentVariables['PGSSLMODE'] = 'require'
  $start.EnvironmentVariables['PGUSER'] = "$($Login.role).$ProjectRef"
  $start.EnvironmentVariables['PGPASSWORD'] = [string]$Login.password

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  [void]$process.Start()
  # Drain both redirected streams concurrently. Schema drops can emit enough
  # PostgreSQL NOTICE output to fill stderr; reading stdout to completion first
  # can then deadlock even though the database command has finished.
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(600000)) {
    try {
      $process.Kill()
    } catch {
      # Preserve the timeout as the primary failure.
    }
    throw "$Executable exceeded the 10-minute recovery command timeout."
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) {
    throw "$Executable failed with exit code $($process.ExitCode): $stderr"
  }
  return $stdout.Trim()
}

function Protect-Backup {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [byte[]]$Key
  )

  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.KeySize = 256
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $Key
    $aes.GenerateIV()

    $input = [IO.File]::OpenRead($InputPath)
    $output = [IO.File]::Create($OutputPath)
    try {
      $output.Write($aes.IV, 0, $aes.IV.Length)
      $crypto = New-Object Security.Cryptography.CryptoStream(
        $output,
        $aes.CreateEncryptor(),
        [Security.Cryptography.CryptoStreamMode]::Write
      )
      try {
        $input.CopyTo($crypto)
        $crypto.FlushFinalBlock()
      } finally {
        $crypto.Dispose()
      }
    } finally {
      $input.Dispose()
      $output.Dispose()
    }
  } finally {
    $aes.Dispose()
  }
}

function Unprotect-Backup {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [byte[]]$Key
  )

  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.KeySize = 256
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $Key

    $input = [IO.File]::OpenRead($InputPath)
    $iv = New-Object byte[] 16
    if ($input.Read($iv, 0, $iv.Length) -ne $iv.Length) {
      throw 'Encrypted backup is missing its initialization vector.'
    }
    $aes.IV = $iv
    $output = [IO.File]::Create($OutputPath)
    try {
      $crypto = New-Object Security.Cryptography.CryptoStream(
        $input,
        $aes.CreateDecryptor(),
        [Security.Cryptography.CryptoStreamMode]::Read
      )
      try {
        $crypto.CopyTo($output)
      } finally {
        $crypto.Dispose()
      }
    } finally {
      $output.Dispose()
      $input.Dispose()
    }
  } finally {
    $aes.Dispose()
  }
}

function Clear-SensitiveFile {
  param([string]$Path)
  if (-not [IO.File]::Exists($Path)) {
    return
  }

  $stream = [IO.File]::OpenWrite($Path)
  try {
    $remaining = $stream.Length
    $buffer = New-Object byte[] 65536
    while ($remaining -gt 0) {
      $count = [Math]::Min($buffer.Length, $remaining)
      $stream.Write($buffer, 0, $count)
      $remaining -= $count
    }
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  [IO.File]::Delete($Path)
}

if ($VerifyOnly) {
  $token = Get-SupabaseManagementToken
  $sourceHost = Get-SessionPoolerHost -Token $token -ProjectRef $SourceProjectRef
  $recoveryHost = Get-SessionPoolerHost -Token $token -ProjectRef $RecoveryProjectRef
  $sourceLogin = Get-TemporaryDatabaseLogin -Token $token -ProjectRef $SourceProjectRef -ReadOnly $false
  $recoveryLogin = Get-TemporaryDatabaseLogin -Token $token -ProjectRef $RecoveryProjectRef -ReadOnly $false
  $snapshotQuery = 'set role postgres; select concat_ws(''|'', (select count(*) from pg_catalog.pg_tables where schemaname = ''public''), (select count(*) from auth.users), (select count(*) from public.users), (select count(*) from public.bookings), (select count(*) from public.flight_logs), (select count(*) from public.club_memberships), (select count(*) from storage.buckets), (select count(*) from storage.objects))'
  $snapshotArguments = "-X -qAt -c `"$snapshotQuery`""
  $sourceSnapshot = Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments $snapshotArguments `
    -HostName $sourceHost `
    -ProjectRef $SourceProjectRef `
    -Login $sourceLogin
  $recoverySnapshot = Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments $snapshotArguments `
    -HostName $recoveryHost `
    -ProjectRef $RecoveryProjectRef `
    -Login $recoveryLogin
  if ($sourceSnapshot -ne $recoverySnapshot) {
    throw "Recovery verification mismatch: source $sourceSnapshot, recovery $recoverySnapshot."
  }
  $values = $recoverySnapshot.Split('|')
  Write-Output (
    'Recovery verification passed: ' +
    "$($values[0]) public tables, $($values[1]) Auth users, " +
    "$($values[2]) profiles, $($values[3]) bookings, $($values[4]) flight logs, " +
    "$($values[5]) memberships, $($values[6]) storage buckets and $($values[7]) storage objects."
  )
  return
}

$drillDirectory = Join-Path $env:TEMP "bfc-recovery-drill-$([guid]::NewGuid().ToString('N'))"
$plainDump = Join-Path $drillDirectory 'production-public.dump'
$encryptedDump = Join-Path $drillDirectory 'production-public.dump.encrypted'
$restoredDump = Join-Path $drillDirectory 'restore-input.dump'
$restoreList = Join-Path $drillDirectory 'restore-input.list'
$plainAuthDump = Join-Path $drillDirectory 'production-auth-users.json'
$encryptedAuthDump = Join-Path $drillDirectory 'production-auth-users.json.encrypted'
$restoredAuthDump = Join-Path $drillDirectory 'restore-auth-users.json'
$resetSqlPath = Join-Path $drillDirectory 'reset-recovery.sql'
[void](New-Item -ItemType Directory -Path $drillDirectory)

$encryptionKey = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($encryptionKey)
$random.Dispose()

try {
  $token = Get-SupabaseManagementToken
  $sourceHost = Get-SessionPoolerHost -Token $token -ProjectRef $SourceProjectRef
  $recoveryHost = Get-SessionPoolerHost -Token $token -ProjectRef $RecoveryProjectRef
  $sourceLogin = Get-TemporaryDatabaseLogin `
    -Token $token `
    -ProjectRef $SourceProjectRef `
    -ReadOnly $false

  Write-Output 'Stage 1/6: creating production public-schema dump.'
  [void](Invoke-PostgresTool `
    -Executable 'pg_dump' `
    -Arguments "--role=postgres --format=custom --schema-only --no-owner --schema=public --schema=private --file=`"$plainDump`"" `
    -HostName $sourceHost `
    -ProjectRef $SourceProjectRef `
    -Login $sourceLogin)
  Write-Output 'Stage 2/6: creating full production data dump, including Auth password hashes.'
  [void](Invoke-PostgresTool `
    -Executable 'pg_dump' `
    -Arguments "--role=postgres --data-only --quote-all-identifiers --schema=public --schema=private --schema=auth --schema=storage --exclude-table=auth.schema_migrations --exclude-table=storage.migrations --exclude-table=storage.buckets_vectors --exclude-table=storage.vector_indexes --file=`"$plainAuthDump`"" `
    -HostName $sourceHost `
    -ProjectRef $SourceProjectRef `
    -Login $sourceLogin)
  $dataSql = [IO.File]::ReadAllText($plainAuthDump)
  [IO.File]::WriteAllText(
    $plainAuthDump,
    "SET ROLE postgres;`r`nSET session_replication_role = replica;`r`n$dataSql`r`nRESET ALL;`r`n",
    [Text.UTF8Encoding]::new($false)
  )

  Write-Output 'Stage 3/6: encrypting, decrypting and checksum-verifying recovery artifacts.'
  $sourceHash = (Get-FileHash -LiteralPath $plainDump -Algorithm SHA256).Hash
  $sourceAuthHash = (Get-FileHash -LiteralPath $plainAuthDump -Algorithm SHA256).Hash
  Protect-Backup -InputPath $plainDump -OutputPath $encryptedDump -Key $encryptionKey
  Protect-Backup -InputPath $plainAuthDump -OutputPath $encryptedAuthDump -Key $encryptionKey
  Clear-SensitiveFile -Path $plainDump
  Clear-SensitiveFile -Path $plainAuthDump
  Unprotect-Backup -InputPath $encryptedDump -OutputPath $restoredDump -Key $encryptionKey
  Unprotect-Backup -InputPath $encryptedAuthDump -OutputPath $restoredAuthDump -Key $encryptionKey
  $decryptedHash = (Get-FileHash -LiteralPath $restoredDump -Algorithm SHA256).Hash
  $decryptedAuthHash = (Get-FileHash -LiteralPath $restoredAuthDump -Algorithm SHA256).Hash
  if ($decryptedHash -ne $sourceHash) {
    throw 'The decrypted recovery artifact does not match the production dump.'
  }
  if ($decryptedAuthHash -ne $sourceAuthHash) {
    throw 'The decrypted Auth recovery artifact does not match the production dump.'
  }
  [void](Invoke-PostgresTool `
    -Executable 'pg_restore' `
    -Arguments "--list --file=`"$restoreList`" `"$restoredDump`"" `
    -HostName $sourceHost `
    -ProjectRef $SourceProjectRef `
    -Login $sourceLogin)
  $restoreEntries = [IO.File]::ReadAllLines($restoreList)
  $filteredDefaultAclCount = 0
  for ($index = 0; $index -lt $restoreEntries.Length; $index += 1) {
    if ($restoreEntries[$index] -match '\bDEFAULT ACL\b.*\bsupabase_admin\b') {
      $restoreEntries[$index] = ";$($restoreEntries[$index])"
      $filteredDefaultAclCount += 1
    }
  }
  if ($filteredDefaultAclCount -eq 0) {
    throw 'The schema dump did not contain the expected managed supabase_admin default ACL entries.'
  }
  [IO.File]::WriteAllLines($restoreList, $restoreEntries, [Text.UTF8Encoding]::new($false))

  Write-Output 'Stage 4/6: resetting only the isolated recovery public schema.'
  Write-Output '  Acquiring a short-lived recovery database login.'
  $recoveryLogin = Get-TemporaryDatabaseLogin `
    -Token $token `
    -ProjectRef $RecoveryProjectRef `
    -ReadOnly $false
  Write-Output '  Clearing stale tenant sessions and application schemas.'
  # Realtime publications are Supabase-managed and may be owned by a platform
  # role that temporary database administrators cannot assume. Dropping the
  # application schemas removes their publication memberships without trying
  # to replace the managed publication objects themselves.
  $resetSql = @'
set role postgres;
set lock_timeout = '30s';
set statement_timeout = '90s';

select pg_terminate_backend(activity.pid)
from pg_stat_activity activity
join pg_roles role on role.rolname = activity.usename
where activity.datname = current_database()
  and activity.pid <> pg_backend_pid()
  and activity.backend_type = 'client backend'
  and not role.rolsuper;

drop schema if exists public cascade;
drop schema if exists private cascade;

do $bfc$
declare
  recoverable_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
  into recoverable_tables
  from pg_catalog.pg_tables
  where (
      schemaname = 'auth'
      and tablename <> 'schema_migrations'
    )
    or (
      schemaname = 'storage'
      and tablename not in ('migrations', 'buckets_vectors', 'vector_indexes')
    );

  if recoverable_tables is not null then
    execute 'truncate table ' || recoverable_tables || ' cascade';
  end if;
end
$bfc$;
'@
  [IO.File]::WriteAllText($resetSqlPath, $resetSql, [Text.UTF8Encoding]::new($false))
  [void](Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments "-X --set ON_ERROR_STOP=1 -q --file=`"$resetSqlPath`"" `
    -HostName $recoveryHost `
    -ProjectRef $RecoveryProjectRef `
    -Login $recoveryLogin)
  # The reset intentionally clears pooled tenant sessions. Obtain a fresh
  # short-lived login before opening the restore connection.
  Start-Sleep -Seconds 2
  $recoveryLogin = Get-TemporaryDatabaseLogin `
    -Token $token `
    -ProjectRef $RecoveryProjectRef `
    -ReadOnly $false
  Write-Output 'Stage 5/6: restoring CRM schema, Auth identities, password hashes and all data.'
  [void](Invoke-PostgresTool `
    -Executable 'pg_restore' `
    -Arguments "--role=postgres --no-owner --exit-on-error --use-list=`"$restoreList`" --dbname=postgres `"$restoredDump`"" `
    -HostName $recoveryHost `
    -ProjectRef $RecoveryProjectRef `
    -Login $recoveryLogin)
  [void](Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments "-X --single-transaction --set ON_ERROR_STOP=1 --file=`"$restoredAuthDump`"" `
    -HostName $recoveryHost `
    -ProjectRef $RecoveryProjectRef `
    -Login $recoveryLogin)

  Write-Output 'Stage 6/6: comparing source and recovery schema counts.'
  $sourceTables = Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments '-X -qAt -c "select count(*) from pg_catalog.pg_tables where schemaname=''public''"' `
    -HostName $sourceHost `
    -ProjectRef $SourceProjectRef `
    -Login $sourceLogin
  $recoveryTables = Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments '-X -qAt -c "select count(*) from pg_catalog.pg_tables where schemaname=''public''"' `
    -HostName $recoveryHost `
    -ProjectRef $RecoveryProjectRef `
    -Login $recoveryLogin

  if ($sourceTables -ne $recoveryTables) {
    throw "Recovery table count mismatch: source $sourceTables, recovery $recoveryTables."
  }
  $sourceAuthCount = Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments '-X -qAt -c "set role postgres; select count(*) from auth.users"' `
    -HostName $sourceHost `
    -ProjectRef $SourceProjectRef `
    -Login $sourceLogin
  $recoveryAuthCount = Invoke-PostgresTool `
    -Executable 'psql' `
    -Arguments '-X -qAt -c "set role postgres; select count(*) from auth.users"' `
    -HostName $recoveryHost `
    -ProjectRef $RecoveryProjectRef `
    -Login $recoveryLogin
  if ($sourceAuthCount -ne $recoveryAuthCount) {
    throw "Recovery Auth user count mismatch: source $sourceAuthCount, recovery $recoveryAuthCount."
  }

  Write-Output "Recovery drill passed: restored $recoveryTables public tables and $recoveryAuthCount Auth users into isolated project $RecoveryProjectRef."
  Write-Output "Verified public SHA-256: $sourceHash"
  Write-Output "Verified Auth SHA-256: $sourceAuthHash"
} finally {
  Clear-SensitiveFile -Path $plainDump
  Clear-SensitiveFile -Path $restoredDump
  Clear-SensitiveFile -Path $plainAuthDump
  Clear-SensitiveFile -Path $restoredAuthDump
  if ([IO.File]::Exists($restoreList)) {
    [IO.File]::Delete($restoreList)
  }
  if ([IO.File]::Exists($encryptedDump)) {
    [IO.File]::Delete($encryptedDump)
  }
  if ([IO.File]::Exists($encryptedAuthDump)) {
    [IO.File]::Delete($encryptedAuthDump)
  }
  if ([IO.File]::Exists($resetSqlPath)) {
    [IO.File]::Delete($resetSqlPath)
  }
  if ([IO.Directory]::Exists($drillDirectory)) {
    [IO.Directory]::Delete($drillDirectory, $false)
  }
  [Array]::Clear($encryptionKey, 0, $encryptionKey.Length)
}
