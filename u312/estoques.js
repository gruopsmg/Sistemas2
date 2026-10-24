// SMG GROUP - Estoque separado por loja
//
// Cada pneu tem um registro de estoque POR LOJA:
//   pneu.estoques = { UNICAR: { quantidade, minimo, localizacao }, FILIAL: {...}, MATRIZ: {...} }
//
// Compatibilidade (nao perder dado que ja existe):
//  - pneu antigo nao tem `estoques`. garantirEstoques() cria o mapa colocando TODA a
//    quantidade atual na loja principal (LOJA_PRINCIPAL), como pedido na migracao.
//  - Os campos antigos do pneu (quantidade / estoqueMinimo / localizacao) continuam
//    existindo e sao mantidos como ESPELHO da loja principal + total, porque telas,
//    relatorios e testes antigos leem esses campos. Quem grava sempre passa por este
//    modulo (nunca escreva pneu.quantidade direto: use definir/movimentar/transferir).
//
// Este arquivo e puro (nao le disco, nao fala com o servidor): da para testar direto.

const LOJA_PRINCIPAL = 'UNICAR';

function chave(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase();
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function registroVazio() {
  return { quantidade: 0, minimo: 0, localizacao: '' };
}

function normalizarRegistro(r) {
  const base = r && typeof r === 'object' ? r : {};
  return {
    quantidade: Math.max(0, numero(base.quantidade)),
    minimo: Math.max(0, numero(base.minimo)),
    localizacao: String(base.localizacao === undefined || base.localizacao === null ? '' : base.localizacao).trim(),
  };
}

// Cria (uma vez) o mapa de estoques a partir dos campos antigos.
// `lojas` e opcional: quando vem, garante que toda loja exista no mapa (zerada).
function garantirEstoques(pneu, lojas) {
  if (!pneu || typeof pneu !== 'object') return {};
  const temMapa = pneu.estoques && typeof pneu.estoques === 'object' && !Array.isArray(pneu.estoques);
  if (!temMapa) {
    pneu.estoques = {};
    pneu.estoques[LOJA_PRINCIPAL] = {
      quantidade: Math.max(0, numero(pneu.quantidade)),
      minimo: Math.max(0, numero(pneu.estoqueMinimo)),
      localizacao: String(pneu.localizacao || '').trim(),
    };
  }
  for (const codigo of Object.keys(pneu.estoques)) {
    // Normaliza NO LUGAR (mesmo objeto): quem ja pegou a referencia do registro
    // continua apontando para o registro de verdade do pneu.
    const atual = normalizarRegistro(pneu.estoques[codigo]);
    pneu.estoques[codigo] = Object.assign(pneu.estoques[codigo] || {}, atual);
  }
  if (Array.isArray(lojas)) {
    for (const loja of lojas) {
      const codigo = chave(typeof loja === 'string' ? loja : loja && loja.codigo);
      if (codigo && !pneu.estoques[codigo]) pneu.estoques[codigo] = registroVazio();
    }
  }
  return pneu.estoques;
}

// Registro da loja (cria zerado quando `criar`), ou null.
function registroDaLoja(pneu, loja, { criar = true } = {}) {
  const codigo = chave(loja);
  if (!codigo) return null;
  const mapa = garantirEstoques(pneu);
  if (!mapa[codigo] && criar) mapa[codigo] = registroVazio();
  return mapa[codigo] || null;
}

function qtdNaLoja(pneu, loja) {
  const r = registroDaLoja(pneu, loja, { criar: false });
  return r ? r.quantidade : 0;
}

function minimoNaLoja(pneu, loja) {
  const r = registroDaLoja(pneu, loja, { criar: false });
  return r ? r.minimo : 0;
}

function localNaLoja(pneu, loja) {
  const r = registroDaLoja(pneu, loja, { criar: false });
  return r ? r.localizacao : '';
}

function totalDoPneu(pneu) {
  const mapa = garantirEstoques(pneu);
  return Object.values(mapa).reduce((soma, r) => soma + numero(r.quantidade), 0);
}

// Loja principal do pneu (a que tem o espelho nos campos antigos).
function lojaPrincipalDoPneu(pneu) {
  const mapa = garantirEstoques(pneu);
  if (mapa[LOJA_PRINCIPAL]) return LOJA_PRINCIPAL;
  const primeira = Object.keys(mapa).find((c) => numero(mapa[c].quantidade) > 0);
  return primeira || LOJA_PRINCIPAL;
}

// Mantem os campos antigos coerentes: quantidade = TOTAL (todas as lojas),
// estoqueMinimo/localizacao = loja principal. Nenhuma tela antiga quebra.
function sincronizar(pneu) {
  if (!pneu || typeof pneu !== 'object') return pneu;
  const mapa = garantirEstoques(pneu);
  const principal = lojaPrincipalDoPneu(pneu);
  const registro = mapa[principal] || registroVazio();
  pneu.quantidade = totalDoPneu(pneu);
  pneu.estoqueMinimo = numero(registro.minimo);
  pneu.localizacao = registro.localizacao || '';
  if (!pneu.loja || !mapa[chave(pneu.loja)]) pneu.loja = principal;
  return pneu;
}

// ---------- operacoes (todas devolvem { ok, erro? , antes, depois }) ----------

function exigirQuantidade(qtd) {
  const n = Number(qtd);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, erro: 'Quantidade inválida.' };
  return { ok: true, qtd: n };
}

