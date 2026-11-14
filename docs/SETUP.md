# 設定步驟（SETUP）

> 骨架。階段 0B 會先寫「技術驗證用的精簡步驟」，階段 4A 補到足以上線，階段 6 定稿。
> 每一步都會標明：要抄下什麼值、填到哪裡。

1. 建 Google 試算表與 Apps Script 專案、clasp login、填 scriptId
2. LINE Developers：建 Provider、Messaging API channel（官方帳號）
3. 設定 Script Properties 的每一個鍵
4. clasp push、部署成 Web App、之後更新版本的指令
5. GitHub Pages 啟用
6. webhook 網址設定、關閉官方帳號內建自動回應
7. 建立備份資料夾並填入資料夾 ID
8. 執行 setup()、安裝每日排程與每週備份排程
9. 用 setup() 產生的團長邀請碼註冊，成為第一位團長，並連結 LINE 通知
10. 設定試算表與備份資料夾的分享權限，執行一次權限檢查
11. 確認個資告知同意內容
12. 圖文選單設定
13. 上線流程：指定其他管理員 → 輸入名單與入團日 → 補登既有頒章 → 填技能章說明 → 發綁定碼給家長
