// Isolated headless audit harness. OFFLINE=1 serves repository files by route fulfillment.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const pw = require(process.env.PW || 'playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'qa/audit-results'));
fs.mkdirSync(path.join(OUT, 'screenshots'), {recursive:true});
const DEMO = fs.readFileSync(path.join(ROOT, 'scripts/_harness.mjs'), 'utf8').match(/HIS\.auth\.attempt\('superadmin@mediheal\.test', '([^']+)'/)[1];
const ROLES = {superadmin:'superadmin',registration:'reception',doctor:'doctor',nurse:'nurse',pharmacist:'pharmacy',lab:'laboratory',finance:'finance',hr:'hr',accounting:'accounting',depthead:'department.head',auditor:'auditor',patient:'patient'};
async function boot() {
  const server = http.createServer((req,res)=>{
    let rel; try {rel=decodeURIComponent(req.url.split('?')[0]);}catch{res.writeHead(400).end();return;}
    const file=path.resolve(ROOT,'.'+(rel==='/'?'/index.html':rel));
    if(!file.startsWith(path.resolve(ROOT)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await pw.chromium.launch({channel:'chrome',headless:true});
  console.log(JSON.stringify({pid:process.pid,port:server.address().port,browser:browser.version(),target:base}));
  return {browser,server,base,async close(){await browser.close();await new Promise(r=>server.close(r));}};
}
async function context(browser,viewport={width:1440,height:1024}){
  const c=await browser.newContext({viewport,acceptDownloads:true});
  return process.env.OFFLINE === '1' ? installRoutes(c) : c;
}
async function installRoutes(c){
  // Offline browser fixture: the sandbox blocks even loopback sockets. Fulfil same-origin
  // requests directly from the unmodified repository, retaining normal HTTP origin/storage behavior.
  await c.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1'){
      // The requested web fonts cannot be acquired in this sandbox. An empty style avoids
      // misclassifying a deliberately unavailable third-party font as an app console error.
      if(u.hostname==='fonts.googleapis.com'){await route.fulfill({status:200,contentType:'text/css',body:''});return;}
      await route.abort();return;
    }
    const file=path.resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
    if(!file.startsWith(path.resolve(ROOT)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){await route.fulfill({status:404,body:'not found'});return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
    await route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await c.addInitScript(()=>{window.print=()=>{window.__printCalls=(window.__printCalls||0)+1;};});
  return c;
}
async function go(page,base,slug){await page.goto(base+'/'+slug+'.html',{waitUntil:'load',timeout:12000});await page.waitForTimeout(120);}
async function login(page,base,role,ui=true,remember=true){
  await go(page,base,'index');
  if(ui){await page.locator('#sie').fill(ROLES[role]+'@mediheal.test');await page.locator('#sip').fill(DEMO);await page.locator('#siBtn').click();}
  else await page.evaluate(([em,pw,rem])=>HIS.auth.attempt(em,pw,rem),[ROLES[role]+'@mediheal.test',DEMO,remember]);
  await page.waitForTimeout(220);
}
const save=(name,data)=>fs.writeFileSync(path.join(OUT,name),JSON.stringify(data,null,2));
async function shot(page,name){await page.screenshot({path:path.join(OUT,'screenshots',name+'.png'),fullPage:true});}
async function changed(page){return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('mh_')&&!/account|session/i.test(k)).map(([k,v])=>[k,v.length])));}
module.exports={ROOT,OUT,ROLES,DEMO,boot,context,installRoutes,go,login,save,shot,changed};
