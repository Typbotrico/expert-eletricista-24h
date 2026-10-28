# CENTRAL DE LIGAÇÕES — RELATÓRIO DE TRANSFERÊNCIA PARA O CHATGPT WORK

**Data de referência:** 28/10/2026 (America/Sao_Paulo)  
**Situação da entrega:** documentação e código organizados; motor de homologação publicado; discador comercial e integração com o site ORIGINAL **não concluídos**.  
**Regra principal:** retomar o projeto existente, preservar dados e funcionalidades e executar/testar/publicar as pendências. Não recriar a Central do zero e não confundir interface de simulação com discagem telefônica real.

## 1. RESUMO EXECUTIVO E STATUS REAL

A Central é um produto próprio e independente dos projetos NIRA/Neuro X. A meta do proprietário é uma plataforma de discagem ativa para equipes comerciais, com campanhas, importação CSV, fila automática de contatos, entrega de chamadas atendidas a vendedores, registro/resultado real, bloqueio de números e relatórios, sem pagar licença por operador a fornecedores de discadores.

Há **três componentes separados**:

1. **Site original** em `https://central-de-ligacoes.ricogisi.chatgpt.site/`. Está publicado, com telas de campanhas, contatos, atendimento, histórico, configurações e simulação. **O botão de iniciar simulação ainda NÃO telefona.** Não foi obtido acesso de escrita ao código-fonte desse projeto via GitHub/Render. O snapshot da Biblioteca do ChatGPT chama-se `Central de Ligações.txt` (é texto renderizado, não a implementação editável).
2. **Asterisk local + MicroSIP**, no notebook Windows/WSL Ubuntu. O ramal 1001 e o eco 600 foram testados. O usuário confirmou que o **MicroSIP tocou** quando executou um teste local no Ubuntu. A chamada recebida da Directcall para o 1001 também já foi testada com áudio bidirecional. O teste do toque não prova que o agente permanente esteja instalado ou conectado à nuvem.
3. **Motor piloto separado** em `https://central-ligacoes-motor-piloto.onrender.com/`: Node.js sem dependências, hospedado no Render gratuito, status ao vivo verificado. Exibe monitor operacional somente leitura, importou estrutura das duas campanhas, exige Bearer token nas rotas administrativas, gera jobs apenas de teste interno 1001→600, tem agente Python para WSL ainda **não instalado como serviço permanente** e **bloqueia totalmente ligações externas**. Não está conectado ao botão do site original.

**Conclusão objetiva:** há protótipo web e telefonia interna funcional, mas **NÃO** há discagem ativa externa, distribuição automática de chamadas atendidas, resultados reais de chamadas externas nem um produto pronto para operação comercial.

## 2. INVENTÁRIO DE ACESSOS E LOCALIZAÇÃO EXATA

| Elemento | Endereço / referência | Estado |
|---|---|---|
| Site a PRESERVAR | https://central-de-ligacoes.ricogisi.chatgpt.site/ | Publicado; ainda simulador |
| Projeto do site em Biblioteca | `Central de Ligações.txt`; `project_id: appgprj_6ae0ead85eb88191957445673ea11c81`; `source_version_number: 3` | Snapshot textual, não fonte editável |
| Motor piloto | https://central-ligacoes-motor-piloto.onrender.com/ | Live; painel somente leitura |
| Status público | https://central-ligacoes-motor-piloto.onrender.com/api/public/status | Live, sem dados pessoais |
| Health | https://central-ligacoes-motor-piloto.onrender.com/health | Live |
| Render painel | https://dashboard.render.com/web/srv-dbgon4vf3r2c73a9sv20 | Serviço `srv-dbgon4vf3r2c73a9sv20`, plano free, região Virginia |
| Workspace Render | `tea-dbblvh8ae00c73991mvg` | Acessível via conector |
| GitHub: branch do motor | https://github.com/Typbotrico/expert-eletricista-24h/tree/central-ligacoes-motor-piloto | **Branch separada**, não alterar `main` do Expert Eletricista |
| Arquivos de backend | `server.js`, `agent.py`, `test_server.js`, `test_agent.py`, `README.md` | No branch e no ZIP desta entrega |
| Oracle Cloud | `https://cloud.oracle.com/?region=sa-saopaulo-1` | Rede configurada segundo conversa, **instância não confirmada** |
| Directcall e-mail de suporte | Assunto `Falha SIP 603 Decline em chamadas de saída — tronco de teste Asterisk` | E-mail enviado em 28/10/2026; sem resposta útil confirmada até esta revisão |
| Acompanhamento da Directcall | Automação `Resposta Directcall` (ID `6ae18fb47534819182ae90a8732213a6`) | Verificação horária ativa |

