# Versão 3.0.11 — Cadastro de pneus (só para o administrador)

## O que entrou

Uma aba nova no sistema, **"Cadastro de pneus"**, que aparece **só para o administrador**:

1. **Adicionar pneu ao estoque** com marca e medida do jeito simples:
   - **Marca**: digita (ou clica num atalho: Pirelli, Goodyear, Michelin, Bridgestone, Goodmark…).
     O campo sugere os nomes das marcas mais usadas — não precisa acertar maiúscula.
   - **Medida**: pode digitar `1856515`, `185/65/15`, `185 65 15`, `185/65R15` ou clicar numa
     medida comum. O sistema mostra na hora o que vai salvar: **`185/65R15`**.
   - Aceita também `175/70R13 C`, `265/70R16 ATR`, `31x10.5R15` e caminhão `1000-20`.
   - Medida impossível (largura 999, aro 40, sem aro) é recusada **com o motivo escrito**.
2. **Quantidade na entrada**: já cadastra com o estoque inicial (botão − / + ao lado).
3. **Remover e adicionar quantidade** direto na lista:
   - Botão **+** (entrada) e **−** (saída) em cada pneu.
   - Pede a quantidade e o **motivo** (venda, OS, perda/avaria, devolução, ajuste de contagem,
     transferência) e aceita uma observação.
   - **Nunca deixa o estoque ficar negativo**: se pedir mais do que tem, aparece
     "Estoque insuficiente na loja X (tem 8, pediu 999)".
4. **Pneu repetido não vira duplicado**: se já existe a mesma marca + medida + tipo, o sistema
   oferece **somar ao existente** (mostra quantas unidades já tem).
5. **Lista profissional**: busca por marca/medida, quantidade por loja, custo, venda, aviso de
   **"baixo"** quando bate o estoque mínimo, e o total de unidades no pé da tabela.
6. Toda entrada e saída continua gravando **movimentação + auditoria** (igual ao resto do sistema).

## Como usar

1. Entre como **administrador**.
2. Na barra de abas, clique em **Cadastro de pneus** (é a última).
3. Preencha Marca e Medida (ou use os atalhos) → escolha **Novo/Remoldado** → quantidade →
   custo e venda → **Cadastrar pneu**.
4. Para mexer no estoque de um pneu que já existe, use **+** ou **−** na linha dele.

## Detalhes que valem saber

- O botão **"+ Novo pneu"** do topo continua existindo (é a janela antiga, mais completa, que
  também serve para operador). A aba nova é a via rápida do administrador.
- A aba **não aparece** para operador, mecânico ou gerente. O servidor também barra quem não é
  da loja.
- A quantidade é sempre da **loja escolhida** no campo "Loja" — o admin pode cadastrar na matriz
  e o estoque nasce naquela loja.

## Como instalar

1. Feche a janela do sistema.
2. Copie o `data.json` para `backups`.
3. Descompacte o `u311.zip` numa pasta nova e copie o seu `data.json` para dentro.
4. Nessa pasta: `npm ci`.
5. `npm start` (ou `set PORT=3001` antes, se for a porta oficial).

## Como voltar atrás

A pasta anterior continua intacta: é só abrir a janela dela de novo. Esta versão não muda o
formato do `data.json`.

## Testes

- 6 testes novos só da leitura de medida (formatos aceitos, sufixos C/ATR, polegada, caminhão,
  recusas e "normalizar duas vezes não muda nada").
- Fluxo conferido na tela: cadastrar, somar ao repetido, entrada, saída e bloqueio de estoque
  negativo.
