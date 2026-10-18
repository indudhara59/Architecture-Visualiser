import * as path from 'node:path';
import * as fs from 'node:fs';
import { runTests } from '@vscode/test-electron';

// Uses a locally installed VS Code when available (VSCODE_EXECUTABLE or the macOS default), else downloads one.
const MAC_CODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

async function main() {
  const root = path.resolve(__dirname, '../..');
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE ?? (fs.existsSync(MAC_CODE) ? MAC_CODE : undefined);
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'out/integration/suite.js'),
    launchArgs: [path.join(root, 'test/fixtures/ts-app'), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