**Conta e segredos:** NÃO copiar tokens/credenciais para este documento, GitHub público ou screenshots. Consultar variáveis de ambiente do Render, arquivos locais protegidos e cofre de credenciais via acesso autorizado. O código neste pacote não contém segredo. **Há risco de exposição** de um token anterior no pacote de teste `.zip` entregue ao usuário; antes da instalação definitiva do agente, rotacionar a chave no Render e configurar uma nova chave em arquivo local seguro, com permissões mínimas. Separar credencial do agente de credencial administrativa.

## 3. DADOS E CAMPANHAS EXISTENTES — BACKUP DO USUÁRIO

Arquivo original anexado na conversa: `central-ligacoes.json` (uma segunda exportação `central-ligacoes (1).json` tinha SHA-256 idêntico: `d23293137a3f8a660e6551901a2f5eeb03e02183f7b1507f7f9ed63f63d52138`). **Não publicar esse backup nem reenviar o conteúdo bruto para GitHub, pois contém número real do usuário.**

- Campanha `Curso de Eletricista`, ID `demo`: 8 contatos com `demo:true`, todos fictícios, 7 pendentes, 1 como Interessado após simulação; 1 atendente, 1 linha, janela 09:00–18:00. A simulação anterior aparece no histórico e NÃO deve ser tratada como ligação real.
- Campanha `teste real central`, ID `1d98902a-3054-48ba-b1d4-686a8ff9a9c7`: 1 contato de homologação autorizado, status `Pendente`, 1 atendente e 1 linha, 09:00–18:00. O número foi omitido intencionalmente deste relatório; recuperar de maneira segura exclusivamente do backup, após verificar autorização de uso.
- ID de campanha selecionada no backup: `1d98902a-3054-48ba-b1d4-686a8ff9a9c7`.
- Campos observados: `id`, `name`, `script`, `contacts`, `history`, `agents`, `lines`, `start`, `end`, `block`, `retryLimit`, `retryMinutes`, `agentNames`, `mode`; contatos com `name`, `phone`, `note`, `status`, `demo`, `attempts`, `agent`, `notes` (variável).
- O site suporta exportação de projeto e importação de CSV de contatos (cabeçalho `nome,telefone,observacao`); preservar essas funções. Deve haver deduplicação, validação BR, opt-out/DNC, histórico e resultados reais.

## 4. TELEFONIA LOCAL QUE FUNCIONOU

**Host:** notebook Windows (`luvir`), WSL Ubuntu 24.04 (usuário `paulo`), Asterisk 20.6.0, MicroSIP no Windows. Não foi fornecido acesso remoto persistente à máquina a este agente; o Work deverá usar acesso autorizado, caso o ambiente disponibilize execução no notebook, ou entregar um processo seguro e curto de instalação assistida.

