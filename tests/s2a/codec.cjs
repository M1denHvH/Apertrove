'use strict';
// Named T2 native-codec admission. Never import Electron/main/Canon or user photos.
if(require.main!==module||process.argv.slice(2).join('\n')!=='--tier\nT2\n--scope\nsynthetic\n--allow-native-sharp'||process.execArgv.includes('--no-addons')||process.env.NODE_OPTIONS||process.env.NODE_PATH||!/^[0-9a-f]{40}$/i.test(process.env.APERTROVE_SOURCE_COMMIT||'')){
  console.error('S2A_CODEC_ADMISSION_REFUSED');process.exitCode=2;
}else main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

async function main(){
  const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),assert=require('node:assert/strict'),child=require('node:child_process');
  const {createFSGuard,prepareFixture,inside,sha}=require('./fs-guard.cjs');
  assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');
  assert.ok(process.execArgv.some(arg=>/^--max-old-space-size=(192|256)$/.test(arg)),'Explicit reviewed JS heap bound required');
  assert.ok(process.execArgv.every(arg=>/^--max-old-space-size=(192|256)$/.test(arg)),'Unreviewed Node flag');
  assert.deepEqual(Object.keys(require.cache).sort(),[__filename,path.join(__dirname,'fs-guard.cjs')].sort(),'No app or addon may load before admission');
  const root=path.resolve(__dirname,'../..'),fixture=prepareFixture(root,'codec-'),qa=path.join(root,'qa','s2a'),started=Date.now();
  const raw={readFileSync:fs.readFileSync,writeFileSync:fs.writeFileSync,lstatSync:fs.lstatSync,realpathSync:fs.realpathSync,existsSync:fs.existsSync,load:Module._load,resolve:Module._resolveFilename,extension:Module._extensions['.node'],dlopen:process.dlopen};
  for(const key of Object.keys(process.env))if(/^sharp_|^npm_config_|^npm_package_config_libvips$/i.test(key))delete process.env[key];
  process.env.SHARP_IGNORE_GLOBAL_LIBVIPS='1';
  for(const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME']){const dir=path.join(fixture,'environment',key);fs.mkdirSync(dir,{recursive:true});process.env[key]=dir;}
  const evidence={unexpected:[],expected:[],graph:[],missingNativeProbes:[],nativeLoads:[],nativeAssets:{},sourceHashes:{},checks:[],memory:[]};
  let expected=false,guard,finished=false,peakRSS=process.memoryUsage().rss,peakHeap=process.memoryUsage().heapUsed;
  const counters={constructors:0,toBuffer:0,metadata:0,derivedWrites:0};
  // Node's Windows addon extension may pass the same exact file via \\?\ form.
  const ordinary=file=>String(file).startsWith('\\\\?\\')?String(file).slice(4):String(file);
  const normal=file=>path.resolve(ordinary(file)).toLowerCase();
  function denied(kind,detail){const item={kind,detail:String(detail),expected};(expected?evidence.expected:evidence.unexpected).push(item);const e=Error('S2A_CODEC_DENIED: '+kind);e.code='S2A_CODEC_DENIED';throw e;}
  function probe(action){const before=evidence.expected.length;expected=true;try{assert.throws(action,e=>e.code==='S2A_CODEC_DENIED');assert.equal(evidence.expected.length,before+1);}finally{expected=false;}}
  const addon=path.join(root,'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node');
  for(const key of Object.keys(process.env))if(/^(?:VIPS_|GIO_|MAGICK_|DYLD_|FONTCONFIG_)|^(?:GI_TYPELIB_PATH|LD_PRELOAD|GDK_PIXBUF_MODULEDIR|GDK_PIXBUF_MODULE_FILE)$/i.test(key))delete process.env[key];
  const pluginRoot=path.join(fixture,'environment','empty-native-plugins');fs.mkdirSync(pluginRoot,{recursive:true});
  for(const key of ['VIPS_PLUGIN_PATH','GIO_MODULE_DIR','GIO_EXTRA_MODULES'])process.env[key]=pluginRoot;
  const systemRoot=process.env.SystemRoot||process.env.SYSTEMROOT||'C:\\Windows';
  process.env.PATH=[path.dirname(addon),path.join(systemRoot,'System32'),systemRoot].join(path.delimiter);
  evidence.nativeEnvironment={SHARP_IGNORE_GLOBAL_LIBVIPS:'1',VIPS_PLUGIN_PATH:pluginRoot,GIO_MODULE_DIR:pluginRoot,GIO_EXTRA_MODULES:pluginRoot,PATH:process.env.PATH};
  const nativeAssets=[addon,path.join(root,'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll'),path.join(root,'node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.7.dll')];
  for(const file of nativeAssets){assert.ok(fs.statSync(file).isFile());evidence.nativeAssets[path.relative(root,file)]={bytes:fs.statSync(file).size,sha256:sha(fs.readFileSync(file))};}
  const sharpParent=path.join(root,'node_modules/sharp/dist/sharp.cjs');
  const absent=new Set(['sharp-win32-x64-0.35.5.node','sharp-wasm32-0.35.5.node'].map(file=>normal(path.join(root,'node_modules/sharp/src/build/Release',file))));
  for(const file of absent)assert.equal(raw.existsSync(file),false,'Unexpected local native build requires a fresh review');
  function filesBelow(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{assert.equal(entry.isSymbolicLink(),false);const file=path.join(folder,entry.name);return entry.isDirectory()?filesBelow(file):/\.(?:cjs|js|json)$/.test(entry.name)?[file]:[];});}
  const packages=[path.join(root,'node_modules/sharp/dist'),path.join(root,'node_modules/sharp/node_modules/semver'),path.join(root,'node_modules/detect-libc/lib'),path.join(root,'node_modules/@img/colour')];
  const reviewed=[...packages.flatMap(filesBelow),path.join(root,'node_modules/sharp/package.json'),path.join(root,'node_modules/detect-libc/package.json'),path.join(root,'node_modules/@img/sharp-win32-x64/index.cjs'),path.join(root,'node_modules/@img/sharp-win32-x64/package.json'),path.join(root,'node_modules/@img/sharp-win32-x64/versions.json'),path.join(root,'node_modules/exifr/dist/full.umd.js'),path.join(root,'node_modules/exifr/package.json')].filter(file=>!/[\\/]bin[\\/]/.test(file));
  const allowed=new Set(reviewed.map(normal));allowed.add(normal(addon));
  for(const file of reviewed)evidence.sourceHashes[path.relative(root,file).split(path.sep).join('/')]=sha(raw.readFileSync(file));
  const core=new Set(['path','util','stream','events','buffer','os','crypto','url','zlib','fs','fs/promises','child_process']);
  const deniedChild=()=>denied('subprocess','all subprocess methods refused');
  for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[method]=deniedChild;
  global.fetch=()=>denied('network','fetch');
  const safeInput=file=>{
    if(typeof file!=='string'||!path.isAbsolute(file)||!inside(fixture,path.resolve(file)))return denied('native-input',String(file));
    const real=raw.realpathSync(file);if(!inside(fixture,real))return denied('native-input-alias',file);
    const stat=fs.statSync(real);if(!stat.isFile()||stat.size>1024*1024)return denied('native-input-size',file);
    return real;
  };
  const readable=file=>{if(typeof file!=='string')return denied('read-path',String(file));const p=path.resolve(file);if(allowed.has(normal(p)))return p;return safeInput(p);};
  // Native dependency definitions may import fs, but only reviewed reads exist.
  // Exifr receives generated image buffers below, never a free path/network port.
  const readOnlyFS=new Proxy({
    readFileSync:(file,...args)=>raw.readFileSync(readable(file),...args),
    existsSync:file=>{const p=readable(file);return raw.existsSync(p);},
    statSync:file=>fs.statSync(readable(file)),lstatSync:file=>raw.lstatSync(readable(file)),realpathSync:file=>raw.realpathSync(readable(file)),
    promises:Object.freeze({readFile:(file,...args)=>fsp.readFile(readable(file),...args)})
  },{get(target,key){if(Object.hasOwn(target,key))return target[key];return denied('native-fs-api',String(key));}});
  Module._load=function(request,parent,isMain){
    const name=String(request).replace(/^node:/,'');
    if(/^(?:electron|koffi|worker_threads|cluster|net|tls|http|https|dns|dgram)(?:\/|$)/.test(name))return denied('import',name);
    if(Module.builtinModules.includes(name)||Module.builtinModules.includes('node:'+name)){
      if(!core.has(name))return denied('core-import',name);
      evidence.graph.push({from:parent?.filename?path.relative(root,parent.filename):'<entry>',to:'node:'+name});
      if(name==='fs')return readOnlyFS;if(name==='fs/promises')return readOnlyFS.promises;
      return raw.load.apply(this,arguments);
    }
    let resolved;
    if(parent?.filename&&normal(parent.filename)===normal(sharpParent)&&request.startsWith('../src/build/Release/')){
      const expectedPath=normal(path.resolve(path.dirname(parent.filename),request));
      if(absent.has(expectedPath)){evidence.missingNativeProbes.push(path.relative(root,expectedPath));const e=Error('Reviewed absent optional local build');e.code='MODULE_NOT_FOUND';throw e;}
    }
    try{resolved=raw.resolve.call(Module,request,parent,isMain);}catch(error){return denied('unreviewed-resolution',String(request));}
    if(!allowed.has(normal(resolved)))return denied('source-import',resolved);
    evidence.graph.push({from:parent?.filename?path.relative(root,parent.filename):'<entry>',to:path.relative(root,resolved)});
    return raw.load.apply(this,arguments);
  };
  Module._extensions['.node']=function(module,file){if(normal(file)!==normal(addon))return denied('native-addon',file);return raw.extension(module,file);};
  process.dlopen=function(module,file,...args){
    if(normal(file)!==normal(addon)||evidence.nativeLoads.length!==0)return denied('dlopen',file);
    for(const asset of nativeAssets)assert.equal(sha(raw.readFileSync(asset)),evidence.nativeAssets[path.relative(root,asset)].sha256,'Native asset changed after preflight');
    evidence.nativeLoads.push(path.relative(root,ordinary(file)));return raw.dlopen.call(this,module,file,...args);
  };
  probe(()=>require('koffi'));probe(()=>require('electron'));probe(()=>require('node:worker_threads'));probe(()=>require('node:http'));probe(()=>child.execFile('powershell.exe',[]));probe(()=>process.dlopen({},path.join(fixture,'forbidden.node')));probe(()=>readOnlyFS.readFileSync(path.join(root,'package.json')));
  assert.equal(evidence.unexpected.length,0);
  const remaining=30000-(Date.now()-started);assert.ok(remaining>0,'Native preflight exceeded total wall budget');
  const hard=setTimeout(()=>{if(finished)return;evidence.checks.push({name:'hard deadline',status:'FAIL',error:'30s exceeded'});try{save(1);}finally{process.exit(1);}},Math.max(1,remaining));
  const memory=setInterval(()=>{const m=process.memoryUsage();peakRSS=Math.max(peakRSS,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);if(m.rss>512*1024*1024){evidence.checks.push({name:'RSS cap',status:'FAIL',bytes:m.rss});try{save(1);}finally{process.exit(1);}}},50);
  const paths={originals:path.join(fixture,'originals'),outputs:path.join(fixture,'exports'),data:path.join(fixture,'userData'),cache:path.join(fixture,'cache')};
  for(const dir of Object.values(paths))fs.mkdirSync(dir);
  const originalHashes={};let producerBoundary;
  function assertBounds(bytes){const buffer=Buffer.isBuffer(bytes)?bytes:bytes?.data;assert.ok(Buffer.isBuffer(buffer)&&buffer.length>0&&buffer.length<=1024*1024,'Native output buffer limit');return bytes;}
  try{
    const actualSharp=require('sharp'),actualExif=require('exifr');
    assert.equal(evidence.unexpected.length,0,'No caught forbidden import may precede codec work');
    assert.equal(actualSharp.versions.sharp,'0.35.5');actualSharp.cache(false);actualSharp.concurrency(1);
    const generated=new Set();
    function nativeSharp(input,options={}){
      counters.constructors++;
      if(typeof input==='string'){const real=safeInput(input);if(!generated.has(normal(real)))return denied('unregistered-native-fixture',real);input=raw.readFileSync(real);}
      else if(Buffer.isBuffer(input)){assert.ok(input.length<=1024*1024);}
      else if(input&&input.create){assert.ok(input.create.width<=32&&input.create.height<=24&&input.create.channels<=4);}
      else return denied('native-input-kind',typeof input);
      const instance=actualSharp(input,{...options,limitInputPixels:4096});
      const proxy=new Proxy(instance,{get(target,key){
        if(key==='toBuffer')return async(...args)=>{counters.toBuffer++;return assertBounds(await target.toBuffer(...args));};
        if(key==='metadata')return async(...args)=>{counters.metadata++;const info=await target.metadata(...args);assert.ok(info.width<=32&&info.height<=24);return info;};
        if(key==='toFile')return async output=>{
          if(typeof output!=='string'||!inside(paths.cache,path.resolve(output))||!/^[a-f0-9]{24}-(?:thumb|preview|edit-[a-f0-9]{40})\.jpg$/i.test(path.basename(output)))return denied('native-output-path',String(output));
          const result=assertBounds(await target.toBuffer({resolveWithObject:true}));await guard.fs.writeFile(output,result.data);counters.derivedWrites++;return result.info;
        };
        const v=Reflect.get(target,key,target);if(typeof v!=='function')return v;
        return(...args)=>{if(key==='resize'){const [w,h]=args;if(typeof w==='number')assert.ok(w<=2400);if(typeof h==='number')assert.ok(h<=1800);}const result=v.apply(target,args);return result===target?proxy:result;};
      }});return proxy;
    }
    const exifPort={parse:async(file,options)=>actualExif.parse(Buffer.isBuffer(file)?file:raw.readFileSync(safeInput(file)),options),thumbnail:async file=>actualExif.thumbnail(raw.readFileSync(safeInput(file)))};
    guard=createFSGuard({repoRoot:root,fixtureRoot:fixture,ports:{sharp:nativeSharp,exifr:exifPort}});
    for(const name of ['electron','koffi','node:child_process','node:worker_threads','../../electron/camera-worker.cjs'])guard.probeImport(name);
    guard.probePath(path.join(root,'package.json'),'readFile');guard.probePath(path.join(root,'outside-output.jpg'),'open');guard.check();
    const L=guard.load('electron/library.cjs'),{readMetadata}=guard.load('electron/metadata.cjs');
    const {createProtectedExport}=guard.load('electron/protected-export.cjs'),{createExportService}=guard.load('electron/export-service.cjs'),{createLibraryRecovery}=guard.load('electron/library-recovery.cjs');
    const photos=[];for(let i=0;i<2;i++){
      const pixels=Buffer.alloc(32*24*3);for(let p=0;p<pixels.length;p++)pixels[p]=(p*7+i*53)%256;
      const bytes=await actualSharp(pixels,{raw:{width:32,height:24,channels:3},limitInputPixels:4096}).jpeg({quality:90}).toBuffer();assertBounds(bytes);assert.deepEqual(jpegDimensions(bytes),{width:32,height:24});
      const file=path.join(paths.originals,i?'B.jpg':'A.jpg');fs.writeFileSync(file,bytes,{flag:'wx'});generated.add(normal(file));originalHashes[file]=sha(bytes);photos.push({id:String(i),path:file,name:path.basename(file),edits:{exposure:.2,contrast:4,saturation:0,warmth:0,rotation:0,monochrome:false}});
    }
    const storeFile=path.join(paths.data,'library.json');fs.writeFileSync(storeFile,JSON.stringify({version:2,photos:[],settings:{},sessions:[],presets:[]}));const storeHash=sha(raw.readFileSync(storeFile));
    const registry=()=>({files:[...photos.map(p=>p.path),storeFile],directories:[paths.data]});let destination,cancel=false,successes=0,photo=photos[0];
    const exporter=createProtectedExport({getRegistry:registry,fs:guard.fs});
    const api=createExportService({exporter,showSaveDialog:async()=>cancel?{canceled:true}:{filePath:destination},getPhoto:()=>photo,getPresets:()=>[{id:'synthetic-preset',name:'S2A',values:{iso:72}}],readMetadata,renderEditedBuffer:L.renderEditedBuffer,cleanEdits:e=>e,t:(k,args)=>k+(args?.path?':'+args.path:''),onPhotoExport:()=>{successes++;}});
    async function check(name,run){const at=Date.now();await run();guard.check();assert.equal(evidence.unexpected.length,0);for(const [file,digest]of Object.entries(originalHashes))assert.equal(sha(raw.readFileSync(file)),digest);assert.equal(sha(raw.readFileSync(storeFile)),storeHash);const m=process.memoryUsage();assert.ok(m.rss<=512*1024*1024);evidence.checks.push({name,status:'PASS',elapsedMs:Date.now()-at});}
    await check('generated JPEG originals have independent SOF32x24 and actual native decode',async()=>{for(const p of photos){const info=await nativeSharp(p.path).metadata();assert.equal(info.format,'jpeg');assert.equal(info.width,32);assert.equal(info.height,24);}});
    await check('actual JPEG export route writes valid NEW output through held handle',async()=>{
      destination=path.join(paths.outputs,'edited.jpg');assert.equal(await api.exportPhoto({id:'0'}),destination);const bytes=raw.readFileSync(destination);assertBounds(bytes);assert.deepEqual(jpegDimensions(bytes),{width:32,height:24});const info=await actualSharp(bytes,{limitInputPixels:4096}).metadata();assert.equal(info.format,'jpeg');assert.equal(info.width,32);assert.equal(successes,1);
      assert.notEqual(sha(bytes),originalHashes[photo.path],'Export must not silently return original encoded bytes');
      const before=assertBounds(await actualSharp(raw.readFileSync(photo.path),{limitInputPixels:4096}).removeAlpha().raw().toBuffer());
      const after=assertBounds(await actualSharp(bytes,{limitInputPixels:4096}).removeAlpha().raw().toBuffer());
      const mean=b=>b.reduce((sum,v)=>sum+v,0)/b.length;counters.jpegMeanDelta=mean(after)-mean(before);assert.ok(counters.jpegMeanDelta>1,'Positive exposure edit must change decoded pixel brightness');
    });
    await check('actual metadata export writes parsed original facts into NEW JSON',async()=>{
      destination=path.join(paths.outputs,'metadata.json');await api.exportMetadata({id:'0'});const result=JSON.parse(raw.readFileSync(destination,'utf8'));assert.equal(result.file.name,'A.jpg');assert.equal(result.file.width,32);assert.equal(result.file.height,24);assert.equal(result.file.bytes,fs.statSync(photo.path).size);assert.equal(typeof result.metadata,'object');
    });
    await check('actual presets export writes usable NEW version1 JSON',async()=>{
      destination=path.join(paths.outputs,'presets.json');await api.exportPresets();const result=JSON.parse(raw.readFileSync(destination,'utf8'));assert.equal(result.version,1);assert.equal(result.presets[0].values.iso,72);
    });
    await check('each actual route cancellation performs no codec work or output',async()=>{
      const before={...counters},files=fs.readdirSync(paths.outputs);cancel=true;for(const name of ['exportPhoto','exportMetadata','exportPresets'])assert.equal(await api[name]({id:'0'}),null);cancel=false;assert.deepEqual(counters,before);assert.deepEqual(fs.readdirSync(paths.outputs),files);
    });
    await check('all actual routes reject current/other originals/store before native producer',async()=>{
      const before={...counters};for(const name of ['exportPhoto','exportMetadata','exportPresets'])for(const file of [...photos.map(p=>p.path),storeFile]){destination=file;await assert.rejects(api[name]({id:'0'}),e=>e.code==='EXPORT_PROTECTED');}assert.deepEqual(counters,before);
    });
    await check('actual codec rejection creates no export success or output',async()=>{
      const bad=path.join(paths.originals,'broken.jpg');fs.writeFileSync(bad,'GENERATED_INVALID_IMAGE');generated.add(normal(bad));photo={...photos[0],path:bad};destination=path.join(paths.outputs,'decode-failure.jpg');const count=successes;
      await assert.rejects(api.exportPhoto({id:'0'}));assert.equal(fs.existsSync(destination),false);assert.equal(successes,count);photo=photos[0];
    });
    await check('real JPEG bytes followed by actual partial write never report success',async()=>{
      const output=path.join(paths.outputs,'partial.jpg'),port={...guard.fs,async open(file,flags){const h=await guard.fs.open(file,flags);return {...h,async writeFile(bytes){await h.writeFile(bytes.subarray(0,4));throw Object.assign(Error('controlled partial write'),{code:'EIO'});}};}};
      const writer=createProtectedExport({getRegistry:registry,fs:port});let notify=0;const routes=createExportService({exporter:writer,showSaveDialog:async()=>({filePath:output}),getPhoto:()=>photos[0],renderEditedBuffer:L.renderEditedBuffer,cleanEdits:e=>e,t:k=>k,onPhotoExport:()=>{notify++;}});
      await assert.rejects(routes.exportPhoto({id:'0'}),e=>e.outputRetained===true);assert.equal(fs.statSync(output).size,4);assert.equal(notify,0);assert.equal(guard.evidence().counters.openHandles,0);
    });
    await check('actual synthetic Sharp buildPhoto cache/metadata record commits to real library',async()=>{
      const file=path.join(paths.data,'import-library.json'),recovery=createLibraryRecovery({fs:guard.fs}),{createLibraryCommitter}=guard.load('electron/library-commits.cjs');let state={version:2,photos:[],settings:{},sessions:[],presets:[]};
      const commits=createLibraryCommitter({getStore:()=>state,isReady:()=>true,writeSnapshot:v=>recovery.writeLibraryGeneration(file,v)});const record=await L.buildPhoto(photos[1].path,paths.cache);
      assert.equal(record.metadata.width,32);assert.equal(record.metadata.height,24);assert.equal(record.previewError,null);assert.ok(fs.statSync(record.thumbPath).size>0);assert.ok(fs.statSync(record.previewPath).size>0);
      const result=await commits.registerPhoto({...record,fingerprint:originalHashes[photos[1].path]},{cameraTransfer:false});assert.equal(result.added,true);assert.equal(JSON.parse(raw.readFileSync(file,'utf8')).photos.length,1);assert.equal(state.photos.length,1);
    });
    await check('actual malformed synthetic image preserves preview/metadata warning registration contract',async()=>{
      const input=path.join(paths.originals,'broken.jpg'),before=sha(raw.readFileSync(input)),file=path.join(paths.data,'warning-library.json');
      const record=await L.buildPhoto(input,paths.cache);assert.equal(record.path,input);assert.equal(typeof record.previewError,'string');assert.ok(record.previewError.length>0);assert.equal(record.previewPath,null);
      const metadata=await readMetadata(input);assert.ok(metadata.errors.length>0);assert.equal(metadata.file.bytes,fs.statSync(input).size);
      const recovery=createLibraryRecovery({fs:guard.fs}),{createLibraryCommitter}=guard.load('electron/library-commits.cjs');const state={version:2,photos:[],settings:{},sessions:[],presets:[]};
      const commits=createLibraryCommitter({getStore:()=>state,isReady:()=>true,writeSnapshot:v=>recovery.writeLibraryGeneration(file,v)});
      assert.equal((await commits.registerPhoto({...record,fingerprint:before})).added,true);assert.equal(JSON.parse(raw.readFileSync(file,'utf8')).photos[0].previewError,record.previewError);assert.equal(sha(raw.readFileSync(input)),before);
    });
    assert.equal(evidence.nativeLoads.length,1);assert.equal(evidence.missingNativeProbes.length,2);assert.equal(evidence.unexpected.length,0);guard.check();await guard.cleanup();
    producerBoundary={input:'Generated fixture paths preloaded to bounded Buffer before native C++; exifr actual parser on same bytes.',derivedOutput:'Actual Sharp toBuffer plus guarded filesystem write for cache-only filenames; no native free-path output.',exportOutput:'Actual L.renderEditedBuffer native codec → protected-export wx held handle.'};
    assert.ok(Date.now()-started<=30000,'Total native suite wall budget exceeded');finished=true;save(0);console.log(JSON.stringify({tier:'T2',native:'Sharp0.35.5 only',pass:evidence.checks.length,exitCode:0,report:'qa/s2a/codec-results.json'}));
  }catch(error){evidence.checks.push({name:'native suite failure',status:'FAIL',error:String(error.stack||error)});if(guard)try{await guard.cleanup();}catch(closeError){evidence.checks.push({name:'handle cleanup',status:'FAIL',error:String(closeError)});}finished=true;save(1);throw error;}
  finally{clearTimeout(hard);clearInterval(memory);}

  function save(exitCode){
    const usage=process.memoryUsage();peakRSS=Math.max(peakRSS,usage.rss);peakHeap=Math.max(peakHeap,usage.heapUsed);
    const sourceHashes={...evidence.sourceHashes,...(guard?guard.evidence().sourceHashes:{}),'tests/s2a/codec.cjs':sha(raw.readFileSync(__filename)),'tests/s2a/fs-guard.cjs':sha(raw.readFileSync(path.join(__dirname,'fs-guard.cjs')))};
    const report={tier:'T2',scope:'synthetic',sourceCommit:process.env.APERTROVE_SOURCE_COMMIT,sourceCommitProvenance:'launcher-provided validated40hex; root final manifest independently verifies committed bytes',environment:{node:process.version,platform:process.platform,arch:process.arch,execArgv:[...process.execArgv]},command:'node --max-old-space-size=192 tests/s2a/codec.cjs --tier T2 --scope synthetic --allow-native-sharp',fixtureRoot:fixture,exitCode,elapsedMs:Date.now()-started,
      pass:evidence.checks.filter(c=>c.status==='PASS').length,fail:evidence.checks.filter(c=>c.status==='FAIL').length,checks:evidence.checks,admission:{expected:evidence.expected,unexpected:evidence.unexpected,missingNativeProbes:evidence.missingNativeProbes,nativeLoads:evidence.nativeLoads},nativeEnvironment:evidence.nativeEnvironment,nativeAssets:evidence.nativeAssets,graph:evidence.graph,sourceHashes,
      memory:{peakRSS,peakHeap,final:usage,resourceUsage:process.resourceUsage(),sampleIntervalMs:50,maxRSSBytes:512*1024*1024,maxHeapMiB:192},limits:{wallMs:30000,inputDimensions:'32x24 RGB',inputOutputBytes:1024*1024,concurrency:1,cache:false},counters,producerBoundary,
      originalsBefore:originalHashes,originalsAfter:Object.fromEntries(Object.keys(originalHashes).map(file=>[file,sha(raw.readFileSync(file))])),guard:guard?.evidence(),cleanup:{openHandles:guard?.evidence().counters.openHandles??0,fixturesRetained:true},
      limitations:['Only reviewed installed Sharp addon and bundled libvips plus ordinary OS loader dependencies; no independent OS tracing. Native C++ LoadLibrary cannot be intercepted by the JS sentinel; plugin and PATH environment are constrained.','Code-level loader/filesystem sentinels are not an OS sandbox. Native input is generated and bounded, never user files. JS timers cannot preempt a synchronous native hang.','Fault injection is scoped synthetic I/O, not Windows ACL/power-loss/hostile-concurrency certification.']};
    raw.writeFileSync(path.join(qa,'codec-results.json'),JSON.stringify(report,null,2)+'\n');
  }
}

function jpegDimensions(buffer){
  if(buffer.length<4||buffer[0]!==255||buffer[1]!==216||buffer[buffer.length-2]!==255||buffer[buffer.length-1]!==217)throw Error('Invalid JPEG markers');
  let offset=2;
  while(offset+4<=buffer.length){if(buffer[offset++]!==255)throw Error('Invalid JPEG marker offset');while(buffer[offset]===255)offset++;const marker=buffer[offset++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;const length=buffer.readUInt16BE(offset);if(length<2||offset+length>buffer.length)throw Error('Invalid JPEG segment length');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw Error('Truncated JPEG SOF');return {height:buffer.readUInt16BE(offset+3),width:buffer.readUInt16BE(offset+5)};}offset+=length;}
  throw Error('JPEG SOF dimensions not found');
}
