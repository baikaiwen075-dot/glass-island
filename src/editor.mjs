import { TYPES, LABELS } from './model.mjs';
import { icon } from './icons.mjs';
import { content, esc, stylePanel, tickClocks } from './components.mjs';
const $ = selector => document.querySelector(selector);
let state, selected, scale = 1, dragging = false, toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200); }
async function call(action, payload) {
  const reply = await window.island.call(action, payload);
  if (!reply.ok) { toast(reply.error); throw new Error(reply.error); }
  return reply.value;
}
// UI errors are surfaced once in the toast, including operating-system dialog failures.
function run(action, payload) { return call(action, payload).catch(() => undefined); }
function patch(values) { return run('panel:update', { id: selected, patch: values }); }
function current() { return state.panels.find(p => p.id === selected); }
function drawIcons(root = document) { for (const node of root.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon, node.closest('.sidebar-heading') ? 14 : 18); }
function select(id) { selected = id; render(); }
function resizeCanvas() {
  scale = $('.canvas-wrap').clientWidth / 1440;
  $('#canvas').style.transform = `scale(${scale})`;
  $('#zoom-label').textContent = `${Math.round(scale * 100)}%`;
}
function render() {
  if (!state) return;
  if (!state.panels.some(p => p.id === selected)) selected = state.panels[0]?.id;
  $('#panel-count').textContent = state.panels.length;
  $('#visible-count').textContent = `${state.panels.filter(p => p.visible).length} 个显示中`;
  $('#layers').innerHTML = state.panels.map(p => `<div class="layer ${p.id === selected ? 'selected' : ''}"><button class="layer-select" data-select="${p.id}"><span class="layer-icon">${icon(p.type, 17)}</span><span>${esc(p.title)}</span>${p.locked ? icon('lock', 12) : ''}</button><button class="icon-button visibility ${!p.visible ? 'dim' : ''}" data-visible="${p.id}" aria-label="${p.visible ? '隐藏' : '显示'}${esc(p.title)}">${icon(p.visible ? 'eye' : 'hidden', 15)}</button></div>`).join('');
  $('#desktop-label').textContent = state.desktopEnabled ? '隐藏桌面面板' : '显示到桌面';
  $('#desktop-button').classList.toggle('is-enabled', state.desktopEnabled);
  $('#material-status').textContent = state.desktopError ? '桌面停留暂不可用' : state.desktopIntegrated ? '桌面玻璃模式已就绪' : '半透明窗口模式';
  $('#material-status').title = state.desktopError || '';
  $('#save-status').innerHTML = state.saveError ? `${icon('help', 14)} 保存失败` : `${icon('check', 14)} 自动保存`;
  $('#save-status').classList.toggle('error', Boolean(state.saveError));
  $('#save-status').title = state.saveError || '修改会自动保存在本机';
  $('#startup-toggle').checked = state.startup.enabled;
  $('#startup-hint').textContent = state.startup.error ? '启动项读取失败' : state.startup.registered && !state.startup.enabled ? '已被 Windows 禁用，可重新开启' : '登录后只显示桌面组件';
  $('#startup-hint').title = state.startup.error || state.startup.path;
  const wallpaper = state.wallpaper || (state.useSystemWallpaper ? state.desktopWallpaper : '');
  for (const button of document.querySelectorAll('[data-theme]')) button.classList.toggle('active', state.theme === button.dataset.theme && !wallpaper && !state.useSystemWallpaper);
  $('#desktop-scene').classList.toggle('active', state.useSystemWallpaper && !state.wallpaper);
  $('#canvas').className = `canvas ${state.theme}${wallpaper ? ' custom-wallpaper' : ''}`;
  $('#canvas').style.backgroundImage = wallpaper ? `url("${wallpaper}")` : '';
  $('#empty-state').hidden = state.panels.some(p => p.visible);
  if (!dragging) renderPanels();
  if (!$('#inspector').contains(document.activeElement) || !document.hasFocus()) renderInspector();
}
function renderPanels() {
  const root = $('#panels'); root.innerHTML = '';
  for (const p of state.panels.filter(p => p.visible)) {
    const wrapper = document.createElement('div');
    wrapper.className = `preview-panel ${selected === p.id ? 'is-selected' : ''} ${p.locked ? 'is-locked' : ''}`;
    wrapper.dataset.id = p.id;
    Object.assign(wrapper.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.width}px`, height: `${p.height}px` });
    wrapper.innerHTML = `<div class="glass-panel">${content(p, false, state.applications)}</div>${selected === p.id ? `<span class="selection-label">${esc(p.title)} ${p.locked ? icon('lock', 13) : ''}</span>${!p.locked ? '<button class="resize-handle" aria-label="拖动调整尺寸"></button>' : ''}` : ''}`;
    stylePanel(wrapper, p); root.append(wrapper);
  }
  tickClocks(root, state.panels);
}
function range(field, label, value, min, max, unit) {
  return `<div class="range-row"><label for="field-${field}">${label}</label><output id="output-${field}">${value}${unit}</output></div><input id="field-${field}" data-field="${field}" type="range" min="${min}" max="${max}" value="${value}" data-unit="${unit}">`;
}
function toggle(field, label, checked, hint = '') { return `<label class="toggle-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''}><span class="switch"></span></label>`; }
function renderInspector() {
  const p = current();
  if (!p) { $('#inspector').innerHTML = '<div class="no-selection">选中一个面板，<br>让它成为你的样子。</div>'; return; }
  let editing = '';
  if (['note', 'glass'].includes(p.type)) editing = `<label class="field-label" for="content-text">${p.type === 'note' ? '便签内容' : '显示文字'}</label><textarea id="content-text" data-content="text" rows="6" maxlength="20000" placeholder="写下此刻的想法…">${esc(p.data.text)}</textarea>`;
  if (p.type === 'todo') editing = `<label class="field-label" for="content-items">每行一项待办</label><textarea id="content-items" data-content="items" rows="6" maxlength="20000" placeholder="今天想完成的事…">${esc(p.data.items.map(i => i.text).join('\n'))}</textarea><p class="field-hint">点击画布或桌面上的复选框完成待办。</p>`;
  if (p.type === 'clock') editing = `${toggle('hour24', '24 小时制', p.data.hour24)}${toggle('seconds', '显示秒数', p.data.seconds)}`;
  if (p.type === 'calendar') editing = '<p class="field-hint">在桌面或画布上点击 ‹ / › 查看上月、下月，点击“本月”恢复跟随系统日期。仅当月高亮今天。</p>';
  if (p.type === 'links') editing = `<div class="pinned-list">${state.applications.filter(a => a.pinned).map(a => `<div class="pinned-entry">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : icon('monitor', 20)}<span>${esc(a.name)}</span><button class="icon-button" data-app-move="${a.id}" data-direction="-1" aria-label="前移">‹</button><button class="icon-button" data-app-move="${a.id}" data-direction="1" aria-label="后移">›</button><button class="icon-button" data-unpin="${a.id}" aria-label="取消固定">${icon('close', 13)}</button></div>`).join('') || '<p class="field-hint">把你常用的软件固定到这里。</p>'}</div><button id="pick-apps" class="button outline full-width">${icon('plus', 15)} 添加本机软件</button><button id="manage-apps" class="button subtle full-width">${icon('grid', 15)} 打开应用大面板</button><p class="field-hint">支持桌面 LNK 快捷方式和 EXE，也可以将文件拖到 Dock 上。原文件保持原位。</p>`;
  if (p.type === 'links') editing += toggle('showLabels', '显示软件名称', p.data.showLabels);
  if (p.type === 'links') editing += toggle('autoHide', '自动隐藏 Dock', p.data.autoHide, '离开后隐藏，移回原范围显示');
  $('#inspector').innerHTML = `<section class="inspector-section panel-identity"><div class="identity-icon">${icon(p.type, 23)}</div><div><strong>${esc(p.title)}</strong><span>${LABELS[p.type]}组件</span></div><span class="identity-dot"></span></section>
    <section class="inspector-section"><div class="section-label">基本信息 <span>BASIC</span></div><label class="field-label" for="panel-title">面板名称</label><input id="panel-title" data-field="title" maxlength="60" value="${esc(p.title)}"><div class="dimensions">${['x', 'y', 'width', 'height'].map((key, i) => `<label><span>${['X', 'Y', '宽度', '高度'][i]}</span><input aria-label="${['横向位置', '纵向位置', '宽度', '高度'][i]}" data-field="${key}" type="number" value="${p[key]}" min="${i > 1 ? i === 2 ? 180 : p.type === 'links' ? 80 : 120 : -20000}" max="${i > 1 ? 1000 : 20000}"></label>`).join('')}</div></section>
    <section class="inspector-section"><div class="section-label">玻璃材质 <span>MATERIAL</span></div><div class="material-presets"><button data-preset="transparent" title="完全透明，只显示文字与图标">全透明</button><button data-preset="clear" title="清透玻璃">清透</button><button data-preset="frosted" title="磨砂玻璃">磨砂</button><button data-preset="ink" title="深色玻璃">墨色</button></div>${range('opacity', '背景不透明度', p.opacity, 0, 100, '%')}${range('blur', '预览模糊', p.blur, 0, 64, ' px')}${range('radius', '圆角大小', p.radius, 0, 48, ' px')}<div class="color-row"><label>玻璃底色<input type="color" data-field="tint" value="${p.tint}" aria-label="玻璃底色"></label><label>文字颜色<input type="color" data-field="textColor" value="${p.textColor}" aria-label="文字颜色"></label></div><p class="field-hint material-hint">0% 为完全透明，去掉底色、边框和阴影；文字图标保持清晰。模糊仅用于画布预览。</p></section>
    <section class="inspector-section"><div class="section-label">组件内容 <span>CONTENT</span></div>${editing}</section>
    <section class="inspector-section"><div class="section-label">桌面行为 <span>BEHAVIOR</span></div>${toggle('visible', '显示面板', p.visible)}${toggle('locked', '锁定位置', p.locked, '内容仍然可以编辑')}${toggle('alwaysOnTop', '始终置顶', p.alwaysOnTop)}<label class="toggle-row"><span>全局鼠标穿透<small>Ctrl + Shift + L 恢复交互</small></span><input id="clickthrough" type="checkbox" ${state.clickThrough ? 'checked' : ''}><span class="switch"></span></label></section>
    <section class="inspector-section inspector-operations"><button id="duplicate-panel" class="button outline">${icon('copy', 15)} 复制面板</button><button id="delete-panel" class="icon-button danger" aria-label="删除面板">${icon('trash', 17)}</button></section>`;
}
function accept(next) { state = next; render(); }
$('#library').innerHTML = TYPES.map(type => `<button class="library-card" data-add="${type}">${icon(type, 22)}<span>${LABELS[type]}</span><span class="add-indicator">+</span></button>`).join('');
drawIcons();
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.select) select(button.dataset.select);
  if (button.dataset.visible) { const p = state.panels.find(p => p.id === button.dataset.visible); await run('panel:update', { id: p.id, patch: { visible: !p.visible } }); }
  if (button.dataset.add) { const id = await run('panel:add', button.dataset.add); if (id) { select(id); toast('已添加，可在画布中自由摆放'); } }
  if (button.dataset.theme) await run('theme:set', button.dataset.theme);
  if (button.dataset.app) await run('app:launch', button.dataset.app);
  if (button.dataset.dockAction) await run(button.dataset.dockAction);
  if (button.dataset.unpin) { await run('app:update', { id: button.dataset.unpin, patch: { pinned: false } }); renderInspector(); }
  if (button.dataset.appMove) { await run('app:reorder', { id: button.dataset.appMove, direction: Number(button.dataset.direction) }); renderInspector(); }
  if (button.dataset.preset) {
    const values = { transparent: { opacity: 0, blur: 0 }, clear: { opacity: 8, blur: 0, tint: '#17232d' }, frosted: { opacity: 34, blur: 38, tint: '#31514b' }, ink: { opacity: 64, blur: 24, tint: '#101a1c' } };
    await patch(values[button.dataset.preset]); renderInspector();
  }
  if (button.hasAttribute('data-todo')) {
    const p = state.panels.find(p => p.id === button.closest('[data-id]').dataset.id);
    await run('todo:toggle', { id: p.id, index: Number(button.dataset.todo) });
  }
  if (button.hasAttribute('data-calendar')) await run('calendar:move', { id: button.closest('[data-id]').dataset.id, direction: Number(button.dataset.calendar) });
  switch (button.id) {
    case 'workspace-button': selected = state.panels[0]?.id; render(); break;
    case 'desktop-button': await run('desktop:toggle'); toast(state.desktopEnabled ? '面板已显示到桌面，可从托盘找回编辑器' : '桌面面板已隐藏'); break;
    case 'import-button': { const result = await run('layout:import'); if (result) toast(result); break; }
    case 'export-button': { const result = await run('layout:export'); if (result) toast(result); break; }
    case 'wallpaper-button': await run('wallpaper:pick'); break;
    case 'help-button': case 'guide-button': $('#help-dialog').showModal(); break;
    case 'help-close': case 'help-done': $('#help-dialog').close(); break;
    case 'data-button': await run('data:open'); break;
    case 'duplicate-panel': { const id = await run('panel:duplicate', selected); if (id) select(id); break; }
    case 'delete-panel': await run('panel:remove', selected); break;
    case 'launcher-button': case 'manage-apps': await run('launcher:toggle'); break;
    case 'desktop-scene': await run('scene:system'); break;
    case 'pick-apps': { const result = await run('apps:pick', { pinned: true }); if (result) toast(`已添加 ${result.added} 个入口${result.failed ? `，${result.failed} 个未能添加` : ''}`); renderInspector(); break; }
  }
});
$('#inspector').addEventListener('input', event => {
  const field = event.target, p = current(); if (!p) return;
  if (field.dataset.field) {
    const name = field.dataset.field;
    let value = field.type === 'checkbox' ? field.checked : ['number', 'range'].includes(field.type) ? Number(field.value) : field.value;
    if (field.type === 'number' && (field.value === '' || !field.validity.valid)) return;
    if (field.type === 'range') $(`#output-${name}`).textContent = value + field.dataset.unit;
    if (['hour24', 'seconds', 'showLabels', 'autoHide'].includes(name)) patch({ data: { [name]: value } }); else patch({ [name]: value });
  }
  if (field.id === 'clickthrough') run('clickthrough:toggle');
  if (field.dataset.content === 'text') patch({ data: { text: field.value } });
  if (field.dataset.content === 'items') {
    const items = field.value.split('\n').filter(t => t.trim()).slice(0, 100).map((text, i) => ({ id: p.data.items[i]?.id || crypto.randomUUID(), text, done: p.data.items[i]?.done || false }));
    patch({ data: { items } });
  }
});
$('#panels').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('[data-todo],[data-calendar],[data-app],[data-dock-action]')) return;
  const wrapper = event.target.closest('.preview-panel'); if (!wrapper) return;
  const p = state.panels.find(p => p.id === wrapper.dataset.id);
  const resizing = Boolean(event.target.closest('.resize-handle'));
  selected = p.id;
  if (p.locked) { render(); return; }
  event.preventDefault(); dragging = true;
  for (const node of $('#panels').children) node.classList.toggle('is-selected', node === wrapper);
  renderInspector();
  const initial = { x: p.x, y: p.y, width: p.width, height: p.height }, start = { x: event.clientX, y: event.clientY };
  let next = { ...initial };
  const move = e => {
    const dx = Math.round((e.clientX - start.x) / scale), dy = Math.round((e.clientY - start.y) / scale);
    if (resizing) { next.width = Math.max(180, Math.min(1000, 1440 - p.x, initial.width + dx)); next.height = Math.max(p.type === 'links' ? 80 : 120, Math.min(1000, 900 - p.y, initial.height + dy)); }
    else { next.x = Math.max(0, Math.min(1440 - p.width, initial.x + dx)); next.y = Math.max(0, Math.min(900 - p.height, initial.y + dy)); }
    Object.assign(wrapper.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` });
  };
  const end = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel);
    await patch(next); dragging = false; render();
  };
  const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); dragging = false; render(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
});
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); $('.canvas-wrap').classList.add('file-over'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('.canvas-wrap').classList.remove('file-over'); });
document.addEventListener('drop', async event => {
  event.preventDefault(); $('.canvas-wrap').classList.remove('file-over');
  if (!event.dataTransfer.files.length) return;
  const result = await run('apps:addPaths', { paths: Array.from(event.dataTransfer.files, file => window.island.filePath(file)), pinned: true });
  if (result) toast(`已添加 ${result.added} 个软件入口${result.failed ? `，${result.failed} 个未能添加` : ''}`);
});
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea') || $('#help-dialog').open) return;
  if (event.key === '?') $('#help-dialog').showModal();
  if (event.key === 'Delete' && selected) run('panel:remove', selected);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); run('panel:duplicate', selected).then(id => { if (id) select(id); }); }
});
new ResizeObserver(resizeCanvas).observe($('.canvas-wrap'));
$('#startup-toggle').addEventListener('change', async event => {
  const toggle = event.target; toggle.disabled = true;
  const result = await run('startup:set', toggle.checked);
  if (result) toast(result.enabled ? '已开启开机自启，登录后将恢复桌面组件' : '已关闭开机自启');
  else toggle.checked = state.startup.enabled;
  toggle.disabled = false;
});
window.island.onState(accept);
try { accept(await call('get')); } catch { $('#material-status').textContent = '加载失败，请重启应用'; }
setInterval(() => { if (state) tickClocks($('#panels'), state.panels); }, 1000);
