# UNICAR — Estoque de Pneus (rede local / LAN)

Sistema de controle de estoque de pneus que roda **no seu próprio computador**,
sem depender de internet externa nem de assinatura de nenhum serviço. Qualquer
aparelho conectado na mesma rede Wi-Fi/rede local pode acessar e ver o mesmo
estoque, em tempo real.

## O que você precisa

- Um computador que fique ligado durante o expediente (vai ser o "servidor").
- Instalar o **Node.js** nele (só uma vez). Baixe em: https://nodejs.org
  (escolha a versão "LTS").

## Passo a passo (fazer uma vez)

1. Copie a pasta `unicar-lan` para o computador que vai servir de servidor
   (ex: o computador do balcão ou do escritório).
2. Abra o **Prompt de Comando** (Windows) ou o **Terminal** (Mac/Linux).
3. Entre na pasta do projeto, por exemplo:
   ```
   cd Desktop\unicar-lan
   ```
4. Instale as dependências (só precisa fazer isso uma vez):
   ```
   npm install
   ```
5. Inicie o sistema:
   ```
   npm start
   ```
6. Vai aparecer uma mensagem assim no terminal:
   ```
   UNICAR - Estoque de Pneus (rede local)
   Neste computador: http://localhost:3000
   De outros aparelhos na mesma rede Wi-Fi/LAN, acesse:
     -> http://192.168.0.15:3000
   ```
   Esse endereço `http://192.168.0.15:3000` (o número vai ser diferente no seu
   caso) é o que você vai usar nos **outros** aparelhos.

## Usando em vários pontos (celular, tablet, outro PC)

- No **próprio computador servidor**, abra o navegador em `http://localhost:3000`.
- Em **qualquer outro aparelho** (celular, tablet, outro computador da loja),
  desde que esteja **na mesma rede Wi-Fi**, abra o navegador e digite o
  endereço que apareceu no terminal (ex: `http://192.168.0.15:3000`).
- Todos verão e poderão editar o **mesmo estoque**, atualizado ao vivo.

Dica: para não precisar descobrir o IP de novo toda vez, você pode configurar
um "IP fixo" para o computador servidor nas configurações do seu roteador
(isso é opcional, procure por "IP reservado" ou "DHCP fixo" no manual do seu
roteador Wi-Fi).

## Deixando o sistema sempre rodando

Enquanto a janela do terminal com `npm start` estiver aberta, o sistema fica
disponível. Se você fechar o terminal, o sistema para. Algumas opções para
deixar sempre ligado:

- **Mais simples**: deixe o terminal aberto minimizado no computador servidor.
- **Windows**: você pode usar o Agendador de Tarefas para iniciar o comando
  `npm start` automaticamente quando o computador ligar.
- **Mais avançado (Windows/Mac/Linux)**: instale o utilitário `pm2`
  (`npm install -g pm2`) e rode `pm2 start server.js --name unicar`. Ele
  mantém o sistema rodando em segundo plano e reinicia automaticamente se
  cair.

## Login por usuário

Agora o sistema pede usuário e senha. Cada aparelho da rede precisa entrar uma
vez; a sessão dura 12 horas e depois pede a senha de novo.

**No primeiro `npm start`**, o sistema cria sozinho um administrador:

```
usuário: admin
senha:   unicar123
```

Entre com ele e **troque a senha na hora** (o sistema já abre a tela pedindo
isso). Depois, na aba **Usuários**, cadastre uma conta para cada pessoa da loja.

Existem dois perfis:

- **Administrador** — usa o sistema todo e ainda cadastra, bloqueia e exclui
  usuários (aba "Usuários").
- **Operador** — usa estoque, movimentações, garantias e bebidas normalmente, mas
  não vê as abas de usuários e auditoria.

Detalhes úteis:

- As senhas ficam guardadas **embaralhadas** (hash scrypt) dentro do `data.json`
  — nem o administrador consegue ler a senha de alguém, só definir uma nova.
