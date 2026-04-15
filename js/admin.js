/**
 * 光田綜合醫院 公播圖卡管理系統 — 管理後台
 * admin.js
 *
 * 資料來源策略：
 * - 優先使用 Apps Script Web App（讀寫 Google Sheets）
 * - 若未設定 Apps Script URL，改用 GitHub API（讀寫 data/cards.json）
 * - 圖片上傳：GitHub Contents API
 */

(function () {
  'use strict';

  // ============================================================
  // 設定（從 localStorage 讀取）
  // ============================================================
  var SETTINGS_KEY = 'signage_admin_settings';
  var settings = loadSettings();

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        sheetId: s.sheetId || '1reiXhNRHZP5SB3CG2HlOffJe-SNjWzQaR_3qovkW8tQ',
        appsScriptUrl: s.appsScriptUrl || '',
        ghOwner: s.ghOwner || 'kyoape-ux',
        ghRepo: s.ghRepo || 'signage-cards',
        ghToken: s.ghToken || '',
        defaultDays: parseInt(s.defaultDays, 10) || 90,
        expiringDays: parseInt(s.expiringDays, 10) || 3
      };
    } catch (e) {
      return { sheetId: '', appsScriptUrl: '', ghOwner: 'kyoape-ux', ghRepo: 'signage-cards', ghToken: '', defaultDays: 90, expiringDays: 3 };
    }
  }

  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ============================================================
  // 群組 → 尺寸對照
  // ============================================================
  var GROUP_SIZE_MAP = {
    '公共區域直式': '1080x1920',
    '公共區域宣傳橫式': '1920x1080',
    '門診大內科全區': '800x1080',
    '門診大外科全區': '800x1080',
    '婦女整合門診': '800x1080'
  };

  // ============================================================
  // 狀態
  // ============================================================
  var allCards = [];
  var filteredCards = [];
  var currentFilter = { group: '', size: '', status: '' };
  var selectedIds = {};
  var pendingFile = null;
  var pendingFileData = null;

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    fillSettingsForm();
    setupUpload();
    setupGroupAutoSize();
    loadCards();
  }

  // ============================================================
  // 資料讀取
  // ============================================================
  function loadCards() {
    showLoading(true);

    if (settings.appsScriptUrl) {
      // 優先從 Apps Script 讀取
      fetchJson(settings.appsScriptUrl + '?action=getCards', function (result) {
        showLoading(false);
        if (result && result.success) {
          allCards = result.data || [];
          renderAll();
        } else {
          toast('Apps Script 讀取失敗，改用 JSON', 'warning');
          loadFromGitHub();
        }
      }, function () {
        showLoading(false);
        toast('Apps Script 無法連線，改用 JSON', 'warning');
        loadFromGitHub();
      });
    } else {
      loadFromGitHub();
    }
  }

  function loadFromGitHub() {
    showLoading(true);
    var url = 'https://api.github.com/repos/' + settings.ghOwner + '/' + settings.ghRepo + '/contents/data/cards.json';
    var headers = {};
    if (settings.ghToken) {
      headers['Authorization'] = 'token ' + settings.ghToken;
    }

    fetchJson(url, function (data) {
      showLoading(false);
      if (data && data.content) {
        try {
          var decoded = decodeBase64UTF8(data.content.replace(/\n/g, ''));
          allCards = JSON.parse(decoded);
          window._ghCardsSha = data.sha; // 記住 SHA 用於更新
          renderAll();
        } catch (e) {
          toast('JSON 解析失敗: ' + e.message, 'error');
          allCards = [];
          renderAll();
        }
      } else {
        // 檔案可能不存在，初始化空陣列
        allCards = [];
        renderAll();
      }
    }, function () {
      showLoading(false);
      // 嘗試直接讀本地 JSON
      fetchJson('data/cards.json?t=' + Date.now(), function (data) {
        if (Array.isArray(data)) {
          allCards = data;
        } else {
          allCards = [];
        }
        renderAll();
      }, function () {
        allCards = [];
        renderAll();
      });
    }, headers);
  }

  // ============================================================
  // 資料儲存
  // ============================================================
  function saveCards(callback) {
    showLoading(true);

    if (settings.appsScriptUrl) {
      // 透過 Apps Script 寫入（逐筆更新太慢，改用批次）
      var payload = JSON.stringify({ action: 'replaceAll', cards: allCards });
      postJson(settings.appsScriptUrl, payload, function (result) {
        showLoading(false);
        if (result && result.success) {
          toast('已儲存至 Google Sheets', 'success');
          if (callback) callback(true);
        } else {
          toast('Sheets 寫入失敗，改存 GitHub', 'warning');
          saveToGitHub(callback);
        }
      }, function () {
        showLoading(false);
        saveToGitHub(callback);
      });
    } else {
      saveToGitHub(callback);
    }
  }

  function saveToGitHub(callback) {
    if (!settings.ghToken) {
      toast('請先在設定中填入 GitHub Token', 'error');
      showLoading(false);
      if (callback) callback(false);
      return;
    }

    showLoading(true);
    var url = 'https://api.github.com/repos/' + settings.ghOwner + '/' + settings.ghRepo + '/contents/data/cards.json';
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(allCards, null, 2))));

    var body = {
      message: 'update cards data',
      content: content
    };

    if (window._ghCardsSha) {
      body.sha = window._ghCardsSha;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Authorization', 'token ' + settings.ghToken);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      showLoading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var resp = JSON.parse(xhr.responseText);
          window._ghCardsSha = resp.content.sha;
        } catch (e) {}
        toast('已儲存至 GitHub', 'success');
        if (callback) callback(true);
      } else {
        toast('GitHub 儲存失敗: ' + xhr.status, 'error');
        if (callback) callback(false);
      }
    };
    xhr.send(JSON.stringify(body));
  }

  // ============================================================
  // 圖片上傳到 GitHub
  // ============================================================
  function uploadImageToGitHub(file, base64Data, callback) {
    if (!settings.ghToken) {
      toast('請先設定 GitHub Token', 'error');
      callback(null);
      return;
    }

    var now = new Date();
    var prefix = now.getFullYear().toString() +
                 pad2(now.getMonth() + 1) +
                 pad2(now.getDate());
    var safeName = file.name.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fff]/g, '_');
    var filename = prefix + '_' + safeName;

    var url = 'https://api.github.com/repos/' + settings.ghOwner + '/' + settings.ghRepo + '/contents/images/' + encodeURIComponent(filename);

    // 移除 data URL 前綴
    var pureBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');

    var body = {
      message: 'upload: ' + filename,
      content: pureBase64
    };

    showLoading(true);
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Authorization', 'token ' + settings.ghToken);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      showLoading(false);
      if (xhr.status === 201 || xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          var imgUrl = resp.content.download_url;
          toast('圖片上傳成功', 'success');
          callback(imgUrl, filename);
        } catch (e) {
          callback(null);
        }
      } else {
        toast('圖片上傳失敗: ' + xhr.status, 'error');
        callback(null);
      }
    };
    xhr.send(JSON.stringify(body));
  }

  // ============================================================
  // 渲染
  // ============================================================
  function renderAll() {
    updateDashboard();
    applyFilters();
  }

  function updateDashboard() {
    var counts = { active: 0, expiring: 0, expired: 0, disabled: 0 };
    var now = new Date();
    var todayStr = formatDateSlash(now);

    for (var i = 0; i < allCards.length; i++) {
      var status = getCardStatus(allCards[i], todayStr, now);
      if (counts[status] !== undefined) counts[status]++;
    }

    document.getElementById('count-active').textContent = counts.active;
    document.getElementById('count-expiring').textContent = counts.expiring;
    document.getElementById('count-expired').textContent = counts.expired;
    document.getElementById('count-disabled').textContent = counts.disabled;

    // 更新群組下拉
    var groupSelect = document.getElementById('filter-group');
    var currentVal = groupSelect.value;
    var groups = {};
    for (var j = 0; j < allCards.length; j++) {
      if (allCards[j].group) groups[allCards[j].group] = true;
    }
    // 加上預設群組
    var defaultGroups = Object.keys(GROUP_SIZE_MAP);
    for (var k = 0; k < defaultGroups.length; k++) {
      groups[defaultGroups[k]] = true;
    }
    groupSelect.innerHTML = '<option value="">全部群組</option>';
    Object.keys(groups).sort().forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      groupSelect.appendChild(opt);
    });
    groupSelect.value = currentVal;
  }

  function getCardStatus(card, todayStr, now) {
    if (String(card.enabled).toUpperCase() !== 'TRUE') return 'disabled';
    var endDate = normalizeDate(card.end_date || '');
    var startDate = normalizeDate(card.start_date || '');
    if (endDate && todayStr > endDate) return 'expired';
    if (startDate && todayStr < startDate) return 'active'; // 尚未開始也算啟用中
    if (endDate) {
      var daysLeft = daysBetween(now, parseDateStr(endDate));
      if (daysLeft <= settings.expiringDays) return 'expiring';
    }
    return 'active';
  }

  window.applyFilters = function () {
    var group = document.getElementById('filter-group').value;
    var size = document.getElementById('filter-size').value;
    var status = document.getElementById('filter-status').value;
    currentFilter = { group: group, size: size, status: status };

    var now = new Date();
    var todayStr = formatDateSlash(now);
    filteredCards = [];

    for (var i = 0; i < allCards.length; i++) {
      var c = allCards[i];
      if (group && c.group !== group) continue;
      if (size && c.size !== size) continue;
      if (status) {
        var s = getCardStatus(c, todayStr, now);
        if (s !== status) continue;
      }
      filteredCards.push(c);
    }

    // 排序
    filteredCards.sort(function (a, b) {
      return (parseInt(a.sort_order, 10) || 99) - (parseInt(b.sort_order, 10) || 99);
    });

    renderCardList();
  };

  window.filterByStatus = function (status) {
    document.getElementById('filter-status').value = status;
    applyFilters();
  };

  function renderCardList() {
    var container = document.getElementById('card-list');
    var emptyState = document.getElementById('empty-state');

    // 清除舊的（保留 empty-state）
    var items = container.querySelectorAll('.card-item');
    for (var i = 0; i < items.length; i++) {
      container.removeChild(items[i]);
    }

    if (filteredCards.length === 0) {
      emptyState.style.display = 'block';
      document.getElementById('btn-batch').style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';

    var now = new Date();
    var todayStr = formatDateSlash(now);

    for (var j = 0; j < filteredCards.length; j++) {
      var card = filteredCards[j];
      var status = getCardStatus(card, todayStr, now);
      var el = createCardElement(card, status, now);
      container.appendChild(el);
    }

    updateBatchButton();
  }

  function createCardElement(card, status, now) {
    var div = document.createElement('div');
    div.className = 'card-item';
    div.setAttribute('data-id', card.id);

    var statusLabel = { active: '播放中', expiring: '即將到期', expired: '已過期', disabled: '已停用' };
    var badgeClass = { active: 'badge-active', expiring: 'badge-expiring', expired: 'badge-expired', disabled: 'badge-disabled' };

    // 剩餘天數
    var remaining = '';
    var remainClass = 'remaining-ok';
    if (card.end_date) {
      var endD = parseDateStr(normalizeDate(card.end_date));
      var days = daysBetween(now, endD);
      if (days > 0) {
        remaining = '剩 ' + days + ' 天';
        if (days <= settings.expiringDays) { remainClass = 'remaining-warn'; }
      } else if (days === 0) {
        remaining = '今天到期';
        remainClass = 'remaining-warn';
      } else {
        remaining = '已過期 ' + Math.abs(days) + ' 天';
        remainClass = 'remaining-over';
      }
    }

    var startStr = card.start_date ? card.start_date.replace(/\//g, '/') : '--';
    var endStr = card.end_date ? card.end_date.replace(/\//g, '/') : '--';
    var timeStr = (card.start_time || '00:00') + ' - ' + (card.end_time || '23:59');
    var displayName = card.image_filename || card.note || card.id || '未命名';
    var sizeLabel = card.size === '1920x1080' ? '1920×1080 橫式' :
                    card.size === '1080x1920' ? '1080×1920 直式' :
                    card.size === '800x1080' ? '800×1080 右半版' : (card.size || '');

    div.innerHTML =
      '<div class="card-checkbox"><input type="checkbox" onchange="toggleSelect(\'' + card.id + '\', this.checked)"></div>' +
      '<div class="card-thumb">' +
        '<img src="' + escapeHtml(card.image_url || '') + '" alt="" onerror="this.src=\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22><rect fill=%22%23333%22 width=%22400%22 height=%22300%22/><text fill=%22%23666%22 x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2216%22>No Image</text></svg>\'">' +
        '<span class="card-status-badge ' + badgeClass[status] + '">' + statusLabel[status] + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-title">' + escapeHtml(displayName) + '</div>' +
        '<div class="card-meta">' +
          '<span>📁 ' + escapeHtml(card.group || '') + '</span>' +
          '<span>📐 ' + sizeLabel + '</span>' +
          '<span>📅 ' + startStr + ' → ' + endStr + '</span>' +
          '<span>🕐 ' + timeStr + '</span>' +
          '<span>🔢 排序: ' + (card.sort_order || 0) + '</span>' +
        '</div>' +
        (remaining ? '<div class="card-remaining ' + remainClass + '">' + remaining + '</div>' : '') +
      '</div>' +
      '<div class="card-actions">' +
        '<button class="btn btn-secondary btn-sm" onclick="editCard(\'' + card.id + '\')">✏️ 編輯</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="duplicateCard(\'' + card.id + '\')">📋 複製延期</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="toggleCardEnabled(\'' + card.id + '\')">' +
          (String(card.enabled).toUpperCase() === 'TRUE' ? '⏸ 停用' : '▶ 啟用') +
        '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteCard(\'' + card.id + '\')">🗑</button>' +
      '</div>';

    return div;
  }

  // ============================================================
  // CRUD 操作
  // ============================================================
  window.openAddModal = function () {
    document.getElementById('editing-card-id').value = '';
    document.getElementById('modal-title').textContent = '新增圖卡';
    clearForm();

    // 預設日期
    var today = new Date();
    document.getElementById('card-start-date').value = formatDateISO(today);
    var endDate = new Date(today);
    endDate.setDate(endDate.getDate() + settings.defaultDays);
    document.getElementById('card-end-date').value = formatDateISO(endDate);

    document.getElementById('card-modal').classList.add('show');
  };

  window.editCard = function (id) {
    var card = findCard(id);
    if (!card) return;

    document.getElementById('editing-card-id').value = id;
    document.getElementById('modal-title').textContent = '編輯圖卡';

    document.getElementById('card-group').value = card.group || '';
    document.getElementById('card-size').value = card.size || '';
    document.getElementById('card-start-date').value = dateSlashToISO(card.start_date);
    document.getElementById('card-end-date').value = dateSlashToISO(card.end_date);
    document.getElementById('card-start-time').value = card.start_time || '00:00';
    document.getElementById('card-end-time').value = card.end_time || '23:59';
    document.getElementById('card-sort').value = card.sort_order || 1;
    document.getElementById('card-enabled').value = String(card.enabled).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
    document.getElementById('card-note').value = card.note || '';

    // 顯示現有圖片
    if (card.image_url) {
      document.getElementById('preview-img').src = card.image_url;
      document.getElementById('upload-preview').style.display = 'block';
      document.getElementById('upload-area').style.display = 'none';
    }

    pendingFile = null;
    pendingFileData = null;

    document.getElementById('card-modal').classList.add('show');
  };

  window.saveCard = function () {
    var id = document.getElementById('editing-card-id').value;
    var isNew = !id;

    var group = document.getElementById('card-group').value;
    var size = document.getElementById('card-size').value;
    var startDate = isoToDateSlash(document.getElementById('card-start-date').value);
    var endDate = isoToDateSlash(document.getElementById('card-end-date').value);
    var startTime = document.getElementById('card-start-time').value || '00:00';
    var endTime = document.getElementById('card-end-time').value || '23:59';
    var sortOrder = parseInt(document.getElementById('card-sort').value, 10) || 1;
    var enabled = document.getElementById('card-enabled').value;
    var note = document.getElementById('card-note').value;

    var doSave = function (imageUrl, filename) {
      var now = new Date().toISOString();

      if (isNew) {
        if (!imageUrl) {
          toast('請上傳圖片', 'error');
          return;
        }
        var newCard = {
          id: 'card_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
          image_url: imageUrl,
          image_filename: filename || '',
          thumbnail: '',
          group: group,
          size: size,
          start_date: startDate,
          end_date: endDate,
          start_time: startTime,
          end_time: endTime,
          sort_order: sortOrder,
          enabled: enabled,
          note: note,
          created_at: now,
          updated_at: now
        };
        allCards.push(newCard);
      } else {
        var card = findCard(id);
        if (!card) return;
        if (imageUrl) {
          card.image_url = imageUrl;
          card.image_filename = filename || card.image_filename;
        }
        card.group = group;
        card.size = size;
        card.start_date = startDate;
        card.end_date = endDate;
        card.start_time = startTime;
        card.end_time = endTime;
        card.sort_order = sortOrder;
        card.enabled = enabled;
        card.note = note;
        card.updated_at = now;
      }

      saveCards(function (ok) {
        if (ok) {
          closeModal();
          renderAll();
        }
      });
    };

    // 如果有新上傳的圖片，先上傳到 GitHub
    if (pendingFile && pendingFileData) {
      uploadImageToGitHub(pendingFile, pendingFileData, function (url, fname) {
        if (url) {
          doSave(url, fname);
        }
      });
    } else {
      // 編輯模式，沒換圖
      var existingUrl = isNew ? null : (findCard(id) || {}).image_url;
      doSave(existingUrl, null);
    }
  };

  window.deleteCard = function (id) {
    if (!confirm('確定要刪除這張圖卡？')) return;
    allCards = allCards.filter(function (c) { return c.id !== id; });
    saveCards(function () { renderAll(); });
  };

  window.duplicateCard = function (id) {
    var card = findCard(id);
    if (!card) return;

    var today = new Date();
    var endDate = new Date(today);
    endDate.setDate(endDate.getDate() + settings.defaultDays);

    var newCard = {};
    for (var k in card) {
      if (card.hasOwnProperty(k)) newCard[k] = card[k];
    }
    newCard.id = 'card_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    newCard.start_date = formatDateSlash(today);
    newCard.end_date = formatDateSlash(endDate);
    newCard.enabled = 'TRUE';
    newCard.created_at = new Date().toISOString();
    newCard.updated_at = new Date().toISOString();
    newCard.note = (card.note || '') + '（複製延期）';

    allCards.push(newCard);
    saveCards(function () {
      renderAll();
      toast('已複製延期，新圖卡上架 ' + settings.defaultDays + ' 天', 'success');
    });
  };

  window.toggleCardEnabled = function (id) {
    var card = findCard(id);
    if (!card) return;
    card.enabled = String(card.enabled).toUpperCase() === 'TRUE' ? 'FALSE' : 'TRUE';
    card.updated_at = new Date().toISOString();
    saveCards(function () { renderAll(); });
  };

  // ============================================================
  // 批次操作
  // ============================================================
  window.toggleSelect = function (id, checked) {
    if (checked) {
      selectedIds[id] = true;
    } else {
      delete selectedIds[id];
    }
    updateBatchButton();
  };

  function updateBatchButton() {
    var count = Object.keys(selectedIds).length;
    document.getElementById('btn-batch').style.display = count > 0 ? 'inline-flex' : 'none';
  }

  window.showBatchMenu = function () {
    var count = Object.keys(selectedIds).length;
    document.getElementById('batch-count').textContent = count;
    document.getElementById('batch-modal').classList.add('show');

    document.getElementById('batch-action').onchange = function () {
      document.getElementById('batch-extend-group').style.display =
        this.value === 'extend' ? 'block' : 'none';
    };
  };

  window.closeBatchModal = function () {
    document.getElementById('batch-modal').classList.remove('show');
  };

  window.executeBatch = function () {
    var action = document.getElementById('batch-action').value;
    var ids = Object.keys(selectedIds);
    var now = new Date().toISOString();

    for (var i = 0; i < ids.length; i++) {
      var card = findCard(ids[i]);
      if (!card) continue;

      if (action === 'enable') {
        card.enabled = 'TRUE';
        card.updated_at = now;
      } else if (action === 'disable') {
        card.enabled = 'FALSE';
        card.updated_at = now;
      } else if (action === 'extend') {
        var days = parseInt(document.getElementById('batch-extend-days').value, 10) || 90;
        var endD = card.end_date ? parseDateStr(normalizeDate(card.end_date)) : new Date();
        if (endD < new Date()) endD = new Date();
        endD.setDate(endD.getDate() + days);
        card.end_date = formatDateSlash(endD);
        card.updated_at = now;
      } else if (action === 'delete') {
        allCards = allCards.filter(function (c) { return c.id !== card.id; });
      }
    }

    selectedIds = {};
    closeBatchModal();
    saveCards(function () { renderAll(); });
    toast('批次操作完成（' + ids.length + ' 張）', 'success');
  };

  // ============================================================
  // 圖片上傳 UI
  // ============================================================
  function setupUpload() {
    var area = document.getElementById('upload-area');
    var fileInput = document.getElementById('file-input');

    area.addEventListener('click', function () {
      fileInput.click();
    });

    area.addEventListener('dragover', function (e) {
      e.preventDefault();
      area.classList.add('dragover');
    });

    area.addEventListener('dragleave', function () {
      area.classList.remove('dragover');
    });

    area.addEventListener('drop', function (e) {
      e.preventDefault();
      area.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });
  }

  function handleFile(file) {
    if (!file.type.match(/^image\//)) {
      toast('請選擇圖片檔案', 'error');
      return;
    }

    pendingFile = file;
    var reader = new FileReader();
    reader.onload = function (e) {
      pendingFileData = e.target.result;
      document.getElementById('preview-img').src = e.target.result;
      document.getElementById('upload-preview').style.display = 'block';
      document.getElementById('upload-area').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  window.removeImage = function () {
    pendingFile = null;
    pendingFileData = null;
    document.getElementById('preview-img').src = '';
    document.getElementById('upload-preview').style.display = 'none';
    document.getElementById('upload-area').style.display = 'block';
    document.getElementById('file-input').value = '';
  };

  // ============================================================
  // 群組自動對應尺寸
  // ============================================================
  function setupGroupAutoSize() {
    var groupSelect = document.getElementById('card-group');
    var sizeSelect = document.getElementById('card-size');
    groupSelect.addEventListener('change', function () {
      var mapped = GROUP_SIZE_MAP[groupSelect.value];
      if (mapped) sizeSelect.value = mapped;
    });
  }

  // ============================================================
  // Modal
  // ============================================================
  window.closeModal = function () {
    document.getElementById('card-modal').classList.remove('show');
    clearForm();
  };

  function clearForm() {
    pendingFile = null;
    pendingFileData = null;
    document.getElementById('preview-img').src = '';
    document.getElementById('upload-preview').style.display = 'none';
    document.getElementById('upload-area').style.display = 'block';
    document.getElementById('file-input').value = '';
    document.getElementById('card-note').value = '';
    document.getElementById('card-sort').value = '1';
    document.getElementById('card-start-time').value = '00:00';
    document.getElementById('card-end-time').value = '23:59';
    document.getElementById('card-enabled').value = 'TRUE';
  }

  // ============================================================
  // 設定
  // ============================================================
  window.toggleSettings = function () {
    var panel = document.getElementById('settings-panel');
    var cardList = document.getElementById('card-list');
    var toolbar = document.getElementById('toolbar');
    var dashboard = document.getElementById('dashboard');

    if (panel.classList.contains('show')) {
      panel.classList.remove('show');
      cardList.style.display = '';
      toolbar.style.display = '';
      dashboard.style.display = '';
    } else {
      panel.classList.add('show');
      cardList.style.display = 'none';
      toolbar.style.display = 'none';
      dashboard.style.display = 'none';
      fillSettingsForm();
    }
  };

  function fillSettingsForm() {
    document.getElementById('cfg-sheet-id').value = settings.sheetId || '';
    document.getElementById('cfg-apps-script-url').value = settings.appsScriptUrl || '';
    document.getElementById('cfg-gh-owner').value = settings.ghOwner || '';
    document.getElementById('cfg-gh-repo').value = settings.ghRepo || '';
    document.getElementById('cfg-gh-token').value = settings.ghToken || '';
    document.getElementById('cfg-default-days').value = settings.defaultDays || 90;
    document.getElementById('cfg-expiring-days').value = settings.expiringDays || 3;
  }

  window.saveSettings = function () {
    settings.sheetId = document.getElementById('cfg-sheet-id').value.trim();
    settings.appsScriptUrl = document.getElementById('cfg-apps-script-url').value.trim();
    settings.ghOwner = document.getElementById('cfg-gh-owner').value.trim();
    settings.ghRepo = document.getElementById('cfg-gh-repo').value.trim();
    settings.ghToken = document.getElementById('cfg-gh-token').value.trim();
    settings.defaultDays = parseInt(document.getElementById('cfg-default-days').value, 10) || 90;
    settings.expiringDays = parseInt(document.getElementById('cfg-expiring-days').value, 10) || 3;

    saveSettingsToStorage();
    toast('設定已儲存', 'success');
    toggleSettings();
    loadCards();
  };

  // ============================================================
  // 預覽
  // ============================================================
  window.openPreview = function () {
    var group = document.getElementById('filter-group').value || '公共區域宣傳橫式';
    var size = GROUP_SIZE_MAP[group] || '1920x1080';
    var page = size === '1080x1920' ? 'player-v.html' :
               size === '800x1080' ? 'player-r.html' : 'player-h.html';
    var url = page + '?group=' + encodeURIComponent(group) + '&debug=1';
    window.open(url, '_blank');
  };

  // ============================================================
  // 工具函式
  // ============================================================
  function findCard(id) {
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i].id === id) return allCards[i];
    }
    return null;
  }

  function formatDateSlash(d) {
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
  }

  function formatDateISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dateSlashToISO(s) {
    if (!s) return '';
    return s.replace(/\//g, '-');
  }

  function isoToDateSlash(s) {
    if (!s) return '';
    return s.replace(/-/g, '/');
  }

  function normalizeDate(s) {
    return String(s).replace(/-/g, '/').trim();
  }

  function parseDateStr(s) {
    var parts = s.split('/');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function daysBetween(from, to) {
    var msDay = 86400000;
    var fromMid = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var toMid = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((toMid - fromMid) / msDay);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Base64 → UTF-8 安全解碼（atob 不支援多位元組字元）
  function decodeBase64UTF8(str) {
    var binary = atob(str);
    var bytes = [];
    for (var i = 0; i < binary.length; i++) {
      bytes.push(binary.charCodeAt(i));
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }

  // ============================================================
  // HTTP 工具
  // ============================================================
  function fetchJson(url, onSuccess, onError, headers) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    if (headers) {
      for (var k in headers) {
        if (headers.hasOwnProperty(k)) xhr.setRequestHeader(k, headers[k]);
      }
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { onSuccess(JSON.parse(xhr.responseText)); }
        catch (e) { if (onError) onError(e); }
      } else {
        if (onError) onError(new Error('HTTP ' + xhr.status));
      }
    };
    xhr.send();
  }

  function postJson(url, body, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { onSuccess(JSON.parse(xhr.responseText)); }
        catch (e) { if (onError) onError(e); }
      } else {
        if (onError) onError(new Error('HTTP ' + xhr.status));
      }
    };
    xhr.send(body);
  }

  // ============================================================
  // UI 工具
  // ============================================================
  function showLoading(visible) {
    var el = document.getElementById('loading');
    el.classList.toggle('show', visible);
  }

  function toast(msg, type) {
    type = type || 'success';
    var container = document.getElementById('toast-container');
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { container.removeChild(el); }, 300);
    }, 3000);
  }

  // ============================================================
  // 啟動
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
