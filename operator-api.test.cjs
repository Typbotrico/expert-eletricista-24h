'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createOperatorApi}=require('./operator-api.cjs');
function harness(){
 let whole={};let time=Date.parse('2026-10-28T15:00:00Z');
 const api=createOperatorApi({getState:()=>whole,transact:async fn=>{const next=structuredClone(whole);const result=await fn(next);whole=next;return result},secret:'S'.repeat(48),setupKey:'T'.repeat(40),recoveryToken:'R'.repeat(64),recoveryExpiresAt:time+7200000,now:()=>time});
 async function call(path,method='GET',data=null,cookie='',key=''){
  const req=Readable.from(data==null?[]:[Buffer.from(JSON.stringify(data))]);req.method=method;req.url=path;req.headers={host:'test.local',cookie,origin:'https://test.local',...(key?{'idempotency-key':key}:{})};req.socket={remoteAddress:'127.0.0.1'};
  let status=null,headers={},body='';const res={headersSent:false,writeHead(code,extra){status=code;headers=extra;this.headersSent=true},end(value){body=String(value??'')}};
  await api.handle(req,res,path.split('?')[0]);return {status,headers,body:headers['Content-Type']?.includes('application/json')?JSON.parse(body):body};
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

test('bulk campaign processes multiple unique contacts in sequence without overlap',async()=>{
 const h=harness();
 const first=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidPass789!!'});
 const cookie=first.headers['Set-Cookie'].split(';')[0];
 const camp=await h.call('/api/operator/campaign','POST',{name:'Lista de 100 clientes'},cookie);const id=camp.body.campaign.id;
 const rows=['Nome;Telefone'];for(let i=0;i<100;i++)rows.push('Cliente '+i+';2499'+String(1000000+i).padStart(7,'0'));
 rows.push(rows[7]);
 let imp=await h.call('/api/operator/import','POST',{campaignId:id,text:rows.join('\n')},cookie);
 assert.equal(imp.status,200);assert.equal(imp.body.added,100);assert.equal(imp.body.duplicates,1);
 await h.call('/api/operator/pause','POST',{campaignId:id,paused:false},cookie);
 const called=new Set();
 for(let i=0;i<12;i++){
  const claimed=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);
  assert.equal(claimed.status,200);const current=claimed.body.contact;assert.equal(called.has(current.phone),false);
  called.add(current.phone);
  const key='batch-idempotency-'+String(i).padStart(3,'0');
  const sent=await h.call('/api/operator/dial','POST',{contactId:current.id},cookie,key);
  assert.equal(sent.status,200);assert.equal(sent.body.contact.attempts,1);
  const duplicate=await h.call('/api/operator/dial','POST',{contactId:current.id},cookie,key);
  assert.equal(duplicate.body.contact.attempts,1);
  const concurrent=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);
  assert.equal(concurrent.status,409);
  const ended=await h.call('/api/operator/finish','POST',{contactId:current.id,result:'Atendeu',ended:true},cookie);
  assert.equal(ended.status,200);
 }
 const data=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(data.body.contacts.filter(x=>x.status==='Atendeu').length,12);
 assert.equal(data.body.contacts.filter(x=>x.status==='Pendente').length,88);
});

test('operator embeds only in original ChatGPT Site and uses partitioned secure cookies',async()=>{
 const h=harness();
 const framed=await h.call('/operador?embedded=1');
 assert.equal(framed.status,200);
 assert.match(framed.headers['Content-Security-Policy'],/frame-ancestors 'self' https:\/\/central-de-ligacoes\.ricogisi\.chatgpt\.site/);
 assert.match(framed.body,/header\{display:none!important\}/);
 const normal=await h.call('/operador');
 assert.equal(normal.status,200);
 assert.equal(normal.body.includes('header{display:none!important}'),false);
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidStrongPass123!'});
 assert.equal(setup.status,201);
 assert.match(setup.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=None; Partitioned/);
 const c=setup.headers['Set-Cookie'].split(';')[0];
 const account=await h.call('/api/operator/view','GET',null,c);
 assert.equal(account.status,200);
 const logout=await h.call('/api/operator/logout','POST',{},c);
 assert.match(logout.headers['Set-Cookie'],/Max-Age=0/);
 assert.match(logout.headers['Set-Cookie'],/Partitioned/);
});

