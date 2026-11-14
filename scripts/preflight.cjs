const fs=require('node:fs');
const path=require('node:path');
const {ROOT,sourceFiles}=require('./source-files.cjs');
function preflight(){
  const files=sourceFiles(),issues=[];
  for(const file of files){
    if(/(?:EDSDK|EdsImage)\.(?:dll|lib|h)$/i.test(file)||/(?:^|\/)library\.json$/i.test(file))issues.push(`${file}: proprietary SDK or personal library`);
    const bytes=fs.readFileSync(path.join(ROOT,file));if(bytes.length>10*1024*1024)issues.push(`${file}: unexpectedly large source file`);
    if(/\.(?:png|ico)$/i.test(file))continue;
    const text=bytes.toString('utf8');
    if(/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))issues.push(`${file}: possible credential`);
    if(/C:[\\/]Users[\\/][^\\/\s<]+/i.test(text))issues.push(`${file}: personal absolute Windows path`);
    if(text.includes('\uFFFD'))issues.push(`${file}: invalid UTF-8/replacement character`);
  }
  const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(ROOT,'package-lock.json')));
  if(pkg.version!==lock.version||pkg.name!==lock.name)issues.push('Package and lock metadata differ');
  for(const required of ['README.md','README.ru.md','LICENSE','SECURITY.md','docs/INSTALLATION.md','docs/USER_GUIDE.md','docs/REQUIREMENTS.md','docs/TROUBLESHOOTING.md','docs/RELEASE_NOTES.md','docs/PRIVACY.md','docs/screenshots/workspace.png','docs/screenshots/sessions.png','docs/screenshots/lighting.png'])if(!files.includes(required))issues.push(`Missing ${required}`);
  if(issues.length)throw Error(issues.join('\n'));
  return files;
}
if(require.main===module){try{const files=preflight();console.log(`PASS: ${files.length} allowlisted public files; no known credential patterns, personal paths or SDK binaries. Review screenshots and text before publication.`);if(process.argv.includes('--list'))console.log(files.join('\n'));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={preflight};
