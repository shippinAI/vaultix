export type SnippetLanguage = "bash" | "powershell" | "text";

export type Snippet = {
  language: SnippetLanguage;
  code: string;
};

export type OS = "linux" | "macos" | "windows";
export type Pkcs11Tool = "jarsigner" | "osslsigncode" | "pkcs11-tool";

export type SignerAuth = { mode: "token"; token: string } | { mode: "machine-identity" };

const credLines = (auth: SignerAuth, shell: "powershell" | "bash"): string => {
  if (shell === "powershell") {
    return auth.mode === "token"
      ? `$env:VAULTIX_TOKEN = "${auth.token}"`
      : `$env:VAULTIX_UNIVERSAL_AUTH_CLIENT_ID = "<client-id>"
$env:VAULTIX_UNIVERSAL_AUTH_CLIENT_SECRET = "<client-secret>"`;
  }
  return auth.mode === "token"
    ? `export VAULTIX_TOKEN="${auth.token}"`
    : `export VAULTIX_UNIVERSAL_AUTH_CLIENT_ID="<client-id>"
export VAULTIX_UNIVERSAL_AUTH_CLIENT_SECRET="<client-secret>"`;
};

const PKCS11_RELEASES = "https://vaultix.shippin.cloud/releases/pkcs11";
const KSP_RELEASES = "https://vaultix.shippin.cloud/releases/ksp";

const isEcdsa = (keyAlgorithm?: string | null) =>
  Boolean(keyAlgorithm && keyAlgorithm.toUpperCase().startsWith("EC"));

// jarsigner picks the signature algorithm from the key type.
const jarsignerSigAlg = (keyAlgorithm?: string | null) =>
  isEcdsa(keyAlgorithm) ? "SHA256withECDSA" : "SHA256withRSA";

// ---- Standard signing tools (PKCS#11) --------------------------------------

export const pkcs11InstallSnippet = (os: OS): Snippet => {
  switch (os) {
    case "linux":
      return {
        language: "bash",
        code: `curl -L -o libvaultix-pkcs11.tar.gz \\
  ${PKCS11_RELEASES}/libvaultix-pkcs11-linux-amd64.so.tar.gz
tar -xzf libvaultix-pkcs11.tar.gz`
      };
    case "macos":
      return {
        language: "bash",
        code: `curl -L -o libvaultix-pkcs11.tar.gz \\
  ${PKCS11_RELEASES}/libvaultix-pkcs11-darwin-arm64.dylib.tar.gz
tar -xzf libvaultix-pkcs11.tar.gz`
      };
    case "windows":
    default:
      return {
        language: "powershell",
        code: `Invoke-WebRequest \`
  -Uri "${PKCS11_RELEASES}/libvaultix-pkcs11-windows-amd64.dll.zip" \`
  -OutFile "libvaultix-pkcs11.zip"
Expand-Archive libvaultix-pkcs11.zip -DestinationPath . -Force`
      };
  }
};

export const pkcs11ConfigureSnippet = (os: OS, serverUrl: string, auth: SignerAuth): Snippet => {
  if (os === "windows") {
    return {
      language: "powershell",
      code: `New-Item -ItemType Directory -Force -Path "$env:ProgramData\\Vaultix" | Out-Null
'{ "server_url": "${serverUrl}" }' | Set-Content "$env:ProgramData\\Vaultix\\pkcs11.conf"
$env:VAULTIX_CONFIG = "$env:ProgramData\\Vaultix\\pkcs11.conf"
${credLines(auth, "powershell")}`
    };
  }
  return {
    language: "bash",
    code: `sudo mkdir -p /etc/vaultix
echo '{ "server_url": "${serverUrl}" }' | sudo tee /etc/vaultix/pkcs11.conf > /dev/null
${credLines(auth, "bash")}`
  };
};

export const jarsignerConfigSnippet = (os: OS): Snippet => {
  if (os === "windows") {
    return {
      language: "powershell",
      code: `@"
name = Vaultix
library = C:/path/to/libvaultix-pkcs11.dll
"@ | Set-Content vaultix-pkcs11.cfg`
    };
  }
  const ext = os === "macos" ? "dylib" : "so";
  return {
    language: "bash",
    code: `cat > vaultix-pkcs11.cfg <<EOF
name = Vaultix
library = /path/to/libvaultix-pkcs11.${ext}
EOF`
  };
};

