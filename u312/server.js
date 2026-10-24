// UNICAR - Servidor de controle de estoque de pneus (rede local / LAN)
// Roda com: npm install  ->  npm start
// Acesse de qualquer aparelho na mesma rede em: http://SEU-IP-LOCAL:3000
// Configuracao por variaveis de ambiente (.env opcional). Veja .env.example.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { carregarConfig } = require('./config');
const { criarRegistro } = require('./registro');
const { criarArmazenamento, ErroArmazenamento } = require('./armazenamento');
const criarAuth = require('./auth');
const criarAuditoria = require('./auditoria');
const modulosOS = require('./os');
const modulosRelatorios = require('./relatorios');
const estoquesMod = require('./estoques');
const grupoMod = require('./grupo');
const chatMod = require('./chat');

// ---------- Configuracao ----------
const { config, problemas } = carregarConfig();
if (problemas.length) {
  console.error('Configuracao invalida (corrija e suba de novo):');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

const registro = criarRegistro({
  pasta: config.pastaLogs,
  nivel: config.nivelLog,
  diasDeLog: config.diasDeLog,
});
registro.limparAntigos();
registro.info(`UNICAR ${config.versao} subindo (node ${process.version}, ambiente ${config.ambiente}, porta ${config.porta}, host ${config.host})`);

// ---------- Armazenamento em arquivo JSON (veja armazenamento.js) ----------
const armazenamento = criarArmazenamento({ config, registro });
const DATA_FILE = armazenamento.arquivo;
const PORT = config.porta;
const LIMITE_MOVIMENTOS = config.limiteMovimentos;
const VERSION = config.versao;
const INICIADO_EM = Date.now();

// Nomes mantidos iguais aos do codigo antigo para o resto do arquivo (e o auth.js) nao mudar
const loadData = () => armazenamento.carregar();
const saveData = (data) => armazenamento.salvar(data);
const withData = (mutateFn) => armazenamento.comDados(mutateFn);

// ---------- Base de clientes (única para todas as lojas) ----------
// Na primeira subida, monta a lista a partir dos clientes que já estão nas OS. Não apaga nada.
const clientesMod = require('./clientes');
const apiClientes = require('./api-clientes');
const apiTecnicos = require('./api-tecnicos');
const apiWhatsapp = require('./api-whatsapp');
try {
  const dadosClientes = loadData();
  const antes = Array.isArray(dadosClientes.clientes) ? dadosClientes.clientes.length : 0;
  clientesMod.garantirClientes(dadosClientes);
  if (dadosClientes.clientes.length !== antes) {
    saveData(dadosClientes);
    registro.info(`clientes: base iniciada com ${dadosClientes.clientes.length} cliente(s) das OS existentes`);
  }
} catch (e) {
  registro.aviso ? registro.aviso(`clientes: não consegui montar a base inicial (${e.message})`) : null;
}

// ---------- App ----------
const app = express();

// O Express 4 NAO manda para o tratamento de erros quando uma rota async falha
// (a promessa rejeitada fica solta: antes derrubava o processo, e com o processo de pe
// o pedido ficaria pendurado para sempre). Este trecho envolve as rotas registradas daqui
// para baixo — inclusive as do auth.js e auditoria.js — para que o erro chegue ao
// tratamento central e o cliente receba uma resposta. Middlewares de erro (4 argumentos)
// ficam como estao.
for (const metodo of ['get', 'post', 'put', 'delete', 'patch', 'use']) {
  const registrarOriginal = app[metodo].bind(app);
  app[metodo] = (...argumentos) => {
    const envolvidos = argumentos.map((arg) => {
      if (typeof arg !== 'function' || arg.length >= 4) return arg;
      return (req, res, next) => Promise.resolve(arg(req, res, next)).catch(next);
    });
    return registrarOriginal(...envolvidos);
  };
}

app.use(express.json({ limit: '25mb' })); // 25 MB: a importação manda o arquivo em base64 (limite de 10 MB)

// Log de auditoria (ver auditoria.js)
const auditoria = criarAuditoria({ loadData, limiteRegistros: config.limiteAuditoria });

// Login por usuário (ver auth.js)
const auth = criarAuth({ loadData, withData, registrarAuditoria: auditoria.registrar });

// Rotas que funcionam sem estar logado (entrar, sair, saber quem sou eu)
auth.registrarRotasPublicas(app);

// Rotas novas (identidade do grupo, importação de arquivos, chat e chamados).
// Cada rota diz se exige login: só /api/grupo é pública (a tela de login precisa do nome/logo).
// O aviso em tempo real depende do Socket.IO, que só nasce mais abaixo — por isso o
// "interruptor" avisarChat: as rotas já ficam registradas e o repasse liga logo depois.
const apiNovas = require('./api-novas');
let repassarChat = null;
const avisarChat = (tipo, dados) => { if (repassarChat) repassarChat(tipo, dados); };
apiNovas.registrarRotas(app, {
  loadData,
  withData,
  auth,
  auditoria,
  broadcastState,
  arquivoDados: DATA_FILE,
  avisarChat,
});

// A tela principal do sistema só abre para quem já entrou
app.get(['/', '/index.html'], auth.protegerPaginas);

app.use(express.static(path.join(__dirname, 'public')));

// Daqui para baixo, toda a API exige login
app.use('/api', auth.exigirLogin);

// Trocar a própria senha e administrar usuários
auth.registrarRotasProtegidas(app);

// Cadastro de clientes: base única do grupo (qualquer loja vê e usa qualquer cliente)
apiClientes.registrarRotas(app, { loadData, withData, auth, auditoria });

// Cadastro de técnicos/mecânicos (admin: todas as lojas; gerente: só a própria)
apiTecnicos.registrarRotas(app, { loadData, withData, auth, auditoria });

// WhatsApp: envio da OS digital (uma conexão por loja). Só envia — não recebe nem responde.
apiWhatsapp.registrarRotas(app, { loadData, withData, auth, auditoria });

// Consultar o log de auditoria (só admin)
auditoria.registrarRotas(app, auth.exigirAdmin);

// Ordens de Serviço (cada uma pertence a uma loja) e painéis/relatórios das lojas.
// A checagem de loja e de perfil acontece dentro desses módulos, no servidor.
modulosOS.registrarRotas(app, {
  loadData,
  withData,
  auth,
  auditoria,
  limites: { movimentos: config.limiteMovimentos, bebidas: config.limiteBebidasMov },
});
modulosRelatorios.registrarRotas(app, { loadData });

const server = http.createServer(app);
const io = new Server(server);
io.use(auth.socketMiddleware); // o tempo real também só vale para quem está logado
// Liga o repasse de chat (as rotas foram registradas antes do Socket.IO existir)
const tempoReal = apiNovas.registrarSocket(io, { auth });
repassarChat = tempoReal.avisar;

// Cada pessoa recebe o estado "do seu tamanho": ninguém recebe o valor de compra dos pneus,
// e só administradores recebem o valor total do estoque (ver estadoPublico em auth.js).
function broadcastState() {
  const data = loadData();
  for (const socket of io.sockets.sockets.values()) {
    const u = auth.usuarioNoData(data, auth.tokenDoSocket(socket));
    if (!u) continue; // sessão vencida ou usuário bloqueado: não recebe nada
    socket.emit('state', auth.estadoPublico(data, u));
  }
}

app.get('/api/state', (req, res) => {
  res.json(auth.estadoPublico(loadData(), req.usuario));
});

// Devolve o pneu sem o valor de compra (usado nas respostas da API)
const semCusto = ({ precoCusto, ...resto }) => resto;

// Normaliza texto para comparar marca/medida ignorando maiúsculas,
// acentos e espaços extras (ex: "175/65 R14" == "175/65R14").
function normalizarChave(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

// ---------- estoque por loja (regra unica usada por todas as rotas) ----------
const chaveLoja = (valor) => estoquesMod.chave(valor);

// Loja efetiva de uma ESCRITA: administrador escolhe (ou cai na loja principal);
// quem nao e administrador so mexe na propria loja — loja mandada pelo navegador e ignorada.
function lojaDaEscrita(req, pedida) {
  if (req.usuario && req.usuario.perfil === 'admin') {
    return estoquesMod.chave(pedida) || estoquesMod.LOJA_PRINCIPAL;
  }
  return estoquesMod.chave(req.usuario && req.usuario.loja);
}

// Loja efetiva de uma LEITURA: admin pode pedir uma loja (?loja=) ou ver todas (null).
function lojaDaLeitura(req) {
  if (req.usuario && req.usuario.perfil === 'admin') {
    const pedida = estoquesMod.chave(req.query && req.query.loja);
    return pedida || null;
  }
  return estoquesMod.chave(req.usuario && req.usuario.loja) || null;
}

function lojasConhecidas() {
  return require('./lojas').codigosDeLojas(loadData());
}

function exigirAdminNaRota(req, res) {
  if (req.usuario && req.usuario.perfil === 'admin') return true;
  res.status(403).json({ error: 'Só o administrador pode fazer isso.' });
  return false;
}

app.post('/api/pneus', async (req, res) => {
  const body = req.body || {};
  if (!body.marca || !body.medida) {
    return res.status(400).json({ error: 'Marca e medida são obrigatórias.' });
  }
  const status = body.status === 'remoldado' ? 'remoldado' : 'novo';
  const chaveMarca = normalizarChave(body.marca);
  const chaveMedida = normalizarChave(body.medida);
  const loja = lojaDaEscrita(req, body.loja);
  if (!loja) {
    return res.status(400).json({ error: 'Você não está ligado a nenhuma loja. Fale com o administrador.' });
  }

  // Se o usuário já confirmou que quer somar mesmo assim, não bloqueia de novo.
  if (!body.confirmarDuplicado) {
    const atual = loadData();
    const igual = atual.pneus.find((t) =>
      normalizarChave(t.marca) === chaveMarca &&
      normalizarChave(t.medida) === chaveMedida &&
      t.status === status
    );
    if (igual) {
      return res.status(409).json({
        error: 'duplicado',
        mensagem: `Já existe um pneu ${igual.status === 'remoldado' ? 'remoldado' : 'novo'} cadastrado com marca "${igual.marca}" e medida "${igual.medida}" (${igual.quantidade} un. em estoque).`,
        existente: semCusto(igual),
      });
    }
  }

  const tire = {
    id: crypto.randomUUID(),
    marca: String(body.marca).trim(),
    medida: String(body.medida).trim(),
    status,
    localizacao: '',
    quantidade: 0,
    estoqueMinimo: 0,
    precoCusto: Number(body.precoCusto) || 0,
    precoVenda: Number(body.precoVenda) || 0,
    loja,
    estoques: {},
    criadoEm: Date.now(),
    atualizadoEm: Date.now(),
  };
  // quantidade/minimo/localizacao entram na LOJA escolhida (as outras nascem zeradas)
  estoquesMod.definirQuantidade(tire, loja, Number(body.quantidade) || 0);
  estoquesMod.definirMinimo(tire, loja, Number(body.estoqueMinimo) || 0);
  estoquesMod.definirLocalizacao(tire, loja, body.localizacao || '');

  await withData((data) => {
    data.pneus.push(tire);
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'criar',
      entidade: 'pneu',
      entidadeId: tire.id,
      loja,
      resumo: `Cadastrou o pneu ${tire.marca} ${tire.medida} (${tire.status}) na loja ${loja}, ${estoquesMod.qtdNaLoja(tire, loja)} un.`,
    });
  });
  broadcastState();
  res.json(semCusto(tire));
});

