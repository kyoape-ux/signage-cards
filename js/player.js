/**
 * 光田綜合醫院 公播圖卡播放器 v2
 * player.js — 頻道(Channel) + 標籤(Tag) 架構
 * 相容 Android WebView (Android 5+)
 *
 * URL 參數：
 *   ?channel=ch_hall        頻道 ID（必填）
 *   &interval=8             覆蓋頻道預設秒數
 *   &transition=fade        轉場：fade / slide / none
 *   &refresh=60             資料更新間隔秒
 *   &debug=1                除錯模式
 */

(function () {
  'use strict';

  // ============================================================
  // URL 參數
  // ============================================================
  function getParam(name) {
    var s = (window.location.search || '').substring(1);
    var parts = s.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (decodeURIComponent(kv[0]) === name) {
        return decodeURIComponent(kv[1] || '');
      }
    }
    return null;
  }

  var CHANNEL_ID  = getParam('channel')    || '';
  var INTERVAL    = parseInt(getParam('interval'), 10) || 0; // 0 = 用頻道預設
  var TRANSITION  = getParam('transition') || 'fade';
  var REFRESH     = parseInt(getParam('refresh'), 10)  || 60;
  var DEBUG       = getParam('debug') === '1' || getParam('debug') === 'true';

  // 向下相容舊 URL：?group=xxx → 當作頻道名稱搜尋
  var LEGACY_GROUP = getParam('group') || '';

  // ============================================================
  // 狀態
  // ============================================================
  var channel        = null;   // 當前頻道定義
  var allChannels    = [];
  var playlist       = [];
  var currentIndex   = 0;
  var slideTimer     = null;
  var refreshTimer   = null;
  var isTransitioning = false;

  // ============================================================
  // DOM
  // ============================================================
  var container, slideA, slideB, imgA, imgB,
      defaultScreen, loadingIndicator, debugInfo;

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    container        = document.getElementById('player-container');
    slideA           = document.getElementById('slide-a');
    slideB           = document.getElementById('slide-b');
    imgA             = document.getElementById('img-a');
    imgB             = document.getElementById('img-b');
    defaultScreen    = document.getElementById('default-screen');
    loadingIndicator = document.getElementById('loading-indicator');
    debugInfo        = document.getElementById('debug-info');

    if (!container) { log('ERROR: #player-container not found'); return; }

    container.className = 'transition-' + TRANSITION;

    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    log('Init — channel: ' + (CHANNEL_ID || LEGACY_GROUP) + ' | refresh: ' + REFRESH + 's');

    // 載入頻道 + 圖卡
    loadData();
    refreshTimer = setInterval(loadData, REFRESH * 1000);
  }

  // ============================================================
  // 資料載入
  // ============================================================
  function loadData() {
    showLoading(true);

    // 同時載入 channels.json 和 cards.json
    var channelsLoaded = false, cardsLoaded = false;
    var channelsData = null, cardsData = null;

    function checkBothLoaded() {
      if (!channelsLoaded || !cardsLoaded) return;
      showLoading(false);
      processData(channelsData, cardsData);
    }

    loadJson('data/channels.json', function (data) {
      channelsData = data;
      channelsLoaded = true;
      checkBothLoaded();
    }, function () {
      channelsData = [];
      channelsLoaded = true;
      checkBothLoaded();
    });

    loadJson('data/cards.json', function (data) {
      cardsData = data;
      cardsLoaded = true;
      checkBothLoaded();
    }, function () {
      cardsData = [];
      cardsLoaded = true;
      checkBothLoaded();
    });
  }

  function loadJson(path, onOk, onErr) {
    var url = path + '?t=' + Date.now();

    if (typeof fetch !== 'undefined') {
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(onOk)
        .catch(function (e) {
          log('Fetch ' + path + ' error: ' + e.message);
          onErr();
        });
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { onOk(JSON.parse(xhr.responseText)); }
          catch (e) { onErr(); }
        } else { onErr(); }
      };
      xhr.send();
    }
  }

  // ============================================================
  // 資料處理
  // ============================================================
  function processData(channels, cards) {
    if (!Array.isArray(channels)) channels = [];
    if (!Array.isArray(cards)) cards = [];

    allChannels = channels;

    // 找到目前的頻道
    channel = findChannel(channels);
    if (!channel) {
      log('找不到頻道: ' + (CHANNEL_ID || LEGACY_GROUP));
      showDefault();
      return;
    }

    log('頻道: ' + channel.name + ' (' + channel.size + ') tags=' + (channel.tags || []).join(','));

    // 設定螢幕尺寸
    applySize(channel.size);

    // 設定輪播秒數（URL 參數 > 頻道預設 > 8秒）
    if (!INTERVAL) INTERVAL = channel.interval || 8;

    // 過濾圖卡
    var filtered = filterCards(cards, channel);
    log('過濾後 ' + filtered.length + ' 筆圖卡');

    updatePlaylist(filtered);
  }

  function findChannel(channels) {
    // 優先用 channel ID
    if (CHANNEL_ID) {
      for (var i = 0; i < channels.length; i++) {
        if (channels[i].id === CHANNEL_ID) return channels[i];
      }
    }
    // 向下相容：用 group 名稱比對 channel name
    if (LEGACY_GROUP) {
      for (var j = 0; j < channels.length; j++) {
        if (channels[j].name === LEGACY_GROUP) return channels[j];
      }
      // 再用 tags 比對
      for (var k = 0; k < channels.length; k++) {
        var tags = channels[k].tags || [];
        for (var t = 0; t < tags.length; t++) {
          if (tags[t] === LEGACY_GROUP) return channels[k];
        }
      }
    }
    // 如果都找不到但只有一個頻道，就用那個
    if (channels.length === 1) return channels[0];
    return null;
  }

  function applySize(sizeStr) {
    if (!sizeStr) return;
    var parts = sizeStr.split('x');
    if (parts.length !== 2) return;
    var w = parseInt(parts[0], 10);
    var h = parseInt(parts[1], 10);
    if (!w || !h) return;

    // 設定 viewport
    var metaVP = document.querySelector('meta[name="viewport"]');
    if (metaVP) {
      metaVP.setAttribute('content', 'width=' + w + ', initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }

    // 設定 CSS 尺寸
    var style = document.documentElement.style;
    style.width = w + 'px';
    style.height = h + 'px';
    document.body.style.width = w + 'px';
    document.body.style.height = h + 'px';
    container.style.width = w + 'px';
    container.style.height = h + 'px';
  }

  // ============================================================
  // 過濾邏輯
  // ============================================================
  function filterCards(cards, ch) {
    var now      = new Date();
    var todayStr = fmtDate(now);
    var timeStr  = fmtTime(now);
    var chTags   = ch.tags || [];
    var chId     = ch.id;
    var chSize   = ch.size;

    var result = [];

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];

      // 1. 啟用
      if (String(c.enabled).toUpperCase() !== 'TRUE' && c.enabled !== true) continue;

      // 2. 匹配邏輯
      var matched = false;

      // 2a. 指定頻道模式：card.channels 有列出此頻道
      var cardChannels = c.channels || [];
      if (cardChannels.length > 0) {
        for (var cc = 0; cc < cardChannels.length; cc++) {
          if (cardChannels[cc] === chId) { matched = true; break; }
        }
      }

      // 2b. 標籤模式：card.tags 與 channel.tags 有交集
      if (!matched) {
        var cardTags = c.tags || [];
        if (cardTags.length > 0 && cardChannels.length === 0) {
          for (var ct = 0; ct < cardTags.length; ct++) {
            for (var cht = 0; cht < chTags.length; cht++) {
              if (cardTags[ct] === chTags[cht]) { matched = true; break; }
            }
            if (matched) break;
          }
        }
      }

      if (!matched) continue;

      // 3. 取得該尺寸圖片
      var imgUrl = '';
      if (c.variants && typeof c.variants === 'object') {
        imgUrl = c.variants[chSize] || '';
      }
      // 向下相容：沒有 variants 用 image_url
      if (!imgUrl && c.image_url) {
        imgUrl = c.image_url;
      }
      if (!imgUrl) continue;

      // 4. 日期範圍
      var sd = norm(c.start_date);
      var ed = norm(c.end_date);
      if (sd && todayStr < sd) continue;
      if (ed && todayStr > ed) continue;

      // 5. 時段
      var st = c.start_time || '00:00';
      var et = c.end_time || '23:59';
      if (timeStr < st || timeStr > et) continue;

      result.push({
        id: c.id,
        title: c.title || '',
        image_url: imgUrl,
        sort_order: parseInt(c.sort_order, 10) || 99,
        priority: c.priority || 'normal'
      });
    }

    // 排序：urgent 優先 → sort_order 升序
    result.sort(function (a, b) {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
      return a.sort_order - b.sort_order;
    });

    return result;
  }

  // ============================================================
  // 播放清單管理
  // ============================================================
  function updatePlaylist(newList) {
    if (newList.length === 0) {
      playlist = [];
      currentIndex = 0;
      if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
      showDefault();
      return;
    }

    var currentUrl = (playlist.length > 0) ? playlist[currentIndex % playlist.length].image_url : null;
    playlist = newList;

    var found = -1;
    if (currentUrl) {
      for (var i = 0; i < playlist.length; i++) {
        if (playlist[i].image_url === currentUrl) { found = i; break; }
      }
    }
    currentIndex = (found >= 0) ? found : 0;

    if (defaultScreen) defaultScreen.className = '';

    if (!slideTimer) {
      showSlide(currentIndex);
      startTimer();
    }
  }

  function startTimer() {
    if (slideTimer) clearInterval(slideTimer);
    slideTimer = setInterval(function () {
      if (playlist.length === 0) return;
      currentIndex = (currentIndex + 1) % playlist.length;
      showSlide(currentIndex);
    }, INTERVAL * 1000);
  }

  // ============================================================
  // 圖片顯示（兩層交替淡入淡出）
  // ============================================================
  function showSlide(index) {
    if (isTransitioning || !playlist[index]) return;

    var url = playlist[index].image_url;
    log('播放 [' + index + '] ' + (playlist[index].title || url));

    var isAActive = slideA.classList.contains('active');
    var nextEl = isAActive ? slideB : slideA;
    var nextImg = isAActive ? imgB : imgA;
    var prevEl = isAActive ? slideA : slideB;

    preload(index);
    isTransitioning = true;

    nextImg.src = url;
    nextImg.onload = function () {
      nextEl.className = 'slide active';
      prevEl.className = 'slide prev';
      setTimeout(function () {
        prevEl.className = 'slide';
        isTransitioning = false;
      }, 900);
    };
    nextImg.onerror = function () {
      log('圖片載入失敗: ' + url);
      isTransitioning = false;
      if (playlist.length > 1) {
        currentIndex = (currentIndex + 1) % playlist.length;
        showSlide(currentIndex);
      }
    };
  }

  function preload(idx) {
    if (playlist.length <= 1) return;
    var next = (idx + 1) % playlist.length;
    var img = new Image();
    img.src = playlist[next].image_url;
    img.onload = img.onerror = function () { img = null; };
  }

  // ============================================================
  // UI
  // ============================================================
  function showDefault() {
    if (defaultScreen) defaultScreen.className = 'visible';
    log('顯示預設畫面');
  }

  function showLoading(v) {
    if (loadingIndicator) loadingIndicator.className = v ? 'visible' : '';
  }

  // ============================================================
  // 工具
  // ============================================================
  function fmtDate(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
  }
  function fmtTime(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function norm(s) { return String(s || '').replace(/-/g, '/').trim(); }

  function log(msg) {
    var ts = new Date().toLocaleTimeString('zh-TW');
    console.log('[Player ' + ts + '] ' + msg);
    if (DEBUG && debugInfo) {
      debugInfo.className = 'show';
      debugInfo.textContent = '[' + ts + '] ' + msg + '\n' + debugInfo.textContent;
      var lines = debugInfo.textContent.split('\n');
      if (lines.length > 20) debugInfo.textContent = lines.slice(0, 20).join('\n');
    }
  }

  // 頁面可見性
  var visKey = typeof document.hidden !== 'undefined' ? 'visibilitychange' : 'webkitvisibilitychange';
  document.addEventListener(visKey, function () {
    if (!document.hidden && !document.webkitHidden) { log('回到前景'); loadData(); }
  });

  // 啟動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
