const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { findEnvironment, activationCommand } = require('../src/python-environment');

test('discover valid environments, honor selection, and safely quote activation paths', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sidebar env's-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  async function fixture(name) {
    const root = path.join(cwd, name);
    const bin = path.join(root, process.platform === 'win32' ? 'Scripts' : 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(root, 'pyvenv.cfg'), 'home = test-fixture');
    const python = path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python');
    await fs.writeFile(python, 'fixture');
    await fs.writeFile(path.join(bin, 'Activate.ps1'), 'fixture');
    await fs.writeFile(path.join(root, 'Scripts', 'activate.bat'), 'fixture').catch(() => {});
    return { root, python };
  }
  assert.equal(await findEnvironment(cwd), undefined, 'No environment returns undefined');
  await fs.mkdir(path.join(cwd, '.venv'));
  assert.equal(await findEnvironment(cwd), undefined, 'An arbitrary folder is not a virtual environment');
  const local = await fixture('.venv');
  const other = await fixture('custom environment');
  assert.equal((await findEnvironment(cwd)).root, local.root);
  assert.equal((await findEnvironment(cwd, other.python)).root, other.root, 'Python selection wins over local discovery');
  assert.equal((await findEnvironment(cwd, local.python, other.root)).root, other.root, 'Explicit override wins over Python selection');
  assert.equal((await findEnvironment(cwd, other.python, undefined, local.python)).root, other.root, 'Selection wins over default interpreter setting');
  const environment = await findEnvironment(cwd, other.python);
  const command = await activationCommand(environment, 'powershell.exe');
  assert.ok(command.startsWith(". '"));
  assert.ok(command.includes("env''s-"), 'Single quotes in PowerShell paths are escaped');
  assert.equal(await activationCommand(environment, 'unknown-shell'), undefined);
  await fs.rm(path.join(other.root, process.platform === 'win32' ? 'Scripts' : 'bin', 'Activate.ps1'));
  assert.equal(await activationCommand(environment, 'pwsh'), undefined, 'Missing activation script is not executed');
});
