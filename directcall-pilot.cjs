'use strict';
/**
 * Central de Ligações — piloto Directcall Click-to-Call.
 * Sem SIP, Asterisk, RTP ou credenciais no navegador.
 * BLOQUEADO por padrão. Apenas números explicitamente autorizados.
 * Cada chamada é um ato manual; não há discagem automática.
 */
const ENDPOINT = 'https://api.directcallsoft.com';
const PHONE = /^55[1-9]\d(?:\d{8}|\d{9})$/;
const YES = value => value === '1';
const parseAllowlist = value => new Set(String(value || '').split(/[\s,;]+/).map(v => v.trim()).filter(v => PHONE.test(v)));
const mask = value => value ? '••••' + String(value).slice(-4) : null;
const keyValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const formatForm = fields => new URLSearchParams(fields).toString();

function createDirectcallPilot({env = process.env, now = Date.now, fetchImpl = globalThis.fetch} = {}) {
  const origins = parseAllowlist(env.DIRECTCALL_PILOT_ORIGINS);
  const destinations = parseAllowlist(env.DIRECTCALL_PILOT_DESTINATIONS);
  const configured = () => Boolean(env.DIRECTCALL_API_CLIENT_ID && env.DIRECTCALL_API_CLIENT_SECRET);
  const enabled = () => YES(env.DIRECTCALL_PILOT_ENABLED);
  const ready = () => enabled() && configured() && origins.size > 0 && destinations.size > 0;
  const history = new Map();
  const attempts = [];
  let inFlight = false;
  let lastAttempt = 0;
  let cachedToken = null;
  let tokenExpires = 0;
  const reply = (code, body) => ({code, body});
  const status = () => ({
    mode:'directcall_click2call',
    enabled:enabled(),
    configured:configured(),
    ready:ready(),
    call_mode:'origem_telefone_vendedor_destino_cliente',
    browser_audio:false,
    requires_external_headset_softphone:false,
    cost_may_apply:true,
    auto_dialer:false,
    max_test_calls_24h:3,
    origin_count:origins.size,
    destination_count:destinations.size,
    reason:ready() ? null : (!enabled() ? 'piloto_desativado' : !configured() ? 'credenciais_api_ausentes' : 'lista_de_numeros_autorizados_ausente')
  });
  async function request(path, fields) {
    const response = await fetchImpl(ENDPOINT + path, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(12000),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:formatForm(fields)
    });
    if (!response.ok) throw new Error('directcall_http_' + response.status);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('directcall_json_invalido');
    return data;
  }
  async function token() {
    if (cachedToken && now() < tokenExpires) return cachedToken;
    const data = await request('/request_token', {
      client_id:env.DIRECTCALL_API_CLIENT_ID,
      client_secret:env.DIRECTCALL_API_CLIENT_SECRET,
      format:'json'
    });
    if (typeof data.access_token !== 'string' || data.access_token.length < 12) throw new Error('directcall_token_indisponivel');
    cachedToken=data.access_token;
    tokenExpires=now()+50*60*1000;
    return cachedToken;
  }
  function pair(origin, destination) {
    if (!PHONE.test(origin || '') || !PHONE.test(destination || '')) return 'numero_invalido_use_55_ddd_numero';
    if (!origins.has(origin)) return 'telefone_de_origem_nao_autorizado';
    if (!destinations.has(destination)) return 'destino_nao_autorizado';
    if (origin===destination) return 'origem_e_destino_iguais';
    return null;
  }
  function preview({origem, destino} = {}) {
    const problem=pair(origem,destino);
    return reply(problem ? 422 : 200, {
      valid:!problem,
      dry_run:true,
      billable:false,
      origin_masked:mask(origem),
      destination_masked:mask(destino),
      error:problem,
      instructions:'A chamada real exige configuração, idempotência e confirmação explícita. O vendedor atende o telefone informado na origem.'
    });
  }
  async function call({body = {}, idempotencyKey} = {}) {
    if (!ready()) return reply(503,{accepted:false,error:status().reason});
    const problem=pair(body.origem,body.destino);
    if (problem) return reply(422,{accepted:false,error:problem});
    if (body.confirmation !== 'LIGAR_AGORA') return reply(422,{accepted:false,error:'confirmacao_explicita_obrigatoria'});
    if (!keyValid(idempotencyKey)) return reply(400,{accepted:false,error:'idempotency_key_obrigatoria'});
    const prior=history.get(idempotencyKey);
    if (prior) return reply(200,{...prior,replayed:true});
    if (inFlight) return reply(429,{accepted:false,error:'outra_chamada_em_processamento'});
    const t=now();
    for (let i=attempts.length-1;i>=0;i--) if (t-attempts[i]>86400000) attempts.splice(i,1);
    if (attempts.length>=3) return reply(429,{accepted:false,error:'limite_tres_chamadas_piloto_24h'});
    if (t-lastAttempt<90000) return reply(429,{accepted:false,error:'intervalo_90_segundos'});
    inFlight=true;
    lastAttempt=t;
    attempts.push(t);
    const record={accepted:false,provider_status:'unknown',origin_masked:mask(body.origem),destination_masked:mask(body.destino),at:new Date(t).toISOString(),cost_may_apply:true};
    history.set(idempotencyKey,record);
    try {
      const access_token=await token();
      const data=await request('/voz/call',{
        access_token,
        origem:body.origem,
        destino:body.destino,
        gravar:'n',
        cli:'n',
        inverter_discagem:'s',
        format:'json'
      });
      const accepted = data.status === 'ok' && String(data.codigo) === '000';
      Object.assign(record, {
        accepted,
        provider_status:accepted?'requested':'rejected',
        provider_code:String(data.codigo || 'desconhecido').slice(0,30),
        callerid:typeof data.callerid==='string' ? data.callerid.slice(0,80) : null,
        meaning:accepted?'Pedido aceito pela operadora. Isso não comprova atendimento nem áudio.':'Operadora não aceitou o pedido.'
      });
      return reply(accepted?202:502,{...record,replayed:false});
    } catch {
      record.provider_status='unknown';
      record.meaning='Resposta indisponível; pode haver chamada em andamento. Não repetir com outra chave sem conferir a operadora.';
      return reply(502,{...record,replayed:false,error:'resultado_da_operadora_indeterminado'});
    } finally {
      inFlight=false;
      if (history.size>100) history.delete(history.keys().next().value);
    }
  }
  async function handle({method,path,body,idempotencyKey} = {}) {
    if (method==='GET' && path==='/api/directcall/status') return reply(200,status());
    if (method==='POST' && path==='/api/directcall/preview') return preview(body);
    if (method==='POST' && path==='/api/directcall/call') return call({body,idempotencyKey});
    return reply(404,{error:'rota_inexistente'});
  }
  return {status, preview, call, handle};
}
module.exports={createDirectcallPilot};
