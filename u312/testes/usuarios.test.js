// Testes da GESTÃO DE USUÁRIOS pela tela de administração:
// criar, editar (perfil/loja/nome/senha), bloquear, liberar e excluir — sempre sem perder histórico.
//
// Rodam sobre uma CÓPIA do data.json real (com a migração aplicada), numa pasta temporária.
// O arquivo original NUNCA é tocado; a senha de teste entra apenas na cópia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { novaPasta, subirServidor, pedir, entrar } = require('./ajuda');
const migracao = require('../migracoes/001_lojas_os');

const REFERENCIA = process.env.UNICAR_DADOS_REFERENCIA
  || path.join(__dirname, '..', '..', 'app-unicar', 'data.json');

function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(senha), salt, 64).toString('hex')}`;
}

function prepararPasta({ senhaAdmin = 'teste123' } = {}) {
  const pasta = novaPasta('unicar-usuarios-');
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  migracao.aplicar(dados);
  const admin = dados.usuarios.find((u) => u.perfil === 'admin');
  admin.senhaHash = gerarHashSenha(senhaAdmin);
  admin.precisaTrocarSenha = false;
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return { pasta, dados };
}

const comJson = (cookie) => ({ 'content-type': 'application/json', cookie });
const enviar = (base, caminho, corpo, cookie, metodo = 'POST') =>
  pedir(base, caminho, { metodo, corpo: JSON.stringify(corpo), cabecalhos: comJson(cookie) });
const lerDados = (pasta) => JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));

const PORTA = 5600 + crypto.randomInt(0, 200);

test('usuários: admin cria, edita, bloqueia, libera e troca senha (com auditoria)', async (t) => {
  const { pasta } = prepararPasta();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  const admin = await entrar(base, 'admin', 'teste123');
  assert.strictEqual(admin.status, 200, 'o admin do arquivo real precisa entrar');

  await t.test('quem não é administrador não vê nem cria usuários', async () => {
    const joao = await entrar(base, 'joao', 'joao123'); // na cópia do real, o João tem senha própria
    const senhaOk = joao.status === 200;
    if (!senhaOk) {
      // a senha real do João não é conhecida: o teste cria um operador para conferir o bloqueio
      const criado = await enviar(base, '/api/usuarios', { nome: 'Operador Teste', usuario: 'op.teste', senha: 'op12345', perfil: 'operador', loja: 'UNICAR' }, admin.cookie);
      assert.strictEqual(criado.status, 200);
      const op = await entrar(base, 'op.teste', 'op12345');
      const lista = await pedir(base, '/api/usuarios', { cabecalhos: { cookie: op.cookie } });
      assert.strictEqual(lista.status, 403, 'operador não lista usuários');
      const cria = await enviar(base, '/api/usuarios', { nome: 'X', usuario: 'x.teste', senha: 'x12345', perfil: 'operador', loja: 'UNICAR' }, op.cookie);
      assert.strictEqual(cria.status, 403, 'operador não cria usuários');
      return;
    }
    const lista = await pedir(base, '/api/usuarios', { cabecalhos: { cookie: joao.cookie } });
    assert.strictEqual(lista.status, 403, 'operador não lista usuários');
  });

  let gerenteId = null;
  await t.test('cria gerente da FILIAL (e o login dele já entra na loja certa)', async () => {
    const r = await enviar(base, '/api/usuarios', { nome: 'Gerente Filial', usuario: 'ger.filial', senha: 'ger12345', perfil: 'gerente', loja: 'FILIAL' }, admin.cookie);
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    gerenteId = r.corpo.id;
    assert.strictEqual(r.corpo.loja, 'FILIAL');
    assert.strictEqual(r.corpo.perfil, 'gerente');
    assert.ok(!('senhaHash' in r.corpo), 'a API nunca devolve a senha');

    const login = await entrar(base, 'ger.filial', 'ger12345');
    assert.strictEqual(login.status, 200);
    const eu = await pedir(base, '/api/eu', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(eu.corpo.usuario.loja, 'FILIAL', 'a loja vem do servidor no login');
  });

  await t.test('recusa criação sem loja, com login repetido ou senha curta', async () => {
    const semLoja = await enviar(base, '/api/usuarios', { nome: 'Sem Loja', usuario: 'sem.loja', senha: 'abc12345', perfil: 'operador' }, admin.cookie);
    assert.strictEqual(semLoja.status, 400, 'não-admin precisa de loja');
    const repetido = await enviar(base, '/api/usuarios', { nome: 'Repetido', usuario: 'ger.filial', senha: 'abc12345', perfil: 'gerente', loja: 'MATRIZ' }, admin.cookie);
    assert.strictEqual(repetido.status, 400, 'login repetido é recusado');
    const curta = await enviar(base, '/api/usuarios', { nome: 'Curta', usuario: 'curta.teste', senha: 'abc', perfil: 'operador', loja: 'UNICAR' }, admin.cookie);
    assert.strictEqual(curta.status, 400, 'senha curta é recusada');
    const lojaErrada = await enviar(base, '/api/usuarios', { nome: 'Loja Errada', usuario: 'loja.errada', senha: 'abc12345', perfil: 'operador', loja: 'LOJA-X' }, admin.cookie);
    assert.strictEqual(lojaErrada.status, 400, 'loja inexistente é recusada');
  });

  await t.test('edita: muda a loja e o perfil, e a sessão antiga cai na hora', async () => {
    const login1 = await entrar(base, 'ger.filial', 'ger12345');
    assert.strictEqual(login1.status, 200);
    const antes = await pedir(base, '/api/eu', { cabecalhos: { cookie: login1.cookie } });
    assert.strictEqual(antes.corpo.usuario.loja, 'FILIAL');

    const r = await enviar(base, `/api/usuarios/${gerenteId}`, { nome: 'Gerente Matriz', loja: 'MATRIZ' }, admin.cookie, 'PUT');
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.loja, 'MATRIZ');
    assert.strictEqual(r.corpo.nome, 'Gerente Matriz');

    const sessaoVelha = await pedir(base, '/api/eu', { cabecalhos: { cookie: login1.cookie } });
    assert.strictEqual(sessaoVelha.status, 401, 'mudar loja/perfil derruba a sessão antiga');

    const login2 = await entrar(base, 'ger.filial', 'ger12345');
    const eu2 = await pedir(base, '/api/eu', { cabecalhos: { cookie: login2.cookie } });
    assert.strictEqual(eu2.corpo.usuario.loja, 'MATRIZ', 'a loja nova vale no próximo login');
  });

  await t.test('bloqueia o acesso: não entra mais e a sessão aberta morre', async () => {
    const aberta = await entrar(base, 'ger.filial', 'ger12345');
    assert.strictEqual(aberta.status, 200);
    const bloquear = await enviar(base, `/api/usuarios/${gerenteId}`, { ativo: false }, admin.cookie, 'PUT');
    assert.strictEqual(bloquear.status, 200);
    assert.strictEqual(bloquear.corpo.ativo, false);

    const tentativa = await entrar(base, 'ger.filial', 'ger12345');
    assert.strictEqual(tentativa.status, 401, 'usuário bloqueado não entra');
    const sessaoMorta = await pedir(base, '/api/eu', { cabecalhos: { cookie: aberta.cookie } });
    assert.strictEqual(sessaoMorta.status, 401, 'a sessão que já estava aberta é encerrada');
  });

  await t.test('libera de novo e ele volta a entrar', async () => {
    const liberar = await enviar(base, `/api/usuarios/${gerenteId}`, { ativo: true }, admin.cookie, 'PUT');
    assert.strictEqual(liberar.status, 200, JSON.stringify(liberar.corpo));
    assert.strictEqual(liberar.corpo.ativo, true);
    const volta = await entrar(base, 'ger.filial', 'ger12345');
    assert.strictEqual(volta.status, 200, 'liberado volta a entrar');
  });

  await t.test('admin troca a senha: a antiga para de valer e a sessão cai', async () => {
    const aberta = await entrar(base, 'ger.filial', 'ger12345');
    const troca = await enviar(base, `/api/usuarios/${gerenteId}`, { senha: 'novaSenha123' }, admin.cookie, 'PUT');
    assert.strictEqual(troca.status, 200, JSON.stringify(troca.corpo));
    const voltou = await entrar(base, 'ger.filial', 'novaSenha123');
    assert.strictEqual(voltou.status, 200, 'a senha nova vale');
    const aviso = await pedir(base, '/api/eu', { cabecalhos: { cookie: voltou.cookie } });
    assert.strictEqual(aviso.corpo.precisaTrocarSenha, true, 'a pessoa troca a senha no próximo acesso');
    assert.strictEqual((await entrar(base, 'ger.filial', 'ger12345')).status, 401, 'a senha antiga não vale mais');
    const antiga = await pedir(base, '/api/eu', { cabecalhos: { cookie: aberta.cookie } });
    assert.strictEqual(antiga.status, 401, 'trocar a senha derruba as sessões abertas');
  });

  await t.test('proteções: não bloqueia a si mesmo, não deixa o sistema sem admin ativo', async () => {
    const eu = await pedir(base, '/api/eu', { cabecalhos: { cookie: admin.cookie } });
    const meuId = eu.corpo.usuario.id;
    const autoBloqueio = await enviar(base, `/api/usuarios/${meuId}`, { ativo: false }, admin.cookie, 'PUT');
    assert.strictEqual(autoBloqueio.status, 400, 'não pode desativar a si mesmo');
    const meRebaixar = await enviar(base, `/api/usuarios/${meuId}`, { perfil: 'operador' }, admin.cookie, 'PUT');
    assert.strictEqual(meRebaixar.status, 400, 'precisa sobrar um administrador ativo');
    const meExcluir = await pedir(base, `/api/usuarios/${meuId}`, { metodo: 'DELETE', cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(meExcluir.status, 400, 'não pode excluir a si mesmo');
  });

  await t.test('tudo isso fica na auditoria, com o nome de quem fez', async () => {
    const aud = await pedir(base, '/api/auditoria?limit=400', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(aud.status, 200);
    const deUsuarios = aud.corpo.filter((r) => r.entidade === 'usuario');
    assert.ok(deUsuarios.length >= 4, `esperava pelo menos 4 registros de usuário, veio ${deUsuarios.length}`);
    const resumos = deUsuarios.map((r) => r.resumo).join(' | ');
    assert.match(resumos, /Gerente Filial|Gerente Matriz/, 'a criação e a edição ficam registradas');
    assert.match(resumos, /bloqueado|liberado/, 'o bloqueio/liberação ficam registrados');
  });

  const dados = lerDados(pasta);
  assert.ok(dados.auditoria.length > 0, 'a auditoria foi gravada no arquivo');
});

test('usuários: excluir só quando não há histórico (nunca perder OS)', async (t) => {
  const { pasta } = prepararPasta();
  const servidor = await subirServidor(pasta, { porta: PORTA + 1 });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  const admin = await entrar(base, 'admin', 'teste123');
  assert.strictEqual(admin.status, 200);

  // mecânico de teste, com uma OS atribuída a ele
  const mec = await enviar(base, '/api/usuarios', { nome: 'Mecânico Teste', usuario: 'mec.teste', senha: 'mec12345', perfil: 'mecanico', loja: 'UNICAR' }, admin.cookie);
  assert.strictEqual(mec.status, 200, JSON.stringify(mec.corpo));
  const mecId = mec.corpo.id;

  const os = await enviar(base, '/api/os', {
    loja: 'UNICAR',
    cliente: { nome: 'Cliente do Mecânico', telefone: '22999990000' },
    veiculo: { placa: 'MEC-1A23', marca: 'Fiat', modelo: 'Palio', ano: '2012' },
    mecanicoId: mecId,
    itens: [{ tipo: 'mao de obra', descricao: 'Troca de óleo', quantidade: 1, valorUnitario: 120, desconto: 0 }],
  }, admin.cookie);
  assert.strictEqual(os.status, 200, JSON.stringify(os.corpo));

  await t.test('não exclui usuário que aparece em OS — orienta a bloquear', async () => {
    const r = await pedir(base, `/api/usuarios/${mecId}`, { metodo: 'DELETE', cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(r.status, 400, 'exclusão com histórico é recusada');
    assert.match(String(r.corpo.error), /Bloquear|bloquear|ordem/i);
    const lista = await pedir(base, '/api/usuarios', { cabecalhos: { cookie: admin.cookie } });
    assert.ok(lista.corpo.some((u) => u.id === mecId), 'o usuário continua no sistema');
  });

  await t.test('bloquear resolve: ele perde o acesso e a OS continua com o nome dele', async () => {
    const bloquear = await enviar(base, `/api/usuarios/${mecId}`, { ativo: false }, admin.cookie, 'PUT');
    assert.strictEqual(bloquear.status, 200);
    assert.strictEqual((await entrar(base, 'mec.teste', 'mec12345')).status, 401);
    const dados = lerDados(pasta);
    const achada = dados.os.find((o) => o.numero === os.corpo.os.numero);
    assert.ok(achada, 'a OS continua lá');
    assert.strictEqual(achada.mecanicoId, mecId, 'a OS não perde o vínculo com o mecânico');
  });

  await t.test('usuário criado por engano (sem histórico) PODE ser excluído', async () => {
    const novo = await enviar(base, '/api/usuarios', { nome: 'Criado por Engano', usuario: 'engano.teste', senha: 'eng12345', perfil: 'operador', loja: 'MATRIZ' }, admin.cookie);
    assert.strictEqual(novo.status, 200);
    const r = await pedir(base, `/api/usuarios/${novo.corpo.id}`, { metodo: 'DELETE', cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const lista = await pedir(base, '/api/usuarios', { cabecalhos: { cookie: admin.cookie } });
    assert.ok(!lista.corpo.some((u) => u.id === novo.corpo.id), 'saiu da lista');
    assert.ok(lista.corpo.some((u) => u.id === mecId), 'mas o mecânico com histórico continua');
  });

  await t.test('a exclusão também fica na auditoria', async () => {
    const aud = await pedir(base, '/api/auditoria?limit=200', { cabecalhos: { cookie: admin.cookie } });
    const excluidos = aud.corpo.filter((r) => r.entidade === 'usuario' && r.acao === 'excluir');
    assert.ok(excluidos.length >= 1, 'registrou quem foi excluído e por quem');
  });
});
