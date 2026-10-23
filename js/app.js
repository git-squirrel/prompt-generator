/* ============================================
   Prompt Generator - Main Application Logic
   Refactored: unified storage, deduplicated code,
   removed deprecated APIs, improved error handling.
   ============================================ */

// ============================================================
// SECTION 1: Data Constants & Global State
// ============================================================

let CN_EN_MAP = {};
let IDENTITY_EN = {'中国':'Chinese','韩国':'Korean','日本':'Japanese','欧美':'Western','女':'Female','男':'Male'};
// 润色模板组（动态可增删，结构定义见 SECTION 5）
let enrichGroups = [];
let _enrichGroupSeq = 1;

let promptsEnabled = {};
let promptsChance = {};   // 类别名 -> 出现概率(0-100)，缺省 100
let promptsLocked = {};   // 类别名 -> [cn,...] 锁定的提示词，每次随机必出（该类别不再随机补抽）
let DATA = null;
let _enManual = false;    // 英文框是否被手动编辑过（用于中英对齐提示）

// ============================================================
// Storage key mapping: shortName -> serverKey
// ============================================================
const STORAGE_TO_SERVER = {
  prompts_data: 'pg_prompts_data',
  prompts_data_enabled: 'pg_prompts_data_enabled',
  prompts_chance: 'pg_prompts_chance',
  prompts_locked: 'pg_prompts_locked',
  identity_regions: 'pg_identity_regions',
  identity_genders: 'pg_identity_genders',
  identity_age: 'pg_identity_age',
  identity_age_random: 'pg_identity_age_random',
  identity_region_random: 'pg_identity_region_random',
  identity_gender_random: 'pg_identity_gender_random',
  identity_enabled: 'pg_identity_enabled',
  enrich_groups: 'pg_enrich_groups',
  enrichCN: 'pg_enrichCN',
  enrichEN: 'pg_enrichEN',
  skinCN: 'pg_skinCN',
  skinEN: 'pg_skinEN',
  qualityCN: 'pg_qualityCN',
  qualityEN: 'pg_qualityEN',
  ai_settings: 'pg_ai_settings',
  ai_preset: 'pg_ai_preset',
  ai_history: 'pg_ai_history',
  comfy_settings: 'pg_comfy_settings',
  comfy_workflows: 'pg_comfy_workflows',
  comfy_gallery: 'pg_comfy_gallery'
};

function serverKey(shortName) {
  return STORAGE_TO_SERVER[shortName] || shortName;
}

const SERVER_KEYS = {
  prompts: ['prompts_data','prompts_data_enabled','prompts_chance','prompts_locked','identity_regions','identity_genders','identity_en','identity_age','identity_age_random','identity_region_random','identity_gender_random','identity_enabled','enrich_groups','enrichCN','enrichEN','skinCN','skinEN','qualityCN','qualityEN'],
  ai: ['ai_settings','ai_preset','ai_history'],
  comfy: ['comfy_settings','comfy_workflows','comfy_gallery']
};

// ============================================================
// SECTION 2: Utility Functions
// ============================================================

function escapeHtml(str) {
  // 同时转义引号，保证可安全用于标签文本与 HTML 属性两种场景
  return String(str).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function autoResizeTextarea(el) {
  if (!el) return;
  // 主编辑区高度由布局撑满，交给 CSS；其余小输入框仍按内容自适应
  if (el.id === 'promptArea' || el.id === 'promptEnArea') return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, parseInt(el.dataset.minHeight || '60')) + 'px';
}

function resizePromptAreas() {
  autoResizeTextarea(document.getElementById('promptArea'));
  autoResizeTextarea(document.getElementById('promptEnArea'));
}

let toastTimer = null;
// action: { label, onClick } —— 在 toast 里附带一个操作按钮（目前用于「撤销删除」）
function showToast(msg, type, action) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = '';
  el.appendChild(document.createTextNode(msg));
  if (action && action.label && typeof action.onClick === 'function') {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { el.className = 'toast'; action.onClick(); };
    el.appendChild(b);
  }
  el.className = 'toast show';
  el.style.color = type === 'error' ? '#ef4444' : '#34d399';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, action ? 6000 : 2500);
}

// ============================================================
// SECTION 2.6: 删除撤销栈（内存，保留最近 5 步）
// 类别/提示词/画廊清空都只有一次确认，手滑代价大，删除后 6 秒内可撤销
// ============================================================
const _undoStack = [];
function pushUndo(label, restore) {
  _undoStack.push({ label, restore });
  if (_undoStack.length > 5) _undoStack.shift();
}
function undoLast() {
  const u = _undoStack.pop();
  if (!u) return;
  u.restore();
  showToast('↩️ 已撤销：' + u.label, 'success');
}

// ============================================================
// SECTION 2.5: UI Dialogs —— 自定义模态框，替代原生 confirm()/prompt()
// ============================================================

// 构建对话框骨架；onClose(result) 负责 resolve 并移除遮罩
function _uidOverlay(title, onClose) {
  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.style.zIndex = '1100'; // 需盖在其他 pm-overlay 模态框之上
  const pn = document.createElement('div');
  pn.className = 'pm-panel uid-panel';
  const hd = document.createElement('div');
  hd.className = 'pm-header';
  const h3 = document.createElement('h3');
  h3.textContent = title || '确认';
  hd.appendChild(h3);
  pn.appendChild(hd);
  const bd = document.createElement('div');
  bd.className = 'pm-body';
  bd.style.padding = '14px 20px 4px';
  pn.appendChild(bd);
  ov.appendChild(pn);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    ov.remove();
    onClose(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(null); }
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
  document.body.appendChild(ov);
  return { ov, pn, bd, close };
}

// 确认框（替代 confirm）。opts: { title, okText, cancelText, danger, alert }
// alert=true 时为纯提示框：只有确定按钮
function uiConfirm(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const { bd, close } = _uidOverlay(opts.title || (opts.alert ? '提示' : '确认操作'), (r) => resolve(opts.alert ? undefined : !!r));
    const msg = document.createElement('div');
    msg.className = 'uid-msg';
    msg.textContent = message;
    bd.appendChild(msg);
    const ft = document.createElement('div');
    ft.className = 'uid-footer';
    if (!opts.alert) {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = opts.cancelText || '取消';
      cancelBtn.onclick = () => close(false);
      ft.appendChild(cancelBtn);
    }
    const okBtn = document.createElement('button');
    okBtn.textContent = opts.okText || (opts.alert ? '知道了' : '确定');
    okBtn.className = opts.danger ? 'uid-btn-danger' : 'uid-btn-ok';
    okBtn.onclick = () => close(true);
    ft.appendChild(okBtn);
    bd.appendChild(ft);
    okBtn.focus();
  });
}

// 纯提示框（替代 alert）
function uiAlert(message, opts) {
  opts = Object.assign({}, opts, { alert: true });
  return uiConfirm(message, opts);
}

// 单选列表（替代 prompt 输入编号）。options: [{ label, sub }]
// 返回选中下标；取消返回 null
function uiChoice(title, options) {
  return new Promise((resolve) => {
    const { bd, close } = _uidOverlay(title, (r) => resolve(r === undefined ? null : r));
    const list = document.createElement('div');
    list.className = 'uid-choice-list';
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'uid-choice-item';
      const lb = document.createElement('span');
      lb.textContent = opt.label;
      btn.appendChild(lb);
      if (opt.sub) {
        const sub = document.createElement('span');
        sub.className = 'uid-choice-sub';
        sub.textContent = opt.sub;
        btn.appendChild(sub);
      }
      btn.onclick = () => close(i);
      list.appendChild(btn);
    });
    bd.appendChild(list);
    const ft = document.createElement('div');
    ft.className = 'uid-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => close(null);
    ft.appendChild(cancelBtn);
    bd.appendChild(ft);
  });
}

// 多选列表（替代 prompt 逗号编号）。options: [{ label }]
// 返回选中下标数组；取消返回 null
function uiMultiChoice(title, options) {
  return new Promise((resolve) => {
    const { bd, close } = _uidOverlay(title, (r) => resolve(r));
    const list = document.createElement('div');
    list.className = 'uid-check-list';
    const cbs = options.map((opt) => {
      const lb = document.createElement('label');
      lb.className = 'uid-check-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true; // 默认全选，等同原「直接回车导入全部」
      lb.appendChild(cb);
      lb.appendChild(document.createTextNode(opt.label));
      list.appendChild(lb);
      return cb;
    });
    bd.appendChild(list);
    const ft = document.createElement('div');
    ft.className = 'uid-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => close(null);
    const okBtn = document.createElement('button');
    okBtn.className = 'uid-btn-ok';
    okBtn.textContent = '导入选中项';
    okBtn.onclick = () => {
      const idxs = cbs.map((cb, i) => cb.checked ? i : -1).filter(i => i >= 0);
      close(idxs);
    };
    ft.appendChild(cancelBtn);
    ft.appendChild(okBtn);
    bd.appendChild(ft);
    okBtn.focus();
  });
}

// ============================================================
// SECTION 3: Identity Helpers (deduplicated)
// ============================================================

let identityRegions = [], identityGenders = [], identityAge = {};
let identityAgeRandom = false, identityRegionRandom = false, identityGenderRandom = false;
// 人物身份总开关：关闭后提示词不添加 年龄/地区/性别（用于生成无人物画面）
let identityEnabled = true;

function defaultIdentityRegions() { return ['中国', '韩国', '日本', '欧美']; }
function defaultIdentityGenders() { return ['女', '男']; }
function defaultIdentityAge() { return { min: 18, max: 49 }; }

// 身份快照：同一次提示词构建里，中文和英文必须使用同一套身份。
// 原来 getIdentityPrefix() / getIdentityEn() 各自调用本函数，开启「随机」时会抽两次，
// 导致中文显示 28 岁而英文显示 37 岁。只有 forceFresh=true 才重新抽样。
let _identitySnapshot = null;

function _resolveIdentityValues(forceFresh) {
  if (!forceFresh && _identitySnapshot) return _identitySnapshot;
  let age, region, gender;
  if (identityAgeRandom) {
    const min = identityAge.min || 18;
    const max = identityAge.max || 49;
    age = Math.floor(Math.random() * (max - min + 1)) + min;
  } else {
    age = parseInt(document.getElementById('ageSlider')?.value) || 25;
  }
  if (identityRegionRandom) {
    const regions = identityRegions.length ? identityRegions : defaultIdentityRegions();
    region = regions[Math.floor(Math.random() * regions.length)];
  } else {
    region = document.getElementById('regionSelect')?.value || identityRegions[0] || '中国';
  }
  if (identityGenderRandom) {
    gender = identityGenders[Math.floor(Math.random() * identityGenders.length)] || '';
  } else {
    gender = document.getElementById('genderSelect')?.value || '';
  }
  _identitySnapshot = { age, region, gender };
  return _identitySnapshot;
}

// 强制重新抽一次身份并锁定，供一次提示词构建（中英文共用）使用
function rollIdentity() { return _resolveIdentityValues(true); }

function getIdentityPrefix() {
  if (!identityEnabled) return '';
  const { age, region, gender } = _resolveIdentityValues();
  return `${region}，${age}岁${gender ? '，' + gender : ''}`;
}

function getIdentityEn() {
  if (!identityEnabled) return '';
  const { age, region, gender } = _resolveIdentityValues();
  const rf = IDENTITY_EN[region] || region;
  const gf = gender ? (IDENTITY_EN[gender] || gender) : '';
  return `${rf}, ${age} years old${gf ? ', ' + gf : ''}`;
}

function updateAgeDisplay() {
  const slider = document.getElementById('ageSlider');
  const display = document.getElementById('ageDisplay');
  if (slider && display) display.textContent = slider.value;
  updateIdentityPreview();
}

function updateIdentityPreview() {
  const preview = document.getElementById('identityPreview');
  if (!preview) return;
  // Read checkbox states from DOM for live preview
  const ageRandomToggle = document.getElementById('ageRandomToggle');
  const regionRandomToggle = document.getElementById('regionRandomToggle');
  const genderRandomToggle = document.getElementById('genderRandomToggle');
  if (ageRandomToggle) identityAgeRandom = ageRandomToggle.checked;
  if (regionRandomToggle) identityRegionRandom = regionRandomToggle.checked;
  if (genderRandomToggle) identityGenderRandom = genderRandomToggle.checked;
  const mgmtPreview = document.getElementById('mgmtIdentityPreview');
  if (!identityEnabled) {
    preview.textContent = '已关闭';
    if (mgmtPreview) mgmtPreview.textContent = '身份已关闭（不添加年龄 / 地区 / 性别）';
    const meta = document.getElementById('identityMeta');
    if (meta) meta.textContent = '已关闭';
    return;
  }
  rollIdentity();   // 预览每次重新抽，保证中英文一致
  preview.textContent = '已打开';
  const prefix = getIdentityPrefix();
  if (mgmtPreview) mgmtPreview.textContent = prefix;
  const meta = document.getElementById('identityMeta');
  if (meta) meta.textContent = prefix;
}

// ============================================================
// SECTION 4: Identity Management
// ============================================================

function loadIdentitySettings() {
  identityRegions = storage.get('identity_regions') || defaultIdentityRegions();
  identityGenders = storage.get('identity_genders') || defaultIdentityGenders();
  identityAge = storage.get('identity_age') || defaultIdentityAge();
  identityAgeRandom = storage.getBool('identity_age_random');
  identityRegionRandom = storage.getBool('identity_region_random');
  identityGenderRandom = storage.getBool('identity_gender_random');
  // 英文映射：服务器数据（loadDataConstants 已写入 IDENTITY_EN）优先，本地缓存合并补充
  const savedEn = storage.get('identity_en');
  if (savedEn && typeof savedEn === 'object' && !Array.isArray(savedEn)) {
    IDENTITY_EN = Object.assign({}, IDENTITY_EN, savedEn);
  }
  const _ieRaw = storage.getRaw('identity_enabled');
  identityEnabled = _ieRaw === null ? true : _ieRaw === 'true';
}

function saveIdentitySettings() {
  // Read checkbox states from DOM and sync to variables before saving
  const masterToggle = document.getElementById('identityEnabledToggle');
  if (masterToggle) identityEnabled = masterToggle.checked;
  const ageRandomToggle = document.getElementById('ageRandomToggle');
  const regionRandomToggle = document.getElementById('regionRandomToggle');
  const genderRandomToggle = document.getElementById('genderRandomToggle');
  if (ageRandomToggle) identityAgeRandom = ageRandomToggle.checked;
  if (regionRandomToggle) identityRegionRandom = regionRandomToggle.checked;
  if (genderRandomToggle) identityGenderRandom = genderRandomToggle.checked;

  storage.set('identity_regions', identityRegions);
  storage.set('identity_genders', identityGenders);
  storage.set('identity_en', IDENTITY_EN);
  storage.set('identity_age', identityAge);
  // 记住当前选中的值（非随机模式下），刷新后保持
  const _rs = document.getElementById('regionSelect');
  const _gs = document.getElementById('genderSelect');
  const _as = document.getElementById('ageSlider');
  if (_rs && _gs && _as) {
    storage.set('identity_selected', { region: _rs.value, gender: _gs.value, age: _as.value });
  }
  storage.setBool('identity_age_random', identityAgeRandom);
  storage.setBool('identity_region_random', identityRegionRandom);
  storage.setBool('identity_gender_random', identityGenderRandom);
  storage.setBool('identity_enabled', identityEnabled);
  syncAllToServer();
  updateIdentityPreview();
}

// 人物身份总开关
function toggleIdentityEnabled(on) {
  identityEnabled = !!on;
  // 先同步复选框，再让 saveIdentitySettings 以此为权威（否则会被 DOM 旧状态覆盖）
  const t = document.getElementById('identityEnabledToggle');
  if (t) t.checked = identityEnabled;
  saveIdentitySettings();
  renderIdentityBar();
  showToast(identityEnabled
    ? '✅ 已开启人物身份'
    : '🚫 已关闭人物身份，提示词不再添加年龄/地区/性别', 'success');
}

function renderIdentityBar() {
  const regionSel = document.getElementById('regionSelect');
  const genderSel = document.getElementById('genderSelect');
  const ageSlider = document.getElementById('ageSlider');
  const ageDisplay = document.getElementById('ageDisplay');
  const ageRandomToggle = document.getElementById('ageRandomToggle');
  const regionRandomToggle = document.getElementById('regionRandomToggle');
  const genderRandomToggle = document.getElementById('genderRandomToggle');

  // 用 DOM API 构建 option：地区/性别来自用户输入或导入数据，
  // 拼进 innerHTML 存在注入风险（如输入 `"><img src=x onerror=...>`）
  if (regionSel) {
    const current = regionSel.value || identityRegions[0] || '';
    regionSel.innerHTML = '';
    identityRegions.forEach(r => {
      const o = document.createElement('option');
      o.value = r;
      o.textContent = r;
      regionSel.appendChild(o);
    });
    if (identityRegions.includes(current)) regionSel.value = current;
  }
  if (genderSel) {
    const current = genderSel.value || identityGenders[0] || '';
    genderSel.innerHTML = '';
    identityGenders.forEach(g => {
      const o = document.createElement('option');
      o.value = g;
      o.textContent = g;
      genderSel.appendChild(o);
    });
    if (identityGenders.includes(current)) genderSel.value = current;
  }
  if (ageSlider) {
    ageSlider.min = identityAge.min || 18;
    ageSlider.max = identityAge.max || 49;
    const val = parseInt(ageSlider.value);
    if (val < ageSlider.min) ageSlider.value = ageSlider.min;
    if (val > ageSlider.max) ageSlider.value = ageSlider.max;
  }
  // 恢复上次选中的地区 / 性别 / 年龄（非随机模式下生效）
  const _sel = storage.get('identity_selected');
  if (_sel && typeof _sel === 'object') {
    if (regionSel && _sel.region && identityRegions.includes(_sel.region)) regionSel.value = _sel.region;
    if (genderSel && _sel.gender && identityGenders.includes(_sel.gender)) genderSel.value = _sel.gender;
    if (ageSlider && _sel.age) {
      const a = parseInt(_sel.age, 10);
      if (a >= ageSlider.min && a <= ageSlider.max) ageSlider.value = a;
    }
  }
  if (ageDisplay) ageDisplay.textContent = ageSlider ? ageSlider.value : '';
  if (ageRandomToggle) ageRandomToggle.checked = identityAgeRandom;
  if (regionRandomToggle) regionRandomToggle.checked = identityRegionRandom;
  if (genderRandomToggle) genderRandomToggle.checked = identityGenderRandom;
  const masterToggle = document.getElementById('identityEnabledToggle');
  if (masterToggle) masterToggle.checked = identityEnabled;
  const bar = document.getElementById('identityBar');
  if (bar) bar.classList.toggle('identity-off', !identityEnabled);
  document.querySelectorAll('.identity-fields').forEach(el => el.classList.toggle('disabled', !identityEnabled));
  updateIdentityPreview();
}

function renderIdentityManagement() {
  const regionList = document.getElementById('regionList');
  const genderList = document.getElementById('genderList');
  const ageMinInput = document.getElementById('ageMinInput');
  const ageMaxInput = document.getElementById('ageMaxInput');

  if (regionList) {
    regionList.innerHTML = identityRegions.map((r, i) =>
      `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(r)}${IDENTITY_EN[r] ? `<span style="color:var(--text3);font-size:10px;">${escapeHtml(IDENTITY_EN[r])}</span>` : ''}<button onclick="deleteRegion(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:0;line-height:1;">✕</button></span>`
    ).join('');
  }
  if (genderList) {
    genderList.innerHTML = identityGenders.map((g, i) =>
      `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:11px;">${escapeHtml(g)}${IDENTITY_EN[g] ? `<span style="color:var(--text3);font-size:10px;">${escapeHtml(IDENTITY_EN[g])}</span>` : ''}<button onclick="deleteGender(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:0;line-height:1;">✕</button></span>`
    ).join('');
  }
  if (ageMinInput) ageMinInput.value = identityAge.min || 18;
  if (ageMaxInput) ageMaxInput.value = identityAge.max || 49;
}

function addRegion() {
  const input = document.getElementById('newRegionInput');
  const enInput = document.getElementById('newRegionEnInput');
  const name = input.value.trim();
  if (!name) { showToast('⚠️ 请输入地区名称', 'error'); return; }
  if (identityRegions.includes(name)) { showToast('⚠️ 地区已存在', 'error'); return; }
  const en = enInput ? enInput.value.trim() : '';
  if (en) IDENTITY_EN[name] = en;
  identityRegions.push(name);
  input.value = '';
  if (enInput) enInput.value = '';
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`✅ 已添加地区「${name}」` + (en ? `（英文：${en}）` : '（未填英文，英文提示词将显示中文原名）'), 'success');
}

async function deleteRegion(idx) {
  if (idx < 0 || idx >= identityRegions.length) return;
  const name = identityRegions[idx];
  if (!await uiConfirm(`确定删除地区「${name}」？`, { danger: true, okText: '删除' })) return;
  identityRegions.splice(idx, 1);
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`🗑️ 已删除地区「${name}」`, 'success');
}

function addGender() {
  const input = document.getElementById('newGenderInput');
  const enInput = document.getElementById('newGenderEnInput');
  const name = input.value.trim();
  if (!name) { showToast('⚠️ 请输入性别', 'error'); return; }
  if (identityGenders.includes(name)) { showToast('⚠️ 性别已存在', 'error'); return; }
  const en = enInput ? enInput.value.trim() : '';
  if (en) IDENTITY_EN[name] = en;
  identityGenders.push(name);
  input.value = '';
  if (enInput) enInput.value = '';
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`✅ 已添加性别「${name}」` + (en ? `（英文：${en}）` : '（未填英文，英文提示词将显示中文原名）'), 'success');
}

async function deleteGender(idx) {
  if (idx < 0 || idx >= identityGenders.length) return;
  const name = identityGenders[idx];
  if (!await uiConfirm(`确定删除性别「${name}」？`, { danger: true, okText: '删除' })) return;
  identityGenders.splice(idx, 1);
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`🗑️ 已删除性别「${name}」`, 'success');
}

function saveAgeRange() {
  const min = parseInt(document.getElementById('ageMinInput').value) || 18;
  const max = parseInt(document.getElementById('ageMaxInput').value) || 49;
  if (min >= max) { showToast('⚠️ 最小年龄必须小于最大年龄', 'error'); return; }
  if (min < 1) { showToast('⚠️ 最小年龄不能小于1', 'error'); return; }
  if (max > 99) { showToast('⚠️ 最大年龄不能超过99', 'error'); return; }
  identityAge.min = min;
  identityAge.max = max;
  saveIdentitySettings();
  renderIdentityBar();
  showToast(`✅ 年龄范围已更新: ${min}~${max}`, 'success');
}

// ============================================================
// ============================================================
// SECTION 5: Enrich Template Groups（可自定义增删的润色模板组）
//   每组: { id, name, icon, color, on: 是否参与优化, person: 人物相关, cn: [], en: [] }
// ============================================================

function defaultEnrichGroups() {
  return [
    { id: 'enrich',  name: '画面描述', icon: '🌄', color: '#7c5cfc', on: true, person: false, cn: [], en: [] },
    { id: 'skin',    name: '皮肤描述', icon: '👩', color: '#f59e0b', on: true, person: true,  cn: [], en: [] },
    { id: 'quality', name: '画质描述', icon: '✨', color: '#34d399', on: true, person: false, cn: [], en: [] }
  ];
}

function genEnrichGroupId() { return 'g' + Date.now().toString(36) + (_enrichGroupSeq++); }

