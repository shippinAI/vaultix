import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const backend = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL(process.platform === 'win32' ? '../vaultix-transport.exe' : '../vaultix-transport', import.meta.url));
execFileSync('go', ['build', '-trimpath', '-o', output, './cmd/vaultix-transport'], {
  cwd: fileURLToPath(new URL('../../backend-go', import.meta.url)),
  env: {...process.env, CGO_ENABLED: '0'},
  stdio: 'inherit',
  windowsHide: true
});
console.log(`Built Vaultix gateway transport for ${process.platform}/${process.arch} in ${backend}`);
