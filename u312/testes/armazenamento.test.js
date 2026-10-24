// Testes da camada de armazenamento — os defeitos graves que estavam no sistema:
//  1. arquivo ilegivel NAO pode ser apagado/substituido por vazio
//  2. gravacao precisa ser atomica (nada de arquivo truncado)
//  3. erro numa gravacao nao pode travar a fila (sistema continuar sem salvar)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { novaPasta, configDeTeste, registroMudo } = require('./ajuda');
const { criarArmazenamento, estruturaVazia, ErroArmazenamento } = require('../armazenamento');

function montar(pasta, extras = {}) {
  const config = configDeTeste(pasta, extras);
  const armazenamento = criarArmazenamento({ config, registro: registroMudo });
  return { config, armazenamento };
}

test('primeira execucao cria o arquivo vazio e carrega o formato completo', () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  assert.ok(fs.existsSync(config.arquivoDados), 'o arquivo de dados deveria ter sido criado');
  const dados = armazenamento.carregar();
  for (const chave of ['pneus', 'movimentos', 'garantias', 'bebidas', 'bebidasMov', 'usuarios', 'sessoes', 'auditoria']) {
    assert.ok(Array.isArray(dados[chave]), `${chave} deveria ser uma lista`);
  }
});

test('gravacao grava de forma atomica: arquivo valido e sem .tmp para tras', () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  return armazenamento.comDados((dados) => {
    dados.pneus.push({ id: 'a', marca: 'Pirelli', medida: '175/65 R14', quantidade: 4 });
  }).then(() => {
    const lido = JSON.parse(fs.readFileSync(config.arquivoDados, 'utf-8'));
    assert.strictEqual(lido.pneus.length, 1);
    assert.ok(!fs.existsSync(`${config.arquivoDados}.tmp`), 'nao pode sobrar arquivo .tmp');
  });
});

test('a versao anterior fica guardada no .bak antes de cada gravacao', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  await armazenamento.comDados((d) => { d.pneus.push({ id: '1' }); });
  await armazenamento.comDados((d) => { d.pneus.push({ id: '2' }); });

  const atual = JSON.parse(fs.readFileSync(config.arquivoDados, 'utf-8'));
  const anterior = JSON.parse(fs.readFileSync(`${config.arquivoDados}.bak`, 'utf-8'));
  assert.strictEqual(atual.pneus.length, 2);
  assert.strictEqual(anterior.pneus.length, 1, 'o .bak deve ter a versao imediatamente anterior');
});

test('ARQUIVO ILEGIVEL NAO E APAGADO: usa o .bak e entra em modo seguro', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'a', marca: 'Goodyear' }); });
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'b', marca: 'Michelin' }); });

  // simula queda de energia no meio da gravacao: arquivo cortado
  const conteudoQuebrado = '{"pneus": [{"id": "a", "marca": "Goodye';
  fs.writeFileSync(config.arquivoDados, conteudoQuebrado);

  // sistema reinicia: mesma pasta, nova instancia
  const { armazenamento: novoSistema } = montar(pasta);
  const resultado = novoSistema.inicializar();

  assert.ok(resultado.modoSeguro, 'deveria entrar em modo seguro');
  assert.strictEqual(fs.readFileSync(config.arquivoDados, 'utf-8'), conteudoQuebrado,
    'o arquivo ilegivel NAO pode ser alterado (nada de substituir por vazio)');
  const dados = novoSistema.carregar();
  assert.strictEqual(dados.pneus.length, 1, 'deve ler a ultima copia boa (.bak)');
  assert.strictEqual(dados.pneus[0].marca, 'Goodyear');
});

test('em modo seguro a gravacao e RECUSADA (nada e sobrescrito)', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'a' }); });
  const quebrado = '{ isso nao e json';
  fs.writeFileSync(config.arquivoDados, quebrado);

  const { armazenamento: novoSistema } = montar(pasta);
  novoSistema.inicializar();
  await assert.rejects(
    () => novoSistema.comDados((d) => { d.pneus.push({ id: 'novo' }); }),
    (erro) => erro instanceof ErroArmazenamento && erro.codigo === 'MODO_SEGURO',
  );
  assert.strictEqual(fs.readFileSync(config.arquivoDados, 'utf-8'), quebrado,
    'o arquivo ilegivel continua intocado');
});

test('sem arquivo E sem .bak, o sistema recusa subir em vez de comecar vazio', () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  fs.writeFileSync(config.arquivoDados, '{ quebrado');
  // nao existe .bak (removido de proposito)
  try { fs.unlinkSync(`${config.arquivoDados}.bak`); } catch (e) { /* pode nao existir */ }

  const { armazenamento: novoSistema } = montar(pasta);
  assert.throws(() => novoSistema.inicializar(), (erro) => erro.codigo === 'DADOS_ILEGIVEIS');
  assert.strictEqual(fs.readFileSync(config.arquivoDados, 'utf-8'), '{ quebrado');
});

