'use strict';
(()=>{const $=id=>document.getElementById(id),API='/api/operator/',KEY='central.operator.campaign.v1';
let profile=null,view=null,campaignId='',sdkReady=false,sdkLoading=false,busy=false,sequencePaused=false;
const status=(s,kind='')=>{const e=$('message');e.textContent=s;e.className='notice '+kind};
const notice=(id,s,kind='')=>{const e=$(id);e.textContent=s;e.className='notice '+kind};
const err=e=>e?.message||String(e);
async function request(path,{method='GET',data=null,key=null}={}){const opt={method,credentials:'same-origin',headers:{'Accept':'application/json'}};if(data!==null){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(data)}if(key)opt.headers['Idempotency-Key']=key;const response=await fetch(API+path,opt);if(!response.ok){let msg='HTTP '+response.status;try{msg=(await response.json()).error||msg}catch{}throw Error(msg.replaceAll('_',' '))}return response.headers.get('content-type')?.includes('text/csv')?response.blob():response.json();}
function setupUI(configured){$('auth').classList.remove('hidden');$('dashboard').classList.remove('ready');$('setupForm').classList.toggle('hidden',configured);$('loginForm').classList.toggle('hidden',!configured);$('recoveryForm').classList.add('hidden');notice('authMessage',configured?'Usuário: admin. Use a senha do primeiro cadastro ou recupere seu acesso.':'Primeiro acesso: crie a conta do administrador.');const fragment=new URLSearchParams(location.hash.replace(/^#/,''));if(!configured&&fragment.has('setup'))$('setupKey').value=fragment.get('setup');if(configured&&fragment.has('recuperar')){const code=fragment.get('recuperar');$('recoveryCode').value=code;$('loginForm').classList.add('hidden');$('recoveryForm').classList.remove('hidden');notice('authMessage','Recuperação autorizada: escolha uma nova senha de pelo menos 12 caracteres.','good');}if(fragment.has('recuperar')||fragment.has('setup'))history.replaceState(null,'',location.pathname+location.search);}
const active=()=>view?.active||null;
function show(){if(!view)return;const campaigns=view.campaigns||[],chosen=campaigns.find(x=>x.id===campaignId);
$('userLabel').textContent=view.user.name+' · '+(view.user.role==='admin'?'Administrador':'Operador');
$('campaign').replaceChildren(new Option('Selecione a campanha',''),...campaigns.map(c=>new Option(c.name,c.id)));$('campaign').value=chosen?campaignId:'';
$('admin').style.display=view.user.role==='admin'?'block':'none';
$('agents').textContent=(view.users||[]).map(x=>x.name+' ('+x.username+')').join(' · ');
const list=view.contacts.filter(c=>c.campaignId===campaignId);
$('total').textContent=list.length;$('pending').textContent=list.filter(c=>c.status==='Pendente').length;$('finished').textContent=list.filter(c=>!['Pendente','Reservado','Comando enviado','Resultado desconhecido'].includes(c.status)).length;$('blocked').textContent=view.blocked;
notice('campaignStatus',chosen?(chosen.paused?'Campanha pausada: chamadas bloqueadas.':'Campanha ativa · próxima chamada apenas após confirmação.'):'Selecione uma campanha.',chosen?.paused?'warn':'');
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
}
async function refresh(){view=await request('view');profile=view.user;const ids=new Set(view.campaigns.map(x=>x.id));if(!ids.has(campaignId)){campaignId=ids.has(localStorage.getItem(KEY))?localStorage.getItem(KEY):view.campaigns[0]?.id||''}$('auth').classList.add('hidden');$('dashboard').classList.add('ready');$('logout').classList.remove('hidden');show()}
async function action(fn){if(busy)return;busy=true;show();try{await fn();await refresh()}catch(e){status('Erro: '+err(e),'error');console.warn('Central: operação não concluída')}finally{busy=false;show()}}
async function script(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(Error('Não foi possível carregar a biblioteca '+src));document.head.append(s)})}
function dockPhone(){
 const dock=$('directcallDock'),frame=document.getElementById('directcall-frame-web');
 if(!dock||!frame)return false;
 if(frame.parentNode!==dock)dock.appendChild(frame);
 const placeholder=$('phonePlaceholder');if(placeholder)placeholder.style.display='none';
 frame.style.setProperty('position','relative','important');frame.style.setProperty('bottom','auto','important');frame.style.setProperty('right','auto','important');
 frame.style.setProperty('width','350px','important');frame.style.setProperty('height','550px','important');
 const phone=document.getElementById('directcall-app-web');if(phone){phone.setAttribute('allow','microphone; autoplay');phone.setAttribute('title','Telefone oficial Directcall');phone.style.setProperty('width','100%','important');phone.style.setProperty('height','505px','important')}
 return true;
}
async function sdk(){if(sdkLoading)return;sdkLoading=true;sdkReady=false;notice('sdkStatus','Conferindo aplicativo oficial Directcall...');try{
if(!window.jQuery)await script('https://code.jquery.com/jquery-3.7.1.min.js');
if(typeof window.jQuery?.directcall_app!=='function')await script('https://www.directcallsoft.com/api/app/novo/app/directcall-app-web.js');
if(typeof window.jQuery?.directcall_app!=='function')throw Error('Biblioteca carregada, mas comando não disponível.');
if(!window.__operatorDirectcallInitialized){window.jQuery.directcall_app({state:'hide',clicktocall:false,habilitar_menu_chamadas:true,habilitar_menu_sms:false,habilitar_menu_mensagem_de_voz:false});window.__operatorDirectcallInitialized=true}
if(typeof window.jQuery.directcall_app()?.comando!=='function')throw Error('O plugin não disponibilizou o método de ligação.');
sdkReady=true;try{window.jQuery.directcall_app().state(350,550);dockPhone();setTimeout(dockPhone,300)}catch(e){console.warn('Directcall: não foi possível ampliar automaticamente. Use Mostrar telefone.',e)}notice('sdkStatus',dockPhone()?'Telefone oficial fixado dentro da Central. Confirme Via navegador no Directcall APP.':'Plugin carregado. Clique em Mostrar telefone para montar o aparelho nesta tela.','good');
}catch(e){notice('sdkStatus',err(e)+'. Nenhuma chamada será enviada.','error')}
finally{sdkLoading=false;show()}}
function expandPhone(){if(!sdkReady)throw Error('Plugin ainda não carregado');const app=window.jQuery.directcall_app();if(!app||typeof app.state!=='function')throw Error('Controle da janela indisponível. Use Reconectar interface.');app.state(350,550);if(!dockPhone())throw Error('O painel oficial ainda não foi criado. Clique em Reconectar interface.');setTimeout(dockPhone,250)}
function sendProvider(c){if(!sdkReady)throw Error('Plugin da Directcall indisponível');expandPhone();const provider=window.jQuery.directcall_app();const name=c.name.replace(/[|\r\n]/g,' ').slice(0,70),id=c.id.replace(/[^a-zA-Z0-9_-]/g,'');if(typeof provider?.comando!=='function')throw Error('Comando Directcall ausente');provider.comando('1|chamar|'+c.phone+'|'+id+'|'+name)}
async function boot(){try{const state=await request('status');if(!state.configured){setupUI(false);return}try{await refresh();await sdk();}catch{setupUI(true)}}catch(e){setupUI(true);notice('authMessage','Não foi possível conectar ao banco da Central: '+err(e),'error')}}
$('setupForm').onsubmit=async e=>{e.preventDefault();try{const r=await request('setup',{method:'POST',data:{key:$('setupKey').value,name:$('setupName').value,password:$('setupPass').value}});$('setupPass').value='';await refresh();await sdk();}catch(ex){notice('authMessage',err(ex),'error')}};
$('loginForm').onsubmit=async e=>{e.preventDefault();const b=$('loginButton');b.disabled=true;try{await request('login',{method:'POST',data:{username:$('username').value.trim(),password:$('password').value}});$('password').value='';await refresh();await sdk()}catch(ex){const m=err(ex);notice('authMessage',m.includes('muitas tentativas')?'Limite de segurança: aguarde 60 segundos antes de tentar novamente. Se não lembrar a senha, clique em Recuperar senha.':m,'error')}finally{b.disabled=false}};
$('showRecover').onclick=()=>{$('loginForm').classList.add('hidden');$('recoveryForm').classList.remove('hidden');notice('authMessage','Abra seu link individual de recuperação para preencher o código seguro.');};
$('cancelRecovery').onclick=()=>{$('recoveryForm').classList.add('hidden');$('loginForm').classList.remove('hidden');$('recoveryPassword').value='';$('recoveryConfirm').value='';notice('authMessage','Entre com usuário admin e sua senha atual.');};
$('recoveryForm').onsubmit=async e=>{e.preventDefault();if($('recoveryPassword').value!==$('recoveryConfirm').value){notice('authMessage','As duas senhas estão diferentes.','error');return;}const b=$('submitRecovery');b.disabled=true;try{await request('reset-password',{method:'POST',data:{code:$('recoveryCode').value.trim(),password:$('recoveryPassword').value}});$('recoveryCode').value='';$('recoveryPassword').value='';$('recoveryConfirm').value='';$('recoveryForm').classList.add('hidden');$('loginForm').classList.remove('hidden');$('username').value='admin';$('password').focus();notice('authMessage','Senha redefinida. Entre com usuário admin e a nova senha. Nenhum contato foi perdido.','good')}catch(ex){notice('authMessage','Recuperação não concluída: '+err(ex),'error')}finally{b.disabled=false}};
$('logout').onclick=async()=>{await request('logout',{method:'POST',data:{}});profile=null;view=null;sdkReady=false;$('logout').classList.add('hidden');setupUI(true)};
$('campaign').onchange=e=>{campaignId=e.target.value;localStorage.setItem(KEY,campaignId);show()};
$('refresh').onclick=()=>action(async()=>{status('Atualizando lista...')});
$('checkSdk').onclick=()=>sdk();
$('testMic').onclick=async()=>{const b=$('testMic'),out=$('micState');b.disabled=true;let stream,ctx;try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Navegador sem permissão de microfone');stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)throw Error('AudioContext indisponível');ctx=new AudioCtor();const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();source.connect(analyser);analyser.fftSize=1024;const values=new Uint8Array(analyser.fftSize);let peak=0;out.textContent='Microfone autorizado. Fale por 2 segundos para verificar o sinal...';for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,250));analyser.getByteTimeDomainData(values);let sum=0;for(const v of values){const n=(v-128)/128;sum+=n*n}peak=Math.max(peak,Math.sqrt(sum/values.length))}out.textContent=peak>0.006?'✓ Microfone captando sua voz. Abra o Directcall APP e confirme Via navegador.':'Microfone autorizado, mas a voz não foi detectada. Confira a entrada selecionada no Windows.'}catch(e){out.textContent='Não foi possível testar: '+(e?.name==='NotAllowedError'?'permita o microfone nas configurações do Chrome.':err(e))}finally{stream?.getTracks().forEach(t=>t.stop());try{await ctx?.close()}catch{}b.disabled=false}};
$('openPhone').onclick=async()=>{try{if(!sdkReady)await sdk();expandPhone();notice('sdkStatus','Telefone exibido dentro da Central. Entre no Directcall APP e confirme Via navegador antes da chamada.','good')}catch(e){notice('sdkStatus','Não foi possível mostrar o telefone integrado: '+err(e)+'. Tente Reconectar interface.','warn')}};
$('next').onclick=()=>action(async()=>{const r=await request('claim',{method:'POST',data:{campaignId}});status('Contato reservado: '+r.contact.name+'. Confira a Directcall antes de ligar.','good')});
$('skip').onclick=()=>action(async()=>{const c=active();if(!c)return;await request('skip',{method:'POST',data:{contactId:c.id}});status('Contato pulado. Selecione o próximo.')});
async function requestOneDial(c){
 if(!c||c.status!=='Reservado')throw Error('Contato não disponível para nova ligação');
 if(!sdkReady)throw Error('Abra o telefone da Directcall antes de iniciar a fila');
 if(sequencePaused)throw Error('Fila pausada pelo operador');
 const key=crypto.randomUUID().replaceAll('-','');
 await request('dial',{method:'POST',data:{contactId:c.id},key});
 try{sendProvider(c)}
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
 await requestOneDial(c);
}
async function finishCurrent(dialNext){
 const c=active();if(!c)throw Error('Não há contato em atendimento');
 if(!$('ended').checked)throw Error('Primeiro encerre a ligação no Directcall e marque a confirmação');
 if(!$('result').value)throw Error('Selecione o resultado desta ligação');
 const callResult=$('result').value;
 await request('finish',{method:'POST',data:{contactId:c.id,result:callResult,notes:$('notes').value,callbackAt:$('callbackAt').value,ended:true}});
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
$('stopQueue').onclick=()=>{sequencePaused=!sequencePaused;show();status(sequencePaused?'Novas chamadas pausadas neste computador. A ligação atual não é interrompida.':'Fila retomada. Clique em Iniciar fila e ligar ou em Salvar e ligar próximo após a chamada.','good')};
$('startQueue').onclick=()=>action(beginQueueDial);
$('call').onclick=()=>action(async()=>{const c=active();if(!c)throw Error('Reserve um contato primeiro');await requestOneDial(c)});
$('result').onchange=()=>{$('returnBox').style.display=$('result').value==='Retornar'?'block':'none';show()};
$('ended').onchange=()=>show();
$('finish').onclick=()=>action(()=>finishCurrent(false));
$('finishAndDial').onclick=()=>action(()=>finishCurrent(true));
$('templateCsv').onclick=()=>{const csv='\uFEFFNome;Telefone\\r\\nNome do contato 1;DDD + telefone\\r\\nNome do contato 2;DDD + telefone\\r\\n'.replaceAll('\\r\\n','\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='modelo_lista_central.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1200)};
$('createListTest').onclick=()=>action(async()=>{if(!$('listTestConsent').checked)throw Error('Confirme a autorização de todos os telefones de teste');const r=await request('test-list',{method:'POST',data:{name:$('listTestName').value,text:$('listTestText').value,consent:true}});campaignId=r.campaign.id;localStorage.setItem(KEY,campaignId);$('listTestConsent').checked=false;$('listTestText').value='';notice('listTestMessage','Campanha de '+r.count+' contatos criada e pausada. Clique em Pausar / retomar campanha para ativar e depois em Iniciar fila e ligar. O próximo telefone só será chamado depois que você encerrar a conversa e clicar em Salvar e ligar próximo.','good');status('Lista de testes pronta, ainda sem chamadas. Entre no Directcall APP e abra o telefone integrado.','good')});
$('createSelfTest').onclick=()=>action(async()=>{if(!$('selfOwned').checked)throw Error('Confirme que o telefone é seu ou autorizado.');const r=await request('self-test',{method:'POST',data:{name:$('selfName').value,phone:$('selfPhone').value,owned:true}});campaignId=r.campaign.id;localStorage.setItem(KEY,campaignId);$('selfOwned').checked=false;notice('selfMessage','Teste criado para '+r.contact.name+'. Campanha pausada: use Pausar / retomar, depois Selecionar próximo contato e Ligar no Directcall. Apenas uma chamada será preparada.','good');status('Campanha de teste salva. Expanda o telefone e faça login no Directcall antes de iniciar a chamada.','good')});
$('createCampaign').onclick=()=>action(async()=>{const r=await request('campaign',{method:'POST',data:{name:$('newCampaign').value,isTest:$('isTest').checked}});campaignId=r.campaign.id;$('newCampaign').value='';$('isTest').checked=false;status('Campanha criada e pausada. Importe contatos e ative-a.','good')});
$('import').onclick=()=>action(async()=>{let text=$('contactsText').value;if($('csv').files[0]){if($('csv').files[0].size>390000)throw Error('Arquivo acima do limite');text=await $('csv').files[0].text()}if(!campaignId)throw Error('Selecione a campanha');const r=await request('import',{method:'POST',data:{campaignId,text}});$('importStatus').textContent=r.added+' adicionados · '+r.duplicates+' repetidos · '+r.invalid+' inválidos · '+r.blocked+' bloqueados';$('contactsText').value='';$('csv').value=''});
$('toggleCampaign').onclick=()=>action(async()=>{const c=view.campaigns.find(x=>x.id===campaignId);if(!c)throw Error('Campanha não selecionada');await request('pause',{method:'POST',data:{campaignId,paused:!c.paused}});status(c.paused?'Campanha retomada.':'Campanha pausada.','good')});
$('createAgent').onclick=()=>action(async()=>{const r=await request('users',{method:'POST',data:{name:$('agentName').value,username:$('agentUsername').value,password:$('agentPassword').value}});$('agentName').value='';$('agentUsername').value='';$('agentPassword').value='';status('Operador '+r.user.name+' criado.','good')});
$('download').onclick=async()=>{try{const blob=await request('export');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='central-operadores.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}catch(e){status(err(e),'error')}};
boot();
})();