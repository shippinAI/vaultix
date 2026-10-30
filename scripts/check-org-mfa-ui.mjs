import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../core/frontend/', import.meta.url));
for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.app.json'],
  ['node_modules/eslint/bin/eslint.js', 'src/pages/organization/SettingsPage/components/OrgSecurityTab/OrgGenericAuthSection.tsx']
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
