export const TYPES = ['clock', 'note', 'todo', 'calendar', 'links', 'glass'];
export const LABELS = { clock: '时钟', note: '便签', todo: '待办清单', calendar: '日历', links: '软件 Dock', glass: '空白玻璃' };
const number = (v, min, max, fallback) => Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;
const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
export function safeURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function normalizeApplication(raw) {
  if (!raw || typeof raw.path !== 'string' || !/^[a-z]:[\\/]/i.test(raw.path) || /[\0\r\n]/.test(raw.path) || raw.path.length > 2048) throw new Error('应用入口必须指向本机绝对路径');
  return { id: typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : crypto.randomUUID(), name: text(raw.name, 80).trim() || '未命名入口', path: raw.path,
    kind: ['app', 'folder', 'file'].includes(raw.kind) ? raw.kind : 'app', group: text(raw.group, 32).trim() || '未分组', pinned: raw.pinned === true,
    icon: typeof raw.icon === 'string' && raw.icon.length < 256000 && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(raw.icon) ? raw.icon : '',
    iconVersion: raw.iconVersion === 1 ? 1 : 0, iconSource: ['location','target','resource','shell','fallback','custom','missing'].includes(raw.iconSource) ? raw.iconSource : '' };
}
export function createPanel(type, index = 0) {
  if (!TYPES.includes(type)) throw new Error('未知组件类型');
  const sizes = { clock: [310, 210], note: [310, 255], todo: [310, 280], calendar: [310, 320], links: [680, 96], glass: [310, 220] };
  return { id: globalThis.crypto.randomUUID(), type, title: LABELS[type], x: 70 + index % 4 * 55, y: 70 + index % 4 * 55,
    width: sizes[type][0], height: sizes[type][1], opacity: type === 'clock' ? 0 : 8, blur: 0, radius: 24, tint: '#17232d',
    textColor: '#f2faf7', visible: true, locked: false, alwaysOnTop: false,
    data: { text: type === 'note' ? '留一点空白，给今天的灵感。\n\n从这里开始，写下你的想法。' : '',
      items: type === 'todo' ? [{ id: 'first', text: '给桌面一点新鲜感', done: true }, { id: 'second', text: '留出一段专注的时间', done: false }] : [],
      links: [], hour24: true, seconds: false, showLabels: false, autoHide: true, calendarMonth: '' } };
}
export function normalizePanel(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) throw new Error('布局中存在不支持的组件');
  const base = createPanel(raw.type);
  const color = (v, fallback) => /^#[\da-f]{6}$/i.test(v) ? v : fallback;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : {};
  return { id: typeof raw.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(raw.id) ? raw.id : base.id, type: raw.type, title: text(raw.title, 60) || base.title,
    x: number(raw.x, -20000, 20000, base.x), y: number(raw.y, -20000, 20000, base.y),
    width: number(raw.width, 180, 1000, base.width), height: number(raw.height, raw.type === 'links' ? 80 : 120, 1000, base.height),
    opacity: number(raw.opacity, 0, 100, base.opacity), blur: number(raw.blur, 0, 64, 0), radius: number(raw.radius, 0, 48, 24),
    tint: color(raw.tint, base.tint), textColor: color(raw.textColor, base.textColor),
    visible: raw.visible !== false, locked: raw.locked === true, alwaysOnTop: raw.alwaysOnTop === true,
    data: { text: text(d.text, 20000), hour24: d.hour24 !== false, seconds: d.seconds === true, showLabels: d.showLabels === true, autoHide: d.autoHide !== false,
      calendarMonth: typeof d.calendarMonth === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(d.calendarMonth) ? d.calendarMonth : '',
      items: (Array.isArray(d.items) ? d.items : []).slice(0, 100).map((item, i) => ({ id: text(item?.id, 80) || `item-${i}`, text: text(item?.text, 500), done: item?.done === true })),
      links: (Array.isArray(d.links) ? d.links : []).slice(0, 12).map(link => ({ label: text(link?.label, 40), url: safeURL(link?.url) })).filter(link => link.label && link.url) } };
}
export function normalizeConfig(raw) {
  if (!raw || ![1, 2, 3].includes(raw.version) || !Array.isArray(raw.panels) || raw.panels.length > 40) throw new Error('请选择有效的璃屿布局文件（最多 40 个面板）');
  const panels = raw.panels.map(normalizePanel);
  if (new Set(panels.map(p => p.id)).size !== panels.length) throw new Error('布局包含重复的组件编号');
  const wallpaper = typeof raw.wallpaper === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(raw.wallpaper) && raw.wallpaper.length < 12000000 ? raw.wallpaper : '';
  if (raw.applications !== undefined && (!Array.isArray(raw.applications) || raw.applications.length > 800)) throw new Error('应用入口数量超过限制');
  const applications = (raw.applications || []).map(normalizeApplication);
  if (new Set(applications.map(a => a.id)).size !== applications.length) throw new Error('应用编号重复');
  return { version: 3, panels, applications, wallpaper, useSystemWallpaper: raw.useSystemWallpaper !== false, theme: ['forest', 'dusk', 'ocean'].includes(raw.theme) ? raw.theme : 'forest', desktopEnabled: raw.desktopEnabled === true };
}
export function defaultConfig() {
  const panels = ['clock', 'note', 'todo', 'links'].map(createPanel);
  Object.assign(panels[0], { x: 90, y: 85, width: 330, height: 215 });
  Object.assign(panels[1], { x: 1000, y: 85, width: 330, height: 265 });
  Object.assign(panels[2], { x: 1000, y: 410, width: 330, height: 295 });
  Object.assign(panels[3], { x: 380, y: 780, width: 680, height: 96 });
  return { version: 3, panels, applications: [], theme: 'forest', wallpaper: '', useSystemWallpaper: true, desktopEnabled: false };
}
export function calendarCells(date = new Date()) {
  const year = date.getFullYear(), month = date.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => i >= offset && i < offset + days ? i - offset + 1 : null);
}
export function calendarDate(month, now = new Date()) {
  return typeof month === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) ? new Date(Number(month.slice(0,4)), Number(month.slice(5)) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
}
export function shiftCalendarMonth(month, direction, now = new Date()) {
  if (![ -1, 0, 1 ].includes(direction)) throw new Error('日历翻月方向无效');
  if (direction === 0) return '';
  const date = calendarDate(month, now); date.setMonth(date.getMonth() + direction);
  const year = date.getFullYear();
  if (year < 1000 || year > 9999) throw new Error('可查看 1000 至 9999 年的日历');
  return `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
export function reorderApplications(applications, { ids, id, beforeId }) {
  if (!Array.isArray(ids) || ids.length > 800 || new Set(ids).size !== ids.length || !ids.includes(id) || beforeId !== null && (!ids.includes(beforeId) || beforeId === id)) throw new Error('图标排序无效');
  const selected = new Set(ids), entries = applications.filter(a => selected.has(a.id));
  if (entries.length !== ids.length) throw new Error('应用列表已更新，请重新拖动');
  const moved = entries.find(a => a.id === id), rest = entries.filter(a => a !== moved);
  rest.splice(beforeId === null ? rest.length : rest.findIndex(a => a.id === beforeId), 0, moved);
  let index = 0;
  return applications.map(a => selected.has(a.id) ? rest[index++] : a);
}
export function fitBounds(panel, area) {
  const width = Math.min(panel.width, area.width), height = Math.min(panel.height, area.height);
  return { x: Math.round(Math.max(area.x, Math.min(panel.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(panel.y, area.y + area.height - height))), width, height };
}
