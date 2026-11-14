# CLAUDE.md — 幼童軍進程與技能章查詢系統

> 給接手維護的工程師（含 Claude）看的專案說明。**唯一的需求來源是 `docs/SPEC.md`**；本檔與 SPEC 衝突時以 SPEC 為準，並立即修正本檔。
> 全程用繁體中文溝通，程式碼註解也用繁體中文。

## 目前進度
- 階段 0A 完成：規格、專案結構、種子資料。
- 下一步：階段 0B 技術驗證（LIFF ID token、GAS 驗證與過期重登、webhook 回覆）。
- 尚未有任何程式碼部署到 Google 或 LINE。

## 架構
- 前端：`web/index.html`，原生 HTML/CSS/JS + LIFF SDK，無框架、無建置工具，部署到 GitHub Pages（repo 為 Public）。查詢端與後台同一頁，依身分切換。
- 後端：Google Apps Script Web App（`gas/`，用 clasp 管理），資料庫是 Google 試算表。
- LINE：同一 Provider 下的 LINE Login channel（掛 LIFF，開啟加入好友選項）＋ Messaging API channel（官方帳號）。
- 前端呼叫 GAS：`fetch` POST，`Content-Type: text/plain`，body 放 JSON（避免 CORS 預檢）。
- `doPost` 同時接前端 API 與 LINE webhook：網址帶 `key=` 參數且符合 Script Properties 的 webhook 密鑰 → 當 webhook；否則當前端 API（body 需帶 ID token）。
- ID token 過期時後端回明確錯誤代碼（預定 `TOKEN_EXPIRED`），前端自動 `liff.login()` 取新 token 重送一次。

## 目錄結構
| 路徑 | 用途 |
|---|---|
| `docs/SPEC.md` | 規格，唯一需求來源；末尾「附錄」記錄與團長的澄清決議 |
| `docs/SETUP.md` | 從零設定步驟（團長本人操作） |
| `docs/TESTING.md` | 手動測試清單 |
| `docs/PRIVACY.md` | 個資告知同意草稿與資料處理說明 |
| `docs/ROADMAP.md` | 第二期功能（現在不做） |
| `docs/CHANGELOG.md` | 每次變更一行 |
| `gas/` | GAS 後端、`appsscript.json`、`.clasp.json`（scriptId 由團長填） |
| `web/index.html` | 前端 |
| `data/items.csv` | 種子資料，只供 `setup()` 第一次匯入 |
| `tests/` | 純邏輯 Node 測試，`npm test` |

純邏輯（狀態與達標判定、綁定碼／邀請碼產生、權限判斷、管理員異動規則、匿名化與刪除範圍、項目總表與設定值驗證）寫成不依賴 `SpreadsheetApp` 的純函式，GAS 與 Node 測試共用同一份檔案（預定 `gas/Logic.js`，以 `module.exports` 存在與否判斷執行環境）。

## 試算表結構（欄位順序固定，只能往右加欄）
| 分頁 | 欄位 |
|---|---|
| 小狼名單 | 小狼ID、姓名、小隊、入團日、目前級別、綁定碼、綁定碼剩餘次數、狀態（在團/離團/已匿名）、離團日 |
| 綁定紀錄 | LINE userId、LINE 顯示名稱、小狼ID、綁定時間、同意時間、同意版本 |
| 管理員 | LINE userId、姓名、LINE 顯示名稱、角色（團長/服務員）、加入時間、指定人 |
| 管理員邀請 | 邀請碼、角色、姓名、建立人、建立時間、到期時間、狀態（未使用/已使用/已作廢）、使用者 userId、使用時間 |
| 項目總表 | 項目ID、類別（進程/技能章）、級別或章名、大項、項目內容、排序、啟用（是/否） |
| 級別與章說明 | 名稱、類別、分類（服務類/健身類/技巧類，進程留空）、說明、晉級條件、排序 |
| 完成紀錄 | 小狼ID、項目ID、完成日期、簽核人、備註、回報人、回報狀態 |
| 頒章紀錄 | 小狼ID、級別或章名、頒發日期、頒發場合、備註、簽核人、登錄時間 |
| 通知紀錄 | 小狼ID、級別或章名、通知類型、通知時間 |
| 綁定失敗紀錄 | LINE userId、時間 |
| 告知同意內容 | 版本、內容、生效日 |
| 設定 | 鍵、值、說明 |
| 操作日誌 | 時間、操作人、動作、對象、修改前、修改後 |

