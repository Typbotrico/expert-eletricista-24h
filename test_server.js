const test=require('node:test'),assert=require('node:assert/strict');
const {createMotor}=require('./server.js');
const adminToken='a'.repeat(64),agentToken='b'.repeat(64);
const fixture={selected:'demo',globalBlock:[],campaigns:[{id:'demo',name:'Homologação',contacts:[{id:'x',name:'Exemplo',phone:'5524000000000',status:'Pendente',demo:true}],history:[{at:'2026-10-28T00:00:00Z',text:'Simulação antiga'}],block:[],agents:1,lines:1,start:'09:00',end:'18:00'}]};
function memory(){let saved=null;return {kind:'test',async load(){return structuredClone(saved)},async save(s){saved=structuredClone(s)},get saved(){return saved}}}
async function start(store=memory(),clock={value:1000000}){const m=createMotor({adminToken,agentToken,store,backup:fixture,now:()=>clock.value});await m.init();await new Promise(r=>m.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+m.server.address().port;const request=async(path,role,method='GET',body,key)=>{const r=await fetch(base+path,{method,headers:{...(role?{Authorization:'Bearer '+(role==='admin'?adminToken:role==='agent'?agentToken:role)}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};return {m,store,clock,request,close:()=>new Promise(r=>m.server.close(r))}}
test('separate scopes, legacy token rejected, public status omits contacts, external calls always blocked',async()=>{const x=await start();try{
 assert.equal((await x.request('/api/campaigns')).status,401);
 assert.equal((await x.request('/api/campaigns','agent')).status,403);
 assert.equal((await x.request('/api/agent/poll','admin')).status,403);
 assert.equal((await x.request('/api/campaigns','old-token')).status,401);
 assert.equal((await x.request('/api/campaign/start','admin','POST')).status,423);
 const p=await x.request('/api/public/status');assert.equal(p.body.totals.fictitious_blocked,1);assert.equal(p.body.external_calls_enabled,false);assert(!JSON.stringify(p.body).includes('5524'));
 assert.equal(x.store.saved.backup.campaigns[0].history[0].text,'Simulação antiga');
}finally{await x.close()}});
test('offline agent rejects test; idempotency, lease, non-answered result and restart durability',async()=>{const x=await start();try{
 const key='unique-test-1234567890';assert.equal((await x.request('/api/pilot/internal-test','admin','POST',null,key)).status,503);
 await x.request('/api/agent/poll?ami_ready=1','agent');
 const one=await x.request('/api/pilot/internal-test','admin','POST',null,key);assert.equal(one.status,202);
 const repeat=await x.request('/api/pilot/internal-test','admin','POST',null,key);assert.equal(repeat.body.jobId,one.body.jobId);assert.equal(x.store.saved.queue.length,1);
 const job=(await x.request('/api/agent/poll?ami_ready=1','agent')).body.job;
 assert.equal((await x.request('/api/agent/report','agent','POST',{id:job.id,lease:'wrong',outcome:'answered'})).status,409);
 assert.equal((await x.request('/api/agent/report','agent','POST',{id:job.id,lease:job.lease,outcome:'accepted'})).status,200);
 assert.equal((await x.request('/api/agent/report','agent','POST',{id:job.id,lease:job.lease,outcome:'answered'})).status,409);
 assert.equal(x.store.saved.lastAgentResult.outcome,'accepted');assert.match(x.store.saved.lastAgentResult.meaning,/não comprova/);
 await x.close();const y=await start(x.store,x.clock);try{assert.equal(y.m.status().totals.internal_test_jobs_completed,1);assert.equal(y.m.status().agent_connected,false);assert.equal((await y.request('/api/agent/poll?ami_ready=1','agent')).body.job,null)}finally{await y.close()}
}finally{if(x.m.server.listening)await x.close()}});
test('restart never redials a leased job and pause survives a restart',async()=>{const x=await start();try{
 await x.request('/api/agent/poll?ami_ready=1','agent');await x.request('/api/pilot/internal-test','admin','POST',null,'unique-test-1234567890');await x.request('/api/agent/poll?ami_ready=1','agent');
 assert.equal((await x.request('/api/campaign/pause','admin','POST',{campaignId:'demo'})).status,200);
 await x.close();const y=await start(x.store,x.clock);try{assert.equal(y.store.saved.queue[0].state,'unknown');assert.equal(y.store.saved.campaignControl.demo.mode,'paused');assert.equal((await y.request('/api/agent/poll?ami_ready=1','agent')).body.job,null)}finally{await y.close()}
}finally{if(x.m.server.listening)await x.close()}});
test('database failure closes writes without claiming queue acceptance',async()=>{const store=memory(),x=await start(store);try{await x.request('/api/agent/poll?ami_ready=1','agent');store.save=async()=>{throw Error('DB offline')};assert.equal((await x.request('/api/pilot/internal-test','admin','POST',null,'unique-test-1234567890')).status,503);assert.equal(x.m.status().ready,false);assert.equal(store.saved.queue.length,0)}finally{await x.close()}});
test('pairing is private, one-use and expires without leaking credential in audit',async()=>{const x=await start();try{
 assert.equal((await x.request('/api/admin/pair','agent','POST')).status,403);
 const pair=await x.request('/api/admin/pair','admin','POST');assert.equal(pair.status,201);assert.equal(pair.body.code.length,64);
 assert(!JSON.stringify(x.store.saved).includes(pair.body.code));
 const enrolled=await x.request('/api/agent/enroll',null,'POST',{code:pair.body.code});assert.equal(enrolled.status,200);assert.equal(enrolled.body.agentToken,agentToken);
 assert.equal((await x.request('/api/agent/enroll',null,'POST',{code:pair.body.code})).status,401);
 const next=await x.request('/api/admin/pair','admin','POST');x.clock.value+=600001;
 assert.equal((await x.request('/api/agent/enroll',null,'POST',{code:next.body.code})).status,401);
 assert(!JSON.stringify((await x.request('/api/audit','admin')).body).includes(agentToken));
}finally{await x.close()}});

test('agent heartbeat alone cannot claim AMI connectivity or obtain an internal job',async()=>{const x=await start();try{
 await x.request('/api/agent/poll','agent');assert.equal(x.m.status().agent_connected,true);assert.equal(x.m.status().asterisk_connected,false);
 assert.equal((await x.request('/api/pilot/internal-test','admin','POST',null,'connectivity-test-12345')).status,503);
 await x.request('/api/agent/poll?ami_ready=1','agent');assert.equal(x.m.status().asterisk_connected,true);
 await x.request('/api/pilot/internal-test','admin','POST',null,'connectivity-test-12345');
 assert.equal((await x.request('/api/agent/poll?ami_ready=0','agent')).body.job,null);
 assert.equal(x.store.saved.queue[0].state,'queued');
}finally{await x.close()}});
test('sync preserves omitted campaigns, contacts, historical activities and DNC entries',async()=>{const x=await start();try{
 const first=structuredClone(fixture);first.globalBlock=['5524000000000'];
 first.campaigns.push({...structuredClone(fixture.campaigns[0]),id:'other'});
 await x.request('/api/import','admin','POST',first);
 const partial=structuredClone(fixture);partial.campaigns[0].contacts=[];partial.campaigns[0].history=[];
 assert.equal((await x.request('/api/import','admin','POST',partial)).status,200);
 assert.equal(x.store.saved.backup.campaigns.length,2);
 assert.equal(x.store.saved.backup.campaigns[0].contacts.length,1);
 assert.equal(x.store.saved.backup.campaigns[0].history.length,1);
 assert.equal(x.store.saved.backup.globalBlock[0],'5524000000000');
}finally{await x.close()}});
