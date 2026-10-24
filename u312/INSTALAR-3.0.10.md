# Versão 3.0.10 — leitor de OCR incluído (PDF escaneado e foto)

## O que estava acontecendo

A mensagem *"O leitor de OCR não está instalado neste computador"* aparecia quando você mandava um
**PDF escaneado** (aquele que é só a foto da página, sem texto selecionável). O OCR é o leitor que
"olha" a imagem e transforma em texto — ele é opcional e não vinha junto com o sistema.

Nesta versão ele **vem junto**.

## O que entrou

1. **OCR incluído no pacote** (`tesseract.js`), instalado no `npm ci`. Sem instalar nada à parte.
2. **Aceita foto da lista** (.jpg/.png), além de PDF, Excel, CSV e TXT.
3. **Corrigi um defeito do PDF escaneado:** o leitor de OCR não abre PDF, só imagem. Agora o sistema
   **tira a foto de dentro do PDF** e entrega essa imagem ao OCR.
4. **Corrigi a quantidade na leitura por OCR:** linha como `175/70 R13 PIRELLI NOVO 8 R$ 289,90`
   agora entra com **quantidade 8** (antes entrava 1).
5. **Um erro do OCR não derruba mais o sistema.** Antes, se o OCR falhasse, o processo podia cair.

## Como instalar

1. Feche a janela do sistema.
2. Guarde uma cópia do seu `data.json` na pasta `backups`.
3. Descompacte o `u310.zip` numa pasta nova (ex.: `unicar-lan-3.0.10`).
4. Copie o seu `data.json` para dentro da pasta nova.
5. Na pasta nova: `npm ci` — agora ele instala o OCR também (demora um pouco mais).
6. Abra com `npm start` (ou `set PORT=3001` antes, se for a porta oficial).
7. Teste: **Importar** → mande um PDF escaneado ou uma foto. A prévia mostra a confiança da leitura.

## Importante sobre o OCR

- **Na primeira vez ele precisa de internet**: baixa o idioma português (~10 MB) e guarda no
  computador. Depois disso funciona sem internet.
- É leitura por imagem: sempre **confira a prévia** antes de confirmar. Confiança abaixo de 80% vem
  com aviso em vermelho.
- Funciona melhor com a foto **reta, bem iluminada e sem sombra**. Foto torta ou escura erra número.
- Se mesmo assim não ler: o caminho mais confiável continua sendo a **planilha (.xlsx/.csv)** — ela não
  depende de OCR.

## Como voltar atrás

A pasta da versão anterior continua igual. Só abrir a janela dela de novo. O `data.json` é o mesmo.

## Testes

- 14 testes só de leitura de arquivo (planilha, PDF escaneado, imagem dentro do PDF, quantidade).
- Suíte completa rodada antes de publicar.
