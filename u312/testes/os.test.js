// Testes do modulo de Ordem de Servico (OS) e das regras de loja.
//
// Estes testes rodam sobre uma COPIA do data.json real recebido (com a migracao aplicada),
// numa pasta temporaria. O arquivo original NUNCA e tocado.
// Para conseguir entrar no sistema durante o teste, a copia recebe uma senha de teste
// APENAS no usuario administrador — no arquivo real nada disso acontece.
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

// Prepara uma pasta temporaria com o dado real migrado + senha de teste no admin
function prepararPasta({ senhaAdmin = 'teste123' } = {}) {
  const pasta = novaPasta();
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  const antes = JSON.parse(JSON.stringify(dados));
  migracao.aplicar(dados);
  const admin = dados.usuarios.find((u) => u.perfil === 'admin');
  admin.senhaHash = gerarHashSenha(senhaAdmin);
  admin.precisaTrocarSenha = false;
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return { pasta, antes, dados };
}

const PORTA = 5200 + crypto.randomInt(0, 300);

test('OS: criar, numerar, isolar por loja, perfis, painel e impressão', async (t) => {
  const { pasta, antes } = prepararPasta();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  // ---------------------------------------------------------------- login
  const admin = await entrar(base, 'admin', 'teste123');
  assert.strictEqual(admin.status, 200, 'o login do administrador precisa continuar funcionando');
  const comoAdmin = { cookie: admin.cookie, 'content-type': 'application/json' };

  // ------------------------------------------- lojas disponíveis para quem entrou
  await t.test('a lista de lojas vem do servidor', async () => {
    const r = await pedir(base, '/api/lojas', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.corpo.lojas.map((l) => l.codigo).sort(), ['FILIAL', 'MATRIZ', 'UNICAR']);
  });

  // ------------------------------------------------- criar OS nas tres lojas
  const osCriadas = {};
  await t.test('criar OS calcula totais, numera por loja e registra na auditoria', async () => {
    for (const loja of ['UNICAR', 'FILIAL', 'MATRIZ']) {
      const r = await pedir(base, '/api/os', {
        metodo: 'POST',
        cabecalhos: comoAdmin,
        corpo: JSON.stringify({
          loja,
          cliente: {
            nome: `Cliente ${loja}`, cpfCnpj: '000.000.000-00', telefone: '22999990000',
            whatsapp: '22999990000', email: 'cliente@exemplo.com', endereco: 'Rua Teste, 10',
          },
          veiculo: { placa: 'ABC1D23', marca: 'Fiat', modelo: 'Argo', ano: '2021', km: '45000', observacoes: 'Pneu dianteiro direito' },
          servicosSolicitados: 'Troca de pneus e alinhamento',
          itens: [
            { tipo: 'pneu', descricao: 'Pneu 175/65 R14', quantidade: 4, valorUnitario: 250, desconto: 50 },
            { tipo: 'mao de obra', descricao: 'Alinhamento e balanceamento', quantidade: 1, valorUnitario: 120, desconto: 0 },
          ],
          descontoTipo: 'valor',
          descontoValor: 30,
          observacoesInternas: 'Cliente pediu para guardar os pneus antigos',
          observacoesCliente: 'Serviço com garantia de 3 meses',
        }),
      });
      assert.strictEqual(r.status, 200, `criar OS em ${loja}: ${JSON.stringify(r.corpo)}`);
      const os = r.corpo.os;
      assert.strictEqual(os.loja, loja, 'a OS precisa pertencer à loja informada');
      assert.match(os.numero, new RegExp(`^OS-${loja}-\\d{6}$`), `número no formato certo (${os.numero})`);
      // 4 x 250 - 50 = 950; + 120 = 1070; - 30 de desconto geral = 1040
      assert.strictEqual(os.subtotal, 1070, 'subtotal = soma dos itens');
      assert.strictEqual(os.descontoGeral, 30);
      assert.strictEqual(os.total, 1040, 'total = subtotal - desconto');
      assert.strictEqual(os.status, 'aberta');
      assert.strictEqual(os.historico.length, 1, 'a abertura precisa ficar no histórico');
      assert.strictEqual(os.responsavel.nome, 'Administrador');
      assert.strictEqual(os.aberturaEm > 0, true);
      osCriadas[loja] = os;
    }
    // numeracao: cada loja comeca em 000001
    assert.strictEqual(osCriadas.UNICAR.numero, 'OS-UNICAR-000001');
    assert.strictEqual(osCriadas.FILIAL.numero, 'OS-FILIAL-000001');
    assert.strictEqual(osCriadas.MATRIZ.numero, 'OS-MATRIZ-000001');

    const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    const auditoriaOS = dados.auditoria.filter((a) => a.entidade === 'os');
    assert.strictEqual(auditoriaOS.length, 3, 'cada OS aberta precisa entrar na auditoria');
    assert.ok(auditoriaOS.every((a) => a.loja), 'a auditoria precisa registrar a loja');
    assert.deepStrictEqual(dados.osSequencia, { UNICAR: 1, FILIAL: 1, MATRIZ: 1 });
  });

  await t.test('o numero da OS nunca se repete (criacões simultâneas)', async () => {
    const pedidos = [];
    for (let i = 0; i < 15; i += 1) {
      pedidos.push(pedir(base, '/api/os', {
        metodo: 'POST',
        cabecalhos: comoAdmin,
        corpo: JSON.stringify({ loja: 'UNICAR', cliente: { nome: `Simultâneo ${i}` }, itens: [] }),
      }));
    }
    const respostas = await Promise.all(pedidos);
    const numeros = respostas.map((r) => (r.corpo.os ? r.corpo.os.numero : null));
    assert.ok(numeros.every(Boolean), 'todas as 15 deveriam ser criadas');
    assert.strictEqual(new Set(numeros).size, 15, 'nenhum número pode repetir');
    const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    assert.strictEqual(new Set(dados.os.map((o) => o.numero)).size, dados.os.length, 'o arquivo não pode ter número repetido');
  });

  // ------------------------------------------------------ usuarios por perfil
  let gerenteFilial = null;
  let mecanicoUnicar = null;
  await t.test('admin cria usuários com loja e perfil (e o gerente não pode criar)', async () => {
    const criar = async (corpo) => pedir(base, '/api/usuarios', {
      metodo: 'POST', cabecalhos: comoAdmin, corpo: JSON.stringify(corpo),
    });

    const semLoja = await criar({ nome: 'Sem Loja', usuario: 'semloja', senha: 'senha1234', perfil: 'gerente' });
    assert.strictEqual(semLoja.status, 400, 'perfil sem loja precisa ser recusado');
    assert.match(semLoja.corpo.error, /loja/i);

    const lojaErrada = await criar({ nome: 'Loja Errada', usuario: 'lojaerrada', senha: 'senha1234', perfil: 'operador', loja: 'XPTO' });
    assert.strictEqual(lojaErrada.status, 400, 'loja inexistente precisa ser recusada');

    const g = await criar({ nome: 'Gerente Filial', usuario: 'gerente.filial', senha: 'gerente123', perfil: 'gerente', loja: 'FILIAL' });
    assert.strictEqual(g.status, 200, JSON.stringify(g.corpo));
    assert.strictEqual(g.corpo.loja, 'FILIAL');
    assert.strictEqual(g.corpo.perfilRotulo, 'Gerente');
    assert.strictEqual(g.corpo.permissoes.verTodasAsLojas, false);
    gerenteFilial = g.corpo;

    const m = await criar({ nome: 'Mecânico Unicar', usuario: 'mecanico.unicar', senha: 'mecanico123', perfil: 'mecanico', loja: 'UNICAR' });
    assert.strictEqual(m.status, 200, JSON.stringify(m.corpo));
    mecanicoUnicar = m.corpo;

    const o = await criar({ nome: 'Operador Filial', usuario: 'operador.filial', senha: 'operador123', perfil: 'operador', loja: 'FILIAL' });
    assert.strictEqual(o.status, 200, JSON.stringify(o.corpo));

    // o gerente entra, mas não cria usuários
    const loginGerente = await entrar(base, 'gerente.filial', 'gerente123');
    assert.strictEqual(loginGerente.status, 200, 'o gerente precisa conseguir entrar');
    const tentativa = await pedir(base, '/api/usuarios', {
      metodo: 'POST',
      cabecalhos: { cookie: loginGerente.cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({ nome: 'Outro', usuario: 'outro', senha: 'senha1234', perfil: 'admin', loja: 'FILIAL' }),
    });
    assert.strictEqual(tentativa.status, 403, 'gerente não pode criar usuários');
  });

  // ------------------------------------------------ isolamento entre as lojas
  await t.test('USUÁRIO DE UMA LOJA NÃO ACESSA OS DE OUTRA (no servidor)', async () => {
    const loginGerente = await entrar(base, 'gerente.filial', 'gerente123');
    const cab = { cookie: loginGerente.cookie, 'content-type': 'application/json' };

    const daUnicar = osCriadas.UNICAR;
    const verOutra = await pedir(base, `/api/os/${daUnicar.numero}`, { cabecalhos: cab });
    assert.strictEqual(verOutra.status, 403, 'ver OS de outra loja precisa dar 403');

    const editarOutra = await pedir(base, `/api/os/${daUnicar.numero}`, {
      metodo: 'PUT', cabecalhos: cab, corpo: JSON.stringify({ observacoesInternas: 'tentativa' }),
    });
    assert.strictEqual(editarOutra.status, 403, 'editar OS de outra loja precisa dar 403');

    const cancelarOutra = await pedir(base, `/api/os/${daUnicar.numero}/cancelar`, {
      metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ motivo: 'tentativa' }),
    });
    assert.strictEqual(cancelarOutra.status, 403, 'cancelar OS de outra loja precisa dar 403');

    const imprimirOutra = await pedir(base, `/api/os/${daUnicar.numero}/imprimir`, { cabecalhos: cab });
    assert.strictEqual(imprimirOutra.status, 403, 'imprimir OS de outra loja precisa dar 403');

    const lista = await pedir(base, '/api/os', { cabecalhos: cab });
    assert.strictEqual(lista.status, 200);
    assert.ok(lista.corpo.os.length > 0, 'o gerente precisa ver as OS da loja dele');
    assert.ok(lista.corpo.os.every((o) => o.loja === 'FILIAL'), `só podia vir FILIAL: ${JSON.stringify(lista.corpo.os.map((o) => o.loja))}`);

    const filial = osCriadas.FILIAL;
    const verMesma = await pedir(base, `/api/os/${filial.numero}`, { cabecalhos: cab });
    assert.strictEqual(verMesma.status, 200);
    assert.strictEqual(verMesma.corpo.os.numero, filial.numero);

    // filtro por outra loja na lista não pode furar o isolamento
    const listaForcando = await pedir(base, '/api/os?loja=UNICAR', { cabecalhos: cab });
    assert.ok(listaForcando.corpo.os.every((o) => o.loja === 'FILIAL'), 'filtro por outra loja precisa ser ignorado');
  });

  await t.test('ADMINISTRADOR acessa as três lojas', async () => {
    const lista = await pedir(base, '/api/os', { cabecalhos: { cookie: admin.cookie } });
    const lojas = new Set(lista.corpo.os.map((o) => o.loja));
    assert.deepStrictEqual([...lojas].sort(), ['FILIAL', 'MATRIZ', 'UNICAR']);
    const consolidado = await pedir(base, '/api/painel/consolidado', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(consolidado.status, 200);
    assert.strictEqual(consolidado.corpo.lojas.length, 3);
    const soFilial = await pedir(base, '/api/os?loja=FILIAL', { cabecalhos: { cookie: admin.cookie } });
    assert.ok(soFilial.corpo.os.every((o) => o.loja === 'FILIAL'));
  });

  // ------------------------------------------------------------------ painel
  await t.test('painel: cada loja vê só os seus números', async () => {
    const loginGerente = await entrar(base, 'gerente.filial', 'gerente123');
    const pGerente = await pedir(base, '/api/painel', { cabecalhos: { cookie: loginGerente.cookie } });
    assert.strictEqual(pGerente.status, 200);
    assert.strictEqual(pGerente.corpo.loja, 'FILIAL');
    assert.strictEqual(pGerente.corpo.total, 1, 'o gerente da FILIAL só podia ver 1 OS');
    assert.strictEqual(pGerente.corpo.porLoja, undefined, 'gerente não recebe o resumo das outras lojas');

    const forcando = await pedir(base, '/api/painel?loja=UNICAR', { cabecalhos: { cookie: loginGerente.cookie } });
    assert.strictEqual(forcando.corpo.loja, 'FILIAL', 'gerente não consegue pedir o painel de outra loja');

    const semPermissao = await pedir(base, '/api/painel/consolidado', { cabecalhos: { cookie: loginGerente.cookie } });
    assert.strictEqual(semPermissao.status, 403, 'relatório consolidado é só do administrador');

    const pAdmin = await pedir(base, '/api/painel', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(pAdmin.status, 200);
    assert.ok(pAdmin.corpo.total >= 4, 'o admin vê todas as OS');
    assert.strictEqual(Array.isArray(pAdmin.corpo.porLoja), true, 'o admin recebe o resumo por loja');
    assert.ok(pAdmin.corpo.porLoja.length === 3);
    assert.ok(Array.isArray(pAdmin.corpo.pendentes));
    assert.ok(Array.isArray(pAdmin.corpo.clientesRecentes));
    assert.ok(Array.isArray(pAdmin.corpo.servicosMaisRealizados));
  });

  // -------------------------------------------------------- status e histórico
  await t.test('mudar status, editar e cancelar — com histórico e auditoria', async () => {
    const alvo = osCriadas.FILIAL;
    const loginGerente = await entrar(base, 'gerente.filial', 'gerente123');
    const cab = { cookie: loginGerente.cookie, 'content-type': 'application/json' };

    const avanco = await pedir(base, `/api/os/${alvo.numero}/status`, {
      metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'Em execução' }),
    });
    assert.strictEqual(avanco.status, 200, JSON.stringify(avanco.corpo));
    assert.strictEqual(avanco.corpo.os.status, 'em execucao', 'o status precisa ser normalizado');

    const edicao = await pedir(base, `/api/os/${alvo.numero}`, {
      metodo: 'PUT', cabecalhos: cab, corpo: JSON.stringify({ observacoesInternas: 'Aguardando a peça chegar' }),
    });
    assert.strictEqual(edicao.status, 200);
    assert.ok(edicao.corpo.os.historico.length >= 3, 'o histórico precisa acumular, nunca apagar');
    assert.ok(edicao.corpo.os.historico.some((h) => h.acao === 'abertura'), 'o registro da abertura precisa continuar lá');

    const semMotivo = await pedir(base, `/api/os/${alvo.numero}/cancelar`, {
      metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ motivo: '' }),
    });
    assert.strictEqual(semMotivo.status, 400, 'cancelar sem motivo precisa ser recusado');

    const cancelada = await pedir(base, `/api/os/${alvo.numero}/cancelar`, {
      metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ motivo: 'Cliente desistiu do serviço' }),
    });
    assert.strictEqual(cancelada.status, 200, JSON.stringify(cancelada.corpo));
    assert.strictEqual(cancelada.corpo.os.status, 'cancelada');
    assert.strictEqual(cancelada.corpo.os.cancelamento.motivo, 'Cliente desistiu do serviço');
    assert.strictEqual(cancelada.corpo.os.cancelamento.usuario, 'Gerente Filial');

    const dados = JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
    const daOS = dados.auditoria.filter((a) => a.entidade === 'os' && a.resumo.includes('OS-FILIAL'));
    assert.ok(daOS.some((a) => a.acao === 'cancelar'), 'o cancelamento precisa ficar na auditoria');
    assert.ok(daOS.every((a) => a.loja === 'FILIAL'));
  });

  await t.test('operador não cancela; mecânico só mexe em serviço/observação das OS dele', async () => {
    const loginOperador = await entrar(base, 'operador.filial', 'operador123');
    const cabOperador = { cookie: loginOperador.cookie, 'content-type': 'application/json' };
    const nova = await pedir(base, '/api/os', {
      metodo: 'POST', cabecalhos: cabOperador,
      corpo: JSON.stringify({ cliente: { nome: 'Cliente do Operador' }, itens: [{ tipo: 'mao de obra', descricao: 'Montagem', quantidade: 1, valorUnitario: 80 }] }),
    });
    assert.strictEqual(nova.status, 200, 'operador precisa poder abrir OS');
    assert.strictEqual(nova.corpo.os.loja, 'FILIAL', 'operador não escolhe loja: fica na dele');

    const cancelar = await pedir(base, `/api/os/${nova.corpo.os.numero}/cancelar`, {
      metodo: 'POST', cabecalhos: cabOperador, corpo: JSON.stringify({ motivo: 'teste' }),
    });
    assert.strictEqual(cancelar.status, 403, 'operador não pode cancelar');

    // mecânico da UNICAR: OS de outra loja e OS não atribuída
    const loginMecanico = await entrar(base, 'mecanico.unicar', 'mecanico123');
    const cabMecanico = { cookie: loginMecanico.cookie, 'content-type': 'application/json' };
    const verOutraLoja = await pedir(base, `/api/os/${nova.corpo.os.numero}`, { cabecalhos: cabMecanico });
    assert.strictEqual(verOutraLoja.status, 403, 'mecânico não vê OS de outra loja');

    const naoAtribuida = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}`, { cabecalhos: cabMecanico });
    assert.strictEqual(naoAtribuida.status, 403, 'mecânico só vê as OS atribuídas a ele');

    const listaMecanico = await pedir(base, '/api/os', { cabecalhos: cabMecanico });
    assert.strictEqual(listaMecanico.corpo.os.length, 0, 'sem OS atribuída, a lista dele fica vazia');

    // admin atribui uma OS da UNICAR ao mecânico
    const atribuir = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}`, {
      metodo: 'PUT', cabecalhos: comoAdmin, corpo: JSON.stringify({ mecanicoId: mecanicoUnicar.id }),
    });
    assert.strictEqual(atribuir.status, 200, JSON.stringify(atribuir.corpo));
    const agoraVe = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}`, { cabecalhos: cabMecanico });
    assert.strictEqual(agoraVe.status, 200, 'depois de atribuída, o mecânico precisa ver a OS');

    const mexerEmValores = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}`, {
      metodo: 'PUT', cabecalhos: cabMecanico, corpo: JSON.stringify({ itens: [{ tipo: 'peca', descricao: 'Troca', quantidade: 1, valorUnitario: 10 }] }),
    });
    assert.strictEqual(mexerEmValores.status, 403, 'mecânico não altera valores');

    const mexerNoTecnico = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}`, {
      metodo: 'PUT', cabecalhos: cabMecanico, corpo: JSON.stringify({ observacoesInternas: 'Serviço iniciado às 14h' }),
    });
    assert.strictEqual(mexerNoTecnico.status, 200, 'mecânico atualiza observação técnica');

    // a parte técnica inclui andar com o status da PRÓPRIA OS (a tela oferece as mesmas opções)
    const paraExecucao = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}/status`, {
      metodo: 'POST', cabecalhos: cabMecanico, corpo: JSON.stringify({ status: 'Em execução' }),
    });
    assert.strictEqual(paraExecucao.status, 200, 'mecânico responsável coloca a OS dele em execução');

    const entregar = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}/status`, {
      metodo: 'POST', cabecalhos: cabMecanico, corpo: JSON.stringify({ status: 'Entregue' }),
    });
    assert.strictEqual(entregar.status, 403, 'entregar a OS ao cliente não é papel do mecânico');

    const mecanicoCancela = await pedir(base, `/api/os/${osCriadas.UNICAR.numero}/cancelar`, {
      metodo: 'POST', cabecalhos: cabMecanico, corpo: JSON.stringify({ motivo: 'nao pode' }),
    });
    assert.strictEqual(mecanicoCancela.status, 403, 'mecânico não cancela OS');
  });

  // ------------------------------------------------------ impressão e exportação
  await t.test('impressão e CSV saem com os dados da OS', async () => {
    const alvo = osCriadas.MATRIZ;
    const impressao = await pedir(base, `/api/os/${alvo.numero}/imprimir`, { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(impressao.status, 200);
    assert.match(impressao.corpo, new RegExp(alvo.numero));
    assert.match(impressao.corpo, /Cliente MATRIZ/);
    assert.match(impressao.corpo, /window\.print/);
    // v2.1.3: o cabeçalho passou a ser a LOGO da loja + "ORDEM DE SERVIÇO Nº ..."
    assert.match(impressao.corpo, /\/logos\/loja_MATRIZ_logo\.webp/, 'a logo da loja precisa aparecer na folha');
        assert.ok(!impressao.corpo.includes('/logos/loja_UNICAR_logo.webp'), 'a folha da MATRIZ não pode trazer a logo da UNICAR');
    assert.match(impressao.corpo, /ORDEM DE SERVIÇO/, 'o título do documento precisa aparecer');
    assert.match(impressao.corpo, /Nº <b>OS-MATRIZ-/, 'o número da OS precisa aparecer em destaque');
    assert.match(impressao.corpo, /VIA DO CLIENTE/);
    assert.match(impressao.corpo, /VIA DA LOJA/);

    const csv = await pedir(base, '/api/os-exportar.csv', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(csv.status, 200);
    assert.match(csv.corpo, /Numero;Loja;Status/);
    assert.match(csv.corpo, new RegExp(alvo.numero));

    const csvGerente = await entrar(base, 'gerente.filial', 'gerente123');
    const csvFilial = await pedir(base, '/api/os-exportar.csv', { cabecalhos: { cookie: csvGerente.cookie } });
    assert.ok(!csvFilial.corpo.includes('OS-UNICAR'), 'o CSV do gerente não pode trazer OS de outra loja');
  });

  // ------------------------------------------------- funções antigas continuam
  await t.test('as funções antigas do estoque continuam funcionando', async () => {
    const estado = await pedir(base, '/api/state', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(estado.status, 200);
    assert.strictEqual(estado.corpo.pneus.length, antes.pneus.length, 'o estoque precisa continuar igual');
    assert.strictEqual(estado.corpo.movimentos.length, antes.movimentos.length);
    assert.strictEqual(estado.corpo.bebidas.length, antes.bebidas.length);
    assert.strictEqual(estado.corpo.garantias.length, antes.garantias.length);
    assert.strictEqual(estado.corpo.usuarios, undefined, 'usuários continuam fora do estado público');
    assert.strictEqual(estado.corpo.os, undefined, 'OS não vão no estado geral (carregadas pela API)');

    const novo = await pedir(base, '/api/pneus', {
      metodo: 'POST', cabecalhos: comoAdmin,
      corpo: JSON.stringify({ marca: 'Teste OS', medida: '999/99 R99', quantidade: 1 }),
    });
    assert.strictEqual(novo.status, 200, 'cadastrar pneu precisa continuar funcionando');
    const excluir = await pedir(base, `/api/pneus/${novo.corpo.id}`, { metodo: 'DELETE', cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(excluir.status, 200);

    const auditoria = await pedir(base, '/api/auditoria', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(auditoria.status, 200);
    assert.ok(auditoria.corpo.length > 0);

    const usuarios = await pedir(base, '/api/usuarios', { cabecalhos: { cookie: admin.cookie } });
    assert.strictEqual(usuarios.status, 200);
    assert.ok(usuarios.corpo.every((u) => !('senhaHash' in u)), 'a lista de usuários nunca devolve senha');
    assert.ok(usuarios.corpo.every((u) => 'loja' in u), 'a lista de usuários precisa trazer a loja');
  });
});

test('migração: aplica, não perde nada, é reversível e recusa reverter com OS', async () => {
  const original = JSON.parse(fs.readFileSync(REFERENCIA, 'utf-8'));

  // 1) o dado que já existia continua idêntico, campo por campo (só ganha "loja")
  const copia = JSON.parse(JSON.stringify(original));
  migracao.aplicar(copia);
  for (const colecao of ['pneus', 'movimentos', 'garantias', 'bebidas', 'bebidasMov', 'usuarios', 'sessoes', 'auditoria']) {
    assert.strictEqual(copia[colecao].length, original[colecao].length, `${colecao} mudou de tamanho`);
    copia[colecao].forEach((registro, i) => {
      const antes = { ...registro };
      delete antes.loja;
      assert.deepStrictEqual(antes, original[colecao][i], `${colecao}[${i}] foi alterado pela migração`);
    });
  }
  assert.strictEqual(copia.os.length, 0, 'a migração não cria OS fictícia');
  assert.strictEqual(copia.lojas.length, 3);

  // 2) o administrador atual ganha acesso a todas as lojas; os outros ficam na loja padrão
  const admin = copia.usuarios.find((u) => u.perfil === 'admin');
  assert.strictEqual(admin.loja, null);
  assert.ok(copia.usuarios.filter((u) => u.perfil !== 'admin').every((u) => u.loja === 'UNICAR'));

  // 3) aplicar duas vezes não estraga nada (é idempotente)
  const segunda = JSON.parse(JSON.stringify(copia));
  const relatorio = migracao.aplicar(segunda);
  assert.strictEqual(relatorio.jaMigrado, true, 'a segunda aplicação precisa ser reconhecida como já migrada');
  assert.deepStrictEqual(segunda.pneus, copia.pneus);

  // 4) reverter devolve o formato antigo, sem perder registro
  const paraReverter = JSON.parse(JSON.stringify(copia));
  const resultado = migracao.reverter(paraReverter);
  assert.strictEqual(resultado.revertida, true);
  assert.strictEqual(paraReverter.os, undefined);
  assert.strictEqual(paraReverter.lojas, undefined);
  assert.strictEqual(paraReverter.schemaVersao, 1);
  for (const colecao of ['pneus', 'movimentos', 'usuarios', 'auditoria']) {
    assert.strictEqual(paraReverter[colecao].length, original[colecao].length);
    assert.ok(paraReverter[colecao].every((r) => r.loja === undefined), `${colecao} ainda tem o campo loja`);
  }

  // 5) com OS cadastrada, a reversão é recusada (não apaga trabalho real)
  const comOS = JSON.parse(JSON.stringify(copia));
  comOS.os.push({ id: 'x', numero: 'OS-UNICAR-000001', loja: 'UNICAR' });
  const recusada = migracao.reverter(comOS);
  assert.strictEqual(recusada.recusada, true);
  assert.match(recusada.motivo, /OS/i);
  assert.strictEqual(comOS.os.length, 1, 'nada pode ser apagado quando a reversão é recusada');
});

test('permissões: a tabela de cada perfil está coerente', () => {
  const { pode, PERFIS, normalizarPerfil, normalizarStatus, veTodasAsLojas, podeAcessarLoja } = require('../permissoes');

  assert.deepStrictEqual(PERFIS, ['admin', 'gerente', 'operador', 'mecanico']);
  assert.strictEqual(normalizarPerfil('Administrador'), 'admin');
  assert.strictEqual(normalizarPerfil('GERENTE'), 'gerente');
  assert.strictEqual(normalizarPerfil('Operador/Atendente'), 'operador');
  assert.strictEqual(normalizarPerfil('Mecânico/Técnico'), 'mecanico');
  assert.strictEqual(normalizarPerfil('qualquer coisa'), 'operador', 'perfil desconhecido cai no mais restrito possível');

  assert.strictEqual(pode('admin', 'administrarUsuarios'), true);
  assert.strictEqual(pode('gerente', 'administrarUsuarios'), false, 'gerente não administra usuários');
  assert.strictEqual(pode('gerente', 'cancelarOS'), true);
  assert.strictEqual(pode('operador', 'cancelarOS'), false, 'operador não cancela');
  assert.strictEqual(pode('mecanico', 'editarOS'), true);
  assert.strictEqual(pode('mecanico', 'editarValores'), false, 'mecânico não mexe em valores');
  assert.strictEqual(pode('mecanico', 'criarOS'), false, 'mecânico não abre OS');

  assert.strictEqual(veTodasAsLojas({ perfil: 'admin' }), true);
  assert.strictEqual(veTodasAsLojas({ perfil: 'gerente', loja: 'FILIAL' }), false);
  assert.strictEqual(podeAcessarLoja({ perfil: 'admin', loja: null }, 'MATRIZ'), true);
  assert.strictEqual(podeAcessarLoja({ perfil: 'gerente', loja: 'FILIAL' }, 'FILIAL'), true);
  assert.strictEqual(podeAcessarLoja({ perfil: 'gerente', loja: 'FILIAL' }, 'MATRIZ'), false);
  assert.strictEqual(podeAcessarLoja({ perfil: 'gerente', loja: null }, 'FILIAL'), false, 'sem loja não acessa nada');

  // status: aceita como as pessoas escrevem
  assert.strictEqual(normalizarStatus('Em execução'), 'em execucao');
  assert.strictEqual(normalizarStatus('AGUARDANDO APROVAÇÃO'), 'aguardando aprovacao');
  assert.strictEqual(normalizarStatus('aguardando aprovacao'), 'aguardando aprovacao');
  assert.strictEqual(normalizarStatus('entregue'), 'entregue');
  assert.strictEqual(normalizarStatus('inventado'), '', 'status inventado é recusado');
});
