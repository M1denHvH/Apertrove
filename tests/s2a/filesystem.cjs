'use strict';
// Named T2 actual filesystem suite. Fixed fixture bytes here are NOT JPEG codec evidence.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT2\n--scope\nsynthetic'||!process.execArgv.includes('--no-addons')||!process.execArgv.some(arg=>/^--max-old-space-size=(192|256)$/.test(arg))||process.execArgv.some(arg=>arg!=='--no-addons'&&!/^--max-old-space-size=(192|256)$/.test(arg))||process.env.NODE_OPTIONS||process.env.NODE_PATH||!/^[0-9a-f]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT||'')){
  console.error('S2A_FS_ADMISSION_REFUSED');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
  const {createFSGuard,prepareFixture,sha}=require('./fs-guard.cjs');
  const root=path.resolve(__dirname,'../..'),fixture=prepareFixture(root,'filesystem-'),qa=path.join(root,'qa','s2a');
  const originalDir=path.join(fixture,'originals'),outputs=path.join(fixture,'exports'),data=path.join(fixture,'userData');
  for(const folder of [originalDir,outputs,data])fs.mkdirSync(folder);
  const originals=[path.join(originalDir,'A.jpg'),path.join(originalDir,'B.jpg')];
  originals.forEach((file,i)=>fs.writeFileSync(file,'S2A_SYNTHETIC_FS_ORIGINAL_'+i+'\n'));
  const originalHashes=Object.fromEntries(originals.map(file=>[file,sha(fs.readFileSync(file))]));
  const guard=createFSGuard({repoRoot:root,fixtureRoot:fixture});
  const report={tier:'T2',scope:'synthetic',entrypoint:'tests/s2a/filesystem.cjs',sourceCommit:process.env.APERTROVE_SOURCE_COMMIT,sourceCommitProvenance:'launcher-provided validated40hex; root final manifest independently verifies committed bytes',environment:{node:process.version,platform:process.platform,execArgv:[...process.execArgv]},
    command:'node --no-addons --max-old-space-size=192 tests/s2a/filesystem.cjs --tier T2 --scope synthetic',fixtureRoot:fixture,
    originalHashesBefore:originalHashes,results:[],admission:[],limits:{totalMs:30000,caseMs:3000,maxFiles:180},
    execution:'Actual filesystem/owned-handle export routes, recovery writer and transactional importer; image/metadata producers are explicit non-codec fixtures.'};
  const started=Date.now();let deadline;
  function save(){report.elapsedMs=Date.now()-started;report.guard=guard.evidence();report.sourceHashes={...report.guard.sourceHashes,
    'tests/s2a/filesystem.cjs':sha(fs.readFileSync(__filename)),'tests/s2a/fs-guard.cjs':sha(fs.readFileSync(path.join(__dirname,'fs-guard.cjs')))};
    report.originalHashesAfter=Object.fromEntries(originals.map(file=>[file,sha(fs.readFileSync(file))]));
    report.cleanup={openHandles:report.guard.counters.openHandles,fixturesRetained:true,automaticUnlink:false};
    report.pass=report.results.filter(c=>c.status==='PASS').length;report.fail=report.results.filter(c=>c.status==='FAIL').length;
    report.blocked=report.results.filter(c=>c.status==='BLOCKED').length;report.exitCode=report.fail?1:0;
    fs.writeFileSync(path.join(qa,'filesystem-results.json'),JSON.stringify(report,null,2)+'\n');}
  deadline=setTimeout(()=>{report.results.push({name:'hard wall deadline',status:'FAIL',error:'30 second budget exceeded'});save();process.exit(1);},30000);
  const cases=[],add=(name,run)=>cases.push({name,run});
  const error=code=>Object.assign(Error('Controlled synthetic '+code),{code});
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
  const value=tag=>({version:2,photos:[],sessions:[],presets:[],settings:{tag}});
  const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const digest=file=>sha(fs.readFileSync(file));
  let serial=0;function folder(name){const dir=path.join(fixture,String(++serial)+'-'+name);fs.mkdirSync(dir);return dir;}
  try{
    for(const name of ['electron','sharp','exifr','koffi','node:child_process','node:worker_threads','node:http','node:net','../../electron/camera-worker.cjs','../../electron/sdk-environment.cjs'])report.admission.push(guard.probeImport(name));
    for(const operation of ['readFile','writeFile','open','rename destination'])report.admission.push(guard.probePath(path.join(qa,'outside-fixture.json'),operation));
    assert.equal(guard.evidence().counters.operations,0);guard.check();
    const {createProtectedExport}=guard.load('electron/protected-export.cjs');
    const {createExportService}=guard.load('electron/export-service.cjs');
    const recoveryModule=guard.load('electron/library-recovery.cjs');
    const {createLibraryRecovery,previousPath}=recoveryModule;
    const {createLibraryBootstrap}=guard.load('electron/library-bootstrap.cjs');
    const registry={files:[...originals,path.join(data,'library.json'),path.join(data,'library.previous.json')],directories:[data]};
    fs.writeFileSync(path.join(data,'library.json'),JSON.stringify(value('protected-store')));
    const protectedStoreHash=digest(path.join(data,'library.json'));
    function exporter(port=guard.fs,getRegistry=()=>registry){return createProtectedExport({fs:port,getRegistry,platform:process.platform});}
    function service(writer,selected,counters={}){
      const p={id:'a',path:originals[0],name:'A.jpg',edits:{}};
      return createExportService({exporter:writer,showSaveDialog:async()=>selected,getPhoto:()=>p,getPresets:()=>[{id:'preset',name:'Synthetic',values:{iso:72}}],
        cleanEdits:v=>v,localize:v=>v,t:(key,args)=>key+(args?.path?': '+args.path:''),
        renderEditedBuffer:async()=>{counters.producers=(counters.producers||0)+1;return Buffer.from('S2A_NON_CODEC_EXPORT_BYTES');},
        readMetadata:async()=>{counters.producers=(counters.producers||0)+1;return {file:{name:'A.jpg'},metadata:{synthetic:true}};},
        onPhotoExport:()=>{counters.success=(counters.success||0)+1;}});
    }
    for(const method of ['exportPhoto','exportMetadata','exportPresets'])add(method+' writes a real NEW file through actual shared route/owned handle',async()=>{
      const file=path.join(outputs,method+(method==='exportPhoto'?'.jpg':'.json')),counts={},api=service(exporter(),{filePath:file},counts);
      assert.equal(await api[method]({id:'a'}),file);assert.ok(fs.statSync(file).size>0);
      if(method==='exportPhoto')assert.equal(fs.readFileSync(file,'utf8'),'S2A_NON_CODEC_EXPORT_BYTES');
      else if(method==='exportMetadata')assert.equal(json(file).metadata.synthetic,true);else assert.equal(json(file).presets[0].values.iso,72);
      return {outputSha256:digest(file),bytes:fs.statSync(file).size,codec:false,assertion:'actual output bytes inspected independently of callback counts'};
    });
    for(const method of ['exportPhoto','exportMetadata','exportPresets'])add(method+' cancellation has no producer, registry or filesystem side effect',async()=>{
      let registries=0;const counts={},before=guard.evidence().counters.operations,writer=exporter(guard.fs,()=>{registries++;return registry;});
      assert.equal(await service(writer,{canceled:true},counts)[method]({id:'a'}),null);assert.equal(registries,0);assert.equal(counts.producers||0,0);assert.equal(guard.evidence().counters.operations,before);
    });
    for(const method of ['exportPhoto','exportMetadata','exportPresets'])add(method+' protects current original, other original and application store',async()=>{
      const counts={};for(const file of [...originals,path.join(data,'library.json'),path.join(data,'new-private.json')])await assert.rejects(service(exporter(),{filePath:file},counts)[method]({id:'a'}),e=>e.code==='EXPORT_PROTECTED');
      assert.equal(counts.producers||0,0);assert.equal(digest(path.join(data,'library.json')),protectedStoreHash);
    });
    add('existing ordinary artifact rejected, fresh filename still succeeds',async()=>{
      const old=path.join(outputs,'ordinary.json');fs.writeFileSync(old,'PRIOR_EXPORTED_ARTIFACT');const before=digest(old),writer=exporter();
      await assert.rejects(writer.writeJSON(old,{new:true}),e=>e.code==='EXPORT_EXISTS');assert.equal(digest(old),before);
      const fresh=path.join(outputs,'ordinary-new.json');await writer.writeJSON(fresh,{new:true});assert.equal(json(fresh).new,true);
    });
    add('case collision and hardlink aliases leave originals unchanged',async()=>{
      if(process.platform==='win32')await assert.rejects(exporter().writeJSON(originals[1].toUpperCase(),{}),e=>e.code==='EXPORT_PROTECTED');
      const linked=path.join(outputs,'hardlink.jpg');fs.linkSync(originals[1],linked);await assert.rejects(exporter().writeJSON(linked,{}),e=>e.code==='EXPORT_EXISTS');assert.equal(digest(linked),originalHashes[originals[1]]);
    });
    add('known directory junction/symlink parent is rejected',async()=>{
      const link=path.join(fixture,'output-junction');try{fs.symlinkSync(outputs,link,process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return {blocked:'Host disallows synthetic junction/symlink: '+e.code};throw e;}
      await assert.rejects(exporter().writeJSON(path.join(link,'forbidden.json'),{}),e=>e.code==='EXPORT_ALIAS');assert.equal(fs.existsSync(path.join(outputs,'forbidden.json')),false);
    });
    add('known file symlink is rejected without changing target',async()=>{
      const link=path.join(outputs,'file-symlink.jpg');try{fs.symlinkSync(originals[1],link,'file');}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return {blocked:'Host disallows file symlink: '+e.code};throw e;}
      await assert.rejects(exporter().writeJSON(link,{}));assert.equal(digest(originals[1]),originalHashes[originals[1]]);
    });
    add('late registry change is checked again before creation',async()=>{
      const file=path.join(outputs,'late.json'),files=[...registry.files],writer=exporter(guard.fs,()=>({files,directories:registry.directories}));
      await assert.rejects(writer.writeNew(file,()=>{files.push(file);return 'never written';}),e=>e.code==='EXPORT_PROTECTED');assert.equal(fs.existsSync(file),false);
    });
    add('output creation race is won by exclusive owner; competing bytes retained',async()=>{
      const file=path.join(outputs,'creation-race.json'),port={...guard.fs,async open(name,flags){fs.writeFileSync(name,'COMPETING_OWNER',{flag:'wx'});return guard.fs.open(name,flags);}};
      await assert.rejects(exporter(port).writeJSON(file,{new:true}),e=>e.code==='EXPORT_EXISTS');assert.equal(fs.readFileSync(file,'utf8'),'COMPETING_OWNER');
    });
    add('two simultaneous exports to one destination have exactly one success',async()=>{
      const file=path.join(outputs,'parallel.json'),results=await Promise.allSettled([exporter().writeJSON(file,{owner:1}),exporter().writeJSON(file,{owner:2})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.ok([1,2].includes(json(file).owner));
    });
    add('real partial output write rejects, closes owned handle, blocks incomplete import',async()=>{
      const file=path.join(outputs,'partial.json'),port={...guard.fs,async open(name,flags){const h=await guard.fs.open(name,flags);return {...h,async writeFile(bytes){await h.writeFile(Buffer.from(bytes).subarray(0,3));throw error('EIO');}};}};
      const writer=exporter(port);await assert.rejects(writer.writeJSON(file,{incomplete:true}),e=>e.code==='EXPORT_FAILED'&&e.outputRetained===true);
      assert.equal(fs.statSync(file).size,3);assert.equal(guard.evidence().counters.openHandles,0);await assert.rejects(writer.waitForPath(file),e=>e.code==='EXPORT_INCOMPLETE');
      return {partialSha256:digest(file),retained:true,automaticCleanup:false,fault:'controlled EIO after actual3byte write'};
    });
    add('close failure does not publish success',async()=>{
      const file=path.join(outputs,'close-failure.jpg'),counts={},port={...guard.fs,async open(name,flags){const h=await guard.fs.open(name,flags);return {...h,async close(){await h.close();throw error('EIO');}};}};
      await assert.rejects(service(exporter(port),{filePath:file},counts).exportPhoto({id:'a'}),e=>e.outputRetained===true);assert.equal(counts.success||0,0);assert.equal(guard.evidence().counters.openHandles,0);
    });
    add('injected permission failure creates no file and no success',async()=>{
      const file=path.join(outputs,'denied.jpg'),counts={},port={...guard.fs,async open(){throw error('EACCES');}};
      await assert.rejects(service(exporter(port),{filePath:file},counts).exportPhoto({id:'a'}));assert.equal(fs.existsSync(file),false);assert.equal(counts.success||0,0);
      return {fault:'injected EACCES at actual filesystem port, not an OS ACL test'};
    });
    add('active output wait does not finish until writer close',async()=>{
      const file=path.join(outputs,'active.json'),gate=deferred(),entered=deferred(),writer=exporter();
      const writing=writer.writeNew(file,async()=>{entered.resolve();await gate.promise;return 'COMPLETE';});await entered.promise;let observed=false;
      const waiting=writer.waitForPath(file).then(()=>{observed=true;});await Promise.resolve();assert.equal(observed,false);gate.resolve();await writing;await waiting;assert.equal(fs.readFileSync(file,'utf8'),'COMPLETE');
    });
    add('recovery missing/first primary commits and valid primary remains authoritative',async()=>{
      const dir=folder('first'),file=path.join(dir,'library.json'),r=createLibraryRecovery({fs:guard.fs});
      assert.equal((await r.inspectLibraryRecovery(file)).firstRun,true);await assert.rejects(r.readPrimaryLibraryText(file),e=>e.code==='ENOENT');await r.writeLibraryGeneration(file,value('first'));
      assert.equal((await r.inspectLibraryRecovery(file)).selection,'primary');assert.equal(fs.existsSync(previousPath(file)),false);
    });
    add('migration backup retains exact legacy raw bytes and bounded previous rotation',async()=>{
      const dir=folder('migration'),file=path.join(dir,'library.json'),legacy=' { "photos": [], "settings": {"legacy": true} }\n';fs.writeFileSync(file,legacy);
      const r=createLibraryRecovery({fs:guard.fs});await r.writeLibraryGeneration(file,value('next'));assert.equal(fs.readFileSync(previousPath(file),'utf8'),legacy);
      const first=fs.readFileSync(file);await r.writeLibraryGeneration(file,value('latest'));assert.equal(digest(previousPath(file)),sha(first));assert.equal(json(file).settings.tag,'latest');
      assert.equal(fs.readdirSync(dir).filter(name=>name.endsWith('.previous.json')).length,1);assert.equal(fs.readdirSync(dir).filter(name=>name.endsWith('.tmp')).length,0);
    });
    for(const prior of ['{broken','{"version":9,"photos":[],"settings":{}}'])add('bad previous preserved; strict changed persist blocked '+sha(prior).slice(0,8),async()=>{
      const dir=folder('bad-previous'),file=path.join(dir,'library.json'),primary=JSON.stringify(value('current'),null,2);fs.writeFileSync(file,primary);fs.writeFileSync(previousPath(file),prior);
      const r=createLibraryRecovery({fs:guard.fs}),before=digest(file),previousBefore=digest(previousPath(file));await r.writeLibraryGeneration(file,value('current'));
      await assert.rejects(r.writeLibraryGeneration(file,value('changed')),e=>e.code==='LIBRARY_BACKUP_UNUSABLE');assert.equal(digest(file),before);assert.equal(digest(previousPath(file)),previousBefore);
    });
    add('missing primary with backup is RECOVERY_REQUIRED and never fresh',async()=>{
      const dir=folder('missing-primary'),file=path.join(dir,'library.json'),backup=previousPath(file);fs.writeFileSync(backup,JSON.stringify(value('recoverable')));const before=digest(backup),r=createLibraryRecovery({fs:guard.fs});let fresh=0;
      const b=createLibraryBootstrap({readText:()=>r.readPrimaryLibraryText(file),writeStore:v=>r.writeLibraryGeneration(file,v),createFresh:()=>{fresh++;return value('wrong');},prepare:v=>v});
      assert.equal((await b.boot()).kind,'RECOVERY_REQUIRED');assert.equal(fresh,0);assert.equal(fs.existsSync(file),false);assert.equal(digest(backup),before);
    });
    add('boot-only degraded backup preserves bad prior material and permits safe NEW export',async()=>{
      const dir=folder('degraded-boot'),file=path.join(dir,'library.json'),backup=previousPath(file);fs.writeFileSync(file,JSON.stringify(value('before')));fs.writeFileSync(backup,'CORRUPT_FORENSIC_PREVIOUS');
      const previousBefore=digest(backup),r=createLibraryRecovery({fs:guard.fs});let acknowledgement;
      const b=createLibraryBootstrap({readText:()=>r.readPrimaryLibraryText(file),createFresh:()=>{throw Error('Must not reset valid primary');},prepare:v=>{v.settings.prepared=true;return v;},writeStore:async v=>{acknowledgement=await r.writeLibraryGeneration(file,v,{allowBackupDegradation:true});}});
      assert.equal((await b.boot()).kind,'VALID');assert.equal(acknowledgement.backupWarning,'LIBRARY_BACKUP_UNUSABLE');assert.equal(json(file).settings.prepared,true);assert.equal(digest(backup),previousBefore);
      const output=path.join(outputs,'after-degraded-boot.json');await exporter().writeJSON(output,{stillUsable:true});assert.equal(json(output).stillUsable,true);
      await assert.rejects(r.writeLibraryGeneration(file,value('later strict change')),e=>e.code==='LIBRARY_BACKUP_UNUSABLE');assert.equal(digest(backup),previousBefore);
    });
    add('boot-only injected backup I/O failure acknowledges primary without deleting previous',async()=>{
      const dir=folder('degraded-io'),file=path.join(dir,'library.json'),backup=previousPath(file);fs.writeFileSync(file,JSON.stringify(value('before')));fs.writeFileSync(backup,JSON.stringify(value('old-previous')));const before=digest(backup);
      const port={...guard.fs,async open(name,flags){if(name.includes('.backup.'))throw error('EACCES');return guard.fs.open(name,flags);}};
      const result=await createLibraryRecovery({fs:port}).writeLibraryGeneration(file,value('after'),{allowBackupDegradation:true});assert.equal(result.backupWarning,'EACCES');assert.equal(json(file).settings.tag,'after');assert.equal(digest(backup),before);
    });
    for(const [name,primary]of [['corrupt','{bad'],['future','{"version":20,"photos":[],"settings":{}}']])add(name+' primary is never overwritten or silently replaced by backup',async()=>{
      const dir=folder(name),file=path.join(dir,'library.json'),backup=previousPath(file);fs.writeFileSync(file,primary);fs.writeFileSync(backup,JSON.stringify(value('older')));const before=digest(file),previousBefore=digest(backup),r=createLibraryRecovery({fs:guard.fs});
      const info=await r.inspectLibraryRecovery(file);assert.equal(info.selection,'none');assert.equal(info.recoverablePrevious,name==='corrupt');await assert.rejects(r.writeLibraryGeneration(file,value('new')));assert.equal(digest(file),before);assert.equal(digest(backup),previousBefore);
    });
    add('corrupt primary plus invalid backup retains both exact physical byte streams',async()=>{
      const dir=folder('both-corrupt'),file=path.join(dir,'library.json'),backup=previousPath(file);
      fs.writeFileSync(file,'{bad-primary');fs.writeFileSync(backup,'{bad-previous');
      const before=digest(file),previousBefore=digest(backup),r=createLibraryRecovery({fs:guard.fs});let writes=0,fresh=0;
      const info=await r.inspectLibraryRecovery(file);assert.equal(info.primary.kind,'CORRUPT');assert.equal(info.previous.kind,'CORRUPT');assert.equal(info.selection,'none');assert.equal(info.recoverablePrevious,false);
      const b=createLibraryBootstrap({readText:()=>r.readPrimaryLibraryText(file),writeStore:async v=>{writes++;return r.writeLibraryGeneration(file,v);},createFresh:()=>{fresh++;return value('wrong');},prepare:v=>v});
      assert.equal((await b.boot()).kind,'CORRUPT');assert.equal(writes,0);assert.equal(fresh,0);
      await assert.rejects(r.writeLibraryGeneration(file,value('wrong'),{allowBackupDegradation:true}),e=>e.code==='LIBRARY_PRIMARY_UNUSABLE');
      assert.equal(digest(file),before);assert.equal(digest(backup),previousBefore);
      return {primaryBeforeSha256:before,primaryAfterSha256:digest(file),previousBeforeSha256:previousBefore,previousAfterSha256:digest(backup)};
    });
    add('interrupted staging is preserved and never promoted over primary',async()=>{
      const dir=folder('orphan'),file=path.join(dir,'library.json'),temp=file+'.primary.orphan.tmp';fs.writeFileSync(file,JSON.stringify(value('primary')));fs.writeFileSync(temp,JSON.stringify(value('newer-looking-orphan')));const before=digest(temp),r=createLibraryRecovery({fs:guard.fs});
      assert.equal((await r.inspectLibraryRecovery(file)).selection,'primary');assert.equal(json(file).settings.tag,'primary');assert.equal(digest(temp),before);
    });
    add('partial backup failure retains primary and forensic temp',async()=>{
      const dir=folder('backup-fault'),file=path.join(dir,'library.json');fs.writeFileSync(file,JSON.stringify(value('old')));const before=digest(file);
      const port={...guard.fs,async open(name,flags){const h=await guard.fs.open(name,flags);if(!name.includes('.backup.'))return h;return {...h,async writeFile(bytes){await h.writeFile(Buffer.from(bytes).subarray(0,4));throw error('ENOSPC');}};}};
      await assert.rejects(createLibraryRecovery({fs:port}).writeLibraryGeneration(file,value('new')));assert.equal(digest(file),before);assert.ok(fs.readdirSync(dir).some(name=>name.includes('.backup.')&&name.endsWith('.tmp')));assert.equal(guard.evidence().counters.openHandles,0);
    });
    add('primary rename failure leaves old primary and validated previous bytes',async()=>{
      const dir=folder('rename-fault'),file=path.join(dir,'library.json');fs.writeFileSync(file,JSON.stringify(value('old')));const before=digest(file),port={...guard.fs,async rename(from,to){if(to===file)throw error('EIO');return guard.fs.rename(from,to);}};
      await assert.rejects(createLibraryRecovery({fs:port}).writeLibraryGeneration(file,value('new')));assert.equal(digest(file),before);assert.equal(digest(previousPath(file)),before);assert.equal(guard.evidence().counters.openHandles,0);
    });
    // Transactional registration cases are appended below after loading its exact helpers.
    const transactionCases=await registrationCases();cases.push(...transactionCases);
    for(let i=0;i<cases.length;i++){
      const c=cases[i];let timer;
      try{const detail=await Promise.race([c.run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('3s case deadline')),3000);})]);guard.check();for(const file of originals)assert.equal(digest(file),originalHashes[file]);
        report.results.push({name:c.name,status:detail?.blocked?'BLOCKED':'PASS',...detail});console.log((detail?.blocked?'BLOCKED ':'PASS ')+c.name);
      }catch(e){report.results.push({name:c.name,status:'FAIL',error:String(e.stack||e)});console.error('FAIL '+c.name+'\n'+String(e.stack||e));if(guard.evidence().attempts.some(a=>!a.expected)||/deadline/.test(e.message)){for(const r of cases.slice(i+1))report.results.push({name:r.name,status:'NOT_RUN',reason:'stop condition'});break;}}
      finally{clearTimeout(timer);}
    }
    await guard.cleanup();guard.check();
    const countFiles=directory=>fs.readdirSync(directory,{withFileTypes:true}).reduce((n,entry)=>n+(entry.isDirectory()&&!entry.isSymbolicLink()?countFiles(path.join(directory,entry.name)):1),0);
    report.fixtureFileCount=countFiles(fixture);assert.ok(report.fixtureFileCount<=report.limits.maxFiles);
    save();console.log(JSON.stringify({tier:'T2',pass:report.pass,fail:report.fail,blocked:report.blocked,report:'qa/s2a/filesystem-results.json'}));process.exitCode=report.exitCode;
  }catch(e){report.results.push({name:'admission or suite invariant',status:'FAIL',error:String(e.stack||e)});await guard.cleanup();save();throw e;}
  finally{clearTimeout(deadline);}

  async function registrationCases(){
    const {createLibraryCommitter}=guard.load('electron/library-commits.cjs'),{createPhotoImporter}=guard.load('electron/photo-import.cjs');
    const {createLibraryRecovery,previousPath}=guard.load('electron/library-recovery.cjs'),list=[];
    const add=(name,run)=>list.push({name,run});
    function setup(name,{writerFault,buildFault,beforeRead,copyCollision=false,primaryRenameFault}={}){
      const dir=folder(name),capture=path.join(dir,'capture'),file=path.join(dir,'library.json');fs.mkdirSync(capture);let store=value('base');fs.writeFileSync(file,JSON.stringify(store,null,2));const events=[],errors=[];
      const persistencePort={...guard.fs,async rename(from,to){if(to===file&&primaryRenameFault)await primaryRenameFault();return guard.fs.rename(from,to);}};
      const recovery=createLibraryRecovery({fs:persistencePort}),write=async candidate=>{if(writerFault)await writerFault(candidate);return recovery.writeLibraryGeneration(file,candidate);};
      const commits=createLibraryCommitter({getStore:()=>store,writeSnapshot:write,isReady:()=>true});
      const collision=path.join(capture,'collision.jpg');if(copyCollision)fs.writeFileSync(collision,'COMPETING_COPY_OWNER');
      const importer=createPhotoImporter({getStore:()=>store,commits,extensions:new Set(['.jpg']),beforeRead:beforeRead|| (async()=>{}),
        uniquePath:async(dest,name)=>{if(copyCollision)return collision;for(let i=0;i<40;i++){const candidate=path.join(dest,i?i+'-'+name:name);try{await guard.fs.access(candidate);}catch(e){if(e.code==='ENOENT')return candidate;throw e;}}throw Error('fixture collision budget');},
        buildPhoto:async target=>{if(buildFault)await buildFault(target);const bytes=await guard.fs.readFile(target);return {id:sha(target+sha(bytes)).slice(0,24),path:target,name:path.basename(target),previewError:'explicit no-codec fixture'};},
        onPhoto:p=>events.push(p),onError:e=>errors.push(e),onComplete:()=>{}});
      return {dir,capture,file,store,commits,importer,events,errors,context:{sessionId:null,dest:capture},restart:()=>{store=json(file);return store;}};
    }
    add('registration success/duplicate counters reflect actual acknowledged JSON',async()=>{
      const x=setup('registration-success');const result=await x.importer.addFiles(originals,true,x.context);assert.equal(result.added,2);assert.equal(x.events.length,2);assert.equal(json(x.file).photos.length,2);assert.equal(x.store.photos.length,2);
      const duplicate=await x.importer.addFiles(originals,true,x.context);assert.equal(duplicate.added,0);assert.equal(duplicate.skipped,2);assert.equal(x.events.length,2);
    });
    add('failed persist gives added0/events0/no staged dedup; retry reuses retained copy',async()=>{
      let fail=true;const x=setup('registration-failure',{writerFault:async()=>{if(fail)throw error('EIO');}}),first=await x.importer.addFiles([originals[0]],true,x.context);
      assert.equal(first.added,0);assert.equal(x.events.length,0);assert.equal(x.store.photos.length,0);assert.equal(json(x.file).photos.length,0);assert.equal(fs.readdirSync(x.capture).length,1);
      const retained=path.join(x.capture,fs.readdirSync(x.capture)[0]),before=digest(retained);fail=false;const retry=await x.importer.addFiles([originals[0]],true,x.context);
      assert.equal(retry.added,1);assert.equal(retry.skipped,0);assert.equal(x.events.length,1);assert.equal(json(x.file).photos.length,1);assert.equal(fs.readdirSync(x.capture).length,1);assert.equal(digest(retained),before);
    });
    add('composed real import and recovery primary-rename failure has no false added; retry commits retained copy',async()=>{
      let fail=true;const x=setup('composed-rename-failure',{primaryRenameFault:async()=>{if(fail)throw error('EIO');}}),before=digest(x.file);
      const result=await x.importer.addFiles([originals[0]],true,x.context);assert.equal(result.added,0);assert.equal(x.events.length,0);assert.equal(x.store.photos.length,0);assert.equal(json(x.file).photos.length,0);assert.equal(digest(x.file),before);
      assert.equal(digest(previousPath(x.file)),before);assert.ok(fs.readdirSync(x.dir).some(name=>name.includes('.primary.')&&name.endsWith('.tmp')));
      const retained=path.join(x.capture,fs.readdirSync(x.capture)[0]),copyBefore=digest(retained);fail=false;assert.equal((await x.importer.addFiles([originals[0]],true,x.context)).added,1);
      assert.equal(fs.readdirSync(x.capture).length,1);assert.equal(digest(retained),copyBefore);assert.equal(json(x.file).photos[0].path,retained);assert.equal(x.events.length,1);
      return {fault:'controlled EIO on final primary rename AFTER actual backup/temp writes; no physical originals removed'};
    });
    add('registration failure never leaks into later unrelated queued edit',async()=>{
      let first=true;const gate=deferred(),entered=deferred(),x=setup('unrelated-edit',{writerFault:async()=>{if(first){first=false;entered.resolve();await gate.promise;throw error('EIO');}}});
      const importing=x.importer.addFiles([originals[0]],true,x.context);await entered.promise;x.store.settings.theme='dark';const editing=x.commits.persist();gate.resolve();
      assert.equal((await importing).added,0);await editing;assert.equal(x.store.settings.theme,'dark');assert.equal(json(x.file).settings.theme,'dark');assert.equal(json(x.file).photos.length,0);assert.equal(x.events.length,0);
    });
    add('real exclusive copy collision never overwrites another owner or increments added',async()=>{
      const x=setup('copy-collision',{copyCollision:true}),collision=path.join(x.capture,'collision.jpg'),before=digest(collision),result=await x.importer.addFiles([originals[0]],true,x.context);
      assert.equal(result.added,0);assert.equal(result.errors.length,1);assert.equal(x.events.length,0);assert.equal(json(x.file).photos.length,0);assert.equal(digest(collision),before);
      return {fault:'actual OS COPYFILE_EXCL collision; competing target preserved'};
    });
    add('successful registration preserves unrelated live edit and queued persist ordering',async()=>{
      let first=true;const gate=deferred(),entered=deferred(),x=setup('successful-concurrency',{writerFault:async()=>{if(first){first=false;entered.resolve();await gate.promise;}}});
      const importing=x.importer.addFiles([originals[0]],true,x.context);await entered.promise;x.store.settings.theme='dark';const editing=x.commits.persist();gate.resolve();
      assert.equal((await importing).added,1);await editing;assert.equal(x.store.settings.theme,'dark');assert.equal(json(x.file).settings.theme,'dark');assert.equal(json(x.file).photos.length,1);assert.equal(x.events.length,1);
    });
    add('already copied camera-style original survives index failure and deterministic retry',async()=>{
      let fail=true;const x=setup('camera-style',{writerFault:async()=>{if(fail)throw error('EIO');}}),context={...x.context,cameraTransfer:true},before=digest(originals[0]);
      assert.equal((await x.importer.addFiles([originals[0]],false,context)).added,0);assert.equal(x.store.photos.length,0);assert.equal(x.events.length,0);assert.equal(digest(originals[0]),before);
      fail=false;assert.equal((await x.importer.addFiles([originals[0]],false,context)).added,1);assert.equal(json(x.file).photos[0].path,originals[0]);assert.equal(digest(originals[0]),before);assert.equal(fs.readdirSync(x.capture).length,0);
      return {provenance:'synthetic copy=false/cameraTransfer flag only; no worker or hardware'};
    });
    add('multi-file partial success reports only committed records',async()=>{
      let writes=0;const x=setup('partial-batch',{writerFault:async()=>{if(++writes===2)throw error('EIO');}}),result=await x.importer.addFiles(originals,true,x.context);
      assert.equal(result.added,1);assert.equal(result.errors.length,1);assert.equal(x.events.length,1);assert.equal(json(x.file).photos.length,1);assert.equal(fs.readdirSync(x.capture).length,2);
    });
    add('fatal decode/build failure retains copy while recoverable preview warning commits',async()=>{
      let fatal=true;const x=setup('build-fault',{buildFault:async()=>{if(fatal)throw error('SYNTHETIC_FATAL_BUILD');}});
      assert.equal((await x.importer.addFiles([originals[0]],true,x.context)).added,0);assert.equal(fs.readdirSync(x.capture).length,1);fatal=false;
      assert.equal((await x.importer.addFiles([originals[0]],true,x.context)).added,1);assert.equal(json(x.file).photos[0].previewError,'explicit no-codec fixture');
    });
    add('ordinary source already in capture folder still receives a NEW managed copy',async()=>{
      const x=setup('source-in-capture'),source=path.join(x.capture,'user-source.jpg');fs.writeFileSync(source,'UNMANAGED_SOURCE_BYTES');const before=digest(source);
      assert.equal((await x.importer.addFiles([source],true,x.context)).added,1);const committed=json(x.file).photos[0].path;assert.notEqual(committed,source);assert.equal(digest(committed),before);assert.equal(digest(source),before);assert.equal(fs.readdirSync(x.capture).length,2);
    });
    add('restart manual reimport creates a NEW managed copy and preserves unindexed original',async()=>{
      const x=setup('restart-orphan',{writerFault:async()=>{throw error('EIO');}});assert.equal((await x.importer.addFiles([originals[1]],true,x.context)).added,0);
      const retained=path.join(x.capture,fs.readdirSync(x.capture)[0]),before=digest(retained);let store=json(x.file);const r=createLibraryRecovery({fs:guard.fs}),commits=createLibraryCommitter({getStore:()=>store,writeSnapshot:v=>r.writeLibraryGeneration(x.file,v),isReady:()=>true});
      const managed=path.join(x.capture,'reconciled-new.jpg');
      const importer=createPhotoImporter({getStore:()=>store,commits,extensions:new Set(['.jpg']),uniquePath:async()=>managed,buildPhoto:async target=>({id:sha(target).slice(0,24),path:target,name:path.basename(target)}),onPhoto:()=>{},onError:()=>{},onComplete:()=>{}});
      const result=await importer.addFiles([retained],true,x.context);assert.equal(result.added,1);assert.equal(json(x.file).photos[0].path,managed);assert.notEqual(managed,retained);assert.equal(fs.readdirSync(x.capture).length,2);assert.equal(digest(retained),before);assert.equal(digest(managed),before);
    });
    return list;
  }
}