function findEnrichGroup(id) { return enrichGroups.find(g => g.id === id) || null; }

// 该组本次是否参与「优化」：需已启用；若标记为人物相关，则「人物身份」关闭时跳过
function enrichGroupActive(g) {
  if (!g || g.on === false) return false;
  if (g.person && !identityEnabled) return false;
  return true;
}

function normalizeEnrichGroups(list) {
  return (Array.isArray(list) ? list : []).filter(g => g && typeof g === 'object').map(g => ({
    // id 会拼进 onclick 属性（deleteEnrichItem('${id}'...)），白名单字符集防注入
    id: /^[A-Za-z0-9_-]+$/.test(String(g.id || '')) ? String(g.id) : genEnrichGroupId(),
    name: String(g.name || '未命名组'),
    icon: String(g.icon || '📄'),
    color: String(g.color || '#8d8d8d'),
    on: g.on !== false,
    person: !!g.person,
    cn: Array.isArray(g.cn) ? g.cn.slice() : [],
    en: Array.isArray(g.en) ? g.en.slice() : []
  }));
}

// 旧版 6 个扁平数组（enrichCN/enrichEN/skinCN/enrichEN/qualityCN/qualityEN）→ 模板组
function migrateLegacyEnrich(srcObj) {
  const get = k => Array.isArray(srcObj && srcObj[k]) ? srcObj[k].slice() : [];
  const groups = defaultEnrichGroups();
  groups[0].cn = get('enrichCN');  groups[0].en = get('enrichEN');
  groups[1].cn = get('skinCN');    groups[1].en = get('skinEN');
  groups[2].cn = get('qualityCN'); groups[2].en = get('qualityEN');
  return groups;
}

// 读取模板组：优先新格式，否则从旧格式迁移（兼容老数据/老导出文件）
function loadEnrichGroups(serverLegacy) {
  const saved = storage.get('enrich_groups');
  if (Array.isArray(saved) && saved.length) { enrichGroups = normalizeEnrichGroups(saved); return; }
  const pick = k => {
    const s = (serverLegacy && Array.isArray(serverLegacy[k]) && serverLegacy[k].length) ? serverLegacy[k] : null;
    if (s) return s;
    const ls = storage.get(k);
    return Array.isArray(ls) ? ls : [];
  };
  enrichGroups = migrateLegacyEnrich({
    enrichCN: pick('enrichCN'),   enrichEN: pick('enrichEN'),
    skinCN: pick('skinCN'),       skinEN: pick('skinEN'),
    qualityCN: pick('qualityCN'), qualityEN: pick('qualityEN')
  });
}

function saveEnrichData() {
  storage.set('enrich_groups', enrichGroups);
  syncAllToServer();
}

