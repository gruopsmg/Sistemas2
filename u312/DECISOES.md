# DECISÕES — UNICAR (registro do que foi decidido e por quê)

Este arquivo é obrigatório no plano: toda dúvida vira uma decisão registrada aqui, escolhendo
sempre a opção **mais segura** e que **menos altere o comportamento atual**.

---

## Fase 0 — reconhecimento (só leitura)

### 1. Como eu chego no sistema
- **O plano original supõe** que a cópia de desenvolvimento fica no PC do cliente, em
  `C:\Users\Cliente\Documents\Unicar\unicar-lan-dev`.
- **Realidade:** eu rodo em um servidor Linux, sem acesso remoto ao Windows do cliente.
- **Decisão:** trabalhar sobre uma **cópia recebida por upload** (robocopy + zip), extraída em
  uma pasta de trabalho separada (`/opt/data/unicar-trabalho/`). Os caminhos do Windows
  continuam sendo usados **somente** nos documentos de instalação local, que o cliente executa.
- **Motivo:** sem acesso à máquina, qualquer trabalho direto na produção seria impossível — e
  tocar na produção é proibido (regras 1, 2 e 7 do prompt).

### 2. Integridade da cópia recebida
- Tamanho esperado: **94.644.319 bytes** → confere.
- SHA-256 esperado: `6892befaddac668b8e1a6acf2ec4f5ad28e292460f99656fb7f059671f5bae52` → confere.
- **Decisão:** tratar o zip como **imutável** (só leitura) e extrair apenas os arquivos do app.
  O zip continua com o mesmo SHA-256 depois da extração (verificado).

### 3. O que a cópia tem e o que não tem
- **Tem:** `server.js`, `auth.js`, `auditoria.js`, `data.json`, `public/`, `package.json`,
  `package-lock.json`, `README.md` (10 arquivos = o sistema inteiro).
- **Não tem:** `node_modules` e a pasta `backups` (existem na produção, mas o robocopy não os
  levou). `data.json` recebido é o retrato da produção em **15/10/2026 ~14:39**.
- **Decisão:** as dependências serão instaladas **exclusivamente na pasta de teste**
  (`npm ci`, que respeita o `package-lock.json`, sem atualizar versões). Os dados usados em
  teste serão **arquivos próprios**, nunca o `data.json` real.

### 4. Sobras encontradas na pasta de produção (não removidas)
- `cli-12.2.0/` — 312 MB de código-fonte do próprio npm (isso é o que fez o robocopy somar 298 MB).
- `index.html` na raiz — 125 KB, **diferente** de `public/index.html` (arquivo morto; a tela
  servida é `public/index.html`).
- **Decisão:** não mexer (produção é intocável). Fica registrado como limpeza recomendada para
  depois, com lista e autorização do cliente antes de apagar qualquer coisa.

### 5. Itens que o prompt cita e o sistema **não tem** (e como serão tratados)
| Item do prompt | Existe hoje? | Tratamento |
|---|---|---|
| Ordens de serviço (OS) | Não | Não será inventado. Fica registrado como inexistente. |
| Transferências entre lojas | Não | Idem. |
| Cadastro de lojas (UNICAR/MATRIZ/FILIAL) | **Não** — só localização física (arara/prateleira) | Fase 3 prepara a dimensão de loja no dado, com migração e rollback, sem quebrar a operação atual. |
| Banco de dados | Não — é um arquivo JSON único | Fase 3 prepara PostgreSQL como **opcional**, sem serviço pago. |
| Multiusuário por loja | Não (existe `admin` e `operador`, sem vínculo com loja) | Fase 3. |
| HTTPS | Não (rede local) | Fase de segurança, junto com a publicação. |
| Regressão (linha de base das rotas GET) | Não existe | Só é possível capturar rodando contra a produção — **não foi feito**, porque eu não tenho acesso ao PC. Fica pendente para execução local (script só-leitura). |

### 6. Problemas encontrados (graves primeiro)
1. `loadData()` **apaga** o `data.json` quando o arquivo está ilegível (substitui por estrutura vazia).
2. Gravação **não atômica** (`writeFileSync` direto no arquivo vivo).
3. Sem tratamento de erro global: erro em rota `async` derruba o processo; e a fila de gravação
   fica **envenenada** (o sistema continua na tela mas para de salvar).
4. Senha padrão do primeiro admin **fixa no código** (`auth.js:99`) e impressa na tela ao criar.
5. Histórico é cortado sem aviso: movimentos em 500, auditoria em 3000.
6. Sem HTTPS, cookie sem `secure`, servidor aberto em `0.0.0.0`.
7. Permissões grossas (operador exclui pneu e altera preço).
8. Leitura do arquivo inteiro a cada requisição.
9. Pasta de produção poluída (312 MB de npm + `index.html` duplicado).

---

## Fase 1 — backup validado + git

### 7. Backup antes de qualquer mudança
- **Decisão:** gerar backup **fora** da pasta do sistema, com validação de verdade:
  cópia arquivo por arquivo → confere SHA-256 origem x destino → valida cada JSON → gera `.zip`
  → **abre o zip de volta** e compara o SHA-256 de todos os arquivos.