test('arquivo apagado durante o uso entra em modo seguro (nao recria vazio)', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'a', marca: 'Pirelli' }); });
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'b', marca: 'Michelin' }); });
  // nesse ponto: data.json tem 2 pneus e o .bak tem a versao anterior (1 pneu: 'a')
  fs.unlinkSync(config.arquivoDados);

  const dados = armazenamento.carregar();
  assert.strictEqual(dados.pneus.length, 1, 'deve continuar lendo a ultima copia boa (.bak)');
  assert.strictEqual(dados.pneus[0].id, 'a');
  assert.ok(armazenamento.emModoSeguro(), 'deve ficar em modo seguro');
  assert.ok(!fs.existsSync(config.arquivoDados), 'nao pode recriar o arquivo vazio por cima');
});

test('A FILA NAO ENVENENA: depois de um erro, as gravacoes seguintes continuam', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();

  await armazenamento.comDados((d) => { d.pneus.push({ id: 'antes' }); });

  // gravacao que estoura no meio (simula erro de logica/JSON dentro da mutacao)
  await assert.rejects(() => armazenamento.comDados(() => { throw new Error('erro proposital no meio da gravacao'); }));

  // o sistema nao pode ficar "na tela funcionando mas sem salvar"
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'depois' }); });
  const lido = JSON.parse(fs.readFileSync(config.arquivoDados, 'utf-8'));
  assert.strictEqual(lido.pneus.length, 2, 'a gravacao seguinte ao erro precisa ser salva');
  assert.deepStrictEqual(lido.pneus.map((p) => p.id), ['antes', 'depois']);
});

test('gravacoes simultaneas nao se perdem nem corrompem o arquivo', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta);
  armazenamento.inicializar();

  const tarefas = [];
  for (let i = 0; i < 20; i += 1) {
    tarefas.push(armazenamento.comDados((d) => { d.movimentos.push({ id: `m${i}` }); }));
  }
  await Promise.all(tarefas);

  const lido = JSON.parse(fs.readFileSync(config.arquivoDados, 'utf-8'));
  assert.strictEqual(lido.movimentos.length, 20, 'as 20 gravacoes precisam estar no arquivo');
});

test('backup: cria copia, respeita o limite de arquivos e nao sai da pasta', async () => {
  const pasta = novaPasta();
  const { config, armazenamento } = montar(pasta, { maxBackupArquivos: 3 });
  armazenamento.inicializar();
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'a' }); });

  for (let i = 0; i < 5; i += 1) {
    armazenamento.fazerBackup();
    await new Promise((r) => setTimeout(r, 1100)); // nome do backup tem resolucao de 1 segundo
  }
  const backups = armazenamento.listarBackups();
  assert.strictEqual(backups.length, 3, 'deve manter somente os 3 backups mais recentes');
  for (const b of backups) {
    assert.ok(fs.existsSync(path.join(config.pastaBackups, b.arquivo)), 'arquivo de backup precisa existir');
    const conteudo = JSON.parse(fs.readFileSync(path.join(config.pastaBackups, b.arquivo), 'utf-8'));
    assert.strictEqual(conteudo.pneus.length, 1, 'o backup precisa ter o dado de verdade');
  }

  // tentativa de escapar da pasta de backups
  assert.strictEqual(armazenamento.caminhoBackup('../../etc/passwd'), null);
  assert.strictEqual(armazenamento.caminhoBackup('nao-existe.json'), null);
});

test('estado() mostra o que o diagnostico precisa', async () => {
  const pasta = novaPasta();
  const { armazenamento } = montar(pasta);
  armazenamento.inicializar();
  await armazenamento.comDados((d) => { d.pneus.push({ id: 'a' }); });
  const estado = armazenamento.estado();
  assert.ok(estado.possuiArquivo);
  assert.ok(estado.tamanhoBytes > 0);
  assert.ok(estado.possuiBak);
  assert.strictEqual(estado.possuiTmp, false);
  assert.strictEqual(estado.modoSeguro, null);
  assert.strictEqual(estado.escritasOk, 1);
  assert.strictEqual(estado.escritasFalhas, 0);
});

test('garantirFormato completa arquivos antigos sem perder o que ja existe', () => {
  const antigo = { pneus: [{ id: 'a' }], usuarios: [{ id: 'u1' }] };
  const { garantirFormato } = require('../armazenamento');
  const completo = garantirFormato(antigo);
  assert.strictEqual(completo.pneus.length, 1);
  assert.strictEqual(completo.usuarios.length, 1);
  for (const chave of ['movimentos', 'garantias', 'bebidas', 'bebidasMov', 'sessoes', 'auditoria']) {
    assert.deepStrictEqual(completo[chave], []);
  }
  assert.deepStrictEqual(estruturaVazia().pneus, []);
});