- Transporte local PJSIP: `transporte-local`, UDP `0.0.0.0:5070`.
- Ramal `1001` no MicroSIP, registrado e com áudio funcionando.
- Contexto do ramal `central-interna`: extensão `600` → `Answer()`, `Echo()`, `Hangup()`; extensão `700` é teste de saída pelo trunk e retorna `603 Decline`.
- Directcall SIP trunk registrado em `189.84.133.111:5060`; inbound testado e direcionado a `PJSIP/1001`, com áudio bidirecional.
- Segredos do trunk: `/etc/asterisk/pjsip_directcall.conf` (incluído em `pjsip.conf`); **não publicar**.
- AMI Asterisk habilitado somente em `127.0.0.1:5038`. Usuário restrito `central_piloto`; segredo em `/etc/asterisk/central_piloto_ami.secret`.
- Ponte local `central-ami-bridge` como serviço systemd, endpoint `http://127.0.0.1:8765/health` (GET, `ami:ok` no teste anterior). Rota do instalador original: `POST /test-ring` com Bearer token obtido de `/etc/central-ami-bridge/api.token`, corpo JSON `{}`. Protegida, apenas 1001→600. Outros testes podem usar rota equivalente conforme instalação; confirmar localmente.
- Chrome extension “Central de Ligações — Ponte Asterisk (piloto)”: atualização **v0.3.0 comprovada por print** e painel na seção Telefonia; instalação da v0.4.0 **não confirmada**. O painel injetado pela extensão **não é o código-fonte do site original**.
- Teste de `originate`/eco: MicroSIP 1001 tocou, confirmado pelo usuário na conversa. Resultado `AMI Originate accepted` significa comando aceito, **não confirma atendimento real** sem eventos AMI/ChannelState.

**Não reinstalar ou recriar o Asterisk; manter a configuração existente.** Antes de alterar `.conf`, fazer cópia de segurança, testar `asterisk -rx 'dialplan show'`, SIP/PJSIP, chamadas internas e recebidas.

## 5. MOTOR PILOTO DO RENDER — IMPLEMENTADO E PUBLICADO

Stack Node.js 20+, serviço Render `central-ligacoes-motor-piloto`, branch GitHub `central-ligacoes-motor-piloto`, plano free, autoDeploy `yes`, comando de inicialização `node server.js`. Último deploy inspecionado: `dep-dbgouvnlk1mc7394d55g`, status **live**, commit `94281e1f09da734435e531feced8fc24e3a1508c`. API `/api/public/status` devolveu versão `0.2.0`, `ready:true`, `external_calls_enabled:false`, `agent_connected:false`, 2 campanhas, 9 contatos, 8 fictícios bloqueados, 1 elegível para futura validação, 0 testes internos concluídos registrados no serviço. Esses números podem mudar se o serviço reiniciar/importar dados.

**Rotas atuais:**

| Método e rota | Comportamento |
|---|---|
| `GET /` | Painel somente leitura, sem PII, atualização ~12s |
| `GET /health` | Health público, informa bloqueio externo |
| `GET /api/public/status` | Estado agregado público, sem telefones nem tokens |
| `GET /api/campaigns` | Resumo autenticado, não lista telefones |
| `GET /api/audit` | Histórico/queue do piloto, autenticado |
| `POST /api/import` | Importa backup inteiro (cuidado: pode sobrescrever estado em memória) |
| `POST /api/campaign/start` | **423**: chamadas externas bloqueadas propositalmente |
| `POST /api/pilot/internal-test` | Enfileira UM teste interno 1001→600 (202), com rate limit |
| `GET /api/agent/poll` | Agente autorizado obtém trabalho de teste interno |
| `POST /api/agent/report` | Agente reporta `accepted` ou `failed` (não equivale a chamada atendida) |

**Segurança do protótipo:** uma chave Bearer protege `/api/` (exceto `/api/public/status`), sem CORS; a chave atual serve tanto ao agente quanto aos endpoints de administração — corrigir por RBAC/chaves separadas antes de produção. Dados carregados no Render por variável `CENTRAL_BACKUP_B64`, telefone incluso no ambiente privado da plataforma; **não imprimir valor da variável**. Não há persistência em banco: filas, resultados e alterações via API se perdem em reinício/redeploy. Trabalhar com DB seguro, migrações e backups antes de considerar produção. As chamadas PSTN permanecem impossíveis neste motor, por projeto.