// Soma quantidade a um pneu já existente (usado quando o usuário confirma
// que o pneu cadastrado é o mesmo de um já existente, em vez de duplicar).
app.post('/api/pneus/:id/somar', async (req, res) => {
  const qtd = Number((req.body || {}).quantidade);
  if (!qtd || qtd <= 0) return res.status(400).json({ error: 'Quantidade inválida.' });
  const lojaPedida = (req.body || {}).loja;
  let updated = null;
  await withData((data) => {
    const t = data.pneus.find((x) => x.id === req.params.id);
    if (!t) return;
    const loja = lojaDaEscrita(req, lojaPedida);
    const mov = estoquesMod.movimentar(t, loja, 'entrada', qtd);
    if (!mov.ok) return;
    t.atualizadoEm = Date.now();
    updated = t;
    data.movimentos.unshift({
      id: crypto.randomUUID(),
      pneuId: t.id,
      pneuDescricao: [t.marca, t.medida].filter(Boolean).join(' · '),
      tipo: 'entrada',
      quantidade: qtd,
      loja,
      motivo: 'Novo lote cadastrado (mesmo pneu já existente)',
      usuario: req.usuario.nome,
      criadoEm: Date.now(),
    });
    if (data.movimentos.length > LIMITE_MOVIMENTOS) data.movimentos = data.movimentos.slice(0, LIMITE_MOVIMENTOS);
  });
  broadcastState();
  if (!updated) return res.status(404).json({ error: 'Pneu não encontrado (ou loja inválida).' });
  res.json(semCusto(updated));
});

