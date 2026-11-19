const ENTRIES=Object.freeze(['tests/t1/library-schema.test.cjs','tests/t1/library-bootstrap.test.cjs','tests/t1/boot-state.test.cjs','tests/t1/isolation.test.cjs']);
const MODULES=Object.freeze([...ENTRIES,'tests/t1/policy.cjs','tests/t1/fixtures.cjs','electron/library-schema.cjs','electron/library-bootstrap.cjs','electron/library-text.cjs','electron/photo-name.cjs','electron/sessions.cjs','electron/workspace-settings.cjs','electron/boot-state.js','electron/i18n/runtime.js','electron/i18n/locales/en-US.json','electron/i18n/locales/ru-RU.json']);
function denied(code){const error=Error(code);error.code=code;return error;}
function invocation(args){
  if(args[0]!=='--tier'||args[1]!=='T1'||args[2]!=='--scope'||args[3]!=='synthetic')throw denied('T1_SCOPE_DENIED');
  const files=args.slice(4);
  if(!files.length||new Set(files).size!==files.length||files.some(file=>!ENTRIES.includes(file)))throw denied('T1_ENTRYPOINT_DENIED');
  return files;
}
function syntheticPath(file){
  if(!['/synthetic/s1/library.json','/synthetic/s1/original.jpg'].includes(file))throw denied('T1_PATH_DENIED');
  return file;
}
module.exports={ENTRIES,MODULES,invocation,syntheticPath,denied};
