// Testes do servidor de ponta a ponta: sobe o sistema de verdade (em outra porta,
// com arquivo de dados proprio em pasta temporaria) e conversa por HTTP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { novaPasta, subirServidor, pedir, entrar, esperar } = require('./ajuda');

const PORTA = 4100 + crypto.randomInt(0, 400); // porta alta e aleatoria: nunca a 3001 da loja

test('servidor: login, cadastro, persistencia, diagnostico e tratamento de erro', async (t) => {
  const pasta = novaPasta();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  await t.test('/health responde sem login e sem revelar caminho de arquivo', async () => {
    const r = await pedir(base, '/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.ok, true);
    assert.strictEqual(typeof r.corpo.versao, 'string');
    assert.ok(!JSON.stringify(r.corpo).includes('dados.json'), 'nao pode expor caminho de arquivo');
  });

  await t.test('a tela principal manda para o login quando nao ha sessao', async () => {
    const r = await pedir(base, '/');
    assert.strictEqual(r.status, 302);
    assert.ok((r.cabecalhos.get('location') || '').includes('login.html'));
  });

  await t.test('a API exige login e o arquivo de dados nao e publico', async () => {
    assert.strictEqual((await pedir(base, '/api/state')).status, 401);
    assert.strictEqual((await pedir(base, '/api/diagnostico')).status, 401);
    assert.strictEqual((await pedir(base, '/data.json')).status, 404);
    assert.strictEqual((await pedir(base, '/backups/qualquer.json')).status, 404);
  });

  let cookie = '';
  await t.test('login com o admin padrao criado na primeira execucao', async () => {
    const r = await entrar(base, 'admin', 'unicar123');
    assert.strictEqual(r.status, 200);
    assert.ok(r.cookie.startsWith('unicar_sessao='), 'deveria devolver o cookie de sessao');
    cookie = r.cookie;
  });

  await t.test('estado do sistema responde com a sessao', async () => {
    const r = await pedir(base, '/api/state', { cabecalhos: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.corpo.pneus));
  });

  let pneuId = '';
  await t.test('cadastrar pneu grava de verdade no arquivo de dados', async () => {
    const r = await pedir(base, '/api/pneus', {
      metodo: 'POST',
      cabecalhos: { cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({ marca: 'Pirelli', medida: '175/65 R14', quantidade: 4, precoCusto: 120, precoVenda: 210 }),
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.marca, 'Pirelli');
    assert.ok(!('precoCusto' in r.corpo), 'o valor de compra nao pode ir para a tela');
    pneuId = r.corpo.id;

    const noDisco = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    assert.strictEqual(noDisco.pneus.length, 1, 'o pneu precisa estar no arquivo');
    assert.strictEqual(noDisco.pneus[0].marca, 'Pirelli');
    assert.ok(noDisco.pneus[0].precoCusto === 120, 'o valor de compra fica no arquivo (so nao vai para a tela)');
    assert.ok(noDisco.auditoria.length >= 1, 'a acao precisa entrar na auditoria');
  });

  await t.test('/api/diagnostico mostra o estado do armazenamento', async () => {
    const r = await pedir(base, '/api/diagnostico', { cabecalhos: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.ok, true);
    assert.strictEqual(r.corpo.dados.modoSeguro, null);
    assert.ok(r.corpo.dados.escritasOk >= 1);
    assert.strictEqual(r.corpo.limites.movimentos, 500);
    assert.strictEqual(r.corpo.dados.possuiBak, true);
  });

  await t.test('rota de API inexistente responde em JSON', async () => {
    const r = await pedir(base, '/api/rota-inexistente', { cabecalhos: { cookie } });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.corpo.error, 'Rota não encontrada.');
  });

  await t.test('pedido malformado da erro tratado e o sistema continua de pe', async () => {
    const ruim = await pedir(base, '/api/pneus', {
      metodo: 'POST',
      cabecalhos: { cookie, 'content-type': 'application/json' },
      corpo: '{"marca": "quebrado"',
    });
    assert.ok(ruim.status >= 400 && ruim.status < 500, `esperado 4xx, veio ${ruim.status}`);
    assert.strictEqual((await pedir(base, '/health')).status, 200);
  });

  await t.test('FALHA DE GRAVACAO: responde erro tratado, o sistema segue de pe e volta a salvar', async () => {
    // pasta somente leitura: a gravacao atomica falha (nao da para criar o .tmp)
    fs.chmodSync(pasta, 0o555);
    try {
      const falha = await pedir(base, '/api/pneus', {
        metodo: 'POST',
        cabecalhos: { cookie, 'content-type': 'application/json' },
        corpo: JSON.stringify({ marca: 'Falha', medida: '000/00 R00' }),
      });
      assert.strictEqual(falha.status, 500, 'a gravacao que falha precisa virar erro tratado');
      assert.ok(falha.corpo.id, 'a resposta precisa trazer o codigo do erro para achar no log');
      assert.ok(!/EACCES|ENOENT|\/tmp\/|dados\.json/.test(JSON.stringify(falha.corpo)),
        `a resposta nao pode vazar detalhe interno: ${JSON.stringify(falha.corpo)}`);

      // o sistema continua respondendo depois do erro
      assert.strictEqual((await pedir(base, '/health')).status, 200);
      const diag = await pedir(base, '/api/diagnostico', { cabecalhos: { cookie } });
      assert.strictEqual(diag.status, 200);
      assert.ok(diag.corpo.erros.total >= 1, 'o erro precisa estar contado no diagnostico');
      assert.ok(diag.corpo.dados.escritasFalhas >= 1);
      assert.ok(diag.corpo.erros.ultimo, 'o diagnostico precisa guardar a ultima mensagem de erro');
    } finally {
      // devolve a permissao mesmo se alguma verificacao falhar
      fs.chmodSync(pasta, 0o755);
    }

    // confirma que a fila voltou a salvar (nao ficou envenenada)
    const ok = await pedir(base, '/api/pneus', {
      metodo: 'POST',
      cabecalhos: { cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({ marca: 'Depois do erro', medida: '185/65 R15', quantidade: 2 }),
    });
    assert.strictEqual(ok.status, 200, 'depois do erro, gravar uma vez mais precisa funcionar');

    const noDisco = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    assert.ok(noDisco.pneus.some((p) => p.marca === 'Depois do erro'), 'o dado novo precisa estar no arquivo');
    assert.ok(!noDisco.pneus.some((p) => p.marca === 'Falha'), 'o cadastro que falhou nao pode aparecer');
  });

  await t.test('excluir pneu funciona e fica na auditoria', async () => {
    const antes = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8')).auditoria.length;
    const r = await pedir(base, `/api/pneus/${pneuId}`, { metodo: 'DELETE', cabecalhos: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.ok, true);
    const depois = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    assert.ok(!depois.pneus.some((p) => p.id === pneuId), 'o pneu precisa sair do arquivo');
    assert.ok(depois.auditoria.length > antes, 'a exclusao precisa entrar na auditoria');
  });

  await t.test('backup manual responde e cria arquivo na pasta de backups', async () => {
    const r = await pedir(base, '/api/backups', { metodo: 'POST', cabecalhos: { cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.corpo.arquivo.endsWith('.json'));
    assert.ok(fs.existsSync(path.join(pasta, 'backups', r.corpo.arquivo)));
    const lista = await pedir(base, '/api/backups', { cabecalhos: { cookie } });
    assert.strictEqual(lista.status, 200);
    assert.ok(Array.isArray(lista.corpo) && lista.corpo.length >= 1);
  });

  await t.test('encerrar com Ctrl+C grava e sai limpo (sem perder dado)', async () => {
    await servidor.encerrar();
    assert.notStrictEqual(servidor.filho.exitCode, null, 'o processo precisa ter encerrado');
    const noDisco = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    assert.ok(!fs.existsSync(path.join(pasta, 'dados.json.tmp')), 'nao pode sobrar .tmp depois de encerrar');
    assert.ok(Array.isArray(noDisco.pneus), 'o arquivo precisa continuar valido depois de encerrar');
  });
});

test('servidor NAO sobe quando o arquivo de dados esta ilegivel e sem .bak', async () => {
  const pasta = novaPasta();
  fs.writeFileSync(path.join(pasta, 'dados.json'), '{ isso nao e json valido');
  const porta = 4600 + crypto.randomInt(0, 200);

  const { spawn } = require('child_process');
  const caminhoServidor = path.join(__dirname, '..', 'server.js');
  const filho = spawn(process.execPath, [caminhoServidor], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(porta),
      HOST: '127.0.0.1',
      ARQUIVO_DADOS: path.join(pasta, 'dados.json'),
      PASTA_BACKUPS: path.join(pasta, 'backups'),
      PASTA_LOGS: path.join(pasta, 'logs'),
      NIVEL_LOG: 'silencio',
    },
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d.toString(); });
  filho.stderr.on('data', (d) => { saida += d.toString(); });

  const fim = Date.now() + 10000;
  while (filho.exitCode === null && Date.now() < fim) await esperar(100);
  assert.strictEqual(filho.exitCode, 1, `o sistema deveria sair com codigo 1. Saida:\n${saida}`);
  assert.match(saida, /NAO SUBIU|NÃO SUBIU/, 'a mensagem precisa avisar que o sistema nao subiu');
  assert.strictEqual(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'), '{ isso nao e json valido',
    'o arquivo ilegivel precisa continuar intocado');
});
