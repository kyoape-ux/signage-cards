# 光田綜合醫院 公播圖卡管理系統

Digital Signage Card Manager — 基於 Google Sheets + GitHub Pages 的輕量化公播排程系統。

---

## 快速開始（Phase 1 部署）

### 步驟一：建立 Google Sheets

1. 前往 [Google Sheets](https://sheets.google.com) 建立新試算表
2. 將試算表命名為「光田公播圖卡」
3. 複製試算表網址中的 ID（`/d/` 和 `/edit` 之間的那段字串）
   ```
   https://docs.google.com/spreadsheets/d/【這段就是 SHEET_ID】/edit
   ```

4. 建立兩個工作表（分頁）：
   - `cards`（圖卡資料）
   - `groups`（群組設定）

5. **cards 工作表**第一列填入以下標題（欄位順序不能改）：
   ```
   id | image_url | image_filename | thumbnail | group | size | start_date | end_date | start_time | end_time | sort_order | enabled | note | created_at | updated_at
   ```

6. **groups 工作表**第一列填入：
   ```
   group_name | size | description | player_url
   ```

7. 填入預設群組資料：

   | group_name | size | description | player_url |
   |---|---|---|---|
   | 公共區域直式 | 1080x1920 | 電梯旁直立式螢幕 | player-v.html?group=公共區域直式 |
   | 公共區域宣傳橫式 | 1920x1080 | 大廳宣傳橫式螢幕 | player-h.html?group=公共區域宣傳橫式 |
   | 門診大內科全區 | 800x1080 | 內科診間叫號螢幕右側 | player-r.html?group=門診大內科全區 |
   | 門診大外科全區 | 800x1080 | 外科診間叫號螢幕右側 | player-r.html?group=門診大外科全區 |
   | 婦女整合門診 | 800x1080 | 婦科診間叫號螢幕右側 | player-r.html?group=婦女整合門診 |

8. 公開試算表：
   - 檔案 → 共用 → 變更為任何知道連結的人可以**檢視**
   - （不需要編輯權限，播放頁面只需讀取）

### 步驟二：填入測試資料

在 `cards` 工作表填入 2-3 筆測試圖卡，例如：

| id | image_url | image_filename | thumbnail | group | size | start_date | end_date | start_time | end_time | sort_order | enabled | note | created_at | updated_at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| card_001 | https://raw.githubusercontent.com/你的帳號/你的repo/main/images/test1.jpg | test1.jpg | | 公共區域宣傳橫式 | 1920x1080 | 2026/01/01 | 2026/12/31 | 00:00 | 23:59 | 1 | TRUE | 測試圖1 | 2026/01/01 | 2026/01/01 |

### 步驟三：設定 SHEET_ID

編輯三個播放頁面，將 `YOUR_GOOGLE_SHEETS_ID` 替換為你的 Sheets ID：

- `player-h.html` → 第 52 行
- `player-v.html` → 第 52 行
- `player-r.html` → 第 52 行

```javascript
window.PLAYER_CONFIG = {
  sheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms', // ← 換成你的 ID
  group: '公共區域宣傳橫式',
  ...
};
```

### 步驟四：部署到 GitHub Pages

1. 在 GitHub 建立新 repo（例如 `signage-cards`）
2. 將整個資料夾推送到 repo：
   ```bash
   cd /Users/mac/Desktop/公播管理系統
   git init
   git add .
   git commit -m "init: 公播圖卡管理系統 Phase 1"
   git branch -M main
   git remote add origin https://github.com/你的帳號/signage-cards.git
   git push -u origin main
   ```

3. 啟用 GitHub Pages：
   - repo 設定 → Pages → Branch: `main` / `/(root)`
   - 儲存後等約 1 分鐘

4. 存取播放頁面：
   ```
   https://你的帳號.github.io/signage-cards/player-h.html
   https://你的帳號.github.io/signage-cards/player-v.html
   https://你的帳號.github.io/signage-cards/player-r.html?group=門診大外科全區
   ```

### 步驟五：在 iDroid 編輯器設定 URL 元件

1. 開啟 iDroid Media Editor
2. 新增或編輯節目單版型
3. 圖卡輪播區域改為「URL 元件」
4. 填入對應的播放頁面 URL
5. 上傳節目單到 iDroidServer
6. **之後更換圖卡只需更新 Google Sheets，不需再動 iDroid**

---

## URL 參數說明

所有播放頁面支援以下 URL 參數：

| 參數 | 說明 | 預設值 |
|---|---|---|
| `group` | 群組名稱 | HTML 內設定值 |
| `interval` | 每張圖卡停留秒數 | `8` |
| `transition` | 轉場效果：`fade` / `slide` / `none` | `fade` |
| `refresh` | 重新讀取 Sheets 間隔秒數 | `60` |
| `sheetId` | Google Sheets ID（覆蓋 HTML 設定） | HTML 內設定值 |
| `debug` | 開啟除錯模式（顯示 log）：`1` | `false` |

範例：
```
player-r.html?group=婦女整合門診&interval=10&debug=1
```

---

## 圖片規格建議

| 播放頁面 | 尺寸 | 建議圖片規格 |
|---|---|---|
| player-h.html | 1920×1080 | JPG，1920×1080px，< 1MB |
| player-v.html | 1080×1920 | JPG，1080×1920px，< 1MB |
| player-r.html | 800×1080 | JPG，800×1080px，< 500KB |

---

## Phase 2（管理後台）

開發中，完成後可從管理後台：
- 拖曳上傳圖片（自動推送到 GitHub）
- 設定圖卡上下架日期
- 批次延期、停用圖卡
- 一鍵複製延期

---

## 檔案結構

```
公播管理系統/
├── player-h.html         # 播放頁面 — 橫式 1920×1080
├── player-v.html         # 播放頁面 — 直式 1080×1920
├── player-r.html         # 播放頁面 — 右半版 800×1080
├── css/
│   └── player.css        # 播放頁面共用樣式
├── js/
│   └── player.js         # 播放頁面核心邏輯
├── images/               # 圖卡圖片（Git 管理）
│   └── .gitkeep
├── assets/
│   ├── kt-logo.png       # 光田 Logo（預設畫面用）
│   └── default-bg.png    # 預設背景
├── apps-script/
│   └── code.gs           # Google Apps Script（Phase 2 用）
└── README.md
```
