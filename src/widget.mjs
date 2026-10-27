import { content, stylePanel, tickClocks } from './components.mjs';
import { sortable } from './reorder.mjs';
const id = new URLSearchParams(location.search).get('id');
const panel = document.querySelector('#live-panel'), root = document.querySelector('#live-content');
let current, applications = [], latest, markup, dateKey = new Date().toDateString();
const sorting = sortable(root, '[data-app]', 'app', payload => call('app:sort', payload), () => { if (latest) render(latest); });
async function call(action, payload) {
  const reply = await window.island.call(action, payload);
  if (!reply.ok) { panel.title = reply.error; return; }
  return reply.value;
}
function render(state) {
  latest = state;
  current = state.panels.find(p => p.id === id); if (!current) return;
  applications = state.applications;
  stylePanel(panel, current);
  panel.classList.toggle('locked', current.locked);
  document.querySelector('#interaction-hint').hidden = !state.clickThrough || !['todo','calendar','note','links'].includes(current.type);
  const next = content(current, true, applications);
  // Protect the note caret only; focused buttons must still reflect state changes immediately.
  const editingNote = document.activeElement?.matches('.live-note') && document.hasFocus();
  if (!sorting.active && !editingNote && next !== markup) {
    const focusedTodo = document.activeElement?.dataset.todo, focusedMonth = document.activeElement?.dataset.calendar;
    root.innerHTML = next; markup = next;
    if (focusedTodo !== undefined) root.querySelector(`[data-todo="${focusedTodo}"]`)?.focus({ preventScroll: true });
    if (focusedMonth !== undefined) root.querySelector(`[data-calendar="${focusedMonth}"]`)?.focus({ preventScroll: true });
  }
  tickClocks(root, [current]);
}
root.addEventListener('input', event => {
  if (event.target.matches('.live-note')) call('panel:update', { id, patch: { data: { text: event.target.value } } });
});
root.addEventListener('click', event => {
  const todo = event.target.closest('[data-todo]'), calendar = event.target.closest('[data-calendar]'), app = event.target.closest('[data-app]'), action = event.target.closest('[data-dock-action]');
  if (todo) call('todo:toggle', { id, index: Number(todo.dataset.todo) });
  if (calendar) call('calendar:move', { id, direction: Number(calendar.dataset.calendar) });
  if (app) call('app:launch', app.dataset.app);
  if (action) call(action.dataset.dockAction);
});
document.addEventListener('contextmenu', event => { event.preventDefault(); call('editor:open'); });
window.island.onState(render);
const initial = await call('get'); if (initial) render(initial);
document.addEventListener('pointerdown', () => { if (current?.type === 'links') call('widget:interaction', true); }, true);
const endInteraction = () => { if (current?.type === 'links') call('widget:interaction', false); };
window.addEventListener('pointerup', endInteraction);
window.addEventListener('pointercancel', endInteraction);
window.addEventListener('blur', endInteraction);
document.querySelector('.native-resize').addEventListener('pointerdown', event => {
  if (event.button !== 0 || current.locked) return;
  event.preventDefault();
  const startX = event.screenX, startY = event.screenY, width = innerWidth, height = innerHeight;
  const handle = event.currentTarget; handle.setPointerCapture(event.pointerId);
  let frame, next;
  const send = () => { frame = null; if (next) call('widget:resize', next); };
  const move = e => { next = { width: width + e.screenX - startX, height: height + e.screenY - startY }; if (!frame) frame = requestAnimationFrame(send); };
  const finish = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish); if (frame) cancelAnimationFrame(frame); send(); };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
});
setInterval(() => {
  if (!current) return;
  tickClocks(root, [current]);
  if (dateKey !== new Date().toDateString()) { dateKey = new Date().toDateString(); if (latest) render(latest); }
}, 1000);
document.addEventListener('dragover', event => { if (current?.type === 'links' && event.dataTransfer.types.includes('Files')) { event.preventDefault(); panel.classList.add('file-over'); } });
document.addEventListener('dragleave', () => panel.classList.remove('file-over'));
document.addEventListener('drop', async event => {
  event.preventDefault(); panel.classList.remove('file-over');
  if (current?.type !== 'links') return;
  await call('apps:addPaths', { paths: Array.from(event.dataTransfer.files, file => window.island.filePath(file)), pinned: true });
});
