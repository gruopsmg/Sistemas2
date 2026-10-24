// Testes da BAIXA AUTOMÁTICA DE ESTOQUE pela Ordem de Serviço.
// Cobre, uma por uma, as regras definidas pelo dono do sistema:
//   1. baixa ao mudar para "Em execução"
//   2. nenhuma baixa duplicada
//   3. bloqueio por estoque insuficiente (mostrando o que falta)
//   4. baixa somente da diferença ao aumentar quantidade
//   5. estorno ao reduzir ou remover item
//   6. estorno ao cancelar a OS
//   7. auditoria completa (histórico da OS + log de auditoria)
//   8. isolamento de acesso entre lojas (estoque continua compartilhado)
//   9. funções antigas continuam funcionando
//
// Roda sobre uma CÓPIA do data.json real (migrada), em pasta temporária. O arquivo
// original nunca é tocado — e a senha de teste só existe nessa cópia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { novaPasta, subirServidor, pedir, entrar } = require('./ajuda');
const migracao = require('../migracoes/001_lojas_os');

const REFERENCIA = process.env.UNICAR_DADOS_REFERENCIA
  || path.join(__dirname, '..', '..', 'app-unicar', 'data.json');

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(senha), salt, 64).toString('hex')}`;
}

function preparar() {
  const pasta = novaPasta();
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  migracao.aplicar(dados);
  const admin = dados.usuarios.find((u) => u.perfil === 'admin');
  admin.senhaHash = hashSenha('teste123');
  admin.precisaTrocarSenha = false;
  // um segundo admin não é necessário; garante que não há OS sobrando
  dados.os = [];
  dados.osSequencia = { UNICAR: 0, FILIAL: 0, MATRIZ: 0 };
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return { pasta, dados };
}

const lerDados = (pasta) => JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));
const estoqueDe = (dados, pneuId) => Number(dados.pneus.find((p) => p.id === pneuId).quantidade);
const movimentosOS = (dados, numero) => dados.movimentos.filter((m) => m.origem === 'os' && m.osNumero === numero);

const PORTA = 5600 + crypto.randomInt(0, 300);

test('baixa automática de estoque na Ordem de Serviço', async (t) => {
  const { pasta, dados: iniciais } = preparar();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  const login = await entrar(base, 'admin', 'teste123');
  assert.strictEqual(login.status, 200);
  const cab = { cookie: login.cookie, 'content-type': 'application/json' };

  // Escolhe um pneu e uma bebida com estoque para os testes
  const pneu = iniciais.pneus.find((p) => Number(p.quantidade) >= 10);
  const bebida = iniciais.bebidas.find((b) => Number(b.quantidade) >= 3);
  assert.ok(pneu, 'precisa existir um pneu com estoque no dado de teste');
  const estoqueInicial = estoqueDe(iniciais, pneu.id);
  const estoqueBebidaInicial = bebida ? Number(bebida.quantidade) : 0;

  const criarOS = async (corpo) => {
    const r = await pedir(base, '/api/os', { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify(corpo) });
    assert.strictEqual(r.status, 200, `criar OS: ${JSON.stringify(r.corpo)}`);
    return r.corpo.os;
  };

  let osPneu = null;
  let itemPneuId = null;

  // ------------------------------------------------------------------ 1) baixa
  await t.test('1) baixa ao mudar para "Em execução" (com a movimentação completa)', async () => {
    osPneu = await criarOS({
      loja: 'UNICAR',
      cliente: { nome: 'Cliente Baixa', telefone: '22999990000' },
      veiculo: { placa: 'BAI-1234' },
      itens: [
        { tipo: 'pneu', descricao: 'Pneu teste baixa', quantidade: 2, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' },
        { tipo: 'mao de obra', descricao: 'Montagem', quantidade: 1, valorUnitario: 80 },
      ],
    });
    itemPneuId = osPneu.itens.find((i) => i.estoqueId === pneu.id).id;

    const antes = lerDados(pasta);
    assert.strictEqual(estoqueDe(antes, pneu.id), estoqueInicial, 'a OS criada ainda não pode mexer no estoque');

    const r = await pedir(base, `/api/os/${osPneu.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'Em execução' }) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.os.status, 'em execucao');

    const depois = lerDados(pasta);
    assert.strictEqual(estoqueDe(depois, pneu.id), estoqueInicial - 2, 'o estoque precisa cair 2 unidades');

    const movs = movimentosOS(depois, osPneu.numero);
    assert.strictEqual(movs.length, 1, 'uma movimentação de saída');
    const mov = movs[0];
    assert.strictEqual(mov.tipo, 'saida');
    assert.strictEqual(mov.quantidade, 2);
    assert.strictEqual(mov.loja, 'UNICAR');
    assert.strictEqual(mov.pneuId, pneu.id);
    assert.strictEqual(mov.itemId, itemPneuId);
    assert.strictEqual(mov.usuario, 'Administrador');
    assert.ok(mov.criadoEm > 0, 'precisa ter data e hora');
    assert.strictEqual(mov.estoqueApos, estoqueInicial - 2, 'a movimentação guarda o estoque depois');

    const osSalva = depois.os.find((o) => o.id === osPneu.id);
    assert.strictEqual(osSalva.baixas.length, 1);
    assert.strictEqual(osSalva.baixas[0].quantidade, 2);
    assert.strictEqual(osSalva.baixas[0].estoqueId, pneu.id);
  });

  await t.test('1b) item vinculado a bebida lança no histórico de bebidas', async () => {
    if (!bebida) return t.skip('sem bebida com estoque no dado de teste');
    const os = await criarOS({
      loja: 'UNICAR',
      cliente: { nome: 'Cliente Bebida' },
      itens: [{ tipo: 'produto', descricao: bebida.nome, quantidade: 1, valorUnitario: 10, estoqueId: bebida.id, estoqueTipo: 'bebidas' }],
    });
    const r = await pedir(base, `/api/os/${os.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const depois = lerDados(pasta);
    const b = depois.bebidas.find((x) => x.id === bebida.id);
    assert.strictEqual(Number(b.quantidade), estoqueBebidaInicial - 1, 'a bebida precisa cair 1 unidade');
    const movs = depois.bebidasMov.filter((m) => m.origem === 'os' && m.osNumero === os.numero);
    assert.strictEqual(movs.length, 1, 'a saída de bebida vai para o histórico de bebidas');
    assert.strictEqual(movs[0].tipo, 'saida');
    assert.ok(String(movs[0].destino).includes(os.numero), 'o destino aponta para a OS');
  });

  // -------------------------------------------------------- 2) não duplicar
  await t.test('2) NENHUMA baixa duplicada (salvar de novo / editar não baixa outra vez)', async () => {
    const antes = lerDados(pasta);

    // mudar o status para o MESMO valor
    const mesmo = await pedir(base, `/api/os/${osPneu.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(mesmo.status, 200);
    // ir e voltar de status (continua em execução e volta)
    await pedir(base, `/api/os/${osPneu.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'aguardando peca' }) });
    await pedir(base, `/api/os/${osPneu.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    // editar sem mudar quantidade
    const editado = await pedir(base, `/api/os/${osPneu.id}`, {
      metodo: 'PUT', cabecalhos: cab,
      corpo: JSON.stringify({
        cliente: { nome: 'Cliente Baixa', telefone: '22999990000', observacoes: 'nada' },
        itens: [
          { id: itemPneuId, tipo: 'pneu', descricao: 'Pneu teste baixa', quantidade: 2, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' },
          { tipo: 'mao de obra', descricao: 'Montagem', quantidade: 1, valorUnitario: 80 },
        ],
      }),
    });
    assert.strictEqual(editado.status, 200, JSON.stringify(editado.corpo));

    const depois = lerDados(pasta);
    assert.strictEqual(estoqueDe(depois, pneu.id), estoqueDe(antes, pneu.id), 'o estoque não pode mudar');
    assert.strictEqual(movimentosOS(depois, osPneu.numero).length, 1, 'não pode aparecer outra movimentação');
  });

  // ------------------------------------------------------ 3) sem estoque
  await t.test('3) BLOQUEIA por estoque insuficiente e mostra o que falta', async () => {
    const disponivel = estoqueDe(lerDados(pasta), pneu.id);
    const os = await criarOS({
      loja: 'UNICAR',
      cliente: { nome: 'Cliente Sem Estoque' },
      itens: [{ tipo: 'pneu', descricao: 'Pneu demais', quantidade: disponivel + 5, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }],
    });

    const r = await pedir(base, `/api/os/${os.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(r.status, 400, 'a mudança de status precisa ser bloqueada');
    assert.match(r.corpo.error, /estoque insuficiente/i);
    assert.ok(Array.isArray(r.corpo.faltando) && r.corpo.faltando.length === 1, 'precisa dizer o que falta');
    assert.strictEqual(r.corpo.faltando[0].disponivel, disponivel);
    assert.strictEqual(r.corpo.faltando[0].necessario, disponivel + 5);
    assert.strictEqual(r.corpo.faltando[0].faltam, 5);

    const depois = lerDados(pasta);
    assert.strictEqual(estoqueDe(depois, pneu.id), disponivel, 'o estoque não pode mudar');
    assert.strictEqual(depois.os.find((o) => o.id === os.id).status, 'aberta', 'o status não pode mudar');
    assert.strictEqual(movimentosOS(depois, os.numero).length, 0, 'não pode criar movimentação');

    // a conferência (sem alterar nada) também avisa
    const conferir = await pedir(base, `/api/os/${os.id}/conferir-estoque`, { metodo: 'POST', cabecalhos: cab, corpo: '{}' });
    assert.strictEqual(conferir.status, 200);
    assert.strictEqual(conferir.corpo.ok, false);
    assert.strictEqual(conferir.corpo.faltando[0].faltam, 5);

    // e depois de repor o estoque, entra em execução normalmente
    const repor = await pedir(base, `/api/movimentos`, {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ pneuId: pneu.id, tipo: 'entrada', quantidade: 10, motivo: 'reposição para teste' }),
    });
    assert.strictEqual(repor.status, 200);
    const agora = await pedir(base, `/api/os/${os.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(agora.status, 200, 'com estoque reposto precisa funcionar');
    const fim = lerDados(pasta);
    assert.strictEqual(estoqueDe(fim, pneu.id), disponivel + 10 - (disponivel + 5), 'baixa o que a OS pede');
    // desfaz para não atrapalhar os próximos testes
    await pedir(base, `/api/os/${os.id}/cancelar`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ motivo: 'fim do teste de bloqueio' }) });
  });

  // --------------------------------------------- 4) aumento: só a diferença
  await t.test('4) aumento de quantidade baixa SOMENTE a diferença', async () => {
    const antes = lerDados(pasta);
    const atual = estoqueDe(antes, pneu.id);
    const baixaAntes = movimentosOS(antes, osPneu.numero).length;

    // de 2 para 5 → precisa baixar 3
    const r = await pedir(base, `/api/os/${osPneu.id}`, {
      metodo: 'PUT', cabecalhos: cab,
      corpo: JSON.stringify({
        itens: [
          { id: itemPneuId, tipo: 'pneu', descricao: 'Pneu teste baixa', quantidade: 5, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' },
        ],
      }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));

    const depois = lerDados(pasta);
    assert.strictEqual(estoqueDe(depois, pneu.id), atual - 3, 'baixou exatamente 3 (5 - 2)');
    const movs = movimentosOS(depois, osPneu.numero);
    assert.strictEqual(movs.length, baixaAntes + 1);
    const ultima = movs[0]; // mais recente
    assert.strictEqual(ultima.tipo, 'saida');
    assert.strictEqual(ultima.quantidade, 3, 'a movimentação é só da diferença');
    assert.strictEqual(depois.os.find((o) => o.id === osPneu.id).baixas[0].quantidade, 5);
  });

  // ------------------------------------------- 5) redução e remoção: estorno
  await t.test('5) reduzir e remover item gera ESTORNO (sem apagar a movimentação original)', async () => {
    const antes = lerDados(pasta);
    const atual = estoqueDe(antes, pneu.id);
    const saidasAntes = movimentosOS(antes, osPneu.numero).filter((m) => m.tipo === 'saida').length;

    // de 5 para 2 → devolve 3
    const reduz = await pedir(base, `/api/os/${osPneu.id}`, {
      metodo: 'PUT', cabecalhos: cab,
      corpo: JSON.stringify({ itens: [{ id: itemPneuId, tipo: 'pneu', descricao: 'Pneu teste baixa', quantidade: 2, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }] }),
    });
    assert.strictEqual(reduz.status, 200, JSON.stringify(reduz.corpo));
    let depois = lerDados(pasta);
    assert.strictEqual(estoqueDe(depois, pneu.id), atual + 3, 'voltou 3 para o estoque');
    let movs = movimentosOS(depois, osPneu.numero);
    assert.strictEqual(movs.filter((m) => m.tipo === 'entrada').length, 1, 'uma entrada de estorno');
    assert.strictEqual(movs.filter((m) => m.tipo === 'saida').length, saidasAntes, 'as saídas antigas continuam lá');

    // agora remove o item da OS → devolve o resto
    const antes2 = lerDados(pasta);
    const atual2 = estoqueDe(antes2, pneu.id);
    const remove = await pedir(base, `/api/os/${osPneu.id}`, {
      metodo: 'PUT', cabecalhos: cab,
      corpo: JSON.stringify({ itens: [{ tipo: 'mao de obra', descricao: 'Apenas serviço', quantidade: 1, valorUnitario: 80 }] }),
    });
    assert.strictEqual(remove.status, 200, JSON.stringify(remove.corpo));
    depois = lerDados(pasta);
    assert.strictEqual(estoqueDe(depois, pneu.id), atual2 + 2, 'o item removido devolveu as 2 unidades');
    const osFinal = depois.os.find((o) => o.id === osPneu.id);
    assert.strictEqual(osFinal.baixas[0].quantidade, 0, 'não há mais saldo baixado');
    assert.strictEqual(osFinal.baixas.length, 1, 'o controle não se fragmenta: 1 registro por item da OS');
    assert.ok(movimentosOS(depois, osPneu.numero).length >= 4, 'todas as movimentações continuam registradas');
  });

  // ------------------------------------------------------- 6) cancelar
  await t.test('6) cancelar a OS estorna tudo o que estava baixado', async () => {
    // A OS é da MATRIZ: primeiro manda 5 unidades para lá (estoque é por loja), senão
    // a baixa é bloqueada — e o que este teste quer provar é o estorno do cancelamento.
    const transferir = await pedir(base, '/api/estoque/transferir', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ pneuId: pneu.id, de: 'UNICAR', para: 'MATRIZ', quantidade: 5, confirmadoPor: 'Conferente Teste' }),
    });
    assert.strictEqual(transferir.status, 200, JSON.stringify(transferir.corpo));

    const os = await criarOS({
      loja: 'MATRIZ',
      cliente: { nome: 'Cliente Cancelamento' },
      itens: [{ tipo: 'pneu', descricao: 'Pneu cancelamento', quantidade: 3, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }],
    });
    const disponivel = estoqueDe(lerDados(pasta), pneu.id);

    const exec = await pedir(base, `/api/os/${os.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(exec.status, 200, JSON.stringify(exec.corpo));
    let dados = lerDados(pasta);
    assert.strictEqual(estoqueDe(dados, pneu.id), disponivel - 3, 'baixou 3 (da loja MATRIZ)');

    const cancelar = await pedir(base, `/api/os/${os.id}/cancelar`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ motivo: 'cliente desistiu' }) });
    assert.strictEqual(cancelar.status, 200, JSON.stringify(cancelar.corpo));

    dados = lerDados(pasta);
    assert.strictEqual(estoqueDe(dados, pneu.id), disponivel, 'o estoque voltou ao que era antes da baixa');
    const movs = movimentosOS(dados, os.numero);
    assert.strictEqual(movs.filter((m) => m.tipo === 'saida').length, 1, 'a saída original continua registrada');
    assert.strictEqual(movs.filter((m) => m.tipo === 'entrada').length, 1, 'com uma entrada de estorno do cancelamento');
    assert.strictEqual(dados.os.find((o) => o.id === os.id).baixas[0].quantidade, 0, 'nada mais baixado');
  });

  // ------------------------------------------------------- 7) auditoria
  await t.test('7) AUDITORIA e histórico registram baixas, alterações e estornos', async () => {
    const dados = lerDados(pasta);
    const auditoriaBaixa = dados.auditoria.filter((a) => a.acao === 'baixar-estoque');
    const auditoriaEstorno = dados.auditoria.filter((a) => a.acao === 'estornar-estoque');
    assert.ok(auditoriaBaixa.length >= 3, `precisa haver baixas na auditoria (tem ${auditoriaBaixa.length})`);
    assert.ok(auditoriaEstorno.length >= 3, `precisa haver estornos na auditoria (tem ${auditoriaEstorno.length})`);
    for (const a of [...auditoriaBaixa, ...auditoriaEstorno]) {
      assert.strictEqual(a.entidade, 'os');
      assert.ok(a.loja, 'a auditoria precisa dizer a loja');
      assert.ok(a.usuarioId, 'a auditoria precisa dizer o usuário');
      assert.match(a.resumo, /OS-/);
    }

    const osSalva = dados.os.find((o) => o.id === osPneu.id);
    assert.ok(osSalva.historico.some((h) => h.acao === 'baixar-estoque'), 'o histórico da OS precisa da baixa');
    assert.ok(osSalva.historico.some((h) => h.acao === 'estornar-estoque'), 'o histórico da OS precisa do estorno');
    assert.ok(osSalva.historico.some((h) => h.acao === 'abertura'), 'o histórico antigo continua lá');
  });

  // ------------------------------------------- 8) isolamento entre lojas
  await t.test('8) ESTOQUE SEPARADO: OS de uma loja não baixa o estoque da outra', async () => {
    // cria um usuário gerente da FILIAL
    const criado = await pedir(base, '/api/usuarios', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ nome: 'Gerente Filial Teste', usuario: 'ger.filial', senha: 'filial123', perfil: 'gerente', loja: 'FILIAL' }),
    });
    assert.strictEqual(criado.status, 200, JSON.stringify(criado.corpo));

    const loginFilial = await entrar(base, 'ger.filial', 'filial123');
    assert.strictEqual(loginFilial.status, 200);
    const cabFilial = { cookie: loginFilial.cookie, 'content-type': 'application/json' };

    // tenta mexer no status de uma OS da UNICAR → 403 e nada muda no estoque
    const osUnicar = await criarOS({
      loja: 'UNICAR',
      cliente: { nome: 'Cliente Isolamento' },
      itens: [{ tipo: 'pneu', descricao: 'Pneu isolamento', quantidade: 1, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }],
    });
    const disponivel = estoqueDe(lerDados(pasta), pneu.id);
    const tentativa = await pedir(base, `/api/os/${osUnicar.id}/status`, { metodo: 'POST', cabecalhos: cabFilial, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(tentativa.status, 403, 'usuário de outra loja não muda o status');
    assert.strictEqual(estoqueDe(lerDados(pasta), pneu.id), disponivel, 'nada foi baixado');
    assert.strictEqual(movimentosOS(lerDados(pasta), osUnicar.numero).length, 0);

    // A LOJA A NÃO ENXERGA O ESTOQUE DA LOJA B: a FILIAL não tem esse pneu, então a OS dela
    // é BLOQUEADA mesmo com saldo sobrando na UNICAR.
    const osFilial = await criarOS({
      loja: 'FILIAL',
      cliente: { nome: 'Cliente Filial' },
      itens: [{ tipo: 'pneu', descricao: 'Pneu filial', quantidade: 2, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }],
    });
    const bloqueada = await pedir(base, `/api/os/${osFilial.id}/status`, { metodo: 'POST', cabecalhos: cabFilial, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(bloqueada.status, 400, 'a OS da FILIAL não pode usar o estoque da UNICAR');
    assert.strictEqual(bloqueada.corpo.faltando[0].loja, 'FILIAL');
    assert.strictEqual(bloqueada.corpo.faltando[0].disponivel, 0, 'na FILIAL o disponível é zero');
    assert.strictEqual(estoqueDe(lerDados(pasta), pneu.id), disponivel, 'nada mudou no total');

    // o administrador transfere 2 para a FILIAL (com quem recebe confirmando)
    const unicarAntes = lerDados(pasta).pneus.find((p) => p.id === pneu.id).estoques.UNICAR.quantidade;
    const totalAntes = estoqueDe(lerDados(pasta), pneu.id);
    const transf = await pedir(base, '/api/estoque/transferir', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ pneuId: pneu.id, de: 'UNICAR', para: 'FILIAL', quantidade: 2, confirmadoPor: 'Gerente Filial Teste' }),
    });
    assert.strictEqual(transf.status, 200, JSON.stringify(transf.corpo));
    const depoisTransf = lerDados(pasta);
    const pneuDepois = depoisTransf.pneus.find((p) => p.id === pneu.id);
    assert.strictEqual(pneuDepois.estoques.FILIAL.quantidade, 2, 'entrou 2 na FILIAL');
    assert.strictEqual(pneuDepois.estoques.UNICAR.quantidade, unicarAntes - 2, 'saiu 2 da UNICAR');
    assert.strictEqual(pneuDepois.quantidade, totalAntes, 'a transferência não cria nem some unidade');
    assert.ok(depoisTransf.auditoria.some((a) => a.acao === 'transferir'), 'a transferência fica na auditoria');

    // agora a mesma OS da FILIAL executa e baixa SÓ da FILIAL
    const baixaFilial = await pedir(base, `/api/os/${osFilial.id}/status`, { metodo: 'POST', cabecalhos: cabFilial, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(baixaFilial.status, 200, JSON.stringify(baixaFilial.corpo));
    const dados = lerDados(pasta);
    const pneuFinal = dados.pneus.find((p) => p.id === pneu.id);
    assert.strictEqual(pneuFinal.estoques.FILIAL.quantidade, 0, 'a FILIAL baixou as 2 dela');
    assert.strictEqual(pneuFinal.estoques.UNICAR.quantidade, unicarAntes - 2, 'a UNICAR não foi tocada');
    assert.strictEqual(estoqueDe(dados, pneu.id), totalAntes - 2, 'o total caiu só o que foi usado');

    // e o bloqueio por falta de estoque vale para as duas lojas
    const semEstoque = await criarOS({
      loja: 'FILIAL',
      cliente: { nome: 'Sem estoque filial' },
      itens: [{ tipo: 'pneu', descricao: 'Pneu demais filial', quantidade: 1, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }],
    });
    const bloqueio = await pedir(base, `/api/os/${semEstoque.id}/status`, { metodo: 'POST', cabecalhos: cabFilial, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(bloqueio.status, 400, 'falta de estoque bloqueia em qualquer loja');
    assert.strictEqual(bloqueio.corpo.faltando[0].faltam, 1);
  });

  // ------------------------------------------- 9) funções antigas
  await t.test('9) funções antigas continuam funcionando (movimentação manual e bebidas)', async () => {
    const dadosAntes = lerDados(pasta);
    const atual = estoqueDe(dadosAntes, pneu.id);

    const manual = await pedir(base, '/api/movimentos', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ pneuId: pneu.id, tipo: 'saida', quantidade: 1, motivo: 'saída manual (teste)' }),
    });
    assert.strictEqual(manual.status, 200, JSON.stringify(manual.corpo));
    assert.strictEqual(manual.corpo.motivo, 'saída manual (teste)');
    assert.strictEqual(manual.corpo.origem, undefined, 'a movimentação manual não é marcada como OS');
    assert.strictEqual(estoqueDe(lerDados(pasta), pneu.id), atual - 1);

    // a baixa automática continua contando certo depois da movimentação manual
    const os = await criarOS({
      loja: 'UNICAR',
      cliente: { nome: 'Depois do manual' },
      itens: [{ tipo: 'pneu', descricao: 'Pneu depois do manual', quantidade: 1, valorUnitario: 300, estoqueId: pneu.id, estoqueTipo: 'pneus' }],
    });
    const r = await pedir(base, `/api/os/${os.id}/status`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'em execucao' }) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(estoqueDe(lerDados(pasta), pneu.id), atual - 2, 'baixou 1 do manual e 1 da OS');

    // estoque, estado e auditoria seguem respondendo
    const estado = await pedir(base, '/api/state', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(estado.status, 200);
    assert.ok(Array.isArray(estado.corpo.pneus));
    const auditoria = await pedir(base, '/api/auditoria', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(auditoria.status, 200);
    assert.ok(auditoria.corpo.length > 0);
    const painel = await pedir(base, '/api/painel', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(painel.status, 200);
    assert.ok(typeof painel.corpo.faturamento === 'number');
  });
});

test('estoque-os: a conta da baixa é sempre "pedido menos já baixado"', () => {
  const estoqueOS = require('../estoque-os');
  const os = { id: 'x', numero: 'OS-UNICAR-000001', loja: 'UNICAR', baixas: [], itens: [] };
  const item = { id: 'i1', quantidade: 2, estoqueId: 'p1', estoqueTipo: 'pneus', descricao: 'Pneu A' };

  let movs = estoqueOS.calcularMovimentos(os, [item]);
  assert.strictEqual(movs.saidas.length, 1);
  assert.strictEqual(movs.saidas[0].quantidade, 2, 'primeira vez: baixa tudo');

  // depois de baixar 2, pedir 2 de novo não baixa nada
  estoqueOS.baixas(os).push({ itemId: 'i1', estoqueId: 'p1', estoqueTipo: 'pneus', quantidade: 2, descricao: 'Pneu A' });
  movs = estoqueOS.calcularMovimentos(os, [item]);
  assert.strictEqual(movs.saidas.length, 0, 'nada a baixar');
  assert.strictEqual(movs.entradas.length, 0, 'nada a estornar');

  // pedir 5 baixa 3 (depois de aplicar, o controle fica em 5 — é o que o aplicar() faz)
  movs = estoqueOS.calcularMovimentos(os, [{ ...item, quantidade: 5 }]);
  assert.strictEqual(movs.saidas[0].quantidade, 3, 'só a diferença');
  estoqueOS.baixas(os)[0].quantidade = 5;

  // pedir 1 estorna 4
  movs = estoqueOS.calcularMovimentos(os, [{ ...item, quantidade: 1 }]);
  assert.strictEqual(movs.saidas.length, 0);
  assert.strictEqual(movs.entradas[0].quantidade, 4, 'estorna o que sobrou');
  estoqueOS.baixas(os)[0].quantidade = 1;

  // item removido estorna o que ainda estava baixado (1)
  movs = estoqueOS.calcularMovimentos(os, []);
  assert.strictEqual(movs.entradas.length, 1);
  assert.strictEqual(movs.entradas[0].quantidade, 1);
  assert.strictEqual(movs.entradas[0].motivo, 'item removido da OS');
});
