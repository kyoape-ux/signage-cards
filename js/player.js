/**
 * 光田綜合醫院 公播圖卡播放核心邏輯
 * player.js — 相容 Android WebView (Android 5+)
 *
 * 功能：
 * - 讀取 Google Sheets（gviz JSON 格式）
 * - 依群組、日期、時段過濾圖卡
 * - 輪播 + 淡入淡出轉場
 * - 圖片預載入（避免切換白畫面）
 * - 網路斷線時繼續播放上次清單
 * - 記憶體安全（只保留當前 + 下一張 DOM）
 */

(function () {
  'use strict';

  /* ============================================================
     設定（由各播放頁面 HTML 注入 window.PLAYER_CONFIG）
     ============================================================ */
  var CONFIG = window.PLAYER_CONFIG || {};

  var SHEET_ID    = CONFIG.sheetId    || '';        // Google Sheets ID
  var JSON_URL    = CONFIG.jsonUrl    || 'data/cards.json'; // JSON 檔案路徑（備用）
  var GROUP       = CONFIG.group      || '';        // 群組名稱（可被 URL 參數覆蓋）
  var INTERVAL    = CONFIG.interval   || 8;         // 每張停留秒數
  var TRANSITION  = CONFIG.transition || 'fade';    // 轉場效果
  var REFRESH     = CONFIG.refresh    || 60;        // 重新讀取 Sheets 間隔秒數
  var DEBUG       = CONFIG.debug      || false;     // 開發除錯模式

  /* ============================================================
     解析 URL 參數（覆蓋預設值）
     ============================================================ */
  function getUrlParam(name) {
    var search = (window.location.search || '').replace('?', '');
    var parts = search.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (decodeURIComponent(kv[0]) === name) {
        return decodeURIComponent(kv[1] || '');
      }
    }
    return null;
  }

  var urlGroup      = getUrlParam('group');
  var urlInterval   = getUrlParam('interval');
  var urlTransition = getUrlParam('transition');
  var urlRefresh    = getUrlParam('refresh');
  var urlDebug      = getUrlParam('debug');
  var urlSheetId    = getUrlParam('sheetId');

  if (urlGroup)      GROUP      = urlGroup;
  if (urlInterval)   INTERVAL   = parseInt(urlInterval, 10)  || INTERVAL;
  if (urlTransition) TRANSITION = urlTransition;
  if (urlRefresh)    REFRESH    = parseInt(urlRefresh, 10)   || REFRESH;
  if (urlDebug)      DEBUG      = (urlDebug === '1' || urlDebug === 'true');
  if (urlSheetId)    SHEET_ID   = urlSheetId;

  /* ============================================================
     狀態
     ============================================================ */
  var playlist       = [];    // 目前播放清單（已過濾排序）
  var currentIndex   = 0;     // 目前播放索引
  var slideTimer     = null;  // 輪播計時器
  var refreshTimer   = null;  // 資料更新計時器
  var isTransitioning = false;

  /* ============================================================
     DOM 參考
     ============================================================ */
  var container, slideA, slideB, imgA, imgB,
      defaultScreen, loadingIndicator, debugInfo;

  /* ============================================================
     初始化
     ============================================================ */
  function init() {
    container        = document.getElementById('player-container');
    slideA           = document.getElementById('slide-a');
    slideB           = document.getElementById('slide-b');
    imgA             = document.getElementById('img-a');
    imgB             = document.getElementById('img-b');
    defaultScreen    = document.getElementById('default-screen');
    loadingIndicator = document.getElementById('loading-indicator');
    debugInfo        = document.getElementById('debug-info');

    if (!container) {
      logDebug('ERROR: #player-container not found');
      return;
    }

    // 套用轉場 class
    container.className = 'transition-' + TRANSITION;

    // 阻止右鍵選單
    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    logDebug('Init — group: ' + GROUP + ' | interval: ' + INTERVAL + 's | refresh: ' + REFRESH + 's');

    // 首次讀取資料
    fetchCards();

    // 定時刷新
    refreshTimer = setInterval(function () {
      fetchCards();
    }, REFRESH * 1000);
  }

  /* ============================================================
     讀取資料（優先 Sheets → 失敗自動讀 JSON 檔）
     ============================================================ */
  function fetchCards() {
    showLoading(true);

    if (SHEET_ID) {
      fetchFromSheets(function (success) {
        if (!success) {
          logDebug('Sheets 讀取失敗，改讀 JSON 檔案');
          fetchFromJson();
        }
      });
    } else {
      logDebug('未設定 SHEET_ID，讀取 JSON 檔案');
      fetchFromJson();
    }
  }

  /* ============================================================
     從 Google Sheets 讀取（gviz JSON）
     ============================================================ */
  function fetchFromSheets(callback) {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:json&sheet=cards&headers=1&t=' + Date.now();

    var doFetch = function (responseText) {
      var allCards = processSheetData(responseText);
      if (allCards !== null && allCards.length > 0) {
        callback(true);
      } else {
        callback(false);
      }
    };

    if (typeof fetch !== 'undefined') {
      fetch(url)
        .then(function (res) {
          if (!res.ok) { throw new Error('HTTP ' + res.status); }
          return res.text();
        })
        .then(function (text) {
          doFetch(text);
        })
        .catch(function (err) {
          logDebug('Sheets fetch error: ' + err.message);
          callback(false);
        });
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          doFetch(xhr.responseText);
        } else {
          logDebug('Sheets XHR error: ' + xhr.status);
          callback(false);
        }
      };
      xhr.send();
    }
  }

  /* ============================================================
     從 JSON 檔案讀取（本地 / GitHub Pages）
     ============================================================ */
  function fetchFromJson() {
    var url = JSON_URL + '?t=' + Date.now();

    var processJson = function (text) {
      showLoading(false);
      try {
        var allCards = JSON.parse(text);
        if (!Array.isArray(allCards)) {
          logDebug('JSON 格式錯誤：不是陣列');
          if (playlist.length === 0) { showDefault(); }
          return;
        }
        logDebug('JSON 讀取到 ' + allCards.length + ' 筆資料');
        var filtered = filterCards(allCards);
        logDebug('過濾後 ' + filtered.length + ' 筆（group=' + GROUP + '）');
        updatePlaylist(filtered);
      } catch (e) {
        logDebug('JSON parse error: ' + e.message);
        if (playlist.length === 0) { showDefault(); }
      }
    };

    if (typeof fetch !== 'undefined') {
      fetch(url)
        .then(function (res) {
          if (!res.ok) { throw new Error('HTTP ' + res.status); }
          return res.text();
        })
        .then(processJson)
        .catch(function (err) {
          logDebug('JSON fetch error: ' + err.message);
          showLoading(false);
          if (playlist.length === 0) { showDefault(); }
        });
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          processJson(xhr.responseText);
        } else {
          logDebug('JSON XHR error: ' + xhr.status);
          showLoading(false);
          if (playlist.length === 0) { showDefault(); }
        }
      };
      xhr.send();
    }
  }

  /* ============================================================
     解析 gviz JSON
     ============================================================ */
  function parseGvizJson(text) {
    // gviz 回傳格式：/*O_o*/\ngoogle.visualization.Query.setResponse({...});
    var jsonStr = text
      .replace(/^[^(]+\(/, '')   // 移除前綴
      .replace(/\);?\s*$/, ''); // 移除後綴
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      logDebug('JSON parse error: ' + e.message);
      return null;
    }
  }

  function processSheetData(text) {
    showLoading(false);
    var data = parseGvizJson(text);
    if (!data || !data.table) {
      logDebug('無效的 Sheets 資料');
      return null;
    }

    var rows  = data.table.rows  || [];
    var cols  = data.table.cols  || [];

    // 建立欄位索引 map
    // gviz 有時 parsedNumHeaders=0，label 為空，需用第一列資料當標題
    var colMap = {};
    var hasLabels = false;
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].label && cols[i].label.trim()) {
        colMap[cols[i].label.trim()] = i;
        hasLabels = true;
      }
    }

    var dataStartRow = 0;
    if (!hasLabels && rows.length > 0) {
      // 用第一列當作 header
      var headerCells = rows[0].c || [];
      for (var h = 0; h < headerCells.length; h++) {
        if (headerCells[h] && headerCells[h].v) {
          colMap[String(headerCells[h].v).trim()] = h;
        }
      }
      dataStartRow = 1; // 跳過 header 列
    }

    logDebug('Sheets 欄位: ' + Object.keys(colMap).join(', '));

    // 解析每一列
    var allCards = [];
    for (var r = dataStartRow; r < rows.length; r++) {
      var cells = rows[r].c || [];

      // 安全取值（用閉包避免重複宣告問題）
      var cellVal = function (colName) {
        var idx = colMap[colName];
        if (idx === undefined || idx === null) { return ''; }
        var cell = cells[idx];
        if (!cell || cell.v === null || cell.v === undefined) { return ''; }
        return cell.v;
      };

      var card = {};
      card.id             = String(cellVal('id') || '');
      card.image_url      = String(cellVal('image_url') || '');
      card.group          = String(cellVal('group') || '');
      card.start_date     = String(cellVal('start_date') || '');
      card.end_date       = String(cellVal('end_date') || '');
      card.start_time     = String(cellVal('start_time') || '00:00');
      card.end_time       = String(cellVal('end_time') || '23:59');
      card.sort_order     = parseInt(cellVal('sort_order'), 10) || 0;
      card.enabled        = String(cellVal('enabled')).toUpperCase() === 'TRUE';
      card.note           = String(cellVal('note') || '');

      if (card.image_url) {
        allCards.push(card);
      }
    }

    logDebug('Sheets 讀取到 ' + allCards.length + ' 筆資料');

    // 檢查是否真的有 cards 欄位（避免讀到 groups 分頁的資料）
    if (!colMap['image_url'] && colMap['image_url'] !== 0) {
      logDebug('Sheets 欄位不符合 cards 格式，跳過');
      return null;
    }

    // 過濾
    var filtered = filterCards(allCards);
    logDebug('過濾後 ' + filtered.length + ' 筆（group=' + GROUP + '）');

    updatePlaylist(filtered);
    return allCards;
  }

  /* ============================================================
     過濾邏輯
     ============================================================ */
  function filterCards(cards) {
    var now       = new Date();
    var todayStr  = formatDate(now);   // YYYY/MM/DD
    var timeStr   = formatTime(now);   // HH:mm

    var result = [];

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];

      // 1. 群組比對
      if (GROUP && c.group !== GROUP) { continue; }

      // 2. 啟用狀態
      if (!c.enabled) { continue; }

      // 3. 日期範圍
      if (c.start_date && todayStr < normalizeDate(c.start_date)) { continue; }
      if (c.end_date   && todayStr > normalizeDate(c.end_date))   { continue; }

      // 4. 時段
      var st = c.start_time || '00:00';
      var et = c.end_time   || '23:59';
      if (timeStr < st || timeStr > et) { continue; }

      result.push(c);
    }

    // 依 sort_order 排序（升序）
    result.sort(function (a, b) {
      return a.sort_order - b.sort_order;
    });

    return result;
  }

  /* ============================================================
     日期/時間工具
     ============================================================ */
  function formatDate(d) {
    var y  = d.getFullYear();
    var m  = pad2(d.getMonth() + 1);
    var dd = pad2(d.getDate());
    return y + '/' + m + '/' + dd;
  }

  function formatTime(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // 統一日期格式為 YYYY/MM/DD（支援 YYYY-MM-DD 輸入）
  function normalizeDate(str) {
    return String(str).replace(/-/g, '/').trim();
  }

  /* ============================================================
     更新播放清單
     ============================================================ */
  function updatePlaylist(newList) {
    var wasEmpty = playlist.length === 0;

    if (newList.length === 0) {
      playlist = [];
      currentIndex = 0;
      clearInterval(slideTimer);
      slideTimer = null;
      showDefault();
      return;
    }

    // 盡量保持當前圖卡位置
    var currentUrl = (playlist.length > 0) ? playlist[currentIndex % playlist.length].image_url : null;
    playlist = newList;

    // 找回目前圖卡的索引
    var found = -1;
    if (currentUrl) {
      for (var i = 0; i < playlist.length; i++) {
        if (playlist[i].image_url === currentUrl) {
          found = i;
          break;
        }
      }
    }
    currentIndex = (found >= 0) ? found : 0;

    // 隱藏預設畫面
    if (defaultScreen) {
      defaultScreen.className = '';
    }

    if (wasEmpty || !slideTimer) {
      // 首次或重新開始播放
      showSlide(currentIndex);
      startSlideTimer();
    }
    // 如果正在播放，下一次切換時會自動使用新清單
  }

  /* ============================================================
     輪播計時器
     ============================================================ */
  function startSlideTimer() {
    if (slideTimer) { clearInterval(slideTimer); }
    slideTimer = setInterval(function () {
      nextSlide();
    }, INTERVAL * 1000);
  }

  function nextSlide() {
    if (playlist.length === 0) { return; }
    currentIndex = (currentIndex + 1) % playlist.length;
    showSlide(currentIndex);
  }

  /* ============================================================
     顯示特定圖卡（兩層交替淡入淡出）
     ============================================================ */
  function showSlide(index) {
    if (isTransitioning) { return; }
    if (!playlist[index]) { return; }

    var url = playlist[index].image_url;
    logDebug('播放 [' + index + '] ' + url);

    // 判斷哪一層是 active
    var isAActive = slideA.classList.contains('active');
    var nextSlideEl = isAActive ? slideB : slideA;
    var nextImgEl   = isAActive ? imgB   : imgA;
    var prevSlideEl = isAActive ? slideA : slideB;

    // 預載下一張圖（index+1）
    preloadNext(index);

    isTransitioning = true;

    // 設定新圖片
    nextImgEl.src = url;

    nextImgEl.onload = function () {
      // 套用 slide 轉場特效
      if (TRANSITION === 'slide') {
        nextSlideEl.style.webkitTransform = 'translateX(100%)';
        nextSlideEl.style.transform = 'translateX(100%)';
      }

      // 切換 class
      nextSlideEl.className = 'slide active';
      prevSlideEl.className = 'slide prev';

      if (TRANSITION === 'slide') {
        // 觸發 reflow
        void nextSlideEl.offsetWidth;
        nextSlideEl.style.webkitTransform = 'translateX(0)';
        nextSlideEl.style.transform = 'translateX(0)';
      }

      // 轉場結束後重置
      setTimeout(function () {
        prevSlideEl.className = 'slide';
        if (TRANSITION === 'slide') {
          prevSlideEl.style.webkitTransform = '';
          prevSlideEl.style.transform = '';
        }
        isTransitioning = false;
      }, 900); // 略大於 CSS transition duration
    };

    nextImgEl.onerror = function () {
      logDebug('圖片載入失敗，跳過: ' + url);
      isTransitioning = false;
      // 跳過此張，直接播下一張
      if (playlist.length > 1) {
        currentIndex = (currentIndex + 1) % playlist.length;
        showSlide(currentIndex);
      }
    };
  }

  /* ============================================================
     預載下一張圖片
     ============================================================ */
  function preloadNext(currentIdx) {
    if (playlist.length <= 1) { return; }
    var nextIdx = (currentIdx + 1) % playlist.length;
    var nextUrl = playlist[nextIdx].image_url;

    // 用隱藏的 Image 物件預載
    var preloadImg = new Image();
    preloadImg.src = nextUrl;
    // 讓 GC 自動回收
    preloadImg.onload = preloadImg.onerror = function () {
      preloadImg = null;
    };
  }

  /* ============================================================
     預設畫面（無圖卡時）
     ============================================================ */
  function showDefault() {
    if (!defaultScreen) { return; }
    defaultScreen.className = 'visible';
    logDebug('顯示預設畫面（無符合圖卡）');
  }

  /* ============================================================
     載入指示器
     ============================================================ */
  function showLoading(visible) {
    if (!loadingIndicator) { return; }
    loadingIndicator.className = visible ? 'visible' : '';
  }

  /* ============================================================
     除錯 log
     ============================================================ */
  function logDebug(msg) {
    var ts = new Date().toLocaleTimeString('zh-TW');
    console.log('[Player ' + ts + '] ' + msg);

    if (DEBUG && debugInfo) {
      debugInfo.className = 'show';
      debugInfo.textContent = '[' + ts + '] ' + msg + '\n' + debugInfo.textContent;
      // 限制行數避免記憶體增長
      var lines = debugInfo.textContent.split('\n');
      if (lines.length > 20) {
        debugInfo.textContent = lines.slice(0, 20).join('\n');
      }
    }
  }

  /* ============================================================
     頁面可見性 API — 頁面回到前景時刷新資料
     ============================================================ */
  function onVisibilityChange() {
    if (document.hidden === false || document.webkitHidden === false) {
      logDebug('頁面回到前景，刷新資料');
      fetchCards();
    }
  }

  if (typeof document.hidden !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  } else if (typeof document.webkitHidden !== 'undefined') {
    document.addEventListener('webkitvisibilitychange', onVisibilityChange);
  }

  /* ============================================================
     啟動
     ============================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
