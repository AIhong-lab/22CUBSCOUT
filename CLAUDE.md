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
- 章的內建圖與進程顯示範圍（SPEC 附錄第 53 點）：前端 `BADGES`（四級菱形 SVG）、`triBadge`（技能章三角形，顏色 `BADGE_COLOR` 依分類）、`iconOf`（有內建圖時加 `.art`）、`lvIcon`、`levelWindow(currentLevel)`（家長闖關、家長首頁、已登入家長的公開進程頁）。上傳的章圖仍優先（`applyUnitImages`）。
- 網頁由 GAS 提供（SPEC 附錄第 56 點）：`npm run build` 另產生 `dist/Index.html`（＝`web/index.html`）；`doGet` 用 `HtmlService.createHtmlOutputFromFile('Index')`；前端 `IN_GAS` 時走 `google.script.run.apiFromPage`、`gasHash`／`google.script.url.getLocation`（`?p=` 或 `#`）、`gasBase`（`ping.webUrl`）。**公開函式（非底線結尾）訪客都呼叫得到**：`setup`→`setupCore_`、`dailyJob`→`runDaily_`、`weeklyBackup`→`runWeekly_`（`throttle_`），測試一律呼叫內部函式；`tests/web/gas-mode.js` 是 GAS 模式冒煙測試。
- 鎖在 GAS 與加速（SPEC 附錄第 57 點）：設定「允許外部網頁連線」＝否時 `doPost` API 回 `ERR.MOVED`（前端 `showMoved`）；`doGet` 用 `bootData_()` 把公開資料內嵌進 `<script id="boot"></script>`（前端 `window.__BOOT`）；`cachedPublic_`／`clearPublicCache_`（`registerAdmin_` 每次動作後清）；`webUrl_()` 預設改回 GitHub（附錄第 60 點）。`npm run test:web` 會跑三段：一般、`E2E_GAS=1`、`gas-mode.js`。
- 加速（SPEC 附錄第 58 點）：`ss_()` 快取試算表（`SS_CACHE_`／`SHEET_CACHE_`）；`readAll_` 對項目總表、級別與章說明、進程細項、設定使用 CacheService（`sheetCacheKey_`，`invalidate_` 與 `onEdit`／`clearAllCaches_` 清除；模擬環境預設關閉，`env.flags.sheetCache`）；`startup` API（me＋第一個畫面，前端 `state.prefetch`）。
- 正式網站維持 GitHub Pages（SPEC 附錄第 59 點）：`web/index.html` 有 CSP meta（connect-src 只允許 script.google.com／script.googleusercontent.com；建置 `dist/Index.html` 時拿掉這行）、`referrer` no-referrer、被框住時不顯示內容（`!IN_GAS && window.top !== window.self`）。**之後網頁若要載入任何外部資源，必須同時更新 CSP**，e2e 會把 CSP 阻擋當成錯誤。「允許外部網頁連線」必須維持「是」。
- LINE 圖文選單改版（SPEC 附錄第 60 點）：`docs/line-richmenu.jpg` 是團長提供的設計圖（放大成 2500×1686；換圖時六格位置要對齊三欄兩列）；`tools/richmenu.js` 是程式版備案（需指定輸出路徑）；試算表選單「📱 安裝 LINE 圖文選單」（`gas/RichMenu.js`，建立→上傳圖→設預設→刪舊的同名選單，失敗會清掉半成品）；`webUrl_()` 預設改回 GitHub（WEB_URL → `DEFAULT_WEB_URL`）。
- 點名與請假再整理（SPEC 附錄第 61 點）：`Logic.ATTEND_MARKS`／`isPresent`（遲到算出席；判斷出席一律用 `isPresent`，不要寫 `=== '出席'`）、`attendanceCounts` 多回傳 `late`；集會 `counts`（「計入進程」欄，`counts === false` 的出席不算晉級、自動完成與 `trialProgress`，出席率照算）；`meetingSave` 收 `counts`；前端 `MARK_LABEL`／`MARK_ICON`、行事曆 `[data-ct]`、`.list-row.mrow`。不收請假原因；團部ID 在 ROADMAP。
- 手機 App（PWA，SPEC 附錄第 62 點）：`web/manifest.json`、`web/sw.js`（只快取同網域 GET：網頁先連網後快取、圖示先快取；改 sw.js 要把 `VERSION` 加 1）、`web/icons/`（`tools/appicon.js` 產生）；註冊只在 `!IN_GAS && isSecureContext`；CSP 有 `manifest-src 'self'; worker-src 'self'`。`tests/web/pwa.js`（本機伺服器＋離線開啟）；e2e 用 `serviceWorkers: 'block'`。離線點名在 ROADMAP。
- LINE@ 與 PWA 分工（SPEC 附錄第 63 點）：維持帳號密碼、不用 LIFF；管理員關鍵字「點名」→ `rollReplyText_()`（Notify.js；今天或下一場集會、已請假名單、`web/#roll=集會ID`）；前端 `pendingRoll`（登入後開 `ADMIN_PAGES.roll` 的 `params.meetingId`）。家長推播待團長討論。
- 羚羊自動完成（SPEC 附錄第 64 點）：`computeCubProgress` 的出席自動完成項目只算「該項目所屬級的上一級頒發日之後」的出席（上一級沒頒發→不自動完成；視為通過沒有日期→全部算）；舊生用補登剛入團，不設基準日。
- 上線前檢查（SPEC 附錄第 65 點）：`adminHome.alerts.placeholders`（`placeholderPlaces_()`：最新個資告知、了解幼童軍含「【請填寫」；只給有 `manageSettings` 的人）；不採用寫死的剛入團基準日。
- 公開頁面載入（SPEC 附錄第 66 點）：`renderInfo` 先用 `noticeData`／`siteData` 畫面再背景更新（`infoSeq` 與 `#infoBack[data-seq]` 防止換頁後被舊回應蓋掉）；GitHub 版 `api()` 用 AbortController 45 秒逾時（`window.__apiTimeout` 給測試用）。`tests/web/slow.js`。
- LINE 選單右下角（SPEC 附錄第 67 點）：`RichMenu.js` 的 `TEAM_FB_URL`（22 團 FB 粉絲專頁）是沒填「網站內容 → FB 網址」時的預設；三份手冊都有 LINE 官方帳號章節（完整版「五之二」）。
- **目前狀態**（2026-11-16；全團第 1 期見下方附錄第 74 點、第 2 期見附錄第 77 點）：階段 0A～5 與附錄第 45～51 點的程式都已完成並通過模擬測試（`npm test` 150 項、`npm run test:web` 全過）；GAS 版在團長的實際環境進不去，**正式網站維持 GitHub Pages**（附錄第 59 點）；GAS 版程式保留但不使用。**尚未在真實環境驗證**：LINE 推播（Flex、multicast）與圖文選單、每日／每週排程、活動存檔試算表（DriveApp 建檔與搬移）、章圖上傳的縮圖效果。第二期（ROADMAP）未做。團長回報的問題優先處理。
- 多分團（SPEC 附錄第 68 點，2026-11-19 只定規格、尚未寫程式）：將擴充成 22 團團部網站；第一期骨架為分團欄位（空白＝小狼）、權限範圍（管理員／總團／團長（含副團長）／服務員／家長／小孩）、綁定紀錄「關係」、小狼模組化、恢復邀請碼。升團與離團（附錄第 69 點）、三項登記（附錄第 70 點）已定。
- 多分團骨架（SPEC 附錄第 71 點，2026-11-19 已實作）：`Logic.SECTIONS`／`sectionOf`（空白＝小狼）／`CENTRAL`（總團）／`effectiveAdmins(rows, section)`／`validateStaffChange`；`loadAdminRows_()`（管理員分頁全部列）與 `loadAdmins_()`（**只回在小狼有效的身分**，總團視為團長並標 `scope`，LINE userId 跟著人走）；`requireAccount_` 多回 `staff`、`isCentral`；`me.staff`／`isCentral`／`canManageStaff`。`gas/StaffApi.js`：`staffList`、`staffSave`、`inviteCreate`（`requireStaffManager_`：admin 或總團）。邀請碼帶分團、職稱（`redeemInvite_` 依分團寫入）。前端 `ADMIN_PAGES.staff`、`renderNoCub` 的「分團功能準備中」。總團不能在 `adminUpdate`／`adminRemove` 修改。官方進程資料 `data/sections/`（未匯入）、轉換程式 `tools/sections-convert.py`。測試 `tests/web/sections.js`。**新增任何後台功能都要想清楚屬於哪個分團**；目前 `loadAdmins_()` 等於「小狼」。
- 後端版本檢查（SPEC 附錄第 72 點）：`APP_VERSION` 在 `gas/Config.js` 與 `web/index.html` 各一份，**改任何 gas/ 程式都要把兩邊一起改成新版本號**（格式 `YYYY-MM-DD` 加小寫字母，npm test 檢查一致）；`me.serverVersion`、`ping.version`；不一致時團長後台首頁紅色提醒。網站後端網址 2026-11-19 改連團長維護中的專案（原網址屬另一個舊專案）。
- **全團上線（SPEC 附錄第 73 點，目標 2027-01-01）**：配置 23 項已定，分三期（第 1 期全團共用功能、第 2 期稚齡進程優先、第 3 期本人登入／升團／三項登記）。每期開新對話，先讀附錄第 73 點再動工。
- **第 1 期已實作（SPEC 附錄第 74 點，2026-11-19，模擬測試通過、未在真實環境驗證）**：
  - 目前分團：網頁 `api()` 每個請求帶 `_sec`（`state.section`），`requireAccount_(token, section)` 用 `Logic.staffSections`／`pickSection` 決定 `who.section`、`who.admin`（admin、總團在每個分團都是團長）；`registerAdmin_` 設 `CUR_SEC_`（`dispatch_` 開頭清空）。**後台程式一律用 `secCubs_()`、`findCub_()`（只找目前分團）、`squadListOf_()`、`sectionSettingOf_()`、`loadAdmins_(section)`**，不要直接 `loadCubs_()` 列名單（ID 產生、綁定碼、家長端除外）。`cubsOnDate_(date, type, section)`。新增團員要寫第 12 欄分團（`curSec_()`）。
  - 進程只在 `Logic.PROGRESS_SECTIONS`（小狼）：`PROGRESS_ACTIONS` 在其他分團回 FORBIDDEN；`buildCubView_`／`cubAdminDetail` 回 `hasProgress`；`progressCubs_()`（Notify）只掃小狼。
  - 全團共用功能：`SHARED_ACTIONS`（動作 → 功能）＋`canShared_(who, 功能)`，設定鍵「共用功能權限：系統設定／網站內容／個資告知／帳號管理／備份」（`Logic.SHARED_FUNCS`、`canShared`，預設總團）。設定頁 `settingGroupFor_`：全團／分團／權限；各分團設定鍵 `Logic.sectionSettingKey`（小狼用原鍵，其他加「（分團）」，`optional` 不報錯）。`canManageAll_(who)`：全團集會、公告、活動、年度預設（admin、總團；沒有 admin 時團長）。`adminCandidates`（指定管理員時搜尋帳號，只回帳號與稱呼）。
  - 對象：`Logic.ALL`（全團）、`targetOf`／`targetIncludes`（集會、公告、年度出席）、`parseTargets`／`targetsInclude`（活動可複選）；`meetingVisible_`／`canEditMeeting_`／`findMeeting_`、`canEditNotice_`、`canManageEvent_`／`findManagedEvent_`／`eventTargets_`、`accountSections_`（報名資格）、`sectionPeriod_(section, date)`（分團自己的，沒有就全團預設）。
  - 帳號申請：`Logic.UNASSIGNED`（未指定）、`requestSection_`、`childSections_`（`childSections` 與 `childNames` 對應、`staffSection`）、`requestVisible_`、`requestAssign`；核准時第 12 欄寫實際分團。
  - 前端：`SECTIONS`／`SEC_INFO`（full、slug、icon）、`secFull`、`roleName`（羅浮群長）、`targetSel`／`targetPill`、`switchSection`（`#secSel`）、`adminTabs()`／`secHasProgress()`／`canShared()`／`pageOk()`；公開 `renderHome`（團部入口 `#secCards`）、`renderSectionPage(sec)`（`#cub` 等）、`renderCatalog(view, {sec})`（`#secTabs`、`#scout/progress`）、`mountNotices(max, after, secs)`／`noticesFor`、`drawCalendar(el, site, ym, secs)`、`mountCalendarAndFb`；家長 `viewHomeBasic`（非小狼）、`mySecs()`；註冊 `secSelectHtml`／`childSecsOf`。測試 `tests/sections.test.js`、`tests/web/sections.js`。