function renderEnrichManagement() {
  const container = document.getElementById('enrichMgmtContainer');
  if (!container) return;

  const head = `<div class="eg-top">
      <span class="eg-note">「启用」= 该组是否参与「优化」；「人物相关」的组，在「人物身份」总开关关闭时自动跳过</span>
      <input id="newEnrichGroupName" class="eg-newinput" placeholder="新组名称，如 氛围描述"
             onkeydown="if(event.key==='Enter')addEnrichGroup()">
      <button class="btn btn-sm btn-add eg-newbtn" onclick="addEnrichGroup()">+ 新建组</button>
    </div>`;

  const body = enrichGroups.map(g => {
    const active = enrichGroupActive(g);
    const skipped = !!(g.person && !identityEnabled);
    const cls = ['eg-group'];
    if (g.on === false) cls.push('eg-off');
    if (skipped) cls.push('eg-skipped');
    const listHtml = lang => {
      const arr = Array.isArray(g[lang]) ? g[lang] : [];
      if (!arr.length) return `<div class="eg-empty">(空)</div>`;
      return arr.map((t, i) => `<div class="eg-item">
          <span class="eg-tag">${lang.toUpperCase()}</span>
          <span class="eg-text">${escapeHtml(String(t))}</span>
          <button class="eg-del" title="删除该条" onclick="deleteEnrichItem('${g.id}','${lang}',${i})">✕</button>
        </div>`).join('');
    };
    return `<div class="${cls.join(' ')}">
      <div class="eg-head">
        <span class="eg-name">${escapeHtml(g.icon || '📄')} ${escapeHtml(g.name)}</span>
        <span class="eg-count">CN ${(g.cn || []).length} · EN ${(g.en || []).length}</span>
        <span class="eg-sp"></span>
        ${skipped ? '<span class="eg-badge">已跳过</span>' : (g.on === false ? '<span class="eg-badge eg-badge-off">已停用</span>' : '')}
        <label class="eg-chk${g.on !== false ? ' on' : ''}">
          <input type="checkbox" ${g.on !== false ? 'checked' : ''}
                 onchange="toggleEnrichGroup('${g.id}','on',this.checked)"> 启用
        </label>
        <label class="eg-chk${g.person ? ' warn' : ''}">
          <input type="checkbox" ${g.person ? 'checked' : ''}
                 onchange="toggleEnrichGroup('${g.id}','person',this.checked)"> 人物相关
        </label>
        <button class="eg-rmgroup" onclick="deleteEnrichGroup('${g.id}')">删除组</button>
      </div>
      <div class="eg-list">${listHtml('cn')}${listHtml('en')}</div>
      <div class="eg-addrow">
        <input id="egAddCN_${g.id}" class="eg-add" placeholder="添加中文模板..."
               onkeydown="if(event.key==='Enter')addEnrichItem('${g.id}','cn')">
        <input id="egAddEN_${g.id}" class="eg-add" placeholder="添加英文模板..."
               onkeydown="if(event.key==='Enter')addEnrichItem('${g.id}','en')">
        <button class="btn btn-sm btn-add" onclick="addEnrichBoth('${g.id}')">添加</button>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = head + body;
}

function addEnrichGroup() {
  const input = document.getElementById('newEnrichGroupName');
  const name = (input && input.value.trim()) || '';
  if (!name) { showToast('⚠️ 请先输入组名称', 'error'); return; }
  if (enrichGroups.some(g => g.name === name)) { showToast('⚠️ 已存在同名模板组', 'error'); return; }
  const palette = ['#8b5cf6', '#4d6bfe', '#10b981', '#f59e0b', '#14b8a6', '#a855f7', '#f97316', '#ef4444'];
  enrichGroups.push({
    id: genEnrichGroupId(), name, icon: '📄',
    color: palette[enrichGroups.length % palette.length],
    on: true, person: false, cn: [], en: []
  });
  saveEnrichData();
  renderEnrichManagement();
  showToast(`✅ 已新建模板组「${name}」`, 'success');
}

async function deleteEnrichGroup(id) {
  const g = findEnrichGroup(id);
  if (!g) return;
  const n = (Array.isArray(g.cn) ? g.cn.length : 0) + (Array.isArray(g.en) ? g.en.length : 0);
  if (!await uiConfirm(`删除模板组「${g.name}」及其中的 ${n} 条模板？`, { danger: true, okText: '删除' })) return;
  enrichGroups = enrichGroups.filter(x => x.id !== id);
  saveEnrichData();
  renderEnrichManagement();
  showToast('🗑️ 已删除模板组', 'success');
}

function toggleEnrichGroup(id, field, val) {
  const g = findEnrichGroup(id);
  if (!g) return;
  g[field] = !!val;
  saveEnrichData();
  renderEnrichManagement();
}

function addEnrichItem(groupId, lang, silentIfEmpty) {
  const g = findEnrichGroup(groupId);
  if (!g) return;
  const input = document.getElementById('egAdd' + lang.toUpperCase() + '_' + groupId);
  if (!input) return;
  const value = input.value.trim();
  if (!value) { if (!silentIfEmpty) showToast('⚠️ 模板内容不能为空', 'error'); return; }
  if (!Array.isArray(g[lang])) g[lang] = [];
  g[lang].push(value);
  input.value = '';
  saveEnrichData();
  renderEnrichManagement();
  if (!silentIfEmpty) showToast('✅ 已添加模板', 'success');
}

// 「添加」按钮：中英文输入框谁有内容就加谁
function addEnrichBoth(groupId) {
  const g = findEnrichGroup(groupId);
  if (!g) return;
  let added = 0;
  [['cn', 'CN'], ['en', 'EN']].forEach(([lang, up]) => {
    const input = document.getElementById('egAdd' + up + '_' + groupId);
    if (!input) return;
    const v = input.value.trim();
    if (!v) return;
    if (!Array.isArray(g[lang])) g[lang] = [];
    g[lang].push(v);
    input.value = '';
    added++;
  });
  if (!added) { showToast('⚠️ 模板内容不能为空', 'error'); return; }
  saveEnrichData();
  renderEnrichManagement();
  showToast('✅ 已添加模板', 'success');
}

async function deleteEnrichItem(groupId, lang, idx) {
  const g = findEnrichGroup(groupId);
  if (!g || !Array.isArray(g[lang])) return;
  if (idx < 0 || idx >= g[lang].length) return;
  const item = g[lang][idx];
  if (!await uiConfirm(`确定删除此模板？\n「${String(item).slice(0, 60)}」`, { danger: true, okText: '删除' })) return;
  g[lang].splice(idx, 1);
  saveEnrichData();
  renderEnrichManagement();
  showToast('🗑️ 已删除模板', 'success');
}
// ============================================================
// SECTION 6: Prompt Generation
// ============================================================

// 统一抽取逻辑：按类别出现概率抽取、跨类别去重、保底至少一条。
// randomPrompt 和 ComfyUI 批量生图共用，保证行为一致。
function rollPicks() {
  const enabledCats = DATA.filter(c => promptsEnabled[c.name] !== false && c.items.length);
  const picks = [], seen = new Set();
  enabledCats.forEach(cat => {
    // 锁定类别：锁定的提示词（仍存在于该类别中的）每次必出，不再随机补抽
    const lockedCns = promptsLocked[cat.name];
    if (Array.isArray(lockedCns) && lockedCns.length) {
      lockedCns.forEach(cn => {
        const item = cat.items.find(it => it.cn === cn);
        if (item && !seen.has(item.cn)) { seen.add(item.cn); picks.push(item); }
      });
      return;
    }
    const chance = promptsChance[cat.name] != null ? promptsChance[cat.name] : 100;
    if (chance < 100 && Math.random() * 100 >= chance) return;
    let item = cat.items[Math.floor(Math.random() * cat.items.length)];
    // 避免抽到与已选重复的词条（多个类别可能存在同名条目）
    for (let g = 0; g < 5 && seen.has(item.cn); g++) {
      item = cat.items[Math.floor(Math.random() * cat.items.length)];
    }
    if (seen.has(item.cn)) {
      // 随机重试仍撞车时，退而挑一个该类目下没被用过的条目；全撞了才跳过
      // （旧逻辑直接 return，整个类别本次不产出词条——数据里存在跨类别同名条目时会缺一块）
      const alt = cat.items.find(it => !seen.has(it.cn));
      if (!alt) return;
      item = alt;
    }
    seen.add(item.cn);
    picks.push(item);
  });
  // 兜底：概率设置过低导致一条都没抽中时，随机一个有内容的类别必出一条
  if (!picks.length && enabledCats.length) {
    const cat = enabledCats[Math.floor(Math.random() * enabledCats.length)];
    picks.push(cat.items[Math.floor(Math.random() * cat.items.length)]);
  }
  return { picks, enabledCount: enabledCats.length };
}

function randomPrompt() {
  // Sync random-toggle states from DOM so freshly clicked checkboxes take effect immediately
  const ageRT = document.getElementById('ageRandomToggle');
  const regionRT = document.getElementById('regionRandomToggle');
  const genderRT = document.getElementById('genderRandomToggle');
  if (ageRT) identityAgeRandom = ageRT.checked;
  if (regionRT) identityRegionRandom = regionRT.checked;
  if (genderRT) identityGenderRandom = genderRT.checked;

  rollIdentity();   // 本次构建抽一次身份，保证中英文一致

  const { picks, enabledCount } = rollPicks();
  if (enabledCount === 0) { showToast('⚠️ 请至少开启一个类别', 'error'); return; }
  if (!picks.length) { showToast('⚠️ 已开启的类别中没有词条', 'error'); return; }
  const identity = getIdentityPrefix();
  const cn = [identity].concat(picks.map(p => p.cn)).filter(Boolean).join('，');
  setPrompt(cn, picks);
  showToast(`✅ 已生成，抽取 ${picks.length}/${enabledCount} 个类别`, 'success');
}

function setPrompt(cnText, usedItems) {
  document.getElementById('promptArea').value = cnText;
  syncEn(cnText, usedItems);
  resizePromptAreas();
  refreshChipHighlights();
}

// 手动编辑中文后，英文框内容不再对应（英文框只读、不会自动同步），标灰提示
function markEnStale(stale) {
  const tea = document.getElementById('promptEnArea');
  if (!tea) return;
  tea.classList.toggle('en-stale', !!stale);
  tea.title = stale ? '中文已手动修改，英文可能已过期（可直接编辑英文，或点「随机组合 / 模板优化」重新同步）' : '';
}

function syncEn(cnText, usedItems) {
  let en = '';
  if (usedItems && usedItems.length) {
    const idEn = getIdentityEn();
    en = [idEn].concat(usedItems.map(p => p.en.split('/')[0].trim())).filter(Boolean).join(', ');
  } else {
    const segs = cnText.split(/[，,]\s*/).map(s => s.trim()).filter(Boolean);
    en = segs.map(s => {
      const e = CN_EN_MAP[s];
      if (e) return e.split('/')[0].trim();
      if (DATA) for (const cat of DATA) for (const item of cat.items) if (item.cn === s) return item.en.split('/')[0].trim();
      return s;
    }).join(', ');
  }
  document.getElementById('promptEnArea').value = en;
  _enManual = false;
  const es = document.getElementById('enState');
  if (es) es.textContent = '默认由中文自动映射';
  markEnStale(false);
}

function optimizePrompt() {
  const cnText = document.getElementById('promptArea').value.trim();
  if (!cnText) { showToast('⚠️ 提示词为空，请先生成', 'error'); return; }
  const segments = cnText.split(/[，,]/).map(s => s.trim()).filter(Boolean);

  // 参与本次优化的模板组：需「启用」；标记为「人物相关」的组在「人物身份」关闭时跳过
  const egActive = enrichGroups.filter(g => enrichGroupActive(g));
  const egHasCN = egActive.some(g => Array.isArray(g.cn) && g.cn.length);
  const egHasEN = egActive.some(g => Array.isArray(g.en) && g.en.length);
  if (!egHasCN) {
    uiAlert('没有可用的中文润色模板。\n请到「管理类别与提示词」→ 润色模板检查：各组是否已启用、组内是否有内容、是否被「人物身份」总开关跳过');
    return;
  }
  if (!egHasEN) {
    uiAlert('没有可用的英文润色模板。\n请到「管理类别与提示词」→ 润色模板检查：各组是否已启用、组内是否有内容、是否被「人物身份」总开关跳过');
    return;
  }

  let identityEnd = 0;
  if (segments.length > 0 && identityRegions.includes(segments[0])) {
    identityEnd = 1;
    if (segments.length > 1 && segments[1].endsWith('岁')) identityEnd = 2;
    if (segments.length > 2 && identityGenders.includes(segments[2])) identityEnd = 3;
  }

  const bodySegments = segments.slice(identityEnd);
  const idEn = getIdentityEn();

  // 位置规则（与旧版输出一致）：
  //   「画面描述」组 → 提示词最前；「画质描述」组 → 提示词最后；
  //   其余组（皮肤描述 + 用户自建组）→ 按组顺序接在正文之后
  const pickT = (g, lang) => (g && Array.isArray(g[lang]) && g[lang].length)
    ? g[lang][Math.floor(Math.random() * g[lang].length)] : '';
  const egFront = egActive.find(g => g.id === 'enrich') || null;
  const egTail  = egActive.find(g => g.id === 'quality') || null;
  const egMid   = egActive.filter(g => g !== egFront && g !== egTail);

  const base   = pickT(egFront, 'cn');
  const qual   = pickT(egTail, 'cn');
  const midCn  = egMid.map(g => pickT(g, 'cn')).filter(Boolean);
  const baseEn = pickT(egFront, 'en');
  const qualEn = pickT(egTail, 'en');
  const midEn  = egMid.map(g => pickT(g, 'en')).filter(Boolean);

  const identityCn = segments.slice(0, identityEnd).join('，');
  const bodyCn = bodySegments.join('，');
  let optimizedCn = '';
  if (base) optimizedCn += base + ' ';
  if (identityCn) optimizedCn += identityCn + '，';
  optimizedCn += bodyCn;
  if (midCn.length) optimizedCn += '。' + midCn.join('。');
  if (qual) optimizedCn += ' ' + qual;

  const enParts = bodySegments.map(s => {
    const e = CN_EN_MAP[s];
    if (e) return e.split('/')[0].trim();
    if (DATA) for (const cat of DATA) for (const item of cat.items) if (item.cn === s) return item.en.split('/')[0].trim();
    return s;
  });
  let optimizedEn = '';
  if (baseEn) optimizedEn += baseEn + ' ';
  if (idEn) optimizedEn += idEn + ', ';
  optimizedEn += enParts.join(', ');
  if (midEn.length) optimizedEn += '. ' + midEn.join('. ');
  if (qualEn) optimizedEn += ' ' + qualEn;

  document.getElementById('promptArea').value = optimizedCn;
  document.getElementById('promptEnArea').value = optimizedEn;
  _enManual = false;
  const _es = document.getElementById('enState');
  if (_es) _es.textContent = '模板优化结果 · 可继续编辑';
  markEnStale(false);
  resizePromptAreas();
  refreshChipHighlights();
  showToast('✨ 优化完成，已应用深度描述', 'success');
}

function copyPrompt(id) {
  const text = document.getElementById(id).value.trim();
  if (!text) { showToast('⚠️ 内容为空', 'error'); return; }
  navigator.clipboard.writeText(text).then(
    () => showToast('✅ 已复制到剪贴板', 'success'),
    () => showToast('⚠️ 复制失败', 'error')
  );
}

function clearPrompt() {
  document.getElementById('promptArea').value = '';
  document.getElementById('promptEnArea').value = '';
  _enManual = false;
  markEnStale(false);
  const es = document.getElementById('enState');
  if (es) es.textContent = '可手动编辑 · 默认由中文自动映射';
  resizePromptAreas();
  refreshChipHighlights();
}

// 高亮已填入提示词框的词条 chip；提示词内容任何变化（点选/随机/优化/AI/手动输入）后调用
function refreshChipHighlights() {
  const ta = document.getElementById('promptArea');
  if (!ta) return;
  const v = ta.value;
  document.querySelectorAll('.cat-preview .chip').forEach(ch => {
    const cn = ch.dataset.cn || ch.textContent;
    ch.classList.toggle('chip-active', !!cn && v.includes(cn));
  });
  updatePromptStats();
}

function addToPrompt(text) {
  const ta = document.getElementById('promptArea');
  const tea = document.getElementById('promptEnArea');
  const current = ta.value.trim();
  const enText = CN_EN_MAP[text] || text;
  const enFirst = enText.split('/')[0].trim();
  if (current) {
    ta.value = current + '，' + text;
    tea.value = (tea.value.trim() ? tea.value.trim() + ', ' : '') + enFirst;
  } else {
    ta.value = text;
    tea.value = enFirst;
  }
  markEnStale(false);
  resizePromptAreas();
  refreshChipHighlights();
  ta.focus();
}

function showAllItems(idx) {
  const cat = DATA[idx];
  const existing = document.getElementById('itemModal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'itemModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(13,13,13,.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const panel = document.createElement('div');
  panel.style.cssText = 'background:var(--surface-solid);border:1px solid var(--border);border-radius:var(--radius-card);max-width:600px;width:100%;max-height:75vh;overflow-y:auto;padding:18px;box-shadow:0 24px 64px -16px rgba(16,24,40,.25);';
  const title = document.createElement('h3');
  title.style.cssText = 'margin-bottom:10px;font-size:15px;color:var(--text);';
  title.textContent = `${cat.name} (${cat.items.length} 条)`;
  panel.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ 关闭';
  closeBtn.style.cssText = 'float:right;background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-family:inherit;';
  closeBtn.onclick = () => overlay.remove();
  panel.appendChild(closeBtn);
  const searchInput = document.createElement('input');
  searchInput.placeholder = '搜索...';
  searchInput.style.cssText = 'width:100%;padding:6px 10px;margin-bottom:10px;background:var(--surface);border:1px solid var(--border-strong);border-radius:5px;color:var(--text);font-size:12px;outline:none;font-family:inherit;';
  panel.appendChild(searchInput);
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';
  panel.appendChild(list);
  function render(filter) {
    list.innerHTML = '';
    (filter ? cat.items.filter(i => i.cn.includes(filter) || i.en.toLowerCase().includes(filter.toLowerCase())) : cat.items).forEach(item => {
      const chip = document.createElement('span');
      chip.textContent = item.cn;
      chip.style.cssText = 'font-size:11px;background:var(--surface2);color:var(--text2);padding:3px 8px;border-radius:3px;cursor:pointer;transition:background .15s,color .15s;';
      chip.onmouseenter = () => { chip.style.background = 'var(--accent)'; chip.style.color = '#fff'; };
      chip.onmouseleave = () => { chip.style.background = 'var(--surface2)'; chip.style.color = 'var(--text2)'; };
      chip.onclick = () => { addToPrompt(item.cn); overlay.remove(); };
      list.appendChild(chip);
    });
    if (!list.children.length) {
      const e = document.createElement('div');
      e.textContent = '无匹配结果';
      e.style.cssText = 'color:var(--text2);font-size:12px;padding:16px;text-align:center;width:100%;';
      list.appendChild(e);
    }
  }
  searchInput.oninput = () => render(searchInput.value);
  render();
  panel.prepend(searchInput, closeBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  setTimeout(() => searchInput.focus(), 100);
}

// ============================================================
// SECTION 7: Data Persistence
// ============================================================

function saveData() {
  const toSave = DATA.map(cat => ({
    name: cat.name,
    file: cat.file || '',
    items: cat.items,
    count: cat.items.length
  }));
  storage.set('prompts_data', toSave);
  storage.set('prompts_data_enabled', promptsEnabled);
  storage.set('prompts_chance', promptsChance);
  storage.set('prompts_locked', promptsLocked);
  syncAllToServer();
}

// 防抖：prompts.json 有几百 KB，原来每次小操作（开关类别、改年龄）都全量 POST 三次。
// 合并 600ms 内的连续修改，一次发出。
let _syncTimer = null;
function syncAllToServer() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(_doSyncAllToServer, 600);
}

function _buildSyncPayloads() {
  const out = [];
  ['prompts', 'ai', 'comfy'].forEach(cat => {
    const data = {};
    SERVER_KEYS[cat].forEach(k => {
      try {
        const v = storage.get(k);
        if (v !== null) data[serverKey(k)] = v;
      } catch (e) {
        console.warn('[sync] Failed to read key:', k, e.message);
      }
    });
    if (Object.keys(data).length) out.push(['/api/save-' + cat, data]);
  });
  return out;
}

function _doSyncAllToServer() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) return;
  _buildSyncPayloads().forEach(([url, data]) => {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  });
}

// 防抖窗口内直接关闭/切换标签页 → 这次修改只进了 localStorage、没进 data/*.json。
// pagehide/隐藏时用 sendBeacon 补一次落盘（浏览器保证尽力送达，且不会阻塞卸载）。
function flushSyncToServer() {
  if (!_syncTimer) return;
  clearTimeout(_syncTimer);
  _syncTimer = null;
  if (!window.location.origin || !window.location.origin.startsWith('http')) return;
  _buildSyncPayloads().forEach(([url, data]) => {
    try {
      navigator.sendBeacon(url, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    } catch (e) { /* 页面正在卸载，忽略 */ }
  });
}
window.addEventListener('pagehide', flushSyncToServer);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSyncToServer();
});

async function loadDataConstants() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) {
    loadEnrichGroups({});
    console.log('ℹ️ Data constants initialized (offline, using defaults)');
    return;
  }
  try {
    const r = await fetch('/api/load-prompts', { signal: AbortSignal.timeout(3000) });
    if (r.status === 404) {
      // 文件不存在：本地缓存已在 loadAllFromServer 清空。这里只加载默认模板组，
      // 不调用 saveEnrichData()，避免刚删除的文件又被自动同步重建
      loadEnrichGroups({});
      console.log('ℹ️ prompts.json 不存在，使用默认数据');
      return;
    }
    if (r.ok) {
      const d = await r.json();
      if (d && typeof d === 'object') {
        if (d.identity_en && typeof d.identity_en === 'object') {
          IDENTITY_EN = d.identity_en;
        }
        if (d.cn_en_map && typeof d.cn_en_map === 'object') {
          CN_EN_MAP = d.cn_en_map;
        }
        // 新版模板组（pg_enrich_groups）已在 loadAllFromServer 里进 localStorage；
        // 这里只负责：本地/服务器都没有新版数据时，用旧版 6 个扁平键做一次性迁移
        const legacyEnrich = {
          enrichCN:  (d.enrich_data && d.enrich_data.enrichCN)  || d.pg_enrichCN,
          enrichEN:  (d.enrich_data && d.enrich_data.enrichEN)  || d.pg_enrichEN,
          skinCN:    (d.enrich_data && d.enrich_data.skinCN)    || d.pg_skinCN,
          skinEN:    (d.enrich_data && d.enrich_data.skinEN)    || d.pg_skinEN,
          qualityCN: (d.enrich_data && d.enrich_data.qualityCN) || d.pg_qualityCN,
          qualityEN: (d.enrich_data && d.enrich_data.qualityEN) || d.pg_qualityEN
        };
        loadEnrichGroups(legacyEnrich);
        saveEnrichData();
      }
    }
  } catch (e) {
    console.warn('[loadDataConstants] Failed to fetch:', e.message);
  }
  console.log('ℹ️ Data constants initialized (fallback defaults used if server unavailable)');
}

// enrich_groups 走通用同步通道；旧 6 个扁平键只用于一次性迁移（见 loadEnrichGroups）

// 服务器端数据文件被删除/改名时，清空对应类别的本地缓存（文件即真相）。
// 只清该类别，不动其他设置；网络故障（fetch 抛错）不会走到这里。
function _clearLocalCategory(cat) {
  const group = BACKUP_GROUPS[cat];
  if (!group || group.server) return;
  group.keys.forEach(k => storage.remove(k));
  console.log('🧹 服务器文件缺失，已清空本地缓存:', cat);
}

async function loadAllFromServer() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) return false;
  let total = 0;
  for (const cat of ['prompts', 'ai', 'comfy']) {
    try {
      const r = await fetch('/api/load-' + cat, { signal: AbortSignal.timeout(2000) });
      if (r.status === 404) { _clearLocalCategory(cat); continue; }
      if (!r.ok) continue;
      const data = await r.json();
      if (!data) continue;
      SERVER_KEYS[cat].forEach(k => {
        const serverKeyName = serverKey(k);
        if (data[serverKeyName] !== undefined) {
          storage.set(k, data[serverKeyName]);
          total++;
        }
      });
    } catch (e) {
      console.warn('[loadAllFromServer] Failed for category:', cat, e.message);
    }
  }
  if (total > 0) { console.log('📂 Loaded', total, 'items from server files'); return true; }
  return false;
}

// ============================================================
// SECTION 8: Category Management
// ============================================================

function renderCategories() {
  const grid = document.getElementById('catGrid');
  grid.innerHTML = '';
  let total = 0;
  const isMgmt = document.getElementById('mgmtPanel').style.display !== 'none';
  DATA.forEach((cat, idx) => {
    total += cat.items.length;
    // 锁定状态：只统计仍存在于该类别中的锁定词条
    const lockedCns = Array.isArray(promptsLocked[cat.name]) ? promptsLocked[cat.name] : [];
    const lockCount = lockedCns.filter(cn => cat.items.some(it => it.cn === cn)).length;
    const card = document.createElement('div');
    card.className = 'cat-card' + (promptsEnabled[cat.name] !== false ? ' enabled' : '') + (lockCount ? ' cat-locked' : '');
    card.dataset.idx = idx;
    const header = document.createElement('div');
    header.className = 'cat-header';
    const checked = promptsEnabled[cat.name] !== false ? 'checked' : '';
    // 类别名可能形如「风格 (Style)」——拆成中文名 + 英文小标，界面更紧凑
    const _m = String(cat.name).match(/^(.+?)\s*[(（]([^)）]+)[)）]\s*$/);
    const dispName = _m ? _m[1].trim() : cat.name;
    const dispEn = _m ? _m[2].trim().toUpperCase() : '';
    let headerHtml = `<div><span class="cat-name">${escapeHtml(dispName)}</span>` +
      (dispEn ? `<span class="cat-en">${escapeHtml(dispEn)}</span>` : '') +
      `<span class="cat-count">${cat.items.length}</span></div>`;
    if (isMgmt) {
      // 管理模式：上移/下移（随机组合按类别顺序拼接）+ 删除
      headerHtml += `<span style="display:inline-flex;align-items:center;gap:2px;">` +
        `<button class="btn-del" style="color:var(--text2);" title="上移（随机组合时更靠前）" onclick="moveCategory(${idx},-1)">↑</button>` +
        `<button class="btn-del" style="color:var(--text2);" title="下移（随机组合时更靠后）" onclick="moveCategory(${idx},1)">↓</button>` +
        `<button class="btn-del" onclick="deleteCategory(${idx})" title="删除此类别">✕</button></span>`;
    } else {
      // 类别名由用户输入，不再拼接进 onchange 字符串（避免引号注入），改为 appendChild 后绑定事件
      headerHtml += `<label class="toggle"><input type="checkbox" ${checked}><span class="slider"></span></label>`;
    }
    header.innerHTML = headerHtml;
    // 锁定按钮：普通/管理模式都显示；点击打开锁定选择弹窗
    const lockBtn = document.createElement('button');
    lockBtn.className = 'btn-lock' + (lockCount ? ' locked' : '');
    lockBtn.title = lockCount
      ? `已锁定 ${lockCount} 条提示词（每次随机必出），点击管理锁定`
      : '锁定提示词：锁定的词条每次随机都会出现';
    lockBtn.innerHTML = `<svg class="icon"><use href="#icon-lock"/></svg>` +
      (lockCount ? `<span class="lock-count">${lockCount}</span>` : '');
    lockBtn.onclick = (e) => { e.stopPropagation(); openLockPicker(idx); };
    header.insertBefore(lockBtn, header.children[1]);
    if (!isMgmt) {
      const cb = header.querySelector('input[type="checkbox"]');
      if (cb) cb.addEventListener('change', () => toggleCat(cat.name, cb.checked, idx));
    }
    card.appendChild(header);
    const preview = document.createElement('div');
    preview.className = 'cat-preview';
    const _pv = (document.getElementById('promptArea') || { value: '' }).value;
    cat.items.slice(0, 7).forEach(item => {
      const chip = document.createElement('span');
      chip.className = 'chip'
        + (lockedCns.includes(item.cn) ? ' chip-locked' : '')
        + (_pv.includes(item.cn) ? ' chip-active' : '');
      chip.dataset.cn = item.cn;
      chip.textContent = item.cn;
      chip.title = lockedCns.includes(item.cn)
        ? `${item.en || ''}\n🔒 已锁定，每次随机必出`
        : (item.en || '');
      chip.onclick = () => addToPrompt(item.cn);
      preview.appendChild(chip);
    });
    if (cat.items.length > 7) {
      const more = document.createElement('span');
      more.className = 'chip';
      more.textContent = `+${cat.items.length - 7}`;
      more.style.opacity = '.5';
      more.onclick = () => showAllItems(idx);
      preview.appendChild(more);
    }
    card.appendChild(preview);
    if (isMgmt) {
      const actions = document.createElement('div');
      actions.className = 'cat-mgmt-actions';
      const mgmtBtn = document.createElement('button');
      mgmtBtn.textContent = '📝 管理提示词';
      mgmtBtn.onclick = () => openPromptManager(idx);
      actions.appendChild(mgmtBtn);
      // 出现率：随机组合时该类别被抽中的概率，100% = 每次必出
      const chanceWrap = document.createElement('label');
      chanceWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text2);margin-left:auto;cursor:default;';
      chanceWrap.appendChild(document.createTextNode('出现率'));
      const cInput = document.createElement('input');
      cInput.type = 'number';
      cInput.min = 0;
      cInput.max = 100;
      cInput.step = 10;
      cInput.value = promptsChance[cat.name] != null ? promptsChance[cat.name] : 100;
      cInput.title = '随机组合时该类别被抽中的概率（100 = 每次必出，0 = 从不出）';
      cInput.style.cssText = 'width:44px;padding:2px 4px;background:var(--surface);border:1px solid var(--border-strong);border-radius:6px;color:var(--text);font-size:10px;text-align:center;outline:none;font-family:inherit;';
      cInput.onchange = () => { setCategoryChance(cat.name, cInput.value); cInput.value = promptsChance[cat.name]; };
      chanceWrap.appendChild(cInput);
      chanceWrap.appendChild(document.createTextNode('%'));
      actions.appendChild(chanceWrap);
      card.appendChild(actions);
    }
    grid.appendChild(card);
  });
  document.getElementById('totalItems').textContent = total;
  updateLockSummary();
  const cs = document.getElementById('catSummary');
  if (cs) cs.textContent = `${DATA.length} 类 · ${total} 条`;
  const ms = document.getElementById('mgmtCatSummary');
  if (ms) ms.textContent = `${DATA.length} 类 · ${total} 条`;
  const searchEl = document.getElementById('catSearch');
  applyCatSearch(searchEl ? searchEl.value : '');
}

function toggleMgmtPanel() {
  const panel = document.getElementById('mgmtPanel');
  const overlay = document.getElementById('mgmtOverlay');
  const grid = document.getElementById('catGrid');
  const host = document.getElementById('mgmtCatHost');
  const leftHost = document.getElementById('leftCats');
  if (!panel) return;
  const willOpen = panel.style.display === 'none' || !panel.style.display;
  if (willOpen) {
    panel.style.display = 'block';
    if (overlay) overlay.style.display = 'flex';
    if (host && grid) host.appendChild(grid);
    renderCategories();
    renderIdentityManagement();
    renderEnrichManagement();
    const mp = document.getElementById('mgmtIdentityPreview');
    const ip = document.getElementById('identityPreview');
    if (mp && ip) mp.textContent = ip.textContent;
  } else {
    panel.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    if (leftHost && grid) leftHost.appendChild(grid);
    renderCategories();
  }
}

function toggleCat(name, enabled, idx) {
  document.querySelectorAll('.cat-card')[idx].classList.toggle('enabled', enabled);
  promptsEnabled[name] = enabled;
  saveData();
}

function addCategory() {
  const input = document.getElementById('newCatInput');
  const name = input.value.trim();
  if (!name) { showToast('⚠️ 请输入类别名称', 'error'); return; }
  if (DATA.some(c => c.name === name)) { showToast('⚠️ 类别已存在', 'error'); return; }
  DATA.push({ name, file: '', items: [], count: 0 });
  promptsEnabled[name] = true;
  input.value = '';
  saveData();
  renderCategories();
  showToast(`✅ 已添加类别「${name}」`, 'success');
}

// ============================================================
// 提示词锁定：锁定的词条每次随机必出（该类别不再随机补抽）
// ============================================================

function openLockPicker(catIdx) {
  const cat = DATA[catIdx];
  if (!cat) return;
  const existing = document.getElementById('lockModal');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'lockModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  const pn = document.createElement('div');
  pn.className = 'pm-panel';
  pn.style.maxWidth = '760px';

  const hd = document.createElement('div');
  hd.className = 'pm-header';
  hd.innerHTML = `<h3>🔒 锁定提示词 · ${escapeHtml(cat.name)}</h3>`;
  const cb = document.createElement('button');
  cb.textContent = '✕ 关闭';
  cb.style.cssText = 'background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 12px;border-radius:5px;cursor:pointer;font-size:12px;';
  cb.onclick = () => ov.remove();
  hd.appendChild(cb);
  pn.appendChild(hd);

  const bd = document.createElement('div');
  bd.className = 'pm-body';
  bd.style.padding = '12px 18px 4px';

  const info = document.createElement('div');
  info.style.cssText = 'font-size:11px;color:var(--text2);margin-bottom:8px;line-height:1.6;';
  info.textContent = '勾选要锁定的提示词：锁定的词条每次随机都会出现（该类别不再随机抽取其他词条），已锁定词条在卡片上以 🔒 标出。';
  bd.appendChild(info);

  const search = document.createElement('input');
  search.className = 'pm-search';
  search.style.marginBottom = '8px';
  search.placeholder = '🔍 搜索提示词...';
  bd.appendChild(search);

  const list = document.createElement('div');
  list.className = 'lock-picker-list';
  bd.appendChild(list);

  const lockedSet = new Set(promptsLocked[cat.name] || []);
  const cbs = [];
  function renderList(filter) {
    list.innerHTML = '';
    cbs.length = 0;
    const items = filter
      ? cat.items.filter(i => i.cn.toLowerCase().includes(filter) || (i.en || '').toLowerCase().includes(filter))
      : cat.items;
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'pm-empty';
      e.style.padding = '14px';
      e.textContent = filter ? '无匹配结果' : '该类别暂无提示词';
      list.appendChild(e);
      return;
    }
    items.forEach(item => {
      const lb = document.createElement('label');
      lb.className = 'uid-check-item';
      lb.style.minWidth = '0';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = lockedSet.has(item.cn);
      c.style.flexShrink = '0';
      const txt = document.createElement('span');
      txt.textContent = item.cn + (item.en ? '　' + item.en : '');
      txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
      txt.title = item.cn + (item.en ? '　' + item.en : '');
      lb.appendChild(c);
      lb.appendChild(txt);
      list.appendChild(lb);
      cbs.push({ cb: c, cn: item.cn });
    });
  }
  search.oninput = () => renderList(search.value.trim().toLowerCase());
  renderList('');

  const ft = document.createElement('div');
  ft.className = 'uid-footer';
  const clrBtn = document.createElement('button');
  clrBtn.textContent = '🔓 解除全部';
  clrBtn.onclick = () => { cbs.forEach(x => { x.cb.checked = false; }); };
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = () => ov.remove();
  const okBtn = document.createElement('button');
  okBtn.className = 'uid-btn-ok';
  okBtn.textContent = '保存锁定';
  okBtn.onclick = () => {
    const sel = cbs.filter(x => x.cb.checked).map(x => x.cn);
    if (sel.length) promptsLocked[cat.name] = sel;
    else delete promptsLocked[cat.name];
    saveData();
    renderCategories();
    ov.remove();
    showToast(sel.length ? `🔒 已锁定 ${sel.length} 条提示词，每次随机必出` : '🔓 已解除全部锁定', 'success');
  };
  ft.appendChild(clrBtn);
  ft.appendChild(cancelBtn);
  ft.appendChild(okBtn);
  bd.appendChild(ft);

  pn.appendChild(bd);
  ov.appendChild(pn);
  document.body.appendChild(ov);
  setTimeout(() => search.focus(), 100);
}

async function deleteCategory(idx) {
  const cat = DATA[idx];
  if (!cat) return;
  if (!await uiConfirm(`确定要删除类别「${cat.name}」及其所有 ${cat.items.length} 条提示词？`, { danger: true, okText: '删除' })) return;
  // 先快照再删，支持撤销
  const snapshot = {
    cat, idx,
    enabled: promptsEnabled[cat.name],
    chance: promptsChance[cat.name],
    locked: promptsLocked[cat.name]
  };
  DATA.splice(idx, 1);
  delete promptsEnabled[cat.name];
  delete promptsChance[cat.name];
  delete promptsLocked[cat.name];
  saveData();
  renderCategories();
  pushUndo(`删除类别「${cat.name}」`, () => {
    DATA.splice(Math.min(snapshot.idx, DATA.length), 0, snapshot.cat);
    if (snapshot.enabled !== undefined) promptsEnabled[snapshot.cat.name] = snapshot.enabled;
    if (snapshot.chance !== undefined) promptsChance[snapshot.cat.name] = snapshot.chance;
    if (snapshot.locked !== undefined) promptsLocked[snapshot.cat.name] = snapshot.locked;
    saveData();
    renderCategories();
  });
  showToast(`🗑️ 已删除类别「${cat.name}」`, 'success', { label: '撤销', onClick: undoLast });
}

// 类别上移/下移：随机组合按 DATA 顺序拼接，顺序即语义顺序
function moveCategory(idx, dir) {
  const j = idx + dir;
  if (idx < 0 || idx >= DATA.length || j < 0 || j >= DATA.length) return;
  const t = DATA[idx];
  DATA[idx] = DATA[j];
  DATA[j] = t;
  saveData();
  renderCategories();
}

// 设置类别出现概率（0-100），100 = 每次必出
function setCategoryChance(name, val) {
  let v = Math.round(Number(val));
  if (isNaN(v)) v = 100;
  v = Math.max(0, Math.min(100, v));
  promptsChance[name] = v;
  storage.set('prompts_chance', promptsChance);
  syncAllToServer();
}

// 语义槽位顺序：让随机拼接按「画质→主体→外观→表情→服装→动作→道具→场景→氛围→构图」成句
const SLOT_ORDER_KEYWORDS = [
  ['画质', '质量', '画风', '风格', '渲染'],              // 0 画质/风格
  ['身份', '人物', '职业', '年龄', '性别'],              // 1 主体身份
  ['外貌', '发型', '发色', '眼', '脸', '皮肤', '身材', '体型'], // 2 外观
  ['表情', '情绪', '神态'],                              // 3 表情
  ['服装', '服饰', '配饰', '首饰', '纹身', '标记'],       // 4 服装/装饰
  ['动作', '姿势', '姿态'],                              // 5 动作
  ['道具', '物品', '手持'],                              // 6 道具
  ['场景', '环境', '地点', '背景', '室内', '室外'],       // 7 场景
  ['天气', '季节', '四季', '时间', '光线', '光照', '氛围', '液体'], // 8 氛围
  ['构图', '景别', '镜头', '视角', '角度', '焦距']        // 9 构图最后
];

function _slotRank(name) {
  for (let i = 0; i < SLOT_ORDER_KEYWORDS.length; i++) {
    if (SLOT_ORDER_KEYWORDS[i].some(k => name.includes(k))) return i;
  }
  return 4.5; // 未识别的类别排在中间（服装之后、动作之前）
}

function semanticSortCategories() {
  DATA.sort((a, b) => _slotRank(a.name) - _slotRank(b.name));
  saveData();
  renderCategories();
  showToast('✅ 已按语义顺序排列类别', 'success');
}

// ============================================================
// SECTION 9: Prompt Manager Modal
// ============================================================

let _pmCatIdx = -1;

function openPromptManager(catIdx) {
  _pmCatIdx = catIdx;
  const cat = DATA[catIdx];
  if (!cat) return;
  const existing = document.getElementById('pmModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'pm-overlay';
  overlay.id = 'pmModal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const panel = document.createElement('div');
  panel.className = 'pm-panel';

  const header = document.createElement('div');
  header.className = 'pm-header';
  header.innerHTML = `<h3>📝 ${escapeHtml(cat.name)} <span class="mgmt-badge">${cat.items.length} 条</span></h3>`;
  const closeHdrBtn = document.createElement('button');
  closeHdrBtn.textContent = '✕ 关闭';
  closeHdrBtn.style.cssText = 'background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 12px;border-radius:5px;cursor:pointer;font-size:12px;';
  closeHdrBtn.onclick = () => overlay.remove();
  header.appendChild(closeHdrBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'pm-body';
  body.id = 'pmBody';
  panel.appendChild(body);
  renderPromptManager(body);

  const footer = document.createElement('div');
  footer.className = 'pm-footer';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.onclick = () => overlay.remove();
  footer.appendChild(closeBtn);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function renderPromptManager(container) {
  const cat = DATA[_pmCatIdx];
  if (!cat) return;
  container.innerHTML = '';

  const searchInput = document.createElement('input');
  searchInput.className = 'pm-search';
  searchInput.placeholder = '🔍 搜索提示词...';
  searchInput.oninput = () => {
    const val = searchInput.value.trim().toLowerCase();
    renderPromptList(list, val);
  };
  container.appendChild(searchInput);

  const list = document.createElement('div');
  list.className = 'pm-list';
  list.id = 'pmList';
  container.appendChild(list);
  renderPromptList(list, '');

  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid var(--border);margin:10px 0;';
  container.appendChild(sep);

  const addLabel = document.createElement('div');
  addLabel.style.cssText = 'font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px;';
  addLabel.textContent = '添加提示词';
  container.appendChild(addLabel);

  const addRow = document.createElement('div');
  addRow.className = 'pm-add-row';
  const cnInput = document.createElement('input');
  cnInput.id = 'pmNewCn';
  cnInput.placeholder = '中文 (必填)';
  cnInput.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('pmNewEn').focus(); };
  const enInput = document.createElement('input');
  enInput.id = 'pmNewEn';
  enInput.placeholder = 'English (可选)';
  enInput.onkeydown = (e) => { if (e.key === 'Enter') addPrompt(); };
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm btn-add';
  addBtn.textContent = '添加';
  addBtn.onclick = () => addPrompt();
  addRow.appendChild(cnInput);
  addRow.appendChild(enInput);
  addRow.appendChild(addBtn);
  container.appendChild(addRow);

  const batchLabel = document.createElement('div');
  batchLabel.style.cssText = 'font-size:12px;font-weight:600;color:var(--text2);margin:8px 0 4px;';
  batchLabel.textContent = '批量添加（每行一条：中文，English）';
  container.appendChild(batchLabel);

  const batchRow = document.createElement('div');
  batchRow.style.cssText = 'display:flex;gap:6px;align-items:flex-start;';
  const batchTa = document.createElement('textarea');
  batchTa.id = 'pmBatchTa';
  batchTa.className = 'pm-batch';
  batchTa.rows = 3;
  batchTa.placeholder = '批量添加（每行一条：中文，English）\n示例：\n卧室，bedroom\n客厅，living room\n厨房，kitchen';
  const batchBtn = document.createElement('button');
  batchBtn.className = 'btn btn-sm btn-add';
  batchBtn.textContent = '批量添加';
  batchBtn.style.cssText = 'flex-shrink:0;margin-top:0;';
  batchBtn.onclick = () => batchAddPrompts();
  batchRow.appendChild(batchTa);
  batchRow.appendChild(batchBtn);
  container.appendChild(batchRow);

  // AI 生成提示词的要求说明：复制给任意 AI 即可获得格式正确的列表，整体粘贴到上面即可
  const aiTip = document.createElement('div');
  aiTip.style.cssText = 'font-size:10px;color:var(--text2);margin-top:6px;line-height:1.7;';
  aiTip.innerHTML = '💡 提示词可以让 AI 帮你生成，要求示例：「请生成 20 条〔<b>' + escapeHtml(cat.name) +
    '</b>〕类提示词，每行一条，格式为：<b>中文，English</b>。中文 2~10 个字；英文用简洁的绘画关键词，同一含义有多个写法时用 / 分隔。不要编号、不要任何解释说明，直接输出列表。」把 AI 的回复整体粘贴到上面即可（自动跳过重复条目）。';
  container.appendChild(aiTip);
}

function renderPromptList(container, filter) {
  const cat = DATA[_pmCatIdx];
  if (!cat) return;
  container.innerHTML = '';
  const items = filter
    ? cat.items.filter(i => i.cn.toLowerCase().includes(filter) || (i.en && i.en.toLowerCase().includes(filter)))
    : cat.items;
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pm-empty';
    empty.textContent = filter ? '无匹配结果' : '暂无提示词，请在下方添加';
    container.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const realIdx = cat.items.indexOf(item);
    const row = document.createElement('div');
    row.className = 'pm-item';
    const textSpan = document.createElement('div');
    textSpan.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;';
    const cnSpan = document.createElement('span');
    cnSpan.className = 'pm-cn';
    cnSpan.textContent = item.cn;
    const enSpan = document.createElement('span');
    enSpan.className = 'pm-en';
    enSpan.textContent = item.en || '';
    textSpan.appendChild(cnSpan);
    textSpan.appendChild(enSpan);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-del';
    delBtn.textContent = '✕';
    delBtn.onclick = (e) => { e.stopPropagation(); deletePrompt(_pmCatIdx, realIdx); };
    delBtn.title = '删除此提示词';
    row.appendChild(textSpan);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
  const badge = document.querySelector('#pmModal .mgmt-badge');
  if (badge) badge.textContent = cat.items.length + ' 条';
}

function addPrompt() {
  const cn = document.getElementById('pmNewCn').value.trim();
  const en = document.getElementById('pmNewEn').value.trim();
  if (!cn) { showToast('⚠️ 中文内容不能为空', 'error'); return; }
  DATA[_pmCatIdx].items.push({ cn, en });
  document.getElementById('pmNewCn').value = '';
  document.getElementById('pmNewEn').value = '';
  saveData();
  const body = document.getElementById('pmBody');
  if (body) renderPromptManager(body);
  renderCategories();
  showToast(`✅ 已添加提示词「${cn}」`, 'success');
}

function batchAddPrompts() {
  const ta = document.getElementById('pmBatchTa');
  const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) { showToast('⚠️ 请输入提示词，每行一条', 'error'); return; }
  let added = 0;
  lines.forEach(line => {
    const sep = line.includes('，') ? '，' : (line.includes(',') ? ',' : null);
    let cn, en = '';
    if (sep) {
      const parts = line.split(sep);
      cn = parts[0].trim();
      en = parts.slice(1).join(sep).trim();
    } else {
      cn = line.trim();
    }
    if (cn) {
      DATA[_pmCatIdx].items.push({ cn, en });
      added++;
    }
  });
  ta.value = '';
  saveData();
  const body = document.getElementById('pmBody');
  if (body) renderPromptManager(body);
  renderCategories();
  showToast(`✅ 已批量添加 ${added} 条提示词`, 'success');
}

function deletePrompt(catIdx, itemIdx) {
  const cat = DATA[catIdx];
  if (!cat || !cat.items[itemIdx]) return;
  const item = cat.items[itemIdx];
  const cn = item.cn;
  cat.items.splice(itemIdx, 1);
  saveData();
  const body = document.getElementById('pmBody');
  if (body) renderPromptManager(body);
  renderCategories();
  pushUndo(`删除「${cn}」`, () => {
    cat.items.splice(Math.min(itemIdx, cat.items.length), 0, item);
    saveData();
    const b2 = document.getElementById('pmBody');
    if (b2) renderPromptManager(b2);
    renderCategories();
  });
  showToast(`🗑️ 已删除「${cn}」`, 'success', { label: '撤销', onClick: undoLast });
}

// ============================================================
// SECTION 10: AI Configuration
// ============================================================

const AI_PROVIDERS = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', online: true },
  kimi: { name: 'Kimi (月之暗面)', baseUrl: 'https://api.moonshot.cn/v1', online: true },
  llama: { name: 'LLaMA', baseUrl: 'https://api.llama-api.com', online: true },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', online: true },
  ollama: { name: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', online: false },
  'lm-studio': { name: 'LM Studio (本地)', baseUrl: 'http://localhost:1234/v1', online: false },
  custom: { name: '自定义', baseUrl: '', online: false }
};

let aiSettings = null, aiPreset = null, aiHistory = [];

function defaultAiSettings() {
  return { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', polishLang: 'both' };
}

function defaultAiPreset() {
  return {
    preset: '你是一个专业的 AI 绘画提示词生成专家。\n用户给你一组简短的关键词组合，你需要扩展成长篇详细提示词。\n\n要求：\n- 输出一段连贯的中文叙述段落，不要用逗号列表，不要用英文\n- 包含以下维度（按需展开）：\n  1. 场景与光线：地点、光源类型、光线氛围、曝光情况\n  2. 拍摄手法：视角、构图、镜头焦段、镜头类型、后期风格\n  3. 人物外貌：年龄、脸型、发型、五官细节、妆容、皮肤质感\n  4. 人物穿着：服装款式、颜色、质地、配饰\n  5. 姿势动作：肢体位置、姿态、动态细节\n  6. 表情眼神：情绪状态、眼神方向、微表情\n  7. 背景环境：周围陈设、空间感、画面景深\n  8. 氛围情绪：整体氛围、色彩调性、叙事感\n- 可以使用括号加权重语法，例如(女孩皮肤白皙:1.35)\n- 长度控制在 5-8 句自然段落\n- 保持真实摄影感，避免二次元动漫风描述\n\n直接输出优化后的中文提示词，不要添加额外说明。'
  };
}

function loadAiSettings() {
  aiSettings = storage.get('ai_settings') || defaultAiSettings();
}

function saveAiSettings() {
  storage.set('ai_settings', aiSettings);
  syncAllToServer();
}

function loadAiPreset() {
  aiPreset = storage.get('ai_preset') || defaultAiPreset();
}

function saveAiPreset() {
  storage.set('ai_preset', aiPreset);
  syncAllToServer();
}

function loadAiHistory() {
  aiHistory = storage.get('ai_history') || [];
}

function saveAiHistory() {
  storage.set('ai_history', aiHistory);
  syncAllToServer();
}

function updateAiStatus() {
  const el = document.getElementById('aiStatus');
  const tog = document.getElementById('aiToggle');
  if (!el || !tog) return;
  const meta = document.getElementById('aiMeta');
  if (!tog.checked) {
    el.innerHTML = '已关闭';
    el.className = 'ai-indicator';
    if (meta) meta.textContent = '已关闭';
    return;
  }
  if (aiSettings && aiSettings.baseUrl && aiSettings.model) {
    el.innerHTML = '<span class="dot green"></span>已配置';
    el.className = 'ai-indicator on';
    if (meta) meta.textContent = aiSettings.model;
  } else {
    el.innerHTML = '未配置';
    el.className = 'ai-indicator';
    if (meta) meta.textContent = '未配置';
  }
}

// ============================================================
// SECTION 11: AI Settings Modal
// ============================================================

function openAiSettings() {
  const ex = document.getElementById('aiSettingsModal');
  if (ex) ex.remove();
  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'aiSettingsModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const pn = document.createElement('div');
  pn.className = 'pm-panel';
  pn.style.maxWidth = '480px';

  const hd = document.createElement('div');
  hd.className = 'pm-header';
  hd.innerHTML = '<h3>⚙️ AI 设置</h3>';
  const cb = document.createElement('button');
  cb.style.cssText = 'background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 12px;border-radius:5px;cursor:pointer;font-size:12px;';
  cb.textContent = '✕ 关闭';
  cb.onclick = () => ov.remove();
  hd.appendChild(cb);
  pn.appendChild(hd);

  const bd = document.createElement('div');
  bd.className = 'pm-body';
  bd.style.padding = '14px 18px';

  function addLabel(t) { const l = document.createElement('div'); l.className = 'ai-label'; l.textContent = t; bd.appendChild(l); }
  function addInput(id, ph, val, type) {
    const i = document.createElement('input');
    i.id = id;
    i.type = type || 'text';
    i.className = 'ai-settings-input';
    i.placeholder = ph;
    i.value = val || '';
    bd.appendChild(i);
    return i;
  }

  addLabel('AI 厂商');
  const ps = document.createElement('select');
  ps.id = 'aiProvider';
  ps.className = 'ai-settings-select';
  Object.entries(AI_PROVIDERS).forEach(([k, v]) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = v.name;
    if (k === aiSettings.provider) o.selected = true;
    ps.appendChild(o);
  });
  ps.onchange = () => {
    const p = AI_PROVIDERS[ps.value];
    if (p && ps.value !== 'custom') { uir.value = p.baseUrl; }
    kl.style.display = p.online ? '' : 'none';
    ki.style.display = p.online ? '' : 'none';
  };
  bd.appendChild(ps);

  addLabel('API 地址');
  const uir = addInput('aiBaseUrl', 'https://api.deepseek.com', aiSettings.baseUrl, 'url');

  const kl = document.createElement('div');
  kl.className = 'ai-label';
  kl.textContent = 'API Key';
  const ki = document.createElement('input');
  ki.id = 'aiApiKey';
  ki.type = 'password';
  ki.className = 'ai-settings-input';
  ki.placeholder = 'sk-...（本地模型可留空）';
  ki.value = aiSettings.apiKey;
  const provInfo = AI_PROVIDERS[aiSettings.provider] || {};
  if (!provInfo.online) { kl.style.display = 'none'; ki.style.display = 'none'; }
  bd.appendChild(kl);
  bd.appendChild(ki);

  addLabel('模型名称');
  const mr = document.createElement('div');
  mr.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
  const mi = document.createElement('input');
  mi.id = 'aiModel';
  mi.className = 'ai-settings-input';
  mi.style.marginBottom = '0';
  mi.placeholder = 'deepseek-chat 或手动输入';
  mi.value = aiSettings.model;
  const fb = document.createElement('button');
  fb.innerHTML = '📡 获取模型';
  fb.id = 'fetchModelsBtn';
  fb.style.cssText = 'flex-shrink:0;padding:7px 10px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap;';
  fb.onclick = () => fetchModels(uir.value, ki.value, ps.value, mi);
  mr.appendChild(mi);
  mr.appendChild(fb);
  bd.appendChild(mr);

  const ll = document.createElement('div');
  ll.className = 'ai-label';
  ll.textContent = '🌐 润色语言';
  bd.appendChild(ll);
  const lr = document.createElement('div');
  lr.style.cssText = 'display:flex;gap:10px;margin-bottom:10px;';
  ['both', 'cn', 'en'].forEach(v => {
    const lb = document.createElement('label');
    lb.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;';
    const ip = document.createElement('input');
    ip.type = 'radio';
    ip.name = 'aiPolLang';
    ip.value = v;
    if (v === aiSettings.polishLang) ip.checked = true;
    ip.onchange = () => { aiSettings.polishLang = v; };
    lb.appendChild(ip);
    lb.appendChild(document.createTextNode(v === 'both' ? '🇨🇳+🇬🇧 中+英' : v === 'cn' ? '🇨🇳 仅中文' : '🇬🇧 仅英文'));
    lr.appendChild(lb);
  });
  bd.appendChild(lr);

  const tb = document.createElement('button');
  tb.id = 'aiTestBtn';
  tb.className = 'ai-btn-full';
  tb.style.cssText += 'background:var(--surface2);color:var(--text);border:1px solid var(--border);margin-bottom:8px;';
  tb.textContent = '🔌 测试连接';
  tb.onclick = () => testConnection(uir.value, ki.value, ps.value, mi.value);
  bd.appendChild(tb);

  const sb = document.createElement('button');
  sb.className = 'ai-btn-full';
  sb.style.background = 'var(--accent)';
  sb.style.color = '#fff';
  sb.style.marginBottom = '0';
  sb.textContent = '💾 保存设置';
  sb.onclick = () => {
    aiSettings.provider = ps.value;
    aiSettings.baseUrl = uir.value.replace(/\/+$/, '');
    aiSettings.apiKey = ki.value;
    aiSettings.model = mi.value;
    saveAiSettings();
    updateAiStatus();
    syncPolishLangUI();
    ov.remove();
    showToast('✅ AI 设置已保存', 'success');
  };
  bd.appendChild(sb);

  pn.appendChild(bd);
  ov.appendChild(pn);
  document.body.appendChild(ov);
}

async function fetchModels(baseUrl, apiKey, provider, modelInput) {
  const btn = document.getElementById('fetchModelsBtn');
  if (!btn) return;
  btn.textContent = '⏳ 获取中...';
  btn.disabled = true;
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/models';
    const h = { 'Content-Type': 'application/json' };
    const p = AI_PROVIDERS[provider];
    if (p && p.online && apiKey) h['Authorization'] = 'Bearer ' + apiKey;
    const r = await fetch(url, { headers: h });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const models = d.data || [];
    if (!models.length) { showToast('⚠️ 未获取到模型列表', 'error'); return; }
    const cur = modelInput.value;
    const ms = document.createElement('select');
    ms.className = 'ai-model-select';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '-- 选择模型 --';
    ms.appendChild(ph);
    models.forEach(m => {
      const o = document.createElement('option');
      o.value = m.id || m.name;
      o.textContent = m.id || m.name;
      if (o.value === cur) o.selected = true;
      ms.appendChild(o);
    });
    ms.onchange = () => { modelInput.value = ms.value; ms.remove(); };
    modelInput.parentNode.insertBefore(ms, modelInput.nextSibling);
    showToast('✅ 获取到 ' + models.length + ' 个模型，请选择', 'success');
  } catch (e) {
    showToast('⚠️ 获取模型失败: ' + e.message, 'error');
  } finally {
    btn.textContent = '📡 获取模型';
    btn.disabled = false;
  }
}

async function testConnection(baseUrl, apiKey, provider, model) {
  const btn = document.getElementById('aiTestBtn');
  if (!btn) return;
  if (!baseUrl) { showToast('⚠️ 请输入 API 地址', 'error'); return; }
  if (!model) { showToast('⚠️ 请输入模型名称', 'error'); return; }
  btn.textContent = '⏳ 测试中...';
  btn.disabled = true;
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const h = { 'Content-Type': 'application/json' };
    if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
    const r = await fetch(url, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with "OK" only.' }], max_tokens: 10 })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 200) : '')); }
    const d = await r.json();
    if (d.error) throw new Error('API 返回错误: ' + JSON.stringify(d.error).slice(0, 200));
    let testReply = '';
    if (d.choices && d.choices[0] && d.choices[0].message) {
      const m = d.choices[0].message;
      testReply = m.content || '';
      if (!testReply && typeof m.reasoning_content === 'string' && m.reasoning_content) testReply = m.reasoning_content;
      if (!testReply) testReply = '(连接成功，模型返回内容为空)';
    }
    if (!testReply && d.response) testReply = d.response;
    if (!testReply) throw new Error('API 响应格式异常: ' + JSON.stringify(d).slice(0, 200));
    showToast('✅ 连接成功！模型响应: ' + testReply.slice(0, 60), 'success');
  } catch (e) {
    showToast('❌ 连接失败: ' + e.message, 'error');
  } finally {
    btn.textContent = '🔌 测试连接';
    btn.disabled = false;
  }
}

function openAiPreset() {
  const ex = document.getElementById('aiPresetModal');
  if (ex) ex.remove();
  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'aiPresetModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const pn = document.createElement('div');
  pn.className = 'pm-panel';
  pn.style.maxWidth = '550px';

  const hd = document.createElement('div');
  hd.className = 'pm-header';
  hd.innerHTML = '<h3>📝 AI 润色预设</h3>';
  const cb = document.createElement('button');
  cb.style.cssText = 'background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 12px;border-radius:5px;cursor:pointer;font-size:12px;';
  cb.textContent = '✕ 关闭';
  cb.onclick = () => ov.remove();
  hd.appendChild(cb);
  pn.appendChild(hd);

  const bd = document.createElement('div');
  bd.className = 'pm-body';
  bd.style.padding = '14px 18px';
  const info = document.createElement('div');
  info.style.cssText = 'font-size:11px;color:var(--text2);margin-bottom:8px;';
  info.textContent = '💡 该预设只在首次通信或通信中断时发送一次。需同时润色中英文提示词。';
  bd.appendChild(info);

  const ta = document.createElement('textarea');
  ta.id = 'aiPresetTa';
  ta.style.cssText = 'width:100%;min-height:180px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:10px;font-size:12px;font-family:inherit;outline:none;resize:vertical;';
  ta.value = aiPreset.preset;
  bd.appendChild(ta);

  const sb = document.createElement('button');
  sb.textContent = '💾 保存预设';
  sb.className = 'ai-btn-full';
  sb.style.background = 'var(--accent)';
  sb.style.color = '#fff';
  sb.style.marginTop = '10px';
  sb.onclick = () => {
    aiPreset.preset = document.getElementById('aiPresetTa').value;
    saveAiPreset();
    ov.remove();
    showToast('✅ 预设已保存', 'success');
  };
  bd.appendChild(sb);
  pn.appendChild(bd);
  ov.appendChild(pn);
  document.body.appendChild(ov);
}

function openAiHistory() {
  const ex = document.getElementById('aiHistoryModal');
  if (ex) ex.remove();
  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'aiHistoryModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const pn = document.createElement('div');
  pn.className = 'pm-panel';
  pn.style.maxWidth = '620px';

  const hd = document.createElement('div');
  hd.className = 'pm-header';
  hd.innerHTML = '<h3>📜 润色历史 <span class="mgmt-badge">' + aiHistory.length + ' 条</span></h3>';
  const cb = document.createElement('button');
  cb.style.cssText = 'background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 12px;border-radius:5px;cursor:pointer;font-size:12px;';
  cb.textContent = '✕ 关闭';
  cb.onclick = () => ov.remove();
  hd.appendChild(cb);
  pn.appendChild(hd);

  const bd = document.createElement('div');
  bd.className = 'pm-body';
  if (!aiHistory.length) {
    const e = document.createElement('div');
    e.className = 'pm-empty';
    e.textContent = '暂无润色记录';
    bd.appendChild(e);
  } else {
    aiHistory.forEach((r, i) => {
      const c = document.createElement('div');
      c.className = 'ai-history-card';
      const t = document.createElement('div');
      t.className = 'ai-history-time';
      t.textContent = '#' + (i + 1) + ' · ' + new Date(r.timestamp).toLocaleString('zh-CN');
      c.appendChild(t);
      const ol = document.createElement('div');
      ol.className = 'ai-history-label orig';
      ol.textContent = '原始:';
      c.appendChild(ol);
      const ot = document.createElement('div');
      ot.className = 'ai-history-text';
      ot.textContent = r.original;
      c.appendChild(ot);
      if (r.originalEn) {
        const oe = document.createElement('div');
        oe.className = 'ai-history-text en';
        oe.textContent = r.originalEn;
        c.appendChild(oe);
      }
      const pl = document.createElement('div');
      pl.className = 'ai-history-label pol';
      pl.textContent = '润色后:';
      c.appendChild(pl);
      const pt = document.createElement('div');
      pt.className = 'ai-history-text';
      pt.textContent = r.polished;
      c.appendChild(pt);
      if (r.polishedEn) {
        const pe = document.createElement('div');
        pe.className = 'ai-history-text en';
        pe.textContent = r.polishedEn;
        c.appendChild(pe);
      }
      bd.appendChild(c);
    });
  }
  pn.appendChild(bd);
  if (aiHistory.length) {
    const ft = document.createElement('div');
    ft.className = 'pm-footer';
    const clr = document.createElement('button');
    clr.textContent = '🗑️ 清空历史';
    clr.style.cssText = 'padding:5px 14px;border-radius:5px;cursor:pointer;border:1px solid var(--red);background:transparent;color:var(--red);font-size:11px;font-family:inherit;';
    clr.onclick = async () => {
      if (await uiConfirm('确定清空所有润色记录？', { danger: true, okText: '清空' })) {
        aiHistory = [];
        saveAiHistory();
        ov.remove();
        showToast('🗑️ 已清空历史', 'success');
      }
    };
    ft.appendChild(clr);
    pn.appendChild(ft);
  }
  ov.appendChild(pn);
  document.body.appendChild(ov);
}

// ============================================================
// SECTION 12: AI Polish
// ============================================================

async function aiPolish() {
  if (!aiSettings || !aiSettings.baseUrl || !aiSettings.model) {
    showToast('⚠️ 请先配置 AI 设置（⚙️ 设置）', 'error');
    return;
  }
  const cn = document.getElementById('promptArea').value.trim();
  const en = document.getElementById('promptEnArea').value.trim();
  const lang = aiSettings.polishLang || 'both';
  if (lang === 'cn' && !cn) { showToast('⚠️ 中文提示词为空', 'error'); return; }
  if (lang === 'en' && !en) { showToast('⚠️ 英文提示词为空', 'error'); return; }
  if (!cn && !en) { showToast('⚠️ 提示词为空', 'error'); return; }

  const btn = document.getElementById('aiPolishBtn');
  const orig = btn.dataset.label || 'AI 润色';
  btn.dataset.label = orig;
  btn.innerHTML = '⏳ AI 润色中...';
  btn.disabled = true;

  try {
    const msgs = [];
    if (aiPreset && aiPreset.preset) {
      msgs.push({ role: 'system', content: aiPreset.preset });
    }
    let userContent = '';
    if (lang === 'cn') {
      userContent = '请优化以下中文提示词，使其更细腻、富有画面感：\n\n' + cn;
    } else if (lang === 'en') {
      userContent = 'Please polish and expand the following English prompt to be more detailed and vivid:\n\n' + en;
    } else {
      userContent = '请优化以下提示词，保留中英文对照：\n\n中文：' + cn;
      if (en) userContent += '\n\nEnglish: ' + en;
      // 必须声明输出格式，否则下方按「## 中文翻译 / ## 优化后英文提示词」解析几乎必然失败，
      // 失败时整段回复（含中英混杂）会被直接塞进中文框。
      userContent += '\n\n请严格按以下格式输出，不要添加任何其他内容：\n' +
        '## 中文翻译\n<润色后的中文提示词>\n\n## 优化后英文提示词\n<polished English prompt>';
    }
    msgs.push({ role: 'user', content: userContent });

    const url = aiSettings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const h = { 'Content-Type': 'application/json' };
    if (aiSettings.apiKey) h['Authorization'] = 'Bearer ' + aiSettings.apiKey;

    const r = await fetch(url, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ model: aiSettings.model, messages: msgs, max_tokens: 2048, temperature: 0.7 })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 200) : '')); }
    const d = await r.json();
    if (d.error) { const e = typeof d.error === 'string' ? d.error : JSON.stringify(d.error).slice(0, 300); throw new Error('API 错误: ' + e); }
    let reply = '';
    if (d.choices && d.choices.length > 0) {
      const c = d.choices[0];
      if (c.message && (c.message.content != null || c.message.reasoning_content != null)) {
        reply = c.message.content || '';
        if (!reply && typeof c.message.reasoning_content === 'string' && c.message.reasoning_content) reply = c.message.reasoning_content;
      } else if (c.message && c.message.refusal) {
        reply = '[AI 拒绝回答] ' + c.message.refusal;
      } else if (c.text != null) {
        reply = c.text;
      }
    }
    if (!reply && d.response) reply = d.response;
    if (!reply) { const snippet = JSON.stringify(d).slice(0, 400); throw new Error('AI 返回内容为空，响应:' + snippet); }

    if (lang === 'cn') {
      document.getElementById('promptArea').value = reply;
    } else if (lang === 'en') {
      document.getElementById('promptEnArea').value = reply;
    } else {
      const cnM = reply.match(/## 中文翻译\n*([\s\S]*?)(?:\n##|$)/);
      const enM = reply.match(/## 优化后英文提示词\n*([\s\S]*?)(?:\n##|$)/);
      let polCn = cnM ? cnM[1].trim() : '', polEn = enM ? enM[1].trim() : '';
      if (polCn) document.getElementById('promptArea').value = polCn;
      if (polEn) document.getElementById('promptEnArea').value = polEn;
      if (!polCn && !polEn) document.getElementById('promptArea').value = reply;
    }
    _enManual = false;
    const _es = document.getElementById('enState');
    if (_es) _es.textContent = 'AI 润色结果 · 可继续编辑';
    markEnStale(false);
    refreshChipHighlights();
    showToast('✅ AI 润色完成', 'success');
  } catch (e) {
    showToast('❌ AI 润色失败: ' + e.message, 'error');
  } finally {
    btn.innerHTML = '<svg class="icon"><use href="#icon-robot"/></svg><span class="btn-label">' + orig + '</span>';
    btn.disabled = false;
  }
}

// ============================================================
// SECTION 13: ComfyUI Integration
// ============================================================

let comfySettings = null, comfyWorkflows = [], comfyConnected = false;
let comfyStopped = false, comfyQueueRunning = false;

function defaultComfySettings() {
  return {
    url: 'http://127.0.0.1:8188', language: 'en', randomCount: 1, batchCount: 1,
    selectedWorkflow: -1, width: 512, height: 512, useProxy: false,
    autoShutdown: false, shutdownMinutes: 5,
    seed: Math.floor(Math.random() * 2147483647) + 1, seedLock: false
  };
}

function loadComfySettings() {
  comfySettings = Object.assign(defaultComfySettings(), storage.get('comfy_settings') || {});
  if (!comfySettings.seed) comfySettings.seed = Math.floor(Math.random() * 2147483647) + 1;
}

function saveComfySettings() {
  storage.set('comfy_settings', comfySettings);
  syncAllToServer();
}

function loadShutdownUI() {
  const tog = document.getElementById('shutdownToggle');
  const min = document.getElementById('shutdownMinutes');
  if (tog) tog.checked = comfySettings.autoShutdown;
  if (min) min.value = comfySettings.shutdownMinutes;
}

// 开启自动关机属于不可逆操作，先二次确认（关机命令一旦发出只能靠 shutdown /a 取消）
async function saveShutdownSettings() {
  const tog = document.getElementById('shutdownToggle');
  const min = document.getElementById('shutdownMinutes');
  if (tog && tog.checked && !comfySettings.autoShutdown) {
    const mins = parseInt(min && min.value) || 5;
    const ok = await uiConfirm(`开启后，本次生图全部完成 ${mins} 分钟将自动关闭电脑。确认开启？`, { danger: true, okText: '开启' });
    if (!ok) { tog.checked = false; return; }
  }
  if (tog) comfySettings.autoShutdown = tog.checked;
  if (min) comfySettings.shutdownMinutes = parseInt(min.value) || 5;
  saveComfySettings();
}

function triggerShutdown(seconds) {
  const origin = window.location.origin;
  if (origin && origin.startsWith('http')) {
    fetch(origin + '/api/shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds })
    })
    .then(r => r.json())
    .then(d => showToast(`🛑 将在 ${d.seconds} 秒后关机`, 'success'))
    .catch(e => showToast('⚠️ 关机请求失败: ' + e.message, 'error'));
  } else {
    showToast('⚠️ 需要 HTTP 服务才支持关机', 'error');
  }
}

function loadComfyWorkflows() {
  comfyWorkflows = storage.get('comfy_workflows') || [];
}

function saveComfyWorkflows() {
  storage.set('comfy_workflows', comfyWorkflows);
  syncAllToServer();
}

function updateComfyStatus() {
  const el = document.getElementById('comfyStatus');
  if (!el) return;
  el.innerHTML = `<span class="dot ${comfyConnected ? 'green' : 'red'}"></span>${comfyConnected ? 'ComfyUI 已连接' : 'ComfyUI 未连接'}`;
  el.className = comfyConnected ? 'ai-indicator on' : 'ai-indicator off';
  const qs = document.getElementById('comfyQueueState');
  if (qs && !comfyQueueRunning) {
    setQueueStatus(comfyConnected ? 'ready' : 'disconnected');
  }
}

function setQueueStatus(state) {
  const qs = document.getElementById('comfyQueueState');
  if (!qs) return;
  const map = {
    ready: ['green', '就绪'],
    running: ['yellow', '生成中'],
    error: ['red', '出错'],
    stopped: ['amber', '已中止'],
    disconnected: ['red', '未连接']
  };
  const [cls, text] = map[state] || map.ready;
  qs.innerHTML = `<span class="dot ${cls}"></span>${text}`;
}

function getComfyBaseUrl() {
  const origin = window.location.origin;
  const onHttp = origin && origin.startsWith('http');
  if (onHttp && comfySettings.useProxy) return origin + '/comfy-proxy';
  return comfySettings.url.replace(/\/+$/, '');
}

// attempt 计数：proxy↔direct 各只自动切换一次。
// 旧实现没有上限，两端都连不上时会无限递归（每轮 await 保留父帧，栈持续增长），
// 且每轮 saveComfySettings() → 600ms 防抖后全量写 comfy_settings.json（含工作流，上限 5MB），
// 等于每 ~6 秒写一次盘。
async function checkComfyConnection(attempt) {
  attempt = attempt || 0;
  try {
    const url = getComfyBaseUrl() + '/system_stats';
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    comfyConnected = r.ok;
    if (!comfyConnected) showToast('⚠️ ComfyUI 响应异常（状态码:' + r.status + '）', 'error');
    updateComfyStatus();
    return comfyConnected;
  } catch (e) {
    if (attempt === 0 && comfySettings.useProxy) {
      // 代理失败 → 试一次直连；成功才落盘，失败则结束（不再递归）
      comfySettings.useProxy = false;
      try {
        const url = comfySettings.url.replace(/\/+$/, '') + '/system_stats';
        const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
        comfyConnected = r.ok;
        updateComfyStatus();
        if (comfyConnected) {
          saveComfySettings();
          showToast('⚠️ 代理不可用，已切换到直连', 'error');
          return true;
        }
      } catch (e2) {
        console.warn('[checkComfyConnection] Direct connection failed:', e2.message);
      }
      // 两端都失败：恢复用户的代理设置，本次到此为止
      comfySettings.useProxy = true;
      comfyConnected = false;
      updateComfyStatus();
      showToast('⚠️ ComfyUI 未连接（代理与直连均失败）', 'error');
      return false;
    }
    const origin = window.location.origin;
    if (attempt === 0 && origin && origin.startsWith('http') && !comfySettings.useProxy) {
      // 直连失败 → 试一次代理
      comfySettings.useProxy = true;
      saveComfySettings();
      return await checkComfyConnection(1);
    }
    comfyConnected = false;
    updateComfyStatus();
    const msg = e.message || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('net::ERR')) {
      showToast('⚠️ 浏览器跨域限制: 请关闭后通过 start_server.bat 启动服务来打开页面', 'error');
    } else if (msg) {
      showToast('⚠️ 连接失败: ' + msg.slice(0, 100), 'error');
    }
    return false;
  }
}

// Workflow
function handleWorkflowUpload(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = function (ev) {
    try {
      const d = JSON.parse(ev.target.result);
      comfyWorkflows.push({ name: f.name, data: d });
      saveComfyWorkflows();
      showToast('✅ 工作流「' + f.name + '」已上传', 'success');
      if (comfySettings.selectedWorkflow < 0) {
        comfySettings.selectedWorkflow = comfyWorkflows.length - 1;
        saveComfySettings();
      }
      updateRightPanel();
      const cm = document.getElementById('comfyModal');
      if (cm) openComfySettings();
    } catch (err) {
      showToast('⚠️ 无效的工作流 JSON', 'error');
    }
  };
  r.readAsText(f);
  e.target.value = '';
}

async function deleteComfyWorkflow(idx) {
  if (!await uiConfirm('删除工作流「' + comfyWorkflows[idx].name + '」？', { danger: true, okText: '删除' })) return;
  comfyWorkflows.splice(idx, 1);
  if (comfySettings.selectedWorkflow === idx) comfySettings.selectedWorkflow = -1;
  else if (comfySettings.selectedWorkflow > idx) comfySettings.selectedWorkflow--;
  saveComfyWorkflows();
  saveComfySettings();
  updateRightPanel();
}

function selectComfyWorkflow(idx) {
  comfySettings.selectedWorkflow = idx;
  saveComfySettings();
  autoDetectSize();
}

function _latentSizeFromWorkflow(wf) {
  let w = 0, h = 0;
  if (!wf || typeof wf !== 'object') return { w, h };
  if (Array.isArray(wf.nodes)) {
    for (const n of wf.nodes) {
      if (n && n.type && String(n.type).includes('LatentImage') && n.widgets_values && n.widgets_values.length >= 2) {
        w = parseInt(n.widgets_values[0], 10) || 0;
        h = parseInt(n.widgets_values[1], 10) || 0;
        break;
      }
    }
  } else {
    const data = wf.prompt || wf;
    for (const n of Object.values(data)) {
      if (n && n.class_type && String(n.class_type).includes('LatentImage') && n.inputs) {
        w = parseInt(n.inputs.width, 10) || 0;
        h = parseInt(n.inputs.height, 10) || 0;
        break;
      }
    }
  }
  return { w, h };
}

function autoDetectSize() {
  if (comfySettings.selectedWorkflow < 0 || comfySettings.selectedWorkflow >= comfyWorkflows.length) return;
  const wf = comfyWorkflows[comfySettings.selectedWorkflow].data;
  const { w, h } = _latentSizeFromWorkflow(wf);
  if (w && h) {
    comfySettings.width = w;
    comfySettings.height = h;
    saveComfySettings();
    const we = document.getElementById('comfyWidth'), he = document.getElementById('comfyHeight');
    if (we) we.value = comfySettings.width;
    if (he) he.value = comfySettings.height;
    updateRightPanel();
  }
}

function findPromptNodes(wf) {
  if (!wf || typeof wf !== 'object') return [];
  if (Array.isArray(wf.nodes)) return wf.nodes.filter(n => n && (n.type === 'CLIPTextEncode' || n.class_type === 'CLIPTextEncode'));
  const data = wf.prompt || wf;
  if (typeof data === 'object' && !Array.isArray(data)) {
    return Object.values(data).filter(n => n && typeof n === 'object' && n.class_type === 'CLIPTextEncode');
  }
  return [];
}

function workflowToPrompt(wf, text, width, height, seed) {
  if (Array.isArray(wf.nodes)) return _convertNodesFormat(wf, text, width, height, seed);
  const data = wf.prompt || wf;
  if (typeof data === 'object' && !Array.isArray(data)) return _convertApiFormat(data, text, width, height, seed);
  return {};
}

function _convertNodesFormat(wf, text, width, height, seed) {
  const prompt = {}, linkMap = {};
  (wf.links || []).forEach(l => { linkMap[l[0]] = { from: l[1], fromSlot: l[2], to: l[3], toSlot: l[4] }; });
  (wf.nodes || []).forEach(n => {
    if (!n) return;
    const inputs = {}, inputList = n.inputs || [], widgets = n.widgets_values || [];
    let wi = 0;
    inputList.forEach(inp => {
      if (!inp) return;
      const inName = inp.name || inp[0] || '';
      if (!inName) return;
      if (inp.link != null) {
        if (typeof inp.link === 'number' && linkMap[inp.link]) {
          inputs[inName] = [linkMap[inp.link].from, linkMap[inp.link].fromSlot];
        } else if (Array.isArray(inp.link) && inp.link.length >= 2) {
          inputs[inName] = [inp.link[0], inp.link[1]];
        }
        if (inp.widget) wi++;
      } else if (inp.widget || inp.name) {
        if (wi < widgets.length) { inputs[inName] = widgets[wi]; wi++; }
      } else if (Array.isArray(inp) && inp.length >= 2) {
        const n2 = inp[0], v2 = inp[1];
        if (typeof v2 === 'number' || typeof v2 === 'string') { inputs[n2] = v2; }
      }
    });
    if (n.type === 'CLIPTextEncode' && widgets.length > 0 && !inputs.text) inputs.text = text;
    if (n.type && String(n.type).includes('LatentImage')) { if (width) inputs.width = width; if (height) inputs.height = height; }
    if ('seed' in inputs) inputs.seed = seed !== undefined ? seed : Math.floor(Math.random() * 2147483647);
    if ('noise_seed' in inputs) inputs.noise_seed = seed !== undefined ? seed : Math.floor(Math.random() * 2147483647);
    prompt[n.id] = { class_type: n.type, inputs };
  });
  return prompt;
}

function _convertApiFormat(data, text, width, height, seed) {
  const prompt = {};
  Object.entries(data || {}).forEach(([nid, n]) => {
    if (!n || typeof n !== 'object') return;
    const inputs = JSON.parse(JSON.stringify(n.inputs || {}));
    if (n.class_type === 'CLIPTextEncode' && 'text' in inputs) inputs.text = text;
    if (n.class_type && String(n.class_type).includes('LatentImage')) { if (width) inputs.width = width; if (height) inputs.height = height; }
    if ('seed' in inputs) inputs.seed = seed !== undefined ? seed : Math.floor(Math.random() * 2147483647);
    if ('noise_seed' in inputs) inputs.noise_seed = seed !== undefined ? seed : Math.floor(Math.random() * 2147483647);
    prompt[nid] = { class_type: n.class_type, inputs };
  });
  return prompt;
}

async function sendToComfy(promptData) {
  const url = getComfyBaseUrl() + '/prompt';
  const body = { prompt: promptData, client_id: crypto.randomUUID() };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 200) : '')); }
  return r.json();
}

// ============================================================
// SECTION 14: ComfyUI Gallery
// ============================================================

let comfyGallery = [];

function loadComfyGallery() {
  comfyGallery = storage.get('comfy_gallery') || [];
}

function saveComfyGallery() {
  storage.set('comfy_gallery', comfyGallery);
  syncAllToServer();
}

// —— 画廊瀑布流布局 ——
// 不用 CSS column-count：等高图片时 Chromium 的多列平衡会算错，只填前几列、末尾留空列。
// 改为 JS 分列：按「已累计高度」把每张放进当前最矮的列，保证每列都被填满。
const GALLERY_COLS = 4;
const GALLERY_GAP = 12;
const _galleryAspect = {};        // url -> 高/宽，图片加载后缓存
let _galleryLastSig = '';         // 上次渲染的分列签名，用于跳过无变化的全量重建
let _galleryRelayoutTimer = null;
let _galleryRelayoutPending = false;

function _galleryAspectOf(item) {
  const a = _galleryAspect[item && item.url];
  return (typeof a === 'number' && a > 0) ? a : 1;   // 未知时按正方形估算
}

// 图片加载完成后记录真实宽高比，必要时重排一次（收敛，不会死循环）
function galleryImgLoaded(img) {
  if (!img || !img.naturalWidth) return;
  const url = img.getAttribute('src');
  if (!url) return;
  const a = img.naturalHeight / img.naturalWidth;
  const prev = _galleryAspect[url];
  if (typeof prev === 'number' && Math.abs(prev - a) < 0.01) return;
  _galleryAspect[url] = a;
  _galleryRelayoutPending = true;
  clearTimeout(_galleryRelayoutTimer);
  _galleryRelayoutTimer = setTimeout(() => {
    _galleryRelayoutTimer = null;
    if (!_galleryRelayoutPending) return;
    _galleryRelayoutPending = false;
    renderComfyGallery();
  }, 150);
}

function _galleryColsForWidth() {
  const w = window.innerWidth || 1200;
  return w <= 620 ? 2 : (w <= 900 ? 3 : GALLERY_COLS);
}

// 占位图跟随主题：浅色主题下不再出现突兀的深灰块
function _brokenPlaceholder() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bg = dark ? '#3a3a3a' : '#e8eaed';
  const fg = dark ? '#888888' : '#9aa0a6';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="50%" fill="${fg}" font-size="14" text-anchor="middle" dominant-baseline="middle">图片已失效</text>` +
    '</svg>');
}

function galleryImgError(img) {
  if (!img) return;
  img.onerror = null;
  img.src = _brokenPlaceholder();
  img.style.objectFit = 'cover';
}

function _galleryItemHTML(item, idx) {
  const hasBadge = item.badge !== undefined && item.badge !== null && String(item.badge) !== '';
  // 已知宽高比时用 aspect-ratio 占位，减少图片加载/重排时的跳动
  const a = _galleryAspect[item.url];
  const arStyle = (typeof a === 'number' && a > 0) ? ` style="aspect-ratio:${(1 / a).toFixed(4)}"` : '';
  return `<div class="gallery-item" onclick="openGalleryModal(${idx})">
    <img src="${escapeHtml(item.url)}" alt="gallery" loading="lazy"${arStyle} onload="galleryImgLoaded(this)" onerror="galleryImgError(this)">
    <div class="gallery-bar" onclick="event.stopPropagation()">
      ${hasBadge ? `<span class="gallery-idx">#${escapeHtml(String(item.badge))}</span>` : ''}
      <button class="gallery-btn" onclick="downloadGalleryImg(${idx})" title="下载原图">
        <svg class="icon"><use href="#icon-download"/></svg>
      </button>
      <button class="gallery-btn g-btn-del" onclick="deleteGalleryItem(${idx})" title="删除">
        <svg class="icon"><use href="#icon-trash"/></svg>
      </button>
    </div>
  </div>`;
}

function renderComfyGallery() {
  const grid = document.getElementById('galleryGrid');
  const empty = document.getElementById('galleryEmpty');
  const count = document.getElementById('galleryCount');
  if (!grid) return;
  if (count) count.textContent = comfyGallery.length + ' 张';
  if (comfyGallery.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  grid.style.display = '';
  if (empty) empty.style.display = 'none';

  const cols = _galleryColsForWidth();
  const gridW = grid.clientWidth || 1040;
  const colW = Math.max(80, (gridW - GALLERY_GAP * (cols - 1)) / cols);

  // 贪心分列：每张放进当前累计高度最小的列
  const buckets = [];
  for (let i = 0; i < cols; i++) buckets.push({ h: 0, idxs: [] });
  comfyGallery.forEach((item, idx) => {
    let t = 0;
    for (let i = 1; i < buckets.length; i++) if (buckets[i].h < buckets[t].h) t = i;
    buckets[t].idxs.push(idx);
    buckets[t].h += _galleryAspectOf(item) * colW + GALLERY_GAP;
  });

  // 分列结果没变就跳过重建：否则每张图 onload 都会 innerHTML 重建整个画廊，
  // 200 张时造成反复闪烁和滚动位置跳动（O(n²) 的 DOM 重建）
  const sig = cols + '|' + buckets.map(b => b.idxs.join(',')).join('|');
  if (sig === _galleryLastSig && grid.children.length) return;
  _galleryLastSig = sig;

  // 空列容器也保留：否则图少于列数时，仅存的列会被 flex 拉伸到整宽
  grid.innerHTML = buckets
    .map(b => `<div class="gallery-col">${b.idxs.map(i => _galleryItemHTML(comfyGallery[i], i)).join('')}</div>`)
    .join('');
}

// 窗口尺寸变化时列数可能改变，重排一次
if (typeof window !== 'undefined' && !window.__pgGalleryResizeBound) {
  window.__pgGalleryResizeBound = true;
  window.addEventListener('resize', () => {
    if (_galleryRelayoutTimer) return;
    _galleryRelayoutTimer = setTimeout(() => { _galleryRelayoutTimer = null; renderComfyGallery(); }, 220);
  });
}

let _galleryCapToastAt = 0;
function addToComfyGallery(imgUrl, badge, prompt, seed, extra) {
  const item = { url: imgUrl, badge: String(badge || ''), ts: Date.now(), prompt: prompt || '', seed: seed || '' };
  if (extra && typeof extra === 'object') Object.assign(item, extra);
  comfyGallery.unshift(item);
  if (comfyGallery.length > 200) {
    comfyGallery = comfyGallery.slice(0, 200);
    // 上限静默丢弃用户无感知，提示一次（批量生图时节流 30s，避免刷屏）
    if (Date.now() - _galleryCapToastAt > 30000) {
      _galleryCapToastAt = Date.now();
      showToast('⚠️ 画廊已达 200 张上限，最旧的图片已被移除', 'error');
    }
  }
  saveComfyGallery();
  renderComfyGallery();
}

async function clearComfyGallery() {
  if (!await uiConfirm('确定清空所有图片？', { danger: true, okText: '清空' })) return;
  const snapshot = comfyGallery.slice();
  comfyGallery = [];
  saveComfyGallery();
  renderComfyGallery();
  pushUndo(`清空画廊（${snapshot.length} 张）`, () => {
    comfyGallery = snapshot;
    saveComfyGallery();
    renderComfyGallery();
  });
  showToast('🗑️ 画廊已清空', 'success', { label: '撤销', onClick: undoLast });
}

let _currentModalIdx = -1;
let _imgModalKeyHandler = null;

function openGalleryModal(idx) {
  const item = comfyGallery[idx];
  if (!item) return;
  _currentModalIdx = idx;
  const modal = document.getElementById('imgModal');
  const img = document.getElementById('imgModalImg');
  if (!modal || !img) return;
  img.src = item.url;

  const total = comfyGallery.length;
  const badge = (item.badge !== undefined && item.badge !== null && String(item.badge) !== '')
    ? String(item.badge) : String(idx + 1).padStart(2, '0');
  _setText('imgModalBadge', '#' + badge);
  _setText('imgModalTag', '生成');
  _setText('imgModalSub', `生图画廊 · 第 ${idx + 1} / ${total} 张`);
  _setText('imgModalStageBadge', '#' + badge + ' · 原图');

  const _cjk = /[\u4e00-\u9fa5]/;
  const raw = item.prompt || '';
  const cn = item.promptCn || (_cjk.test(raw) ? raw : '');
  const en = item.promptEn || (!_cjk.test(raw) ? raw : '');
  _setText('imiPromptCn', cn || '（无中文记录）');
  _setText('imiPromptEn', en || '（无英文记录）');
  _setText('imiSource', item.source || 'ComfyUI 输出');
  _setText('imiSeedText', item.seed || '—');

  const setSize = () => {
    const w = img.naturalWidth || item.width || 0;
    const h = img.naturalHeight || item.height || 0;
    if (!w || !h) return;
    _setText('imiSizeText', w + ' × ' + h);
    _setText('imiSizeOverlay', '原图 ' + w + ' × ' + h);
  };
  if (img.complete && img.naturalWidth) setSize();
  img.onload = setSize;
  img.onerror = () => {
    _setText('imiSizeText', '—');
    _setText('imiSizeOverlay', '图片加载失败');
  };

  const wfName = item.workflow || (comfyWorkflows[comfySettings.selectedWorkflow] && comfyWorkflows[comfySettings.selectedWorkflow].name) || '—';
  _setText('imiWorkflowText', wfName);
  _setText('imiDurationText', item.duration ? Number(item.duration).toFixed(1) + ' s' : '—');
  _setText('imiTimeText', item.ts ? new Date(item.ts).toLocaleString('zh-CN') : '—');
  _setText('imiBatchText', (item.group && item.batch) ? `第 ${item.group} 组 · 第 ${item.batch} 张` : '#' + badge);

  let meta = item.meta;
  if (!meta && comfyWorkflows[comfySettings.selectedWorkflow]) {
    try { meta = _workflowMeta(comfyWorkflows[comfySettings.selectedWorkflow].data); } catch (e) { meta = null; }
  }
  meta = meta || {};
  _setText('imiSamplerText', meta.sampler || '—');
  _setText('imiStepsText', (meta.steps || meta.cfg) ? `${meta.steps || '—'} / ${meta.cfg || '—'}` : '—');
  _setText('imiModelText', meta.model || '—');

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // 键盘支持：Esc 关闭，←/→ 在同一会话的画廊里翻页（其他对话框都有 Esc，这里原先没有）
  if (_imgModalKeyHandler) document.removeEventListener('keydown', _imgModalKeyHandler, true);
  _imgModalKeyHandler = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeImgModal(); }
    else if (e.key === 'ArrowLeft' && comfyGallery.length > 1) {
      openGalleryModal((_currentModalIdx + 1) % comfyGallery.length);
    } else if (e.key === 'ArrowRight' && comfyGallery.length > 1) {
      openGalleryModal((_currentModalIdx - 1 + comfyGallery.length) % comfyGallery.length);
    }
  };
  document.addEventListener('keydown', _imgModalKeyHandler, true);
}

function copyModalPrompt() {
  const item = comfyGallery[_currentModalIdx];
  const text = item ? (item.promptCn || item.prompt || '') : '';
  if (!text) { showToast('⚠️ 没有可复制的提示词', 'error'); return; }
  navigator.clipboard.writeText(text).then(
    () => showToast('✅ 提示词已复制', 'success'),
    () => showToast('⚠️ 复制失败', 'error')
  );
}


function closeImgModal() {
  const modal = document.getElementById('imgModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.getElementById('imgModalImg').src = '';
  _currentModalIdx = -1;
  document.body.style.overflow = '';
  if (_imgModalKeyHandler) {
    document.removeEventListener('keydown', _imgModalKeyHandler, true);
    _imgModalKeyHandler = null;
  }
}

function downloadCurrentModalImg() {
  const item = comfyGallery[_currentModalIdx];
  if (!item || !item.url) return;
  const a = document.createElement('a');
  a.href = item.url;
  a.download = 'comfy_ui_' + (item.seed || Date.now()) + '.png';
  a.click();
}

function deleteCurrentModalImg() {
  if (_currentModalIdx < 0) return;
  deleteGalleryItem(_currentModalIdx);
  closeImgModal();
}

async function deleteGalleryItem(idx) {
  if (idx < 0 || idx >= comfyGallery.length) return;
  if (!await uiConfirm('确定删除这张图片？', { danger: true, okText: '删除' })) return;
  comfyGallery.splice(idx, 1);
  saveComfyGallery();
  renderComfyGallery();
  showToast('🗑️ 图片已删除', 'success');
}

function downloadGalleryImg(idx) {
  const item = comfyGallery[idx];
  if (!item || !item.url) return;
  const a = document.createElement('a');
  a.href = item.url;
  a.download = 'comfy_ui_' + (item.seed || Date.now()) + '.png';
  a.click();
}

// ============================================================
// SECTION 15: ComfyUI Queue & Progress
// ============================================================

function _updateProgress(status, current, total, elapsed) {
  const wrap = document.getElementById('comfyProgressWrap');
  if (!wrap) return;
  const fill = document.getElementById('comfyProgressFill');
  const info = document.getElementById('comfyProgressInfo');
  if (!total || total <= 0) {
    if (fill) fill.style.width = '0%';
  } else {
    if (fill) fill.style.width = Math.min(100, Math.round((current / total) * 100)) + '%';
  }
  if (info) {
    const es = elapsed > 0 ? _fmtTime(elapsed) : '--:--';
    info.innerHTML = `<span>${current}/${total}</span><span>⏱ ${es}</span><span class="pp-status">${status}</span>`;
  }
  wrap.style.display = 'block';
}

function _hideProgress() {
  const fill = document.getElementById('comfyProgressFill');
  const info = document.getElementById('comfyProgressInfo');
  if (fill) fill.style.width = '0%';
  if (info) info.innerHTML = '<span>0/0</span><span>⏱ --:--</span><span class="pp-status">等待中</span>';
}

function _fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _workflowMeta(wf) {
  const out = { sampler: '', steps: '', cfg: '', model: '' };
  if (!wf || typeof wf !== 'object') return out;
  try {
    if (Array.isArray(wf.nodes)) {
      wf.nodes.forEach(n => {
        if (!n) return;
        const type = n.type || n.class_type || '';
        const w = n.widgets_values || [];
        if (type === 'KSampler' || type === 'KSamplerAdvanced') {
          if (w[2] != null) out.steps = w[2];
          if (w[3] != null) out.cfg = w[3];
          if (w[4]) out.sampler = w[4];
        }
        if (type === 'CheckpointLoaderSimple' && w[0]) out.model = w[0];
        if (type === 'UNETLoader' && w[0]) out.model = w[0];
      });
    } else {
      const data = wf.prompt || wf;
      Object.values(data).forEach(n => {
        if (!n || !n.class_type) return;
        const inp = n.inputs || {};
        if (n.class_type === 'KSampler' || n.class_type === 'KSamplerAdvanced') {
          if (inp.sampler_name) out.sampler = inp.sampler_name;
          if (inp.steps != null) out.steps = inp.steps;
          if (inp.cfg != null) out.cfg = inp.cfg;
        }
        if (n.class_type === 'CheckpointLoaderSimple' && inp.ckpt_name) out.model = inp.ckpt_name;
        if (n.class_type === 'UNETLoader' && inp.unet_name) out.model = inp.unet_name;
      });
    }
  } catch (e) { /* 忽略解析失败 */ }
  return out;
}

function _getWorkflowSteps(wf) {
  if (Array.isArray(wf.nodes)) {
    for (const n of wf.nodes) {
      if ((n.type === 'KSampler' || n.type === 'KSamplerAdvanced') && n.widgets_values) {
        const si = n.widgets_values.length >= 2 ? 1 : 0;
        return parseInt(n.widgets_values[si]) || 20;
      }
    }
  }
  const data = wf.prompt || wf;
  if (typeof data === 'object' && !Array.isArray(data)) {
    for (const n of Object.values(data)) {
      if (n && n.class_type && (n.class_type === 'KSampler' || n.class_type === 'KSamplerAdvanced') && n.inputs) {
        return parseInt(n.inputs.steps) || 20;
      }
    }
  }
  return 20;
}

// ComfyUI API 前缀自适应：标准路由是 /history、/view（无 /api 前缀），
// 个别整合包/反代可能挂在 /api 下。默认无前缀，遇到 404 自动切换并记住。
let _comfyApiPrefix = '';

async function _pollComfyUI(pid, steps) {
  const startTime = Date.now();
  for (let i = 1; i <= 300; i++) {
    if (comfyStopped) { const e = new Error('已中止'); e.stopped = true; throw e; }
    await new Promise(r => setTimeout(r, 1000));
    if (comfyStopped) { const e = new Error('已中止'); e.stopped = true; throw e; }
    const elapsed = (Date.now() - startTime) / 1000;
    const url = getComfyBaseUrl() + _comfyApiPrefix + '/history/' + pid;
    try {
      const r = await fetch(url);
      // 前缀探测：标准路径 404 时，切到 /api 前缀重试（仅前几次尝试时切换）
      if (r.status === 404 && _comfyApiPrefix === '' && i <= 3) {
        _comfyApiPrefix = '/api';
        continue;
      }
      if (r.ok) {
        const d = await r.json();
        if (d[pid]) {
          const s = d[pid].status;
          if (s && s.completed) return d[pid];
          if (s && s.error) throw new Error(s.error_message || 'ComfyUI 生图失败');
          const estSteps = Math.min(steps, Math.max(1, Math.floor(elapsed / 0.8)));
          _updateProgress(`🎨 生成中... ${estSteps}/${steps}步`, i, Math.max(steps * 2, 20), elapsed);
        }
      }
    } catch (e) {
      if (e && e.stopped) throw e;
      if (i < 5) continue;
      throw e;
    }
  }
  throw new Error('ComfyUI 生图超时');
}

function _extractImages(historyData) {
  const images = [];
  const outputs = historyData.outputs;
  if (!outputs) return images;
  const baseUrl = getComfyBaseUrl();
  for (const nodeId of Object.keys(outputs)) {
    const node = outputs[nodeId];
    if (node.images && Array.isArray(node.images)) {
      for (const img of node.images) {
        if (img.filename) {
          images.push(baseUrl + _comfyApiPrefix + '/view?filename=' + encodeURIComponent(img.filename) +
            '&subfolder=' + encodeURIComponent(img.subfolder || '') +
            '&type=' + encodeURIComponent(img.type || 'output'));
        }
      }
    }
  }
  return images;
}

async function _prepareOnePrompt(idx, startTime, completed, total, wf) {
  const cnArea = document.getElementById('promptArea');
  const enArea = document.getElementById('promptEnArea');
  const useAi = document.getElementById('aiToggle') && document.getElementById('aiToggle').checked;
  if (comfyStopped) return { cn: '', en: '' };
  try {
    rollIdentity();   // 本组提示词抽一次身份，中英文共用
    let promptText = '';
    // 与 randomPrompt 共用同一套抽取逻辑（概率/去重/兜底）
    const picks = rollPicks().picks;
    if (picks.length > 0) {
      if (comfySettings.language === 'en') {
        promptText = picks.map(p => p.en.split('/')[0].trim()).filter(Boolean).join(', ');
      } else {
        promptText = [getIdentityPrefix()].concat(picks.map(p => p.cn)).filter(Boolean).join('，');
      }
    }
    if (!promptText) {
      promptText = comfySettings.language === 'en'
        ? (enArea.value.trim() || cnArea.value.trim())
        : cnArea.value.trim();
      if (!promptText) { showToast('⚠️ 提示词为空', 'error'); return { cn: '', en: '' }; }
    }
    if (comfySettings.language === 'en') {
      // 修复：英文模式只把英文写进英文框，中文框填同一组词条的中文对照
      // （原来两个框都写英文，optimizePrompt 按中文模板处理后会变成中英混杂）
      enArea.value = promptText;
      if (picks.length) {
        cnArea.value = [getIdentityPrefix()].concat(picks.map(p => p.cn)).filter(Boolean).join('，');
      }
      // picks 为空（手填英文提示词）时保留中文框原内容，不覆盖
    } else {
      cnArea.value = promptText;
      // Reuse the same picks that generated promptText for consistent CN->EN mapping
      if (picks.length) {
        const enParts = picks.map(p => p.en.split('/')[0].trim());
        enArea.value = [getIdentityEn()].concat(enParts).filter(Boolean).join(', ');
      } else {
        enArea.value = promptText;
      }
    }
    resizePromptAreas();
    _updateProgress(`✨ 优化中... (${idx + 1}/${comfySettings.randomCount}组)`, completed, total, (Date.now() - startTime) / 1000);
    optimizePrompt();
    await new Promise(r => setTimeout(r, 50));
    if (useAi && aiSettings && aiSettings.baseUrl) {
      _updateProgress(`🤖 AI 润色中... (${idx + 1}/${comfySettings.randomCount}组)`, completed, total, (Date.now() - startTime) / 1000);
      await aiPolish();
      await new Promise(r => setTimeout(r, 100));
    }
    const cnFinal = cnArea.value.trim();
    const enFinal = enArea.value.trim();
    markEnStale(false);
    // 修复：原写法在 language==='en' 时会把 en 恒置为 ''，
    // 导致下游取 currentPrompt.en 得到空串，被误判为“提示词为空”而跳过。
    return { cn: cnFinal || enFinal, en: enFinal || cnFinal, rawCn: cnFinal, rawEn: enFinal };
  } catch (e) {
    console.warn('[_prepareOnePrompt] Error:', e.message);
    return { cn: '', en: '' };
  }
}

async function startComfyGeneration() {
  if (comfyQueueRunning) { showToast('⚠️ 生成中，请等待当前队列完成', 'error'); return; }
  if (!comfyConnected) {
    const ok = await checkComfyConnection();
    if (!ok) { showToast('⚠️ ComfyUI 未连接', 'error'); return; }
  }
  if (comfySettings.selectedWorkflow < 0 || comfySettings.selectedWorkflow >= comfyWorkflows.length) {
    showToast('⚠️ 请先上传并选择工作流（⚙️ 设置）', 'error');
    return;
  }
  const wf = comfyWorkflows[comfySettings.selectedWorkflow].data;
  if (findPromptNodes(wf).length === 0) {
    showToast('⚠️ 工作流中未找到 CLIPTextEncode 节点', 'error');
    return;
  }
  const btn = document.getElementById('comfyStartBtn');
  const stopBtn = document.getElementById('comfyStopBtn');
  btn.disabled = true;
  setStartButton('生成中…');
  stopBtn.style.display = 'inline-flex';
  stopBtn.disabled = false;
  stopBtn.innerHTML = '<svg class="icon"><use href="#icon-stop"/></svg>中止';
  comfyStopped = false;
  comfyQueueRunning = true;
  let genFailed = false;
  const total = comfySettings.randomCount * comfySettings.batchCount;
  buildGenQueue(total);
  setQueueStatus('running');
  let completed = 0;
  const startTime = Date.now();
  const steps = _getWorkflowSteps(wf);
  let nextPrompt = null;

  try {
    _updateProgress(`⏳ 准备第1组提示词...`, 0, total, 0);
    nextPrompt = await _prepareOnePrompt(0, startTime, completed, total, wf);
    if (!nextPrompt.cn) { throw new Error('提示词准备失败'); }

    for (let p = 0; p < comfySettings.randomCount; p++) {
      if (comfyStopped) break;
      const currentPrompt = nextPrompt;
      nextPrompt = null;

      let prepPromise = null;
      if (p + 1 < comfySettings.randomCount) {
        prepPromise = _prepareOnePrompt(p + 1, startTime, completed, total, wf);
      }

      const finalPrompt = currentPrompt
        ? (comfySettings.language === 'en' ? currentPrompt.en : currentPrompt.cn)
        : '';
      if (!finalPrompt) {
        showToast('⚠️ 提示词为空，跳过', 'error');
        // 修复：先取回预取结果再 continue，否则下一轮 currentPrompt 会变成 null
        if (prepPromise) nextPrompt = await prepPromise;
        continue;
      }

      const batchResults = [];
      for (let b = 0; b < comfySettings.batchCount; b++) {
        if (comfyStopped) { completed += comfySettings.batchCount - b; break; }
        completed++;
        const elapsed = (Date.now() - startTime) / 1000;
        _updateProgress(`🚀 发送第 ${completed}/${total}`, completed, total, elapsed);
        const seed = comfySettings.seedLock
          ? (parseInt(comfySettings.seed, 10) || Math.floor(Math.random() * 2147483647) + 1)
          : Math.floor(Math.random() * 2147483647) + 1;
        if (!comfySettings.seedLock) {
          const seedInput = document.getElementById('comfySeed');
          if (seedInput) seedInput.value = seed;
        }
        queueMark(completed, 'run', seed);
        _updateProgress(`🎲 种子 ${seed} (${completed}/${total})`, completed, total, elapsed);
        const pd = workflowToPrompt(wf, finalPrompt, comfySettings.width, comfySettings.height, seed);
        let seedCount = 0;
        Object.keys(pd).forEach(nid => {
          const ni = pd[nid] && pd[nid].inputs;
          if (!ni) return;
          if ('seed' in ni) { ni.seed = seed; seedCount++; }
          if ('noise_seed' in ni) { ni.noise_seed = seed; seedCount++; }
        });
        if (!seedCount) _updateProgress(`⚠️ 未找到seed节点 (${completed}/${total})`, completed, total, elapsed);
        _updateProgress(`📤 发送中... (${completed}/${total})`, completed, total, (Date.now() - startTime) / 1000);
        const result = await sendToComfy(pd);
        batchResults.push({ result, seed, prompt: finalPrompt });
      }

      for (let b = 0; b < batchResults.length; b++) {
        if (comfyStopped) break;
        const br = batchResults[b];
        const elapsed = (Date.now() - startTime) / 1000;
        _updateProgress(`🎨 生成中... 0/${steps}步 (${completed - batchResults.length + b + 1}/${total})`, completed, total, elapsed);
        const _pollStart = Date.now();
        const historyData = await _pollComfyUI(br.result.prompt_id, steps);
        const _imgDur = (Date.now() - _pollStart) / 1000;
        const imgs = _extractImages(historyData);
        for (const imgUrl of imgs) {
          addToComfyGallery(imgUrl, completed, br.prompt, br.seed, {
            promptCn: currentPrompt ? currentPrompt.cn : '',
            promptEn: currentPrompt ? currentPrompt.en : '',
            workflow: (comfyWorkflows[comfySettings.selectedWorkflow] || {}).name || '',
            duration: _imgDur,
            width: comfySettings.width,
            height: comfySettings.height,
            group: p + 1,
            batch: b + 1,
            source: (document.getElementById('aiToggle') && document.getElementById('aiToggle').checked)
              ? '模板优化 + AI 润色' : '模板优化',
            meta: _workflowMeta(wf)
          });
        }
        queueMark(completed - batchResults.length + b + 1, 'done', br.seed);
      }
      _updateProgress(`✅ 已完成 ${completed}/${total}`, completed, total, (Date.now() - startTime) / 1000);

      if (prepPromise) {
        nextPrompt = await prepPromise;
        if (!nextPrompt || !nextPrompt.cn) { showToast('⚠️ 提示词准备失败', 'error'); break; }
      }
    }

    const finalElapsed = (Date.now() - startTime) / 1000;
    _updateProgress(`✅ 全部完成! ${completed}/${total}`, completed, total, finalElapsed);
    showToast(`🎉 生图完成！共 ${completed} 张`, 'success');

    if (comfySettings.autoShutdown && comfySettings.shutdownMinutes > 0) {
      const secs = comfySettings.shutdownMinutes * 60;
      showToast(`🛑 将在 ${comfySettings.shutdownMinutes} 分钟后关机`, 'success');
      triggerShutdown(secs);
    }
  } catch (e) {
    if (e && e.stopped) {
      setQueueStatus('stopped');
      _genQueue.forEach(q => { if (q.state === 'run' || q.state === 'queue') q.state = 'stop'; });
      renderGenQueue();
      _updateProgress('⏹ 已中止', completed, total, (Date.now() - startTime) / 1000);
    } else {
      genFailed = true;
      setQueueStatus('error');
      showToast('❌ 生图失败: ' + e.message.slice(0, 150), 'error');
      _updateProgress(`❌ ${e.message.slice(0, 50)}`, completed, total, (Date.now() - startTime) / 1000);
      _genQueue.forEach(q => { if (q.state === 'run') q.state = 'err'; });
      renderGenQueue();
    }
  } finally {
    btn.disabled = false;
    setStartButton(comfyStopped ? '重新开始' : '开始生图');
    stopBtn.style.display = 'none';
    comfyQueueRunning = false;
    if (genFailed) setQueueStatus('error');
    else if (comfyStopped) setQueueStatus('stopped');
    else setQueueStatus(comfyConnected ? 'ready' : 'disconnected');
    if (comfyStopped) _updateProgress('⏹ 已中止', 0, 0, 0);
    else setTimeout(_hideProgress, 6000);
    updateQueueSummary();
  }
}

function stopComfyGeneration() {
  if (!comfyQueueRunning) return;
  comfyStopped = true;
  setQueueStatus('stopped');
  const stopBtn = document.getElementById('comfyStopBtn');
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.innerHTML = '<svg class="icon"><use href="#icon-stop"/></svg>中止中…';
  }
  showToast('⏹ 正在中止生图...', 'success');
  // 同时通知 ComfyUI 中断当前任务并清空队列，否则后台仍会继续跑完已提交的任务
  try {
    const base = getComfyBaseUrl();
    const prefix = _comfyApiPrefix || '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    fetch(base + prefix + '/interrupt', { method: 'POST', signal: ctrl.signal }).catch(() => {});
    fetch(base + prefix + '/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true }),
      signal: ctrl.signal
    }).catch(() => {}).finally(() => clearTimeout(timer));
  } catch (e) { /* 忽略，前端状态已置为中止 */ }
}

// ============================================================
// SECTION 16: ComfyUI Settings Modal
// ============================================================

function openComfySettings() {
  const ex = document.getElementById('comfyModal');
  if (ex) ex.remove();
  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'comfyModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const pn = document.createElement('div');
  pn.className = 'pm-panel';
  pn.style.maxWidth = '500px';
  const hd = document.createElement('div');
  hd.className = 'pm-header';
  hd.innerHTML = '<h3>🖼️ ComfyUI 设置</h3>';
  const cb = document.createElement('button');
  cb.style.cssText = 'background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:3px 12px;border-radius:5px;cursor:pointer;font-size:12px;';
  cb.textContent = '✕ 关闭';
  cb.onclick = () => ov.remove();
  hd.appendChild(cb);
  pn.appendChild(hd);
  const bd = document.createElement('div');
  bd.className = 'pm-body';
  bd.style.padding = '14px 18px';

  const cLabel = document.createElement('div');
  cLabel.className = 'ai-label';
  cLabel.textContent = 'ComfyUI 地址';
  bd.appendChild(cLabel);
  const cRow = document.createElement('div');
  cRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
  const cUrl = document.createElement('input');
  cUrl.id = 'comfyUrl';
  cUrl.className = 'ai-settings-input';
  cUrl.style.marginBottom = '0';
  cUrl.placeholder = 'http://127.0.0.1:8188';
  cUrl.value = comfySettings.url;
  const cBtn = document.createElement('button');
  cBtn.textContent = '🔌 检测';
  cBtn.style.cssText = 'flex-shrink:0;padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;';
  cBtn.onclick = async () => {
    comfySettings.url = cUrl.value.replace(/\/+$/, '');
    saveComfySettings();
    await checkComfyConnection();
    cStat.innerHTML = '状态: ' + (comfyConnected ? '🟢 已连接' : '🔴 未连接');
  };
  cRow.appendChild(cUrl);
  cRow.appendChild(cBtn);
  bd.appendChild(cRow);
  const cStat = document.createElement('div');
  cStat.style.cssText = 'font-size:11px;color:var(--text2);margin-bottom:12px;';
  cStat.innerHTML = '状态: ' + (comfyConnected ? '🟢 已连接' : '🔴 未连接');
  bd.appendChild(cStat);

  const proxyRow = document.createElement('div');
  proxyRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';
  const proxyToggle = document.createElement('label');
  proxyToggle.className = 'toggle';
  const proxyCb = document.createElement('input');
  proxyCb.type = 'checkbox';
  proxyCb.id = 'comfyUseProxy';
  if (comfySettings.useProxy) proxyCb.checked = true;
  const proxySlider = document.createElement('span');
  proxySlider.className = 'slider';
  proxyToggle.appendChild(proxyCb);
  proxyToggle.appendChild(proxySlider);
  const proxyLabel = document.createElement('span');
  proxyLabel.style.cssText = 'font-size:12px;color:var(--text);';
  proxyLabel.textContent = '使用代理（同源转发，解决跨域）';
  const proxyHint = document.createElement('span');
  proxyHint.style.cssText = 'font-size:10px;color:var(--text2);';
  if (window.location.origin && window.location.origin.startsWith('http')) proxyHint.textContent = '代理地址: ' + window.location.origin + '/comfy-proxy';
  else proxyHint.textContent = '需通过 HTTP 服务打开页面才可使用代理';
  proxyRow.appendChild(proxyToggle);
  proxyRow.appendChild(proxyLabel);
  bd.appendChild(proxyRow);
  bd.appendChild(proxyHint);

  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid var(--border);margin:10px 0;';
  bd.appendChild(sep);
  const wfLabel = document.createElement('div');
  wfLabel.className = 'ai-label';
  wfLabel.textContent = '📂 工作流管理';
  bd.appendChild(wfLabel);
  const wfList = document.createElement('div');
  wfList.id = 'comfyWfList';
  bd.appendChild(wfList);

  function renderWfList() {
    wfList.innerHTML = '';
    if (!comfyWorkflows.length) {
      const e = document.createElement('div');
      e.className = 'pm-empty';
      e.textContent = '暂无工作流，请上传';
      wfList.appendChild(e);
      return;
    }
    comfyWorkflows.forEach((wf, i) => {
      const row = document.createElement('div');
      row.className = 'comfy-wf-item';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'wf-name';
      nameSpan.textContent = wf.name;
      if (i === comfySettings.selectedWorkflow) {
        const badge = document.createElement('span');
        badge.className = 'wf-active';
        badge.textContent = '✓ 当前';
        nameSpan.appendChild(badge);
      }
      const acts = document.createElement('div');
      acts.className = 'wf-actions';
      const selBtn = document.createElement('button');
      selBtn.textContent = '选择';
      selBtn.onclick = () => { selectComfyWorkflow(i); renderWfList(); autoDetectSizeInModal(); };
      const delBtn = document.createElement('button');
      delBtn.className = 'wf-del';
      delBtn.textContent = '删除';
      delBtn.onclick = () => { deleteComfyWorkflow(i); renderWfList(); };
      acts.appendChild(selBtn);
      acts.appendChild(delBtn);
      row.appendChild(nameSpan);
      row.appendChild(acts);
      wfList.appendChild(row);
    });
  }
  renderWfList();

  const sep2 = document.createElement('div');
  sep2.style.cssText = 'border-top:1px solid var(--border);margin:10px 0;';
  bd.appendChild(sep2);
  const dimLabel = document.createElement('div');
  dimLabel.className = 'ai-label';
  dimLabel.textContent = '📐 尺寸';
  bd.appendChild(dimLabel);
  const dimRow = document.createElement('div');
  dimRow.className = 'comfy-dim-row';
  const wInput = document.createElement('input');
  wInput.id = 'comfyWidth';
  wInput.type = 'number';
  wInput.min = 64;
  wInput.max = 2048;
  wInput.step = 8;
  wInput.value = comfySettings.width;
  const xSpan = document.createElement('span');
  xSpan.textContent = 'x';
  const hInput = document.createElement('input');
  hInput.id = 'comfyHeight';
  hInput.type = 'number';
  hInput.min = 64;
  hInput.max = 2048;
  hInput.step = 8;
  hInput.value = comfySettings.height;
  const pxSpan = document.createElement('span');
  pxSpan.textContent = 'px';
  dimRow.appendChild(wInput);
  dimRow.appendChild(xSpan);
  dimRow.appendChild(hInput);
  dimRow.appendChild(pxSpan);
  bd.appendChild(dimRow);

  const nodeInfo = document.createElement('div');
  nodeInfo.id = 'comfyNodeInfo';
  nodeInfo.className = 'comfy-node-info';
  function updateNodeInfo() {
    if (comfySettings.selectedWorkflow >= 0 && comfySettings.selectedWorkflow < comfyWorkflows.length) {
      const pn = findPromptNodes(comfyWorkflows[comfySettings.selectedWorkflow].data);
      nodeInfo.textContent = '🔍 已检测 ' + pn.length + ' 个 CLIPTextEncode 节点，将替换第 1 个的提示词';
    } else {
      nodeInfo.textContent = '📂 请先选择工作流';
    }
  }
  updateNodeInfo();
  bd.appendChild(nodeInfo);

  const sep3 = document.createElement('div');
  sep3.style.cssText = 'border-top:1px solid var(--border);margin:10px 0;';
  bd.appendChild(sep3);
  const langLabel = document.createElement('div');
  langLabel.className = 'ai-label';
  langLabel.textContent = '🌐 发送语言';
  bd.appendChild(langLabel);
  const langRow = document.createElement('div');
  langRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
  ['en', 'cn'].forEach(v => {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;';
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = 'comfyLang';
    inp.value = v;
    if (v === comfySettings.language) inp.checked = true;
    inp.onchange = () => { comfySettings.language = v; };
    lbl.appendChild(inp);
    lbl.appendChild(document.createTextNode(v === 'en' ? 'English 英文' : '中文 Chinese'));
    langRow.appendChild(lbl);
  });
  bd.appendChild(langRow);

  const rbRow = document.createElement('div');
  rbRow.style.cssText = 'display:flex;gap:16px;margin-bottom:10px;';
  function makeNumberInput(id, label, val, min, max) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    const lb = document.createElement('div');
    lb.className = 'ai-label';
    lb.textContent = label;
    wrap.appendChild(lb);
    const inp = document.createElement('input');
    inp.id = id;
    inp.type = 'number';
    inp.min = min;
    inp.max = max;
    inp.value = val;
    inp.style.cssText = 'width:80px;padding:6px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;text-align:center;outline:none;font-family:inherit;';
    inp.onfocus = () => { inp.style.borderColor = 'var(--accent)'; };
    inp.onblur = () => { inp.style.borderColor = 'var(--border)'; };
    wrap.appendChild(inp);
    return wrap;
  }
  rbRow.appendChild(makeNumberInput('comfyRandCnt', '随机提示词数量', comfySettings.randomCount, 1, 999999));
  rbRow.appendChild(makeNumberInput('comfyBatchCnt', '生图批次', comfySettings.batchCount, 1, 999999));
  bd.appendChild(rbRow);

  const sb = document.createElement('button');
  sb.className = 'ai-btn-full';
  sb.style.background = 'var(--accent)';
  sb.style.color = '#fff';
  sb.textContent = '💾 保存设置';
  sb.onclick = () => {
    comfySettings.url = cUrl.value.replace(/\/+$/, '');
    comfySettings.width = parseInt(document.getElementById('comfyWidth').value) || 512;
    comfySettings.height = parseInt(document.getElementById('comfyHeight').value) || 512;
    comfySettings.randomCount = parseInt(document.getElementById('comfyRandCnt').value) || 1;
    comfySettings.batchCount = parseInt(document.getElementById('comfyBatchCnt').value) || 1;
    comfySettings.useProxy = document.getElementById('comfyUseProxy').checked;
    saveComfySettings();
    ov.remove();
    updateRightPanel();
    showToast('✅ ComfyUI 设置已保存', 'success');
  };
  bd.appendChild(sb);
  pn.appendChild(bd);
  ov.appendChild(pn);
  document.body.appendChild(ov);

  function autoDetectSizeInModal() {
    autoDetectSize();
    const we = document.getElementById('comfyWidth'), he = document.getElementById('comfyHeight');
    if (we) we.value = comfySettings.width;
    if (he) he.value = comfySettings.height;
    updateNodeInfo();
  }
}

// ============================================================
// SECTION 17: Data Backup & Restore
// ============================================================

const BACKUP_GROUPS = {
  prompts: { keys: ['prompts_data','prompts_data_enabled','prompts_chance','prompts_locked','identity_regions','identity_genders','identity_en','identity_age','identity_age_random','identity_region_random','identity_gender_random','identity_enabled','enrich_groups','enrichCN','enrichEN','skinCN','skinEN','qualityCN','qualityEN'], name: '提示词与类别' },
  ai: { keys: ['ai_settings','ai_preset','ai_history'], name: 'AI 润色设置' },
  comfy: { keys: ['comfy_settings','comfy_workflows','comfy_gallery'], name: 'ComfyUI 设置' },
  server_config: { keys: ['port','host','comfy_url','html_file'], name: '服务配置', server: true }
};

function _exportGroup(cat, info) {
  const data = { _exportedAt: new Date().toISOString() };
  info.keys.forEach(k => {
    try {
      const v = info.server ? null : storage.get(k);
      if (v !== null) data[k] = v;
    } catch (e) {
      console.warn('[_exportGroup] Failed to read key:', k, e.message);
    }
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = cat + '_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  // 延迟回收：click 后同步 revoke 在 Firefox/Safari 可能取消下载
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function _exportServerConfig() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) return;
  try {
    const r = await fetch('/api/load-server-config', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return;
    const data = await r.json();
    if (!data || !data.port) return;
    data._exportedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'server_config_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.warn('[_exportServerConfig] Failed:', e.message);
  }
}

async function exportAllData() {
  const idx = await uiChoice('选择要导出的数据', [
    { label: '📝 提示词数据', sub: 'prompts' },
    { label: '🤖 AI 润色设置', sub: 'ai_settings' },
    { label: '🖼️ ComfyUI 设置', sub: 'comfy_settings' },
    { label: '⚙️ 服务配置', sub: 'server_config' }
  ]);
  if (idx === null) return;
  const names = ['提示词数据', 'AI 润色设置', 'ComfyUI 设置', '服务配置'];
  if (idx === 0) _exportGroup('prompts', BACKUP_GROUPS.prompts);
  else if (idx === 1) _exportGroup('ai', BACKUP_GROUPS.ai);
  else if (idx === 2) _exportGroup('comfy', BACKUP_GROUPS.comfy);
  else if (idx === 3) _exportServerConfig();
  showToast(`✅ 已导出：${names[idx]}`, 'success');
}

function importAllData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fname = file.name.toLowerCase();
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') throw new Error('无效格式');
      let cats = Object.keys(BACKUP_GROUPS).filter(cat => {
        return BACKUP_GROUPS[cat].keys.some(k => data[k] !== undefined);
      });
      if (!cats.length) { showToast('⚠️ 文件中未找到可导入的数据', 'error'); event.target.value = ''; return; }
      let idxs = [];
      if (fname.includes('prompts')) idxs = [cats.indexOf('prompts')];
      else if (fname.includes('ai') || fname.includes('AI')) idxs = [cats.indexOf('ai')];
      else if (fname.includes('comfy')) idxs = [cats.indexOf('comfy')];
      else if (fname.includes('server_config') || fname.includes('config')) idxs = [cats.indexOf('server_config')];
      if (idxs.length !== 1 || idxs[0] === -1) {
        idxs = await uiMultiChoice('选择要导入的类别', cats.map(c => ({ label: BACKUP_GROUPS[c].name })));
        if (idxs === null) { event.target.value = ''; return; }
        if (!idxs.length) { showToast('⚠️ 未选择任何类别', 'error'); event.target.value = ''; return; }
      }
      let count = 0;
      idxs.forEach(i => {
        const cat = cats[i];
        const group = BACKUP_GROUPS[cat];
        if (group.server) {
          const sdata = {};
          group.keys.forEach(k => { if (data[k] !== undefined) sdata[k] = data[k]; });
          if (Object.keys(sdata).length && window.location.origin.startsWith('http')) {
            fetch('/api/save-server-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sdata) }).catch(() => {});
            count += Object.keys(sdata).length;
          }
        } else {
          group.keys.forEach(k => {
            if (data[k] !== undefined) { storage.set(k, data[k]); count++; }
          });
        }
      });
      syncAllToServer();
      showToast(`✅ 已导入 ${count} 项数据（${idxs.length} 个类别），3秒后刷新`, 'success');
      event.target.value = '';
      setTimeout(() => location.reload(), 3000);
    } catch (err) {
      showToast('⚠️ 导入失败: ' + err.message, 'error');
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

// ============================================================
// SECTION 18: Initialization
// ============================================================


// ============================================================
// Theme toggle (DeepSeek light/dark)
// ============================================================
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { storage.setRaw('theme', next); } catch (e) {}
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = next === 'dark'
    ? '<svg class="icon"><use href="#icon-sun"/></svg>'
    : '<svg class="icon"><use href="#icon-moon"/></svg>';
}
async function init() {
  // Theme boot（默认深色，可在右上角切换并持久化）
  try {
    const t = (typeof storage !== 'undefined' && storage.getRaw('theme')) || 'dark';
    const theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const _tb = document.getElementById('themeToggleBtn');
    if (_tb) _tb.innerHTML = (theme === 'dark')
      ? '<svg class="icon"><use href="#icon-sun"/></svg>'
      : '<svg class="icon"><use href="#icon-moon"/></svg>';
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  if (window.location.origin && window.location.origin.startsWith('http')) {
    const loaded = await loadAllFromServer();
    if (loaded) { console.log('✅ Data restored from server backup'); }
  }
  await loadDataConstants();

  const savedData = storage.get('prompts_data');
  const savedEnabled = storage.get('prompts_data_enabled');
  promptsChance = storage.get('prompts_chance') || {};
  promptsLocked = storage.get('prompts_locked') || {};
  if (!promptsLocked || typeof promptsLocked !== 'object' || Array.isArray(promptsLocked)) promptsLocked = {};
  if (savedData) {
    DATA = savedData;
  } else {
    DATA = [];
  }
  if (savedEnabled) {
    promptsEnabled = savedEnabled;
  } else {
    DATA.forEach(cat => { promptsEnabled[cat.name] = true; });
  }

  loadAiSettings();
  loadAiPreset();
  loadAiHistory();
  loadComfySettings();
  loadComfyWorkflows();
  loadComfyGallery();
  loadIdentitySettings();
  loadShutdownUI();
  updateAiStatus();
  updateComfyStatus();
  renderCategories();
  renderIdentityBar();
  renderComfyGallery();
  resizePromptAreas();
  updateRightPanel();
  syncPolishLangUI();
  syncComfyLangUI();
  updatePromptStats();
  renderGenQueue();
  // 手动输入中文（isTrusted=true 的真实键盘输入）后，英文框标记为「可能已过期」，并同步词条高亮
  const cnTa = document.getElementById('promptArea');
  if (cnTa) cnTa.addEventListener('input', (e) => { if (e.isTrusted) { markEnStale(true); refreshChipHighlights(); } });
  const enTa = document.getElementById('promptEnArea');
  if (enTa) enTa.addEventListener('input', (e) => {
    if (!e.isTrusted) return;
    _enManual = true;
    markEnStale(false);
    updatePromptStats();
    const es = document.getElementById('enState');
    if (es) es.textContent = '✎ 已手动编辑';
  });
  setTimeout(() => checkComfyConnection(), 500);

}

// ============================================================
// SECTION 19: New UI glue（三栏界面 / 固定种子 / 队列 / token）
// ============================================================

function _setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

// —— 提示词统计：字数 / 英文词数 / token 估算 ——
function updatePromptStats() {
  const cnEl = document.getElementById('promptArea');
  const enEl = document.getElementById('promptEnArea');
  if (!cnEl || !enEl) return;
  const cn = cnEl.value || '';
  const en = enEl.value || '';
  const cnChars = cn.replace(/\s/g, '').length;
  const cjk = (cn.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (en.match(/[A-Za-z0-9][A-Za-z0-9'\-]*/g) || []).length;
  // 粗估：中文 1 字 ≈ 1 token，英文 1 词 ≈ 0.75 token，其余字符 ≈ 0.5
  const tokens = Math.max(0, Math.round(cjk * 1.0 + words * 0.75 + Math.max(0, cnChars - cjk) * 0.5));
  _setText('tokenCount', tokens);
  _setText('cnCount', cnChars + ' 字');
  _setText('enWords', words + ' words');
  const st = document.getElementById('cnStale');
  if (st && _enManual) {
    st.textContent = '✎ 英文已手动编辑';
    st.className = '';
    st.style.color = 'var(--orange)';
  } else if (st && enEl.classList.contains('en-stale')) {
    st.textContent = '⚠ 英文可能已过期';
    st.className = '';
    st.style.color = 'var(--orange)';
  } else if (st) {
    st.textContent = '✓ 中英已对齐';
    st.className = 'ok-text';
    st.style.color = '';
  }
}

// —— 左侧词库搜索：按类别名或词条过滤 ——
function applyCatSearch(q) {
  const grid = document.getElementById('catGrid');
  if (!grid) return;
  const key = String(q || '').trim().toLowerCase();
  grid.querySelectorAll('.cat-card').forEach(card => {
    const name = (card.querySelector('.cat-name')?.textContent || '').toLowerCase();
    const chips = Array.from(card.querySelectorAll('.cat-preview .chip'));
    let visible = 0;
    chips.forEach(ch => {
      const t = (ch.dataset.cn || ch.textContent || '').toLowerCase();
      const show = !key || name.includes(key) || t.includes(key);
      ch.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    card.style.display = (!key || visible) ? '' : 'none';
  });
}

// —— 锁定统计 ——
function updateLockSummary() {
  let total = 0;
  if (typeof DATA !== 'undefined' && Array.isArray(DATA)) {
    DATA.forEach(cat => {
      const arr = promptsLocked[cat.name];
      if (Array.isArray(arr)) total += arr.filter(cn => cat.items.some(it => it.cn === cn)).length;
    });
  }
  _setText('lockCount', total);
  _setText('lockFoot', total);
  _setText('lockMeta', total);
}

// —— 快速选择人物身份（顶部预览 chips 弹出）——
function _fillQuickSelect(sel, sourceSel) {
  if (!sel || !sourceSel) return;
  const current = sourceSel.value;
  sel.innerHTML = Array.from(sourceSel.options)
    .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</option>`).join('');
  if (current) sel.value = current;
}

