'use strict';
(()=>{const $=id=>document.getElementById(id),API='/api/operator/',KEY='central.operator.campaign.v1';
let profile=null,view=null,campaignId='',sdkReady=false,sdkLoading=false,busy=false,sequencePaused=false;
const status=(s,kind='')=>{for(const id of ['message','easyNotice']){const e=$(id);if(e){e.textContent=s;e.className='notice '+kind}}};
const notice=(id,s,kind='')=>{const e=$(id);e.textContent=s;e.className='notice '+kind};
const err=e=>e?.message||String(e);
async function request(path,{method='GET',data=null,key=null}={}){const opt={method,credentials:'same-origin',headers:{'Accept':'application/json'}};if(data!==null){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(data)}if(key)opt.headers['Idempotency-Key']=key;const response=await fetch(API+path,opt);if(!response.ok){let msg='HTTP '+response.status;try{msg=(await response.json()).error||msg}catch{}throw Error(msg.replaceAll('_',' '))}return response.headers.get('content-type')?.includes('text/csv')?response.blob():response.json();}
function setupUI(configured){$('auth').classList.remove('hidden');$('dashboard').classList.remove('ready');$('setupForm').classList.toggle('hidden',configured);$('loginForm').classList.toggle('hidden',!configured);$('recoveryForm').classList.add('hidden');notice('authMessage',configured?'Usuário: admin. Use a senha do primeiro cadastro ou recupere seu acesso.':'Primeiro acesso: crie a conta do administrador.');const fragment=new URLSearchParams(location.hash.replace(/^#/,''));if(!configured&&fragment.has('setup'))$('setupKey').value=fragment.get('setup');if(configured&&fragment.has('recuperar')){const code=fragment.get('recuperar');$('recoveryCode').value=code;$('loginForm').classList.add('hidden');$('recoveryForm').classList.remove('hidden');notice('authMessage','Recuperação autorizada: escolha uma nova senha de pelo menos 12 caracteres.','good');}if(fragment.has('recuperar')||fragment.has('setup'))history.replaceState(null,'',location.pathname+location.search);}
const active=()=>view?.active||null;

function insideCallHours(){const now=new Date(),wd=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short'}).format(now),tm=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);return !['Sat','Sun'].includes(wd)&&tm>='09:00'&&tm<'18:00'}
let lastRequestedDial=null,vendorCallEnded=false,autoCampaignId=null,queuedHangup=null,autoHangupProcessing=false;
function easyRender(){
 if(!view)return;
 const admin=view.user.role==='admin',all=view.campaigns||[],chosen=all.find(c=>c.id===campaignId);
 const list=view.contacts.filter(c=>c.campaignId===campaignId);
 const c=active(),done=list.filter(x=>!['Pendente','Reservado','Comando enviado','Resultado desconhecido'].includes(x.status)).length;
 const pending=list.filter(x=>x.status==='Pendente'||(x.status==='Retornar'&&x.callbackAt&&new Date(x.callbackAt).getTime()<=Date.now())).length;
 const select=$('easyCampaign');
 select.replaceChildren(new Option('Escolha uma lista...',''),...all.map(x=>new Option(x.name,x.id)));
 select.value=chosen?campaignId:'';
 $('easyImportDetails').style.display=admin?'block':'none';
 $('easyCampaignInfo').textContent=chosen?(list.length+' contatos · '+done+' feitos · '+(chosen.isTest?'Teste com números autorizados':'Campanha comercial')+(chosen.paused?' · Aguardando início':'')):'Escolha uma lista. Se ainda não tiver uma, clique em “Quero colocar uma lista nova”.';
 $('easyStep1').style.borderColor=chosen?'#27856a':'#41678b';
 $('easyPhoneStatus').textContent=sdkReady?'✓ Plugin carregado, mas o login na Directcall ainda precisa ser conferido. Verifique “Via navegador” e a linha de origem no aparelho.':'Telefone carregando... Se não abrir, clique em “Mostrar telefone ao lado”.';
 $('easyPhoneStatus').classList.toggle('ok',sdkReady);
 const upcoming=list.find(x=>x.status==='Pendente')||list.find(x=>x.status==='Retornar'&&x.callbackAt&&Date.parse(x.callbackAt)<=Date.now());
 $('easyContact').textContent=c?c.name:chosen?(upcoming?upcoming.name:'Nenhum contato pendente nesta lista'):'Escolha uma lista acima';
 $('easyCallLabel').textContent=c?(c.status==='Reservado'?'Contato reservado':c.status==='Resultado desconhecido'?'Revisar chamada antes de avançar':'Ligação atual'):'Próxima ligação';
 $('easyPhoneNumber').textContent=c?c.phone:(upcoming?.phone||'');
 const hint=!chosen?'1. Escolha uma lista de contatos.':!list.length?'Esta campanha está vazia. Importe a lista correta.':c&&vendorCallEnded?'✓ A Directcall informou que a chamada terminou. Toque no resultado abaixo para salvar e ligar para o próximo.':c&&c.status==='Comando enviado'?'Quando terminar a chamada na Directcall, toque em um resultado abaixo para ligar para o próximo.':c&&c.status==='Resultado desconhecido'?'O comando não foi confirmado. Confira o histórico da Directcall antes de liberar este contato.':!sdkReady?'Telefone ainda não carregou. Clique em Mostrar telefone e entre na Directcall.':!chosen.isTest&&!insideCallHours()?'Esta lista é COMERCIAL e só permite chamadas das 09h às 18h, de segunda a sexta. Para testar agora, importe o CSV em uma NOVA LISTA DE TESTE autorizada.':sequencePaused?'Chamadas pausadas. Clique em Continuar ligações.':!c&&!upcoming?'Não há contatos disponíveis para ligação nesta lista.':chosen.paused?'Ao clicar em COMEÇAR, a campanha será ativada e a primeira ligação será solicitada.':'Pronto para ligar para '+(c?.name||upcoming.name)+'.';
 $('easyActionHint').textContent=hint;
 const stuck=!!(c&&!vendorCallEnded&&chosen?.isTest&&['Comando enviado','Resultado desconhecido'].includes(c.status));
 $('easyStuckActions').classList.toggle('hidden',!stuck);
 $('easyRetry').classList.toggle('hidden',!(stuck&&c.attempts<3));
 $('easyRetry').disabled=busy;
 $('easyNoRing').disabled=busy;
 $('easyProgress').textContent=done+' de '+list.length+' concluídos';
 $('easyPause').textContent=sequencePaused?'▶ Continuar ligações':'⏸ Pausar ligações';
 $('easyStart').textContent=c&&c.status==='Reservado'?'☎ LIGAR PARA ESTE CONTATO':'▶ COMEÇAR A LIGAR';
 $('easyStart').disabled=busy||sequencePaused||!chosen||!sdkReady||(!chosen.isTest&&!insideCallHours())||(!!c&&c.status!=='Reservado')||(!c&&pending===0);
 const canFinish=c&&['Comando enviado','Resultado desconhecido','Reservado'].includes(c.status);
 $('easyResultSection').classList.toggle('hidden',!canFinish);
 $('easySaveNext').disabled=busy||sequencePaused||!sdkReady||!canFinish||!$('easyEnded').checked||!$('easyResult').value||($('easyResult').value==='Retornar'&&!$('easyCallbackAt').value);
 $('easySaveOnly').disabled=busy||!canFinish||!$('easyEnded').checked||!$('easyResult').value||($('easyResult').value==='Retornar'&&!$('easyCallbackAt').value);
 $('easyHangupNotice').classList.toggle('hidden',!(vendorCallEnded&&canFinish));
 for(const button of document.querySelectorAll('#easyOutcomes [data-call-result]')){
  button.disabled=busy||sequencePaused||!sdkReady||!canFinish;
 }
 $('easyPause').disabled=busy;
 $('easyAutoNext').disabled=!chosen?.isTest||!sdkReady||sequencePaused;
 const autoActive=autoCampaignId===campaignId&&chosen?.isTest===true&&!sequencePaused;
 $('easyAutoStatus').textContent=autoActive?'AUTOMÁTICO ATIVO: aguardando a Directcall confirmar o encerramento para chamar o próximo contato.':'Clique uma vez em COMEÇAR A LIGAR. A sequência seguirá automaticamente se a Directcall confirmar cada encerramento.';
 const oldPending=!!(c&&chosen?.isTest&&['Comando enviado','Resultado desconhecido'].includes(c.status));
 $('easyResumeAuto').classList.toggle('hidden',!oldPending||vendorCallEnded);
 $('easyResumeAuto').disabled=busy||!sdkReady||sequencePaused;
 if(!chosen?.isTest&&$('easyAutoNext').checked)$('easyAutoNext').checked=false;
 const awaiting=list.filter(x=>x.result==='A classificar');
 $('reviewDetails').classList.toggle('hidden',awaiting.length===0);
 $('reviewSummary').textContent='Resultados para classificar depois ('+awaiting.length+')';
 const review=$('reviewItems');review.replaceChildren();
 for(const item of awaiting){
  const row=document.createElement('div');row.className='review-row';
  const heading=document.createElement('strong');heading.textContent=item.name+' · '+item.phone;
  const pick=document.createElement('select');pick.setAttribute('aria-label','Classificar ligação de '+item.name);
  for(const v of ['', 'Atendeu','Não atendeu','Ocupado','Sem interesse','Não ligar']){
   const o=new Option(v||'Como foi a ligação?',v);pick.add(o);
  }
  const btn=document.createElement('button');btn.type='button';btn.className='btn secondary';btn.textContent='Salvar classificação';
  btn.onclick=()=>action(async()=>{if(!pick.value)throw Error('Escolha o resultado antes de salvar');
   if(pick.value==='Não ligar'&&!window.confirm('Bloquear novas chamadas para '+item.name+'?'))return;
   await request('reclassify',{method:'POST',data:{contactId:item.id,result:pick.value}});
   status('Resultado de '+item.name+' classificado com sucesso.','good');
  });
  row.append(heading,pick,btn);review.append(row);
 }
 $('easyModeToggle').textContent=document.body.classList.contains('easy-mode')?'⚙ Ver opções avançadas':'← Voltar ao modo fácil';
}

function show(){if(!view)return;const campaigns=view.campaigns||[],chosen=campaigns.find(x=>x.id===campaignId);
$('userLabel').textContent=view.user.name+' · '+(view.user.role==='admin'?'Administrador':'Operador');
$('campaign').replaceChildren(new Option('Selecione a campanha',''),...campaigns.map(c=>new Option(c.name,c.id)));$('campaign').value=chosen?campaignId:'';
$('admin').style.display=view.user.role==='admin'?'block':'none';
$('quickUpload').style.display=view.user.role==='admin'?'block':'none';
$('gotoImport').style.display=view.user.role==='admin'?'inline-flex':'none';
$('agents').textContent=(view.users||[]).map(x=>x.name+' ('+x.username+')').join(' · ');
const list=view.contacts.filter(c=>c.campaignId===campaignId);
$('total').textContent=list.length;$('pending').textContent=list.filter(c=>c.status==='Pendente').length;$('finished').textContent=list.filter(c=>!['Pendente','Reservado','Comando enviado','Resultado desconhecido'].includes(c.status)).length;$('blocked').textContent=view.blocked;
const campaignType=chosen?(chosen.isTest?'Teste controlado':'Comercial'):'Nenhuma';
$('campaignInfo').textContent=chosen?('Tipo: '+campaignType+' · '+list.length+' contato(s) · '+list.filter(c=>c.status==='Pendente').length+' aguardando'+(chosen.isTest?' · apenas números autorizados':' · ligações seg–sex, 09h–18h')):'Selecione a campanha com a lista importada.';
notice('campaignStatus',chosen?(chosen.paused?'Campanha pausada: chamadas bloqueadas. Ative no botão logo abaixo.':'Campanha ativa · próxima ligação somente com seu comando.'):'Selecione uma campanha.',chosen?.paused?'warn':'');
$('toggleCampaign').style.display=view.user.role==='admin'?'inline-flex':'none';
$('toggleCampaign').textContent=chosen?(chosen.paused?'▶ Ativar campanha':'⏸ Pausar campanha'):'Ativar campanha';
$('toggleCampaign').disabled=busy||!chosen||(chosen.paused&&list.length===0);
const c=active();$('currentName').textContent=c?.name||'Nenhum contato selecionado';$('currentPhone').textContent=c?.phone||'—';
$('currentInfo').textContent=c?'Situação: '+c.status+' · tentativas '+c.attempts:'Selecione o próximo contato.';
notice('queueStatus',c?.status==='Comando enviado'?'Solicitação reservada; aguarde encerramento confirmado.':c?.status==='Resultado desconhecido'?'O resultado do comando é desconhecido. Confira a operadora antes de finalizar.':c?'Contato reservado para você. Confirme o Directcall APP antes de ligar.':chosen?.paused?'Campanha pausada.':'Fila livre para reservar o próximo contato.',c?.status==='Resultado desconhecido'?'warn':'');
$('next').disabled=busy||!chosen||chosen.paused||!!c;$('skip').disabled=busy||!c||c.status!=='Reservado';
$('call').disabled=busy||!sdkReady||!c||c.status!=='Reservado'||chosen?.paused;$('finish').disabled=busy||!c;
$('startQueue').disabled=busy||sequencePaused||!chosen||chosen.paused||!sdkReady||(!!c&&c.status!=='Reservado');
$('finishAndDial').disabled=busy||sequencePaused||!sdkReady||!c||!chosen||chosen.paused||!$('ended').checked||!$('result').value;
$('stopQueue').textContent=sequencePaused?'▶ Retomar novas chamadas':'⏸ Pausar novas chamadas';
if(sequencePaused)notice('queueStatus','Fila pausada neste navegador. Finalize o contato atual antes de sair. Nenhuma nova chamada será solicitada.','warn');
const t=$('rows');t.replaceChildren();for(const x of list.slice(0,1000)){const tr=document.createElement('tr');for(const value of [x.name,x.phone,x.status,x.attempts,x.owner?view.users.find(u=>u.id===x.owner)?.name||'Reservado':'—']){const td=document.createElement('td');td.textContent=String(value??'');tr.appendChild(td)}t.appendChild(tr);}
easyRender();
}
async function refresh(){view=await request('view');profile=view.user;const ids=new Set(view.campaigns.map(x=>x.id));if(!ids.has(campaignId)){campaignId=ids.has(localStorage.getItem(KEY))?localStorage.getItem(KEY):view.campaigns[0]?.id||''}$('auth').classList.add('hidden');$('dashboard').classList.add('ready');$('logout').classList.remove('hidden');show()}
async function action(fn){if(busy)return;busy=true;show();try{await fn();await refresh()}catch(e){status('Erro: '+err(e),'error');console.warn('Central: operação não concluída')}finally{busy=false;show();if(queuedHangup&&!autoHangupProcessing)Promise.resolve().then(processQueuedHangup)}}
async function script(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(Error('Não foi possível carregar a biblioteca '+src));document.head.append(s)})}
const pendingPhoneCalls=new Map();
// Quando o APP oficial é aberto numa janela filha, envia o aviso ao opener,
// que pode ser esta página (em vez do quadro do telefone).
window.addEventListener('message',e=>{
 if(e.origin!=='https://www.directcallsoft.com'&&e.origin!=='https://directcallsoft.com')return;
 if(!e.data||e.data.data!=='Chamada encerrada!'||!lastRequestedDial||vendorCallEnded)return;
 queuedHangup={requestId:lastRequestedDial.id,phone:lastRequestedDial.phone,source:'vendor-opener'};
 processQueuedHangup();
});
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.source!==$('phoneFrame')?.contentWindow)return;
 const m=e.data;if(m?.source!=='central-phone')return;
 if(m.type==='ready'){sdkReady=true;notice('sdkStatus','Telefone Directcall carregado no painel, sem sobrepor a Central. Confira Via navegador e o headset.','good');show();}
 if(m.type==='error'){sdkReady=false;notice('sdkStatus','Erro no telefone integrado: '+String(m.message||'Verifique o navegador'),'error');status('O telefone não carregou. Abra o APP Directcall e verifique a configuração.','error');show();}
 if(m.type==='dial-ack'||m.type==='probe-ack'){const pending=pendingPhoneCalls.get(m.requestId);if(!pending)return;clearTimeout(pending.timeout);pendingPhoneCalls.delete(m.requestId);m.ok?pending.resolve(m.message):pending.reject(Error(m.message||'O aplicativo não respondeu'));}
 if(m.type==='call-ended'){
  if(!lastRequestedDial||m.requestId!==lastRequestedDial.id||m.phone!==lastRequestedDial.phone)return;
  if(!vendorCallEnded){
   queuedHangup=m;
   processQueuedHangup();
  }
 }
});
// A chamada pode terminar enquanto a solicitação ao provedor ainda está em processamento.
// Guarde o evento e reconcilie o estado servidor antes de avançar. Nunca use tempo fixo para discar.
async function processQueuedHangup(){
 if(busy||autoHangupProcessing||!queuedHangup)return;
 autoHangupProcessing=true;
 const event=queuedHangup;queuedHangup=null;
 try{
  await refresh();
  const c=active();
  if(!c||!lastRequestedDial||lastRequestedDial.id!==event.requestId||lastRequestedDial.contactId!==c.id||c.phone!==event.phone)return;
  if(!['Comando enviado','Resultado desconhecido'].includes(c.status)||vendorCallEnded)return;
  vendorCallEnded=true;
  $('easyEnded').checked=true;$('ended').checked=true;
  const camp=view.campaigns.find(x=>x.id===c.campaignId);
  if(autoCampaignId===c.campaignId&&camp?.isTest&&!camp.paused&&!sequencePaused&&sdkReady){
   status('✓ Chamada com '+c.name+' encerrada. Registrando e iniciando o próximo número automaticamente...','good');
   $('result').value='A classificar';
   // Executamos na mesma transação de interface; o servidor libera o contato
   // atual ANTES de reservar o seguinte. Uma confirmação nunca inicia duas chamadas.
   await finishCurrent(true);
   await refresh();
   status('Modo automático: aguardando o encerramento da próxima chamada; resultados ficam para classificar.','good');
  }else{
   status('✓ A Directcall confirmou o fim da ligação com '+c.name+'. Toque no resultado para continuar ou inicie o modo automático.','good');
   show();
   if(document.body.classList.contains('easy-mode'))$('easyResultSection').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
 }catch(e){
  autoCampaignId=null;
  status('Automação pausada para evitar ligações repetidas: '+err(e),'error');
 }finally{
  autoHangupProcessing=false;
  if(queuedHangup&&!busy)Promise.resolve().then(processQueuedHangup);
 }
}
async function sdk(force=false){
 const frame=$('phoneFrame');
 if(!frame)throw Error('Painel de telefone não encontrado');
 const alreadyLoaded=!!frame.getAttribute('src');
 const staleAttempt=!!(active()&&['Comando enviado','Resultado desconhecido'].includes(active().status));
 // A recorded attempt does not prove an actual phone call. Always allow
 // loading the phone on initial page load, including after an interrupted attempt.
 if(alreadyLoaded&&!force){
   if(sdkReady){notice('sdkStatus','Telefone já aberto. Confira Via navegador na Directcall.','good');return;}
   notice('sdkStatus','O telefone ainda está carregando. Se não aparecer, use Reconectar interface.','warn');return;
 }
 // On deliberate reload of a running frame, get confirmation only if the
 // database indicates a pending attempt. Never block the initial mount.
 if(alreadyLoaded&&force&&staleAttempt){
   if(!window.confirm('Existe uma tentativa de ligação registrada. Antes de reiniciar o telefone, confira que NÃO há chamada ativa na Directcall. Você já verificou isso?'))return;
 }
 sdkReady=false;
 notice('sdkStatus',staleAttempt?'Abrindo telefone. Existe uma tentativa anterior pendente no histórico, mas ela não impede o carregamento.':'Abrindo telefone isolado dentro do cartão...');
 frame.src='/telefone?ts='+Date.now();
 show();
}
function expandPhone(){
 if(!sdkReady)throw Error('O telefone ainda está inicializando. Use Reconectar interface caso não apareça.');
 const frame=$('phoneFrame');
 if(!frame?.contentWindow)throw Error('Painel Directcall não disponível');
 frame.contentWindow.postMessage({source:'central-operator',type:'expand'},location.origin);
}
function sendProvider(c){
 if(!sdkReady)throw Error('Plugin Directcall ainda não carregou dentro do painel');
 const frame=$('phoneFrame');if(!frame?.contentWindow)throw Error('Painel de telefone desconectado');
 const requestId=crypto.randomUUID();
 vendorCallEnded=false;lastRequestedDial={id:requestId,phone:c.phone,contactId:c.id,at:Date.now()};
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{pendingPhoneCalls.delete(requestId);reject(Error('O painel não confirmou o envio do comando. Confira o APP antes de qualquer nova tentativa.'))},5000);
  pendingPhoneCalls.set(requestId,{resolve,reject,timeout});
  frame.contentWindow.postMessage({source:'central-operator',type:'dial',requestId,id:c.id,name:c.name,phone:c.phone},location.origin);
 });
}
async function checkPhoneWithoutCall(){
 if(!sdkReady)throw Error('Abra o aparelho Directcall e aguarde ele carregar.');
 const frame=$('phoneFrame');if(!frame?.contentWindow)throw Error('Telefone não encontrado');
 const requestId=crypto.randomUUID();
 const message=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{pendingPhoneCalls.delete(requestId);reject(Error('A Directcall não respondeu ao teste. Confirme o login no APP.'))},5200);
  pendingPhoneCalls.set(requestId,{resolve,reject,timeout});
  frame.contentWindow.postMessage({source:'central-operator',type:'probe',requestId},location.origin);
 });
 status('✓ O APP Directcall respondeu ao teste SEM ligar para ninguém. Agora confirme que está conectado em Via navegador. Isso ainda não verifica se uma chamada vai tocar.','good');
 notice('sdkStatus','APP respondeu ao teste de comunicação. Login, saldo e chamadas reais ainda precisam ser confirmados.','good');
 return message;
}
async function boot(){try{const state=await request('status');if(!state.configured){setupUI(false);return}try{await refresh();await sdk();}catch{setupUI(true)}}catch(e){setupUI(true);notice('authMessage','Não foi possível conectar ao banco da Central: '+err(e),'error')}}
$('setupForm').onsubmit=async e=>{e.preventDefault();try{const r=await request('setup',{method:'POST',data:{key:$('setupKey').value,name:$('setupName').value,password:$('setupPass').value}});$('setupPass').value='';await refresh();await sdk();}catch(ex){notice('authMessage',err(ex),'error')}};
$('loginForm').onsubmit=async e=>{e.preventDefault();const b=$('loginButton');b.disabled=true;try{await request('login',{method:'POST',data:{username:$('username').value.trim(),password:$('password').value}});$('password').value='';await refresh();await sdk()}catch(ex){const m=err(ex);notice('authMessage',m.includes('muitas tentativas')?'Limite de segurança: aguarde 60 segundos antes de tentar novamente. Se não lembrar a senha, clique em Recuperar senha.':m,'error')}finally{b.disabled=false}};
$('showRecover').onclick=()=>{$('loginForm').classList.add('hidden');$('recoveryForm').classList.remove('hidden');notice('authMessage','Abra seu link individual de recuperação para preencher o código seguro.');};
$('cancelRecovery').onclick=()=>{$('recoveryForm').classList.add('hidden');$('loginForm').classList.remove('hidden');$('recoveryPassword').value='';$('recoveryConfirm').value='';notice('authMessage','Entre com usuário admin e sua senha atual.');};
$('recoveryForm').onsubmit=async e=>{e.preventDefault();if($('recoveryPassword').value!==$('recoveryConfirm').value){notice('authMessage','As duas senhas estão diferentes.','error');return;}const b=$('submitRecovery');b.disabled=true;try{await request('reset-password',{method:'POST',data:{code:$('recoveryCode').value.trim(),password:$('recoveryPassword').value}});$('recoveryCode').value='';$('recoveryPassword').value='';$('recoveryConfirm').value='';$('recoveryForm').classList.add('hidden');$('loginForm').classList.remove('hidden');$('username').value='admin';$('password').focus();notice('authMessage','Senha redefinida. Entre com usuário admin e a nova senha. Nenhum contato foi perdido.','good')}catch(ex){notice('authMessage','Recuperação não concluída: '+err(ex),'error')}finally{b.disabled=false}};
$('logout').onclick=async()=>{autoCampaignId=null;queuedHangup=null;await request('logout',{method:'POST',data:{}});profile=null;view=null;sdkReady=false;$('phoneFrame').removeAttribute('src');$('logout').classList.add('hidden');setupUI(true)};
$('campaign').onchange=e=>{campaignId=e.target.value;localStorage.setItem(KEY,campaignId);show()};