app.put('/api/pneus/:id', async (req, res) => {
  const body = req.body || {};
  let updated = null;
  // Como o valor de compra não é mostrado na tela de edição, campo vazio = "manter o valor atual"
  const custoInformado = body.precoCusto !== undefined && body.precoCusto !== null && body.precoCusto !== '';
  const brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
  await withData((data) => {
    const idx = data.pneus.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return;
    const t = data.pneus[idx];
    const loja = lojaDaEscrita(req, body.loja || t.loja);
    const antesQtd = estoquesMod.qtdNaLoja(t, loja);
    const antesMinimo = estoquesMod.minimoNaLoja(t, loja);
    const antesLocal = estoquesMod.localNaLoja(t, loja);
    const novo = {
      ...t,
      marca: body.marca !== undefined ? String(body.marca).trim() : t.marca,
      medida: body.medida !== undefined ? String(body.medida).trim() : t.medida,
      status: body.status !== undefined ? (body.status === 'remoldado' ? 'remoldado' : 'novo') : t.status,
      precoCusto: custoInformado ? Number(body.precoCusto) || 0 : t.precoCusto,
      precoVenda: body.precoVenda !== undefined ? Number(body.precoVenda) || 0 : t.precoVenda,
      atualizadoEm: Date.now(),
    };

    // quantidade / minimo / localizacao valem SEMPRE para uma loja (a do usuario, ou a escolhida)
    if (body.quantidade !== undefined) estoquesMod.definirQuantidade(novo, loja, Number(body.quantidade) || 0);
    if (body.estoqueMinimo !== undefined) estoquesMod.definirMinimo(novo, loja, Number(body.estoqueMinimo) || 0);
    if (body.localizacao !== undefined) estoquesMod.definirLocalizacao(novo, loja, body.localizacao);
    estoquesMod.sincronizar(novo);

    const depoisQtd = estoquesMod.qtdNaLoja(novo, loja);
    const depoisMinimo = estoquesMod.minimoNaLoja(novo, loja);
    const depoisLocal = estoquesMod.localNaLoja(novo, loja);

    // Monta um resumo legível do que mudou, com destaque para preço
    const mudancas = [];
    if (novo.precoCusto !== t.precoCusto) mudancas.push(`preço de custo: ${brl(t.precoCusto)} → ${brl(novo.precoCusto)}`);
    if (novo.precoVenda !== t.precoVenda) mudancas.push(`preço de venda: ${brl(t.precoVenda)} → ${brl(novo.precoVenda)}`);
    if (depoisQtd !== antesQtd) mudancas.push(`quantidade (${loja}): ${antesQtd} → ${depoisQtd}`);
    if (depoisLocal !== antesLocal) mudancas.push(`localização (${loja}): "${antesLocal || '—'}" → "${depoisLocal || '—'}"`);
    if (novo.marca !== t.marca || novo.medida !== t.medida) mudancas.push(`identificação: "${t.marca} ${t.medida}" → "${novo.marca} ${novo.medida}"`);
    if (novo.status !== t.status) mudancas.push(`status: ${t.status} → ${novo.status}`);
    if (depoisMinimo !== antesMinimo) mudancas.push(`estoque mínimo (${loja}): ${antesMinimo} → ${depoisMinimo}`);

    data.pneus[idx] = novo;
    updated = novo;

    if (mudancas.length) {
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        acao: 'editar',
        entidade: 'pneu',
        entidadeId: novo.id,
        loja,
        resumo: `Editou o pneu ${novo.marca} ${novo.medida} — ${mudancas.join('; ')}.`,
      });
    }
  });
  broadcastState();
  if (!updated) return res.status(404).json({ error: 'Pneu não encontrado.' });
  res.json(semCusto(updated));
});

// Mostra o valor de compra de UM pneu. O administrador vê direto (já está logado);
// os demais usuários precisam confirmar a própria senha.
// Cada consulta fica registrada na Auditoria (quem viu o valor de qual pneu).
app.post('/api/pneus/:id/custo', async (req, res) => {
  if (req.usuario.perfil !== 'admin') {
    const chk = auth.verificarSenhaDoUsuario(req.usuario, (req.body || {}).senha);
    if (!chk.ok) return res.status(chk.status).json({ error: chk.erro });
  }
  const tire = loadData().pneus.find((t) => t.id === req.params.id);
  if (!tire) return res.status(404).json({ error: 'Pneu não encontrado.' });
  await withData((data) => {
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'consultar',
      entidade: 'pneu',
      entidadeId: tire.id,
      resumo: `Consultou o valor de compra do pneu ${tire.marca} ${tire.medida} (${tire.status}).`,
    });
  });
  res.json({ precoCusto: Number(tire.precoCusto) || 0 });
});

app.delete('/api/pneus/:id', async (req, res) => {
  let existed = false;
  await withData((data) => {
    const alvo = data.pneus.find((t) => t.id === req.params.id);
    const before = data.pneus.length;
    data.pneus = data.pneus.filter((t) => t.id !== req.params.id);
    existed = data.pneus.length < before;
    if (existed && alvo) {
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        acao: 'excluir',
        entidade: 'pneu',
        entidadeId: alvo.id,
        resumo: `Excluiu o pneu ${alvo.marca} ${alvo.medida} (${alvo.status}), tinha ${alvo.quantidade} un. em estoque.`,
      });
    }
  });
  broadcastState();
  res.json({ ok: existed });
});

