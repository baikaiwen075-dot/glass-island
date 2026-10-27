import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createStartup } = createRequire(import.meta.url)('../src/startup.cjs');
const { iconLocation } = createRequire(import.meta.url)('../src/icon-location.cjs');
import { defaultConfig, normalizeConfig, normalizePanel, normalizeApplication, createPanel, safeURL, calendarCells, fitBounds, TYPES, reorderApplications, calendarDate, shiftCalendarMonth } from '../src/model.mjs';
import { content } from '../src/components.mjs';
test('all component types round trip through validated layouts', () => {
  const raw = defaultConfig(); raw.panels = TYPES.map(createPanel);
  assert.deepEqual(normalizeConfig(raw), raw);
  assert.notEqual(defaultConfig().panels[0].id, defaultConfig().panels[0].id);
});
test('untrusted layouts reject duplicate identifiers and unknown schemas', () => {
  assert.throws(() => normalizeConfig({ version: 99, panels: [] }));
  assert.throws(() => normalizeConfig({ version: 1, panels: Array(41).fill({}) }));
  assert.throws(() => normalizePanel({ type: 'html' }));
  const p = createPanel('clock'); assert.throws(() => normalizeConfig({ version: 1, panels: [p, p] }));
});
test('only web links are allowed; script/file/credential URLs cannot launch', () => {
  for (const value of ['javascript:alert(1)', 'file:///C:/Windows/cmd.exe', 'ms-settings:', 'data:text/html,test', 'https://a:b@example.com', null, {}]) assert.equal(safeURL(value), null);
  assert.equal(safeURL('https://github.com'), 'https://github.com/');
  const p = createPanel('links'); p.data.links.push({ label: 'malicious', url: 'file:///C:/a.exe' });
  assert.equal(normalizePanel(p).data.links.length, 0);
});
test('numeric bounds, colors and content are normalized without carrying unknown fields', () => {
  const p = normalizePanel({ ...createPanel('note'), width: 10, height: Infinity, opacity: 200, tint: 'url(https://bad)', radius: -50, html: '<script>', data: { text: '<b>literal text</b>', items: [null] } });
  assert.equal(p.width, 180); assert.equal(p.height, 255); assert.equal(p.opacity, 100); assert.equal(p.radius, 0);
  assert.equal(p.tint, '#17232d'); assert.equal(p.html, undefined); assert.equal(p.data.text, '<b>literal text</b>');
});
test('application entries reject protocols and remote paths; old layouts migrate to v3', () => {
  for (const path of ['https://github.com', 'javascript:evil()', '\\\\server\\app.exe', 'relative.exe', 'C:\\a.exe\nextra']) assert.throws(() => normalizeApplication({ path }));
  const app = normalizeApplication({ path: 'C:\\Program Files\\编辑器\\app.exe', name: '编辑器', group: '创作', pinned: true, icon: 'data:image/svg+xml;base64,AAAA', command: 'evil' });
  assert.equal(app.name, '编辑器'); assert.equal(app.group, '创作'); assert.equal(app.pinned, true); assert.equal(app.icon, ''); assert.equal(app.command, undefined);
  const old = { ...defaultConfig(), version: 1 }; delete old.applications;
  assert.equal(normalizeConfig(old).version, 3); assert.deepEqual(normalizeConfig(old).applications, []);
});
test('zero opacity and compact Dock dimensions survive save/load', () => {
  const config = defaultConfig();
  const clock = config.panels.find(p => p.type === 'clock'), dock = config.panels.find(p => p.type === 'links');
  assert.equal(clock.opacity, 0); dock.opacity = 0; dock.height = 80; dock.data.showLabels = true;
  const next = normalizeConfig(JSON.parse(JSON.stringify(config)));
  assert.equal(next.panels[0].opacity, 0); assert.equal(next.panels[3].opacity, 0); assert.equal(next.panels[3].height, 80); assert.equal(next.panels[3].data.showLabels, true);
});
test('shortcut icon locations preserve resource indexes, quotes and environment variables', () => {
  assert.deepEqual(iconLocation('"%ProgramFiles%\\App\\icons.dll", -42', 0, '', { PROGRAMFILES:'C:\\Program Files' }), { path:'C:\\Program Files\\App\\icons.dll', index:-42 });
  assert.deepEqual(iconLocation('icons\\custom.ico', 10, 'D:\\My App\\app.lnk'), { path:'D:\\My App\\icons\\custom.ico', index:10 });
  assert.deepEqual(iconLocation('D:\\Icons, Logos\\app.ico', 0), {path:'D:\\Icons, Logos\\app.ico',index:0});
  assert.equal(iconLocation('\\\\server\\icon.ico').path,''); assert.equal(iconLocation(',0').path,'');
});
test('autostart targets the outer portable EXE and can remove its own entry', () => {
  let stored;
  const fakeApp = { isPackaged: true, getAppPath: () => 'C:\\Temp\\unpacked', getPath: () => 'C:\\User\\Test',
    setLoginItemSettings: options => { stored = options; }, getLoginItemSettings: () => ({ openAtLogin: stored?.openAtLogin === true, executableWillLaunchAtLogin: stored?.openAtLogin === true }) };
  const startup = createStartup(fakeApp, { execPath: 'C:\\Temp\\unpacked\\Glass Island.exe', env: { PORTABLE_EXECUTABLE_FILE: 'D:\\My Apps\\GlassIsland.exe' } });
  assert.equal(startup.set(true).enabled, true); assert.equal(stored.path, 'D:\\My Apps\\GlassIsland.exe'); assert.deepEqual(stored.args, ['--autostart']); assert.equal(stored.name, 'GlassIsland.Desktop');
  assert.equal(startup.set(false).registered, false);
  const testStartup = createStartup(fakeApp, { testMode: true, env: {} }); assert.notEqual(testStartup.options.name, 'GlassIsland.Desktop'); assert.ok(testStartup.options.args.includes('--smoke-test'));
});
test('wallpaper accepts embedded raster images only', () => {
  for (const wallpaper of ['https://example.com/image.png', 'data:image/svg+xml;base64,abcd', 'file:///a.png']) assert.equal(normalizeConfig({ ...defaultConfig(), wallpaper }).wallpaper, '');
  assert.equal(normalizeConfig({ ...defaultConfig(), wallpaper: 'data:image/png;base64,abcd' }).wallpaper, 'data:image/png;base64,abcd');
});
test('calendar is Monday-first and includes leap days', () => {
  const feb = calendarCells(new Date(2024, 1, 10)); assert.equal(feb[3], 1); assert.equal(feb.filter(Boolean).length, 29); assert.equal(feb.length % 7, 0);
  const monday = calendarCells(new Date(2026, 5, 1)); assert.equal(monday[0], 1); assert.equal(monday.filter(Boolean).length, 30);
});
test('panels recover onto a monitor after display removal', () => {
  assert.deepEqual(fitBounds({ x: -3000, y: 900, width: 400, height: 200 }, { x: 0, y: 0, width: 1920, height: 1080 }), { x: 0, y: 880, width: 400, height: 200 });
  assert.deepEqual(fitBounds({ x: 900, y: 900, width: 1000, height: 900 }, { x: -800, y: 0, width: 800, height: 600 }), { x: -800, y: 0, width: 800, height: 600 });
});

