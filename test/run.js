const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.test-output');
  const extensionPath = process.env.SECONDARY_TEST_EXTENSION_PATH || root;
  fs.mkdirSync(output, { recursive: true });
  const resultPath = path.join(output, 'result.json');
  fs.rmSync(resultPath, { force: true });
  const executable = process.env.VSCODE_EXECUTABLE || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
    : undefined);
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('Set VSCODE_EXECUTABLE to your VS Code executable.');
  }
  // A fresh isolated profile on each run also makes persisted layout assertions reliable.
  const profile = fs.mkdtempSync(path.join(output, 'profile-'));
  const workspace = fs.mkdtempSync(path.join(output, "workspace env's-"));
  execFileSync(process.env.PYTHON_EXECUTABLE || 'python', ['-m', 'venv', '--without-pip', path.join(workspace, '.venv')], {
    windowsHide: true, timeout: 30000
  });
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const debugPort = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const args = [
    `--extensionDevelopmentPath=${extensionPath}`,
    `--extensionTestsPath=${path.join(__dirname, 'integration.js')}`,
    `--user-data-dir=${profile}`,
    `--extensions-dir=${path.join(output, 'extensions')}`,
    `--remote-debugging-port=${debugPort}`,
    '--disable-extensions', '--disable-workspace-trust', '--disable-gpu',
    '--skip-welcome', '--skip-release-notes', '--new-window', workspace
  ];
  const env = { ...process.env };
  env.SECONDARY_TEST_DEBUG_PORT = String(debugPort);
  env.SECONDARY_TEST_OUTPUT = output;
  env.SECONDARY_TEST_WORKSPACE = workspace;
  delete env.ELECTRON_RUN_AS_NODE;
  let child;
  if (process.platform === 'win32') {
    env.SECONDARY_TEST_EXECUTABLE = executable;
    env.SECONDARY_TEST_ARGS = args.map((arg) => `"${arg}"`).join(' ');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$p = Start-Process -FilePath $env:SECONDARY_TEST_EXECUTABLE -ArgumentList $env:SECONDARY_TEST_ARGS -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode'
    ], { env, windowsHide: true, stdio: 'inherit' });
  } else {
    child = spawn(executable, args, { env, stdio: 'inherit' });
  }
  const timer = setTimeout(() => {
    console.error('VS Code integration test exceeded 120 seconds.');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill();
    }
  }, 120000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  assert.equal(code, 0, 'Extension host test exit code');
  assert.ok(fs.existsSync(resultPath), 'Integration test produced a result');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(result.passed, true);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