app.post('/api/movimentos', async (req, res) => {
  const { pneuId, tipo, quantidade, motivo } = req.body || {};
  const lojaPedida = (req.body || {}).loja;
  let result = null;
  let error = null;

  await withData((data) => {
    const tire = data.pneus.find((t) => t.id === pneuId);
    if (!tire) { error = 'Pneu não encontrado.'; return; }

    const qtd = Number(quantidade);
    if (!qtd || qtd <= 0) { error = 'Quantidade inválida.'; return; }
    if (tipo !== 'entrada' && tipo !== 'saida') { error = 'Tipo de movimentação inválido.'; return; }

    // entra/sai SEMPRE da loja do usuario (admin escolhe a loja na tela)
    const loja = lojaDaEscrita(req, lojaPedida);
    if (!loja) { error = 'Você não está ligado a nenhuma loja.'; return; }
    const mov = estoquesMod.movimentar(tire, loja, tipo, qtd);
    if (!mov.ok) { error = mov.erro; return; }
    tire.atualizadoEm = Date.now();

    const registroMov = {
      id: crypto.randomUUID(),
      pneuId,
      pneuDescricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
      tipo,
      quantidade: qtd,
      loja,
      motivo: motivo ? String(motivo).trim() : '',
      usuario: req.usuario.nome,
      criadoEm: Date.now(),
    };
    data.movimentos.unshift(registroMov);
    if (data.movimentos.length > LIMITE_MOVIMENTOS) data.movimentos = data.movimentos.slice(0, LIMITE_MOVIMENTOS);
    result = registroMov;
  });

  broadcastState();
  if (error) return res.status(400).json({ error });
  res.json(result);
});

// ---------- transferência entre lojas ----------
// Sai de uma loja, entra na outra, no MESMO pneu. Quem recebe confirma (nome vai no registro).
app.post('/api/estoque/transferir', async (req, res) => {
  const body = req.body || {};
  const de = chaveLoja(body.de);
  const para = chaveLoja(body.para);
  const quantidade = Number(body.quantidade);
  const pneuId = String(body.pneuId || '');
  const confirmadoPor = String(body.confirmadoPor || '').trim();

  if (!pneuId) return res.status(400).json({ error: 'Escolha o pneu.' });
  if (!de || !para) return res.status(400).json({ error: 'Informe a loja de origem e a de destino.' });
  if (de === para) return res.status(400).json({ error: 'A loja de origem e a de destino são a mesma.' });
  if (!quantidade || quantidade <= 0) return res.status(400).json({ error: 'Quantidade inválida.' });
  if (!confirmadoPor) return res.status(400).json({ error: 'Escreva o nome de quem está recebendo (confirmação).' });
  if (!lojasConhecidas().includes(de) || !lojasConhecidas().includes(para)) {
    return res.status(400).json({ error: 'Loja inválida.' });
  }
  // Quem transfere precisa enxergar a loja de origem; quem só tem uma loja transfere só a dela.
  const podeDe = req.usuario.perfil === 'admin' || chaveLoja(req.usuario.loja) === de;
  if (!podeDe) return res.status(403).json({ error: 'Você só pode transferir do estoque da sua loja.' });

  let resultado = null;
  let erro = null;
  await withData((data) => {
    const tire = data.pneus.find((t) => t.id === pneuId);
    if (!tire) { erro = 'Pneu não encontrado.'; return; }
    const r = estoquesMod.transferir(tire, de, para, quantidade, { confirmadoPor });
    if (!r.ok) { erro = r.erro; return; }
    tire.atualizadoEm = Date.now();
    data.movimentos.unshift({
      id: crypto.randomUUID(),
      pneuId: tire.id,
      pneuDescricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
      tipo: 'saida',
      quantidade,
      loja: de,
      lojaDestino: para,
      motivo: `Transferência para ${para} (recebido por ${confirmadoPor})`,
      usuario: req.usuario.nome,
      criadoEm: Date.now(),
    });
    data.movimentos.unshift({
      id: crypto.randomUUID(),
      pneuId: tire.id,
      pneuDescricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
      tipo: 'entrada',
      quantidade,
      loja: para,
      lojaOrigem: de,
      motivo: `Transferência de ${de} (confirmado por ${confirmadoPor})`,
      usuario: req.usuario.nome,
      criadoEm: Date.now(),
    });
    if (data.movimentos.length > LIMITE_MOVIMENTOS) data.movimentos = data.movimentos.slice(0, LIMITE_MOVIMENTOS);
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'transferir',
      entidade: 'pneu',
      entidadeId: tire.id,
      loja: de,
      resumo: `Transferiu ${quantidade} un. de ${tire.marca} ${tire.medida} de ${de} para ${para} (recebido por ${confirmadoPor}).`,
    });
    resultado = { ok: true, pneu: tire, de, para, quantidade, saldo: estoquesMod.resumoPorLoja(tire, lojasConhecidas()) };
  });

  broadcastState();
  if (erro) return res.status(400).json({ error: erro });
  res.json(resultado);
});

// ---------- distribuir o estoque atual entre as lojas ----------
// O administrador manda a quantidade de cada loja para cada pneu (é a tela
// "Distribuir estoque atual entre as lojas"). O total do pneu não pode aumentar:
// é reorganização do que já existe — a soma enviada tem que ser igual ao total atual.
app.post('/api/estoque/distribuir', async (req, res) => {
  if (!exigirAdminNaRota(req, res)) return;
  const itens = Array.isArray((req.body || {}).itens) ? req.body.itens : [];
  if (!itens.length) return res.status(400).json({ error: 'Nada para distribuir.' });

  const erros = [];
  const alterados = [];
  await withData((data) => {
    for (const item of itens) {
      const tire = data.pneus.find((t) => t.id === item.pneuId);
      if (!tire) { erros.push({ pneuId: item.pneuId, erro: 'Pneu não encontrado.' }); continue; }
      const mapa = item.lojas && typeof item.lojas === 'object' ? item.lojas : {};
      const totalPedido = Object.values(mapa).reduce((s, v) => s + (Number(v) || 0), 0);
      const totalAtual = estoquesMod.totalDoPneu(tire);
      if (totalPedido !== totalAtual) {
        erros.push({
          pneuId: tire.id,
          descricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
          erro: `A soma por loja (${totalPedido}) tem que ser igual ao total atual (${totalAtual}).`,
        });
        continue;
      }
      const antes = estoquesMod.resumoPorLoja(tire, lojasConhecidas());
      for (const [loja, valor] of Object.entries(mapa)) {
        const codigo = estoquesMod.chave(loja);
        if (!codigo) continue;
        const r = estoquesMod.definirQuantidade(tire, codigo, Number(valor) || 0);
        if (!r.ok) erros.push({ pneuId: tire.id, loja: codigo, erro: r.erro });
      }
      tire.atualizadoEm = Date.now();
      alterados.push({ pneuId: tire.id, antes, depois: estoquesMod.resumoPorLoja(tire, lojasConhecidas()) });
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        acao: 'distribuir-estoque',
        entidade: 'pneu',
        entidadeId: tire.id,
        resumo: `Distribuiu o estoque de ${tire.marca} ${tire.medida} entre as lojas: `
          + antes.map((r) => `${r.loja}=${r.quantidade}`).join(', ')
          + ' → ' + estoquesMod.resumoPorLoja(tire, lojasConhecidas()).map((r) => `${r.loja}=${r.quantidade}`).join(', ') + '.',
      });
    }
  });

  broadcastState();
  res.json({ ok: erros.length === 0, alterados: alterados.length, erros });
});

