// Testes do estoque separado por loja (estoques.js).
// Modulo puro: nao sobe servidor, nao toca em arquivo. Roda rapido.
const test = require('node:test');
const assert = require('node:assert');
const est = require('../estoques');

const LOJAS = ['UNICAR', 'FILIAL', 'MATRIZ'];

function pneuAntigo(extra = {}) {
  return {
    id: 'p1',
    marca: 'LONGWAY',
    medida: '175/65 R14',
    status: 'novo',
    quantidade: 10,
    estoqueMinimo: 4,
    localizacao: 'Corredor A',
    ...extra,
  };
}

test('estoque por loja: pneu antigo vira estoque da loja principal sem perder quantidade', () => {
  const p = pneuAntigo();
  const criados = est.migrarLista([p], LOJAS);
  assert.strictEqual(criados, 1);
  assert.strictEqual(est.qtdNaLoja(p, 'UNICAR'), 10, 'toda a quantidade existente fica na loja principal');
  assert.strictEqual(est.qtdNaLoja(p, 'FILIAL'), 0);
  assert.strictEqual(est.qtdNaLoja(p, 'MATRIZ'), 0);
  assert.strictEqual(est.minimoNaLoja(p, 'UNICAR'), 4);
  assert.strictEqual(est.localNaLoja(p, 'UNICAR'), 'Corredor A');
  assert.strictEqual(est.totalDoPneu(p), 10);
  // campos antigos continuam coerentes (telas/relatorios antigos)
  assert.strictEqual(p.quantidade, 10);
  assert.strictEqual(p.loja, 'UNICAR');
});

test('estoque por loja: migrar duas vezes nao duplica nem zera nada', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  est.migrarLista([p], LOJAS);
  assert.strictEqual(est.qtdNaLoja(p, 'UNICAR'), 10);
  assert.strictEqual(est.totalDoPneu(p), 10);
  assert.strictEqual(Object.keys(p.estoques).sort().join(','), 'FILIAL,MATRIZ,UNICAR');
});

test('estoque por loja: entrada e saida mexem SO na loja pedida', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);

  const entrada = est.movimentar(p, 'FILIAL', 'entrada', 5);
  assert.strictEqual(entrada.ok, true);
  assert.strictEqual(est.qtdNaLoja(p, 'FILIAL'), 5);
  assert.strictEqual(est.qtdNaLoja(p, 'UNICAR'), 10, 'a outra loja nao pode mudar');
  assert.strictEqual(est.totalDoPneu(p), 15);

  const saida = est.movimentar(p, 'FILIAL', 'saida', 2);
  assert.strictEqual(saida.ok, true);
  assert.strictEqual(est.qtdNaLoja(p, 'FILIAL'), 3);
  assert.strictEqual(est.totalDoPneu(p), 13);
});

test('estoque por loja: saida maior que o saldo da loja e bloqueada (nao usa estoque das outras)', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  // UNICAR tem 10, FILIAL tem 0: tirar 1 da FILIAL nao pode "emprestar" de UNICAR
  const r = est.movimentar(p, 'FILIAL', 'saida', 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /Estoque insuficiente na loja FILIAL/);
  assert.strictEqual(est.qtdNaLoja(p, 'FILIAL'), 0);
  assert.strictEqual(est.qtdNaLoja(p, 'UNICAR'), 10);
});

test('estoque por loja: quantidade invalida e loja vazia sao recusadas', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  assert.strictEqual(est.movimentar(p, 'UNICAR', 'entrada', 0).ok, false);
  assert.strictEqual(est.movimentar(p, 'UNICAR', 'entrada', -3).ok, false);
  assert.strictEqual(est.movimentar(p, '', 'entrada', 1).ok, false);
  assert.strictEqual(est.movimentar(p, 'UNICAR', 'troca', 1).ok, false);
});

test('estoque por loja: transferencia tira de uma e poe na outra', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  const r = est.transferir(p, 'UNICAR', 'MATRIZ', 4, { confirmadoPor: 'Fulano' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(est.qtdNaLoja(p, 'UNICAR'), 6);
  assert.strictEqual(est.qtdNaLoja(p, 'MATRIZ'), 4);
  assert.strictEqual(est.totalDoPneu(p), 10, 'transferencia nao cria nem some pneu');
  assert.strictEqual(r.confirmadoPor, 'Fulano');
});

test('estoque por loja: transferencia recusa mesma loja, quantidade invalida e saldo insuficiente', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  assert.strictEqual(est.transferir(p, 'UNICAR', 'UNICAR', 1).ok, false);
  assert.strictEqual(est.transferir(p, 'UNICAR', 'FILIAL', 0).ok, false);
  const r = est.transferir(p, 'FILIAL', 'UNICAR', 1);
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /só tem 0 un/);
  assert.strictEqual(est.totalDoPneu(p), 10, 'nada muda quando a transferencia falha');
});

test('estoque por loja: definir quantidade (importacao "substituir") e por loja', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  const r = est.definirQuantidade(p, 'FILIAL', 7);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(est.qtdNaLoja(p, 'FILIAL'), 7);
  assert.strictEqual(est.qtdNaLoja(p, 'UNICAR'), 10, 'substituir em uma loja nao mexe nas outras');
  assert.strictEqual(est.totalDoPneu(p), 17);
  assert.strictEqual(p.quantidade, 17);
  assert.strictEqual(est.definirQuantidade(p, 'FILIAL', -1).ok, false);
});

test('estoque por loja: minimo e localizacao sao por loja', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  est.definirMinimo(p, 'FILIAL', 3);
  est.definirLocalizacao(p, 'FILIAL', 'Prateleira 2');
  assert.strictEqual(est.minimoNaLoja(p, 'FILIAL'), 3);
  assert.strictEqual(est.localNaLoja(p, 'FILIAL'), 'Prateleira 2');
  assert.strictEqual(est.minimoNaLoja(p, 'UNICAR'), 4, 'a loja principal mantem o minimo antigo');
  assert.strictEqual(est.localNaLoja(p, 'UNICAR'), 'Corredor A');
  // espelho antigo continua sendo o da loja principal
  assert.strictEqual(p.estoqueMinimo, 4);
  assert.strictEqual(p.localizacao, 'Corredor A');
});

test('estoque por loja: resumo lado a lado e alerta de minimo por loja', () => {
  const p = pneuAntigo();
  est.migrarLista([p], LOJAS);
  est.definirMinimo(p, 'MATRIZ', 5);
  est.movimentar(p, 'MATRIZ', 'entrada', 2);
  const resumo = est.resumoPorLoja(p, LOJAS);
  assert.deepStrictEqual(resumo.map((r) => r.loja), LOJAS);
  assert.deepStrictEqual(resumo.map((r) => r.quantidade), [10, 0, 2]);
  const baixos = est.lojasAbaixoDoMinimo(p, LOJAS).map((r) => r.loja);
  assert.deepStrictEqual(baixos, ['MATRIZ'], 'MATRIZ tem 2 e o minimo dela e 5');
});