- **第 2 期已實作（SPEC 附錄第 77 點，2026-11-23，模擬測試通過、未在真實環境驗證）**：
  - 進程模組：`Logic.PROGRESS_MODULES`（小狼、稚齡；`PROGRESS_SECTIONS` 由它產生）、`progressModule`／`levelsOf`／`isLevelOf`／`idPrefixOf`／`currentLevelOf`／`progressParams(settings, section)`（只取該模組用得到的設定）。`computeCubProgress` 帶 `section`：只算該分團的項目（`item.sec`）與頒章（`award.sec`）；剛入團、出席自動完成只有小狼（`newbie`、`autoItem`）；稚齡有完成期限（`deadlines`，`u.deadline`／`u.deadlineState` soon／over，只看 nextLevel，家長端 `buildCubView_` 拿掉）。⑨ 的專科章枚數／必修章等童軍上線再做。
  - **項目的 `item.section` 是「大項」（舊名），分團是 `item.sec`**；頒章、級別與章說明、章圖的分團也是 `sec`。寫分團欄一律用 `secCell_(sec)`（小狼留空）。`loadUnits_(section)`（一定要給分團，沒給時用目前分團）、`loadAllUnits_()`、`sectionItems_(section)`、`loadUnitImages_(section)`。
  - 稚齡資料由 `tools/build.js` 的 `SEED_SECTIONS` 放進 `SEED.sections`，`ensureSectionSeeds_()`（setup）在沒有稚齡項目時新增。各分團進程設定 `scope: 'progress'`（例如「完成期限月數：地球（稚齡）」），`settingGroupFor_` 只給該分團。
  - 公開 `catalog` 帶 `section`（快取鍵 `CATALOG2_稚齡`，`removeCatalogCache_()`）；章圖公開鍵小狼 `類別|名稱`、其他分團 `分團|類別|名稱`。`scanCubs_` 多回 `due`（期限），通知依分團分開推。
  - 前端：`SEC_LEVELS`、`progSec`／`setProgSec`（家長＝孩子的分團、公開＝選的分團、後台＝目前分團；`iconOf` 的章圖鍵與 `levelWindow` 依此）、`lvs()`、`SEC_TEXT`、`SEC_FINISH`、`GROUP_ICON`、`beaverIntroHtml`、`loadCatalog(sec)`（`catalogData` 依分團）。**新增分團進程時，前後端的級別清單要一起加**。測試 `tests/beaver.test.js`、`tests/web/beaver.js`。

