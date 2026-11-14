# 階段 0B 技術驗證：精簡設定步驟

> 只涵蓋三項驗證：① 網頁能呼叫 GAS ② 帳號登入與過期 ③ LINE 回覆。
> 全部用電腦瀏覽器操作，預計 40 分鐘。測試帳號與稱呼一律用虛構名字。
> 驗證結束後這份文件會被正式的 SETUP.md 取代。

每一步標示：📝 = 要抄下來的值，➡️ = 要填到哪裡。準備一個記事本存抄下來的值（**不要**貼到 GitHub 或群組）。

---

## A. Google：建立試算表與後端（約 15 分鐘）

1. 用**團務 Google 帳號**登入，開啟 https://sheets.new 建立新試算表，左上角改名為「幼童軍進程系統」。
2. 上方選單「擴充功能」→「Apps Script」，會開新分頁。左上角專案名稱改為「幼童軍進程系統」。
3. 左側「檔案」看到 `程式碼.gs`，點開，把裡面的內容**全部刪掉**。
4. 另開分頁到 https://github.com/AIhong-lab/22CUBSCOUT/blob/main/gas/Verify0B.gs ，按程式碼框右上角的「複製」圖示（Copy raw file），回 Apps Script 貼上，按上方磁碟圖示「儲存」。
5. 上方函式下拉選單選 `init0B`，按「執行」。
   - 第一次會要求授權：「審查權限」→ 選你的團務帳號 →出現「Google 尚未驗證這個應用程式」→ 點「進階」→「前往 幼童軍進程系統（不安全）」→「允許」。這是你自己的程式，可以放心。
   - 下方「執行記錄」會出現一行 `LINE webhook 網址 =（你的 GAS 網址）?key=……`
   - 📝 抄下 `?key=` 後面那一長串（**webhook 密鑰**，不可外流）。
6. 右上角「部署」→「新增部署作業」→ 左側齒輪選「網頁應用程式」：
   - 說明：`0B 驗證`
   - 執行身分：**我**
   - 誰可以存取：**所有人**
   - 按「部署」（若再要求授權，同第 5 步）。
   - 📝 抄下「網頁應用程式」網址，以 `/exec` 結尾（**GAS 網址**）。
7. 檢查：在瀏覽器新分頁打開 GAS 網址，應看到「OK：幼童軍系統 0B 驗證後端已部署。」

> 之後若程式有修改：「部署」→「管理部署作業」→ 鉛筆圖示 → 版本選「新版本」→「部署」。網址不變。

## B. GitHub Pages：讓測試網頁上線（約 5 分鐘）

1. 開啟 https://github.com/AIhong-lab/22CUBSCOUT/settings/pages
2. 「Build and deployment」→ Source 選 **Deploy from a branch**；Branch 選 **main**、資料夾 **/ (root)** → 按「Save」。
3. 等 1～3 分鐘重新整理頁面，上方會出現「Your site is live at https://……」。
   - 📝 抄下這個網址（**網站網址**）。
4. 測試頁網址 = 網站網址後面加 `web/0b/`，例如 `https://aihong-lab.github.io/22CUBSCOUT/web/0b/`

## C. 驗證 ①：網頁呼叫 GAS

1. 電腦打開測試頁，在「設定」貼上 **GAS 網址** → 「儲存」。
2. 按「測試連線」，應顯示「成功！花了 X 秒」。
3. 用**手機瀏覽器**（Safari 或 Chrome）打開同一個測試頁，重複 1～2。
   - 📝 記下電腦與手機各花幾秒。

## D. 驗證 ②：帳號登入與過期

1. 在測試頁「帳號登入測試」：帳號填 `test_wolf01`、密碼填 8 個字元以上、稱呼填「測試小狼媽媽」→ 按「註冊」。
   - 📝 記下畫面上「密碼雜湊花了幾毫秒」。
