// Named VM-only security regression. No Electron, filesystem adapter or app runtime.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT1\n--scope\nsynthetic'){
  console.error(JSON.stringify({status:'REFUSED',code:'SECURITY_ENTRYPOINT_OR_SCOPE_DENIED'}));process.exitCode=2;
}else if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')){
  console.error(JSON.stringify({status:'REFUSED',code:'SECURITY_STARTUP_ENV_DENIED'}));process.exitCode=2;
}else main().catch(error=>{console.error(String(error.stack||error));process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
  const root=path.resolve(__dirname,'..','..'),qa=path.join(root,'qa','integration');
  const files=['electron/frontend-policy.cjs','electron/shot-inspector.cjs','electron/remote/appearance.js','electron/preload.cjs','electron/main.cjs','src/LightingStudio.jsx','index.html','shot-inspector.html','vite.config.mjs'];
  const sources=new Map(files.map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]));
  const hashes=Object.fromEntries([...files,'tests/t2/security-policy.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  const report={tier:'T1',scope:'synthetic',entrypoint:'tests/t2/security-policy.cjs',
    command:'node --no-addons tests/t2/security-policy.cjs --tier T1 --scope synthetic',sourceCommit:readHead(),sourceHashes:hashes,
    execution:'actual policy, Inspector constructor/open, appearance and preload JavaScript in VM mocks; no actual Electron',
    environment:{node:process.version,platform:process.platform,noAddons:true},results:[],denied:[],graphs:[],
    limits:{totalMs:10000,caseMs:1000,maxCases:40,networkConnections:0,subprocesses:0,nativeModules:0},
    compatibility:{scripts:'self: external startup script and Vite production modules',styles:'self + inline React/GSAP/appearance styles',fonts:'self: bundled @fontsource Manrope',
      images:'self + focal-asset: + data: for previews/focus JPEG/Remote QR',canvas:'createImageBitmap(new Blob(bytes)) and canvas drawing; no object URL or source Worker found',
      development:'React refresh inline bootstrap and exact loopback HTTP/WS HMR need dev-only CSP transform',permissions:'deny all browser permissions; HEX clipboard uses bounded main IPC; Inspector clipboard uses bounded IPC',
      residual:'Actual Electron custom scheme, session permissions, packaged asset loading and hardware not certified by VM.'}};
  const tests=[];const add=(name,run)=>tests.push({name,run});
  function loader({isPackaged=true,devURL,failHandleAt=0,failProtocol=false,existingProtocol=false,clipboardWriter}={}){
    const attempts=[],cache=new Map(),handlers=new Map(),protocols=new Map(),windows=[],clipboard=[],invoke=[],exposed={};
    let handleCalls=0,protocolFault=failProtocol,expectedProbe=false;const removals=[];
    const blocked=operation=>{const attempt={operation,expected:expectedProbe};attempts.push(attempt);report.denied.push(attempt);const error=Error('SECURITY_SIDE_EFFECT_DENIED: '+operation);error.code='SECURITY_SIDE_EFFECT_DENIED';throw error;};
    const permission={};
    if(existingProtocol)protocols.set('focal-asset','preexisting-owner');
    const isolatedSession={setPermissionRequestHandler:handler=>{permission.request=handler;},setPermissionCheckHandler:handler=>{permission.check=handler;},
      protocol:{handle(scheme,handler){if(protocolFault){protocolFault=false;throw Error('controlled protocol registration failure');}if(protocols.has(scheme))throw Error('duplicate scheme');protocols.set(scheme,handler);},
        unhandle(scheme){protocols.delete(scheme);removals.push('protocol:'+scheme);}}};
    class BrowserWindow{
      constructor(options){this.options=options;this.events=new Map();this.destroyed=false;this.loads=[];this.webContents={mainFrame:{},events:new Map(),send:()=>{},setWindowOpenHandler:fn=>{this.openHandler=fn;},on:(name,fn)=>{this.webContents.events.set(name,fn);}};windows.push(this);}
      isDestroyed(){return this.destroyed;}isMinimized(){return false;}restore(){}show(){}focus(){}setBackgroundColor(){}
      on(name,fn){this.events.set(name,fn);}once(name,fn){this.events.set(name,fn);}
      destroy(){this.destroyed=true;this.events.get('closed')?.();}
      loadURL(url){this.loads.push({url});return Promise.resolve();}loadFile(file){this.loads.push({file});return Promise.resolve();}
    }
    const electron={app:{isPackaged},BrowserWindow,session:{fromPartition(partition){assert.equal(partition,'persist:apertrove-shot-inspector');return isolatedSession;}},
      ipcMain:{handle(channel,handler){handleCalls++;if(handleCalls===failHandleAt)throw Error('controlled IPC registration failure '+failHandleAt);if(handlers.has(channel))throw Error('duplicate channel '+channel);handlers.set(channel,handler);},removeHandler(channel){removals.push(channel);handlers.delete(channel);}},
      utilityProcess:{fork:()=>blocked('utilityProcess.fork')},shell:{showItemInFolder:()=>blocked('shell.showItemInFolder')},clipboard:{writeText:text=>{clipboard.push(text);return clipboardWriter?.(text);}},
      contextBridge:{exposeInMainWorld:(name,value)=>{exposed[name]=value;}},
      ipcRenderer:{on:()=>{},removeListener:()=>{},send:()=>blocked('ipcRenderer.send'),invoke:(channel,args)=>{invoke.push({channel,args});return Promise.resolve(true);}}};
    const imports=new Map([['node:path',path],['electron',electron],['node:crypto',{randomUUID:()=>blocked('randomUUID')}],
      ['node:fs/promises',new Proxy({},{get:(_target,key)=>()=>blocked('fs/promises.'+String(key))})],
      ['node:fs',{createReadStream:()=>blocked('createReadStream')}],['node:stream',{Readable:{toWeb:()=>blocked('Readable.toWeb')}}]]);
    const allowed=new Set(['electron/frontend-policy.cjs','electron/shot-inspector.cjs','electron/remote/appearance.js','electron/preload.cjs']);
    const graph=[],scanned=new Set();
    function resolve(request,parent){
      if(imports.has(request))return request;
      const target=typeof request==='string'&&request.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(parent),request)):null;
      if(!allowed.has(target))return blocked('import '+String(request));return target;
    }
    function scan(file){
      if(scanned.has(file))return;assert.ok(allowed.has(file));scanned.add(file);const source=sources.get(file);
      assert.ok(!/\bimport\s*(?:\(|['"{*])|\beval\s*\(|\bnew\s+Function\s*\(/.test(source),'dynamic code excluded');
      const requires=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];assert.equal((source.match(/\brequire\s*\(/g)||[]).length,requires.length);
      for(const match of requires){const target=resolve(match[2],file);graph.push({from:file,request:match[2],target});if(!imports.has(target))scan(target);}
    }
    const context=vm.createContext({URL,process:Object.freeze({env:Object.freeze({FOCAL_DEV_URL:devURL}),argv:Object.freeze([])}),setTimeout:()=>blocked('setTimeout'),clearTimeout:()=>blocked('clearTimeout'),Response:function(){return blocked('Response');}},{codeGeneration:{strings:false,wasm:false}});
    function execute(file){
      if(imports.has(file))return imports.get(file);if(cache.has(file))return cache.get(file).exports;
      const module={exports:{}};cache.set(file,module);
      const fn=new vm.Script('(function(exports,require,module,__filename,__dirname){\n'+sources.get(file)+'\n})',{filename:file}).runInContext(context,{timeout:500});
      fn(module.exports,request=>execute(resolve(request,file)),module,path.join(root,file),path.dirname(path.join(root,file)));return module.exports;
    }
    return {load(file){scan(file);return execute(file);},handlers,protocols,permission,windows,clipboard,invoke,exposed,removals,attempts,
      probeImport(request){expectedProbe=true;try{assert.throws(()=>resolve(request,'electron/shot-inspector.cjs'),error=>error.code==='SECURITY_SIDE_EFFECT_DENIED');}finally{expectedProbe=false;}},
      create(){return this.load('electron/shot-inspector.cjs').createShotInspector({latest:()=>null,findPhoto:()=>null,appearance:()=>({resolvedTheme:'light',design:'current'}),locale:()=> 'en-US',canRead:()=>false,trackRead:()=>blocked('trackRead')});},
      evidence(){assert.equal(attempts.filter(attempt=>!attempt.expected).length,0,'unexpected side effect must fail suite');report.graphs.push(graph);return {handlers:[...handlers.keys()],protocols:[...protocols.keys()],removals:[...removals],nativeAttempts:[...attempts]};}};
  }
  const policy=loader().load('electron/frontend-policy.cjs'),dist=path.join(root,'dist');
  for(const entry of ['index.html','shot-inspector.html'])add('packaged '+entry+' ignores every dev override',()=>{
    for(const devURL of ['http://127.0.0.1:5173/','https://untrusted.invalid/','javascript:alert(1)','not a URL'])assert.equal(policy.frontendTarget({isPackaged:true,devURL,entry,distDir:dist}).file,path.join(dist,entry));
    return {entry,assertions:['override not parsed or loaded','fixed packaged entry']};
  });
  add('development exact loopback origin supports both entries',()=>{
    for(const entry of ['index.html','shot-inspector.html'])for(const devURL of ['http://127.0.0.1:5173','http://127.0.0.1:5173/'])assert.equal(policy.frontendTarget({isPackaged:false,devURL,entry,distDir:dist}).url,'http://127.0.0.1:5173/'+entry);
    assert.equal(policy.frontendTarget({isPackaged:false,entry:'index.html',distDir:dist}).file,path.join(dist,'index.html'));
  });
  for(const [kind,devURL] of [['credentials','http://user:pass@127.0.0.1:5173/'],['path','http://127.0.0.1:5173/other'],['query','http://127.0.0.1:5173/?x=1'],['fragment','http://127.0.0.1:5173/#x'],['port','http://127.0.0.1:5174/'],['LAN','http://192.0.2.1:5173/'],['localhost alias','http://localhost:5173/'],['HTTPS','https://127.0.0.1:5173/'],['file scheme','file:///index.html'],['WebSocket scheme','ws://127.0.0.1:5173/'],['invalid URL','not a URL']])add('development rejects '+kind,()=>{
    for(const entry of ['index.html','shot-inspector.html'])assert.throws(()=>policy.frontendTarget({isPackaged:false,devURL,entry,distDir:dist}));return {devURL,assertions:['rejected before any mock BrowserWindow/native load']};
  });
  add('unknown frontend entries are refused',()=>{for(const entry of ['../index.html','remote.html','C:/index.html',''])assert.throws(()=>policy.frontendTarget({isPackaged:true,entry,distDir:dist}));});
  add('VM import sentinels refuse camera/native/subprocess/network before resolution',()=>{
    const host=loader();for(const request of ['koffi','node:child_process','node:net','./camera-worker.cjs','./sdk-environment.cjs'])host.probeImport(request);return host.evidence();
  });
  add('permission request and check callbacks deny every permission',()=>{
    let request,check;policy.denyPermissions({setPermissionRequestHandler:fn=>{request=fn;},setPermissionCheckHandler:fn=>{check=fn;}});
    const permissions=['media','geolocation','notifications','clipboard-read','clipboard-sanitized-write','midi','usb','serial','unknown'];
    for(const permission of permissions){let result;request({},permission,value=>{result=value;},{});assert.equal(result,false);assert.equal(check({},permission,'http://127.0.0.1:5173/',{}),false);}return {permissions,assertions:['mock callbacks only, no actual Electron session']};
  });
  add('bounded HEX copy accepts exact colors and rejects malformed input before clipboard',async()=>{
    const writes=[];for(const color of ['#ffffff','#000000','#Aa00Ff'])assert.equal(await policy.copyHexColor(color,async value=>{writes.push(value);}),true);
    const before=writes.length;for(const value of ['red','#fff','#1234567','123456','#abcdef\n',' #123456',null,undefined,42,{},'#12\u000034'])await assert.rejects(()=>policy.copyHexColor(value,async text=>{writes.push(text);}),/Invalid HEX color/);
    assert.equal(writes.length,before);return {writes,assertions:['strict type and length','invalid input never reaches callback']};
  });
  add('HEX copy success waits for deferred clipboard writer',async()=>{
    let release,success=false,writeCalls=0;
    const gate=new Promise(resolve=>{release=resolve;});
    const pending=policy.copyHexColor('#ABCDEF',async text=>{assert.equal(text,'#ABCDEF');writeCalls++;await gate;}).then(result=>{success=true;return result;});
    try{
      await Promise.resolve();await Promise.resolve();assert.equal(writeCalls,1);assert.equal(success,false,'pending writer must not publish copy success');
      release();assert.equal(await pending,true);assert.equal(success,true);
      return {writeCalls,assertions:['writer remained pending across microtasks','success only after writer resolved']};
    }finally{release();}
  });
  add('HEX copy writer rejection propagates without success or unhandled rejection',async()=>{
    const failure=Error('controlled clipboard write failure'),unhandled=[];let rejectWrite,success=false;
    const capture=reason=>{unhandled.push(String(reason));};process.on('unhandledRejection',capture);
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    try{
      const writing=new Promise((_resolve,reject)=>{rejectWrite=reject;});
      const pending=policy.copyHexColor('#ABCDEF',()=>writing);
      pending.then(()=>{success=true;},()=>{});
      const rejected=assert.rejects(pending,error=>error===failure);rejectWrite(failure);await rejected;await tick();
      assert.equal(success,false);assert.equal(unhandled.length,0);
      return {success,unhandledRejections:unhandled.length,assertions:['same writer error reaches caller','no copy success on failure','no orphan rejected writer promise']};
    }finally{await tick();process.removeListener('unhandledRejection',capture);}
  });
  for(const isPackaged of [true,false])add('actual Inspector open '+(isPackaged?'packaged override ignored':'approved development entry'),async()=>{
    const host=loader({isPackaged,devURL:isPackaged?'https://untrusted.invalid/':'http://127.0.0.1:5173/'}),inspector=host.create();await inspector.open();
    const win=host.windows[0];assert.equal(host.windows.length,1);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.contextIsolation,true);assert.equal(win.options.webPreferences.nodeIntegration,false);
    assert.equal(win.openHandler().action,'deny');let prevented=false;win.webContents.events.get('will-navigate')({preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);
    if(isPackaged)assert.equal(win.loads[0].file,path.join(dist,'shot-inspector.html'));else assert.equal(win.loads[0].url,'http://127.0.0.1:5173/shot-inspector.html');
    const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};assert.equal(host.handlers.get('shot:boot')(event).locale,'en-US');assert.throws(()=>host.handlers.get('shot:boot')({...event,senderFrame:{}}));
    host.handlers.get('shot:copy')(event,{text:'synthetic metadata'});assert.equal(host.clipboard[0],'synthetic metadata');assert.throws(()=>host.handlers.get('shot:copy')(event,{text:'x'.repeat(100001)}));
    inspector.close();return {loads:win.loads,...host.evidence(),assertions:['actual Inspector JS with fake BrowserWindow','top-frame sender guard','bounded copy IPC preserved','no worker/filesystem/native operation']};
  });
  add('Inspector clipboard IPC awaits deferred acknowledgement and propagates writer rejection',async()=>{
    let release,settled=false;const gate=new Promise(resolve=>{release=resolve;}),host=loader({clipboardWriter:()=>gate}),inspector=host.create();await inspector.open();const win=host.windows[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
    const pending=host.handlers.get('shot:copy')(event,{text:'synthetic deferred copy'});assert.equal(typeof pending.then,'function');pending.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);release();await pending;assert.equal(settled,true);inspector.close();
    const failure=Error('controlled asynchronous clipboard failure'),failed=loader({clipboardWriter:()=>Promise.reject(failure)}),other=failed.create();await other.open();const second=failed.windows[0];await assert.rejects(failed.handlers.get('shot:copy')({sender:second.webContents,senderFrame:second.webContents.mainFrame},{text:'synthetic failed copy'}),error=>error===failure);other.close();return {deferred:host.evidence(),rejected:failed.evidence()};
  });
  add('actual Inspector rejects invalid development URL twice before allocating a window',()=>{
    const host=loader({isPackaged:false,devURL:'https://untrusted.invalid/'}),inspector=host.create();
    for(let attempt=0;attempt<2;attempt++){assert.throws(()=>inspector.open(),/Untrusted development frontend URL/);assert.equal(host.windows.length,0);}
    return {attempts:2,windowsCreated:host.windows.length,...host.evidence(),assertions:['no hidden orphan window','second open cannot report false success']};
  });
  for(const failHandleAt of [2,3])add('actual Inspector IPC registration fault '+failHandleAt+' rolls back and same-session retry succeeds',()=>{
    const host=loader({failHandleAt});assert.throws(()=>host.create(),/controlled IPC registration failure/);
    const afterFault={handlers:[...host.handlers.keys()],protocols:[...host.protocols.keys()],removed:[...host.removals]};
    assert.equal(afterFault.handlers.length,0,JSON.stringify(afterFault));assert.equal(afterFault.protocols.length,0,JSON.stringify(afterFault));
    const retried=host.create();assert.equal(typeof retried.open,'function');assert.equal(host.handlers.size,4);assert.equal(host.protocols.size,1);
    return {afterFault,afterRetry:host.evidence(),fault:'controlled mock ipcMain.handle throws while actual constructor executes'};
  });
  add('actual Inspector protocol registration failure rolls back all newly registered IPC',()=>{
    const host=loader({failProtocol:true});assert.throws(()=>host.create(),/controlled protocol registration failure/);assert.equal(host.handlers.size,0);assert.equal(host.protocols.size,0);
    host.create();assert.equal(host.handlers.size,4);assert.equal(host.protocols.size,1);return host.evidence();
  });
  add('actual Inspector failed registration preserves a protocol owned before this factory',()=>{
    const host=loader({existingProtocol:true});assert.throws(()=>host.create(),/duplicate scheme/);assert.equal(host.handlers.size,0);assert.equal(host.protocols.get('focal-asset'),'preexisting-owner');assert.ok(!host.removals.includes('protocol:focal-asset'));return host.evidence();
  });
  add('actual preload exposes bounded copyColor IPC',async()=>{
    const host=loader();host.load('electron/preload.cjs');assert.equal(typeof host.exposed.focal.copyColor,'function');await host.exposed.focal.copyColor({text:'#ABCDEF'});
    assert.equal(host.invoke.length,1);assert.equal(host.invoke[0].channel,'focal:copyColor');assert.equal(host.invoke[0].args.text,'#ABCDEF');return {invocations:host.invoke,...host.evidence()};
  });
  add('main and Inspector source wire the same policy; HEX copy uses bounded IPC',()=>{
    const main=sources.get('electron/main.cjs'),inspector=sources.get('electron/shot-inspector.cjs'),lighting=sources.get('src/LightingStudio.jsx');
    for(const source of [main,inspector]){assert.match(source,/require\(['"]\.\/frontend-policy\.cjs['"]\)/);assert.match(source,/frontendTarget\(\{isPackaged:app\.isPackaged,devURL:process\.env\.FOCAL_DEV_URL/);assert.ok(!/\.loadURL\(process\.env\.FOCAL_DEV_URL/.test(source));}
    assert.match(main,/entry:'index\.html'/);assert.match(inspector,/entry:'shot-inspector\.html'/);assert.ok(main.includes('denyPermissions(win.webContents.session)'));assert.ok(inspector.includes('denyPermissions(isolatedSession)'));
    assert.match(main,/copyColor:\(\{text\}\)=>copyHexColor\(text,/);assert.match(lighting,/window\.focal\.copyColor\(\{text:hexValue\}\)/);assert.ok(!lighting.includes('navigator.clipboard'));
    return {evidence:'source wiring only; actual main module is not loaded'};
  });

  assert.ok(tests.length<=report.limits.maxCases);let stop=false;
  const total=setTimeout(()=>{report.results.push({name:'total deadline',status:'FAIL',error:'SECURITY_RESOURCE_BUDGET'});save(1);process.exit(1);},report.limits.totalMs);
  try{
    for(const test of tests){if(stop){report.results.push({name:test.name,status:'NOT_RUN',reason:'unexpected forbidden side effect'});continue;}let timer;
      try{const detail=await Promise.race([Promise.resolve().then(test.run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('security case deadline')),report.limits.caseMs);})]);report.results.push({name:test.name,status:'PASS',...detail});console.log('PASS '+test.name);}
      catch(error){report.results.push({name:test.name,status:'FAIL',error:String(error.stack||error)});console.error('FAIL '+test.name+'\n'+String(error.stack||error));if(error.code==='SECURITY_SIDE_EFFECT_DENIED'||/deadline/.test(error.message))stop=true;}
      finally{clearTimeout(timer);}
    }
    save(report.results.some(result=>result.status!=='PASS')||report.denied.some(attempt=>!attempt.expected)?1:0);console.log(JSON.stringify({tier:report.tier,pass:report.pass,fail:report.fail,exitCode:report.exitCode}));process.exitCode=report.exitCode;
  }finally{clearTimeout(total);}
  function save(exitCode){
    report.pass=report.results.filter(result=>result.status==='PASS').length;report.fail=report.results.filter(result=>result.status==='FAIL').length;report.exitCode=exitCode;
    // Trusted report output only; production VM has no filesystem adapter.
    const canonicalRoot=fs.realpathSync(root);for(const relative of ['qa',path.join('qa','integration')]){const target=path.join(root,relative);try{assert.equal(fs.lstatSync(target).isSymbolicLink(),false);const rest=path.relative(canonicalRoot,fs.realpathSync(target));assert.ok(rest!=='..'&&!rest.startsWith('..'+path.sep)&&!path.isAbsolute(rest));}catch(error){if(error.code!=='ENOENT')throw error;}}
    fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,'security-policy-results.json'),JSON.stringify(report,null,2)+'\n');
  }
  function readHead(){
    const dotGit=path.join(root,'.git');const git=fs.statSync(dotGit).isFile()?path.resolve(root,fs.readFileSync(dotGit,'utf8').trim().replace(/^gitdir: /,'')):dotGit;
    const head=fs.readFileSync(path.join(git,'HEAD'),'utf8').trim();if(/^[0-9a-f]{40}$/.test(head))return head;assert.match(head,/^ref: refs\//);const ref=head.slice(5);let common=git;
    try{common=path.resolve(git,fs.readFileSync(path.join(git,'commondir'),'utf8').trim());}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const dir of [git,common])try{const value=fs.readFileSync(path.join(dir,ref),'utf8').trim();assert.match(value,/^[0-9a-f]{40}$/);return value;}catch(error){if(error.code!=='ENOENT')throw error;}
    const entry=fs.readFileSync(path.join(common,'packed-refs'),'utf8').split(/\r?\n/).find(line=>line.endsWith(' '+ref));assert.ok(entry);return entry.slice(0,40);
  }
}
