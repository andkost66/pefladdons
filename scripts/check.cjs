const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../CrabVIP');
for(const name of ['crab.js',...fs.readdirSync(path.join(root,'js')).filter(x=>x.endsWith('.js')).map(x=>'js/'+x)])execFileSync(process.execPath,['--check',path.join(root,name)],{stdio:'pipe'});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
for(const name of [...manifest.content_scripts.flatMap(x=>x.js),...manifest.web_accessible_resources.flatMap(x=>x.resources)])if(!name.includes('*')&&!fs.existsSync(path.join(root,name)))throw Error('Missing '+name);
console.log('All JavaScript syntax and manifest resource paths passed');
