param([switch]$Development)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if(-not $Development -and (git status --porcelain=v1 | Out-String).Trim()){throw 'Use a clean committed checkout for acceptance'}
if(Get-Process WindowsSandbox*,WindowsSandboxClient* -ErrorAction SilentlyContinue){throw 'An existing Sandbox must not be disturbed'}
$rev=(git rev-parse HEAD).Trim()
$evidence=Join-Path $repoRoot ('.cache\windows-cli-install-'+[guid]::NewGuid().ToString('N'))
$inputDir=(New-Item -ItemType Directory -Path (Join-Path $evidence 'input')).FullName
$outputDir=(New-Item -ItemType Directory -Path (Join-Path $evidence 'output')).FullName
$source=(New-Item -ItemType Directory -Path (Join-Path $evidence 'source')).FullName
$paths=@('cmd','internal','compose/embed.go','compose/vaultix.yml','compose/self.env.example','go.mod','go.sum','scripts/fixtures/windows-install')
$sourceFiles=@(git ls-files --cached --others --exclude-standard -- @paths) | Sort-Object -Unique
function SourceHashes { return @($sourceFiles | ForEach-Object { @{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $repoRoot $_)).Hash.ToLowerInvariant()} }) }
$snapshot=SourceHashes
if($Development){
  foreach($path in $sourceFiles){$target=Join-Path $source $path; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null; Copy-Item -LiteralPath (Join-Path $repoRoot $path) -Destination $target}
}else{
  $archive=Join-Path $evidence 'source.tar'
  & git -c core.autocrlf=false archive --format=tar --output=$archive $rev @paths
  if($LASTEXITCODE -ne 0){throw 'Source archive failed'}
  & tar -xf $archive -C $source
  if($LASTEXITCODE -ne 0){throw 'Source extraction failed'}
}
$sdk='C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
foreach($tool in @('AppxPackaging.dll','Microsoft.Windows.Build.Appx.AppxPackaging.dll.manifest','OpcServices.dll','Microsoft.Windows.Build.Appx.OpcServices.dll.manifest','AppxSip.dll','Microsoft.Windows.Build.Appx.AppxSip.dll.manifest','signtool.exe','signtool.exe.manifest','mssign32.dll','wintrust.dll','Microsoft.Windows.Build.Signing.mssign32.dll.manifest','Microsoft.Windows.Build.Signing.wintrust.dll.manifest')){Copy-Item -LiteralPath (Join-Path $sdk $tool) -Destination $inputDir}
& go -C $source build -buildvcs=false -trimpath -o (Join-Path $inputDir 'fixture.exe') ./scripts/fixtures/windows-install
if($LASTEXITCODE -ne 0){throw 'Fixture builder failed'}
Add-Type -AssemblyName System.Drawing
$artifacts=@(); $sequence=0
foreach($v in @('1.2.3','1.2.4','1.2.5')){
  $sequence++
  $layout=(New-Item -ItemType Directory -Path (Join-Path $evidence $v)).FullName
  & go -C $source build -p 2 -buildvcs=false -trimpath -ldflags "-X main.version=$v -X main.revision=$rev" -o (Join-Path $layout 'vaultix.exe') ./cmd/vaultix
  if($LASTEXITCODE -ne 0){throw 'Native fixture build failed'}
  Copy-Item -LiteralPath (Join-Path $layout 'vaultix.exe') -Destination (Join-Path $layout 'vaultixl.exe')
  Copy-Item -LiteralPath (Join-Path $layout 'vaultix.exe') -Destination (Join-Path $inputDir "$v.exe")
  $artifacts+=@{version=$v;sequence=$sequence;sha256=(Get-FileHash -LiteralPath (Join-Path $layout 'vaultix.exe')).Hash.ToLowerInvariant()}
  # Deliberately plain fixture artwork; this is not a production branding receipt.
  $bitmap=New-Object System.Drawing.Bitmap 150,150
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap); $graphics.Clear([System.Drawing.Color]::DarkSlateBlue)
  $bitmap.Save((Join-Path $layout 'Vaultix.png'),[System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose()
  $xml=[IO.File]::ReadAllText((Join-Path $source 'internal/release/windows-cli.xml')).Replace('{{PUBLISHER}}','CN=Vaultix Disposable Probe').Replace('{{VERSION}}',"0.0.0.$sequence")
  [IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'),$xml,[Text.UTF8Encoding]::new($false))
  & (Join-Path $sdk 'makeappx.exe') pack /d $layout /p (Join-Path $inputDir "$v.msix") /o > (Join-Path $evidence "$v-pack.log") 2>&1
  if($LASTEXITCODE -ne 0){throw 'MSIX packaging failed; retained log'}
}
[IO.File]::WriteAllText((Join-Path $inputDir 'revision.txt'),$rev)
Copy-Item -LiteralPath (Join-Path $source 'scripts/fixtures/windows-install/guest.ps1') -Destination (Join-Path $inputDir 'guest.ps1')
$inputXml=[Security.SecurityElement]::Escape($inputDir); $outputXml=[Security.SecurityElement]::Escape($outputDir)
@"
<Configuration><Networking>Disable</Networking><vGPU>Disable</vGPU><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><MemoryInMB>2048</MemoryInMB>
<MappedFolders><MappedFolder><HostFolder>$inputXml</HostFolder><SandboxFolder>C:\VaultixInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>$outputXml</HostFolder><SandboxFolder>C:\VaultixOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders>
<LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\VaultixInput\guest.ps1</Command></LogonCommand></Configuration>
"@ | Set-Content -LiteralPath (Join-Path $evidence 'test.wsb')
$report=@{passed=$false;development=[bool]$Development;revision=$rev;artifacts=$artifacts;sourceSnapshot=$snapshot;hostTrustModified=$false;evidence=$evidence;startedAt=[DateTime]::UtcNow.ToString('o')}
if(-not $Development){$report.sourceArchiveSha256=(Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant()}
$receipt=Join-Path $repoRoot '.cache/windows-cli-install.json'
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $receipt
Start-Process -FilePath "$env:WINDIR\System32\WindowsSandbox.exe" -ArgumentList ('"'+(Join-Path $evidence 'test.wsb')+'"') -WindowStyle Hidden | Out-Null
$result=Join-Path $outputDir 'result.json'; $deadline=[DateTime]::UtcNow.AddSeconds(300)
while(-not (Test-Path -LiteralPath $result)){if([DateTime]::UtcNow -gt $deadline){throw 'Guest acceptance timed out; watchdog shuts down only the disposable guest'}; Start-Sleep -Seconds 2}
$report.guest=Get-Content -Raw -LiteralPath $result | ConvertFrom-Json
$report.completedAt=[DateTime]::UtcNow.ToString('o')
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $receipt
$deadline=[DateTime]::UtcNow.AddSeconds(45)
while(Get-Process WindowsSandbox*,WindowsSandboxClient* -ErrorAction SilentlyContinue){if([DateTime]::UtcNow -gt $deadline){throw 'Guest shutdown not confirmed'}; Start-Sleep -Seconds 2}
$report.cleanupPassed=$true
if($report.guest.passed -ne $true){$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $receipt; throw ('Guest acceptance failed: '+$report.guest.error)}
if(($snapshot | ConvertTo-Json -Depth 4 -Compress) -ne ((SourceHashes) | ConvertTo-Json -Depth 4 -Compress)){throw 'Source changed during acceptance'}
if(-not $Development -and ((git rev-parse HEAD).Trim() -ne $rev -or (git status --porcelain=v1 | Out-String).Trim())){throw 'Committed source changed during acceptance'}
$report.passed=$true; $report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $receipt
@{passed=$true;development=[bool]$Development;receipt=$receipt;evidence=$evidence;steps=$report.guest.steps;cleanupPassed=$true} | ConvertTo-Json -Depth 5
