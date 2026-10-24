// UNICAR - Rotas do WhatsApp (envio da OS digital) por loja
// Só envia: não recebe, não responde e não é atendimento.

const whatsapp = require('./whatsapp');
const osPdf = require('./os-pdf');
const { acharLoja, normalizarCodigo } = require('./lojas');
const { veTodasAsLojas } = require('./permissoes');

const INTERVALO_MINIMO_ENVIO_MS = 60 * 1000; // evita clique repetido / disparo em massa
const ultimoEnvioPorOS = new Map();

function erro(res, status, mensagem) {
  return res.status(status).json({ error: mensagem });
}

// admin mexe em qualquer loja; gerente só na dele
function podeAdministrar(usuario, codigoLoja) {
  if (!usuario) return false;
  if (usuario.perfil === 'admin') return true;
  if (usuario.perfil === 'gerente') return normalizarCodigo(usuario.loja) === normalizarCodigo(codigoLoja);
  return false;
}

function podeEnviarOS(usuario) {
  if (!usuario) return false;
  return ['admin', 'gerente', 'operador'].includes(usuario.perfil);
}

function registrarRotas(app, ctx) {
  const { loadData, withData, auth, auditoria } = ctx;

  const log = (data, req, acao, resumo, entidadeId) => auditoria.registrar(data, {
    usuario: req.usuario.nome,
    usuarioId: req.usuario.id,
    loja: req.usuario.loja || null,
    acao,
    entidade: 'whatsapp',
    entidadeId: entidadeId || null,
    resumo,
  });

  // ---------------- status das conexões ----------------
  app.get('/api/whatsapp', async (req, res) => {
    const todas = veTodasAsLojas(req.usuario);
    const codigos = todas
      ? (loadData().lojas || []).map((l) => l.codigo)
      : [normalizarCodigo(req.usuario.loja)];
    const lista = codigos.map((c) => whatsapp.estadoPublico(c));
    res.json({ lojas: lista, podeAdministrar: req.usuario.perfil === 'admin' || req.usuario.perfil === 'gerente' });
  });

  app.get('/api/whatsapp/:loja', (req, res) => {
    const codigo = normalizarCodigo(req.params.loja);
    if (!veTodasAsLojas(req.usuario) && codigo !== normalizarCodigo(req.usuario.loja)) {
      return erro(res, 403, 'Você só vê o WhatsApp da sua loja.');
    }
    res.json({ whatsapp: whatsapp.estadoPublico(codigo) });
  });

  // ---------------- conectar (QR Code) ----------------
  app.post('/api/whatsapp/:loja/conectar', async (req, res) => {
    const codigo = normalizarCodigo(req.params.loja);
    if (!podeAdministrar(req.usuario, codigo)) return erro(res, 403, 'Só o administrador ou o gerente da loja conecta o WhatsApp.');
    try {
      const estado = await whatsapp.conectar(codigo);
      await withData((data) => log(data, req, 'conectar', `WhatsApp da loja ${codigo}: conexão iniciada (QR Code)`, codigo));
      res.json({ whatsapp: estado });
    } catch (e) {
      res.status(500).json({ error: `Não consegui iniciar a conexão: ${e.message}` });
    }
  });

  // ---------------- conectar por número (código de 8 caracteres) ----------------
  app.post('/api/whatsapp/:loja/codigo', async (req, res) => {
    const codigo = normalizarCodigo(req.params.loja);
    if (!podeAdministrar(req.usuario, codigo)) return erro(res, 403, 'Só o administrador ou o gerente da loja conecta o WhatsApp.');
    const telefone = String((req.body || {}).telefone || '').trim();
    if (!whatsapp.normalizarNumero(telefone)) return erro(res, 400, 'Digite o número com DDD (ex.: 22999998888).');
    try {
      const estado = await whatsapp.conectar(codigo, { telefone });
      await withData((data) => log(data, req, 'conectar', `WhatsApp da loja ${codigo}: pedido de código para ${whatsapp.normalizarNumero(telefone)}`, codigo));
      res.json({ whatsapp: estado });
    } catch (e) {
      res.status(500).json({ error: `Não consegui gerar o código: ${e.message}` });
    }
  });

  // ---------------- desconectar ----------------
  app.post('/api/whatsapp/:loja/desconectar', async (req, res) => {
    const codigo = normalizarCodigo(req.params.loja);
    if (!podeAdministrar(req.usuario, codigo)) return erro(res, 403, 'Só o administrador ou o gerente da loja desconecta o WhatsApp.');
    const apagar = (req.body || {}).apagar === true;
    const estado = await whatsapp.desconectar(codigo, { apagar });
    await withData((data) => log(data, req, 'desconectar',
      `WhatsApp da loja ${codigo}: desconectado${apagar ? ' e sessão apagada' : ''}`, codigo));
    res.json({ whatsapp: estado });
  });

  // ---------------- mensagem de teste ----------------
  app.post('/api/whatsapp/:loja/teste', async (req, res) => {
    const codigo = normalizarCodigo(req.params.loja);
    if (!podeAdministrar(req.usuario, codigo)) return erro(res, 403, 'Só o administrador ou o gerente da loja envia o teste.');
    const numero = String((req.body || {}).numero || '').trim();
    if (!whatsapp.normalizarNumero(numero)) return erro(res, 400, 'Digite o número que vai receber o teste (DDD + número).');
    try {
      const r = await whatsapp.enviarTexto(codigo, {
        numero,
        texto: `Teste do sistema UNICAR — loja ${codigo}. Se você recebeu esta mensagem, o envio de OS está funcionando.`,
      });
      await withData((data) => log(data, req, 'teste', `WhatsApp da loja ${codigo}: mensagem de teste enviada`, codigo));
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  });

  // ---------------- enviar a OS em PDF ----------------
  app.post('/api/os/:chave/enviar-whatsapp', async (req, res) => {
    if (!podeEnviarOS(req.usuario)) return erro(res, 403, 'Seu perfil não pode enviar OS.');
    const data = loadData();
    const chave = String(req.params.chave || '');
    const os = (data.os || []).find((o) => o.id === chave || String(o.numero).toUpperCase() === chave.toUpperCase());
    if (!os) return erro(res, 404, 'OS não encontrada.');
    if (req.usuario.perfil !== 'admin' && normalizarCodigo(os.loja) !== normalizarCodigo(req.usuario.loja)) {
      return erro(res, 403, 'Esta OS é de outra loja.');
    }

    const numero = whatsapp.normalizarNumero((req.body || {}).numero
      || (os.cliente && (os.cliente.whatsapp || os.cliente.telefone)) || '');
    if (!numero) return erro(res, 400, 'Esta OS não tem telefone do cliente. Digite o número para enviar.');

    const anterior = ultimoEnvioPorOS.get(os.id);
    if (anterior && Date.now() - anterior < INTERVALO_MINIMO_ENVIO_MS) {
      const faltam = Math.ceil((INTERVALO_MINIMO_ENVIO_MS - (Date.now() - anterior)) / 1000);
      return erro(res, 429, `Esta OS já foi enviada agora há pouco. Espere ${faltam}s para enviar de novo.`);
    }

    const loja = acharLoja(data, os.loja) || { codigo: os.loja, nome: os.loja };
    let pdf;
    try {
      pdf = await osPdf.gerarPDF(os, loja, { config: data.impressao || {} });
    } catch (e) {
      return res.status(500).json({ error: `Não consegui montar o PDF da OS: ${e.message}` });
    }
    const legenda = String((req.body || {}).mensagem || '').trim() || osPdf.mensagemDaOS(os, loja);

    try {
      const r = await whatsapp.enviarDocumento(os.loja, {
        numero, pdf, nomeArquivo: osPdf.nomeArquivo(os), legenda, osNumero: os.numero,
      });
      ultimoEnvioPorOS.set(os.id, Date.now());
      await withData((d) => {
        const alvo = (d.os || []).find((o) => o.id === os.id);
        if (alvo) {
          alvo.whatsappEnvios = Array.isArray(alvo.whatsappEnvios) ? alvo.whatsappEnvios : [];
          alvo.whatsappEnvios.push({ numero, em: Date.now(), por: req.usuario.nome, loja: os.loja });
        }
        log(d, req, 'enviar', `OS ${os.numero} enviada pelo WhatsApp para ${numero}`, os.id);
      });
      res.json({ ok: true, numero, os: os.numero, em: r.em || Date.now() });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  });

  // baixar/abrir o PDF da OS (mesmo documento que vai pelo WhatsApp)
  app.get('/api/os/:chave/pdf', async (req, res) => {
    const data = loadData();
    const chave = String(req.params.chave || '');
    const os = (data.os || []).find((o) => o.id === chave || String(o.numero).toUpperCase() === chave.toUpperCase());
    if (!os) return erro(res, 404, 'OS não encontrada.');
    if (req.usuario.perfil !== 'admin' && normalizarCodigo(os.loja) !== normalizarCodigo(req.usuario.loja)) {
      return erro(res, 403, 'Esta OS é de outra loja.');
    }
    const loja = acharLoja(data, os.loja) || { codigo: os.loja, nome: os.loja };
    try {
      const pdf = await osPdf.gerarPDF(os, loja, { config: data.impressao || {} });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${osPdf.nomeArquivo(os)}"`);
      res.send(pdf);
    } catch (e) {
      res.status(500).json({ error: `Não consegui montar o PDF: ${e.message}` });
    }
  });

  // histórico de envios (para a ficha da OS)
  app.get('/api/os/:chave/whatsapp', (req, res) => {
    const data = loadData();
    const chave = String(req.params.chave || '');
    const os = (data.os || []).find((o) => o.id === chave || String(o.numero).toUpperCase() === chave.toUpperCase());
    if (!os) return erro(res, 404, 'OS não encontrada.');
    if (req.usuario.perfil !== 'admin' && normalizarCodigo(os.loja) !== normalizarCodigo(req.usuario.loja)) {
      return erro(res, 403, 'Esta OS é de outra loja.');
    }
    res.json({ envios: Array.isArray(os.whatsappEnvios) ? os.whatsappEnvios : [] });
  });
}

module.exports = { registrarRotas };
