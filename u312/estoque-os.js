// UNICAR - Baixa automática do estoque pelas Ordens de Serviço
//
// Regras definidas pelo dono do sistema (e conferidas por teste automático):
//  1. a baixa acontece quando a OS entra em "Em execução" — uma vez só, sem duplicar;
//  2. uma movimentação de saída para cada pneu/peça/produto vinculado a um item do estoque;
//  3. a movimentação guarda número da OS, loja, item, quantidade, usuário, data e hora;
//  4. nunca deixa estoque negativo: se faltar, a mudança de status é bloqueada e o sistema
//     mostra exatamente quais itens estão faltando;
//  5. item que aumenta de quantidade depois da baixa: baixa SOMENTE a diferença;
//  6. item que diminui ou é removido: cria ENTRADA de estorno — a movimentação original fica;
//  7. OS cancelada: estorna tudo o que ainda estava baixado;
//  8. nada é apagado: o controle (`os.baixas`) só registra o saldo baixado por item.
//
// O estoque de PNEU e separado por loja (estoques.js): a baixa de uma OS da FILIAL tira da
// FILIAL, nunca do estoque da UNICAR. Bebida continua sendo um estoque unico do grupo.

const TIPOS_ESTOQUE = ['pneus', 'bebidas'];

// Estoque de pneu e separado por loja (estoques.js). Bebida continua unica.
const estoquesPorLoja = require('./estoques');

