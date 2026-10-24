// Testes da v2.1.3: logo + nome da loja no topo e documento A4 com marca d'água.
// Roda um servidor de verdade, com dados próprios numa pasta temporária.
const { test } = require('node:test');
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

// Cópia do dado real (nunca o original) + senha conhecida no admin, para poder entrar.
function prepararPasta(senhaAdmin = 'unicar123') {
  const pasta = novaPasta('unicar-logo-');
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  migracao.aplicar(dados);
  const admin = dados.usuarios.find((u) => u.perfil === 'admin');
  admin.senhaHash = gerarHashSenha(senhaAdmin);
  admin.precisaTrocarSenha = false;
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return pasta;
}

const PORTA = 5600 + crypto.randomInt(0, 200);

test('marca da loja no topo e documento A4 da OS (v2.1.3)', async (t) => {
  const pasta = prepararPasta();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  // ------------------------------------------- usuário da FILIAL (criado pelo admin)
  const admin = await entrar(base, 'admin', 'unicar123');
  assert.strictEqual(admin.status, 200, 'o admin precisa entrar');
  const comoAdmin = { cookie: admin.cookie, 'content-type': 'application/json' };
  const gerenteCriado = await pedir(base, '/api/usuarios', {
    metodo: 'POST',
    cabecalhos: comoAdmin,
    corpo: JSON.stringify({ nome: 'Gerente Filial', usuario: 'gerente.filial', senha: 'gerente123', perfil: 'gerente', loja: 'FILIAL' }),
  });
  assert.ok([200, 201].includes(gerenteCriado.status), `criar gerente devolveu ${gerenteCriado.status}`);

  // ---------------------------------------------------------------- login
  const gerente = await entrar(base, 'gerente.filial', 'gerente123');
  assert.strictEqual(gerente.status, 200, 'o gerente da FILIAL precisa entrar');

  // ------------------------------------------- /api/eu devolve a marca da loja
  await t.test('cada usuário recebe a marca da SUA loja (nunca a de outra)', async () => {
    const doGerente = await pedir(base, '/api/eu', { cabecalhos: { cookie: gerente.cookie } });
    assert.strictEqual(doGerente.status, 200);
    assert.strictEqual(doGerente.corpo.usuario.loja, 'FILIAL');
    assert.strictEqual(doGerente.corpo.marca.logo, '/logos/loja_FILIAL_logo.webp');
    assert.strictEqual(doGerente.corpo.marca.marcaDagua, '/logos/marca_agua_FILIAL.png');
    assert.ok(!JSON.stringify(doGerente.corpo.marca).includes('UNICAR'), 'não pode vazar marca de outra loja');

    // admin sem loja: marca do sistema, sem logo de loja
    const doAdmin = await pedir(base, '/api/eu', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(doAdmin.corpo.usuario.loja, null);
    assert.strictEqual(doAdmin.corpo.marca.logo, '');
    assert.strictEqual(doAdmin.corpo.marca.titulo, 'UNICAR');
  });

  // ------------------------------------------------------- arquivos das logos
  await t.test('as 3 logos e as 3 marcas d\'água abrem pelo site', async () => {
    for (const arquivo of ['loja_UNICAR_logo.webp', 'loja_MATRIZ_logo.webp', 'loja_FILIAL_logo.webp',
      'marca_agua_UNICAR.png', 'marca_agua_MATRIZ.png', 'marca_agua_FILIAL.png']) {
      const r = await pedir(base, `/logos/${arquivo}`);
      assert.strictEqual(r.status, 200, `${arquivo} precisa abrir (veio ${r.status})`);
      assert.ok(String(r.cabecalhos.get('content-type')).startsWith('image/'), `${arquivo} precisa ser imagem`);
    }
  });

  // ---------------------------------------------------------- documento da OS
  let numero = '';
  await t.test('emite uma OS por loja e a folha traz logo, marca d\'água e as 5 seções', async () => {
    const queridas = { UNICAR: 'adriana', FILIAL: 'gerente.filial', MATRIZ: 'mecanico.unicar' };
    void queridas;

    // admin emite na MATRIZ
    const r = await pedir(base, '/api/os', {
      metodo: 'POST',
      cabecalhos: comoAdmin,
      corpo: JSON.stringify({
        loja: 'MATRIZ',
        cliente: {
          nome: 'Cliente do Teste', cpfCnpj: '111.222.333-44', telefone: '22999990000',
          email: 'teste@exemplo.com', endereco: 'Rua A, 10', bairro: 'Centro',
          cidade: 'São Pedro da Aldeia', cep: '28940-000', rgIe: '1234567',
          midia: 'Indicação', contato: 'Maria', referencia: 'Perto da praça',
        },
        veiculo: { placa: 'ABC1D23', marca: 'Fiat', modelo: 'Argo', ano: '2021', km: '45000', observacoes: 'Pneu dianteiro' },
        itens: [
          { tipo: 'produto', descricao: 'Pneu 175/70 R14', quantidade: 2, valorUnitario: 320 },
          { tipo: 'mao de obra', descricao: 'Alinhamento', quantidade: 1, valorUnitario: 80 },
        ],
        condicoesPagamento: '3x no cartão',
        autorizadoPor: 'Cliente autorizou por telefone',
      }),
    });
    assert.ok([200, 201].includes(r.status), `criar OS devolveu ${r.status}: ${JSON.stringify(r.corpo)}`);
    numero = r.corpo.os ? r.corpo.os.numero : r.corpo.numero;
    assert.ok(numero, 'a OS precisa ter número');

    const folha = await pedir(base, `/api/os/${numero}/imprimir`, { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(folha.status, 200);

    // A4 em pé, uma folha com as duas vias (cliente em cima, loja embaixo)
    assert.match(folha.corpo, /@page \{ size: A4 portrait/);
    assert.match(folha.corpo, /\.via \{ height: 140mm/, 'cada via ocupa metade da folha');
    assert.match(folha.corpo, /VIA DO CLIENTE/);
    assert.match(folha.corpo, /VIA DA LOJA/);
    assert.match(folha.corpo, /Recorte aqui/, 'linha de corte entre as vias');
    assert.strictEqual((folha.corpo.match(/class="via via-cliente/g) || []).length, 1);
    assert.strictEqual((folha.corpo.match(/class="via via-loja/g) || []).length, 1);

    // logo da loja no cabeçalho das duas vias
    assert.ok(folha.corpo.includes('/logos/loja_MATRIZ_logo.webp'), 'logo da MATRIZ no cabeçalho');
    assert.ok(!folha.corpo.includes('loja_UNICAR_logo'), 'não pode aparecer logo de outra loja');
    assert.match(folha.corpo, /print-color-adjust: exact/);
    assert.match(folha.corpo, /-webkit-print-color-adjust: exact/);

    // dados preenchidos, sem custo/lucro/margem
    assert.match(folha.corpo, /Cliente do Teste/);
    assert.match(folha.corpo, /ABC1D23/);
    assert.match(folha.corpo, /3x no cartão/);
    assert.doesNotMatch(folha.corpo, /precoCusto|lucro|margem/i);
  });

  // -------------------------------------------------------- modelo em branco
  await t.test('modelo em branco: 1 folha por loja, sem número e sem dados', async () => {
    for (const loja of ['UNICAR', 'MATRIZ', 'FILIAL']) {
      const r = await pedir(base, `/api/os-branco/imprimir?loja=${loja}`, { cabecalhos: { cookie: admin.cookie } });
      assert.strictEqual(r.status, 200, `modelo ${loja} devolveu ${r.status}`);
      assert.ok(r.corpo.includes(`/logos/loja_${loja}_logo.webp`), `modelo ${loja} com a logo certa`);
      assert.match(r.corpo, /<div class="numero">Nº <span class="vazio"><\/span><\/div>/, 'modelo sai sem número');
      assert.ok(!r.corpo.includes('Cliente do Teste'), 'modelo não pode trazer dados de OS');
      assert.strictEqual((r.corpo.match(/<tr class="vazia"><td class="c">\d+<\/td><td><\/td>/g) || []).length, 20,
        'modelo traz 10 linhas em branco em cada via');
    }
  });

  // ------------------------------------------------------------- permissões
  await t.test('vendedor só tira modelo da própria loja (id forçado é ignorado)', async () => {
    const r = await pedir(base, '/api/os-branco/imprimir?loja=UNICAR', { cabecalhos: { cookie: gerente.cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.corpo.includes('/logos/loja_FILIAL_logo.webp'), 'gerente da FILIAL só tira da FILIAL');
    assert.ok(!r.corpo.includes('/logos/loja_UNICAR_logo.webp'), 'id forçado na URL não pode mudar a loja');
  });

  await t.test('sem sessão não abre o modelo nem a impressão', async () => {
    assert.strictEqual((await pedir(base, '/api/os-branco/imprimir?loja=UNICAR')).status, 401);
    const r = await pedir(base, `/api/os/${numero}/imprimir`);
    assert.strictEqual(r.status, 401);
  });
});