- **Também:** o `data.json.bak` (último arquivo bom) passa a ser mantido pelo próprio sistema a
  cada escrita (Fase 2), além dos backups automáticos de 6 em 6 horas que já existiam.
- **Resultado:** `BACKUPS_HERMES/20261015-181948-fase0-recebido` + `.zip` (10 arquivos, 719.432
  bytes, 3 JSONs válidos, zip testado). Ver `MANIFESTO.txt` para os hashes.
- **Motivo:** regra 6 do prompt — "sem backup validado, não prossiga".

### 8. Versionamento
- **Decisão:** a cópia de desenvolvimento é um repositório git; o estado recebido foi marcado com
  a etiqueta **`v1.0.0-recebido`**. Toda mudança é comparável (`git diff`) e reversível
  (`git checkout v1.0.0-recebido -- .`).
- **Decisão:** `data.json`, `backups/`, `logs/` e `.env` **não** entram no git — são dados da loja,
  não código. A proteção deles é o backup validado (item 7) + `data.json.bak`.
- **Motivo:** permitir rollback do código sem misturar dado real com código.

---

## Fase 2 — estabilidade e perda de dados (autorizada pelo cliente)

### 9. Arquivo ilegível nunca mais é apagado
- **Decisão:** se o `data.json` não abrir, o sistema tenta o `data.json.bak`; se nenhum dos dois
  servir, ele **recusa subir** e mostra mensagem clara com o caminho do arquivo e o que fazer.
- **Motivo:** parar é incomparavelmente melhor do que rodar com dado vazio, aceitar lançamentos e
  sobrescrever o arquivo real. Antes, esse era o caminho para perder o estoque inteiro.
- **Efeito colateral aceito:** se o arquivo realmente corromper, a loja fica sem sistema até
  alguém restaurar um backup. Por isso o `data.json.bak` e os backups de 6 em 6 horas existem.

### 10. Gravação atômica
- **Decisão:** gravar em `data.json.tmp` → confirmar no disco (`fsync`) → renomear por cima do
  `data.json` (operação atômica) → antes disso, o arquivo bom anterior vira `data.json.bak`.
- **Decisão:** até 3 tentativas com 50 ms de intervalo, porque no Windows antivírus/Dropbox podem
  segurar o arquivo por alguns milissegundos (`EPERM`/`EBUSY`).
- **Motivo:** queda de energia ou erro no meio da gravação não pode mais truncar o arquivo.

### 11. Erro não derruba nem "envenena" o sistema
- **Decisão:** middleware de erro no Express (resposta genérica + id do erro no log, sem detalhe
  interno), `process.on('unhandledRejection')` e `'uncaughtException'` registrando em log **sem
  encerrar** o processo, e fila de gravação que continua funcionando depois de um erro.
- **Motivo:** os backups de 15/10 às 02:28, 08:28 e 11:32 mostram reinicializações — o risco não é
  teórico. Com gravação atômica + backup validado, continuar de pé é mais seguro para a loja do que
  morrer no meio do expediente.

### 12. Configuração por variáveis de ambiente (sem dependência nova)
- **Decisão:** `PORT` (padrão 3000), `HOST` (padrão 0.0.0.0), `ARQUIVO_DADOS`, `PASTA_BACKUPS`,
  `NIVEL_LOG` (padrão info). O `.env` é lido por código próprio (~15 linhas), **sem instalar**
  nada.
- **Motivo:** a regra do cliente proíbe instalar/atualizar dependências; e configurar por ambiente
  é o que permite a publicação sem reescrever o código.

### 13. Saúde e diagnóstico
- **Decisão:** `/health` público e **mínimo** (`ok`, `versao`, `uptime`) — não revela nada interno.
  Diagnóstico detalhado (tamanho/idade do arquivo de dados, fila, erros, backups) em
  `/api/diagnostico`, **só admin**.
- **Motivo:** permitir monitorar sem expor caminho de arquivo, contadores ou versão de dependência
  a quem não está logado.

### 14. Escopo respeitado
- **Decisão:** a Fase 2 mexe **apenas** em estabilidade, configuração, log e saúde. Não mexi em
  funcionalidade, tela, permissão ou modelo de dados — isso é Fase 3, com migração e rollback.
- **Motivo:** mudança pequena e verificável é mais segura que refatoração grande num sistema em uso.

### 15. Descoberta durante os testes: rota `async` no Express 4
- **O que aconteceu:** ao provocar uma falha de gravação de propósito, o pedido **ficou pendurado
  para sempre**. Causa: no Express 4, quando uma rota `async` falha, o erro **não** chega ao
  tratamento de erros — a promessa fica solta. No sistema antigo isso **derrubava o processo**; com o
  processo mantido de pé (decisão 11), o pedido penduraria a tela do usuário.
- **Decisão:** envolver as rotas registradas (inclusive as de `auth.js`/`auditoria.js`) para que a
  falha seja encaminhada ao tratamento central e o cliente receba resposta.
