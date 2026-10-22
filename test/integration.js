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
  const extension = vscode.extensions.getExtension('local-tools.secondary-sidebar-terminal');
  assert.ok(extension);
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['open', 'new', 'close']) assert.ok(commands.includes(`secondaryTerminal.${name}`));
  const output = process.env.SECONDARY_TEST_OUTPUT || path.join(extension.extensionPath, '.test-output');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.SECONDARY_TEST_DEBUG_PORT}`);
  const page = browser.contexts()[0].pages().find((item) => item.url().includes('workbench'));
  assert.ok(page, 'Workbench renderer is available');
  const sentinel = vscode.window.createTerminal({
    name: 'Bottom terminal must stay here',
    shellPath: process.platform === 'win32' ? process.env.ComSpec : '/bin/sh',
    location: vscode.TerminalLocation.Panel
  });
  await sentinel.processId;
  sentinel.show();

  async function proveBottomAlive(name) {
    const marker = path.join(output, `${name}.txt`);
    fs.rmSync(marker, { force: true });
    sentinel.sendText(`echo ${name}> "${marker}"`);
    await until(() => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes(name), name);
  }

  async function sidebarFrame() {
    let match;
    await until(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator('body[data-sidebar-terminal]').count().catch(() => 0)) {
          match = frame;
          return true;
        }
      }
      return false;
    }, 'independent sidebar webview');
    return match;
  }

  async function sidebarCommand(frame, command, marker) {
    fs.rmSync(marker, { force: true });
    const input = frame.locator('.session:not([hidden]) .xterm-helper-textarea');
    await input.focus();
    await input.pressSequentially(`${command} > "${marker}"`, { delay: 2 });
    await input.press('Enter');
    await until(() => fs.existsSync(marker) && fs.statSync(marker).size > 0, command);
    const bytes = fs.readFileSync(marker);
    return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim();
  }

  try {
    await proveBottomAlive('bottom-before');
    const nativeTerminals = [...vscode.window.terminals];
    await vscode.commands.executeCommand('secondaryTerminal.open');
    // This is the exact regression: the native terminal must remain in the bottom panel.
    assert.equal(await page.locator('.part.panel .xterm').count(), 1, 'Opening the sidebar keeps the bottom terminal in place');
    assert.deepEqual(vscode.window.terminals, nativeTerminals, 'No native terminals created or moved');
    const frame = await sidebarFrame();
    const frameBox = await (await frame.frameElement()).boundingBox();
    const sidebarBox = await page.locator('.part.auxiliarybar').boundingBox();
    assert.ok(frameBox && sidebarBox && frameBox.x >= sidebarBox.x, 'Independent webview is displayed in the Secondary Side Bar');
    await until(async () => await frame.locator('#sessions option').count() === 1, 'one initial sidebar session');

    const scrollInput = frame.locator('.session:not([hidden]) .xterm-helper-textarea');
    await scrollInput.focus();
    await scrollInput.pressSequentially('1..200 | ForEach-Object { Write-Output "SCROLL-$_" }', { delay: 1 });
    await scrollInput.press('Enter');
    const rows = frame.locator('.session:not([hidden]) .xterm-rows');
    await until(async () => (await rows.textContent()).includes('SCROLL-200'), 'sidebar output finishes');
    const firstRow = frame.locator('.session:not([hidden]) .xterm-rows > div').first();
    const initialBottomRow = await firstRow.textContent();
    assert.equal(await frame.locator('#scroll-up').count(), 1, 'sidebar has an explicit scroll-up control');
    await frame.locator('#scroll-up').click();
    await until(async () => (await firstRow.textContent()) !== initialBottomRow, 'scroll-up reveals older output');
    const topRow = await firstRow.textContent();
    await frame.locator('#scroll-down').click();
    await until(async () => (await firstRow.textContent()) !== topRow, 'scroll-down returns to newer output');
    const bottomRow = await firstRow.textContent();
    await frame.locator('.session:not([hidden]) .xterm-screen').hover();
    for (let i = 0; i < 20; i++) await page.mouse.wheel(3, -2);
    await until(async () => (await firstRow.textContent()) !== bottomRow, 'small touchpad gestures reveal older output');
    for (let i = 0; i < 20; i++) await page.mouse.wheel(3, 2);
    await until(async () => (await firstRow.textContent()) === bottomRow, 'small touchpad gestures return to newer output');

    // Inline TUIs may request mouse reports while retaining normal scrollback.
    const trackedInput = frame.locator('.session:not([hidden]) .xterm-helper-textarea');
    await trackedInput.focus();
    await trackedInput.pressSequentially('1..200 | ForEach-Object { Write-Output "TRACKED-$_" }', { delay: 1 });
    await trackedInput.press('Enter');
    const trackedRows = frame.locator('.session:not([hidden]) .xterm-rows');
    await until(async () => (await trackedRows.textContent()).includes('TRACKED-200'), 'tracked session has scrollback');
    // Feed a protocol fixture at the PTY-to-webview boundary so Windows ConPTY
    // cannot consume the mouse-mode request before it reaches the emulator.
    await frame.locator('.session:not([hidden])').evaluate((element) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'data', id: element.dataset.session, data: '\x1b[?1000h' }
      }));
    });
    await until(async () => await frame.locator('.session:not([hidden]) .xterm.enable-mouse-events').count() === 1,
      'inline application enabled mouse tracking');
    const trackedFirstRow = frame.locator('.session:not([hidden]) .xterm-rows > div').first();
    const trackedBottomRow = await trackedFirstRow.textContent();
    await frame.locator('.session:not([hidden]) .xterm-screen').hover();
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -2);
    await until(async () => (await trackedFirstRow.textContent()) !== trackedBottomRow,
      'touchpad scrolls normal scrollback even when the app tracks mouse events');
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 2);
    await until(async () => (await trackedFirstRow.textContent()) === trackedBottomRow,
      'touchpad returns to live output while mouse tracking is enabled');
    await frame.locator('.session:not([hidden])').evaluate((element) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'data', id: element.dataset.session, data: '\x1b[?1000l' }
      }));
    });

    await scrollInput.focus();
    await scrollInput.pressSequentially('1..6000 | ForEach-Object { Write-Output "HISTORY-$_" }', { delay: 1 });
    await scrollInput.press('Enter');
    await until(async () => (await rows.textContent()).includes('HISTORY-6000'), 'long output finishes');
    await frame.locator('#scroll-up').click();
    await until(async () => await frame.locator('.session:not([hidden]) .xterm-rows > div').filter({ hasText: /^SCROLL-1\s*$/ }).count() > 0,
      'scrolling to top reveals the start of long output');
    await frame.locator('#scroll-down').click();

    const sidebarPid = await sidebarCommand(frame, 'echo $PID', path.join(output, 'sidebar-pid.txt'));
    assert.match(sidebarPid, /^\d+$/, 'Sidebar runs a real PowerShell process');
    assert.notEqual(Number(sidebarPid), await sentinel.processId, 'The two shells are separate processes');
    const expectedEnvironment = path.join(process.env.SECONDARY_TEST_WORKSPACE, '.venv');
    const activated = await sidebarCommand(frame, 'echo $env:VIRTUAL_ENV', path.join(output, 'activated-env.txt'));
    assert.equal(activated, expectedEnvironment, 'Project venv is automatically activated');
    const pythonPrefix = await sidebarCommand(frame, 'python -c "import sys; print(sys.prefix)"', path.join(output, 'python-prefix.txt'));
    assert.equal(pythonPrefix, expectedEnvironment, 'Python actually uses the virtual environment');

    async function setTitle(title, osc = 0, terminator = 'BEL', preserveFocus = false) {
      const chars = Array.from(title, (char) => `[char]${char.codePointAt(0)}`).join(',');
      const end = terminator === 'BEL' ? '[char]7' : '([char]27 + "\\")';
      const command = `${preserveFocus ? 'Start-Sleep -Milliseconds 500; ' : ''}[Console]::Write(([char]27 + ']${osc};' + (-join @(${chars})) + ${end}))`;
      const input = frame.locator('.session:not([hidden]) .xterm-helper-textarea');
      await input.focus();
      await input.pressSequentially(command, { delay: 1 });
      await input.press('Enter');
      if (preserveFocus) await frame.locator('#sessions').focus();
      await until(async () => await frame.locator('#sessions option:checked').textContent() === title,
        `session title follows OSC ${osc}: ${title}`);
      if (preserveFocus) assert.equal(await frame.locator('#sessions').evaluate((element) => element === document.activeElement), true,
        'Title changes do not steal focus');
    }
    await setTitle('Codex');
    const titleInput = frame.locator('.session:not([hidden]) .xterm-helper-textarea');
    await titleInput.pressSequentially("$Host.UI.RawUI.WindowTitle = 'Claude Code'", { delay: 1 });
    await titleInput.press('Enter');
    await until(async () => await frame.locator('#sessions option:checked').textContent() === 'Claude Code',
      'Windows console title changes propagate through ConPTY');
    await setTitle('Codex - 修復登入流程', 2, 'ST', true);
    const firstTitle = 'Codex - 修復登入流程';
    await proveBottomAlive('bottom-alongside-sidebar');
    await frame.locator('.session:not([hidden]) .xterm-helper-textarea').pressSequentially('$env:SIDEBAR_ONLY="first-session"');
    await frame.locator('.session:not([hidden]) .xterm-helper-textarea').press('Enter');

    await Promise.all([
      vscode.commands.executeCommand('secondaryTerminal.open'),
      vscode.commands.executeCommand('secondaryTerminal.open')
    ]);
    assert.equal(await frame.locator('#sessions option').count(), 1, 'Repeated open reuses the sidebar session');
    assert.equal(await frame.locator('#sessions option:checked').textContent(), firstTitle, 'Open preserves the dynamic title');

    await vscode.commands.executeCommand('secondaryTerminal.new');
    await until(async () => await frame.locator('#sessions option').count() === 2, 'second independent session');
    const secondPid = await sidebarCommand(frame, 'echo $PID', path.join(output, 'second-pid.txt'));
    assert.notEqual(secondPid, sidebarPid, 'New creates a different shell process');
    assert.equal(await sidebarCommand(frame, 'echo $env:VIRTUAL_ENV', path.join(output, 'second-env.txt')), expectedEnvironment,
      'Every new sidebar shell activates the project environment');
    await setTitle('Claude Code - 重構 API', 2);
    assert.equal(await frame.locator('#sessions option[value="1"]').textContent(), firstTitle, 'Sessions keep independent titles');
    await frame.locator('#sessions').selectOption('1');
    assert.equal(await frame.locator('#sessions option:checked').textContent(), firstTitle);
    const retained = await sidebarCommand(frame, 'echo $env:SIDEBAR_ONLY', path.join(output, 'retained.txt'));
    assert.equal(retained, 'first-session', 'Switching sessions preserves shell state');

    // Hide and reveal the Secondary Side Bar without killing its session.
    await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    await vscode.commands.executeCommand('secondaryTerminal.open');
    const reopenedPid = await sidebarCommand(frame, 'echo $PID', path.join(output, 'reopened-pid.txt'));
    assert.equal(reopenedPid, sidebarPid, 'Hide/reveal preserves the sidebar process');
    assert.equal(await frame.locator('#sessions option:checked').textContent(), firstTitle, 'Hide/reveal preserves the title');

    await vscode.workspace.getConfiguration('secondaryTerminal').update('autoActivateEnvironment', false, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('secondaryTerminal.new');
    const disabled = await sidebarCommand(frame, "echo ([string]$env:VIRTUAL_ENV + 'EMPTY')", path.join(output, 'disabled-env.txt'));
    assert.equal(disabled, 'EMPTY', 'Auto activation can be disabled for new shells');
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await vscode.workspace.getConfiguration('secondaryTerminal').update('autoActivateEnvironment', true, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await until(async () => await frame.locator('#sessions option').count() === 1, 'sidebar close');
    assert.equal(await page.locator('.part.panel .xterm').count(), 1, 'Closing a sidebar session leaves the native terminal in place');
    await proveBottomAlive('bottom-after-sidebar-close');
    assert.deepEqual(vscode.window.terminals, nativeTerminals);
    await vscode.commands.executeCommand('secondaryTerminal.close');
    await until(async () => await frame.locator('#empty').isVisible(), 'empty state after closing final session');
    await frame.locator('#start').click();
    await until(async () => await frame.locator('#sessions option').count() === 1, 'restart from empty state');

    // Reproduce the persisted 0.1 layout, then exercise the explicit upgrade recovery.
    await vscode.commands.executeCommand('vscode.moveViews', {
      viewIds: ['terminal'], destinationId: 'workbench.view.extension.secondary-terminal'
    });
    assert.equal(await page.locator('.part.panel .xterm').count(), 0);
    await vscode.commands.executeCommand('secondaryTerminal.restore');
    await until(async () => await page.locator('.part.panel .xterm').count() === 1, 'Legacy recovery returns the native terminal to the bottom');
    await proveBottomAlive('bottom-after-legacy-recovery');
    await vscode.commands.executeCommand('secondaryTerminal.open');

    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      passed: true, vscode: vscode.version,
      checks: ['native terminal remains in bottom panel', 'both shells execute commands simultaneously',
        'scroll buttons reveal older output', 'small touchpad gestures scroll both directions',
        'history remains accessible after 6000 lines', 'touchpad scrolls history with application mouse tracking enabled',
        'independent shell PIDs', 'repeated opens reuse session', 'new sidebar sessions',
        'switching sessions preserves environment', 'hide/reveal preserves process',
        'closing sidebar leaves bottom shell running', 'restart from empty state', 'upgrade recovery preserves native shell',
        'OSC 0 and OSC 2 titles update from real PTY output', 'BEL and ST title terminators',
        'Windows console titles', 'Unicode task titles', 'title updates preserve focus',
        'independent titles retained across switch and hide/reveal',
        'real venv automatically activated, including paths with spaces and apostrophes',
        'Python sys.prefix points to project venv', 'new shells activate independently', 'auto activation can be disabled']
    }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await vscode.commands.executeCommand('secondaryTerminal.close');
    sentinel.dispose();
    await browser.close();
  }
}

module.exports = { run };
