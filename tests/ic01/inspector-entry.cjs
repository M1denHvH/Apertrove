'use strict';
// Exact trusted utilityProcess wrapper. No camera provider or SDK import exists.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),fixture=process.env.APERTROVE_IC01_FIXTURE;
if(!process.parentPort||typeof fixture!=='string'||!path.isAbsolute(fixture)||process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('IC01_INSPECTOR_ADMISSION');
if(process.versions.electron!=='45.3.2')throw Error('IC01_EXACT_ELECTRON_REQUIRED');
const fixtureRoot=fs.realpathSync(fixture),relative=path.relative(path.join(root,'qa/integration-candidate/fixtures'),fixtureRoot);
if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||fs.lstatSync(fixture).isSymbolicLink())throw Error('IC01_INSPECTOR_FIXTURE');
const guard=require('./guard.cjs').installGuard({root,fixtureRoot,mode:'inspector'});
process.parentPort.prependListener('message',event=>{const value=event?.data;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||typeof value.file!=='string')throw Error('IC01_INSPECTOR_MESSAGE');guard.checkFile(value.file);});
const post=process.parentPort.postMessage.bind(process.parentPort);
process.parentPort.postMessage=value=>post(value?.done?{...value,ic01Guard:guard.evidence()}:value);
require('../../electron/shot-inspector-worker.cjs');