- **Motivo:** erro precisa virar resposta clara, não tela travada nem processo morto.

### 16. Mensagem de erro não pode vazar caminho de arquivo
- **O que aconteceu:** o próprio teste pegou que a resposta da falha de gravação mostrava o caminho
  interno do arquivo (`EACCES: permission denied, open '/.../dados.json.tmp'`).
- **Decisão:** mensagem curta e genérica na tela ("não foi possível gravar agora e nada foi perdido"),
  com o detalhe técnico indo **só** para o log; a resposta leva um `id` para achar o erro no log.
- **Decisão extra:** como nem o log pode ser gravado quando o problema é disco cheio/permissão, as
  últimas mensagens de erro ficam **na memória** e aparecem em `/api/diagnostico`
  (`erros.ultimo`). Assim o responsável consegue ver o motivo mesmo sem log.
- **Motivo:** quem usa o sistema não precisa (nem deve) ver caminho de arquivo; mas o diagnóstico
  precisa existir mesmo no pior cenário.

### 17. Versão e escopo do que foi publicado na cópia
- **Decisão:** `package.json` de `1.0.0` para **`1.1.0`**, e etiqueta git `v1.1.0` (a anterior,
  `v1.0.0-recebido`, continua apontando para o estado exato do que foi recebido).
- **Não foi tocado:** telas, permissões, regras de negócio, modelo de dados e dependências
  (nenhuma dependência nova: os testes usam o `node:test` que já vem no Node.js).

### 18. Conferência com o dado real
- **Decisão:** abrir o seu `data.json` de verdade (uma **cópia** dele, em pasta temporária) com o
  código novo e comparar lista por lista, além de conferir o SHA-256 antes/depois.
- **Resultado:** 180 pneus, 106 movimentos, 1 garantia, 6 bebidas, 13 movimentos de bebida,
  2 usuários, 2 sessões, 669 registros de auditoria — **idêntico** ao original, e o arquivo
  **não foi alterado** (mesmo SHA-256, 328.963 bytes, sem criar `.bak` ao apenas ler).

### 19. Linha de base de regressão
- **O plano pedia** a linha de base das rotas GET **da produção**. Eu não tenho acesso ao PC da
  loja, então isso foi adaptado (registrado aqui, como manda a regra).
- **Decisão:** criar a ferramenta `scripts/linha_de_base.js` e rodá-la na **cópia**, guardando rota,
  status esperado x obtido e o **SHA-256 do corpo** — de propósito **sem guardar o conteúdo**, para
  não carregar dado de cliente dentro do arquivo.
- **Resultado:** 14 rotas conferidas, **0 falhas** (inclui as proteções: `/data.json` e
  `/backups/...` dão 404, `/` e `/index.html` redirecionam para o login sem sessão, e `/api/*`
  exige login).
- **Pendente (precisa do PC da loja):** rodar a mesma ferramenta contra a produção, para ter o
  retrato "de antes" do sistema em uso. Fica para a fase da instalação local, com você executando.

---

## Fase OS — Ordens de Serviço e lojas (v2.0.0)

### 20. Perfis: mantive as chaves antigas e acrescentei as novas
- **Decisão:** os perfis internos continuam `admin` e `operador` (é o que as telas e as checagens
  de hoje usam) e ganharam `gerente` e `mecanico`. Os **rótulos** na tela são os pedidos:
  Administrador, Gerente, Operador/Atendente, Mecânico/Técnico.
- **Motivo:** trocar a chave `admin` por `administrador` quebraria as verificações existentes
  (esconder abas de admin, liberar valor de compra) e as senhas/registros atuais. Rótulo é
  apresentação; chave é contrato interno.

### 21. Loja dos dados que já existiam
- **Decisão:** os registros que já estavam no sistema (pneus, movimentos, garantias, bebidas e
  o usuário não administrador) passam a ser da loja **UNICAR**; o administrador fica **sem loja
  fixa** (acesso a todas).
- **Motivo:** é onde o sistema roda hoje. Qualquer outra escolha seria invenção. Trocar depois é
  uma linha na migração.

### 22. Estoque continua compartilhado
- **Decisão:** acrescentei o campo `loja` nos registros e um **filtro por loja** nas telas, mas
  **não** separei quantidade por loja nem mudei a operação de estoque.
- **Motivo:** separar estoque mexeria na rotina da loja, e o pedido desta fase é a OS por loja.
  O campo já está pronto para separar depois, quando você quiser.

### 23. A OS não dá baixa no estoque (nesta versão)
- **Decisão:** a OS **informa** pneus, peças e produtos com valor, mas não desconta do estoque
  automaticamente.
- **Motivo:** baixa automática muda o comportamento atual (e pode dar baixa errada em OS
  cancelada ou alterada). Fica como próximo passo, se você quiser — a estrutura já permite.

### 24. Mecânico/Técnico vê só as OS atribuídas a ele
- **Decisão:** o mecânico enxerga apenas as OS em que ele está marcado como responsável técnico;
  ele atualiza serviços e observações técnicas, e **não** mexe em valores, não cancela e não
  abre OS.