export const pkcs11SignSnippet = (
  tool: Pkcs11Tool,
  signerName: string,
  keyAlgorithm?: string | null
): Snippet => {
  switch (tool) {
    case "jarsigner":
      return {
        language: "bash",
        code: `jarsigner -keystore NONE -storetype PKCS11 \\
  -addprovider SunPKCS11 -providerArg vaultix-pkcs11.cfg \\
  -sigalg ${jarsignerSigAlg(keyAlgorithm)} \\
  myapp.jar "${signerName}"`
      };
    case "osslsigncode":
      return {
        language: "bash",
        code: `osslsigncode sign \\
  -pkcs11module /path/to/libvaultix-pkcs11.so \\
  -pkcs11cert "pkcs11:object=${signerName};type=cert" \\
  -key "pkcs11:object=${signerName};type=private" \\
  -h sha256 \\
  -in MyApp.exe -out MyApp-signed.exe`
      };
    case "pkcs11-tool":
    default:
      return {
        language: "bash",
        code: "pkcs11-tool --module ./libvaultix-pkcs11.so --list-slots"
      };
  }
};

// ---- Windows signtool (native KSP) -----------------------------------------

export const kspDownloadSnippet = (): Snippet => ({
  language: "powershell",
  code: `Invoke-WebRequest -Uri "${KSP_RELEASES}/vaultix-ksp.dll" -OutFile "vaultix-ksp.dll"`
});

// Registering a CNG Key Storage Provider is a few registry entries plus dropping the DLL in
// System32.
export const kspRegisterSnippet = (): Snippet => ({
  language: "powershell",
  code: `$prov = "Vaultix Key Storage Provider"
$base = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Cryptography"
Copy-Item .\\vaultix-ksp.dll "$env:windir\\System32\\vaultix-ksp.dll" -Force
New-Item -Path "$base\\Providers\\$prov\\UM\\00010001" -Force | Out-Null
New-ItemProperty -Path "$base\\Providers\\$prov\\UM" -Name Image -PropertyType String -Value "vaultix-ksp.dll" -Force | Out-Null
Set-ItemProperty -Path "$base\\Providers\\$prov\\UM\\00010001" -Name "(default)" -Value "CRYPT_KEY_STORAGE_INTERFACE"
New-ItemProperty -Path "$base\\Providers\\$prov\\UM\\00010001" -Name Flags -PropertyType DWord -Value 0x10000 -Force | Out-Null
New-ItemProperty -Path "$base\\Providers\\$prov\\UM\\00010001" -Name Functions -PropertyType MultiString -Value @("KEY_STORAGE") -Force | Out-Null
$iface = "$base\\Configuration\\Local\\Default\\00010001\\KEY_STORAGE"
$cur = @((Get-ItemProperty $iface).Providers)
if ($cur -notcontains $prov) { Set-ItemProperty -Path $iface -Name Providers -Value ($cur + $prov) }`
});

export const kspConfigureSnippet = (serverUrl: string, auth: SignerAuth): Snippet => ({
  language: "powershell",
  code: `New-Item -ItemType Directory -Force -Path "$env:ProgramData\\Vaultix" | Out-Null
'{ "server_url": "${serverUrl}" }' | Set-Content "$env:ProgramData\\Vaultix\\config.json"
${credLines(auth, "powershell")}`
});

export const kspCertSnippet = (signerName: string, certPem?: string): Snippet => {
  const pem =
    certPem?.trim() ||
    `-----BEGIN CERTIFICATE-----
(loading this Signer's certificate...)
-----END CERTIFICATE-----`;
  return {
    language: "powershell",
    code: `$certPem = @"
${pem}
"@
Set-Content -Path "$env:ProgramData\\Vaultix\\${signerName}.cer" -Value $certPem -Encoding ascii`
  };
};

export const kspSignSnippet = (signerName: string): Snippet => ({
  language: "powershell",
  code: `signtool sign /fd SHA256 \`
  /f "$env:ProgramData\\Vaultix\\${signerName}.cer" \`
  /csp "Vaultix Key Storage Provider" /kc "${signerName}" \`
  MyApp.exe`
});
