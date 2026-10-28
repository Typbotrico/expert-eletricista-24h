'use strict';
/** Central de Ligações — motor intermediário de homologação.
 * Segurança: chamadas externas INTENCIONALMENTE DESABILITADAS.
 * Sem dependências, sem armazenar telefones no GitHub, sem CORS.
 * Fila e resultados persistidos no D1 do site original. PSTN bloqueada.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const ext=require('./pilot-external.cjs');
const DASHBOARD_HTML = "<!doctype html>\n<html lang=\"pt-BR\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Central de Ligações — Motor piloto</title>\n<style>\n:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#071121;color:#edf5ff}\n*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 70% -10%,#143f75 0,transparent 47%),#071121}\nmain{max-width:1120px;margin:0 auto;padding:36px 24px 65px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #253c56;padding-bottom:22px;flex-wrap:wrap}\n.brand{display:flex;align-items:center;gap:14px}.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(135deg,#22bbf4,#3464ef);font-weight:900;font-size:26px;box-shadow:0 0 30px #147dd83d}\n.brandname{font-weight:800;font-size:20px;letter-spacing:.02em}.muted{color:#9eb3cd;font-size:14px}.capsule{border:1px solid #36516e;background:#0f2136;border-radius:24px;padding:10px 15px;font-size:13px}\nh1{font-size:clamp(26px,4vw,40px);line-height:1.18;margin:40px 0 12px}p{line-height:1.65}.sub{max-width:780px;color:#b4c9e1;margin-bottom:30px}\n.row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.tile,.panel{border:1px solid #263e5a;border-radius:18px;background:#0d2138dd;padding:22px}.tile span{font-size:13px;color:#9eb6d0}.tile strong{display:block;font-size:33px;margin-top:10px;letter-spacing:-.02em}.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;margin-top:17px}.panel h2{font-size:17px;margin:0 0 22px}.line{padding:13px 0;border-top:1px solid #233a55;display:flex;align-items:center;justify-content:space-between;gap:12px}.line strong{font-size:14px;text-align:right}.ok{color:#50e0ac}.warn{color:#ffcf79}.danger{color:#ffa39a}.notice{margin-top:20px;border:1px solid #54472d;background:#34271466;border-radius:14px;padding:18px;color:#ffe1ad;font-size:14px}.foot{margin-top:28px;color:#8da9c8;font-size:13px}a{color:#8cc4ff}small{font-size:12px;color:#9cb3ce}\n@media(max-width:750px){.row{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.tile,.panel{padding:17px}.tile strong{font-size:27px}}\n</style></head>\n<body><main>\n<header><div class=\"brand\"><div class=\"mark\">C</div><div><div class=\"brandname\">CENTRAL DE LIGAÇÕES</div><div class=\"muted\">Motor operacional · homologação</div></div></div><div class=\"capsule\" id=\"updated\">Conferindo sistema…</div></header>\n<h1>Monitor de operação</h1>\n<p class=\"sub\">Acompanhamento em tempo real da infraestrutura de testes. Este motor é separado do site original. Nenhuma chamada externa está autorizada nesta fase.</p>\n<section class=\"row\" aria-label=\"Indicadores\">\n<div class=\"tile\"><span>Campanhas importadas</span><strong id=\"campaigns\">—</strong></div>\n<div class=\"tile\"><span>Contatos no backup</span><strong id=\"contacts\">—</strong></div>\n<div class=\"tile\"><span>Exemplos bloqueados</span><strong id=\"blocked\">—</strong></div>\n<div class=\"tile\"><span>Testes internos reportados</span><strong id=\"tests\">—</strong></div>\n</section>\n<section class=\"grid\"><div class=\"panel\"><h2>Telefonia e integração</h2>\n<div class=\"line\"><span>API do motor</span><strong class=\"ok\" id=\"health\">Verificando…</strong></div>\n<div class=\"line\"><span>Agente Asterisk do notebook</span><strong id=\"agent\">Verificando…</strong></div>\n<div class=\"line\"><span>Chamadas para clientes</span><strong class=\"danger\">Bloqueadas</strong></div>\n<div class=\"line\"><span>Conexão com site original</span><strong class=\"ok\">Backend integrado</strong></div>\n<div class=\"line\"><span>Testes internos na fila</span><strong id=\"pending\">—</strong></div>\n</div><div class=\"panel\"><h2>Último teste Asterisk</h2>\n<div class=\"line\"><span>Resultado do agente</span><strong id=\"result\">Nenhum registro atual</strong></div>\n<div class=\"line\"><span>Horário do registro</span><strong id=\"testtime\">—</strong></div>\n<div class=\"line\"><span>Rota permitida</span><strong>1001 → eco 600</strong></div>\n<div class=\"line\"><span>Operadora</span><strong class=\"warn\">Directcall · aguardando novo teste</strong></div>\n</div></section>\n<div class=\"notice\"><strong>Ambiente protegido.</strong> O motor só pode enfileirar teste interno do ramal 1001. Não executa campanhas de saída; o agente instalado no computador é necessário para tocar o MicroSIP. Os resultados do piloto são temporários e podem desaparecer após reinício do servidor.</div>\n<p class=\"foot\">Atualização automática a cada 12 segundos. <a href=\"/health\" target=\"_blank\" rel=\"noreferrer\">Ver resposta técnica</a>. Este painel é somente leitura e não exibe telefones ou chaves de acesso.</p>\n</main>\n<script>\n(function(){'use strict';\nconst set=(id,v)=>{document.getElementById(id).textContent=String(v)};\nfunction relative(ts){if(!ts)return '—';const d=new Date(ts);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});}\nasync function refresh(){try{\nconst response=await fetch('/api/public/status',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);\nconst d=await response.json();if(d.external_calls_enabled!==false)throw Error('Estado de telefonia inesperado');\nset('health',d.ready?'Online':'Indisponível');set('campaigns',d.totals.campaigns);set('contacts',d.totals.contacts);\nset('blocked',d.totals.fictitious_blocked);set('tests',d.totals.internal_test_jobs_completed);\nset('pending',d.totals.active_internal_jobs);set('agent',d.agent_connected?'Conectado':'Desconectado');\ndocument.getElementById('agent').className=d.agent_connected?'ok':'warn';\nset('result',d.last_internal_result?d.last_internal_result.outcome:'Sem teste recente');\nset('testtime',relative(d.last_internal_result?.at));set('updated','Online · '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'}));\n}catch(err){set('updated','Erro ao consultar servidor');set('health','Indisponível')}}\nrefresh();setInterval(refresh,12000);\n})();\n</script></body></html>";

const copy=x=>JSON.parse(JSON.stringify(x));
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)};
const safe=v=>String(v??'');
const validPhone=v=>/^55[1-9]\d(?:\d{8}|\d{9})$/.test(v);
function parseBackup(obj){
 if(!obj||!Array.isArray(obj.campaigns)||obj.campaigns.length>30)throw Error('Backup inválido');
 const result=copy(obj),ids=new Set();let total=0;
 for(const c of result.campaigns){
  if(!c||typeof c.id!=='string'||ids.has(c.id)||!Array.isArray(c.contacts)||c.contacts.length>5000)throw Error('Campanha inválida');ids.add(c.id);total+=c.contacts.length;
  if(total>10000)throw Error('Limite excedido');
  for(const p of c.contacts){if(!p||typeof p.id!=='string'||typeof p.phone!=='string')throw Error('Contato inválido');}
 }
 return result;
}
function stats(c,backup){
 const block=new Set([...(backup.globalBlock||[]),...(c.block||[])]);
 const fictional=p=>p.demo===true||/exemplo|fict[ií]ci/i.test(safe(p.note)+' '+safe(p.name));
 return {id:c.id,name:c.name,total:c.contacts.length,fictional:c.contacts.filter(fictional).length,pending:c.contacts.filter(p=>p.status==='Pendente').length,eligible_for_future_validation:c.contacts.filter(p=>!fictional(p)&&validPhone(p.phone)&&p.status==='Pendente'&&!block.has(p.phone)&&!block.has(p.id)).length,agents:c.agents,lines:c.lines,hours:c.start+'–'+c.end};
}
function empty(backup){return {version:1,backup:parseBackup(backup),queue:[],history:[],lastQueuedAt:0,completedInternalTests:0,lastAgentResult:null,campaignControl:{}};}
function remoteStore(config){
 let revision=0;
 const url=new URL(config.url);
 if(url.protocol!=='https:'||url.origin!=='https://central-de-ligacoes.ricogisi.chatgpt.site'||url.pathname!=='/api/internal/motor-state')throw Error('Persistência não autorizada');
 const request=async(method,body)=>{
  const r=await fetch(url,{method,headers:{Authorization:'Bearer '+config.token,'OAI-Sites-Authorization':'Bearer '+config.siteToken,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('Persistência indisponível (HTTP '+r.status+')');return r.json();
 };
 return {async load(){const d=await request('GET');revision=d.revision;return d.state},async save(state){const d=await request('PUT',{revision,state});revision=d.revision},kind:'D1'};
}
function createMotor({adminToken,agentToken,store,backup={selected:'',campaigns:[],globalBlock:[]},now=()=>Date.now(),pilotCampaignId='1d98902a-3054-48ba-b1d4-686a8ff9a9c7'}){
 if(!adminToken||adminToken.length<32||!agentToken||agentToken.length<32||adminToken===agentToken)throw Error('Credenciais separadas obrigatórias');
 let state,ready=false,storageHealthy=false,agentSeenAt=0,amiReady=false,integrated=false;
 const policy=ext.policyFromBackup(backup,pilotCampaignId);let agentVersion='',agentRouteHash='';
 let chain=Promise.resolve();
 const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const audit=(s,type,fields={})=>{s.history.push({at:new Date(now()).toISOString(),type,...fields});s.history=s.history.slice(-1000)};
 const save=async next=>{try{await store.save(next);state=next;storageHealthy=true}catch{storageHealthy=false;throw Error('Persistência indisponível; operação não confirmada')}};
 async function init(){
  const saved=await store.load();state=saved||empty(backup);
  if(state.version!==1||!Array.isArray(state.queue)||!state.backup)throw Error('Estado persistido inválido');
  parseBackup(state.backup);
  // Work already handed to AMI must never be silently retried after a restart.
  for(const j of state.queue)if(j.state==='leased'){j.state='unknown';j.phase='unknown';audit(state,'reinicio_com_resultado_desconhecido',{id:j.id})}
  await save(state);ready=true;
 }
 function pilotStatus(){const candidate=ext.candidate(state,policy,now());const connected=agentSeenAt>0&&now()-agentSeenAt<60000&&amiReady;const routeReady=Boolean(policy&&agentRouteHash===policy.phoneHash&&agentVersion==='0.6.0');return {ready:connected&&routeReady&&!candidate.error,routeReady,agentVersion,reason:candidate.error||(!connected?'agente_ou_ami_desconectado':!routeReady?'atualizar_agente_e_validar_rota_700':null),campaignId:policy?.campaignId||null,seller:'1001',route:'700',maxActive:1};}
 function status(){
  const cs=state?.backup.campaigns||[],ss=cs.map(c=>stats(c,state.backup));
  return {service:'central-ligacoes-motor',mode:'piloto',version:'0.6.0',ready:ready&&storageHealthy,external_calls_enabled:false,carrier_status:'Saída pela extensão 700 validada manualmente pelo proprietário; piloto automático em homologação',agent_connected:agentSeenAt>0&&now()-agentSeenAt<60000,asterisk_connected:amiReady&&agentSeenAt>0&&now()-agentSeenAt<60000,totals:{campaigns:cs.length,contacts:ss.reduce((n,c)=>n+c.total,0),fictitious_blocked:ss.reduce((n,c)=>n+c.fictional,0),eligible_for_future_validation:ss.reduce((n,c)=>n+c.eligible_for_future_validation,0),internal_test_jobs_completed:state?.completedInternalTests||0,active_internal_jobs:(state?.queue||[]).filter(j=>!ext.external(j)&&ext.active(j)).length,active_external_jobs:(state?.queue||[]).filter(j=>ext.external(j)&&ext.active(j)).length},last_internal_result:state?.lastAgentResult||null,persistence:store.kind,storage_healthy:storageHealthy,site_original_integrated:integrated};
 }
 const reply=(res,code,body)=>{const data=JSON.stringify(body);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(data)});res.end(data)};
 const read=async req=>{let size=0,chunks=[];for await(const part of req){size+=part.length;if(size>1500000)throw Error('Payload excedido');chunks.push(part)}return chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{}};
 const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&(path==='/health'||path==='/api/public/status'))return reply(res,ready&&storageHealthy?200:503,status());
  if(req.method==='GET'&&path==='/'){
   const html=DASHBOARD_HTML.replace('Os resultados do piloto são temporários e podem desaparecer após reinício do servidor.','Fila e resultados do motor são persistidos no banco da Central original.').replace("d.last_internal_result.outcome","d.last_internal_result.outcome");
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Frame-Options':'DENY'});return res.end(html);
  }
  const presented=safe(req.headers.authorization).replace(/^Bearer /,'');
  const role=equal(presented,adminToken)?'admin':equal(presented,agentToken)?'agent':null;
  // A pairing code is single use, short-lived and only enrolls the fixed internal agent.
  if(path==='/api/agent/enroll'&&req.method==='POST'){
   if(!ready||!storageHealthy)return reply(res,503,{error:'persistencia_indisponivel'});
   try{return await serial(async()=>{
    const {code}=await read(req);if(typeof code!=='string'||! /^[a-f0-9]{64}$/.test(code))return reply(res,401,{error:'pareamento_invalido'});
    const hash=crypto.createHash('sha256').update(code).digest('hex'),pair=state.pairing;
    if(!pair||pair.expiresAt<now()||!equal(hash,pair.hash))return reply(res,401,{error:'pareamento_invalido_ou_expirado'});
    const next=copy(state);delete next.pairing;audit(next,'agente_pareado');await save(next);
    return reply(res,200,{agentToken,scope:'internal_echo_1001',endpoint:'https://central-ligacoes-motor-piloto.onrender.com'});
   })}catch{return reply(res,503,{error:'pareamento_indisponivel'})}
  }
  if(!role)return reply(res,401,{error:'token_invalido'});
  if((path.startsWith('/api/agent/')&&role!=='agent')||(!path.startsWith('/api/agent/')&&role!=='admin'))return reply(res,403,{error:'escopo_insuficiente'});
  if(!ready||!storageHealthy)return reply(res,503,{error:'persistencia_indisponivel'});
  if(role==='admin'&&req.headers['x-workspace-id'])integrated=true;
  if(path==='/api/admin/status'&&req.method==='GET')return reply(res,200,{...status(),campaigns:state.backup.campaigns.map(c=>stats(c,state.backup)),campaignControl:state.campaignControl,pilot:pilotStatus()});
  if(path==='/api/campaigns'&&req.method==='GET')return reply(res,200,{selected:state.backup.selected,campaigns:state.backup.campaigns.map(c=>stats(c,state.backup)),external_calls_enabled:false});
  if(path==='/api/audit'&&req.method==='GET')return reply(res,200,{history:state.history,queue:state.queue.map(({id,state,kind,createdAt,outcome})=>({id,state,kind,createdAt,outcome}))});
  if(path==='/api/calls'&&req.method==='GET')return reply(res,200,{calls:state.queue.filter(ext.external).slice(-50).reverse().map(ext.callView),pilot:pilotStatus()});
  try{await serial(async()=>{
   if(path==='/api/admin/pair'&&req.method==='POST'){
    const code=crypto.randomBytes(32).toString('hex'),next=copy(state),expiresAt=now()+10*60*1000;
    next.pairing={hash:crypto.createHash('sha256').update(code).digest('hex'),expiresAt};audit(next,'pareamento_criado');await save(next);
    return reply(res,201,{code,expiresAt,scope:'somente 1001 → eco 600'});
   }
   const s=copy(state);let changed=false;
   for(const j of s.queue){if((j.state==='leased'&&now()-(j.progressAt||j.leasedAt)>(ext.external(j)?300000:90000))||(j.state==='queued'&&now()-j.createdMs>60000)){j.state=ext.external(j)&&j.state==='leased'?'unknown':'expired';if(j.state==='unknown')j.phase='unknown';audit(s,'job_expirado',{id:j.id});changed=true}}
   if(changed)await save(s);
   if(path==='/api/campaign/start'&&req.method==='POST'){
    const body=await read(req),key=safe(req.headers['idempotency-key']);
    if(!/^[a-zA-Z0-9-]{16,80}$/.test(key)||body.confirmed!==true)return reply(res,400,{error:'confirmacao_e_idempotencia_obrigatorias'});
    if(!policy||body.campaignId!==policy.campaignId)return reply(res,423,{error:'somente_campanha_de_teste_autorizada'});
    const prior=state.queue.find(j=>j.key===key);if(prior)return reply(res,200,{accepted:true,replayed:true,call:ext.callView(prior)});
    const check=ext.candidate(state,policy,now());if(check.error)return reply(res,423,{error:check.error});
    if(!pilotStatus().ready)return reply(res,503,{error:pilotStatus().reason});
    if(state.queue.some(ext.active)||now()-state.lastQueuedAt<15000)return reply(res,429,{error:'ramal_reservado_ou_aguarde_15s'});
    const next=copy(state),job={id:crypto.randomUUID(),key,kind:'external_pilot_700',state:'queued',phase:'reserved',createdAt:new Date(now()).toISOString(),createdMs:now(),campaignId:policy.campaignId,contactId:check.p.id,contactName:safe(check.p.name).slice(0,140),phoneMasked:'••••'+check.p.phone.slice(-4),channel:'PJSIP/1001',exten:'700',routeHash:policy.phoneHash,events:[],lastSeq:0};
    next.queue.push(job);next.queue=next.queue.slice(-500);next.lastQueuedAt=now();next.campaignControl[policy.campaignId]={mode:'running',at:new Date(now()).toISOString()};audit(next,'piloto_externo_solicitado',{id:job.id,campaignId:policy.campaignId});await save(next);
    return reply(res,202,{accepted:true,call:ext.callView(job),meaning:'Operador 1001 será chamado primeiro; nenhum atendimento ainda confirmado'});
   }
   if(path==='/api/agent/event'&&req.method==='POST'){
    const body=await read(req),next=copy(state),j=next.queue.find(j=>j.id===body.id);
    if(!j||!ext.external(j)||j.state!=='leased'||!equal(body.lease,j.lease))return reply(res,409,{error:'lease_invalido'});
    const changed=ext.applyEvent(j,body,new Date(now()).toISOString());j.progressAt=now();agentSeenAt=now();await save(next);
    return reply(res,200,{saved:true,replayed:!changed});
   }
   if(path==='/api/calls/qualify'&&req.method==='POST'){
    const body=await read(req),next=copy(state),j=next.queue.find(j=>j.id===body.id&&ext.external(j));
    if(!j)return reply(res,404,{error:'ligacao_inexistente'});
    if(['queued','leased'].includes(j.state))return reply(res,409,{error:'aguarde_encerramento'});
    if(!['Interessado','Retornar','Sem interesse','Não ligar','Sem classificação'].includes(body.classification)||typeof body.notes!=='string'||body.notes.length>4000)return reply(res,400,{error:'classificacao_invalida'});
    j.classification=body.classification;j.notes=body.notes;j.audioConfirmed=body.audioConfirmed===true;j.qualifiedAt=new Date(now()).toISOString();
    if(j.audioConfirmed&&!j.bridgeConfirmed)return reply(res,409,{error:'audio_sem_ponte_confirmada'});
    if(j.state==='unknown'&&body.releaseReservation===true){j.reservationReleased=true;audit(next,'reserva_liberada_manualmente',{id:j.id});}
    if(j.classification==='Não ligar'){
     const c=next.backup.campaigns.find(c=>c.id===j.campaignId),p=c?.contacts.find(p=>p.id===j.contactId);if(p){p.status='Não ligar';next.backup.globalBlock=[...new Set([...(next.backup.globalBlock||[]),p.phone])];}
    }
    audit(next,'ligacao_classificada',{id:j.id,classification:j.classification,audioConfirmed:j.audioConfirmed});await save(next);return reply(res,200,{saved:true,call:ext.callView(j)});
   }
   if(path==='/api/import'&&req.method==='POST'){
    const candidate=parseBackup(await read(req));const next=copy(state);const merged=new Map(next.backup.campaigns.map(c=>[c.id,c]));for(const c of candidate.campaigns){const old=merged.get(c.id);if(old){const contacts=new Map(old.contacts.map(p=>[p.id,p]));for(const p of c.contacts)contacts.set(p.id,p);c.contacts=[...contacts.values()];c.block=[...new Set([...(old.block||[]),...(c.block||[])])];const events=new Map([...(old.history||[]),...(c.history||[])].map(e=>[e.at+'|'+e.text,e]));c.history=[...events.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,2000)}merged.set(c.id,c)}next.backup={...candidate,campaigns:[...merged.values()],globalBlock:[...new Set([...(next.backup.globalBlock||[]),...(candidate.globalBlock||[])])]};parseBackup(next.backup);audit(next,'campanhas_sincronizadas',{campaigns:candidate.campaigns.length});await save(next);
    return reply(res,200,{imported:true,campaigns:next.backup.campaigns.map(c=>stats(c,next.backup)),external_calls_enabled:false});
   }
   if(['/api/campaign/pause','/api/campaign/stop'].includes(path)&&req.method==='POST'){
    const {campaignId}=await read(req);if(!state.backup.campaigns.some(c=>c.id===campaignId))return reply(res,404,{error:'campanha_inexistente'});
    const next=copy(state),mode=path.endsWith('/stop')?'stopped':'paused';next.campaignControl[campaignId]={mode,at:new Date(now()).toISOString()};for(const j of next.queue)if(ext.external(j)&&j.campaignId===campaignId&&j.state==='queued'){j.state='canceled';j.phase='ended';audit(next,'ligacao_cancelada_na_fila',{id:j.id})}audit(next,'campanha_'+mode,{campaignId});await save(next);return reply(res,200,{saved:true,mode,external_calls_enabled:false});
   }
   if(path==='/api/pilot/internal-test'&&req.method==='POST'){
    const key=safe(req.headers['idempotency-key']);if(!/^[a-zA-Z0-9-]{16,80}$/.test(key))return reply(res,400,{error:'chave_idempotencia_obrigatoria'});
    const prior=state.queue.find(j=>j.key===key);if(prior)return reply(res,200,{accepted:true,jobId:prior.id,state:prior.state,replayed:true});
    if(!status().agent_connected||!status().asterisk_connected)return reply(res,503,{error:'agente_ou_ami_desconectado'});
    if(now()-state.lastQueuedAt<15000||state.queue.some(ext.active))return reply(res,429,{error:'teste_pendente_ou_intervalo'});
    const next=copy(state),job={id:crypto.randomUUID(),key,kind:'internal_echo_1001',state:'queued',createdAt:new Date(now()).toISOString(),createdMs:now(),channel:'PJSIP/1001',exten:'600'};
    next.queue.push(job);next.queue=next.queue.slice(-500);next.lastQueuedAt=now();audit(next,'teste_interno_solicitado',{id:job.id});await save(next);
    return reply(res,202,{accepted:true,jobId:job.id,scope:'ramal 1001 → eco 600',meaning:'Enfileirado; ainda não atendido'});
   }
   if(path==='/api/agent/poll'&&req.method==='GET'){
    const query=new URL(req.url,'http://localhost').searchParams;agentSeenAt=now();amiReady=query.get('ami_ready')==='1';agentVersion=query.get('version')||'';agentRouteHash=query.get('route_hash')||'';
    const next=copy(state);let j=amiReady?next.queue.find(j=>j.state==='queued'&&(!ext.external(j)||pilotStatus().routeReady)):null;
    if(j&&ext.external(j)){const c=ext.candidate(next,policy,now());if(c.error||['paused','stopped'].includes(next.campaignControl[j.campaignId]?.mode)){j.state='canceled';audit(next,'ligacao_cancelada_na_fila',{id:j.id});await save(next);j=null;}}
    if(!j)return reply(res,200,{job:null,external_calls_enabled:false});
    j.state='leased';j.leasedAt=now();j.lease=crypto.randomUUID();audit(next,'job_entregue_ao_agente',{id:j.id});await save(next);
    return reply(res,200,{job:{id:j.id,lease:j.lease,kind:j.kind,channel:'PJSIP/1001',exten:j.exten,...(ext.external(j)?{routeHash:j.routeHash,context:'central-interna',maxSeconds:180}:{})},external_calls_enabled:false});
   }
   if(path==='/api/agent/report'&&req.method==='POST'){
    const body=await read(req),next=copy(state),j=next.queue.find(j=>j.id===body.id);
    if(!j)return reply(res,404,{error:'job_inexistente'});
    if(j.state!=='leased'||!equal(body.lease,j.lease))return reply(res,409,{error:'lease_invalido_ou_job_encerrado'});
    if(ext.external(j)){
     if(!['completed','failed','busy','no_answer','operator_no_answer','unknown'].includes(body.outcome))return reply(res,400,{error:'resultado_invalido'});
     if(body.outcome==='completed'&&(!j.bridgeConfirmed||!j.hangupConfirmed))return reply(res,409,{error:'conclusao_sem_ponte_e_encerramento'});
     j.state=body.outcome;j.outcome=body.outcome;j.finishedAt=new Date(now()).toISOString();if(body.outcome==='unknown')j.phase='unknown';else j.phase='ended';
     j.elapsedSeconds=Math.min(240,Math.floor((j.lastElapsedMs||0)/1000));next.lastExternalResult={id:j.id,outcome:j.outcome,at:j.finishedAt};audit(next,'resultado_externo_do_agente',{id:j.id,outcome:j.outcome});agentSeenAt=now();await save(next);
     return reply(res,200,{saved:true,call:ext.callView(j)});
    }
    if(!['accepted','failed','answered','no_answer','unknown'].includes(body.outcome))return reply(res,400,{error:'resultado_invalido'});
    j.state=body.outcome;j.outcome=body.outcome;next.completedInternalTests++;next.lastAgentResult={at:new Date(now()).toISOString(),outcome:body.outcome,scope:'ramal 1001 / eco 600',meaning:body.outcome==='answered'?'Agente reportou evento de atendimento AMI; áudio exige conferência humana':'Comando aceito não comprova atendimento nem áudio'};
    audit(next,'resultado_do_agente',{id:j.id,outcome:body.outcome});await save(next);return reply(res,200,{saved:true,meaning:next.lastAgentResult.meaning});
   }
   reply(res,404,{error:'endpoint_inexistente'});
  })}catch{reply(res,storageHealthy?400:503,{error:storageHealthy?'solicitacao_invalida':'persistencia_indisponivel_operacao_nao_confirmada'})}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 return {server,init,status};
}
if(require.main===module){
 const store=remoteStore({url:process.env.CENTRAL_STORAGE_URL,token:process.env.CENTRAL_STORAGE_TOKEN,siteToken:process.env.CENTRAL_SITE_ACCESS_TOKEN});
 let backup={selected:'',campaigns:[],globalBlock:[]};if(process.env.CENTRAL_BACKUP_B64)backup=JSON.parse(Buffer.from(process.env.CENTRAL_BACKUP_B64,'base64').toString());
 const motor=createMotor({adminToken:process.env.CENTRAL_ADMIN_TOKEN,agentToken:process.env.CENTRAL_AGENT_TOKEN,store,backup});
 motor.init().then(()=>motor.server.listen(Number(process.env.PORT||8000),'0.0.0.0',()=>console.log('Central 0.6.0 pronta; D1 persistente; piloto externo restrito à rota local 700'))).catch(()=>{console.error('Falha ao iniciar persistência; serviço fechado com segurança');process.exit(1)});
}
module.exports={createMotor,parseBackup,stats,remoteStore};
