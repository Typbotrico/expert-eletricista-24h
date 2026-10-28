'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createDirectcallPilot} = require('./directcall-pilot.cjs');

const origem='5521998765432';
const destino='5521987654321';
const env={
 DIRECTCALL_PILOT_ENABLED:'1',
 DIRECTCALL_API_CLIENT_ID:'id-de-teste',
 DIRECTCALL_API_CLIENT_SECRET:'segredo-ficticio',
 DIRECTCALL_PILOT_ORIGINS:origem,
 DIRECTCALL_PILOT_DESTINATIONS:destino
};
const key='idempotency-123456789';
function mock() {
 const requests=[];
 const fetchImpl=async (url,opts)=>{
  requests.push({url,params:new URLSearchParams(opts.body)});
  return {ok:true,json:async()=>url.endsWith('/request_token')?{access_token:'token-ficticio-comprido-12345'}:{status:'ok',codigo:'000',callerid:'uuid-exemplo'}};
 };
 return {requests,fetchImpl};
}

test('piloto fechado quando não configurado',async()=>{
 const m=mock(),p=createDirectcallPilot({env:{},fetchImpl:m.fetchImpl});
 assert.equal(p.status().ready,false);
 assert.equal((await p.call({body:{origem,destino,confirmation:'LIGAR_AGORA'},idempotencyKey:key})).code,503);
 assert.equal(m.requests.length,0);
});
test('preview sem ligação nem custo',()=>{
 const m=mock(),p=createDirectcallPilot({env,fetchImpl:m.fetchImpl});
 assert.equal(p.preview({origem,destino}).body.dry_run,true);
 assert.equal(p.preview({origem,destino}).body.billable,false);
 assert.equal(p.preview({origem,destino:'5521999999999'}).code,422);
 assert.equal(m.requests.length,0);
});
test('ligação exige confirmação, token e chave idempotente',async()=>{
 const m=mock(),p=createDirectcallPilot({env,fetchImpl:m.fetchImpl});
 assert.equal((await p.call({body:{origem,destino},idempotencyKey:key})).code,422);
 assert.equal((await p.call({body:{origem,destino,confirmation:'LIGAR_AGORA'},idempotencyKey:'fraca'})).code,400);
 assert.equal(m.requests.length,0);
});
test('um pedido real para números autorizados, origem primeiro, gravação desligada',async()=>{
 const m=mock(),p=createDirectcallPilot({env,fetchImpl:m.fetchImpl,now:()=>1800000000000});
 const body={origem,destino,confirmation:'LIGAR_AGORA'};
 const first=await p.call({body,idempotencyKey:key});
 assert.equal(first.code,202);
 assert.equal(first.body.accepted,true);
 assert.equal(first.body.provider_status,'requested');
 assert.equal(m.requests.length,2);
 assert.equal(m.requests[0].url,'https://api.directcallsoft.com/request_token');
 assert.equal(m.requests[1].url,'https://api.directcallsoft.com/voz/call');
 assert.equal(m.requests[1].params.get('inverter_discagem'),'s');
 assert.equal(m.requests[1].params.get('gravar'),'n');
 assert.equal((await p.call({body,idempotencyKey:key})).body.replayed,true);
 assert.equal(m.requests.length,2);
 assert.equal((await p.call({body,idempotencyKey:'idempotency-234567890'})).code,429);
 assert.equal(m.requests.length,2);
});
test('falha HTTP fica indeterminada e não repete automaticamente',async()=>{
 let count=0;
 const fetchImpl=async(url)=>{count++;if(url.endsWith('/request_token'))return {ok:true,json:async()=>({access_token:'token-ficticio-comprido-12345'})};throw new Error('timeout');};
 const p=createDirectcallPilot({env,fetchImpl,now:()=>1800000000000});
 const body={origem,destino,confirmation:'LIGAR_AGORA'};
 const one=await p.call({body,idempotencyKey:key});
 assert.equal(one.code,502);
 assert.equal(one.body.provider_status,'unknown');
 assert.equal((await p.call({body,idempotencyKey:key})).body.replayed,true);
 assert.equal(count,2);
});
