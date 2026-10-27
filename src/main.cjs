const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell, screen, globalShortcut, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { startBridge } = require('./windows.cjs');
const applications = require('./applications.cjs');
const { createStartup } = require('./startup.cjs');
const testMode = process.argv.includes('--smoke-test');
const autostart = process.argv.includes('--autostart');
const dataArg = process.argv.find(arg => arg.startsWith('--data-dir='));
if (dataArg) app.setPath('userData', path.resolve(dataArg.slice(11)));
let editor, launcher, tray, state, model, bridge, bridgeTimer, dockTimer, desktopError = '', desktopWallpaper = '', saveTimer, quitting = false, welcomeShown = false, clickThrough = false, saveError = '', shortcuts = {};
const widgets = new Map();
const dockVisibility = new Map();
const candidates = new Map();
let iconRefreshTask, refreshingIcons = false;
const startup = createStartup(app, { testMode });
const file = () => path.join(app.getPath('userData'), 'layout.json');
const prefs = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true };
function snapshot() { return { ...state, refreshingIcons, startup: startup.status(), clickThrough, saveError, shortcuts, desktopWallpaper, desktopIntegrated: Boolean(bridge) && !desktopError, desktopError, nativeGlass: process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621 }; }
function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('island:state', snapshot());
}
function flush() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(`${file()}.tmp`, JSON.stringify(state, null, 2));
    if (fs.existsSync(file())) fs.copyFileSync(file(), `${file()}.bak`);
    fs.renameSync(`${file()}.tmp`, file());
    saveError = '';
  } catch (error) { saveError = `保存失败：${error.message}`; broadcast(); }
}
function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); broadcast(); }
function secure(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
}
function openEditor() {
  if (editor && !editor.isDestroyed()) { editor.show(); editor.restore(); editor.focus(); return; }
  editor = new BrowserWindow({ width: 1440, height: 940, minWidth: 1080, minHeight: 740, title: '璃屿 · Glass Island', backgroundColor: '#101817', autoHideMenuBar: true, icon: path.join(__dirname, '../assets/icon.png'), webPreferences: prefs, show: false });
  secure(editor);
  editor.loadFile(path.join(__dirname, 'index.html'));
  editor.once('ready-to-show', () => { editor.show(); if (!testMode && !welcomeShown && !state.applications.length) { welcomeShown = true; openLauncher(); } });
  editor.on('close', event => { if (!quitting && tray && state.desktopEnabled) { event.preventDefault(); editor.hide(); } });
  editor.on('closed', () => { editor = null; });
}
function openLauncher(toggle = false) {
  if (launcher && !launcher.isDestroyed()) {
    if (toggle && launcher.isVisible()) launcher.hide(); else { launcher.show(); launcher.focus(); }
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  launcher = new BrowserWindow({ width: Math.min(1060, area.width - 50), height: Math.min(720, area.height - 60), minWidth: 700, minHeight: 520, frame: false, transparent: true,
    backgroundColor: '#00000000', title: '璃屿 · 应用大面板', skipTaskbar: true, show: false, webPreferences: prefs });
  secure(launcher); launcher.loadFile(path.join(__dirname, 'launcher.html'));
  launcher.once('ready-to-show', () => launcher.show());
  launcher.on('close', event => { if (!quitting) { event.preventDefault(); launcher.hide(); } });
  launcher.on('closed', () => { launcher = null; });
}
function bindDesktop(win, panel) {
  if (!bridge || win.isDestroyed()) return;
  bridge.bind(win, panel.alwaysOnTop).then(() => { if (desktopError) { desktopError = ''; broadcast(); } }).catch(error => {
    if (!win.isDestroyed() && desktopError !== error.message) { desktopError = error.message; broadcast(); }
  });
}
async function readDesktopWallpaper() {
  if (!bridge) return;
  try {
    const target = await bridge.request('wallpaper');
    if (!target || !fs.existsSync(target) || fs.statSync(target).size > 8 * 1024 * 1024) return;
    const bytes = fs.readFileSync(target), mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : null;
    if (mime) desktopWallpaper = `data:image/${mime};base64,${bytes.toString('base64')}`;
  } catch { /* Custom wallpaper and bundled scenes remain usable. */ }
}
function widgetBounds(panel) {
  const area = screen.getPrimaryDisplay().workArea;
  // Layout coordinates use a 1440 × 900 design space, independent of display scaling.
  const candidate = { x: area.x + Math.round(panel.x / 1440 * area.width), y: area.y + Math.round(panel.y / 900 * area.height),
    width: Math.max(180, Math.round(panel.width / 1440 * area.width)), height: Math.max(panel.type === 'links' ? 80 : 120, Math.round(panel.height / 900 * area.height)) };
  return model.fitBounds(candidate, area);
}
function applyWidget(panel, win, bounds = true) {
  if (bounds) win.setBounds(widgetBounds(panel));
  if (win.isAlwaysOnTop() !== panel.alwaysOnTop) win.setAlwaysOnTop(panel.alwaysOnTop);
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  // Native resize frames and system acrylic can turn transparent windows into grey rectangles.
  // Resizing is handled by our transparent corner handle instead.
  win.setResizable(false);
  win.setMovable(!panel.locked);
  bindDesktop(win, panel);
}
function syncWidgets(bounds = true) {
  for (const [id, win] of widgets) {
    if (!state.desktopEnabled || !state.panels.some(p => p.id === id && p.visible)) { widgets.delete(id); dockVisibility.delete(id); win.destroy(); }
  }
  if (!state.desktopEnabled) return;
  for (const panel of state.panels.filter(p => p.visible)) {
    if (widgets.has(panel.id)) { applyWidget(panel, widgets.get(panel.id), bounds); continue; }
    const win = new BrowserWindow({ ...widgetBounds(panel), minWidth: 180, minHeight: panel.type === 'links' ? 80 : 120, resizable: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      skipTaskbar: true, title: `璃屿 · ${panel.title}`, show: false, webPreferences: prefs });
    widgets.set(panel.id, win);
    secure(win);
    applyWidget(panel, win);
    win.loadFile(path.join(__dirname, 'widget.html'), { query: { id: panel.id } });
    win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.showInactive(); bindDesktop(win, state.panels.find(p => p.id === panel.id) || panel); } });
    const remember = () => {
      if (win.isDestroyed() || !state.desktopEnabled) return;
      const p = state.panels.find(p => p.id === panel.id); if (!p) return;
      const b = win.getBounds(), area = screen.getPrimaryDisplay().workArea;
      // Keep the single-screen editor in sync; other displays can still host native windows.
      Object.assign(p, { x: Math.round((b.x - area.x) / area.width * 1440), y: Math.round((b.y - area.y) / area.height * 900), width: Math.round(b.width / area.width * 1440), height: Math.round(b.height / area.height * 900) });
      changed();
    };
    win.on('moved', remember); win.on('resized', remember);
    win.on('closed', () => { widgets.delete(panel.id); dockVisibility.delete(panel.id); });
  }
  updateDocks();
}
function updateDocks() {
  const cursor = screen.getCursorScreenPoint(), now = Date.now();
  for (const [id, win] of widgets) {
    const panel = state.panels.find(p => p.id === id);
    if (panel?.type !== 'links' || win.isDestroyed() || win.webContents.isLoading()) continue;
    let visibility = dockVisibility.get(id);
    if (!visibility) { visibility = { hidden: false, leftAt: now, interacting: false }; dockVisibility.set(id, visibility); }
    const b = win.getBounds(), inside = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
    // Poll screen coordinates so a fully hidden window can wake without intercepting desktop clicks.
    if (!panel.data.autoHide || inside || visibility.interacting) {
      visibility.leftAt = now;
      if (visibility.hidden) { visibility.hidden = false; win.showInactive(); bindDesktop(win, panel); }
    } else if (!visibility.hidden && now - visibility.leftAt >= 450) {
      visibility.hidden = true; win.hide();
    }
  }
}
function updatePanel(id, patch, fromWidget = false) {
  const index = state.panels.findIndex(p => p.id === id);
  if (index < 0) throw new Error('组件不存在');
  const old = state.panels[index];
  if (fromWidget) patch = { data: { ...old.data, ...patch.data } };
  state.panels[index] = model.normalizePanel({ ...old, ...patch, id: old.id, type: old.type, data: { ...old.data, ...patch.data } });
  syncWidgets(!fromWidget); changed();
}
function setDesktop(enabled) { state.desktopEnabled = enabled; syncWidgets(); changed(); }
function setClickThrough(enabled) { clickThrough = enabled; syncWidgets(false); broadcast(); }
async function addPaths(paths, pinned = false, group = '未分组') {
  if (!Array.isArray(paths) || paths.length > 800) throw new Error('一次最多添加 800 个入口');
  const existing = new Map(state.applications.map(a => [path.win32.normalize(a.path).toLowerCase(), a]));
  let added = 0; const errors = [];
  for (const target of paths) {
    const key = applications.localPath(target)?.toLowerCase();
    if (existing.has(key)) { if (pinned) existing.get(key).pinned = true; continue; }
    if (state.applications.length >= 800) { errors.push('入口已达 800 个上限'); break; }
    try { const entry = model.normalizeApplication({ ...await applications.describe(target), pinned, group }); state.applications.push(entry); existing.set(key, entry); added++; }
    catch (error) { errors.push(error.message); }
  }
  changed(); return { added, failed: errors.length, error: errors[0] || '' };
}
function refreshIcons(force = false) {
  if (iconRefreshTask) return iconRefreshTask;
  const entries = state.applications.filter(a => a.iconSource !== 'custom' && (force || a.iconVersion !== applications.ICON_VERSION || !a.icon));
  if (!entries.length) return Promise.resolve({ updated: 0, failed: 0 });
  const backup = path.join(app.getPath('userData'), 'before-icon-repair.json');
  if (fs.existsSync(file()) && !fs.existsSync(backup)) fs.copyFileSync(file(), backup);
  refreshingIcons = true; broadcast();
  iconRefreshTask = (async () => {
    let updated = 0, failed = 0;
    for (const original of entries) {
      const icon = await applications.readIcon(original.path);
      const entry = state.applications.find(a => a.id === original.id && a.path === original.path);
      if (!entry || entry.iconSource === 'custom') continue;
      if (icon.icon) { Object.assign(entry, model.normalizeApplication({ ...entry, ...icon })); updated++; }
      else failed++;
    }
    if (updated) changed();
    return { updated, failed };
  })().finally(() => { refreshingIcons = false; iconRefreshTask = null; if (!quitting) broadcast(); });
  return iconRefreshTask;
}
async function action(event, name, payload) {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('不受信任的子页面');
  const isEditor = editor && event.sender === editor.webContents;
  const isLauncher = launcher && event.sender === launcher.webContents;
  const isManager = isEditor || isLauncher;
  const ownId = [...widgets].find(([, win]) => win.webContents === event.sender)?.[0];
  if (!isManager && !ownId) throw new Error('不受信任的窗口');
  if (name === 'get') return snapshot();
  if (name === 'widget:interaction' && ownId && state.panels.find(p => p.id === ownId)?.type === 'links') {
    const visibility = dockVisibility.get(ownId);
    if (visibility) visibility.interacting = payload === true;
    updateDocks(); return;
  }
  if (name === 'widget:resize' && ownId) {
    const panel = state.panels.find(p => p.id === ownId); if (panel.locked) throw new Error('面板位置已锁定');
    if (!Number.isFinite(payload?.width) || !Number.isFinite(payload?.height)) throw new Error('面板尺寸无效');
    const area = screen.getPrimaryDisplay().workArea;
    updatePanel(ownId, { width: Math.round(payload.width / area.width * 1440), height: Math.round(payload.height / area.height * 900) }); return;
  }
  if (name === 'panel:update' && (isEditor || payload?.id === ownId)) { updatePanel(payload.id, payload.patch, !isEditor); return snapshot(); }
  if (name === 'todo:toggle' || name === 'calendar:move') {
    const p = state.panels.find(p => p.id === payload?.id);
    if (!p || (!isEditor && p.id !== ownId)) throw new Error('只能操作当前桌面组件');
    if (name === 'todo:toggle') {
      if (p.type !== 'todo' || !Number.isInteger(payload.index) || !p.data.items[payload.index]) throw new Error('待办项目不存在');
      const items = p.data.items.map((item, i) => i === payload.index ? { ...item, done: !item.done } : item);
      updatePanel(p.id, { data: { items } }, true);
    } else {
      if (p.type !== 'calendar') throw new Error('这不是日历组件');
      updatePanel(p.id, { data: { calendarMonth: model.shiftCalendarMonth(p.data.calendarMonth, payload.direction) } }, true);
    }
    return snapshot();
  }
  if (name === 'link:open') {
    const p = state.panels.find(p => p.id === payload?.id);
    if (!p || (!isEditor && p.id !== ownId)) throw new Error('组件不存在');
    const url = model.safeURL(p.data.links[payload.index]?.url);
    if (!url) throw new Error('仅支持 http / https 链接');
    await shell.openExternal(url); return;
  }
  if (name === 'editor:open') { openEditor(); return; }
  if (name === 'launcher:toggle') { openLauncher(true); return; }
  if (name === 'launcher:hide' && isLauncher) { launcher.hide(); return; }
  if (name === 'computer:open') {
    if (!bridge) throw new Error('Windows 桌面服务不可用，请重新启动璃屿');
    await bridge.request('computer'); return;
  }
  if (name === 'app:launch') {
    const entry = state.applications.find(a => a.id === payload);
    if (!entry || (!isManager && (!entry.pinned || state.panels.find(p => p.id === ownId)?.type !== 'links'))) throw new Error('应用入口不存在');
    await applications.open(entry); if (isLauncher) launcher.hide(); return;
  }
  if (name === 'apps:addPaths' && (isManager || state.panels.find(p => p.id === ownId)?.type === 'links')) return addPaths(payload?.paths, !isManager || payload?.pinned === true, payload?.group);
  if (name === 'app:sort') {
    if (!isManager && (state.panels.find(p => p.id === ownId)?.type !== 'links' || !Array.isArray(payload?.ids) || payload.ids.some(id => !state.applications.some(a => a.id === id && a.pinned)))) throw new Error('只能调整 Dock 中已固定的图标');
    state.applications = model.reorderApplications(state.applications, payload || {}); changed(); return;
  }
  if (!isManager) throw new Error('该操作仅限应用管理与编辑器');
  switch (name) {
    case 'apps:refreshIcons': return refreshIcons(true);
    case 'app:icon:reset': {
      const entry = state.applications.find(a => a.id === payload); if (!entry) throw new Error('应用入口不存在');
      const icon = await applications.readIcon(entry.path); if (!icon.icon) throw new Error('未能读取图标，可选择本机图片作为图标');
      const current = state.applications.find(a => a.id === payload); if (current) Object.assign(current, model.normalizeApplication({ ...current, ...icon })); changed(); return;
    }
    case 'app:icon:pick': {
      if (!state.applications.some(a => a.id === payload)) throw new Error('应用入口不存在');
      const picked = await dialog.showOpenDialog(isLauncher ? launcher : editor, { title: '选择应用图标', properties: ['openFile'], filters: [{ name: '图标与图片', extensions: ['ico','png','jpg','jpeg','bmp'] }] });
      if (picked.canceled) return;
      const target = picked.filePaths[0];
      if (!/\.(ico|png|jpe?g|bmp)$/i.test(target) || fs.statSync(target).size > 8*1024*1024) throw new Error('请选择小于 8 MB 的图标或图片');
      const icon = await applications.readIcon(target); if (!icon.icon || icon.iconSource === 'fallback') throw new Error('无法读取这张图片，请换一张 PNG 或 ICO');
      const entry = state.applications.find(a => a.id === payload); if (!entry) throw new Error('应用入口已移除');
      Object.assign(entry, model.normalizeApplication({ ...entry, ...icon, iconSource: 'custom' })); changed(); return true;
    }
    case 'startup:set': {
      if (!isEditor) throw new Error('请在编辑器中设置开机自启');
      const result = startup.set(payload); broadcast(); return result;
    }
    case 'apps:pick': {
      const picked = await dialog.showOpenDialog(isLauncher ? launcher : editor, { title: payload?.folder ? '添加文件夹入口' : '添加软件或快捷方式', properties: payload?.folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
        ...(payload?.folder ? {} : { filters: [{ name: '软件与快捷方式', extensions: ['exe', 'lnk'] }, { name: '常用文件', extensions: ['pdf', 'txt', 'md', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'mp4'] }] }) });
      if (picked.canceled) return; return addPaths(picked.filePaths, payload?.pinned === true, payload?.group);
    }
    case 'apps:scan': {
      candidates.clear(); const found = await applications.scan(payload);
      const existing = new Set(state.applications.map(a => path.win32.normalize(a.path).toLowerCase()));
      for (const item of found) if (!existing.has(item.path.toLowerCase())) candidates.set(item.id, item);
      return [...candidates.values()];
    }
    case 'apps:addSelected': {
      if (!Array.isArray(payload) || payload.length > 800) throw new Error('所选入口无效');
      const paths = payload.map(id => candidates.get(id)?.path).filter(Boolean); const result = await addPaths(paths); candidates.clear(); return result;
    }
    case 'app:update': {
      const index = state.applications.findIndex(a => a.id === payload?.id); if (index < 0) throw new Error('入口不存在');
      const old = state.applications[index];
      state.applications[index] = model.normalizeApplication({ ...old, name: payload.patch?.name ?? old.name, group: payload.patch?.group ?? old.group, pinned: payload.patch?.pinned ?? old.pinned }); changed(); return;
    }
    case 'app:remove': {
      const answer = await dialog.showMessageBox(isLauncher ? launcher : editor, { message: '移除这个应用入口？', detail: '只从璃屿移除图标，原软件和文件不会被删除。', buttons: ['保留', '移除'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) { state.applications = state.applications.filter(a => a.id !== payload); changed(); } return;
    }
    case 'app:reorder': {
      const pinned = state.applications.filter(a => a.pinned), position = pinned.findIndex(a => a.id === payload?.id), neighbor = pinned[position + (payload?.direction === -1 ? -1 : 1)];
      if (position >= 0 && neighbor) { const index = state.applications.findIndex(a => a.id === payload.id), target = state.applications.indexOf(neighbor); [state.applications[index], state.applications[target]] = [state.applications[target], state.applications[index]]; changed(); } return;
    }
    case 'app:reveal': { const entry = state.applications.find(a => a.id === payload); if (entry) shell.showItemInFolder(entry.path); return; }
    case 'scene:system': state.useSystemWallpaper = true; state.wallpaper = ''; await readDesktopWallpaper(); changed(); return;
    case 'panel:add': {
      if (state.panels.length >= 40) throw new Error('最多可添加 40 个组件');
      const p = model.createPanel(payload, state.panels.length); state.panels.push(p); syncWidgets(); changed(); return p.id;
    }
    case 'panel:duplicate': {
      if (state.panels.length >= 40) throw new Error('最多可添加 40 个组件');
      const source = state.panels.find(p => p.id === payload); if (!source) throw new Error('组件不存在');
      const p = model.normalizePanel({ ...source, id: crypto.randomUUID(), title: `${source.title} 副本`, x: source.x + 30, y: source.y + 30 });
      state.panels.push(p); syncWidgets(); changed(); return p.id;
    }
    case 'panel:remove': {
      const result = await dialog.showMessageBox(editor, { type: 'question', buttons: ['保留', '删除'], defaultId: 0, cancelId: 0, message: '删除这个面板？', detail: '面板中的便签和待办也会被删除。' });
      if (result.response === 1) { state.panels = state.panels.filter(p => p.id !== payload); syncWidgets(); changed(); } return;
    }
    case 'desktop:toggle': setDesktop(!state.desktopEnabled); return snapshot();
    case 'clickthrough:toggle': setClickThrough(!clickThrough); return snapshot();
    case 'theme:set': if (!['forest', 'dusk', 'ocean'].includes(payload)) throw new Error('未知场景'); state.theme = payload; state.wallpaper = ''; state.useSystemWallpaper = false; changed(); return;
    case 'wallpaper:pick': {
      const picked = await dialog.showOpenDialog(editor, { title: '选择预览壁纸', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], properties: ['openFile'] });
      if (picked.canceled) return;
      const selected = picked.filePaths[0]; if (fs.statSync(selected).size > 8 * 1024 * 1024) throw new Error('请选择小于 8 MB 的图片');
      const ext = path.extname(selected).slice(1).toLowerCase(), mime = ext === 'jpg' ? 'jpeg' : ext;
      if (!['png', 'jpeg', 'webp'].includes(mime)) throw new Error('不支持的图片格式');
      state.wallpaper = `data:image/${mime};base64,${fs.readFileSync(selected).toString('base64')}`; changed(); return;
    }
    case 'layout:export': {
      const picked = await dialog.showSaveDialog(editor, { defaultPath: 'glass-island-layout.json', filters: [{ name: '璃屿布局', extensions: ['json'] }] });
      if (!picked.canceled) { fs.writeFileSync(picked.filePath, JSON.stringify(state, null, 2)); return '布局已导出'; } return;
    }
    case 'layout:import': {
      const picked = await dialog.showOpenDialog(editor, { filters: [{ name: '璃屿布局', extensions: ['json'] }], properties: ['openFile'] });
      if (picked.canceled) return;
      if (fs.statSync(picked.filePaths[0]).size > 16 * 1024 * 1024) throw new Error('布局文件过大');
      const next = model.normalizeConfig(JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8')));
      const answer = await dialog.showMessageBox(editor, { type: 'question', buttons: ['取消', '导入'], defaultId: 0, cancelId: 0, message: `导入 ${next.panels.length} 个面板和 ${next.applications.length} 个本机入口？`, detail: '将替换当前布局；导入的入口仅在你点击时打开。当前配置会先备份到 before-import.json。' });
      if (answer.response !== 1) return;
      fs.writeFileSync(path.join(app.getPath('userData'), 'before-import.json'), JSON.stringify(state, null, 2));
      state = { ...next, desktopEnabled: state.desktopEnabled }; syncWidgets(); changed(); return '布局已导入';
    }
    case 'data:open': await shell.openPath(app.getPath('userData')); return;
    case 'app:quit': app.quit(); return;
    default: throw new Error('不支持的操作');
  }
}
async function boot() {
  model = await import(pathToFileURL(path.join(__dirname, 'model.mjs')));
  bridge = startBridge(); await readDesktopWallpaper();
  applications.configureIcons(bridge ? values => bridge.request('icon', values) : null);
  state = model.defaultConfig();
  if (fs.existsSync(file())) {
    try {
      const raw = JSON.parse(fs.readFileSync(file(), 'utf8')); state = model.normalizeConfig(raw);
      if (raw.version === 1) {
        fs.copyFileSync(file(), path.join(app.getPath('userData'), 'before-upgrade-v02.json'));
        for (const panel of state.panels.filter(p => p.type === 'links')) Object.assign(panel, { title: '软件 Dock', x: 380, y: 745, width: 680, height: 130, opacity: 18, tint: '#17232d' });
      }
      if (raw.version < 3) {
        fs.copyFileSync(file(), path.join(app.getPath('userData'), 'before-upgrade-v03.json'));
        for (const panel of state.panels) {
          panel.opacity = panel.type === 'clock' ? 0 : 8; panel.blur = 0;
          if (panel.type === 'links') { panel.y += Math.max(0, panel.height - 96); panel.y = Math.min(panel.y, 804); panel.height = 96; panel.data.showLabels = false; }
        }
      }
    }
    catch {
      const recovery = await dialog.showMessageBox({ type: 'warning', buttons: ['退出并保留文件', '备份损坏文件并恢复默认'], defaultId: 0, cancelId: 0, message: '布局文件无法读取', detail: `文件位置：${file()}。原文件不会直接覆盖。` });
      if (recovery.response !== 1) { app.quit(); return; }
      fs.copyFileSync(file(), `${file()}.corrupt-${Date.now()}`);
    }
  }
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle('island:action', async (...args) => {
    try { return { ok: true, value: await action(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  if (!testMode) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')));
    tray.setToolTip('璃屿 · Glass Island');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开应用大面板', click: () => openLauncher() },
      { label: '打开编辑器', click: openEditor },
      { label: '显示 / 隐藏桌面面板', click: () => setDesktop(!state.desktopEnabled) },
      { label: '切换鼠标穿透', click: () => setClickThrough(!clickThrough) },
      { type: 'separator' }, { label: '退出璃屿', click: () => app.quit() }
    ]));
    tray.on('double-click', openEditor);
    shortcuts.editor = globalShortcut.register('CommandOrControl+Shift+G', openEditor);
    shortcuts.clickThrough = globalShortcut.register('CommandOrControl+Shift+L', () => setClickThrough(!clickThrough));
    shortcuts.visibility = globalShortcut.register('CommandOrControl+Shift+H', () => setDesktop(!state.desktopEnabled));
    shortcuts.launcher = globalShortcut.register('CommandOrControl+Shift+Space', () => openLauncher(true));
  }
  Menu.setApplicationMenu(null);
  if (autostart) state.desktopEnabled = true;
  else openEditor();
  syncWidgets();
  dockTimer = setInterval(updateDocks, 100);
  refreshIcons().catch(() => { /* Existing entries remain usable if a refresh fails. */ });
  bridgeTimer = setInterval(() => { if (state.desktopEnabled) for (const [id, win] of widgets) { const panel = state.panels.find(p => p.id === id); if (panel) bindDesktop(win, panel); } }, 3000);
  screen.on('display-metrics-changed', () => syncWidgets());
  screen.on('display-removed', () => syncWidgets());
}
if (!testMode && !app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(boot).catch(error => { dialog.showErrorBox('璃屿启动失败', error.message); app.quit(); });
  app.on('second-instance', openEditor);
  app.on('activate', openEditor);
  app.on('window-all-closed', () => { if (!tray || !state?.desktopEnabled) app.quit(); });
  app.on('before-quit', () => { quitting = true; if (state) flush(); clearInterval(bridgeTimer); clearInterval(dockTimer); bridge?.stop(); globalShortcut.unregisterAll(); });
}
