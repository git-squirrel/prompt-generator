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
let enrichCN = [], enrichEN = [], skinCN = [], skinEN = [], qualityCN = [], qualityEN = [];

let promptsEnabled = {};
let DATA = null;

// ============================================================
// Storage key mapping: shortName -> serverKey
// ============================================================
const STORAGE_TO_SERVER = {
  prompts_data: 'pg_prompts_data',
  prompts_data_enabled: 'pg_prompts_data_enabled',
  identity_regions: 'pg_identity_regions',
  identity_genders: 'pg_identity_genders',
  identity_age: 'pg_identity_age',
  identity_age_random: 'pg_identity_age_random',
  identity_region_random: 'pg_identity_region_random',
  identity_gender_random: 'pg_identity_gender_random',
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
  prompts: ['prompts_data','prompts_data_enabled','identity_regions','identity_genders','identity_age','identity_age_random','identity_region_random','identity_gender_random','enrichCN','enrichEN','skinCN','skinEN','qualityCN','qualityEN'],
  ai: ['ai_settings','ai_preset','ai_history'],
  comfy: ['comfy_settings','comfy_workflows','comfy_gallery']
};

// ============================================================
// SECTION 2: Utility Functions
// ============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, parseInt(el.dataset.minHeight || '60')) + 'px';
}

function resizePromptAreas() {
  autoResizeTextarea(document.getElementById('promptArea'));
  autoResizeTextarea(document.getElementById('promptEnArea'));
}

let toastTimer = null;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show';
  el.style.color = type === 'error' ? '#ef4444' : '#34d399';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ============================================================
// SECTION 3: Identity Helpers (deduplicated)
// ============================================================

let identityRegions = [], identityGenders = [], identityAge = {};
let identityAgeRandom = false, identityRegionRandom = false, identityGenderRandom = false;

function defaultIdentityRegions() { return ['中国', '韩国', '日本', '欧美']; }
function defaultIdentityGenders() { return ['女', '男']; }
function defaultIdentityAge() { return { min: 18, max: 49 }; }

function _resolveIdentityValues() {
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
  return { age, region, gender };
}

function getIdentityPrefix() {
  const { age, region, gender } = _resolveIdentityValues();
  return `${region}，${age}岁${gender ? '，' + gender : ''}`;
}

function getIdentityEn() {
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
  if (preview) preview.textContent = getIdentityPrefix();
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
}

function saveIdentitySettings() {
  storage.set('identity_regions', identityRegions);
  storage.set('identity_genders', identityGenders);
  storage.set('identity_age', identityAge);
  storage.setBool('identity_age_random', identityAgeRandom);
  storage.setBool('identity_region_random', identityRegionRandom);
  storage.setBool('identity_gender_random', identityGenderRandom);
  syncAllToServer();
}

function renderIdentityBar() {
  const regionSel = document.getElementById('regionSelect');
  const genderSel = document.getElementById('genderSelect');
  const ageSlider = document.getElementById('ageSlider');
  const ageDisplay = document.getElementById('ageDisplay');
  const ageRandomToggle = document.getElementById('ageRandomToggle');
  const regionRandomToggle = document.getElementById('regionRandomToggle');
  const genderRandomToggle = document.getElementById('genderRandomToggle');

  if (regionSel) {
    const current = regionSel.value || identityRegions[0] || '';
    regionSel.innerHTML = identityRegions.map(r => `<option value="${r}">${r}</option>`).join('');
    if (identityRegions.includes(current)) regionSel.value = current;
  }
  if (genderSel) {
    const current = genderSel.value || identityGenders[0] || '';
    genderSel.innerHTML = identityGenders.map(g => `<option value="${g}">${g}</option>`).join('');
    if (identityGenders.includes(current)) genderSel.value = current;
  }
  if (ageSlider) {
    ageSlider.min = identityAge.min || 18;
    ageSlider.max = identityAge.max || 49;
    const val = parseInt(ageSlider.value);
    if (val < ageSlider.min) ageSlider.value = ageSlider.min;
    if (val > ageSlider.max) ageSlider.value = ageSlider.max;
  }
  if (ageDisplay) ageDisplay.textContent = ageSlider ? ageSlider.value : '';
  if (ageRandomToggle) ageRandomToggle.checked = identityAgeRandom;
  if (regionRandomToggle) regionRandomToggle.checked = identityRegionRandom;
  if (genderRandomToggle) genderRandomToggle.checked = identityGenderRandom;
  updateIdentityPreview();
}

