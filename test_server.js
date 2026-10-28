'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
process.env.CENTRAL_API_TOKEN='x'.repeat(40);
const {server,parseBackup}=require('./server');
const data={selected:'test',campaigns:[{id:'demo',name:'Demo',contacts:Array.from({length:8},(_,i)=>({id:'demo-'+i,phone:'552400000000'+i,status:'Pendente',demo:true,note:'Dado fictício'}))},{id:'test',name:'Teste autorizado',contacts:[{id:'only',name:'Teste',phone:'5524999999999',status:'Pendente'}]}]};
test('Filtro conserva campanha real sem discar ficticios',()=>{
 const p=parseBackup(data);
 assert.equal(p.campaigns.length,2);
 assert.equal(p.campaigns[0].contacts.filter(c=>c.eligible).length,0);
 assert.equal(p.campaigns[1].contacts.filter(c=>c.eligible).length,1);
 assert.equal(p.campaigns[0].contacts.filter(c=>c.fictitious).length,8);
});
test('Servidor protegido e bloqueio de chamadas externas', async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port,api='http://127.0.0.1:'+port, auth={Authorization:'Bearer '+'x'.repeat(40)};
 try {
  let r=await fetch(api+'/health');let body=await r.json();assert.equal(body.external_calls_enabled,false);
  r=await fetch(api+'/');assert.equal(r.status,200);
  let html=await r.text();assert.ok(html.includes('Monitor de operação'));assert.ok(html.includes('Somente leitura')||html.includes('somente leitura'));
  assert.equal(html.includes('5524999999999'),false);
  r=await fetch(api+'/api/public/status');assert.equal(r.status,200);
  let summary=await r.json();assert.equal(summary.external_calls_enabled,false);
  assert.equal(summary.site_original_integrated,false);assert.equal('phone' in summary,false);
  assert.equal(JSON.stringify(summary).includes('5524999999999'),false);
  r=await fetch(api+'/api/campaigns');assert.equal(r.status,401);
  r=await fetch(api+'/api/campaigns',{headers:auth});assert.equal(r.status,200);
  r=await fetch(api+'/api/campaign/start',{method:'POST',headers:auth});assert.equal(r.status,423);
  r=await fetch(api+'/api/pilot/internal-test',{method:'POST',headers:auth}); assert.equal(r.status,202);
  let b=await r.json();let jobId=b.jobId;
  r=await fetch(api+'/api/agent/poll',{headers:auth});b=await r.json();assert.equal(b.job.channel,'PJSIP/1001');assert.equal(b.job.exten,'600');
  r=await fetch(api+'/api/agent/report',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({id:jobId,outcome:'accepted',detail:'AMI response success'})});assert.equal(r.status,200);
 } finally {await new Promise(resolve=>server.close(resolve))}
});