- Se alguém esquecer a senha, o administrador abre **Usuários → Editar** e define
  uma senha nova; a pessoa é desconectada e entra com a senha nova.
- Para tirar o acesso de um ex-funcionário sem apagar o histórico, use
  **Editar → Situação: Bloqueado**.
- Toda movimentação de estoque e toda etapa de garantia passam a registrar
  **quem lançou**, e isso aparece no histórico e na ficha da garantia.
- Sempre precisa sobrar pelo menos um administrador ativo, e ninguém consegue
  excluir ou bloquear a própria conta.
- Depois de 8 tentativas de senha erradas seguidas, aquele aparelho fica 5
  minutos sem poder tentar de novo.

Um aviso honesto: a rede local não usa HTTPS, então a senha trafega sem
criptografia dentro do Wi-Fi da loja. Para o uso interno pretendido isso é
aceitável, mas vale proteger o Wi-Fi com uma senha boa e não expor a porta 3000
para a internet.

## Log de auditoria, backups e tema

**Log de auditoria** — a aba **Auditoria** (só para administradores) mostra quem
fez o quê: cadastro e exclusão de pneus, qualquer mudança de preço, edição e
exclusão de garantias, **toda entrada, saída, correção e exclusão de bebida**, e
tudo que é feito na aba Usuários. É separado da lista de "Movimentações" (que já
existia e continua registrando entradas/saídas de estoque de pneus com o nome de
quem lançou).

**Backup automático** — o sistema salva sozinho uma cópia do `data.json` na
pasta `backups/` ao ligar e depois a cada 6 horas, guardando as últimas 60
cópias (cerca de 15 dias). Na aba Usuários, o administrador também pode clicar
em **"Fazer backup agora"** e baixar qualquer cópia da lista. Para restaurar um
backup: pare o servidor, substitua o `data.json` pelo arquivo baixado (renomeado
para `data.json`) e ligue de novo.

**Tema claro/escuro** — o botão 🌙/☀️ no topo alterna entre os dois temas; a
escolha fica salva no navegador de cada aparelho.

## Valor de compra e valor total do estoque (acesso restrito)

- **Valor total do estoque** (card "Valor em estoque" do Painel): aparece **só para
  administradores**. Para os operadores o card some e o servidor nem envia esse número.
- **Valor de compra de cada pneu**: na aba Estoque a coluna aparece escondida (`R$ ••••`).
  Para o **administrador** o valor de compra já aparece direto na coluna, sem senha e sem
  clicar em nada (e já vem preenchido ao editar o pneu). Para os **demais usuários** o valor
  fica escondido: clique em **👁 Ver** e digite **a sua própria senha**. O valor aparece **só
  daquele pneu** — ao liberar outro pneu, o anterior volta a ficar escondido. Some sozinho
  depois de 30 segundos (ou no botão 🙈).
- Para os não administradores, o valor de compra **não é enviado ao navegador**: o servidor só
  entrega esse número no momento em que a senha é conferida, então não dá para vê-lo "inspecionando" a página.
- Depois de 5 senhas erradas seguidas, a pessoa fica 5 minutos sem poder consultar.
- Cada consulta fica na aba **Auditoria** ("Consultou Pneu": quem viu o valor de qual pneu,
  sem gravar o valor).
- Ao **editar** um pneu, o campo "Valor de compra" vem vazio: deixe vazio para manter o valor
  atual, ou digite um número para trocá-lo. Ao cadastrar um pneu novo, funciona como antes.
- A exportação (CSV/impressão) **não inclui** o valor de compra.
- Observação: a Auditoria (só admin) e os backups continuam mostrando/contendo os valores.

## Evitando pneus duplicados

Ao cadastrar um pneu novo (marca + medida + tipo "novo"/"remoldado" iguais a
um já existente, sem diferenciar maiúsculas/minúsculas ou espaços), o sistema
não deixa criar um segundo item igual. Em vez disso, ele avisa quanto já tem
em estoque e pergunta se você quer **somar a quantidade digitada ao cadastro
já existente**:

