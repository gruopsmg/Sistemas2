// Testes do cadastro de clientes (base única do grupo) e da ligação com a OS.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { novaPasta, subirServidor, pedir, entrar } = require('./ajuda');
const migracao = require('../migracoes/001_lojas_os');
const clientes = require('../clientes');

const REFERENCIA = process.env.UNICAR_DADOS_REFERENCIA
  || path.join(__dirname, '..', '..', 'app-unicar', 'data.json');

function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(senha), salt, 64).toString('hex')}`;
}

function prepararPasta() {
  const pasta = novaPasta('unicar-clientes-');
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  migracao.aplicar(dados);
  for (const u of dados.usuarios) u.senhaHash = gerarHashSenha(u.perfil === 'admin' ? 'admin123' : 'senha123');
  dados.usuarios.forEach((u) => { u.precisaTrocarSenha = false; });
  delete dados.clientes;
  delete dados.clientesMigrados;
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return pasta;
}

// ------------------------------------------------------------------ unidade
test('normaliza e não duplica: CPF manda, nome é o plano B', () => {
  const data = { clientes: [], clientesMigrados: true };
  const a = clientes.salvarCliente(data, { nome: 'José da Silva', cpfCnpj: '123.456.789-00' }, { nome: 'admin' });
  assert.strictEqual(a.criado, true);
  // mesmo CPF com outra grafia do número e outro nome = mesma pessoa
  const b = clientes.salvarCliente(data, { nome: 'JOSE DA SILVA', cpfCnpj: '12345678900' }, { nome: 'admin' });
  assert.strictEqual(b.criado, false);
  assert.strictEqual(data.clientes.length, 1);
  // mesmo nome sem documento = mesma pessoa
  const c = clientes.salvarCliente(data, { nome: 'maria souza' }, { nome: 'admin' });
  const d = clientes.salvarCliente(data, { nome: 'MARIA SOUZA' }, { nome: 'admin' });
  assert.strictEqual(c.criado, true);
  assert.strictEqual(d.criado, false);
  assert.strictEqual(data.clientes.length, 2);
});

test('busca por nome sem acento, por CPF parcial e por telefone', () => {
  const data = { clientes: [], clientesMigrados: true };
  clientes.salvarCliente(data, { nome: 'Adriana Felisserto', cpfCnpj: '093.504.337-37', telefone: '(22) 99263-9013' }, {});
  clientes.salvarCliente(data, { nome: 'Uiliam da Rocha', cpfCnpj: '111.222.333-44', whatsapp: '(22) 99999-1111' }, {});
  assert.strictEqual(clientes.buscarClientes(data, 'adriana').length, 1);
  assert.strictEqual(clientes.buscarClientes(data, 'felisserto').length, 1);
  assert.strictEqual(clientes.buscarClientes(data, '093504').length, 1, 'CPF parcial');
  assert.strictEqual(clientes.buscarClientes(data, '992639013').length, 1, 'telefone sem máscara');
  assert.strictEqual(clientes.buscarClientes(data, 'zzz').length, 0);
});

test('migração cria a base a partir das OS sem duplicar e marca o vínculo', () => {
  const data = {
    clientes: [],
    os: [
      { numero: 'OS-1', aberturaEm: 1000, cliente: { nome: 'Cliente A', cpfCnpj: '111.111.111-11' } },
      { numero: 'OS-2', aberturaEm: 2000, cliente: { nome: 'Cliente A', cpfCnpj: '11111111111' } },
      { numero: 'OS-3', aberturaEm: 3000, cliente: { nome: 'Cliente B' } },
      { numero: 'OS-4', aberturaEm: 4000, cliente: { nome: 'cliente b' } },
      { numero: 'OS-5', aberturaEm: 5000, cliente: {} },
    ],
  };
  clientes.garantirClientes(data);
  assert.strictEqual(data.clientes.length, 2, 'dois clientes distintos');
  const a = data.clientes.find((c) => c.nome === 'Cliente A');
  assert.strictEqual(a.osCount, 2);
  assert.strictEqual(data.os[0].clienteId, a.id);
  assert.ok(data.clientesMigrados);
  // rodar de novo não duplica
  clientes.garantirClientes(data);
  assert.strictEqual(data.clientes.length, 2);
});

test('remover: bloqueia cliente com OS e libera cliente só de cadastro', () => {
  const data = { clientes: [], clientesMigrados: true };
  const comOs = clientes.salvarCliente(data, { nome: 'Tem OS' }, {}).cliente;
  comOs.osCount = 2;
  const semOs = clientes.salvarCliente(data, { nome: 'Sem OS' }, {}).cliente;
  assert.ok(clientes.removerCliente(data, comOs.id).erro, 'com OS não pode apagar');
  assert.strictEqual(clientes.removerCliente(data, semOs.id), true);
  assert.strictEqual(data.clientes.length, 1);
});

test('importação: cabeçalho com ; e linhas soltas', () => {
  const data = { clientes: [], clientesMigrados: true };
  const csv = 'Nome;CPF;Telefone;Bairro;Cidade\n'
    + 'Adriana Felisserto;093.504.337-37;(22) 99263-9013;Estacao;Sao Pedro da Aldeia\n'
    + 'Beto Souza;111.222.333-44;(22) 99888-7766;Centro;Cabo Frio\n';
  const previa = clientes.previaImportacao(data, csv);
  assert.strictEqual(previa.total, 2);
  assert.strictEqual(previa.novos.length, 2);
  assert.strictEqual(previa.temCabecalho, true);
  const aplicado = clientes.aplicarImportacao(data, csv, { nome: 'admin' });
  assert.strictEqual(aplicado.criados, 2);
  // importar de novo atualiza, não duplica
  const denovo = clientes.aplicarImportacao(data, csv, { nome: 'admin' });
  assert.strictEqual(denovo.criados, 0);
  assert.strictEqual(data.clientes.length, 2);

  const soltas = 'ADALTO GOMES VIEIRA 897.777.097-49 (22) 99907-3556\n'
    + 'ADEMIR CARDOSO 037.193.537-70\n';
  const p2 = clientes.previaImportacao(data, soltas);
  assert.strictEqual(p2.total, 2);
  assert.match(p2.novos[0].nome, /ADALTO GOMES VIEIRA/);
  assert.strictEqual(p2.novos[0].cpfCnpj, '897.777.097-49');
});

test('clienteDaOS: conta a OS e reaproveita o cadastro', () => {
  const data = { clientes: [], clientesMigrados: true };
  const r1 = clientes.clienteDaOS(data, { nome: 'Joao Pedro', cpfCnpj: '222.333.444-55' }, null, { nome: 'ana' });
  assert.ok(r1.clienteId);
  assert.strictEqual(r1.cliente.osCount, 1);
  const r2 = clientes.clienteDaOS(data, { nome: 'Joao Pedro', cpfCnpj: '22233344455', telefone: '(22) 99999-0000' }, null, { nome: 'bia' });
  assert.strictEqual(r2.clienteId, r1.clienteId, 'mesmo cliente, sem duplicar');
  assert.strictEqual(r2.cliente.osCount, 2);
  assert.strictEqual(r2.cliente.telefone, '(22) 99999-0000', 'telefone novo entrou no cadastro');
});

// ------------------------------------------------------------------ API
const PORTA = 5800 + crypto.randomInt(0, 150);

test('API de clientes: todos usam, admin apaga, OS usa a base', async (t) => {
  const pasta = prepararPasta();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;
  const admin = await entrar(base, 'admin', 'admin123');
  assert.strictEqual(admin.status, 200, 'admin precisa entrar');

  // lista vazia no começo (mas sem erro)
  let r = await pedir(base, '/api/clientes', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.corpo.total, 0);

  // cadastro
  r = await pedir(base, '/api/clientes', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({ nome: 'Maria Teste', cpfCnpj: '555.666.777-88', telefone: '(22) 98888-7777', cidade: 'Cabo Frio' }),
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
  const id = r.corpo.cliente.id;
  assert.strictEqual(r.corpo.criado, true);

  // cadastrar de novo o mesmo CPF não cria outro
  r = await pedir(base, '/api/clientes', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({ nome: 'MARIA TESTE', cpfCnpj: '55566677788' }),
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.corpo.criado, false);

  // busca pelo telefone
  r = await pedir(base, '/api/clientes?busca=988887777', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.corpo.clientes.length, 1);

  // criar OS usando o cliente da base: grava o vínculo e não duplica
  r = await pedir(base, '/api/os', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({
      loja: 'MATRIZ', clienteId: id,
      cliente: { nome: 'Maria Teste', cpfCnpj: '555.666.777-88', telefone: '(22) 98888-7777' },
      veiculo: { placa: 'ABC1D23' },
      itens: [{ tipo: 'produto', descricao: 'Pneu 175/70 R14', quantidade: 1, valorUnitario: 300 }],
    }),
  });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.corpo));
  const numero = r.corpo.os ? r.corpo.os.numero : r.corpo.numero;
  assert.ok(numero);

  r = await pedir(base, '/api/clientes', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.corpo.total, 1, 'a OS não pode criar cliente duplicado');
  assert.strictEqual(r.corpo.clientes[0].osCount, 1, 'a OS conta no cliente');

  const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
  const os = dados.os.find((o) => o.numero === numero);
  assert.strictEqual(os.clienteId, id, 'a OS guarda o vínculo com o cliente');

  // OS com cliente novo cadastra na base
  r = await pedir(base, '/api/os', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({
      loja: 'MATRIZ', cliente: { nome: 'Cliente Novo da OS', cpfCnpj: '999.888.777-66' },
      itens: [{ tipo: 'produto', descricao: 'Serviço', quantidade: 1, valorUnitario: 50 }],
    }),
  });
  assert.ok([200, 201].includes(r.status));
  r = await pedir(base, '/api/clientes?busca=Cliente Novo', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.corpo.clientes.length, 1, 'cliente novo da OS entrou na base');
  assert.strictEqual(r.corpo.clientes[0].osCount, 1);

  // a base é do grupo: usuário de OUTRA loja vê o mesmo cliente
  const dadosAtual = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
  const outro = dadosAtual.usuarios.find((u) => u.perfil !== 'admin' && u.loja && u.loja !== 'MATRIZ');
  if (outro) {
    const sessao = await entrar(base, outro.usuario, 'senha123');
    if (sessao.status === 200) {
      const listaOutro = await pedir(base, '/api/clientes', { cabecalhos: { cookie: sessao.cookie } });
      assert.strictEqual(listaOutro.status, 200);
      assert.ok(listaOutro.corpo.total >= 2, 'cliente de outra loja precisa aparecer');
    }
  }

  // cliente com OS não pode ser apagado; sem OS pode
  r = await pedir(base, `/api/clientes/${id}`, { metodo: 'DELETE', cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.status, 400, 'cliente com OS não pode ser apagado');

  r = await pedir(base, '/api/clientes', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' }, corpo: JSON.stringify({ nome: 'Só cadastro' }),
  });
  const idSo = r.corpo.cliente.id;
  r = await pedir(base, `/api/clientes/${idSo}`, { metodo: 'DELETE', cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.status, 200);

  // importação pela API: prévia não grava, confirmar grava
  const csv = 'Nome;CPF;Telefone\nFulano da Silva;123.123.123-12;(22) 97777-6666\n';
  r = await pedir(base, '/api/clientes/importar/previa', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' }, corpo: JSON.stringify({ conteudo: csv }),
  });
  assert.strictEqual(r.corpo.novosTotal, 1);
  let depois = await pedir(base, '/api/clientes', { cabecalhos: { cookie: admin.cookie } });
  const totalAntes = depois.corpo.total;
  r = await pedir(base, '/api/clientes/importar', {
    metodo: 'POST', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' }, corpo: JSON.stringify({ conteudo: csv }),
  });
  assert.strictEqual(r.corpo.criados, 1);
  depois = await pedir(base, '/api/clientes', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(depois.corpo.total, totalAntes + 1);

  // configuração da impressão: cada loja sai com a SUA cor (a da logo)
  r = await pedir(base, '/api/os-config', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  const cores = {};
  for (const loja of r.corpo.lojas) cores[loja.codigo] = loja.cor;
  assert.strictEqual(cores.MATRIZ, '#e39012', 'MATRIZ com o laranja da logo');
  assert.strictEqual(cores.FILIAL, '#a5182f', 'FILIAL com o vinho da logo');
  assert.strictEqual(cores.UNICAR, '#d02b2b', 'UNICAR com o vermelho da logo');

  // troca de cor por loja (Configurações) e volta ao padrão
  r = await pedir(base, '/api/os-config', {
    metodo: 'PUT', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({ lojas: [{ codigo: 'MATRIZ', cor: '#1e7f4f' }] }),
  });
  assert.strictEqual(r.status, 200);
  r = await pedir(base, '/api/os-config', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.corpo.lojas.find((l) => l.codigo === 'MATRIZ').cor, '#1e7f4f');
  // cor inválida não grava lixo
  await pedir(base, '/api/os-config', {
    metodo: 'PUT', cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({ lojas: [{ codigo: 'MATRIZ', cor: 'vermelho' }] }),
  });
  r = await pedir(base, '/api/os-config', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(r.corpo.lojas.find((l) => l.codigo === 'MATRIZ').cor, '#e39012', 'volta para a cor da logo');

  // sem sessão não abre
  r = await pedir(base, '/api/clientes');
  assert.strictEqual(r.status, 401);
});

test('a tela tem a aba Clientes e o formulário de OS busca cliente salvo', () => {
  const raiz = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(raiz, 'public', 'index.html'), 'utf-8');
  assert.match(html, /data-view="clientes"/, 'aba Clientes no menu');
  assert.match(html, /id="view-clientes"/, 'tela de clientes');
  assert.match(html, /id="clienteBusca"/, 'busca de clientes');
  assert.match(html, /id="btnImportarClientes"/, 'importação de clientes');
  assert.match(html, /src="\/clientes\.js"/, 'script da tela');

  const os = fs.readFileSync(path.join(raiz, 'public', 'os.js'), 'utf-8');
  assert.match(os, /id="osClienteBusca"/, 'busca de cliente dentro da OS');
  assert.match(os, /id="osClienteId"/, 'o formulário guarda o vínculo do cliente');
  assert.match(os, /clienteId: overlay\.querySelector\('#osClienteId'\)/, 'o vínculo vai no corpo da OS');
  assert.match(os, /window\.unicarNovaOSComCliente/, 'botão Nova OS da tela de clientes');

  const smg = fs.readFileSync(path.join(raiz, 'public', 'smg.js'), 'utf-8');
  assert.match(smg, /tabClientes.*style\.display = ''/, 'aba liberada para qualquer usuário');
});