- **Motivo:** foi o que o pedido descreve ("pode visualizar OS atribuídas"). Se preferir que ele
  veja a fila inteira da loja, é só afrouxar uma regra em `permissoes.js`/`os.js`.

### 25. Valores travados depois da aprovação
- **Decisão:** operador pode alterar valores (itens/desconto) enquanto a OS está em `aberta`,
  `em análise` ou `aguardando aprovação`. Depois de `aprovada`, valores só por gerente ou
  administrador. OS `entregue` ou `cancelada` só o administrador altera.
- **Motivo:** evita mexer em preço depois que o cliente já aprovou o serviço.

### 26. Cancelamento e reversão da migração
- **Decisão:** cancelar OS exige **motivo** (mínimo 3 caracteres), fica no histórico da OS e na
  auditoria, e é permitido para gerente e administrador (não para operador/mecânico).
- **Decisão:** `migracoes/executar.js --reverter` **recusa** reverter quando já existem OS
  cadastradas (apagaria trabalho real); só com `--forcar`, e ainda assim a cópia prévia fica
  guardada.
- **Motivo:** nenhuma ação destrutiva sem aviso — é a regra que você pediu desde o começo.

### 27. Telas novas dentro do arquivo atual, no mesmo padrão
- **Decisão:** as telas ficaram no próprio `public/index.html` (duas abas novas e duas telas) com a
  lógica em `public/os.js`, reusando as mesmas classes e variáveis de cor. No `index.html` só
  **7 linhas foram substituídas** (todas no cadastro de usuários, que ganhou loja/perfil novo, e a
  abertura das abas) — nada foi removido. Isso é conferido por teste automático, linha por linha.
- **Decisão:** o CSS novo usa **apenas** as variáveis de cor do tema (nada de paleta nova).
- **Motivo:** manter exatamente a identidade visual e não substituir a interface existente.

### 28. Celular
- **Decisão:** no celular a tabela da OS esconde as colunas "Loja" e "Aberta em" (mantém número,
  cliente, placa, status e valor); o número da OS não quebra linha.
- **Motivo:** a tabela de 7 colunas ficava apertada no celular; o resto continua acessível abrindo
  a OS.

### 29. Versão e conferência
- **Decisão:** versão do sistema para **2.0.0** (mudança grande: lojas + OS), com etiqueta git
  `v2.0.0`. Os testes passaram de 31 para **50**, incluindo testes que provam: número único,
  isolamento entre lojas no servidor, admin com acesso às três lojas, criação de usuários com
  loja/perfil, login atual funcionando, funções antigas intactas, interface preservada e
  **nenhuma informação perdida na migração** (comparação campo por campo com o arquivo original).

---

## Fase baixa de estoque — v2.1.0

### 30. A baixa acontece só em "Em execução" — e só uma vez
- **Decisão:** a baixa roda quando a OS **entra** em `em execução`. A conta é sempre
  "o que a OS pede − o que já foi baixado", então salvar o mesmo status, editar a OS ou sair e voltar
  para "Em execução" **não** baixa de novo.
- **Decisão:** sair de "Em execução" para "Aguardando peça" (ou outro status anterior) **não** estorna
  automático — normalmente a peça já está separada/no veículo. O estorno automático acontece no
  **cancelamento** (regra pedida) e nas reduções/remoções de item.
- **Motivo:** cumprir a regra "uma única vez" sem criar movimentação fantasma.

### 31. O vínculo com o estoque é por item e é opcional
- **Decisão:** só itens com "Item do estoque" escolhido geram movimentação. Mão de obra e peças soltas
  continuam valendo só como valor na OS.
- **Motivo:** o sistema só tem estoque de pneus e bebidas; peça solta não tem saldo para baixar. Fica
  fácil ligar depois (é o mesmo campo).

### 32. Bloqueio vale também na edição
- **Decisão:** se o item aumentar de quantidade e não houver estoque, **a edição inteira é recusada**
  (nada é salvo, nem cliente nem veículo) e a tela mostra o que falta. O mesmo vale para a mudança de
  status: o status não muda e o estoque não é tocado.
- **Motivo:** evitar estado pela metade — ou a OS fica consistente com o estoque, ou não muda.

### 33. Estoque compartilhado e soma por item
- **Decisão:** mantido o estoque **compartilhado** entre as lojas (decisão 11/22). Se dois itens da
  mesma OS apontarem para o mesmo registro de estoque, a conferência **soma** as quantidades antes de
  comparar com o disponível.
- **Motivo:** impedir que duas linhas da mesma OS "passem" individualmente e deixem o saldo negativo.

### 34. Controle e rastro
- **Decisão:** o saldo baixado por item fica em `os.baixas` (por item da OS). As movimentações ficam em
  `movimentos` (pneus) e `bebidasMov` (bebidas) com `origem: 'os'`, `osNumero`, `loja` e `itemId`.
  Nada é apagado: estorno é uma **entrada nova**.
- **Observação registrada:** o corte de histórico (500 movimentações por lista) pode descartar
  movimentações antigas, mas o **histórico dentro da OS** permanece — e é ele que sustenta a conferência.
