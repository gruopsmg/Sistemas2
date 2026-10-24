'use strict';

// Planilha .xlsx: leitura por coluna (medida, marca, quantidade, preço) e recusas claras.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const planilha = require('../planilha');
const importacao = require('../importacao');

const pasta = path.join(__dirname, 'fixtures');
const ler = (nome) => fs.readFileSync(path.join(pasta, nome));

test('lê uma planilha simples e devolve uma linha por pneu', () => {
  const lido = planilha.paraTexto(ler('planilha-simples.xlsx'));
  assert.equal(lido.ok, true, lido.motivo);
  assert.ok(lido.rows.length >= 4, 'cabeçalho + 3 pneus');
  assert.ok(/175\/70 R13/.test(lido.texto) || /175\/70R13/.test(lido.texto));

  const tabela = importacao.interpretarTabela(lido.rows);
  assert.equal(tabela.itens.length, 3);
  const pirelli = tabela.itens.find((i) => /Pirelli/i.test(i.marca));
  assert.ok(pirelli, 'achou o Pirelli');
  assert.equal(pirelli.quantidade, 8);
  assert.equal(pirelli.preco, 289.9);
  assert.equal(pirelli.medida, '175/70R13');
});

test('lê cabeçalho com acento e nomes diferentes (Qtd, Custo, Preço de venda)', () => {
  const lido = planilha.paraTexto(ler('planilha-completa.xlsx'));
  assert.equal(lido.ok, true, lido.motivo);
  const tabela = importacao.interpretarTabela(lido.rows);

  // 185/65R15 aparece 2x -> vira 1 item com as quantidades somadas
  const bridgestone = tabela.itens.find((i) => /Bridgestone/i.test(i.marca));
  assert.ok(bridgestone, 'achou Bridgestone');
  assert.equal(bridgestone.quantidade, 5, '2 + 3');
  assert.equal(bridgestone.tipo, 'usado');
  assert.equal(bridgestone.custo, 150);
  assert.equal(bridgestone.preco, 280);

  // "320,50" e "499,90" (vírgula) precisam virar número
  const continental = tabela.itens.find((i) => /Continental/i.test(i.marca));
  assert.ok(continental, 'achou Continental');
  assert.equal(continental.custo, 320.5);
  assert.equal(continental.preco, 499.9);
  assert.equal(continental.quantidade, 6);
  assert.equal(continental.tipo, 'novo');
  assert.equal(continental.localizacao, 'P1');
  assert.equal(continental.estoqueMinimo, 2);

  // a linha sem medida vai para revisão, não para o estoque
  assert.equal(tabela.revisao.length, 1);
  assert.ok(/medida/i.test(tabela.revisao[0].motivo));
});

test('planilha sem coluna Status entra como NOVO e avisa', () => {
  const lido = planilha.paraTexto(ler('planilha-simples.xlsx'));
  const tabela = importacao.interpretarTabela(lido.rows);
  assert.ok(tabela.itens.every((i) => i.tipo === 'novo'));
  assert.ok(tabela.itens[0].avisos.some((a) => /sem coluna Status/i.test(a)));
});

test('planilha sem cabeçalho reconhecível não inventa pneu', () => {
  const lido = planilha.paraTexto(ler('planilha-sem-cabecalho.xlsx'));
  assert.equal(lido.ok, true);
  const tabela = importacao.interpretarTabela(lido.rows);
  assert.equal(tabela.itens.length, 0);
  assert.equal(tabela.semColunas, true);
});

test('recusa .xls antigo com explicação em português', () => {
  const lido = planilha.paraTexto(ler('arquivo-antigo.xls'));
  assert.equal(lido.ok, false);
  assert.ok(/xls/i.test(lido.motivo));
  assert.ok(/Salvar como/i.test(lido.motivo));
});

test('recusa arquivo que não é planilha (sem quebrar)', () => {
  const lido = planilha.paraTexto(Buffer.from('isso não é uma planilha'));
  assert.equal(lido.ok, false);
  assert.ok(lido.motivo.length > 10);
});

test('recusa .xlsx cortado/corrompido com mensagem clara', () => {
  const inteiro = ler('planilha-simples.xlsx');
  const lido = planilha.paraTexto(inteiro.slice(0, 900));
  assert.equal(lido.ok, false);
  assert.ok(/Não consegui abrir a planilha/i.test(lido.motivo));
});