- **權限設定、移交中心、童軍本人帳號、選單精簡（SPEC 附錄第 76 點，2026-11-23 拆回團長交接包，模擬測試通過、未在真實環境驗證）**：
  - 權限：`Logic.PERM_FEATURES`（33 項，`scope` public／parent／admin，`actions` 對應後端動作，`sharedFunc` 對應共用功能，`locked`）、`defaultPermRows`、`parsePermRules(rows, settingsValues)`（讀試算表二維陣列；沒有那一列的共用功能沿用「共用功能權限：○○」）、`validatePermUpdate`、`allowsFeature`（沒有最高管理員時團長照舊可用總團級功能）、`resolvePermissions`。後端 `loadPermRules_()`、`resolveWhoPerms_(who, isParent, isScoutSelf, section)`；`requireRole_` 先看權限表的 `actions`，沒列的動作才用 `Logic.can`；`canShared_` 也走權限表。API `permSettingsGet`／`permSettingsSave`（同步寫回共用功能權限設定）；`me.tabs`／`visibleTabs`／`permissions`／`accountType`／`allowedSections`；公開資料帶 `publicTabs`（只隱藏入口，不是保密）。**「全團系統參數設定」(tab_settings) 不綁 manageSettings**，分團團長仍可改自己分團的設定。
  - 最高管理員：`ownerId_()` 先讀設定分頁原始列「最高管理員帳號ID」（`OWNER_SETTING_KEY`，不在 `Logic.SETTINGS`、設定頁看不到），沒有才是 admin；`loadAdmins_` 合成列用 `ownerId_()` 並標 `_synthetic`（`adminUpdate` 拒絕改合成列）。API `handoverSummary`、`handoverTransfer`（重新讀帳號核對密碼、失敗計入登入鎖定、確認帳號名稱、接任者加總團、原管理員可保留總團）。
  - 童軍本人：`Logic.SCOUT_SELF`／`SELF_ELIGIBLE_SECTIONS`；`bindCub_(accountId, cub, version, relation, skipCodeDecrement)`（有「本人」綁定的帳號不能再綁別人）；`apiParentCreateScoutAccount_`（TeamApi）；`apiCubDetail_` 依 `member_progress`／`member_attendance` 過濾；`parentLeave`、`eventRegister` 依 `parent_leave`／`parent_events`。
  - 前端：`hasTab(id, fallback)`、`state.publicTabs`、`isTopAdmin()`、`myAllowedSecs()`、`PARENT_TABS()`／`PARENT_SEGS()`（函式）、`pageOk(k)`、`firstPageOf`、`PAGE_GROUPS`（6 組：集會、進程、團員、公告活動、帳號權限、團務設定）、`adminMoreItems`／`adminSideTabs`（8 入口）、`ADMIN_PAGES.perms`／`handover`、`ADMIN_PAGES.mine` 含 LINE 連結。後台首頁不再呼叫 `homeIntroHtml`。e2e 用 `openPage(k)` 進頁面。測試 `tests/perms.test.js`。
