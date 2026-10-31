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
 const thirdChance=await h.call('/api/operator/retry-test','POST',{contactId:id,checkedNoActiveCall:true},cookie);
 assert.equal(thirdChance.status,200);
 assert.equal(thirdChance.body.contact.status,'Reservado');
 const third=await h.call('/api/operator/dial','POST',{contactId:id},cookie,'third-dial-test-123456');
 assert.equal(third.status,200);
 assert.equal(third.body.contact.attempts,3);
 h.advance(15001);
 await assert.rejects(()=>h.call('/api/operator/retry-test','POST',{contactId:id,checkedNoActiveCall:true},cookie),/repeticao_nao_autorizada/);
 const state=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(state.body.contacts[0].attempts,3);
});

test('operator may safely close a no-ring attempt and proceed to next without auto dial',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Admin',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const created=await h.call('/api/operator/test-list','POST',{name:'Primeira lista',text:'Nome;Telefone\nRico;24993285944\nIgor;24992002907',consent:true},cookie);
 assert.equal(created.status,201);
 const campaignId=created.body.campaign.id;
 await h.call('/api/operator/pause','POST',{campaignId,paused:false},cookie);
 const claimed=await h.call('/api/operator/claim','POST',{campaignId},cookie);
 const id=claimed.body.contact.id;
 assert.equal(claimed.body.contact.name,'Rico');
 await h.call('/api/operator/dial','POST',{contactId:id},cookie,'no-ring-example-key-1234567');
 const blocked=await h.call('/api/operator/no-ring','POST',{contactId:id,checkedNoActiveCall:false},cookie);
 assert.equal(blocked.status,422);
 await assert.rejects(()=>h.call('/api/operator/no-ring','POST',{contactId:id,checkedNoActiveCall:true},cookie),/aguarde_15_segundos_antes_de_revisar/);
 h.advance(15001);
 const closed=await h.call('/api/operator/no-ring','POST',{contactId:id,checkedNoActiveCall:true},cookie);
 assert.equal(closed.status,200);
 assert.equal(closed.body.contact.status,'Não chegou a ligar');
 assert.equal(closed.body.contact.owner,null);
 const next=await h.call('/api/operator/claim','POST',{campaignId},cookie);
 assert.equal(next.status,200);
 assert.equal(next.body.contact.name,'Igor');
 assert.equal(next.body.contact.attempts,0);
 const record=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(record.body.contacts[0].result,'Não chegou a ligar');
 assert.equal(record.body.contacts[0].attempts,1);
});

