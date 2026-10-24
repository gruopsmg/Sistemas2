# Instalar a versão 3.0.7 no PC da loja

Esta versão traz o estoque **separado por loja**, a **importação de arquivo** (TXT/CSV/PDF), o
**chat interno com chamados e alarme**, a **Ordem de Serviço impressa em duas vias** na mesma folha A4 o
**cadastro de clientes** (base única do grupo, usada ao abrir a OS) a OS impressa com o **timbrado da loja**
(a logomarca grande e clara no meio de cada via), a **cor de cada loja** nos detalhes o **envio da OS em PDF
pelo WhatsApp** (uma conexão por loja) e a **logo única do grupo** no topo, na tela de login e na aba do navegador. O sistema continua com a marca **UNICAR** como sempre foi;
a marca **SMG** aparece só na **tela de login** (editável em Configurações).
Nada da produção é apagado: a pasta antiga continua lá e o caminho de volta está no fim.

## Antes de começar (2 minutos)

1. Abra a pasta do sistema no PC: `C:\Users\Cliente\Documents\Unicar`.
2. Copie a pasta `unicar-lan` inteira para `C:\Users\Cliente\Documents\Unicar\BACKUPS_HERMES\antes-3.0.7`.
   (É a sua cópia de segurança: se algo der errado, é só voltar essa pasta.)
3. Confira que a cópia tem `data.json` dentro.

## Instalar (lado a lado, sem tocar na versão que está rodando)

4. Descompacte o `u307.zip` em `C:\Users\Cliente\Documents\Unicar\unicar-lan-3.0.7`.
5. Copie o `data.json` da pasta antiga para dentro de `unicar-lan-3.0.7`.
6. Abra a pasta `unicar-lan-3.0.7`, clique na barra de endereço, digite `cmd` e tecle Enter.
7. Digite: `npm ci` (precisa de internet; instala as bibliotecas).
8. Digite: `set PORT=3004` e depois `npm start`.
9. Abra no navegador: `http://localhost:3004` e entre com o seu usuário de administrador.

## WhatsApp (opcional, mas é o que esta versão acrescenta)

9.1. A versão nova instala mais bibliotecas (o WhatsApp usa a `@whiskeysockets/baileys`), por isso o
   `npm ci` do passo 7 passa de ~130 pacotes e precisa de internet.
9.2. Entre como **administrador** → aba **Configurações** → painel **📱 WhatsApp das lojas**.
9.3. Em cada loja escolha um caminho: **Conectar (QR Code)** e leia o QR no celular da loja
   (WhatsApp → Aparelhos conectados → Conectar aparelho), ou digite o número da loja e clique em
   **Conectar com número** — o sistema mostra um código de 8 caracteres para digitar no WhatsApp.
9.4. O status muda para **🟢 Conectado** com o número. Use **Enviar mensagem de teste** para conferir.
9.5. A sessão fica em `C:\Users\Cliente\Documents\Unicar\whatsapp-sessao\<LOJA>` — **fora** da pasta do
   sistema. Trocar de versão (renomear pastas) não apaga e não pede QR de novo. Não apague essa pasta.
9.6. Para mandar a OS: **Ordens de Serviço → Ver → 📱 WhatsApp** (confirme o número do cliente).
   O sistema só ENVIA; não recebe nem responde mensagens.

## Logo do grupo (novo nesta versão)

- O **topo do sistema**, a **tela de login** e o **ícone da aba** agora usam a mesma logo do **grupo**
  (SMG), igual para todas as lojas e usuários.
- A logo de **cada loja continua nos documentos**: OS impressa em duas vias e PDF do WhatsApp. Nada mudou ali.
- O navegador pode guardar a logo antiga: abra com **Ctrl+F5** (ou aba nova) na primeira vez.
- Trocar a logo depois: **Configurações → Logo da tela de login** (o arquivo enviado passa a valer também no
  topo e na aba). Não precisa de programador.

## Conferir (o que você deve ver)

10. A **tela de login** com a **logo SMG** (a imagem que você mandou) e a marca **SMG**;
11. A **Ordem de Serviço impressa em duas vias** na mesma folha A4 (cliente em cima, loja embaixo, com linha de corte), com as opções "duas vias / só cliente / só loja" e "Salvar em PDF";
15. Na OS impressa, cada via sai com o **timbrado da loja** ao fundo e a **cor da loja** (a da logomarca) na faixa, no número e no total. Em **Configurações → Dados que saem na OS impressa** dá para ajustar a cor de cada loja.
14. A aba **Clientes**: lista de todas as lojas, busca por nome/CPF/telefone, cadastro, edição e importação de lista (CSV/TXT). Ao criar uma OS, o campo **“Usar cliente já cadastrado”** preenche tudo; se for cliente novo, ele entra na base ao salvar.
12. Em **Configurações → Dados que saem na OS impressa**: endereço, telefone e CNPJ de cada loja, mais os textos de garantia e prazo; dentro do sistema o topo continua **UNICAR**. Menu com **Estoque por loja**, **Importar**, **Chat** e **Configurações**.
11. Em **Estoque por loja**: as três colunas (UNICAR, FILIAL, MATRIZ) e o botão **Distribuir estoque atual**.
12. Em **Importar**: envie um TXT/CSV, escolha a loja e o modo, veja a **prévia** — só grava no **Confirmar**.
13. Em **Chat**: clique em **Ativar sons**, abra um chamado urgente de outra loja e confirme que o alarme toca e para no **Visto**.

## Publicar (trocar a versão que os clientes usam)

14. Feche a janela preta da versão antiga (a da porta 3001).
15. Na pasta `unicar-lan-3.0.7`: `set PORT=3001` e `npm start`.
16. Confira `http://localhost:3001`. Se estiver tudo certo, a versão antiga pode ser renomeada para `unicar-lan-antiga`.

## Como voltar atrás (se algo não funcionar)

17. Feche a janela preta que estiver aberta.
18. Renomeie `unicar-lan-3.0.7` para `unicar-lan-3.0.7-com-problema`.
19. Copie de volta `BACKUPS_HERMES\antes-3.0.7\unicar-lan` para o lugar da antiga.
20. Entre na pasta da versão antiga e rode `npm start` (porta 3001, como era antes).

O `data.json` da 3.0.2 **não** serve para a versão antiga (ela não entende o estoque por loja).
Se precisar voltar, use o `data.json` da cópia do passo 2 — é o dado de antes da atualização.

## Mudanças que mexem no dado (leia uma vez)

- **Estoque por loja:** todo o estoque que existia foi atribuído à loja principal (UNICAR).
  Ele reorganiza em **Estoque por loja → Distribuir estoque atual** (a soma tem que fechar com o total).
- **Número de OS:** continua igual à versão anterior (`OS-UNICAR-000001`). Existe um campo
  opcional de prefixo em **Configurações**, vazio por padrão (vazio = numeração de sempre).
- **Chat e chamados** ficam no mesmo `data.json`. As mensagens não são apagadas de verdade:
  o administrador marca como apagada (fica o registro para a auditoria).
- **Sons do alarme:** o navegador só libera áudio depois de um clique — por isso o botão
  **Ativar sons**. O alarme de chamado toca 3 s e repete a cada 30 s até alguém clicar em **Visto**
  (para sozinho depois de 10 minutos).
