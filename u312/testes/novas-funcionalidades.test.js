// Testes das funcionalidades novas (SMG GROUP): identidade do grupo, estoque por loja,
// importação de arquivo (TXT/PDF) e chat interno com chamados.
//
// Roda sobre uma CÓPIA do data.json real (migrada), em pasta temporária; o original nunca é
// tocado e a senha de teste existe só nessa cópia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
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
  dados.os = [];
  dados.osSequencia = { UNICAR: 0, FILIAL: 0, MATRIZ: 0 };
  dados.chatMensagens = [];
  dados.chamados = [];
  dados.importacoes = [];
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return { pasta, dados };
}

const lerDados = (pasta) => JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));

function pdfComTexto(linhas) {
  const conteudo = ['BT', '/F1 10 Tf', '12 TL', '40 800 Td',
    ...linhas.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`), 'ET'].join('\n');
  const comprimido = zlib.deflateSync(Buffer.from(conteudo, 'latin1'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n4 0 obj<</Length ${comprimido.length}/Filter/FlateDecode>>\nstream\n`, 'latin1'),
    comprimido,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1'),
  ]);
}

const PORTA = 5900 + crypto.randomInt(0, 90);

test('SMG GROUP: identidade, estoque por loja, importação e chat', async (t) => {
  const { pasta } = preparar();
  const servidor = await subirServidor(pasta, { porta: PORTA });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  const login = await entrar(base, 'admin', 'teste123');
  assert.strictEqual(login.status, 200);
  const cab = { cookie: login.cookie, 'content-type': 'application/json' };

  // ---------------------------------------------------------------- identidade do grupo
  await t.test('o sistema continua UNICAR e a tela de login tem a marca SMG', async () => {
    const r = await pedir(base, '/api/grupo');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.sistema, 'UNICAR', 'o sistema continua UNICAR');
    assert.strictEqual(r.corpo.login.nome, 'SMG GROUP', 'a tela de login usa SMG GROUP');
    assert.match(r.corpo.login.subtitulo, /estoque/i);
    assert.ok(r.corpo.login.logo, 'a logo da tela de login precisa existir');
    const logo = await pedir(base, r.corpo.login.logo.split('?')[0]);
    assert.strictEqual(logo.status, 200, 'o arquivo da logo precisa ser servido');
    assert.strictEqual(r.corpo.prefixoOS, 'OS', 'padrão: numeração de OS igual à de antes');
    // o sistema NÃO vira SMG: a identidade das telas é a mesma de sempre
    const estado = await pedir(base, '/api/state', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(estado.status, 200);
  });

  await t.test('administrador troca nome, subtítulo e prefixo (e fica na auditoria)', async () => {
    const r = await pedir(base, '/api/config/grupo', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ loginNome: 'SMG GROUP', loginSubtitulo: 'Gestão de estoque, serviços e pneus', prefixoOS: 'SMG' }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const publico = await pedir(base, '/api/grupo');
    assert.strictEqual(publico.corpo.login.subtitulo, 'Gestão de estoque, serviços e pneus');
    assert.strictEqual(publico.corpo.prefixoOS, 'SMG', 'o prefixo pode ser trocado (opcional)');
    // volta ao padrão para o resto dos testes (numeração de OS igual à de antes)
    await pedir(base, '/api/config/grupo', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ loginNome: 'SMG GROUP', loginSubtitulo: 'Gestão de estoque e serviços', prefixoOS: 'OS' }),
    });
    const dados = lerDados(pasta);
    assert.ok(dados.auditoria.some((a) => a.entidade === 'grupo'), 'troca de identidade precisa de auditoria');
  });

  await t.test('funcionário NÃO troca a identidade do grupo', async () => {
    await pedir(base, '/api/usuarios', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ nome: 'Operador Teste', usuario: 'op.teste', senha: 'op12345', perfil: 'operador', loja: 'FILIAL' }),
    });
    const op = await entrar(base, 'op.teste', 'op12345');
    assert.strictEqual(op.status, 200);
    const r = await pedir(base, '/api/config/grupo', {
      metodo: 'POST', cabecalhos: { cookie: op.cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({ loginNome: 'Outro Nome' }),
    });
    assert.strictEqual(r.status, 403);
    assert.strictEqual((await pedir(base, '/api/grupo')).corpo.login.nome, 'SMG GROUP');
  });

  // ---------------------------------------------------------------- estoque por loja
  const dados0 = lerDados(pasta);
  const pneu = dados0.pneus.find((p) => Number(p.quantidade) > 4);
  assert.ok(pneu, 'precisa de um pneu com estoque na base de teste');

  await t.test('estoque que já existia foi para a loja principal (sem perder nada)', async () => {
    const d = lerDados(pasta);
    const p = d.pneus.find((x) => x.id === pneu.id);
    assert.ok(p.estoques && p.estoques.UNICAR, 'o pneu precisa ter o mapa de lojas');
    assert.strictEqual(p.estoques.UNICAR.quantidade, Number(pneu.quantidade));
    assert.strictEqual(p.quantidade, Number(pneu.quantidade), 'o total continua igual');
  });

  await t.test('funcionário da FILIAL não recebe o estoque das outras lojas', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const r = await pedir(base, '/api/state', { cabecalhos: { cookie: op.cookie } });
    assert.strictEqual(r.status, 200);
    const p = r.corpo.pneus.find((x) => x.id === pneu.id);
    assert.deepStrictEqual(Object.keys(p.estoques), ['FILIAL'], 'só a loja dele no mapa');
    assert.strictEqual(p.quantidade, 0, 'a FILIAL não tem esse pneu');
    assert.strictEqual(r.corpo.pneus.some((x) => x.precoCusto !== undefined), false, 'custo nunca sai para funcionário');
  });

  await t.test('o administrador vê as lojas lado a lado (consolidado)', async () => {
    const r = await pedir(base, '/api/estoque/consolidado', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.corpo.lojas.slice().sort(), ['FILIAL', 'MATRIZ', 'UNICAR']);
    const linha = r.corpo.linhas.find((l) => l.id === pneu.id);
    assert.strictEqual(linha.lojas.length, 3);
    assert.strictEqual(linha.total, Number(pneu.quantidade));
  });

  await t.test('transferência entre lojas: sai de uma, entra na outra, com confirmação e auditoria', async () => {
    const antes = lerDados(pasta).pneus.find((x) => x.id === pneu.id);
    const r = await pedir(base, '/api/estoque/transferir', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ pneuId: pneu.id, de: 'UNICAR', para: 'FILIAL', quantidade: 2, confirmadoPor: 'Operador Teste' }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const depois = lerDados(pasta).pneus.find((x) => x.id === pneu.id);
    assert.strictEqual(depois.estoques.FILIAL.quantidade, antes.estoques.FILIAL.quantidade + 2);
    assert.strictEqual(depois.estoques.UNICAR.quantidade, antes.estoques.UNICAR.quantidade - 2);
    assert.strictEqual(depois.quantidade, antes.quantidade, 'transferir não cria nem some unidade');
    const d = lerDados(pasta);
    assert.ok(d.auditoria.some((a) => a.acao === 'transferir' && /Operador Teste/.test(a.resumo)));
    assert.strictEqual(d.movimentos.filter((m) => m.motivo && m.motivo.includes('Transferência')).length >= 2, true, 'saída + entrada registradas');
  });

  await t.test('transferência sem confirmação de quem recebe é recusada', async () => {
    const r = await pedir(base, '/api/estoque/transferir', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ pneuId: pneu.id, de: 'UNICAR', para: 'MATRIZ', quantidade: 1 }),
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.corpo.error, /recebendo/);
  });

  await t.test('distribuir o estoque atual exige que a soma feche com o total', async () => {
    const d = lerDados(pasta);
    const p = d.pneus.find((x) => x.id === pneu.id);
    const total = p.quantidade;
    const errado = await pedir(base, '/api/estoque/distribuir', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ itens: [{ pneuId: p.id, lojas: { UNICAR: total, FILIAL: 1, MATRIZ: 0 } }] }),
    });
    assert.strictEqual(errado.status, 200);
    assert.strictEqual(errado.corpo.ok, false, 'soma maior que o total tem que ser recusada');
    assert.match(errado.corpo.erros[0].erro, /igual ao total atual/);

    const certo = await pedir(base, '/api/estoque/distribuir', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ itens: [{ pneuId: p.id, lojas: { UNICAR: total - 1, FILIAL: 1, MATRIZ: 0 } }] }),
    });
    assert.strictEqual(certo.status, 200);
    assert.strictEqual(certo.corpo.ok, true, JSON.stringify(certo.corpo));
    const depois = lerDados(pasta).pneus.find((x) => x.id === p.id);
    assert.strictEqual(depois.quantidade, total, 'o total não pode mudar na distribuição');
    assert.strictEqual(depois.estoques.UNICAR.quantidade, total - 1);
    assert.strictEqual(depois.estoques.FILIAL.quantidade, 1);
  });

  await t.test('funcionário não distribui estoque (só administrador)', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const r = await pedir(base, '/api/estoque/distribuir', {
      metodo: 'POST', cabecalhos: { cookie: op.cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({ itens: [{ pneuId: pneu.id, lojas: { FILIAL: 5 } }] }),
    });
    assert.strictEqual(r.status, 403);
  });

  // ---------------------------------------------------------------- importação
  await t.test('prévia de TXT: entende as linhas e NÃO grava nada antes de confirmar', async () => {
    const antes = fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8');
    const texto = [
      'MEDIDA;MARCA;TIPO;CUSTO;VENDA;QTD',
      '175/65R14;LONGWAY;NOVO;180,00;245,00;3',
      '185/60R15;GOODYEAR;REMOLD;210,50;310,00;2',
      'linha que nao da para entender',
    ].join('\n');
    const r = await pedir(base, '/api/importar/previa', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ nome: 'lote.txt', conteudo: Buffer.from(texto).toString('base64'), loja: 'FILIAL', modo: 'somar' }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.loja, 'FILIAL');
    assert.strictEqual(r.corpo.estatisticas.itens, 2);
    assert.strictEqual(r.corpo.revisao.length, 1, 'a linha incompreensível vai para revisão');
    assert.ok(r.corpo.criar.length >= 1, 'pelo menos um pneu novo');
    assert.strictEqual(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'), antes, 'prévia NÃO pode gravar');
    t._previa = r.corpo.id;
  });

  await t.test('confirmar a importação: grava na loja escolhida, guarda o arquivo e a auditoria', async () => {
    const r = await pedir(base, '/api/importar/confirmar', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ id: t._previa }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.ok(r.corpo.criados >= 1);
    const d = lerDados(pasta);
    const novo = d.pneus.find((p) => p.marca === 'LONGWAY' && p.medida === '175/65R14' && p.status === 'novo' && p.estoques.FILIAL && p.estoques.FILIAL.quantidade >= 3);
    assert.ok(novo, 'o pneu importado precisa existir na loja FILIAL');
    assert.ok(d.importacoes.length >= 1, 'a importação fica registrada');
    assert.ok(d.auditoria.some((a) => a.acao === 'importar'), 'importação precisa de auditoria');
    const pastaArquivos = path.join(pasta, 'arquivos-importados');
    assert.ok(fs.existsSync(pastaArquivos) && fs.readdirSync(pastaArquivos).length >= 1, 'o arquivo original precisa ser guardado');
    const csv = await pedir(base, `/api/importacoes/${r.corpo.id}/resultado.csv`, { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(csv.status, 200);
    assert.match(String(csv.corpo), /"arquivo";"loja";"modo"/);
  });

  await t.test('prévia de PDF com texto: extrai e interpreta', async () => {
    const pdf = pdfComTexto(['175/65R14 LONGWAY NOVO R$ 245,00 qtd 3', '185/60R15 GOODYEAR REMOLD R$ 310,00 qtd 2']);
    const r = await pedir(base, '/api/importar/previa', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ nome: 'tabela.pdf', conteudo: pdf.toString('base64'), loja: 'MATRIZ', modo: 'somar' }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.tipo, 'pdf');
    assert.ok(r.corpo.estatisticas.itens >= 2, 'as duas linhas do PDF precisam ser lidas');
  });

  await t.test('PDF escaneado sem OCR instalado: mensagem clara (nunca erro 500)', async () => {
    const semTexto = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1');
    const r = await pedir(base, '/api/importar/previa', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ nome: 'foto.pdf', conteudo: semTexto.toString('base64'), loja: 'UNICAR', modo: 'somar' }),
    });
    assert.ok([422, 200].includes(r.status), `status inesperado: ${r.status}`);
    if (r.status === 422) {
      assert.match(r.corpo.error, /escaneado|OCR/i);
      assert.ok(r.corpo.dica, 'precisa dizer como resolver');
    } else {
      assert.ok(r.corpo.avisoOcr, 'se o OCR existe, tem que avisar que é leitura por foto');
    }
  });

  await t.test('arquivo acima de 10 MB é recusado com mensagem clara', async () => {
    const grande = Buffer.alloc(11 * 1024 * 1024, 0x41);
    const r = await pedir(base, '/api/importar/previa', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ nome: 'grande.txt', conteudo: grande.toString('base64'), loja: 'UNICAR' }),
      limiteMs: 60000,
    });
    assert.ok([413, 400].includes(r.status), `status inesperado: ${r.status}`);
    assert.match(String(r.corpo.error), /10 MB|grande/i);
  });

  // ---------------------------------------------------------------- chat e chamados
  let salaFilialMatriz = null;
  await t.test('salas: cada loja só vê as conversas em que participa', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const r = await pedir(base, '/api/chat/salas', { cabecalhos: { cookie: op.cookie } });
    assert.strictEqual(r.status, 200);
    const ids = r.corpo.salas.map((s) => s.id);
    assert.ok(ids.includes('geral'), 'a FILIAL participa do grupo geral');
    assert.ok(ids.includes('loja:filial-unicar'), 'e da conversa com a UNICAR');
    assert.ok(!ids.includes('loja:matriz-unicar'), 'mas NÃO da conversa entre MATRIZ e UNICAR');

    const admin = await pedir(base, '/api/chat/salas', { cabecalhos: { cookie: login.cookie } });
    const idsAdmin = admin.corpo.salas.map((s) => s.id);
    assert.ok(idsAdmin.length > ids.length, 'administrador vê todas as salas');
    salaFilialMatriz = 'loja:filial-unicar';
  });

  await t.test('mensagem em tempo real: grava, aparece na sala e conta como não lida para o outro', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const envio = await pedir(base, `/api/chat/sala/${salaFilialMatriz}/mensagem`, {
      metodo: 'POST', cabecalhos: { cookie: op.cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({ texto: 'preciso de 2 pneus do lote novo' }),
    });
    assert.strictEqual(envio.status, 200, JSON.stringify(envio.corpo));

    const lidas = await pedir(base, `/api/chat/sala/${salaFilialMatriz}`, { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(lidas.status, 200);
    assert.ok(lidas.corpo.mensagens.some((m) => /lote novo/.test(m.texto)), 'a mensagem precisa chegar para a outra loja');
    const naoLidas = await pedir(base, '/api/chat/naolidas', { cabecalhos: { cookie: login.cookie } });
    assert.ok(naoLidas.corpo.total >= 1, 'o contador de não lidas precisa subir');
  });

  await t.test('loja de fora NÃO abre a conversa de outras duas (403)', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const r = await pedir(base, '/api/chat/sala/loja:matriz-unicar', { cabecalhos: { cookie: op.cookie } });
    assert.strictEqual(r.status, 403);
  });

  await t.test('chamado: abre com prioridade, aparece para a outra loja e tem "visto"', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const r = await pedir(base, '/api/chamados', {
      metodo: 'POST', cabecalhos: { cookie: op.cookie, 'content-type': 'application/json' },
      corpo: JSON.stringify({
        para: 'UNICAR',
        titulo: 'Preciso de 2 pneus 175/65R14',
        mensagem: 'Cliente esperando, pode transferir?',
        prioridade: 'urgente',
        vinculo: { tipo: 'medida', rotulo: '175/65R14' },
      }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const chamado = r.corpo.chamado;
    assert.match(chamado.numero, /^CH-\d{4}-\d{4}$/);
    assert.strictEqual(chamado.status, 'aberto');
    assert.strictEqual(chamado.prioridade, 'urgente');
    assert.strictEqual(chamado.de, 'FILIAL');
    assert.strictEqual(chamado.para, 'UNICAR');

    const daUnicar = await pedir(base, '/api/chamados', { cabecalhos: { cookie: login.cookie } });
    const achado = daUnicar.corpo.chamados.find((c) => c.id === chamado.id);
    assert.ok(achado, 'a loja de destino precisa ver o chamado');
    assert.strictEqual(achado.visto, false, 'o alarme só desliga no "Visto"');

    const visto = await pedir(base, `/api/chamados/${chamado.id}/visto`, { metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({}) });
    assert.strictEqual(visto.status, 200);
    const depois = await pedir(base, '/api/chamados', { cabecalhos: { cookie: login.cookie } });
    assert.strictEqual(depois.corpo.chamados.find((c) => c.id === chamado.id).visto, true);

    const resp = await pedir(base, `/api/chamados/${chamado.id}/responder`, {
      metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ texto: 'Pode passar aqui que eu separo' }),
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.corpo.chamado.status, 'em atendimento');

    const resolvido = await pedir(base, `/api/chamados/${chamado.id}/status`, {
      metodo: 'POST', cabecalhos: cab, corpo: JSON.stringify({ status: 'resolvido' }),
    });
    assert.strictEqual(resolvido.status, 200);
    assert.strictEqual(resolvido.corpo.chamado.status, 'resolvido');
    assert.ok(lerDados(pasta).auditoria.some((a) => a.entidade === 'chamado'), 'chamado fica na auditoria');
  });

  await t.test('apagar mensagem: só administrador (e nada some do arquivo)', async () => {
    const op = await entrar(base, 'op.teste', 'op12345');
    const sala = await pedir(base, `/api/chat/sala/${salaFilialMatriz}`, { cabecalhos: { cookie: login.cookie } });
    const msg = sala.corpo.mensagens[0];

    const tentativa = await pedir(base, `/api/chat/mensagem/${msg.id}`, { metodo: 'DELETE', cabecalhos: { cookie: op.cookie, 'content-type': 'application/json' } });
    assert.strictEqual(tentativa.status, 403);

    const apagada = await pedir(base, `/api/chat/mensagem/${msg.id}`, { metodo: 'DELETE', cabecalhos: cab });
    assert.strictEqual(apagada.status, 200);
    const depois = lerDados(pasta).chatMensagens.find((m) => m.id === msg.id);
    assert.strictEqual(depois.apagada, true, 'a mensagem fica marcada como apagada (não desaparece do arquivo)');
  });

  await t.test('número de OS continua como antes e número antigo continua válido', async () => {
    const r = await pedir(base, '/api/os', {
      metodo: 'POST', cabecalhos: cab,
      corpo: JSON.stringify({ loja: 'UNICAR', cliente: { nome: 'Cliente Prefixo' }, itens: [{ tipo: 'mao de obra', descricao: 'Serviço', quantidade: 1, valorUnitario: 100 }] }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.os.numero, /^OS-UNICAR-\d{6}$/, `número novo: ${r.corpo.os.numero}`);

    // um número antigo (OS-UNICAR-000001) tem que continuar sendo encontrado
    const d = lerDados(pasta);
    d.os.push({ id: 'legado-1', numero: 'OS-UNICAR-000001', loja: 'UNICAR', status: 'aberta', cliente: { nome: 'Antigo' }, itens: [], criadoEm: Date.now() });
    fs.writeFileSync(path.join(pasta, 'dados.json'), JSON.stringify(d, null, 2));
    const antigo = await pedir(base, '/api/os/OS-UNICAR-000001', { cabecalhos: cab });
    assert.strictEqual(antigo.status, 200, 'OS antiga precisa continuar abrindo pelo número antigo');
  });
});