// ---------- visão consolidada (admin): estoque de cada loja lado a lado ----------
app.get('/api/estoque/consolidado', (req, res) => {
  const data = loadData();
  const lojas = lojasConhecidas();
  if (req.usuario.perfil !== 'admin') {
    const minha = chaveLoja(req.usuario.loja);
    if (!minha) return res.status(403).json({ error: 'Você não está ligado a nenhuma loja.' });
    const linhas = data.pneus.map((p) => ({
      id: p.id,
      marca: p.marca,
      medida: p.medida,
      status: p.status,
      precoVenda: p.precoVenda,
      lojas: estoquesMod.resumoPorLoja(p, [minha]),
      total: estoquesMod.qtdNaLoja(p, minha),
    }));
    return res.json({ lojas: [minha], linhas });
  }
  const filtro = chaveLoja(req.query.loja);
  const colunas = filtro && lojas.includes(filtro) ? [filtro] : lojas;
  const linhas = data.pneus.map((p) => ({
    id: p.id,
    marca: p.marca,
    medida: p.medida,
    status: p.status,
    precoVenda: p.precoVenda,
    precoCusto: p.precoCusto,
    lojas: estoquesMod.resumoPorLoja(p, colunas),
    total: estoquesMod.totalDoPneu(p),
    abaixoDoMinimo: estoquesMod.lojasAbaixoDoMinimo(p, colunas).map((r) => r.loja),
  }));
  res.json({ lojas: colunas, linhas, todasAsLojas: lojas });
});

// ---------- Garantias ----------
// Fluxo: chegada -> envio para a fábrica -> análise (aprovado/reprovado) -> saída

// Aceita data/hora vinda do formulário (ex: "2025-03-14T09:30") ou timestamp.
// Se vier vazio, usa o momento atual.
function parseQuando(v) {
  if (v === undefined || v === null || v === '') return Date.now();
  if (typeof v === 'number' && isFinite(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function statusGarantia(g) {
  if (g.saidaEm) return 'finalizado';
  if (g.analiseEm) return g.resultado === 'aprovado' ? 'aprovado' : 'reprovado';
  if (g.envioEm) return 'na_fabrica';
  return 'recebido';
}

const txt = (v) => (v === undefined || v === null ? '' : String(v).trim());

app.post('/api/garantias', async (req, res) => {
  const b = req.body || {};
  if (!txt(b.cliente) || !txt(b.marca) || !txt(b.medida)) {
    return res.status(400).json({ error: 'Cliente, marca e medida são obrigatórios.' });
  }
  const quando = parseQuando(b.chegadaEm);
  const g = {
    id: crypto.randomUUID(),
    cliente: txt(b.cliente),
    telefone: txt(b.telefone),
    veiculo: txt(b.veiculo),
    marca: txt(b.marca),
    medida: txt(b.medida),
    quantidade: Number(b.quantidade) > 0 ? Number(b.quantidade) : 1,
    serie: txt(b.serie),          // nº de série / DOT do pneu
    notaFiscal: txt(b.notaFiscal),
    defeito: txt(b.defeito),      // reclamação do cliente
    // etapas
    chegadaEm: quando,
    envioEm: null,
    envioObs: '',
    analiseEm: null,
    resultado: null,              // 'aprovado' | 'reprovado'
    analiseObs: '',
    saidaEm: null,
    saidaObs: '',
    historico: [
      { etapa: 'chegada', em: quando, obs: txt(b.obsChegada), usuario: req.usuario.nome, registradoEm: Date.now() },
    ],
    criadoEm: Date.now(),
    atualizadoEm: Date.now(),
  };
  await withData((data) => {
    data.garantias.unshift(g);
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'criar',
      entidade: 'garantia',
      entidadeId: g.id,
      resumo: `Abriu garantia de ${g.cliente} (${g.marca} ${g.medida}).`,
    });
  });
  broadcastState();
  res.json(g);
});

app.put('/api/garantias/:id', async (req, res) => {
  const b = req.body || {};
  let updated = null;
  await withData((data) => {
    const g = data.garantias.find((x) => x.id === req.params.id);
    if (!g) return;
    const campos = ['cliente', 'telefone', 'veiculo', 'marca', 'medida', 'serie', 'notaFiscal', 'defeito'];
    campos.forEach((c) => { if (b[c] !== undefined) g[c] = txt(b[c]); });
    if (b.quantidade !== undefined) g.quantidade = Number(b.quantidade) > 0 ? Number(b.quantidade) : 1;
    if (b.chegadaEm !== undefined) {
      g.chegadaEm = parseQuando(b.chegadaEm);
      const h = (g.historico || []).find((x) => x.etapa === 'chegada');
      if (h) h.em = g.chegadaEm;
    }
    g.atualizadoEm = Date.now();
    updated = g;
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'editar',
      entidade: 'garantia',
      entidadeId: g.id,
      resumo: `Editou os dados cadastrais da garantia de ${g.cliente} (${g.marca} ${g.medida}).`,
    });
  });
  broadcastState();
  if (!updated) return res.status(404).json({ error: 'Garantia não encontrada.' });
  res.json(updated);
});

app.delete('/api/garantias/:id', async (req, res) => {
  let existed = false;
  await withData((data) => {
    const alvo = data.garantias.find((g) => g.id === req.params.id);
    const before = data.garantias.length;
    data.garantias = data.garantias.filter((g) => g.id !== req.params.id);
    existed = data.garantias.length < before;
    if (existed && alvo) {
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        acao: 'excluir',
        entidade: 'garantia',
        entidadeId: alvo.id,
        resumo: `Excluiu a garantia de ${alvo.cliente} (${alvo.marca} ${alvo.medida}).`,
      });
    }
  });
  broadcastState();
  res.json({ ok: existed });
});