test('authorised 2-to-5 number list is safe, starts paused and advances without dialing duplicates',async()=>{
 const h=harness();
 const init=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidPass789!!'});
 const cookie=init.headers['Set-Cookie'].split(';')[0];
 const payload={name:'Cinco ligações de homologação',consent:true,text:'Nome;Telefone\nPrimeiro;24999998888\nSegundo;24988887777\nTerceiro;24977776666\nQuarto;24966665555\nQuinto;24955554444'};
 let x=await h.call('/api/operator/test-list','POST',{...payload,consent:false},cookie);
 assert.equal(x.status,422);
 x=await h.call('/api/operator/test-list','POST',payload,cookie);
 assert.equal(x.status,201);assert.equal(x.body.count,5);assert.equal(x.body.campaign.paused,true);
 const id=x.body.campaign.id;
 const amended=await h.call('/api/operator/test-list','POST',{name:'Lista atualizada',consent:true,text:'Nome;Telefone\nPrimeiro;24999998888\nSétimo;24933332222'},cookie);
 assert.equal(amended.status,201);
 assert.equal(amended.body.campaign.authorizedPhones.length,2);
 assert.equal(h.state().operatorV1.campaigns.length,2);
 h.advance(10*3600000);
 await assert.rejects(()=>h.call('/api/operator/claim','POST',{campaignId:id},cookie),/campanha_indisponivel_ou_pausada/);
 await h.call('/api/operator/pause','POST',{campaignId:id,paused:false},cookie);
 const result=[];
 for(let i=0;i<5;i++){
  const n=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);
  assert.equal(n.status,200);
  const c=n.body.contact;assert.equal(result.includes(c.phone),false);result.push(c.phone);
  const send=await h.call('/api/operator/dial','POST',{contactId:c.id},cookie,'unique-list-'+String(i).padStart(18,'0'));
  assert.equal(send.status,200);assert.equal(send.body.contact.attempts,1);
  assert.equal((await h.call('/api/operator/claim','POST',{campaignId:id},cookie)).status,409);
  assert.equal((await h.call('/api/operator/finish','POST',{contactId:c.id,ended:true,result:'Não atendeu'},cookie)).status,200);
 }
 assert.equal(result.length,5);
 await assert.rejects(()=>h.call('/api/operator/claim','POST',{campaignId:id},cookie),/lista_sem_contatos_pendentes/);
 const status=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(status.body.contacts.filter(c=>c.status==='Não atendeu').length,5);
});
test('test campaign cannot dial unapproved numbers even inside business hours',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidPass789!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const camp=await h.call('/api/operator/campaign','POST',{name:'Teste inseguro',isTest:true},cookie);
 const id=camp.body.campaign.id;
 await h.call('/api/operator/import','POST',{campaignId:id,text:'Nome;Telefone\nSem consentimento;24999998888'},cookie);
 await h.call('/api/operator/pause','POST',{campaignId:id,paused:false},cookie);
 await assert.rejects(()=>h.call('/api/operator/claim','POST',{campaignId:id},cookie),/lista_sem_contatos_pendentes/);
});

test('isolated Directcall phone is only served to authenticated operators and fits nested integration',async()=>{
 const h=harness();
 const no=await h.call('/telefone');
 assert.equal(no.status,401);
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidStrongPass123!'});
 assert.equal(setup.status,201);
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const yes=await h.call('/telefone','GET',null,cookie);
 assert.equal(yes.status,200);
 assert.match(yes.headers['Content-Security-Policy'],/frame-ancestors 'self' https:\/\/central-de-ligacoes\.ricogisi\.chatgpt\.site/);
 assert.match(yes.body,/source:'central-phone'/);
 assert.match(yes.body,/m\.type==='dial'/);
});