- Se você confirmar, a quantidade é somada ao pneu existente e fica registrada
  uma entrada em "Movimentações" (motivo: "Novo lote cadastrado (mesmo pneu já
  existente)").
- Se você cancelar, nada é criado — ajuste a marca, a medida ou o tipo
  (novo/remoldado) se realmente quiser um item separado.

Pneus "novo" e "remoldado" com a mesma marca/medida são tratados como itens
diferentes, já que normalmente têm preço e procedência distintos.

## Aba "Garantias"

Controla o pneu de garantia do momento em que ele entra na loja até a entrega
final ao cliente. Cada etapa grava **data e hora**:

1. **Lançar chegada** — cadastra cliente, veículo/placa, marca, medida,
   quantidade, nº de série/DOT, nota fiscal e o defeito relatado. A data/hora
   vem preenchida com o momento atual, mas você pode corrigir (útil para
   lançar um pneu que chegou ontem).
2. **Enviar p/ fábrica** — registra a ida do pneu para a fábrica.
3. **Lançar resultado** — registra a análise da fábrica como **aprovado** ou
   **reprovado**, com espaço para o nº do laudo.
4. **Registrar saída** — registra a saída/entrega do pneu. Nessa hora você pode
   marcar a opção de **dar baixa no estoque** de um pneu novo entregue ao
   cliente: o sistema cria automaticamente uma saída em "Movimentações" com o
   motivo "Troca em garantia — nome do cliente".

O botão **Ficha** abre a linha do tempo completa, com todas as datas, horários,
observações e o tempo total (em dias) que a garantia levou.

Se lançar uma etapa errada, abra a Ficha e use **Desfazer última etapa**.
Atenção: desfazer a saída não devolve o pneu ao estoque — se você tinha marcado
a baixa, faça uma entrada manual na aba Movimentações.

As etapas só podem ser lançadas na ordem certa e nenhuma data pode ser anterior
à etapa anterior, para o histórico não ficar inconsistente.

O painel inicial mostra um resumo de "Garantias em aberto", com quantos dias
cada uma está parada — bom para cobrar a fábrica.

## Aba "Bebidas"

Controle simples das bebidas da loja: **qual é a bebida, quanto tem em estoque e
para onde saiu.** Qualquer usuário (administrador ou operador) pode usar.

- **+ Nova bebida** — cadastra o nome (ex: "Coca-Cola 2L", "Água 500ml") e a
  quantidade que já tem. O sistema não deixa cadastrar duas bebidas com o mesmo
  nome (ignora maiúsculas, acentos e espaços extras).
