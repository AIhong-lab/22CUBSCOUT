# CLAUDE.md — 幼童軍進程與技能章查詢系統

> 給接手維護的工程師（含 Claude）看的專案說明。**唯一的需求來源是 `docs/SPEC.md`**；本檔與 SPEC 衝突時以 SPEC 為準，並立即修正本檔。
> 全程用繁體中文溝通，程式碼註解也用繁體中文。

## 目前進度
- 階段 0A 完成：規格、專案結構、種子資料。
- 2026-11-14 改為帳號密碼登入（見 SPEC 附錄第 7 點），已改寫 SPEC 本文。
- 階段 0B 技術驗證通過（2026-11-14 團長實測）：
  - ① GitHub Pages（text/plain POST）呼叫 GAS：電腦與手機瀏覽器皆成功，單次約 0.9～2.3 秒（含冷啟動）。
  - ② 註冊、登入、記住我、憑證過期回登入畫面、錯誤訊息一致：皆通過。HMAC-SHA256 雜湊 1000 次約 380 毫秒 → 正式版預定 2000 次。
  - ③ LINE webhook 打到 GAS（302 轉址不影響）並以 reply API 回覆：通過。Verify 按鈕結果不作為判斷依據。
  - 0B 驗證程式已於階段 2 刪除；Script Properties 的 `WEBHOOK_KEY`、`LINE_MESSAGING_TOKEN` 沿用。
