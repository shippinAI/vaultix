$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$steps=[Collections.Generic.List[string]]::new(); $held=$null; $updater=$null
function Mark([string]$value){$steps.Add($value); $steps | ConvertTo-Json | Set-Content C:\VaultixOutput\progress.json}
function StartNative([string]$exe,[string]$arguments){
  $p=[Diagnostics.ProcessStartInfo]::new($exe,$arguments); $p.UseShellExecute=$false; $p.CreateNoWindow=$true
  $p.RedirectStandardOutput=$true; $p.RedirectStandardError=$true; $p.RedirectStandardInput=$true
  try { return [Diagnostics.Process]::Start($p) } catch {
    # Diagnostic launches cannot turn a failed first launch into acceptance.
    $original=$_
    $diagnostic=@{original=$original.Exception.Message;exe=$exe;arguments=$arguments;registered=@(Get-AppxPackage -Name Vaultix.CLI | Select-Object PackageFullName,Version,Status)}
    if($exe -in @('vaultix.exe','vaultixl.exe') -and $arguments -eq 'version --json'){
      try {
        $p.FileName=Join-Path $env:LOCALAPPDATA ('Microsoft\WindowsApps\'+$exe)
        $retry=[Diagnostics.Process]::Start($p); $retry.StandardInput.Close()
        if(-not $retry.WaitForExit(10000)){$retry.Kill();throw 'Diagnostic absolute launch timed out'}
        $diagnostic.absolute=@{exit=$retry.ExitCode;output=$retry.StandardOutput.ReadToEnd();error=$retry.StandardError.ReadToEnd()}
      }catch{$diagnostic.absoluteError=$_.Exception.Message}
      try{$diagnostic.shell=(& $exe version --json 2>&1 | Out-String);$diagnostic.shellExit=$LASTEXITCODE}catch{$diagnostic.shellError=$_.Exception.Message}
    }
    $diagnostic.logs=@(Get-AppxLog | Select-Object -First 15 Time,ID,Message)
    $diagnostic | ConvertTo-Json -Depth 7 | Set-Content C:\VaultixOutput\launch-diagnostic.json
    throw $original
  }
}
function Native([string]$exe,[string]$arguments,[switch]$Refuse){
  $p=StartNative $exe $arguments; $p.StandardInput.Close()
  if(-not $p.WaitForExit(60000)){$p.Kill();throw 'Native command timed out'}
  $out=$p.StandardOutput.ReadToEnd(); $err=$p.StandardError.ReadToEnd()
  if($Refuse){if($p.ExitCode -eq 0){throw ('Expected command refusal: '+$arguments)}; return $err}
  if($p.ExitCode -ne 0){throw ('Native failed: '+$arguments+': '+$err)}
  return $out
}
try{
  if($env:USERNAME -ne 'WDAGUtilityAccount'){throw 'Disposable guest only'}
  $env:VAULTIX_DISABLE_UPDATE_CHECK='1'
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 260; Stop-Computer -Force"' | Out-Null
  New-Item -ItemType Directory C:\Probe | Out-Null
  Copy-Item C:\VaultixInput\*.msix C:\Probe\
  $cert=New-SelfSignedCertificate -Type Custom -Subject 'CN=Vaultix Disposable Probe' -KeyUsage DigitalSignature -FriendlyName 'Disposable Vaultix installation only' -CertStoreLocation Cert:\CurrentUser\My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
  $rev=[IO.File]::ReadAllText('C:\VaultixInput\revision.txt'); $seq=0
  foreach($v in @('1.2.3','1.2.4','1.2.5')){
    $seq++
    & C:\VaultixInput\signtool.exe sign /fd SHA256 /sha1 $cert.Thumbprint /s My "C:\Probe\$v.msix" > "C:\VaultixOutput\$v-sign.log" 2>&1
    if($LASTEXITCODE -ne 0){throw 'Guest-only signing failed'}
    Native C:\VaultixInput\fixture.exe "C:\Probe\$v $v $seq $rev C:\VaultixInput\$v.exe C:\Probe\$v.msix" | Out-Null
  }
  Mark 'guest-signed-v2-bundles'
  $bootstrap='C:\VaultixInput\1.2.3.exe'
  Native $bootstrap 'init --project packaging-install --env dev' | Out-Null
  $p=StartNative $bootstrap 'set FIXTURE_REFERENCE'; $p.StandardInput.WriteLine('DISPOSABLE-FIXTURE'); $p.StandardInput.Close()
  if(-not $p.WaitForExit(10000) -or $p.ExitCode -ne 0){throw 'Credential fixture failed'}
  $parent=Join-Path $env:APPDATA 'vaultix'; $root=Join-Path $parent 'cli-install'; $config=Join-Path $parent 'config.json'; $before=(Get-FileHash -LiteralPath $config).Hash
  $first='update install --bundle C:\Probe\1.2.3 --trust C:\Probe\1.2.3\trust.json --json'
  Native $bootstrap ($first+' --directory C:\Probe\elsewhere') -Refuse | Out-Null
  $acl=Get-Acl -LiteralPath $parent; $unsafe=Get-Acl -LiteralPath $parent
  $unsafe.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  Set-Acl -LiteralPath $parent -AclObject $unsafe
  Native $bootstrap $first -Refuse | Out-Null
  Set-Acl -LiteralPath $parent -AclObject $acl
  New-Item -ItemType Directory -Path $root | Out-Null; [IO.File]::WriteAllText((Join-Path $root 'sentinel'),'operator-owned')
  Native $bootstrap $first -Refuse | Out-Null
  if(@(Get-ChildItem -LiteralPath $root -Force).Count -ne 1){throw 'Unmanaged installation mutated'}
  Remove-Item -LiteralPath (Join-Path $root 'sentinel'); [IO.Directory]::Delete($root)
  New-Item -ItemType Directory C:\Probe\foreign | Out-Null
  New-Item -ItemType Junction -Path $root -Target C:\Probe\foreign | Out-Null
  Native $bootstrap $first -Refuse | Out-Null
  [IO.Directory]::Delete($root)
  Mark 'unsafe-directory-acl-unmanaged-and-junction-refused'
  # The signed release is trusted, but the OS publisher certificate is not yet.
  Native $bootstrap $first -Refuse | Out-Null
  if(Get-AppxPackage -Name Vaultix.CLI){throw 'Untrusted publisher installed'}
  $s=(Native $bootstrap 'update status --json') | ConvertFrom-Json
  if($s.verified -or $s.windows.state -ne 'prepared' -or $null -ne $s.windows.active){throw 'Untrusted package reported active'}
  Export-Certificate -Cert $cert -FilePath C:\Probe\publisher.cer | Out-Null
  Import-Certificate -FilePath C:\Probe\publisher.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
  $s=(Native $bootstrap $first) | ConvertFrom-Json
  if(-not $s.verified -or $s.windows.state -ne 'active' -or $s.version -ne '1.2.3' -or (Get-AppxPackage -Name Vaultix.CLI).Version -ne '0.0.0.1'){throw 'First installation not verified'}
  Mark 'os-trust-refusal-prepared-retry-and-native-install'
  $env:PATH=(Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps')+';'+$env:PATH
  foreach($exe in @('vaultix.exe','vaultixl.exe')){if(((Native $exe 'version --json')|ConvertFrom-Json).version -ne '1.2.3'){throw 'First native command mismatch'}; if((Native $exe 'ls') -notmatch 'FIXTURE_REFERENCE'){throw 'Credential access lost'}}
  $copy='C:\Probe\corrupt'; Copy-Item -LiteralPath C:\Probe\1.2.4 -Destination $copy -Recurse
  $file=Join-Path $copy 'vaultix-cli-windows-amd64.msix'; $data=[IO.File]::ReadAllBytes($file); $data[[int]($data.Length/2)]=$data[[int]($data.Length/2)] -bxor 255; [IO.File]::WriteAllBytes($file,$data)
  Native $bootstrap 'update install --bundle C:\Probe\corrupt --json' -Refuse | Out-Null
  if((Get-AppxPackage -Name Vaultix.CLI).Version -ne '0.0.0.1'){throw 'Corrupt package changed registration'}
  Mark 'both-native-commands-existing-credentials-and-corrupt-refusal'
  $held=StartNative 'vaultix.exe' 'login --token'; Start-Sleep -Milliseconds 300
  if($held.HasExited){throw 'Held native process exited'}
  $updater=StartNative 'vaultix.exe' 'update install --bundle C:\Probe\1.2.4 --json'
  $deadline=[DateTime]::UtcNow.AddSeconds(30); $observed=$false
  while(-not $updater.HasExited -and [DateTime]::UtcNow -lt $deadline){
    $state=Get-Content -Raw -LiteralPath (Join-Path $root 'state.json') | ConvertFrom-Json
    if($state.pending){$updater.Kill();$updater.WaitForExit();$observed=$true;break}
    Start-Sleep -Milliseconds 2
  }
  if(-not $observed){throw 'Did not kill a live updater after prepared-state publication'}
  if($held.HasExited -or (Get-AppxPackage -Name Vaultix.CLI).Version -ne '0.0.0.1'){throw 'Interrupted update lost the running old version'}
  $s=(Native $bootstrap 'update status --json')|ConvertFrom-Json
  if($s.verified -or $s.version -ne '1.2.4' -or $s.windows.active.version -ne '1.2.3'){throw 'Interrupted status is not truthful'}
  $s=(Native 'vaultix.exe' 'update install --bundle C:\Probe\1.2.4 --json')|ConvertFrom-Json
  if($s.verified -or $s.windows.state -ne 'pending-activation' -or $s.windows.active.version -ne '1.2.3' -or $held.HasExited){throw 'Deferred update state incorrect'}
  Mark 'killed-native-updater-reconciles-and-retries-without-forcing-exit'
  $held.StandardInput.Close(); if(-not $held.WaitForExit(10000)){throw 'Held command did not exit'}
  foreach($exe in @('vaultixl.exe','vaultix.exe')){if(((Native $exe 'version --json')|ConvertFrom-Json).version -ne '1.2.4'){throw 'Deferred native activation failed'}}
  $s=(Native 'vaultix.exe' 'update status --json')|ConvertFrom-Json
  if(-not $s.verified -or $s.windows.state -ne 'active' -or (Get-AppxPackage -Name Vaultix.CLI).Version -ne '0.0.0.2'){throw 'Active checkpoint reconciliation failed'}
  Native 'vaultix.exe' 'update install --bundle C:\Probe\1.2.3 --json' -Refuse | Out-Null
  $s=(Native 'vaultixl.exe' 'update install --bundle C:\Probe\1.2.4 --json')|ConvertFrom-Json
  if($s.changed -or -not $s.verified){throw 'Same-release retry changed the active installation'}
  Mark 'first-relaunch-both-commands-active-checkpoint-and-downgrade-refusal'
  $s=(Native 'vaultix.exe' 'update install --bundle C:\Probe\1.2.5 --json')|ConvertFrom-Json
  if($s.version -ne '1.2.5'){throw 'Subsequent self-update target differs'}
  foreach($exe in @('vaultix.exe','vaultixl.exe')){if(((Native $exe 'version --json')|ConvertFrom-Json).version -ne '1.2.5'){throw 'Subsequent native activation failed'}; if((Native $exe 'ls') -notmatch 'FIXTURE_REFERENCE'){throw 'Updated credential access lost'}}
  $s=(Native $bootstrap 'update status --json')|ConvertFrom-Json
  if(-not $s.verified -or $s.version -ne '1.2.5' -or (Get-AppxPackage -Name Vaultix.CLI).Version -ne '0.0.0.3'){throw 'Final status differs from independent OS state'}
  if((Get-FileHash -LiteralPath $config).Hash -ne $before){throw 'Encrypted configuration changed'}
  Mark 'subsequent-self-update-independent-os-state-and-unchanged-config'
  @{passed=$true;guestOnly=$true;steps=$steps;windowsVersion=[Environment]::OSVersion.Version.ToString();powershellVersion=$PSVersionTable.PSVersion.ToString();limitations=@('Disposable test signing only','Process interruption is not power-loss certification','No public release or operator deployment acceptance')} | ConvertTo-Json -Depth 5 | Set-Content C:\VaultixOutput\result.json
}catch{
  @{passed=$false;guestOnly=$true;steps=$steps;error=$_.Exception.Message;detail=$_.ToString();stack=$_.ScriptStackTrace}|ConvertTo-Json -Depth 5|Set-Content C:\VaultixOutput\result.json
}finally{if($held -and -not $held.HasExited){$held.Kill()};if($updater -and -not $updater.HasExited){$updater.Kill()};Stop-Computer -Force}