- **Não mexido:** telas antigas, permissões, estoque compartilhado, migração e a interface (o teste de
  interface confere linha por linha: nesta fase mudou **1 linha** do `index.html`, a lista de rótulos da
  auditoria, já declarada no teste).

---

## Fase de fechamento — v2.1.1

### 35. O formulário da OS devolve o mesmo id de item
- **Decisão:** a linha do item carrega `data-item-id` e o salvamento devolve esse id. Corrige um defeito real
  encontrado ao testar na tela: como o formulário não devolvia o id, cada edição fazia o servidor entender
  "item removido + item novo" — o saldo final ficava certo (a conta sempre fecha), mas gerava **estorno e nova
  baixa desnecessários** e deixava um registro órfão no controle `os.baixas`.
- **Motivo:** cumprir a regra "aumentou a quantidade → baixa só a diferença" também quando a edição vem da tela.
- **Proteção:** teste automático em `testes/interface.test.js` (o formulário precisa devolver o id) e no teste da
  baixa (`os.baixas` tem exatamente **1 registro por item** da OS, sem fragmentar).

### 36. Bloquear/liberar acesso pela lista + exclusão protegida
- **Decisão:** botão **Bloquear/Liberar** ao lado de "Editar" na lista de usuários (antes só dava para
  bloquear editando o cadastro). E a exclusão de usuário passou a ser **recusada** quando a pessoa aparece em
  alguma OS (como responsável, mecânico ou autor de um passo do histórico) — a mensagem orienta a bloquear.
- **Motivo:** o pedido é "criar, editar, ativar e desativar usuários"; excluir quem tem histórico apagaria o
  passado. Usuário criado por engano e **sem** histórico continua podendo ser excluído (função que já existia).
- **Preservado:** a rota de exclusão e o botão na tela continuam existindo (eram do sistema original).

### 37. Versão final e testes
- **Decisão:** versão **2.1.1** (correções sobre a 2.1.0), com a etiqueta git `v2.1.1`. Rollback preservado
  para `v1.0.0-recebido`, `v1.1.0`, `v1.1.0-final`, `v2.0.0` e `v2.1.0`.
- **Testes:** **78** no total, incluindo os 15 de gestão de usuários (criar, editar, bloquear, liberar, trocar
  senha, exclusão protegida, auditoria) e a conferência da interface linha por linha.
- **Pacote:** ZIP sem `node_modules` e sem `data.json` (o pacote nunca substitui dado do cliente).

---

## Migração e 4 perfis — v2.1.2

### 38. O mecânico responsável muda o status da própria OS (na tela)
- **Decisão:** o servidor já permitia ao mecânico colocar a **OS dele** em execução / aguardando peça /
  finalizar (`podeMudarPara`), mas a tela só mostrava o botão para quem tem `mudarStatus` (admin, gerente,
  operador) — ou seja, a capacidade existia e não era oferecida. A tela passou a mostrar o botão para o
  **mecânico responsável daquela OS**, oferecendo **somente** as opções que o servidor aceita.
- **Motivo:** o pedido diz que o mecânico "pode atualizar serviços e observações técnicas"; deixar a tela
  esconder o que o servidor permite é a mesma classe de defeito do id do item (tela × servidor discordando).
- **Continua valendo:** mecânico não altera valores (403), não cancela (403) e não entrega a OS ao cliente
  (403) — agora com teste automático cobrindo os quatro pontos.
- **Migração validada no fechamento:** sobre cópia do `data.json` real, `--aplicar` marcou 308 registros como
  UNICAR, criou as 3 lojas, ligou `joao` à UNICAR, manteve o admin com todas as lojas e **não mudou nenhum
  hash de senha**; contagens antes/depois idênticas; `--reverter` devolveu o formato 1 sem perder nada.
- **Versão e pacote:** **2.1.2** (o `u211.zip` já publicado não continha os ajustes 4 e 38 — trocar o
  conteúdo mantendo o número invalidaria o SHA entregue). Pacote novo: `u212.zip`.

---

# Decisões da versão 3.0.0 (SMG GROUP: estoque por loja, importação e chat)

## 20. Estoque de pneu separado por loja, com o campo antigo mantido como espelho
- **Decisão:** cada pneu ganhou `estoques = { LOJA: { quantidade, minimo, localizacao } }`.
  Os campos antigos (`quantidade`, `estoqueMinimo`, `localizacao`) continuam existindo e são
  mantidos automaticamente como **total** e **loja principal**.
- **Motivo:** telas, relatórios, CSV e testes antigos leem esses campos. Recriar tudo do zero
  quebraria o que já funciona (e o dono pediu para não refazer o que funciona).
- **Consequência:** nenhuma escrita pode alterar `pneu.quantidade` direto — todas passam por
  `estoques.js` (movimentar / definirQuantidade / transferir / sincronizar).

## 21. O estoque que já existia vai para a loja principal (UNICAR)
- **Decisão:** migração na leitura (`garantirFormato`) coloca toda a quantidade atual na loja
  principal; as outras lojas nascem zeradas. A tela **Distribuir estoque atual** reorganiza,
  exigindo que a soma por loja seja igual ao total (não cria nem some pneu).
