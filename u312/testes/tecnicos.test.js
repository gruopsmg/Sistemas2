// Testes do cadastro de técnicos/mecânicos
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const tec = require('../tecnicos');

const ADMIN = { perfil: 'admin', nome: 'Admin', id: 'a1', loja: null };
const GER_MATRIZ = { perfil: 'gerente', nome: 'Ger', id: 'g1', loja: 'MATRIZ' };
const novoData = () => ({ lojas: [{ codigo: 'UNICAR' }, { codigo: 'MATRIZ' }, { codigo: 'FILIAL' }], os: [], tecnicos: [] });

test('admin cadastra técnico em qualquer loja ou em todas', () => {
  const data = novoData();
  const a = tec.salvar(data, { nome: '  João   Silva ', loja: 'filial', telefone: '(22) 99999-0000' }, ADMIN);
  assert.ok(!a.erro && a.criado);
  assert.strictEqual(a.tecnico.nome, 'João Silva');
  assert.strictEqual(a.tecnico.loja, 'FILIAL');
  const b = tec.salvar(data, { nome: 'Maria' }, ADMIN);
  assert.strictEqual(b.tecnico.loja, '', 'sem loja = todas');
  assert.strictEqual(data.tecnicos.length, 2);
});

test('exige nome e recusa loja inexistente', () => {
  const data = novoData();
  assert.match(tec.salvar(data, { nome: '  ' }, ADMIN).erro, /nome/i);
  assert.match(tec.salvar(data, { nome: 'X', loja: 'NAOEXISTE' }, ADMIN).erro, /Loja inválida/);
});

test('gerente só cadastra na própria loja, mesmo pedindo outra', () => {
  const data = novoData();
  const r = tec.salvar(data, { nome: 'Pedro', loja: 'FILIAL' }, GER_MATRIZ);
  assert.strictEqual(r.tecnico.loja, 'MATRIZ');
});

test('gerente não mexe em técnico de outra loja nem o enxerga', () => {
  const data = novoData();
  const feito = tec.salvar(data, { nome: 'Carlos', loja: 'FILIAL' }, ADMIN).tecnico;
  assert.strictEqual(tec.salvar(data, { id: feito.id, nome: 'Outro' }, GER_MATRIZ).status, 403);
  assert.strictEqual(tec.remover(data, feito.id, GER_MATRIZ).status, 403);
  assert.strictEqual(tec.listar(data, GER_MATRIZ).length, 0);
  assert.strictEqual(tec.listar(data, ADMIN).length, 1);
});

test('nome repetido na mesma loja é recusado (sem acento/maiúscula), em outra loja pode', () => {
  const data = novoData();
  tec.salvar(data, { nome: 'José', loja: 'MATRIZ' }, ADMIN);
  assert.match(tec.salvar(data, { nome: 'JOSE', loja: 'MATRIZ' }, ADMIN).erro, /Já existe/);
  assert.ok(!tec.salvar(data, { nome: 'José', loja: 'FILIAL' }, ADMIN).erro);
});

test('editar mantém os campos não enviados', () => {
  const data = novoData();
  const t = tec.salvar(data, { nome: 'Ana', telefone: '123', especialidade: 'alinhamento', loja: 'MATRIZ' }, ADMIN).tecnico;
  const e = tec.salvar(data, { id: t.id, especialidade: 'suspensão' }, ADMIN).tecnico;
  assert.strictEqual(e.telefone, '123');
  assert.strictEqual(e.especialidade, 'suspensão');
  assert.strictEqual(e.loja, 'MATRIZ');
});

test('técnico sem OS é apagado; com OS é só desativado', () => {
  const data = novoData();
  const livre = tec.salvar(data, { nome: 'Livre', loja: 'MATRIZ' }, ADMIN).tecnico;
  const usado = tec.salvar(data, { nome: 'Usado', loja: 'MATRIZ' }, ADMIN).tecnico;
  data.os.push({ id: 'o1', mecanicoId: usado.id });
  assert.ok(tec.remover(data, livre.id, ADMIN).apagado);
  assert.ok(tec.remover(data, usado.id, ADMIN).desativado);
  assert.strictEqual(data.tecnicos.length, 1);
  assert.strictEqual(data.tecnicos[0].ativo, false);
});

test('lista da OS: só ativos, da loja do usuário (ou de todas as lojas)', () => {
  const data = novoData();
  tec.salvar(data, { nome: 'M1', loja: 'MATRIZ' }, ADMIN);
  tec.salvar(data, { nome: 'F1', loja: 'FILIAL' }, ADMIN);
  tec.salvar(data, { nome: 'Geral' }, ADMIN);
  const off = tec.salvar(data, { nome: 'Parado', loja: 'MATRIZ' }, ADMIN).tecnico;
  tec.salvar(data, { id: off.id, ativo: false }, ADMIN);
  const nomes = (l) => l.map((t) => t.nome).sort();
  assert.deepStrictEqual(nomes(tec.paraListaDaOS(data, GER_MATRIZ, false)), ['Geral', 'M1']);
  assert.deepStrictEqual(nomes(tec.paraListaDaOS(data, ADMIN, true)), ['F1', 'Geral', 'M1']);
  assert.ok(tec.paraListaDaOS(data, ADMIN, true).every((t) => t.perfil === 'mecanico'), 'aparece no seletor da OS');
});

test('a tela tem a aba, a view e o script de técnicos', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const trecho of ['id="tabTecnicos"', 'id="view-tecnicos"', 'src="/tecnicos.js"', 'id="btnSalvarTecnico"']) {
    assert.ok(html.includes(trecho), `falta ${trecho}`);
  }
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'tecnicos.js'), 'utf8');
  for (const id of ['tecnicoNome', 'tecnicoLoja', 'tecnicosTabela', 'btnNovoTecnico']) {
    assert.ok(html.includes(`id="${id}"`), `index.html sem #${id}`);
    assert.ok(js.includes(id), `tecnicos.js não usa #${id}`);
  }
});
