# Versão 3.0.9 — subir planilha para atualizar os pneus

## O que entrou

1. **Importar planilha do Excel (.xlsx) de verdade.** Antes o botão aceitava o arquivo mas o sistema
   tentava ler como texto e dizia "não encontrei nenhuma linha de pneu". Agora ele lê a planilha
   coluna por coluna.
2. **Leitura por coluna** (o jeito certo): a primeira linha da planilha é o cabeçalho; o sistema
   entende os títulos `Medida`, `Marca`, `Quantidade`, `Preço`, e também `Status`, `Custo`,
   `Localização` e `Estoque mínimo`. Aceita acento, maiúscula e nomes parecidos (`Qtd`, `Qtde`,
   `Preço de venda`, `Valor`, `Custo`, `Local`, `Mínimo`).
3. **Modelo pronto para baixar:** na aba **Importar** tem o link *"Baixar o modelo da planilha"* —
   abre no Excel com as colunas certas e 3 linhas de exemplo (é só apagar e colocar as suas).
4. **CSV também passou a ser lido por coluna.** Se o arquivo tem cabeçalho, vale a mesma regra da
   planilha (antes o CSV caía no leitor de texto solto e trocava quantidade com preço).
5. **Recusas claras, sem erro feio:**
   - planilha do Excel antigo (.xls) → "Abra no Excel e use Salvar como → .xlsx (ou .csv)".
   - arquivo cortado/estragado → "Não consegui abrir a planilha. Salve de novo como .xlsx".
   - arquivo sem cabeçalho reconhecível → diz que não achou as colunas, não inventa pneu.
   - linha sem medida → vai para **"Precisam de revisão"**, não entra no estoque.
6. **Status:** se a planilha tiver a coluna `Status` (novo / usado / remoldado), ela manda. Se não
   tiver, entra como **NOVO** e a prévia avisa em cada linha.

## Como atualizar o estoque (passo a passo)

1. Abra a aba **Importar** e clique em **"Baixar o modelo da planilha"**.
2. Abra o arquivo no Excel, apague as 3 linhas de exemplo e preencha com os seus pneus.
   - Para **somar** ao estoque: coloque só o que chegou.
   - Para **corrigir** o estoque todo: escolha "Definir estoque (substituir)" na tela.
3. Salve como **.xlsx** (ou .csv).
4. Na tela: escolha a **loja**, escolha **Somar** ou **Definir**, selecione o arquivo e clique em
   **Ver prévia**.
5. Confira: **Criar** (pneus que não existiam), **Atualizar** (os que já existiam, com antes → depois)
   e **Revisar** (linhas que o sistema não entendeu).
6. Se estiver certo, clique em **Confirmar importação**. Nada é gravado antes disso.

Dica: o pneu é reconhecido pela **medida + marca + tipo** (novo/remoldado). Se a mesma medida e marca
aparecer duas vezes na planilha, as quantidades são somadas.

## Como instalar

1. Feche a janela do sistema (a que mostra `http://localhost:3000`).
2. Faça uma cópia do `data.json` para `backups\` (o sistema também faz backup automático ao subir).
3. Descompacte o `u309.zip` numa pasta nova (ex.: `unicar-lan-3.0.9`).
4. Copie o seu `data.json` para dentro dessa pasta nova.
5. Nessa pasta: `npm ci` (precisa de internet, só na primeira vez).
6. Teste: `set PORT=3004` e `npm start` → abra `http://localhost:3004`, entre, vá em **Importar** e
   suba uma planilha pequena de teste.
7. Se estiver tudo certo, feche a janela de teste e suba a 3.0.9 na porta normal (`set PORT=3001`).

## Como voltar atrás

A pasta antiga continua intacta: é só abrir a janela da versão anterior de novo. O `data.json` é
compatível nas duas (a importação por planilha não muda o formato do arquivo).

## Testes desta versão

- 11 testes novos só de planilha (leitura .xlsx, CSV com cabeçalho, soma de duplicados, .xls recusado,
  arquivo corrompido, planilha vazia, planilha sem cabeçalho, prévia criar/atualizar).
- Suíte completa rodada antes de publicar.