- 階段 1 完成：`gas/Logic.js`（純邏輯，GAS 以全域 `Logic` 使用、Node 以 require 使用）＋ `tests/logic.test.js`（46 項，`npm test` 全過；另以故意改壞程式確認測試抓得到錯）。
- 點名系統已寫入 SPEC 7.13（排入階段 4A）。出席與進程的連動已寫入 Logic.js：羚羊 `P-羚羊-7` 依出席自動完成（計算而得、不寫入完成紀錄）、狼鹿豹需「晉級所需出席次數」。出席率已寫入 Logic.js（`attendanceRate`、`periodOf`）。
- 階段 2 完成（程式與模擬測試）：`setup()`、帳號註冊／登入／憑證、綁定與告知同意、家長查詢 API。72 項測試全過。待團長部署並執行 `setup()` 確認試算表。
- 階段 3 完成（前端與模擬測試）：`web/index.html` 家長端（登入／註冊三步驟／忘記密碼／重新同意／首頁／進程／技能章／出席／我的資料／列印簽核單），後台為佔位頁。根目錄 `index.html` 轉址到 `web/`。`GAS_URL` 已填入團長的部署網址（2026-11-14），待團長實測。
- 階段 4A 完成（程式與模擬測試）：後台 API（`AdminApi.js`、`Backup.js`、LINE 配對）與後台畫面；網頁改為闖關冒險風格（SPEC 附錄第 19 點）。`npm test` 92 項、`npm run test:web` 全過。
- 里程碑一期間新增：小隊清單（SPEC 7.2、附錄第 20 點）：`Logic.parseList`／`changeSquads`、API `squadList`／`squadSave`、後台「更多 → 🏕️ 小隊設定」；`cubSave` 只接受清單內的小隊。
- 里程碑一期間新增：公開頁面（SPEC 第六節第 11 點、附錄第 21、22 點）：公開 API `catalog`（`PUBLIC_ACTIONS`，只回傳啟用項目與說明，快取 5 分鐘）；前端 `renderHome`（首頁 `#home`）、`renderCatalog('progress'|'badges')`（`#progress`、`#badges`），`setHash` 更新網址方便分享；未登入者預設看首頁。
- 里程碑一期間新增：進程細項（SPEC 附錄第 24、27 點）：團自訂細項掛在官方項目下，只顯示不勾選、不影響達標；`Logic.parseDetails`／`buildDetailSeed`、`loadDetails_`／`detailsView_`（白名單 group/standard/life/subs）；catalog（快取鍵 `CATALOG2`）、`buildCubView_`、`cubAdminDetail` 的項目帶 `details`；前端 `detailsHtml()`。技能章不掛細項；晉級所需技能章枚數先不做。
- 里程碑一期間新增：新的註冊方式（SPEC 附錄第 31 點、7.2-1）：`register` 沒帶 `code` 走 `registerByRequest_`（身分、孩子姓名、同意）→ 寫「註冊申請」；`requestChildren`（已登入加孩子）；後台 `requestList`／`requestApprove`／`requestReject`（權限 `reviewRequests`，團長）；`me.requests`；`adminHome.alerts.pendingRequests`。結案時清空填寫姓名。前端 `renderSignup1~3`、`renderNoCub` 顯示申請狀態、`ADMIN_PAGES.requests`。舊的代碼註冊保留。
- 2026-11-15 團長同意開始階段 4B：`gas/ItemsAdmin.js`（項目管理 API：`itemsTree`、`itemSave`、`itemToggle`、`itemMove`、`sectionRename`、`unitSave`、`detailSave`、`detailToggle`、`itemsExport`、`itemsReload`；新增／停用／啟用先回 `needConfirm` 影響預覽）、設定頁（`settingsGet`／`settingsSave`／`consentSave`，`Logic.validateSettingValue`）、`ensureBackup_()`（setup 自動建立備份資料夾與每週排程）、試算表選單「團長預設帳號（admin）」（`ensureDefaultAdmin_`，隨機密碼只顯示在視窗）。前端 `ADMIN_PAGES.items`、`ADMIN_PAGES.settings`。
- 體驗者（SPEC 附錄第 40 點）：狀態「體驗」、`Logic.trialProgress`（只算一般團集會）、`cubsOnDate_(date, type)`（大活動不列體驗者）、`cubJoin`（轉為入團）、`adminHome.trials`、家長端 `trial`；剛入團出席用 `newbieAfter`（入團日之後）。
- 名單直接編輯（SPEC 附錄第 41 點）：`cubBatchSave`（同一位多筆會合併、有錯整批不寫）、前端 `ADMIN_PAGES.cubs` 的 `edit` 模式。
- 2026-11-15 全面檢查後修正：體驗者的綁定碼可用（`checkBindCode`）、`admin` 為保留帳號（`isReservedUsername_`）且選單重設密碼時清除其登入失敗紀錄、視為通過的剛入團不顯示修改／撤銷頒章、出席總覽列出體驗者。
- 階段 5 完成（模擬測試，SPEC 第八節、附錄第 43 點）：`gas/Notify.js`——`syncNotifications_`（達標推播、去重、清除、再提醒）、`scanCubs_`（首頁與通知共用）、`linePush_`（multicast）、`handleKeyword_`、`dailyJob`／`ensureDailyTrigger_`；`registerAdmin_` 依 `NOTIFY_AFTER` 在動作後呼叫 `notifySafely_`（失敗不影響主要操作）。弱密碼檢查 `Logic.isWeakPassword`。審核可核准為體驗者（`mode: 'trial'`）。前端 `#award=` 連結。
- 小隊輔、正副小隊長、公告欄等（SPEC 附錄第 45 點）：`gas/TeamApi.js`——`squadStaffSave`（`me.mySquads` 讓點名／簽核預設帶自己的小隊，不限制權限）、`cubRoleSave`／`canLeadSquad_`（狼級以上；小隊沒有狼級以上時羚羊也可）／`endRoleInRow_`（換小隊、離團、升團自動卸任）、公開 API `notices`＋`noticeList`／`noticeSave`（只下架不刪除）、`cubImport`、`parentLeave`；狀態「升團」（`Logic.GRADUATED`，`cubLeave` 帶 `reason`）。前端 `mountNotices`、`ADMIN_PAGES.notices`、`downloadCsv`、`mySquad()`。交接手冊 `docs/HANDOVER.md`。
- 最高權限鎖在 admin（SPEC 附錄第 46 點）：`ownerId_()`（帳號名稱 admin 的帳號ID）、`Logic.validateAdminChange(admins, actorId, change, ownerId)`、`guardOwner_`（帳號停用／刪除／臨時碼）；`me.isOwner`、`adminList.ownerExists`。沒有 admin 帳號時照舊規則。
- 後台選單整理（SPEC 附錄第 47 點）：選單顯示「帳號申請」（頁面鍵仍是 `requests`）、「列印紙本」（`print`）；`PAGE_GROUPS`／`mountPageSeg` 把 overview＋attOverview、calendar＋periods、admins＋accounts 各合併成一個選單項目（頁內切換鈕 `#gseg`）。
- 後台首頁與刪除權限（SPEC 附錄第 48 點）：`ADMIN_PAGES.home` 上半部用 `homeIntroHtml`（和 `renderHome` 共用），後台區塊從 `#adminZone` 開始、快捷按鈕 `#adminQuick`；`privacyExecute` 的 `delete` 只有 admin（`me.ownerExists`／`me.isOwner`）。
- LINE 圖文選單與公開頁面（SPEC 附錄第 49 點）：分頁「網站內容」（`SHEET.SITE`，鍵 about／activity／fb）、公開 API `siteInfo`（含本月起的啟用集會，白名單 date/name/type/note）、`siteContentGet`／`siteContentSave`（在 TeamApi.js）；前端 `loadSite`、`drawCalendar`（首頁 `#calCard`）、`renderInfo('notices'|'calendar'|'about')`（`INFO_PAGES`，網址 `#notices`、`#calendar`、`#about`）、首頁 `#homeLinks`、設定頁表單 `#fw`。畫面上稱「公佈欄」。圖文選單圖片 `docs/line-richmenu.jpg`（由 scratch 腳本產生，六格都是「連結」動作）。
- 活動報名、繳費紀錄與章的圖片（SPEC 附錄第 50 點）：`gas/EventApi.js`——`eventAdminList`／`eventSave`／`eventRegs`／`eventPay`／`eventRegRemove`（權限 `manageEvents`，團長）、登入後 `eventList`／`eventRegister`／`eventCancel`、`publicEvents_`（併入 `siteInfo.events`）、`deleteRegsOfAccount_`；`Logic.validateEvent`（擋機敏題目）／`validateEventPeople`／`EVENT_IDENTITIES`；時間用 `'YYYY-MM-DDTHH:mm'` 字串（`nowStamp_`）。章圖：`unitImages`（公開）／`unitImageSave`、`Logic.isUnitImage`。前端 `ADMIN_PAGES.events`、`renderInfo('events')`、`renderEventForm`、`pendingEvent`、`iconOf` 回傳 `.uic` 容器＋`applyUnitImages`（MutationObserver）、`shrinkImage`。
- 活動存檔試算表（SPEC 附錄第 51 點）：`syncEventSheet_`（另開試算表檔案，分頁「報名名單」「活動資訊」，整份重寫）、`afterSync_`（各動作回傳的 `_ev` 觸發，失敗不影響主要操作）、`eventSheetSync`、`eventFolder_`（`EVENT_FOLDER_ID`）、`safeCell_`（防公式）；`eventRegs.sheetUrl` 只給團長。這是系統唯一會寫到主試算表以外檔案的地方。
- 活動報名對象與資料保留（SPEC 附錄第 52 點）：`canRegisterEvents_`（管理員或綁定在團／體驗孩子）、`eventList.eligible`；`purgeEndedEvents_`（`dailyJob` 呼叫；先 `syncEventSheet_` 成功才刪報名並寫「封存時間」），封存後 `eventSave`／`syncEventSheet_` 拒絕。
- **目前狀態**（2026-11-16）：階段 0A～5 與附錄第 45～51 點的程式都已完成並通過模擬測試（`npm test` 139 項、`npm run test:web` 全過）；團長已在正式環境試用。**尚未在真實環境驗證**：LINE 推播（Flex、multicast）與圖文選單、每日／每週排程、活動存檔試算表（DriveApp 建檔與搬移）、章圖上傳的縮圖效果。第二期（ROADMAP）未做。團長回報的問題優先處理。

