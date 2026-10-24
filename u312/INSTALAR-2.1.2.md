# 📘 MANUAL — Instalar a versão 2.1.2 do UNICAR (rede local)

**O que este manual faz:** cria uma pasta nova e separada (`unicar-lan-2.1.2`), põe a versão nova para
rodar em **porta de teste (3002)** e valida tudo — **sem encostar no sistema que está rodando hoje**.

**O que este manual NÃO faz:** não altera a produção, não apaga/move/renomeia nada, não mexe no
`data.json` original e **não roda a migração** (isso fica para o fim, esperando a sua autorização).

> Todos os comandos deste manual foram conferidos: **cada um tem no máximo 63 caracteres** e vai em
> **uma linha só**. No CMD do Windows, cole **um comando por vez** e aperte Enter.

---

## ⚠️ Antes de começar (5 regras de ouro)

1. Cole **um comando por vez** (nunca o bloco inteiro de uma vez).
2. **Nunca** deixe as duas versões abertas apontando para o mesmo `data.json`.
3. A pasta antiga (`unicar-lan`) **não é apagada, movida nem renomeada** em momento nenhum.
4. No teste (porta 3002) o sistema usa uma **cópia** dos seus dados: o que você fizer ali **não mexe** no
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
copy unicar-lan\data.json BACKUPS_MANUAIS\data-antes-2.1.2.json
```
Uma segunda cópia, fora da pasta (à prova de acidente):

```
cd /d "C:\Users\Cliente\Documents\Unicar\BACKUPS_MANUAIS"
```
```
copy data-antes-2.1.2.json "%USERPROFILE%\Desktop\"
```
```
dir
```

✅ **Deu certo?** Aparece `data-antes-2.1.2.json` na lista (tamanho parecido com **328.963 bytes**) e uma
cópia na Área de Trabalho.

---

## 🟢 PASSO 2 — Criar a pasta separada

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
mkdir unicar-lan-2.1.2
```
```
cd unicar-lan-2.1.2
```

✅ **Deu certo?** O caminho do prompt passa a terminar em `\unicar-lan-2.1.2>`.

---

## 🟢 PASSO 3 — Copiar os arquivos (seguro)

**3.1 — Baixar o pacote** (o ZIP tem só o programa: **não tem `node_modules`** e **não tem `data.json`** —
ou seja, ele não substitui dado nenhum seu):

```
curl.exe -o u212.zip http://82.25.64.194:8890/22601a40/u212.zip
```
```
powershell Expand-Archive u212.zip -DestinationPath . -Force
```
```
dir
```

✅ **Deu certo?** Aparecem `server.js`, `os.js`, `estoque-os.js`, `package.json` e as pastas `public` e
`migracoes`.

**3.2 — Instalar as bibliotecas** (usa o `package-lock.json`, não troca versão de nada):

```
npm ci
```

✅ **Deu certo?** Termina com algo como `added 90 packages in 7s`.

**3.3 — Se o `npm ci` falhar** (sem internet), copie as bibliotecas do sistema antigo:

```
cd /d "C:\Users\Cliente\Documents\Unicar\unicar-lan"
```
```
xcopy node_modules ..\unicar-lan-2.1.2\node_modules /E /I /Q
```
```
cd ..\unicar-lan-2.1.2
```

---

## 🟢 PASSO 4 — Sobre os comandos

Todos os comandos vão em **linha única** e foram medidos (o maior tem 63 caracteres). Se você vir um
comando "quebrado" na tela, é só a quebra visual do CMD: confira digitando, ou cole linha por linha.

---

## 🟢 PASSO 5 — Subir na PORTA DE TESTE (3002)

