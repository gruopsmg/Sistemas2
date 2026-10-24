// UNICAR - Log de auditoria
// Registra ações sensíveis (editar preço, excluir pneu, mexer em usuários, etc.)
// separado das "movimentações" de estoque, que já têm sua própria lista.

const crypto = require('crypto');

const MAX_REGISTROS_PADRAO = 3000; // valor padrao; pode ser trocado por configuracao (LIMITE_AUDITORIA)
let maxRegistros = MAX_REGISTROS_PADRAO; // na pratica existe uma unica instancia por processo

function garantirFormatoAuditoria(data) {
  if (!Array.isArray(data.auditoria)) data.auditoria = [];
  return data;
}

// Chamado de dentro de um withData(): recebe o "data" já aberto para escrita.
function registrar(data, { usuario, usuarioId, loja, acao, entidade, entidadeId, resumo }) {
  garantirFormatoAuditoria(data);
  data.auditoria.unshift({
    id: crypto.randomUUID(),
    usuario: usuario || 'sistema',
    usuarioId: usuarioId || null,
    loja: loja || null,
    acao,               // 'criar' | 'editar' | 'excluir' | 'entrada' | 'saida' (estas duas: bebidas)
    entidade,            // 'pneu' | 'garantia' | 'usuario' | 'backup' | 'bebida'
    entidadeId: entidadeId || null,
    resumo: resumo || '',
    criadoEm: Date.now(),
  });
  if (data.auditoria.length > maxRegistros) {
    data.auditoria = data.auditoria.slice(0, maxRegistros);
  }
}

module.exports = function criarAuditoria({ loadData, limiteRegistros }) {
  if (Number.isFinite(Number(limiteRegistros)) && Number(limiteRegistros) > 0) {
    maxRegistros = Math.trunc(Number(limiteRegistros));
  }
  function registrarRotas(app, exigirAdmin) {
    // Só o administrador vê o log de auditoria
    app.get('/api/auditoria', exigirAdmin, (req, res) => {
      const data = garantirFormatoAuditoria(loadData());
      const limite = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
      res.json(data.auditoria.slice(0, limite));
    });
  }

  return { garantirFormatoAuditoria, registrar, registrarRotas };
};