Agente Python em `agent.py` (no repositório): consulta `/api/agent/poll` por HTTPS a cada ~4 segundos, valida `kind=internal_echo_1001`, `channel=PJSIP/1001` e `exten=600`, conecta à AMI somente em loopback, origina o eco interno e informa o resultado. Busca segredo AMI em `/etc/central-ami-bridge/ami.secret` e token do motor em `/etc/central-motor-agent/token`. **O agente não foi comprovadamente instalado como serviço systemd permanente** e o status público informa `agent_connected:false`. Não usar essa versão sem credenciais separadas e configuração segura de serviço.

## 6. TESTES REALMENTE EXECUTADOS E EVIDÊNCIAS

1. `node --test test_server.js`: **2 testes aprovados** em 28/10/2026: filtragem de fictícios; health/painel/status sem PII; autenticação; HTTP 423 para discagem externa; job interno 1001→600 e relatório aceito.
2. `python3 -m unittest discover -s ... -p 'test_agent.py'`: **1 teste aprovado**: validação rígida de jobs, rejeita canal PSTN/outros ramais.
3. Render: `GET /health` e `GET /api/public/status` responderam `ready:true`; Render listou deploy **live**.
4. Acesso a `/api/campaigns` sem autenticação retornou **HTTP 401**, conforme esperado.
5. Interface do monitor foi verificada no endereço público. Não há números de telefone nele.
6. O usuário confirmou manualmente: **“tocou”** após teste único no Ubuntu com MicroSIP aberto. Isso prova toque local, não operação autônoma permanente nem discagem externa.
7. Directcall: inbound com áudio bidirecional foi testado. Outbound foi recusado `603 Decline`. Não existe homologação de ligação para celular por saída PSTN.

**Importante:** não inventar taxas de atendimento, duração de chamada, disponibilidade da operadora ou implantação do agente; apenas os testes acima estão fundamentados.

## 7. ORACLE CLOUD — CONTEXTO, NÃO DEPENDÊNCIA

O usuário iniciou pelo Oracle Cloud uma VCN `rede-central-ligacoes`, subnet `subrede-publica-central`, gateway `internet-central`, tabela de rota default com `0.0.0.0/0` para o gateway. A conversa indicou que as etapas de rede estavam feitas. **Não há prova de instância Compute criada, IP público, chave SSH guardada, acesso SSH, recursos Always Free ou serviços em execução na Oracle.** Work pode verificar o console com autorização já disponível; não exige Oracle para concluir o piloto no Render. Se Oracle for usada, verificar disponibilidade gratuita, segurança de ingress/egress, firewall e não expor AMI/SIP diretamente à internet.

## 8. PENDÊNCIAS COM PRIORIDADES DE EXECUÇÃO PARA O WORK

**P0 — Acessar E EDITAR o código-fonte do SITE ORIGINAL.** Localizar projeto `appgprj_6ae0ead85eb88191957445673ea11c81` ou sua fonte real no ambiente de projetos/Work. **Não** assumir que o snapshot `Central de Ligações.txt` ou o `central-ligacoes.json` representa fonte editável. Preservar rotas, telas, campanhas, contatos, estados, importação/exportação e aparência. Fazer backup antes da primeira mudança. Se falta ferramenta capaz de alterar ChatGPT Sites diretamente, documentar a limitação e propor fluxo de publicação aprovado sem alegar que a alteração foi realizada. Evitar criar uma segunda Central pública substituta não solicitada.

**P1 — Segurança e credenciais.** Rotacionar `CENTRAL_API_TOKEN` do Render devido a distribuição prévia de pacote de teste com segredo; entregar novo segredo ao agente por canal seguro, nunca em ZIP, GitHub, log ou chat. Separar credenciais `admin`/`agent`; princípio do menor privilégio; autenticação de usuários no site e sessão expirada; controles contra CSRF/abusos; DNC; validação e auditoria; impedir replay/duplicidade de job; configurar cabeçalhos, CSP, limites. Não abrir AMI 5038 nem ponte 8765 para Internet.

