const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { chromium } = require('playwright-core');

async function until(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function run() {
  const output = process.env.SECONDARY_TEST_OUTPUT;
  const extension = vscode.extensions.getExtension('local-tools.secondary-sidebar-terminal');
  await extension.activate();
  await vscode.workspace.getConfiguration('editor').update('accessibilitySupport', 'on', vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('terminal.integrated').update('scrollback', 10000, vscode.ConfigurationTarget.Global);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.SECONDARY_TEST_DEBUG_PORT}`);
  const page = browser.contexts()[0].pages().find((item) => item.url().includes('workbench'));
  assert.ok(page);
  const bottom = vscode.window.createTerminal({
    name: 'Bottom tests', shellPath: 'powershell.exe', shellArgs: ['-NoLogo', '-NoProfile'],
    location: vscode.TerminalLocation.Panel
  });

  async function command(terminal, expression, name) {
    const file = path.join(output, `${name}.txt`);
    fs.rmSync(file, { force: true });
    terminal.sendText(`& { ${expression} } | Out-File -LiteralPath '${file.replace(/'/g, "''")}' -Encoding utf8`);
    await until(() => fs.existsSync(file) && fs.statSync(file).size > 0, name);
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  }

  try {
    const document = await vscode.workspace.openTextDocument({ content: 'Code stays here. Native terminals run on the right and below.' });
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    bottom.show(true);
    const bottomPid = await bottom.processId;
    await command(bottom, '$PID', 'bottom-before');

    const right = await vscode.commands.executeCommand('secondaryTerminal.open');
    assert.ok(vscode.window.terminals.includes(right), 'Right terminal is registered with VS Code');
    assert.notEqual(await right.processId, bottomPid, 'Bottom and right have independent shells');
    assert.equal(right.creationOptions.shellPath, undefined, 'Default shell uses VS Code profiles');
    await until(() => vscode.window.tabGroups.all.some((group) => group.viewColumn > 1 &&
      group.tabs.some((tab) => tab.input instanceof vscode.TabInputTerminal)), 'native terminal opens in a right editor group');
    const rightGroup = vscode.window.tabGroups.all.find((group) => group.viewColumn > 1 &&
      group.tabs.some((tab) => tab.input instanceof vscode.TabInputTerminal));
    await until(async () => await page.locator('.part.editor .codicon-lock').count() > 0,
      'native terminal group locks automatically');
    assert.equal(await page.locator('.part.panel .xterm').count(), 1, 'Native bottom terminal stays in the panel');
    assert.equal(await page.locator('.part.editor .xterm').count(), 1, 'Right terminal uses the native editor renderer');
    assert.equal(page.frames().filter((frame) => frame.url().includes('vscode-webview')).length, 0, 'No custom terminal webview');
    const terminalGroup = page.locator('.part.editor .editor-group-container').filter({ has: page.locator('.xterm') });
    await until(async () => Math.abs((await terminalGroup.boundingBox()).width - 300) < 8,
      'new terminal group uses sidebar-like width');

    await command(bottom, '$PID', 'bottom-alongside');

    right.sendText('[Console]::Write((1..6000 | ForEach-Object { "NATIVE-HISTORY-$_" }) -join "`r`n"); [Console]::WriteLine()');
    const rows = page.locator('.part.editor .xterm-accessibility-tree');
    await until(async () => (await rows.textContent()).includes('NATIVE-HISTORY-6000'), 'native history finishes');
    const liveRows = await rows.textContent();
    await page.locator('.part.editor .xterm').first().hover();
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
    await until(async () => (await rows.textContent()) !== liveRows, 'native wheel reveals older output');
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
    await until(async () => (await rows.textContent()) === liveRows, 'native wheel returns to latest output');
    right.show();
    await vscode.commands.executeCommand('workbench.action.terminal.scrollToTop');
    await until(async () => (await rows.locator('[role="listitem"]').allTextContents()).some((line) => /^NATIVE-HISTORY-1\s*$/.test(line)),
      'native scrollback retains first of 6000 lines');
    await vscode.commands.executeCommand('workbench.action.terminal.scrollToBottom');

    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0, groups: [{ size: 0.6 }, { size: 0.4 }]
    });
    const manualWidth = (await terminalGroup.boundingBox()).width;
    bottom.show();
    assert.equal(await vscode.commands.executeCommand('secondaryTerminal.open'), right, 'Open reuses the right terminal after bottom commands');
    assert.ok(Math.abs((await terminalGroup.boundingBox()).width - manualWidth) < 4, 'Open preserves manual width');
    const second = await vscode.commands.executeCommand('secondaryTerminal.new');
    assert.notEqual(second, right);
    assert.notEqual(await second.processId, await right.processId);
    await until(() => rightGroup.tabs.filter((tab) => tab.input instanceof vscode.TabInputTerminal).length === 2,
      'new terminals reuse the same right group');
    assert.equal(vscode.window.tabGroups.all.length, 2, 'New does not create extra editor columns');
    assert.ok(Math.abs((await terminalGroup.boundingBox()).width - manualWidth) < 4, 'New tab preserves manual width');
    assert.equal(Number(await command(second, '$PID', 'second-native-pid')), await second.processId);

    bottom.show();
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await until(() => !vscode.window.terminals.includes(second), 'Close disposes only the selected right terminal');
    assert.ok(vscode.window.terminals.includes(bottom));
    assert.ok(vscode.window.terminals.includes(right));
    await command(bottom, '$PID', 'bottom-after-close');
    assert.equal(await vscode.commands.executeCommand('secondaryTerminal.open'), right);
    await page.screenshot({ path: path.join(output, 'native-terminals.png') });

    await vscode.commands.executeCommand('secondaryTerminal.close');
    await until(() => !vscode.window.terminals.includes(right), 'close final right terminal');
    const fresh = await vscode.commands.executeCommand('secondaryTerminal.open');
    assert.equal(Number(await command(fresh, '$PID', 'reopened-native-pid')), await fresh.processId);
    await until(async () => Math.abs((await terminalGroup.boundingBox()).width - 300) < 8,
      'recreated terminal group restores default narrow width');
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await until(() => vscode.window.tabGroups.all.length === 1, 'final terminal group closes');
    await vscode.commands.executeCommand('workbench.action.splitEditorDown');
    await until(() => vscode.window.tabGroups.all.length === 2, 'code has two stacked editor groups');
    const codeTabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs
      .filter((tab) => tab.input instanceof vscode.TabInputText).map((tab) => tab.input.uri.toString()));
    const previousCodeTabs = codeTabs();
    assert.equal(previousCodeTabs.length, 2);
    await vscode.commands.executeCommand('secondaryTerminal.open');
    await until(() => vscode.window.tabGroups.all.length === 3, 'right terminal added beside stacked code groups');
    assert.deepEqual(codeTabs(), previousCodeTabs, 'Existing code tabs remain in their groups');
    const nestedLayout = await vscode.commands.executeCommand('vscode.getEditorLayout');
    assert.equal(nestedLayout.orientation, 0);
    assert.equal(nestedLayout.groups[0].groups.length, 2, 'Stacked code layout is preserved');
    await until(async () => Math.abs((await terminalGroup.boundingBox()).width - 300) < 8,
      'right terminal beside stacked code still uses sidebar-like width');
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await command(bottom, '$PID', 'bottom-final');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      passed: true, vscode: vscode.version,
      checks: ['right terminal is a real VS Code native terminal', 'native bottom terminal stays alive and in place',
        'independent shell processes', 'VS Code default shell profile is respected', 'native editor group is locked',
        'no custom terminal webview', 'native wheel scrolls history in both directions', '6000 lines retained in native scrollback',
        'open reuses existing terminal', 'new terminals share the right group', 'closing right terminal preserves bottom shell',
        'reopening after close creates a working native shell', 'new groups use 300 pixel sidebar-like width',
        'open and new tab preserve manual width', 'recreated group restores narrow width',
        'stacked code groups preserved when narrow right column is added']
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure-dom.txt'), await page.locator('.part.editor').innerText().catch(() => ''));
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await vscode.commands.executeCommand('secondaryTerminal.close');
    bottom.dispose();
    await browser.close();
  }
}

module.exports = { run };
