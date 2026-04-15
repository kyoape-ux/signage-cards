/**
 * 光田綜合醫院 公播圖卡管理系統 — 管理後台 v2
 * admin.js — Channel + Tag 架構
 *
 * 資料來源：GitHub API（讀寫 data/cards.json、data/channels.json）
 * 圖片上傳：GitHub Contents API
 */

(function () {
  'use strict';

  // ============================================================
  // 設定
  // ============================================================
  var SETTINGS_KEY = 'signage_admin_settings';
  var settings = loadSettings();

  // 尺寸選項
  var SIZE_OPTIONS = [
    { value: '1920x1080', label: '1920×1080 橫式' },
    { value: '1080x1920', label: '1080×1920 直式' },
    { value: '800x1080',  label: '800×1080 右半版' },
    { value: '1080x1162', label: '1080×1162 海報' }
  ];

  // ============================================================
  // 狀態
  // ============================================================
  var allCards = [];
  var allChannels = [];
  var allTags = [];
  var filteredCards = [];
  var currentFilter = { tag: '', channel: '', status: '' };
  var selectedIds = {};
  var pendingVariants = {};  // { "1920x1080": { file, dataUrl } }
  var existingVariants = {}; // 編輯時已有的 variants
  var currentTab = 'cards';

  // ============================================================
  // 設定管理
  // ============================================================
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        ghOwner: s.ghOwner || 'kyoape-ux',
        ghRepo: s.ghRepo || 'signage-cards',
        ghToken: s.ghToken || '',
        defaultDays: parseInt(s.defaultDays, 10) || 90,
        expiringDays: parseInt(s.expiringDays, 10) || 3,
        tags: s.tags || ['醫療行銷', '自費推廣', '衛教', '新進醫師', '活動', '歡迎', '會議']
      };
    } catch (e) {
      return { ghOwner: 'kyoape-ux', ghRepo: 'signage-cards', ghToken: '', defaultDays: 90, expiringDays: 3, tags: ['醫療行銷', '自費推廣', '衛教', '新進醫師', '活動', '歡迎', '會議'] };
    }
  }

  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    autoSetupFromHash();
    fillSettingsForm();
    loadData();
  }

  function autoSetupFromHash() {
    var hash = window.location.hash || '';
    if (hash.indexOf('token=') < 0) return;
    var params = {};
    hash.replace('#', '').split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    if (params.token) {
      settings.ghToken = params.token;
      if (params.owner) settings.ghOwner = params.owner;
      if (params.repo) settings.ghRepo = params.repo;
      saveSettingsToStorage();
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setTimeout(function () { toast('✅ 設定已自動完成！', 'success'); }, 500);
    }
  }

  // ============================================================
  // 資料讀取
  // ============================================================
  function loadData() {
    showLoading(true);
    var done = 0;
    function check() { if (++done >= 2) { showLoading(false); refreshAll(); } }

    ghReadJson('data/cards.json', function (data) {
      allCards = Array.isArray(data) ? data : [];
      check();
    }, function () { allCards = []; check(); });

    ghReadJson('data/channels.json', function (data) {
      allChannels = Array.isArray(data) ? data : [];
      check();
    }, function () { allChannels = []; check(); });
  }

  function refreshAll() {
    collectTags();
    renderDashboard();
    populateFilters();
    applyFilters();
    renderChannelList();
  }

  // ============================================================
  // 標籤收集
  // ============================================================
  function collectTags() {
    var tagSet = {};
    // 從設定
    (settings.tags || []).forEach(function (t) { if (t) tagSet[t] = true; });
    // 從圖卡
    allCards.forEach(function (c) {
      (c.tags || []).forEach(function (t) { if (t) tagSet[t] = true; });
    });
    // 從頻道
    allChannels.forEach(function (ch) {
      (ch.tags || []).forEach(function (t) { if (t) tagSet[t] = true; });
    });
    allTags = Object.keys(tagSet).sort();
  }

  // ============================================================
  // 儀表板
  // ============================================================
  function renderDashboard() {
    var counts = { active: 0, expiring: 0, expired: 0, disabled: 0 };
    var now = new Date();
    var todayStr = fmtDate(now);

    allCards.forEach(function (c) {
      var st = getCardStatus(c, todayStr, now);
      counts[st]++;
    });

    document.getElementById('count-active').textContent = counts.active;
    document.getElementById('count-expiring').textContent = counts.expiring;
    document.getElementById('count-expired').textContent = counts.expired;
    document.getElementById('count-disabled').textContent = counts.disabled;
  }

  function getCardStatus(c, todayStr, now) {
    if (!todayStr) { var n = new Date(); todayStr = fmtDate(n); now = n; }
    if (String(c.enabled).toUpperCase() !== 'TRUE' && c.enabled !== true) return 'disabled';
    var ed = norm(c.end_date);
    if (ed && todayStr > ed) return 'expired';
    if (ed) {
      var endD = parseDate(ed);
      if (endD) {
        var diff = Math.ceil((endD - now) / 86400000);
        if (diff <= settings.expiringDays) return 'expiring';
      }
    }
    return 'active';
  }

  // ============================================================
  // 篩選
  // ============================================================
  function populateFilters() {
    var tagSel = document.getElementById('filter-tag');
    var chSel = document.getElementById('filter-channel');
    if (!tagSel || !chSel) return;

    // 保留當前值
    var curTag = tagSel.value;
    var curCh = chSel.value;

    tagSel.innerHTML = '<option value="">全部標籤</option>';
    allTags.forEach(function (t) {
      tagSel.innerHTML += '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    });

    chSel.innerHTML = '<option value="">全部頻道</option>';
    allChannels.forEach(function (ch) {
      chSel.innerHTML += '<option value="' + esc(ch.id) + '">' + esc(ch.name) + '</option>';
    });

    tagSel.value = curTag;
    chSel.value = curCh;
  }

  function applyFilters() {
    var tagVal = document.getElementById('filter-tag').value;
    var chVal = document.getElementById('filter-channel').value;
    var statusVal = document.getElementById('filter-status').value;
    currentFilter = { tag: tagVal, channel: chVal, status: statusVal };

    var now = new Date();
    var todayStr = fmtDate(now);

    filteredCards = allCards.filter(function (c) {
      // 狀態篩選
      if (statusVal) {
        var st = getCardStatus(c, todayStr, now);
        if (st !== statusVal) return false;
      }
      // 標籤篩選
      if (tagVal) {
        var tags = c.tags || [];
        if (tags.indexOf(tagVal) < 0) return false;
      }
      // 頻道篩選
      if (chVal) {
        var channels = c.channels || [];
        if (channels.length > 0) {
          if (channels.indexOf(chVal) < 0) return false;
        } else {
          // 用標籤比對頻道
          var ch = findChannelById(chVal);
          if (ch) {
            var chTags = ch.tags || [];
            var cardTags = c.tags || [];
            var hasMatch = false;
            for (var i = 0; i < cardTags.length; i++) {
              if (chTags.indexOf(cardTags[i]) >= 0) { hasMatch = true; break; }
            }
            if (!hasMatch) return false;
          }
        }
      }
      return true;
    });

    renderCardList();
    updateBatchBtn();
  }

  function filterByStatus(status) {
    document.getElementById('filter-status').value = status;
    applyFilters();
  }

  // ============================================================
  // 圖卡列表渲染
  // ============================================================
  function renderCardList() {
    var container = document.getElementById('card-list');
    var emptyState = document.getElementById('empty-state');
    if (!container) return;

    // 清除舊卡片，保留空狀態
    var items = container.querySelectorAll('.card-item');
    for (var i = 0; i < items.length; i++) items[i].remove();

    if (filteredCards.length === 0) {
      if (emptyState) emptyState.style.display = '';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    var now = new Date();
    var todayStr = fmtDate(now);

    filteredCards.forEach(function (c) {
      var status = getCardStatus(c, todayStr, now);
      var thumbUrl = getFirstVariant(c);
      var el = document.createElement('div');
      el.className = 'card-item';
      el.setAttribute('data-id', c.id);

      var badgeClass = 'badge-' + status;
      var badgeText = { active: '播放中', expiring: '即將到期', expired: '已過期', disabled: '已停用' }[status];

      var tagsHtml = (c.tags || []).map(function (t) {
        return '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:rgba(15,110,86,0.2);color:var(--kt-green-light)">' + esc(t) + '</span>';
      }).join(' ');

      var channelsHtml = '';
      if (c.channels && c.channels.length > 0) {
        channelsHtml = '<span>📺 指定頻道：' + c.channels.map(function (chId) {
          var ch = findChannelById(chId);
          return ch ? esc(ch.name) : esc(chId);
        }).join('、') + '</span>';
      }

      var variantSizes = c.variants ? Object.keys(c.variants).filter(function (k) { return c.variants[k]; }) : [];
      var variantHtml = variantSizes.length > 0 ? '<span>🖼 ' + variantSizes.join(', ') + '</span>' : '';

      var remaining = '';
      var ed = norm(c.end_date);
      if (ed) {
        var endD = parseDate(ed);
        if (endD) {
          var diff = Math.ceil((endD - now) / 86400000);
          if (diff < 0) remaining = '<div class="card-remaining remaining-over">已過期 ' + Math.abs(diff) + ' 天</div>';
          else if (diff <= settings.expiringDays) remaining = '<div class="card-remaining remaining-warn">剩 ' + diff + ' 天</div>';
          else remaining = '<div class="card-remaining remaining-ok">剩 ' + diff + ' 天</div>';
        }
      }

      var priorityBadge = c.priority === 'urgent' ? '<span style="color:#ff9800;font-weight:500">⚡ 插播</span>' : '';

      el.innerHTML =
        '<div class="card-checkbox"><input type="checkbox" onchange="toggleSelect(\'' + c.id + '\', this.checked)"></div>' +
        '<div class="card-thumb">' +
          (thumbUrl ? '<img src="' + esc(thumbUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:36px">🖼</div>') +
          '<div class="card-status-badge ' + badgeClass + '">' + badgeText + '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-title">' + priorityBadge + ' ' + esc(c.title || '無標題') + '</div>' +
          '<div class="card-meta">' +
            '<span>📅 ' + esc(c.start_date || '') + ' ~ ' + esc(c.end_date || '') + '</span>' +
            '<span>🕐 ' + esc(c.start_time || '00:00') + ' ~ ' + esc(c.end_time || '23:59') + '</span>' +
            variantHtml +
            channelsHtml +
            '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">' + tagsHtml + '</div>' +
          '</div>' +
          remaining +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-secondary btn-sm" onclick="editCard(\'' + c.id + '\')">✏ 編輯</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="duplicateCard(\'' + c.id + '\')">📋 複製</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="toggleEnabled(\'' + c.id + '\')">' + (c.enabled ? '⏸ 停用' : '▶ 啟用') + '</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteCard(\'' + c.id + '\')">🗑</button>' +
        '</div>';

      container.appendChild(el);
    });
  }

  // ============================================================
  // Tab 切換
  // ============================================================
  function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tab-cards').style.display = tab === 'cards' ? '' : 'none';
    document.getElementById('tab-channels').style.display = tab === 'channels' ? '' : 'none';

    var btns = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === tab);
    }

    // 隱藏設定面板
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.remove('show');
  }

  // ============================================================
  // 設定面板
  // ============================================================
  function toggleSettings() {
    var sp = document.getElementById('settings-panel');
    if (!sp) return;
    var isShow = sp.classList.contains('show');
    sp.classList.toggle('show');
    if (!isShow) {
      // 隱藏其他
      document.getElementById('tab-cards').style.display = 'none';
      document.getElementById('tab-channels').style.display = 'none';
    } else {
      switchTab(currentTab);
    }
  }

  function fillSettingsForm() {
    setVal('cfg-gh-owner', settings.ghOwner);
    setVal('cfg-gh-repo', settings.ghRepo);
    setVal('cfg-gh-token', settings.ghToken);
    setVal('cfg-default-days', settings.defaultDays);
    setVal('cfg-expiring-days', settings.expiringDays);
    setVal('cfg-tags', (settings.tags || []).join('\n'));
  }

  function saveSettings() {
    settings.ghOwner = getVal('cfg-gh-owner') || settings.ghOwner;
    settings.ghRepo = getVal('cfg-gh-repo') || settings.ghRepo;
    settings.ghToken = getVal('cfg-gh-token') || settings.ghToken;
    settings.defaultDays = parseInt(getVal('cfg-default-days'), 10) || 90;
    settings.expiringDays = parseInt(getVal('cfg-expiring-days'), 10) || 3;
    settings.tags = getVal('cfg-tags').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    saveSettingsToStorage();
    toast('設定已儲存', 'success');
    collectTags();
    populateFilters();
  }

  // ============================================================
  // 圖卡 Modal
  // ============================================================
  function openAddModal() {
    document.getElementById('editing-card-id').value = '';
    document.getElementById('modal-title').textContent = '新增圖卡';
    resetCardForm();

    // 預設日期
    var now = new Date();
    setVal('card-start-date', fmtDateISO(now));
    var end = new Date(now.getTime() + settings.defaultDays * 86400000);
    setVal('card-end-date', fmtDateISO(end));
    setVal('card-start-time', '00:00');
    setVal('card-end-time', '23:59');
    setVal('card-sort', '10');
    setVal('card-priority', 'normal');

    buildTagCheckboxes([]);
    buildChannelCheckboxes([]);
    buildVariantUploads({});
    showModal('card-modal');
  }

  function editCard(id) {
    var card = findCardById(id);
    if (!card) return;

    document.getElementById('editing-card-id').value = id;
    document.getElementById('modal-title').textContent = '編輯圖卡';

    setVal('card-title', card.title || '');
    setVal('card-start-date', toISO(card.start_date));
    setVal('card-end-date', toISO(card.end_date));
    setVal('card-start-time', card.start_time || '00:00');
    setVal('card-end-time', card.end_time || '23:59');
    setVal('card-sort', card.sort_order || 10);
    setVal('card-priority', card.priority || 'normal');
    setVal('card-note', card.note || '');

    buildTagCheckboxes(card.tags || []);
    buildChannelCheckboxes(card.channels || []);
    existingVariants = card.variants || {};
    buildVariantUploads(existingVariants);
    showModal('card-modal');
  }

  function resetCardForm() {
    setVal('card-title', '');
    setVal('card-note', '');
    pendingVariants = {};
    existingVariants = {};
  }

  function buildTagCheckboxes(selected) {
    var container = document.getElementById('tag-checkboxes');
    if (!container) return;
    container.innerHTML = '';
    allTags.forEach(function (tag) {
      var checked = selected.indexOf(tag) >= 0;
      var chip = document.createElement('label');
      chip.className = 'tag-chip' + (checked ? ' selected' : '');
      chip.innerHTML = '<input type="checkbox" value="' + esc(tag) + '"' + (checked ? ' checked' : '') + '>' + esc(tag);
      chip.onclick = function () {
        var cb = chip.querySelector('input');
        setTimeout(function () {
          chip.classList.toggle('selected', cb.checked);
        }, 0);
      };
      container.appendChild(chip);
    });
  }

  function buildChannelCheckboxes(selected) {
    var container = document.getElementById('channel-checkboxes');
    if (!container) return;
    container.innerHTML = '';
    allChannels.forEach(function (ch) {
      var checked = selected.indexOf(ch.id) >= 0;
      var chip = document.createElement('label');
      chip.className = 'tag-chip' + (checked ? ' selected' : '');
      chip.innerHTML = '<input type="checkbox" value="' + esc(ch.id) + '"' + (checked ? ' checked' : '') + '>' + esc(ch.name) + ' <span style="font-size:10px;color:var(--text-muted)">(' + ch.size + ')</span>';
      chip.onclick = function () {
        var cb = chip.querySelector('input');
        setTimeout(function () {
          chip.classList.toggle('selected', cb.checked);
        }, 0);
      };
      container.appendChild(chip);
    });
  }

  function buildVariantUploads(existingVars) {
    var container = document.getElementById('variant-uploads');
    if (!container) return;
    container.innerHTML = '';
    pendingVariants = {};

    SIZE_OPTIONS.forEach(function (opt) {
      var row = document.createElement('div');
      row.className = 'variant-row';
      var existing = existingVars[opt.value] || '';
      var statusText = existing ? '✅ 已上傳' : '未上傳';
      row.innerHTML =
        '<span class="size-label">' + opt.label + '</span>' +
        (existing ? '<img class="variant-preview" src="' + esc(existing) + '" onerror="this.style.display=\'none\'">' : '<span class="variant-preview" style="display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text-muted)">—</span>') +
        '<span class="variant-status" id="vs-' + opt.value + '">' + statusText + '</span>' +
        '<input type="file" accept="image/*" style="display:none" id="vf-' + opt.value + '">' +
        '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'vf-' + opt.value + '\').click()">選擇圖片</button>' +
        (existing ? '<button class="btn btn-danger btn-sm" onclick="removeVariant(\'' + opt.value + '\', this)">✕</button>' : '');
      container.appendChild(row);

      // 檔案選擇事件
      var fileInput = row.querySelector('input[type="file"]');
      fileInput.addEventListener('change', function () {
        if (!this.files || !this.files[0]) return;
        var file = this.files[0];
        var reader = new FileReader();
        var sizeKey = opt.value;
        reader.onload = function (e) {
          pendingVariants[sizeKey] = { file: file, dataUrl: e.target.result };
          // 更新預覽
          var preview = row.querySelector('.variant-preview');
          if (preview.tagName === 'IMG') {
            preview.src = e.target.result;
          } else {
            var img = document.createElement('img');
            img.className = 'variant-preview';
            img.src = e.target.result;
            preview.replaceWith(img);
          }
          var vs = document.getElementById('vs-' + sizeKey);
          if (vs) vs.textContent = '📎 ' + file.name;
        };
        reader.readAsDataURL(file);
      });
    });
  }

  function removeVariant(sizeKey, btn) {
    delete existingVariants[sizeKey];
    delete pendingVariants[sizeKey];
    var row = btn.closest('.variant-row');
    var preview = row.querySelector('.variant-preview');
    if (preview && preview.tagName === 'IMG') {
      var span = document.createElement('span');
      span.className = 'variant-preview';
      span.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text-muted)';
      span.textContent = '—';
      preview.replaceWith(span);
    }
    var vs = document.getElementById('vs-' + sizeKey);
    if (vs) vs.textContent = '未上傳';
    btn.remove();
  }

  function addCustomTag() {
    var input = document.getElementById('new-tag-input');
    var tag = (input.value || '').trim();
    if (!tag) return;
    input.value = '';

    if (allTags.indexOf(tag) < 0) {
      allTags.push(tag);
      allTags.sort();
    }

    // 新增到 checkbox 並勾選
    var container = document.getElementById('tag-checkboxes');
    // 檢查是否已存在
    var existing = container.querySelector('input[value="' + tag + '"]');
    if (existing) {
      existing.checked = true;
      existing.closest('.tag-chip').classList.add('selected');
      return;
    }

    var chip = document.createElement('label');
    chip.className = 'tag-chip selected';
    chip.innerHTML = '<input type="checkbox" value="' + esc(tag) + '" checked>' + esc(tag);
    chip.onclick = function () {
      var cb = chip.querySelector('input');
      setTimeout(function () { chip.classList.toggle('selected', cb.checked); }, 0);
    };
    container.appendChild(chip);
  }

  // ============================================================
  // 儲存圖卡
  // ============================================================
  function saveCard() {
    var title = getVal('card-title');
    if (!title) { toast('請輸入標題', 'error'); return; }

    var editId = document.getElementById('editing-card-id').value;

    // 收集勾選的標籤
    var selectedTags = [];
    document.querySelectorAll('#tag-checkboxes input:checked').forEach(function (cb) {
      selectedTags.push(cb.value);
    });

    // 收集勾選的頻道
    var selectedChannels = [];
    document.querySelectorAll('#channel-checkboxes input:checked').forEach(function (cb) {
      selectedChannels.push(cb.value);
    });

    var card = {
      id: editId || ('card_' + Date.now()),
      title: title,
      tags: selectedTags,
      channels: selectedChannels,
      variants: Object.assign({}, existingVariants),
      start_date: fromISO(getVal('card-start-date')),
      end_date: fromISO(getVal('card-end-date')),
      start_time: getVal('card-start-time') || '00:00',
      end_time: getVal('card-end-time') || '23:59',
      sort_order: parseInt(getVal('card-sort'), 10) || 10,
      priority: getVal('card-priority') || 'normal',
      enabled: true,
      note: getVal('card-note') || ''
    };

    // 如果編輯，保留 enabled 狀態
    if (editId) {
      var old = findCardById(editId);
      if (old) card.enabled = old.enabled;
    }

    // 上傳新圖片
    var pendingSizes = Object.keys(pendingVariants);
    if (pendingSizes.length > 0) {
      showLoading(true);
      uploadVariantsSequential(pendingSizes, 0, card, function () {
        finalizeSaveCard(card, editId);
      });
    } else {
      finalizeSaveCard(card, editId);
    }
  }

  function uploadVariantsSequential(sizes, idx, card, done) {
    if (idx >= sizes.length) { done(); return; }
    var sizeKey = sizes[idx];
    var pv = pendingVariants[sizeKey];
    if (!pv) { uploadVariantsSequential(sizes, idx + 1, card, done); return; }

    var ext = pv.file.name.split('.').pop() || 'png';
    var path = 'images/' + card.id + '_' + sizeKey.replace('x', '_') + '.' + ext;
    var base64 = pv.dataUrl.split(',')[1];

    ghUploadFile(path, base64, '上傳 ' + card.title + ' (' + sizeKey + ')', function (url) {
      card.variants[sizeKey] = url;
      uploadVariantsSequential(sizes, idx + 1, card, done);
    }, function (err) {
      toast('圖片上傳失敗: ' + err, 'error');
      uploadVariantsSequential(sizes, idx + 1, card, done);
    });
  }

  function finalizeSaveCard(card, editId) {
    if (editId) {
      var idx = allCards.findIndex(function (c) { return c.id === editId; });
      if (idx >= 0) allCards[idx] = card;
      else allCards.push(card);
    } else {
      allCards.push(card);
    }

    showLoading(true);
    ghSaveJson('data/cards.json', allCards, (editId ? '更新' : '新增') + '圖卡: ' + card.title, function () {
      showLoading(false);
      closeModal();
      toast(editId ? '圖卡已更新' : '圖卡已新增', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      toast('儲存失敗: ' + err, 'error');
    });
  }

  // ============================================================
  // 圖卡操作
  // ============================================================
  function duplicateCard(id) {
    var card = findCardById(id);
    if (!card) return;
    var newCard = JSON.parse(JSON.stringify(card));
    newCard.id = 'card_' + Date.now();
    newCard.title = card.title + ' (副本)';
    allCards.push(newCard);

    showLoading(true);
    ghSaveJson('data/cards.json', allCards, '複製圖卡: ' + newCard.title, function () {
      showLoading(false);
      toast('已複製', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      allCards.pop();
      toast('複製失敗: ' + err, 'error');
    });
  }

  function toggleEnabled(id) {
    var card = findCardById(id);
    if (!card) return;
    card.enabled = !card.enabled;

    showLoading(true);
    ghSaveJson('data/cards.json', allCards, (card.enabled ? '啟用' : '停用') + '圖卡: ' + card.title, function () {
      showLoading(false);
      toast(card.enabled ? '已啟用' : '已停用', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      card.enabled = !card.enabled;
      toast('操作失敗: ' + err, 'error');
    });
  }

  function deleteCard(id) {
    var card = findCardById(id);
    if (!card) return;
    if (!confirm('確定刪除「' + card.title + '」？')) return;

    var idx = allCards.findIndex(function (c) { return c.id === id; });
    if (idx < 0) return;
    allCards.splice(idx, 1);

    showLoading(true);
    ghSaveJson('data/cards.json', allCards, '刪除圖卡: ' + card.title, function () {
      showLoading(false);
      toast('已刪除', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      allCards.splice(idx, 0, card);
      toast('刪除失敗: ' + err, 'error');
    });
  }

  // ============================================================
  // 快速插播
  // ============================================================
  function openQuickInsert() {
    openAddModal();
    document.getElementById('modal-title').textContent = '⚡ 快速插播';
    setVal('card-priority', 'urgent');
    setVal('card-sort', '0');
    // 今天日期
    var now = new Date();
    setVal('card-start-date', fmtDateISO(now));
    setVal('card-end-date', fmtDateISO(now));
  }

  // ============================================================
  // 批次選取
  // ============================================================
  function toggleSelect(id, checked) {
    if (checked) selectedIds[id] = true;
    else delete selectedIds[id];
    updateBatchBtn();
  }

  function updateBatchBtn() {
    var count = Object.keys(selectedIds).length;
    var btn = document.getElementById('btn-batch');
    if (btn) btn.style.display = count > 0 ? '' : 'none';
  }

  function showBatchMenu() {
    var count = Object.keys(selectedIds).length;
    if (count === 0) { toast('請先勾選圖卡', 'warning'); return; }
    document.getElementById('batch-count').textContent = count;
    document.getElementById('batch-action').value = 'enable';
    document.getElementById('batch-extend-group').style.display = 'none';
    showModal('batch-modal');

    document.getElementById('batch-action').onchange = function () {
      document.getElementById('batch-extend-group').style.display = this.value === 'extend' ? '' : 'none';
    };
  }

  function closeBatchModal() {
    hideModal('batch-modal');
  }

  function executeBatch() {
    var action = getVal('batch-action');
    var ids = Object.keys(selectedIds);
    if (ids.length === 0) return;

    ids.forEach(function (id) {
      var card = findCardById(id);
      if (!card) return;
      switch (action) {
        case 'enable': card.enabled = true; break;
        case 'disable': card.enabled = false; break;
        case 'extend':
          var days = parseInt(getVal('batch-extend-days'), 10) || 90;
          var ed = parseDate(norm(card.end_date)) || new Date();
          ed.setDate(ed.getDate() + days);
          card.end_date = fmtDate(ed);
          break;
        case 'delete':
          var idx = allCards.findIndex(function (c) { return c.id === id; });
          if (idx >= 0) allCards.splice(idx, 1);
          break;
      }
    });

    showLoading(true);
    ghSaveJson('data/cards.json', allCards, '批次' + action + ' ' + ids.length + '張圖卡', function () {
      showLoading(false);
      closeBatchModal();
      selectedIds = {};
      toast('批次操作完成', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      toast('批次操作失敗: ' + err, 'error');
      loadData(); // reload
    });
  }

  // ============================================================
  // 頻道管理
  // ============================================================
  function renderChannelList() {
    var container = document.getElementById('channel-list');
    if (!container) return;
    container.innerHTML = '';

    if (allChannels.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📺</div><p>尚無頻道，點擊「＋ 新增頻道」開始</p></div>';
      return;
    }

    allChannels.forEach(function (ch) {
      var el = document.createElement('div');
      el.className = 'channel-card';

      var tagsHtml = (ch.tags || []).map(function (t) {
        return '<span class="ch-tag">' + esc(t) + '</span>';
      }).join('');

      var baseUrl = settings.ghOwner && settings.ghRepo
        ? 'https://' + settings.ghOwner + '.github.io/' + settings.ghRepo + '/player.html?channel=' + ch.id
        : 'player.html?channel=' + ch.id;

      // 計算該頻道有多少張圖卡
      var cardCount = countCardsForChannel(ch);

      el.innerHTML =
        '<div class="ch-name">' + esc(ch.name) + (ch.enabled === false ? ' <span style="color:var(--status-disabled)">(已停用)</span>' : '') + '</div>' +
        '<div class="ch-meta">' +
          '<span>📍 ' + esc(ch.location || '') + '</span>' +
          '<span>📐 ' + esc(ch.size) + ' | ⏱ ' + (ch.interval || 8) + '秒</span>' +
          '<span>🖼 ' + cardCount + ' 張圖卡</span>' +
        '</div>' +
        '<div class="ch-tags">' + tagsHtml + '</div>' +
        '<div class="ch-url" onclick="copyText(this.textContent)">' + esc(baseUrl) + '</div>' +
        '<div class="ch-actions">' +
          '<button class="btn btn-secondary btn-sm" onclick="editChannel(\'' + ch.id + '\')">✏ 編輯</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="previewChannel(\'' + ch.id + '\')">👁 預覽</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteChannel(\'' + ch.id + '\')">🗑</button>' +
        '</div>';
      container.appendChild(el);
    });
  }

  function countCardsForChannel(ch) {
    var now = new Date();
    var todayStr = fmtDate(now);
    var count = 0;
    allCards.forEach(function (c) {
      if (String(c.enabled).toUpperCase() !== 'TRUE' && c.enabled !== true) return;
      var cardChannels = c.channels || [];
      var matched = false;
      if (cardChannels.length > 0) {
        matched = cardChannels.indexOf(ch.id) >= 0;
      } else {
        var cardTags = c.tags || [];
        var chTags = ch.tags || [];
        for (var i = 0; i < cardTags.length; i++) {
          if (chTags.indexOf(cardTags[i]) >= 0) { matched = true; break; }
        }
      }
      if (!matched) return;
      // 有該尺寸的圖片？
      var hasVariant = c.variants && c.variants[ch.size];
      var hasLegacy = c.image_url;
      if (!hasVariant && !hasLegacy) return;
      count++;
    });
    return count;
  }

  function openAddChannel() {
    document.getElementById('editing-channel-id').value = '';
    document.getElementById('ch-modal-title').textContent = '新增頻道';
    setVal('ch-name', '');
    setVal('ch-location', '');
    setVal('ch-size', '1920x1080');
    setVal('ch-interval', '8');
    setVal('ch-player-url', '');
    buildChTagCheckboxes([]);
    showModal('channel-modal');
  }

  function editChannel(id) {
    var ch = findChannelById(id);
    if (!ch) return;
    document.getElementById('editing-channel-id').value = id;
    document.getElementById('ch-modal-title').textContent = '編輯頻道';
    setVal('ch-name', ch.name || '');
    setVal('ch-location', ch.location || '');
    setVal('ch-size', ch.size || '1920x1080');
    setVal('ch-interval', ch.interval || 8);

    var baseUrl = settings.ghOwner && settings.ghRepo
      ? 'https://' + settings.ghOwner + '.github.io/' + settings.ghRepo + '/player.html?channel=' + ch.id
      : 'player.html?channel=' + ch.id;
    setVal('ch-player-url', baseUrl);

    buildChTagCheckboxes(ch.tags || []);
    showModal('channel-modal');
  }

  function buildChTagCheckboxes(selected) {
    var container = document.getElementById('ch-tag-checkboxes');
    if (!container) return;
    container.innerHTML = '';
    allTags.forEach(function (tag) {
      var checked = selected.indexOf(tag) >= 0;
      var chip = document.createElement('label');
      chip.className = 'tag-chip' + (checked ? ' selected' : '');
      chip.innerHTML = '<input type="checkbox" value="' + esc(tag) + '"' + (checked ? ' checked' : '') + '>' + esc(tag);
      chip.onclick = function () {
        var cb = chip.querySelector('input');
        setTimeout(function () { chip.classList.toggle('selected', cb.checked); }, 0);
      };
      container.appendChild(chip);
    });
  }

  function saveChannel() {
    var name = getVal('ch-name');
    if (!name) { toast('請輸入名稱', 'error'); return; }

    var editId = document.getElementById('editing-channel-id').value;

    var selectedTags = [];
    document.querySelectorAll('#ch-tag-checkboxes input:checked').forEach(function (cb) {
      selectedTags.push(cb.value);
    });

    var ch = {
      id: editId || ('ch_' + Date.now()),
      name: name,
      location: getVal('ch-location') || '',
      size: getVal('ch-size') || '1920x1080',
      interval: parseInt(getVal('ch-interval'), 10) || 8,
      tags: selectedTags,
      enabled: true
    };

    if (editId) {
      var old = findChannelById(editId);
      if (old) ch.enabled = old.enabled !== false;
      var idx = allChannels.findIndex(function (c) { return c.id === editId; });
      if (idx >= 0) allChannels[idx] = ch;
      else allChannels.push(ch);
    } else {
      allChannels.push(ch);
    }

    showLoading(true);
    ghSaveJson('data/channels.json', allChannels, (editId ? '更新' : '新增') + '頻道: ' + ch.name, function () {
      showLoading(false);
      closeChannelModal();
      toast(editId ? '頻道已更新' : '頻道已新增', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      toast('儲存失敗: ' + err, 'error');
    });
  }

  function deleteChannel(id) {
    var ch = findChannelById(id);
    if (!ch) return;
    if (!confirm('確定刪除頻道「' + ch.name + '」？')) return;

    var idx = allChannels.findIndex(function (c) { return c.id === id; });
    if (idx < 0) return;
    allChannels.splice(idx, 1);

    showLoading(true);
    ghSaveJson('data/channels.json', allChannels, '刪除頻道: ' + ch.name, function () {
      showLoading(false);
      toast('已刪除', 'success');
      refreshAll();
    }, function (err) {
      showLoading(false);
      allChannels.splice(idx, 0, ch);
      toast('刪除失敗: ' + err, 'error');
    });
  }

  function previewChannel(id) {
    var baseUrl = settings.ghOwner && settings.ghRepo
      ? 'https://' + settings.ghOwner + '.github.io/' + settings.ghRepo + '/player.html?channel=' + id + '&debug=1'
      : 'player.html?channel=' + id + '&debug=1';
    window.open(baseUrl, '_blank');
  }

  function closeChannelModal() {
    hideModal('channel-modal');
  }

  // ============================================================
  // GitHub API
  // ============================================================
  function ghApiUrl(path) {
    return 'https://api.github.com/repos/' + settings.ghOwner + '/' + settings.ghRepo + '/contents/' + path;
  }

  function ghHeaders() {
    var h = { 'Accept': 'application/vnd.github.v3+json' };
    if (settings.ghToken) h['Authorization'] = 'token ' + settings.ghToken;
    return h;
  }

  function ghReadJson(path, onOk, onErr) {
    fetch(ghApiUrl(path), { headers: ghHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var content = decodeBase64UTF8(data.content);
        var json = JSON.parse(content);
        // 儲存 sha 以便後續更新
        window['_sha_' + path.replace(/[^a-zA-Z0-9]/g, '_')] = data.sha;
        onOk(json);
      })
      .catch(function (err) {
        console.error('ghReadJson', path, err);
        onErr(err.message);
      });
  }

  function ghSaveJson(path, data, message, onOk, onErr) {
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    var shaKey = '_sha_' + path.replace(/[^a-zA-Z0-9]/g, '_');
    var sha = window[shaKey] || '';

    var body = { message: message, content: content };
    if (sha) body.sha = sha;

    fetch(ghApiUrl(path), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
      body: JSON.stringify(body)
    })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'HTTP ' + r.status); });
      return r.json();
    })
    .then(function (result) {
      window[shaKey] = result.content.sha;
      onOk();
    })
    .catch(function (err) {
      console.error('ghSaveJson', path, err);
      onErr(err.message);
    });
  }

  function ghUploadFile(path, base64Content, message, onOk, onErr) {
    // 先檢查是否已存在（取得 sha）
    fetch(ghApiUrl(path), { headers: ghHeaders() })
      .then(function (r) {
        if (r.ok) return r.json();
        return null;
      })
      .then(function (existing) {
        var body = { message: message, content: base64Content };
        if (existing && existing.sha) body.sha = existing.sha;

        return fetch(ghApiUrl(path), {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
          body: JSON.stringify(body)
        });
      })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function (result) {
        // 回傳 GitHub Pages URL
        var url = 'https://' + settings.ghOwner + '.github.io/' + settings.ghRepo + '/' + path;
        onOk(url);
      })
      .catch(function (err) {
        console.error('ghUploadFile', path, err);
        onErr(err.message);
      });
  }

  function decodeBase64UTF8(b64) {
    try {
      var binStr = atob(b64.replace(/\s/g, ''));
      var bytes = new Uint8Array(binStr.length);
      for (var i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return atob(b64.replace(/\s/g, ''));
    }
  }

  // ============================================================
  // Modal
  // ============================================================
  function showModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('show');
  }

  function hideModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }

  function closeModal() {
    hideModal('card-modal');
  }

  // ============================================================
  // UI 工具
  // ============================================================
  function showLoading(v) {
    var el = document.getElementById('loading');
    if (el) el.classList.toggle('show', !!v);
  }

  function toast(msg, type) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'toast ' + (type || '');
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(function () { div.remove(); }, 3500);
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('已複製 URL', 'success');
  }

  // ============================================================
  // 工具函式
  // ============================================================
  function findCardById(id) {
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i].id === id) return allCards[i];
    }
    return null;
  }

  function findChannelById(id) {
    for (var i = 0; i < allChannels.length; i++) {
      if (allChannels[i].id === id) return allChannels[i];
    }
    return null;
  }

  function getFirstVariant(card) {
    if (card.variants) {
      var keys = Object.keys(card.variants);
      for (var i = 0; i < keys.length; i++) {
        if (card.variants[keys[i]]) return card.variants[keys[i]];
      }
    }
    return card.image_url || '';
  }

  function getVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; }

  function fmtDate(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
  }
  function fmtDateISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function norm(s) { return String(s || '').replace(/-/g, '/').trim(); }
  function toISO(s) { return String(s || '').replace(/\//g, '-').trim(); }
  function fromISO(s) { return String(s || '').replace(/-/g, '/').trim(); }

  function parseDate(s) {
    if (!s) return null;
    var parts = s.split('/');
    if (parts.length !== 3) return null;
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }

  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ============================================================
  // 全域曝露
  // ============================================================
  window.switchTab = switchTab;
  window.toggleSettings = toggleSettings;
  window.saveSettings = saveSettings;
  window.openAddModal = openAddModal;
  window.closeModal = closeModal;
  window.saveCard = saveCard;
  window.editCard = editCard;
  window.duplicateCard = duplicateCard;
  window.toggleEnabled = toggleEnabled;
  window.deleteCard = deleteCard;
  window.openQuickInsert = openQuickInsert;
  window.addCustomTag = addCustomTag;
  window.removeVariant = removeVariant;
  window.toggleSelect = toggleSelect;
  window.showBatchMenu = showBatchMenu;
  window.closeBatchModal = closeBatchModal;
  window.executeBatch = executeBatch;
  window.applyFilters = applyFilters;
  window.filterByStatus = filterByStatus;
  window.openAddChannel = openAddChannel;
  window.editChannel = editChannel;
  window.saveChannel = saveChannel;
  window.deleteChannel = deleteChannel;
  window.closeChannelModal = closeChannelModal;
  window.previewChannel = previewChannel;
  window.copyText = copyText;
  window.toast = toast;

  // ============================================================
  // 啟動
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
