const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [from, to] of [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/xterm/LICENSE', 'xterm.LICENSE'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
  ['@xterm/addon-fit/LICENSE', 'addon-fit.LICENSE']
]) fs.copyFileSync(path.join(root, 'node_modules', from), path.join(root, 'media', to));