## 架構
- 前端：`web/index.html`，原生 HTML/CSS/JS，無框架、無建置工具，部署到 GitHub Pages（repo 為 Public）。查詢端與後台同一頁，依身分切換。
- 後端：Google Apps Script Web App（`gas/`，用 clasp 管理），資料庫是 Google 試算表。
- 登入：家長、服務員、團長都用帳號密碼。註冊改為自己選身分送出申請、團長審核（SPEC 附錄第 31 點）；綁定碼仍可直接註冊；邀請碼已拿掉，只剩 setup() 的第一位團長邀請碼（附錄第 33 點）。密碼加鹽多次雜湊；登入後發隨機憑證，前端存瀏覽器，後端只存雜湊。忘記密碼由團長產生臨時碼。
- LINE：只用 Messaging API channel（官方帳號），僅通知「已連結 LINE」的管理員與管理員關鍵字查詢。沒有 LINE Login、沒有 LIFF、不推播給家長。圖文選單是給所有人的六個網頁連結（附錄第 49 點），不經過後端。
- 前端呼叫 GAS：`fetch` POST，`Content-Type: text/plain`，body 放 JSON（避免 CORS 預檢）。
- `doPost` 同時接前端 API 與 LINE webhook：網址帶 `key=` 參數且符合 Script Properties 的 webhook 密鑰 → 當 webhook；否則當前端 API（body 帶登入憑證）。
- 憑證過期或無效時後端回明確錯誤代碼（預定 `SESSION_EXPIRED`），前端清除憑證回登入畫面，登入後回到原畫面。

