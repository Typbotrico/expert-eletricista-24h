# Central original + motor piloto 0.5

Site preservado: https://central-de-ligacoes.ricogisi.chatgpt.site/
Motor existente: https://central-ligacoes-motor-piloto.onrender.com/

Esta revisão conecta o painel original ao motor por backend autenticado. Não habilita discagem externa. O histórico do simulador não comprova ligação telefônica.

## Implantação

- Site: manter projeto e banco `DB`. Migração 0001 adiciona somente `motor_state`; não altera `workspaces`.
- Site: `TELEPHONY_ENGINE_URL`, `TELEPHONY_ENGINE_TOKEN` (admin), `MOTOR_PERSISTENCE_TOKEN`.
- Motor: publicar `pilot-server.cjs` como `server.js`, exclusivamente no branch `central-ligacoes-motor-piloto` do repositório existente.
- Motor: `CENTRAL_ADMIN_TOKEN`, `CENTRAL_AGENT_TOKEN`, `CENTRAL_STORAGE_URL`, `CENTRAL_STORAGE_TOKEN`, `CENTRAL_SITE_ACCESS_TOKEN`. Não gravar valores no repositório.
- `CENTRAL_BACKUP_B64` existente é preservado; só inicializa um banco ainda vazio. O estado persistido tem prioridade nos próximos reinícios.
- O token antigo `CENTRAL_API_TOKEN` deve ser rotacionado e deixa de autorizar o motor 0.5.
- Persistência CAS: mudanças só são confirmadas depois do banco; concorrência é serializada. Falha de armazenamento fecha novas operações. Reiniciar após corrigir a persistência.
- Job entregue e sem resultado fica `unknown` após reinício, nunca volta automaticamente à fila. Teste não entregue expira após 60 segundos; lease expira após 90 segundos.

## Homologação local reproduzível

`node --test telephony/pilot-server.test.cjs`
`node --test telephony/engine.test.mjs`
`node tests/engine.cjs`
`node --experimental-strip-types tests/workspace.mjs`

Os testes automatizados usam serviços substitutos locais; não comprovam chamada ou áudio reais.

## Notebook — pendência explícita

Não houve acesso remoto ao notebook Windows/WSL. Nenhum instalador foi executado nele, nenhuma configuração Asterisk/Directcall foi alterada e não se deve afirmar agente conectado sem heartbeat real.

O painel Telefonia real oferece Conectar notebook: emite código de uso único por 10 minutos. `install-agent.sh` verifica o agente pelo SHA-256, reaproveita somente o segredo AMI existente, instala serviço sem alterar Asterisk e troca o código por credencial restrita. `agent.py` usa journal fsync, lease e eventos AMI correlacionados. Comando aceito não vira atendimento. Código consumido com resposta perdida exige novo pareamento. O serviço do WSL inicia quando a distribuição inicia; isto não garante inicialização automática do Windows/WSL. Não reutilizar token administrativo no notebook. Não expor AMI 5038 ou ponte 8765 na internet.

## Saída externa — pendência explícita

`POST /api/campaign/start` retorna 423 incondicionalmente. Nenhum parâmetro ou variável habilita PSTN nesta revisão. Para concluir, ainda são necessários: validar no Asterisk a correção informada pela Directcall em 28/10/2026, agente permanente, fila de contatos autorizados com disponibilidade real do vendedor, bridge para 1001, resultados e duração por chamada, testes de áudio e reinício.

## Rollback

A versão anterior do Site pode ser republicada; a tabela adicional não impede seu funcionamento. Reverter o motor para 0.2 não é um rollback operacional seguro: ele usa credencial única e memória volátil. Preserve a versão 0.5 estável e seus segredos; corrija falhas nela. Não restaurar segredo potencialmente exposto.

## Atualização 28/10/2026

A Directcall respondeu ao chamado CST-57471 às 09:27 (Brasília), informando ajuste interno e pedindo novo teste. A correção é declaração do provedor, ainda não validada no notebook. A versão 0.5 distingue heartbeat do agente de login AMI confirmado. Nenhum teste é entregue sem AMI pronta. Sincronização preserva campanhas, contatos, histórico e bloqueios omitidos por uma cópia antiga.