function syncIdentityQuickUI() {
  const age = document.getElementById('ageSlider');
  const region = document.getElementById('regionSelect');
  const gender = document.getElementById('genderSelect');
  const qAge = document.getElementById('idAge');
  if (!age || !region || !gender || !qAge) return;
  const min = parseInt(age.min, 10) || 18;
  const max = parseInt(age.max, 10) || 49;
  qAge.min = min;
  qAge.max = max;
  qAge.value = age.value;
  _setText('idAgeVal', age.value);
  _fillQuickSelect(document.getElementById('idRegion'), region);
  _fillQuickSelect(document.getElementById('idGender'), gender);
  const setChk = (id, srcId) => {
    const el = document.getElementById(id);
    const src = document.getElementById(srcId);
    if (el && src) el.checked = src.checked;
  };
  setChk('idAgeRandom', 'ageRandomToggle');
  setChk('idRegionRandom', 'regionRandomToggle');
  setChk('idGenderRandom', 'genderRandomToggle');
  _setText('idPreview', identityEnabled ? getIdentityPrefix() : '身份已关闭');
}

function openIdentityPop(e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  const pop = document.getElementById('identityPop');
  const btn = document.getElementById('identityPreviewBtn');
  if (!pop || !btn) return;
  const willShow = !pop.classList.contains('show');
  syncIdentityQuickUI();
  if (!willShow) { pop.classList.remove('show'); return; }
  pop.classList.add('show');
  positionIdentityPop();
}

