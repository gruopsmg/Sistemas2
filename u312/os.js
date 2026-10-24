// UNICAR - Ordens de Servico (OS)
//
// Cada OS pertence a UMA loja e so aparece para quem tem acesso aquela loja
// (administrador ve todas). A checagem e feita AQUI, no servidor: esconder na tela nao basta.

const crypto = require('crypto');
const estoqueOS = require('./estoque-os');
const estoques = require('./estoques');
const grupoMod = require('./grupo');
const {
  pode,
  veTodasAsLojas,
  lojaDoUsuario,
  podeAcessarLoja,
  normalizarStatus,
  STATUS_OS,
  STATUS_ROTULO,
} = require('./permissoes');
const { normalizarCodigo, acharLoja, garantirLojas } = require('./lojas');
const clientesMod = require('./clientes');
const { marcaDaLoja } = require('./marcas');

const TIPOS_ITEM = ['pneu', 'peca', 'produto', 'mao de obra'];
const TIPO_ROTULO = {
  'pneu': 'Pneu',
  'peca': 'Peça',
  'produto': 'Produto',
  'mao de obra': 'Mão de obra',
};

// Status em que os valores da OS ainda podem ser mexidos por operador
const STATUS_ANTES_DA_APROVACAO = ['aberta', 'em analise', 'aguardando aprovacao'];
// Depois da entrega (ou do cancelamento), so o administrador mexe
const STATUS_TRAVADOS = ['entregue', 'cancelada'];