## 目錄結構
| 路徑 | 用途 |
|---|---|
| `docs/SPEC.md` | 規格，唯一需求來源；末尾「附錄」記錄與團長的澄清決議 |
| `docs/MANUAL.md`、`MANUAL-parent.md`、`MANUAL-staff.md` | 操作手冊：完整版（團長）、家長版、服務員版；**改到使用者看得到的功能時三份都要同步更新** |
| `docs/HANDOVER.md` | 交接手冊：給下一任團長（帳號與服務清單、移交步驟、每年要做的事） |
| `docs/SETUP.md` | 從零設定步驟（團長本人操作） |
| `docs/TESTING.md` | 手動測試清單 |
| `docs/PRIVACY.md` | 個資告知同意草稿與資料處理說明 |
| `docs/ROADMAP.md` | 第二期功能（現在不做） |
| `docs/CHANGELOG.md` | 每次變更一行 |
| `gas/` | GAS 後端、`appsscript.json`、`.clasp.json`（scriptId 由團長填） |
| `web/index.html` | 前端 |
| `data/items.csv` | 種子資料，只供 `setup()` 第一次匯入 |
| `data/details.csv` | 團自訂進程細項種子（掛在官方項目ID下），只供 `setup()` 在「進程細項」分頁為空時匯入 |
| `tests/` | 純邏輯 Node 測試，`npm test` |

純邏輯寫在 `gas/Logic.js`，不依賴 `SpreadsheetApp`，GAS 與 Node 測試共用：
- 日期一律 `'YYYY-MM-DD'` 字串；亂數（`randInt`）與雜湊（`hmacHex`）由呼叫端注入（GAS 用 `Utilities`，Node 用 `crypto`）。
- 只計算、不寫入；例如 `planPrivacy`、`planBackfill`、`planBatchSignoff` 回傳「要寫哪些列」，由 GAS 層批次執行。
- 主要函式：`parseSettings`／`parseItems`（容錯並回報列號）、`nextItemId`、`buildSeed`、`computeCubProgress`（四種狀態＋達標）、`nextChallenge`、`validateAwardDate`、`generateCode`、`checkBindCode`／`checkInvite`、`hashPassword`／`verifyPassword`（雜湊字串前綴記錄次數，格式 `次數$雜湊`）、`isLocked`、`needsReconsent`、`can`（權限矩陣 `PERMISSIONS`）、`validateAdminChange`、`planPrivacy`、`diffNotifications`。
- 對使用者的代碼錯誤訊息一律用 `Logic.CODE_ERROR_MESSAGE`，不透露原因或代碼種類。

