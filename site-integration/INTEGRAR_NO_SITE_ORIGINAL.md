# Integrar o discador progressivo ao SITE ORIGINAL da Central de Ligações

Projeto-alvo que deve ser EDITADO, não recriado:
https://central-de-ligacoes.ricogisi.chatgpt.site/

Discador já implantado no Render:
https://central-ligacoes-motor-piloto.onrender.com/operador?embedded=1

## Ordem de edição para o ChatGPT Sites

1. Abra o PROJETO ORIGINAL da Central de Ligações, preservando a versão atual, suas rotas, funcionalidades, usuários, dados de contatos e campanhas, armazenamento D1, configurações e os demais menus.
2. No menu existente **Atendimento**, coloque o discador progressivo como o conteúdo principal dentro do layout atual. Use o componente de referência `site-integration/DiscadorIntegrado.jsx`, ou código equivalente. NÃO abrir outro domínio, pop-up ou nova guia quando o usuário clicar em Atendimento.
3. Faça a incorporação com iframe responsivo de largura 100%, altura mínima de 850 px, `src="https://central-ligacoes-motor-piloto.onrender.com/operador?embedded=1"`, `allow="microphone; autoplay"`, com título acessível, fundo adequado e bordas discretas. Ajuste altura e rolagem à tela. Sem mostrar dois cabeçalhos.
4. Remova apenas o aviso antigo "Telefone no navegador em preparação" e o painel *Asterisk piloto local* do Atendimento, se estiverem redundantes. Preserve menus restantes e os dados associados; não exclua banco, campanhas, contatos ou registros.
5. Na aba Atendimento, o operador deve conseguir, na mesma página: entrar no discador, selecionar campanha, importar ou selecionar lista quando autorizado, clicar em "Iniciar fila e ligar", falar no headset via Directcall, classificar resultado, "Salvar e ligar próximo" e "Pausar novas chamadas".
6. Preserve acesso autenticado. O iframe tem uma conta própria de operadores, que pode exigir login inicial dentro do painel; NÃO exponha tokens, senhas ou credenciais Directcall no código, CSS, HTML nem na URL. O motor já usa cookies HttpOnly, Secure e Partitioned.
7. Não automatize novo telefonema ao desligar sem confirmação confiável da chamada; preserve intervalo e botão de encerramento/classificação e bloqueio "Não ligar".
8. Valide o iframe, login, permissão do microfone, áudio em ambos os lados, 2 ligações em sequência e persistência do resultado. Se políticas da hospedagem do Sites impedirem o iframe ou microfone, NÃO publique uma integração quebrada: preserve a versão atual e relate especificamente a limitação, preparando integração nativa no frontend mediante backend seguro.
9. Revise a prévia; PUBLIQUE somente depois da validação e preserve a URL original.

## Referência do componente

`site-integration/DiscadorIntegrado.jsx` no branch `central-ligacoes-motor-piloto` do repositório `Typbotrico/expert-eletricista-24h`.

## Infraestrutura atual

- Motor Render: `https://central-ligacoes-motor-piloto.onrender.com`
- Endpoint de operador: `/operador`; incorporável: `/operador?embedded=1`
- CSP no motor: frame-ancestors restrito ao site principal e ao próprio motor
- Banco e fila no motor permanecem separados da autenticação do ChatGPT Sites; isso deve ser mostrado claramente até existir SSO formal.
- Evite mudanças na branch `main` do projeto Expert Eletricista e não altere NIRA.
