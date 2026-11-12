import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {accessSync,constants,existsSync} from 'node:fs';
import {join} from 'node:path';

const backend = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL(process.platform === 'win32' ? '../vaultix-transport.exe' : '../vaultix-transport', import.meta.url));
const source=fileURLToPath(new URL('../../backend-go', import.meta.url));
if(existsSync(join(source,'go.mod'))) {
  execFileSync('go', ['build', '-trimpath', '-o', output, './cmd/vaultix-transport'], {
    cwd: source,
    env: {...process.env, CGO_ENABLED: '0'},
    stdio: 'inherit',
    windowsHide: true
  });
  console.log(`Built Vaultix gateway transport for ${process.platform}/${process.arch} in ${backend}`);
} else {
  // Development containers package the same source-built executable. Source-only
  // host development always rebuilds above so a stale binary is never preferred.
  accessSync(output,constants.X_OK);
  console.log('Using the Vaultix transport compiled into this development image.');
}
