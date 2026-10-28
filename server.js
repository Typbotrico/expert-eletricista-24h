'use strict';
/** Central de Ligações — motor intermediário de homologação.
 * Segurança: chamadas externas INTENCIONALMENTE DESABILITADAS.
 * Sem dependências, sem armazenar telefones no GitHub, sem CORS.
 * Estado em memória: modo piloto; reinicializa no redeploy/restart.
 */
const http = require('node:http');
const crypto = require('node:crypto');
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
const MAX_HISTORY = 250;
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
function watchdog(){
  const now=Date.now();
  for(const j of queue)if(j.state==='leased' && now-j.leasedAt>90000) {j.state='expired';audit('job_expirado',{id:j.id});}
  queue=queue.slice(-200);
}
const server = http.createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET' && path==='/health') {
      return reply(res,200,{service:'central-ligacoes-motor',mode:'piloto',ready:true,external_calls_enabled:false,carrier_status:'603 Decline — aguarda Directcall',agent_connected:Date.now()-agentSeenAt<60000});
    }
    if(req.method==='GET' && path==='/') {
      const body='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Central de Ligações — Motor piloto</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:17px system-ui;background:#0e1b2e;color:#eaf2ff;max-width:720px;margin:65px auto;padding:20px"><h1>Central de Ligações · Motor piloto</h1><p>Serviço publicado. Campanhas e testes internos por API autenticada.</p><p><strong>Chamadas externas desabilitadas</strong> até resolver a resposta SIP 603 Decline da Directcall e instalar a ponte do agente.</p><p>Este serviço complementa o projeto existente, sem substituir o site nem o Asterisk.</p><p><a style="color:#8cb9ff" href="/health">Verificar saúde do motor</a></p></body></html>';
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(body);
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
      j.state=outcome;j.result=safe(body.detail).slice(0,160);audit('resultado_do_agente',{id:j.id,outcome});
      return reply(res,200,{saved:true,meaning:'accepted indica AMI Originate aceito, nao atendimento confirmado'});
    }
    return reply(res,404,{error:'endpoint_nao_encontrado'});
  } catch(err) {return reply(res,400,{error:'solicitacao_invalida',detail:safe(err.message).slice(0,160)});}
});
if(require.main===module)server.listen(port,'0.0.0.0',()=>console.log('Motor da Central pronto na porta '+port+' — somente piloto interno'));
module.exports={server,parseBackup,stats};