function numeroDe(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function dinheiro(valor) {
  return Math.round(numeroDe(valor) * 100) / 100;
}

function texto(valor, limite = 500) {
  const t = String(valor === undefined || valor === null ? '' : valor).trim();
  return limite ? t.slice(0, limite) : t;
}

function garantirFormatoOS(data) {
  if (!Array.isArray(data.os)) data.os = [];
  if (!data.osSequencia || typeof data.osSequencia !== 'object' || Array.isArray(data.osSequencia)) {
    data.osSequencia = {};
  }
  garantirLojas(data);
  return data;
}

// ---------- numeracao ----------
// O numero continua unico por loja e a sequencia NAO recomeca (OS ja emitidas seguem validas).
// Padrao = como sempre foi: OS-UNICAR-000001. Se o administrador preencher um prefixo em
// Configuracoes, o numero novo ganha esse bloco: OS-SMG-UNICAR-000001 (opcional).
// Quem le o numero antigo continua funcionando: a busca aceita o numero exato.
const PREFIXO_NUMERO = 'OS';

function formatarNumero(codigoLoja, sequencia, prefixo) {
  const loja = normalizarCodigo(codigoLoja);
  const grupo = String(prefixo || '').trim().toUpperCase();
  if (grupo && grupo !== PREFIXO_NUMERO) {
    return `${PREFIXO_NUMERO}-${grupo}-${loja}-${String(sequencia).padStart(6, '0')}`;
  }
  return `${PREFIXO_NUMERO}-${loja}-${String(sequencia).padStart(6, '0')}`;
}

function proximoNumero(data, codigoLoja) {
  const loja = normalizarCodigo(codigoLoja);
  const prefixo = grupoMod.garantirGrupo(data).prefixoOS;
  data.osSequencia[loja] = numeroDe(data.osSequencia[loja]);
  // Protecao extra: se por algum motivo o numero ja existir, pula ate achar um livre
  for (let tentativa = 0; tentativa < 10000; tentativa += 1) {
    data.osSequencia[loja] += 1;
    const candidato = formatarNumero(loja, data.osSequencia[loja], prefixo);
    if (!data.os.some((o) => o.numero === candidato)) return candidato;
  }
  throw new Error('Nao consegui gerar um numero de OS livre.');
}

// ---------- itens e totais ----------
function normalizarItem(bruto) {
  const tipo = TIPOS_ITEM.includes(texto(bruto && bruto.tipo, 20).toLowerCase())
    ? texto(bruto.tipo, 20).toLowerCase()
    : 'peca';
  const quantidade = dinheiro(bruto && bruto.quantidade);
  const valorUnitario = dinheiro(bruto && bruto.valorUnitario);
  const desconto = dinheiro(bruto && bruto.desconto);
  const brutoTotal = dinheiro(quantidade * valorUnitario);
  // Vínculo opcional com um registro do estoque: é o que permite a baixa automática.
  // Sem vínculo, o item é só um valor na OS (não mexe no estoque).
  const estoqueId = bruto && bruto.estoqueId ? String(bruto.estoqueId) : null;
  const estoqueTipo = bruto && estoqueOS.TIPOS_ESTOQUE.includes(bruto.estoqueTipo) ? bruto.estoqueTipo : 'pneus';
  return {
    id: (bruto && bruto.id) || crypto.randomUUID(),
    tipo,
    descricao: texto(bruto && bruto.descricao, 200) || TIPO_ROTULO[tipo],
    marca: texto(bruto && bruto.marca, 80),
    medida: texto(bruto && bruto.medida, 80),
    quantidade,
    valorUnitario,
    desconto,
    total: dinheiro(Math.max(0, brutoTotal - desconto)),
    estoqueId,
    estoqueTipo: estoqueId ? estoqueTipo : null,
  };
}

// Subtotal = soma dos itens. Desconto geral pode ser em reais ('valor') ou porcentagem ('percento').
function calcularTotais(os) {
  const itens = Array.isArray(os.itens) ? os.itens : [];
  const subtotal = dinheiro(itens.reduce((soma, item) => soma + numeroDe(item.total), 0));
  const descontoItens = dinheiro(itens.reduce((soma, item) => soma + numeroDe(item.desconto), 0));
  const descontoTipo = os.descontoTipo === 'percento' ? 'percento' : 'valor';
  const descontoValor = dinheiro(os.descontoValor);
  const descontoGeral = descontoTipo === 'percento'
    ? dinheiro(subtotal * (Math.min(100, Math.max(0, descontoValor)) / 100))
    : descontoValor;
  const total = dinheiro(Math.max(0, subtotal - descontoGeral));
  return { subtotal, descontoItens, descontoTipo, descontoValor, descontoGeral, total };
}

function normalizarCliente(bruto) {
  const b = bruto || {};
  return {
    nome: texto(b.nome, 120),
    cpfCnpj: texto(b.cpfCnpj, 24),
    telefone: texto(b.telefone, 24),
    whatsapp: texto(b.whatsapp, 24),
    email: texto(b.email, 120),
    endereco: texto(b.endereco, 200),
    cidade: texto(b.cidade, 80),
    // campos que o documento impresso pede (OS antiga fica vazia, sem quebrar)
    bairro: texto(b.bairro, 80),
    cep: texto(b.cep, 12),
    rgIe: texto(b.rgIe, 24),
    midia: texto(b.midia, 40),
    contato: texto(b.contato, 80),
    referencia: texto(b.referencia, 160),
  };
}

function normalizarVeiculo(bruto) {
  const b = bruto || {};
  return {
    placa: texto(b.placa, 12).toUpperCase(),
    marca: texto(b.marca, 60),
    modelo: texto(b.modelo, 60),
    ano: texto(b.ano, 10),
    km: texto(b.km, 16),
    observacoes: texto(b.observacoes, 500),
  };
}

// ---------- regras de quem pode o que, dentro de uma OS ----------
function podeEditarValores(usuario, os) {
  if (pode(usuario.perfil, 'editarValores') && (usuario.perfil === 'admin' || usuario.perfil === 'gerente')) return true;
  if (usuario.perfil === 'operador') return STATUS_ANTES_DA_APROVACAO.includes(os.status);
  if (usuario.perfil === 'admin') return true;
  return false;
}

function podeMudarPara(usuario, os, novoStatus) {
  if (!pode(usuario.perfil, 'mudarStatus') && usuario.perfil !== 'admin') {
    // mecanico pode andar com a parte tecnica
    const tecnico = ['em execucao', 'aguardando peca', 'finalizada'];
    return usuario.perfil === 'mecanico' && tecnico.includes(novoStatus) && os.mecanicoId === usuario.id;
  }
  if (STATUS_TRAVADOS.includes(os.status) && usuario.perfil !== 'admin') return false;
  return true;
}

function enxergaOS(usuario, os) {
  if (!usuario) return false;
  if (!podeAcessarLoja(usuario, os.loja)) return false;
  if (usuario.perfil === 'mecanico') return os.mecanicoId === usuario.id;
  return true;
}

// ---------- filtros ----------
function filtrarOS(data, usuario, filtros = {}) {
  const lista = (garantirFormatoOS(data).os || []).filter((os) => enxergaOS(usuario, os));
  const alvo = (v) => texto(v, 120).toLowerCase();
  const numeroFiltro = alvo(filtros.numero);
  const clienteFiltro = alvo(filtros.cliente);
  const telefoneFiltro = String(filtros.telefone || '').replace(/\D/g, '');
  const placaFiltro = alvo(filtros.placa);
  const statusFiltro = filtros.status ? normalizarStatus(filtros.status) : '';
  const lojaFiltro = filtros.loja && (veTodasAsLojas(usuario) ? normalizarCodigo(filtros.loja) : '');
  const mecanicoFiltro = filtros.mecanicoId ? String(filtros.mecanicoId) : '';
  const de = filtros.de ? Number(filtros.de) : null;
  const ate = filtros.ate ? Number(filtros.ate) : null;

  return lista
    .filter((os) => {
      if (numeroFiltro && !alvo(os.numero).includes(numeroFiltro)) return false;
      if (clienteFiltro && !alvo(os.cliente && os.cliente.nome).includes(clienteFiltro)) return false;
      if (telefoneFiltro) {
        const tel = `${(os.cliente && os.cliente.telefone) || ''}${(os.cliente && os.cliente.whatsapp) || ''}`.replace(/\D/g, '');
        if (!tel.includes(telefoneFiltro)) return false;
      }
      if (placaFiltro && !alvo(os.veiculo && os.veiculo.placa).includes(placaFiltro)) return false;
      if (statusFiltro && os.status !== statusFiltro) return false;
      if (lojaFiltro && os.loja !== lojaFiltro) return false;
      if (mecanicoFiltro && os.mecanicoId !== mecanicoFiltro) return false;
      if (de !== null && Number(os.aberturaEm || 0) < de) return false;
      if (ate !== null && Number(os.aberturaEm || 0) > ate) return false;
      return true;
    })
    .sort((a, b) => numeroDe(b.aberturaEm) - numeroDe(a.aberturaEm));
}

function resumoOS(os) {
  return {
    id: os.id,
    numero: os.numero,
    loja: os.loja,
    status: os.status,
    statusRotulo: STATUS_ROTULO[os.status] || os.status,
    clienteId: os.clienteId || null,
    clienteNome: (os.cliente && os.cliente.nome) || '',
    clienteTelefone: (os.cliente && (os.cliente.whatsapp || os.cliente.telefone)) || '',
    placa: (os.veiculo && os.veiculo.placa) || '',
    veiculo: [os.veiculo && os.veiculo.marca, os.veiculo && os.veiculo.modelo].filter(Boolean).join(' '),
    aberturaEm: os.aberturaEm,
    alteradoEm: os.alteradoEm,
    conclusaoEm: os.conclusaoEm || null,
    entregaEm: os.entregaEm || null,
    total: numeroDe(os.total),
    responsavel: os.responsavel && os.responsavel.nome ? os.responsavel.nome : '',
    mecanicoId: os.mecanicoId || null,
  };
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Impressao da OS: DUAS VIAS na mesma folha A4 (cliente em cima, loja embaixo).
// O gerador do documento fica em impressao-os.js (testavel sem subir servidor).
// ---------------------------------------------------------------------------
const pagamentoMod = require('./pagamento');
const { htmlImpressao, SERVICOS_MODELO, GARANTIA_PADRAO, PRAZO_PADRAO } = require('./impressao-os');


function csvDeOS(listaOS, nomeLoja) {
  const esc = (v) => {
    const t = String(v === undefined || v === null ? '' : v).replace(/"/g, '""');
    return /[";\n]/.test(t) ? `"${t}"` : t;
  };
  const dataHora = (ms) => (ms ? new Date(Number(ms)).toLocaleString('pt-BR') : '');
  const linhas = [
    ['Numero', 'Loja', 'Status', 'Cliente', 'Telefone', 'Placa', 'Veiculo', 'Abertura', 'Alteracao', 'Conclusao', 'Entrega', 'Subtotal', 'Desconto', 'Total', 'Forma de pagamento', 'Responsavel'].join(';'),
  ];
  for (const os of listaOS) {
    linhas.push([
      esc(os.numero), esc(os.loja), esc(STATUS_ROTULO[os.status] || os.status),
      esc(os.cliente && os.cliente.nome), esc((os.cliente && (os.cliente.whatsapp || os.cliente.telefone)) || ''),
      esc(os.veiculo && os.veiculo.placa),
      esc([os.veiculo && os.veiculo.marca, os.veiculo && os.veiculo.modelo].filter(Boolean).join(' ')),
      esc(dataHora(os.aberturaEm)), esc(dataHora(os.alteradoEm)), esc(dataHora(os.conclusaoEm)), esc(dataHora(os.entregaEm)),
      String(numeroDe(os.subtotal).toFixed(2)).replace('.', ','),
      String(numeroDe(os.descontoGeral).toFixed(2)).replace('.', ','),
      String(numeroDe(os.total).toFixed(2)).replace('.', ','),
      esc(pagamentoMod.rotuloPagamento(os)),
      esc(os.responsavel && os.responsavel.nome),
    ].join(';'));
  }
  return { conteudo: '\ufeff' + linhas.join('\r\n'), nome: `ordens-de-servico${nomeLoja ? '-' + nomeLoja : ''}.csv` };
}

// ---------- rotas ----------
function registrarRotas(app, { loadData, withData, auth, auditoria, limites }) {
  estoqueOS.configurarLimites(limites);
  const log = (data, req, os, acao, resumo) => auditoria.registrar(data, {
    usuario: req.usuario.nome,
    usuarioId: req.usuario.id,
    loja: os.loja,
    acao,
    entidade: 'os',
    entidadeId: os.id,
    resumo,
  });

  // ---------- baixa de estoque (a lógica vive em estoque-os.js) ----------
  function resumoDoMovimento(movs, verbo) {
    const total = movs.reduce((soma, m) => soma + numeroDe(m.quantidade), 0);
    const nomes = [...new Set(movs.map((m) => (m.estoqueTipo === 'bebidas' ? m.bebidaNome : m.pneuDescricao)).filter(Boolean))];
    return `${verbo} ${total} un. — ${nomes.slice(0, 4).join(', ')}${nomes.length > 4 ? ` (+${nomes.length - 4})` : ''}`;
  }

  function anotarHistorico(os, { usuario, acao, de = null, para = null, resumo }) {
    os.historico.unshift({
      quando: Date.now(),
      usuarioId: usuario.id,
      usuario: usuario.nome,
      loja: os.loja,
      acao,
      de,
      para,
      resumo,
    });
    if (os.historico.length > 500) os.historico = os.historico.slice(0, 500);
  }

  // Aplica as movimentações de estoque e registra no histórico da OS e na auditoria
  function aplicarEstoque(data, req, os, movimentos) {
    const criados = estoqueOS.aplicar(data, os, movimentos, { usuario: req.usuario.nome });
    if (!criados.length) return [];
    const saidas = criados.filter((m) => m.tipo === 'saida');
    const entradas = criados.filter((m) => m.tipo === 'entrada');
    if (saidas.length) {
      const resumo = resumoDoMovimento(saidas, 'Baixa de estoque:');
      anotarHistorico(os, { usuario: req.usuario, acao: 'baixar-estoque', para: os.status, resumo });
      log(data, req, os, 'baixar-estoque', `${os.numero} — ${resumo}`);
    }
    if (entradas.length) {
      const resumo = resumoDoMovimento(entradas, 'Estorno de estoque:');
      anotarHistorico(os, { usuario: req.usuario, acao: 'estornar-estoque', para: os.status, resumo });
      log(data, req, os, 'estornar-estoque', `${os.numero} — ${resumo}`);
    }
    return criados;
  }

  // Lista de lojas (o seletor da tela). Quem nao e admin so ve a propria loja.
  app.get('/api/lojas', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const todas = garantirLojas(data);
    const visiveis = veTodasAsLojas(req.usuario) ? todas : todas.filter((l) => l.codigo === req.usuario.loja);
    res.json({ lojas: visiveis, minhaLoja: req.usuario.loja || null, todas: veTodasAsLojas(req.usuario) });
  });

  // Criar OS
  app.post('/api/os', async (req, res) => {
    if (!pode(req.usuario.perfil, 'criarOS')) {
      return res.status(403).json({ error: 'Seu perfil não pode abrir uma ordem de serviço.' });
    }
    const b = req.body || {};
    let erro = null;
    let criada = null;

    await withData((data) => {
      garantirFormatoOS(data);
      // loja: admin escolhe; os demais ficam travados na propria loja
      const lojaPedida = veTodasAsLojas(req.usuario) ? normalizarCodigo(b.loja) : normalizarCodigo(req.usuario.loja);
      const loja = acharLoja(data, lojaPedida);
      if (!loja || loja.ativa === false) {
        erro = 'Informe uma loja válida (UNICAR, FILIAL ou MATRIZ).';
        return;
      }
      if (!veTodasAsLojas(req.usuario) && !req.usuario.loja) {
        erro = 'Seu usuário não está ligado a nenhuma loja. Peça ao administrador.';
        return;
      }
      const escolhido = clientesMod.clienteDaOS(data, b.cliente, b.clienteId, req.usuario);
      const cliente = escolhido.data;
      if (!cliente.nome) { erro = 'Informe o nome do cliente.'; return; }
      const veiculo = normalizarVeiculo(b.veiculo);
      const itens = Array.isArray(b.itens) ? b.itens.map(normalizarItem) : [];
      const agora = Date.now();
      const statusInicial = normalizarStatus(b.status) || 'aberta';

      const base = {
        id: crypto.randomUUID(),
        numero: proximoNumero(data, loja.codigo),
        loja: loja.codigo,
        status: STATUS_OS.includes(statusInicial) ? statusInicial : 'aberta',
        cliente,
        clienteId: escolhido.clienteId || null,
        veiculo,
        itens,
        descontoTipo: b.descontoTipo === 'percento' ? 'percento' : 'valor',
        descontoValor: dinheiro(b.descontoValor),
        observacoesInternas: texto(b.observacoesInternas, 2000),
        observacoesCliente: texto(b.observacoesCliente, 2000),
        defeito: texto(b.defeito, 600),
        servicosSolicitados: texto(b.servicosSolicitados, 2000),
        ...pagamentoMod.dadosDePagamento(b, {}),
        condicoesPagamento: texto(b.condicoesPagamento, 200),
        autorizadoPor: texto(b.autorizadoPor, 120),
        mecanicoId: b.mecanicoId ? String(b.mecanicoId) : null,
        responsavel: { id: req.usuario.id, nome: req.usuario.nome },
        aberturaEm: agora,
        alteradoEm: agora,
        conclusaoEm: null,
        entregaEm: null,
        cancelamento: null,
        historico: [{
          quando: agora,
          usuarioId: req.usuario.id,
          usuario: req.usuario.nome,
          loja: loja.codigo,
          acao: 'abertura',
          de: null,
          para: 'aberta',
          resumo: `OS aberta por ${req.usuario.nome}.`,
        }],
        schemaVersao: 2,
      };
      Object.assign(base, calcularTotais(base));
      criada = base;
      data.os.push(base);
      log(data, req, base, 'criar', `Abriu a OS ${base.numero} (${base.cliente.nome}) na loja ${base.loja}.`);
    });

    if (erro) return res.status(400).json({ error: erro });
    res.json({ os: criada });
  });

  // Listar OS com filtros
  app.get('/api/os', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const filtros = {
      numero: req.query.numero,
      cliente: req.query.cliente,
      telefone: req.query.telefone,
      placa: req.query.placa,
      status: req.query.status,
      loja: req.query.loja,
      mecanicoId: req.query.mecanicoId,
      de: req.query.de,
      ate: req.query.ate,
    };
    const lista = filtrarOS(data, req.usuario, filtros);
    const limite = Math.min(Math.max(Number(req.query.limite) || 200, 1), 1000);
    res.json({
      total: lista.length,
      os: lista.slice(0, limite).map(resumoOS),
      lojas: veTodasAsLojas(req.usuario) ? garantirLojas(data) : garantirLojas(data).filter((l) => l.codigo === req.usuario.loja),
    });
  });

  // Ver uma OS (aceita o id ou o numero)
  app.get('/api/os/:chave', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const chave = String(req.params.chave || '');
    const os = data.os.find((o) => o.id === chave || o.numero === chave.toUpperCase());
    if (!os) return res.status(404).json({ error: 'OS não encontrada.' });
    if (!enxergaOS(req.usuario, os)) {
      return res.status(403).json({ error: 'Esta OS é de outra loja. Você não tem acesso.' });
    }
    res.json({ os, loja: acharLoja(data, os.loja), podeEditarValores: podeEditarValores(req.usuario, os) });
  });

  // Editar OS (o historico nunca e apagado)
  app.put('/api/os/:chave', async (req, res) => {
    const b = req.body || {};
    let erro = null;
    let statusErro = 400;
    let faltando = null;
    let atualizada = null;

    await withData((data) => {
      garantirFormatoOS(data);
      const chave = String(req.params.chave || '');
      const os = data.os.find((o) => o.id === chave || o.numero === chave.toUpperCase());
      if (!os) { erro = 'OS não encontrada.'; statusErro = 404; return; }
      if (!enxergaOS(req.usuario, os)) { erro = 'Esta OS é de outra loja. Você não tem acesso.'; statusErro = 403; return; }
      if (!pode(req.usuario.perfil, 'editarOS')) { erro = 'Seu perfil não pode editar OS.'; statusErro = 403; return; }
      if (STATUS_TRAVADOS.includes(os.status) && req.usuario.perfil !== 'admin') {
        erro = 'OS entregue ou cancelada só pode ser alterada pelo administrador.';
        statusErro = 403;
        return;
      }

      // CONFERÊNCIA DO ESTOQUE ANTES DE MEXER EM QUALQUER COISA:
      // se o item aumentou e não tem estoque, a edição inteira é recusada (nada é salvo).
      const itensDepois = b.itens !== undefined
        ? (Array.isArray(b.itens) ? b.itens.map(normalizarItem) : [])
        : os.itens;
      const jaTemBaixa = estoqueOS.resumoBaixas(os).length > 0;
      let movimentosEstoque = { saidas: [], entradas: [] };
      if (jaTemBaixa || os.status === 'em execucao') {
        movimentosEstoque = estoqueOS.calcularMovimentos(os, itensDepois);
        const conferencia = estoqueOS.conferirEstoque(data, movimentosEstoque.saidas);
        if (!conferencia.ok) {
          faltando = conferencia.faltando;
          erro = 'Estoque insuficiente para esta alteração na OS.';
          statusErro = 400;
          return;
        }
      }

      const mudancas = [];
      const ehMecanico = req.usuario.perfil === 'mecanico';

      if (!ehMecanico) {
        if (b.cliente !== undefined || b.clienteId) {
          const escolhido = clientesMod.clienteDaOS(data, b.cliente || os.cliente, b.clienteId || os.clienteId, req.usuario);
          const novo = escolhido.data;
          if (novo.nome !== os.cliente.nome) mudancas.push('cliente');
          os.cliente = { ...os.cliente, ...novo };
          if (escolhido.clienteId) os.clienteId = escolhido.clienteId;
        }
        if (b.veiculo !== undefined) {
          const novo = normalizarVeiculo(b.veiculo);
          if (novo.placa !== os.veiculo.placa) mudancas.push('veículo');
          os.veiculo = { ...os.veiculo, ...novo };
        }
        if (b.servicosSolicitados !== undefined) {
          os.servicosSolicitados = texto(b.servicosSolicitados, 2000);
          mudancas.push('serviços solicitados');
        }
        if (b.defeito !== undefined) os.defeito = texto(b.defeito, 600);
        if (b.pagamentos !== undefined || b.formaPagamento !== undefined || b.parcelas !== undefined || b.condicoesPagamento !== undefined) {
          const antesRotulo = pagamentoMod.rotuloPagamento(os);
          const novoPag = pagamentoMod.dadosDePagamento(b, os);
          if (b.condicoesPagamento !== undefined) os.condicoesPagamento = texto(b.condicoesPagamento, 200);
          Object.assign(os, novoPag);
          if (pagamentoMod.rotuloPagamento(os) !== antesRotulo) mudancas.push('forma de pagamento');
        }
        if (b.observacoesCliente !== undefined) {
          os.observacoesCliente = texto(b.observacoesCliente, 2000);
          mudancas.push('observações para o cliente');
        }
        if (b.mecanicoId !== undefined && pode(req.usuario.perfil, 'atribuirMecanico')) {
          os.mecanicoId = b.mecanicoId ? String(b.mecanicoId) : null;
          mudancas.push('mecânico responsável');
        }
        if (b.itens !== undefined || b.descontoValor !== undefined || b.descontoTipo !== undefined) {
          if (!podeEditarValores(req.usuario, os)) {
            erro = `Você não pode alterar valores de uma OS com status "${os.status}". Peça ao gerente ou ao administrador.`;
            statusErro = 403;
            return;
          }
          if (b.itens !== undefined) {
            os.itens = itensDepois; // já normalizado e já conferido contra o estoque
            mudancas.push('itens');
          }
          if (b.descontoTipo !== undefined) os.descontoTipo = b.descontoTipo === 'percento' ? 'percento' : 'valor';
          if (b.descontoValor !== undefined) os.descontoValor = dinheiro(b.descontoValor);
          if (b.descontoTipo !== undefined || b.descontoValor !== undefined) mudancas.push('desconto');
          Object.assign(os, calcularTotais(os));
        }
      }

      if (b.observacoesInternas !== undefined) {
        os.observacoesInternas = texto(b.observacoesInternas, 2000);
        mudancas.push('observações internas');
      }

      // Mecânico só mexe em serviços/observações técnicas: se tentou outra coisa, avisa.
      if (ehMecanico && !mudancas.length) {
        const tentouAlgo = ['cliente', 'veiculo', 'itens', 'descontoValor', 'descontoTipo'].some((k) => b[k] !== undefined);
        if (tentouAlgo) {
          erro = 'O mecânico pode atualizar apenas serviços e observações técnicas.';
          statusErro = 403;
          return;
        }
      }

      const agora = Date.now();
      os.alteradoEm = agora;
      os.historico.unshift({
        quando: agora,
        usuarioId: req.usuario.id,
        usuario: req.usuario.nome,
        loja: os.loja,
        acao: 'edicao',
        de: null,
        para: os.status,
        resumo: mudancas.length ? `Alterou: ${mudancas.join(', ')}.` : 'Salvou sem mudanças.',
      });
      if (os.historico.length > 500) os.historico = os.historico.slice(0, 500);
      atualizada = os;
      log(data, req, os, 'editar', `Editou a OS ${os.numero}${mudancas.length ? ` (${mudancas.join(', ')})` : ''}.`);
      // Ajusta o estoque pelo que mudou: aumentou → saída só da diferença; diminuiu/removeu → estorno
      if (movimentosEstoque.saidas.length || movimentosEstoque.entradas.length) {
        aplicarEstoque(data, req, os, movimentosEstoque);
      }
    });

    if (erro) return res.status(statusErro).json({ error: erro, faltando });
    res.json({ os: atualizada });
  });

  // Mudar status
  app.post('/api/os/:chave/status', async (req, res) => {
    const novo = normalizarStatus((req.body || {}).status);
    if (!novo) return res.status(400).json({ error: 'Informe um status válido.' });
    let erro = null;
    let statusErro = 400;
    let faltando = null;
    let atualizada = null;
    let movimentosEstoque = { saidas: [], entradas: [] };

    await withData((data) => {
      garantirFormatoOS(data);
      const chave = String(req.params.chave || '');
      const os = data.os.find((o) => o.id === chave || o.numero === chave.toUpperCase());
      if (!os) { erro = 'OS não encontrada.'; statusErro = 404; return; }
      if (!enxergaOS(req.usuario, os)) { erro = 'Esta OS é de outra loja. Você não tem acesso.'; statusErro = 403; return; }
      if (novo === 'cancelada') {
        erro = 'Para cancelar, use o cancelamento (com motivo obrigatório).';
        statusErro = 400;
        return;
      }
      if (!podeMudarPara(req.usuario, os, novo)) {
        erro = `Seu perfil não pode mudar esta OS para "${STATUS_ROTULO[novo]}".`;
        statusErro = 403;
        return;
      }

      // BAIXA DE ESTOQUE: acontece quando a OS entra em "Em execução".
      // A conta é sempre "o que a OS pede menos o que já foi baixado", então salvar o mesmo
      // status de novo não baixa nada (e um aumento baixa só a diferença).
      if (novo === 'em execucao') {
        movimentosEstoque = estoqueOS.calcularMovimentos(os, os.itens);
        const conferencia = estoqueOS.conferirEstoque(data, movimentosEstoque.saidas);
        if (!conferencia.ok) {
          faltando = conferencia.faltando;
          erro = 'Estoque insuficiente para colocar esta OS em execução.';
          statusErro = 400;
          return;
        }
      }

      const anterior = os.status;
      const agora = Date.now();
      os.status = novo;
      os.alteradoEm = agora;
      if (novo === 'finalizada' && !os.conclusaoEm) os.conclusaoEm = agora;
      if (novo === 'entregue') os.entregaEm = agora;
      os.historico.unshift({
        quando: agora,
        usuarioId: req.usuario.id,
        usuario: req.usuario.nome,
        loja: os.loja,
        acao: 'status',
        de: anterior,
        para: novo,
        resumo: `Status: ${STATUS_ROTULO[anterior] || anterior} → ${STATUS_ROTULO[novo] || novo}.`,
      });
      atualizada = os;
      log(data, req, os, 'status', `OS ${os.numero}: ${anterior} → ${novo}.`);
      if (movimentosEstoque.saidas.length || movimentosEstoque.entradas.length) {
        aplicarEstoque(data, req, os, movimentosEstoque);
      }
    });

    if (erro) return res.status(statusErro).json({ error: erro, faltando });
    res.json({ os: atualizada });
  });

  // Cancelar (motivo obrigatorio)
  app.post('/api/os/:chave/cancelar', async (req, res) => {
    const motivo = texto((req.body || {}).motivo, 500);
    if (motivo.length < 3) return res.status(400).json({ error: 'Informe o motivo do cancelamento.' });
    let erro = null;
    let statusErro = 400;
    let atualizada = null;

    await withData((data) => {
      garantirFormatoOS(data);
      const chave = String(req.params.chave || '');
      const os = data.os.find((o) => o.id === chave || o.numero === chave.toUpperCase());
      if (!os) { erro = 'OS não encontrada.'; statusErro = 404; return; }
      if (!enxergaOS(req.usuario, os)) { erro = 'Esta OS é de outra loja. Você não tem acesso.'; statusErro = 403; return; }
      if (!pode(req.usuario.perfil, 'cancelarOS')) {
        erro = 'Seu perfil não pode cancelar OS. Peça ao gerente ou ao administrador.';
        statusErro = 403;
        return;
      }
      if (os.status === 'cancelada') { erro = 'Esta OS já está cancelada.'; statusErro = 400; return; }
      const agora = Date.now();
      const anterior = os.status;
      os.status = 'cancelada';
      os.cancelamento = { motivo, quando: agora, usuarioId: req.usuario.id, usuario: req.usuario.nome };
      os.alteradoEm = agora;
      os.historico.unshift({
        quando: agora,
        usuarioId: req.usuario.id,
        usuario: req.usuario.nome,
        loja: os.loja,
        acao: 'cancelamento',
        de: anterior,
        para: 'cancelada',
        resumo: `Cancelou a OS. Motivo: ${motivo}`,
      });
      atualizada = os;
      log(data, req, os, 'cancelar', `Cancelou a OS ${os.numero}. Motivo: ${motivo}`);

      // CANCELAMENTO: devolve ao estoque tudo o que ainda estava baixado por esta OS
      // (as movimentações originais de saída continuam lá — o estorno é uma entrada nova)
      const estornos = estoqueOS.estornarTudo(data, os, { usuario: req.usuario.nome, motivo: 'cancelamento da OS' });
      if (estornos.length) {
        const resumo = resumoDoMovimento(estornos, 'Estorno de estoque:');
        anotarHistorico(os, { usuario: req.usuario, acao: 'estornar-estoque', de: 'cancelada', para: 'cancelada', resumo });
        log(data, req, os, 'estornar-estoque', `${os.numero} — ${resumo} (cancelamento da OS)`);
      }
    });

    if (erro) return res.status(statusErro).json({ error: erro });
    res.json({ os: atualizada });
  });

  // Estoque disponível para vincular aos itens da OS (sem valor de compra, sem dado sensível).
  // O saldo é o da LOJA da OS (ou da loja do usuário): estoque de outra loja não aparece.
  app.get('/api/os-estoque', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const lojaPedida = String((req.query && req.query.loja) || '').toUpperCase();
    const loja = lojaPedida || String((req.usuario && req.usuario.loja) || '').toUpperCase();
    const pneus = (Array.isArray(data.pneus) ? data.pneus : []).map((p) => {
      const quantidade = loja ? estoques.qtdNaLoja(p, loja) : estoques.totalDoPneu(p);
      const localizacao = loja ? estoques.localNaLoja(p, loja) : (p.localizacao || '');
      return {
        tipo: 'pneus',
        id: p.id,
        descricao: [p.marca, p.medida].filter(Boolean).join(' · '),
        detalhe: [p.status, localizacao].filter(Boolean).join(' · '),
        quantidade: numeroDe(quantidade),
        loja: loja || null,
      };
    });
    const bebidas = (Array.isArray(data.bebidas) ? data.bebidas : []).map((b) => ({
      tipo: 'bebidas',
      id: b.id,
      descricao: b.nome,
      detalhe: 'bebidas',
      quantidade: numeroDe(b.quantidade),
      loja: null,
    }));
    res.json({ itens: [...pneus, ...bebidas], loja: loja || null });
  });

  // Conferência do estoque SEM alterar nada: a tela usa para avisar antes de mudar o status
  app.post('/api/os/:chave/conferir-estoque', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const chave = String(req.params.chave || '');
    const os = data.os.find((o) => o.id === chave || o.numero === chave.toUpperCase());
    if (!os) return res.status(404).json({ error: 'OS não encontrada.' });
    if (!enxergaOS(req.usuario, os)) return res.status(403).json({ error: 'Esta OS é de outra loja. Você não tem acesso.' });
    const movimentos = estoqueOS.calcularMovimentos(os, os.itens);
    const conferencia = estoqueOS.conferirEstoque(data, movimentos.saidas);
    res.json({
      ok: conferencia.ok,
      faltando: conferencia.faltando,
      baixas: estoqueOS.resumoBaixas(os),
      previsao: { saidas: movimentos.saidas.length, entradas: movimentos.entradas.length },
    });
  });

  // Impressao / exportacao
  app.get('/api/os/:chave/imprimir', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const chave = String(req.params.chave || '');
    const os = data.os.find((o) => o.id === chave || o.numero === chave.toUpperCase());
    if (!os) return res.status(404).send('OS não encontrada.');
    if (!enxergaOS(req.usuario, os)) return res.status(403).send('Esta OS é de outra loja.');
    const loja = acharLoja(data, os.loja) || { codigo: os.loja, nome: os.loja };
    const incluirInternas = req.usuario.perfil === 'admin' || req.usuario.perfil === 'gerente' || req.query.internas === '1';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlImpressao(os, loja, {
      via: req.query.via,
      internas: incluirInternas,
      config: data.impressao || {},
    }));
  });

  // Modelo em branco: mesma folha, sem OS. Vendedor só tira da própria loja.
  app.get('/api/os-branco/imprimir', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const pedida = veTodasAsLojas(req.usuario) ? normalizarCodigo(req.query.loja) : normalizarCodigo(req.usuario.loja);
    const loja = acharLoja(data, pedida) || acharLoja(data, req.usuario.loja);
    if (!loja) return res.status(400).send('Escolha uma loja para o modelo.');
    const vazio = {
      numero: '', loja: loja.codigo, status: '', cliente: {}, veiculo: {}, itens: [],
      total: null, formaPagamento: '', parcelas: 1, pagamentos: [], condicoesPagamento: '', autorizadoPor: '', conclusaoEm: null,
      responsavel: { nome: '' },
    };
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlImpressao(vazio, loja, { modelo: true, vendedor: '', config: data.impressao || {} }));
  });

  // Configuracao usada na impressao: dados de cada loja + texto de garantia e prazo
  app.get('/api/os-config', (req, res) => {
    const data = loadData();
    const lojasMod = require('./lojas');
    const lista = lojasMod.listarLojas(data).map((l) => ({
      codigo: l.codigo,
      nome: l.nome || l.codigo,
      endereco: l.endereco || '',
      telefone: l.telefone || '',
      cnpj: l.cnpj || '',
      cor: l.cor || marcaDaLoja(l.codigo).cor || '',
    }));
    const imp = data.impressao || {};
    res.json({
      lojas: lista,
      impressao: {
        garantia: imp.garantia || GARANTIA_PADRAO,
        prazo: imp.prazo || PRAZO_PADRAO,
      },
      podeEditar: req.usuario.perfil === 'admin',
    });
  });

  app.put('/api/os-config', async (req, res) => {
    if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador altera os dados de impressão.' });
    const b = req.body || {};
    const lojasMod = require('./lojas');
    let resposta = null;
    await withData((data) => {
      if (Array.isArray(b.lojas)) {
        for (const pedida of b.lojas) {
          const alvo = lojasMod.listarLojas(data).find((l) => l.codigo === lojasMod.normalizarCodigo(pedida.codigo));
          if (!alvo) continue;
          if (pedida.nome !== undefined) alvo.nome = String(pedida.nome).trim().slice(0, 60) || alvo.codigo;
          if (pedida.endereco !== undefined) alvo.endereco = String(pedida.endereco).trim().slice(0, 160);
          if (pedida.telefone !== undefined) alvo.telefone = String(pedida.telefone).trim().slice(0, 40);
          if (pedida.cnpj !== undefined) alvo.cnpj = String(pedida.cnpj).trim().slice(0, 24);
          if (pedida.cor !== undefined) {
            const cor = String(pedida.cor).trim();
            alvo.cor = /^#[0-9a-fA-F]{6}$/.test(cor) ? cor.toLowerCase() : '';
          }
        }
      }
      const imp = data.impressao || {};
      if (b.impressao) {
        if (b.impressao.garantia !== undefined) imp.garantia = String(b.impressao.garantia).trim().slice(0, 600) || GARANTIA_PADRAO;
        if (b.impressao.prazo !== undefined) imp.prazo = String(b.impressao.prazo).trim().slice(0, 400) || PRAZO_PADRAO;
      }
      data.impressao = imp;
      auditoria.registrar(data, {
        usuario: req.usuario.nome, usuarioId: req.usuario.id, loja: req.usuario.loja || null,
        acao: 'configuracao', entidade: 'impressao', entidadeId: 'impressao',
        resumo: 'Dados de impressão (lojas, garantia e prazo) atualizados',
      });
      resposta = { ok: true };
    });
    res.json(resposta || { ok: true });
  });

  app.get('/api/os-exportar.csv', (req, res) => {
    const data = loadData();
    garantirFormatoOS(data);
    const lista = filtrarOS(data, req.usuario, {
      status: req.query.status,
      loja: req.query.loja,
      de: req.query.de,
      ate: req.query.ate,
    });
    const pedida = veTodasAsLojas(req.usuario) && req.query.loja ? normalizarCodigo(req.query.loja) : req.usuario.loja;
    const { conteudo, nome } = csvDeOS(lista, pedida);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(conteudo);
  });

  // Usuarios da loja (para escolher o mecanico responsavel) — nunca devolve senha
  app.get('/api/os-tecnicos', (req, res) => {
    const data = loadData();
    const usuarios = Array.isArray(data.usuarios) ? data.usuarios : [];
    const lista = usuarios
      .filter((u) => u.ativo !== false)
      .filter((u) => {
        if (veTodasAsLojas(req.usuario)) return ['mecanico', 'operador', 'gerente'].includes(u.perfil);
        return u.loja && u.loja === req.usuario.loja && ['mecanico', 'operador', 'gerente'].includes(u.perfil);
      })
      .map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, loja: u.loja || null }));
    // técnicos do cadastro (sem login) também podem ser o mecânico responsável
    const cadastrados = require('./tecnicos').paraListaDaOS(data, req.usuario, veTodasAsLojas(req.usuario));
    res.json(lista.concat(cadastrados));
  });
}

module.exports = {
  TIPOS_ITEM,
  TIPO_ROTULO,
  STATUS_ANTES_DA_APROVACAO,
  STATUS_TRAVADOS,
  garantirFormatoOS,
  formatarNumero,
  proximoNumero,
  calcularTotais,
  normalizarItem,
  normalizarCliente,
  normalizarVeiculo,
  podeEditarValores,
  podeMudarPara,
  enxergaOS,
  filtrarOS,
  resumoOS,
  htmlImpressao,
  csvDeOS,
  registrarRotas,
  dinheiro,
  texto,
  numeroDe,
};