function positionIdentityPop() {
  const pop = document.getElementById('identityPop');
  const btn = document.getElementById('identityPreviewBtn');
  if (!pop || !btn) return;
  const r = btn.getBoundingClientRect();
  const w = 322;
  pop.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
  pop.style.top = (r.bottom + 8) + 'px';
}

function closeIdentityPop() {
  const pop = document.getElementById('identityPop');
  if (pop) pop.classList.remove('show');
}

// 拖动年龄滑杆时实时预览（不落盘）
function onQuickIdentityInput() {
  const qAge = document.getElementById('idAge');
  const age = document.getElementById('ageSlider');
  if (!qAge || !age) return;
  _setText('idAgeVal', qAge.value);
  age.value = qAge.value;
  _setText('ageDisplay', qAge.value);
  updateIdentityPreview();
  _setText('idPreview', identityEnabled ? getIdentityPrefix() : '身份已关闭');
}

// 选择地区 / 性别 / 随机开关后同步到原有控件并保存
function applyQuickIdentity() {
  const age = document.getElementById('ageSlider');
  const qAge = document.getElementById('idAge');
  const region = document.getElementById('regionSelect');
  const gender = document.getElementById('genderSelect');
  if (!age || !region || !gender || !qAge) return;
  age.value = qAge.value;
  _setText('ageDisplay', qAge.value);
  const qRegion = document.getElementById('idRegion');
  const qGender = document.getElementById('idGender');
  if (qRegion) region.value = qRegion.value;
  if (qGender) gender.value = qGender.value;
  const pair = [
    ['ageRandomToggle', 'idAgeRandom'],
    ['regionRandomToggle', 'idRegionRandom'],
    ['genderRandomToggle', 'idGenderRandom']
  ];
  pair.forEach(([srcId, qId]) => {
    const src = document.getElementById(srcId);
    const q = document.getElementById(qId);
    if (src && q) src.checked = q.checked;
  });
  saveIdentitySettings();
  updateIdentityPreview();
  syncIdentityQuickUI();
}