// Registra uma etapa: 'envio' | 'analise' | 'saida'
app.post('/api/garantias/:id/etapa', async (req, res) => {
  const { etapa, quando, obs, resultado, pneuIdBaixa, qtdBaixa } = req.body || {};
  let result = null;
  let error = null;

  await withData((data) => {
    const g = data.garantias.find((x) => x.id === req.params.id);
    if (!g) { error = 'Garantia não encontrada.'; return; }

    const em = parseQuando(quando);
    const observacao = txt(obs);

    if (etapa === 'envio') {
      if (g.envioEm) { error = 'Esta garantia já foi enviada para a fábrica.'; return; }
      if (em < g.chegadaEm) { error = 'A data de envio não pode ser anterior à chegada.'; return; }
      g.envioEm = em;
      g.envioObs = observacao;
    } else if (etapa === 'analise') {
      if (!g.envioEm) { error = 'Registre primeiro o envio para a fábrica.'; return; }
      if (g.analiseEm) { error = 'O resultado da análise já foi lançado.'; return; }
      if (resultado !== 'aprovado' && resultado !== 'reprovado') { error = 'Informe se a fábrica aprovou ou reprovou.'; return; }
      if (em < g.envioEm) { error = 'A data da análise não pode ser anterior ao envio.'; return; }
      g.analiseEm = em;
      g.resultado = resultado;
      g.analiseObs = observacao;
    } else if (etapa === 'saida') {
      if (!g.analiseEm) { error = 'Lance primeiro o resultado da análise da fábrica.'; return; }
      if (g.saidaEm) { error = 'A saída desta garantia já foi registrada.'; return; }
      if (em < g.analiseEm) { error = 'A data de saída não pode ser anterior à análise.'; return; }
      g.saidaEm = em;
      g.saidaObs = observacao;

      // Opcional: dar baixa no estoque do pneu novo entregue ao cliente
      if (pneuIdBaixa) {
        const tire = data.pneus.find((t) => t.id === pneuIdBaixa);
        if (!tire) { error = 'Pneu de reposição não encontrado no estoque.'; return; }
        const qtd = Number(qtdBaixa) > 0 ? Number(qtdBaixa) : 1;
        const atual = Number(tire.quantidade) || 0;
        if (atual - qtd < 0) { error = 'Estoque insuficiente para a baixa do pneu de reposição.'; return; }
        tire.quantidade = atual - qtd;
        tire.atualizadoEm = Date.now();
        data.movimentos.unshift({
          id: crypto.randomUUID(),
          pneuId: tire.id,
          pneuDescricao: [tire.marca, tire.medida].filter(Boolean).join(' · '),
          tipo: 'saida',
          quantidade: qtd,
          motivo: `Troca em garantia — ${g.cliente}`,
          usuario: req.usuario.nome,
          criadoEm: em,
        });
        if (data.movimentos.length > LIMITE_MOVIMENTOS) data.movimentos = data.movimentos.slice(0, LIMITE_MOVIMENTOS);
      }
    } else {
      error = 'Etapa inválida.';
      return;
    }

    g.historico = g.historico || [];
    g.historico.push({ etapa, em, obs: observacao, resultado: etapa === 'analise' ? resultado : undefined, usuario: req.usuario.nome, registradoEm: Date.now() });
    g.atualizadoEm = Date.now();
    result = g;

    const nomeEtapa = { envio: 'ida para a fábrica', analise: `análise (${resultado})`, saida: 'saída do pneu' }[etapa] || etapa;
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'editar',
      entidade: 'garantia',
      entidadeId: g.id,
      resumo: `Lançou a etapa "${nomeEtapa}" na garantia de ${g.cliente} (${g.marca} ${g.medida}).`,
    });
  });

  broadcastState();
  if (error) return res.status(400).json({ error });
  res.json(result);
});

// Desfaz a última etapa registrada (para corrigir lançamento errado)
app.delete('/api/garantias/:id/etapa', async (req, res) => {
  let result = null;
  let error = null;
  await withData((data) => {
    const g = data.garantias.find((x) => x.id === req.params.id);
    if (!g) { error = 'Garantia não encontrada.'; return; }
    const st = statusGarantia(g);
    if (st === 'finalizado') { g.saidaEm = null; g.saidaObs = ''; }
    else if (st === 'aprovado' || st === 'reprovado') { g.analiseEm = null; g.resultado = null; g.analiseObs = ''; }
    else if (st === 'na_fabrica') { g.envioEm = null; g.envioObs = ''; }
    else { error = 'Não há etapa para desfazer (só resta a chegada).'; return; }
    g.historico = (g.historico || []).slice(0, -1);
    g.atualizadoEm = Date.now();
    result = g;
  });
  broadcastState();
  if (error) return res.status(400).json({ error });
  res.json(result);
});

// ---------- Bebidas ----------
// Controle bem simples: qual é a bebida, quanto tem em estoque e para onde saiu.
// Tudo que mexe no estoque de bebidas também é registrado no log de auditoria.
const MAX_MOV_BEBIDAS = config.limiteBebidasMov;

// Inteiro maior que zero (para entradas/saídas). Devolve null se for inválido.
function inteiroPositivo(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Inteiro maior ou igual a zero (para o estoque). Vazio conta como 0. Devolve null se for inválido.
function inteiroNaoNegativo(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

app.post('/api/bebidas', async (req, res) => {
  const body = req.body || {};
  const nome = txt(body.nome);
  if (!nome) return res.status(400).json({ error: 'Informe o nome da bebida.' });
  const qtd = inteiroNaoNegativo(body.quantidade);
  if (qtd === null) return res.status(400).json({ error: 'Quantidade inválida (use um número inteiro, 0 ou mais).' });

  let bebida = null;
  let error = null;
  await withData((data) => {
    const chave = normalizarChave(nome);
    if (data.bebidas.some((b) => normalizarChave(b.nome) === chave)) {
      error = `Já existe uma bebida cadastrada como "${nome}".`;
      return;
    }
    bebida = {
      id: crypto.randomUUID(),
      nome,
      quantidade: qtd,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
    };
    data.bebidas.push(bebida);
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'criar',
      entidade: 'bebida',
      entidadeId: bebida.id,
      resumo: `Cadastrou a bebida ${bebida.nome}, estoque inicial de ${bebida.quantidade} un.`,
    });
  });
  broadcastState();
  if (error) return res.status(400).json({ error });
  res.json(bebida);
});