function renderIdentityManagement() {
  const regionList = document.getElementById('regionList');
  const genderList = document.getElementById('genderList');
  const ageMinInput = document.getElementById('ageMinInput');
  const ageMaxInput = document.getElementById('ageMaxInput');

  if (regionList) {
    regionList.innerHTML = identityRegions.map((r, i) =>
      `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:11px;">${r}<button onclick="deleteRegion(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:0;line-height:1;">✕</button></span>`
    ).join('');
  }
  if (genderList) {
    genderList.innerHTML = identityGenders.map((g, i) =>
      `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:11px;">${g}<button onclick="deleteGender(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:0;line-height:1;">✕</button></span>`
    ).join('');
  }
  if (ageMinInput) ageMinInput.value = identityAge.min || 18;
  if (ageMaxInput) ageMaxInput.value = identityAge.max || 49;
}

function addRegion() {
  const input = document.getElementById('newRegionInput');
  const name = input.value.trim();
  if (!name) { showToast('⚠️ 请输入地区名称', 'error'); return; }
  if (identityRegions.includes(name)) { showToast('⚠️ 地区已存在', 'error'); return; }
  identityRegions.push(name);
  input.value = '';
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`✅ 已添加地区「${name}」`, 'success');
}

function deleteRegion(idx) {
  if (idx < 0 || idx >= identityRegions.length) return;
  const name = identityRegions[idx];
  if (!confirm(`确定删除地区「${name}」？`)) return;
  identityRegions.splice(idx, 1);
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`🗑️ 已删除地区「${name}」`, 'success');
}

function addGender() {
  const input = document.getElementById('newGenderInput');
  const name = input.value.trim();
  if (!name) { showToast('⚠️ 请输入性别', 'error'); return; }
  if (identityGenders.includes(name)) { showToast('⚠️ 性别已存在', 'error'); return; }
  identityGenders.push(name);
  input.value = '';
  saveIdentitySettings();
  renderIdentityBar();
  renderIdentityManagement();
  showToast(`✅ 已添加性别「${name}」`, 'success');
}

function deleteGender(idx) {
  if (idx < 0 || idx >= identityGenders.length) return;
  const name = identityGenders[idx];
  if (!confirm(`确定删除性别「${name}」？`)) return;
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
// SECTION 5: Enrich Template Management
// ============================================================

const ENRICH_TYPES = [
  { key: 'enrichCN', label: '🌄 场景描述 (CN)', color: '#7c5cfc' },
  { key: 'enrichEN', label: '🌄 Scene Description (EN)', color: '#a78bfa' },
  { key: 'skinCN', label: '👩 皮肤描述 (CN)', color: '#f59e0b' },
  { key: 'skinEN', label: '👩 Skin Description (EN)', color: '#fbbf24' },
  { key: 'qualityCN', label: '✨ 画质描述 (CN)', color: '#34d399' },
  { key: 'qualityEN', label: '✨ Quality Description (EN)', color: '#6ee7b7' }
];

function getEnrichArray(key) {
  switch (key) {
    case 'enrichCN': return enrichCN;
    case 'enrichEN': return enrichEN;
    case 'skinCN': return skinCN;
    case 'skinEN': return skinEN;
    case 'qualityCN': return qualityCN;
    case 'qualityEN': return qualityEN;
    default: return [];
  }
}

function saveEnrichData() {
  storage.set('enrichCN', enrichCN);
  storage.set('enrichEN', enrichEN);
  storage.set('skinCN', skinCN);
  storage.set('skinEN', skinEN);
  storage.set('qualityCN', qualityCN);
  storage.set('qualityEN', qualityEN);
  syncAllToServer();
}

function renderEnrichManagement() {
  const container = document.getElementById('enrichMgmtContainer');
  if (!container) return;
  container.innerHTML = '';
  ENRICH_TYPES.forEach(entry => {
    const arr = getEnrichArray(entry.key);
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:10px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--surface2);';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:12px;font-weight:600;color:' + entry.color + ';margin-bottom:5px;display:flex;align-items:center;justify-content:space-between;';
    header.innerHTML = `<span>${entry.label}</span><span style="font-size:10px;color:var(--text2);">${arr.length} 条</span>`;
    section.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:6px;max-height:150px;overflow-y:auto;';
    if (arr.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:10px;color:var(--text2);padding:4px 0;';
      empty.textContent = '(空)';
      list.appendChild(empty);
    } else {
      arr.forEach((item, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;';
        const text = document.createElement('span');
        text.style.cssText = 'flex:1;font-size:10px;color:var(--text);word-break:break-all;line-height:1.3;';
        text.textContent = item;
        const delBtn = document.createElement('button');
        delBtn.textContent = '✕';
        delBtn.style.cssText = 'flex-shrink:0;background:none;border:none;color:var(--red);cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;';
        delBtn.onmouseenter = () => { delBtn.style.background = 'rgba(239,68,68,.15)'; };
        delBtn.onmouseleave = () => { delBtn.style.background = 'none'; };
        delBtn.onclick = () => deleteEnrichItem(entry.key, idx);
        row.appendChild(text);
        row.appendChild(delBtn);
        list.appendChild(row);
      });
    }
    section.appendChild(list);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:4px;';
    const input = document.createElement('input');
    input.id = 'enrichInput_' + entry.key;
    input.placeholder = '输入新模板...';
    input.style.cssText = 'flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 6px;font-size:11px;outline:none;font-family:inherit;';
    input.onkeydown = (e) => { if (e.key === 'Enter') addEnrichItem(entry.key); };
    const addBtn = document.createElement('button');
    addBtn.textContent = '添加';
    addBtn.style.cssText = 'flex-shrink:0;background:' + entry.color + ';color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;font-family:inherit;';
    addBtn.onclick = () => addEnrichItem(entry.key);
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    section.appendChild(addRow);

    container.appendChild(section);
  });
}

