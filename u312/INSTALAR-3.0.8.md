# Instalar a versão 3.0.8 no PC da loja

Duas mudanças, só isso:

1. **Som automático** — o alarme de chamado e o aviso de mensagem nova agora tocam **sem precisar
   clicar em "Ativar sons"**. O navegador libera o áudio no primeiro clique/toque em qualquer lugar
   da tela; a partir daí o som funciona o dia inteiro (fica guardado no navegador).
2. **Chat sem erro** — a mensagem do chat não se perde mais quando o envio falha: o texto fica no
   campo, aparece o motivo em português e você tenta de novo. Também corrigimos três casos: conversa
   que não existe mais (avisa para atualizar), pessoa fora da conversa (diz qual é o motivo) e arquivo
   travado na hora de gravar (avisa para tentar em 2 segundos, sem perder a mensagem).

Nada de dado é apagado. Nada muda em estoque, OS, lojas ou senhas.

## Antes de começar (2 minutos)

1. Abra a pasta do sistema: `C:\Users\Cliente\Documents\Unicar`.
2. Copie **só o `data.json`** de `unicar-lan` para `C:\Users\Cliente\Documents\Unicar\BACKUPS_HERMES\antes-3.0.8`.
   (É a sua cópia de segurança. Não copie a pasta inteira: ela tem o npm dentro e o Windows reclama de memória.)

## Instalar (ao lado, sem tocar no que está rodando)

3. Descompacte o `u308.zip` em `unicar-lan-3.0.8`.
4. Copie o `data.json` da pasta antiga para dentro de `unicar-lan-3.0.8`.
5. Abra a pasta `unicar-lan-3.0.8`, clique na barra de endereço, digite `cmd` e tecle Enter.
6. Digite `npm ci` (precisa de internet; leva ~1 min).
7. Teste antes de publicar: `set PORT=3004` e depois `npm start`. Abra `http://localhost:3004`.
8. Confira as duas coisas novas:
   - clique em qualquer lugar da tela → o rodapé do chat mostra **🔊 Som ligado**;
   - mande uma mensagem no chat: ela aparece e o campo é limpo só depois de enviar.
9. Se estiver tudo certo, feche a janela antiga e publique: `set PORT=3001` e `npm start` **na pasta 3.0.8**.

## Voltar atrás

Feche a janela da 3.0.8, abra a pasta `unicar-lan` (a antiga) e rode `npm start` com `PORT=3001`.
Se precisar recuperar o dado: copie o `data.json` de `BACKUPS_HERMES\antes-3.0.8` para a pasta que
vai rodar, por cima, com o sistema fechado.

## O que foi testado aqui

- **175 testes automáticos** passando (eram 171; 4 novos só do chat e do som).
- Envio real no chat pelos 4 perfis (admin, gerente, operador, mecânico) na cópia de teste.
- Conversa inexistente → aviso "Essa conversa não existe mais"; pessoa de fora → "Você não participa
  desta conversa"; texto vazio → não envia.
- Som: um clique em qualquer lugar já libera o áudio (conferido no navegador, sem usar o botão).
