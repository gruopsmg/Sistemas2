// Testes da interface: provam que a tela atual foi PRESERVADA.
//
// A ideia é comparar o index.html original (recebido) com o de agora, linha por linha:
//  - o bloco de cores (identidade visual) tem de ser idêntico;
//  - todos os elementos originais (marca, menu, abas, botões, telas) têm de continuar lá;
//  - as ÚNICAS linhas que podem ter saído são as 6 mudanças necessárias, listadas abaixo,
//    todas relacionadas ao cadastro de usuários (ganhou loja) e à inclusão dos novos itens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ATUAL = path.join(__dirname, '..', 'public', 'index.html');
const ORIGINAL = process.env.UNICAR_INTERFACE_ORIGINAL
  || path.join(__dirname, '..', '..', 'app-unicar', 'public', 'index.html');

const ler = (p) => fs.readFileSync(p, 'utf-8');
const linhas = (texto) => texto.split(/\r?\n/);

// Linhas do arquivo original que PODEM ter sido substituídas (todas explicadas e mínimas)
const MUDANCAS_ESPERADAS = [
  '</style>',
  '</body>',
  '<option value="operador">Operador</option>',                       // virou "Operador/Atendente"
  "const PERFIL_LABEL = { admin: 'Administrador', operador: 'Operador' };", // ganhou gerente e mecânico
  '<thead><tr><th>Nome</th><th>Usuário de acesso</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>', // ganhou coluna Loja
  "const corpo = { nome, perfil, ativo: document.getElementById('uAtivo').value === 'sim' };", // ganhou loja
  "await api('POST', '/api/usuarios', { nome, usuario: login, senha, perfil });",             // ganhou loja
  // ganhou os rótulos das ações novas (mudar status, cancelar, baixar/estornar estoque)
  "const ACAO_LABEL = { criar: 'Criou', editar: 'Editou', excluir: 'Excluiu', entrada: 'Entrada de', saida: 'Saída de', consultar: 'Consultou' };",
  // troca de marca UNICAR -> SMG GROUP: título da aba, rodapé e o texto alternativo da logo
  // (as linhas originais são conferidas pelos prefixos em MUDANCAS_ESPERADAS_PREFIXOS,
  //  porque a linha do <img> carrega a logo inteira em base64)
].map((l) => l.trim());

// Linhas originais que podem ter mudado (prefixo basta). Hoje: nenhuma — a marca do sistema
// voltou a ser UNICAR por pedido do dono; o SMG ficou só na tela de login.
const MUDANCAS_ESPERADAS_PREFIXOS = [];

test('a identidade visual (bloco de cores) está intacta', () => {
  const bloco = (texto) => {
    const inicio = texto.indexOf(':root {');
    const fim = texto.indexOf('}', inicio);
    return texto.slice(inicio, fim);
  };
  const coresAtual = bloco(ler(ATUAL));
  const coresOriginal = bloco(ler(ORIGINAL));
  assert.ok(coresOriginal.length > 100, 'o bloco de cores do original precisa ser encontrado');
  assert.strictEqual(coresAtual, coresOriginal, 'nenhuma cor pode ter mudado');

  // as cores principais, uma por uma (o que dá a cara do sistema)
  for (const cor of ['--accent: #e2231a', '--yellow: #ffd400', '--bg: #1b1c1f', '--good: #3ecf7e', '--bad: #ff5252']) {
    assert.ok(coresAtual.includes(cor), `a cor ${cor} precisa continuar igual`);
  }
});