function addEnrichItem(key) {
  const input = document.getElementById('enrichInput_' + key);
  if (!input) return;
  const value = input.value.trim();
  if (!value) { showToast('⚠️ 模板内容不能为空', 'error'); return; }
  const arr = getEnrichArray(key);
  arr.push(value);
  input.value = '';
  saveEnrichData();
  renderEnrichManagement();
  showToast('✅ 已添加模板', 'success');
}

function deleteEnrichItem(key, idx) {
  const arr = getEnrichArray(key);
  if (idx < 0 || idx >= arr.length) return;
  const item = arr[idx];
  if (!confirm(`确定删除此模板？\n「${item.slice(0, 60)}」`)) return;
  arr.splice(idx, 1);
  saveEnrichData();
  renderEnrichManagement();
  showToast('🗑️ 已删除模板', 'success');
}

// ============================================================
// SECTION 6: Prompt Generation
// ============================================================

function randomPrompt() {
  const enabledCats = DATA.filter(c => promptsEnabled[c.name]);
  if (enabledCats.length === 0) { showToast('⚠️ 请至少开启一个类别', 'error'); return; }
  const picks = [];
  enabledCats.forEach(cat => { if (cat.items.length) picks.push(cat.items[Math.floor(Math.random() * cat.items.length)]); });
  const identity = getIdentityPrefix();
  const cn = identity + '，' + picks.map(p => p.cn).join('，');
  setPrompt(cn, picks);
  showToast(`✅ 已生成，共 ${enabledCats.length} 个类别`, 'success');
}

function setPrompt(cnText, usedItems) {
  document.getElementById('promptArea').value = cnText;
  syncEn(cnText, usedItems);
  resizePromptAreas();
}

function syncEn(cnText, usedItems) {
  let en = '';
  if (usedItems && usedItems.length) {
    const idEn = getIdentityEn();
    en = idEn + ', ' + usedItems.map(p => p.en.split('/')[0].trim()).join(', ');
  } else {
    const segs = cnText.split(/[，,] /).map(s => s.trim()).filter(Boolean);
    en = segs.map(s => {
      const e = CN_EN_MAP[s];
      if (e) return e.split('/')[0].trim();
      if (DATA) for (const cat of DATA) for (const item of cat.items) if (item.cn === s) return item.en.split('/')[0].trim();
      return s;
    }).join(', ');
  }
  document.getElementById('promptEnArea').value = en;
}

