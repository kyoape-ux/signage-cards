/**
 * 光田公播圖卡管理系統 — Google Sheets 一鍵初始化
 *
 * 使用方式：
 * 1. 開新的 Google 試算表
 * 2. 擴充功能 → Apps Script
 * 3. 把這整段貼進去（取代原有內容）
 * 4. 點「執行」→ 允許授權
 * 5. 執行完成後關掉 Apps Script，回到試算表即可
 */

function initSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 建立 cards 工作表 ──────────────────────────────
  var cardsSheet = ss.getSheetByName('cards');
  if (!cardsSheet) {
    cardsSheet = ss.insertSheet('cards');
  } else {
    cardsSheet.clear();
  }

  var cardsHeaders = [
    'id', 'image_url', 'image_filename', 'thumbnail',
    'group', 'size', 'start_date', 'end_date',
    'start_time', 'end_time', 'sort_order', 'enabled',
    'note', 'created_at', 'updated_at'
  ];
  cardsSheet.appendRow(cardsHeaders);

  // 範例圖卡（方便測試用，稍後可刪除）
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
  cardsSheet.appendRow([
    'card_001',
    'https://picsum.photos/1920/1080',  // 測試用隨機圖片，正式請換成實際 URL
    'test-1920x1080.jpg',
    '',
    '公共區域宣傳橫式',
    '1920x1080',
    '2026/01/01',
    '2026/12/31',
    '00:00',
    '23:59',
    '1',
    'TRUE',
    '測試用圖卡（可刪除）',
    today,
    today
  ]);
  cardsSheet.appendRow([
    'card_002',
    'https://picsum.photos/1080/1920',
    'test-1080x1920.jpg',
    '',
    '公共區域直式',
    '1080x1920',
    '2026/01/01',
    '2026/12/31',
    '00:00',
    '23:59',
    '1',
    'TRUE',
    '測試用圖卡（可刪除）',
    today,
    today
  ]);

  // 標頭列格式：粗體 + 背景色
  var cardsHeader = cardsSheet.getRange(1, 1, 1, cardsHeaders.length);
  cardsHeader.setFontWeight('bold');
  cardsHeader.setBackground('#0F6E56');
  cardsHeader.setFontColor('#ffffff');
  cardsSheet.setFrozenRows(1);

  // 欄寬自動調整
  cardsSheet.autoResizeColumns(1, cardsHeaders.length);

  // ── 建立 groups 工作表 ────────────────────────────
  var groupsSheet = ss.getSheetByName('groups');
  if (!groupsSheet) {
    groupsSheet = ss.insertSheet('groups');
  } else {
    groupsSheet.clear();
  }

  var groupsHeaders = ['group_name', 'size', 'description', 'player_url'];
  groupsSheet.appendRow(groupsHeaders);

  var groups = [
    ['公共區域直式',     '1080x1920', '電梯旁直立式螢幕',     'player-v.html?group=公共區域直式'],
    ['公共區域宣傳橫式', '1920x1080', '大廳宣傳橫式螢幕',     'player-h.html?group=公共區域宣傳橫式'],
    ['門診大內科全區',   '800x1080',  '內科診間叫號螢幕右側', 'player-r.html?group=門診大內科全區'],
    ['門診大外科全區',   '800x1080',  '外科診間叫號螢幕右側', 'player-r.html?group=門診大外科全區'],
    ['婦女整合門診',     '800x1080',  '婦科診間叫號螢幕右側', 'player-r.html?group=婦女整合門診']
  ];
  for (var i = 0; i < groups.length; i++) {
    groupsSheet.appendRow(groups[i]);
  }

  var groupsHeader = groupsSheet.getRange(1, 1, 1, groupsHeaders.length);
  groupsHeader.setFontWeight('bold');
  groupsHeader.setBackground('#0F6E56');
  groupsHeader.setFontColor('#ffffff');
  groupsSheet.setFrozenRows(1);
  groupsSheet.autoResizeColumns(1, groupsHeaders.length);

  // ── 刪除預設的 Sheet1（如果存在）──────────────────
  var defaultSheet = ss.getSheetByName('工作表1');
  if (!defaultSheet) { defaultSheet = ss.getSheetByName('Sheet1'); }
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  // ── 完成提示 ──────────────────────────────────────
  var sheetId = ss.getId();
  Logger.log('✅ 初始化完成！');
  Logger.log('Sheets ID：' + sheetId);
  Logger.log('請複製此 ID 填入 player HTML 的 sheetId 欄位');

  SpreadsheetApp.getUi().alert(
    '✅ 初始化完成！\n\n' +
    'Sheets ID：\n' + sheetId + '\n\n' +
    '請複製此 ID，填入 player-h.html / player-v.html / player-r.html\n' +
    '的 sheetId 設定欄位。\n\n' +
    '記得把試算表設定為「知道連結的人可以檢視」！'
  );
}
