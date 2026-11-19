'use strict';
// Trusted IC01 composition only. Reviewed-code fence, not an OS sandbox.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const cp=require('node:child_process'),net=require('node:net'),http=require('node:http'),https=require('node:https'),tls=require('node:tls'),dns=require('node:dns');
const inside=(base,file)=>{const relative=path.relative(base,file);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
const normal=file=>path.resolve(String(file).startsWith('\\\\?\\')?String(file).slice(4):String(file)).toLowerCase();
const error=code=>Object.assign(Error(code),{code});
let installed=false;
function installGuard({root,fixtureRoot,mode}={}){
  if(installed||!['main','inspector'].includes(mode))throw error('IC01_GUARD_CONFIG');
  root=fs.realpathSync(root);fixtureRoot=fs.realpathSync(fixtureRoot);
  const fixtureBase=path.join(root,'qa/integration-candidate/fixtures');
  if(!inside(fixtureBase,fixtureRoot)||normal(fixtureRoot)===normal(fixtureBase)||fs.lstatSync(fixtureRoot).isSymbolicLink())throw error('IC01_FIXTURE_REQUIRED');
  const raw={load:Module._load,resolve:Module._resolveFilename,extension:Module._extensions['.node'],dlopen:process.dlopen};
  const allowedRead=[path.join(root,'electron'),path.join(root,'dist'),path.join(root,'assets'),path.join(root,'node_modules'),path.join(root,'tests/ic01')];
  const readFiles=new Set(['package.json','package-lock.json'].map(name=>normal(path.join(root,name))));
  const addon=path.join(root,'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node'),addonHash='971048779f9c8598df14641dfc03c625885c93f473a788e65ca2deb50d0b083e';
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(hash(addon)!==addonHash)throw error('IC01_SHARP_BYTES_CHANGED');
  const denials=[],nativeLoads=[],writes=[],faults=[],handles=new Set();
  const counters={operations:0,readBytes:0,writeBytes:0,openHandles:0,maxOpenHandles:0};
  const limits={operations:12000,fileBytes:8*1024*1024,readBytes:64*1024*1024,writeBytes:32*1024*1024,handles:32};
  let expecting=0,readFault=false,persistFault=false,exportFault=false,sharpFacade;
  const library=normal(path.join(fixtureRoot,'user-data/library.json')),exportsRoot=path.join(fixtureRoot,'exports');
  const display=value=>typeof value==='string'&&inside(root,path.resolve(value))?path.relative(root,path.resolve(value)):String(value).replace(/[\r\n]/g,' ').slice(0,120);
  function deny(kind,detail){if(denials.length<256)denials.push({kind,detail:display(detail),expected:expecting>0});throw error('IC01_GUARD_DENIED');}
  function charge(kind,file,bytes=0){
    if(!Number.isFinite(bytes)||bytes<0||bytes>limits.fileBytes||++counters.operations>limits.operations)return deny('budget',kind);
    if(kind==='read')counters.readBytes+=bytes;
    if(kind==='write'){counters.writeBytes+=bytes;if(writes.length<1024)writes.push({file:path.relative(fixtureRoot,file),bytes});}
    if(counters.readBytes>limits.readBytes||counters.writeBytes>limits.writeBytes)return deny('budget',kind);
  }
  function checked(file,write=false,metadata=false){
    if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))return deny('path','absolute string required');
    const absolute=path.resolve(file),inFixture=inside(fixtureRoot,absolute),ancestor=metadata&&[fixtureRoot,...allowedRead].some(base=>inside(absolute,base));
    if(write?!inFixture:!inFixture&&!ancestor&&!readFiles.has(normal(absolute))&&!allowedRead.some(base=>inside(base,absolute)))return deny('path',file);
    if(ancestor&&!inside(root,absolute))return absolute; // metadata only, never content
    let current=absolute;
    while(inside(root,current)){
      try{const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||!inside(root,fs.realpathSync(current)))return deny('alias',file);}
      catch(cause){if(!['ENOENT','ENOTDIR'].includes(cause.code))throw cause;}
      if(normal(current)===normal(root))break;current=path.dirname(current);
    }
    return absolute;
  }
  function input(file){const p=checked(file);if(!inside(fixtureRoot,p))return deny('fixture-input',file);const stat=fs.statSync(p);if(!stat.isFile()||stat.size>limits.fileBytes)return deny('fixture-input',file);return p;}
  function failRead(p){if(readFault&&normal(p)===library){faults.push({kind:'read',code:'EACCES'});throw error('EACCES');}}
  function beforeRead(file){const p=checked(file);failRead(p);let size=0;try{size=fs.statSync(p).size;}catch(cause){if(!['ENOENT','ENOTDIR'].includes(cause.code))throw cause;}charge('read',p,size);return p;}
  function readonly(options){if(options&&typeof options==='object'&&options.flag&&!['r','rs'].includes(options.flag))return deny('read-flags',options.flag);}
  const bytes=value=>typeof value==='string'?Buffer.byteLength(value):ArrayBuffer.isView(value)?value.byteLength:deny('write-data',typeof value);
  const promises={
    async readFile(file,options){readonly(options);return fsp.readFile(beforeRead(file),options);},
    async stat(file,...args){return fsp.stat(checked(file,false,true),...args);},
    async lstat(file,...args){return fsp.lstat(checked(file,false,true),...args);},
    async realpath(file,...args){return fsp.realpath(checked(file,false,true),...args);},
    async access(file,...args){return fsp.access(checked(file,false,true),...args);},
    async statfs(file,...args){return fsp.statfs(checked(file,false,true),...args);},
    async readdir(file,...args){return fsp.readdir(checked(file),...args);},
    async mkdir(file,...args){const p=checked(file,true);charge('write',p);return fsp.mkdir(p,...args);},
    async writeFile(file,data,...args){const p=checked(file,true);charge('write',p,bytes(data));return fsp.writeFile(p,data,...args);},
    async appendFile(file,data,...args){const p=checked(file,true);charge('write',p,bytes(data));return fsp.appendFile(p,data,...args);},
    async copyFile(from,to,...args){const a=beforeRead(from),b=checked(to,true);charge('write',b,fs.statSync(a).size);return fsp.copyFile(a,b,...args);},
    async rename(from,to){const a=checked(from,true),b=checked(to,true);charge('write',b);if(persistFault&&normal(b)===library){persistFault=false;faults.push({kind:'persist',code:'EIO'});throw error('EIO');}return fsp.rename(a,b);},
    async unlink(file){const p=checked(file,true);charge('write',p);return fsp.unlink(p);},
    async rm(file,options){const p=checked(file,true);if(normal(p)===normal(fixtureRoot)||options?.recursive)return deny('recursive-removal',file);charge('write',p);return fsp.rm(p,options);},
    async rmdir(file,options){const p=checked(file,true);if(options?.recursive)return deny('recursive-removal',file);charge('write',p);return fsp.rmdir(p,options);},
    async open(file,flags,permissions){
      const write=flags!=='r'&&flags!=='rs'&&flags!==0,p=checked(file,write);if(!write)failRead(p);
      if(handles.size>=limits.handles)return deny('handles',file);
      charge(write?'write':'read',p);const handle=await fsp.open(p,flags,permissions);handles.add(handle);counters.openHandles=handles.size;counters.maxOpenHandles=Math.max(counters.maxOpenHandles,handles.size);
      const injected=write&&flags==='wx'&&exportFault&&inside(exportsRoot,p);if(injected)exportFault=false;let closed=false;
      const own=()=>{if(closed)throw error('IC01_HANDLE_CLOSED');};
      return Object.freeze({fd:handle.fd,
        async stat(...args){own();return handle.stat(...args);},
        async read(...args){own();charge('read',p,typeof args[2]==='number'?args[2]:0);return handle.read(...args);},
        async readFile(...args){own();charge('read',p,(await handle.stat()).size);return handle.readFile(...args);},
        async writeFile(data,...args){own();if(!write)return deny('read-handle-write',p);if(injected){const part=Buffer.from(data).subarray(0,4);charge('write',p,part.length);await handle.writeFile(part);faults.push({kind:'export',code:'EIO',retained:true});throw error('EIO');}charge('write',p,bytes(data));return handle.writeFile(data,...args);},
        async sync(){own();return handle.sync();},
        async close(){own();await handle.close();closed=true;handles.delete(handle);counters.openHandles=handles.size;}
      });
    }
  };
  const promiseFacade=new Proxy(Object.freeze(promises),{get(target,key){if(key==='__esModule'||key==='then'||typeof key==='symbol')return undefined;if(Object.hasOwn(target,key))return target[key];return deny('fs-promises-api',String(key));}});
  const sync={
    constants:fs.constants,promises:promiseFacade,F_OK:fs.F_OK,R_OK:fs.R_OK,W_OK:fs.W_OK,X_OK:fs.X_OK,
    readFileSync(file,options){readonly(options);return fs.readFileSync(beforeRead(file),options);},
    existsSync(file){return fs.existsSync(checked(file,false,true));},
    statSync(file,...args){return fs.statSync(checked(file,false,true),...args);},
    lstatSync(file,...args){return fs.lstatSync(checked(file,false,true),...args);},
    realpathSync(file,...args){return fs.realpathSync(checked(file,false,true),...args);},
    accessSync(file,...args){return fs.accessSync(checked(file,false,true),...args);},
    readdirSync(file,...args){return fs.readdirSync(checked(file),...args);},
    mkdirSync(file,...args){const p=checked(file,true);charge('write',p);return fs.mkdirSync(p,...args);},
    mkdtempSync(prefix,...args){const p=checked(prefix,true);charge('write',p);return fs.mkdtempSync(p,...args);},
    writeFileSync(file,data,...args){const p=checked(file,true);charge('write',p,bytes(data));return fs.writeFileSync(p,data,...args);},
    copyFileSync(from,to,...args){const a=beforeRead(from),b=checked(to,true);charge('write',b,fs.statSync(a).size);return fs.copyFileSync(a,b,...args);},
    unlinkSync(file){const p=checked(file,true);charge('write',p);return fs.unlinkSync(p);},
    createReadStream(file,options){const p=beforeRead(file);if(options?.fd!==undefined||options?.flags&&!['r','rs'].includes(options.flags))return deny('stream-options',file);return fs.createReadStream(p,options);},
    watch(file,...args){const p=checked(file);if(!inside(fixtureRoot,p))return deny('watch',file);return fs.watch(p,...args);}
  };
  sync.realpathSync.native=sync.realpathSync;
  for(const name of ['readFile','stat','lstat','realpath','access','statfs','readdir','mkdir','writeFile','appendFile','copyFile','rename','unlink','rm','rmdir']){
    sync[name]=(...args)=>{const callback=args.pop();if(typeof callback!=='function')throw TypeError('A callback is required.');Promise.resolve().then(()=>promises[name](...args)).then(value=>callback(null,value),callback);};
  }
  const fsFacade=new Proxy(Object.freeze(sync),{get(target,key){if(key==='__esModule'||key==='then'||typeof key==='symbol')return undefined;if(Object.hasOwn(target,key))return target[key];return deny('fs-api',String(key));}});
  function wrapSharp(actual){
    if(sharpFacade)return sharpFacade;
    if(actual.versions?.sharp!=='0.35.5')return deny('sharp-version','Exact reviewed version required');
    function pipeline(instance){let proxy;
      proxy=new Proxy(instance,{get(target,key){
        if(key==='toFile')return async(file,...args)=>{const p=checked(file,true);charge('write',p);const result=await target.toFile(p,...args);const size=fs.statSync(p).size;charge('write',p,size);return result;};
        if(key==='toBuffer')return async(...args)=>{const result=await target.toBuffer(...args),buffer=Buffer.isBuffer(result)?result:result?.data;if(!Buffer.isBuffer(buffer)||buffer.length>limits.fileBytes)return deny('native-output','Buffer bound');return result;};
        const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
        return(...args)=>{if(key==='resize'){const [width,height]=args;if(typeof width==='number'&&width>4096||typeof height==='number'&&height>4096)return deny('native-dimensions','Resize bound');}const result=value.apply(target,args);if(result===target)return proxy;if(key==='clone')return pipeline(result);return result;};
      }});return proxy;
    }
    function argumentsFor(args){
      const [source,options={}]=args;
      if(typeof source==='string')input(source);
      else if(Buffer.isBuffer(source)){if(source.length>limits.fileBytes)return deny('native-input','Buffer bound');}
      else if(source?.create){const {width,height,channels}=source.create;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>1048576||!Number.isInteger(channels)||channels<1||channels>4)return deny('native-input','Create bound');}
      else return deny('native-input',typeof source);
      return [source,{...options,limitInputPixels:1048576}];
    }
    sharpFacade=new Proxy(actual,{apply(target,thisArg,args){return pipeline(Reflect.apply(target,thisArg,argumentsFor(args)));},construct(target,args){return pipeline(Reflect.construct(target,argumentsFor(args)));}});
    return sharpFacade;
  }
  function guardedParent(parent){return typeof parent?.filename==='string'&&inside(root,path.resolve(parent.filename));}
  Module._load=function(request,parent,isMain){
    const name=String(request).replace(/^node:/,''),scoped=guardedParent(parent);
    if(scoped&&(/^(?:koffi|original-fs|worker_threads|cluster)(?:\/|$)/i.test(name)||/camera-worker|sdk-environment|native-buffer|flash-bridge|flash-wia|edsdk|canon.*\.dll/i.test(name)))return deny('import',request);
    if(scoped&&(name==='fs'||name==='fs/promises'))return name==='fs'?fsFacade:promiseFacade;
    const resolved=raw.resolve.call(Module,request,parent,isMain);
    if(scoped&&typeof resolved==='string'&&path.isAbsolute(resolved)){
      if(!allowedRead.some(base=>inside(base,resolved))||!['.js','.cjs','.json','.node'].includes(path.extname(resolved)))return deny('module-source',resolved);
      checked(resolved);
    }
    const value=raw.load.apply(this,arguments);
    if(scoped&&name==='sharp')return wrapSharp(value);
    return value;
  };
  Module._extensions['.node']=function(module,file){if(normal(file)!==normal(addon))return deny('native-addon',file);return raw.extension(module,file);};
  process.dlopen=function(module,file,...args){if(normal(file)!==normal(addon)||hash(addon)!==addonHash)return deny('dlopen',file);if(nativeLoads.length>=1)return deny('dlopen','Only one actual addon load per process');nativeLoads.push({file:path.relative(root,addon),sha256:addonHash});return raw.dlopen.call(this,module,file,...args);};
  for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=()=>deny('child-process',name);
  net.Socket.prototype.connect=()=>deny('network','socket');net.Server.prototype.listen=()=>deny('network','listen');
  for(const name of ['connect','createConnection'])net[name]=()=>deny('network',name);
  tls.connect=()=>deny('network','tls');
  for(const value of [http,https])for(const name of ['request','get'])value[name]=()=>deny('network',name);
  for(const name of ['lookup','resolve','resolve4','resolve6','resolveAny','reverse']){dns[name]=()=>deny('network','dns '+name);if(dns.promises?.[name])dns.promises[name]=async()=>deny('network','dns-promise '+name);}
  globalThis.fetch=async()=>deny('network','fetch');
  for(const key of Object.keys(process.env))if(/^(?:VIPS_|GIO_|MAGICK_|DYLD_|FONTCONFIG_)|^(?:GI_TYPELIB_PATH|LD_PRELOAD|GDK_PIXBUF_MODULEDIR|GDK_PIXBUF_MODULE_FILE)$/i.test(key))delete process.env[key];
  const plugins=path.join(fixtureRoot,'native-empty-plugins');fs.mkdirSync(plugins,{recursive:true});
  process.env.SHARP_IGNORE_GLOBAL_LIBVIPS='1';for(const key of ['VIPS_PLUGIN_PATH','GIO_MODULE_DIR','GIO_EXTRA_MODULES'])process.env[key]=plugins;
  installed=true;
  function expect(fn){
    const before=denials.length;expecting++;
    try{const value=fn();if(value&&typeof value.then==='function')return Promise.resolve(value).then(()=>{throw error('IC01_EXPECTED_DENIAL_MISSING');},cause=>{if(cause.code!=='IC01_GUARD_DENIED'||denials.length<=before)throw cause;return denials.at(-1);}).finally(()=>{expecting--;});}
    catch(cause){expecting--;if(cause.code!=='IC01_GUARD_DENIED'||denials.length<=before)throw cause;return denials.at(-1);}
    expecting--;throw error('IC01_EXPECTED_DENIAL_MISSING');
  }
  return Object.freeze({
    checkFile:input,expect,
    fault(name){if(name==='read')readFault=true;else if(name==='read-clear')readFault=false;else if(name==='persist')persistFault=true;else if(name==='export')exportFault=true;else throw error('IC01_FAULT_UNKNOWN');},
    evidence(){const expected=denials.filter(item=>item.expected),unexpected=denials.filter(item=>!item.expected);return JSON.parse(JSON.stringify({mode,expectedDenials:expected,unexpectedDenials:unexpected,expected,unexpected,nativeLoads,writes,faults,fs:{...counters},limits,limitation:'Reviewed JS/native input-output fence; Electron and Windows native internals are not an OS sandbox'}));}
  });
}
module.exports={installGuard};