function optimizePrompt() {
  const cnText = document.getElementById('promptArea').value.trim();
  if (!cnText) { showToast('⚠️ 提示词为空，请先生成', 'error'); return; }
  const segments = cnText.split(/[，,]/).map(s => s.trim()).filter(Boolean);

  const hasSceneCN = enrichCN.length > 0, hasSceneEN = enrichEN.length > 0;
  const hasSkinCN = skinCN.length > 0, hasSkinEN = skinEN.length > 0;
  const hasQualCN = qualityCN.length > 0, hasQualEN = qualityEN.length > 0;
  if (!hasSceneCN && !hasSkinCN && !hasQualCN) {
    alert('⚠️ 所有中文描述模板都为空，请先在「管理类别与提示词」→ 润色模板中添加内容');
    return;
  }
  if (!hasSceneEN && !hasSkinEN && !hasQualEN) {
    alert('⚠️ 所有英文描述模板都为空，请先在「管理类别与提示词」→ 润色模板中添加内容');
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

  const base = hasSceneCN ? enrichCN[Math.floor(Math.random() * enrichCN.length)] : '';
  const skin = hasSkinCN ? skinCN[Math.floor(Math.random() * skinCN.length)] : '';
  const qual = hasQualCN ? qualityCN[Math.floor(Math.random() * qualityCN.length)] : '';
  const baseEn = hasSceneEN ? enrichEN[Math.floor(Math.random() * enrichEN.length)] : '';
  const skinEn = hasSkinEN ? skinEN[Math.floor(Math.random() * skinEN.length)] : '';
  const qualEn = hasQualEN ? qualityEN[Math.floor(Math.random() * qualityEN.length)] : '';

  const identityCn = segments.slice(0, identityEnd).join('，');
  const bodyCn = bodySegments.join('，');
  let optimizedCn = '';
  if (base) optimizedCn += base + ' ';
  if (identityCn) optimizedCn += identityCn + '，';
  optimizedCn += bodyCn;
  if (skin) optimizedCn += '。' + skin;
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
  if (skinEn) optimizedEn += '. ' + skinEn;
  if (qualEn) optimizedEn += ' ' + qualEn;

  document.getElementById('promptArea').value = optimizedCn;
  document.getElementById('promptEnArea').value = optimizedEn;
  resizePromptAreas();
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
  resizePromptAreas();
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
  resizePromptAreas();
  ta.focus();
}

function showAllItems(idx) {
  const cat = DATA[idx];
  const existing = document.getElementById('itemModal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'itemModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1a24;border:1px solid #333;border-radius:12px;max-width:600px;width:100%;max-height:75vh;overflow-y:auto;padding:18px;';
  const title = document.createElement('h3');
  title.style.cssText = 'margin-bottom:10px;font-size:15px;';
  title.textContent = `${cat.name} (${cat.items.length} 条)`;
  panel.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ 关闭';
  closeBtn.style.cssText = 'float:right;background:#24242f;border:1px solid #333;color:#888;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px;';
  closeBtn.onclick = () => overlay.remove();
  panel.appendChild(closeBtn);
  const searchInput = document.createElement('input');
  searchInput.placeholder = '搜索...';
  searchInput.style.cssText = 'width:100%;padding:6px 10px;margin-bottom:10px;background:#24242f;border:1px solid #333;border-radius:5px;color:#e0e0ec;font-size:12px;outline:none;';
  panel.appendChild(searchInput);
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';
  panel.appendChild(list);
  function render(filter) {
    list.innerHTML = '';
    (filter ? cat.items.filter(i => i.cn.includes(filter) || i.en.toLowerCase().includes(filter.toLowerCase())) : cat.items).forEach(item => {
      const chip = document.createElement('span');
      chip.textContent = item.cn;
      chip.style.cssText = 'font-size:11px;background:#24242f;color:#888;padding:3px 8px;border-radius:3px;cursor:pointer;';
      chip.onmouseenter = () => { chip.style.background = '#7c5cfc'; chip.style.color = '#fff'; };
      chip.onmouseleave = () => { chip.style.background = '#24242f'; chip.style.color = '#888'; };
      chip.onclick = () => { addToPrompt(item.cn); overlay.remove(); };
      list.appendChild(chip);
    });
    if (!list.children.length) {
      const e = document.createElement('div');
      e.textContent = '无匹配结果';
      e.style.cssText = 'color:#888;font-size:12px;padding:16px;text-align:center;width:100%;';
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
  syncAllToServer();
}

function syncAllToServer() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) return;
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
    if (Object.keys(data).length) {
      fetch('/api/save-' + cat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(() => {});
    }
  });
}

async function loadDataConstants() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) {
    console.log('ℹ️ Data constants initialized (offline, using defaults)');
    return;
  }
  try {
    const r = await fetch('/api/load-prompts', { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const d = await r.json();
      if (d && typeof d === 'object') {
        if (d.identity_en && typeof d.identity_en === 'object') {
          IDENTITY_EN = d.identity_en;
        }
        if (d.cn_en_map && typeof d.cn_en_map === 'object') {
          CN_EN_MAP = d.cn_en_map;
        }
        if (d.enrich_data && typeof d.enrich_data === 'object') {
          if (d.enrich_data.enrichCN) enrichCN = d.enrich_data.enrichCN;
          if (d.enrich_data.enrichEN) enrichEN = d.enrich_data.enrichEN;
          if (d.enrich_data.skinCN) skinCN = d.enrich_data.skinCN;
          if (d.enrich_data.skinEN) skinEN = d.enrich_data.skinEN;
          if (d.enrich_data.qualityCN) qualityCN = d.enrich_data.qualityCN;
          if (d.enrich_data.qualityEN) qualityEN = d.enrich_data.qualityEN;
        }
        // Direct enrich keys as fallback
        const enrichDirectMap = {
          'pg_enrichCN': 'enrichCN', 'pg_enrichEN': 'enrichEN',
          'pg_skinCN': 'skinCN', 'pg_skinEN': 'skinEN',
          'pg_qualityCN': 'qualityCN', 'pg_qualityEN': 'qualityEN'
        };
        for (const [serverKey, localKey] of Object.entries(enrichDirectMap)) {
          if (d[serverKey] !== undefined) {
            const arr = getEnrichArray(localKey);
            arr.length = 0;
            arr.push(...d[serverKey]);
          }
        }
        // localStorage overrides (user edits take priority)
        try {
          const lsEnrichCN = storage.get('enrichCN');
          if (lsEnrichCN) enrichCN = lsEnrichCN;
          const lsEnrichEN = storage.get('enrichEN');
          if (lsEnrichEN) enrichEN = lsEnrichEN;
          const lsSkinCN = storage.get('skinCN');
          if (lsSkinCN) skinCN = lsSkinCN;
          const lsSkinEN = storage.get('skinEN');
          if (lsSkinEN) skinEN = lsSkinEN;
          const lsQualCN = storage.get('qualityCN');
          if (lsQualCN) qualityCN = lsQualCN;
          const lsQualEN = storage.get('qualityEN');
          if (lsQualEN) qualityEN = lsQualEN;
        } catch (e) {
          console.warn('[loadDataConstants] Failed to load enrich from localStorage:', e.message);
        }
        saveEnrichData();
      }
    }
  } catch (e) {
    console.warn('[loadDataConstants] Failed to fetch:', e.message);
  }
  console.log('ℹ️ Data constants initialized (fallback defaults used if server unavailable)');
}

