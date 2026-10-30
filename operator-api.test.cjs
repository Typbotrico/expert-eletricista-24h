'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createOperatorApi}=require('./operator-api.cjs');
function harness(){
 let whole={};let time=Date.parse('2026-10-28T15:00:00Z');
 const api=createOperatorApi({getState:()=>whole,transact:async fn=>{const next=structuredClone(whole);const result=await fn(next);whole=next;return result},secret:'S'.repeat(48),setupKey:'T'.repeat(40),recoveryToken:'R'.repeat(64),recoveryExpiresAt:time+7200000,now:()=>time});
 async function call(path,method='GET',data=null,cookie='',key=''){
  const req=Readable.from(data==null?[]:[Buffer.from(JSON.stringify(data))]);req.method=method;req.headers={host:'test.local',cookie,origin:'https://test.local',...(key?{'idempotency-key':key}:{})};req.socket={remoteAddress:'127.0.0.1'};
  let status=null,headers={},body='';const res={headersSent:false,writeHead(code,extra){status=code;headers=extra;this.headersSent=true},end(value){body=String(value??'')}};
  await api.handle(req,res,path);return {status,headers,body:headers['Content-Type']?.includes('application/json')?JSON.parse(body):body};
 }
 return {call,state:()=>whole,advance:n=>{time+=n}};
}
test('admin setup is one use, credentials stay hashed, protected endpoints require cookie',async()=>{
 const h=harness();assert.equal((await h.call('/api/operator/status')).body.configured,false);
 assert.equal((await h.call('/api/operator/view')).status,401);
 assert.equal((await h.call('/api/operator/setup','POST',{key:'wrong',name:'Admin',password:'VeryStrong123!!'})).status,403);
 const r=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'VeryStrong123!!'});
 assert.equal(r.status,201);assert.ok(r.headers['Set-Cookie'].includes('HttpOnly'));assert.equal(h.state().operatorV1.users[0].hash.includes('VeryStrong123!!'),false);
 assert.equal((await h.call('/api/operator/status')).body.configured,true);
 assert.equal((await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Extra',password:'VeryStrong123!!'})).status,409);
 const unauth=await h.call('/api/operator/campaign','POST',{name:'Teste'});assert.equal(unauth.status,401);
});
test('shared campaigns prevent duplicate calls, preserve blocked numbers, and require explicit closure',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Admin',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 let r=await h.call('/api/operator/campaign','POST',{name:'Campanha A'},cookie);assert.equal(r.status,201);const id=r.body.campaign.id;
 r=await h.call('/api/operator/import','POST',{campaignId:id,text:'Nome;Telefone\nAna;24999998888\nAna repetida;24999998888\nBruno;24988887777'},cookie);assert.equal(r.body.added,2);assert.equal(r.body.duplicates,1);
 await h.call('/api/operator/pause','POST',{campaignId:id,paused:false},cookie);
 r=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);assert.equal(r.status,200);let c=r.body.contact;
 assert.equal(c.status,'Reservado');
 r=await h.call('/api/operator/dial','POST',{contactId:c.id},cookie,'idempotency-123456789');assert.equal(r.status,200);assert.equal(r.body.contact.attempts,1);
 const again=await h.call('/api/operator/dial','POST',{contactId:c.id},cookie,'idempotency-123456789');assert.equal(again.body.contact.attempts,1);
 const noEnd=await h.call('/api/operator/finish','POST',{contactId:c.id,result:'Atendeu',ended:false},cookie);assert.equal(noEnd.status,422);
 await h.call('/api/operator/finish','POST',{contactId:c.id,result:'Não ligar',ended:true},cookie);
 assert.equal(h.state().operatorV1.blocked.length,1);
 r=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);assert.equal(r.body.contact.name,'Bruno');
 assert.equal((await h.call('/api/operator/export','GET',null,cookie)).status,200);
});

test('explicitly authorised own-number Directcall tests work after hours but remain paused by default',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Admin',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 assert.equal((await h.call('/api/operator/self-test','POST',{name:'Celular próprio',phone:'24999998888',owned:false},cookie)).status,422);
 const created=await h.call('/api/operator/self-test','POST',{name:'Celular próprio',phone:'24999998888',owned:true},cookie);
 assert.equal(created.status,201);assert.equal(created.body.campaign.paused,true);
 assert.equal(created.body.campaign.isTest,true);
 const id=created.body.campaign.id;
 h.advance(10*3600000);
 await assert.rejects(()=>h.call('/api/operator/claim','POST',{campaignId:id},cookie),/campanha_indisponivel_ou_pausada/);
 await h.call('/api/operator/pause','POST',{campaignId:id,paused:false},cookie);
 const reserved=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);
 assert.equal(reserved.status,200);assert.equal(reserved.body.contact.phone,'5524999998888');
 const dial=await h.call('/api/operator/dial','POST',{contactId:reserved.body.contact.id},cookie,'selftest-key-123456789');
 assert.equal(dial.status,200);assert.equal(dial.body.contact.status,'Comando enviado');
 assert.equal((await h.call('/api/operator/claim','POST',{campaignId:id},cookie)).status,409);
 const ended=await h.call('/api/operator/finish','POST',{contactId:reserved.body.contact.id,ended:true,result:'Não atendeu'},cookie);
 assert.equal(ended.status,200);
 await assert.rejects(()=>h.call('/api/operator/claim','POST',{campaignId:id},cookie),/lista_sem_contatos_pendentes/);
});

test('recovery resets only admin password, keeps data, revokes sessions and rejects reused code',async()=>{
 const h=harness();
 const a=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'OldStrongPass456!'});
 assert.equal(a.status,201);
 const cookie=a.headers['Set-Cookie'].split(';')[0];
 const c=await h.call('/api/operator/campaign','POST',{name:'Campanha preservada'},cookie);
 assert.equal(c.status,201);
 let r=await h.call('/api/operator/reset-password','POST',{code:'errado',password:'NewStrongPass789!'});
 assert.equal(r.status,403);
 r=await h.call('/api/operator/reset-password','POST',{code:'R'.repeat(64),password:'NewStrongPass789!'});
 assert.equal(r.status,200);
 assert.equal((await h.call('/api/operator/view','GET',null,cookie)).status,401);
 assert.equal((await h.call('/api/operator/login','POST',{username:'admin',password:'OldStrongPass456!'})).status,401);
 const login=await h.call('/api/operator/login','POST',{username:'admin',password:'NewStrongPass789!'});
 assert.equal(login.status,200);
 const logged=login.headers['Set-Cookie'].split(';')[0];
 const v=await h.call('/api/operator/view','GET',null,logged);
 assert.equal(v.status,200);assert.equal(v.body.campaigns.length,1);assert.equal(v.body.campaigns[0].name,'Campanha preservada');
 await assert.rejects(()=>h.call('/api/operator/reset-password','POST',{code:'R'.repeat(64),password:'AnotherStrongPass456!'}),/codigo_ja_utilizado/);
});
test('login has short cooldown only after failed passwords; successful login clears attempts',async()=>{
 const h=harness();
 await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidStrongPass123!'});
 for(let i=0;i<8;i++)assert.equal((await h.call('/api/operator/login','POST',{username:'admin',password:'errada'})).status,401);
 assert.equal((await h.call('/api/operator/login','POST',{username:'admin',password:'ValidStrongPass123!'})).status,429);
 h.advance(60001);
 assert.equal((await h.call('/api/operator/login','POST',{username:'admin',password:'ValidStrongPass123!'})).status,200);
 assert.equal((await h.call('/api/operator/login','POST',{username:'admin',password:'ValidStrongPass123!'})).status,200);
});
