const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const ROOT_FILES=['package.json','package-lock.json','vite.config.js','vite.config.mjs','index.html','shot-inspector.html','README.md','README.ru.md','LICENSE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes'];
const DIRECTORIES=['src','electron','assets','public','tests','scripts','docs','.github'];
const EXTENSIONS=new Set(['.js','.jsx','.cjs','.mjs','.css','.html','.json','.md','.svg','.png','.ico','.ps1','.yml','.yaml']);
function sourceFiles(root=ROOT){
  const files=ROOT_FILES.filter(file=>fs.existsSync(path.join(root,file)));
  function walk(directory){
    for(const item of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){
      const relative=`${directory}/${item.name}`;
      if(item.isSymbolicLink())throw Error(`Symlink is not exportable: ${relative}`);
      if(item.isDirectory()){if(!['node_modules','dist','release','qa','artifacts','sdk','vendor','captures','previews'].includes(item.name)&&!item.name.endsWith('-profile'))walk(relative);}
      else if(relative==='assets/THIRD_PARTY_LICENSES.txt'||/^assets\/licenses\/(?:LGPL|GPL)-3\.0\.txt$/.test(relative)||EXTENSIONS.has(path.extname(item.name).toLowerCase()))files.push(relative);
    }
  }
  for(const directory of DIRECTORIES)if(fs.existsSync(path.join(root,directory)))walk(directory);
  return files.sort();
}
module.exports={ROOT,sourceFiles};
