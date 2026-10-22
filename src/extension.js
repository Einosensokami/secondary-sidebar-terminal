const vscode = require('vscode');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { findEnvironment, activationCommand } = require('./python-environment');

const VIEW_ID = 'secondaryTerminal.launcher';

class SidebarTerminal {
  constructor(context) {
    this.context = context;
    this.sessions = new Map();
    this.nextId = 1;
    this.activeId = undefined;
    this.ready = false;
    this.disposables = [];
    this.creating = undefined;
    this.disposed = false;
  }

  resolveWebviewView(view) {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    const uri = (file) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
    const nonce = crypto.randomBytes(24).toString('base64');
    view.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${view.webview.cspSource};">
<link href="${uri('xterm.css')}" rel="stylesheet"><link href="${uri('terminal.css')}" rel="stylesheet"></head>
<body data-sidebar-terminal="true">
<div id="toolbar"><select id="sessions" aria-label="側欄終端機"></select><button id="scroll-up" title="往上翻一頁" aria-label="往上翻一頁">↑</button><button id="scroll-down" title="往下翻一頁" aria-label="往下翻一頁">↓</button><button id="new" title="新增終端機" aria-label="新增終端機">＋</button><button id="close" title="關閉目前終端機" aria-label="關閉目前終端機">×</button></div>
<div id="empty">尚未開啟終端機。<button id="start">開啟終端機</button></div>
<div id="terminal"></div><div id="status" role="status"></div>
<script nonce="${nonce}" src="${uri('xterm.js')}"></script><script nonce="${nonce}" src="${uri('addon-fit.js')}"></script><script nonce="${nonce}" src="${uri('terminal.js')}"></script>
</body></html>`;
    this.disposables.push(view.webview.onDidReceiveMessage((message) => {
      void this.onMessage(message).catch((error) => this.report(error));
    }));
    this.disposables.push(view.onDidDispose(() => {
      if (this.view === view) { this.view = undefined; this.ready = false; }
    }));
  }

  post(message) {
    if (this.ready && this.view) void this.view.webview.postMessage(message);
  }

  snapshot() {
    if (this.view) this.view.title = this.sessions.get(this.activeId)?.title || 'Sidebar Terminal';
    this.post({ type: 'sessions',
      sessions: [...this.sessions.values()].map(({ id, title, exitCode }) => ({ id, title, exitCode })),
      activeId: this.activeId });
  }

  async onMessage(message) {
    if (!message || typeof message !== 'object') return;
    const session = this.sessions.get(message.id);
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.ensureSession();
        this.snapshot();
        for (const item of this.sessions.values()) this.post({ type: 'reset', id: item.id, data: item.history });
        break;
      case 'new': await this.create(); break;
      case 'close': this.close(message.id); break;
      case 'select':
        if (session) { this.activeId = session.id; this.snapshot(); }
        break;
      case 'title':
        if (session && typeof message.title === 'string') {
          const title = message.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 512) || session.defaultTitle;
          if (title !== session.title) {
            session.title = title;
            // A title update must not rebuild the session list and refocus the terminal.
            this.post({ type: 'title', id: session.id, title });
            if (this.view && session.id === this.activeId) this.view.title = title;
          }
        }
        break;
      case 'input':
        if (session?.pty && typeof message.data === 'string' && message.data.length <= 1024 * 1024) session.pty.write(message.data);
        break;
      case 'resize':
        if (session?.pty && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
          session.pty.resize(Math.max(2, Math.min(1000, message.cols)), Math.max(1, Math.min(1000, message.rows)));
        }
        break;
      case 'copy':
        if (typeof message.text === 'string') void vscode.env.clipboard.writeText(message.text);
        break;
      case 'paste': {
        const id = message.id;
        void vscode.env.clipboard.readText().then((text) => this.post({ type: 'paste', id, text }));
        break;
      }
    }
  }

  async selectedPython(folder) {
    const extension = vscode.extensions.getExtension('ms-python.python');
    if (!extension) return undefined;
    // Optional integration must not prevent a terminal from opening if Python is slow or unavailable.
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const api = await extension.activate();
          await api.ready;
          return api.environments?.getActiveEnvironmentPath(folder?.uri)?.path;
        })(),
        new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), 3000); })
      ]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async ensureSession() {
    if (this.sessions.size) return;
    if (!this.creating) this.creating = this.create().finally(() => { this.creating = undefined; });
    return this.creating;
  }

  async create() {
    if (!vscode.workspace.isTrusted) throw new Error('請先信任工作區，再開啟終端機。');
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = editorUri ? vscode.workspace.getWorkspaceFolder(editorUri) : undefined;
    const folder = activeFolder?.uri.scheme === 'file' ? activeFolder : vscode.workspace.workspaceFolders?.find((item) => item.uri.scheme === 'file');
    const config = vscode.workspace.getConfiguration('secondaryTerminal', folder?.uri);
    const shell = config.get('shellPath') || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh');
    const args = config.get('shellArgs', []);
    const cwd = folder?.uri.fsPath || os.homedir();
    let activation;
    if (folder && config.get('autoActivateEnvironment', true)) {
      const selected = await this.selectedPython(folder);
      const defaultInterpreter = vscode.workspace.getConfiguration('python', folder.uri).get('defaultInterpreterPath');
      const environment = await findEnvironment(cwd, selected, config.get('environmentPath'), defaultInterpreter);
      activation = await activationCommand(environment, shell);
    }
    if (this.disposed) return;
    const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
    delete env.ELECTRON_RUN_AS_NODE;
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    const pty = require('node-pty').spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd, env });
    const id = String(this.nextId++);
    const defaultTitle = `${path.basename(shell)} ${id}`;
    const session = { id, title: defaultTitle, defaultTitle, pty, history: '', subscriptions: [], exitCode: undefined };
    this.sessions.set(id, session);
    this.activeId = id;
    session.subscriptions.push(pty.onData((data) => {
      session.history = (session.history + data).slice(-1024 * 1024);
      this.post({ type: 'data', id, data });
    }));
    session.subscriptions.push(pty.onExit(({ exitCode }) => {
      session.pty = undefined;
      session.exitCode = exitCode;
      const data = `\r\n[程序已結束，結束碼 ${exitCode}]\r\n`;
      session.history += data;
      this.post({ type: 'data', id, data });
      this.snapshot();
    }));
    // Queue activation before user input. node-pty waits until the shell is ready.
    if (activation) pty.write(activation);
    this.snapshot();
    return session;
  }

  close(id = this.activeId) {
    const session = this.sessions.get(id);
    if (!session) return;
    for (const item of session.subscriptions) item.dispose();
    if (session.pty) session.pty.kill();
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = [...this.sessions.keys()].at(-1);
    this.post({ type: 'removed', id });
    this.snapshot();
  }

  async open(createNew = false) {
    const hadSessions = this.sessions.size > 0;
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    if (createNew && hadSessions) await this.create();
    else await this.ensureSession();
    this.post({ type: 'focus' });
  }

  report(error) {
    const text = `無法開啟側欄終端機：${error.message || error}`;
    this.post({ type: 'error', text });
    void vscode.window.showErrorMessage(text);
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.sessions.keys()]) this.close(id);
    for (const item of this.disposables) item.dispose();
  }
}

function activate(context) {
  const provider = new SidebarTerminal(context);
  context.subscriptions.push(provider, vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
    webviewOptions: { retainContextWhenHidden: true }
  }));
  let pending = Promise.resolve();
  for (const [name, action] of [
    ['open', () => provider.open()], ['new', () => provider.open(true)], ['close', () => provider.close()]
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(`secondaryTerminal.${name}`, () => {
      const result = pending.then(action);
      pending = result.catch(() => {});
      return result.catch((error) => { provider.report(error); throw error; });
    }));
  }
  // Explicit recovery for users upgrading from 0.1, which moved the native view.
  // Normal sidebar commands never invoke this or change native terminal layout.
  context.subscriptions.push(vscode.commands.registerCommand('secondaryTerminal.restore', async () => {
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['terminal'], destinationId: 'terminal' });
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
  }));
}

module.exports = { activate };
