// UNICAR - Paineis e relatorios das lojas
//
// O painel e por loja. Quem nao e administrador ve SOMENTE a propria loja — e o filtro
// acontece aqui, no servidor, sobre a lista de OS que a pessoa ja pode enxergar.

const { STATUS_OS, STATUS_ROTULO, veTodasAsLojas, pode } = require('./permissoes');
const { normalizarCodigo, garantirLojas, acharLoja } = require('./lojas');
const { garantirFormatoOS, filtrarOS, numeroDe } = require('./os');

const STATUS_ABERTOS = STATUS_OS.filter((s) => s !== 'entregue' && s !== 'cancelada');
const STATUS_FATURADOS = ['finalizada', 'entregue'];

function dia(ms) {
  if (!ms) return null;
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Converte 'AAAA-MM-DD' em milissegundos (inicio do dia) / fim do dia
function inicioDoDia(valor) {
  if (!valor) return null;
  const t = String(valor).trim();
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(t);
  const ms = Date.parse(soData ? `${t}T00:00:00` : t);
  return Number.isFinite(ms) ? ms : null;
}

function fimDoDia(valor) {
  const inicio = inicioDoDia(valor);
  return inicio === null ? null : inicio + 24 * 60 * 60 * 1000 - 1;
}

function resumoDoPainel(listaOS) {
  const porStatus = {};
  for (const s of STATUS_OS) porStatus[s] = 0;
  let faturamento = 0;
  let emAndamentoValor = 0;
  const servicos = new Map();
  const pecas = new Map();
  const clientes = new Map();
  const pendentes = [];

  for (const os of listaOS) {
    porStatus[os.status] = (porStatus[os.status] || 0) + 1;
    const total = numeroDe(os.total);
    if (STATUS_FATURADOS.includes(os.status)) faturamento += total;
    else if (os.status !== 'cancelada') emAndamentoValor += total;

    for (const item of os.itens || []) {
      const mapa = item.tipo === 'mao de obra' ? servicos : pecas;
      const chave = String(item.descricao || '').trim().toLowerCase();
      if (!chave) continue;
      const atual = mapa.get(chave) || { descricao: item.descricao, quantidade: 0, valor: 0 };
      atual.quantidade += numeroDe(item.quantidade);
      atual.valor += numeroDe(item.total);
      mapa.set(chave, atual);
    }

    const nomeCliente = String((os.cliente && os.cliente.nome) || '').trim();
    if (nomeCliente) {
      const chave = nomeCliente.toLowerCase();
      const atual = clientes.get(chave);
      if (!atual || Number(os.aberturaEm || 0) > Number(atual.ultimaEm || 0)) {
        clientes.set(chave, {
          nome: nomeCliente,
          telefone: (os.cliente && (os.cliente.whatsapp || os.cliente.telefone)) || '',
          veiculo: [os.veiculo && os.veiculo.marca, os.veiculo && os.veiculo.modelo].filter(Boolean).join(' '),
          placa: (os.veiculo && os.veiculo.placa) || '',
          ultimaEm: os.aberturaEm,
          ultimaOS: os.numero,
          loja: os.loja,
          quantas: (atual ? atual.quantas : 0) + 1,
        });
      } else {
        atual.quantas += 1;
      }
    }

    if (STATUS_ABERTOS.includes(os.status)) {
      pendentes.push({
        numero: os.numero,
        loja: os.loja,
        status: os.status,
        statusRotulo: STATUS_ROTULO[os.status] || os.status,
        cliente: nomeCliente,
        telefone: (os.cliente && (os.cliente.whatsapp || os.cliente.telefone)) || '',
        placa: (os.veiculo && os.veiculo.placa) || '',
        aberturaEm: os.aberturaEm,
        diasAberto: Math.floor((Date.now() - Number(os.aberturaEm || Date.now())) / (24 * 60 * 60 * 1000)),
        total,
      });
    }
  }

  const ordenar = (mapa) => [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
  return {
    total: listaOS.length,
    porStatus,
    porStatusRotulo: Object.fromEntries(Object.entries(porStatus).map(([k, v]) => [STATUS_ROTULO[k] || k, v])),
    faturamento: Math.round(faturamento * 100) / 100,
    emAndamentoValor: Math.round(emAndamentoValor * 100) / 100,
    servicosMaisRealizados: ordenar(servicos).slice(0, 10),
    itensMaisUsados: ordenar(pecas).slice(0, 10),
    clientesRecentes: [...clientes.values()]
      .sort((a, b) => numeroDe(b.ultimaEm) - numeroDe(a.ultimaEm))
      .slice(0, 10),
    pendentes: pendentes.sort((a, b) => numeroDe(a.aberturaEm) - numeroDe(b.aberturaEm)).slice(0, 30),
  };
}

function registrarRotas(app, { loadData }) {
  // Painel: por loja (ou consolidado, para o administrador)
  app.get('/api/painel', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    if (!pode(req.usuario.perfil, 'verPainelDaLoja') && !veTodasAsLojas(req.usuario)) {
      return res.status(403).json({ error: 'Seu perfil não tem acesso ao painel.' });
    }

    const de = inicioDoDia(req.query.de);
    const ate = fimDoDia(req.query.ate);
    const filtros = { de, ate, status: req.query.status };

    const base = filtrarOS(data, req.usuario, filtros);

    // Qual loja mostrar
    let alvo = null;
    if (veTodasAsLojas(req.usuario)) {
      const pedida = normalizarCodigo(req.query.loja);
      alvo = pedida && pedida !== 'TODAS' ? pedida : null;
    } else {
      alvo = req.usuario.loja || null;
      if (!alvo) return res.status(403).json({ error: 'Seu usuário não está ligado a nenhuma loja.' });
    }

    const lista = alvo ? base.filter((os) => os.loja === alvo) : base;
    const painel = resumoDoPainel(lista);

    const porLoja = veTodasAsLojas(req.usuario)
      ? garantirLojas(data).map((loja) => ({
        loja: loja.codigo,
        nome: loja.nome,
        ...resumoDoPainel(base.filter((os) => os.loja === loja.codigo)),
      }))
      : undefined;

    res.json({
      loja: alvo,
      nomeLoja: alvo ? (acharLoja(data, alvo) || {}).nome || alvo : 'Todas as lojas',
      periodo: { de: req.query.de || null, ate: req.query.ate || null },
      ...painel,
      porLoja,
      lojas: veTodasAsLojas(req.usuario) ? garantirLojas(data) : garantirLojas(data).filter((l) => l.codigo === alvo),
    });
  });

  // Relatorio consolidado (so administrador)
  app.get('/api/painel/consolidado', (req, res) => {
    if (!pode(req.usuario.perfil, 'verRelatorioGeral')) {
      return res.status(403).json({ error: 'Somente o administrador vê o relatório consolidado.' });
    }
    const data = loadData();
    garantirFormatoOS(data);
    const de = inicioDoDia(req.query.de);
    const ate = fimDoDia(req.query.ate);
    const todas = filtrarOS(data, req.usuario, { de, ate });
    const lojas = garantirLojas(data).map((loja) => {
      const doResumo = resumoDoPainel(todas.filter((os) => os.loja === loja.codigo));
      return {
        loja: loja.codigo,
        nome: loja.nome,
        ativa: loja.ativa !== false,
        total: doResumo.total,
        porStatus: doResumo.porStatus,
        faturamento: doResumo.faturamento,
        pendentes: doResumo.pendentes.length,
      };
    });
    const geral = resumoDoPainel(todas);
    res.json({
      periodo: { de: req.query.de || null, ate: req.query.ate || null },
      dia: dia(Date.now()),
      lojas,
      geral: {
        total: geral.total,
        porStatus: geral.porStatus,
        faturamento: geral.faturamento,
        pendentes: geral.pendentes.length,
        servicosMaisRealizados: geral.servicosMaisRealizados,
      },
    });
  });
}

module.exports = { registrarRotas, resumoDoPainel, inicioDoDia, fimDoDia };
