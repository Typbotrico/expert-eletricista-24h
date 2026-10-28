'use strict';
const crypto=require('node:crypto'),ext=require('./pilot-external.cjs');
function normalize(value){let p=String(value||'').replace(/\D/g,'');if(p.length===10||p.length===11)p='55'+p;return /^55[1-9]\d\d{8,9}$/.test(p)?p:null;}
function makePolicy(numbers){const phones=[...new Set(numbers.map(normalize).filter(Boolean))];if(phones.length>10)throw Error('Limite de números de teste excedido');return {phones,revision:ext.hash([...phones].sort().join('|'))};}
function hours(c,now){const time=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));return c.start&&c.end&&time>=c.start&&time<c.end;}
const fictitious=p=>p.demo===true||/exemplo|fict[ií]ci/i.test(String(p.name)+' '+String(p.note));
function eligible(state,c,p,policy){return p&&!fictitious(p)&&policy.phones.includes(normalize(p.phone))&&['Pendente','Retornar','Não atendeu'].includes(p.status)&&![...(state.backup.globalBlock||[]),...(c.block||[])].some(n=>normalize(n)===normalize(p.phone)||n===p.id);}
function campaign(state,id){return state.backup.campaigns.find(c=>c.id===id);}
const needsResult=j=>j.kind==='campaign_call'&&j.state==='completed'&&(!j.classification||j.classification==='Sem classificação');
function start(state,id,key,policy,now,ready){
 state.runs??=[];const prior=state.runs.find(r=>r.key===key||(r.requestKeys||[]).includes(key));if(prior)return {run:prior,replayed:true};
 const c=campaign(state,id);if(!c)throw Error('campanha_nao_encontrada');
 if(!ready)throw Error('atualizar_agente_para_fila');
 if(!hours(c,now))throw Error('fora_do_expediente');
 if(c.agents!==1||c.lines!==1)throw Error('piloto_exige_um_atendente_e_uma_linha');
 const current=state.runs.find(r=>r.campaignId===id&&r.status==='paused');
 if(current&&state.queue.some(j=>j.runId===current.id&&needsResult(j)))throw Error('aguardando_classificacao');
 if(state.runs.some(r=>r.status==='running'))throw Error('fila_ja_em_execucao');
 if(state.queue.some(ext.active))throw Error('ramal_reservado_ou_aguarde_15s');
 if(current){current.status='running';current.requestKeys=[...(current.requestKeys||[]),key].slice(-100);current.reason=null;current.resumedAt=new Date(now).toISOString();return {run:current,resumed:true};}
 const seen=new Set(),entries=[];
 for(const p of c.contacts){const phone=normalize(p.phone);if(!seen.has(phone)&&eligible(state,c,p,policy)&&['Pendente','Não atendeu','Retornar'].includes(p.status)){seen.add(phone);entries.push({contactId:p.id,phone,attempts:0,nextAt:0});}}
 if(!entries.length)throw Error('nenhum_contato_autorizado_pendente');
 const run={id:crypto.randomUUID(),key,campaignId:id,status:'running',createdAt:new Date(now).toISOString(),entries,maxAttempts:Math.min(3,Math.max(1,c.retryLimit||1)),retryMs:Math.max(60000,Math.min(86400000,(c.retryMinutes||60)*60000)),nextAt:now};
 state.runs.push(run);state.runs=state.runs.slice(-100);return {run};
}
function next(state,policy,now){
 if(state.queue.some(ext.active))return null;
 const run=state.runs?.find(r=>r.status==='running');if(!run||run.nextAt>now)return null;
 const c=campaign(state,run.campaignId);
 if(state.queue.some(j=>j.runId===run.id&&needsResult(j))){run.status='paused';run.reason='aguardando_classificacao';return null;}
 if(!c||!hours(c,now)){run.status='paused';run.reason=c?'fora_do_expediente':'campanha_nao_encontrada';return null;}
 for(const entry of run.entries){
  const p=c.contacts.find(p=>p.id===entry.contactId&&normalize(p.phone)===entry.phone);
  if(!eligible(state,c,p,policy)){entry.skipped=true;entry.reason='bloqueado_ou_removido';continue;}
  if(p.callbackAt&&Number.isFinite(Date.parse(p.callbackAt))&&Date.parse(p.callbackAt)>now){entry.nextAt=Date.parse(p.callbackAt);continue;}
  if(entry.attempts>=run.maxAttempts||entry.nextAt>now||entry.done)continue;
  entry.attempts++;entry.inFlight=true;
  const job={id:crypto.randomUUID(),key:run.id+'-'+entry.contactId+'-'+entry.attempts,kind:'campaign_call',state:'queued',phase:'reserved',createdAt:new Date(now).toISOString(),createdMs:now,campaignId:c.id,runId:run.id,contactId:p.id,contactName:p.name,phoneMasked:'••••'+entry.phone.slice(-4),targetPhone:entry.phone,channel:'PJSIP/1001',maxSeconds:180,events:[],lastSeq:0};
  state.queue.push(job);state.queue=state.queue.slice(-500);return job;
 }
 if(run.entries.every(e=>e.skipped||e.done||e.attempts>=run.maxAttempts)){run.status='completed';run.finishedAt=new Date(now).toISOString();}
 else{const due=run.entries.filter(e=>!e.skipped&&!e.done&&e.attempts<run.maxAttempts).map(e=>e.nextAt);if(due.length)run.nextAt=Math.max(now,Math.min(...due));}
 return null;
}
function finish(state,job,now){
 if(job.kind!=='campaign_call')return;
 const run=state.runs?.find(r=>r.id===job.runId),entry=run?.entries.find(e=>e.contactId===job.contactId);if(!run||!entry)return;
 entry.lastOutcome=job.outcome;entry.inFlight=job.outcome==='unknown';
 if(job.outcome==='unknown'){run.status='paused';run.reason='resultado_desconhecido';return;}
 if(['completed','failed'].includes(job.outcome))entry.done=true;
 if(job.outcome==='completed'&&needsResult(job)&&run.status!=='stopped'){run.status='paused';run.reason='aguardando_classificacao';return;}
 if(job.outcome==='operator_no_answer'){entry.attempts=Math.max(0,entry.attempts-1);entry.nextAt=now;run.nextAt=now;run.status='paused';run.reason='vendedor_nao_atendeu';return;}
 entry.nextAt=now+run.retryMs;run.nextAt=now+15000;
 if(run.entries.every(e=>e.skipped||e.done||e.attempts>=run.maxAttempts)&&run.status==='running'){run.status='completed';run.finishedAt=new Date(now).toISOString();}
}
function view(run){const {key,entries,...rest}=run;return {...rest,total:entries.length,attempted:entries.filter(e=>e.attempts>0).length,finished:entries.filter(e=>e.done||e.skipped||(e.attempts>=run.maxAttempts&&!e.inFlight)).length,entries:entries.map(({phone,...e})=>({...e,phoneMasked:'••••'+phone.slice(-4)}))};}
module.exports={normalize,makePolicy,hours,eligible,campaign,start,next,finish,view};