document.addEventListener('click', (e) => {
  const pop = document.getElementById('identityPop');
  if (!pop || !pop.classList.contains('show')) return;
  if (pop.contains(e.target) || e.target.closest('#identityPreviewBtn')) return;
  closeIdentityPop();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeIdentityPop();
});
window.addEventListener('resize', () => {
  const pop = document.getElementById('identityPop');
  if (pop && pop.classList.contains('show')) positionIdentityPop();
});

// —— 语言模式（AI 润色）——
function syncPolishLangUI() {
  const v = (aiSettings && aiSettings.polishLang) || 'both';
  document.querySelectorAll('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === v));
}
function setPolishLang(v) {
  if (!aiSettings) return;
  if (!['both', 'cn', 'en'].includes(v)) return;
  aiSettings.polishLang = v;
  saveAiSettings();
  syncPolishLangUI();
  const map = { both: '中 + 英', cn: '仅中文', en: '仅英文' };
  showToast('✅ AI 润色语言：' + map[v], 'success');
}

// —— 发送语言（ComfyUI）——
function syncComfyLangUI() {
  const v = (comfySettings && comfySettings.language) || 'en';
  document.querySelectorAll('#comfyLangSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === v));
  const st = document.getElementById('enStatus');
  if (st) st.textContent = '发送语言：' + (v === 'en' ? 'English' : '中文');
}
function setComfyLang(v) {
  if (!comfySettings) return;
  comfySettings.language = v === 'cn' ? 'cn' : 'en';
  saveComfySettings();
  syncComfyLangUI();
  showToast('✅ 发送语言：' + (comfySettings.language === 'en' ? 'English' : '中文'), 'success');
}

// —— 右栏：工作流 / 尺寸 / 数量 / 种子 / 按钮 ——
function renderComfyWorkflowSelect() {
  const sel = document.getElementById('comfyWorkflowSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="-1">未选择工作流</option>' +
    comfyWorkflows.map((w, i) => `<option value="${i}">${escapeHtml(w.name)}</option>`).join('');
  const idx = comfySettings.selectedWorkflow;
  sel.value = (idx >= 0 && idx < comfyWorkflows.length) ? String(idx) : '-1';
  _setText('wfCount', comfyWorkflows.length + ' 个已上传');
}

function renderSizeInputs() {
  const w = document.getElementById('comfySizeW');
  const h = document.getElementById('comfySizeH');
  if (w) w.value = comfySettings.width;
  if (h) h.value = comfySettings.height;
  document.querySelectorAll('.size-presets button').forEach(b => {
    b.classList.toggle('on',
      parseInt(b.dataset.w, 10) === parseInt(comfySettings.width, 10) &&
      parseInt(b.dataset.h, 10) === parseInt(comfySettings.height, 10));
  });
}

function applySizePreset(w, h) {
  const clamp = (v) => Math.max(1, parseInt(v, 10) || 1);
  comfySettings.width = clamp(w);
  comfySettings.height = clamp(h);
  saveComfySettings();
  updateRightPanel();
}

function onSizeInput() {
  const wEl = document.getElementById('comfySizeW');
  const hEl = document.getElementById('comfySizeH');
  if (!wEl || !hEl) return;
  const clamp = (v) => Math.max(1, parseInt(v, 10) || 1);
  comfySettings.width = clamp(wEl.value);
  comfySettings.height = clamp(hEl.value);
  saveComfySettings();
  updateRightPanel();
}

function onCountInput(field, val) {
  let n = parseInt(val, 10) || 1;
  n = Math.max(1, n);
  comfySettings[field] = n;
  saveComfySettings();
  updateRightPanel();
}

function onWorkflowSelectChange(v) {
  const idx = parseInt(v, 10);
  if (isNaN(idx)) return;
  selectComfyWorkflow(idx);
  updateRightPanel();
  if (idx >= 0 && comfyWorkflows[idx]) showToast('✅ 已选择工作流：' + comfyWorkflows[idx].name, 'success');
}

function onSizeChange(v) {
  const m = String(v).split('x').map(Number);
  if (!m[0] || !m[1]) return;
  comfySettings.width = m[0];
  comfySettings.height = m[1];
  saveComfySettings();
  updateRightPanel();
}

function stepCount(field, delta) {
  let n = parseInt(comfySettings[field], 10) || 1;
  n = Math.max(1, n + delta);
  comfySettings[field] = n;
  saveComfySettings();
  updateRightPanel();
}

function updateSeedUI() {
  const input = document.getElementById('comfySeed');
  const lock = document.getElementById('comfySeedLock');
  if (!input || !comfySettings) return;
  input.value = comfySettings.seed || '';
  if (lock) lock.checked = !!comfySettings.seedLock;
  _setText('seedHint', comfySettings.seedLock ? '已锁定 · 每张相同' : '未锁定 · 每张随机');
}

function onSeedChange(v) {
  let n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  if (!n || n < 1) n = 1;
  if (n > 2147483647) n = 2147483647;
  comfySettings.seed = n;
  saveComfySettings();
  updateSeedUI();
}

function randomizeSeed() {
  comfySettings.seed = Math.floor(Math.random() * 2147483647) + 1;
  saveComfySettings();
  updateSeedUI();
  showToast('🎲 新种子：' + comfySettings.seed, 'success');
}

function onSeedLockChange(on) {
  comfySettings.seedLock = !!on;
  if (on && !comfySettings.seed) comfySettings.seed = Math.floor(Math.random() * 2147483647) + 1;
  saveComfySettings();
  updateSeedUI();
  showToast(on ? '🔒 种子已锁定：每张图片使用同一种子' : '🔓 种子已解锁：每张图片随机', 'success');
}

function setStartButton(label) {
  const btn = document.getElementById('comfyStartBtn');
  if (!btn) return;
  const total = (parseInt(comfySettings.randomCount, 10) || 1) * (parseInt(comfySettings.batchCount, 10) || 1);
  const txt = label || '开始生图';
  btn.innerHTML = `<svg class="icon"><use href="#icon-play"/></svg><span class="btn-label">${txt}</span><span class="start-count">· ${total} 张</span>`;
}

function updateRightPanel() {
  if (typeof comfySettings === 'undefined' || !comfySettings) return;
  renderComfyWorkflowSelect();
  renderSizeInputs();
  const randEl = document.getElementById('randCountInput');
  const batchEl = document.getElementById('batchCountInput');
  if (randEl) randEl.value = comfySettings.randomCount || 1;
  if (batchEl) batchEl.value = comfySettings.batchCount || 1;
  _setText('totalGenCount', (comfySettings.randomCount || 1) * (comfySettings.batchCount || 1));
  updateSeedUI();
  syncComfyLangUI();
  loadShutdownUI();
  if (!comfyQueueRunning) setStartButton('开始生图');
  updateQueueSummary();
}

// —— 生成队列 ——
let _genQueue = [];
function buildGenQueue(total) {
  _genQueue = Array.from({ length: total }, () => ({ state: 'wait', seed: '' }));
  renderGenQueue();
  updateQueueSummary();
}
function queueMark(index, state, seed) {
  const q = _genQueue[index - 1];
  if (!q) return;
  q.state = state;
  if (seed) q.seed = seed;
  renderGenQueue();
  updateQueueSummary();
}
function _queueGroupOf(i) {
  const batch = Math.max(1, parseInt(comfySettings.batchCount, 10) || 1);
  return Math.floor(i / batch) + 1;
}
function renderGenQueue() {
  const box = document.getElementById('genQueue');
  if (!box) return;
  if (!_genQueue.length) {
    box.innerHTML = '<div class="queue-empty">等待开始 · 选择工作流后点击「开始生图」</div>';
    return;
  }
  // 数量很大时只渲染前 200 行，避免上千行 DOM 拖慢界面；状态仍按完整队列统计
  const MAX_ROWS = 200;
  const rows = _genQueue.slice(0, MAX_ROWS).map((q, i) => {
    const cls = q.state === 'done' ? 'done' : (q.state === 'run' ? 'run' : (q.state === 'err' ? 'err' : (q.state === 'stop' ? 'stop' : '')));
    const text = `第 ${_queueGroupOf(i)} 组 · seed ${q.seed || '待生成'}`;
    const bar = q.state === 'run' ? '<span class="mini-bar"><i style="width:55%"></i></span>' : '';
    const st = q.state === 'done' ? '完成' : (q.state === 'run' ? '生成中' : (q.state === 'err' ? '失败' : (q.state === 'stop' ? '已中止' : '排队')));
    return `<div class="qrow ${cls}"><span class="qidx">#${String(i + 1).padStart(2, '0')}</span><span class="qtext">${text}</span>${bar}<span class="qstat ${cls}">${st}</span></div>`;
  }).join('');
  const more = _genQueue.length > MAX_ROWS
    ? `<div class="queue-more">仅显示前 ${MAX_ROWS} 条，另有 ${_genQueue.length - MAX_ROWS} 条在后台执行…</div>`
    : '';
  box.innerHTML = rows + more;
}
function updateQueueSummary() {
  const sub = document.getElementById('queueSub');
  if (!sub) return;
  const total = _genQueue.length;
  if (!total) { sub.textContent = '未开始'; return; }
  const done = _genQueue.filter(q => q.state === 'done').length;
  sub.textContent = done >= total ? `${total} 张 · 已完成` : `${done}/${total} · ${comfyQueueRunning ? '进行中' : '等待'}`;
}


// ============================================================
// SECTION 20: Restyled AI / ComfyUI settings modals
// ============================================================

function _aiTabBtn(label, tab, count) {
  return `<button type="button" class="ai-tab" data-tab="${tab}">${label}${count != null ? ` <span class="ai-tab-count">${count}</span>` : ''}</button>`;
}

function openAiSettings(tab) {
  tab = tab || 'model';
  const old = document.getElementById('aiSettingsModal');
  if (old) old.remove();

  const providers = Object.entries(AI_PROVIDERS).map(([k, v]) =>
    `<option value="${k}" ${k === aiSettings.provider ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('');
  const langRadio = (v, label, desc) => `
    <label class="ai-lang ${aiSettings.polishLang === v ? 'on' : ''}">
      <input type="radio" name="aiPolLang" value="${v}" ${aiSettings.polishLang === v ? 'checked' : ''}>
      <span>${label}</span><em>${desc}</em>
    </label>`;
  const hist = aiHistory.map((r, i) => `
    <div class="ai-hist-item">
      <div class="ai-hist-time">#${i + 1} · ${new Date(r.timestamp).toLocaleString('zh-CN')}</div>
      <div class="ai-hist-label">原始</div>
      <div class="ai-hist-text">${escapeHtml(r.original || '')}</div>
      ${r.originalEn ? `<div class="ai-hist-text en">${escapeHtml(r.originalEn)}</div>` : ''}
      <div class="ai-hist-label pol">润色后</div>
      <div class="ai-hist-text">${escapeHtml(r.polished || '')}</div>
      <button type="button" class="ai-hist-copy" data-copy="${escapeHtml((r.polished || '').replace(/"/g, '&quot;'))}">复制结果</button>
    </div>`).join('');

  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'aiSettingsModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `
    <div class="pm-panel ai-panel">
      <div class="pm-header">
        <h3><svg class="icon"><use href="#icon-robot"/></svg>AI 润色设置</h3>
        <div class="ai-tabs">
          ${_aiTabBtn('模型设置', 'model')}
          ${_aiTabBtn('润色预设', 'preset')}
          ${_aiTabBtn('历史记录', 'history', aiHistory.length)}
        </div>
        <button class="pm-close" type="button">✕ 关闭</button>
      </div>
      <div class="pm-body ai-body">
        <section class="ai-pane" data-pane="model">
          <div class="ai-form-grid">
            <div>
              <div class="ai-label">AI 厂商 <span>选择后自动填入默认地址</span></div>
              <select id="aiProvider" class="ai-settings-select">${providers}</select>
              <div class="ai-label">API 地址 <span>兼容 OpenAI 协议</span></div>
              <input id="aiBaseUrl" class="ai-settings-input" type="url" value="${escapeHtml(aiSettings.baseUrl || '')}" placeholder="https://api.deepseek.com">
              <div class="ai-label">API Key <span>仅保存在本地</span></div>
              <input id="aiApiKey" class="ai-settings-input" type="password" value="${escapeHtml(aiSettings.apiKey || '')}" placeholder="sk-...（本地模型可留空）">
              <div class="ai-label">模型名称 <span>可手动输入</span></div>
              <div class="ai-inline">
                <input id="aiModel" class="ai-settings-input" value="${escapeHtml(aiSettings.model || '')}" placeholder="deepseek-chat">
                <button type="button" id="fetchModelsBtn" class="btn btn-sm">获取模型</button>
              </div>
            </div>
            <div>
              <div class="ai-label">润色语言 <span>与顶部工具栏同步</span></div>
              ${langRadio('both', '中 + 英', '默认')}
              ${langRadio('cn', '仅中文', '英文保持')}
              ${langRadio('en', '仅英文', '最省 token')}
              <div class="ai-status-box">
                <div class="ai-status-line"><span class="dot ${aiSettings.baseUrl && aiSettings.model ? 'green' : ''}"></span>
                  ${aiSettings.baseUrl && aiSettings.model ? '已配置 · ' + escapeHtml(aiSettings.model) : '尚未配置模型'}</div>
                <div class="ai-status-note">测试连接会发送一条 max_tokens=10 的请求；异步 Pipeline 会在生图时后台润色下一组。</div>
              </div>
            </div>
          </div>
          <div class="ai-foot-actions">
            <button type="button" id="aiTestBtn" class="btn btn-sm"><svg class="icon"><use href="#icon-plug"/></svg>测试连接</button>
            <button type="button" id="aiSaveBtn" class="btn btn-sm btn-primary"><svg class="icon"><use href="#icon-check"/></svg>保存设置</button>
          </div>
        </section>

        <section class="ai-pane" data-pane="preset" style="display:none">
          <div class="ai-label">系统预设 <span>只在首次通信或通信中断时发送一次</span></div>
          <textarea id="aiPresetTa" class="ai-preset-ta" spellcheck="false">${escapeHtml(aiPreset.preset || '')}</textarea>
          <div class="ai-status-note" style="margin-top:8px">建议写清：角色、输出结构、语言、长度、禁止项。保存后立即生效。</div>
          <div class="ai-foot-actions">
            <button type="button" id="aiPresetSave" class="btn btn-sm btn-primary"><svg class="icon"><use href="#icon-check"/></svg>保存预设</button>
          </div>
        </section>

        <section class="ai-pane" data-pane="history" style="display:none">
          <div class="ai-hist-head"><span>最近 ${aiHistory.length} 次润色</span>
            ${aiHistory.length ? '<button type="button" id="aiHistClear" class="btn btn-sm danger">清空历史</button>' : ''}
          </div>
          <div class="ai-hist-list">${hist || '<div class="pm-empty">暂无润色记录</div>'}</div>
        </section>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const tabs = Array.from(ov.querySelectorAll('.ai-tab'));
  const panes = Array.from(ov.querySelectorAll('.ai-pane'));
  function showTab(name) {
    tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === name));
    panes.forEach(p => { p.style.display = p.dataset.pane === name ? '' : 'none'; });
  }
  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  showTab(tab);

  ov.querySelector('.pm-close').onclick = () => ov.remove();

  const ps = ov.querySelector('#aiProvider');
  const uir = ov.querySelector('#aiBaseUrl');
  const ki = ov.querySelector('#aiApiKey');
  const mi = ov.querySelector('#aiModel');
  ps.onchange = () => {
    const p = AI_PROVIDERS[ps.value];
    if (p) {
      uir.value = p.baseUrl;
      ki.classList.toggle('hidden', !p.online);
    }
  };
  if (!(AI_PROVIDERS[aiSettings.provider] || {}).online) ki.classList.add('hidden');

  ov.querySelector('#fetchModelsBtn').onclick = () => fetchModels(uir.value, ki.value, ps.value, mi);
  ov.querySelector('#aiTestBtn').onclick = () => testConnection(uir.value, ki.value, ps.value, mi.value);

  ov.querySelector('#aiSaveBtn').onclick = () => {
    aiSettings.provider = ps.value;
    aiSettings.baseUrl = uir.value.replace(/\/+$/, '');
    aiSettings.apiKey = ki.value;
    aiSettings.model = mi.value;
    const checked = ov.querySelector('input[name="aiPolLang"]:checked');
    if (checked) aiSettings.polishLang = checked.value;
    saveAiSettings();
    updateAiStatus();
    syncPolishLangUI();
    ov.remove();
    showToast('✅ AI 设置已保存', 'success');
  };

  ov.querySelector('#aiPresetSave').onclick = () => {
    aiPreset.preset = ov.querySelector('#aiPresetTa').value;
    saveAiPreset();
    ov.remove();
    showToast('✅ 预设已保存', 'success');
  };

  const clr = ov.querySelector('#aiHistClear');
  if (clr) clr.onclick = async () => {
    if (await uiConfirm('确定清空所有润色记录？', { danger: true, okText: '清空' })) {
      aiHistory = [];
      saveAiHistory();
      ov.remove();
      showToast('🗑️ 已清空历史', 'success');
    }
  };
  ov.querySelectorAll('.ai-hist-copy').forEach(b => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copy || '').then(
        () => showToast('✅ 已复制润色结果', 'success'),
        () => showToast('⚠️ 复制失败', 'error')
      );
    };
  });
}