const ENRICH_KEYS = new Set(['enrichCN', 'enrichEN', 'skinCN', 'skinEN', 'qualityCN', 'qualityEN']);

async function loadAllFromServer() {
  if (!window.location.origin || !window.location.origin.startsWith('http')) return false;
  let total = 0;
  for (const cat of ['prompts', 'ai', 'comfy']) {
    try {
      const r = await fetch('/api/load-' + cat, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) continue;
      const data = await r.json();
      if (!data) continue;
      SERVER_KEYS[cat].forEach(k => {
        if (ENRICH_KEYS.has(k)) return;
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
    const card = document.createElement('div');
    card.className = 'cat-card' + (promptsEnabled[cat.name] !== false ? ' enabled' : '');
    card.dataset.idx = idx;
    const header = document.createElement('div');
    header.className = 'cat-header';
    const checked = promptsEnabled[cat.name] !== false ? 'checked' : '';
    let headerHtml = `<div><span class="cat-name">${escapeHtml(cat.name)}</span><span class="cat-count">${cat.items.length}</span></div>`;
    if (isMgmt) {
      headerHtml += `<button class="btn-del" onclick="deleteCategory(${idx})" title="删除此类别">✕</button>`;
    } else {
      headerHtml += `<label class="toggle"><input type="checkbox" ${checked} onchange="toggleCat('${cat.name.replace(/'/g, "\\'")}', this.checked, ${idx})"><span class="slider"></span></label>`;
    }
    header.innerHTML = headerHtml;
    card.appendChild(header);
    const preview = document.createElement('div');
    preview.className = 'cat-preview';
    cat.items.slice(0, 8).forEach(item => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = item.cn;
      chip.title = item.en;
      chip.onclick = () => addToPrompt(item.cn);
      preview.appendChild(chip);
    });
    if (cat.items.length > 8) {
      const more = document.createElement('span');
      more.className = 'chip';
      more.textContent = `+${cat.items.length - 8}`;
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
      card.appendChild(actions);
    }
    grid.appendChild(card);
  });
  document.getElementById('totalItems').textContent = total;
}

function toggleMgmtPanel() {
  const panel = document.getElementById('mgmtPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  renderCategories();
  if (panel.style.display === 'block') {
    renderIdentityManagement();
    renderEnrichManagement();
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

function batchAddCategories() {
  const ta = document.getElementById('batchCatInput');
  const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) { showToast('⚠️ 请输入类别名称，每行一个', 'error'); return; }
  let added = 0;
  lines.forEach(name => {
    if (!DATA.some(c => c.name === name)) {
      DATA.push({ name, file: '', items: [], count: 0 });
      promptsEnabled[name] = true;
      added++;
    }
  });
  ta.value = '';
  if (added === 0) { showToast('⚠️ 所有类别已存在', 'error'); return; }
  saveData();
  renderCategories();
  showToast(`✅ 已批量添加 ${added} 个类别`, 'success');
}

function deleteCategory(idx) {
  const cat = DATA[idx];
  if (!cat) return;
  if (!confirm(`确定要删除类别「${cat.name}」及其所有 ${cat.items.length} 条提示词？`)) return;
  DATA.splice(idx, 1);
  delete promptsEnabled[cat.name];
  saveData();
  renderCategories();
  showToast(`🗑️ 已删除类别「${cat.name}」`, 'success');
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
  batchTa.placeholder = '示例：\n卧室，bedroom\n客厅，living room\n厨房，kitchen';
  const batchBtn = document.createElement('button');
  batchBtn.className = 'btn btn-sm btn-add';
  batchBtn.textContent = '批量添加';
  batchBtn.style.cssText = 'flex-shrink:0;margin-top:0;';
  batchBtn.onclick = () => batchAddPrompts();
  batchRow.appendChild(batchTa);
  batchRow.appendChild(batchBtn);
  container.appendChild(batchRow);
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
  const cn = cat.items[itemIdx].cn;
  cat.items.splice(itemIdx, 1);
  saveData();
  const body = document.getElementById('pmBody');
  if (body) renderPromptManager(body);
  renderCategories();
  showToast(`🗑️ 已删除「${cn}」`, 'success');
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
  if (!tog.checked) { el.textContent = '已关闭'; el.className = 'ai-indicator'; return; }
  if (aiSettings && aiSettings.baseUrl && aiSettings.model) {
    el.textContent = '已配置 ✓';
    el.className = 'ai-indicator on';
  } else {
    el.textContent = '未配置';
    el.className = 'ai-indicator';
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
    clr.onclick = () => {
      if (confirm('确定清空所有润色记录？')) {
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
  const orig = btn.textContent;
  btn.textContent = '⏳ AI 润色中...';
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
    showToast('✅ AI 润色完成', 'success');
  } catch (e) {
    showToast('❌ AI 润色失败: ' + e.message, 'error');
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ============================================================
// SECTION 13: ComfyUI Integration
// ============================================================

let comfySettings = null, comfyWorkflows = [], comfyConnected = false;
let comfyStopped = false, comfyQueueRunning = false;

function defaultComfySettings() {
  return { url: 'http://127.0.0.1:8188', language: 'en', randomCount: 1, batchCount: 1, selectedWorkflow: -1, width: 512, height: 512, useProxy: false, autoShutdown: false, shutdownMinutes: 5 };
}

function loadComfySettings() {
  comfySettings = storage.get('comfy_settings') || defaultComfySettings();
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

function saveShutdownSettings() {
  const tog = document.getElementById('shutdownToggle');
  const min = document.getElementById('shutdownMinutes');
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
  el.innerHTML = comfyConnected ? '🟢 已连接' : '🔴 未连接';
  el.className = comfyConnected ? 'ai-indicator on' : 'ai-indicator';
}

function getComfyBaseUrl() {
  const origin = window.location.origin;
  const onHttp = origin && origin.startsWith('http');
  if (onHttp && comfySettings.useProxy) return origin + '/comfy-proxy';
  return comfySettings.url.replace(/\/+$/, '');
}

async function checkComfyConnection() {
  try {
    const url = getComfyBaseUrl() + '/system_stats';
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    comfyConnected = r.ok;
    if (!comfyConnected) showToast('⚠️ ComfyUI 响应异常（状态码:' + r.status + '）', 'error');
    updateComfyStatus();
    return comfyConnected;
  } catch (e) {
    if (comfySettings.useProxy) {
      comfySettings.useProxy = false;
      saveComfySettings();
      try {
        const url = comfySettings.url.replace(/\/+$/, '') + '/system_stats';
        const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
        comfyConnected = r.ok;
        updateComfyStatus();
        if (comfyConnected) showToast('⚠️ 代理不可用，已切换到直连', 'error');
        return comfyConnected;
      } catch (e2) {
        console.warn('[checkComfyConnection] Direct connection failed:', e2.message);
      }
    }
    const origin = window.location.origin;
    if (origin && origin.startsWith('http') && !comfySettings.useProxy) {
      comfySettings.useProxy = true;
      saveComfySettings();
      return await checkComfyConnection();
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
    } catch (err) {
      showToast('⚠️ 无效的工作流 JSON', 'error');
    }
  };
  r.readAsText(f);
  e.target.value = '';
}

function deleteComfyWorkflow(idx) {
  if (!confirm('删除工作流「' + comfyWorkflows[idx].name + '」？')) return;
  comfyWorkflows.splice(idx, 1);
  if (comfySettings.selectedWorkflow === idx) comfySettings.selectedWorkflow = -1;
  else if (comfySettings.selectedWorkflow > idx) comfySettings.selectedWorkflow--;
  saveComfyWorkflows();
  saveComfySettings();
}

function selectComfyWorkflow(idx) {
  comfySettings.selectedWorkflow = idx;
  saveComfySettings();
  autoDetectSize();
}

function autoDetectSize() {
  if (comfySettings.selectedWorkflow < 0 || comfySettings.selectedWorkflow >= comfyWorkflows.length) return;
  const wf = comfyWorkflows[comfySettings.selectedWorkflow].data;
  for (const n of (wf.nodes || [])) {
    if (n.type === 'EmptyLatentImage' && n.widgets_values && n.widgets_values.length >= 2) {
      comfySettings.width = n.widgets_values[0];
      comfySettings.height = n.widgets_values[1];
      saveComfySettings();
      const we = document.getElementById('comfyWidth'), he = document.getElementById('comfyHeight');
      if (we) we.value = comfySettings.width;
      if (he) he.value = comfySettings.height;
      break;
    }
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
    if (n.type === 'EmptyLatentImage') { if (width) inputs.width = width; if (height) inputs.height = height; }
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
    if (n.class_type === 'EmptyLatentImage') { if (width) inputs.width = width; if (height) inputs.height = height; }
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

function renderComfyGallery() {
  const grid = document.getElementById('galleryGrid');
  const empty = document.getElementById('galleryEmpty');
  const count = document.getElementById('galleryCount');
  if (!grid) return;
  if (count) count.textContent = comfyGallery.length + ' 张';
  if (comfyGallery.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = comfyGallery.map((item, idx) => {
    return `<div class="gallery-item">
      <img src="${item.url}" alt="gallery" loading="lazy" onclick="openGalleryModal(${idx})">
      ${item.badge ? `<span class="gallery-badge">#${item.badge}</span>` : ''}
      <div class="gallery-item-actions">
        <button onclick="event.stopPropagation();downloadGalleryImg(${idx})" title="下载">⬇️</button>
        <button class="btn-g-del" onclick="event.stopPropagation();deleteGalleryItem(${idx})" title="删除">✕</button>
      </div>
    </div>`;
  }).join('');
}

function addToComfyGallery(imgUrl, badge, prompt, seed) {
  comfyGallery.unshift({ url: imgUrl, badge: String(badge || ''), ts: Date.now(), prompt: prompt || '', seed: seed || '' });
  if (comfyGallery.length > 200) comfyGallery = comfyGallery.slice(0, 200);
  saveComfyGallery();
  renderComfyGallery();
}

function clearComfyGallery() {
  if (!confirm('确定清空所有图片？')) return;
  comfyGallery = [];
  saveComfyGallery();
  renderComfyGallery();
  showToast('🗑️ 画廊已清空', 'success');
}

let _currentModalIdx = -1;

function openGalleryModal(idx) {
  const item = comfyGallery[idx];
  if (!item) return;
  _currentModalIdx = idx;
  const modal = document.getElementById('imgModal');
  const img = document.getElementById('imgModalImg');
  const promptEl = document.getElementById('imiPromptText');
  const seedEl = document.getElementById('imiSeedText');
  if (!modal || !img) return;
  img.src = item.url;
  if (promptEl) promptEl.textContent = item.prompt || '(无记录)';
  if (seedEl) seedEl.textContent = item.seed || '(无记录)';
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeImgModal() {
  const modal = document.getElementById('imgModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.getElementById('imgModalImg').src = '';
  _currentModalIdx = -1;
  document.body.style.overflow = '';
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

function deleteGalleryItem(idx) {
  if (idx < 0 || idx >= comfyGallery.length) return;
  if (!confirm('确定删除这张图片？')) return;
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
  const wrap = document.getElementById('comfyProgressWrap');
  if (wrap) wrap.style.display = 'none';
}

function _fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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

async function _pollComfyUI(pid, steps) {
  const url = getComfyBaseUrl() + '/api/history/' + pid;
  const startTime = Date.now();
  for (let i = 1; i <= 300; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const elapsed = (Date.now() - startTime) / 1000;
    try {
      const r = await fetch(url);
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
          images.push(baseUrl + '/api/view?filename=' + encodeURIComponent(img.filename) +
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
    let promptText = '';
    const ec = DATA.filter(c => promptsEnabled[c.name]);
    if (ec.length > 0) {
      if (comfySettings.language === 'en') {
        promptText = ec.map(c => {
          const item = c.items[Math.floor(Math.random() * c.items.length)];
          return item ? item.en.split('/')[0].trim() : '';
        }).filter(Boolean).join(', ');
      } else {
        const picks = [];
        ec.forEach(c => { if (c.items.length) picks.push(c.items[Math.floor(Math.random() * c.items.length)]); });
        promptText = getIdentityPrefix() + '，' + picks.map(p => p.cn).join('，');
      }
    }
    if (!promptText) {
      promptText = comfySettings.language === 'en'
        ? (enArea.value.trim() || cnArea.value.trim())
        : cnArea.value.trim();
      if (!promptText) { showToast('⚠️ 提示词为空', 'error'); return { cn: '', en: '' }; }
    }
    if (comfySettings.language === 'en') {
      enArea.value = promptText;
      cnArea.value = promptText;
    } else {
      cnArea.value = promptText;
      const enParts = ec.map(c => {
        const item = c.items[Math.floor(Math.random() * c.items.length)];
        return item ? item.en.split('/')[0].trim() : '';
      }).filter(Boolean);
      enArea.value = getIdentityEn() + ', ' + enParts.join(', ');
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
    const cnFinal = comfySettings.language === 'en' ? '' : (cnArea.value.trim() || '');
    const enFinal = comfySettings.language === 'en' ? (enArea.value.trim() || '') : enArea.value.trim();
    const finalPromptText = comfySettings.language === 'en' ? enFinal : cnFinal;
    return { cn: finalPromptText, en: finalPromptText === cnFinal ? enFinal : cnFinal, rawCn: cnArea.value.trim(), rawEn: enArea.value.trim() };
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
  btn.textContent = '⏳ 生成中...';
  stopBtn.style.display = 'inline';
  comfyStopped = false;
  comfyQueueRunning = true;
  const total = comfySettings.randomCount * comfySettings.batchCount;
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

      const finalPrompt = comfySettings.language === 'en' ? currentPrompt.en : currentPrompt.cn;
      if (!finalPrompt) { showToast('⚠️ 提示词为空，跳过', 'error'); continue; }

      const batchResults = [];
      for (let b = 0; b < comfySettings.batchCount; b++) {
        if (comfyStopped) { completed += comfySettings.batchCount - b; break; }
        completed++;
        const elapsed = (Date.now() - startTime) / 1000;
        _updateProgress(`🚀 发送第 ${completed}/${total}`, completed, total, elapsed);
        const seed = Math.floor(Math.random() * 2147483647) + 1;
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
        const historyData = await _pollComfyUI(br.result.prompt_id, steps);
        const imgs = _extractImages(historyData);
        for (const imgUrl of imgs) {
          addToComfyGallery(imgUrl, completed, br.prompt, br.seed);
        }
      }
      _updateProgress(`✅ 已完成 ${completed}/${total}`, completed, total, (Date.now() - startTime) / 1000);

      if (prepPromise) {
        nextPrompt = await prepPromise;
        if (!nextPrompt.cn) { showToast('⚠️ 提示词准备失败', 'error'); break; }
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
    showToast('❌ 生图失败: ' + e.message.slice(0, 150), 'error');
    _updateProgress(`❌ ${e.message.slice(0, 50)}`, completed, total, (Date.now() - startTime) / 1000);
  } finally {
    btn.disabled = false;
    btn.textContent = comfyStopped ? '🔄 重新开始' : '🚀 开始生图';
    stopBtn.style.display = 'none';
    comfyQueueRunning = false;
    if (comfyStopped) _updateProgress('⏹ 已中止', 0, 0, 0);
    else setTimeout(_hideProgress, 6000);
  }
}

function stopComfyGeneration() {
  comfyStopped = true;
  showToast('⏹ 正在中止生图...', 'success');
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
  rbRow.appendChild(makeNumberInput('comfyRandCnt', '随机提示词数量', comfySettings.randomCount, 1, 50));
  rbRow.appendChild(makeNumberInput('comfyBatchCnt', '生图批次', comfySettings.batchCount, 1, 20));
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
  prompts: { keys: ['prompts_data','prompts_data_enabled','identity_regions','identity_genders','identity_age','identity_age_random','identity_region_random','identity_gender_random','enrichCN','enrichEN','skinCN','skinEN','qualityCN','qualityEN'], name: '提示词与类别' },
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
  URL.revokeObjectURL(a.href);
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

function exportAllData() {
  const sel = prompt(
    '选择要导出的文件（输入编号）：\n\n' +
    '1. 提示词数据（prompts）\n' +
    '2. AI 润色设置（ai_settings）\n' +
    '3. ComfyUI 设置（comfy_settings）\n' +
    '4. 服务配置（server_config）\n\n' +
    '输入 1-4，直接取消则不导出',
    '1'
  );
  if (sel === null) return;
  const idx = parseInt(sel.trim());
  if (idx === 1) _exportGroup('prompts', BACKUP_GROUPS.prompts);
  else if (idx === 2) _exportGroup('ai', BACKUP_GROUPS.ai);
  else if (idx === 3) _exportGroup('comfy', BACKUP_GROUPS.comfy);
  else if (idx === 4) _exportServerConfig();
  else { showToast('⚠️ 请输入 1-4', 'error'); return; }
  const names = ['', '提示词数据', 'AI 润色设置', 'ComfyUI 设置', '服务配置'];
  showToast(`✅ 已导出：${names[idx]}`, 'success');
}

function importAllData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fname = file.name.toLowerCase();
  const reader = new FileReader();
  reader.onload = function (e) {
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
        const sel = prompt(
          '选择要导入的类别（输入编号，逗号分隔）：\n\n' +
          cats.map((c, i) => `${i + 1}. ${BACKUP_GROUPS[c].name}`).join('\n') +
          '\n\n全部导入请直接回车',
          '1,2,3'
        );
        if (sel === null) { event.target.value = ''; return; }
        idxs = sel.trim() ? sel.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < cats.length) : cats.map((_, i) => i);
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

async function init() {
  if (window.location.origin && window.location.origin.startsWith('http')) {
    const loaded = await loadAllFromServer();
    if (loaded) { console.log('✅ Data restored from server backup'); }
  }
  await loadDataConstants();

  const savedData = storage.get('prompts_data');
  const savedEnabled = storage.get('prompts_data_enabled');
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
  setTimeout(() => checkComfyConnection(), 500);
}

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') randomPrompt();
});

// Start
init();