## 試算表結構（欄位順序固定，只能往右加欄）
| 分頁 | 欄位 |
|---|---|
| 小狼名單 | 小狼ID、姓名、小隊、入團日、目前級別、綁定碼、綁定碼剩餘次數、狀態（在團/體驗/升團/離團/已匿名）、離團日、體驗開始日、職務（小隊長/副小隊長/空白） |
| 帳號 | 帳號ID、帳號名稱、稱呼、密碼雜湊、密碼鹽、狀態（啟用/停用）、建立時間、最後登入時間、臨時碼雜湊、臨時碼到期時間 |
| 登入工作階段 | 憑證雜湊、帳號ID、建立時間、到期時間 |
| 綁定紀錄 | 帳號ID、小狼ID、綁定時間、同意時間、同意版本 |
| 管理員 | 帳號ID、姓名、角色（團長/服務員）、加入時間、指定人、LINE userId、LINE 連結時間 |
| 管理員邀請 | 邀請碼、角色、姓名、建立人、建立時間、到期時間、狀態（未使用/已使用/已作廢）、使用者帳號ID、使用時間 |
| 項目總表 | 項目ID、類別（進程/技能章）、級別或章名、大項、項目內容、排序、啟用（是/否） |
| 級別與章說明 | 名稱、類別、分類（服務類/健身類/技巧類，進程留空）、說明、晉級條件、排序 |
| 進程細項 | 項目ID、分組、細項內容、通過標準、生活應用、排序、啟用（是/否） |
| 完成紀錄 | 小狼ID、項目ID、完成日期、簽核人、備註、回報人、回報狀態 |
| 頒章紀錄 | 小狼ID、級別或章名、頒發日期、頒發場合、備註、簽核人、登錄時間 |
| 通知紀錄 | 小狼ID、級別或章名、通知類型、通知時間 |
| 集會行事曆 | 集會ID、日期、名稱、備註、啟用（是/否）、建立人、建立時間、類型（一般/大活動） |
| 出席紀錄 | 集會ID、小狼ID、狀態（出席/請假；空白＝無此列）、點名人、點名時間 |
| 年度出席設定 | 年度名稱、開始日、結束日、應出席總數、備註 |
| 額外出席 | 年度名稱、小狼ID、額外出席次數、備註、設定人、設定時間 |
| 失敗紀錄 | 類型（登入/綁定）、對象（帳號名稱、帳號ID 或「未登入」）、時間 |
| 告知同意內容 | 版本、內容、生效日 |
| 註冊申請 | 申請ID、帳號ID、類型（孩子/服務員）、填寫姓名、申請時間、狀態（待審核/已核准/已退回）、處理人、處理時間、小狼ID、同意版本、備註 |
| 小隊輔 | 小隊、帳號ID、設定人、設定時間 |
| 職務紀錄 | 小狼ID、小隊、職務、開始日、結束日（空白＝現任）、設定人、設定時間 |
| 公告 | 公告ID、標題、內容、置頂（是/否）、集會ID、發布人、發布時間、狀態（顯示/下架） |
| 網站內容 | 鍵（about/activity/fb）、內容、更新人、更新時間 |
| 活動 | 活動ID、標題、說明、活動日期、結束日期、報名開始、報名結束、每人費用、題目（JSON）、狀態（開放/關閉）、建立人、建立時間、存檔試算表ID、封存時間 |
| 活動報名 | 報名ID、活動ID、帳號ID、姓名、身分別、答案（JSON）、應繳金額、已繳（是/否）、報名時間、狀態（有效/取消）、更新人、更新時間 |
| 章圖 | 名稱、類別、圖片（data URL）、更新人、更新時間 |
| 設定 | 鍵、值、說明 |
| 操作日誌 | 時間、操作人、動作、對象、修改前、修改後 |

