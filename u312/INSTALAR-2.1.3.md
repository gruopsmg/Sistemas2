# 📘 MANUAL — Instalar a versão 2.1.3 do UNICAR (rede local)

**O que esta versão acrescenta:** (1) cada usuário vê no topo a **logo e o nome da SUA loja**;
(2) a **Ordem de Serviço em A4**, com a logo da loja no cabeçalho, **marca d'água** da loja no meio da
folha e o formulário completo em 5 seções; (3) botão **🖨️ Versão em branco** para imprimir o modelo.

**O que este manual faz:** cria uma pasta nova e separada (`unicar-lan-2.1.3`) e põe a versão nova para
rodar em **porta de teste (3004)** — **sem encostar no sistema que está rodando hoje**.

**O que este manual NÃO faz:** não altera a produção, não apaga/move/renomeia nada, não mexe no
`data.json` original e **não roda migração nenhuma** (esta versão não precisa: não muda a estrutura do
dado, só acrescenta campos opcionais na OS, que nascem vazios).

> Todos os comandos vão em **uma linha só**. No CMD do Windows, cole **um comando por vez** e aperte Enter.

---

## ⚠️ Antes de começar (5 regras de ouro)

1. Cole **um comando por vez** (nunca o bloco inteiro de uma vez).
2. **Nunca** deixe as duas versões abertas apontando para o mesmo `data.json`.
3. A pasta antiga (`unicar-lan`) **não é apagada, movida nem renomeada** em momento nenhum.
4. No teste (porta 3004) o sistema usa uma **cópia** dos seus dados: o que você fizer ali **não mexe** no
   sistema real.
5. Se algo der errado: `Ctrl+C` fecha a janela e a versão antiga continua funcionando como sempre.

---

## 🟢 PASSO 1 — Backup do data.json atual

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
mkdir BACKUPS_MANUAIS
```
```
copy unicar-lan\data.json BACKUPS_MANUAIS\d-213.json
```
Uma segunda cópia, fora da pasta (à prova de acidente):

```
cd /d "C:\Users\Cliente\Documents\Unicar\BACKUPS_MANUAIS"
```
```
copy d-213.json "%USERPROFILE%\Desktop\"
```

✅ **Deu certo?** Aparece `d-213.json` na lista e uma cópia na Área de Trabalho.

---

## 🟢 PASSO 2 — Criar a pasta separada

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
mkdir unicar-lan-2.1.3
```
```
cd unicar-lan-2.1.3
```

✅ **Deu certo?** O caminho do prompt passa a terminar em `\unicar-lan-2.1.3>`.

---

## 🟢 PASSO 3 — Baixar e instalar

**3.1 — Baixar o pacote** (o ZIP tem só o programa: **não tem `node_modules`** e **não tem
`data.json`** — ele não substitui dado nenhum seu):

```
curl.exe -o u213.zip http://82.25.64.194:8890/a213b40e/u213.zip
```
```
powershell Expand-Archive u213.zip -DestinationPath . -Force
```
```
dir
```

✅ **Deu certo?** Aparecem `server.js`, `os.js`, `marcas.js`, `package.json` e as pastas `public`
(com `public\logos`) e `testes`.

**3.2 — Instalar as bibliotecas** (usa o `package-lock.json`, não troca versão de nada):

```
npm ci
```

✅ **Deu certo?** Termina com algo como `added 90 packages in 7s`.

**3.3 — Se o `npm ci` falhar** (sem internet), copie as bibliotecas da versão que já roda:

```
cd /d "C:\Users\Cliente\Documents\Unicar\unicar-lan"
```
```
xcopy node_modules ..\unicar-lan-2.1.3\node_modules /E /I /Q
```
```
cd ..\unicar-lan-2.1.3
```

---

## 🟢 PASSO 4 — Subir na PORTA DE TESTE (3004)