// Editar nome e/ou corrigir o estoque manualmente (ajuste de inventário)
app.put('/api/bebidas/:id', async (req, res) => {
  const body = req.body || {};
  let updated = null;
  let error = null;
  let naoEncontrada = false;
  await withData((data) => {
    const b = data.bebidas.find((x) => x.id === req.params.id);
    if (!b) { naoEncontrada = true; return; }

    const nome = body.nome !== undefined ? txt(body.nome) : b.nome;
    if (!nome) { error = 'Informe o nome da bebida.'; return; }

    let qtd = b.quantidade;
    if (body.quantidade !== undefined) {
      qtd = inteiroNaoNegativo(body.quantidade);
      if (qtd === null) { error = 'Quantidade inválida (use um número inteiro, 0 ou mais).'; return; }
    }

    const chave = normalizarChave(nome);
    if (data.bebidas.some((x) => x.id !== b.id && normalizarChave(x.nome) === chave)) {
      error = `Já existe outra bebida cadastrada como "${nome}".`;
      return;
    }

    const mudancas = [];
    if (nome !== b.nome) mudancas.push(`nome: "${b.nome}" → "${nome}"`);
    if (qtd !== b.quantidade) mudancas.push(`estoque: ${b.quantidade} → ${qtd}`);

    // Se renomeou, o histórico de movimentações passa a mostrar o nome novo
    if (nome !== b.nome) {
      data.bebidasMov.forEach((m) => { if (m.bebidaId === b.id) m.bebidaNome = nome; });
    }

    const nomeAntigo = b.nome;
    b.nome = nome;
    b.quantidade = qtd;
    b.atualizadoEm = Date.now();
    updated = b;

    if (mudancas.length) {
      auditoria.registrar(data, {
        usuario: req.usuario.nome,
        acao: 'editar',
        entidade: 'bebida',
        entidadeId: b.id,
        resumo: `Editou a bebida ${nomeAntigo} — ${mudancas.join('; ')}.`,
      });
    }
  });
  broadcastState();
  if (naoEncontrada) return res.status(404).json({ error: 'Bebida não encontrada.' });
  if (error) return res.status(400).json({ error });
  res.json(updated);
});

app.delete('/api/bebidas/:id', async (req, res) => {
  let existed = false;
  await withData((data) => {
    const alvo = data.bebidas.find((b) => b.id === req.params.id);
    if (!alvo) return;
    data.bebidas = data.bebidas.filter((b) => b.id !== req.params.id);
    existed = true;
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'excluir',
      entidade: 'bebida',
      entidadeId: alvo.id,
      resumo: `Excluiu a bebida ${alvo.nome}, tinha ${alvo.quantidade} un. em estoque.`,
    });
  });
  broadcastState();
  res.json({ ok: existed });
});

// Entrada (reposição) ou saída (com destino) de bebida
app.post('/api/bebidas/movimentos', async (req, res) => {
  const { bebidaId, tipo, quantidade, destino } = req.body || {};
  let result = null;
  let error = null;

  await withData((data) => {
    const b = data.bebidas.find((x) => x.id === bebidaId);
    if (!b) { error = 'Bebida não encontrada.'; return; }

    if (tipo !== 'entrada' && tipo !== 'saida') { error = 'Tipo de movimentação inválido.'; return; }

    const qtd = inteiroPositivo(quantidade);
    if (!qtd) { error = 'Informe uma quantidade inteira maior que zero.'; return; }

    const destinoTxt = txt(destino);
    if (tipo === 'saida' && !destinoTxt) { error = 'Informe para onde a bebida saiu.'; return; }

    const antes = Number(b.quantidade) || 0;
    const depois = tipo === 'entrada' ? antes + qtd : antes - qtd;
    if (depois < 0) { error = `Estoque insuficiente: só há ${antes} un. de ${b.nome}.`; return; }

    b.quantidade = depois;
    b.atualizadoEm = Date.now();

    const mov = {
      id: crypto.randomUUID(),
      bebidaId: b.id,
      bebidaNome: b.nome,
      tipo,
      quantidade: qtd,
      destino: destinoTxt,      // na saída: para onde foi. Na entrada: observação (ex: fornecedor)
      estoqueApos: depois,
      usuario: req.usuario.nome,
      criadoEm: Date.now(),
    };
    data.bebidasMov.unshift(mov);
    if (data.bebidasMov.length > MAX_MOV_BEBIDAS) data.bebidasMov = data.bebidasMov.slice(0, MAX_MOV_BEBIDAS);
    result = mov;

    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: tipo, // 'entrada' | 'saida'
      entidade: 'bebida',
      entidadeId: b.id,
      resumo: tipo === 'saida'
        ? `Saída de ${qtd} un. de ${b.nome} para "${destinoTxt}" (estoque: ${antes} → ${depois}).`
        : `Entrada de ${qtd} un. de ${b.nome}${destinoTxt ? ` (${destinoTxt})` : ''} (estoque: ${antes} → ${depois}).`,
    });
  });

  broadcastState();
  if (error) return res.status(400).json({ error });
  res.json(result);
});

io.on('connection', (socket) => {
  const data = loadData();
  const u = auth.usuarioNoData(data, auth.tokenDoSocket(socket));
  if (u) socket.emit('state', auth.estadoPublico(data, u));
});

function getLocalIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ---------- Backup automático do data.json ----------
// A lógica de backup agora vive em armazenamento.js (cópia + rotação + validação).
// Consultar/baixar/forçar backups — só o administrador
app.get('/api/backups', auth.exigirAdmin, (req, res) => {
  res.json(armazenamento.listarBackups());
});

app.post('/api/backups', auth.exigirAdmin, async (req, res) => {
  const arquivo = armazenamento.fazerBackup();
  if (!arquivo) return res.status(500).json({ error: 'Não foi possível criar o backup agora.' });
  await withData((data) => {
    auditoria.registrar(data, {
      usuario: req.usuario.nome,
      acao: 'criar',
      entidade: 'backup',
      entidadeId: null,
      resumo: `Fez um backup manual (${arquivo}).`,
    });
  });
  res.json({ arquivo });
});

app.get('/api/backups/:arquivo', auth.exigirAdmin, (req, res) => {
  const completo = armazenamento.caminhoBackup(req.params.arquivo); // impede acessar fora da pasta de backups
  if (!completo) {
    return res.status(404).json({ error: 'Backup não encontrado.' });
  }
  res.download(completo, path.basename(completo));
});