test('Directcall browser mode is explicitly enforced rather than desktop and handles async plugin startup',()=>{
 const fs=require('node:fs'),html=fs.readFileSync(require('node:path').join(__dirname,'telefone.html'),'utf8');
 assert.match(html,/directcall_app\(\{state:'open'/);
 assert.doesNotMatch(html,/directcall_app\(\{state:'hide'/);
 assert.match(html,/requestVendorAck\('0\|chamar\|'/);
 assert.match(html,/await loaded/);
 assert.match(html,/await new Promise\(resolve=>setTimeout\(resolve,3300\)\)/);
 assert.doesNotMatch(html,/app\(\)\.comando\('1\|chamar/);
 assert.match(html,/requestVendorAck\('0\|chamar\|'/);
 assert.match(html,/message\.state!==true/);
 assert.match(html,/requestVendorAck\('0\|verificar\|'/);
 assert.match(html,/mode:'app-web'/);
 const raw=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(raw);
 const vm=require('node:vm');
 new vm.Script(raw[1],{filename:'telefone-inline.js'});
});

test('phone loads even when Rico has an unresolved recorded attempt',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const src=fs.readFileSync(require('node:path').join(__dirname,'operador.js'),'utf8');
 const m=src.match(/async function sdk\(force=false\)\{[\s\S]*?\n\}\nfunction expandPhone/);
 assert.ok(m,'sdk implementation should be found');
 assert.match(m[0],/const alreadyLoaded=!!frame\.getAttribute\('src'\)/);
 assert.match(m[0],/if\(alreadyLoaded&&force&&staleAttempt\)/);
 assert.doesNotMatch(m[0],/if\(staleAttempt\)\s*\{[^}]*return;/);
 assert.match(m[0],/frame\.src='\/telefone\?ts='\+Date\.now\(\)/);
 const manual=src.match(/\$\('checkSdk'\)\.onclick=([^;]+);/);
 assert.ok(manual&&manual[1].includes('sdk(true)'), 'reconnect button should be an explicit user action');
 new vm.Script(src,{filename:'operador.js'});
});

test('supervised retry initiates provider command only after confirming no active call',()=>{
 const fs=require('node:fs'),src=fs.readFileSync(require('node:path').join(__dirname,'operador.js'),'utf8');
 const onRetry=src.slice(src.indexOf("$('easyRetry').onclick="),src.indexOf("$('easyNoRing').onclick="));
 assert.match(onRetry,/window\.confirm\(/);
 assert.match(onRetry,/if\(!sdkReady\)/);
 assert.match(onRetry,/await request\('retry-test'/);
 assert.match(onRetry,/await requestOneDial\(r\.contact\)/);
 assert.ok(onRetry.indexOf('window.confirm(')<onRetry.indexOf("await request('retry-test'"));
 assert.ok(onRetry.indexOf("await request('retry-test'")<onRetry.indexOf('await requestOneDial(r.contact)'));
});

test('Directcall inner app only automatically places call for position zero; probe is non-billable',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'telefone.html'),'utf8');
 const src=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(src);
 new vm.Script(src,{filename:'telefone-inline.js'});
 assert.match(src,/requestVendorAck\('0\|chamar\|'\+m\.phone\+'\|'\+id\+'\|'\+name/);
 assert.match(src,/requestVendorAck\('0\|verificar\|','probe-ack'/);
 assert.match(src,/e\.source!==f\?\.contentWindow/);
 assert.match(src,/e\.origin!=='https:\/\/www\.directcallsoft\.com'/);
 assert.doesNotMatch(src,/app\(\)\.comando\('1\|chamar/);
 const ui=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 assert.match(ui,/if\(m\.type==='dial-ack'\|\|m\.type==='probe-ack'\)/);
 assert.match(ui,/async function checkPhoneWithoutCall\(\)/);
 assert.match(ui,/type:'probe',requestId/);
});

test('one-tap result buttons save and start next only after confirmed provider hangup or operator verification',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const html=fs.readFileSync(path.join(__dirname,'operador.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 const phone=fs.readFileSync(path.join(__dirname,'telefone.html'),'utf8');
 assert.equal((html.match(/data-call-result=/g)||[]).length,6);
 for(const outcome of ['Atendeu','Não atendeu','Ocupado','Sem interesse','Retornar','Não ligar'])assert.match(html,new RegExp('data-call-result="'+outcome+'"'));
 assert.match(html,/id="easyHangupNotice"/);
 assert.match(ui,/if\(m\.type==='call-ended'\)/);
 assert.match(ui,/m\.requestId!==lastRequestedDial\.id/);
 assert.match(ui,/c\.phone!==event\.phone/);
 assert.match(ui,/vendorCallEnded=true/);
 assert.match(ui,/\$\('easyEnded'\)\.checked=true/);
 assert.match(ui,/if\(!vendorCallEnded&&!window\.confirm/);
 assert.match(ui,/await easyFinish\(true\)/);
 const vendor=phone.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(vendor);new vm.Script(vendor,{filename:'telefone-inline.js'});
 assert.match(vendor,/e\.origin!=='https:\/\/www\.directcallsoft\.com'/);
 assert.match(vendor,/message\.data==='Chamada encerrada!'/);
 assert.match(vendor,/callEndedRelayed=true/);
 assert.match(vendor,/inform\('call-ended'/);
 assert.doesNotMatch(vendor,/message\.state===true.*inform\('call-ended'/);
 new vm.Script(ui,{filename:'operador.js'});
});

test('automatic test queue advances only after explicit opt-in and provider-end confirmation; outcomes can be reviewed',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Admin',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const created=await h.call('/api/operator/test-list','POST',{name:'Dois testes',text:'Nome;Telefone\nRico;24993285944\nIgor;24992002907',consent:true},cookie);
 assert.equal(created.status,201);
 const campaignId=created.body.campaign.id;
 await h.call('/api/operator/pause','POST',{campaignId,paused:false},cookie);
 const claimed=await h.call('/api/operator/claim','POST',{campaignId},cookie);
 const id=claimed.body.contact.id;
 await h.call('/api/operator/dial','POST',{contactId:id},cookie,'auto-queue-rico-dial-123456');
 const rejected=await h.call('/api/operator/finish','POST',{contactId:id,result:'A classificar',ended:true},cookie);
 assert.equal(rejected.status,422);
 const done=await h.call('/api/operator/finish','POST',{contactId:id,result:'A classificar',ended:true,providerHangupVerified:true},cookie);
 assert.equal(done.status,200);
 assert.equal(done.body.contact.result,'A classificar');
 assert.equal(done.body.contact.owner,null);
 const next=await h.call('/api/operator/claim','POST',{campaignId},cookie);
 assert.equal(next.status,200);
 assert.equal(next.body.contact.name,'Igor');
 assert.equal(next.body.contact.attempts,0);
 const review=await h.call('/api/operator/reclassify','POST',{contactId:id,result:'Não ligar'},cookie);
 assert.equal(review.status,200);
 assert.equal(review.body.contact.result,'Não ligar');
 const state=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(state.body.contacts.find(x=>x.name==='Rico').attempts,1);
 assert.equal(state.body.contacts.find(x=>x.name==='Igor').status,'Reservado');
 assert.equal(state.body.blocked,1);
 await assert.rejects(()=>h.call('/api/operator/reclassify','POST',{contactId:id,result:'Atendeu'},cookie),/contato_nao_aguarda_classificacao/);
});
test('autonext frontend requires operator opt-in, test campaign, correlated vendor hangup and has fallback',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const html=fs.readFileSync(path.join(__dirname,'operador.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 assert.match(html,/id="easyAutoNext"/);
 assert.match(html,/id="reviewItems"/);
 assert.match(ui,/if\(autoCampaignId===c\.campaignId&&camp\?\.isTest&&!camp\.paused&&!sequencePaused&&sdkReady&&hangupBridgeReady\)/);
 assert.match(ui,/lastRequestedDial\.contactId!==c\.id/);
 assert.match(ui,/providerHangupVerified:callResult==='A classificar'&&vendorCallEnded/);
 assert.match(ui,/autoCampaignId=chosen\.isTest&&\$\('easyAutoNext'\)\.checked&&hangupBridgeReady\?campaignId:null/);
 assert.match(ui,/await request\('reclassify'/);
 new vm.Script(ui,{filename:'operador.js'});
});

test('single Start click enables automatic test sequence; provider callback is queued until state is up to date',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const html=fs.readFileSync(path.join(__dirname,'operador.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 assert.match(html,/id="easyAutoNext" type="checkbox" checked/);
 assert.match(html,/id="easyResumeAuto"/);
 assert.match(ui,/autoCampaignId=chosen\.isTest&&\$\('easyAutoNext'\)\.checked&&hangupBridgeReady\?campaignId:null/);
 assert.match(ui,/async function processQueuedHangup\(\)/);
 assert.match(ui,/if\(busy\|\|autoHangupProcessing\|\|!queuedHangup\)return/);
 assert.match(ui,/queuedHangup=m/);
 assert.match(ui,/if\(queuedHangup&&!autoHangupProcessing\)Promise\.resolve\(\)\.then\(processQueuedHangup\)/);
 assert.match(ui,/if\(autoCampaignId===c\.campaignId&&camp\?\.isTest&&!camp\.paused&&!sequencePaused&&sdkReady&&hangupBridgeReady\)/);
 assert.match(ui,/await finishCurrent\(true\)/);
 assert.match(ui,/if\(sequencePaused\)autoCampaignId=null/);
 assert.doesNotMatch(ui,/window\.confirm\('AUTORIZAR avanço automático/);
 new vm.Script(ui,{filename:'operador.js'});
});
test('pending outcome may be registered with one explicit operator hangup confirmation for recovery',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Admin',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const camp=await h.call('/api/operator/test-list','POST',{name:'Auto teste',text:'Nome;Telefone\nRico;24993285944\nIgor;24992002907',consent:true},cookie);
 const id=camp.body.campaign.id;
 await h.call('/api/operator/pause','POST',{campaignId:id,paused:false},cookie);
 const c=(await h.call('/api/operator/claim','POST',{campaignId:id},cookie)).body.contact;
 await h.call('/api/operator/dial','POST',{contactId:c.id},cookie,'unique-dial-manual-123456');
 let fail=await h.call('/api/operator/finish','POST',{contactId:c.id,result:'A classificar',ended:true},cookie);
 assert.equal(fail.status,422);
 const done=await h.call('/api/operator/finish','POST',{contactId:c.id,result:'A classificar',ended:true,operatorHangupConfirmed:true},cookie);
 assert.equal(done.status,200);
 assert.equal(done.body.contact.result,'A classificar');
 const next=await h.call('/api/operator/claim','POST',{campaignId:id},cookie);
 assert.equal(next.status,200);
 assert.equal(next.body.contact.name,'Igor');
});

test('outgoing hangup needs explicit Chrome detector and resume does not claim success on failure',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const ui=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 const tel=fs.readFileSync(path.join(__dirname,'telefone.html'),'utf8');
 assert.match(ui,/hangupBridgeReady=false/);
 assert.match(ui,/if\(m\.type==='hangup-bridge-ready'\)/);
 assert.match(ui,/hangupBridgeReady=true/);
 assert.match(ui,/if\(autoCampaignId===c\.campaignId&&camp\?\.isTest&&!camp\.paused&&!sequencePaused&&sdkReady&&hangupBridgeReady\)/);
 assert.match(ui,/const advance=await finishCurrent\(true,true\)/);
 assert.match(ui,/if\(advance\?\.kind==='dial-sent'\)/);
 assert.match(ui,/throw Error\('A ligação anterior foi salva, mas NÃO foi possível selecionar o próximo contato/);
 assert.match(tel,/source:'central-extension',type:'call-intent'/);
 assert.match(tel,/inform\('hangup-bridge-ready'/);
 assert.match(tel,/message\.requestId===latestCallRequest\.id/);
 assert.match(tel,/message\.phone===latestCallRequest\.phone/);
 const script=tel.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);new vm.Script(script,{filename:'telefone-inline.js'});
 new vm.Script(ui,{filename:'operador.js'});
});

test('operator diagnosis distinguishes blocked attempt from reserved contact and never dials by itself',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const html=fs.readFileSync(path.join(__dirname,'operador.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 assert.match(html,/id="easyDialDiagnosis"/);
 assert.match(ui,/['"]Comando enviado['"],['"]Resultado desconhecido['"]/);
 assert.match(ui,/BLOQUEIO:/);
 assert.match(ui,/CONTATO RESERVADO:/);
 assert.match(ui,/Detector automático NÃO conectado/);
 assert.match(ui,/\$\('easyDialDiagnosis'\)\.textContent=/);
 new vm.Script(ui,{filename:'operador.js'});
});

test('atomic resume ends Rico and reserves Igor in ONE operation with no duplicate dial',async()=>{
 const h=harness();
 const setup=await h.call('/api/operator/setup','POST',{key:'T'.repeat(40),name:'Admin',password:'VeryStrong123!!'});
 const cookie=setup.headers['Set-Cookie'].split(';')[0];
 const created=await h.call('/api/operator/test-list','POST',{name:'Sequencia autorizada',text:'Nome;Telefone\nRico;24993285944\nIgor;24992002907\nBernardo;24993147385',consent:true},cookie);
 assert.equal(created.status,201);
 const campaignId=created.body.campaign.id;
 await h.call('/api/operator/pause','POST',{campaignId,paused:false},cookie);
 const rico=(await h.call('/api/operator/claim','POST',{campaignId},cookie)).body.contact;
 assert.equal(rico.name,'Rico');
 await h.call('/api/operator/dial','POST',{contactId:rico.id},cookie,'rico-attempt-confirm-123456789');
 const withoutConfirmation=await h.call('/api/operator/resume-verified','POST',{contactId:rico.id,campaignId,endedConfirmed:false,noActiveCall:true},cookie);
 assert.equal(withoutConfirmation.status,422);
 const wrongCampaign=await h.call('/api/operator/resume-verified','POST',{contactId:rico.id,campaignId:'invalid',endedConfirmed:true,noActiveCall:true},cookie);
 assert.equal(wrongCampaign.status,409);
 const response=await h.call('/api/operator/resume-verified','POST',{contactId:rico.id,campaignId,endedConfirmed:true,noActiveCall:true},cookie);
 assert.equal(response.status,200);
 assert.equal(response.body.finished.name,'Rico');
 assert.equal(response.body.finished.result,'A classificar');
 assert.equal(response.body.next.name,'Igor');
 assert.equal(response.body.next.status,'Reservado');
 assert.equal(response.body.next.attempts,0,'atomic reserve must NOT initiate a phone call');
 const state=await h.call('/api/operator/view','GET',null,cookie);
 assert.equal(state.body.active.name,'Igor');
 assert.equal(state.body.contacts.find(c=>c.id===rico.id).owner,null);
 assert.equal(state.body.contacts.find(c=>c.name==='Bernardo').status,'Pendente');
 const again=await h.call('/api/operator/resume-verified','POST',{contactId:rico.id,campaignId,endedConfirmed:true,noActiveCall:true},cookie);
 assert.equal(again.status,409,'repeating resume must not start a duplicate call');
});
test('operator resume screen uses atomic endpoint, not disjoint finish-and-claim',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const js=fs.readFileSync(path.join(__dirname,'operador.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'operador.html'),'utf8');
 const resume=js.slice(js.indexOf("$('easyResumeAuto').onclick="),js.indexOf("$('easyStart').onclick="));
 assert.match(resume,/request\('resume-verified'/);
 assert.doesNotMatch(resume,/await finishCurrent\(/);
 assert.match(resume,/if\(advance\.next\.id===c\.id\)/);
 assert.match(resume,/await requestOneDial\(advance\.next\)/);
 assert.match(resume,/RETOMADA NÃO CONCLUÍDA/);
 assert.match(html,/id="easyResumeFeedback"/);
 assert.match(js,/if\(view\.active\?\.campaignId&&ids\.has\(view\.active\.campaignId\)\)/);
 new vm.Script(js,{filename:'operador.js'});
});