function openAiPreset() { openAiSettings('preset'); }
function openAiHistory() { openAiSettings('history'); }

function openComfySettings() {
  const old = document.getElementById('comfyModal');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'pm-overlay';
  ov.id = 'comfyModal';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `
    <div class="pm-panel comfy-panel">
      <div class="pm-header">
        <h3><svg class="icon"><use href="#icon-image"/></svg>ComfyUI 设置</h3>
        <span class="pm-header-sub">地址 · 工作流 · 输出</span>
        <span class="comfy-head-status" id="comfyHeadStatus"></span>
        <button class="pm-close" type="button">✕ 关闭</button>
      </div>
      <div class="pm-body comfy-body">
        <div class="comfy-col">
          <section class="comfy-block">
            <div class="comfy-block-title">连接</div>
            <div class="ai-label">ComfyUI 地址</div>
            <div class="comfy-inline">
              <input id="comfyUrl" class="ai-settings-input" value="${escapeHtml(comfySettings.url || '')}" placeholder="http://127.0.0.1:8188">
              <button type="button" id="comfyDetectBtn" class="btn btn-sm">检测</button>
            </div>
            <div class="comfy-status-line" id="comfyStat">状态：${comfyConnected ? '🟢 已连接' : '🔴 未连接'}</div>
            <label class="comfy-check"><input type="checkbox" id="comfyUseProxy" ${comfySettings.useProxy ? 'checked' : ''}>使用代理（同源转发，解决跨域）</label>
            <div class="comfy-hint" id="comfyProxyHint"></div>
          </section>

          <section class="comfy-block">
            <div class="comfy-block-title">输出设置</div>
            <div class="ai-label">尺寸（px）</div>
            <div class="comfy-dim-row">
              <input id="comfyWidth" type="number" step="1" value="${comfySettings.width}">
              <span>×</span>
              <input id="comfyHeight" type="number" step="1" value="${comfySettings.height}">
              <button type="button" id="comfyDetectSizeBtn" class="btn btn-sm" title="从工作流读取">自动检测</button>
            </div>
            <div class="comfy-two">
              <div><div class="ai-label">提示词数量</div><input id="comfyRandCnt" class="ai-settings-input" type="number" step="1" value="${comfySettings.randomCount}"></div>
              <div><div class="ai-label">生图批次</div><input id="comfyBatchCnt" class="ai-settings-input" type="number" step="1" value="${comfySettings.batchCount}"></div>
            </div>
            <div class="ai-label">发送语言</div>
            <label class="comfy-check"><input type="radio" name="comfyLang" value="en" ${comfySettings.language === 'en' ? 'checked' : ''}>English 英文</label>
            <label class="comfy-check"><input type="radio" name="comfyLang" value="cn" ${comfySettings.language === 'cn' ? 'checked' : ''}>中文 Chinese</label>
            <label class="comfy-check"><input type="checkbox" id="comfyShutdown" ${comfySettings.autoShutdown ? 'checked' : ''}>生图完成后自动关机</label>
          </section>
        </div>

        <div class="comfy-col">
          <section class="comfy-block comfy-wf-block">
            <div class="comfy-block-title">工作流 <span id="comfyWfCount">${comfyWorkflows.length} 个</span></div>
            <div id="comfyWfList" class="comfy-wf-list"></div>
            <button type="button" id="comfyUploadBtn" class="btn btn-sm comfy-upload-btn"><svg class="icon"><use href="#icon-upload"/></svg>上传工作流 JSON（推荐 API 格式）</button>
            <div class="comfy-node-info" id="comfyNodeInfo">📂 请先选择工作流</div>
          </section>
          <section class="comfy-block">
            <div class="comfy-block-title">说明</div>
            <div class="comfy-li">· 提示词数量 × 生图批次 = 本次总张数</div>
            <div class="comfy-li">· 优先使用 ComfyUI 的 Save (API Format) 导出</div>
            <div class="comfy-li">· 普通界面格式会自动转换，节点 ID 重新映射</div>
            <div class="comfy-li">· 生成时可在主界面查看进度与实时画廊</div>
          </section>
        </div>
      </div>
      <div class="pm-footer">
        <span class="pm-foot-note">保存到本地 data/comfy_settings.json</span>
        <button type="button" id="comfySaveBtn" class="btn btn-sm btn-primary"><svg class="icon"><use href="#icon-check"/></svg>保存设置</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const cUrl = ov.querySelector('#comfyUrl');
  const cStat = ov.querySelector('#comfyStat');
  const wfList = ov.querySelector('#comfyWfList');
  const nodeInfo = ov.querySelector('#comfyNodeInfo');
  const headStatus = ov.querySelector('#comfyHeadStatus');
  const proxyHint = ov.querySelector('#comfyProxyHint');

  function syncStatus() {
    cStat.innerHTML = '状态：' + (comfyConnected ? '🟢 已连接' : '🔴 未连接');
    headStatus.innerHTML = `<span class="dot ${comfyConnected ? 'green' : 'red'}"></span>${comfyConnected ? '已连接' : '未连接'}`;
  }
  syncStatus();

  proxyHint.textContent = (window.location.origin && window.location.origin.startsWith('http'))
    ? '代理地址：' + window.location.origin + '/comfy-proxy'
    : '需通过 HTTP 服务打开页面才可使用代理';

  function renderWfList() {
    wfList.innerHTML = '';
    if (!comfyWorkflows.length) {
      wfList.innerHTML = '<div class="pm-empty" style="padding:14px">暂无工作流，请上传</div>';
      return;
    }
    comfyWorkflows.forEach((wf, i) => {
      const row = document.createElement('div');
      row.className = 'comfy-wf-item' + (i === comfySettings.selectedWorkflow ? ' active' : '');
      row.innerHTML = `<svg class="icon"><use href="#icon-doc"/></svg><span class="wf-name">${escapeHtml(wf.name)}</span>` +
        (i === comfySettings.selectedWorkflow ? '<span class="wf-active">✓ 当前</span>' : '') +
        `<span class="wf-actions"><button type="button" data-act="use" data-i="${i}">选择</button><button type="button" class="wf-del" data-act="del" data-i="${i}">删除</button></span>`;
      wfList.appendChild(row);
    });
    wfList.querySelectorAll('button[data-act]').forEach(btn => {
      btn.onclick = async () => {
        const i = parseInt(btn.dataset.i, 10);
        if (btn.dataset.act === 'use') {
          selectComfyWorkflow(i);
          ov.querySelector('#comfyWidth').value = comfySettings.width;
          ov.querySelector('#comfyHeight').value = comfySettings.height;
          renderWfList();
          updateNodeInfo();
          updateRightPanel();
        } else {
          await deleteComfyWorkflow(i);
          renderWfList();
          ov.querySelector('#comfyWidth').value = comfySettings.width;
          ov.querySelector('#comfyHeight').value = comfySettings.height;
          updateNodeInfo();
        }
      };
    });
    ov.querySelector('#comfyWfCount').textContent = comfyWorkflows.length + ' 个';
  }

  function updateNodeInfo() {
    if (comfySettings.selectedWorkflow >= 0 && comfySettings.selectedWorkflow < comfyWorkflows.length) {
      const nodes = findPromptNodes(comfyWorkflows[comfySettings.selectedWorkflow].data);
      nodeInfo.textContent = `🔍 已检测 ${nodes.length} 个 CLIPTextEncode 节点，将替换第 1 个的提示词`;
    } else {
      nodeInfo.textContent = '📂 请先选择工作流';
    }
  }

  renderWfList();
  updateNodeInfo();

  ov.querySelector('#comfyUploadBtn').onclick = () => document.getElementById('comfyFileInput').click();
  ov.querySelector('#comfyDetectSizeBtn').onclick = () => {
    autoDetectSize();
    ov.querySelector('#comfyWidth').value = comfySettings.width;
    ov.querySelector('#comfyHeight').value = comfySettings.height;
    updateNodeInfo();
  };
  ov.querySelector('#comfyDetectBtn').onclick = async () => {
    comfySettings.url = cUrl.value.replace(/\/+$/, '');
    saveComfySettings();
    await checkComfyConnection();
    syncStatus();
  };
  ov.querySelector('#comfySaveBtn').onclick = () => {
    comfySettings.url = cUrl.value.replace(/\/+$/, '');
    comfySettings.width = Math.max(1, parseInt(ov.querySelector('#comfyWidth').value, 10) || 512);
    comfySettings.height = Math.max(1, parseInt(ov.querySelector('#comfyHeight').value, 10) || 512);
    comfySettings.randomCount = Math.max(1, parseInt(ov.querySelector('#comfyRandCnt').value, 10) || 1);
    comfySettings.batchCount = Math.max(1, parseInt(ov.querySelector('#comfyBatchCnt').value, 10) || 1);
    comfySettings.useProxy = ov.querySelector('#comfyUseProxy').checked;
    const lang = ov.querySelector('input[name="comfyLang"]:checked');
    if (lang) comfySettings.language = lang.value;
    comfySettings.autoShutdown = ov.querySelector('#comfyShutdown').checked;
    saveComfySettings();
    loadShutdownUI();
    ov.remove();
    updateRightPanel();
    showToast('✅ ComfyUI 设置已保存', 'success');
  };
  ov.querySelector('.pm-close').onclick = () => ov.remove();
}

// 焦点在输入框/文本域时不触发，避免误把正在手动编辑的提示词覆盖掉
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return;
    randomPrompt();
  }
});

// Start
init();