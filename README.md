# Secondary Sidebar Terminal

在 VS Code **次要側邊欄（Secondary Side Bar）**開啟額外、獨立的互動式終端機。底部原有的 Terminal 可以同時使用；兩邊擁有各自的 shell 程序、工作目錄及環境變數。

## 安裝與使用

此 VSIX 適用於 **Windows x64、VS Code 1.106 以上**。

1. [下載 0.4.2 VSIX](https://github.com/Einosensokami/secondary-sidebar-terminal/releases/download/v0.4.2/secondary-sidebar-terminal-win32-x64-0.4.2.vsix)，在 Extensions 的 `…` 選單選擇 **Install from VSIX…** 安裝。
2. 若 VS Code 提示重新載入，執行 **Developer: Reload Window**。
3. `Ctrl+Shift+P` → **Secondary Terminal: 開啟於次要側邊欄**。也可在次要側邊欄選擇 **Terminal** 分頁。

**從 0.1.0 升級**：若原生 Terminal 還在舊版移動的位置，執行一次 **Secondary Terminal: 還原舊版移走的原生 Terminal 至底部**。這只還原原生 Terminal 的位置，保留執行中的程序。之後再執行「開啟於次要側邊欄」。

## 操作

- `＋`：新增獨立的側欄 shell。
- `↑` / `↓`：跳到最早或最新的輸出；也可在輸出區使用滑鼠滾輪或觸控板雙指滑動。每個工作階段最多保留最近 100,000 行供回捲。
- 下拉選單：切換側欄工作階段，各工作階段的狀態會保留。
- 名稱會跟隨程式送出的終端標題更新。例如 Codex、Claude Code 若有送出程式名稱或任務標題，會同步顯示在工作階段選單與側欄標題。支援 OSC 0 / OSC 2；程式沒有送出標題時，保留現有名稱。
- `×`：關閉目前側欄 shell，其他側欄工作階段與底部終端機可繼續使用。
- `Ctrl+C`：中斷前景程序；有選取文字時複製文字。
- `Ctrl+Shift+C`：複製選取文字。
- `Ctrl+V` / `Ctrl+Shift+V`：貼上。
- 側欄尺寸改變時，終端機會自動調整列數與行數。

隱藏側欄或切換到 Chat 後，shell 會繼續執行；回到 Terminal 可繼續操作。重新載入或關閉 VS Code 視窗時，側欄 shell 會結束。原生 Terminal 的分割、Tasks、Debug Console 與 shell integration 仍由 VS Code 管理；側欄 shell 使用自己的終端畫面。

若在側欄執行 Codex CLI 的 `codex resume`，請改用 `codex resume --no-alt-screen`，讓對話留在終端機回捲歷史中。也可在 Codex 輸入 `/tui`、選擇 **scrollback**，再重新啟動 Codex。Codex 的全螢幕模式使用 alternate screen；該畫面不會進入一般終端機的回捲緩衝區。參見 [Codex CLI 指令選項](https://learn.chatgpt.com/docs/cli/reference) 與 [Codex 開發者指令](https://learn.chatgpt.com/docs/developer-commands)。

次要側邊欄通常在右邊，實際位置遵循你的 VS Code 配置。新 shell 的起始目錄為目前工作區的第一個本機資料夾；沒有工作區時使用使用者家目錄。

## Python 虛擬環境

每次**新增側欄終端機**時，預設會自動啟用工作區的 Python venv。優先順序為 `secondaryTerminal.environmentPath`、Python 擴充套件選定的解譯器、`python.defaultInterpreterPath`，接著是工作區中的 `.venv`、`venv`、`env`、`.env`。只有找到有效的 `pyvenv.cfg`、Python 執行檔及對應 shell 的啟用腳本時才會執行啟用命令。

你可用 `"secondaryTerminal.autoActivateEnvironment": false` 停用，也可將 `secondaryTerminal.environmentPath` 設為 venv 資料夾或其 Python 執行檔。新設定會套用到下一個新建的側欄 shell；已開啟的工作階段會保留原狀。沒有開啟本機資料夾時不會自動啟用環境。

## Shell 設定

Windows 預設使用 Windows PowerShell。可在設定中自訂：

```json
{
  "secondaryTerminal.shellPath": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  "secondaryTerminal.shellArgs": ["-NoLogo"]
}
```

改用 CMD 時，設定 `"secondaryTerminal.shellPath": "cmd.exe"`。設定變更會套用到下一個新建的 shell。

## 開發與驗證

使用 [VS Code WebviewView](https://code.visualstudio.com/api/extension-guides/webview)、[xterm.js](https://xtermjs.org/) 與 [node-pty](https://github.com/microsoft/node-pty) 實作。套件內包含終端畫面及 Windows x64 原生模組，可離線使用。

標題更新使用 xterm.js 的 [onTitleChange](https://xtermjs.org/docs/api/terminal/classes/terminal/#ontitlechange) 事件，依程式提供的標題顯示；不會自行推測對話或任務內容。

```powershell
npm ci
npm run check
npm test
npm run package
```

開啟資料夾按 F5，可在 Extension Development Host 試用。Windows 整合測試使用隔離的 VS Code 設定，在真實的 webview 輸入命令，驗證底部 Terminal 保持原位、兩邊程序不同、多工作階段、環境變數保留、隱藏後重開及關閉行為。可用 `VSCODE_EXECUTABLE` 指定 VS Code 執行檔。

虛擬環境整合參照 [Python 擴充套件的環境 API](https://github.com/microsoft/vscode-python/wiki/Python-Environment-APIs)。整合測試會建立一個真正的 venv，確認 `VIRTUAL_ENV` 和 `python` 都指向它。

macOS / Linux 可從原始碼安裝對應的 node-pty 並重新打包；此 Windows VSIX 不適用於其他平台，其他平台尚未驗證。