$('easyModeToggle').onclick=()=>{document.body.classList.toggle('easy-mode');show();window.scrollTo({top:0,behavior:'smooth'})};
$('easyCampaign').onchange=e=>{campaignId=e.target.value;localStorage.setItem(KEY,campaignId);show()};
$('easyPhoneButton').onclick=()=>{$('phoneCard').scrollIntoView({behavior:'smooth',block:'start'});try{if(sdkReady)expandPhone();else sdk(true)}catch(e){status('Não foi possível mostrar o telefone: '+err(e),'warn')}};
$('easyProbe').onclick=()=>action(checkPhoneWithoutCall);
$('easyFile').onchange=async()=>{
 const file=$('easyFile').files[0];if(!file)return;
 if(file.size>50000){status('Este teste aceita até cinco números. Escolha uma lista menor.','warn');$('easyFile').value='';return}
 try{$('easyPaste').value=await file.text();$('easyImportDetails').open=true;status('Arquivo escolhido. Confira os nomes e marque a autorização antes de usar a lista.','good')}
 catch(e){status('Não consegui ler o arquivo. Confira se é um CSV.','error')}
};
$('easyImport').onclick=()=>action(async()=>{
 if(view?.user.role!=='admin')throw Error('Somente o administrador pode criar novas listas');
 if(!$('easyConsent').checked)throw Error('Confirme a autorização dos destinatários');
 const text=$('easyPaste').value.trim();
 if(!text)throw Error('Escolha um arquivo CSV ou cole os contatos');
 const names=text.split(/\r?\n/).map(x=>x.split(/[;,]/)[0].trim()).filter(x=>x&&!/^nome$/i.test(x));const campaignName='Teste '+(names.slice(0,2).join(' e ')||'contatos')+' · '+new Date().toLocaleDateString('pt-BR');
 const r=await request('test-list',{method:'POST',data:{name:campaignName,text,consent:true}});
 campaignId=r.campaign.id;localStorage.setItem(KEY,campaignId);
 $('easyPaste').value='';$('easyFile').value='';$('easyConsent').checked=false;$('easyImportDetails').open=false;
 status('✓ Lista com '+r.count+' contatos pronta! Agora confira o telefone e clique em COMEÇAR A LIGAR.','good');
});
$('easyResumeAuto').onclick=()=>action(async()=>{
 const c=active(),camp=view?.campaigns.find(x=>x.id===c?.campaignId);
 if(!c||!camp?.isTest||!['Comando enviado','Resultado desconhecido'].includes(c.status))throw Error('Nenhuma ligação anterior pendente para retomar');
 if(!sdkReady||sequencePaused)throw Error('Abra o telefone Directcall e retire a pausa antes de continuar');
 if(!window.confirm('A chamada anterior com '+c.name+' JÁ ESTÁ ENCERRADA na Directcall? Ao confirmar, a Central vai registrar o resultado como A CLASSIFICAR e ligar para o próximo automaticamente.'))return;
 if(camp.paused)await request('pause',{method:'POST',data:{campaignId:c.campaignId,paused:false}});
 campaignId=c.campaignId;autoCampaignId=campaignId;$('easyAutoNext').checked=true;
 $('result').value='A classificar';$('ended').checked=true;
 await finishCurrent(true,true);
 status('Lista retomada automaticamente. Os resultados pendentes podem ser classificados depois.','good');
});
$('easyStart').onclick=()=>action(async()=>{
 if(!sdkReady)throw Error('Abra o telefone e confira Via navegador antes de ligar');
 if(sequencePaused)throw Error('Ligações pausadas. Clique em Continuar ligações');
 let chosen=view?.campaigns.find(c=>c.id===campaignId);
 if(!chosen)throw Error('Escolha sua lista no passo 1');
 if(chosen.paused){status('Etapa 1/3: ativando a lista...');await request('pause',{method:'POST',data:{campaignId,paused:false}});await refresh()}
 // Clicar em COMEÇAR é a autorização explícita para discar a lista de testes.
 // Não mostrar prompts entre as chamadas. Desligar o modo automático é opcional.
 autoCampaignId=chosen.isTest&&$('easyAutoNext').checked?campaignId:null;
 status(autoCampaignId?'Modo automático ativo. Aguardando eventos reais de encerramento da Directcall.':'Modo manual ativo para esta campanha.','good');
 status('Etapa 2/3: reservando o próximo contato e enviando para a Directcall...');
 await beginQueueDial();
 status('Etapa 3/3: comando entregue ao plugin. Verifique se a Directcall iniciou a ligação e se o celular tocou. A Central não recebe confirmação de toque.','good');
});
$('easyResult').onchange=()=>{$('easyReturnRow').classList.toggle('hidden',$('easyResult').value!=='Retornar');show()};
$('easyEnded').onchange=()=>show();
$('easyCallbackAt').onchange=()=>show();
document.querySelectorAll('#easyOutcomes [data-call-result]').forEach(button=>{
 button.onclick=()=>action(async()=>{
  const c=active();if(!c)throw Error('Nenhuma ligação está em atendimento');
  if(!['Comando enviado','Resultado desconhecido','Reservado'].includes(c.status))throw Error('Finalize o contato atual antes de avançar');
  const result=button.getAttribute('data-call-result');
  if(result==='Retornar'){
   $('easyResult').value='Retornar';$('easyReturnRow').classList.remove('hidden');$('easyExtraDetails').open=true;
   status('Escolha a data e a hora do retorno. Depois clique em SALVAR E LIGAR PARA O PRÓXIMO.','warn');
   show();return;
  }
  if(result==='Não ligar'&&!window.confirm('Confirma que '+c.name+' NÃO deve receber novas ligações?'))return;
  if(!vendorCallEnded&&!window.confirm('Você já DESLIGOU a ligação com '+c.name+' no telefone da Directcall? Somente depois de desligar a Central ligará para a próxima pessoa.'))return;
  $('easyResult').value=result;$('easyEnded').checked=true;
  await easyFinish(true);
 });
});