test('todos os elementos originais da tela continuam lá', () => {
  const atual = ler(ATUAL);
  const original = ler(ORIGINAL);

  // menu original completo
  for (const aba of ['dashboard', 'estoque', 'localizacao', 'movimentos', 'garantias', 'bebidas', 'usuarios', 'auditoria']) {
    assert.ok(atual.includes(`data-view="${aba}"`), `a aba "${aba}" precisa continuar no menu`);
    assert.ok(atual.includes(`id="view-${aba}"`), `a tela "view-${aba}" precisa continuar existindo`);
  }

  // marca e cabeçalho
  // A marca do topo continua no HTML (o nome do grupo é trocado por JS, em /smg.js) e o
  // subtítulo original segue como reserva caso o JS não rode.
  assert.ok(atual.includes('<h1>UNI<span class="hl">CAR</span></h1>'), 'a marca original precisa continuar no HTML');
  assert.ok(atual.includes('São Pedro da Aldeia · Estoque de pneus'), 'o subtítulo do cabeçalho precisa continuar');
  assert.ok(atual.includes('class="brand-mark"'), 'o logo precisa continuar');

  // botões do topo
  for (const id of ['btnTema', 'btnMinhaSenha', 'btnSair', 'btnNovoPneu', 'connDot', 'userPill']) {
    assert.ok(atual.includes(`id="${id}"`), `o botão/elemento ${id} precisa continuar`);
  }

  // telas antigas e seus componentes
  for (const id of ['dashCards', 'alertList', 'searchInput', 'filterChips', 'usuarioTableBody', 'gFilterChips', 'bebidaTable']) {
    assert.ok(atual.includes(`id="${id}"`), `o componente ${id} precisa continuar`);
  }
  for (const classe of ['class="tabs"', 'class="panel"', 'class="stat-card"', 'class="filter-chip', 'class="table-wrap"', 'class="modal-overlay"', 'class="toast"', 'class="btn-primary"', 'class="btn-ghost']) {
    assert.ok(atual.includes(classe), `o estilo ${classe} precisa continuar em uso`);
  }

  // rotas antigas que a tela usa
  for (const rota of ['/api/pneus', '/api/movimentos', '/api/garantias', '/api/bebidas', '/api/usuarios', '/api/auditoria', '/api/backups', '/api/eu', '/api/minha-senha', '/api/logout']) {
    assert.ok(atual.includes(rota), `a tela precisa continuar usando ${rota}`);
  }

  // o sistema antigo de abas continua funcionando do mesmo jeito
  assert.ok(atual.includes("document.querySelectorAll('.tab').forEach"), 'a troca de abas original precisa continuar');
  assert.ok(atual.includes("document.getElementById('view-' + btn.dataset.view).classList.add('active')"), 'a troca de telas original precisa continuar');
  assert.ok(atual.includes("const socket = io();"), 'o tempo real precisa continuar');

  assert.ok(atual.length > original.length, 'o arquivo novo precisa ser MAIOR (só acrescentamos)');
});

test('as abas e telas novas foram acrescentadas no mesmo padrão', () => {
  const atual = ler(ATUAL);
  assert.ok(atual.includes('data-view="os"'), 'a aba de Ordens de Serviço precisa existir');
  assert.ok(atual.includes('data-view="painel-os"'), 'a aba do painel das lojas precisa existir');
  assert.ok(atual.includes('id="view-os"'), 'a tela da OS precisa existir');
  assert.ok(atual.includes('id="view-painel-os"'), 'a tela do painel precisa existir');
  assert.ok(atual.includes('<script src="/os.js"></script>'), 'o script das telas novas precisa ser carregado');
  assert.ok(atual.includes('id="uLoja"'), 'o cadastro de usuário precisa do campo Loja');

  // contagem: exatamente 2 abas e 2 telas novas (nenhuma a mais, nenhuma a menos)
  const contar = (texto, regex) => (texto.match(regex) || []).length;
  // abas novas: 2 da OS + estoque por loja, importar, chat e configurações
  assert.ok(atual.includes('data-view="estoque-lojas"') && atual.includes('data-view="importar"')
    && atual.includes('data-view="chat"') && atual.includes('data-view="config"'), 'abas novas do estoque/importação/chat/config');
  assert.ok(atual.includes('<script src="/smg.js"></script>'), 'o script das telas novas precisa ser carregado');
  // + a aba/tela de Clientes (base única do grupo, pedido de 21/10)
  assert.ok(atual.includes('data-view="clientes"'), 'a aba de Clientes precisa existir');
  assert.ok(atual.includes('id="view-clientes"'), 'a tela de Clientes precisa existir');
  assert.ok(atual.includes('<script src="/clientes.js"></script>'), 'o script de Clientes precisa ser carregado');
  assert.strictEqual(contar(atual, /class="tab[" ]/g) - contar(ler(ORIGINAL), /class="tab[" ]/g), 7, 'exatamente 7 abas novas');
  assert.strictEqual(contar(atual, /class="view[" ]/g) - contar(ler(ORIGINAL), /class="view[" ]/g), 7, 'exatamente 7 telas novas');
});

