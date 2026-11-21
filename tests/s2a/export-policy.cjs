// Named T1 VM/model tests. No real export/codec/filesystem claim is made here.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT1\n--scope\nsynthetic'){
  console.error('REFUSED: named T1 synthetic entrypoint required');process.exitCode=2;
}else if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')||!/^[a-f0-9]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT||'')){
  console.error('REFUSED: clean Node preload environment, --no-addons and exact source commit required');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
  const root=path.resolve(__dirname,'../..'),file='electron/protected-export.cjs';
  const bytes=fs.readFileSync(path.join(root,file)),source=bytes.toString('utf8');
  const denied=[];let expected=false;
  const deny=request=>{denied.push({request,expected});const error=Error('T1_EXPORT_IMPORT_DENIED');error.code='T1_EXPORT_IMPORT_DENIED';throw error;};
  const defaultFs=new Proxy({},{get:(_target,key)=>()=>deny('default filesystem '+String(key))});
  const imports=new Map([['node:fs/promises',defaultFs],['node:path',path]]);
  const localRequire=request=>imports.has(request)?imports.get(request):deny(request);
  for(const request of ['electron','koffi','sharp','node:child_process','node:http','../camera-worker.cjs']){
    expected=true;assert.throws(()=>localRequire(request),error=>error.code==='T1_EXPORT_IMPORT_DENIED');expected=false;
  }
  assert.equal((source.match(/\brequire\s*\(/g)||[]).length,2);assert.ok(!/\bimport\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/.test(source));
  const context=vm.createContext({Buffer:Object.freeze({byteLength:Buffer.byteLength})},{codeGeneration:{strings:false,wasm:false}});
  const module={exports:{}};
  new vm.Script('(function(require,module,exports){\n'+source+'\n})',{filename:file}).runInContext(context,{timeout:1000})(localRequire,module,module.exports);
  const {createProtectedExport}=module.exports;
  const results=[],tests=[];const add=(name,run)=>tests.push({name,run});
  const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
  const p=path.win32,key=file=>p.resolve(file).toLowerCase();
  function fake(options={}){
    let inode=20;const entries=new Map(),canonical=new Map(),calls=[],hooks=options.hooks||{};
    const addDirectory=file=>entries.set(key(file),{kind:'directory',ino:++inode,dev:1,nlink:1});
    for(const directory of ['C:\\','C:\\exports','C:\\photos','C:\\appdata','C:\\legacy','C:\\other'])addDirectory(directory);
    const addFile=(file,content='owned original')=>{const entry={kind:'file',ino:++inode,dev:1,nlink:1,bytes:Buffer.from(content)};entries.set(key(file),entry);return entry;};
    addFile('C:\\photos\\selected.jpg','MODEL_ORIGINAL_A');addFile('C:\\photos\\other.jpg','MODEL_ORIGINAL_B');addFile('C:\\appdata\\library.json','MODEL_STORE');
    const initialHashes=['C:\\photos\\selected.jpg','C:\\photos\\other.jpg','C:\\appdata\\library.json'].map(file=>[file,sha(entries.get(key(file)).bytes)]);
    const failure=code=>Object.assign(Error(code),{code});
    const stat=entry=>({dev:options.noIdentity?0:entry.dev,ino:options.noIdentity?0:entry.ino,nlink:entry.nlink,size:entry.bytes?.length,
      isFile:()=>entry.kind==='file',isDirectory:()=>entry.kind==='directory',isSymbolicLink:()=>entry.kind==='link'});
    const port={
      async lstat(file){calls.push({method:'lstat',file});const entry=entries.get(key(file));if(!entry)throw failure('ENOENT');return stat(entry);},
      async realpath(file){calls.push({method:'realpath',file});if(options.unidentifiedOriginal&&key(file)===key('C:\\photos\\other.jpg'))throw failure('ENOTSUP');if(canonical.has(key(file)))return canonical.get(key(file));if(!entries.has(key(file)))throw failure('ENOENT');return p.resolve(file);},
      async open(file,flags){
        calls.push({method:'open',file,flags});assert.equal(flags,'wx');if(hooks.beforeOpen)await hooks.beforeOpen(file);
        if(entries.has(key(file)))throw failure('EEXIST');const entry=addFile(file,'');let closed=false;
        const handle={
          async writeFile(value){assert.equal(closed,false);calls.push({method:'writeFile',file});if(hooks.write)await hooks.write(entry,Buffer.from(value),file);else entry.bytes=Buffer.from(value);},
          async close(){calls.push({method:'close',file});if(hooks.close)await hooks.close(entry,file);closed=true;},
          async stat(){if(options.throwIdentity)throw failure('ENOTSUP');return stat(entry);}
        };
        if(options.noHandleStat)delete handle.stat;
        if(hooks.afterCreate)await hooks.afterCreate(entry,file);return handle;
      }
    };
    let registry={files:['C:\\photos\\selected.jpg','C:\\photos\\other.jpg','C:\\appdata\\library.json'],directories:['C:\\appdata']},registryReads=0;
    const exporter=createProtectedExport({platform:'win32',fs:port,serialize:options.serialize||((fn)=>fn()),getRegistry:()=>{registryReads++;return options.getRegistry?options.getRegistry(registry,registryReads):registry;}});
    return {entries,canonical,calls,hooks,exporter,addDirectory,addFile,setRegistry:value=>{registry=value;},get registryReads(){return registryReads;},
      unchanged(){for(const [file,hash] of initialHashes)assert.equal(sha(entries.get(key(file)).bytes),hash,'Model original changed: '+file);},
      originalHashes:initialHashes,get:file=>entries.get(key(file)),fault:failure};
  }
  const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);

  add('all three cancellation contracts return null before producer, registry or filesystem',async()=>{
    for(const type of ['jpeg','metadata','presets']){const f=fake();let produced=false;assert.equal(await f.exporter.save({canceled:true},()=>{produced=true;throw Error(type);}),null);assert.equal(produced,false);assert.equal(f.registryReads,0);assert.equal(f.calls.length,0);f.unchanged();}
  });
  for(const destination of ['C:\\photos\\selected.jpg','C:\\photos\\other.jpg','c:/PHOTOS/other.JPG','C:\\exports\\..\\photos\\other.jpg','C:\\appdata\\library.json','C:\\appdata\\library.previous.json','C:\\appdata\\staging\\new.json'])add('protected registry rejects '+destination+' before producer',async()=>{
    const f=fake();let produced=false;await rejects(f.exporter.writeNew(destination,()=>{produced=true;return 'bad';}),'EXPORT_PROTECTED');assert.equal(produced,false);assert.equal(f.calls.length,0);f.unchanged();
  });
  for(const destination of ['relative.jpg','\\output.jpg','C:output.jpg','C:\\exports\\photo.jpg:secret','C:\\exports\\CON.jpg','C:\\exports\\COM¹.jpg','C:\\exports\\ambiguous.','C:\\exports\\space \\out.jpg','\\\\?\\C:\\exports\\out.jpg','C:\\exports\\bad?.json'])add('unsupported Windows path rejected '+destination,async()=>{
    const f=fake();await rejects(f.exporter.writeNew(destination,()=> 'bad'),'EXPORT_PATH');assert.equal(f.calls.length,0);f.unchanged();
  });
  add('ordinary NEW model JPEG bytes are written through exactly one owned wx handle',async()=>{
    const f=fake(),destination='C:\\exports\\new.jpg',output=Buffer.from([0xff,0xd8,0x01,0xff,0xd9]);let encoded=false;
    assert.equal(await f.exporter.save({canceled:false,filePath:destination},()=>{encoded=true;assert.equal(f.get(destination),undefined);return output;}),destination);
    assert.equal(encoded,true);assert.deepEqual(f.get(destination).bytes,output);assert.equal(f.calls.filter(call=>call.method==='open').length,1);assert.equal(f.calls.filter(call=>call.method==='writeFile').length,1);assert.equal(f.calls.filter(call=>call.method==='close').length,1);f.unchanged();
    return {oracle:'Fixed bytes only; this model case does not prove JPEG codec validity.'};
  });
  for(const [name,value] of [['metadata',{file:{name:'synthetic.jpg',width:32,height:24},metadata:{ISO:100},errors:[]}],['presets',{version:1,presets:[{id:'test',values:{iso:72}}]}]])add('ordinary NEW '+name+' JSON roundtrip uses owned handle',async()=>{
    const f=fake(),destination='C:\\exports\\'+name+'.json';assert.equal(await f.exporter.writeJSON(destination,value),destination);assert.deepEqual(JSON.parse(f.get(destination).bytes),value);f.unchanged();
  });
  add('existing ordinary artifact is preserved and a new filename still works',async()=>{
    const f=fake();f.addFile('C:\\exports\\existing.jpg','PRIOR_EXPORT');await rejects(f.exporter.writeNew('C:\\exports\\existing.jpg',()=> 'new'),'EXPORT_EXISTS');assert.equal(f.get('C:\\exports\\existing.jpg').bytes.toString(),'PRIOR_EXPORT');assert.equal(await f.exporter.writeNew('C:\\exports\\different.jpg',()=> 'new'),'C:\\exports\\different.jpg');f.unchanged();
  });
  add('existing hardlink alias is never opened for write',async()=>{
    const f=fake(),original=f.get('C:\\photos\\other.jpg');original.nlink=2;f.entries.set(key('C:\\exports\\alias.jpg'),original);await rejects(f.exporter.writeNew('C:\\exports\\alias.jpg',()=> 'bad'),'EXPORT_EXISTS');assert.equal(f.calls.filter(call=>call.method==='open').length,0);f.unchanged();
  });
  add('known parent junction/symlink rejected before producer',async()=>{
    const f=fake();f.entries.set(key('C:\\linked'),{kind:'link'});await rejects(f.exporter.writeNew('C:\\linked\\new.jpg',()=> 'bad'),'EXPORT_ALIAS');f.unchanged();
  });
  add('canonical protected directory and original alias reject NEW lexical paths',async()=>{
    let f=fake();f.canonical.set(key('C:\\exports'),'C:\\appdata');await rejects(f.exporter.writeNew('C:\\exports\\new.json',()=> 'bad'),'EXPORT_PROTECTED');f.unchanged();
    f=fake();f.canonical.set(key('C:\\photos\\other.jpg'),'C:\\exports\\new.jpg');await rejects(f.exporter.writeNew('C:\\exports\\new.jpg',()=> 'bad'),'EXPORT_PROTECTED');f.unchanged();
  });
  for(const option of ['noIdentity','noHandleStat','throwIdentity','unidentifiedOriginal'])add('optional '+option+' unavailable does NOT disable a NEW export',async()=>{
    const f=fake({[option]:true}),destination='C:\\exports\\ordinary.jpg';assert.equal(await f.exporter.writeNew(destination,()=> 'complete'),destination);assert.equal(f.get(destination).bytes.toString(),'complete');f.unchanged();
  });
  add('producer failure occurs before output creation and does not poison later export',async()=>{
    let queue=Promise.resolve();const serialize=fn=>{const job=queue.catch(()=>{}).then(fn);queue=job;return job;};const f=fake({serialize});
    await rejects(f.exporter.writeNew('C:\\exports\\failed.jpg',()=>{throw Error('controlled codec failure');}),'EXPORT_FAILED');assert.equal(f.get('C:\\exports\\failed.jpg'),undefined);
    await f.exporter.writeNew('C:\\exports\\good.jpg',()=> 'complete');assert.equal(f.get('C:\\exports\\good.jpg').bytes.toString(),'complete');f.unchanged();
  });
  add('late registry addition after producer refuses before exclusive open',async()=>{
    const destination='C:\\exports\\late.jpg',f=fake();await rejects(f.exporter.writeNew(destination,()=>{f.setRegistry({files:[destination],directories:[]});return 'bad';}),'EXPORT_PROTECTED');assert.equal(f.get(destination),undefined);f.unchanged();
  });
  add('exclusive creation race preserves competitor file',async()=>{
    const f=fake();f.hooks.beforeOpen=file=>{f.addFile(file,'COMPETITOR');};await rejects(f.exporter.writeNew('C:\\exports\\race.jpg',()=> 'bad'),'EXPORT_EXISTS');assert.equal(f.get('C:\\exports\\race.jpg').bytes.toString(),'COMPETITOR');f.unchanged();
  });
  add('open permission failure reports no retained output or success',async()=>{
    const f=fake();f.hooks.beforeOpen=()=>{throw f.fault('EACCES');};const error=await f.exporter.writeNew('C:\\exports\\denied.jpg',()=> 'data').catch(error=>error);assert.equal(error.code,'EXPORT_FAILED');assert.equal(error.outputRetained,false);assert.equal(f.get('C:\\exports\\denied.jpg'),undefined);f.unchanged();
  });
  add('partial write failure retains owned incomplete bytes and closes handle without unlink',async()=>{
    const f=fake(),destination='C:\\exports\\partial.jpg';f.hooks.write=(entry,bytes)=>{entry.bytes=bytes.subarray(0,3);throw f.fault('ENOSPC');};
    const error=await f.exporter.writeNew(destination,()=> 'COMPLETE').catch(error=>error);assert.equal(error.code,'EXPORT_FAILED');assert.equal(error.outputRetained,true);assert.equal(f.get(destination).bytes.toString(),'COM');assert.equal(f.calls.filter(call=>call.method==='close').length,1);await rejects(f.exporter.waitForPath(destination),'EXPORT_INCOMPLETE');f.unchanged();
  });
  add('close failure cannot publish success and retries handle cleanup',async()=>{
    const f=fake(),destination='C:\\exports\\close.jpg';let first=true;f.hooks.close=()=>{if(first){first=false;throw f.fault('EIO');}};
    const error=await f.exporter.writeNew(destination,()=> 'complete').catch(error=>error);assert.equal(error.code,'EXPORT_FAILED');assert.equal(error.outputRetained,true);assert.equal(f.calls.filter(call=>call.method==='close').length,2);await rejects(f.exporter.waitForPath(destination),'EXPORT_INCOMPLETE');f.unchanged();
  });
  add('known path replacement with another original hardlink writes only owned object and returns no success',async()=>{
    const f=fake(),destination='C:\\exports\\swapped.jpg';f.hooks.write=(entry,bytes)=>{entry.bytes=bytes;const original=f.get('C:\\photos\\other.jpg');original.nlink=2;f.entries.set(key(destination),original);};
    const error=await f.exporter.writeNew(destination,()=> 'SAFE_OWNED_BYTES').catch(error=>error);assert.equal(error.code,'EXPORT_PATH_CHANGED');assert.equal(error.outputRetained,true);assert.equal(f.get(destination),f.get('C:\\photos\\other.jpg'));f.unchanged();
  });
  add('known identity swap during close is detected after handle close',async()=>{
    const f=fake(),destination='C:\\exports\\late-swap.jpg';f.hooks.close=()=>{f.addFile(destination,'same-size');};await rejects(f.exporter.writeNew(destination,()=> 'same-size'),'EXPORT_PATH_CHANGED');f.unchanged();
  });
  add('waitForPath waits through production and write completion before registration may read',async()=>{
    const f=fake(),entered=deferred(),release=deferred(),destination='C:\\exports\\active.jpg';let readAllowed=false;
    const writing=f.exporter.writeNew(destination,async()=>{entered.resolve();await release.promise;return 'complete';});await entered.promise;
    const waiting=f.exporter.waitForPath(destination).then(()=>{readAllowed=true;});await Promise.resolve();await Promise.resolve();assert.equal(readAllowed,false);assert.equal(f.get(destination),undefined);
    release.resolve();await writing;await waiting;assert.equal(readAllowed,true);assert.equal(f.get(destination).bytes.toString(),'complete');f.unchanged();
  });
  add('simultaneous exports to one name grant one owner and no unhandled waiter rejection',async()=>{
    const f=fake(),entered=deferred(),release=deferred(),destination='C:\\exports\\same.jpg';
    const first=f.exporter.writeNew(destination,async()=>{entered.resolve();await release.promise;return 'first';});await entered.promise;
    await rejects(f.exporter.writeNew(destination,()=> 'second'),'EXPORT_BUSY');release.resolve();await first;assert.equal(f.get(destination).bytes.toString(),'first');f.unchanged();
  });
  add('late registry change after creation writes no bytes and incomplete waiter rejects',async()=>{
    const destination='C:\\exports\\late-created.jpg',f=fake({getRegistry:(registry,count)=>count>=3?{files:[destination],directories:[]}:registry});
    const error=await f.exporter.writeNew(destination,()=> 'bad').catch(error=>error);assert.equal(error.code,'EXPORT_PROTECTED');assert.equal(error.outputRetained,true);assert.equal(f.get(destination).bytes.length,0);await rejects(f.exporter.waitForPath(destination),'EXPORT_INCOMPLETE');f.unchanged();
  });

  const started=Date.now();let deadline;
  const total=setTimeout(()=>{console.error('T1 export suite deadline');process.exit(1);},20000);
  try{
    for(const test of tests){
      try{const detail=await Promise.race([Promise.resolve().then(test.run),new Promise((_resolve,reject)=>{deadline=setTimeout(()=>reject(Error('case deadline')),2000);})]);results.push({name:test.name,status:'PASS',...detail});}
      catch(error){results.push({name:test.name,status:'FAIL',error:String(error.stack||error)});}
      finally{clearTimeout(deadline);}
    }
    assert.equal(denied.filter(item=>!item.expected).length,0);
    const report={tier:'T1',scope:'synthetic memory filesystem model',entrypoint:'tests/s2a/export-policy.cjs',sourceCommit:process.env.APERTROVE_SOURCE_COMMIT,
      command:'node --no-addons --max-old-space-size=192 tests/s2a/export-policy.cjs --tier T1 --scope synthetic',environment:{node:process.version,platform:process.platform,execArgv:[...process.execArgv]},exitCode:results.some(item=>item.status==='FAIL')?1:0,
      sourceHashes:{[file]:sha(bytes),'tests/s2a/export-policy.cjs':sha(fs.readFileSync(__filename))},reviewedGraph:{[file]:['node:path (pure)','node:fs/promises (denied default, explicit model port injected)']},denied,
      results,pass:results.filter(item=>item.status==='PASS').length,fail:results.filter(item=>item.status==='FAIL').length,elapsedMs:Date.now()-started,
      modelOriginalHashOracles:fake().originalHashes,
      limits:{totalMs:20000,caseMs:2000,realFilesystemAdapters:0,codecNativeCalls:0,network:0,subprocesses:0},
      limitation:'File writes, aliases, hardlinks, faults and identities in this suite are modelled. Real synthetic filesystem/Sharp acceptance requires separately reviewed T2.'};
    const qa=path.join(root,'qa','s2a');
    for(const relative of ['qa',path.join('qa','s2a')]){const candidate=path.join(root,relative);try{assert.equal(fs.lstatSync(candidate).isSymbolicLink(),false);const rel=path.relative(fs.realpathSync(root),fs.realpathSync(candidate));assert.ok(rel!== '..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));}catch(error){if(error.code!=='ENOENT')throw error;}}
    fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,'export-policy-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({tier:'T1',pass:report.pass,fail:report.fail,report:'qa/s2a/export-policy-results.json'}));process.exitCode=report.fail?1:0;
  }finally{clearTimeout(total);}
}