**P2 — Persistência e modelo real.** Substituir estado em memória por banco com tabelas de campanhas, contatos, bloqueios/DNC, agentes, sessões, chamadas, tentativas, eventos AMI, campanhas em andamento, jobs/idempotência e auditoria. Backups e migrações. Importar o backup protegido (9 contatos) em modo idempotente, preservando IDs/status/histórico; conservar os fictícios como dados de demonstração, nunca encaminhar à discagem. Implementar normalização E.164 e autorização/opt-out LGPD.

**P3 — Conectar site ↔ motor real.** Adicionar ao SITE ORIGINAL um modo de telefonia real claramente distinto do simulador. Ligar Iniciar/Pausar/Parar campanha a endpoints autenticados; disponibilizar status vivo, filas, quantidade de linhas, atendentes, timeout, pacing, horários, retries, resultado por contato, logs. A interface precisa consumir API real e persistir os dados, sem chamar diretamente endpoints de administração a partir de JS público com segredo. Usar backend-for-frontend ou sessão segura. A extensão Chrome é apenas referência provisória.

**P4 — Agente local permanente.** Configurar `agent.py` ou seu sucessor com execução contínua via systemd no WSL, usuário sem privilégios, token de agente individual, logs controlados, reconexão, heartbeat, atualização e rotação de chave. Antes de instalar, verificar se o ambiente Work consegue executar no notebook de forma autorizada; não fingir que comandos no container/Render alteram o PC. Garantir que WSL/Windows retomem o serviço após reinício. Testar no painel `agent_connected:true` e logs de jobs concluídos (com duas evidências distintas: aceito pelo AMI e chamada atendida).

**P5 — Solucionar Directcall 603 Decline.** Consultar resposta ao ticket de 28/10/2026, buscar motivo de bloqueio de conta trial, autorização de chamadas de saída, formato de destino e caller ID, crédito/limites, IP, ACL e regras da operadora. Não adivinhar; reunir captura SIP sem senha (sngrep/ASTERISK pjsip logger), registrar `INVITE/603`. Usar somente número de homologação autorizado. Depois de confirmação pelo provedor, validar 1 chamada externa real com áudio, registros, status SIP, atendimento, hangup e bilhetagem.

**P6 — Discador de produção / distribuição ao vendedor.** Somente após P1–P5: fila de contatos autorizados, limite de 1 linha/1 atendente para piloto, disponibilidade de vendedor antes da chamada, bridge real após answer, abandono/transferência, busy/no-answer/fail, timer, retries, DNC, horário BR, opt-out, encerramento por operador, gravações apenas com base legal e sinalização apropriada. Idempotência e backpressure antes de escalar.

**P7 — Homologar ponta a ponta e PUBLICAR.** Cenários: importação; bloqueio fictícios; DNC; contato real autorizado; iniciar/pausar/parar; ramal 1001; saída Directcall (sem 603); atendimento 2 vias; classificação; dashboard; reinício; falha do agente; logs; rollback; proteção de segredos. Apresentar vídeo/log/screenshot de evidência real. Só então marcar a Central como discador operacional e não como simulação.

**Restrições do usuário:** execução, não mais plano vazio; aproveitar o que já existe; evitar novo VPS como pré-requisito; não requisitar prints repetitivos; preservar aplicativos existentes, inclusive o repositório principal `expert-eletricista-24h` e outras apps Render; **não relacionar a Central ao NIRA**.

## 9. CRITÉRIOS DE ACEITAÇÃO OBJETIVOS

- O site ORIGINAL mantém exatamente suas campanhas, 8 fictícios e 1 contato de teste, com dados e histórico íntegros.
- Um clique em Iniciar campanha na interface REAL dispara somente chamadas de destino autorizado por agente/operadora; modo demonstração fica separado e inequívoco.
- O agente local fica conectado sem linha de comando manual a cada início; o status da nuvem mostra heartbeat real.
- O contato de teste recebe uma chamada externa pela Directcall **após resolver 603**, vendedor 1001 conversa em dois sentidos, resultado e duração salvos em banco.
- Nenhuma chamada para fictícios, bloqueados, fora de horário ou sem autorização.
- Pausar/Parar realmente interrompe a fila; retomada não duplica tentativas; logs e resultados sobrevivem reinício.
- Tests automatizados + 1 ensaio real de ponta a ponta aprovados; publicação verificada no link original. Não marcar “concluído” com base apenas em HTTP 202/AMI Originate accepted.