**4.1 — Levar uma CÓPIA do seu dado para a pasta nova:**

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
copy unicar-lan\data.json unicar-lan-2.1.3\data.json
```

**4.2 — Subir a versão nova na 3004** (deixe esta janela aberta):

```
cd unicar-lan-2.1.3
```
```
set PORT=3004 && npm start
```

✅ **Deu certo?** Aparece o quadro:

```
UNICAR - Estoque de Pneus (rede local) v2.1.3
Neste computador: http://localhost:3004
```

**4.3 — Conferir em outra janela do CMD:**

```
curl.exe http://localhost:3004/health
```

✅ **Resposta esperada:** `{"ok":true,"versao":"2.1.3",...}`

---

## 🟢 PASSO 5 — Validação (o que conferir na tela)

Abra no navegador: **http://localhost:3004**

| # | O que fazer | Deu certo? |
|---|---|---|
| 1 | Entrar com o **seu usuário e senha de sempre** | entrou e a tela abre igual à de hoje |
| 2 | Olhar o **topo da tela** | aparece a **logo + o nome da sua loja** (UNICAR: "AUTO CENTER UNICAR") |
| 3 | Entrar como o **gerente da FILIAL** (aba anônima) | no topo aparece o **escudo da FILIAL** — nunca a logo da UNICAR |
| 4 | Entrar como **admin** | no topo aparece a marca do sistema (UNICAR), como antes |
| 5 | **Ordens de Serviço** → abrir uma OS → **🖨 Imprimir** | folha A4 com a **logo da loja** no cabeçalho, **"ORDEM DE SERVIÇO Nº …"** e a **marca d'água** da loja no meio |
| 6 | Olhar as 5 seções da folha | Cliente · Veículo/local · Peças/produtos/serviços · Serviços e valores · Confirmação com SIM/NÃO e assinaturas |
| 7 | Na lista de OS, clicar em **🖨️ Versão em branco** | a mesma folha, **sem número e sem dados**, para preencher à mão |
| 8 | **+ Nova OS** → preencher **Bairro, CEP, RG/I.E., Mídia, Contato, Ponto de referência**, **Condições de pagamento** e **Autorização do cliente** | os campos aparecem na OS impressa |
| 9 | Imprimir/Salvar em PDF pelo navegador | **1 página**, com a marca d'água saindo no PDF |
| 10 | Aba **Estoque**, **Movimentações**, **Garantias**, **Bebidas**, **Usuários**, **Auditoria**, **Painel OS** | tudo igual a hoje |

**Para parar o teste:** clique na janela do 3004 e aperte **Ctrl+C**.

---

## 🟢 PASSO 6 — Rollback (voltar atrás)

**6.1 — Voltar do teste (porta 3004):** aperte `Ctrl+C` na janela do 3004. A versão antiga (3001) nunca
parou; nada mudou. Pode manter a pasta `unicar-lan-2.1.3` guardada.

**6.2 — Voltar depois de trocar para a 3001** (só se já estiver usando a versão nova valendo):

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
copy /Y unicar-lan-2.1.3\data.json unicar-lan\data.json
```
```
cd unicar-lan
```
```
set PORT=3001 && npm start
```

✅ De volta à versão antiga, com os dados mais recentes.
**Planos B:** cada pasta guarda backups automáticos em `backups\data-AAAAMMDD-HHMMSS.json`, e você tem a
cópia do Passo 1.

---

## 🔴 PASSO 7 — Trocar a produção para a 2.1.3 (SÓ com a sua autorização)

> Faça com a loja parada (uns 3 minutos, de preferência no fim do expediente).

1. **Avise** quem estiver usando.
2. Na janela do sistema antigo (3001): **Ctrl+C**.
3. Backup do dado "do momento":

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
copy unicar-lan\data.json BACKUPS_MANUAIS\d-troca.json
```

4. Levar o dado vivo para a pasta nova e subir na 3001:

```
copy /Y unicar-lan\data.json unicar-lan-2.1.3\data.json
```
```
cd unicar-lan-2.1.3
```
```
set PORT=3001 && npm start
```

5. **Validar de novo** (Passo 5, itens 1 a 9).
6. 🛑 **Não apague e não mova a pasta antiga** `unicar-lan`: ela é o seu rollback.

---

## 🔧 Problemas comuns

- **`npm` não é reconhecido** → o Node.js não está no PATH; reinstale/repare o Node.
- **`EADDRINUSE` (porta ocupada)** → use outra porta: `set PORT=3005 && npm start`.
- **Página em branco** → confira o endereço exato: `http://localhost:3004` (sem IP, sem https).
- **Só apareceu o usuário `admin` padrão / estoque vazio** → faltou o Passo 4.1 (copiar o `data.json`).
- **Logo não aparece no topo** → confira se a pasta `public\logos` veio no pacote (6 arquivos).
- **A folha saiu sem a marca d'água** → no diálogo de impressão, marque **"Gráficos de plano de fundo"**
  (o mesmo ajuste vale para a marca d'água aparecer no PDF).
- **Windows perguntar sobre o firewall** → permita em **rede privada** (o acesso pela LAN é assim hoje).

---

## ✅ Resumo

- 🟢 A produção **não é tocada** em nenhum passo.
- 🟢 Há **backup** do dado antes (Passo 1) e **rollback** pronto (Passo 6).
- 🟢 O teste roda em **cópia**, na **porta 3004**.
- 🟢 Esta versão **não precisa de migração**: os campos novos da OS nascem vazios.
- 🟡 A troca da 3001 (Passo 7) fica esperando a sua autorização — e é reversível.

Versão: **2.1.3** · Etiquetas de volta: `v2.1.2`, `v2.1.0`, `v2.0.0`, `v1.1.0-final`, `v1.0.0-recebido`
