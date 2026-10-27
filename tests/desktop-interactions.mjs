import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaultConfig, createPanel } from '../src/model.mjs';
const base=path.resolve('.'), packaged=process.argv.includes('--packaged');
const dir=await mkdtemp(path.join(base,'test-results/desktop-interactions-'));
const helper=path.join(dir,'Mouse.exe'), source=path.join(dir,'Mouse.cs');
await writeFile(source,`using System;using System.Runtime.InteropServices;
class Mouse{
 [StructLayout(LayoutKind.Sequential)] struct Point{public int x;public int y;}
 [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint f);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 static void Main(string[] a){SetProcessDPIAware();
  if(a[0]=="position"){Point p;GetCursorPos(out p);Console.WriteLine(p.x+","+p.y+","+GetForegroundWindow().ToInt64());return;}
  if(a[0]=="restore"){SetCursorPos(int.Parse(a[1]),int.Parse(a[2]));SetForegroundWindow(new IntPtr(long.Parse(a[3])));return;}
  SetCursorPos(int.Parse(a[1]),int.Parse(a[2]));System.Threading.Thread.Sleep(100);Point hit;GetCursorPos(out hit);Console.WriteLine(GetAncestor(WindowFromPoint(hit),2).ToInt64());mouse_event(2,0,0,0,UIntPtr.Zero);System.Threading.Thread.Sleep(30);mouse_event(4,0,0,0,UIntPtr.Zero);
 }}
`);
const compile=spawnSync(path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo',`/out:${helper}`,source],{windowsHide:true});assert.equal(compile.status,0,compile.stdout.toString());
function mouse(...args){const r=spawnSync(helper,args.map(String),{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
const previous=mouse('position').split(',');
const config=defaultConfig(),todo=createPanel('todo'),calendar=createPanel('calendar');
Object.assign(todo,{x:70,y:130,width:350,height:300,opacity:25});
Object.assign(calendar,{x:500,y:130,width:350,height:340,opacity:25});
todo.data.items=[{id:'one',text:'在桌面完成的任务',done:false},{id:'two',text:'另一项任务',done:false}];
config.panels=[todo,calendar];config.desktopEnabled=true;
await writeFile(path.join(dir,'layout.json'),JSON.stringify(config));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const options={...(packaged?{executablePath:path.join(base,'release/win-unpacked/Glass Island.exe')}:{}),args:[...(packaged?[]:[base]),'--smoke-test',`--data-dir=${dir}`],env,timeout:60000};
let app,editor,todoPage,calendarPage;const errors=[];
async function call(name,payload,page=editor){const r=await page.evaluate(([n,p])=>window.island.call(n,p),[name,payload]);assert.equal(r.ok,true,r.error);return r.value;}
async function nativeClick(page,selector,{checkbox=false,padding=false}={}){
 const id=new URL(page.url()).searchParams.get('id');
 await app.evaluate(({BrowserWindow},id)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`id=${id}`));w.show();w.focus();w.moveTop();},id);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const box=await page.locator(checkbox?`${selector} .checkbox`:selector).boundingBox();assert.ok(box);
 const point=await app.evaluate(({BrowserWindow,screen},{id,x,y})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`id=${id}`)),b=w.getContentBounds();return screen.dipToScreenPoint({x:Math.round(b.x+x),y:Math.round(b.y+y)});},{id,x:box.x+(padding?3:box.width/2),y:box.y+box.height/2});
 const hit=mouse('click',point.x,point.y);
 const expected=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`id=${id}`)).getNativeWindowHandle().readBigUInt64LE().toString(),id);
 assert.equal(hit,expected,'native mouse hit belongs to '+selector+' at '+JSON.stringify(point));
}
async function open(){
 app=await electron.launch(options);editor=await app.firstWindow();await editor.locator('.preview-panel').first().waitFor();
 await app.evaluate(async({BrowserWindow})=>{await Promise.all(BrowserWindow.getAllWindows().map(w=>w.webContents.isLoading()?new Promise(r=>w.webContents.once('did-finish-load',r)):Promise.resolve()));});
 todoPage=null;calendarPage=null;
 for(let attempt=0;attempt<100&&(!todoPage||!calendarPage);attempt++){
  todoPage=app.windows().find(p=>p.url().includes(`id=${todo.id}`));calendarPage=app.windows().find(p=>p.url().includes(`id=${calendar.id}`));
  if(!todoPage||!calendarPage)await new Promise(r=>setTimeout(r,50));
 }
 assert.ok(todoPage&&calendarPage,'Both desktop pages attach before testing controls');
 for(const p of [editor,todoPage,calendarPage])p.on('pageerror',e=>errors.push(e.message));
 await todoPage.locator('[data-todo="0"]').waitFor();await calendarPage.locator('[data-calendar="1"]').waitFor();
}
try{
 await open();
 // A focused button must update immediately, without blurring or returning to the editor.
 await todoPage.locator('[data-todo="0"]').click();
 await todoPage.locator('[data-todo="0"][aria-pressed="true"]').waitFor();
 assert.equal(await todoPage.locator('.tiny-tag').textContent(),'1 / 2');
 await todoPage.locator('[data-todo="0"]').press('Space');
 await todoPage.locator('[data-todo="0"][aria-pressed="false"]').waitFor();
 // The editor is hidden for all native mouse tests.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).hide());
 await nativeClick(todoPage,'[data-todo="0"]',{checkbox:true});
 await todoPage.locator('[data-todo="0"][aria-pressed="true"]').waitFor({timeout:5000});
 await nativeClick(todoPage,'[data-todo="0"]',{checkbox:true});
 await todoPage.locator('[data-todo="0"][aria-pressed="false"]').waitFor({timeout:5000});
 for(const p of [todo,calendar])await call('panel:update',{id:p.id,patch:{opacity:0,locked:true}});
 await nativeClick(todoPage,'[data-todo="1"]',{checkbox:true});
 await todoPage.locator('[data-todo="1"][aria-pressed="true"]').waitFor({timeout:5000});
 assert.equal((await call('get')).panels.find(p=>p.id===todo.id).data.items[1].done,true);
 const now=new Date(),label=(y,m)=>`${y} 年 ${m} 月`;
 await call('panel:update',{id:calendar.id,patch:{data:{calendarMonth:'2026-12'}}});
 await nativeClick(calendarPage,'[data-calendar="1"]',{padding:true});
 await calendarPage.waitForFunction(()=>document.querySelector('.calendar-month').textContent==='2027 年 1 月');
 await nativeClick(calendarPage,'[data-calendar="-1"]');
 await calendarPage.waitForFunction(()=>document.querySelector('.calendar-month').textContent==='2026 年 12 月');
 await call('panel:update',{id:calendar.id,patch:{data:{calendarMonth:'2028-03'}}});
 await nativeClick(calendarPage,'[data-calendar="-1"]');
 await calendarPage.waitForFunction(()=>document.querySelector('.calendar-month').textContent==='2028 年 2 月');
 assert.equal(await calendarPage.locator('.calendar-grid span:not(.weekday)').evaluateAll(nodes=>nodes.filter(n=>n.textContent).length),29);
 assert.equal(await calendarPage.locator('.today').count(),0);
 await nativeClick(calendarPage,'[data-calendar="0"]');
 await calendarPage.waitForFunction(expected=>document.querySelector('.calendar-month').textContent===expected,label(now.getFullYear(),now.getMonth()+1));
 assert.equal(await calendarPage.locator('.today').textContent(),String(now.getDate()));
 // Rapid requests use main-process state so successive clicks cannot overwrite each other.
 const replies=await todoPage.evaluate(id=>Promise.all(Array.from({length:4},()=>window.island.call('todo:toggle',{id,index:1}))),todo.id);
 assert.ok(replies.every(r=>r.ok));assert.equal((await call('get')).panels.find(p=>p.id===todo.id).data.items[1].done,true);
 const denied=await todoPage.evaluate(id=>window.island.call('calendar:move',{id,direction:1}),calendar.id);assert.equal(denied.ok,false);
 const wrong=await todoPage.evaluate(id=>window.island.call('todo:toggle',{id,index:-1}),todo.id);assert.equal(wrong.ok,false);
 await call('clickthrough:toggle');await todoPage.locator('#interaction-hint:not([hidden])').waitFor();
 await call('clickthrough:toggle');await todoPage.locator('#interaction-hint[hidden]').waitFor({state:'attached'});
 await nativeClick(todoPage,'[data-todo="0"]',{checkbox:true});await todoPage.locator('[data-todo="0"][aria-pressed="true"]').waitFor({timeout:5000});
 // Calendar actions in the preview use the same state and must not drag the panel.
 await call('panel:update',{id:calendar.id,patch:{locked:false}});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).show());
 const before=(await call('get')).panels.find(p=>p.id===calendar.id);
 await editor.locator(`[data-id="${calendar.id}"] [data-calendar="1"]`).click();
 const savedMonth=(await call('get')).panels.find(p=>p.id===calendar.id).data.calendarMonth;
 assert.ok(savedMonth);assert.deepEqual([(await call('get')).panels.find(p=>p.id===calendar.id).x,(await call('get')).panels.find(p=>p.id===calendar.id).y],[before.x,before.y]);
 await calendarPage.waitForFunction(()=>document.querySelectorAll('.today').length===0);
 await calendarPage.screenshot({path:'test-results/interactive-calendar.png',omitBackground:true});
 await todoPage.screenshot({path:'test-results/interactive-todo.png',omitBackground:true});
 await app.close();app=null;
 const disk=JSON.parse(await readFile(path.join(dir,'layout.json'),'utf8'));
 assert.equal(disk.panels[0].data.items[0].done,true);assert.equal(disk.panels[1].data.calendarMonth,savedMonth);
 await open();assert.equal(await todoPage.locator('[data-todo="0"]').getAttribute('aria-pressed'),'true');
 assert.equal((await call('get')).panels.find(p=>p.id===calendar.id).data.calendarMonth,savedMonth);
 assert.deepEqual(errors,[]);
 console.log('PASS: focused todo/keyboard immediate updates, real OS checkbox and month clicks while editor hidden, zero-opacity and locked widget interactions, year rollover and leap February, current-month reset/today marker, atomic rapid toggles, IPC permissions, click-through hint and recovery, preview actions without dragging, persistence after relaunch.');
}finally{if(app)await app.close();mouse('restore',...previous);}
