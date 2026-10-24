# RESTAURAR — como voltar atrás (UNICAR)

Guia curto para desfazer qualquer mudança. **Nada aqui apaga a produção.**

## 0. Antes de tudo: onde está cada coisa

| O que | Onde |
|---|---|
| Sistema em uso (intocado) | `C:\Users\Cliente\Documents\Unicar\unicar-lan` |
| Cópia de desenvolvimento | `C:\Users\Cliente\Documents\Unicar\unicar-lan-dev` |
| Backups externos | `C:\Users\Cliente\Documents\Unicar\BACKUPS_HERMES` |
| Backups automáticos do próprio sistema | `unicar-lan\backups\` (de 6 em 6 horas) |

## 1. Voltar o código (git)

A cópia de desenvolvimento é um repositório git. O estado exato do sistema recebido está marcado com a etiqueta (tag):

```
cd /d "C:\Users\Cliente\Documents\Unicar\unicar-lan-dev"
git status                 :: mostra o que mudou
git diff                   :: mostra as mudanças linha por linha
git checkout -- .          :: desfaz TODAS as mudanças não salvas
git tag                    :: lista as etiquetas (v1.0.0-recebido = estado original)
git stash                  :: guarda mudanças de lado para voltar depois
```

Para voltar ao ponto exato do recebimento (código de hoje, sem perder o histórico):

```
git stash push -m "antes de voltar"
git checkout v1.0.0-recebido -- .
```

## 2. Voltar os dados (data.json)

O `data.json` **não** fica no git (é dado da loja, não código). Ele é protegido por três camadas:

1. `data.json.bak` — cópia automática do **último arquivo bom**, gravada antes de cada escrita (criada pelo próprio sistema).
2. `backups\data-AAAAMMDD-HHMMSS.json` — cópia automática de 6 em 6 horas (60 arquivos guardados).
3. `BACKUPS_HERMES\AAAAMMDD-HHMMSS\` — cópia validada, com `MANIFESTO.txt` contendo o sha256 de cada arquivo, **fora** da pasta do sistema.

Para voltar um dado específico: pare o sistema (`Ctrl+C` **na janela do CMD**), copie o arquivo desejado por cima do `data.json` e ligue de novo (`set PORT=3001 && npm start`).

> ⚠️ Só pare o sistema quando a loja não estiver lançando nada. Pare sempre pelo mesmo jeito: `Ctrl+C` na janela do CMD e depois `set PORT=3001 && npm start`.

## 3. Conferir se o backup está inteiro

```
cd /d "C:\Users\Cliente\Documents\Unicar\BACKUPS_HERMES\<pasta-do-backup>"
certutil -hashfile data.json SHA256
```
Compare com a linha do `data.json` no `MANIFESTO.txt`. Se baterem, o backup é fiel ao que existia naquele momento.

## 4. Voltar a versão publicada (depois do deploy)

Cada publicação deixa a imagem/versão anterior registrada. O procedimento para voltar a versão antiga fica no `ATUALIZAR_LOCAL.md` (seção "Voltar atrás"), com o comando exato de rollback.

## 5. O que NUNCA deve ser feito

- Não rode `git clean -fd` na pasta de desenvolvimento sem conferir antes com `git status` (isso apaga arquivos novos, inclusive `data.json`, que é ignorado pelo git).
- Não apague a pasta `BACKUPS_HERMES`.
- Não edite nada dentro de `unicar-lan` (produção) ao fazer manutenção — só copie de lá para trabalhar.