**5.1 — Levar uma CÓPIA do seu dado para a pasta nova** (o sistema real segue usando o dele):

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
copy unicar-lan\data.json unicar-lan-2.1.2\data.json
```

**5.2 — Subir a versão nova na 3002** (deixe esta janela aberta):

```
cd unicar-lan-2.1.2
```
```
set PORT=3002 && npm start
```

✅ **Deu certo?** Aparece o quadro:

```
UNICAR - Estoque de Pneus (rede local) v2.1.2
Neste computador: http://localhost:3002
```

**5.3 — Conferir em outra janela do CMD:**

```
curl.exe http://localhost:3002/health
```

✅ **Resposta esperada:** `{"ok":true,"versao":"2.1.2",...}`

---

## 🟢 PASSO 6 — Validação (o que conferir na tela)

Abra no navegador: **http://localhost:3002**

| # | O que fazer | Deu certo? |
|---|---|---|
| 1 | Entrar com o **seu usuário e senha de sempre** | entrou e a tela abre igual à de hoje |
| 2 | Aba **Estoque** | os **180 pneus** estão lá, com preço e localização |
| 3 | Aba **Ordens de Serviço** → **+ Nova OS** → loja UNICAR, nome do cliente e um item com **Item do estoque** = um pneu (quantidade 1) → **Salvar OS** | aparece `OS-UNICAR-000001` |
| 4 | Abrir a OS → **↻ Mudar status** → **Em execução** | no histórico aparece *"Baixa de estoque: 1 un. — (pneu)"* |
| 5 | Voltar em **Estoque** e olhar o pneu escolhido | **1 unidade a menos** |
| 6 | **Movimentações** e **Auditoria** | a saída com **número da OS, loja e usuário**; o registro na auditoria |
| 7 | Editar a OS e **aumentar** para 3 → salvar | saiu **só a diferença** (2 un.), sem estorno estranho |
| 8 | Editar e **diminuir** para 1 → salvar | aparece **estorno** (entrada de 2 un.) |
| 9 | Criar outra OS com quantidade **maior que o estoque** → Em execução | **bloqueia** e lista o que está faltando |
| 10 | Aba **Usuários** → **+ Novo usuário** (gerente da FILIAL) e o botão **Bloquear** | cria, bloqueia e libera |
| 11 | Aba **Painel OS** | os números da loja, faturamento, serviços, pendentes |
| 12 | Aba **Bebidas**, **Garantias**, **Localização**, **Painel** | tudo igual a hoje |
| 13 | OS → **🖨 Imprimir** e **Exportar CSV** | folha pronta para impressão e planilha |
| 14 | Entrar como o gerente da FILIAL (noutro navegador/aba anônima) | ele vê **só** a OS da loja dele; Usuários e Auditoria nem aparecem |

**Para parar o teste:** clique na janela do 3002 e aperte **Ctrl+C**.

---

## 🟢 PASSO 7 — Rollback (voltar atrás)

**7.1 — Voltar do teste (porta 3002):** aperte `Ctrl+C` na janela do 3002. A versão antiga (3001) nunca
parou; nada mudou. Pode manter a pasta `unicar-lan-2.1.2` guardada.

**7.2 — Voltar depois de trocar para a 3001** (só se já estiver usando a versão nova valendo):

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
copy /Y unicar-lan-2.1.2\data.json unicar-lan\data.json
```
```
cd unicar-lan
```
```
set PORT=3001 && npm start
```

✅ De volta à versão antiga, com os dados mais recentes (o `copy` acima é o que devolve o dado).
**Planos B:** cada pasta guarda backups automáticos em `backups\data-AAAAMMDD-HHMMSS.json`, e você tem a
cópia do Passo 1.

---

## 🔴 PASSO 8 — Substituir a versão antiga (SÓ com autorização)

> Faça com a loja parada (uns 3 minutos, de preferência no fim do expediente).

1. **Avise** quem estiver usando.
2. Na janela do sistema antigo (3001): **Ctrl+C**.
3. Backup do dado "do momento":

```
cd /d "C:\Users\Cliente\Documents\Unicar"
```
```
copy unicar-lan\data.json BACKUPS_MANUAIS\data-antes-da-troca.json
```

4. Levar o dado vivo para a pasta nova:

```
copy /Y unicar-lan\data.json unicar-lan-2.1.2\data.json
```

5. **Migração** (cria as lojas/OS e liga cada usuário à sua loja) — **aguardando a sua autorização**:

```
cd /d "C:\Users\Cliente\Documents\Unicar\unicar-lan-2.1.2"
```
```
node migracoes\executar.js
```
Confira o que ele mostra (é simulação: **não grava nada**). Se estiver tudo certo:
```
node migracoes\executar.js --aplicar
```
✅ = "aplicada", e uma cópia prévia é guardada em `data.json.antes-migracao-...`.
Se algo der errado: `node migracoes\executar.js --reverter`

6. Subir a versão nova **na porta 3001**:

```
set PORT=3001 && npm start
```

7. **Validar de novo** (Passo 6, itens 1 a 6) — inclusive o login dos outros usuários, agora na loja deles.

8. 🛑 **Não apague e não mova a pasta antiga** `unicar-lan`: ela é o seu rollback. Só depois de alguns dias
   sem problema a gente conversa sobre o que fazer com ela.

---

## 🔧 Problemas comuns

- **`npm` não é reconhecido** → o Node.js não está no PATH; reinstale/repare o Node.
- **`EADDRINUSE` (porta ocupada)** → a 3001 é do sistema antigo; se acontecer no teste, use
  `set PORT=3003 && npm start`.
- **Página em branco** → confira o endereço exato: `http://localhost:3002` (sem IP, sem https).
- **Apareceu só o usuário `admin` padrão / estoque vazio** → faltou o Passo 5.1 (copiar o `data.json`).
- **Windows perguntar sobre o firewall** → permita em **rede privada** (o acesso pela LAN é assim hoje).
- **Outra máquina não abre** → liberar a porta (3001/3002) no firewall do Windows, como já é hoje na 3001.

---

## ✅ Resumo

- 🟢 A produção **não é tocada** em nenhum passo.
- 🟢 Há **backup** do dado antes (Passo 1) e **rollback** pronto (Passo 7).
- 🟢 O teste roda em **cópia**, na **porta 3002**.
- 🟡 A **migração** (Passo 8) e a **troca da 3001** ficam esperando a sua autorização — e são reversíveis.

Versão: **2.1.2** · Etiquetas de volta: `v2.1.0`, `v2.0.0`, `v1.1.0-final`, `v1.1.0`, `v1.0.0-recebido`