2. **不勾**「記住我」→ 按「登入」→ 應看到「✅ 你已登入」。
3. 等 **3 分鐘** → 按「再呼叫一次」→ 應回到登入畫面，並顯示「登入已過期，請重新登入」。
4. 重新登入（不勾記住我）→ 應直接回到「✅ 你已登入」畫面。
5. 按「登出」→ **勾**「記住我」→ 登入 → **關掉瀏覽器分頁**再重新打開測試頁 → 應直接是「✅ 你已登入」。
6. 故意輸錯密碼 → 應顯示「帳號或密碼錯誤」；輸入不存在的帳號 → 也應顯示同一句。

## E. 驗證 ③：LINE 官方帳號回覆（約 15 分鐘）

1. 開啟 https://manager.line.biz ，進入你的官方帳號 → 右上「設定」→ 左側「Messaging API」→「啟用 Messaging API」。
   - 選擇或建立 Provider，名稱例如「22團幼童軍」（之後不能改，取個正式的）。
2. 開啟 https://developers.line.biz/console/ → 點剛才的 Provider → 點官方帳號的 channel → 上方「Messaging API」分頁。
3. 拉到最下方「Channel access token (long-lived)」→ 按「Issue」。
   - 📝 抄下這串 token（**不可外流**）。
4. 回 Apps Script → 左側齒輪「專案設定」→ 最下方「指令碼屬性」→「新增指令碼屬性」：
   - 屬性：`LINE_MESSAGING_TOKEN`，值：貼上第 3 步的 token → 「儲存指令碼屬性」。
   - 檢查：同一區應該已經有 `WEBHOOK_KEY`（第 A5 步自動產生的）。
5. 回 LINE Developers「Messaging API」分頁 →「Webhook settings」：
   - Webhook URL 按「Edit」，貼上：**GAS 網址** + `?key=` + **webhook 密鑰**（例如 `https://script.google.com/macros/s/AAA/exec?key=BBB`）→「Update」。
   - 打開「Use webhook」。
   - 「Webhook redelivery」保持**關閉**。
   - 可以按「Verify」看看，**顯示錯誤（例如 302）也先不用理會**，以下一步實際收到回覆為準。📝 記下 Verify 顯示的結果。
6. 回 https://manager.line.biz →「設定」→「回應設定」：「聊天」關閉、「自動回應訊息」**關閉**、「Webhook」**開啟**。
7. 用手機 LINE 加官方帳號好友，傳任意文字（例如「你好」）。
   - 應收到「✅ 0B 測試成功：收到你的訊息「你好」」。
8. 回 Apps Script，函式選 `showWebhookLog` →「執行」，📝 把執行記錄那一行抄下來（只有時間、事件數與回覆狀態碼，不含訊息內容）。

## F. 回報給我

請把以下結果回覆給我（**不要**貼 token、webhook 密鑰或任何網址中的 key）：

```
① 電腦：成功/失敗，X 秒；手機：成功/失敗，X 秒（手機型號與瀏覽器）
② 註冊雜湊 X 毫秒；過期後回到登入畫面：是/否；重新登入回到原畫面：是/否；記住我：是/否；錯誤訊息一致：是/否
③ Verify 結果：……；收到回覆：是/否；showWebhookLog：……
其他卡住或看不懂的地方：……
```

## G. 驗證結束後

- Apps Script 執行 `cleanup0B()` 清除測試帳號（WEBHOOK_KEY 與 LINE_MESSAGING_TOKEN 會保留，正式版繼續用）。
- 試算表、Apps Script 專案、LINE 設定都保留，階段 2 直接沿用。

---

## 驗證結果（2026-11-14）
- ① 通過：電腦與手機瀏覽器皆可呼叫 GAS，單次約 0.9～2.3 秒。
- ② 通過：註冊（雜湊 1000 次 380 毫秒）、登入、記住我、過期回登入畫面、錯誤訊息一致。
- ③ 通過：LINE 傳訊後同一分鐘收到回覆。曾因 Webhook URL 的密鑰與 `WEBHOOK_KEY` 不一致而略過事件，修正後正常。
- 後續待辦：執行 `cleanup0B()`；重新發行曾在截圖中露出的 Channel secret 與 Channel access token。
