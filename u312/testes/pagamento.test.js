// Testes da forma de pagamento da OS (Dinheiro, Cartão, PIX etc.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  FORMAS_PAGAMENTO, normalizarForma, normalizarParcelas, rotuloPagamento, normalizarPagamentos, dadosDePagamento, totalPago,
} = require('../pagamento');
const { htmlImpressao } = require('../impressao-os');

const LOJA = { codigo: 'MATRIZ', nome: 'UNICAR MATRIZ' };
const osBase = (extra) => ({
  numero: 'OS-UNICAR-000001', loja: 'MATRIZ', status: 'aberta',
  cliente: { nome: 'Cliente' }, veiculo: {}, itens: [], total: 100, responsavel: { nome: 'X' },
  ...extra,
});

test('tem as principais formas de pagamento', () => {
  const rotulos = FORMAS_PAGAMENTO.map((f) => f.rotulo);
  for (const r of ['Dinheiro', 'PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto']) {
    assert.ok(rotulos.includes(r), `falta ${r}`);
  }
});

test('forma desconhecida é descartada e parcelas só valem no crédito', () => {
  assert.strictEqual(normalizarForma('PIX'), 'pix');
  assert.strictEqual(normalizarForma('<script>'), '');
  assert.strictEqual(normalizarParcelas(6, 'cartao_credito'), 6);
  assert.strictEqual(normalizarParcelas(6, 'pix'), 1);
  assert.strictEqual(normalizarParcelas(0, 'cartao_credito'), 1);
  assert.strictEqual(normalizarParcelas(999, 'cartao_credito'), 24);
  assert.strictEqual(normalizarParcelas('abc', 'cartao_credito'), 1);
});

test('texto do pagamento: forma, parcelas e observação', () => {
  assert.strictEqual(rotuloPagamento(osBase({ formaPagamento: 'dinheiro' })), 'Dinheiro');
  assert.strictEqual(rotuloPagamento(osBase({ formaPagamento: 'cartao_credito', parcelas: 3 })), 'Cartão de Crédito (3x)');
  assert.strictEqual(rotuloPagamento(osBase({ formaPagamento: 'cartao_credito', parcelas: 1 })), 'Cartão de Crédito');
  assert.strictEqual(
    rotuloPagamento(osBase({ formaPagamento: 'pix', condicoesPagamento: 'entrada 100' })),
    'PIX — entrada 100',
  );
});

test('OS antiga (só texto livre) continua mostrando o texto', () => {
  assert.strictEqual(rotuloPagamento(osBase({ condicoesPagamento: '3x no cartao' })), '3x no cartao');
  assert.strictEqual(rotuloPagamento(osBase({})), '');
});

test('a forma de pagamento sai na impressão', () => {
  const html = htmlImpressao(osBase({ formaPagamento: 'cartao_debito' }), LOJA);
  assert.match(html, /Forma de pagamento<\/span><b>Cartão de Débito<\/b>/);
});

test('lista da tela é igual à do servidor', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'os.js'), 'utf8');
  for (const f of FORMAS_PAGAMENTO) {
    assert.ok(fonte.includes(`codigo: '${f.codigo}'`), `tela sem ${f.codigo}`);
    assert.ok(fonte.includes(`'${f.rotulo}'`), `tela sem rótulo ${f.rotulo}`);
  }
});

test('várias formas na mesma OS: Dinheiro 500 + PIX 500', () => {
  const d = dadosDePagamento({ pagamentos: [{ forma: 'dinheiro', valor: 500 }, { forma: 'pix', valor: '500' }] }, {});
  assert.strictEqual(d.pagamentos.length, 2);
  assert.strictEqual(d.formaPagamento, 'misto');
  assert.strictEqual(totalPago(d), 1000);
  assert.strictEqual(rotuloPagamento(d), 'Dinheiro R$ 500,00 + PIX R$ 500,00');
  assert.strictEqual(rotuloPagamento({ ...d, condicoesPagamento: 'sinal pago' }), 'Dinheiro R$ 500,00 + PIX R$ 500,00 — sinal pago');
});

test('crédito parcelado com valor, milhar e vírgula decimal', () => {
  const d = dadosDePagamento({ pagamentos: [{ forma: 'cartao_credito', valor: '1250,5', parcelas: 4 }] }, {});
  assert.strictEqual(d.pagamentos[0].valor, 1250.5);
  assert.strictEqual(d.parcelas, 4);
  assert.strictEqual(rotuloPagamento(d), 'Cartão de Crédito R$ 1.250,50 (4x)');
});

test('linhas inválidas são descartadas; valor negativo ou texto vira 0; máximo de linhas', () => {
  const l = normalizarPagamentos([
    { forma: 'inexistente', valor: 10 }, { forma: 'pix', valor: -5 }, { forma: 'dinheiro', valor: 'abc' }, null,
  ]);
  assert.deepStrictEqual(l.map((x) => [x.forma, x.valor]), [['pix', 0], ['dinheiro', 0]]);
  const muitas = normalizarPagamentos(Array.from({ length: 30 }, () => ({ forma: 'pix', valor: 1 })));
  assert.strictEqual(muitas.length, 10);
  assert.deepStrictEqual(normalizarPagamentos('lixo'), []);
});

test('formato antigo (uma forma só) continua funcionando', () => {
  const novo = dadosDePagamento({ formaPagamento: 'pix' }, {});
  assert.deepStrictEqual(novo.pagamentos, [{ forma: 'pix', valor: 0, parcelas: 1 }]);
  assert.strictEqual(rotuloPagamento(novo), 'PIX');
  // OS gravada antes (sem lista) segue mostrando a forma, e editar outro campo não a perde
  assert.strictEqual(rotuloPagamento({ formaPagamento: 'cartao_credito', parcelas: 3 }), 'Cartão de Crédito (3x)');
  const mantido = dadosDePagamento({ observacao: 'x' }, { formaPagamento: 'pix' });
  assert.strictEqual(mantido.formaPagamento, 'pix');
});

test('mandar lista vazia limpa os pagamentos; não mandar nada mantém', () => {
  const base = dadosDePagamento({ pagamentos: [{ forma: 'pix', valor: 10 }] }, {});
  assert.deepStrictEqual(dadosDePagamento({ pagamentos: [] }, base).pagamentos, []);
  assert.strictEqual(dadosDePagamento({}, base).pagamentos.length, 1);
});

test('a tela envia a lista de pagamentos', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'os.js'), 'utf8');
  assert.ok(fonte.includes('pagamentos: lerPagamentos()'));
  assert.ok(fonte.includes('id="osAddPagamento"'));
});