## 10. ORDEM DE COMEÇO RECOMENDADA, SEM PERDER TEMPO

1. Abrir o **projeto original** usando `project_id`, confirmar modo editável e fazer backup da versão 3; consultar este relatório e os arquivos do ZIP.
2. Verificar no **Render** serviço `srv-dbgon4vf3r2c73a9sv20`, ler logs e endpoint público; no **GitHub**, abrir branch `central-ligacoes-motor-piloto`, rodar testes `node --test test_server.js` e `python3 -m unittest test_agent.py`.
3. Auditar segurança/credenciais, persistência e agentes; preparar integração do site original com API (não expondo token no frontend).
4. Consultar ticket Directcall no Gmail; corrigir tronco só com respaldo técnico, mantendo o inbound funcional.
5. Testar, conectar permanentemente o agente, homologar chamada externa autorizada e publicar alterações do projeto original, com rollback.

## 11. PROMPT DIRETO PARA ABRIR O WORK

> Continue o PROJETO EXISTENTE `Central de Ligações`, site `https://central-de-ligacoes.ricogisi.chatgpt.site/`, project_id `appgprj_6ae0ead85eb88191957445673ea11c81`. Leia primeiro o arquivo `RELATORIO_COMPLETO_WORK.md` do pacote de transferência e o código no branch `central-ligacoes-motor-piloto` do repositório `Typbotrico/expert-eletricista-24h`; não mexa no branch principal. O motor piloto está vivo no Render `srv-dbgon4vf3r2c73a9sv20`, URL `https://central-ligacoes-motor-piloto.onrender.com/`; o agente local Asterisk não está permanentemente conectado e as chamadas externas estão bloqueadas pelo erro Directcall `603 Decline`. Execute a implementação prioritária, não só um relatório: obtenha acesso à fonte editável do site original; preserve dados, UI e funções existentes; implemente autenticação de agentes/admin, segurança e rotação de chaves, persistência, integração real site/API/AMI, agente local permanente e campanha real com distribuição ao ramal 1001. Contatos fictícios NUNCA podem ser discados; para homologação use apenas o telefone autorizado já no backup original. Verifique a Directcall e corrija a saída antes de qualquer discagem PSTN; teste uma chamada externa real com áudio e persistência e publique as mudanças na Central original. Documente cada execução e não alegue estar pronto sem teste ponta a ponta. Não crie outro site substituto, não peça repetição de prints/comandos já feitos e não misture o projeto NIRA.

## 12. RASTREABILIDADE / LIMITAÇÕES

**Confirmado por ferramentas neste trabalho:** status `live` do serviço Render, `/api/public/status`, `HTTP 401` sem token, branch GitHub, arquivos de código, testes locais 3/3, conteúdo e SHA do backup do usuário, snapshot do site na Biblioteca.

**Confirmado por declaração/prints do usuário, mas não reexecutado nesta sessão:** Asterisk, MicroSIP 1001, inbound Directcall com áudio, toque local do 1001, extensão v0.3 na interface, VCN e Internet Gateway Oracle.

**Não confirmado:** uma VM Oracle operacional; acesso de escrita ao site original; instalação permanente do agente na WSL; chamada externa bem-sucedida; SIP 603 resolvido; sistema de campanhas em produção; gravação/duração e resultados reais.

**Confidencialidade:** nenhuma senha, token, segredo SIP, chave SSH ou número de telefone pessoal foi incorporado a este handoff. O backup original deve continuar restrito ao usuário e às ferramentas autorizadas do Work.