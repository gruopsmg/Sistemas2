# 3.0.12 — subir o estoque da planilha em cada loja

## Antes de tudo
As quantidades vieram da **coluna "RESTOU"** da sua planilha — o que você disse que não está
100% atualizado. Elas servem como ponto de partida; depois vocês ajustam pela aba
**Cadastro de pneus** (botão + e −) ou pela **Importar** de novo.

## Os 3 arquivos (um por loja)
- `estoque-matriz.xlsx` — 39 itens · **144 unidades**
- `estoque-filial.xlsx` — 16 itens · **43 unidades**
- `estoque-unicar.xlsx` — 152 itens · **627 unidades**

> O rodapé da sua planilha dizia **630** na UNICAR. Somando linha por linha deu **627**.
> São 3 unidades de diferença para você conferir depois — provavelmente uma linha digitada
> no meio da contagem. Nada impede o import: é só ajustar na tela.

## Como importar (em cada loja)
1. Instale/abra a versão **3.0.12**.
2. Aba **Importar** → arquivo: escolha o `.xlsx` da loja.
3. **Loja de destino**: escolha a loja daquele arquivo (MATRIZ, FILIAL ou UNICAR).
4. **O que fazer**: `Somar ao estoque (entrada)`.
5. Clique em **Ver prévia**. Deve aparecer:
   - MATRIZ: **39** para criar, **0** para revisar
   - FILIAL: **16** para criar, **0** para revisar
   - UNICAR: **152** para criar, **0** para revisar
6. Confira as primeiras linhas (medida, marca, quantidade, preço) e clique em **Confirmar importação**.

Repita para as outras duas lojas (arquivo diferente, loja diferente).

## O que já vem certo nos arquivos
- **Medida no padrão do sistema**: `165/70/13` virou `165/70R13`; `205/65/15 ATR` virou
  `205/65R15 ATR`; `185R14 C` continua `185R14 C`; moto `5.60.15` virou `5.60-15`.
- **Marca sem o "(NOVO)"**: quem estava escrito **(NOVO)** entrou como **Novo**; o resto entrou como
  **Remoldado** (a regra da casa). Se algum estiver errado, é só editar o pneu.
- **Preço** na coluna de venda. O **custo** ficou vazio (a planilha só tinha custo em 3 linhas).
- **Item com 0 unidade ficou de fora** — o sistema não cria pneu com estoque zero. Quando chegar
  mercadoria, cadastre pela aba **Cadastro de pneus**.

## Versão 3.0.12 (o que mudou)
A importação passou a aceitar medidas que antes iam para a revisão:
`185R14` (sem perfil) e as de moto `5.60-15` / `2.75-18`. Sem isso, 4 itens da sua planilha
não entravam.

## Se algo vier na revisão
A tela mostra linha por linha o motivo. Não confirme nada com revisão sem olhar — é ali que o
sistema avisa o que não entendeu.
