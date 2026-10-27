import { icon } from './icons.mjs';
import { calendarCells, calendarDate } from './model.mjs';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function stylePanel(element, panel) {
  element.classList.add('panel-ready');
  element.classList.toggle('is-transparent', panel.opacity === 0);
  element.classList.toggle('dock-no-labels', panel.type === 'links' && !panel.data.showLabels);
  element.style.setProperty('--glass-tint', panel.tint);
  element.style.setProperty('--glass-opacity', panel.opacity / 100);
  element.style.setProperty('--glass-blur', `${panel.blur}px`);
  element.style.setProperty('--glass-radius', `${panel.radius}px`);
  element.style.setProperty('--glass-text', panel.textColor);
}
export function content(panel, live = false, applications = []) {
  const d = panel.data, date = new Date();
  switch (panel.type) {
    case 'clock': return `<div class="clock-widget"><div class="eyebrow">让时间，慢一点</div><div class="clock-digits" data-clock="${panel.id}"></div><div class="clock-date">${esc(date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))}</div></div>`;
    case 'note': return `<div class="note-widget"><div class="widget-heading">${icon('note', 17)}<span>${esc(panel.title)}</span><span class="tiny-tag">随手记</span></div>${live ? `<textarea class="live-note" aria-label="便签内容" spellcheck="false">${esc(d.text)}</textarea>` : `<div class="note-text">${esc(d.text || '写一点什么…')}</div>`}<div class="note-footer">一点想法，无限可能 ${icon('sparkle', 13)}</div></div>`;
    case 'todo': {
      const done = d.items.filter(i => i.done).length;
      return `<div class="todo-widget"><div class="widget-heading">${icon('todo', 17)}<span>${esc(panel.title)}</span><span class="tiny-tag">${done} / ${d.items.length}</span></div><div class="todo-items">${d.items.map((item, i) => `<button class="todo-item ${item.done ? 'done' : ''}" data-todo="${i}" aria-pressed="${item.done}"><span class="checkbox">${item.done ? icon('check', 12) : ''}</span><span>${esc(item.text)}</span></button>`).join('') || '<span class="muted">今天也可以，轻装上阵。</span>'}</div><div class="todo-progress"><i style="width:${d.items.length ? done / d.items.length * 100 : 0}%"></i></div><div class="note-footer">完成小事，也是一种进步</div></div>`;
    }
    case 'calendar': {
      const viewed = calendarDate(d.calendarMonth, date), thisMonth = viewed.getFullYear() === date.getFullYear() && viewed.getMonth() === date.getMonth();
      return `<div class="calendar-widget"><div class="widget-heading">${icon('calendar', 17)}<span class="calendar-month" aria-live="polite">${viewed.getFullYear()} 年 ${viewed.getMonth() + 1} 月</span><nav class="calendar-nav" aria-label="切换日历月份"><button data-calendar="-1" aria-label="上个月" title="上个月">‹</button><button data-calendar="0" aria-label="回到本月" title="回到本月并跟随系统日期">本月</button><button data-calendar="1" aria-label="下个月" title="下个月">›</button></nav></div><div class="calendar-grid">${['一', '二', '三', '四', '五', '六', '日'].map(day => `<span class="weekday">${day}</span>`).join('')}${calendarCells(viewed).map(day => `<span class="${thisMonth && day === date.getDate() ? 'today' : ''}">${day || ''}</span>`).join('')}</div></div>`;
    }
    case 'links': return `<div class="links-widget app-dock"><button class="shortcut dock-system" data-dock-action="launcher:toggle" title="应用大面板"><span class="shortcut-icon">${icon('grid', 25)}</span><span>应用</span></button><button class="shortcut dock-system" data-dock-action="computer:open" title="打开此电脑"><span class="shortcut-icon">${icon('monitor', 25)}</span><span>此电脑</span></button><span class="dock-divider"></span>${applications.filter(a => a.pinned).map(a => `<button class="shortcut app-shortcut" data-app="${a.id}" title="${esc(a.name)}"><span class="app-icon">${a.icon ? `<img src="${esc(a.icon)}" alt="" draggable="false">` : icon(a.kind === 'folder' ? 'folder' : 'monitor', 32)}</span><span>${esc(a.name)}</span></button>`).join('') || `<button class="dock-add-apps" data-dock-action="launcher:toggle">${icon('plus', 20)}<span>添加你的软件</span></button>`}<span class="dock-divider"></span><button class="shortcut dock-system" data-dock-action="editor:open" title="外观与组件设置"><span class="shortcut-icon">${icon('settings', 26)}</span><span>设置</span></button></div>`;
    case 'glass': return `<div class="empty-widget">${icon('sparkle', 25)}<span>${esc(d.text || panel.title)}</span></div>`;
    default: return '';
  }
}
export function tickClocks(root, panels) {
  const now = new Date();
  for (const node of root.querySelectorAll('[data-clock]')) {
    const p = panels.find(p => p.id === node.dataset.clock); if (!p) continue;
    const next = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(p.data.seconds ? { second: '2-digit' } : {}), hour12: !p.data.hour24 });
    if (node.textContent !== next) node.textContent = next;
  }
}