test('planilha vazia é recusada', () => {
  const lido = planilha.paraTexto(Buffer.alloc(0));
  assert.equal(lido.ok, false);
});

test('CSV com cabeçalho também é lido por coluna (não por texto solto)', () => {
  const csv = '\uFEFF"Medida";"Marca";"Status";"Quantidade";"Custo";"Preco";"Localizacao";"Estoque minimo"\r\n'
    + '"175/70 R13";"Pirelli";"novo";"8";"210,00";"289,90";"P1";"4"\r\n'
    + '"185/65 R14";"Goodmark";"remoldado";"5";"150,00";"199,90";"P2";"2"';
  const linhas = importacao.linhasDeTabela(csv);
  assert.equal(importacao.temCabecalhoTabela(linhas), true);
  const tabela = importacao.interpretarTabela(linhas);
  assert.equal(tabela.itens.length, 2);
  const pirelli = tabela.itens.find((i) => /Pirelli/i.test(i.marca));
  assert.equal(pirelli.quantidade, 8);
  assert.equal(pirelli.preco, 289.9);
  assert.equal(pirelli.custo, 210);
  assert.equal(pirelli.localizacao, 'P1');
  assert.equal(pirelli.estoqueMinimo, 4);
  assert.equal(pirelli.tipo, 'novo');
  const goodmark = tabela.itens.find((i) => /Goodmark/i.test(i.marca));
  assert.equal(goodmark.tipo, 'remoldado');
});

test('texto solto (sem cabeçalho de colunas) continua indo pelo leitor antigo', () => {
  const texto = 'Pneu 175/70R13 Pirelli novo 8 R$ 289,90\nPneu 185/65R14 Goodyear novo 5 R$ 349,50';
  const linhas = importacao.linhasDeTabela(texto);
  assert.equal(importacao.temCabecalhoTabela(linhas), false);
  const leitura = importacao.interpretarConteudo(texto);
  assert.equal(leitura.itens.length, 2);
});


test('tira a imagem de dentro do PDF escaneado (é o que o OCR precisa)', () => {
  const pdf = ler('lista-escaneada.pdf');
  const img = importacao.extrairImagemDoPdf(pdf);
  assert.equal(img.ok, true, img.motivo);
  assert.equal(img.mime, 'image/jpeg');
  assert.equal(img.largura, 1200);
  assert.equal(img.altura, 700);
  assert.ok(img.dados.length > 1000);
  // começa com o marcador de JPEG
  assert.equal(img.dados[0], 0xff);
  assert.equal(img.dados[1], 0xd8);
});

test('PDF sem imagem devolve motivo claro (sem quebrar)', () => {
  const semImagem = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF');
  const img = importacao.extrairImagemDoPdf(semImagem);
  assert.equal(img.ok, false);
  assert.ok(/imagem/i.test(img.motivo));
  assert.ok(/escaneado/i.test(img.motivo));
});

test('quantidade sai certa na linha de lista lida por OCR', () => {
  const linha = '175/70 R13 PIRELLI NOVO 8 R$ 289,90';
  assert.equal(importacao.acharQuantidade(linha, '175/70R13'), 8);
  const l2 = '185/65 R14 GOODYEAR NOVO 5 R$ 349,50';
  assert.equal(importacao.acharQuantidade(l2, '185/65R14'), 5);
  // sem ambiguidade: dois números soltos → não inventa
  assert.equal(importacao.acharQuantidade('175/70 R13 PIRELLI 8 9 R$ 289,90', '175/70R13'), null);
});

test('prévia com planilha separa criar e atualizar pelo estoque existente', () => {
  const lido = planilha.paraTexto(ler('planilha-simples.xlsx'));
  const tabela = importacao.interpretarTabela(lido.rows);
  const pneus = [{ id: 'a', medida: '175/70R13', marca: 'Pirelli', status: 'novo', quantidade: 4 }];
  const previa = importacao.montarPrevia(tabela.itens, { pneus, loja: 'UNICAR', modo: 'somar' });
  assert.equal(previa.atualizar.length, 1);
  assert.equal(previa.atualizar[0].quantidadeAntes, 4);
  assert.equal(previa.atualizar[0].quantidadeDepois, 12);
  assert.equal(previa.criar.length, 2);
});