- **外部檢查修正（SPEC 附錄第 78 點，2026-11-25）**：`imgKey(cat, unit, sec)`（前端章圖鍵）；`assertEditorRun_()`（Setup.js，公開函式只限擁有者在編輯器執行；內部呼叫 `installDailyTrigger_`／`installBackupTrigger_`）；`assertNotScoutSelf_`（Api.js）；`Logic.replaceNameOnly`（個資姓名替換保護較長的姓名）；LINE 連結 `#award=團員ID,章名,分團`、`#roll=集會ID,分團`（前端 `linkSec` 先切分團）；`NOTIFY_AFTER` 不含 backfill；測試 mock 有 `Session`（`env.flags.activeUser`）。測試 `tests/review.test.js`。

## 架構
- 前端：`web/index.html`，原生 HTML/CSS/JS，無框架、無建置工具，可部署到 GitHub Pages（repo 為 Public），也可以直接由 GAS 提供（`dist/Index.html`，附錄第 56 點）。查詢端與後台同一頁，依身分切換。
- 後端：Google Apps Script Web App（`gas/`，用 clasp 管理），資料庫是 Google 試算表。
- 登入：家長、服務員、團長都用帳號密碼。註冊改為自己選身分送出申請、團長審核（SPEC 附錄第 31 點）；綁定碼仍可直接註冊；邀請碼已恢復（附錄第 68、71 點，帶分團與職稱，由 admin 或總團產生）。密碼加鹽多次雜湊；登入後發隨機憑證，前端存瀏覽器，後端只存雜湊。忘記密碼由團長產生臨時碼。
- LINE：只用 Messaging API channel（官方帳號），僅通知「已連結 LINE」的管理員與管理員關鍵字查詢。沒有 LINE Login、沒有 LIFF、不推播給家長。圖文選單是給所有人的六個網頁連結（附錄第 49 點），按鈕不經過後端；由試算表選單一鍵安裝（附錄第 60 點）。
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
| `web/manifest.json`、`web/sw.js`、`web/icons/` | 手機 App（PWA，附錄第 62 點） |
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
| 小狼名單 | 小狼ID、姓名、小隊、入團日、目前級別、綁定碼、綁定碼剩餘次數、狀態（在團/體驗/升團/離團/已匿名）、離團日、體驗開始日、職務（小隊長/副小隊長/空白）、分團 |
| 帳號 | 帳號ID、帳號名稱、稱呼、密碼雜湊、密碼鹽、狀態（啟用/停用）、建立時間、最後登入時間、臨時碼雜湊、臨時碼到期時間 |
| 登入工作階段 | 憑證雜湊、帳號ID、建立時間、到期時間 |
| 綁定紀錄 | 帳號ID、小狼ID、綁定時間、同意時間、同意版本、關係（家長/本人，空白＝家長） |
| 管理員 | 帳號ID、姓名、角色（總團/團長/服務員）、加入時間、指定人、LINE userId、LINE 連結時間、分團（空白＝小狼；總團留空）、職稱。一人可多列（每分團一列） |
| 管理員邀請 | 邀請碼、角色、姓名、建立人、建立時間、到期時間、狀態（未使用/已使用/已作廢）、使用者帳號ID、使用時間、分團、職稱 |
| 項目總表 | 項目ID、類別（進程/技能章）、級別或章名、大項、項目內容、排序、啟用（是/否）、分團（空白＝小狼） |
| 級別與章說明 | 名稱、類別、分類（服務類/健身類/技巧類；稚齡為服務類/運動類/技巧類；進程留空）、說明、晉級條件、排序、分團（空白＝小狼） |
| 進程細項 | 項目ID、分組、細項內容、通過標準、生活應用、排序、啟用（是/否） |
| 完成紀錄 | 小狼ID、項目ID、完成日期、簽核人、備註、回報人、回報狀態 |
| 頒章紀錄 | 小狼ID、級別或章名、頒發日期、頒發場合、備註、簽核人、登錄時間、分團（空白＝小狼；章名要和分團一起對應） |
| 通知紀錄 | 小狼ID、級別或章名、通知類型、通知時間 |
| 集會行事曆 | 集會ID、日期、名稱、備註、啟用（是/否）、建立人、建立時間、類型（一般/大活動）、計入進程（是/否，空白＝是）、分團（分團名稱或「全團」；空白＝小狼） |
| 出席紀錄 | 集會ID、小狼ID、狀態（出席/遲到/請假；空白＝無此列）、點名人、點名時間 |
| 年度出席設定 | 年度名稱、開始日、結束日、應出席總數、備註、分團（全團／分團；空白＝小狼） |
| 額外出席 | 年度名稱、小狼ID、額外出席次數、備註、設定人、設定時間 |
| 失敗紀錄 | 類型（登入/綁定）、對象（帳號名稱、帳號ID 或「未登入」）、時間 |
| 告知同意內容 | 版本、內容、生效日 |
| 註冊申請 | 申請ID、帳號ID、類型（孩子/服務員）、填寫姓名、申請時間、狀態（待審核/已核准/已退回）、處理人、處理時間、小狼ID、同意版本、備註、分團（空白＝小狼；「未指定」＝家長不確定） |
| 小隊輔 | 小隊、帳號ID、設定人、設定時間、分團（空白＝小狼） |
| 職務紀錄 | 小狼ID、小隊、職務、開始日、結束日（空白＝現任）、設定人、設定時間 |
| 公告 | 公告ID、標題、內容、置頂（是/否）、集會ID、發布人、發布時間、狀態（顯示/下架）、分團（分團名稱或「全團」） |
| 網站內容 | 鍵（about/activity/fb）、內容、更新人、更新時間 |
| 活動 | 活動ID、標題、說明、活動日期、結束日期、報名開始、報名結束、每人費用、題目（JSON）、狀態（開放/關閉）、建立人、建立時間、存檔試算表ID、封存時間、分團（「全團」或「童軍、行義」可複選；空白＝小狼） |
| 活動報名 | 報名ID、活動ID、帳號ID、姓名、身分別、答案（JSON）、應繳金額、已繳（是/否）、報名時間、狀態（有效/取消）、更新人、更新時間 |
| 章圖 | 名稱、類別、圖片（data URL）、更新人、更新時間、分團（空白＝小狼） |
| 設定 | 鍵、值、說明（另有「最高管理員帳號ID」一列，只能由移交中心寫入） |
| 權限設定 | 功能代碼、功能名稱、分類、最低權限、停用分團、更新人、更新時間（系統分頁，由後台權限設定頁維護） |
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
- 小狼以外的分團在前面加分團名（`Logic.idPrefixOf`）：`稚齡-P-地球-1`、`稚齡-B-種植-1`；序號依分團分開算（附錄第 77 點）。

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
| `RichMenu.js` | LINE 圖文選單一鍵安裝（附錄第 60 點）：`richMenuAreas_`、`installRichMenu_`、試算表選單 `menuInstallRichMenu`；圖片 `docs/line-richmenu.jpg`（團長的設計圖） |
| `AdminApi.js` | 後台 API（`registerAdmin_(名稱, 權限, 函式)` 統一做權限檢查）：首頁、小狼與綁定碼、簽核與撤銷、頒章／修改／撤銷／補登、管理員（邀請碼列出與作廢；產生在 StaffApi.js）、帳號管理、行事曆與點名、年度出席、個資處理、LINE 配對 |
| `TeamApi.js` | 小隊輔、正副小隊長與職務紀錄、公告欄（含公開 API `notices`）、批次匯入名單、家長線上請假（SPEC 附錄第 45 點） |
| `EventApi.js` | 活動報名與繳費紀錄、章的圖片（SPEC 附錄第 50 點） |
| `StaffApi.js` | 分團身分與邀請碼（SPEC 附錄第 68、71 點）：`staffList`、`staffSave`、`inviteCreate`，只有 admin 或總團 |
| `ItemsAdmin.js` | 項目管理 API（SPEC 7.7，4B）：樹狀資料、改文字、新增（自動ID、影響預覽）、停用／啟用、排序、大項改名、技能章新增／改名、說明、本團細項、匯出、重新載入；改完清公開查詢快取 |
| `Notify.js` | LINE 主動通知（階段 5）：達標推播與去重、再提醒、關鍵字回覆、每日排程 |
| `Backup.js` | 備份與輪替、權限檢查、`weeklyBackup`／`installBackupTrigger`、`ensureBackup_`（setup 自動建立資料夾與排程） |
| `Menu.js` | 試算表選單「🐺 幼童軍系統」（`onOpen`）：團長預設帳號 admin（`ensureDefaultAdmin_`）、把帳號設為團長（`setLeaderByUsername_`）、安裝 LINE 圖文選單、顯示全部分頁／只顯示需要編輯的分頁；選單呼叫的函式名稱不可底線結尾 |
| `Setup.js` | `setup()`、`ensureNewbieLevel_()`（補上剛入團，只做一次）、`organizeSheets_(hide)`（依 `EDITABLE_SHEETS` 排序並隱藏系統分頁，只改顯示狀態）、`cleanup0B()` |