async function easyFinish(next){
 if(!$('easyEnded').checked)throw Error('Primeiro desligue no Directcall e marque a confirmação');
 if(!$('easyResult').value)throw Error('Escolha o resultado da ligação');
 $('result').value=$('easyResult').value;
 $('ended').checked=true;
 $('callbackAt').value=$('easyCallbackAt').value;
 if(!next)sequencePaused=true;
 await finishCurrent(next);
 $('easyResult').value='';$('easyEnded').checked=false;$('easyCallbackAt').value='';$('easyReturnRow').classList.add('hidden');
 if(!next)status('Resultado salvo. Nenhuma nova chamada será feita até você continuar.','good');
}
$('easySaveNext').onclick=()=>action(()=>easyFinish(true));
$('easySaveOnly').onclick=()=>action(()=>easyFinish(false));
$('easyPause').onclick=()=>{sequencePaused=!sequencePaused;if(sequencePaused)autoCampaignId=null;show();status(sequencePaused?'Fila pausada: nenhuma nova ligação será iniciada.':'Fila liberada. Clique em COMEÇAR A LIGAR para continuar.','good')};
$('easyAutoNext').onchange=()=>{
 if(!$('easyAutoNext').checked){
  autoCampaignId=null;status('Avanço automático desativado. A chamada atual não será interrompida.','good');
 }else{
  const chosen=view?.campaigns.find(x=>x.id===campaignId);
  if(!chosen?.isTest){$('easyAutoNext').checked=false;throw Error('Automação permitida apenas para lista de teste autorizada')}
  autoCampaignId=campaignId;status('Avanço automático ativado para os contatos de teste.','good');
 }
 show();
};

