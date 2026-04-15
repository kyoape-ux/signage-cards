/**
 * 修復 cards 工作表 — 貼進 Apps Script 後選此函式執行
 */
function fixCards() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 找到或建立 cards 工作表
  var cardsSheet = ss.getSheetByName('cards');
  if (!cardsSheet) {
    cardsSheet = ss.insertSheet('cards');
  } else {
    cardsSheet.clear();
  }

  // 寫入標題列
  var headers = ['id','image_url','image_filename','thumbnail','group','size','start_date','end_date','start_time','end_time','sort_order','enabled','note','created_at','updated_at'];
  cardsSheet.appendRow(headers);

  // 寫入 3 筆測試圖卡
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

  cardsSheet.appendRow([
    'card_001',
    'https://picsum.photos/id/1015/1920/1080',
    'test-h.jpg', '',
    '公共區域宣傳橫式', '1920x1080',
    '2026/01/01', '2026/12/31',
    '00:00', '23:59',
    1, 'TRUE',
    '橫式測試圖卡', today, today
  ]);

  cardsSheet.appendRow([
    'card_002',
    'https://picsum.photos/id/1025/1920/1080',
    'test-h2.jpg', '',
    '公共區域宣傳橫式', '1920x1080',
    '2026/01/01', '2026/12/31',
    '00:00', '23:59',
    2, 'TRUE',
    '橫式測試圖卡2', today, today
  ]);

  cardsSheet.appendRow([
    'card_003',
    'https://picsum.photos/id/1035/1080/1920',
    'test-v.jpg', '',
    '公共區域直式', '1080x1920',
    '2026/01/01', '2026/12/31',
    '00:00', '23:59',
    1, 'TRUE',
    '直式測試圖卡', today, today
  ]);

  // 格式美化
  var h = cardsSheet.getRange(1, 1, 1, headers.length);
  h.setFontWeight('bold');
  h.setBackground('#0F6E56');
  h.setFontColor('#fff');
  cardsSheet.setFrozenRows(1);
  cardsSheet.autoResizeColumns(1, headers.length);

  // 確保 groups 工作表存在且正確
  var groupsSheet = ss.getSheetByName('groups');
  if (!groupsSheet) {
    groupsSheet = ss.insertSheet('groups');
    groupsSheet.appendRow(['group_name','size','description','player_url']);
    groupsSheet.appendRow(['公共區域直式','1080x1920','電梯旁直立式螢幕','player-v.html?group=公共區域直式']);
    groupsSheet.appendRow(['公共區域宣傳橫式','1920x1080','大廳宣傳橫式螢幕','player-h.html?group=公共區域宣傳橫式']);
    groupsSheet.appendRow(['門診大內科全區','800x1080','內科診間叫號螢幕右側','player-r.html?group=門診大內科全區']);
    groupsSheet.appendRow(['門診大外科全區','800x1080','外科診間叫號螢幕右側','player-r.html?group=門診大外科全區']);
    groupsSheet.appendRow(['婦女整合門診','800x1080','婦科診間叫號螢幕右側','player-r.html?group=婦女整合門診']);
    var gh = groupsSheet.getRange(1,1,1,4);
    gh.setFontWeight('bold');
    gh.setBackground('#0F6E56');
    gh.setFontColor('#fff');
    groupsSheet.setFrozenRows(1);
    groupsSheet.autoResizeColumns(1,4);
  }

  SpreadsheetApp.getUi().alert('✅ cards 工作表已修復！\n\n已填入 3 筆測試圖卡，播放頁面應該馬上就能看到圖片了。');
}