- 試算表只顯示 `EDITABLE_SHEETS`（Config.js）的 5 個分頁，其他系統分頁由 setup() 隱藏（SPEC 附錄第 30 點）；新增分頁時要決定它屬於哪一種。
- 完成紀錄的「回報人、回報狀態」是第二期預留欄，第一期留空；判定邏輯只把「回報狀態為空或『已確認』」視為完成。
- 進程級別順序：剛入團 → 羚羊 → 狼 → 鹿 → 豹（`Logic.LEVELS`；剛入團為本團自訂，頒黃領巾，SPEC 附錄第 37 點）。豹級頒發後進程全部完成，沒有下一級。已有羚羊以上頒章者，剛入團在計算時視為已通過（`implicit`，不寫入頒章紀錄）。晉級間隔只套用 `INTERVAL_LEVELS`（狼鹿豹）；出席：剛入團用「剛入團所需出席次數」、其餘用「晉級所需出席次數」。前端級別名稱一律用 `lvName()`（剛入團不加「級」）。

## 種子資料 `data/items.csv`
- 依中華民國童軍總會官方原文（進程 110.02.21、技能章 106.11.11）轉出，與 SPEC.md 第十二節一致；欄位：`類別,級別或章名,大項或分類,項目內容`。進程 97 項、技能章 26 章 66 項。
- 第三欄：進程列是「大項」（羚羊為「－」）；技能章列是章的「分類」（服務類/健身類/技巧類）。`setup()` 匯入時：技能章項目的「大項」寫「－」，分類寫入「級別與章說明」的「分類」欄。
- 只在 `setup()` 第一次（項目總表為空）時匯入；匯入後試算表是唯一來源。

## 項目ID 規則
- 進程：`P-{級別}-{大項}-{序號}`，例如 `P-狼-國旗-1`；羚羊大項為「－」時為 `P-羚羊-1`；豹級官方大項名稱含頓號，ID 為 `P-豹-認識動、植物-1`。
- 技能章：`B-{章名}-{序號}`，例如 `B-嚮導-1`。進程大項「勞作」與技能章「勞作」靠前綴 P/B 區分（`P-狼-勞作-1` vs `B-勞作-1`），兩者是不同的東西。
- 序號取「同前綴目前用過的最大序號 + 1」，含已停用項目，永不重用。
- 章名或大項改名時，項目ID **不變**（ID 只是代號，不跟著名稱走）。

