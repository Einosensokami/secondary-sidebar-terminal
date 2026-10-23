# Secondary Sidebar Terminal

直接開啟 **VS Code 原生終端機**到右側，底部 Terminal 可同時跑測試或其他指令。

0.5.0 起使用原生終端機編輯器分頁，取代舊版的 webview 終端機。畫面、回捲、選取、快捷鍵、終端標題與 shell integration 都由 VS Code 處理。

## 安裝與使用

1. [下載 0.5.3 VSIX](https://github.com/Einosensokami/secondary-sidebar-terminal/releases/download/v0.5.3/secondary-sidebar-terminal-win32-x64-0.5.3.vsix)，執行 **Extensions: Install from VSIX…** 安裝。
2. 執行 **Developer: Reload Window**。升級時，舊版 webview 中的 shell 會結束。
3. `Ctrl+Shift+P` → **Secondary Terminal: 開啟右側原生終端機**。

也可點底部 Terminal 工具列的「開啟右側原生終端機」圖示，直接開到右側。

右側可執行 `codex resume`，下方原生 Terminal 繼續跑測試。開啟指令會收起 Secondary Side Bar，讓右側原生終端機出現在視窗右側；需要 Chat 時，可透過 VS Code 的版面配置按鈕重新打開 Secondary Side Bar。

**位置說明**：右側使用 VS Code 的原生終端機編輯器群組，並非嵌入 Secondary Side Bar。底部原生 Terminal 檢視保留原位。

## 操作

- **開啟右側原生終端機**：回到既有的右側終端機；沒有時新增。
- **新增右側原生終端機**：在同一右側群組新增獨立的 shell。
- **關閉目前右側原生終端機**：關閉最近使用的右側 shell；底部 shell 繼續執行。
- 也可使用原生終端機的分頁、工具列、快捷鍵與滑鼠操作。
- 右側群組預設由 VS Code 自動鎖定，開啟程式碼檔案時會使用其他群組。
- 新建右側群組預設約 **300 像素寬**，接近側欄寬度。可用 `secondaryTerminal.width` 調整；小視窗會受可用空間限制。同一群組再次開啟或新增分頁會保留手動調整的寬度；變更寬度設定後，下次開啟會套用新設定。

歷史行數、字型、捲動與 shell profile 使用 VS Code 的 `terminal.integrated.*` 設定。例如增加歷史行數：

```json
{
  "terminal.integrated.scrollback": 100000
}
```

不指定 `secondaryTerminal.shellPath` 時，使用 VS Code 預設終端機 profile。原生終端機的重新連線與保存遵循 VS Code 設定。

## Shell 與虛擬環境

虛擬環境選擇與啟用沿用 VS Code／Python 擴充套件的設定。`secondaryTerminal.shellPath` 與 `secondaryTerminal.shellArgs` 可覆寫右側 shell；留空時使用 VS Code 預設設定。

若原生 Terminal 檢視曾被舊版移離底部，可執行 **Secondary Terminal: 還原舊版移走的原生 Terminal 至底部**。

## 開發與驗證

```powershell
npm ci
npm run check
npm test
npm run package
```

整合測試在隔離的真實 VS Code 視窗中確認：右側與底部都是原生終端機、程序彼此獨立、上下捲動、6,000 行歷史、多個右側分頁與關閉互不影響。可用 `VSCODE_EXECUTABLE` 指定 VS Code 執行檔。目前整合測試在 Windows 驗證。

原生位置使用 [TerminalEditorLocationOptions](https://code.visualstudio.com/api/references/vscode-api#TerminalEditorLocationOptions)。終端機操作參見 [VS Code Terminal Basics](https://code.visualstudio.com/docs/terminal/basics)。