- `npm run build`：產生 `gas/SeedData.js` 與合併檔 `dist/Code.gs`（團長可整份貼到 Apps Script，不需 clasp）。`npm test` 會先自動 build。
- 測試：`tests/logic.test.js`（純邏輯）、`tests/backend.test.js`（用 `tests/gas-mock.js` 模擬試算表跑完整 API 流程，也測合併檔）。
- 新增 API：家長端加在 `AUTHED_ACTIONS`／`PUBLIC_ACTIONS`；後台 API（4A）必須先用 `Logic.can(role, 動作)` 檢查。回傳欄位一律白名單組裝，不可直接回傳試算表列。
- 會改動「完成紀錄」「頒章紀錄」「管理員」既有列的，只有規格明定的操作：撤銷簽核（7.4）、修改／撤銷頒章（7.5）、管理員異動（7.9）、個資處理（7.10），且都要寫操作日誌（含修改前的值）。
- 簽核人、建立人等欄位存「帳號ID」，顯示時再換成管理員姓名；帳號ID 不可送到家長端。

## 前端（web/index.html）
- 單一檔案、原生 JS，**唯一設定值是最上方的 `GAS_URL`**（repo 公開，不可放其他任何設定或金鑰）；下一行的 `APP_VERSION` 是版本號，不是設定（附錄第 72 點）。
- 版面（SPEC 附錄第 44 點）：`#tabs` 在 `header.top` 內，<760px 用 CSS 固定在螢幕下方；`setTabs()` 清單可含分組標題 `['#','',標題]`（只在電腦版後台側欄顯示）；寬螢幕（`isWide()`，≥1000px）後台用 `adminSideTabs()` 左側分組選單，手機用 `ADMIN_TABS`＋分組的「更多」。家長 `PARENT_TABS` 四個分頁（首頁、公佈欄、進度、我的；公開 `PUBLIC_TABS` 也有公佈欄，附錄第 55 點），「進度」內用 `state.seg`（map/badges/attendance）切換。簽核是 `st.step` 1～3 的精靈。小狼頁 `params.tab`（prog/badges/bind）。樣式集中在 CSS 的「2026-11 改版」區塊。未登入預設 `renderHome()`。e2e 另有一段 1280px 寬螢幕檢查。
- 結構：工具函式 → 登入／註冊 → 家長畫面（`viewHome` 首頁、`viewMap` 闖關、`viewBadges` 徽章、`viewStamps` 出席、`renderMine`）→ `printSheets` → 後台（`ADMIN_PAGES` 物件，每個鍵是一頁；`goAdmin(頁名, 參數)` 切換）。
- 後台需要確認的操作（頒章、修改頒章）用 `withConfirm()`：後端回 `needConfirm` 時跳確認視窗再帶 `confirm:true` 重送。
- 登入憑證：勾「記住我」存 localStorage，否則存 sessionStorage（關閉瀏覽器即登出）。
- 任何 API 回 `SESSION_EXPIRED` → `onExpired()` 清憑證、記住目前畫面、顯示登入頁，登入後回原畫面。切換分頁沿用已載入資料，不重新呼叫後端。
- 所有顯示文字一律經 `esc()` 跳脫（姓名等資料來自試算表）。
- 列印：`printSheet()` 把簽核單寫入 `#print`，`@media print` 只印該區塊（A4）。
- 測試：`npm run test:web`（Playwright，後端接 `tests/gas-mock.js`；設 `SHOT_DIR` 可存截圖；最後跑 `tests/web/pwa.js`、`tests/web/slow.js`）。不在 `npm test` 內。

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
- **雲端硬碟備份**（2026-11-20、21 團長要求）：四份手冊（交接、完整版、家長版、服務員版）、`dist/Code.gs`、`dist/Index.html` 有新版時，**直接用 Google Drive 連接器放進團長指定的資料夾「新版程式與手冊（權限隔離與移交版）」**（網址記在白板「所有會用到的網址」表，不寫進這個公開 repo）。手冊轉成 Google 文件、檔名用中文（交接手冊、操作手冊（完整版・團長）、操作手冊（家長版）、操作手冊（服務員版））；程式檔不轉換、保留原檔名。連接器不能改已上傳檔案的內容，所以每次是新增一份，回覆裡列出新檔連結，並請團長自己刪掉舊版（不要自己丟進垃圾桶）。
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