- **Motivo:** não perder nada e não adivinhar onde cada pneu estava fisicamente.

## 22. A baixa da OS sai da loja da OS
- **Decisão:** `conferirEstoque` e `aplicar` usam o saldo da loja da OS; faltou naquela loja,
  a mudança de status é bloqueada (mesmo com saldo em outra loja).
- **Motivo:** era a decisão em aberto nº 1 do dono. O contrário (compartilhado) mascarava
  falta de estoque na loja que vendeu.

## 23. Número de OS: prefixo novo, número antigo intacto
- **Decisão:** novas OS saem como `OS-SMG-<LOJA>-000001`; as antigas (`OS-UNICAR-000001`)
  continuam exatamente como estão e são encontradas pelo número antigo. O prefixo é
  configurável em Configurações.
- **Suposição:** o prefixo entra como segundo bloco (mantendo a loja no número) para não
  colidir sequências entre lojas e não exigir migração do contador.

## 24. Importação: prévia em memória, gravação só no confirmar
- **Decisão:** o arquivo é enviado em base64 (sem dependência nova de upload), a prévia fica
  na memória por 30 minutos, o original é salvo em `arquivos-importados/` e a importação entra
  em `data.importacoes` + auditoria.
- **Suposição:** um valor de preço só = **preço de venda**; dois valores = **custo e venda**.
- **Suposição:** sem a palavra NOVO na linha, o pneu entra como **REMOLD** (regra do dono).

## 25. PDF escaneado: OCR é opcional (não instalamos nada no PC dele)
- **Decisão:** PDF com texto é lido por um extrator próprio (sem biblioteca externa). PDF que
  é só imagem tenta `tesseract.js` **se estiver instalado**; se não estiver, a tela explica em
  português e sugere TXT/Excel — nunca erro 500.
- **Motivo:** instalar OCR baixa modelo e precisa de internet; não dá para presumir isso na
  máquina da loja. Fica registrado como pendência, com o comando pronto.

## 26. Identidade do grupo vem do dado (não do código)
- **Decisão:** nome, subtítulo, logo e prefixo das OS ficam em `data.grupo`; o HTML antigo
  continua com a marca original e o `smg.js` troca o texto na tela (assim os testes de
  preservação da interface continuam válidos e nada é apagado do arquivo).
- **Decisão:** os **códigos** das lojas (UNICAR/FILIAL/MATRIZ) não mudam (dado e OS dependem
  deles); só o **nome de exibição** vira SMG GROUP / SMG Filial / SMG Matriz.

## 27. Chat: salas derivadas das lojas, permissão no servidor
- **Decisão:** uma sala por par de lojas (`loja:filial-unicar`), uma geral e uma de chamados,
  todas recriadas de forma idempotente. Quem não participa recebe 403 na rota (não é só esconder).
- **Decisão:** apagar mensagem só marca `apagada` (o texto sai, o registro fica para auditoria).
- **Decisão:** alarme sonoro é gerado por Web Audio no navegador (sem arquivo de som),
  repete a cada 30 s, para no **Visto** ou sozinho em 10 minutos.

## 28. Som por pessoa fica no navegador
- **Decisão:** volume e liga/desliga ficam no `localStorage` do aparelho (não no `data.json`).
- **Motivo:** é preferência de quem está naquele computador/celular; evita gravar dado de
  dispositivo no arquivo da loja. Se o dono quiser isso no cadastro do usuário, é uma linha.

## 29. CORREÇÃO DO DONO: o sistema continua UNICAR; o SMG é só na tela de login
- **Decisão (pedido dele, 20/10):** nada de rebrand no sistema. Topo, título da aba, rodapé,
  marca das lojas (`marcas.js`), nomes das lojas nas telas e relatórios voltam a ser **UNICAR**
  como na 2.1.3. A marca **SMG** (nome, subtítulo e logo) vive **apenas na tela de login**, e é
  editável em Configurações (`data.grupo.loginNome/loginSubtitulo/loginLogo`).
- **Numeração de OS:** volta ao padrão de sempre (`OS-UNICAR-000001`). O campo de prefixo em
  Configurações continua existindo, mas vazio por padrão (= numeração antiga).
- **Compatibilidade:** dado gravado pela 3.0.0 (`grupo.nome/subtitulo/logo`) é lido como marca
  do login — nada se perde ao atualizar.

## 30. Logo da tela de login: a arte enviada pelo dono (Drive)
- **Decisão:** a imagem enviada (SMG GROUP, vermelho/preto sobre branco, 677x369 com muita margem)
  foi recortada para o conteúdo (203x260), ampliada para 264 px de largura e salva em
  `public/logos/logo_login.png` (PNG com fundo branco).
- **Decisão de tela:** no tema escuro a logo fica dentro de um **cartão branco arredondado**
  (132 px no celular, 176 px no desktop). Sem o cartão, a parte preta da arte desaparece no fundo.