## 後端檔案（gas/）與建置
| 檔案 | 內容 |
|---|---|
| `Logic.js` | 純邏輯（GAS 與 Node 共用） |
| `Config.js` | 分頁名稱、標題列、純文字欄、錯誤代碼、`ApiError` |
| `SeedData.js` | **自動產生**：種子項目、晉級條件、預設告知文字（來源 data/items.csv、SPEC 第十二節、PRIVACY.md 標記區塊） |
| `Db.js` | 試算表批次讀寫、`withLock_`、型別轉換（日期一律轉 'YYYY-MM-DD'）、各分頁讀成物件 |
| `Auth.js` | 亂數（取自 UUID）、HMAC 雜湊、失敗紀錄與鎖定、登入憑證 |
| `Api.js` | `doGet`／`doPost`、動作分派（`PUBLIC_ACTIONS`、`AUTHED_ACTIONS`）、家長端 API、`buildCubView_` |
| `Webhook.js` | LINE webhook（密鑰與格式檢查）、管理員 LINE 配對碼、`lineReply_` |
| `AdminApi.js` | 後台 API（`registerAdmin_(名稱, 權限, 函式)` 統一做權限檢查）：首頁、小狼與綁定碼、簽核與撤銷、頒章／修改／撤銷／補登、管理員（邀請碼只剩列出與作廢）、帳號管理、行事曆與點名、年度出席、個資處理、LINE 配對 |
| `TeamApi.js` | 小隊輔、正副小隊長與職務紀錄、公告欄（含公開 API `notices`）、批次匯入名單、家長線上請假（SPEC 附錄第 45 點） |
| `EventApi.js` | 活動報名與繳費紀錄、章的圖片（SPEC 附錄第 50 點） |
| `ItemsAdmin.js` | 項目管理 API（SPEC 7.7，4B）：樹狀資料、改文字、新增（自動ID、影響預覽）、停用／啟用、排序、大項改名、技能章新增／改名、說明、本團細項、匯出、重新載入；改完清公開查詢快取 |
| `Notify.js` | LINE 主動通知（階段 5）：達標推播與去重、再提醒、關鍵字回覆、每日排程 |
| `Backup.js` | 備份與輪替、權限檢查、`weeklyBackup`／`installBackupTrigger`、`ensureBackup_`（setup 自動建立資料夾與排程） |
| `Menu.js` | 試算表選單「🐺 幼童軍系統」（`onOpen`）：團長預設帳號 admin（`ensureDefaultAdmin_`）、把帳號設為團長（`setLeaderByUsername_`）、顯示全部分頁／只顯示需要編輯的分頁；選單呼叫的函式名稱不可底線結尾 |
| `Setup.js` | `setup()`、`ensureNewbieLevel_()`（補上剛入團，只做一次）、`organizeSheets_(hide)`（依 `EDITABLE_SHEETS` 排序並隱藏系統分頁，只改顯示狀態）、`cleanup0B()` |

- `npm run build`：產生 `gas/SeedData.js` 與合併檔 `dist/Code.gs`（團長可整份貼到 Apps Script，不需 clasp）。`npm test` 會先自動 build。
- 測試：`tests/logic.test.js`（純邏輯）、`tests/backend.test.js`（用 `tests/gas-mock.js` 模擬試算表跑完整 API 流程，也測合併檔）。
- 新增 API：家長端加在 `AUTHED_ACTIONS`／`PUBLIC_ACTIONS`；後台 API（4A）必須先用 `Logic.can(role, 動作)` 檢查。回傳欄位一律白名單組裝，不可直接回傳試算表列。
- 會改動「完成紀錄」「頒章紀錄」「管理員」既有列的，只有規格明定的操作：撤銷簽核（7.4）、修改／撤銷頒章（7.5）、管理員異動（7.9）、個資處理（7.10），且都要寫操作日誌（含修改前的值）。
- 簽核人、建立人等欄位存「帳號ID」，顯示時再換成管理員姓名；帳號ID 不可送到家長端。

## 前端（web/index.html）
- 單一檔案、原生 JS，**唯一設定值是最上方的 `GAS_URL`**（repo 公開，不可放其他任何設定或金鑰）。
- 版面（SPEC 附錄第 44 點）：`#tabs` 在 `header.top` 內，<760px 用 CSS 固定在螢幕下方；`setTabs()` 清單可含分組標題 `['#','',標題]`（只在電腦版後台側欄顯示）；寬螢幕（`isWide()`，≥1000px）後台用 `adminSideTabs()` 左側分組選單，手機用 `ADMIN_TABS`＋分組的「更多」。家長 `PARENT_TABS` 三個分頁，「進度」內用 `state.seg`（map/badges/attendance）切換。簽核是 `st.step` 1～3 的精靈。小狼頁 `params.tab`（prog/badges/bind）。樣式集中在 CSS 的「2026-11 改版」區塊。未登入預設 `renderHome()`。e2e 另有一段 1280px 寬螢幕檢查。
- 結構：工具函式 → 登入／註冊 → 家長畫面（`viewHome` 首頁、`viewMap` 闖關、`viewBadges` 徽章、`viewStamps` 出席、`renderMine`）→ `printSheets` → 後台（`ADMIN_PAGES` 物件，每個鍵是一頁；`goAdmin(頁名, 參數)` 切換）。
- 後台需要確認的操作（頒章、修改頒章）用 `withConfirm()`：後端回 `needConfirm` 時跳確認視窗再帶 `confirm:true` 重送。
- 登入憑證：勾「記住我」存 localStorage，否則存 sessionStorage（關閉瀏覽器即登出）。
- 任何 API 回 `SESSION_EXPIRED` → `onExpired()` 清憑證、記住目前畫面、顯示登入頁，登入後回原畫面。切換分頁沿用已載入資料，不重新呼叫後端。
- 所有顯示文字一律經 `esc()` 跳脫（姓名等資料來自試算表）。
- 列印：`printSheet()` 把簽核單寫入 `#print`，`@media print` 只印該區塊（A4）。
- 測試：`npm run test:web`（Playwright，後端接 `tests/gas-mock.js`；設 `SHOT_DIR` 可存截圖）。不在 `npm test` 內。

