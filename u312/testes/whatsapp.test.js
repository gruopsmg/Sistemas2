// Testes do envio da OS pelo WhatsApp (PDF + conexão por loja + rotas)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { novaPasta, subirServidor, pedir, entrar } = require('./ajuda');
const migracao = require('../migracoes/001_lojas_os');
const whatsapp = require('../whatsapp');
const osPdf = require('../os-pdf');

const REFERENCIA = process.env.UNICAR_DADOS_REFERENCIA
  || path.join(__dirname, '..', '..', 'app-unicar', 'data.json');

function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(senha), salt, 64).toString('hex')}`;
}

function prepararPasta() {
  const pasta = novaPasta('unicar-zap-');
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  migracao.aplicar(dados);
  for (const u of dados.usuarios) {
    u.senhaHash = gerarHashSenha(u.perfil === 'admin' ? 'admin123' : 'senha123');
    u.precisaTrocarSenha = false;
  }
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return pasta;
}

function osExemplo() {
  return {
    id: 'os-1',
    numero: 'OS-MATRIZ-000123',
    loja: 'MATRIZ',
    status: 'concluida',
    cliente: { nome: 'Maria Souza', telefone: '(22) 99999-1111', cpfCnpj: '123.456.789-00' },
    veiculo: { placa: 'ABC1D23', marca: 'Fiat', modelo: 'Argo', ano: '2021', km: '45000' },
    itens: [
      { descricao: 'Pneu 185/60 R15', quantidade: 2, valorUnitario: 339, total: 678 },
      { descricao: 'Alinhamento', quantidade: 1, valorUnitario: 80, total: 80 },
    ],
    total: 758,
    condicoesPagamento: '3x no cartão',
    defeito: 'Barulho na roda dianteira',
    responsavel: { nome: 'Administrador' },
    aberturaEm: new Date('2026-10-21T14:39:00Z').getTime(),
  };
}

// ------------------------------------------------------------------ unidade
test('normaliza o telefone: com máscara, sem 55, com 55, inválido', () => {
  assert.strictEqual(whatsapp.normalizarNumero('(22) 99999-1111'), '5522999991111');
  assert.strictEqual(whatsapp.normalizarNumero('22999991111'), '5522999991111');
  assert.strictEqual(whatsapp.normalizarNumero('+55 22 99999-1111'), '5522999991111');
  assert.strictEqual(whatsapp.normalizarNumero('0055 22 99999 1111'), '5522999991111');
  assert.strictEqual(whatsapp.normalizarNumero('123'), '', 'curto demais');
  assert.strictEqual(whatsapp.normalizarNumero(''), '');
  assert.strictEqual(whatsapp.normalizarNumero('119999988887777'), '', 'longo demais');
});

test('mensagem e nome do arquivo da OS', () => {
  const os = osExemplo();
  const loja = { codigo: 'MATRIZ', nome: 'UNICAR MATRIZ' };
  const texto = osPdf.mensagemDaOS(os, loja);
  assert.match(texto, /Maria/);
  assert.match(texto, /OS-MATRIZ-000123/);
  assert.match(texto, /R\$ 758,00/);
  assert.strictEqual(osPdf.nomeArquivo(os), 'OS-MATRIZ-000123.pdf');
  assert.strictEqual(osPdf.nomeArquivo({ numero: 'OS/1 2' }), 'OS-1-2.pdf');
});

test('gera o PDF da OS em UMA folha A4 com a cor da loja', async () => {
  const pdf = await osPdf.gerarPDF(osExemplo(), {
    codigo: 'MATRIZ', nome: 'UNICAR MATRIZ', cor: '#e39012',
    endereco: 'Rua das Palmeiras, 120', telefone: '(22) 99888-7766', cnpj: '12.345.678/0001-90',
  });
  assert.ok(Buffer.isBuffer(pdf), 'precisa devolver Buffer');
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-', 'assinatura de PDF');
  assert.ok(pdf.length > 5000, `PDF pequeno demais (${pdf.length} bytes)`);
  const paginas = pdf.toString('latin1').split('/Type /Page').length - 1
    - (pdf.toString('latin1').split('/Type /Pages').length - 1);
  assert.strictEqual(paginas, 1, `o PDF da OS tem de ser 1 folha (deu ${paginas})`);
});

test('não envia sem o WhatsApp conectado, e avisa o que fazer', async () => {
  await assert.rejects(
    () => whatsapp.enviarDocumento('UNICAR', { numero: '22999991111', pdf: Buffer.from('%PDF-1.4'), nomeArquivo: 'x.pdf' }),
    /não está conectado/i,
  );
  await assert.rejects(
    () => whatsapp.enviarTexto('UNICAR', { numero: '22999991111', texto: 'oi' }),
    /não está conectado/i,
  );
});

test('telefone inválido nem tenta conectar (não abre socket)', async () => {
  const estado = await whatsapp.conectar('FILIAL', { telefone: '123' });
  assert.strictEqual(estado.status, 'erro');
  assert.match(estado.erro, /Telefone inválido/i);
});

test('a pasta da sessão fica fora da pasta do sistema', () => {
  const pasta = whatsapp.pastaDaLoja('MATRIZ');
  assert.ok(!pasta.startsWith(path.join(__dirname, '..') + path.sep + 'public'), 'não pode ficar em public');
  assert.match(pasta.replace(/\\/g, '/'), /whatsapp-sessao\/MATRIZ$/);
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf-8');
  assert.match(gitignore, /whatsapp-sessao/, 'a sessão não pode entrar no git/pacote');
});

// ------------------------------------------------------------------ API
const PORTA = 6000 + crypto.randomInt(0, 120);

test('API do WhatsApp: status por loja, permissão e envio da OS', async (t) => {
  const pasta = prepararPasta();
  const servidor = await subirServidor(pasta, {
    porta: PORTA,
    ambiente: { WHATSAPP_ENVIO_FAKE: '1', PASTA_WHATSAPP: path.join(pasta, 'whatsapp-sessao') },
  });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  // sem login não abre
  const semSessao = await pedir(base, '/api/whatsapp');
  assert.strictEqual(semSessao.status, 401);

  const admin = await entrar(base, 'admin', 'admin123');
  const lista = await pedir(base, '/api/whatsapp', { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(lista.status, 200);
  assert.strictEqual(lista.corpo.lojas.length, 3, 'uma conexão por loja');
  for (const l of lista.corpo.lojas) {
    assert.strictEqual(l.status, 'desconectado');
    assert.ok(l.pasta.includes('whatsapp-sessao'), 'mostra a pasta da sessão');
  }

  // cria uma OS e envia pelo WhatsApp (envio falso, mas o caminho todo roda: PDF + auditoria)
  const criada = await pedir(base, '/api/os', {
    metodo: 'POST',
    cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({
      loja: 'MATRIZ',
      cliente: { nome: 'Cliente Zap', telefone: '(22) 98888-7777' },
      veiculo: { placa: 'XYZ9K88' },
      itens: [{ tipo: 'produto', descricao: 'Pneu 175/70 R14', quantidade: 2, valorUnitario: 300 }],
      condicoesPagamento: 'Pix',
    }),
  });
  assert.ok([200, 201].includes(criada.status), JSON.stringify(criada.corpo));
  const numero = criada.corpo.os ? criada.corpo.os.numero : criada.corpo.numero;

  const envio = await pedir(base, `/api/os/${numero}/enviar-whatsapp`, {
    metodo: 'POST',
    cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({}),
  });
  assert.strictEqual(envio.status, 200, JSON.stringify(envio.corpo));
  assert.strictEqual(envio.corpo.numero, '5522988887777', 'usa o telefone do cliente já normalizado');
  assert.strictEqual(envio.corpo.os, numero);

  // segunda vez em menos de 1 minuto é barrada (evita disparo repetido)
  const repetido = await pedir(base, `/api/os/${numero}/enviar-whatsapp`, {
    metodo: 'POST',
    cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({}),
  });
  assert.strictEqual(repetido.status, 429);
  assert.match(repetido.corpo.error, /agora há pouco/i);

  // histórico na OS + auditoria
  const historico = await pedir(base, `/api/os/${numero}/whatsapp`, { cabecalhos: { cookie: admin.cookie } });
  assert.strictEqual(historico.corpo.envios.length, 1);
  assert.strictEqual(historico.corpo.envios[0].numero, '5522988887777');

  const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
  const os = dados.os.find((o) => o.numero === numero);
  assert.strictEqual(os.whatsappEnvios.length, 1, 'o envio fica gravado na OS');
  const registro = dados.auditoria.find((a) => a.entidade === 'whatsapp' && a.acao === 'enviar');
  assert.ok(registro, 'o envio entra na auditoria');
  assert.match(registro.resumo, new RegExp(numero));

  // telefone do cliente inválido/ausente: 400 com mensagem clara
  const semTelefone = await pedir(base, '/api/os', {
    metodo: 'POST',
    cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({
      loja: 'MATRIZ', cliente: { nome: 'Sem Telefone' },
      itens: [{ tipo: 'produto', descricao: 'Serviço', quantidade: 1, valorUnitario: 50 }],
    }),
  });
  const numeroSem = semTelefone.corpo.os ? semTelefone.corpo.os.numero : semTelefone.corpo.numero;
  const semNumero = await pedir(base, `/api/os/${numeroSem}/enviar-whatsapp`, {
    metodo: 'POST',
    cabecalhos: { cookie: admin.cookie, 'Content-Type': 'application/json' },
    corpo: JSON.stringify({}),
  });
  assert.strictEqual(semNumero.status, 400);
  assert.match(semNumero.corpo.error, /telefone/i);
});

test('operador não administra a conexão e só vê o WhatsApp da própria loja', async (t) => {
  const pasta = prepararPasta();
  const servidor = await subirServidor(pasta, {
    porta: PORTA + 1,
    ambiente: { WHATSAPP_ENVIO_FAKE: '1', PASTA_WHATSAPP: path.join(pasta, 'whatsapp-sessao') },
  });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
  const operador = dados.usuarios.find((u) => u.perfil === 'operador') || dados.usuarios.find((u) => u.perfil !== 'admin');
  if (!operador) return;
  const sessao = await entrar(base, operador.usuario, 'senha123');
  assert.strictEqual(sessao.status, 200);

  const lista = await pedir(base, '/api/whatsapp', { cabecalhos: { cookie: sessao.cookie } });
  assert.strictEqual(lista.status, 200);
  assert.strictEqual(lista.corpo.lojas.length, 1, 'só a própria loja');

  const conectar = await pedir(base, '/api/whatsapp/MATRIZ/conectar', {
    metodo: 'POST', cabecalhos: { cookie: sessao.cookie, 'Content-Type': 'application/json' }, corpo: '{}',
  });
  assert.strictEqual(conectar.status, 403, 'operador não conecta o WhatsApp');
});

test('a tela tem o painel do WhatsApp e o botão na OS', () => {
  const raiz = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(raiz, 'public', 'index.html'), 'utf-8');
  assert.match(html, /id="cfgWhatsapp"/, 'painel do WhatsApp em Configurações');
  assert.match(html, /WhatsApp das lojas/, 'título do painel');
  assert.match(html, /src="\/whatsapp\.js"/, 'script do WhatsApp carregado');
  const os = fs.readFileSync(path.join(raiz, 'public', 'os.js'), 'utf-8');
  assert.match(os, /id="osWhatsappDetalhe"/, 'botão WhatsApp na ficha da OS');
  assert.match(os, /unicarEnviarWhatsApp/, 'o botão chama o envio');
  const wpp = fs.readFileSync(path.join(raiz, 'public', 'whatsapp.js'), 'utf-8');
  for (const texto of ['Conectar (QR Code)', 'Conectar com número', 'Enviar mensagem de teste', 'Desconectar']) {
    assert.ok(wpp.includes(texto), `a tela precisa ter: ${texto}`);
  }
});
