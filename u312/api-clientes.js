// UNICAR - Rotas do cadastro de clientes (base única do grupo, todas as lojas)
// Qualquer usuário logado consulta, inclui e edita; apagar é só do administrador.

const clientesMod = require('./clientes');

function erro(res, status, mensagem) {
  return res.status(status).json({ error: mensagem });
}

function registrarRotas(app, ctx) {
  const { loadData, withData, auditoria } = ctx;

  const log = (data, req, acao, resumo, entidadeId) => auditoria.registrar(data, {
    usuario: req.usuario.nome,
    usuarioId: req.usuario.id,
    loja: req.usuario.loja || null,
    acao,
    entidade: 'cliente',
    entidadeId: entidadeId || null,
    resumo,
  });

  // lista / busca
  app.get('/api/clientes', (req, res) => {
    const data = loadData();
    const lista = clientesMod.garantirClientes(data);
    const busca = String(req.query.busca || '');
    const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
    const achados = clientesMod.buscarClientes(data, busca, limite).map(clientesMod.clientePublico);
    res.json({
      clientes: achados,
      total: lista.length,
      totalEncontrado: busca ? achados.length : lista.length,
      busca,
    });
  });

  app.get('/api/clientes/estatisticas', (req, res) => {
    const data = loadData();
    const lista = clientesMod.garantirClientes(data);
    res.json({
      total: lista.length,
      comDocumento: lista.filter((c) => clientesMod.chaveDocumento(c.cpfCnpj)).length,
      comOS: lista.filter((c) => (c.osCount || 0) > 0).length,
    });
  });

  app.get('/api/clientes/:id', (req, res) => {
    const data = loadData();
    const cliente = clientesMod.acharCliente(data, String(req.params.id));
    if (!cliente) return erro(res, 404, 'Cliente não encontrado.');
    res.json({ cliente: clientesMod.clientePublico(cliente) });
  });

  app.post('/api/clientes', async (req, res) => {
    const b = req.body || {};
    let resposta = null;
    await withData((data) => {
      const r = clientesMod.salvarCliente(data, b, req.usuario);
      if (r.erro) { resposta = { status: 400, erro: r.erro }; return; }
      log(data, req, r.criado ? 'criar' : 'editar',
        `${r.criado ? 'Cliente cadastrado' : 'Cliente atualizado'}: ${r.cliente.nome}`, r.cliente.id);
      resposta = { status: r.criado ? 201 : 200, corpo: { cliente: clientesMod.clientePublico(r.cliente), criado: r.criado } };
    });
    if (resposta.erro) return erro(res, resposta.status, resposta.erro);
    res.status(resposta.status).json(resposta.corpo);
  });

  app.put('/api/clientes/:id', async (req, res) => {
    const id = String(req.params.id);
    let resposta = null;
    await withData((data) => {
      const existente = clientesMod.acharCliente(data, id);
      if (!existente) { resposta = { status: 404, erro: 'Cliente não encontrado.' }; return; }
      const r = clientesMod.salvarCliente(data, { ...(req.body || {}), id }, req.usuario);
      if (r.erro) { resposta = { status: 400, erro: r.erro }; return; }
      log(data, req, 'editar', `Cliente atualizado: ${r.cliente.nome}`, id);
      resposta = { status: 200, corpo: { cliente: clientesMod.clientePublico(r.cliente) } };
    });
    if (resposta.erro) return erro(res, resposta.status, resposta.erro);
    res.status(resposta.status).json(resposta.corpo);
  });

  app.delete('/api/clientes/:id', async (req, res) => {
    if (req.usuario.perfil !== 'admin') return erro(res, 403, 'Só o administrador apaga clientes.');
    const id = String(req.params.id);
    let resposta = null;
    await withData((data) => {
      const alvo = clientesMod.acharCliente(data, id);
      if (!alvo) { resposta = { status: 404, erro: 'Cliente não encontrado.' }; return; }
      const r = clientesMod.removerCliente(data, id);
      if (r && r.erro) { resposta = { status: 400, erro: r.erro }; return; }
      log(data, req, 'excluir', `Cliente apagado: ${alvo.nome}`, id);
      resposta = { status: 200, corpo: { ok: true } };
    });
    if (resposta.erro) return erro(res, resposta.status, resposta.erro);
    res.status(resposta.status).json(resposta.corpo);
  });

  // ---------------- importação da lista (CSV/TXT) ----------------
  // A prévia não grava nada; o confirmar refaz a leitura e grava (é idempotente: documento/nome não duplica).
  app.post('/api/clientes/importar/previa', (req, res) => {
    const conteudo = String((req.body || {}).conteudo || '');
    if (!conteudo.trim()) return erro(res, 400, 'Envie o conteúdo do arquivo (CSV ou TXT).');
    if (conteudo.length > 4 * 1024 * 1024) return erro(res, 400, 'Arquivo grande demais (limite de 4 MB).');
    const data = loadData();
    const previa = clientesMod.previaImportacao(data, conteudo);
    res.json({
      novos: previa.novos.slice(0, 200),
      atualizados: previa.atualizados.slice(0, 200),
      ignoradas: previa.ignoradas,
      total: previa.total,
      novosTotal: previa.novos.length,
      atualizadosTotal: previa.atualizados.length,
      temCabecalho: previa.temCabecalho,
    });
  });

  app.post('/api/clientes/importar', async (req, res) => {
    const conteudo = String((req.body || {}).conteudo || '');
    if (!conteudo.trim()) return erro(res, 400, 'Envie o conteúdo do arquivo (CSV ou TXT).');
    let resultado = null;
    await withData((data) => {
      resultado = clientesMod.aplicarImportacao(data, conteudo, req.usuario);
      log(data, req, 'importar',
        `Importação de clientes: ${resultado.criados} novo(s), ${resultado.atualizados} atualizado(s)`, 'importacao');
    });
    res.json(resultado || { criados: 0, atualizados: 0, total: 0 });
  });
}

module.exports = { registrarRotas };
