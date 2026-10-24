'use strict';
// Formas de pagamento da OS. Fica em arquivo próprio para o os.js, a impressão
// (HTML) e o PDF usarem exatamente a mesma lista e o mesmo texto.

const FORMAS_PAGAMENTO = [
  { codigo: 'dinheiro', rotulo: 'Dinheiro' },
  { codigo: 'pix', rotulo: 'PIX' },
  { codigo: 'cartao_credito', rotulo: 'Cartão de Crédito', aceitaParcelas: true },
  { codigo: 'cartao_debito', rotulo: 'Cartão de Débito' },
  { codigo: 'boleto', rotulo: 'Boleto' },
  { codigo: 'transferencia', rotulo: 'Transferência bancária' },
  { codigo: 'cheque', rotulo: 'Cheque' },
  { codigo: 'crediario', rotulo: 'Crediário / Fiado' },
  { codigo: 'misto', rotulo: 'Misto (mais de uma forma)' },
  { codigo: 'outro', rotulo: 'Outro' },
];

const MAX_PARCELAS = 24;

function normalizarForma(valor) {
  const v = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
  return FORMAS_PAGAMENTO.some((f) => f.codigo === v) ? v : '';
}

// Só cartão de crédito tem parcelas; nos demais casos vira 1.
function normalizarParcelas(valor, forma) {
  const f = FORMAS_PAGAMENTO.find((x) => x.codigo === forma);
  if (!f || !f.aceitaParcelas) return 1;
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PARCELAS);
}

const MAX_LINHAS_PAGAMENTO = 10;
const VALOR_MAXIMO = 10000000;

function valorSeguro(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, VALOR_MAXIMO) * 100) / 100;
}

function brl(v) {
  const [inteiro, dec] = (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).split('.');
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

// Lista de pagamentos da OS: [{ forma, valor, parcelas }]. Linha sem forma válida é descartada.
// valor 0 = "valor não informado" (OS antigas e quem só escolhe a forma).
function normalizarPagamentos(lista) {
  if (!Array.isArray(lista)) return [];
  const saida = [];
  for (const bruto of lista.slice(0, MAX_LINHAS_PAGAMENTO)) {
    const forma = normalizarForma(bruto && bruto.forma);
    if (!forma) continue;
    saida.push({ forma, valor: valorSeguro(bruto.valor), parcelas: normalizarParcelas(bruto.parcelas, forma) });
  }
  return saida;
}

// Lista de pagamentos que vale para a OS, a partir do que veio no pedido (b) e do que já existia (base).
// Aceita o formato novo (b.pagamentos) e o antigo de uma forma só (b.formaPagamento + b.parcelas).
// Devolve também formaPagamento/parcelas já resumidos (usados por quem só quer "a forma").
function dadosDePagamento(b, base) {
  const pedido = b || {};
  const antes = base || {};
  let pagamentos;
  if (pedido.pagamentos !== undefined) {
    pagamentos = normalizarPagamentos(pedido.pagamentos);
  } else if (pedido.formaPagamento !== undefined || pedido.parcelas !== undefined) {
    const forma = normalizarForma(pedido.formaPagamento !== undefined ? pedido.formaPagamento : antes.formaPagamento);
    pagamentos = forma ? [{ forma, valor: 0, parcelas: normalizarParcelas(pedido.parcelas, forma) }] : [];
  } else if (Array.isArray(antes.pagamentos)) {
    pagamentos = normalizarPagamentos(antes.pagamentos);
  } else {
    const forma = normalizarForma(antes.formaPagamento);
    pagamentos = forma ? [{ forma, valor: 0, parcelas: normalizarParcelas(antes.parcelas, forma) }] : [];
  }
  const formas = [...new Set(pagamentos.map((x) => x.forma))];
  const credito = pagamentos.find((x) => x.forma === 'cartao_credito');
  return {
    pagamentos,
    formaPagamento: formas.length === 0 ? '' : (formas.length === 1 ? formas[0] : 'misto'),
    parcelas: credito ? credito.parcelas : 1,
  };
}

function totalPago(os) {
  const lista = os && Array.isArray(os.pagamentos) ? os.pagamentos : [];
  return Math.round(lista.reduce((s, x) => s + valorSeguro(x.valor), 0) * 100) / 100;
}

function rotuloDeLinha(x) {
  const f = FORMAS_PAGAMENTO.find((y) => y.codigo === x.forma);
  if (!f) return '';
  let t = f.rotulo;
  if (valorSeguro(x.valor) > 0) t += ` ${brl(x.valor)}`;
  if (f.aceitaParcelas && Number(x.parcelas) > 1) t += ` (${Number(x.parcelas)}x)`;
  return t;
}

// Texto único para impressão/PDF/CSV:
//   "Dinheiro R$ 500,00 + PIX R$ 500,00 — observação"
// OS antigas (uma forma só, ou só texto livre) continuam mostrando o que tinham.
function rotuloPagamento(os) {
  const o = os || {};
  const obs = String(o.condicoesPagamento || '').trim();
  let partes = [];
  if (Array.isArray(o.pagamentos) && o.pagamentos.length) {
    partes = o.pagamentos.map(rotuloDeLinha).filter(Boolean);
  } else if (o.formaPagamento) {
    partes = [rotuloDeLinha({ forma: o.formaPagamento, valor: 0, parcelas: o.parcelas })].filter(Boolean);
  }
  const t = partes.join(' + ');
  if (!t) return obs;
  return obs ? `${t} — ${obs}` : t;
}

module.exports = {
  FORMAS_PAGAMENTO, MAX_PARCELAS, MAX_LINHAS_PAGAMENTO, normalizarForma, normalizarParcelas,
  normalizarPagamentos, dadosDePagamento, totalPago, rotuloPagamento,
};
