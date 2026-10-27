import { _electron as electron } from 'playwright';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const base = path.resolve('.'), packaged = process.argv.includes('--packaged');
await mkdir('test-results', { recursive: true });
const dir = await mkdtemp(path.join(base, 'test-results/transparent-v03-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
if (packaged && process.argv.includes('--portable-path')) env.PORTABLE_EXECUTABLE_FILE = path.join(base,`release/Glass-Island-${JSON.parse(await readFile('package.json','utf8')).version}-win-x64.exe`);
let app, editor;
const testName = 'GlassIsland.Test.' + createHash('sha256').update(dir).digest('hex').slice(0,12);
const launchOptions = args => ({ ...(packaged ? { executablePath: path.join(base, 'release/win-unpacked/Glass Island.exe') } : {}), args: [...(packaged ? [] : [base]), '--smoke-test', `--data-dir=${dir}`, ...args], env, timeout: 60000 });
async function call(name, payload, page = editor) { const reply = await page.evaluate(([n,p]) => window.island.call(n,p), [name,payload]); assert.equal(reply.ok, true, reply.error); return reply.value; }
async function widgetPage(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const page = app.windows().find(p => p.url().includes(`id=${id}`)); if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Widget page did not attach: ${id}`);
}
try {
  app = await electron.launch(launchOptions([])); editor = await app.firstWindow(); await editor.locator('.preview-panel').first().waitFor();
  await editor.locator('#startup-toggle').check();
  await editor.waitForFunction(() => document.querySelector('#toast').textContent.includes('已开启开机自启'));
  assert.equal((await call('get')).startup.enabled, true);
  if (env.PORTABLE_EXECUTABLE_FILE) assert.equal((await call('get')).startup.path, env.PORTABLE_EXECUTABLE_FILE);
  const name = 'GlassIsland.Test.' + createHash('sha256').update(dir).digest('hex').slice(0,12);
  const registered = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', name], { windowsHide:true, encoding:'utf8' });
  assert.equal(registered.status, 0); assert.ok(registered.stdout.includes('--autostart')); assert.ok(registered.stdout.includes(dir));
  assert.equal((await call('get')).startup.registered, true);
  await editor.locator('#startup-toggle').uncheck();
  await editor.waitForFunction(() => document.querySelector('#toast').textContent.includes('已关闭开机自启'));
  assert.equal((await call('get')).startup.registered, false);
  assert.notEqual(spawnSync('reg.exe', ['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v',name], {windowsHide:true,stdio:'pipe'}).status,0);
  const state = await call('get'), clock = state.panels.find(p => p.type === 'clock'), dock = state.panels.find(p => p.type === 'links');
  await call('panel:update', { id:dock.id, patch:{data:{autoHide:false}} });
  await editor.locator(`[data-select="${dock.id}"]`).click(); await editor.locator('[data-preset="transparent"]').click();
  assert.equal((await call('get')).panels.find(p => p.id === dock.id).opacity, 0);
  await call('desktop:toggle');
  await app.evaluate(async({BrowserWindow}) => { await Promise.all(BrowserWindow.getAllWindows().map(w => w.webContents.isLoading() ? new Promise(r => w.webContents.once('did-finish-load', r)) : Promise.resolve())); });
  for (const id of [clock.id,dock.id]) {
    const page = await widgetPage(id);
    await page.locator('#live-panel.panel-ready.is-transparent').waitFor();
  }
  const alpha = await app.evaluate(async ({ BrowserWindow }, ids) => {
    const results=[];
    for (const id of ids) {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`id=${id}`));
      let result;
      for (let frame=0;frame<20;frame++) {
        const image = await win.webContents.capturePage(); const bytes = image.toBitmap();
        let zero = 0, opaque = 0; for (let i=3;i<bytes.length;i+=4) { if(bytes[i]===0) zero++; if(bytes[i]===255) opaque++; }
        result = { id, zero: zero/(bytes.length/4), opaque: opaque/(bytes.length/4), corner: bytes[3], resizable: win.isResizable() };
        if (result.corner===0 && result.zero>0.65 && result.opaque>0.001) break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      results.push(result);
    }
    return results;
  }, [clock.id,dock.id]);
  for (const result of alpha) { assert.equal(result.corner, 0, 'window corners must be truly transparent'); assert.ok(result.zero > 0.65 && result.opaque>0.001, JSON.stringify(result)); assert.equal(result.resizable, false); }
  const nativeClock = await widgetPage(clock.id), nativeDock = await widgetPage(dock.id);
  await nativeClock.screenshot({ path: 'test-results/transparent-clock.png', omitBackground: true });
  await nativeDock.screenshot({ path: 'test-results/transparent-dock.png', omitBackground: true });
  await call('widget:resize', { width: 420, height: 180 }, nativeClock);
  await nativeClock.waitForFunction(() => innerWidth === 420 && innerHeight === 180);
  const handle = await nativeClock.locator('.native-resize').boundingBox();
  await nativeClock.mouse.move(handle.x+8,handle.y+8); await nativeClock.mouse.down(); await nativeClock.mouse.move(handle.x-20,handle.y-10,{steps:3}); await nativeClock.mouse.up();
  await nativeClock.waitForFunction(() => innerWidth < 420 && innerHeight < 180);
  await call('panel:update', { id: clock.id, patch: { locked: true } });
  const denied = await nativeClock.evaluate(() => window.island.call('widget:resize', { width: 500,height: 200 })); assert.equal(denied.ok, false);
  await app.close(); app=null;
  const saved = JSON.parse(await readFile(path.join(dir,'layout.json'),'utf8')); assert.equal(saved.panels.find(p=>p.id===dock.id).opacity,0);
  app = await electron.launch(launchOptions(['--autostart']));
  const first = await app.firstWindow(); await first.locator('#live-panel').waitFor();
  const urls = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getURL()));
  assert.ok(urls.every(url=>!url.includes('index.html')&&!url.includes('launcher.html')),'login startup only restores widgets');
  assert.equal((await call('get', undefined, first)).desktopEnabled,true);
  console.log('PASS: actual Windows startup entry enable/disable, true alpha-zero window corners and background, transparent preset persistence, custom resize and locking, quiet login startup. Alpha checks: '+JSON.stringify(alpha));
} finally {
  if (app) { await app.evaluate(({app}, name) => app.setLoginItemSettings({ name, openAtLogin:false }), testName).catch(()=>{}); await app.close(); }
}