test('drag ordering inserts between visible entries and preserves filtered-out positions', () => {
  const apps = ['a','hidden','b','c'].map(id => ({ id }));
  const moved = reorderApplications(apps, { ids: ['a','b','c'], id:'c', beforeId:'a' });
  assert.deepEqual(moved.map(a => a.id), ['c','hidden','a','b']);
  assert.deepEqual(reorderApplications(moved, { ids:['c','a','b'],id:'c',beforeId:null }).map(a=>a.id),['a','hidden','b','c']);
  assert.deepEqual(apps.map(a=>a.id),['a','hidden','b','c']);
  for (const payload of [{ids:['a','a'],id:'a',beforeId:null},{ids:['a','missing'],id:'a',beforeId:null},{ids:['a','b'],id:'a',beforeId:'hidden'},{ids:['a'],id:'a',beforeId:'a'}]) assert.throws(()=>reorderApplications(apps,payload));
});

test('Dock auto hide is enabled by default and an explicit opt out survives round trip', () => {
  assert.equal(normalizePanel({type:'links'}).data.autoHide,true);
  const dock=createPanel('links'); dock.data.autoHide=false;
  assert.equal(normalizePanel(JSON.parse(JSON.stringify(dock))).data.autoHide,false);
});

test('calendar navigation handles year boundaries, leap years, validation and returning to current month', () => {
  assert.equal(shiftCalendarMonth('2026-12',1),'2027-01');
  assert.equal(shiftCalendarMonth('2026-01',-1),'2025-12');
  assert.equal(shiftCalendarMonth('',1,new Date(2026,9,27)),'2026-11');
  assert.equal(shiftCalendarMonth('2028-02',0),'');
  assert.equal(calendarCells(calendarDate('2028-02')).filter(Boolean).length,29);
  assert.throws(()=>shiftCalendarMonth('2026-01',2));assert.throws(()=>shiftCalendarMonth('9999-12',1));
  const p=createPanel('calendar');p.data.calendarMonth='2027-01';
  assert.equal(normalizePanel(p).data.calendarMonth,'2027-01');
  assert.equal(normalizePanel({...p,data:{calendarMonth:'2026-13'}}).data.calendarMonth,'');
});

test('calendar highlights today only in the current month and exposes accessible navigation', () => {
  const p=createPanel('calendar'), now=new Date();
  assert.ok(content(p).includes('class="today"'));
  p.data.calendarMonth=shiftCalendarMonth('',1,now);
  const html=content(p);
  assert.equal(html.includes('class="today"'),false);
  for(const label of ['上个月','下个月','回到本月'])assert.ok(html.includes(`aria-label="${label}"`));
});
