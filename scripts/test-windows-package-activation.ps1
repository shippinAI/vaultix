param([ValidateSet('vaultix','vaultixl')][string]$FirstCommand='vaultix')
$ErrorActionPreference = 'Stop'
$repoRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if ((git status --porcelain=v1 | Out-String).Trim()) {throw 'Use a clean committed checkout'}
if (Get-Process WindowsSandbox*,WindowsSandboxClient* -ErrorAction SilentlyContinue) { throw 'An existing Sandbox must not be disturbed.' }
$probeRoot = Join-Path (Get-Location) ('.cache\windows-package-' + [guid]::NewGuid().ToString('N'))
$probeInput = (New-Item -ItemType Directory -Path (Join-Path $probeRoot 'input')).FullName
$probeOutput = (New-Item -ItemType Directory -Path (Join-Path $probeRoot 'output')).FullName
$sdk = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
foreach ($tool in @('AppxPackaging.dll', 'Microsoft.Windows.Build.Appx.AppxPackaging.dll.manifest', 'OpcServices.dll', 'Microsoft.Windows.Build.Appx.OpcServices.dll.manifest', 'AppxSip.dll', 'Microsoft.Windows.Build.Appx.AppxSip.dll.manifest', 'signtool.exe', 'signtool.exe.manifest', 'mssign32.dll', 'wintrust.dll', 'Microsoft.Windows.Build.Signing.mssign32.dll.manifest', 'Microsoft.Windows.Build.Signing.wintrust.dll.manifest')) {
  Copy-Item -LiteralPath (Join-Path $sdk $tool) -Destination $probeInput
}
$rev = (git rev-parse HEAD).Trim()
$source = (New-Item -ItemType Directory -Path (Join-Path $probeRoot 'source')).FullName
$archive = Join-Path $probeRoot 'source.tar'
git -c core.autocrlf=false archive --format=tar --output=$archive $rev cmd internal compose/embed.go compose/vaultix.yml compose/self.env.example go.mod go.sum
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed' }
tar -xf $archive -C $source
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed' }
Add-Type -AssemblyName System.Drawing
$artifacts=@()
foreach ($v in @('1.2.3','1.2.4')) {
  $layout = (New-Item -ItemType Directory -Path (Join-Path $probeRoot $v)).FullName
  & go -C $source build -p 2 -buildvcs=false -trimpath -ldflags "-X main.version=$v -X main.revision=$rev" -o (Join-Path $layout 'vaultix.exe') ./cmd/vaultix
  if ($LASTEXITCODE -ne 0) { throw 'Native fixture build failed' }
  Copy-Item -LiteralPath (Join-Path $layout 'vaultix.exe') -Destination (Join-Path $layout 'vaultixl.exe')
  $artifacts+=@{version=$v;sha256=(Get-FileHash -LiteralPath (Join-Path $layout 'vaultix.exe') -Algorithm SHA256).Hash.ToLowerInvariant()}
  $bitmap = New-Object System.Drawing.Bitmap 150,150
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::DarkSlateBlue)
  $bitmap.Save((Join-Path $layout 'Probe.png'),[System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
  @"
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" xmlns:uap17="http://schemas.microsoft.com/appx/manifest/uap/windows10/17" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" xmlns:virtualization="http://schemas.microsoft.com/appx/manifest/virtualization/windows10" IgnorableNamespaces="uap uap5 uap10 uap17 rescap virtualization">
  <Identity Name="Vaultix.CLI.Probe" Publisher="CN=Vaultix Disposable Probe" Version="$v.0" ProcessorArchitecture="x64" />
  <Properties><DisplayName>Vaultix CLI probe</DisplayName><PublisherDisplayName>Vaultix disposable probe</PublisherDisplayName><Logo>Probe.png</Logo><uap17:UpdateWhileInUse>defer</uap17:UpdateWhileInUse><virtualization:FileSystemWriteVirtualization><virtualization:ExcludedDirectories><virtualization:ExcludedDirectory>`$(KnownFolder:RoamingAppData)\vaultix</virtualization:ExcludedDirectory></virtualization:ExcludedDirectories></virtualization:FileSystemWriteVirtualization></Properties>
  <Resources><Resource Language="en-us"/></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.26100.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Applications>
    <Application Id="Vaultix" Executable="vaultix.exe" uap10:Subsystem="console" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL" uap10:SupportsMultipleInstances="true">
      <uap:VisualElements DisplayName="Vaultix probe" Description="Disposable packaging probe" BackgroundColor="transparent" Square150x150Logo="Probe.png" Square44x44Logo="Probe.png" />
      <Extensions><uap5:Extension Category="windows.appExecutionAlias"><uap5:AppExecutionAlias uap10:Subsystem="console"><uap5:ExecutionAlias Alias="vaultix.exe" /></uap5:AppExecutionAlias></uap5:Extension></Extensions>
    </Application>
    <Application Id="Vaultixl" Executable="vaultixl.exe" uap10:Subsystem="console" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL" uap10:SupportsMultipleInstances="true">
      <uap:VisualElements DisplayName="Vaultixl probe" Description="Disposable packaging probe" BackgroundColor="transparent" Square150x150Logo="Probe.png" Square44x44Logo="Probe.png" />
      <Extensions><uap5:Extension Category="windows.appExecutionAlias"><uap5:AppExecutionAlias uap10:Subsystem="console"><uap5:ExecutionAlias Alias="vaultixl.exe" /></uap5:AppExecutionAlias></uap5:Extension></Extensions>
    </Application>
  </Applications>
  <Capabilities><rescap:Capability Name="runFullTrust"/><rescap:Capability Name="unvirtualizedResources"/></Capabilities>
</Package>
"@ | Set-Content -LiteralPath (Join-Path $layout 'AppxManifest.xml') -Encoding UTF8
  & (Join-Path $sdk 'makeappx.exe') pack /d $layout /p (Join-Path $probeInput "$v.msix") /o | Out-File (Join-Path $probeRoot "$v-pack.log")
  if ($LASTEXITCODE -ne 0) { throw 'MSIX packaging failed; retained log.' }
}
Copy-Item -LiteralPath (Join-Path $probeRoot '1.2.3\vaultix.exe') -Destination (Join-Path $probeInput 'portable.exe')
Copy-Item -LiteralPath scripts/fixtures/windows-package/guest.ps1 -Destination (Join-Path $probeInput 'probe.ps1')
$inputXml = [System.Security.SecurityElement]::Escape($probeInput)
$outputXml = [System.Security.SecurityElement]::Escape($probeOutput)
@"
<Configuration><Networking>Disable</Networking><vGPU>Disable</vGPU><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><MemoryInMB>2048</MemoryInMB>
<MappedFolders><MappedFolder><HostFolder>$inputXml</HostFolder><SandboxFolder>C:\VaultixInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>$outputXml</HostFolder><SandboxFolder>C:\VaultixOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders>
<LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\VaultixInput\probe.ps1 -FirstCommand $FirstCommand</Command></LogonCommand></Configuration>
"@ | Set-Content -LiteralPath (Join-Path $probeRoot 'probe.wsb')
$process = Start-Process -FilePath "$env:WINDIR\System32\WindowsSandbox.exe" -ArgumentList ('"' + (Join-Path $probeRoot 'probe.wsb') + '"') -WindowStyle Hidden -PassThru

$receipt=Join-Path $repoRoot ('.cache/windows-package-'+$FirstCommand+'.json')
$report=@{passed=$false;revision=$rev;artifacts=$artifacts;firstCommand=$FirstCommand;hostTrustModified=$false;evidence=$probeRoot;startedAt=[DateTime]::UtcNow.ToString('o');sourceArchiveSha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receipt
$result=Join-Path $probeOutput 'result.json'
$deadline=[DateTime]::UtcNow.AddSeconds(240)
while(-not (Test-Path -LiteralPath $result)) {
  if([DateTime]::UtcNow -gt $deadline){throw 'Guest acceptance timed out; retained evidence. Guest watchdog shuts down only the disposable guest.'}
  Start-Sleep -Seconds 2
}
$guest=Get-Content -Raw -LiteralPath $result | ConvertFrom-Json
$report.guest=$guest
$report.completedAt=[DateTime]::UtcNow.ToString('o')
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receipt
if($guest.passed -ne $true){throw ('Guest acceptance failed: '+$guest.error)}
# The guest shuts itself down. Do not terminate unrelated host processes.
$shutdownDeadline=[DateTime]::UtcNow.AddSeconds(45)
while(Get-Process WindowsSandbox*,WindowsSandboxClient* -ErrorAction SilentlyContinue) {
  if([DateTime]::UtcNow -gt $shutdownDeadline){throw 'Guest shutdown not confirmed; retain fixture evidence'}
  Start-Sleep -Seconds 2
}
$report.cleanupPassed=$true
if ((git rev-parse HEAD).Trim() -ne $rev -or (git status --porcelain=v1 | Out-String).Trim()) {throw 'Source changed during package acceptance'}
$report.passed=$true
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receipt
Get-Content -LiteralPath $receipt
