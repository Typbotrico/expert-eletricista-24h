# Central de Ligações — alternativa provisória SEM VPS (Directcall REST API)

## Estado comprovado em 28/10/2026
- Site principal preservado: https://central-de-ligacoes.ricogisi.chatgpt.site/
- Motor existente Render Free: https://central-ligacoes-motor-piloto.onrender.com/
- Código da alternativa: `directcall-pilot.cjs`, conectado em `server.js`.
- Deploy: `dep-dbh7l4t9el5s73d0k010`, commit `1c2db0d306f3474f9581b8303ca58c2599de4978`, status `live`.
- Health de produção respondeu normalmente e a rota administrativa negou requisição pública (HTTP 401).
- Testes simulados da camada Directcall aprovados (10 verificações com transporte simulado); nenhum teste real faturável.
- `DIRECTCALL_PILOT_ENABLED=0` configurado explicitamente no Render: NÃO origina chamadas.

## Arquitetura temporária
Vendedor acessa Central de Ligações > escolhe contato > clica “Ligar via telefone” > backend autenticado do site solicita `/voz/call` via motor Render > Directcall chama PRIMEIRO o telefone físico do vendedor e DEPOIS o cliente.
**O vendedor fala ao telefone físico**. Não há áudio pelo navegador neste modo.
A API gerencia a telefonia na operadora; não há necessidade de SIP, MicroSIP, Asterisk, portas UDP ou VPS.
**Chamadas continuam tarifadas pela Directcall**. Confirmar valores e se o serviço API está habilitado, pois credenciais SIP não substituem as credenciais da REST API.

## Configuração necessária (somente no cofre de ambiente do Render)
- `DIRECTCALL_API_CLIENT_ID`: identificação da conta **API** da Directcall.
- `DIRECTCALL_API_CLIENT_SECRET`: senha exclusiva da conta **API**.
- `DIRECTCALL_PILOT_ORIGINS`: telefone(s) autorizado(s) de vendedores, no formato 55+DDD+numero, separação por vírgula.
- `DIRECTCALL_PILOT_DESTINATIONS`: telefones de teste explicitamente autorizados, mesmo formato.
- `DIRECTCALL_PILOT_ENABLED`: deixar `0` até confirmação do preço, ativação da API, consentimento para ligar e teste com números próprios; usar `1` só para piloto.
Nunca colar credenciais em GitHub, páginas públicas, screenshots ou conversa.

## Contrato HTTP (somente servidor -> servidor, requer Bearer CENTRAL_ADMIN_TOKEN)
- GET `/api/directcall/status`: retorna flags e contagem de números autorizados, sem segredos.
- POST `/api/directcall/preview` com JSON `{"origem":"55...","destino":"55..."}`: valida formato/autorização sem efetuar ligação nem gerar custo.
- POST `/api/directcall/call` com `Idempotency-Key` único (16 a 80 caracteres) e JSON `{"origem":"55...","destino":"55...","confirmation":"LIGAR_AGORA"}`:
   - Requer modo ativado, credenciais, origem/destino em listas explícitas;
   - no máximo 3 tentativas por processo em janela de 24 horas e 90 segundos entre tentativas;
   - uma solicitação por vez, sem rediscagem automática;
   - solicita `inverter_discagem=s` para chamar vendedor primeiro e `gravar=n`;
   - retorna `202` quando a operadora aceitou o PEDIDO (não confirma áudio/atendimento);
   - em timeout, retorno indeterminado, não repetir sem checagem da operadora.
- Não habilitar chamadas em massa e nunca expor token administrativo no JavaScript do navegador.
- O site deve usar seu backend autenticado para proxyar a chamada e associar o evento ao contato/campanha do vendedor.

## Próximo bloqueio real
Obter credenciais da REST API Directcall e confirmar habilitação/custos para a conta atual. Foi localizada documentação da Directcall para testes grátis, mas não foi comprovada emissão das credenciais nesta conta.
Referências oficiais:
https://docs.api.directcall.com.br/wiki/spaces/cloudapi/pages/950307/
https://docs.api.directcall.com.br/wiki/spaces/cloudapi/pages/950320/
https://docs.api.directcall.com.br/wiki/spaces/cloudapi/pages/950369/

## Critérios de validação para avançar
1. Autenticação API bem-sucedida no Render sem expor segredo.
2. Preview de números de teste autorizado.
3. Uma chamada consentida com vendedor recebendo no celular, cliente de teste atendendo e áudio bidirecional conferido.
4. Resultado/status da chamada e registro no CRM do site original.
5. Só então ampliar operação e avaliar custo vs VPS + SIP.
