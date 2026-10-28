# Central de Ligações — motor piloto (sem discagem externa)

O serviço de teste do Render e o agente local são complementares ao site existente.

**O agente NÃO está instalado no notebook.** É preciso acesso autorizado ao WSL Ubuntu para colocá-lo em execução.

`server.js` oferece `/health`, `/api/campaigns`, `/api/audit`, `/api/import`, `/api/pilot/internal-test`, `/api/agent/poll` e `/api/agent/report`. Todas as rotas `/api/` requerem Bearer token, salvo `/health`.

`/api/campaign/start` bloqueia todas as chamadas externas com HTTP 423. O agente `agent.py` só permite o ramal local PJSIP/1001 e eco 600.

O Render gratuito usa estado volátil (em memória). O backup original fica no ambiente privado do serviço para inicialização do piloto; as alterações feitas via API não sobrevivem a reinícios. NÃO usar como operação comercial.

O projeto principal e o Asterisk não foram modificados por esta entrega. O código está em uma ramificação isolada do GitHub, sem alterações na principal.

Testes locais: `node --test test_server.js` e `python3 -m unittest test_agent.py`.

**Segurança:** nenhum token, número real ou segredo SIP incluído neste ZIP. Não exponha o token do motor.