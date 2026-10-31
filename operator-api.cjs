'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
function createOperatorApi({getState,transact,secret,setupKey,recoveryToken,recoveryExpiresAt=0,testPhones=[],now=()=>Date.now()}){
 const attempts=new Map();
 const empty=()=>({users:[],campaigns:[],contacts:[],blocked:[],events:[],revision:0});
 const data=()=>getState()?.operatorV1||empty();
 const safe=v=>String(v??'');
 const normal=v=>safe(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const phone=v=>{let x=safe(v).replace(/\D/g,'');if(x.length===10||x.length===11)x='55'+x;return /^55[1-9]\d(?:\d{8}|\d{9})$/.test(x)?x:null};
 const equals=(a,b)=>{const x=Buffer.from(safe(a)),y=Buffer.from(safe(b));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)};
 const hashPass=(pass,salt)=>crypto.scryptSync(pass,salt,64).toString('hex');
 const answer=(res,code,payload,extras={})=>{const body=JSON.stringify(payload);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(body),...extras});res.end(body)};
 const fail=(res,code,msg)=>answer(res,code,{error:msg});
 const parse=async(req)=>{let size=0,a=[];for await(const chunk of req){size+=chunk.length;if(size>1000000)throw Error('limite_de_conteudo');a.push(chunk)}const s=Buffer.concat(a).toString('utf8');return s?JSON.parse(s):{}};
 const clock=()=>new Date(now()).toISOString();
 const log=(s,actor,type,contact)=>{s.events.push({at:clock(),actor,type,contact:contact||null});s.events=s.events.slice(-2000)};
 const cookie=(req)=>{const m=(req.headers.cookie||'').match(/(?:^|;\s*)central_operator_session=([^;]+)/);return m?m[1]:''};
 const signin=(u)=>{const body=Buffer.from(JSON.stringify({id:u.id,sv:u.sessionVersion||0,exp:now()+12*3600000})).toString('base64url');const mac=crypto.createHmac('sha256',secret).update(body).digest('base64url');return body+'.'+mac};
 const authenticated=(req)=>{try{if(!secret||secret.length<32)return null;const [raw,signature]=cookie(req).split('.');if(!raw||!equals(crypto.createHmac('sha256',secret).update(raw).digest('base64url'),signature))return null;const info=JSON.parse(Buffer.from(raw,'base64url').toString());if(info.exp<now())return null;const u=data().users.find(x=>x.id===info.id)||null;return u&&(u.sessionVersion||0)===(info.sv||0)?u:null}catch{return null}};
 const basicUser=u=>({id:u.id,username:u.username,name:u.name,role:u.role});
 const cleanContact=c=>({id:c.id,campaignId:c.campaignId,name:c.name,phone:c.phone,status:c.status,attempts:c.attempts,owner:c.owner||null,requestedAt:c.requestedAt||null,finishedAt:c.finishedAt||null,callbackAt:c.callbackAt||null,notes:c.notes||'',result:c.result||null});
 const userView=u=>{const d=data(),own=d.contacts.find(c=>c.owner===u.id&&['Reservado','Comando enviado','Resultado desconhecido'].includes(c.status));return {user:basicUser(u),campaigns:d.campaigns,contacts:d.contacts.map(cleanContact),active:own?cleanContact(own):null,blocked:d.blocked.length,users:u.role==='admin'?d.users.map(basicUser):[],events:u.role==='admin'?d.events.slice(-100).reverse():[],revision:d.revision}};
 const transactData=async fn=>transact(async whole=>{whole.operatorV1||=empty();const d=whole.operatorV1;const out=await fn(d);d.revision++;return out});
 const originOk=req=>{const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host&&new URL(o).protocol==='https:'}catch{return false}};
 const limitKey=(req,scope)=>scope+'|'+safe(req.socket?.remoteAddress||'unknown').slice(0,120);
 const rate=(req,scope='general')=>{const key=limitKey(req,scope);const a=(attempts.get(key)||[]).filter(x=>now()-x<60000);attempts.set(key,a);return a.length<8};
 const recordFailure=(req,scope='general')=>{const key=limitKey(req,scope),a=(attempts.get(key)||[]).filter(x=>now()-x<60000);a.push(now());attempts.set(key,a)};
 const clearFailures=(req,scope='general')=>attempts.delete(limitKey(req,scope));
 const csvRows=t=>{const out=[];let row=[],item='',quoted=false;const delim=((t.split(/\r?\n/,1)[0].match(/;/g)||[]).length>=(t.split(/\r?\n/,1)[0].match(/,/g)||[]).length)?';':',';for(let i=0;i<t.length;i++){const c=t[i];if(c==='"'){if(quoted&&t[i+1]==='"'){item+='"';i++}else quoted=!quoted}else if(c===delim&&!quoted){row.push(item.trim());item=''}else if((c==='\r'||c==='\n')&&!quoted){row.push(item.trim());if(row.some(Boolean))out.push(row);row=[];item='';if(c==='\r'&&t[i+1]==='\n')i++}else item+=c}row.push(item.trim());if(row.some(Boolean))out.push(row);return out};
 const importRows=text=>{let rows=csvRows(safe(text).slice(0,400000));if(rows.length===1&&rows[0].length===1)rows=safe(text).split(/\r?\n/).filter(Boolean).map(r=>r.split(/\s{2,}/));const h=rows[0]?.map(v=>normal(v).replace(/[^a-z]/g,''))||[];const a=h.findIndex(x=>['nome','cliente','contato','name'].includes(x)),b=h.findIndex(x=>['telefone','celular','fone','numero','phone'].includes(x));if(a>=0&&b>=0)rows=rows.slice(1).map(r=>[r[a],r[b]]);return rows};
 const results=new Set(['Atendeu','Não atendeu','Ocupado','Retornar','Sem interesse','Não ligar','A classificar']);
 const allowTests=new Set(testPhones.map(phone).filter(Boolean));
 const canCall=(campaign,c)=>campaign?.isTest===true?(Array.isArray(campaign.authorizedPhones)?campaign.authorizedPhones.includes(c?.phone):(allowTests.has(c?.phone)||data().testPhonesAuthorized?.includes(c?.phone))):during();
 const during=()=>{const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short'}).format(now());const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now());return !['Sat','Sun'].includes(day)&&hour>='09:00'&&hour<'18:00'};
 const change=(s,c,actor,status,action)=>{c.status=status;log(s,actor,action,c.id)};
 async function handle(req,res,pathname){
  if(pathname==='/operador'&&req.method==='GET'){
   const embed=new URL(req.url,'https://central-ligacoes-motor-piloto.onrender.com').searchParams.get('embedded')==='1';
   let file=fs.readFileSync(path.join(__dirname,'operador.html'),'utf8');
   if(embed){const css=':root{background:#f4f7fb;color:#182c44}body{min-height:100%;background:#f4f7fb;color:#182c44}header{display:none!important}main{max-width:none;padding:10px 8px 28px}#auth{margin:18px auto}footer{display:none}.card,.stat{background:#fff;border-color:#d7e3ee;color:#182c44;box-shadow:0 1px 3px #162b4520;border-radius:12px}h1,h2,h3{color:#162c45}p,.sub,.muted,.stat span{color:#536c86}.pill{border-color:#bfcedd;color:#355672}.notice{background:#ecf4ff;border-color:#bdcfe2;color:#32516f}.notice.good{background:#e5f8f2;border-color:#a2d9c9;color:#17614d}.notice.warn{background:#fff6e6;border-color:#e2caa6;color:#815f20}.notice.error{background:#fff0f0;border-color:#e5b6b6;color:#962d35}.current{background:#f8fbff;border-color:#cedeed}.big{color:#162b44}.phone{color:#176ab5}.lbl{color:#416b95}.field label{color:#2c445f}.field input,.field textarea,.field select{background:#fff;color:#1d334a;border-color:#becfdf}input::placeholder,textarea::placeholder{color:#8294a5}.list{border-color:#d3dfe9}th{background:#eaf2fa;color:#24425f}th,td{border-color:#dbe5ef;color:#20354b}.btn.secondary{background:#eff5fc;color:#2a5176;border-color:#bfd2e6}.btn.warn{background:#fff4e9;color:#815029;border-color:#ddbe9e}.btn{min-height:43px}@media(max-width:900px){.layout{grid-template-columns:1fr}}';file=file.replace('</style>',css+'</style>')}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'self' https://central-de-ligacoes.ricogisi.chatgpt.site"});
   return res.end(file)
  }
  if(pathname==='/operador.js'&&req.method==='GET'){const file=fs.readFileSync(path.join(__dirname,'operador.js'));res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(file)}
  if(pathname==='/telefone'&&req.method==='GET'){
   if(!authenticated(req))return fail(res,401,'entre_na_central');
   const file=fs.readFileSync(path.join(__dirname,'telefone.html'));
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'self' https://central-de-ligacoes.ricogisi.chatgpt.site"});
   return res.end(file);
  }
  if(!pathname.startsWith('/api/operator/'))return false;
  if(req.method!=='GET'&&!originOk(req))return fail(res,403,'origem_invalida');
  if(pathname==='/api/operator/status'&&req.method==='GET')return answer(res,200,{configured:data().users.length>0,version:'1.0.0',mode:'discagem_assistida',provider:'directcall_app_web',external_calls_auto:false,persistent:true});
  if(pathname==='/api/operator/setup'&&req.method==='POST'){
   if(!setupKey||setupKey.length<24||!secret||secret.length<32)return fail(res,503,'configuracao_indisponivel');
   if(!rate(req,'setup'))return fail(res,429,'muitas_tentativas_aguarde_60_segundos');
   const b=await parse(req);if(!equals(safe(b.key),setupKey)){recordFailure(req,'setup');return fail(res,403,'convite_invalido')}
   if(data().users.length)return fail(res,409,'administrador_ja_configurado');
   const pass=safe(b.password),name=safe(b.name).trim().slice(0,70);if(pass.length<12||pass.length>128||!name)return fail(res,422,'nome_e_senha_de_12_caracteres_obrigatorios');
   const salt=crypto.randomBytes(16).toString('hex');
   const user=await transactData(async d=>{if(d.users.length)throw Error('configuracao_existente');const u={id:crypto.randomUUID(),username:'admin',name,role:'admin',salt,hash:hashPass(pass,salt)};d.users.push(u);log(d,u.id,'admin_configurado');return u});
   return answer(res,201,{user:basicUser(user)},{'Set-Cookie':'central_operator_session='+signin(user)+'; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=43200'});
  }
  if(pathname==='/api/operator/reset-password'&&req.method==='POST'){
   if(!rate(req,'reset'))return fail(res,429,'muitas_tentativas_aguarde_60_segundos');
   if(!recoveryToken||recoveryToken.length<48||!Number.isFinite(Number(recoveryExpiresAt))||now()>=Number(recoveryExpiresAt))return fail(res,403,'codigo_expirado_ou_indisponivel');
   const b=await parse(req),candidate=safe(b.code),pass=safe(b.password);
   if(pass.length<12||pass.length>128||candidate.length>160||!equals(candidate,recoveryToken)){recordFailure(req,'reset');return fail(res,403,'codigo_invalido_ou_senha_fora_do_padrao')}
   const tokenFingerprint=crypto.createHash('sha256').update(recoveryToken).digest('hex');
   const u=await transactData(async d=>{
    if(d.recoveryUsed===tokenFingerprint)throw Error('codigo_ja_utilizado');
    const admin=d.users.find(x=>x.role==='admin'&&x.username==='admin');if(!admin)throw Error('administrador_nao_encontrado');
    const salt=crypto.randomBytes(16).toString('hex');admin.salt=salt;admin.hash=hashPass(pass,salt);admin.sessionVersion=(admin.sessionVersion||0)+1;
    d.recoveryUsed=tokenFingerprint;log(d,admin.id,'senha_admin_redefinida');return basicUser(admin);
   });
   clearFailures(req,'login');clearFailures(req,'reset');return answer(res,200,{user:u,reset:true},{'Set-Cookie':'central_operator_session=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0'});
  }
  if(pathname==='/api/operator/login'&&req.method==='POST'){
   if(!rate(req,'login'))return fail(res,429,'muitas_tentativas_aguarde_60_segundos');
   const b=await parse(req);if(safe(b.password).length>128||safe(b.username).length>80){recordFailure(req,'login');return fail(res,401,'usuario_ou_senha_invalidos')}const u=data().users.find(x=>x.username===normal(b.username));if(!u||!equals(hashPass(safe(b.password),u.salt),u.hash)){recordFailure(req,'login');return fail(res,401,'usuario_ou_senha_invalidos')}
   clearFailures(req,'login');return answer(res,200,{user:basicUser(u)},{'Set-Cookie':'central_operator_session='+signin(u)+'; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=43200'});
  }
  if(pathname==='/api/operator/logout'&&req.method==='POST')return answer(res,200,{ok:true},{'Set-Cookie':'central_operator_session=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0'});
  const actor=authenticated(req);if(!actor)return fail(res,401,'entre_na_central');
  if(pathname==='/api/operator/view'&&req.method==='GET')return answer(res,200,userView(actor));
  if(pathname==='/api/operator/users'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req),username=normal(b.username),pass=safe(b.password);if(!/^[a-z0-9._-]{3,30}$/.test(username)||pass.length<12||pass.length>128||!safe(b.name).trim())return fail(res,422,'usuario_nome_senha_invalidos');
   const u=await transactData(async d=>{if(d.users.length>=5)throw Error('limite_quatro_operadores');if(d.users.some(u=>u.username===username))throw Error('usuario_duplicado');const salt=crypto.randomBytes(16).toString('hex');const item={id:crypto.randomUUID(),username,name:safe(b.name).trim().slice(0,70),salt,hash:hashPass(pass,salt),role:'agent'};d.users.push(item);log(d,actor.id,'operador_criado');return basicUser(item)});
   return answer(res,201,{user:u});
  }
  if(pathname==='/api/operator/self-test'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req),p=phone(b.phone),name=safe(b.name).trim().slice(0,90);
   if(!p||!name||b.owned!==true)return fail(res,422,'nome_telefone_e_confirmacao_de_autorizacao_obrigatorios');
   const v=await transactData(async d=>{
    d.testPhonesAuthorized||=[];
    const existing=d.contacts.find(c=>c.phone===p);
    if(existing){const camp=d.campaigns.find(x=>x.id===existing.campaignId);if(camp?.isTest)return {campaign:camp,contact:cleanContact(existing),alreadyExists:true};throw Error('numero_ja_cadastrado_em_outra_campanha')}
    if(d.testPhonesAuthorized.length>=30&&!d.testPhonesAuthorized.includes(p))throw Error('limite_total_de_numeros_de_teste');
    if(d.blocked.includes(p))throw Error('numero_bloqueado_nao_ligar');
    if(d.testPhonesAuthorized.indexOf(p)<0)d.testPhonesAuthorized.push(p);
    const camp={id:crypto.randomUUID(),name:'Teste Directcall — '+name,paused:true,isTest:true,authorizedPhones:[p],createdAt:clock()};
    const c={id:crypto.randomUUID(),campaignId:camp.id,name,phone:p,status:'Pendente',attempts:0,owner:null,requestedAt:null,finishedAt:null,callbackAt:null,notes:'Teste autorizado pelo administrador',result:null};
    d.campaigns.push(camp);d.contacts.push(c);
    log(d,actor.id,'numero_pessoal_de_teste_autorizado',c.id);
    return {campaign:camp,contact:cleanContact(c),alreadyExists:false}
   });
   return answer(res,201,v)
  }
  if(pathname==='/api/operator/test-list'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req),name=safe(b.name).trim().slice(0,80);
   if(b.consent!==true||!name)return fail(res,422,'autorizacao_expressa_e_nome_obrigatorios');
   const input=importRows(b.text);
   if(input.length<2||input.length>5)return fail(res,422,'lista_de_testes_precisa_de_2_a_5_contatos');
   const phones=new Set(),ready=[];
   for(const item of input){const p=phone(item[1]),n=safe(item[0]).trim().slice(0,100);
    if(!p||!n)return fail(res,422,'nome_ou_telefone_de_teste_invalido');
    if(phones.has(p))return fail(res,422,'telefone_duplicado_na_lista');
    phones.add(p);ready.push({name:n,phone:p});
   }
   const result=await transactData(async d=>{
    d.testPhonesAuthorized||=[];
    if(ready.some(c=>d.blocked.includes(c.phone)))throw Error('numero_bloqueado_nao_ligar');
    if(new Set([...d.testPhonesAuthorized,...ready.map(c=>c.phone)]).size>30)throw Error('limite_total_de_numeros_de_teste');
    if(d.contacts.length+ready.length>10000)throw Error('limite_global_de_contatos');
    const camp={id:crypto.randomUUID(),name,paused:true,isTest:true,authorizedPhones:ready.map(x=>x.phone),createdAt:clock()};
    d.campaigns.push(camp);
    for(const row of ready){if(!d.testPhonesAuthorized.includes(row.phone))d.testPhonesAuthorized.push(row.phone);
     const c={id:crypto.randomUUID(),campaignId:camp.id,name:row.name,phone:row.phone,status:'Pendente',attempts:0,owner:null,requestedAt:null,finishedAt:null,callbackAt:null,notes:'Teste de ligação em lista expressamente autorizado pelo administrador',result:null};d.contacts.push(c);
    }
    log(d,actor.id,'lista_de_testes_autorizada');return {campaign:camp,count:ready.length};
   });return answer(res,201,result);
  }
  // Recomeçar apenas uma campanha de TESTE. Não apaga auditoria nem desbloqueia DNC.
  // A confirmação humana de que não existe chamada ativa é obrigatória:
  // o APP Directcall não disponibiliza um status de linha confiável ao servidor.
  if(pathname==='/api/operator/test-reset'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req);
   if(b.confirmed!==true||b.checkedNoActiveCall!==true)return fail(res,422,'confirme_que_nao_ha_chamada_ativa_e_o_reinicio_da_lista');
   const selected=data().campaigns.find(c=>c.id===b.campaignId);
   if(!selected)return fail(res,404,'campanha_nao_encontrada');
   if(!selected.isTest)return fail(res,403,'somente_lista_de_teste_autorizada');
   const result=await transactData(async d=>{
    const camp=d.campaigns.find(c=>c.id===b.campaignId);
    if(!camp?.isTest)throw Error('somente_lista_de_teste_autorizada');
    const contacts=d.contacts.filter(c=>c.campaignId===camp.id);
    // Uma tentativa muito recente ainda pode estar tocando ou sendo encerrada.
    const unconfirmed=contacts.find(c=>['Comando enviado','Resultado desconhecido'].includes(c.status)&&c.requestedAt&&Number.isFinite(Date.parse(c.requestedAt))&&now()-Date.parse(c.requestedAt)<30000);
    if(unconfirmed)throw Error('aguarde_30_segundos_e_confirme_desligamento_na_directcall');
    camp.paused=true;
    let reset=0,blocked=0;
    for(const c of contacts){
     if(d.blocked.includes(c.phone)||c.status==='Não ligar'||c.result==='Não ligar'){
      c.owner=null;blocked++;continue;
     }
     c.status='Pendente';c.attempts=0;c.owner=null;c.lastKey=null;
     c.requestedAt=null;c.finishedAt=null;c.callbackAt=null;c.reservedAt=null;
     c.result=null;c.reviewOwner=null;c.notes='Teste reiniciado; contato autorizado';
     reset++;
    }
    log(d,actor.id,'lista_de_teste_reiniciada');
    return {campaignId:camp.id,paused:true,reset,blocked,total:contacts.length,meaning:'Lista de teste reiniciada e pausada; nenhuma ligacao foi solicitada. Auditoria e bloqueios foram preservados.'};
   });
   return answer(res,200,result);
  }
  if(pathname==='/api/operator/campaign'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req);if(!safe(b.name).trim())return fail(res,422,'nome_obrigatorio');
   const c=await transactData(async d=>{const c={id:crypto.randomUUID(),name:safe(b.name).trim().slice(0,80),paused:true,isTest:b.isTest===true,createdAt:clock()};d.campaigns.push(c);log(d,actor.id,'campanha_criada');return c});return answer(res,201,{campaign:c});
  }
  if(pathname==='/api/operator/import'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req),rows=importRows(b.text);if(rows.length>3200)return fail(res,422,'limite_3000_contatos');
   const counts=await transactData(async d=>{const camp=d.campaigns.find(x=>x.id===b.campaignId);if(!camp)throw Error('campanha_nao_encontrada');const seen=new Set(d.contacts.map(x=>x.phone));let added=0,duplicates=0,invalid=0,blocked=0;for(const row of rows){const p=phone(row[1]),name=safe(row[0]).trim().slice(0,100);if(!p||!name){invalid++;continue}if(d.blocked.includes(p)){blocked++;continue}if(seen.has(p)){duplicates++;continue}if(d.contacts.length>=10000)throw Error('limite_global_de_contatos');d.contacts.push({id:crypto.randomUUID(),campaignId:camp.id,name,phone:p,status:'Pendente',attempts:0,owner:null,requestedAt:null,finishedAt:null,callbackAt:null,notes:'',result:null});seen.add(p);added++}log(d,actor.id,'contatos_importados');return {added,duplicates,invalid,blocked}});return answer(res,200,counts);
  }
  if(pathname==='/api/operator/pause'&&req.method==='POST'){
   if(actor.role!=='admin')return fail(res,403,'somente_admin');
   const b=await parse(req);const c=await transactData(async d=>{const c=d.campaigns.find(x=>x.id===b.campaignId);if(!c)throw Error('campanha_nao_encontrada');c.paused=!!b.paused;log(d,actor.id,c.paused?'campanha_pausada':'campanha_reativada');return c});return answer(res,200,{campaign:c});
  }
  if(pathname==='/api/operator/claim'&&req.method==='POST'){
   const b=await parse(req);
   const active=data().contacts.find(c=>c.owner===actor.id&&['Reservado','Comando enviado','Resultado desconhecido'].includes(c.status));if(active)return fail(res,409,'ha_contato_em_andamento');
   const c=await transactData(async d=>{const camp=d.campaigns.find(x=>x.id===b.campaignId);if(!camp||camp.paused)throw Error('campanha_indisponivel_ou_pausada');const c=d.contacts.find(x=>x.campaignId===camp.id&&canCall(camp,x)&&!d.blocked.includes(x.phone)&&(x.status==='Pendente'||(x.status==='Retornar'&&x.callbackAt&&Date.parse(x.callbackAt)<=now()&&x.attempts<3)));if(!c)throw Error('lista_sem_contatos_pendentes');c.owner=actor.id;c.reservedAt=clock();change(d,c,actor.id,'Reservado','contato_reservado');return cleanContact(c)});return answer(res,200,{contact:c});
  }
  if(pathname==='/api/operator/dial'&&req.method==='POST'){
   const b=await parse(req),key=safe(req.headers['idempotency-key']);if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))return fail(res,422,'chave_de_operacao_obrigatoria');
   const c=await transactData(async d=>{const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id);if(!c)throw Error('contato_nao_reservado');if(c.lastKey===key)return cleanContact(c);if(c.status!=='Reservado'||c.attempts>=3)throw Error('ligacao_ja_solicitada_ou_limite_atingido');const camp=d.campaigns.find(x=>x.id===c.campaignId);if(!camp||camp.paused||!canCall(camp,c)||d.blocked.includes(c.phone))throw Error('discagem_bloqueada');c.attempts++;c.lastKey=key;c.requestedAt=clock();change(d,c,actor.id,'Comando enviado','solicitacao_reservada');return cleanContact(c)});return answer(res,200,{contact:c,meaning:'Permissao para enviar ao APP; NAO comprova chamada ou atendimento.'});
  }
  if(pathname==='/api/operator/retry-test'&&req.method==='POST'){
   const b=await parse(req);
   if(b.checkedNoActiveCall!==true)return fail(res,422,'confirmacao_de_nenhuma_chamada_ativa_obrigatoria');
   const contact=await transactData(async d=>{
    const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&['Comando enviado','Resultado desconhecido'].includes(x.status));
    if(!c)throw Error('nenhuma_tentativa_para_revisar');
    const camp=d.campaigns.find(x=>x.id===c.campaignId);
    if(!camp?.isTest||!canCall(camp,c)||c.attempts>=3)throw Error('repeticao_nao_autorizada');
    if(!c.requestedAt||now()-Date.parse(c.requestedAt)<15000)throw Error('aguarde_15_segundos_antes_de_revisar');
    c.status='Reservado';c.lastKey=null;log(d,actor.id,'repeticao_de_teste_autorizada_apos_conferencia',c.id);
    return cleanContact(c)
   });return answer(res,200,{contact,meaning:'Contato liberado para uma única nova tentativa após confirmação de ausência de chamada ativa. Não disca automaticamente.'});
  }

  if(pathname==='/api/operator/no-ring'&&req.method==='POST'){
   const b=await parse(req);
   if(b.checkedNoActiveCall!==true)return fail(res,422,'confirme_que_nenhuma_chamada_esta_ativa');
   const c=await transactData(async d=>{
    const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&['Comando enviado','Resultado desconhecido'].includes(x.status));
    if(!c)throw Error('nenhuma_tentativa_para_revisar');
    const camp=d.campaigns.find(x=>x.id===c.campaignId);
    if(!camp?.isTest)throw Error('somente_lista_de_teste_autorizada');
    if(!c.requestedAt||now()-Date.parse(c.requestedAt)<15000)throw Error('aguarde_15_segundos_antes_de_revisar');
    c.result='Não chegou a ligar';c.finishedAt=clock();c.notes=(safe(c.notes)+' | Sem toque; operador verificou ausência de chamada ativa').trim().slice(0,1000);
    c.owner=null;change(d,c,actor.id,'Não chegou a ligar','teste_sem_toque_encerrado_sem_rediscar');return cleanContact(c);
   });
   return answer(res,200,{contact:c,meaning:'A tentativa foi encerrada como sem toque. Não houve rediscagem e este contato não voltará automaticamente para a fila.'});
  }
  if(pathname==='/api/operator/unknown'&&req.method==='POST'){
   const b=await parse(req);const c=await transactData(async d=>{const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&x.status==='Comando enviado');if(!c)throw Error('solicitacao_nao_encontrada');change(d,c,actor.id,'Resultado desconhecido','comando_nao_confirmado');return cleanContact(c)});return answer(res,200,{contact:c});
  }
  if(pathname==='/api/operator/skip'&&req.method==='POST'){
   const b=await parse(req);const c=await transactData(async d=>{const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&x.status==='Reservado');if(!c)throw Error('nao_pode_pular_chamada_solicitada');c.owner=null;c.finishedAt=clock();change(d,c,actor.id,'Pulado','contato_pulado');return cleanContact(c)});return answer(res,200,{contact:c});
  }
  // Recover one historical call and reserve the NEXT authorised test contact atomically.
  // Never sends a PSTN request: the authenticated browser must separately dial next.
  if(pathname==='/api/operator/resume-verified'&&req.method==='POST'){
   const b=await parse(req);
   if(b.endedConfirmed!==true||b.noActiveCall!==true)return fail(res,422,'confirmacao_de_encerramento_obrigatoria');
   const current=data().contacts.find(x=>x.id===b.contactId&&x.owner===actor.id);
   if(!current||current.campaignId!==b.campaignId||!['Comando enviado','Resultado desconhecido'].includes(current.status))
    return fail(res,409,'tentativa_pendente_nao_encontrada');
   const selected=data().campaigns.find(x=>x.id===current.campaignId);
   if(!selected?.isTest)return fail(res,403,'somente_lista_de_teste_autorizada');
   if(selected.paused&&actor.role!=='admin')return fail(res,409,'campanha_pausada_pelo_administrador');
   const result=await transactData(async d=>{
    const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&x.campaignId===b.campaignId&&['Comando enviado','Resultado desconhecido'].includes(x.status));
    if(!c)throw Error('tentativa_pendente_nao_encontrada');
    const camp=d.campaigns.find(x=>x.id===c.campaignId);
    if(!camp?.isTest)throw Error('somente_lista_de_teste_autorizada');
    if(camp.paused){
     if(actor.role!=='admin')throw Error('campanha_pausada_pelo_administrador');
     camp.paused=false;log(d,actor.id,'campanha_de_teste_reativada_por_retomada');
    }
    c.result='A classificar';c.finishedAt=clock();c.callbackAt=null;c.owner=null;c.reviewOwner=actor.id;
    c.notes=(safe(c.notes)+' | Operador confirmou no painel o encerramento da tentativa antes de retomar').trim().slice(0,1000);
    change(d,c,actor.id,'A classificar','chamada_encerrada_por_confirmacao_para_retomada');
    const next=d.contacts.find(x=>x.campaignId===camp.id&&x.id!==c.id&&canCall(camp,x)&&!d.blocked.includes(x.phone)&&(x.status==='Pendente'||(x.status==='Retornar'&&x.callbackAt&&Date.parse(x.callbackAt)<=now()&&x.attempts<3)));
    if(next){
     next.owner=actor.id;next.reservedAt=clock();change(d,next,actor.id,'Reservado','proximo_contato_reservado_apos_retomada');
    }
    return {finished:cleanContact(c),next:next?cleanContact(next):null};
   });
   return answer(res,200,{...result,meaning:'Tentativa antiga encerrada e próximo contato reservado na mesma operação. Nenhuma chamada enviada ao provedor.'});
  }
  // Fast path for an already-observed provider hangup in an authorised TEST campaign.
  // Finish and reserve next contact in one durable transaction. NEVER dials PSTN here.
  // A new call still needs the explicit browser session that started the test and
  // its independent provider command. Invalid/replayed events cannot reserve twice.
  if(pathname==='/api/operator/auto-advance'&&req.method==='POST'){
   const b=await parse(req);
   if(b.providerHangupVerified!==true)return fail(res,422,'encerramento_do_provedor_obrigatorio');
   const previous=await transactData(async d=>{
    const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&x.campaignId===b.campaignId&&['Comando enviado','Resultado desconhecido'].includes(x.status));
    if(!c)throw Error('tentativa_atual_nao_encontrada');
    const camp=d.campaigns.find(x=>x.id===c.campaignId);
    if(!camp?.isTest||camp.paused||!canCall(camp,c))throw Error('somente_campanha_de_teste_ativa_autorizada');
    const another=d.contacts.find(x=>x.owner===actor.id&&x.id!==c.id&&['Reservado','Comando enviado','Resultado desconhecido'].includes(x.status));
    if(another)throw Error('outra_chamada_reservada');
    c.result='A classificar';c.finishedAt=clock();c.callbackAt=null;c.owner=null;c.reviewOwner=actor.id;
    c.notes=(safe(c.notes)+' | Encerramento informado pela Directcall; classificação pendente').trim().slice(0,1000);
    change(d,c,actor.id,'A classificar','chamada_encerrada_classificacao_pendente');
    const next=d.contacts.find(x=>x.campaignId===camp.id&&x.id!==c.id&&canCall(camp,x)&&!d.blocked.includes(x.phone)&&(x.status==='Pendente'||(x.status==='Retornar'&&x.callbackAt&&Date.parse(x.callbackAt)<=now()&&x.attempts<3)));
    if(next){
     next.owner=actor.id;next.reservedAt=clock();change(d,next,actor.id,'Reservado','proximo_contato_reservado_apos_encerramento');
    }
    return {finished:cleanContact(c),next:next?cleanContact(next):null};
   });
   return answer(res,200,{...previous,meaning:'Chamada finalizada e próximo número somente reservado. Nenhuma nova chamada foi discada pelo servidor.'});
  }
  if(pathname==='/api/operator/finish'&&req.method==='POST'){
   const b=await parse(req);if(b.ended!==true||!results.has(b.result))return fail(res,422,'confirmacao_encerramento_e_resultado_obrigatorios');
   if(b.result==='A classificar'&&b.providerHangupVerified!==true&&b.operatorHangupConfirmed!==true)return fail(res,422,'encerramento_do_provedor_ou_operador_necessario');
   if(b.result==='Retornar'&&(!b.callbackAt||Number.isNaN(Date.parse(b.callbackAt))||Date.parse(b.callbackAt)<now()||Date.parse(b.callbackAt)>now()+30*86400000))return fail(res,422,'data_de_retorno_invalida');
   const c=await transactData(async d=>{
    const c=d.contacts.find(x=>x.id===b.contactId&&x.owner===actor.id&&['Reservado','Comando enviado','Resultado desconhecido'].includes(x.status));
    if(!c)throw Error('contato_indisponivel');
    const camp=d.campaigns.find(x=>x.id===c.campaignId);
    if(b.result==='A classificar'&&(!camp?.isTest||!['Comando enviado','Resultado desconhecido'].includes(c.status)))throw Error('classificacao_pendente_permitida_apenas_em_teste');
    c.result=b.result;c.notes=safe(b.notes).slice(0,1000);
    c.finishedAt=clock();c.callbackAt=b.result==='Retornar'?new Date(b.callbackAt).toISOString():null;c.owner=null;
    if(b.result==='A classificar'){c.reviewOwner=actor.id;c.notes=(c.notes+(b.providerHangupVerified===true?' | Encerramento informado pelo aplicativo Directcall; classificação pendente':' | Encerramento confirmado manualmente pelo operador; classificação pendente')).slice(0,1000);}
    if(b.result==='Não ligar'&&!d.blocked.includes(c.phone))d.blocked.push(c.phone);
    change(d,c,actor.id,b.result,b.result==='A classificar'?'chamada_encerrada_classificacao_pendente':'chamada_classificada');
    return cleanContact(c);
   });return answer(res,200,{contact:c});
  }
  if(pathname==='/api/operator/reclassify'&&req.method==='POST'){
   const b=await parse(req);
   if(!results.has(b.result)||b.result==='A classificar')return fail(res,422,'classificacao_invalida');
   if(b.result==='Retornar'&&(!b.callbackAt||Number.isNaN(Date.parse(b.callbackAt))||Date.parse(b.callbackAt)<=now()||Date.parse(b.callbackAt)>now()+30*86400000))return fail(res,422,'data_de_retorno_invalida');
   const c=await transactData(async d=>{
    const c=d.contacts.find(x=>x.id===b.contactId&&x.result==='A classificar'&&x.status==='A classificar');
    if(!c)throw Error('contato_nao_aguarda_classificacao');
    if(actor.role!=='admin'&&c.reviewOwner!==actor.id)throw Error('sem_permissao_para_classificar');
    c.result=b.result;c.callbackAt=b.result==='Retornar'?new Date(b.callbackAt).toISOString():null;c.reviewOwner=null;
    c.notes=(c.notes+' | Classificação concluída').slice(0,1000);
    if(b.result==='Não ligar'&&!d.blocked.includes(c.phone))d.blocked.push(c.phone);
    change(d,c,actor.id,b.result,'chamada_reclassificada');return cleanContact(c);
   });return answer(res,200,{contact:c});
  }
  if(pathname==='/api/operator/export'&&req.method==='GET'){if(actor.role!=='admin')return fail(res,403,'somente_admin');const d=data();const q=x=>'"'+safe(x).replace(/"/g,'""')+'"';const rows=[['Campanha','Nome','Telefone','Status','Resultado','Tentativas','Responsável','Solicitada em','Encerrada em','Retorno','Notas'],...d.contacts.map(c=>[d.campaigns.find(x=>x.id===c.campaignId)?.name||'',c.name,c.phone,c.status,c.result,c.attempts,d.users.find(x=>x.id===c.owner)?.name||'',c.requestedAt,c.finishedAt,c.callbackAt,c.notes])];const out='\ufeff'+rows.map(r=>r.map(q).join(';')).join('\r\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="central-operadores.csv"','Cache-Control':'no-store'});return res.end(out)}
  return fail(res,404,'rota_nao_encontrada');
 }
 return {handle};
}
module.exports={createOperatorApi};