## 常見維護工作
- **總會更新進程／技能章內容**（SPEC 附錄第 14 點）：從 https://www.scout.org.tw/autopage/70/466 取得新版原文 → 與試算表「項目總表」逐條比對 → 列出修改／新增／停用清單給團長確認 → 經後台或試算表執行（ID 不變、只停用不刪除）→ 同步更新 data/items.csv 與 SPEC 第十二節 → `npm run build`。
- **改告知同意文字**：試算表「告知同意內容」新增一列（版本 +1）；家長下次登入會被要求重新同意。PRIVACY.md 只影響新架設的系統。

## 部署指令（細節見 docs/SETUP.md）
```bash
cd gas
clasp login            # 第一次
clasp push             # 上傳程式碼
clasp deploy -i <deploymentId> -d "說明"   # 更新既有部署，網址不變
npm test               # 在 repo 根目錄跑純邏輯測試（node --test tests/*.test.js）
```

## Script Properties（只存在 GAS，不進 repo）
`SPREADSHEET_ID`、`WEBHOOK_KEY`（setup 自動產生）、`LINE_MESSAGING_TOKEN`（團長手動填）、`BACKUP_FOLDER_ID`（setup 自動建立）、`EVENT_FOLDER_ID`（第一次建立活動時自動建立）；選用：`WEB_URL`（GitHub Pages 網址，給通知按鈕用）。

## 維護守則（SPEC 第十四節，必須遵守）
- **開發紀錄白板**（2026-11-15 團長要求）：每次完成新的修改或決議後，除了更新 SPEC／CHANGELOG，也要把重點加到團長的白板 https://claude.ai/artifact/L3KxAvGf868X5VzEnUfcVm （Whiteboard 類型，用 ArtifactData 寫入 `elements/<id>`，先讀 `board/meta` 與現有元素再新增，不重建）：在「這次對話做了什麼」接著加一個方塊（編號續編），並同步更新「接下來要你做」「還沒在真實環境驗證」兩區。不放任何真實姓名。
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
- 前端（repo 是公開的）出現 GAS 網址以外的任何設定值或金鑰。
- 相信前端傳來的帳號ID 或身分；一律以後端用登入憑證查出的帳號為準。
- 存明碼密碼，或讓密碼、臨時碼、登入憑證出現在日誌、錯誤訊息、API 回應中。
- 登入錯誤訊息透露帳號是否存在。
- 後台 API 只靠前端隱藏按鈕做權限控制。
- API 回傳其他人的帳號ID、LINE userId，或回傳白名單以外的欄位。
- 錯誤訊息透露某位小狼是否存在、或輸入的是綁定碼還是邀請碼。
- 逐格讀寫試算表（一律 getValues/setValues 批次），或寫入時不加 LockService。
- 收集生日、身分證字號、電話、地址、照片。
- `setup()` 覆蓋任何已有資料的分頁。
- 團長說要做之前，動第二期（ROADMAP）的功能。