test('easy three-step workflow displays while keeping advanced controls and secured phone',async()=>{
 const h=harness();
 const operator=await h.call('/operador');
 assert.equal(operator.status,200);
 assert.match(operator.body,/body class="easy-mode"/);
 assert.match(operator.body,/id="easyCampaign"/);
 assert.match(operator.body,/id="easyImport"/);
 assert.match(operator.body,/id="easyStart"/);
 assert.match(operator.body,/id="easySaveNext"/);
 assert.match(operator.body,/id="easyEnded"/);
 assert.match(operator.body,/id="easyPause"/);
 assert.match(operator.body,/id="easyModeToggle"/);
 assert.match(operator.body,/id="phoneFrame"/);
 assert.match(operator.body,/id="toggleCampaign"/);
});

test('Rico to Samira amended test campaign accepts first call without changing older list',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'ValidPass789!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const original='Nome;Telefone\nRico;24993285944\nIgor;24992002907\nBernardo;24993147385\nCris;24992678628\nLucas;24981352655';
 const amended='Nome;Telefone\nRico;24993285944\nIgor;24992002907\nBernardo;24993147385\nSamira;24981273160\nLucas;24981352655';
 const first=await h.call('/api/operator/test-list','POST',{name:'Lista antiga',text:original,consent:true},cookie);
 assert.equal(first.status,201);
 const updated=await h.call('/api/operator/test-list','POST',{name:'Lista atualizada com Samira',text:amended,consent:true},cookie);
 assert.equal(updated.status,201);assert.equal(updated.body.count,5);
 const camp=updated.body.campaign;
 assert.equal(camp.authorizedPhones.length,5);
 assert.equal(camp.authorizedPhones.includes('5524981273160'),true);
 assert.equal(camp.authorizedPhones.includes('5524992678628'),false);
 await h.call('/api/operator/pause','POST',{campaignId:camp.id,paused:false},cookie);
 const claimed=await h.call('/api/operator/claim','POST',{campaignId:camp.id},cookie);
 assert.equal(claimed.status,200);
 assert.equal(claimed.body.contact.name,'Rico');
 assert.equal(claimed.body.contact.phone,'5524993285944');
 const dial=await h.call('/api/operator/dial','POST',{contactId:claimed.body.contact.id},cookie,'rico-unique-safe-123456789');
 assert.equal(dial.status,200);
 assert.equal(dial.body.contact.attempts,1);
 assert.equal(dial.body.contact.status,'Comando enviado');
 assert.equal((await h.call('/api/operator/claim','POST',{campaignId:camp.id},cookie)).status,409);
});

test('safe retry for unconfirmed test dial is explicit and cannot cause unlimited calls',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Administrador',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const batch=await h.call('/api/operator/test-list','POST',{name:'Um dos cinco autorizados',text:'Nome;Telefone\nRico;24993285944\nIgor;24992002907',consent:true},cookie);
 assert.equal(batch.status,201);
 await h.call('/api/operator/pause','POST',{campaignId:batch.body.campaign.id,paused:false},cookie);
 const claimed=await h.call('/api/operator/claim','POST',{campaignId:batch.body.campaign.id},cookie);
 assert.equal(claimed.body.contact.name,'Rico');
 const id=claimed.body.contact.id;
 const sent=await h.call('/api/operator/dial','POST',{contactId:id},cookie,'first-dial-test-123456');
 assert.equal(sent.status,200);
 let retry=await h.call('/api/operator/retry-test','POST',{contactId:id,checkedNoActiveCall:false},cookie);
 assert.equal(retry.status,422);
 await assert.rejects(()=>h.call('/api/operator/retry-test','POST',{contactId:id,checkedNoActiveCall:true},cookie),/aguarde_15_segundos/);
 h.advance(15001);
 retry=await h.call('/api/operator/retry-test','POST',{contactId:id,checkedNoActiveCall:true},cookie);
 assert.equal(retry.status,200);
 assert.equal(retry.body.contact.status,'Reservado');
 assert.equal(retry.body.contact.attempts,1);
 const resent=await h.call('/api/operator/dial','POST',{contactId:id},cookie,'second-dial-test-12345');
 assert.equal(resent.status,200);
 assert.equal(resent.body.contact.attempts,2);
 h.advance(15001);
 await assert.rejects(()=>h.call('/api/operator/retry-test','POST',{contactId:id,checkedNoActiveCall:true},cookie),/repeticao_nao_autorizada/);
 const state=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(state.body.contacts[0].attempts,2);
});
