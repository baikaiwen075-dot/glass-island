import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base=path.resolve('.'), packaged=process.argv.includes('--packaged');
await mkdir('test-results',{recursive:true});const root=await mkdtemp(path.join(base,'test-results/icons-')),data=path.join(root,'data');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
async function launch(){app=await electron.launch({...packaged?{executablePath:path.join(base,'release/win-unpacked/Glass Island.exe')}:{},args:[...packaged?[]:[base],'--smoke-test',`--data-dir=${data}`],env,timeout:60000});page=await app.firstWindow();await page.locator('.preview-panel').first().waitFor();}
async function call(name,payload){const r=await page.evaluate(([n,p])=>window.island.call(n,p),[name,payload]);assert.equal(r.ok,true,r.error);return r.value;}
try{
 await launch();
 const png=await app.evaluate(({nativeImage})=>{const bytes=Buffer.alloc(64*64*4);for(let i=0;i<bytes.length;i+=4){bytes[i]=235;bytes[i+1]=80;bytes[i+2]=20;bytes[i+3]=255;}return nativeImage.createFromBitmap(bytes,{width:64,height:64}).toPNG().toString('base64');});
 const image=Buffer.from(png,'base64'),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=64;header[7]=64;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
 const ico=path.join(root,'custom.ico');await writeFile(ico,Buffer.concat([header,image]));
 const source=path.join(root,'Fixture.cs'),exe=path.join(root,'IconFixture.exe');await writeFile(source,'class Fixture{static void Main(){}}');
 const compiled=spawnSync(path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe',`/win32icon:${path.join(base,'assets/icon.ico')}`,`/out:${exe}`,source],{windowsHide:true});assert.equal(compiled.status,0,compiled.stdout?.toString());
 const custom=path.join(root,'custom.lnk'),indexed=path.join(root,'indexed.lnk'),negative=path.join(root,'negative.lnk'),expanded=path.join(root,'expanded.lnk');
 await app.evaluate(({shell},{root,exe,ico,custom,indexed,negative,expanded})=>{process.env.GLASS_ICON_ROOT=root;for(const [file,icon,iconIndex]of[[custom,ico,0],[indexed,process.env.SystemRoot+'\\System32\\shell32.dll',3],[negative,process.env.SystemRoot+'\\System32\\shell32.dll',-4],[expanded,'%GLASS_ICON_ROOT%\\custom.ico',0]])if(!shell.writeShortcutLink(file,{target:exe,icon,iconIndex}))throw Error('Failed to create fixture');},{root,exe,ico,custom,indexed,negative,expanded});
 const result=await call('apps:addPaths',{paths:[custom,indexed,negative,expanded,exe],pinned:true});assert.equal(result.added,5);
 const entries=(await call('get')).applications,find=p=>entries.find(a=>a.path===p);
 assert.equal(find(custom).iconSource,'location');assert.equal(find(indexed).iconSource,'location');assert.equal(find(negative).iconSource,'location');assert.equal(find(expanded).icon,find(custom).icon);
 assert.notEqual(find(custom).icon,find(exe).icon);assert.notEqual(find(indexed).icon,find(exe).icon);
 const pixels=await app.evaluate(({nativeImage},data)=>{const image=nativeImage.createFromDataURL(data);return{size:image.getSize(),pixel:Array.from(image.toBitmap().subarray(0,4))};},find(custom).icon);
 assert.equal(pixels.size.width,64);assert.deepEqual(pixels.pixel,[235,80,20,255]);
 const id=find(custom).id;await call('app:update',{id,patch:{name:'保留名称',group:'创作',pinned:true}});
 await app.close();app=null;
 const file=path.join(data,'layout.json'),old=JSON.parse(await readFile(file,'utf8'));for(const a of old.applications){a.icon='data:image/png;base64,'+(await readFile('assets/icon.png')).toString('base64');delete a.iconVersion;delete a.iconSource;}await writeFile(file,JSON.stringify(old));
 await launch();
 for(let n=0;n<100;n++){const state=await call('get');if(!state.refreshingIcons&&state.applications.every(a=>a.iconVersion===1))break;await new Promise(r=>setTimeout(r,50));}
 const restored=(await call('get')).applications.find(a=>a.id===id);assert.equal(restored.icon,find(custom).icon);assert.equal(restored.name,'保留名称');assert.equal(restored.group,'创作');assert.equal(restored.pinned,true);await access(path.join(data,'before-icon-repair.json'));
 await call('launcher:toggle');const manager=app.windows().find(p=>p.url().includes('launcher.html'))||await app.waitForEvent('window',{predicate:p=>p.url().includes('launcher.html')});await manager.locator('#refresh-icons').waitFor();
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(base,'assets/icon.png'));
 await call('app:icon:pick',id);const changed=(await call('get')).applications.find(a=>a.id===id);assert.equal(changed.iconSource,'custom');assert.notEqual(changed.icon,restored.icon);
 await manager.locator('#refresh-icons').click();await manager.waitForFunction(()=>document.querySelector('#launcher-toast').textContent.includes('已刷新'));assert.equal((await call('get')).applications.find(a=>a.id===id).icon,changed.icon);
 await call('app:icon:reset',id);assert.equal((await call('get')).applications.find(a=>a.id===id).icon,restored.icon);
 console.log('PASS: ICO pixels at 64px, executable resources, positive/negative resource indexes, environment paths, automatic legacy cache repair with backup, preserved groups/names/pins, custom icon protection, manual refresh/reset.');
}finally{if(app)await app.close();}
