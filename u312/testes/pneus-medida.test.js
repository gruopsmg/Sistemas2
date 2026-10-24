'use strict';

// Medida de pneu digitada "do jeito que a pessoa fala" -> padrão da loja.

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizarMedida } = require('../public/pneus-medida.js');

test('aceita a medida em todos os jeitos comuns e devolve o padrão', () => {
  const esperado = '185/65R15';
  for (const entrada of ['185/65R15', '185/65 r15', '185/65/15', '185 65 15', '1856515']) {
    const r = normalizarMedida(entrada);
    assert.equal(r.ok, true, `${entrada} deveria ser aceita (${r.motivo})`);
    assert.equal(r.texto, esperado, entrada);
    assert.equal(r.largura, '185');
    assert.equal(r.perfil, '65');
    assert.equal(r.aro, '15');
  }
});

test('mantém o sufixo de carga (C) e de uso misto (ATR) separado por espaço', () => {
  assert.equal(normalizarMedida('175/70R13 C').texto, '175/70R13 C');
  assert.equal(normalizarMedida('175/70 R13 C').texto, '175/70R13 C');
  assert.equal(normalizarMedida('265/70 R16 ATR').texto, '265/70R16 ATR');
  assert.equal(normalizarMedida('195/75R16C').texto, '195/75R16 C');
});

test('aceita medida em polegadas e de caminhão', () => {
  const pol = normalizarMedida('31x10.5R15');
  assert.equal(pol.ok, true);
  assert.equal(pol.texto, '31x10.5R15');
  const cam = normalizarMedida('1000-20');
  assert.equal(cam.ok, true);
  assert.equal(cam.texto, '1000-20');
});

test('normalizar duas vezes não muda nada', () => {
  for (const entrada of ['185/65R15', '175/70R13 C', '265/70R16 ATR', '1000-20', '31x10.5R15']) {
    const uma = normalizarMedida(entrada);
    const duas = normalizarMedida(uma.texto);
    assert.equal(duas.texto, uma.texto, entrada);
  }
});

test('recusa medida incompleta ou fora do normal com motivo claro', () => {
  const semAro = normalizarMedida('185/65');
  assert.equal(semAro.ok, false);
  assert.match(semAro.motivo, /aro/i);

  const aro = normalizarMedida('185/65 R40');
  assert.equal(aro.ok, false);
  assert.match(aro.motivo, /aro/i);

  const perfil = normalizarMedida('185/10 R15');
  assert.equal(perfil.ok, false);
  assert.match(perfil.motivo, /perfil/i);

  const largura = normalizarMedida('999/65 R15');
  assert.equal(largura.ok, false);
  assert.match(largura.motivo, /largura/i);

  const texto = normalizarMedida('pneu grande');
  assert.equal(texto.ok, false);

  const vazio = normalizarMedida('');
  assert.equal(vazio.ok, false);
  assert.match(vazio.motivo, /digite/i);
});

test('não confunde aro 13 com perfil 13 nem inverte os campos', () => {
  const r = normalizarMedida('175/70/13');
  assert.equal(r.texto, '175/70R13');
  assert.equal(r.largura, '175');
  assert.equal(r.perfil, '70');
  assert.equal(r.aro, '13');
});
