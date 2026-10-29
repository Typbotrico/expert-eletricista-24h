'use strict';
(()=>{const $=id=>document.getElementById(id),API='/api/operator/',KEY='central.operator.campaign.v1';
let profile=null,view=null,campaignId='',sdkReady=false,sdkLoading=false,busy=false;
const status=(s,kind='')=>{const e=$('message');e.textContent=s;e.className='notice '+kind};
const notice=(id,s,kind='')=>{const e=$(id);e.textContent=s;e.className='notice '+kind};
const err=e=>e?.message||String(e);
async function request(path,{method='GET',data=null,key=null}={}){const opt={method,credentials:'same-origin',headers:{'Accept':'application/json'}};if(data!==null){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(data)}if(key)opt.headers['Idempotency-Key']=key;const response=await fetch(API+path,opt);if(!response.ok){let msg='HTTP '+response.status;try{msg=(await response.json()).error||msg}catch{}throw Error(msg.replaceAll('_',' '))}return response.headers.get('content-type')?.includes('text/csv')?response.blob():response.json();}
function setupUI(configured){$('auth').classList.remove('hidden');$('dashboard').classList.remove('ready');$('setupForm').classList.toggle('hidden',configured);$('loginForm').classList.toggle('hidden',!configured);notice('authMessage',configured?'Entre com o usuário cadastrado.':'Primeiro acesso: crie a conta do administrador.');if(!configured){const fragment=new URLSearchParams(location.hash.replace(/^#/,''));if(fragment.has('setup')){$('setupKey').value=fragment.get('setup');history.replaceState(null,'',location.pathname+location.search);}}}
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
const t=$('rows');t.replaceChildren();for(const x of list.slice(0,1000)){const tr=document.createElement('tr');for(const value of [x.name,x.phone,x.status,x.attempts,x.owner?view.users.find(u=>u.id===x.owner)?.name||'Reservado':'—']){const td=document.createElement('td');td.textContent=String(value??'');tr.appendChild(td)}t.appendChild(tr);}
}
async function refresh(){view=await request('view');profile=view.user;const ids=new Set(view.campaigns.map(x=>x.id));if(!ids.has(campaignId)){campaignId=ids.has(localStorage.getItem(KEY))?localStorage.getItem(KEY):view.campaigns[0]?.id||''}$('auth').classList.add('hidden');$('dashboard').classList.add('ready');$('logout').classList.remove('hidden');show()}
async function action(fn){if(busy)return;busy=true;show();try{await fn();await refresh()}catch(e){status('Erro: '+err(e),'error');console.warn('Central: operação não concluída')}finally{busy=false;show()}}
async function script(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(Error('Não foi possível carregar a biblioteca '+src));document.head.append(s)})}
async function sdk(){if(sdkLoading)return;sdkLoading=true;sdkReady=false;notice('sdkStatus','Conferindo aplicativo oficial Directcall...');try{
if(!window.jQuery)await script('https://code.jquery.com/jquery-3.7.1.min.js');
if(typeof window.jQuery?.directcall_app!=='function')await script('https://www.directcallsoft.com/api/app/novo/app/directcall-app-web.js');
if(typeof window.jQuery?.directcall_app!=='function')throw Error('Biblioteca carregada, mas comando não disponível.');
if(!window.__operatorDirectcallInitialized){window.jQuery.directcall_app({state:'hide',clicktocall:false,habilitar_menu_chamadas:true,habilitar_menu_sms:false,habilitar_menu_mensagem_de_voz:false});window.__operatorDirectcallInitialized=true}
if(typeof window.jQuery.directcall_app()?.comando!=='function')throw Error('O plugin não disponibilizou o método de ligação.');
sdkReady=true;notice('sdkStatus','Plugin disponível. Entre no APP da operadora e confirme “Via navegador”. A autenticação não é verificada pelo carregamento.', 'good');
}catch(e){notice('sdkStatus',err(e)+'. Nenhuma chamada será enviada.','error')}
finally{sdkLoading=false;show()}}
function sendProvider(c){if(!sdkReady)throw Error('Plugin da Directcall indisponível');const provider=window.jQuery.directcall_app();const name=c.name.replace(/[|\r\n]/g,' ').slice(0,70),id=c.id.replace(/[^a-zA-Z0-9_-]/g,'');if(typeof provider?.comando!=='function')throw Error('Comando Directcall ausente');provider.comando('1|chamar|'+c.phone+'|'+id+'|'+name)}
async function boot(){try{const state=await request('status');if(!state.configured){setupUI(false);return}try{await refresh();await sdk();}catch{setupUI(true)}}catch(e){setupUI(true);notice('authMessage','Não foi possível conectar ao banco da Central: '+err(e),'error')}}
$('setupForm').onsubmit=async e=>{e.preventDefault();try{const r=await request('setup',{method:'POST',data:{key:$('setupKey').value,name:$('setupName').value,password:$('setupPass').value}});$('setupPass').value='';await refresh();await sdk();}catch(ex){notice('authMessage',err(ex),'error')}};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await request('login',{method:'POST',data:{username:$('username').value,password:$('password').value}});$('password').value='';await refresh();await sdk()}catch(ex){notice('authMessage',err(ex),'error')}};
$('logout').onclick=async()=>{await request('logout',{method:'POST',data:{}});profile=null;view=null;sdkReady=false;$('logout').classList.add('hidden');setupUI(true)};
$('campaign').onchange=e=>{campaignId=e.target.value;localStorage.setItem(KEY,campaignId);show()};
$('refresh').onclick=()=>action(async()=>{status('Atualizando lista...')});
$('checkSdk').onclick=()=>sdk();
$('next').onclick=()=>action(async()=>{const r=await request('claim',{method:'POST',data:{campaignId}});status('Contato reservado: '+r.contact.name+'. Confira a Directcall antes de ligar.','good')});
$('skip').onclick=()=>action(async()=>{const c=active();if(!c)return;await request('skip',{method:'POST',data:{contactId:c.id}});status('Contato pulado. Selecione o próximo.')});
$('call').onclick=()=>action(async()=>{const c=active();if(!c||c.status!=='Reservado')return;const key=crypto.randomUUID().replaceAll('-','');await request('dial',{method:'POST',data:{contactId:c.id},key});try{sendProvider(c);status('Comando enviado ao Directcall APP. Aguarde a chamada real. Não significa que o cliente atendeu.','good')}catch(e){try{await request('unknown',{method:'POST',data:{contactId:c.id}})}catch{}throw Error('Envio não confirmado: '+err(e)+'. Confira no APP antes de qualquer nova tentativa.') }});
$('result').onchange=()=>{$('returnBox').style.display=$('result').value==='Retornar'?'block':'none'};
$('finish').onclick=()=>action(async()=>{const c=active();if(!c)throw Error('Nenhum contato selecionado');await request('finish',{method:'POST',data:{contactId:c.id,result:$('result').value,notes:$('notes').value,callbackAt:$('callbackAt').value,ended:$('ended').checked}});$('result').value='';$('notes').value='';$('callbackAt').value='';$('ended').checked=false;$('returnBox').style.display='none';try{if(campaignId)await request('claim',{method:'POST',data:{campaignId}});status('Resultado salvo e próximo contato reservado. Clique em Ligar para efetuar a próxima chamada.','good')}catch(e){status('Resultado salvo. '+err(e)+'; a próxima ligação não foi iniciada.','good')}});
$('createCampaign').onclick=()=>action(async()=>{const r=await request('campaign',{method:'POST',data:{name:$('newCampaign').value,isTest:$('isTest').checked}});campaignId=r.campaign.id;$('newCampaign').value='';$('isTest').checked=false;status('Campanha criada e pausada. Importe contatos e ative-a.','good')});
$('import').onclick=()=>action(async()=>{let text=$('contactsText').value;if($('csv').files[0]){if($('csv').files[0].size>390000)throw Error('Arquivo acima do limite');text=await $('csv').files[0].text()}if(!campaignId)throw Error('Selecione a campanha');const r=await request('import',{method:'POST',data:{campaignId,text}});$('importStatus').textContent=r.added+' adicionados · '+r.duplicates+' repetidos · '+r.invalid+' inválidos · '+r.blocked+' bloqueados';$('contactsText').value='';$('csv').value=''});
$('toggleCampaign').onclick=()=>action(async()=>{const c=view.campaigns.find(x=>x.id===campaignId);if(!c)throw Error('Campanha não selecionada');await request('pause',{method:'POST',data:{campaignId,paused:!c.paused}});status(c.paused?'Campanha retomada.':'Campanha pausada.','good')});
$('createAgent').onclick=()=>action(async()=>{const r=await request('users',{method:'POST',data:{name:$('agentName').value,username:$('agentUsername').value,password:$('agentPassword').value}});$('agentName').value='';$('agentUsername').value='';$('agentPassword').value='';status('Operador '+r.user.name+' criado.','good')});
$('download').onclick=async()=>{try{const blob=await request('export');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='central-operadores.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}catch(e){status(err(e),'error')}};
boot();
})();