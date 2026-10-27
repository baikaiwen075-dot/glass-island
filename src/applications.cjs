const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, shell } = require('electron');
const { iconLocation } = require('./icon-location.cjs');
const ICON_VERSION = 1;
let nativeIcons;
function configureIcons(reader) { nativeIcons = reader; }
const entryTypes = new Set(['.exe', '.lnk', '.pdf', '.txt', '.md', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.mp4']);
function localPath(value) { return typeof value === 'string' && /^[a-z]:[\\/]/i.test(value) && !/[\0\r\n]/.test(value) ? path.win32.normalize(value) : null; }
async function describe(value) {
  const target = localPath(value); if (!target) throw new Error('请选择本机文件或文件夹');
  const stat = await fs.stat(target);
  if (!stat.isDirectory() && (!stat.isFile() || !entryTypes.has(path.extname(target).toLowerCase()))) throw new Error('请选择软件 EXE、LNK 快捷方式、常用文档或文件夹');
  return { id: randomUUID(), name: stat.isDirectory() ? path.basename(target) || path.parse(target).root : path.basename(target, path.extname(target)), path: target, kind: stat.isDirectory() ? 'folder' : path.extname(target).toLowerCase() === '.exe' || path.extname(target).toLowerCase() === '.lnk' ? 'app' : 'file',
    ...await readIcon(target), group: '未分组', pinned: false };
}
async function readIcon(target) {
  let info = {};
  if (path.extname(target).toLowerCase() === '.lnk') { try { info = shell.readShortcutLink(target); } catch {} }
  const location = iconLocation(info.icon, info.iconIndex, target), resolved = iconLocation(info.target);
  if (nativeIcons) {
    try {
      const result = await nativeIcons({ path: target, iconPath: location.path, iconIndex: location.index, targetPath: resolved.path });
      if (result.icon) return { icon: result.icon, iconVersion: ICON_VERSION, iconSource: result.source };
    } catch { /* A missing icon must not prevent adding or opening a program. */ }
  }
  for (const file of [resolved.path, target].filter(Boolean)) {
    try { const image = await app.getFileIcon(file, { size: 'large' }); if (!image.isEmpty()) return { icon: image.toDataURL(), iconVersion: ICON_VERSION, iconSource: 'fallback' }; } catch {}
  }
  return { icon: '', iconVersion: ICON_VERSION, iconSource: 'missing' };
}
async function scan(source) {
  const roots = source === 'desktop' ? [app.getPath('desktop'), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')] : source === 'startmenu' ?
    [path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft/Windows/Start Menu/Programs')] : [];
  if (!roots.length) throw new Error('不支持的扫描来源');
  const paths = [], visited = new Set();
  async function walk(dir, depth) {
    if (depth > 6 || paths.length >= 800) return;
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const item of entries) {
      if (item.isSymbolicLink()) continue;
      const target = path.join(dir, item.name), key = target.toLowerCase(); if (visited.has(key)) continue; visited.add(key);
      if (item.isDirectory()) { if (depth < 6) await walk(target, depth + 1); }
      else if (item.isFile() && /\.(lnk|exe)$/i.test(item.name) && !/uninstall|卸载|更新助手|readme|帮助文档/i.test(item.name)) paths.push(target);
      if (paths.length >= 800) break;
    }
  }
  for (const root of roots) await walk(root, 0);
  const result = [];
  for (let i = 0; i < paths.length; i += 12) result.push(...(await Promise.all(paths.slice(i, i + 12).map(value => describe(value).catch(() => null)))).filter(Boolean));
  return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
async function open(entry) {
  const target = localPath(entry.path); if (!target) throw new Error('入口路径无效');
  await fs.access(target).catch(() => { throw new Error('原软件或快捷方式已移动，请重新添加'); });
  const error = await shell.openPath(target); if (error) throw new Error(`无法打开入口：${error}`);
}
module.exports = { localPath, describe, scan, open, readIcon, configureIcons, ICON_VERSION };