// ---------- Contador de erros (aparece em /api/diagnostico) ----------
// Serve para ver, sem abrir log, se o sistema andou errando e o quê.
const contadorErros = (() => {
  const porTipo = new Map();
  let total = 0;
  let ultimo = null;
  return {
    registrar(erro) {
      total += 1;
      const chave = (erro && (erro.codigo || erro.name)) || 'Erro';
      porTipo.set(chave, (porTipo.get(chave) || 0) + 1);
      ultimo = {
        quando: Date.now(),
        tipo: String(chave),
        mensagem: String((erro && erro.message) || erro || 'sem mensagem').slice(0, 300),
      };
    },
    resumo: () => ({ total, tipos: Object.fromEntries(porTipo), ultimo }),
  };
})();

// ---------- Saúde e diagnóstico ----------
// /health é público e mínimo de propósito: serve para monitorar sem revelar nada interno
// (sem caminho de arquivo, sem contadores, sem versão de dependência).
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    versao: VERSION,
    uptimeSegundos: Math.round((Date.now() - INICIADO_EM) / 1000),
  });
});

// Diagnóstico completo: só o administrador.
app.get('/api/diagnostico', auth.exigirAdmin, (req, res) => {
  const emModoSeguro = armazenamento.emModoSeguro();
  res.json({
    ok: !emModoSeguro,
    versao: VERSION,
    node: process.version,
    ambiente: config.ambiente,
    uptimeSegundos: Math.round((Date.now() - INICIADO_EM) / 1000),
    porta: config.porta,
    host: config.host,
    erros: contadorErros.resumo(),
    dados: armazenamento.estado(),
    limites: {
      movimentos: config.limiteMovimentos,
      auditoria: config.limiteAuditoria,
      backups: config.maxBackupArquivos,
      intervaloBackupMinutos: Math.round(config.intervaloBackupMs / 60000),
    },
    avisos: emModoSeguro ? [armazenamento.motivoModoSeguro()] : [],
  });
});

// Rota de /api que não existe responde em JSON (e não a página de erro em HTML do Express)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Tratamento central de erros: o sistema continua de pé, o detalhe vai só para o log,
// e o cliente recebe uma mensagem curta com um código para achar o erro no log.
app.use((erro, req, res, next) => {
  const id = crypto.randomUUID().slice(0, 8);
  contadorErros.registrar(erro);
  const status = Number(erro && erro.status) || 500;
  // Erros criados pelo proprio sistema (modo seguro, dado ilegivel, gravacao) tem
  // mensagem util e sem detalhe interno: podem ir para a tela.
  const mensagemSegura = ['MODO_SEGURO', 'DADOS_ILEGIVEIS', 'FALHA_GRAVACAO', 'CONFIG'].includes(erro && erro.codigo);
  if (status >= 500) {
    registro.erro(`erro ${id} em ${req.method} ${req.originalUrl}`, erro instanceof Error ? erro : new Error(String(erro)));
  } else {
    registro.aviso(`pedido recusado (${status}) em ${req.method} ${req.originalUrl}: ${(erro && erro.message) || 'sem mensagem'}`);
  }
  if (res.headersSent) return next(erro);
  const corpo = {
    error: status >= 500 && !mensagemSegura
      ? 'O sistema teve um problema interno. O erro ficou registrado no log.'
      : String((erro && erro.message) || 'Pedido recusado.'),
    id,
  };
  if (erro && erro.dica) corpo.dica = erro.dica;
  return res.status(status).json(corpo);
});

// ---------- Subida do sistema ----------
// Se o arquivo de dados não puder ser lido, o sistema NÃO sobe: parar e avisar é
// melhor do que rodar com dado vazio e sobrescrever o arquivo real da loja.
try {
  armazenamento.inicializar();
} catch (e) {
  registro.erro('não consegui ler o arquivo de dados; o sistema NÃO vai subir para não sobrescrever nada', e);
  console.error('');
  console.error('  *** O SISTEMA NAO SUBIU ***');
  for (const linha of String(e.message).split('\n')) console.error(`  ${linha}`);
  console.error('');
  process.exit(1);
}

// Erro solto não pode mais derrubar a loja: fica registrado e o sistema segue de pé.
process.on('unhandledRejection', (motivo) => {
  contadorErros.registrar(motivo);
  registro.erro('promessa rejeitada sem tratamento (o sistema continua de pé)', motivo instanceof Error ? motivo : new Error(String(motivo)));
});
process.on('uncaughtException', (erro) => {
  contadorErros.registrar(erro);
  registro.erro('exceção não tratada (o sistema continua de pé)', erro);
});

const pararBackupsAutomaticos = armazenamento.iniciarBackupsAutomaticos();

const servidor = server.listen(PORT, config.host, async () => {
  const admin = await auth.garantirAdminPadrao();
  if (admin) {
    registro.aviso('usuário admin padrão criado (senha padrão do código) — troque a senha no primeiro acesso');
  }
  console.log('');
  console.log('========================================');
  console.log(`  UNICAR - Estoque de Pneus (rede local) v${VERSION}`);
  console.log('========================================');
  if (admin) {
    console.log('  PRIMEIRO ACESSO — usuário criado automaticamente:');
    console.log('     usuário: admin');
    console.log('     senha:   unicar123');
    console.log('  Entre com ele e troque a senha na hora.');
    console.log('----------------------------------------');
  }
  console.log(`  Neste computador: http://localhost:${PORT}`);
  const ips = getLocalIps();
  if (ips.length && (config.host === '0.0.0.0' || config.host === '::')) {
    console.log('  De outros aparelhos na mesma rede Wi-Fi/LAN, acesse:');
    ips.forEach((ip) => console.log(`    -> http://${ip}:${PORT}`));
  } else if (ips.length) {
    console.log(`  Escutando somente em ${config.host} (configurável por HOST no .env).`);
  } else {
    console.log('  Não foi possível detectar o IP da rede automaticamente.');
    console.log('  Rode "ipconfig" (Windows) ou "ifconfig"/"ip a" (Mac/Linux) para achar o IP deste PC.');
  }
  console.log('  Deixe esta janela aberta enquanto o sistema estiver em uso.');
  console.log('========================================');
  console.log('');
  registro.info(`servidor escutando em ${config.host}:${config.porta}`);
});

// Parada limpa: espera as gravações pendentes antes de sair (Ctrl+C na janela do CMD).
let encerrando = false;
function encerrar(motivo) {
  if (encerrando) return;
  encerrando = true;
  registro.info(`recebi ${motivo}: encerrando com calma (aguardando gravações pendentes)`);
  try { pararBackupsAutomaticos(); } catch (e) { /* segue */ }
  servidor.close(() => {
    registro.info('servidor encerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => encerrar('Ctrl+C'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
