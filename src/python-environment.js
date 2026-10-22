const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function isFile(file) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}

async function environmentAt(candidate, cwd) {
  if (!candidate || typeof candidate !== 'string') return undefined;
  const expanded = candidate.replace(/\$\{workspaceFolder\}/g, cwd).replace(/^~(?=[\\/]|$)/, os.homedir());
  const absolute = path.resolve(cwd, expanded);
  const roots = [absolute, path.dirname(absolute), path.dirname(path.dirname(absolute))];
  for (const root of roots) {
    if (!await isFile(path.join(root, 'pyvenv.cfg'))) continue;
    const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
    const python = path.join(root, bin, process.platform === 'win32' ? 'python.exe' : 'python');
    if (await isFile(python)) return { root, python, name: path.basename(root) };
  }
  return undefined;
}

async function findEnvironment(cwd, selectedPath, configuredPath, defaultInterpreter) {
  for (const candidate of [configuredPath, selectedPath, defaultInterpreter, '.venv', 'venv', 'env', '.env']) {
    const environment = await environmentAt(candidate, cwd);
    if (environment) return environment;
  }
  return undefined;
}

async function activationCommand(environment, shell) {
  if (!environment) return undefined;
  const name = path.basename(shell).toLowerCase().replace(/\.exe$/, '');
  const quote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
  let file;
  let command;
  if (name === 'powershell' || name === 'pwsh') {
    file = path.join(environment.root, process.platform === 'win32' ? 'Scripts' : 'bin', 'Activate.ps1');
    command = `. '${file.replace(/'/g, "''")}'`;
  } else if (name === 'cmd') {
    file = path.join(environment.root, 'Scripts', 'activate.bat');
    // CMD expands these characters even inside quotes. Do not evaluate such paths.
    if (/[%!"\r\n]/.test(file)) return undefined;
    command = `call "${file}"`;
  } else if (['bash', 'zsh', 'sh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'].includes(name)) {
    const suffix = name === 'fish' ? '.fish' : ['csh', 'tcsh'].includes(name) ? '.csh' : '';
    file = path.join(environment.root, 'bin', `activate${suffix}`);
    command = `${['fish', 'csh', 'tcsh'].includes(name) ? 'source' : '.'} ${quote(file)}`;
  }
  return file && await isFile(file) ? `${command}\r` : undefined;
}

module.exports = { environmentAt, findEnvironment, activationCommand };
