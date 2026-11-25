const {boot,context,go,login,save,shot}=require('./audit-harness.cjs');
const PAGES=['registration','appointments','consultation','treatment','nursing','laboratory','pharmacy','admissions','charges','billing','claims','attendance','payroll','personnel','departments','accounts','audit','reports','settings','profile'];
const results=[];
const visible=()=>{const a=[...document.querySelectorAll('button')];return a.map((e,i)=>({i,text:(e.innerText||e.getAttribute('aria-label')||e.title||'').trim().replace(/\s+/g,' '),id:e.id,disabled:e.disabled,rect:e.getBoundingClientRect().toJSON(),inStage:!!e.closest('#stage')})).filter(x=>x.inStage&&!x.disabled&&x.rect.width>0&&x.rect.height>0&&x.rect.right>0&&x.rect.left<innerWidth);};
function inspectDialog(){
 const ds=[...document.querySelectorAll('[role=dialog],.tp-modal,.pe-modal,.pm-modal,.pr-modal,.at-modal,.ac-bg,.modal-bg,.bl-modal,.md-modal')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';});
 const d=ds.at(-1);if(!d)return null;const r=d.getBoundingClientRect();
 return {class:d.className,role:d.getAttribute('role'),name:d.getAttribute('aria-label')||d.getAttribute('aria-labelledby'),rect:r.toJSON(),inputs:[...d.querySelectorAll('input,select,textarea')].map(e=>({id:e.id,name:e.name,type:e.type,label:e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||[...e.labels||[]].map(l=>l.innerText).join(''),placeholder:e.placeholder,readonly:e.readOnly})),buttons:[...d.querySelectorAll('button')].map(e=>({text:e.innerText.trim(),label:e.getAttribute('aria-label'),disabled:e.disabled,rect:e.getBoundingClientRect().toJSON()})),focusInside:d.contains(document.activeElement)};
}
(async()=>{const app=await boot();try{
 const c=await context(app.browser,{width:1440,height:900});const p=await c.newPage();await login(p,app.base,'superadmin',false);
 for(const slug of PAGES){await go(p,app.base,slug);const base=await p.evaluate(visible);
  // One representative per action label; row-specific effects are covered by the domain suites.
  const uniq=base.filter((x,i,a)=>a.findIndex(y=>y.text===x.text)===i);
  for(const b of uniq){await go(p,app.base,slug);const before=await p.evaluate(()=>document.body.innerHTML);const rec={page:slug,control:b.text,selectorIndex:b.i};
   try{const fresh=(await p.evaluate(visible)).find(x=>x.text===b.text);if(!fresh){rec.unavailable=true;results.push(rec);continue;}const target=p.locator('button').nth(fresh.i);await target.click({timeout:2500});await p.waitForTimeout(90);rec.navigation=!new URL(p.url()).pathname.endsWith('/'+slug+'.html');rec.changed=await p.evaluate(old=>document.body.innerHTML!==old,before);rec.dialog=await p.evaluate(inspectDialog);
    if(rec.dialog){
     const unlabeled=rec.dialog.inputs.filter(x=>!x.label);rec.unlabeledCount=unlabeled.length;
     if(unlabeled.length)await shot(p,'modal-'+slug+'-'+results.filter(x=>x.page===slug&&x.dialog).length);
     await p.setViewportSize({width:1440,height:768});rec.at768=await p.evaluate(inspectDialog);await p.setViewportSize({width:1440,height:900});
     await p.keyboard.press('Escape');rec.escapeClosed=!(await p.evaluate(inspectDialog));rec.focusAfterEscape=await p.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,text:document.activeElement.innerText?.trim().slice(0,70)}));
    }
   }catch(e){rec.error=e.message.split('\n')[0];}
   results.push(rec);save('surface.json',results);
  }console.log(slug,uniq.length,'controls',results.filter(x=>x.page===slug&&x.dialog).length,'dialog states');
 }await c.close();
}finally{await app.close();}process.exitCode=results.some(x=>x.error||x.unlabeledCount)?1:0;console.log('DONE',results.length,'representative controls',results.filter(x=>x.dialog).length,'dialogs',results.filter(x=>x.error).length,'click errors');})().catch(e=>{console.error(e);process.exitCode=1;});
