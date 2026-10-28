const test=require('node:test'),assert=require('node:assert/strict');
const {createMotor}=require('./server.js');
const adminToken='a'.repeat(64),agentToken='b'.repeat(64);
const fixture={selected:'demo',globalBlock:[],campaigns:[{id:'demo',name:'Homologação',contacts:[{id:'x',name:'Exemplo',phone:'5524000000000',status:'Pendente',demo:true}],history:[{at:'2026-10-28T00:00:00Z',text:'Simulação antiga'}],block:[],agents:1,lines:1,start:'09:00',end:'18:00'}]};
function memory(){let saved=null;return {kind:'test',async load(){return structuredClone(saved)},async save(s){saved=structuredClone(s)},get saved(){return saved}}}
async function start(store=memory(),clock={value:1000000},backup=fixture){const m=createMotor({adminToken,agentToken,store,backup,now:()=>clock.value});await m.init();await new Promise(r=>m.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+m.server.address().port;const request=async(path,role,method='GET',body,key)=>{const r=await fetch(base+path,{method,headers:{...(role?{Authorization:'Bearer '+(role==='admin'?adminToken:role==='agent'?agentToken:role)}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};return {m,store,clock,request,close:()=>new Promise(r=>m.server.close(r))}}
test('separate scopes, legacy token rejected, public status omits contacts, external calls always blocked',async()=>{const x=await start();try{
 assert.equal((await x.request('/api/campaigns')).status,401);
 assert.equal((await x.request('/api/campaigns','agent')).status,403);
 assert.equal((await x.request('/api/agent/poll','admin')).status,403);
 assert.equal((await x.request('/api/campaigns','old-token')).status,401);
 assert.equal((await x.request('/api/campaign/start','admin','POST',{confirmed:true,campaignId:'demo'},'unauthorised-test-12345')).status,423);
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

const ext=require('./pilot-external.cjs');
function authorisedFixture(){const b=structuredClone(fixture);b.selected='1d98902a-3054-48ba-b1d4-686a8ff9a9c7';b.campaigns=[{...b.campaigns[0],id:b.selected,contacts:[{id:'own-test',name:'Homologação local',phone:'5524999999999',status:'Pendente'}]}];return b;}
const businessClock=()=>({value:Date.parse('2026-10-28T15:00:00Z')});
async function readyExternal(x,b){const h=ext.hash(b.campaigns[0].contacts[0].phone);await x.request('/api/agent/poll?ami_ready=1&version=0.6.0&route_hash='+h,'agent');return h;}
async function startCall(x,b,key='external-test-key-123456'){return x.request('/api/campaign/start','admin','POST',{confirmed:true,campaignId:b.selected},key)}
test('external pilot requires matching locally validated fixed destination and cannot call a demonstration campaign',async()=>{const b=authorisedFixture(),x=await start(memory(),businessClock(),b);try{
 assert.equal((await startCall(x,b)).status,503);
 await x.request('/api/agent/poll?ami_ready=1&version=0.6.0&route_hash='+'a'.repeat(64),'agent');assert.equal((await startCall(x,b)).status,503);
 await readyExternal(x,b);assert.equal((await x.request('/api/campaign/start','admin','POST',{confirmed:true,campaignId:'demo'},'other-external-key-123456')).status,423);
 const first=await startCall(x,b);assert.equal(first.status,202);assert.equal((await startCall(x,b)).body.call.id,first.body.call.id);
 assert.equal((await startCall(x,b,'another-external-key-12345')).status,429);
 assert.equal(x.store.saved.queue.length,1);assert(!JSON.stringify((await x.request('/api/public/status')).body).includes('99999999'));
 }finally{await x.close()}});
test('external pilot enforces hours and DNC again immediately before delivery',async()=>{const b=authorisedFixture(),x=await start(memory(),businessClock(),b);try{
 await readyExternal(x,b);await startCall(x,b);const changed=structuredClone(b);changed.globalBlock=[b.campaigns[0].contacts[0].phone];await x.request('/api/import','admin','POST',changed);
 const h=ext.hash(b.campaigns[0].contacts[0].phone);assert.equal((await x.request('/api/agent/poll?ami_ready=1&version=0.6.0&route_hash='+h,'agent')).body.job,null);
 assert.equal((await startCall(x,b,'new-after-block-1234567')).status,423);
 }finally{await x.close()}});
test('external completion requires correlated customer answer, bridge and hangup; qualification persists separately',async()=>{const b=authorisedFixture(),x=await start(memory(),businessClock(),b);try{
 const hash=await readyExternal(x,b);await startCall(x,b);const job=(await x.request('/api/agent/poll?ami_ready=1&version=0.6.0&route_hash='+hash,'agent')).body.job;const id='central-'+job.id;
 assert.equal(job.exten,'700');assert.equal(job.routeHash,hash);
 const report=o=>x.request('/api/agent/report','agent','POST',{id:job.id,lease:job.lease,outcome:o});
 assert.equal((await report('completed')).status,409);
 const send=(seq,phase,proof,elapsedMs)=>x.request('/api/agent/event','agent','POST',{id:job.id,lease:job.lease,seq,phase,proof,elapsedMs});
 assert.equal((await send(1,'contact_answered',{event:'DialEnd',uniqueId:'unrelated',destUniqueId:'other',dialStatus:'ANSWER'},10)).status,400);
 assert.equal((await send(1,'operator_answered',{event:'Newstate',uniqueId:id,channelState:'6'},1000)).status,200);
 await send(2,'contact_ringing',{event:'DialBegin',uniqueId:id,destUniqueId:'dest'},2000);
 await send(3,'contact_answered',{event:'DialEnd',uniqueId:id,destUniqueId:'dest',dialStatus:'ANSWER'},3000);
 assert.equal((await send(4,'bridged',{event:'BridgeEnter',operatorUniqueId:id,destUniqueId:'wrong',bridgeId:'bridge'},3100)).status,400);
 await send(4,'bridged',{event:'BridgeEnter',operatorUniqueId:id,destUniqueId:'dest',bridgeId:'bridge'},3100);
 const end={event:'Hangup',uniqueId:id};await send(5,'ended',end,13100);
 assert.equal((await send(5,'ended',end,13100)).body.replayed,true);
 assert.equal((await report('completed')).status,200);
 const q=await x.request('/api/calls/qualify','admin','POST',{id:job.id,classification:'Interessado',notes:'Homologação',audioConfirmed:true});assert.equal(q.status,200);assert.equal(q.body.call.talkSeconds,10);assert.equal(q.body.call.audioConfirmed,true);
 assert.equal((await x.request('/api/calls','agent')).status,403);assert.equal((await x.request('/api/calls','admin')).body.calls.length,1);
 }finally{await x.close()}});
test('pause cancels undispatched external work and restart holds an uncertain call until explicit manual release',async()=>{const b=authorisedFixture(),x=await start(memory(),businessClock(),b);try{
 await readyExternal(x,b);await startCall(x,b);await x.request('/api/campaign/pause','admin','POST',{campaignId:b.selected});assert.equal(x.store.saved.queue[0].state,'canceled');
 x.clock.value+=16000;const hash=await readyExternal(x,b);await startCall(x,b,'restart-external-key-123456');const job=(await x.request('/api/agent/poll?ami_ready=1&version=0.6.0&route_hash='+hash,'agent')).body.job;assert(job);
 await x.close();const y=await start(x.store,x.clock,b);try{
 assert.equal(y.store.saved.queue[1].state,'unknown');await readyExternal(y,b);assert.equal((await startCall(y,b,'retry-after-restart-12345')).status,429);
 await y.request('/api/calls/qualify','admin','POST',{id:job.id,classification:'Sem classificação',notes:'Encerrei no MicroSIP',releaseReservation:true,audioConfirmed:false});y.clock.value+=16000;assert.equal((await startCall(y,b,'new-after-release-12345')).status,202);
 }finally{await y.close()}
 }finally{if(x.m.server.listening)await x.close()}});

test('pilot never starts outside Brazil campaign hours or when eligible contact is fictional',async()=>{const b=authorisedFixture(),x=await start(memory(),businessClock(),b);try{
 await readyExternal(x,b);x.clock.value=Date.parse('2026-10-28T23:00:00Z');await readyExternal(x,b);assert.equal((await startCall(x,b)).status,423);
 x.clock.value=Date.parse('2026-10-28T15:00:00Z');const demo=structuredClone(b);demo.campaigns[0].contacts[0].demo=true;await x.request('/api/import','admin','POST',demo);await readyExternal(x,b);assert.equal((await startCall(x,b)).status,423);
}finally{await x.close()}});
