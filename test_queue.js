const test=require('node:test'),assert=require('node:assert/strict');
const flow=require('./campaign-queue.cjs'),{createMotor}=require('./server.js');
const phones=['5524999999901','5524999999902','5524999999903','5524999999904'];
const admin='a'.repeat(64),agent='b'.repeat(64),policy=flow.makePolicy(phones);
function fixture(){return {selected:'test-list',globalBlock:[],campaigns:[{id:'test-list',name:'Lista sintética',agents:1,lines:1,start:'09:00',end:'18:00',retryLimit:1,retryMinutes:60,history:[],block:[],contacts:phones.map((phone,i)=>({id:'c'+i,name:'Teste '+i,phone,status:'Pendente'}))}]};}
async function setup(){let source=fixture(),saved=null,readFails=false,time=Date.parse('2026-10-28T15:00:00Z');const store={kind:'test',async load(){return structuredClone(saved)},async save(s){saved=structuredClone(s)},async readWorkspace(owner){if(readFails)throw Error('source offline');assert.equal(owner,'owner-test');return structuredClone(source)}};
 const m=createMotor({adminToken:admin,agentToken:agent,store,backup:source,testNumbers:phones,now:()=>time});await m.init();await new Promise(r=>m.server.listen(0,'127.0.0.1',r));
 const call=async(path,role='admin',body,key)=>{const r=await fetch('http://127.0.0.1:'+m.server.address().port+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(role==='admin'?admin:agent),'X-Workspace-ID':'owner-test',...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 const poll=()=>call('/api/agent/poll?ami_ready=1&version=0.7.0&template_ready=1&policy_revision='+policy.revision,'agent');
 await call('/api/import','admin',source);await poll();
 return {m,call,poll,get saved(){return saved},get source(){return source},failSource(){readFails=true},advance(){time+=16000},close:()=>new Promise(r=>m.server.close(r))};
}
test('four approved contacts are delivered sequentially once per round and another number cannot join',async()=>{const x=await setup();try{
 x.source.campaigns[0].contacts.push({id:'outside',name:'Fora da autorização',phone:'5524999999905',status:'Pendente'});
 const start=await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'unique-round-key-12345');assert.equal(start.status,202);assert.equal(start.body.run.total,4);
 assert.equal((await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'unique-round-key-12345')).body.replayed,true);
 const received=[];
 for(let i=0;i<4;i++){
  const job=(await x.poll()).body.job;assert(job);received.push(job.targetPhone);assert.equal(job.kind,'campaign_call');
  assert.equal((await x.poll()).body.job,null);
  assert.equal((await x.call('/api/agent/report','agent',{id:job.id,lease:job.lease,outcome:'failed'})).status,200);x.advance();
 }
 assert.equal((await x.poll()).body.job,null);assert.deepEqual(received,phones);assert.equal(x.saved.runs[0].status,'completed');
 const publicView=(await x.call('/api/calls')).body;assert(!JSON.stringify(publicView).includes(phones[0]));assert.equal(publicView.calls.length,4);
 }finally{await x.close()}});
test('latest account DNC is checked before every dispatch, independently of the imported snapshot',async()=>{const x=await setup();try{
 await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'block-round-key-12345');x.source.globalBlock=[phones[0]];
 const job=(await x.poll()).body.job;assert.equal(job.targetPhone,phones[1]);assert.equal(x.saved.runs[0].entries[0].skipped,true);
 }finally{await x.close()}});
test('pause and resume do not repeat the first attempted contact; stopping prevents the next contact',async()=>{const x=await setup();try{
 await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'pause-round-key-12345');const first=(await x.poll()).body.job;
 await x.call('/api/campaign/pause','admin',{campaignId:'test-list'});await x.call('/api/agent/report','agent',{id:first.id,lease:first.lease,outcome:'failed'});x.advance();assert.equal((await x.poll()).body.job,null);
 await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'resume-round-key-12345');const second=(await x.poll()).body.job;assert.equal(second.targetPhone,phones[1]);
 await x.call('/api/campaign/stop','admin',{campaignId:'test-list'});await x.call('/api/agent/report','agent',{id:second.id,lease:second.lease,outcome:'failed'});x.advance();assert.equal((await x.poll()).body.job,null);assert.equal(x.saved.runs[0].status,'stopped');
 }finally{await x.close()}});
test('seller nonanswer pauses the run and a source read failure never delivers a job',async()=>{const x=await setup();try{
 await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'seller-round-key-12345');const first=(await x.poll()).body.job;
 await x.call('/api/agent/report','agent',{id:first.id,lease:first.lease,outcome:'operator_no_answer'});assert.equal(x.saved.runs[0].status,'paused');assert.equal(x.saved.runs[0].entries[0].attempts,0);x.advance();assert.equal((await x.poll()).body.job,null);await x.call('/api/campaign/run','admin',{campaignId:'test-list',confirmed:true},'source-fail-round-12345');x.failSource();assert.equal((await x.poll()).body.job,null);assert.equal(x.saved.runs[0].reason,'falha_ao_conferir_bloqueios');
 }finally{await x.close()}});
test('phone normalization, deduplication, fake and blocked contacts cannot expand a run',()=>{
 const state={backup:fixture(),queue:[]};state.backup.campaigns[0].contacts.push({...state.backup.campaigns[0].contacts[0],id:'duplicate'});state.backup.campaigns[0].contacts[1].demo=true;state.backup.globalBlock=[phones[2]];
 const result=flow.start(state,'test-list','unit-round-key-12345',policy,Date.parse('2026-10-28T15:00:00Z'),true);assert.equal(result.run.entries.length,2);assert.equal(flow.normalize('(24) 99999-9901'),phones[0]);
});
