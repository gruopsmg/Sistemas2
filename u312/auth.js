// UNICAR - Login por usuário (sessões por cookie, sem dependências extras)
// Usado pelo server.js. Os usuários e as sessões ficam salvos no mesmo data.json.

const crypto = require('crypto');
const { PERFIS, PERFIL_ROTULO, normalizarPerfil, permissoesDoPerfil } = require('./permissoes');
const { garantirLojas, lojaValida, normalizarCodigo, rotuloLoja } = require('./lojas');
const { marcaDaLoja } = require('./marcas');
const estoquesMod = require('./estoques');

const COOKIE_NOME = 'unicar_sessao';
const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas
const MAX_TENTATIVAS = 8;                      // tentativas erradas antes de travar
const TRAVA_MS = 5 * 60 * 1000;                // tempo de trava por IP
const MAX_TENTATIVAS_SENHA = 5;               // erros ao confirmar a senha (ver valor de compra) antes de travar

// ---------- senhas ----------
function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function conferirSenha(senha, guardado) {
  if (!guardado || typeof guardado !== 'string' || !guardado.includes(':')) return false;
  const [salt, hash] = guardado.split(':');
  let teste;
  try { teste = crypto.scryptSync(String(senha), salt, 64); } catch (e) { return false; }
  const alvo = Buffer.from(hash, 'hex');
  if (teste.length !== alvo.length) return false;
  return crypto.timingSafeEqual(teste, alvo);
}

// ---------- utilidades ----------
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const txt = (v) => (v === undefined || v === null ? '' : String(v).trim());
const normalizarLogin = (v) => txt(v).toLowerCase().replace(/\s+/g, '');

function lerCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((parte) => {
    const i = parte.indexOf('=');
    if (i === -1) return;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// Versão do usuário que pode ir para a tela (nunca inclui a senha)
function usuarioPublico(u) {
  if (!u) return null;
  const perfil = normalizarPerfil(u.perfil);
  return {
    id: u.id,
    nome: u.nome,
    usuario: u.usuario,
    perfil: u.perfil,
    perfilNormalizado: perfil,
    perfilRotulo: PERFIL_ROTULO[perfil] || perfil,
    loja: u.loja || null,
    ativo: u.ativo !== false,
    criadoEm: u.criadoEm,
    ultimoAcessoEm: u.ultimoAcessoEm || null,
    // O que este perfil pode fazer (a tela usa para esconder; o servidor confere de novo)
    permissoes: permissoesDoPerfil(perfil),
  };
}

// Garante que data.json tenha as listas de usuários e sessões
function garantirFormatoAuth(data) {
  if (!Array.isArray(data.usuarios)) data.usuarios = [];
  if (!Array.isArray(data.sessoes)) data.sessoes = [];
  garantirLojas(data); // as três lojas precisam existir para o sistema de OS funcionar
  return data;
}

// Remove do estado tudo que não deve ir para os navegadores.
// - O valor de compra (precoCusto) de cada pneu NUNCA sai daqui: para ver um valor,
//   a pessoa precisa confirmar a própria senha (rota POST /api/pneus/:id/custo).
// - O valor total do estoque (a preço de compra) só é calculado e enviado para administradores.
// - ESTOQUE POR LOJA: quem não é administrador recebe SÓ os números da própria loja
//   (quantidade, mínimo e localização). O estoque das outras lojas não chega no navegador
//   dele nem escondido num campo: é recortado aqui, no servidor.
function estadoPublico(data, usuario) {
  // Loja, OS e o contador de numeração NÃO vão no estado geral:
  // as Ordens de Serviço são carregadas pela API (a tela pede já filtrado pela loja).
  // Chat e importações também não: cada um tem rota própria com a checagem de participação.
  const {
    usuarios, sessoes, auditoria, os, lojas, osSequencia, migracoes,
    chatMensagens, chatSalas, chamados, importacoes, ...resto
  } = data || {};
  const pneus = Array.isArray(resto.pneus) ? resto.pneus : [];
  const ehAdmin = !!usuario && usuario.perfil === 'admin';
  const lojaDoUsuario = usuario && !ehAdmin ? String(usuario.loja || '').toUpperCase() : '';

  if (ehAdmin) {
    // Administrador: vê o consolidado e o mapa de todas as lojas (estoques), sem o custo? não —
    // administrador recebe o valor de compra (já era assim).
    resto.pneus = pneus.map((pneu) => ({ ...pneu }));
    resto.valorEstoque = pneus.reduce((s, t) => s + (Number(t.quantidade) || 0) * (Number(t.precoCusto) || 0), 0);
    resto.estoquePorLoja = true;
  } else {
    resto.pneus = pneus.map(({ precoCusto, ...pneu }) => {
      if (!lojaDoUsuario) return { ...pneu, quantidade: 0, estoqueMinimo: 0, localizacao: '', estoques: {} };
      const quantidade = estoquesMod.qtdNaLoja(pneu, lojaDoUsuario);
      const minimo = estoquesMod.minimoNaLoja(pneu, lojaDoUsuario);
      const localizacao = estoquesMod.localNaLoja(pneu, lojaDoUsuario);
      return {
        ...pneu,
        quantidade,
        estoqueMinimo: minimo,
        localizacao,
        // só a loja dele no mapa (nada de vazar o saldo das outras)
        estoques: { [lojaDoUsuario]: { quantidade, minimo, localizacao } },
        loja: lojaDoUsuario,
      };
    });
    // Movimentações e garantias também são recortadas pela loja
    resto.movimentos = (Array.isArray(resto.movimentos) ? resto.movimentos : [])
      .filter((m) => !m || !m.loja || String(m.loja).toUpperCase() === lojaDoUsuario);
    resto.garantias = (Array.isArray(resto.garantias) ? resto.garantias : [])
      .filter((g) => !g || !g.loja || String(g.loja).toUpperCase() === lojaDoUsuario);
    resto.estoquePorLoja = false;
  }
  return resto;
}

module.exports = function criarAuth({ loadData, withData, registrarAuditoria }) {
  const tentativas = new Map(); // ip -> { erros, ate }
  const tentativasSenha = new Map(); // usuarioId -> { erros, janelaAte, bloqueadoAte }
  const auditar = typeof registrarAuditoria === 'function' ? registrarAuditoria : () => {};

  // ---------- primeiro acesso ----------
  // Se não houver nenhum usuário, cria o administrador padrão.
  async function garantirAdminPadrao() {
    let criado = null;
    await withData((data) => {
      garantirFormatoAuth(data);
      if (data.usuarios.length > 0) return;
      const admin = {
        id: crypto.randomUUID(),
        nome: 'Administrador',
        usuario: 'admin',
        senhaHash: gerarHashSenha('unicar123'),
        perfil: 'admin',
        loja: null, // administrador: acesso a todas as lojas
        ativo: true,
        precisaTrocarSenha: true,
        criadoEm: Date.now(),
        ultimoAcessoEm: null,
      };
      data.usuarios.push(admin);
      criado = admin;
    });
    return criado;
  }

  // ---------- sessões ----------
  function limparSessoesVencidas(data) {
    const agora = Date.now();
    data.sessoes = (data.sessoes || []).filter((s) => s.expiraEm > agora);
  }

  async function criarSessao(usuarioId) {
    const token = crypto.randomBytes(32).toString('hex');
    await withData((data) => {
      garantirFormatoAuth(data);
      limparSessoesVencidas(data);
      data.sessoes.push({
        tokenHash: hashToken(token),
        usuarioId,
        criadaEm: Date.now(),
        expiraEm: Date.now() + DURACAO_SESSAO_MS,
      });
      const u = data.usuarios.find((x) => x.id === usuarioId);
      if (u) u.ultimoAcessoEm = Date.now();
    });
    return token;
  }

  async function encerrarSessao(token) {
    if (!token) return;
    const th = hashToken(token);
    await withData((data) => {
      garantirFormatoAuth(data);
      data.sessoes = data.sessoes.filter((s) => s.tokenHash !== th);
    });
  }

  // Encerra todas as sessões de um usuário (ao trocar senha, desativar, excluir)
  function derrubarSessoesDe(data, usuarioId) {
    data.sessoes = (data.sessoes || []).filter((s) => s.usuarioId !== usuarioId);
  }

  // Descobre o usuário a partir do token, sem depender de estado em memória
  // Versão que usa um "data" já carregado (permite atender vários sockets lendo o arquivo só uma vez)
  function usuarioNoData(data, token) {
    if (!token) return null;
    garantirFormatoAuth(data);
    const sessao = data.sessoes.find((s) => s.tokenHash === hashToken(token));
    if (!sessao || sessao.expiraEm <= Date.now()) return null;
    const u = data.usuarios.find((x) => x.id === sessao.usuarioId);
    if (!u || u.ativo === false) return null;
    return u;
  }

  function usuarioDoToken(token) {
    if (!token) return null;
    return usuarioNoData(loadData(), token);
  }

  function tokenDoSocket(socket) {
    return lerCookies(socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie)[COOKIE_NOME] || null;
  }

  // Confere a senha da pessoa que já está logada (usado para liberar o valor de compra).
  // Trava por usuário depois de várias tentativas erradas, para ninguém ficar "chutando" a senha.
  function verificarSenhaDoUsuario(usuario, senha) {
    const reg = tentativasSenha.get(usuario.id);
    if (reg && reg.bloqueadoAte > Date.now()) {
      const min = Math.ceil((reg.bloqueadoAte - Date.now()) / 60000);
      return { ok: false, status: 429, erro: `Muitas tentativas erradas. Tente de novo em ${min} min.` };
    }
    if (!conferirSenha(String(senha || ''), usuario.senhaHash)) {
      const dentroDaJanela = reg && reg.janelaAte > Date.now();
      const erros = (dentroDaJanela ? reg.erros : 0) + 1;
      tentativasSenha.set(usuario.id, {
        erros,
        janelaAte: Date.now() + TRAVA_MS,
        bloqueadoAte: erros >= MAX_TENTATIVAS_SENHA ? Date.now() + TRAVA_MS : 0,
      });
      // 403 (e não 401): a tela trata 401 como "sessão expirada" e mandaria para o login
      return { ok: false, status: 403, erro: 'Senha incorreta.' };
    }
    tentativasSenha.delete(usuario.id);
    return { ok: true };
  }

  function tokenDoReq(req) {
    return lerCookies(req.headers.cookie)[COOKIE_NOME] || null;
  }

  function usuarioDoReq(req) {
    return usuarioDoToken(tokenDoReq(req));
  }

  // ---------- middlewares ----------
  function exigirLogin(req, res, next) {
    const u = usuarioDoReq(req);
    if (!u) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    req.usuario = u;
    next();
  }

  function exigirAdmin(req, res, next) {
    if (!req.usuario || req.usuario.perfil !== 'admin') {
      return res.status(403).json({ error: 'Apenas o administrador pode fazer isso.' });
    }
    next();
  }

  // Exige um dos perfis informados (ex.: exigirPerfil('admin', 'gerente'))
  function exigirPerfil(...perfisAceitos) {
    const aceitos = perfisAceitos.map(normalizarPerfil);
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
      if (!aceitos.includes(normalizarPerfil(req.usuario.perfil))) {
        return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
      }
      next();
    };
  }

  // Bloqueia o acesso à tela principal de quem não fez login
  function protegerPaginas(req, res, next) {
    if (usuarioDoReq(req)) return next();
    res.redirect('/login.html');
  }

  function socketMiddleware(socket, next) {
    const token = lerCookies(socket.handshake.headers?.cookie)[COOKIE_NOME];
    const u = usuarioDoToken(token);
    if (!u) return next(new Error('nao-autenticado'));
    socket.data.usuario = usuarioPublico(u);
    next();
  }

  // ---------- rotas ----------
  function registrarRotasPublicas(app) {
    app.post('/api/login', async (req, res) => {
      const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
      const reg = tentativas.get(ip);
      if (reg && reg.bloqueadoAte > Date.now()) {
        const min = Math.ceil((reg.bloqueadoAte - Date.now()) / 60000);
        return res.status(429).json({ error: `Muitas tentativas erradas. Tente de novo em ${min} min.` });
      }

      const login = normalizarLogin((req.body || {}).usuario);
      const senha = String((req.body || {}).senha || '');
      const data = garantirFormatoAuth(loadData());
      const u = data.usuarios.find((x) => normalizarLogin(x.usuario) === login);

      if (!u || u.ativo === false || !conferirSenha(senha, u.senhaHash)) {
        const dentroDaJanela = reg && reg.janelaAte > Date.now();
        const erros = (dentroDaJanela ? reg.erros : 0) + 1;
        tentativas.set(ip, {
          erros,
          janelaAte: Date.now() + TRAVA_MS,
          bloqueadoAte: erros >= MAX_TENTATIVAS ? Date.now() + TRAVA_MS : 0,
        });
        return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      }

      tentativas.delete(ip);
      const token = await criarSessao(u.id);
      res.cookie
        ? res.cookie(COOKIE_NOME, token, { httpOnly: true, sameSite: 'lax', maxAge: DURACAO_SESSAO_MS })
        : res.setHeader('Set-Cookie', `${COOKIE_NOME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`);
      const publico = usuarioPublico(u);
      // A tela usa isto para mostrar a logo e o nome da LOJA do usuário logado.
      res.json({ usuario: publico, marca: marcaDaLoja(publico.loja), precisaTrocarSenha: !!u.precisaTrocarSenha });
    });

    app.post('/api/logout', async (req, res) => {
      await encerrarSessao(tokenDoReq(req));
      res.setHeader('Set-Cookie', `${COOKIE_NOME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      res.json({ ok: true });
    });

    // Quem sou eu (usado pela tela para saber se ainda está logado)
    app.get('/api/eu', (req, res) => {
      const u = usuarioDoReq(req);
      if (!u) return res.status(401).json({ error: 'Não autenticado.' });
      const publico = usuarioPublico(u);
      res.json({ usuario: publico, marca: marcaDaLoja(publico.loja), precisaTrocarSenha: !!u.precisaTrocarSenha });
    });
  }

  function registrarRotasProtegidas(app) {
    // Troca da própria senha
    app.post('/api/minha-senha', async (req, res) => {
      const senhaAtual = String((req.body || {}).senhaAtual || '');
      const novaSenha = String((req.body || {}).novaSenha || '');
      if (novaSenha.length < 4) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 4 caracteres.' });
      if (!conferirSenha(senhaAtual, req.usuario.senhaHash)) {
        return res.status(400).json({ error: 'A senha atual está incorreta.' });
      }
      const tokenAtual = tokenDoReq(req);
      await withData((data) => {
        garantirFormatoAuth(data);
        const u = data.usuarios.find((x) => x.id === req.usuario.id);
        if (!u) return;
        u.senhaHash = gerarHashSenha(novaSenha);
        u.precisaTrocarSenha = false;
        // derruba as outras sessões desse usuário, mantendo só a atual
        const th = hashToken(tokenAtual);
        data.sessoes = data.sessoes.filter((s) => s.usuarioId !== u.id || s.tokenHash === th);
      });
      res.json({ ok: true });
    });

    // ----- administração de usuários (só admin) -----
    app.get('/api/usuarios', exigirAdmin, (req, res) => {
      const data = garantirFormatoAuth(loadData());
      const lista = data.usuarios
        .slice()
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
        .map(usuarioPublico);
      res.json(lista);
    });

    app.post('/api/usuarios', exigirAdmin, async (req, res) => {
      const b = req.body || {};
      const nome = txt(b.nome);
      const login = normalizarLogin(b.usuario);
      const senha = String(b.senha || '');
      const perfil = normalizarPerfil(b.perfil);
      const lojaPedida = normalizarCodigo(b.loja);

      if (!nome || !login) return res.status(400).json({ error: 'Informe o nome e o usuário de acesso.' });
      if (!/^[a-z0-9._-]+$/.test(login)) return res.status(400).json({ error: 'O usuário de acesso só pode ter letras, números, ponto, hífen ou _.' });
      if (senha.length < 4) return res.status(400).json({ error: 'A senha precisa ter pelo menos 4 caracteres.' });

      let erro = null;
      let criado = null;
      await withData((data) => {
        garantirFormatoAuth(data);
        if (data.usuarios.some((x) => normalizarLogin(x.usuario) === login)) {
          erro = 'Já existe um usuário com esse nome de acesso.';
          return;
        }
        // Administrador enxerga todas as lojas (loja fica vazia); os outros perfis
        // precisam de uma loja válida, senão ficariam sem acesso a nada.
        let loja = null;
        if (perfil !== 'admin') {
          if (!lojaPedida) { erro = 'Escolha a loja do usuário (UNICAR, FILIAL ou MATRIZ).'; return; }
          if (!lojaValida(data, lojaPedida)) { erro = `Loja inválida ou inativa: ${lojaPedida}.`; return; }
          loja = lojaPedida;
        }
        criado = {
          id: crypto.randomUUID(),
          nome,
          usuario: login,
          senhaHash: gerarHashSenha(senha),
          perfil,
          loja,
          ativo: true,
          precisaTrocarSenha: true,
          criadoEm: Date.now(),
          ultimoAcessoEm: null,
        };
        data.usuarios.push(criado);
        auditar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          loja,
          acao: 'criar',
          entidade: 'usuario',
          entidadeId: criado.id,
          resumo: `Criou o usuário "${criado.nome}" (${criado.usuario}, ${PERFIL_ROTULO[perfil] || perfil}`
            + `${loja ? `, loja ${loja}` : ', todas as lojas'}).`,
        });
      });
      if (erro) return res.status(400).json({ error: erro });
      res.json(usuarioPublico(criado));
    });

    app.put('/api/usuarios/:id', exigirAdmin, async (req, res) => {
      const b = req.body || {};
      let erro = null;
      let atualizado = null;
      await withData((data) => {
        garantirFormatoAuth(data);
        const u = data.usuarios.find((x) => x.id === req.params.id);
        if (!u) { erro = 'Usuário não encontrado.'; return; }

        const admins = data.usuarios.filter((x) => x.perfil === 'admin' && x.ativo !== false);
        const perfilNovo = b.perfil !== undefined ? normalizarPerfil(b.perfil) : null;
        const viraNaoAdmin = perfilNovo !== null && perfilNovo !== 'admin' && u.perfil === 'admin';
        const viraInativo = b.ativo === false && u.ativo !== false;
        if ((viraNaoAdmin || viraInativo) && admins.length <= 1 && u.perfil === 'admin') {
          erro = 'Precisa existir pelo menos um administrador ativo.';
          return;
        }
        if (viraInativo && u.id === req.usuario.id) { erro = 'Você não pode desativar o seu próprio acesso.'; return; }

        const perfilAntes = u.perfil;
        const lojaAntes = u.loja || null;
        if (b.nome !== undefined) u.nome = txt(b.nome) || u.nome;
        if (b.perfil !== undefined) u.perfil = perfilNovo;
        if (b.loja !== undefined) {
          const pedida = normalizarCodigo(b.loja);
          if (u.perfil === 'admin') {
            u.loja = null;
          } else if (!pedida) {
            erro = 'Escolha a loja do usuário.';
            return;
          } else if (!lojaValida(data, pedida)) {
            erro = `Loja inválida ou inativa: ${pedida}.`;
            return;
          } else {
            u.loja = pedida;
          }
        }
        if (u.perfil === 'admin') u.loja = null; // administrador nunca fica preso a uma loja

        const mudancas = [];
        if (b.perfil !== undefined && u.perfil !== perfilAntes) {
          mudancas.push(`perfil → ${PERFIL_ROTULO[normalizarPerfil(u.perfil)] || u.perfil}`);
        }
        if ((u.loja || null) !== lojaAntes) mudancas.push(`loja → ${u.loja || 'todas'}`);
        if (viraInativo) mudancas.push('bloqueado');
        else if (b.ativo === true && u.ativo === false) mudancas.push('liberado de novo');
        if (b.ativo !== undefined) u.ativo = !!b.ativo;
        if (b.senha) {
          const senha = String(b.senha);
          if (senha.length < 4) { erro = 'A senha precisa ter pelo menos 4 caracteres.'; return; }
          u.senhaHash = gerarHashSenha(senha);
          u.precisaTrocarSenha = true;
          derrubarSessoesDe(data, u.id); // obriga a entrar de novo com a senha nova
          mudancas.push('senha redefinida pelo admin');
        }
        // Mudar de loja ou de perfil também derruba as sessões abertas: o acesso novo
        // passa a valer na hora (o usuário entra de novo e já com a loja certa).
        const mudouAcesso = (u.perfil !== perfilAntes) || ((u.loja || null) !== lojaAntes);
        if (mudouAcesso && u.id !== req.usuario.id) derrubarSessoesDe(data, u.id);
        if (u.ativo === false) derrubarSessoesDe(data, u.id);
        atualizado = u;
        auditar(data, {
          usuario: req.usuario.nome,
          usuarioId: req.usuario.id,
          loja: u.loja || null,
          acao: 'editar',
          entidade: 'usuario',
          entidadeId: u.id,
          resumo: `Editou o usuário "${u.nome}"${mudancas.length ? ' — ' + mudancas.join(', ') : ''}.`,
        });
      });
      if (erro) return res.status(400).json({ error: erro });
      if (!atualizado) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json(usuarioPublico(atualizado));
    });

    app.delete('/api/usuarios/:id', exigirAdmin, async (req, res) => {
      let erro = null;
      let removido = false;
      await withData((data) => {
        garantirFormatoAuth(data);
        const u = data.usuarios.find((x) => x.id === req.params.id);
        if (!u) { erro = 'Usuário não encontrado.'; return; }
        if (u.id === req.usuario.id) { erro = 'Você não pode excluir o seu próprio usuário.'; return; }
        const admins = data.usuarios.filter((x) => x.perfil === 'admin' && x.ativo !== false);
        if (u.perfil === 'admin' && admins.length <= 1) { erro = 'Precisa existir pelo menos um administrador ativo.'; return; }
        // Não excluir quem já tem histórico: a OS guarda quem abriu, o mecânico responsável e cada
        // passo no histórico. Para tirar o acesso o caminho é DESATIVAR — assim o passado fica inteiro.
        const osDoUsuario = (Array.isArray(data.os) ? data.os : []).filter((o) =>
          (o.mecanicoId && o.mecanicoId === u.id) ||
          (o.responsavel && o.responsavel.id === u.id) ||
          (Array.isArray(o.historico) && o.historico.some((h) => h && h.usuarioId === u.id)));
        if (osDoUsuario.length) {
          erro = `${u.nome} aparece em ${osDoUsuario.length} ordem(ns) de serviço. Para tirar o acesso, use Bloquear (o histórico continua guardado).`;
          return;
        }
        data.usuarios = data.usuarios.filter((x) => x.id !== u.id);
        derrubarSessoesDe(data, u.id);
        removido = true;
        auditar(data, {
          usuario: req.usuario.nome,
          acao: 'excluir',
          entidade: 'usuario',
          entidadeId: u.id,
          resumo: `Excluiu o usuário "${u.nome}" (${u.usuario}).`,
        });
      });
      if (erro) return res.status(400).json({ error: erro });
      res.json({ ok: removido });
    });
  }

  return {
    COOKIE_NOME,
    garantirFormatoAuth,
    estadoPublico,
    usuarioPublico,
    garantirAdminPadrao,
    usuarioDoReq,
    usuarioNoData,
    tokenDoSocket,
    verificarSenhaDoUsuario,
    exigirLogin,
    exigirAdmin,
    exigirPerfil,
    protegerPaginas,
    socketMiddleware,
    registrarRotasPublicas,
    registrarRotasProtegidas,
  };
};
