param([ValidateSet('vaultix','vaultixl')][string]$FirstCommand='vaultix')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$steps = [System.Collections.Generic.List[string]]::new()
$held = $null
function Mark([string]$step) { $steps.Add($step); $steps | ConvertTo-Json | Set-Content C:\VaultixOutput\progress.json }
function Native([string]$exe,[string[]]$argv) {
  $value = & $exe @argv 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('Native command failed: ' + ($value -join ' ')) }
  return ($value -join "`n")
}
try {
  $env:VAULTIX_DISABLE_UPDATE_CHECK='1'
  # Guest-only watchdog bounds orphaned test processes even if acceptance hangs.
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 180; Stop-Computer -Force"' | Out-Null
  New-Item -ItemType Directory C:\Probe | Out-Null
  Copy-Item C:\VaultixInput\*.msix C:\Probe\
  $cert=New-SelfSignedCertificate -Type Custom -Subject 'CN=Vaultix Disposable Probe' -KeyUsage DigitalSignature -FriendlyName 'Disposable Vaultix probe only' -CertStoreLocation Cert:\CurrentUser\My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
  Export-Certificate -Cert $cert -FilePath C:\Probe\probe.cer | Out-Null
  Import-Certificate -FilePath C:\Probe\probe.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
  foreach($v in @('1.2.3','1.2.4')) {
    & C:\VaultixInput\signtool.exe sign /fd SHA256 /sha1 $cert.Thumbprint /s My "C:\Probe\$v.msix" > "C:\VaultixOutput\$v-sign.log" 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Guest signing failed' }
  }
  Mark 'guest-only-test-signing'
  Native C:\VaultixInput\portable.exe @('init','--project','packaging-probe','--env','dev') | Out-Null
  'DISPOSABLE-FIXTURE' | & C:\VaultixInput\portable.exe set PROBE_REFERENCE
  if($LASTEXITCODE -ne 0) {throw 'Portable keyring fixture failed'}
  $config=Join-Path $env:APPDATA 'vaultix\config.json'
  $before=(Get-FileHash -LiteralPath $config).Hash
  Mark 'portable-config-and-keyring-fixture'
  $check=[System.Diagnostics.ProcessStartInfo]::new('C:\VaultixInput\portable.exe','C:\VaultixInput\portable.exe version --json')
  $check.UseShellExecute=$false; $check.CreateNoWindow=$true; $check.RedirectStandardOutput=$true; $check.RedirectStandardError=$true
  $negative=[System.Diagnostics.Process]::Start($check)
  if(-not $negative.WaitForExit(10000)){$negative.Kill();throw 'Portable refusal timed out'}
  if($negative.ExitCode -eq 0 -or $negative.StandardError.ReadToEnd() -notmatch 'unknown command'){throw 'Portable duplicate argument was incorrectly normalized'}
  Mark 'portable-arguments-preserved'
  Add-AppxPackage C:\Probe\1.2.3.msix
  $native=Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\vaultix.exe'
  $alternate=Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\vaultixl.exe'
  $env:PATH=(Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps')+';'+$env:PATH
  $native=$FirstCommand+'.exe'; $alternate=if($FirstCommand -eq 'vaultix'){'vaultixl.exe'}else{'vaultix.exe'}
  foreach($command in @($native,$alternate)) {
    $identity=(Native $command @('version','--json')) | ConvertFrom-Json
    if($identity.version -ne '1.2.3') {throw 'First native identity mismatch'}
    if((Native $command @('ls')) -notmatch 'PROBE_REFERENCE') {throw 'Packaged process could not decrypt existing keyring-backed state'}
  }
  if((Get-FileHash -LiteralPath $config).Hash -ne $before) {throw 'Configuration changed'}
  Mark 'installed-native-pair-and-existing-keyring'
  $check=[System.Diagnostics.ProcessStartInfo]::new($native,'C:\Untrusted\vaultix.exe version --json')
  $check.UseShellExecute=$false; $check.CreateNoWindow=$true; $check.RedirectStandardOutput=$true; $check.RedirectStandardError=$true
  $negative=[System.Diagnostics.Process]::Start($check)
  if(-not $negative.WaitForExit(10000)){$negative.Kill();throw 'Packaged refusal timed out'}
  if($negative.ExitCode -eq 0 -or $negative.StandardError.ReadToEnd() -notmatch 'unknown command'){throw 'Unrelated packaged argument was incorrectly normalized'}
  # Corrupt the candidate package before OS validation, independently of CLI checks.
  $corrupt=[System.IO.File]::ReadAllBytes('C:\Probe\1.2.4.msix')
  $corrupt[[int]($corrupt.Length/2)]=$corrupt[[int]($corrupt.Length/2)] -bxor 255
  [System.IO.File]::WriteAllBytes('C:\Probe\corrupt.msix',$corrupt)
  $refused=$false
  try {Add-AppxPackage C:\Probe\corrupt.msix -ErrorAction Stop} catch {$refused=$true}
  if(-not $refused -or (Get-AppxPackage -Name Vaultix.CLI.Probe).Version -ne '1.2.3.0'){throw 'Corrupt package altered installed version'}
  Mark 'packaged-arguments-and-corrupt-update-refused'
  $start=[System.Diagnostics.ProcessStartInfo]::new($native,'login --token')
  $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
  $held=[System.Diagnostics.Process]::Start($start)
  Start-Sleep -Milliseconds 500
  if($held.HasExited) {throw 'Holding native process exited'}
  Add-AppxPackage C:\Probe\1.2.4.msix -DeferRegistrationWhenPackagesAreInUse
  if($held.HasExited) {throw 'Deferred update killed running CLI'}
  $registered=Get-AppxPackage -Name Vaultix.CLI.Probe
  if($registered.Version -ne '1.2.3.0') {throw 'Unexpected early activation'}
  Mark 'deferred-update-preserves-running-cli'
  $held.StandardInput.Close(); if(-not $held.WaitForExit(10000)){throw 'Held fixture did not exit after EOF'}
  foreach($command in @($native,$alternate)) {
    $identity=(Native $command @('version','--json')) | ConvertFrom-Json
    if($identity.version -ne '1.2.4') {throw 'Deferred native identity mismatch'}
    if((Native $command @('ls')) -notmatch 'PROBE_REFERENCE') {throw 'Updated package lost existing keyring/config'}
  }
  if((Get-FileHash -LiteralPath $config).Hash -ne $before) {throw 'Updated configuration changed'}
  Mark 'relaunch-both-commands-and-keyring'
  @{passed=$true; guestOnly=$true; steps=$steps; limitations=@('No interrupted package-manager transaction test','No product package installer implementation','Test signing only','No production certificate or package identity decision')} | ConvertTo-Json -Depth 5 | Set-Content C:\VaultixOutput\result.json
} catch {
  $failure=$_.Exception.Message
  $detail=$_.ToString()
  $stack=$_.ScriptStackTrace
  @{passed=$false;guestOnly=$true;steps=$steps;error=$failure;detail=$detail;stack=$stack} | ConvertTo-Json -Depth 5 | Set-Content C:\VaultixOutput\result.json
} finally { if($held -and -not $held.HasExited){$held.Kill()}; Stop-Computer -Force }
