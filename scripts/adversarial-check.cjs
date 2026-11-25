const {boot,context,go,login,save}=require('./audit-harness.cjs');
const results=[];
function check(name,pass,detail){results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));save('adversarial.json',results);}
(async()=>{const app=await boot();try{const c=await context(app.browser),p=await c.newPage();await login(p,app.base,'superadmin',false);await go(p,app.base,'nursing');
const r=await p.evaluate(()=>{
 const r=[];const test=(name,fn)=>{try{const x=fn();r.push({name,pass:!x.ok,detail:x.error||'accepted invalid mutation'});}catch(e){r.push({name,pass:false,detail:e.message});}};
 const patientId='PT-99213';
 test('pending prescription cannot dispense',()=>HIS.pharmacy.dispense('RX-0001',{batchId:'BT-0003',qty:1}));
 test('infinite prescription quantity refused',()=>HIS.pharmacy.createRx({patientId,drug:'Aspirin 81 mg tablet',qty:Infinity}));
 test('infinite stock receipt refused',()=>HIS.pharmacy.receive({drug:'Test',qty:Infinity,expiry:'2030-01-01'}));
 test('invalid batch expiry refused',()=>HIS.pharmacy.receive({drug:'Test',qty:2,expiry:'not-a-date'}));
 test('negative stock price refused',()=>HIS.pharmacy.receive({drug:'Test',qty:2,expiry:'2030-01-01',price:-1}));
 test('infinite charge quantity refused',()=>HIS.charges.add({patientId,source:'manual',sourceId:'bad-qty',description:'Test',qty:Infinity,unitPrice:1}));
 test('infinite charge price refused',()=>HIS.charges.add({patientId,source:'manual',sourceId:'bad-price',description:'Test',qty:1,unitPrice:Infinity}));
 test('overflow charge total refused',()=>HIS.charges.add({patientId,source:'manual',sourceId:'bad-total',description:'Test',qty:1e200,unitPrice:1e200}));
 const enc=HIS.encounters.all().find(x=>x.patientId!==patientId);
 test('wrong-patient charge encounter refused',()=>HIS.charges.add({patientId,encounterId:enc.id,source:'manual',sourceId:'bad-enc',description:'Test',qty:1,unitPrice:1}));
 test('missing charge encounter refused',()=>HIS.charges.add({patientId,encounterId:'NO-SUCH-ENCOUNTER',source:'manual',sourceId:'missing-enc',description:'Test',qty:1,unitPrice:1}));
 test('wrong-patient laboratory encounter refused',()=>HIS.lab.create({patientId,encounterId:enc.id,test:Object.keys(HIS.lab.CATALOG)[0]}));
 test('missing laboratory encounter refused',()=>HIS.lab.create({patientId,encounterId:'NO-SUCH-ENCOUNTER',test:Object.keys(HIS.lab.CATALOG)[0]}));
 test('wrong-patient claim refused',()=>HIS.claims.create({patientId:'PT-99210',invoiceId:HIS.billing.all().find(x=>x.pt===patientId).id,requestedAmount:1,payer:'PhilHealth',memberRef:'test'}));
 test('impossible birth date refused',()=>HIS.registry.create({name:'Invalid birthday',dob:'2026-02-31'}));
 test('future birth date refused',()=>HIS.registry.create({name:'Future birthday',dob:'2039-01-01'}));
 test('orphan vitals refused',()=>HIS.vitals.record('PT-MISSING',{bp:'120/80',hr:80,rr:18,temp:37,spo2:98}));
 return r;
});for(const x of r)check(x.name,x.pass,x.detail);await c.close();}finally{await app.close();}console.log('RESULT',results.filter(x=>x.pass).length,'pass',results.filter(x=>!x.pass).length,'fail');process.exitCode=results.some(x=>!x.pass)?1:0;})().catch(e=>{console.error(e);process.exitCode=1});