// Entrada (+) ou saida (-) na loja informada.
function movimentar(pneu, loja, tipo, quantidade) {
  const codigo = chave(loja);
  if (!codigo) return { ok: false, erro: 'Informe a loja.' };
  if (tipo !== 'entrada' && tipo !== 'saida') return { ok: false, erro: 'Tipo de movimentação inválido.' };
  const q = exigirQuantidade(quantidade);
  if (!q.ok) return q;
  const registro = registroDaLoja(pneu, codigo);
  const antes = registro.quantidade;
  const depois = tipo === 'entrada' ? antes + q.qtd : antes - q.qtd;
  if (depois < 0) {
    return { ok: false, erro: `Estoque insuficiente na loja ${codigo} (tem ${antes}, pediu ${q.qtd}).`, antes, depois: antes };
  }
  registro.quantidade = depois;
  sincronizar(pneu);
  return { ok: true, antes, depois, loja: codigo };
}

// Define a quantidade exata da loja (usado na importacao "substituir" e na edicao).
function definirQuantidade(pneu, loja, quantidade) {
  const codigo = chave(loja);
  if (!codigo) return { ok: false, erro: 'Informe a loja.' };
  const n = Number(quantidade);
  if (!Number.isFinite(n) || n < 0) return { ok: false, erro: 'Quantidade inválida.' };
  const registro = registroDaLoja(pneu, codigo);
  const antes = registro.quantidade;
  registro.quantidade = n;
  sincronizar(pneu);
  return { ok: true, antes, depois: n, loja: codigo };
}

function definirMinimo(pneu, loja, minimo) {
  const codigo = chave(loja);
  if (!codigo) return { ok: false, erro: 'Informe a loja.' };
  const n = Number(minimo);
  if (!Number.isFinite(n) || n < 0) return { ok: false, erro: 'Estoque mínimo inválido.' };
  const registro = registroDaLoja(pneu, codigo);
  const antes = registro.minimo;
  registro.minimo = n;
  sincronizar(pneu);
  return { ok: true, antes, depois: n, loja: codigo };
}

function definirLocalizacao(pneu, loja, localizacao) {
  const codigo = chave(loja);
  if (!codigo) return { ok: false, erro: 'Informe a loja.' };
  const registro = registroDaLoja(pneu, codigo);
  registro.localizacao = String(localizacao === undefined || localizacao === null ? '' : localizacao).trim();
  sincronizar(pneu);
  return { ok: true, depois: registro.localizacao, loja: codigo };
}

// Transferencia: sai de uma loja, entra na outra (as duas no mesmo pneu).
function transferir(pneu, de, para, quantidade, { confirmadoPor = '' } = {}) {
  const origem = chave(de);
  const destino = chave(para);
  if (!origem || !destino) return { ok: false, erro: 'Informe a loja de origem e a de destino.' };
  if (origem === destino) return { ok: false, erro: 'A loja de origem e a de destino são a mesma.' };
  const q = exigirQuantidade(quantidade);
  if (!q.ok) return q;
  const rOrigem = registroDaLoja(pneu, origem);
  if (rOrigem.quantidade < q.qtd) {
    return { ok: false, erro: `A loja ${origem} só tem ${rOrigem.quantidade} un. desse pneu.` };
  }
  const rDestino = registroDaLoja(pneu, destino);
  const antesOrigem = rOrigem.quantidade;
  const antesDestino = rDestino.quantidade;
  rOrigem.quantidade = antesOrigem - q.qtd;
  rDestino.quantidade = antesDestino + q.qtd;
  sincronizar(pneu);
  return {
    ok: true,
    quantidade: q.qtd,
    de: origem,
    para: destino,
    antes: { [origem]: antesOrigem, [destino]: antesDestino },
    depois: { [origem]: rOrigem.quantidade, [destino]: rDestino.quantidade },
    confirmadoPor: String(confirmadoPor || ''),
  };
}

// Visao "lado a lado": uma linha por loja, na ordem pedida.
function resumoPorLoja(pneu, lojas) {
  const mapa = garantirEstoques(pneu);
  const codigos = (Array.isArray(lojas) && lojas.length ? lojas : Object.keys(mapa))
    .map((l) => chave(typeof l === 'string' ? l : l && l.codigo))
    .filter(Boolean);
  return codigos.map((codigo) => {
    const r = mapa[codigo] || registroVazio();
    return { loja: codigo, quantidade: r.quantidade, minimo: r.minimo, localizacao: r.localizacao };
  });
}

// Abaixo do minimo em alguma loja? (usado no painel)
function lojasAbaixoDoMinimo(pneu, lojas) {
  return resumoPorLoja(pneu, lojas).filter((r) => r.minimo > 0 && r.quantidade < r.minimo);
}

// Normaliza todos os pneus de uma lista (migracao/leitura). Devolve quantos foram criados.
function migrarLista(pneus, lojas) {
  let criados = 0;
  for (const pneu of Array.isArray(pneus) ? pneus : []) {
    const tinha = pneu && pneu.estoques && typeof pneu.estoques === 'object';
    garantirEstoques(pneu, lojas);
    if (!tinha) criados += 1;
    sincronizar(pneu);
  }
  return criados;
}

module.exports = {
  LOJA_PRINCIPAL,
  chave,
  registroVazio,
  garantirEstoques,
  registroDaLoja,
  qtdNaLoja,
  minimoNaLoja,
  localNaLoja,
  totalDoPneu,
  lojaPrincipalDoPneu,
  sincronizar,
  movimentar,
  definirQuantidade,
  definirMinimo,
  definirLocalizacao,
  transferir,
  resumoPorLoja,
  lojasAbaixoDoMinimo,
  migrarLista,
};