- 完成紀錄的「回報人、回報狀態」是第二期預留欄，第一期留空；判定邏輯只把「回報狀態為空或『已確認』」視為完成。
- 進程級別順序：羚羊 → 狼 → 鹿 → 豹。豹級頒發後進程全部完成，沒有下一級。

## 種子資料 `data/items.csv`
- 由 SPEC.md 第十二節原樣轉出，欄位：`類別,級別或章名,大項或分類,項目內容`。進程 97 項、技能章 26 章 66 項。
- 第三欄：進程列是「大項」（羚羊為「－」）；技能章列是章的「分類」（服務類/健身類/技巧類）。`setup()` 匯入時：技能章項目的「大項」寫「－」，分類寫入「級別與章說明」的「分類」欄。
- 只在 `setup()` 第一次（項目總表為空）時匯入；匯入後試算表是唯一來源。

## 項目ID 規則
- 進程：`P-{級別}-{大項}-{序號}`，例如 `P-狼-國旗-1`；羚羊大項為「－」時為 `P-羚羊-1`。
- 技能章：`B-{章名}-{序號}`，例如 `B-嚮導-1`。進程大項「勞作」與技能章「勞作」靠前綴 P/B 區分（`P-狼-勞作-1` vs `B-勞作-1`），兩者是不同的東西。
- 序號取「同前綴目前用過的最大序號 + 1」，含已停用項目，永不重用。
- 章名或大項改名時，項目ID **不變**（ID 只是代號，不跟著名稱走）。

## 部署指令（細節見 docs/SETUP.md）
```bash
cd gas
clasp login            # 第一次
clasp push             # 上傳程式碼
clasp deploy -i <deploymentId> -d "說明"   # 更新既有部署，網址不變
npm test               # 在 repo 根目錄跑純邏輯測試
```

## Script Properties（只存在 GAS，不進 repo）
預定鍵（階段 0B／2 定案）：`LINE_LOGIN_CHANNEL_ID`、`LINE_MESSAGING_TOKEN`、`WEBHOOK_KEY`、`BACKUP_FOLDER_ID`、`SPREADSHEET_ID`、`LIFF_URL`。

## 維護守則（SPEC 第十四節，必須遵守）
- 改任何功能前先讀 CLAUDE.md、docs/SPEC.md 與相關檔案；改完同步更新 SPEC.md、CLAUDE.md 與 CHANGELOG.md。
- 項目ID 一經產生永不更改、永不重用。
- 不得刪除或重排試算表既有欄位；要加欄位只能加在最右邊，並更新 setup()。
- 除了 SPEC 7.10 的個資處理功能之外，不得寫任何會覆蓋或刪除「小狼名單」「項目總表」「級別與章說明」「設定」「管理員」「頒章紀錄」「完成紀錄」既有內容的程式。
- 任何會動到正式試算表資料的操作（搬移、清除、批次改寫），先說明影響並等團長同意。
- 不得把金鑰、token、任何小狼或家長的真實資料寫進程式碼、測試、文件或 commit。測試資料一律用虛構姓名。若團長不小心貼了真實名單，要提醒他。
- 修 bug 時先補一個會失敗的測試再修。
- 沒有實際驗證過的東西不要說「已完成」；需要在 LINE 或 Google 後台手動操作才能驗證的，明確列出來。
- 規格沒寫到的地方，先問，不要自行擴充功能。第二期功能（ROADMAP.md）在團長說要做之前不要實作。

## 絕對不能做的事
- 前端（repo 是公開的）出現 LIFF ID 與 GAS 網址以外的任何設定值或金鑰。
- 相信前端傳來的 userId；一律以後端驗證 ID token 取得的 userId 為準。
- 後台 API 只靠前端隱藏按鈕做權限控制。
- API 回傳其他人的 userId，或回傳白名單以外的欄位。
- 錯誤訊息透露某位小狼是否存在、或輸入的是綁定碼還是邀請碼。
- 逐格讀寫試算表（一律 getValues/setValues 批次），或寫入時不加 LockService。
- 收集生日、身分證字號、電話、地址、照片。
- `setup()` 覆蓋任何已有資料的分頁。
- 在里程碑一期間、團長說「繼續做 4B」之前動後面階段。
