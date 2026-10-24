// UNICAR - Rotas do cadastro de técnicos/mecânicos
// Administrador: todas as lojas. Gerente: só a própria loja. Os demais não acessam.

const tecnicosMod = require('./tecnicos');

function registrarRotas(app, ctx) {
  const { loadData, withData, auditoria } = ctx;

  const erro = (res, status, mensagem) => res.status(status).json({ error: mensagem });
  const permitido = (req, res, next) => {
    const perfil = req.usuario && req.usuario.perfil;
    if (perfil !== 'admin' && perfil !== 'gerente') return erro(res, 403, 'Só administrador e gerente cadastram técnicos.');
    next();
  };
  const log = (data, req, acao, resumo, id) => auditoria.registrar(data, {
    usuario: req.usuario.nome, usuarioId: req.usuario.id, loja: req.usuario.loja || null,
    acao, entidade: 'tecnico', entidadeId: id || null, resumo,
  });

  app.get('/api/tecnicos', permitido, (req, res) => {
    res.json({ tecnicos: tecnicosMod.listar(loadData(), req.usuario) });
  });

  app.post('/api/tecnicos', permitido, async (req, res) => {
    let r = null;
    await withData((data) => {
      r = tecnicosMod.salvar(data, { ...(req.body || {}), id: undefined }, req.usuario);
      if (r.erro) return;
      log(data, req, 'criar', `Técnico cadastrado: ${r.tecnico.nome}${r.tecnico.loja ? ` (${r.tecnico.loja})` : ''}`, r.tecnico.id);
    });
    if (r.erro) return erro(res, r.status, r.erro);
    res.status(201).json({ tecnico: tecnicosMod.tecnicoPublico(r.tecnico) });
  });

  app.put('/api/tecnicos/:id', permitido, async (req, res) => {
    let r = null;
    await withData((data) => {
      r = tecnicosMod.salvar(data, { ...(req.body || {}), id: String(req.params.id) }, req.usuario);
      if (r.erro) return;
      log(data, req, 'editar', `Técnico atualizado: ${r.tecnico.nome}`, r.tecnico.id);
    });
    if (r.erro) return erro(res, r.status, r.erro);
    res.json({ tecnico: tecnicosMod.tecnicoPublico(r.tecnico) });
  });

  app.delete('/api/tecnicos/:id', permitido, async (req, res) => {
    let r = null;
    await withData((data) => {
      r = tecnicosMod.remover(data, String(req.params.id), req.usuario);
      if (r.erro) return;
      log(data, req, r.desativado ? 'editar' : 'excluir',
        `${r.desativado ? 'Técnico desativado (já está em OS)' : 'Técnico apagado'}: ${r.tecnico.nome}`, r.tecnico.id);
    });
    if (r.erro) return erro(res, r.status, r.erro);
    res.json({ ok: true, desativado: !!r.desativado });
  });
}

module.exports = { registrarRotas };
