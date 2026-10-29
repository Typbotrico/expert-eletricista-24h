'use strict';
(()=>{
const Q=window.QueueCore,KEY='central.queue.progressive.v2',el=id=>document.getElementById(id);
let state;try{state=Q.sanitizeState(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{state=Q.fresh()}
let sdkLoaded=false,sdkLoading=false;
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));return true}catch{message('Não foi possível salvar localmente. Exporte os contatos.');return false}}
function message(s){el('status').textContent=s}
function sdkStatus(s,ok=false){el('sdkStatus').textContent=s;el('sdkStatus').className='notice '+(ok?'good':'info')}
function render(){const t=Q.totals(state),c=Q.active(state);
for(const k of ['total','pending','finished','blocked'])el(k).textContent=t[k];
el('currentName').textContent=c?c.name:'Nenhum contato em foco';el('currentPhone').textContent=c?c.phone:'—';el('currentDetail').textContent=c?'Situação: '+c.status+(c.requestedAt?' • Comando enviado às '+new Date(c.requestedAt).toLocaleString('pt-BR'):''):state.paused?'Fila pausada':'Selecione o próximo contato';
el('pause').textContent=state.paused?'Retomar fila':'Pausar fila';el('reserve').disabled=!!c||state.paused;el('dial').disabled=!sdkLoaded||!c||state.paused||c.status!=='Em foco'||c.attempts>0;el('skip').disabled=!c||c.status!=='Em foco';el('save').disabled=!c;
el('queueStatus').textContent=c?.status==='Comando enviado'?'Aguardando confirmação humana de encerramento. Não há rediscagem automática.':state.paused?'Fila pausada, chamadas não autorizadas.':c?'Contato reservado. Faça a ligação somente quando a Directcall estiver pronta.':'Nenhuma chamada ativa. Próximo contato pode ser reservado.';
const body=el('rows');body.replaceChildren();for(const x of state.contacts.slice(0,600)){const tr=document.createElement('tr');for(const value of [x.name,x.phone,x.status,x.attempts,x.finishedAt?new Date(x.finishedAt).toLocaleString('pt-BR'):'—']){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}
}
function script(url){return new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=url;tag.async=false;tag.onload=resolve;tag.onerror=()=>reject(Error('Falha ao carregar biblioteca externa'));document.head.appendChild(tag);});}
async function loadSdk(){if(sdkLoading)return;sdkLoading=true;sdkLoaded=false;render();sdkStatus('Verificando o aplicativo oficial da Directcall...');try{
 if(!window.jQuery)await script('https://code.jquery.com/jquery-3.7.1.min.js');
 if(typeof window.jQuery?.directcall_app!=='function')await script('https://www.directcallsoft.com/api/app/novo/app/directcall-app-web.js');
 if(typeof window.jQuery?.directcall_app!=='function')throw Error('O plugin oficial não expôs a integração esperada.');
 if(!window.__centralSdkInitialized){window.jQuery.directcall_app({state:'hide',clicktocall:false,habilitar_menu_chamadas:true,habilitar_menu_sms:false,habilitar_menu_mensagem_de_voz:false});window.__centralSdkInitialized=true;}
 sdkLoaded=true;sdkStatus('Plugin carregado. Confirme o login e a configuração “Via navegador” no Directcall APP antes de ligar.',true);
 el('vendorApp').textContent='Plugin carregado. A interface oficial da Directcall pode aparecer como um widget flutuante ou solicitar autenticação.';
 }catch(e){sdkStatus('Integração indisponível: '+e.message+'. Não será feito pedido de ligação.');}finally{sdkLoading=false;render();}}
function send(c){if(!sdkLoaded)throw Error('Plugin Directcall não disponível');const app=window.jQuery.directcall_app();if(!app||typeof app.comando!=='function')throw Error('Método de chamada não disponível no plugin');
const cleanName=c.name.replace(/[|\r\n]/g,' ').slice(0,80),id=c.id.replace(/[^a-zA-Z0-9_-]/g,'');
app.comando('1|chamar|'+c.phone+'|'+id+'|'+cleanName);
}
el('retrySdk').onclick=()=>loadSdk();
el('import').onclick=async()=>{const file=el('file').files[0];if(file&&file.size>2e6){el('importFeedback').textContent='Arquivo acima de 2 MB.';return}let text=file?await file.text():el('list').value;const r=Q.add(state,text);persist();render();el('importFeedback').textContent=r.created+' adicionados, '+r.duplicate+' repetidos, '+r.invalid+' inválidos, '+r.blocked+' bloqueados.';};
el('reserve').onclick=()=>{const c=Q.reserve(state);if(c){persist();render();message('Contato selecionado. Confira o APP antes de ligar.')}else message('Nenhum contato pendente ou disponível agora.');};
el('pause').onclick=()=>{state.paused=!state.paused;persist();render();};
el('dial').onclick=()=>{const c=Q.active(state);if(!c||c.status!=='Em foco'||!sdkLoaded)return;try{send(c);Q.requestCall(state);persist();render();message('Comando enviado ao aplicativo. Não confirme atendimento até conferir a chamada real.');}catch(e){message('Nenhuma chamada confirmada: '+e.message);}};
el('skip').onclick=()=>{try{Q.skip(state);persist();Q.reserve(state);persist();render();message('Contato pulado; próximo preparado.')}catch(e){message(e.message)}};
el('result').onchange=()=>el('returnField').style.display=el('result').value==='Retornar'?'block':'none';
el('save').onclick=()=>{try{Q.classify(state,el('result').value,el('notes').value,el('callbackAt').value||null,el('ended').checked);persist();el('result').value='';el('notes').value='';el('callbackAt').value='';el('returnField').style.display='none';el('ended').checked=false;if(!state.paused)Q.reserve(state);persist();render();message('Resultado salvo. Próximo contato preparado; nenhuma ligação iniciada automaticamente.');}catch(e){message(e.message)}};
el('export').onclick=()=>{const data=Q.csv(state);const blob=new Blob([data],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.download='central_resultados.csv';a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
el('clear').onclick=()=>{if(Q.active(state)?.status==='Comando enviado'){message('Confirme o encerramento da chamada antes de apagar a fila.');return}if(!confirm('Apagar contatos e histórico salvos neste navegador?'))return;state=Q.fresh();persist();render();};
render();loadSdk();
})();