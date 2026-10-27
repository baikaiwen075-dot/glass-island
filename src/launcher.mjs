import { icon } from './icons.mjs';
import { esc } from './components.mjs';
import { sortable } from './reorder.mjs';
const $ = s => document.querySelector(s);
let state, group = '全部', editing, found = [], busy = false, toastTimer;
const sorting = sortable($('#app-grid'), '[data-entry]', 'entry', payload => run('app:sort', payload), () => render());
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon, 19);
function toast(message) { $('#launcher-toast').textContent = message; $('#launcher-toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#launcher-toast').hidden = true; }, 3000); }
async function call(name, payload) { const reply = await window.island.call(name, payload); if (!reply.ok) { toast(reply.error); throw new Error(reply.error); } return reply.value; }
function run(name, payload) { return call(name, payload).catch(() => undefined); }
function appIcon(entry) { return entry.icon ? `<img src="${esc(entry.icon)}" alt="" draggable="false">` : icon(entry.kind === 'folder' ? 'folder' : 'monitor', 38); }
function matching() {
  const terms = $('#search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return state.applications.filter(a => (group === '全部' || group === '已固定' && a.pinned || a.group === group) && terms.every(term => `${a.name} ${a.group}`.toLocaleLowerCase().includes(term)));
}
function render(next) {
  if (next) state = next; if (!state) return;
  if (sorting.active) return;
  const groups = ['全部', '已固定', ...new Set(state.applications.map(a => a.group))];
  if (!groups.includes(group)) group = '全部';
  $('#groups').innerHTML = groups.map(g => `<button class="group-tab ${g === group ? 'active' : ''}" data-group="${esc(g)}">${esc(g)}${g === '已固定' ? `<span>${state.applications.filter(a => a.pinned).length}</span>` : ''}</button>`).join('');
  $('#app-count').textContent = `${state.applications.length} 个入口`;
  const entries = matching();
  $('#app-grid').innerHTML = entries.map(a => `<article class="application-card" data-entry="${a.id}" title="${esc(a.name)}"><button class="app-launch" data-launch="${a.id}"><span class="library-app-icon">${appIcon(a)}</span><strong>${esc(a.name)}</strong><small>${esc(a.group)}</small></button><div class="app-card-actions"><button class="app-pin ${a.pinned ? 'pinned' : ''}" data-pin="${a.id}" title="${a.pinned ? '取消 Dock 固定' : '固定到 Dock'}" aria-label="${a.pinned ? '取消固定' : '固定到 Dock'}">${icon('pin', 14)}</button><button class="app-edit" data-edit="${a.id}" aria-label="编辑${esc(a.name)}">···</button></div></article>`).join('');
  $('#app-empty').hidden = entries.length > 0;
  if (!entries.length) {
    $('#app-empty h2').textContent = state.applications.length ? '这里暂时没有匹配的入口。' : '把你的软件，放进这块玻璃。';
    $('#app-empty p').innerHTML = state.applications.length ? '试试其他关键词，或切换到“全部”分组。' : '添加 EXE 或 LNK 快捷方式，也可以直接从桌面拖入。<br>只创建入口，原来的软件和文件保持原位。';
    $('#empty-import').hidden = state.applications.length > 0;
  }
  $('#launcher-status').textContent = state.saveError ? '保存失败，请打开设置检查' : state.refreshingIcons ? '正在修复软件图标…' : busy ? '正在读取本机软件…' : '本机应用 · 本地保存';
  $('#refresh-icons').disabled = state.refreshingIcons;
}
function edit(id) {
  editing = state.applications.find(a => a.id === id); if (!editing) return;
  $('#entry-name').value = editing.name; $('#entry-group').value = editing.group; $('#entry-pinned').checked = editing.pinned; $('#entry-path').textContent = editing.path;
  $('#group-options').innerHTML = [...new Set(state.applications.map(a => a.group))].filter(g => !['全部', '已固定'].includes(g)).map(g => `<option value="${esc(g)}">`).join('');
  $('#entry-dialog').showModal();
}
function imported(result) { if (result) toast(`已添加 ${result.added} 个入口${result.failed ? `；${result.failed} 个未添加：${result.error}` : ''}`); }
async function scan(source) {
  if (busy) return; busy = true; render();
  for (const button of document.querySelectorAll('#scan-desktop,#scan-startmenu,#empty-import')) button.disabled = true;
  try {
    found = await call('apps:scan', source);
    if (!found.length) { toast('没有找到尚未添加的软件快捷方式，可使用“添加软件”手动选择'); return; }
    $('#candidate-list').innerHTML = found.map(a => `<label class="candidate-entry"><input type="checkbox" data-candidate="${a.id}" checked><span>${appIcon(a)}</span><div><strong>${esc(a.name)}</strong><small>${esc(a.path)}</small></div></label>`).join('');
    $('#candidate-count').textContent = `${found.length} 个待选入口`; $('#select-all').checked = true;
    $('#import-title').textContent = source === 'desktop' ? '从桌面挑选软件' : '从开始菜单挑选软件';
    $('#import-dialog').showModal();
  } catch {} finally { busy = false; for (const button of document.querySelectorAll('#scan-desktop,#scan-startmenu,#empty-import')) button.disabled = false; render(); }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.launch) await run('app:launch', button.dataset.launch);
  if (button.dataset.pin) { const a = state.applications.find(a => a.id === button.dataset.pin); await run('app:update', { id: a.id, patch: { pinned: !a.pinned } }); }
  if (button.dataset.edit) edit(button.dataset.edit);
  if (button.hasAttribute('data-group')) { group = button.dataset.group; render(); }
  switch (button.id) {
    case 'close': await run('launcher:hide'); break;
    case 'settings': await run('editor:open'); break;
    case 'refresh-icons': { const result = await run('apps:refreshIcons'); if (result) toast(`已刷新 ${result.updated} 个图标${result.failed ? `，${result.failed} 个暂未读取到` : ''}`); break; }
    case 'pick-files': imported(await run('apps:pick', { group: ['全部', '已固定'].includes(group) ? '未分组' : group, pinned: group === '已固定' })); break;
    case 'pick-folder': imported(await run('apps:pick', { folder: true })); break;
    case 'scan-desktop': case 'empty-import': await scan('desktop'); break;
    case 'scan-startmenu': await scan('startmenu'); break;
    case 'cancel-import': $('#import-dialog').close(); break;
    case 'confirm-import': { const ids = Array.from(document.querySelectorAll('[data-candidate]:checked'), input => input.dataset.candidate); $('#import-dialog').close(); imported(await run('apps:addSelected', ids)); break; }
    case 'cancel-entry': $('#entry-dialog').close(); break;
    case 'reveal-entry': await run('app:reveal', editing.id); break;
    case 'remove-entry': await run('app:remove', editing.id); if (!state.applications.some(a => a.id === editing.id)) $('#entry-dialog').close(); break;
    case 'pick-entry-icon': if (await run('app:icon:pick', editing.id)) toast('图标已更换，Dock 会同步更新'); break;
    case 'reset-entry-icon': await run('app:icon:reset', editing.id); break;
  }
});
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (['全部', '已固定'].includes($('#entry-group').value.trim())) { toast('分组名称不能使用“全部”或“已固定”'); return; }
  const result = await window.island.call('app:update', { id: editing.id, patch: { name: $('#entry-name').value, group: $('#entry-group').value, pinned: $('#entry-pinned').checked } });
  if (result.ok) $('#entry-dialog').close(); else toast(result.error);
});
$('#select-all').addEventListener('change', event => { for (const box of document.querySelectorAll('[data-candidate]')) box.checked = event.target.checked; });
$('#search').addEventListener('input', () => render());
document.addEventListener('contextmenu', event => { const card = event.target.closest('[data-entry]'); if (card) { event.preventDefault(); edit(card.dataset.entry); } });
document.addEventListener('keydown', event => {
  if ($('#entry-dialog').open || $('#import-dialog').open) return;
  if (event.key === 'Escape') run('launcher:hide');
  if (event.key === 'Enter' && document.activeElement === $('#search')) { const first = matching()[0]; if (first) run('app:launch', first.id); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); $('#search').focus(); }
});
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); document.body.classList.add('dropping'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', async event => { event.preventDefault(); document.body.classList.remove('dropping'); imported(await run('apps:addPaths', { paths: Array.from(event.dataTransfer.files, file => window.island.filePath(file)), pinned: group === '已固定', group: ['全部', '已固定'].includes(group) ? '未分组' : group })); });
window.island.onState(render);
render(await call('get'));
window.addEventListener('focus', () => $('#search').focus());
