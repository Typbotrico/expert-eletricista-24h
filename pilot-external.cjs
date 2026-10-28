'use strict';
const crypto=require('node:crypto');
const HASH=/^[a-f0-9]{64}$/;
const hash=phone=>crypto.createHash('sha256').update(phone).digest('hex');
const external=j=>['external_pilot_700','campaign_call'].includes(j.kind);
const active=j=>['queued','leased'].includes(j.state)||(external(j)&&j.state==='unknown'&&!j.reservationReleased);
const fictional=p=>p.demo===true||/exemplo|fict[ií]ci/i.test(String(p.name)+' '+String(p.note));
function policyFromBackup(backup,campaignId){
 const c=backup?.campaigns?.find(c=>c.id===campaignId),contacts=c?.contacts?.filter(p=>!fictional(p)&&/^55[1-9]\d\d{8,9}$/.test(p.phone))||[];
 return contacts.length===1?{campaignId,phoneHash:hash(contacts[0].phone)}:null;
}
function candidate(state,policy,now){
 if(!policy)return {error:'piloto_sem_numero_autorizado'};
 const c=state.backup.campaigns.find(c=>c.id===policy.campaignId);
 if(!c)return {error:'campanha_nao_autorizada'};
 const p=c.contacts.find(p=>!fictional(p)&&hash(p.phone)===policy.phoneHash);
 if(!p)return {error:'contato_autorizado_nao_encontrado'};
 if(p.status==='Não ligar'||[...(state.backup.globalBlock||[]),...(c.block||[])].some(n=>n===p.phone||n===p.id))return {error:'contato_bloqueado'};
 const time=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
 if(!c.start||!c.end||time<c.start||time>=c.end)return {error:'fora_do_expediente'};
 if(Number(c.agents)!==1||Number(c.lines)!==1)return {error:'piloto_exige_um_atendente_e_uma_linha'};
 return {c,p};
}
const PHASES=['reserved','operator_ringing','operator_answered','contact_ringing','contact_answered','bridged','ended'];
function applyEvent(job,body,at){
 if(!Number.isSafeInteger(body.seq)||body.seq<1||body.seq>500)throw Error('Evento inválido');
 if(body.seq<=(job.lastSeq||0))return false;
 if(body.seq!==(job.lastSeq||0)+1)throw Error('Sequência inválida');
 if(![...PHASES,'heartbeat'].includes(body.phase))throw Error('Fase inválida');
 const elapsed=Number(body.elapsedMs);if(!Number.isFinite(elapsed)||elapsed<0||elapsed>240000)throw Error('Tempo inválido');
 if(elapsed<(job.lastElapsedMs||0))throw Error('Tempo regressivo');
 const proof=body.proof||{};
 const checkId=v=>typeof v==='string'&&v.length>0&&v.length<=150&&!/[\r\n]/.test(v);
 const channel='central-'+job.id;
 if(body.phase==='operator_answered'&&!(proof.event==='Newstate'&&proof.uniqueId===channel&&proof.channelState==='6')&&!(proof.event==='OriginateResponse'&&proof.actionId===job.id&&proof.response==='Success'&&proof.reason==='4'))throw Error('Atendimento do operador sem prova correlacionada');
 if(body.phase==='contact_ringing'&&!(proof.event==='DialBegin'&&proof.uniqueId===channel&&checkId(proof.destUniqueId)))throw Error('Destino não correlacionado');
 if(body.phase==='contact_ringing'){if(job.destUniqueId&&job.destUniqueId!==proof.destUniqueId)throw Error('Destino alterado');job.destUniqueId=proof.destUniqueId;}
 if(body.phase==='contact_answered'&&!(job.destUniqueId&&proof.destUniqueId===job.destUniqueId&&proof.uniqueId===channel&&proof.event==='DialEnd'&&proof.dialStatus==='ANSWER'))throw Error('Atendimento do contato sem prova');
 if(body.phase==='bridged'&&!(job.contactAnswered&&proof.event==='BridgeEnter'&&proof.operatorUniqueId===channel&&proof.destUniqueId===job.destUniqueId&&checkId(proof.bridgeId)))throw Error('Ponte sem prova correlacionada');
 if(body.phase==='ended'&&!(proof.event==='Hangup'&&[channel,job.destUniqueId].includes(proof.uniqueId)))throw Error('Encerramento sem prova');
 if(body.phase!=='heartbeat'){
  const prior=PHASES.indexOf(job.phase||'reserved'),next=PHASES.indexOf(body.phase);
  if(next<prior)throw Error('Fase regressiva');
  job.phase=body.phase;
  job.events??=[];job.events.push({seq:body.seq,phase:body.phase,elapsedMs:elapsed,at,proof});
 }
 if(body.phase==='operator_answered')job.operatorAnswered=true;
 if(body.phase==='contact_answered')job.contactAnswered=true;
 if(body.phase==='bridged'){job.bridgeConfirmed=true;job.bridgeElapsedMs??=elapsed;}
 if(body.phase==='ended'){job.hangupConfirmed=true;job.talkSeconds=job.bridgeConfirmed?Math.max(0,Math.floor((elapsed-job.bridgeElapsedMs)/1000)):0;}
 job.lastSeq=body.seq;job.lastElapsedMs=elapsed;return true;
}
function callView(j){const {lease,key,routeHash,targetPhone,...safe}=j;return safe;}
module.exports={HASH,hash,external,active,policyFromBackup,candidate,applyEvent,callView};
