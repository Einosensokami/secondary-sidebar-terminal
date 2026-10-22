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
  const workspace = process.env.SECONDARY_TEST_WORKSPACE;
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

    const environment = path.join(workspace, '.venv');
    assert.equal(await command(right, '$env:VIRTUAL_ENV', 'native-venv'), environment);
    assert.equal(await command(right, 'python -c "import sys; print(sys.prefix)"', 'native-python'), environment);
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

    bottom.show();
    assert.equal(await vscode.commands.executeCommand('secondaryTerminal.open'), right, 'Open reuses the right terminal after bottom commands');
    const second = await vscode.commands.executeCommand('secondaryTerminal.new');
    assert.notEqual(second, right);
    assert.notEqual(await second.processId, await right.processId);
    await until(() => rightGroup.tabs.filter((tab) => tab.input instanceof vscode.TabInputTerminal).length === 2,
      'new terminals reuse the same right group');
    assert.equal(vscode.window.tabGroups.all.length, 2, 'New does not create extra editor columns');
    assert.equal(await command(second, '$env:VIRTUAL_ENV', 'second-native-venv'), environment);

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
    await vscode.workspace.getConfiguration('secondaryTerminal').update('autoActivateEnvironment', false, vscode.ConfigurationTarget.Workspace);
    const fresh = await vscode.commands.executeCommand('secondaryTerminal.open');
    assert.equal(await command(fresh, 'if ($env:VIRTUAL_ENV) { $env:VIRTUAL_ENV } else { "NONE" }', 'native-disabled-venv'), 'NONE');
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await command(bottom, '$PID', 'bottom-final');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      passed: true, vscode: vscode.version,
      checks: ['right terminal is a real VS Code native terminal', 'native bottom terminal stays alive and in place',
        'independent shell processes', 'VS Code default shell profile is respected', 'native editor group is locked',
        'no custom terminal webview', 'native wheel scrolls history in both directions', '6000 lines retained in native scrollback',
        'open reuses existing terminal', 'new terminals share the right group', 'closing right terminal preserves bottom shell',
        'real Python venv activated independently', 'auto activation can be disabled']
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