- **Troca futura:** Configurações → "Logo da tela de login" (o navegador reduz para 600 px antes de enviar).

## 31. Impressão da OS em duas vias (uma folha A4)
- **Pedido do dono (21/10):** uma única folha A4 em retrato, metade de cima = VIA DO CLIENTE e metade
  de baixo = VIA DA LOJA, com linha tracejada + tesoura + "Recorte aqui" entre as duas.
- **Como ficou:** `impressao-os.js` (novo módulo, testável sem servidor) monta a folha; cada via tem
  140 mm de altura e a folha 289 mm (A4 com margem de 4 mm). O gerador antigo (folha cheia com marca
  d'água) foi substituído — o mesmo gerador serve a OS e o "modelo em branco".
- **Capacidade:** 8 itens normal; 9 a 10 entra o modo compacto (fonte 8,4 pt); acima de 10 quebra em
  folhas de 12 itens mantendo SEMPRE cliente em cima e loja embaixo, com "Folha x/y" e subtotal da folha.
- **Tabela elástica:** a tabela de itens cresce para preencher a via e completa até 10 linhas, para a via
  nunca ficar com um buraco branco no meio (o dono reclama de espaço vazio).
- **Assinaturas:** na via do cliente "Assinatura da loja"; na via da loja "Assinatura do cliente (de acordo)".
  Em cada via também sai a "Data de entrega prevista".
- **Dados por loja:** `endereco`, `telefone` e `cnpj` passaram a existir em `data.lojas` (preservados pelo
  `garantirLojas`) e são editados em Configurações → "Dados que saem na OS impressa".
- **Garantia e prazo:** texto global em `data.impressao` (vale para as três lojas), com padrão seguro.
- **Novo campo na OS:** `defeito` (defeito relatado pelo cliente) entra no formulário e na via impressa.
- **Sem custo:** a impressão nunca mostra `precoCusto`, lucro ou margem — só valor unitário, total e forma
  de pagamento.

## 32. Cadastro de clientes: base ÚNICA do grupo (aba "Clientes")
- **Pedido do dono (21/10):** botão "Clientes" com a lista completa e, ao criar uma OS, usar os dados de um
  cliente já salvo — se não existir, cadastrar na hora. **A base serve para todas as lojas e é liberada
  para qualquer acesso.**
- **Como ficou:** `clientes.js` (puro, testável) + `api-clientes.js` (rotas) + `public/clientes.js` (tela).
  A base vive em `data.clientes`, **sem campo de loja** — é do grupo, de propósito.
- **Chave do cadastro:** CPF/CNPJ só com dígitos quando tem 11+ dígitos; sem documento, o nome normalizado
  (maiúsculas, sem acento, espaços colapsados). Criar OS não duplica: atualiza o cadastro e soma `osCount`.
- **Ligação com a OS:** campo "Usar cliente já cadastrado" no formulário de OS busca por nome/CPF/telefone
  (200 ms de debounce, 8 sugestões), preenche os campos e guarda `os.clienteId`. Cliente novo digitado à mão
  entra na base ao salvar a OS. A tela de Clientes tem o atalho "Nova OS" com o cliente já escolhido.
- **Migração:** na primeira subida, a base é montada a partir dos clientes que já estão nas OS
  (`clientesMigrados` marca que foi feito). Nada é apagado; OS antigas ganham `clienteId`.
- **Permissões:** qualquer usuário logado lista, inclui e edita; **apagar é só do administrador** e um
  cliente com OS registradas não pode ser apagado.
- **Importação:** CSV/TXT com cabeçalho (Nome; CPF; Telefone; Endereço; Bairro; Cidade…) ou linhas soltas
  ("NOME 123.456.789-00 (22) 9…"); prévia mostra novos/atualizados/ignorados e **nada grava antes de
  confirmar**; reimportar atualiza em vez de duplicar (idempotente).
- **A lista que o dono colou no chat é OCR de um PDF e está corrompida** (CPF como "127.gS7.S77-40"): não foi
  importada. O caminho é mandar o CSV/Excel original na aba Clientes → "Importar lista".

## 33. OS impressa: timbrado da loja ao fundo + cor de cada loja
- **Pedido do dono (21/10):** "a OS tem que sair com o timbrado grande no meio de cada via — o timbrado é a
  logomarca de cada loja — e as cores não são todas vermelhas, cada loja com a sua cor, que é da logomarca".
- **Timbrado:** cada via recebe `<div class="timbrado">` com `marca_agua_<LOJA>.png` (a versão sem fundo
  branco da logo), centralizado, 62% da largura, `opacity: .12`, `mix-blend-mode: multiply` e
  `filter: grayscale(1)` — em cinza para não brigar com a cor da loja nem com a impressão em preto e branco.
  O conteúdo fica em `z-index: 1` (o timbrado é `z-index: 0`).
- **Cor por loja:** `marcas.js` ganhou `cor` (UNICAR `#d02b2b`, MATRIZ `#e39012`, FILIAL `#a5182f`), extraída
  das logos. O documento usa `--acento` por via (faixa "VIA DO…", título "ORDEM DE SERVIÇO", número,
  borda do cabeçalho e total). `data.lojas[].cor` pode sobrescrever, editável em **Configurações →
  Dados que saem na OS impressa** (input de cor); a rota valida `#rrggbb` e cor inválida volta ao padrão.
- **Cabeçalho:** quando a loja não tem endereço/telefone/CNPJ cadastrados, sai o subtítulo da marca em vez
  de um texto de exemplo ("endereço · telefone · CNPJ" aparecia no papel).
- **Atenção:** `garantirLojas` reconstrói o objeto da loja — todo campo novo (`cor`) precisa ser copiado lá,
  senão some na próxima leitura.

## 34. Envio da OS em PDF pelo WhatsApp (uma conexão por loja)
- **Pedido do dono (21/10):** enviar a OS digital pelo WhatsApp. Uso **só de envio** — não é atendimento, não
  recebe e não responde mensagem. Uma conexão por loja, por QR Code ou por código de 8 caracteres, status em
  tempo real, sessão em disco que sobrevive à atualização. Sem Docker e sem serviço pago.
- **Biblioteca:** `@whiskeysockets/baileys@6.7.24` (JavaScript puro) + `qrcode` (desenha o QR) + `pdfkit`
  (gera o PDF). Entram no `package.json`; a instalação continua sendo `npm ci`.
- **Sessão:** `../whatsapp-sessao/<LOJA>` (fora da pasta do sistema, ao lado dela), configurável por
  `PASTA_WHATSAPP`. Fica no `.gitignore` e fora do `git archive` (pacote) e do backup validado.
  Motivo: a atualização troca a pasta inteira — se a sessão ficasse dentro, pediria QR a cada versão.
- **PDF digital:** `os-pdf.js` (pdfkit) — uma folha A4, uma via, logo + dados da loja, cliente, veículo,
  itens, total, defeito, garantia/prazo e a cor da loja. As logos do PDF são PNG em `public/logos/pdf/`
  (o pdfkit não lê `.webp`).
- **Rotas:** `GET /api/whatsapp` (status das lojas visíveis), `POST /api/whatsapp/:loja/conectar|codigo|
  desconectar|teste`, `POST /api/os/:chave/enviar-whatsapp`, `GET /api/os/:chave/pdf` e
  `GET /api/os/:chave/whatsapp` (histórico).
- **Permissões:** conectar/desconectar/testar = admin (qualquer loja) ou gerente (a dele); enviar OS =
  admin/gerente/operador, respeitando a loja da OS. Todo envio entra na auditoria e em `os.whatsappEnvios`.
- **Proteções:** telefone normalizado (55 + DDD, 12-13 dígitos); 1 envio por OS a cada 60 s (429);
  sem conexão devolve 409 com instrução; `WHATSAPP_ENVIO_FAKE=1` existe só para os testes.
- **Reconexão:** queda de rede tenta de novo até 5 vezes (espera crescente); `loggedOut`/401 limpa a sessão
  e pede QR de novo.

## 35. Logo única do GRUPO no topo, no login e no favicon (v3.0.7)
- **Pedido do dono (21/10):** trocar a logo do sistema (a que aparecia como "Unicar" no topo, tela de login e
  aba do navegador) pela logo do grupo, igual para todas as lojas e usuários. Documentos **não** mudam.
- **Arte:** a mesma imagem que ele mandou pelo Drive (ID `1RkRk2tBRBT4E9VWmdqV2ikz1p5Iiarj3`), recortada no
  conteúdo e gerada em 4 tamanhos: `grupo-2026.png` (76x96, topo 2x), `grupo-2026-login.png` (381x480),
  `grupo-2026-icon-32.png` e `grupo-2026-icon-192.png`/`apple-touch-icon-2026.png` (atalho do celular).
- **Cache:** todos os arquivos têm nome novo e `?v=3.0.7` nos `<link>`/`src` — o navegador não reaproveita a
  logo antiga.
- **Topo:** `aplicarMarca()` deixou de usar a logo da loja e delega para `window.unicarAplicarGrupo()`
  (`smg.js`), que troca imagem, título (`loginNome`) e subtítulo (`loginSubtitulo`) e também os `<link rel=icon>`.
  CSS novo `.brand-mark.grupo-logo` (contain, fundo branco, 46 px) — em card branco porque a arte tem fundo
  branco e elementos pretos (no tema escuro, sem o card, a parte preta sumiria).
- **Login:** usa `grupo-2026-login.png`; o padrão do servidor (`GRUPO_PADRAO.loginLogo`) mudou e
  `garantirGrupo` **migra** o caminho antigo (`/logos/logo_login.png`) para o novo, preservando upload
  personalizado (`data:image/...`).
- **Favicon:** ícones quadrados (32/192) em `index.html` e `login.html`; se o dono subir uma logo própria em
  Configurações, o favicon passa a usar a imagem enviada.
- **Não muda:** `marcas.js` (logo por loja), OS impressa em duas vias, timbrado, PDF do WhatsApp e o cabeçalho
  de cada via — testes cobrem os dois lados.