test('NADA FOI REMOVIDO: só saíram as linhas que eu documentei', () => {
  const antes = linhas(ler(ORIGINAL)).map((l) => l.trim()).filter(Boolean);
  const agora = linhas(ler(ATUAL)).map((l) => l.trim()).filter(Boolean);

  // multiconjunto do arquivo novo, para não confundir repetição
  const contagemAgora = new Map();
  for (const l of agora) contagemAgora.set(l, (contagemAgora.get(l) || 0) + 1);

  const removidas = [];
  for (const l of antes) {
    const quantas = contagemAgora.get(l) || 0;
    if (quantas > 0) contagemAgora.set(l, quantas - 1);
    else removidas.push(l);
  }

  const explicadaPorPrefixo = (l) => MUDANCAS_ESPERADAS_PREFIXOS.some((p) => l.startsWith(p));
  const naoExplicadas = removidas.filter((l) => !MUDANCAS_ESPERADAS.includes(l) && !explicadaPorPrefixo(l));
  assert.deepStrictEqual(naoExplicadas, [],
    `estas linhas sumiram e não estavam previstas:\n${naoExplicadas.join('\n')}`);
  assert.ok(removidas.length <= MUDANCAS_ESPERADAS.length + MUDANCAS_ESPERADAS_PREFIXOS.length,
    `saíram ${removidas.length} linhas, o esperado era no máximo ${MUDANCAS_ESPERADAS.length + MUDANCAS_ESPERADAS_PREFIXOS.length}`);

  // e o arquivo cresceu (acrescentamos muito mais do que trocamos)
  const acrescentadas = agora.length - antes.length + removidas.length;
  assert.ok(acrescentadas > 20, `o esperado eram várias linhas novas (vieram ${acrescentadas})`);
});

test('o arquivo de telas novas (os.js) é válido e usa o mesmo visual do sistema', () => {
  const fonte = ler(path.join(__dirname, '..', 'public', 'os.js'));
  // sintaxe: o arquivo é um módulo isolado, então dá para conferir com o próprio Node
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'public', 'os.js')]);

  // reusa as classes e componentes do sistema (nada de estilo novo inventado)
  for (const classe of ['panel', 'panel-header', 'stat-card', 'filter-chip', 'badge', 'btn-primary', 'btn-ghost', 'btn-danger-ghost', 'table-wrap', 'empty-state', 'toolbar', 'search-input', 'modal-overlay', 'field-row']) {
    assert.ok(fonte.includes(classe), `os.js precisa reusar a classe ${classe}`);
  }
  assert.ok(fonte.includes("getElementById('toast')"), 'os.js precisa usar o mesmo aviso (toast) do sistema');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(fonte.replace(/var\(--[a-z-]+\)/g, '')), 'os.js não pode inventar cores próprias');

  // nenhuma cor nova no HTML além das variáveis já existentes
  const html = ler(ATUAL);
  const trechoOS = html.slice(html.indexOf('Ordens de Serviço — mesmas cores'), html.indexOf('</style>'));
  assert.ok(!/#[0-9a-fA-F]{6}/.test(trechoOS.replace(/rgba?\([^)]*\)/g, '')), 'o CSS novo das OS não pode trazer cores fixas');
  assert.ok(trechoOS.includes('var(--accent-soft)') && trechoOS.includes('var(--good-soft)'), 'o CSS das OS precisa usar as variáveis de cor do tema');
});

// A baixa automática depende de o formulário devolver o MESMO id do item. Sem isso, cada edição
// na tela vira "removeu o item + criou de novo" e o estorno deixa rastro que não deveria existir.
test('o formulário da OS devolve o id do item (baixa só da diferença na edição)', () => {
  const fonte = ler(path.join(__dirname, '..', 'public', 'os.js'));
  assert.match(fonte, /<tr data-os-item data-item-id="\$\{item\.id/, 'a linha do item precisa guardar o id');
  assert.match(fonte, /id: linha\.dataset\.itemId/, 'ao salvar, o id do item precisa voltar igual');
});
