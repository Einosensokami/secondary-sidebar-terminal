/* global Terminal, FitAddon, acquireVsCodeApi */
(() => {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('terminal');
  const selector = document.getElementById('sessions');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');
  const terminals = new Map();
  let activeId;
  let resizeFrame;
  const send = (message) => vscode.postMessage(message);

  function theme() {
    const style = getComputedStyle(document.body);
    const color = (name, fallback) => style.getPropertyValue(`--vscode-${name}`).trim() || fallback;
    return {
      background: color('terminal-background', color('sideBar-background', '#181818')),
      foreground: color('terminal-foreground', '#cccccc'),
      cursor: color('terminalCursor-foreground', '#cccccc'),
      selectionBackground: color('terminal-selectionBackground', '#264f78'),
      ...Object.fromEntries(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
        'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']
        .map((name) => [name, color(`terminal-ansi${name[0].toUpperCase()}${name.slice(1)}`, '')]).filter(([, value]) => value))
    };
  }

  function fit() {
    const item = terminals.get(activeId);
    if (!item || !root.clientWidth || !root.clientHeight) return;
    item.fit.fit();
    send({ type: 'resize', id: activeId, cols: item.term.cols, rows: item.term.rows });
  }

  function makeTerminal(id) {
    const element = document.createElement('div');
    element.className = 'session';
    element.dataset.session = id;
    root.append(element);
    const term = new Terminal({ cursorBlink: true, scrollback: 100000, fontSize: 13,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family') || 'monospace',
      theme: theme() });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(element);
    term.onData((data) => send({ type: 'input', id, data }));
    term.onTitleChange((title) => send({ type: 'title', id, title }));
    term.onResize(({ cols, rows }) => send({ type: 'resize', id, cols, rows }));
    let wheelPixels = 0;
    element.addEventListener('wheel', (event) => {
      if (id !== activeId || term.buffer.active.type !== 'normal' ||
          term.modes.mouseTrackingMode !== 'none' || !event.deltaY || event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const lineHeight = element.querySelector('.xterm-rows > div')?.getBoundingClientRect().height || 16;
      const pixels = event.deltaY * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? term.rows * lineHeight : 1);
      wheelPixels += pixels;
      const lines = Math.trunc(wheelPixels / lineHeight);
      if (lines) {
        term.scrollLines(lines);
        wheelPixels -= lines * lineHeight;
      }
    }, { capture: true, passive: false });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mac = /Mac/i.test(navigator.platform);
      const modifier = mac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'c' && (mac || event.shiftKey || term.hasSelection())) {
        send({ type: 'copy', text: term.getSelection() });
        event.preventDefault();
        return false;
      }
      if ((modifier && key === 'v') || (event.shiftKey && event.key === 'Insert')) {
        send({ type: 'paste', id });
        event.preventDefault();
        return false;
      }
      return true;
    });
    const item = { term, fit: fitAddon, element };
    terminals.set(id, item);
    return item;
  }

  function activate(id) {
    activeId = id;
    for (const [key, item] of terminals) item.element.hidden = key !== id;
    empty.hidden = Boolean(id);
    root.hidden = !id;
    document.getElementById('close').disabled = !id;
    document.getElementById('scroll-up').disabled = !id;
    document.getElementById('scroll-down').disabled = !id;
    fit();
    terminals.get(id)?.term.focus();
  }

  window.addEventListener('message', ({ data: message }) => {
    switch (message.type) {
      case 'sessions':
        selector.replaceChildren();
        for (const session of message.sessions) {
          if (!terminals.has(session.id)) makeTerminal(session.id);
          terminals.get(session.id).exited = session.exitCode !== undefined;
          const option = document.createElement('option');
          option.value = session.id;
          option.textContent = session.title + (session.exitCode === undefined ? '' : '（已結束）');
          option.title = session.title;
          selector.append(option);
        }
        selector.value = message.activeId || '';
        selector.title = selector.selectedOptions[0]?.textContent || '';
        activate(message.activeId);
        status.textContent = '';
        break;
      case 'title': {
        const option = Array.from(selector.options).find((item) => item.value === message.id);
        if (option) {
          const exited = terminals.get(message.id)?.exited;
          option.textContent = message.title + (exited ? '（已結束）' : '');
          option.title = message.title;
          if (message.id === activeId) selector.title = message.title;
        }
        break;
      }
      case 'data': terminals.get(message.id)?.term.write(message.data); break;
      case 'reset': {
        const item = terminals.get(message.id);
        if (item) { item.term.reset(); item.term.write(message.data); }
        break;
      }
      case 'removed': {
        const item = terminals.get(message.id);
        if (item) { item.term.dispose(); item.element.remove(); terminals.delete(message.id); }
        break;
      }
      case 'paste': terminals.get(message.id)?.term.paste(message.text); break;
      case 'focus': fit(); terminals.get(activeId)?.term.focus(); break;
      case 'error': status.textContent = message.text; break;
    }
  });

  selector.addEventListener('change', () => send({ type: 'select', id: selector.value }));
  document.getElementById('new').addEventListener('click', () => send({ type: 'new' }));
  document.getElementById('start').addEventListener('click', () => send({ type: 'new' }));
  document.getElementById('close').addEventListener('click', () => send({ type: 'close', id: activeId }));
  document.getElementById('scroll-up').addEventListener('click', () => terminals.get(activeId)?.term.scrollToTop());
  document.getElementById('scroll-down').addEventListener('click', () => terminals.get(activeId)?.term.scrollToBottom());
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fit);
  }).observe(root);
  new MutationObserver(() => {
    for (const { term } of terminals.values()) term.options.theme = theme();
  }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  send({ type: 'ready' });
})();