$('easyRetry').onclick=()=>action(async()=>{
 const c=active();const chosen=view?.campaigns.find(x=>x.id===c?.campaignId);
 if(!c||!chosen?.isTest)throw Error('Este recurso é apenas para chamadas de teste autorizadas');
 if(chosen.paused)throw Error('A campanha está pausada. Escolha Continuar antes de repetir.');
 if(sequencePaused)throw Error('A fila está pausada. Clique em Continuar ligações.');
 if(!sdkReady)throw Error('O telefone Directcall não carregou. Confira o aparelho e clique em Mostrar telefone.');
 if(!window.confirm('Você conferiu na Directcall que não existe chamada ativa e que o celular NÃO tocou? Se confirmar, a Central vai TENTAR LIGAR agora para '+c.name+'.'))return;
 const r=await request('retry-test',{method:'POST',data:{contactId:c.id,checkedNoActiveCall:true}});
 status('Nova tentativa autorizada: enviando a ligação para '+c.name+'...');
 await requestOneDial(r.contact);
 status('Nova tentativa enviada ao telefone da Directcall para '+c.name+'. Veja se o aparelho mostra a discagem e se o celular toca.','good');
});
$('easyNoRing').onclick=()=>action(async()=>{
 const c=active();const chosen=view?.campaigns.find(x=>x.id===c?.campaignId);
 if(!c||!chosen?.isTest)throw Error('Nenhum teste em andamento para encerrar');
 if(!window.confirm('Confirma que o telefone de '+c.name+' NÃO tocou e que NÃO existe chamada ativa na Directcall? Isso encerrará somente esta tentativa, sem iniciar outra ligação.'))return;
 await request('no-ring',{method:'POST',data:{contactId:c.id,checkedNoActiveCall:true}});
 status('Tentativa de '+c.name+' encerrada como NÃO TOCOU. A fila foi liberada. Escolha o próximo contato e clique em COMEÇAR A LIGAR quando estiver pronto.','good');
});