- **Registrar entrada / saída** — escolha a bebida, o tipo e a quantidade:
  - **Saída**: é obrigatório informar **para onde saiu** (ex: "geladeira do
    balcão", "cliente João", "evento sábado"). O estoque diminui e o sistema
    não deixa a saída passar do que existe.
  - **Entrada** (reposição): o estoque aumenta; a observação (ex: "compra no
    fornecedor") é opcional.
- **Estoque de bebidas** — mostra quanto tem de cada uma; quando chega a zero
  aparece o aviso "sem estoque". O botão **Editar** serve para renomear ou
  **corrigir o estoque** depois de uma contagem (essa correção não aparece no
  histórico de bebidas, mas fica registrada na Auditoria).
- **Histórico de bebidas** — lista quem lançou cada entrada/saída, quando, para
  onde foi e quanto ficou em estoque. Excluir uma bebida da lista **não apaga**
  o histórico dela.

**Auditoria:** tudo isso também vai para a aba **Auditoria** (só administrador),
com o nome de quem fez. Exemplos do que aparece lá:

- `Saída de Bebida — Saída de 5 un. de Coca-Cola 2L para "Geladeira do balcão" (estoque: 24 → 19).`
- `Entrada de Bebida — Entrada de 12 un. de Coca-Cola 2L (Compra fornecedor) (estoque: 19 → 31).`
- `Editou Bebida — Editou a bebida Coca-Cola 2L — estoque: 32 → 30.`

As quantidades de bebida são sempre números inteiros (garrafas, latas, caixas…).
Sistemas antigos continuam funcionando: se o seu `data.json` ainda não tem
bebidas, o campo é criado sozinho na primeira vez que o servidor liga.

## Configuração, log e saúde do sistema (v1.1.0)

**Configuração (opcional).** Copie o arquivo `.env.example` para `.env` na pasta do sistema e ajuste
o que precisar. Sem `.env`, tudo funciona com os valores padrão (os mesmos de antes). As opções são:
`PORT` (padrão 3000), `HOST` (padrão `0.0.0.0`, todos os aparelhos da rede), `ARQUIVO_DADOS`,
`PASTA_BACKUPS`, `PASTA_LOGS`, `NIVEL_LOG` (debug/info/aviso/erro/silencio), `INTERVALO_BACKUP_MS`,
`MAX_BACKUP_ARQUIVOS`, `LIMITE_MOVIMENTOS`, `LIMITE_AUDITORIA`, `DIAS_DE_LOG`.
Se um valor estiver errado (ex.: `PORT=abc`), o sistema **avisa e não sobe** — melhor parar do que
subir na porta errada.

**Log.** A partir da v1.1.0 o sistema também grava o que acontece em `logs\app-AAAAMMDD.log`
(e avisos/erros em `logs\erros-AAAAMMDD.log`), guardando 14 dias. É onde se procura o código do erro
(ex.: `erro 1a2b3c4d`) que aparece na tela.

**Saúde.** `http://localhost:3001/health` responde, sem exigir login, apenas
`{"ok":true,"versao":"...","uptimeSegundos":...}` — serve para monitorar sem expor nada interno.
O diagnóstico completo (`/api/diagnostico`, só administrador) mostra tamanho e idade do arquivo de
dados, quantas gravações deram certo, se existe cópia `.bak`, quantos erros aconteceram e o motivo.

**Modo seguro (importante).** Se o `data.json` ficar ilegível (queda de energia, disco cheio,
antivírus), o sistema **não apaga nem substitui** o arquivo: ele passa a ler a última cópia boa
(`data.json.bak`), **recusa gravar** e avisa na tela. Se nem o `.bak` servir, o sistema **não sobe** e
explica o que fazer. Nos dois casos, nada é perdido por conta própria — o caminho de volta está no
`RESTAURAR.md`.

**Gravação segura.** Antes de cada gravação o sistema escreve em `data.json.tmp`, confirma no disco e
renomeia por cima (troca atômica). O arquivo bom anterior vira `data.json.bak`. Queda de energia no
meio da gravação não trunca mais o arquivo.

**Testes.** `npm test` roda a bateria automática (armazenamento, configuração e servidor de ponta a
ponta). Nenhuma dependência extra: usa o próprio `node:test` do Node.js. Os testes nunca tocam no
`data.json` de verdade — cada um usa uma pasta temporária própria.

## Ordens de Serviço e lojas (v2.0.0)

O sistema passou a ter **Ordens de Serviço (OS)** e **três lojas**: `UNICAR`, `FILIAL` e `MATRIZ`.
Cada OS pertence a uma loja e **só aparece para quem tem acesso àquela loja** (o administrador vê todas).

**Perfis e o que cada um pode:**

| Perfil | Vê | Pode |
|---|---|---|
| Administrador | todas as lojas | tudo: usuários, configurações, cancelar OS, relatórios gerais |
| Gerente | só a loja dele | abrir/editar/cancelar OS da loja, ver o painel da loja |
| Operador/Atendente | só a loja dele | abrir e editar OS da loja (valores até a OS ser aprovada); **não** cancela nem administra usuários |
| Mecânico/Técnico | só as OS **atribuídas a ele** | atualizar serviços e observações técnicas; **não** mexe em valores |

A loja fica gravada no cadastro do usuário e é conferida **no servidor** a cada pedido — não é só a tela
escondendo. Se o usuário mudar de loja, as sessões abertas dele são encerradas.

**Numeração:** automática e única por loja — `OS-UNICAR-000001`, `OS-FILIAL-000001`, `OS-MATRIZ-000001`.

**Status da OS:** Aberta · Em análise · Aguardando aprovação · Aprovada · Em execução · Aguardando peça ·
Finalizada · Entregue · Cancelada (cancelar exige motivo). Toda alteração fica no **histórico da própria OS**
e na **Auditoria** — nada é apagado quando a OS é editada.

**O que a OS tem:** cliente (nome, CPF/CNPJ, telefone, WhatsApp, e-mail, endereço), veículo (placa, marca,
modelo, ano, km, observações), serviços solicitados, itens (pneu, peça, produto, mão de obra) com quantidade,
valor, desconto, cálculo automático de subtotal/desconto/total, observações internas (não saem na impressão)
e observações para o cliente.

**Busca e relatórios:** busca por número, cliente, telefone, placa; filtros por status, loja e período;
**Exportar CSV**; painel por loja com contagem por status, faturamento, valor em andamento, OS pendentes,
serviços mais realizados e clientes recentes. O administrador tem o painel consolidado das três lojas
(`/api/painel/consolidado`).

**Imprimir:** o botão de impressão abre a folha pronta (cabeçalho da marca e da loja, número da OS, dados do
cliente e do veículo, itens, totais, observações e espaço para assinaturas) e chama a impressão do navegador.

**Primeira vez (migração).** O sistema antigo não tinha loja nenhuma. Para marcar os dados que já existiam,
rode **uma vez**:

```
node migracoes/executar.js              :: só simula (não grava nada)
node migracoes/executar.js --aplicar    :: aplica (faz uma cópia antes e confere depois)
node migracoes/executar.js --reverter   :: desfaz (recusa se já existirem OS cadastradas)
```

A migração é **aditiva**: cria as lojas, a lista de OS e o contador; marca os registros existentes com a
loja `UNICAR` (o administrador fica com acesso a todas). Não apaga, não renomeia e não altera valores,
senhas, sessões, quantidades, preços ou auditoria. A cópia prévia fica como
`data.json.antes-migracao-AAAAMMDD-HHMMSS`. Detalhes e o porquê de cada escolha estão no `DECISOES.md`.

### Baixa automática de estoque (v2.1.0)

Ao mudar a OS para **Em execução**, o sistema dá baixa no estoque dos itens que estiverem vinculados a um item
do estoque (pneu ou bebida):

1. cria **uma movimentação de saída por item**, com número da OS, loja, item, quantidade, usuário e data/hora;
2. **bloqueia** a mudança de status se faltar estoque e mostra **o que está faltando** (disponível × necessário);
3. **não duplica**: salvar o mesmo status de novo, editar a OS ou sair e voltar para "Em execução" não baixa outra vez;
4. **aumentou a quantidade** depois da baixa → baixa **somente a diferença**;
5. **diminuiu ou removeu o item** → cria **entrada de estorno** (a movimentação original continua registrada);
6. **cancelou a OS** → estorna automaticamente **tudo** o que ainda estava baixado;
7. toda baixa e todo estorno ficam no **histórico da OS** e na **auditoria** (com a loja).

No formulário da OS, cada item tem o campo **"Item do estoque"**: escolher um pneu ou uma bebida é o que liga a
baixa automática; deixando em *"— não mexe no estoque —"* (padrão), o item é só valor na OS (mão de obra, peça
solta). O sistema mostra quanto tem disponível ao lado.

No detalhe da OS há o botão **📦 Conferir estoque**: mostra, sem alterar nada, se há estoque suficiente e o que
já foi baixado por aquela OS.

O estoque continua **compartilhado** entre as lojas: a baixa de uma OS da FILIAL reduz o mesmo estoque que a
UNICAR enxerga (e a conferência de disponibilidade vale para as três lojas).

### Correções da v2.1.1 e da v2.1.2 (mesmas funções, sem surpresa)

1. **Editar a OS não mexe no estoque além do necessário.** O formulário passou a devolver o **mesmo
   identificador** de cada item, então aumentar a quantidade baixa **somente a diferença**. Antes disso, uma
   edição podia registrar um estorno e uma nova baixa do mesmo item: o saldo final sempre fechava certo, mas o
   histórico ganhava movimentações que não deveriam existir.
2. **Bloquear / liberar o acesso pela lista de usuários** (botão ao lado de "Editar"), sem apagar nada.
3. **Usuário que aparece em alguma OS não pode ser excluído:** o sistema recusa e orienta a **bloquear** o
   acesso — assim o histórico (quem abriu, quem executou, cada passo) fica sempre íntegro.
4. **v2.1.2 — o mecânico responsável anda com a parte técnica pela tela.** O botão de mudar status só
   aparecia para perfil administrativo, embora o servidor já permitisse ao mecânico colocar a **própria OS**
   em execução / aguardando peça / finalizar. A tela agora oferece exatamente essas opções (e continua sem
   mexer em valores, sem cancelar e sem entregar a OS ao cliente).

### Novidades da v2.1.3 — a loja no topo e a OS em A4

1. **Cada usuário vê a logo e o nome da SUA loja no topo.** O cabeçalho deixou de ser fixo: ao entrar,
   a tela pede a marca ao servidor (`/api/eu` agora devolve `marca`) e troca a logo e o texto. Quem não
   tem loja (administrador) continua vendo a marca do sistema. Em nenhuma situação aparece a logo de
   outra loja: o servidor só manda a marca da loja do próprio usuário.
2. **Ordem de Serviço em A4 vertical, pronta para imprimir.** O documento foi refeito no formato de
   formulário comercial, com **5 seções**: dados do cliente; características do veículo/local; peças,
   produtos e serviços; opções de serviços e valores; e o rodapé de confirmação (pergunta SIM/NÃO,
   observações e assinaturas do funcionário e do cliente).
3. **Marca d'água da loja** no centro da folha, atrás de todo o conteúdo, a **12% de opacidade** e com
   **68% da largura** da página. É a mesma logo do cabeçalho (o branco desaparece no papel por
   `mix-blend-mode: multiply`) e sai na impressão e no PDF (`print-color-adjust: exact`).
4. **Campos novos na OS** (todos opcionais — OS antiga continua válida e nasce vazia): bairro, CEP,
   RG/I.E., mídia, contato, ponto de referência, condições de pagamento e autorização do cliente.
5. **Modelo em branco:** botão **🖨️ Versão em branco** na aba Ordens de Serviço. O vendedor tira só da
   própria loja; o administrador escolhe a loja. A folha sai sem número e sem dados.

As logos ficam em `public/logos/` (`loja_UNICAR_logo.webp`, `loja_MATRIZ_logo.webp`,
`loja_FILIAL_logo.webp` e as `marca_agua_*.png`). Para trocar uma logo, basta substituir o arquivo com o
mesmo nome — o endereço `/logos/...` já está servido pelo próprio sistema.

## Onde ficam os dados

Tudo é salvo automaticamente no arquivo `data.json`, dentro da própria pasta
do projeto, no computador servidor. Recomendações:

- Faça backup desse arquivo de vez em quando (basta copiar o `data.json`
  para um pendrive ou nuvem).
- Não edite esse arquivo manualmente enquanto o sistema estiver rodando.

## Problemas comuns

- **"Não consigo acessar de outro aparelho"**: confirme que os dois aparelhos
  estão na mesma rede Wi-Fi, e que o firewall do Windows não está bloqueando
  a porta 3000 (na primeira vez que rodar, o Windows pode perguntar se
  permite acesso à rede — clique em "Permitir").
- **"Quero mudar a porta 3000"**: rode `set PORT=8080 && npm start` (Windows)
  ou `PORT=8080 npm start` (Mac/Linux), e use essa porta no endereço.
