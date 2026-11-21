// Named T1 only: actual recovery code, deterministic in-memory filesystem faults.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT1\n--scope\nsynthetic'){
  console.error(JSON.stringify({status:'REFUSED',code:'RECOVERY_T1_SCOPE_DENIED'}));process.exitCode=2;
}else if(process.env.NODE_OPTIONS||process.env.NODE_PATH||!process.execArgv.includes('--no-addons')){
  console.error(JSON.stringify({status:'REFUSED',code:'RECOVERY_T1_ENV_DENIED'}));process.exitCode=2;
}else main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
  const root=path.resolve(__dirname,'../..'),output=path.join(root,'qa','s2a','recovery-results.json');
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  const files=['electron/library-recovery.cjs','electron/library-schema.cjs','electron/library-text.cjs'];
  const sources=new Map(),modules=new Map(),graph=[],denials=[];
  const deny=request=>{denials.push(request);const error=Error('RECOVERY_IMPORT_DENIED: '+request);error.code='RECOVERY_IMPORT_DENIED';throw error;};
  const builtins=new Map([
    ['node:path',path],['node:crypto',Object.freeze({randomUUID:crypto.randomUUID,createHash:crypto.createHash})],
    ['node:util',Object.freeze({TextDecoder:require('node:util').TextDecoder})],
    ['node:fs/promises',new Proxy({},{get:()=>{throw Error('Default filesystem is not admitted in T1.');}})]
  ]);
  function resolve(request,parent){
    if(builtins.has(request))return request;
    const file=typeof request==='string'&&request.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(parent),request)):null;
    if(!files.includes(file))return deny(request);return file;
  }
  function scan(file){
    if(sources.has(file))return;const target=fs.realpathSync(path.join(root,file));assert.equal(target.startsWith(fs.realpathSync(root)+path.sep),true);
    const source=fs.readFileSync(target,'utf8');sources.set(file,source);
    assert.equal(/\bimport\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/.test(source),false);
    const imports=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];assert.equal((source.match(/\brequire\s*\(/g)||[]).length,imports.length);
    for(const item of imports){const target=resolve(item[2],file);graph.push({from:file,to:target});if(!builtins.has(target))scan(target);}
  }
  const context=vm.createContext({},{codeGeneration:{strings:false,wasm:false}});
  function load(file){
    if(builtins.has(file))return builtins.get(file);if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    new vm.Script('(function(exports,require,module){\n'+sources.get(file)+'\n})',{filename:file}).runInContext(context,{timeout:500})(module.exports,request=>load(resolve(request,file)),module);
    return module.exports;
  }
  for(const request of ['electron','koffi','sharp','node:child_process','node:net','node:worker_threads','../camera-worker.cjs','../sdk-environment.cjs'])assert.throws(()=>resolve(request,'electron/library-recovery.cjs'),error=>error.code==='RECOVERY_IMPORT_DENIED');
  assert.equal(denials.length,8);scan(files[0]);const policy=load(files[0]);
  const primary=path.resolve('/synthetic-s2a/library.json'),previous=policy.previousPath(primary);
  const valid=(name,version=2)=>({version,photos:[],sessions:[],presets:[],settings:{name},unknown:{retained:true}});
  const json=value=>Buffer.from(JSON.stringify(value,null,2));
  const failure=code=>Object.assign(Error('Controlled '+code),{code});
  function model(initial={}){
    const entries=new Map(Object.entries(initial).map(([name,bytes])=>[name,Buffer.from(bytes)]));
    const calls=[],state={fault:null,onClose:null,afterCommitForbidden:false,committed:false,openHandles:0};
    function step(operation,file){
      if(state.afterCommitForbidden&&state.committed)throw Error('Unexpected I/O after primary commit.');
      calls.push({operation,file});if(state.fault?.operation===operation&&state.fault.match(file))throw failure(state.fault.code||'EIO');
    }
    const adapter={
      async readFile(file){step('readFile',file);if(!entries.has(file))throw failure('ENOENT');return Buffer.from(entries.get(file));},
      async mkdir(file,options){step('mkdir',file);assert.equal(options.recursive,true);},
      async open(file,flags){
        step('open',file);assert.equal(flags,'wx');if(entries.has(file))throw failure('EEXIST');entries.set(file,Buffer.alloc(0));state.openHandles++;let closed=false,closeFaultInjected=false;
        return {
          async writeFile(bytes){
            if(state.fault?.operation==='partialWrite'&&state.fault.match(file)){entries.set(file,Buffer.from(bytes).subarray(0,7));calls.push({operation:'partialWrite',file});throw failure(state.fault.code||'ENOSPC');}
            step('writeFile',file);entries.set(file,Buffer.from(bytes));
          },
          async close(){
            const transient=state.fault?.operation==='close'&&state.fault.match(file);
            if(!closed&&transient&&!closeFaultInjected){closeFaultInjected=true;calls.push({operation:'closeFailure',file});throw failure(state.fault.code||'EIO');}
            if(!closed){closed=true;state.openHandles--;}
            if(transient)calls.push({operation:'close',file});else step('close',file);
            state.onClose?.(file,entries);
          }
        };
      },
      async rename(from,to){step('rename',to);assert.ok(entries.has(from));entries.set(to,entries.get(from));entries.delete(from);if(to===primary)state.committed=true;}
    };
    let sequence=0;
    return {entries,calls,state,api:policy.createLibraryRecovery({fs:adapter,id:()=>String(++sequence)}),hash:file=>sha(entries.get(file)),text:file=>entries.get(file)?.toString('utf8')};
  }
  const cases=[],results=[];const add=(name,run)=>cases.push({name,run});
  add('classification uses real schema, UTF-8 and byte hashes',()=>{
    for(const [bytes,kind] of [[json(valid('v2')),'VALID'],[json({photos:[],settings:{}}),'VALID'],[json(valid('future',3)),'UNSUPPORTED_VERSION'],[Buffer.from('{'),'CORRUPT'],[Buffer.from([0xc3,0x28]),'UNREADABLE']]){
      const result=policy.classifyLibraryBytes(bytes);assert.equal(result.kind,kind);assert.equal(result.sha256,sha(bytes));
    }
  });
  add('valid primary is authoritative even when previous differs',async()=>{
    const m=model({[primary]:json(valid('primary')),[previous]:json(valid('different previous'))});const before=[m.hash(primary),m.hash(previous)];const result=await m.api.inspectLibraryRecovery(primary);
    assert.equal(result.selection,'primary');assert.equal(result.reason,'PRIMARY_AUTHORITATIVE');assert.equal(result.recoverablePrevious,false);assert.equal(m.calls.every(call=>call.operation==='readFile'),true);assert.deepEqual([m.hash(primary),m.hash(previous)],before);
  });
  for(const [label,bytes] of [['corrupt',Buffer.from('{')],['future',json(valid('future',3))]])add('exact-byte unchanged v2 boots without replacing '+label+' previous',async()=>{
    const candidate=valid('same'),m=model({[primary]:json(candidate),[previous]:bytes}),before=[m.hash(primary),m.hash(previous)];await m.api.writeLibraryGeneration(primary,candidate);assert.deepEqual([m.hash(primary),m.hash(previous)],before);assert.equal(m.calls.every(call=>call.operation==='readFile'),true);assert.equal(m.state.committed,false);await assert.rejects(m.api.writeLibraryGeneration(primary,valid('changed')),error=>error.code==='LIBRARY_BACKUP_UNUSABLE');assert.deepEqual([m.hash(primary),m.hash(previous)],before);assert.equal(m.calls.every(call=>call.operation==='readFile'),true);
  });
  add('only both missing preserves ENOENT fresh contract',async()=>{
    const m=model();assert.equal((await m.api.inspectLibraryRecovery(primary)).firstRun,true);await assert.rejects(m.api.readPrimaryLibraryText(primary),error=>error.code==='ENOENT');assert.equal(m.entries.size,0);
  });
  add('semantic unchanged v2 preserves raw formatting and an unusable previous',async()=>{
    const candidate=valid('same'),formatted=Buffer.from(JSON.stringify({unknown:candidate.unknown,settings:candidate.settings,presets:[],sessions:[],photos:[],version:2}));
    const m=model({[primary]:formatted,[previous]:Buffer.from('{')}),before=[m.hash(primary),m.hash(previous)];
    const status=await m.api.writeLibraryGeneration(primary,candidate);assert.equal(status.primaryChanged,false);assert.equal(status.backupWarning,'LIBRARY_BACKUP_UNUSABLE');assert.deepEqual([m.hash(primary),m.hash(previous)],before);assert.equal(m.calls.every(call=>call.operation==='readFile'),true);
  });
  for(const [label,bytes] of [['corrupt',Buffer.from('{')],['future',json(valid('future',3))]])add('boot-only degraded '+label+' previous preserves core availability and ordinary persist stays strict',async()=>{
    const m=model({[primary]:json(valid('old')),[previous]:bytes}),previousHash=m.hash(previous);
    const status=await m.api.writeLibraryGeneration(primary,valid('prepared'),{allowBackupDegradation:true});
    assert.equal(status.primaryChanged,true);assert.equal(status.backupWarning,'LIBRARY_BACKUP_UNUSABLE');assert.equal(JSON.parse(m.text(primary)).settings.name,'prepared');assert.equal(m.hash(previous),previousHash);
    const primaryHash=m.hash(primary);await assert.rejects(m.api.writeLibraryGeneration(primary,valid('ordinary edit')),error=>error.code==='LIBRARY_BACKUP_UNUSABLE');assert.equal(m.hash(primary),primaryHash);assert.equal(m.hash(previous),previousHash);
  });
  add('boot-only backup write refusal warns but acknowledges the real primary commit',async()=>{
    const m=model({[primary]:json(valid('old')),[previous]:json(valid('previous'))}),previousHash=m.hash(previous);m.state.fault={operation:'writeFile',match:file=>file.includes('.backup.'),code:'EACCES'};
    const status=await m.api.writeLibraryGeneration(primary,valid('prepared'),{allowBackupDegradation:true});assert.equal(status.backupWarning,'EACCES');assert.equal(JSON.parse(m.text(primary)).settings.name,'prepared');assert.equal(m.hash(previous),previousHash);assert.equal(m.state.openHandles,0);
    const primaryHash=m.hash(primary);await assert.rejects(m.api.writeLibraryGeneration(primary,valid('ordinary edit')),error=>error.code==='EACCES');assert.equal(m.hash(primary),primaryHash);
  });
  add('boot-only degradation never downgrades a future primary',async()=>{
    const m=model({[primary]:json(valid('future',3)),[previous]:json(valid('previous'))}),before=m.hash(primary);await assert.rejects(m.api.writeLibraryGeneration(primary,valid('prepared'),{allowBackupDegradation:true}),error=>error.code==='LIBRARY_UNSUPPORTED_VERSION');assert.equal(m.hash(primary),before);assert.equal(m.calls.every(call=>call.operation==='readFile'),true);
  });
  add('boot-only degradation never swallows a detected backup generation change',async()=>{
    const future=json(valid('external future',3)),m=model({[primary]:json(valid('old'))});m.state.onClose=(file,entries)=>{if(file.includes('.backup.'))entries.set(previous,future);};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('prepared'),{allowBackupDegradation:true}),error=>error.code==='LIBRARY_CHANGED');assert.equal(m.hash(previous),sha(future));assert.equal(JSON.parse(m.text(primary)).settings.name,'old');
  });
  for(const [label,bytes] of [['valid',json(valid('backup'))],['corrupt',Buffer.from('{')],['future',json(valid('future',3))]])add('missing primary with '+label+' previous cannot fresh-start',async()=>{
    const m=model({[previous]:bytes}),before=m.hash(previous);await assert.rejects(m.api.readPrimaryLibraryText(primary),error=>error.code==='LIBRARY_RECOVERY_REQUIRED');await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='LIBRARY_RECOVERY_REQUIRED');assert.equal(m.hash(previous),before);assert.equal(m.entries.has(primary),false);
  });
  add('read helper leaves corrupt text classification to S1 bootstrap',async()=>{
    const m=model({[primary]:Buffer.from('{')});assert.equal(await m.api.readPrimaryLibraryText(primary),'{');assert.equal(m.entries.size,1);
  });
  for(const [label,bytes,code] of [['corrupt',Buffer.from('{'),'LIBRARY_PRIMARY_UNUSABLE'],['future',json(valid('future',3)),'LIBRARY_UNSUPPORTED_VERSION']])add(label+' primary is never replaced by valid previous',async()=>{
    const m=model({[primary]:bytes,[previous]:json(valid('previous'))}),before=[m.hash(primary),m.hash(previous)],inspection=await m.api.inspectLibraryRecovery(primary);
    assert.equal(inspection.selection,'none');assert.equal(inspection.recoverablePrevious,label!=='future');await assert.rejects(m.api.writeLibraryGeneration(primary,valid('candidate')),error=>error.code===code);assert.deepEqual([m.hash(primary),m.hash(previous)],before);assert.equal(m.calls.some(call=>call.operation==='open'),false);
  });
  add('invalid candidate is rejected before I/O',async()=>{
    for(const value of [undefined,{version:2,photos:{},settings:{}},valid('future',3)]){const m=model({[primary]:json(valid('old'))});await assert.rejects(m.api.writeLibraryGeneration(primary,value),error=>error.code==='LIBRARY_CANDIDATE_INVALID');assert.equal(m.calls.length,0);}
  });
  add('new generation physically enters model primary only after commit',async()=>{
    const m=model();await m.api.writeLibraryGeneration(primary,valid('new'));assert.equal(JSON.parse(m.text(primary)).settings.name,'new');assert.equal(m.entries.has(previous),false);assert.equal(m.entries.size,1);assert.equal(m.state.openHandles,0);assert.equal(m.calls.at(-1).operation,'rename');
  });
  add('candidate is detached before the first asynchronous filesystem boundary',async()=>{
    const m=model(),candidate=valid('snapshot'),pending=m.api.writeLibraryGeneration(primary,candidate);candidate.settings.name='later mutation';await pending;assert.equal(JSON.parse(m.text(primary)).settings.name,'snapshot');assert.equal(candidate.settings.name,'later mutation');assert.equal(JSON.parse(m.text(primary)).unknown.retained,true);
  });
  add('migration backs up exact legacy bytes and rotates only one previous',async()=>{
    const legacy=Buffer.from('  {"photos":[],"settings":{"name":"legacy"}}\n'),m=model({[primary]:legacy});await m.api.writeLibraryGeneration(primary,valid('v2'));
    assert.equal(m.hash(previous),sha(legacy));const committed=m.hash(primary);await m.api.writeLibraryGeneration(primary,valid('next'));assert.equal(m.hash(previous),committed);assert.equal(JSON.parse(m.text(primary)).settings.name,'next');assert.equal(m.entries.size,2);assert.equal(m.state.openHandles,0);
  });
  for(const [label,bytes] of [['corrupt',Buffer.from('{')],['future',json(valid('future',3))]])add(label+' previous retained and failure precedes primary I/O',async()=>{
    const m=model({[primary]:json(valid('old')),[previous]:bytes}),before=[m.hash(primary),m.hash(previous)];await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='LIBRARY_BACKUP_UNUSABLE');assert.deepEqual([m.hash(primary),m.hash(previous)],before);assert.equal(m.calls.some(call=>call.operation==='open'),false);
  });
  add('unreadable previous is retained and blocks replacement',async()=>{
    const m=model({[primary]:json(valid('old')),[previous]:json(valid('previous'))}),before=[m.hash(primary),m.hash(previous)];m.state.fault={operation:'readFile',match:file=>file===previous,code:'EACCES'};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='LIBRARY_BACKUP_UNUSABLE');assert.deepEqual([m.hash(primary),m.hash(previous)],before);assert.equal(m.calls.some(call=>call.operation==='open'),false);
  });
  for(const phase of ['backup','primary'])add(phase+' partial write fails without primary acknowledgement and retains temp',async()=>{
    const m=model({[primary]:json(valid('old')),[previous]:json(valid('previous'))}),before=m.hash(primary);m.state.fault={operation:'partialWrite',match:file=>file.includes('.'+phase+'.'),code:'ENOSPC'};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='ENOSPC');assert.equal(m.hash(primary),before);assert.equal(m.state.committed,false);assert.equal(m.state.openHandles,0);assert.equal([...m.entries.keys()].some(file=>file.includes('.'+phase+'.')&&file.endsWith('.tmp')),true);
  });
  for(const phase of ['backup','primary'])add(phase+' close failure precedes primary acknowledgement',async()=>{
    const m=model({[primary]:json(valid('old'))}),before=m.hash(primary);m.state.fault={operation:'close',match:file=>file.includes('.'+phase+'.'),code:'EIO'};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='EIO');assert.equal(m.hash(primary),before);assert.equal(m.state.committed,false);assert.equal(m.state.openHandles,0);assert.equal([...m.entries.keys()].some(file=>file.includes('.'+phase+'.')&&file.endsWith('.tmp')),true);
  });
  for(const target of [previous,primary])add((target===previous?'backup':'primary')+' rename fault keeps primary valid and retry succeeds',async()=>{
    const m=model({[primary]:json(valid('old')),[previous]:json(valid('previous'))}),before=m.hash(primary);m.state.fault={operation:'rename',match:file=>file===target,code:'EIO'};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='EIO');assert.equal(m.hash(primary),before);assert.equal(m.state.committed,false);const retained=[...m.entries].filter(([file])=>file.endsWith('.tmp')).map(([file,bytes])=>[file,sha(bytes)]);m.state.fault=null;await m.api.writeLibraryGeneration(primary,valid('retry'));assert.equal(JSON.parse(m.text(primary)).settings.name,'retry');for(const [file,hash] of retained)assert.equal(m.hash(file),hash);
  });
  add('late primary change is detected before primary replacement',async()=>{
    const newer=json(valid('external newer')),m=model({[primary]:json(valid('old'))});m.state.onClose=(file,entries)=>{if(file.includes('.primary.'))entries.set(primary,newer);};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('stale')),error=>error.code==='LIBRARY_CHANGED');assert.equal(m.hash(primary),sha(newer));assert.equal(m.state.committed,false);
  });
  add('late future backup is preserved before backup replacement',async()=>{
    const future=json(valid('future',3)),m=model({[primary]:json(valid('old'))});m.state.onClose=(file,entries)=>{if(file.includes('.backup.'))entries.set(previous,future);};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='LIBRARY_CHANGED');assert.equal(m.hash(previous),sha(future));assert.equal(JSON.parse(m.text(primary)).settings.name,'old');
  });
  add('backup changed after its commit prevents primary replacement',async()=>{
    const m=model({[primary]:json(valid('old'))}),before=m.hash(primary),future=json(valid('future',3));m.state.onClose=(file,entries)=>{if(file.includes('.primary.'))entries.set(previous,future);};await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='LIBRARY_CHANGED');assert.equal(m.hash(primary),before);assert.equal(m.hash(previous),sha(future));assert.equal(m.state.committed,false);
  });
  add('exclusive temp collision cannot overwrite someone else material',async()=>{
    const collision=primary+'.primary.1.tmp',m=model({[collision]:Buffer.from('forensic')});await assert.rejects(m.api.writeLibraryGeneration(primary,valid('new')),error=>error.code==='EEXIST');assert.equal(m.text(collision),'forensic');assert.equal(m.entries.has(primary),false);
  });
  add('unknown orphan temp is not promoted or deleted',async()=>{
    const orphan=primary+'.old-orphan.tmp',m=model({[primary]:json(valid('good')),[orphan]:Buffer.from('partial-forensic')});await m.api.writeLibraryGeneration(primary,valid('new'));assert.equal(m.text(orphan),'partial-forensic');assert.equal(JSON.parse(m.text(primary)).settings.name,'new');assert.equal([...m.entries.keys()].filter(file=>file===previous).length,1);
  });
  add('no fallible filesystem work occurs after primary acknowledgement',async()=>{
    const m=model({[primary]:json(valid('old'))});m.state.afterCommitForbidden=true;await m.api.writeLibraryGeneration(primary,valid('new'));assert.equal(m.state.committed,true);assert.equal(m.calls.at(-1).operation,'rename');assert.equal(m.calls.at(-1).file,primary);
  });
  const sourceHashes=Object.fromEntries([...sources].map(([file,source])=>[file,sha(Buffer.from(source))]));sourceHashes['tests/s2a/recovery.cjs']=sha(fs.readFileSync(__filename));
  const report={tier:'T1',scope:'synthetic',entrypoint:'tests/s2a/recovery.cjs',command:'node --no-addons tests/s2a/recovery.cjs --tier T1 --scope synthetic',sourceCommit:readHead(),sourceHashes,graph,expectedImportDenials:denials,
    environment:{node:process.version,platform:process.platform,noAddons:true},limits:{totalMs:15000,caseMs:1000,maxCases:40},results,
    actualScope:'Production recovery implementation with deterministic in-memory adapter. No real library filesystem/codec/app/native execution.',residual:['Physical filesystem and Windows crash/ACL/aliases are not certified by these model tests.','Native absence is derived from closed imports/no-addons, not OS instrumentation.','Automatic promotion/restore and power-loss durability remain outside this slice.']};
  function save(exitCode){
    report.pass=results.filter(item=>item.status==='PASS').length;report.fail=results.filter(item=>item.status==='FAIL').length;report.exitCode=exitCode;
    const canonicalRoot=fs.realpathSync(root);for(const relative of ['qa',path.join('qa','s2a')]){const target=path.join(root,relative);try{assert.equal(fs.lstatSync(target).isSymbolicLink(),false);const rest=path.relative(canonicalRoot,fs.realpathSync(target));assert.ok(rest!=='..'&&!rest.startsWith('..'+path.sep)&&!path.isAbsolute(rest));}catch(error){if(error.code!=='ENOENT')throw error;}}
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
  assert.ok(cases.length<=report.limits.maxCases);
  const deadline=setTimeout(()=>{results.push({name:'total deadline',status:'FAIL'});save(1);process.exit(1);},report.limits.totalMs);
  try{
    for(const test of cases){let timer;try{await Promise.race([Promise.resolve().then(test.run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Recovery case deadline')),report.limits.caseMs);})]);results.push({name:test.name,status:'PASS'});console.log('PASS '+test.name);}catch(error){results.push({name:test.name,status:'FAIL',error:String(error.stack||error)});console.error('FAIL '+test.name+'\n'+String(error.stack||error));}finally{clearTimeout(timer);}}
    save(results.some(item=>item.status!=='PASS')?1:0);console.log(JSON.stringify({tier:'T1',pass:report.pass,fail:report.fail,exitCode:report.exitCode,report:output}));process.exitCode=report.exitCode;
  }finally{clearTimeout(deadline);}
  function readHead(){
    const dotGit=path.join(root,'.git'),git=fs.statSync(dotGit).isFile()?path.resolve(root,fs.readFileSync(dotGit,'utf8').trim().replace(/^gitdir: /,'')):dotGit;
    const head=fs.readFileSync(path.join(git,'HEAD'),'utf8').trim();if(/^[0-9a-f]{40}$/.test(head))return head;assert.match(head,/^ref: refs\//);const ref=head.slice(5);let common=git;
    try{common=path.resolve(git,fs.readFileSync(path.join(git,'commondir'),'utf8').trim());}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const dir of [git,common])try{const value=fs.readFileSync(path.join(dir,ref),'utf8').trim();assert.match(value,/^[0-9a-f]{40}$/);return value;}catch(error){if(error.code!=='ENOENT')throw error;}
    const line=fs.readFileSync(path.join(common,'packed-refs'),'utf8').split(/\r?\n/).find(value=>value.endsWith(' '+ref));assert.ok(line);return line.slice(0,40);
  }
}
