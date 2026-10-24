// SMG GROUP - Rotas novas: identidade do grupo, importação de arquivos e chat interno
//
// Fica separado do server.js para o arquivo principal não virar um monumento.
// Tudo aqui passa pelo auth do sistema: as rotas chamadas sem login são apenas as
// que a tela de login precisa (nome/subtítulo/logo do grupo).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const grupoMod = require('./grupo');
const chatMod = require('./chat');
const estoquesMod = require('./estoques');
const importacao = require('./importacao');
const planilha = require('./planilha');

const LIMITE_ARQUIVO_BYTES = 10 * 1024 * 1024; // 10 MB, como pedido
const VALIDADE_PREVIA_MS = 30 * 60 * 1000;     // 30 minutos para confirmar

// Prévia fica na memória do servidor (não no data.json): se reiniciar, é só importar de novo.
const previas = new Map();

function limparPreviasVelhas() {
  const agora = Date.now();
  for (const [id, previa] of previas) {
    if (agora - previa.criadaEm > VALIDADE_PREVIA_MS) previas.delete(id);
  }
}

function erro(res, status, mensagem, extra = {}) {
  return res.status(status).json({ error: mensagem, ...extra });
}

function registrarRotas(app, ctx) {
  const { loadData, withData, auth, auditoria, broadcastState } = ctx;
  const exigirLogin = auth.exigirLogin;

  // ---------------- identidade do grupo (público só para a tela de login) ----------------
  app.get('/api/grupo', (req, res) => {
    const data = loadData();
    const grupo = grupoMod.garantirGrupo(data);
    const lojas = (data.lojas || []).filter((l) => l.ativa !== false).map((l) => ({
      codigo: l.codigo,
      nome: l.nome,
      matriz: !!l.matriz,
    }));
    res.json({
      // o SISTEMA continua UNICAR; o que a tela de login mostra é a marca do login
      sistema: 'UNICAR',
      login: {
        nome: grupo.loginNome,
        subtitulo: grupo.loginSubtitulo,
        logo: grupo.loginLogo,
      },
      // compatibilidade com a tela nova de Configurações e com versões anteriores do cliente
      nome: grupo.loginNome,
      subtitulo: grupo.loginSubtitulo,
      logo: grupo.loginLogo,
      prefixoOS: grupo.prefixoOS,
      lojas,
    });
  });

  // Trocas de nome/subtítulo/logo/prefixo: só administrador.
  app.post('/api/config/grupo', exigirLogin, async (req, res) => {
    if (!req.usuario || req.usuario.perfil !== 'admin') return erro(res, 403, 'Só o administrador troca a identidade do grupo.');
    const body = req.body || {};
    let grupoAtualizado = null;
    await withData((data) => {
      const antes = { ...grupoMod.garantirGrupo(data) };
      grupoAtualizado = grupoMod.atualizarGrupo(data, {
        loginNome: body.loginNome !== undefined ? body.loginNome : body.nome,
        loginSubtitulo: body.loginSubtitulo !== undefined ? body.loginSubtitulo : body.subtitulo,
        prefixoOS: body.prefixoOS,
      });
      const mudancas = [];
      const rotulos = { loginNome: 'nome do login', loginSubtitulo: 'subtítulo do login', prefixoOS: 'prefixo das OS' };
      for (const campo of ['loginNome', 'loginSubtitulo', 'prefixoOS']) {
        if (antes[campo] !== grupoAtualizado[campo]) mudancas.push(`${rotulos[campo]}: "${antes[campo]}" → "${grupoAtualizado[campo]}"`);
      }
      if (mudancas.length) {
        auditoria.registrar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          acao: 'editar',
          entidade: 'grupo',
          entidadeId: 'grupo',
          resumo: `Configurações do grupo — ${mudancas.join('; ')}.`,
        });
      }
    });
    if (typeof broadcastState === 'function') broadcastState();
    res.json({ ok: true, grupo: grupoAtualizado });
  });

  // Logo enviada pela tela (arquivo lido no navegador e mandado como data URL).
  app.post('/api/config/logo', exigirLogin, async (req, res) => {
    if (!req.usuario || req.usuario.perfil !== 'admin') return erro(res, 403, 'Só o administrador troca a logo.');
    const dataUrl = String((req.body || {}).imagem || '');
    const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) return erro(res, 400, 'Envie uma imagem PNG, JPG, WEBP ou SVG.');
    const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : (m[1] === 'svg+xml' ? 'svg' : m[1]);
    const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    if (bytes.length > 3 * 1024 * 1024) return erro(res, 400, 'A logo é grande demais (máximo 3 MB).');

    // Sem dependência de redimensionador: o navegador já manda a imagem reduzida (600 px).
    const pasta = path.join(__dirname, 'public', 'logos');
    fs.mkdirSync(pasta, { recursive: true });
    const nome = `logo-grupo.${ext}`;
    fs.writeFileSync(path.join(pasta, nome), bytes);
    const caminho = `/logos/${nome}?v=${Date.now()}`;

    await withData((data) => {
      const grupo = grupoMod.garantirGrupo(data);
      grupo.loginLogo = caminho;
      grupo.atualizadoEm = Date.now();
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        usuarioId: req.usuario.id,
        acao: 'editar',
        entidade: 'grupo',
        entidadeId: 'grupo',
        resumo: `Trocou a logo da tela de login (${nome}, ${Math.round(bytes.length / 1024)} KB).`,
      });
    });
    if (typeof broadcastState === 'function') broadcastState();
    res.json({ ok: true, logo: caminho });
  });

  // ---------------- importação de arquivos ----------------
  // Modelo para o cliente preencher no Excel (abre como planilha, separado por ;)
  app.get('/api/importar/modelo.csv', exigirLogin, (req, res) => {
    const linhas = [
      ['Medida', 'Marca', 'Status', 'Quantidade', 'Custo', 'Preco', 'Localizacao', 'Estoque minimo'],
      ['175/70 R13', 'Pirelli', 'novo', '8', '210,00', '289,90', 'P1', '4'],
      ['185/65 R14', 'Goodmark', 'remoldado', '5', '150,00', '199,90', 'P2', '2'],
      ['205/55 R16', 'Michelin', 'novo', '3', '320,50', '499,90', 'P3', '1'],
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-estoque.csv"');
    res.send('\ufeff' + csv);
  });
  app.post('/api/importar/previa', exigirLogin, async (req, res) => {
    const body = req.body || {};
    const nome = String(body.nome || 'arquivo').slice(0, 120);
    const conteudoBase64 = String(body.conteudo || '');
    const loja = estoquesMod.chave(body.loja) || estoquesMod.chave(req.usuario.loja) || estoquesMod.LOJA_PRINCIPAL;
    const modo = body.modo === 'substituir' ? 'substituir' : 'somar';

    if (!conteudoBase64) return erro(res, 400, 'Nenhum arquivo recebido.');
    // só admin escolhe loja diferente da dele
    const lojaFinal = req.usuario.perfil === 'admin' ? loja : (estoquesMod.chave(req.usuario.loja) || loja);
    if (!lojaFinal) return erro(res, 400, 'Escolha a loja de destino.');

    let bytes;
    try {
      bytes = Buffer.from(conteudoBase64, 'base64');
    } catch (e) {
      return erro(res, 400, 'Não consegui ler o arquivo. Envie de novo.');
    }
    if (!bytes.length) return erro(res, 400, 'O arquivo está vazio.');
    if (bytes.length > LIMITE_ARQUIVO_BYTES) {
      return erro(res, 413, `O arquivo tem ${(bytes.length / 1024 / 1024).toFixed(1)} MB. O limite é 10 MB.`);
    }

    const ehPdf = /\.pdf$/i.test(nome) || bytes.slice(0, 4).toString('latin1') === '%PDF';
    let texto = '';
    let avisoOcr = null;
    let confiancaOcr = null;
    let avisoPlanilha = null;
    let linhasPlanilha = null;

    if (ehPdf) {
      texto = importacao.extrairTextoPdf(bytes);
      if (importacao.pareceEscaneado(texto)) {
        const ocr = await importacao.tentarOcr(bytes);
        if (ocr.ok) {
          texto = ocr.texto;
          confiancaOcr = ocr.confianca;
          avisoOcr = `PDF escaneado: o texto saiu de OCR (leitura por foto, confiança ${Math.round(ocr.confianca)}%). Confira antes de confirmar.`;
          if (ocr.confianca < 80) avisoOcr = `PDF escaneado lido por OCR com confiança BAIXA (${Math.round(ocr.confianca)}%). Revise linha por linha.`;
        } else {
          return erro(res, 422, ocr.motivo, { dica: ocr.dica || '' });
        }
      }
    } else if ((bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
      // Foto da lista (JPG/PNG): lê por OCR
      const ocr = await importacao.tentarOcr(bytes);
      if (!ocr.ok) return erro(res, 422, ocr.motivo, { dica: ocr.dica || '' });
      texto = ocr.texto;
      confiancaOcr = Number(ocr.confianca) || 0;
      avisoOcr = `Foto lida por OCR (confiança ${Math.round(confiancaOcr)}%). Confira antes de confirmar.`;
      if (confiancaOcr < 80) avisoOcr = `Foto lida por OCR com confiança BAIXA (${Math.round(confiancaOcr)}%). Revise linha por linha.`;
    } else if (/\.xlsx$/i.test(nome) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      // Planilha do Excel (.xlsx): le por COLUNA (cabecalho) e, se nao achar, cai no texto
      const lido = planilha.paraTexto(bytes);
      if (!lido.ok) return erro(res, 422, lido.motivo);
      texto = lido.texto;
      avisoPlanilha = lido.aviso;
      linhasPlanilha = lido.rows;
    } else if (/\.xls$/i.test(nome)) {
      return erro(res, 422, 'Esta planilha é do Excel antigo (.xls). Abra no Excel e use "Salvar como" → .xlsx (ou .csv) e envie de novo.');
    } else {
      texto = bytes.toString('utf8');
    }

    // CSV/TXT em colunas (com cabeçalho) também é lido por coluna, igual à planilha
    if (!linhasPlanilha && !ehPdf) {
      const linhasTexto = importacao.linhasDeTabela(texto);
      if (importacao.temCabecalhoTabela(linhasTexto)) linhasPlanilha = linhasTexto;
    }

    let leitura = importacao.interpretarConteudo(texto);
    // Planilha com cabecalho: o certo e ler por coluna (medida/marca/qtd/preco).
    if (linhasPlanilha && linhasPlanilha.length) {
      const tabela = importacao.interpretarTabela(linhasPlanilha);
      if (tabela.itens.length || (!tabela.semColunas && tabela.revisao.length)) leitura = tabela;
    }
    if (!leitura.itens.length && !leitura.revisao.length) {
      return erro(res, 422, 'Não encontrei nenhuma linha de pneu nesse arquivo.', { aviso: avisoOcr });
    }

    const data = loadData();
    const previa = importacao.montarPrevia(leitura.itens, { pneus: data.pneus, loja: lojaFinal, modo });
    const id = crypto.randomUUID();

    // Guarda o arquivo original (auditoria do que entrou) e o registro da importação
    const pasta = path.join(path.dirname(ctx.arquivoDados), 'arquivos-importados');
    fs.mkdirSync(pasta, { recursive: true });
    const nomeSeguro = `${new Date().toISOString().replace(/[:.]/g, '-')}-${nome.replace(/[^\w.\-]/g, '_')}`;
    const caminhoArquivo = path.join(pasta, nomeSeguro);
    fs.writeFileSync(caminhoArquivo, bytes);

    previas.set(id, {
      id,
      nome,
      arquivo: caminhoArquivo,
      tamanho: bytes.length,
      loja: lojaFinal,
      modo,
      criadaEm: Date.now(),
      usuario: req.usuario.nome,
      usuarioId: req.usuario.id,
      previa,
      leitura,
      avisoOcr,
      confiancaOcr,
      avisoPlanilha,
    });
    limparPreviasVelhas();

    res.json({
      id,
      arquivo: nome,
      tamanho: bytes.length,
      tipo: ehPdf ? 'pdf' : (avisoPlanilha ? 'planilha' : 'texto'),
      avisoPlanilha,
      avisoOcr,
      confiancaOcr,
      loja: lojaFinal,
      modo,
      criar: previa.criar,
      atualizar: previa.atualizar,
      revisao: leitura.revisao,
      estatisticas: leitura.estatisticas,
    });
  });

  // Confirmar: só aqui o estoque muda.
  app.post('/api/importar/confirmar', exigirLogin, async (req, res) => {
    const id = String((req.body || {}).id || '');
    const previa = previas.get(id);
    if (!previa) return erro(res, 404, 'Esta prévia venceu (ou o sistema reiniciou). Envie o arquivo de novo.');
    if (previa.usuarioId !== req.usuario.id && req.usuario.perfil !== 'admin') {
      return erro(res, 403, 'Esta importação é de outro usuário.');
    }
    const modo = (req.body || {}).modo === 'substituir' ? 'substituir' : previa.modo;
    const loja = req.usuario.perfil === 'admin' ? (estoquesMod.chave((req.body || {}).loja) || previa.loja) : previa.loja;

    const criados = [];
    const atualizados = [];
    await withData((data) => {
      for (const item of previa.previa.criar) {
        const tire = {
          id: crypto.randomUUID(),
          marca: item.marca,
          medida: item.medida,
          status: item.tipo,
          localizacao: '',
          quantidade: 0,
          estoqueMinimo: 0,
          precoCusto: Number(item.custo) || 0,
          precoVenda: Number(item.preco) || 0,
          loja,
          estoques: {},
          criadoEm: Date.now(),
          atualizadoEm: Date.now(),
          origemImportacao: id,
        };
        estoquesMod.definirQuantidade(tire, loja, item.quantidade);
        data.pneus.push(tire);
        criados.push(`${item.marca} ${item.medida} (${item.tipo}) +${item.quantidade}`);
        data.movimentos.unshift({
          id: crypto.randomUUID(),
          pneuId: tire.id,
          pneuDescricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
          tipo: 'entrada',
          quantidade: item.quantidade,
          loja,
          motivo: `Importação de ${previa.nome}`,
          usuario: req.usuario.nome,
          criadoEm: Date.now(),
        });
      }

      for (const item of previa.previa.atualizar) {
        const tire = data.pneus.find((p) => p.id === item.pneuId);
        if (!tire) continue;
        const antes = estoquesMod.qtdNaLoja(tire, loja);
        const r = modo === 'substituir'
          ? estoquesMod.definirQuantidade(tire, loja, item.quantidade)
          : estoquesMod.movimentar(tire, loja, 'entrada', item.quantidade);
        if (!r.ok) continue;
        // preço/custo do arquivo atualizam o cadastro (quando vieram)
        if (item.preco !== null && item.preco !== undefined) tire.precoVenda = Number(item.preco) || tire.precoVenda;
        if (item.custo !== null && item.custo !== undefined) tire.precoCusto = Number(item.custo) || tire.precoCusto;
        tire.atualizadoEm = Date.now();
        atualizados.push(`${tire.marca} ${tire.medida}: ${antes} → ${estoquesMod.qtdNaLoja(tire, loja)}`);
        data.movimentos.unshift({
          id: crypto.randomUUID(),
          pneuId: tire.id,
          pneuDescricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
          tipo: modo === 'substituir' ? 'ajuste' : 'entrada',
          quantidade: Math.abs(estoquesMod.qtdNaLoja(tire, loja) - antes),
          loja,
          motivo: `Importação (${modo === 'substituir' ? 'definir estoque' : 'somar'}) de ${previa.nome}`,
          usuario: req.usuario.nome,
          criadoEm: Date.now(),
        });
      }

      const registro = {
        id,
        arquivo: previa.nome,
        arquivoGuardado: previa.arquivo,
        tamanho: previa.tamanho,
        loja,
        modo,
        usuario: req.usuario.nome,
        usuarioId: req.usuario.id,
        criadoEm: previa.criadaEm,
        confirmadoEm: Date.now(),
        criados: criados.length,
        atualizados: atualizados.length,
        revisao: previa.leitura.revisao.length,
        avisoOcr: previa.avisoOcr || null,
      };
      if (!Array.isArray(data.importacoes)) data.importacoes = [];
      data.importacoes.unshift(registro);
      if (data.importacoes.length > 200) data.importacoes.length = 200;

      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        usuarioId: req.usuario.id,
        loja,
        acao: 'importar',
        entidade: 'estoque',
        entidadeId: id,
        resumo: `Importou "${previa.nome}" na loja ${loja} (${modo}): ${criados.length} criado(s), ${atualizados.length} atualizado(s), ${previa.leitura.revisao.length} para revisão.`,
      });
    });

    previas.delete(id);
    if (typeof broadcastState === 'function') broadcastState();
    res.json({
      ok: true,
      id,
      loja,
      modo,
      criados: criados.length,
      atualizados: atualizados.length,
      revisao: previa.leitura.revisao,
      detalhe: { criados, atualizados },
    });
  });

  // Exportar o resultado (CSV) — abre no Excel
  app.get('/api/importacoes/:id/resultado.csv', exigirLogin, (req, res) => {
    const data = loadData();
    const registro = (data.importacoes || []).find((i) => i.id === req.params.id);
    if (!registro) return erro(res, 404, 'Importação não encontrada.');
    if (req.usuario.perfil !== 'admin' && registro.usuarioId !== req.usuario.id) {
      return erro(res, 403, 'Esta importação é de outro usuário.');
    }
    const linhas = [
      ['arquivo', 'loja', 'modo', 'criados', 'atualizados', 'revisao', 'usuario', 'quando'],
      [registro.arquivo, registro.loja, registro.modo, registro.criados, registro.atualizados, registro.revisao, registro.usuario,
        new Date(registro.confirmadoEm || registro.criadoEm).toLocaleString('pt-BR')],
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="importacao-${registro.id.slice(0, 8)}.csv"`);
    res.send('\ufeff' + csv);
  });

  app.get('/api/importacoes', exigirLogin, (req, res) => {
    const data = loadData();
    const lista = (data.importacoes || []).filter((i) => req.usuario.perfil === 'admin' || i.usuarioId === req.usuario.id);
    res.json({ importacoes: lista.slice(0, 50) });
  });

  // ---------------- chat interno ----------------
  function usuarioDoReq(req) {
    return req.usuario;
  }

  app.get('/api/chat/salas', exigirLogin, (req, res) => {
    const data = loadData();
    const salas = chatMod.salasVisiveis(data, usuarioDoReq(req)).map((s) => ({
      id: s.id,
      tipo: s.tipo,
      nome: s.nome,
      participantes: s.participantes,
    }));
    res.json({ salas, naoLidas: chatMod.naoLidas(data, usuarioDoReq(req)) });
  });

  app.get('/api/chat/naolidas', exigirLogin, (req, res) => {
    const data = loadData();
    res.json(chatMod.naoLidas(data, usuarioDoReq(req)));
  });

  app.get('/api/chat/sala/:id', exigirLogin, (req, res) => {
    const data = loadData();
    const usuario = usuarioDoReq(req);
    chatMod.garantirChat(data, data.lojas);
    const sala = data.chatSalas.find((s) => s.id === req.params.id);
    if (!sala) return erro(res, 404, 'Conversa não encontrada.');
    if (!chatMod.podeVerSala(data, usuario, sala.id)) return erro(res, 403, 'Você não participa desta conversa.');
    const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 300);
    const mensagens = data.chatMensagens
      .filter((m) => m.salaId === sala.id)
      .slice(0, limite)
      .map((m) => ({
        id: m.id,
        autor: m.autor,
        autorId: m.autorId,
        loja: m.loja,
        texto: m.apagada ? '(mensagem apagada pelo administrador)' : m.texto,
        apagada: !!m.apagada,
        criadoEm: m.criadoEm,
        vistoPor: (m.vistoPor || []).map((v) => v.nome || 'alguém'),
        visto: (m.vistoPor || []).some((v) => v.usuarioId === usuario.id),
      }));
    res.json({ sala: { id: sala.id, nome: sala.nome, tipo: sala.tipo }, mensagens });
  });

  app.post('/api/chat/sala/:id/mensagem', exigirLogin, async (req, res) => {
    const texto = (req.body || {}).texto;
    let criada = null;
    try {
      await withData((data) => {
        const salaExiste = (data.chatSalas || []).some((s) => s && s.id === req.params.id);
        if (!salaExiste) {
          criada = { ok: false, naoExiste: true, erro: 'Essa conversa não existe mais. Atualize a lista de conversas.' };
          return;
        }
        const r = chatMod.criarMensagem(data, { salaId: req.params.id, usuario: req.usuario, texto });
        if (!r.ok) { criada = r; return; }
        criada = r;
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        usuarioId: req.usuario.id,
        loja: req.usuario.loja,
        acao: 'mensagem',
        entidade: 'chat',
        entidadeId: r.mensagem.id,
        resumo: `Enviou mensagem na conversa ${req.params.id}.`,
      });
      });
    } catch (e) {
      // Falha ao gravar (arquivo travado por antivírus/backup): avisa em português
      // e não deixa a tela achando que a mensagem foi enviada.
      return erro(res, e && e.status ? e.status : 500,
        (e && e.message) || 'Não foi possível gravar a mensagem agora. Tente de novo em instantes.');
    }
    if (!criada || !criada.ok) {
      const semPermissao = /não participa|nao participa/i.test(String((criada && criada.erro) || ''));
      const status = (criada && criada.naoExiste) ? 404 : semPermissao ? 403 : 400;
      return erro(res, status, (criada && criada.erro) || 'Não consegui enviar.');
    }
    // O aviso por socket é um extra: se ele falhar, a mensagem já está gravada e o
    // envio continua sendo sucesso (antes, um erro aqui devolvia 500 e a pessoa
    // reenviava a mesma mensagem).
    try { if (ctx.avisarChat) ctx.avisarChat('mensagem', { salaId: req.params.id, mensagem: criada.mensagem }); }
    catch (e) { /* segue: mensagem salva */ }
    res.json({ ok: true, mensagem: criada.mensagem });
  });

  app.post('/api/chat/sala/:id/visto', exigirLogin, async (req, res) => {
    let marcadas = 0;
    await withData((data) => {
      marcadas = chatMod.marcarSalaVista(data, { salaId: req.params.id, usuario: req.usuario });
    });
    if (ctx.avisarChat) ctx.avisarChat('visto', { salaId: req.params.id, por: req.usuario.nome, marcadas });
    res.json({ ok: true, marcadas });
  });

  app.delete('/api/chat/mensagem/:id', exigirLogin, async (req, res) => {
    let resultado = null;
    await withData((data) => {
      resultado = chatMod.apagarMensagem(data, { mensagemId: req.params.id, usuario: req.usuario });
      if (resultado.ok) {
        auditoria.registrar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          acao: 'excluir',
          entidade: 'chat',
          entidadeId: req.params.id,
          resumo: 'Apagou uma mensagem do chat interno.',
        });
      }
    });
    if (!resultado.ok) return erro(res, 403, resultado.erro);
    if (ctx.avisarChat) ctx.avisarChat('apagada', { mensagemId: req.params.id, salaId: resultado.mensagem.salaId });
    res.json({ ok: true });
  });

  // ---------------- chamados ----------------
  app.get('/api/chamados', exigirLogin, (req, res) => {
    const data = loadData();
    chatMod.garantirChat(data, data.lojas);
    const lista = data.chamados
      .filter((c) => chatMod.podeVerChamado(req.usuario, c))
      .map((c) => ({
        ...c,
        visto: (c.vistoPor || []).some((v) => v.usuarioId === req.usuario.id),
      }));
    res.json({ chamados: lista });
  });

  app.post('/api/chamados', exigirLogin, async (req, res) => {
    let resultado = null;
    await withData((data) => {
      const entrada = { ...(req.body || {}) };
      if (req.usuario.perfil !== 'admin') entrada.de = req.usuario.loja;
      resultado = chatMod.criarChamado(data, req.usuario, entrada);
      if (resultado.ok) {
        auditoria.registrar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          loja: resultado.chamado.de,
          acao: 'chamado',
          entidade: 'chamado',
          entidadeId: resultado.chamado.id,
          resumo: `Abriu o chamado ${resultado.chamado.numero} (${resultado.chamado.prioridade}) de ${resultado.chamado.de} para ${resultado.chamado.para}: ${resultado.chamado.titulo}.`,
        });
      }
    });
    if (!resultado.ok) return erro(res, 400, resultado.erro);
    if (ctx.avisarChat) ctx.avisarChat('chamado', { chamado: resultado.chamado });
    res.json({ ok: true, chamado: resultado.chamado });
  });

  app.post('/api/chamados/:chave/responder', exigirLogin, async (req, res) => {
    let resultado = null;
    await withData((data) => {
      resultado = chatMod.responderChamado(data, req.usuario, req.params.chave, (req.body || {}).texto);
      if (resultado.ok) {
        auditoria.registrar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          loja: req.usuario.loja,
          acao: 'chamado',
          entidade: 'chamado',
          entidadeId: resultado.chamado.id,
          resumo: `Respondeu o chamado ${resultado.chamado.numero}.`,
        });
      }
    });
    if (!resultado.ok) return erro(res, 400, resultado.erro);
    if (ctx.avisarChat) ctx.avisarChat('chamado-resposta', { chamado: resultado.chamado });
    res.json({ ok: true, chamado: resultado.chamado });
  });

  app.post('/api/chamados/:chave/status', exigirLogin, async (req, res) => {
    let resultado = null;
    await withData((data) => {
      resultado = chatMod.mudarStatusChamado(data, req.usuario, req.params.chave, String((req.body || {}).status || ''));
      if (resultado.ok) {
        auditoria.registrar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          loja: req.usuario.loja,
          acao: 'chamado',
          entidade: 'chamado',
          entidadeId: resultado.chamado.id,
          resumo: `Chamado ${resultado.chamado.numero}: status ${resultado.chamado.status}.`,
        });
      }
    });
    if (!resultado.ok) return erro(res, 400, resultado.erro);
    if (ctx.avisarChat) ctx.avisarChat('chamado-status', { chamado: resultado.chamado });
    res.json({ ok: true, chamado: resultado.chamado });
  });

  app.post('/api/chamados/:chave/visto', exigirLogin, async (req, res) => {
    let resultado = null;
    await withData((data) => {
      resultado = chatMod.marcarChamadoVisto(data, req.usuario, req.params.chave);
    });
    if (!resultado.ok) return erro(res, 400, resultado.erro);
    if (ctx.avisarChat) ctx.avisarChat('chamado-visto', { chamadoId: resultado.chamado.id, por: req.usuario.nome });
    res.json({ ok: true });
  });
}

// ---------------- tempo real (Socket.IO) ----------------
// Presença: quem está online agora (por loja) + repasse de mensagens/chamados.
function registrarSocket(io, ctx) {
  const online = new Map(); // socketId -> { nome, loja, perfil, usuarioId }

  function resumoOnline() {
    const porLoja = {};
    const pessoas = [];
    for (const dados of online.values()) {
      const loja = dados.loja || 'ADMIN';
      porLoja[loja] = (porLoja[loja] || 0) + 1;
      pessoas.push({ nome: dados.nome, loja: dados.loja || null, perfil: dados.perfil });
    }
    return { total: online.size, porLoja, pessoas };
  }

  io.on('connection', (socket) => {
    const usuario = socket.data && socket.data.usuario ? socket.data.usuario : null;
    if (usuario) {
      online.set(socket.id, { nome: usuario.nome, loja: usuario.loja || null, perfil: usuario.perfil, usuarioId: usuario.id });
      io.emit('presenca', resumoOnline());
    }
    socket.on('disconnect', () => {
      if (online.delete(socket.id)) io.emit('presenca', resumoOnline());
    });
  });

  return {
    avisar(tipo, dados) {
      io.emit('chat', { tipo, ...dados });
    },
    resumoOnline,
  };
}

module.exports = { registrarRotas, registrarSocket, LIMITE_ARQUIVO_BYTES };
