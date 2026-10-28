'use strict';
/** Central de Ligações — motor intermediário de homologação.
 * Segurança: chamadas externas INTENCIONALMENTE DESABILITADAS.
 * Sem dependências, sem armazenar telefones no GitHub, sem CORS.
 * Estado em memória: modo piloto; reinicializa no redeploy/restart.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const DASHBOARD_HTML = "<!doctype html>\n<html lang=\"pt-BR\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Central de Ligações — Motor piloto</title>\n<style>\n:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#071121;color:#edf5ff}\n*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 70% -10%,#143f75 0,transparent 47%),#071121}\nmain{max-width:1120px;margin:0 auto;padding:36px 24px 65px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #253c56;padding-bottom:22px;flex-wrap:wrap}\n.brand{display:flex;align-items:center;gap:14px}.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(135deg,#22bbf4,#3464ef);font-weight:900;font-size:26px;box-shadow:0 0 30px #147dd83d}\n.brandname{font-weight:800;font-size:20px;letter-spacing:.02em}.muted{color:#9eb3cd;font-size:14px}.capsule{border:1px solid #36516e;background:#0f2136;border-radius:24px;padding:10px 15px;font-size:13px}\nh1{font-size:clamp(26px,4vw,40px);line-height:1.18;margin:40px 0 12px}p{line-height:1.65}.sub{max-width:780px;color:#b4c9e1;margin-bottom:30px}\n.row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.tile,.panel{border:1px solid #263e5a;border-radius:18px;background:#0d2138dd;padding:22px}.tile span{font-size:13px;color:#9eb6d0}.tile strong{display:block;font-size:33px;margin-top:10px;letter-spacing:-.02em}.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;margin-top:17px}.panel h2{font-size:17px;margin:0 0 22px}.line{padding:13px 0;border-top:1px solid #233a55;display:flex;align-items:center;justify-content:space-between;gap:12px}.line strong{font-size:14px;text-align:right}.ok{color:#50e0ac}.warn{color:#ffcf79}.danger{color:#ffa39a}.notice{margin-top:20px;border:1px solid #54472d;background:#34271466;border-radius:14px;padding:18px;color:#ffe1ad;font-size:14px}.foot{margin-top:28px;color:#8da9c8;font-size:13px}a{color:#8cc4ff}small{font-size:12px;color:#9cb3ce}\n@media(max-width:750px){.row{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.tile,.panel{padding:17px}.tile strong{font-size:27px}}\n</style></head>\n<body><main>\n<header><div class=\"brand\"><div class=\"mark\">C</div><div><div class=\"brandname\">CENTRAL DE LIGAÇÕES</div><div class=\"muted\">Motor operacional · homologação</div></div></div><div class=\"capsule\" id=\"updated\">Conferindo sistema…</div></header>\n<h1>Monitor de operação</h1>\n<p class=\"sub\">Acompanhamento em tempo real da infraestrutura de testes. Este motor é separado do site original. Nenhuma chamada externa está autorizada nesta fase.</p>\n<section class=\"row\" aria-label=\"Indicadores\">\n<div class=\"tile\"><span>Campanhas importadas</span><strong id=\"campaigns\">—</strong></div>\n<div class=\"tile\"><span>Contatos no backup</span><strong id=\"contacts\">—</strong></div>\n<div class=\"tile\"><span>Exemplos bloqueados</span><strong id=\"blocked\">—</strong></div>\n<div class=\"tile\"><span>Testes internos reportados</span><strong id=\"tests\">—</strong></div>\n</section>\n<section class=\"grid\"><div class=\"panel\"><h2>Telefonia e integração</h2>\n<div class=\"line\"><span>API do motor</span><strong class=\"ok\" id=\"health\">Verificando…</strong></div>\n<div class=\"line\"><span>Agente Asterisk do notebook</span><strong id=\"agent\">Verificando…</strong></div>\n<div class=\"line\"><span>Chamadas para clientes</span><strong class=\"danger\">Bloqueadas</strong></div>\n<div class=\"line\"><span>Conexão com site original</span><strong class=\"warn\">Não integrada</strong></div>\n<div class=\"line\"><span>Testes internos na fila</span><strong id=\"pending\">—</strong></div>\n</div><div class=\"panel\"><h2>Último teste Asterisk</h2>\n<div class=\"line\"><span>Resultado do agente</span><strong id=\"result\">Nenhum registro atual</strong></div>\n<div class=\"line\"><span>Horário do registro</span><strong id=\"testtime\">—</strong></div>\n<div class=\"line\"><span>Rota permitida</span><strong>1001 → eco 600</strong></div>\n<div class=\"line\"><span>Operadora</span><strong class=\"warn\">Directcall · 603 Decline</strong></div>\n</div></section>\n<div class=\"notice\"><strong>Ambiente protegido.</strong> O motor só pode enfileirar teste interno do ramal 1001. Não executa campanhas de saída; o agente instalado no computador é necessário para tocar o MicroSIP. Os resultados do piloto são temporários e podem desaparecer após reinício do servidor.</div>\n<p class=\"foot\">Atualização automática a cada 12 segundos. <a href=\"/health\" target=\"_blank\" rel=\"noreferrer\">Ver resposta técnica</a>. Este painel é somente leitura e não exibe telefones ou chaves de acesso.</p>\n</main>\n<script>\n(function(){'use strict';\nconst set=(id,v)=>{document.getElementById(id).textContent=String(v)};\nfunction relative(ts){if(!ts)return '—';const d=new Date(ts);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});}\nasync function refresh(){try{\nconst response=await fetch('/api/public/status',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);\nconst d=await response.json();if(d.external_calls_enabled!==false)throw Error('Estado de telefonia inesperado');\nset('health',d.ready?'Online':'Indisponível');set('campaigns',d.totals.campaigns);set('contacts',d.totals.contacts);\nset('blocked',d.totals.fictitious_blocked);set('tests',d.totals.internal_test_jobs_completed);\nset('pending',d.totals.active_internal_jobs);set('agent',d.agent_connected?'Conectado':'Desconectado');\ndocument.getElementById('agent').className=d.agent_connected?'ok':'warn';\nset('result',d.last_internal_result?d.last_internal_result.outcome:'Sem teste recente');\nset('testtime',relative(d.last_internal_result?.at));set('updated','Online · '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'}));\n}catch(err){set('updated','Erro ao consultar servidor');set('health','Indisponível')}}\nrefresh();setInterval(refresh,12000);\n})();\n</script></body></html>";
const MAX_BODY = 1200000;
const token = process.env.CENTRAL_API_TOKEN || '';
if (token.length < 32) throw new Error('CENTRAL_API_TOKEN ausente/inseguro; serviço não iniciado');
const port = Number(process.env.PORT || 8000);
let campaigns = [];
let selected = '';
let queue = [];
let history = [];
let agentSeenAt = 0;
let lastQueuedAt = 0;
const startedAt = Date.now();
let lastAgentResult = null;
let completedInternalTests = 0;
const MAX_HISTORY = 250;
const PUBLIC_STATUS_CACHE = 'no-store';
const safe = (v) => String(v == null ? '' : v);
const validPhone = (v) => /^55[1-9]\d(?:\d{8}|\d{9})$/.test(v);
function id() { return crypto.randomUUID(); }
function audit(type, fields={}) {
  history.push({ at:new Date().toISOString(), type, ...fields });
  history = history.slice(-MAX_HISTORY);
}
function parseBackup(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.campaigns) || obj.campaigns.length > 1000) throw Error('Formato de backup inválido');
  const blocks = new Set(Array.isArray(obj.globalBlock) ? obj.globalBlock.map(safe) : []);
  let totalContacts=0;
  const clean = obj.campaigns.map(c => {
    if (!c || !Array.isArray(c.contacts) || c.contacts.length>10000) throw Error('Campanha inválida ou grande demais');
    totalContacts += c.contacts.length;
    if(totalContacts>15000) throw Error('Limite do piloto excedido');
    const block = new Set([...blocks,...(Array.isArray(c.block)?c.block.map(safe):[])]);
    const contacts = c.contacts.map(p => {
      const phone=safe(p?.phone).replace(/\D/g,'');
      const fictitious=p?.demo===true || /exemplo|fict[ií]ci/i.test(safe(p?.note));
      const eligible = !fictitious && validPhone(phone) && safe(p?.status)==='Pendente' && !block.has(phone) && !block.has(safe(p?.id));
      return {id:safe(p?.id).slice(0,100), phone, name:safe(p?.name).slice(0,140), status:safe(p?.status), fictitious, eligible};
    });
    return {id:safe(c.id).slice(0,100),name:safe(c.name).slice(0,120),contacts,agents:Math.max(0,Number(c.agents)||0),lines:Math.max(0,Number(c.lines)||0),start:safe(c.start),end:safe(c.end)};
  });
  return { selected:safe(obj.selected), campaigns:clean };
}
if(process.env.CENTRAL_BACKUP_B64) {
  try {
    const bootstrap=parseBackup(JSON.parse(Buffer.from(process.env.CENTRAL_BACKUP_B64,'base64').toString('utf8')));
    selected=bootstrap.selected; campaigns=bootstrap.campaigns;
    audit('backup_inicial_validado',{campaigns:campaigns.length,contacts:campaigns.reduce((n,c)=>n+c.contacts.length,0)});
  } catch(err) { console.error('Backup inicial inválido:',err.message); process.exit(1); }
}
function stats(c) {
  return {id:c.id,name:c.name,total:c.contacts.length,fictional:c.contacts.filter(x=>x.fictitious).length,pending:c.contacts.filter(x=>x.status==='Pendente').length,eligible_for_future_validation:c.contacts.filter(x=>x.eligible).length,agents:c.agents,lines:c.lines,hours:c.start+'–'+c.end};
}
function authorized(req) {
  const auth=safe(req.headers.authorization);
  const presented=auth.startsWith('Bearer ')?auth.slice(7):'';
  const a=Buffer.from(presented),b=Buffer.from(token);
  return a.length===b.length && a.length>0 && crypto.timingSafeEqual(a,b);
}
function reply(res,status,obj) {
  const body=JSON.stringify(obj);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}
async function readJson(req) {
  const parts=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;if(size>MAX_BODY) throw Error('Payload maior que 1.2 MB');parts.push(chunk);}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function activeJobs(){return queue.filter(j=>j.state==='queued'||j.state==='leased').length;}
function publicStatus(){
  const agentOnline=Date.now()-agentSeenAt<60000;
  return {
    service:'central-ligacoes-motor', mode:'piloto', ready:true,
    version:'0.2.0', started_at:new Date(startedAt).toISOString(),
    external_calls_enabled:false, carrier_status:'Directcall SIP 603 Decline — saída ainda indisponível',
    agent_connected:agentOnline,
    totals:{campaigns:campaigns.length,contacts:campaigns.reduce((n,c)=>n+c.contacts.length,0),
      fictitious_blocked:campaigns.reduce((n,c)=>n+c.contacts.filter(x=>x.fictitious).length,0),
      eligible_for_future_validation:campaigns.reduce((n,c)=>n+c.contacts.filter(x=>x.eligible).length,0),
      internal_test_jobs_completed:completedInternalTests,active_internal_jobs:activeJobs()},
    last_internal_result:lastAgentResult,
    persistence:'temporaria_em_memoria',
    site_original_integrated:false,
  };
}

function watchdog(){
  const now=Date.now();
  for(const j of queue)if(j.state==='leased' && now-j.leasedAt>90000) {j.state='expired';audit('job_expirado',{id:j.id});}
  queue=queue.slice(-200);
}
const server = http.createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET' && (path==='/health' || path==='/api/public/status')) {
      return reply(res,200,publicStatus());
    }
    if(req.method==='GET' && path==='/') {
      res.writeHead(200,{
        'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':PUBLIC_STATUS_CACHE,
        'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'X-Frame-Options':'DENY',
      });
      return res.end(DASHBOARD_HTML);
    }
    if(!path.startsWith('/api/'))return reply(res,404,{error:'nao_encontrado'});
    if(!authorized(req))return reply(res,401,{error:'token_invalido'});
    watchdog();
    if(req.method==='GET' && path==='/api/campaigns')return reply(res,200,{selected,campaigns:campaigns.map(stats),storage:'volatile_pilot',external_calls_enabled:false});
    if(req.method==='GET' && path==='/api/audit')return reply(res,200,{history,queue:queue.map(j=>({id:j.id,state:j.state,kind:j.kind,createdAt:j.createdAt})),external_calls_enabled:false});
    if(req.method==='POST' && path==='/api/import') {
      const candidate=parseBackup(await readJson(req));
      selected=candidate.selected;campaigns=candidate.campaigns;
      audit('backup_importado',{campaigns:campaigns.length,contacts:campaigns.reduce((n,c)=>n+c.contacts.length,0)});
      return reply(res,200,{imported:true,campaigns:campaigns.map(stats),external_calls_enabled:false});
    }
    if(req.method==='POST' && path==='/api/campaign/start') {
      return reply(res,423,{error:'discagem_externa_bloqueada',reason:'Directcall SIP 603 Decline; nenhum cliente sera chamado',external_calls_enabled:false});
    }
    if(req.method==='POST' && path==='/api/pilot/internal-test') {
      const now=Date.now();
      if(now-lastQueuedAt<15000 || activeJobs()>0)return reply(res,429,{error:'teste_ja_pendente_ou_aguarde_15s'});
      const job={id:id(),kind:'internal_echo_1001',state:'queued',createdAt:new Date().toISOString(),channel:'PJSIP/1001',exten:'600'};
      queue.push(job);lastQueuedAt=now;
      audit('teste_interno_solicitado',{id:job.id});
      return reply(res,202,{accepted:true,jobId:job.id,scope:'somente ramal 1001 / eco 600',agent_connected:now-agentSeenAt<60000});
    }
    if(req.method==='GET' && path==='/api/agent/poll') {
      agentSeenAt=Date.now();
      const j=queue.find(j=>j.state==='queued');
      if(!j)return reply(res,200,{job:null,external_calls_enabled:false});
      j.state='leased';j.leasedAt=Date.now();audit('teste_interno_entregue_ao_agente',{id:j.id});
      return reply(res,200,{job:{id:j.id,kind:j.kind,channel:'PJSIP/1001',exten:'600'},external_calls_enabled:false});
    }
    if(req.method==='POST' && path==='/api/agent/report') {
      const body=await readJson(req);
      const j=queue.find(x=>x.id===body.id);
      if(!j)return reply(res,404,{error:'job_nao_encontrado'});
      if(j.state!=='leased')return reply(res,409,{error:'job_nao_em_execucao'});
      const outcome=['accepted','failed'].includes(body.outcome)?body.outcome:'invalid';
      if(outcome==='invalid')return reply(res,400,{error:'resultado_invalido'});
      j.state=outcome;j.result=safe(body.detail).slice(0,160);completedInternalTests++;lastAgentResult={at:new Date().toISOString(),outcome,scope:'ramal 1001 / eco 600',meaning:'Originate aceito não comprova atendimento'};audit('resultado_do_agente',{id:j.id,outcome});
      return reply(res,200,{saved:true,meaning:'accepted indica AMI Originate aceito, nao atendimento confirmado'});
    }
    return reply(res,404,{error:'endpoint_nao_encontrado'});
  } catch(err) {return reply(res,400,{error:'solicitacao_invalida',detail:safe(err.message).slice(0,160)});}
});
if(require.main===module)server.listen(port,'0.0.0.0',()=>console.log('Motor da Central pronto na porta '+port+' — somente piloto interno'));
module.exports={server,parseBackup,stats,publicStatus};