function numeroDe(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function acharEstoque(data, estoqueId, estoqueTipo) {
  const tipo = TIPOS_ESTOQUE.includes(estoqueTipo) ? estoqueTipo : 'pneus';
  const lista = Array.isArray(data[tipo]) ? data[tipo] : [];
  const registro = lista.find((x) => x && x.id === estoqueId);
  return registro ? { registro, tipo } : null;
}

function descricaoDoEstoque(tipo, registro) {
  if (!registro) return '';
  return tipo === 'bebidas'
    ? String(registro.nome || '')
    : [registro.marca, registro.medida].filter(Boolean).join(' · ');
}

// ---------- controle de quanto já foi baixado por item da OS ----------
function baixas(os) {
  if (!Array.isArray(os.baixas)) os.baixas = [];
  return os.baixas;
}

function saldoBaixado(os, itemId) {
  return baixas(os)
    .filter((b) => b.itemId === itemId)
    .reduce((soma, b) => soma + numeroDe(b.quantidade), 0);
}

function controleDoItem(os, itemId) {
  return baixas(os).find((b) => b.itemId === itemId) || null;
}

function anotarControle(os, itemId, delta, estoqueTipo, estoqueId, descricao) {
  const agora = Date.now();
  const controle = controleDoItem(os, itemId);
  if (controle) {
    controle.quantidade = Math.max(0, numeroDe(controle.quantidade) + delta);
    controle.estoqueTipo = estoqueTipo || controle.estoqueTipo;
    controle.estoqueId = estoqueId || controle.estoqueId;
    controle.descricao = descricao || controle.descricao;
    controle.atualizadoEm = agora;
    return controle;
  }
  const novo = {
    itemId,
    estoqueTipo: estoqueTipo || 'pneus',
    estoqueId: estoqueId || null,
    descricao: descricao || '',
    quantidade: Math.max(0, delta),
    criadoEm: agora,
    atualizadoEm: agora,
  };
  baixas(os).push(novo);
  return novo;
}

// ---------- o que precisa baixar / estornar entre o que a OS pede e o que já foi baixado ----------
function calcularMovimentos(os, itens) {
  const listaItens = Array.isArray(itens) ? itens : [];
  const porId = new Map(listaItens.map((i) => [String(i.id), i]));
  const saidas = [];
  const entradas = [];

  for (const item of listaItens) {
    if (!item || !item.estoqueId) continue; // item sem vínculo com estoque não baixa nada
    const desejado = numeroDe(item.quantidade);
    const atual = saldoBaixado(os, item.id);
    const delta = desejado - atual;

    if (delta > 0) {
      saidas.push({
        itemId: item.id,
        estoqueId: item.estoqueId,
        estoqueTipo: item.estoqueTipo || 'pneus',
        quantidade: delta,
        descricao: item.descricao || '',
        motivo: 'uso na OS',
        loja: os.loja,
      });
    } else if (delta < 0) {
      const controle = controleDoItem(os, item.id) || {};
      entradas.push({
        itemId: item.id,
        estoqueId: controle.estoqueId || item.estoqueId,
        estoqueTipo: controle.estoqueTipo || item.estoqueTipo || 'pneus',
        quantidade: Math.abs(delta),
        descricao: item.descricao || controle.descricao || '',
        motivo: 'quantidade reduzida na OS',
        loja: os.loja,
      });
    }
  }

  // Itens que saíram da OS (ou perderam o vínculo) com baixa ainda em aberto
  for (const controle of baixas(os)) {
    const saldo = numeroDe(controle.quantidade);
    if (saldo <= 0) continue;
    const item = porId.get(String(controle.itemId));
    const aindaVale = item && item.estoqueId && String(item.estoqueId) === String(controle.estoqueId);
    if (aindaVale) continue;
    entradas.push({
      itemId: controle.itemId,
      estoqueId: controle.estoqueId,
      estoqueTipo: controle.estoqueTipo || 'pneus',
      quantidade: saldo,
      descricao: controle.descricao || (item ? item.descricao : ''),
      motivo: item ? 'item deixou de ser do estoque' : 'item removido da OS',
      loja: os.loja,
    });
  }

  return { saidas, entradas };
}

// ---------- conferência: dá para baixar sem deixar estoque negativo? ----------
function conferirEstoque(data, saidas) {
  const porEstoque = new Map();
  for (const saida of saidas || []) {
    const chave = `${saida.estoqueTipo}:${saida.estoqueId}:${String(saida.loja || '').toUpperCase()}`;
    const atual = porEstoque.get(chave) || { estoqueTipo: saida.estoqueTipo, estoqueId: saida.estoqueId, loja: saida.loja, quantidade: 0, itens: [] };
    atual.quantidade += numeroDe(saida.quantidade);
    if (saida.descricao) atual.itens.push(saida.descricao);
    porEstoque.set(chave, atual);
  }

  const faltando = [];
  for (const pedido of porEstoque.values()) {
    const achado = acharEstoque(data, pedido.estoqueId, pedido.estoqueTipo);
    if (!achado) {
      faltando.push({
        descricao: pedido.itens.join(', ') || '(item não encontrado no estoque)',
        disponivel: 0,
        necessario: pedido.quantidade,
        faltam: pedido.quantidade,
        motivo: 'o item do estoque não existe mais',
      });
      continue;
    }
    // Pneu: o saldo que importa e o da LOJA DA OS. Bebida: saldo unico.
    const disponivel = achado.tipo === 'pneus'
      ? estoquesPorLoja.qtdNaLoja(achado.registro, pedido.loja)
      : numeroDe(achado.registro.quantidade);
    if (disponivel < pedido.quantidade) {
      faltando.push({
        estoqueId: pedido.estoqueId,
        estoqueTipo: achado.tipo,
        loja: pedido.loja,
        descricao: descricaoDoEstoque(achado.tipo, achado.registro),
        localizacao: achado.tipo === 'pneus'
          ? estoquesPorLoja.localNaLoja(achado.registro, pedido.loja)
          : (achado.registro.localizacao || ''),
        disponivel,
        necessario: pedido.quantidade,
        faltam: pedido.quantidade - disponivel,
      });
    }
  }
  return { ok: faltando.length === 0, faltando };
}

// ---------- movimentações ----------
function criarMovimentacao(data, { tipo, estoqueTipo, registro, quantidade, antes, depois, texto, os, itemId, usuario, quando }) {
  const mov = {
    id: crypto.randomUUID(),
    origem: 'os',
    osId: os.id,
    osNumero: os.numero,
    loja: os.loja,
    itemId: itemId || null,
    estoqueTipo,
    tipo,
    quantidade,
    estoqueApos: depois,
    usuario: usuario || 'sistema',
    criadoEm: quando || Date.now(),
  };

  if (estoqueTipo === 'bebidas') {
    mov.bebidaId = registro.id;
    mov.bebidaNome = registro.nome;
    // no cadastro de bebidas o campo "destino" serve de observação na entrada
    mov.destino = texto;
    data.bebidasMov.unshift(mov);
    const limite = LIMITES.bebidas;
    if (data.bebidasMov.length > limite) data.bebidasMov = data.bebidasMov.slice(0, limite);
  } else {
    mov.pneuId = registro.id;
    mov.pneuDescricao = descricaoDoEstoque('pneus', registro);
    mov.motivo = texto;
    mov.quantidadeAntes = antes;
    data.movimentos.unshift(mov);
    const limite = LIMITES.movimentos;
    if (data.movimentos.length > limite) data.movimentos = data.movimentos.slice(0, limite);
  }
  return mov;
}

// Limites de histórico (mesmos números do sistema; trocáveis por configuração)
const LIMITES = { movimentos: 500, bebidas: 500 };
function configurarLimites({ movimentos, bebidas } = {}) {
  if (Number.isFinite(Number(movimentos)) && Number(movimentos) > 0) LIMITES.movimentos = Math.trunc(Number(movimentos));
  if (Number.isFinite(Number(bebidas)) && Number(bebidas) > 0) LIMITES.bebidas = Math.trunc(Number(bebidas));
}

// ---------- aplicar (baixar e estornar) ----------
function aplicar(data, os, movimentos, { usuario, quando } = {}) {
  const criados = [];
  const textoOS = `OS ${os.numero} (loja ${os.loja})`;
  const cliente = os.cliente && os.cliente.nome ? os.cliente.nome : '';
  const agora = quando || Date.now();

  for (const saida of movimentos.saidas || []) {
    const achado = acharEstoque(data, saida.estoqueId, saida.estoqueTipo);
    if (!achado) continue;
    const quantidade = numeroDe(saida.quantidade);
    let antes;
    let depois;
    if (achado.tipo === 'pneus') {
      // sai da loja da OS (nunca do total das outras lojas)
      const baixa = estoquesPorLoja.movimentar(achado.registro, os.loja, 'saida', quantidade);
      if (!baixa.ok) continue; // a conferência já barrou; aqui é a rede de segurança
      antes = baixa.antes;
      depois = baixa.depois;
    } else {
      antes = numeroDe(achado.registro.quantidade);
      depois = antes - quantidade;
      achado.registro.quantidade = depois;
    }
    achado.registro.atualizadoEm = agora;
    const mov = criarMovimentacao(data, {
      tipo: 'saida',
      estoqueTipo: achado.tipo,
      registro: achado.registro,
      quantidade,
      antes,
      depois,
      texto: `Baixa automática da ${textoOS} (${saida.motivo || 'uso na OS'})${cliente ? ` — cliente ${cliente}` : ''}`,
      os,
      itemId: saida.itemId,
      usuario,
      quando: agora,
    });
    criados.push(mov);
    anotarControle(os, saida.itemId, quantidade, achado.tipo, achado.registro.id, descricaoDoEstoque(achado.tipo, achado.registro));
  }

  for (const entrada of movimentos.entradas || []) {
    const achado = acharEstoque(data, entrada.estoqueId, entrada.estoqueTipo);
    if (!achado) continue;
    const quantidade = numeroDe(entrada.quantidade);
    let antes;
    let depois;
    if (achado.tipo === 'pneus') {
      // estorna para a loja da OS (mesma loja de onde saiu)
      const volta = estoquesPorLoja.movimentar(achado.registro, os.loja, 'entrada', quantidade);
      if (!volta.ok) continue;
      antes = volta.antes;
      depois = volta.depois;
    } else {
      antes = numeroDe(achado.registro.quantidade);
      depois = antes + quantidade;
      achado.registro.quantidade = depois;
    }
    achado.registro.atualizadoEm = agora;
    const mov = criarMovimentacao(data, {
      tipo: 'entrada',
      estoqueTipo: achado.tipo,
      registro: achado.registro,
      quantidade,
      antes,
      depois,
      texto: `Estorno da ${textoOS} (${entrada.motivo || 'devolução ao estoque'})${cliente ? ` — cliente ${cliente}` : ''}`,
      os,
      itemId: entrada.itemId,
      usuario,
      quando: agora,
    });
    criados.push(mov);
    anotarControle(os, entrada.itemId, -quantidade, achado.tipo, achado.registro.id, descricaoDoEstoque(achado.tipo, achado.registro));
  }

  if (criados.length) {
    os.estoqueAlteradoEm = agora;
    os.estoqueBaixadoPor = usuario || os.estoqueBaixadoPor || null;
  }
  return criados;
}

// Estorna tudo o que ainda está baixado (usado no cancelamento)
function estornarTudo(data, os, { usuario, motivo = 'cancelamento da OS', quando } = {}) {
  const entradas = [];
  for (const controle of baixas(os)) {
    const saldo = numeroDe(controle.quantidade);
    if (saldo <= 0) continue;
    entradas.push({
      itemId: controle.itemId,
      estoqueId: controle.estoqueId,
      estoqueTipo: controle.estoqueTipo || 'pneus',
      quantidade: saldo,
      descricao: controle.descricao || '',
      motivo,
    });
  }
  if (!entradas.length) return [];
  return aplicar(data, os, { saidas: [], entradas }, { usuario, quando });
}

// Resumo para a tela: o que está baixado agora por esta OS
function resumoBaixas(os) {
  return baixas(os)
    .filter((b) => numeroDe(b.quantidade) > 0)
    .map((b) => ({
      itemId: b.itemId,
      estoqueId: b.estoqueId,
      estoqueTipo: b.estoqueTipo || 'pneus',
      descricao: b.descricao || '',
      quantidade: numeroDe(b.quantidade),
    }));
}

module.exports = {
  TIPOS_ESTOQUE,
  acharEstoque,
  descricaoDoEstoque,
  baixas,
  saldoBaixado,
  calcularMovimentos,
  conferirEstoque,
  aplicar,
  estornarTudo,
  resumoBaixas,
  configurarLimites,
};
