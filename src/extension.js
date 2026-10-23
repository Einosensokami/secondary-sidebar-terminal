const vscode = require('vscode');

class NativeTerminals {
  constructor(context) {
    this.context = context;
    this.terminals = new Set();
    this.active = undefined;
    const savedPids = context.workspaceState.get('nativeTerminalPids', []);
    this.ready = Promise.all(vscode.window.terminals.map(async (terminal) => {
      if (savedPids.includes(await terminal.processId)) this.track(terminal);
    }));
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (this.terminals.has(terminal)) this.active = terminal;
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        if (!this.terminals.delete(terminal)) return;
        if (this.active === terminal) this.active = [...this.terminals].at(-1);
        void this.save();
      })
    );
  }

  track(terminal) {
    this.terminals.add(terminal);
    this.active = terminal;
  }

  async save() {
    const pids = await Promise.all([...this.terminals].map((terminal) => terminal.processId));
    await this.context.workspaceState.update('nativeTerminalPids', pids.filter(Number.isInteger));
  }

  sideColumn() {
    const groups = vscode.window.tabGroups.all.filter((group) =>
      group.viewColumn > vscode.ViewColumn.One && group.tabs.length > 0 &&
      group.tabs.every((tab) => tab.input instanceof vscode.TabInputTerminal));
    return groups.at(-1)?.viewColumn ?? vscode.ViewColumn.Beside;
  }

  async open(createNew = false) {
    await this.ready;
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    if (!createNew && this.active) {
      this.active.show();
      return this.active;
    }
    if (!vscode.workspace.isTrusted) throw new Error('請先信任工作區，再開啟終端機。');
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    const folder = (editorUri && vscode.workspace.getWorkspaceFolder(editorUri)) ||
      vscode.workspace.workspaceFolders?.[0];
    const config = vscode.workspace.getConfiguration('secondaryTerminal', folder?.uri);
    const shellPath = config.get('shellPath');
    const shellArgs = config.get('shellArgs');
    const terminal = vscode.window.createTerminal({
      location: { viewColumn: this.sideColumn() },
      ...(folder ? { cwd: folder.uri } : {}),
      ...(shellPath ? { shellPath } : {}),
      ...(shellArgs?.length ? { shellArgs } : {})
    });
    this.track(terminal);
    terminal.show();
    await this.save();
    return terminal;
  }

  async close() {
    await this.ready;
    const terminal = this.active;
    if (!terminal) return;
    this.terminals.delete(terminal);
    this.active = [...this.terminals].at(-1);
    terminal.dispose();
    await this.save();
  }
}

function activate(context) {
  const terminals = new NativeTerminals(context);
  let pending = Promise.resolve();
  for (const [name, action] of [
    ['open', () => terminals.open()], ['new', () => terminals.open(true)], ['close', () => terminals.close()]
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(`secondaryTerminal.${name}`, () => {
      const result = pending.then(action);
      pending = result.catch(() => {});
      return result.catch((error) => {
        void vscode.window.showErrorMessage(`無法開啟原生終端機：${error.message || error}`);
        throw error;
      });
    }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('secondaryTerminal.restore', async () => {
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['terminal'], destinationId: 'terminal' });
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
  }));
}

module.exports = { activate };
