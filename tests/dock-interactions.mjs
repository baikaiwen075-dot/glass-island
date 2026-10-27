import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/model.mjs';
const base=path.resolve('.'), packaged=process.argv.includes('--packaged');
const dir=await mkdtemp(path.join(base,'test-results/dock-interactions-'));
const helper=path.join(dir,'Cursor.exe'), source=path.join(dir,'Cursor.cs');
 await writeFile(source, `using System;using System.IO;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Web.Script.Serialization;
class Cursor{
 [StructLayout(LayoutKind.Sequential)] struct Point {public int x;public int y;}
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 static void Main(string[] args){
  SetProcessDPIAware();
  if(args.Length==0){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"accidental-launch.txt"),"launched");return;}
  if(args[0]=="cursor"){SetCursorPos(int.Parse(args[1]),int.Parse(args[2]));return;}
  if(args[0]=="position"){Point p;GetCursorPos(out p);Console.WriteLine(new JavaScriptSerializer().Serialize(new{x=p.x,y=p.y}));return;}
  if(args[0]=="close"){PostMessage(new IntPtr(long.Parse(args[1])),0x10,IntPtr.Zero,IntPtr.Zero);return;}
  if(args[0]=="hide"){ShowWindow(new IntPtr(long.Parse(args[1])),0);return;}
  if(args[0]=="minimize"){ShowWindow(new IntPtr(long.Parse(args[1])),6);return;}
  var found=new List<object>();dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
  foreach(dynamic w in shell.Windows()){try{string p=w.Document.Folder.Self.Path;if(p.ToUpperInvariant().Contains("20D04FE0-3AEA-1069-A2D8-08002B30309D")){long h=(long)w.HWND;found.Add(new{hwnd=h,visible=IsWindowVisible(new IntPtr(h)),minimized=IsIconic(new IntPtr(h))});}}catch{}}
  Console.WriteLine(new JavaScriptSerializer().Serialize(found));
 }
}`);
const compiled=spawnSync(path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/reference:Microsoft.CSharp.dll','/reference:System.Web.Extensions.dll',`/out:${helper}`,source],{windowsHide:true});
assert.equal(compiled.status,0,compiled.stdout.toString());
function native(...args){const r=spawnSync(helper,args.map(String),{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()?JSON.parse(r.stdout):null;}
const originalCursor=native('position'), originalWindows=native('windows');
const config=defaultConfig(), dock=config.panels.find(p=>p.type==='links');
config.panels=[dock];dock.data.autoHide=false;
config.applications=Array.from({length:12},(_,i)=>({id:`item-${i}`,name:`软件 ${i+1}`,path:helper,group:i%2?'分组乙':'分组甲',pinned:i<4,icon:'',iconVersion:1,iconSource:'custom'}));
await writeFile(path.join(dir,'layout.json'),JSON.stringify(config));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app,editor,manager,dockPage;const errors=[];
async function call(name,payload,page=editor){const r=await page.evaluate(([n,p])=>window.island.call(n,p),[name,payload]);assert.equal(r.ok,true,r.error);return r.value;}
async function ids(page,selector,key){return page.locator(selector).evaluateAll((nodes,k)=>nodes.map(n=>n.dataset[k]),key);}
async function drag(page,from,to,{cancel=false}={}){
 const a=await from.boundingBox(),b=await to.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
 await page.mouse.move(b.x+b.width*.2,b.y+b.height/2,{steps:12});
 await page.waitForTimeout(200);
 assert.equal(await page.locator('.sort-ghost').count(),1,'drag has a floating icon');
 if(cancel) await page.keyboard.press('Escape');
 await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('.sort-ghost'));
}
async function dockVisible(expected){
 for(let i=0;i<35;i++){
  const visible=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`id=${id}`))?.isVisible(),dock.id);
  if(visible===expected)return;await new Promise(r=>setTimeout(r,70));
 }throw new Error(`Dock visibility did not become ${expected}: `+JSON.stringify(await app.evaluate(({BrowserWindow,screen},id)=>({cursor:screen.getCursorScreenPoint(),windows:BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes(`id=${id}`)).map(w=>({bounds:w.getBounds(),visible:w.isVisible()}))}),dock.id)));
}
async function dockCenter(){return app.evaluate(({BrowserWindow,screen},id)=>{const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`id=${id}`)).getBounds();return screen.dipToScreenPoint({x:b.x+b.width/2,y:b.y+b.height/2});},dock.id);}
try{
 app=await electron.launch({...(packaged?{executablePath:path.join(base,'release/win-unpacked/Glass Island.exe')}:{}),args:[...(packaged?[]:[base]),'--smoke-test',`--data-dir=${dir}`],env,timeout:60000});
 editor=await app.firstWindow();editor.on('pageerror',e=>errors.push(e.message));await editor.locator('.preview-panel').waitFor();
 await call('launcher:toggle');manager=app.windows().find(p=>p.url().includes('launcher.html'))||await app.waitForEvent('window');
 manager.on('pageerror',e=>errors.push(e.message));await manager.locator('.application-card').first().waitFor();
 await drag(manager,manager.locator('[data-entry="item-3"] .app-launch'),manager.locator('[data-entry="item-0"]'));
 await manager.waitForFunction(()=>document.querySelector('.application-card').dataset.entry==='item-3');
 assert.equal((await call('get')).applications[0].id,'item-3');
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('launcher.html')).isVisible()),true,'drag must not launch software or dismiss launcher');
 await drag(manager,manager.locator('[data-entry="item-9"] .app-launch'),manager.locator('[data-entry="item-3"]'));
 assert.equal((await ids(manager,'.application-card','entry'))[0],'item-9','drag across grid rows inserts in the intended slot');
 await manager.locator('[data-group="分组甲"]').click();
 const hiddenBefore=(await call('get')).applications.filter(a=>a.group==='分组乙').map(a=>a.id);
 await drag(manager,manager.locator('[data-entry="item-6"] .app-launch'),manager.locator('[data-entry="item-0"]'));
 assert.equal((await ids(manager,'.application-card','entry'))[0],'item-6');
 assert.deepEqual((await call('get')).applications.filter(a=>a.group==='分组乙').map(a=>a.id),hiddenBefore);
 const beforeCancel=await ids(manager,'.application-card','entry');
 await drag(manager,manager.locator('[data-entry="item-4"] .app-launch'),manager.locator('[data-entry="item-6"]'),{cancel:true});
 assert.deepEqual(await ids(manager,'.application-card','entry'),beforeCancel);
 await manager.locator('[data-group="全部"]').click();
 await manager.locator('#search').fill('软件 1');
 const beforeSearch=(await call('get')).applications.map(a=>a.id),selected=await ids(manager,'.application-card','entry');
 await drag(manager,manager.locator(`[data-entry="${selected.at(-1)}"] .app-launch`),manager.locator(`[data-entry="${selected[0]}"]`));
 const afterSearch=(await call('get')).applications.map(a=>a.id);
 for(let i=0;i<beforeSearch.length;i++)if(!selected.includes(beforeSearch[i]))assert.equal(afterSearch[i],beforeSearch[i]);
 await call('launcher:hide',undefined,manager);
 await call('desktop:toggle');
 await app.evaluate(async({BrowserWindow})=>{await Promise.all(BrowserWindow.getAllWindows().map(w=>w.webContents.isLoading()?new Promise(r=>w.webContents.once('did-finish-load',r)):Promise.resolve()));});
 for(let attempt=0;attempt<100&&!dockPage;attempt++){dockPage=app.windows().find(p=>p.url().includes(`id=${dock.id}`));if(!dockPage)await new Promise(r=>setTimeout(r,50));}
 assert.ok(dockPage,'Dock page attaches before testing controls');dockPage.on('pageerror',e=>errors.push(e.message));await dockPage.locator('[data-app]').first().waitFor();
 const dockOrder=await ids(dockPage,'[data-app]','app');
 await drag(dockPage,dockPage.locator(`[data-app="${dockOrder.at(-1)}"]`),dockPage.locator(`[data-app="${dockOrder[0]}"]`));
 await dockPage.waitForFunction(id=>document.querySelector('[data-app]').dataset.app===id,dockOrder.at(-1));
 const savedOrder=(await call('get')).applications.map(a=>a.id);
 const denied=await dockPage.evaluate(()=>window.island.call('app:sort',{ids:['item-4','item-0'],id:'item-4',beforeId:'item-0'}));assert.equal(denied.ok,false);
 await dockPage.locator('[data-dock-action="computer:open"]').click();
 let computer;
 for(let i=0;i<30;i++){computer=native('windows').find(w=>w.visible&&!w.minimized);if(computer)break;await new Promise(r=>setTimeout(r,150));}
 assert.ok(computer,'This PC opens as an actual visible Windows Explorer window');
 const windowCount=native('windows').length;
 await call('computer:open',undefined,dockPage);
 assert.equal(native('windows').length,windowCount,'repeated clicks reuse the existing This PC window');
 // Only close windows opened by this test, preserving pre-existing Explorer windows.
 for(const w of native('windows'))if(!originalWindows.some(old=>old.hwnd===w.hwnd))native('close',w.hwnd);
 native('cursor',0,0);
 await editor.locator(`[data-select="${dock.id}"]`).click();
 await editor.locator('[data-field="autoHide"]').check();
 await dockVisible(false);
 const center=await dockCenter();native('cursor',center.x,center.y);await dockVisible(true);
 await call('widget:interaction',true,dockPage);native('cursor',0,0);await new Promise(r=>setTimeout(r,650));await dockVisible(true);
 await call('widget:interaction',false,dockPage);await dockVisible(false);
 for(let i=0;i<2;i++){native('cursor',center.x,center.y);await dockVisible(true);native('cursor',0,0);await dockVisible(false);}
 await editor.locator('[data-field="autoHide"]').uncheck();await dockVisible(true);
 await editor.locator('[data-field="autoHide"]').check();await dockVisible(false);
 // Repositioning must move the hidden activation range too.
 await call('panel:update',{id:dock.id,patch:{x:90,y:100}});await dockVisible(false);
 const moved=await dockCenter();native('cursor',moved.x,moved.y);await dockVisible(true);
 assert.deepEqual(errors,[]);
 await assert.rejects(readFile(path.join(dir,'accidental-launch.txt')),{code:'ENOENT'});
 await app.close();app=null;
 const disk=JSON.parse(await readFile(path.join(dir,'layout.json'),'utf8'));
 assert.deepEqual(disk.applications.map(a=>a.id),savedOrder);assert.equal(disk.panels[0].data.autoHide,true);
 app=await electron.launch({...(packaged?{executablePath:path.join(base,'release/win-unpacked/Glass Island.exe')}:{}),args:[...(packaged?[]:[base]),'--smoke-test',`--data-dir=${dir}`],env,timeout:60000});editor=await app.firstWindow();await editor.locator('.preview-panel').waitFor();
 assert.deepEqual((await call('get')).applications.map(a=>a.id),savedOrder);
 console.log('PASS: pointer drag with live displacement, filtered and search sorting, Escape cancellation, Dock drag without accidental launch, widget sort permissions, actual visible This PC window, native cursor leave/hide/re-entry/reveal, repeated wake, interaction hold, opt-out, moved activation bounds, order and auto-hide persistence after relaunch.');
}finally{
 if(app)await app.close();native('cursor',originalCursor.x,originalCursor.y);
 for(const w of native('windows'))if(!originalWindows.some(old=>old.hwnd===w.hwnd))native('close',w.hwnd);
 for(const w of originalWindows){if(!w.visible)native('hide',w.hwnd);else if(w.minimized)native('minimize',w.hwnd);}
}
