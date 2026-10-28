# Central original + motor piloto 0.6

Site preservado: https://central-de-ligacoes.ricogisi.chatgpt.site/
Motor existente: https://central-ligacoes-motor-piloto.onrender.com/

Esta revisão conecta o painel original ao motor e habilita somente um piloto externo restrito ao número autorizado. Campanhas comerciais continuam bloqueadas. O histórico do simulador não comprova ligação telefônica.

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

Até a versão 0.5, `POST /api/campaign/start` retornava 423 incondicionalmente. A exceção controlada da versão 0.6 está descrita abaixo. Para concluir, ainda são necessários: validar no Asterisk a correção informada pela Directcall em 28/10/2026, agente permanente, fila de contatos autorizados com disponibilidade real do vendedor, bridge para 1001, resultados e duração por chamada, testes de áudio e reinício.

## Rollback

A versão anterior do Site pode ser republicada; a tabela adicional não impede seu funcionamento. Reverter o motor para 0.2 não é um rollback operacional seguro: ele usa credencial única e memória volátil. Preserve uma versão estável e seus segredos; corrija falhas nela. Não restaurar segredo potencialmente exposto.

## Atualização 28/10/2026

A Directcall respondeu ao chamado CST-57471 às 09:27 (Brasília), informando ajuste interno e pedindo novo teste. A correção é declaração do provedor, ainda não validada no notebook. A versão 0.5 distingue heartbeat do agente de login AMI confirmado. Nenhum teste é entregue sem AMI pronta. Sincronização preserva campanhas, contatos, histórico e bloqueios omitidos por uma cópia antiga.

## Piloto externo 0.6 — uma ligação para número autorizado

O proprietário confirmou na conversa que o eco 600 e a rota 700 funcionaram com áudio. Essa declaração é separada dos eventos medidos pelo motor. Não houve chamada externa automática comprovada até a publicação deste código.

O destino permitido é derivado exclusivamente do backup inicial privado `CENTRAL_BACKUP_B64`, na campanha de teste `1d98902a-3054-48ba-b1d4-686a8ff9a9c7`, com exatamente um telefone real elegível. Sincronizações e parâmetros HTTP não alteram esse destino permitido. O agente 0.6 anuncia o hash do destino fixo da extensão 700, obtido localmente pelo instalador. Se o hash não corresponder, a chamada é bloqueada.

A ligação reserva o vendedor primeiro: `PJSIP/1001` atende, então o Asterisk executa `700@central-interna`, sem alterar o dialplan existente. Não há discagem de listas comerciais, paralelismo, retentativas automáticas ou destinos arbitrários. A campanha deve usar uma linha e um atendente, respeitar expediente de Brasília e não conter bloqueio ao número.

`POST /api/campaign/start` exige confirmação e chave idempotente. Uma única chamada fica ativa. Pausar/parar cancela o que ainda não foi entregue ao agente; uma conversa ativa termina normalmente. Se houver reinício ou resultado desconhecido, a reserva fica retida até conferência humana no MicroSIP. Não se origina novamente um job já preparado/enviado.

`POST /api/agent/event` recebe eventos numerados e correlacionados por Uniqueid/ActionID: atendimento do vendedor, DialBegin, DialEnd ANSWER, dois canais na mesma bridge e Hangup. A duração medida é da ponte até o primeiro encerramento correlacionado; a reserva só é liberada após o encerramento do canal do vendedor ou resultado terminal seguro. O agente impõe TIMEOUT(absolute)=180 por chamada; após o limite de observação tenta Hangup do canal identificado e mantém desconhecido sem rediscagem.

`GET /api/calls` e `POST /api/calls/qualify` são exclusivos da administração. Confirmar áudio é uma declaração humana, habilitada somente com ponte registrada. Classificação e notas ficam no motor; o backend também atualiza a ficha original via revisão otimista. Não ligar é persistido no bloqueio global. Os resultados têm origem `telephony`; simulação continua distinta.

### Atualização local necessária

O agente já instalado permanece no modo interno até a atualização. O mesmo `install-agent.sh` agora reaproveita `token.json` e solicita novo pareamento apenas se não encontrar token válido. Copia o segredo AMI já existente, consulta `dialplan show 700@central-interna` e não muda os arquivos do Asterisk. Os formatos PJSIP fixos suportados são `número@endpoint` e `endpoint/sip:número@host`; destinos dinâmicos ou múltiplos são recusados. O instalador verifica o SHA-256 do agente antes de instalar e reinicia somente `central-motor-agent`.

O motor exige também o módulo `pilot-external.cjs`, incluído no mesmo commit. Testes locais usam eventos AMI simulados e número sintético; não comprovam voz real. A homologação final exige atualização local, chamada pelo botão do site, confirmação de áudio nos dois aparelhos, encerramento e classificação.
