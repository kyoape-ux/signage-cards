/**
 * 光田綜合醫院 公播圖卡管理系統
 * Google Apps Script — Web App 中間層
 *
 * 部署方式：
 * 1. 開啟你的 Google Sheets → 擴充功能 → Apps Script
 * 2. 貼上此程式碼，儲存
 * 3. 部署 → 新增部署 → 類型選「網路應用程式」
 * 4. 執行身分：我（你的帳號）
 * 5. 存取權：所有人（含匿名）
 * 6. 複製部署 URL，填入管理後台設定
 *
 * API 端點：
 *   GET  ?action=getCards              → 取得所有圖卡
 *   GET  ?action=getGroups             → 取得所有群組
 *   POST { action: 'addCard', ... }    → 新增圖卡
 *   POST { action: 'updateCard', ... } → 更新圖卡
 *   POST { action: 'deleteCard', id }  → 刪除圖卡
 *   POST { action: 'addGroup', ... }   → 新增群組
 *   POST { action: 'updateGroup', ... }→ 更新群組
 *   POST { action: 'deleteGroup', ... }→ 刪除群組
 */

// ============================================================
// GET 請求處理
// ============================================================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getCards';
  var result;

  try {
    if (action === 'getCards') {
      result = getCards();
    } else if (action === 'getGroups') {
      result = getGroups();
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return buildResponse(result);
}

// ============================================================
// POST 請求處理
// ============================================================
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return buildResponse({ success: false, error: 'Invalid JSON: ' + err.message });
  }

  var action = data.action;
  var result;

  try {
    if (action === 'addCard') {
      result = addCard(data);
    } else if (action === 'updateCard') {
      result = updateCard(data);
    } else if (action === 'deleteCard') {
      result = deleteCard(data.id);
    } else if (action === 'addGroup') {
      result = addGroup(data);
    } else if (action === 'updateGroup') {
      result = updateGroup(data);
    } else if (action === 'deleteGroup') {
      result = deleteGroup(data.group_name);
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return buildResponse(result);
}

// ============================================================
// cards 工作表操作
// ============================================================

// cards 欄位順序（與 Sheets 對應）
var CARD_COLS = [
  'id', 'image_url', 'image_filename', 'thumbnail', 'group', 'size',
  'start_date', 'end_date', 'start_time', 'end_time',
  'sort_order', 'enabled', 'note', 'created_at', 'updated_at'
];

function getCardsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('cards');
  if (!sheet) {
    // 自動建立 cards 工作表
    sheet = ss.insertSheet('cards');
    sheet.appendRow(CARD_COLS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getGroupsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('groups');
  if (!sheet) {
    sheet = ss.insertSheet('groups');
    sheet.appendRow(['group_name', 'size', 'description', 'player_url']);
    sheet.setFrozenRows(1);
    // 填入預設群組
    var defaults = [
      ['公共區域直式',     '1080x1920', '電梯旁直立式螢幕',      'player-v.html?group=公共區域直式'],
      ['公共區域宣傳橫式', '1920x1080', '大廳宣傳橫式螢幕',      'player-h.html?group=公共區域宣傳橫式'],
      ['門診大內科全區',   '800x1080',  '內科診間叫號螢幕右側',  'player-r.html?group=門診大內科全區'],
      ['門診大外科全區',   '800x1080',  '外科診間叫號螢幕右側',  'player-r.html?group=門診大外科全區'],
      ['婦女整合門診',     '800x1080',  '婦科診間叫號螢幕右側',  'player-r.html?group=婦女整合門診']
    ];
    for (var i = 0; i < defaults.length; i++) {
      sheet.appendRow(defaults[i]);
    }
  }
  return sheet;
}

function getCards() {
  var sheet = getCardsSheet();
  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) { return { success: true, data: [] }; }

  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return { success: true, data: rows };
}

function addCard(card) {
  var sheet = getCardsSheet();
  var now   = new Date().toISOString();
  var id    = card.id || generateId();

  var row = CARD_COLS.map(function (col) {
    if (col === 'id')         { return id; }
    if (col === 'created_at') { return now; }
    if (col === 'updated_at') { return now; }
    if (col === 'enabled' && (card[col] === undefined)) { return true; }
    if (col === 'sort_order' && (card[col] === undefined || card[col] === '')) { return 99; }
    if (col === 'start_time' && !card[col]) { return '00:00'; }
    if (col === 'end_time'   && !card[col]) { return '23:59'; }
    return (card[col] !== undefined && card[col] !== null) ? card[col] : '';
  });

  sheet.appendRow(row);
  return { success: true, id: id };
}

function updateCard(card) {
  var sheet = getCardsSheet();
  var data  = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx = headers.indexOf('id');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(card.id)) {
      var updIdx = headers.indexOf('updated_at');
      if (updIdx >= 0) {
        sheet.getRange(i + 1, updIdx + 1).setValue(new Date().toISOString());
      }
      // 逐欄更新（跳過 id、created_at）
      for (var j = 0; j < headers.length; j++) {
        var col = headers[j];
        if (col === 'id' || col === 'created_at' || col === 'updated_at') { continue; }
        if (card[col] !== undefined) {
          sheet.getRange(i + 1, j + 1).setValue(card[col]);
        }
      }
      return { success: true };
    }
  }
  return { success: false, error: '找不到 id: ' + card.id };
}

function deleteCard(id) {
  var sheet = getCardsSheet();
  var data  = sheet.getDataRange().getValues();
  var idIdx = data[0].indexOf('id');

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: '找不到 id: ' + id };
}

// ============================================================
// groups 工作表操作
// ============================================================

function getGroups() {
  var sheet = getGroupsSheet();
  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) { return { success: true, data: [] }; }

  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return { success: true, data: rows };
}

function addGroup(group) {
  var sheet = getGroupsSheet();
  sheet.appendRow([
    group.group_name  || '',
    group.size        || '',
    group.description || '',
    group.player_url  || ''
  ]);
  return { success: true };
}

function updateGroup(group) {
  var sheet = getGroupsSheet();
  var data  = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameIdx = headers.indexOf('group_name');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]) === String(group.group_name)) {
      for (var j = 0; j < headers.length; j++) {
        var col = headers[j];
        if (group[col] !== undefined) {
          sheet.getRange(i + 1, j + 1).setValue(group[col]);
        }
      }
      return { success: true };
    }
  }
  return { success: false, error: '找不到群組: ' + group.group_name };
}

function deleteGroup(groupName) {
  var sheet = getGroupsSheet();
  var data  = sheet.getDataRange().getValues();
  var nameIdx = data[0].indexOf('group_name');

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][nameIdx]) === String(groupName)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: '找不到群組: ' + groupName };
}

// ============================================================
// 工具函式
// ============================================================

function generateId() {
  return 'card_' + new Date().getTime() + '_' + Math.floor(Math.random() * 10000);
}

function buildResponse(data) {
  var json = JSON.stringify(data);
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