$('refresh').onclick=()=>action(async()=>{status('Atualizando lista...')});
$('checkSdk').onclick=()=>sdk(true);
$('probePhone').onclick=()=>action(checkPhoneWithoutCall);
$('gotoImport').onclick=()=>document.getElementById('quickUpload').scrollIntoView({behavior:'smooth',block:'start'});
$('gotoPhone').onclick=()=>document.getElementById('phoneCard').scrollIntoView({behavior:'smooth',block:'start'});
$('gotoQueue').onclick=()=>document.getElementById('queueCard').scrollIntoView({behavior:'smooth',block:'start'});
$('testMic').onclick=async()=>{const b=$('testMic'),out=$('micState');b.disabled=true;let stream,ctx;try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Navegador sem permissão de microfone');stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)throw Error('AudioContext indisponível');ctx=new AudioCtor();const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();source.connect(analyser);analyser.fftSize=1024;const values=new Uint8Array(analyser.fftSize);let peak=0;out.textContent='Microfone autorizado. Fale por 2 segundos para verificar o sinal...';for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,250));analyser.getByteTimeDomainData(values);let sum=0;for(const v of values){const n=(v-128)/128;sum+=n*n}peak=Math.max(peak,Math.sqrt(sum/values.length))}out.textContent=peak>0.006?'✓ Microfone captando sua voz. Abra o Directcall APP e confirme Via navegador.':'Microfone autorizado, mas a voz não foi detectada. Confira a entrada selecionada no Windows.'}catch(e){out.textContent='Não foi possível testar: '+(e?.name==='NotAllowedError'?'permita o microfone nas configurações do Chrome.':err(e))}finally{stream?.getTracks().forEach(t=>t.stop());try{await ctx?.close()}catch{}b.disabled=false}};
$('openPhone').onclick=async()=>{try{if(!sdkReady){await sdk(true);return}expandPhone();document.getElementById('phoneCard').scrollIntoView({behavior:'smooth',block:'start'});notice('sdkStatus','Telefone está dentro do painel. Confirme Via navegador no APP.','good')}catch(e){notice('sdkStatus','Não foi possível mostrar: '+err(e)+'. Clique em Reconectar interface.','warn')}};
$('next').onclick=()=>action(async()=>{const r=await request('claim',{method:'POST',data:{campaignId}});status('Contato reservado: '+r.contact.name+'. Confira a Directcall antes de ligar.','good')});
$('skip').onclick=()=>action(async()=>{const c=active();if(!c)return;await request('skip',{method:'POST',data:{contactId:c.id}});status('Contato pulado. Selecione o próximo.')});
async function requestOneDial(c){
 if(!c||c.status!=='Reservado')throw Error('Contato não disponível para nova ligação');
 if(!sdkReady)throw Error('Abra o telefone da Directcall antes de iniciar a fila');
 if(sequencePaused)throw Error('Fila pausada pelo operador');
 const key=crypto.randomUUID().replaceAll('-','');
 status('Registrando a tentativa para '+c.name+'... Não clique novamente.');
 await request('dial',{method:'POST',data:{contactId:c.id},key});
 status('Enviando '+c.phone+' ao telefone Directcall. Aguardando resposta técnica do plugin...');
 try{await sendProvider(c)}
 catch(e){try{await request('unknown',{method:'POST',data:{contactId:c.id}})}catch{}throw Error('Não foi possível confirmar o envio. O contato ficou bloqueado para evitar outra discagem. Confira no APP. '+err(e))}
 status('Ligação solicitada para '+c.name+' ('+c.phone+'). Aguarde no Directcall. Ao encerrar, marque o resultado e escolha Salvar e ligar próximo.','good');
}
async function beginQueueDial(){
 if(sequencePaused)throw Error('A fila está pausada');
 const chosen=view?.campaigns.find(x=>x.id===campaignId);
 if(!chosen||chosen.paused)throw Error('Ative uma campanha com contatos antes de iniciar a fila');
 if(!sdkReady)throw Error('Abra o Directcall APP e confirme Via navegador antes de iniciar');
 let c=active();
 if(c&&c.status!=='Reservado')throw Error('Já existe chamada em andamento ou com resultado desconhecido. Finalize-a primeiro.');
 if(!c){const r=await request('claim',{method:'POST',data:{campaignId}});c=r.contact;}
 status('Contato selecionado: '+c.name+' ('+c.phone+'). Enviando o comando à Directcall...');
 await requestOneDial(c);
}
async function finishCurrent(dialNext,operatorHangupConfirmed=false){
 const c=active();if(!c)throw Error('Não há contato em atendimento');
 if(!$('ended').checked)throw Error('Primeiro encerre a ligação no Directcall e marque a confirmação');
 if(!$('result').value)throw Error('Selecione o resultado desta ligação');
 const callResult=$('result').value;
 await request('finish',{method:'POST',data:{contactId:c.id,result:callResult,notes:$('notes').value,callbackAt:$('callbackAt').value,ended:true,providerHangupVerified:callResult==='A classificar'&&vendorCallEnded,operatorHangupConfirmed:callResult==='A classificar'&&operatorHangupConfirmed}});
 vendorCallEnded=false;lastRequestedDial=null;
 $('result').value='';$('notes').value='';$('callbackAt').value='';$('ended').checked=false;$('returnBox').style.display='none';
 // The previous call is committed before any next contact can be reserved or dialled.
 if(sequencePaused||!campaignId){status('Resultado salvo. Fila pausada; nenhuma chamada nova foi iniciada.','good');return}
 const chosen=view.campaigns.find(x=>x.id===campaignId);
 if(!chosen||chosen.paused){status('Resultado salvo. Campanha pausada; não há próxima ligação.','good');return}
 let reserved;
 try{reserved=await request('claim',{method:'POST',data:{campaignId}})}
 catch(e){status('Resultado de '+c.name+' salvo. Nenhum próximo contato foi reservado ('+err(e)+').','good');return}
 if(!dialNext){status('Resultado salvo. Próximo contato: '+reserved.contact.name+'. Clique em Ligar quando estiver pronto.','good');return}
 try{await requestOneDial(reserved.contact)}
 catch(e){status('Resultado anterior salvo. Próximo contato reservado, mas não foi discado: '+err(e),'warn');return}
 status('Resultado de '+c.name+' salvo. Próxima chamada solicitada para '+reserved.contact.name+'.','good');
}
$('stopQueue').onclick=()=>{sequencePaused=!sequencePaused;if(sequencePaused)autoCampaignId=null;show();status(sequencePaused?'Novas chamadas pausadas neste computador. A ligação atual não é interrompida.':'Fila retomada. Clique em Iniciar fila e ligar para continuar.','good')};
$('startQueue').onclick=()=>action(beginQueueDial);
$('call').onclick=()=>action(async()=>{const c=active();if(!c)throw Error('Reserve um contato primeiro');await requestOneDial(c)});
$('result').onchange=()=>{$('returnBox').style.display=$('result').value==='Retornar'?'block':'none';show()};
$('ended').onchange=()=>show();
$('finish').onclick=()=>action(()=>finishCurrent(false));
$('finishAndDial').onclick=()=>action(()=>finishCurrent(true));
$('templateCsv').onclick=()=>{const csv='\uFEFFNome;Telefone\r\n';const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='modelo_lista_central.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1200)};
$('listTestFile').onchange=async()=>{const file=$('listTestFile').files[0];if(!file)return;if(file.size>50000){notice('listTestMessage','Arquivo muito grande para uma lista de até cinco números.','warn');$('listTestFile').value='';return}const text=await file.text();$('listTestText').value=text;notice('listTestMessage','Arquivo carregado. Confira os números, confirme a autorização e clique em Criar campanha de teste em lista.','good')};
$('createListTest').onclick=()=>action(async()=>{if(!$('listTestConsent').checked)throw Error('Confirme a autorização de todos os telefones de teste');const r=await request('test-list',{method:'POST',data:{name:$('listTestName').value,text:$('listTestText').value,consent:true}});campaignId=r.campaign.id;localStorage.setItem(KEY,campaignId);$('listTestConsent').checked=false;$('listTestText').value='';notice('listTestMessage','Campanha de '+r.count+' contatos criada e pausada. Clique em Pausar / retomar campanha para ativar e depois em Iniciar fila e ligar. O próximo telefone só será chamado depois que você encerrar a conversa e clicar em Salvar e ligar próximo.','good');status('Lista de testes pronta, ainda sem chamadas. Entre no Directcall APP e abra o telefone integrado.','good')});
$('createSelfTest').onclick=()=>action(async()=>{if(!$('selfOwned').checked)throw Error('Confirme que o telefone é seu ou autorizado.');const r=await request('self-test',{method:'POST',data:{name:$('selfName').value,phone:$('selfPhone').value,owned:true}});campaignId=r.campaign.id;localStorage.setItem(KEY,campaignId);$('selfOwned').checked=false;notice('selfMessage','Teste criado para '+r.contact.name+'. Campanha pausada: use Pausar / retomar, depois Selecionar próximo contato e Ligar no Directcall. Apenas uma chamada será preparada.','good');status('Campanha de teste salva. Expanda o telefone e faça login no Directcall antes de iniciar a chamada.','good')});
$('createCampaign').onclick=()=>action(async()=>{const r=await request('campaign',{method:'POST',data:{name:$('newCampaign').value,isTest:$('isTest').checked}});campaignId=r.campaign.id;$('newCampaign').value='';$('isTest').checked=false;status('Campanha criada e pausada. Importe contatos e ative-a.','good')});
$('import').onclick=()=>action(async()=>{let text=$('contactsText').value;if($('csv').files[0]){if($('csv').files[0].size>390000)throw Error('Arquivo acima do limite');text=await $('csv').files[0].text()}if(!campaignId)throw Error('Selecione a campanha');const r=await request('import',{method:'POST',data:{campaignId,text}});$('importStatus').textContent=r.added+' adicionados · '+r.duplicates+' repetidos · '+r.invalid+' inválidos · '+r.blocked+' bloqueados';$('contactsText').value='';$('csv').value=''});
$('toggleCampaign').onclick=()=>action(async()=>{const c=view.campaigns.find(x=>x.id===campaignId);if(!c)throw Error('Campanha não selecionada');await request('pause',{method:'POST',data:{campaignId,paused:!c.paused}});status(c.paused?'Campanha retomada.':'Campanha pausada.','good')});
$('createAgent').onclick=()=>action(async()=>{const r=await request('users',{method:'POST',data:{name:$('agentName').value,username:$('agentUsername').value,password:$('agentPassword').value}});$('agentName').value='';$('agentUsername').value='';$('agentPassword').value='';status('Operador '+r.user.name+' criado.','good')});
$('download').onclick=async()=>{try{const blob=await request('export');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='central-operadores.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}catch(e){status(err(e),'error')}};
boot();
})();