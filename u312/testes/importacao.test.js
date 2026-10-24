// Testes da importação de arquivos (TXT/CSV e PDF) e da prévia.
// Módulo puro: não sobe servidor. O PDF de teste é gerado aqui dentro (com zlib),
// então o teste não depende de nenhum arquivo externo.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const imp = require('../importacao');

// ---------- gerador de PDF mínimo (com texto) para o teste ----------
function pdfComTexto(linhas) {
  const conteudo = [
    'BT',
    '/F1 10 Tf',
    '12 TL',
    '40 800 Td',
    ...linhas.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`),
    'ET',
  ].join('\n');
  const comprimido = zlib.deflateSync(Buffer.from(conteudo, 'latin1'));
  const cabecalhos = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj',
    `4 0 obj<</Length ${comprimido.length}/Filter/FlateDecode>>`,
    'stream',
  ].join('\n');
  return Buffer.concat([
    Buffer.from(cabecalhos + '\n', 'latin1'),
    comprimido,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1'),
  ]);
}

test('importação TXT: tabulação, ponto e vírgula, vírgula e texto livre', () => {
  const arquivo = [
    '175/65 R14\tLONGWAY\tNOVO\t180,00\t245,00\t3',
    '185/60R15;GOODYEAR;REMOLD;210,50;310,00;2',
    '195/55/16,PIRELLI,NOVO,300,00,450,00,1',
    '175/65/14 LONGWAY R$ 245,00 qtd 3',
  ].join('\n');
  const r = imp.interpretarConteudo(arquivo);
  assert.strictEqual(r.estatisticas.itens, 4, JSON.stringify(r.revisao));
  const medidas = r.itens.map((i) => i.medida);
  assert.deepStrictEqual(medidas, ['175/65R14', '185/60R15', '195/55R16', '175/65R14']);
  const primeiro = r.itens[0];
  assert.strictEqual(primeiro.marca, 'LONGWAY');
  assert.strictEqual(primeiro.tipo, 'novo');
  assert.strictEqual(primeiro.custo, 180);
  assert.strictEqual(primeiro.preco, 245);
  assert.strictEqual(primeiro.quantidade, 3);
});

test('importação TXT: texto livre "175/65/14 LONGWAY R$ 245,00 qtd 3"', () => {
  const r = imp.interpretarLinha('175/65/14 LONGWAY R$ 245,00 qtd 3');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.strictEqual(r.medida, '175/65R14', 'medida sai sempre no mesmo formato');
  assert.strictEqual(r.marca, 'LONGWAY');
  assert.strictEqual(r.preco, 245);
  assert.strictEqual(r.quantidade, 3);
  assert.strictEqual(r.tipo, 'remoldado', 'sem a palavra NOVO entra como REMOLD (regra do dono)');
});

test('importação: variações de medida (C, ATR, polegada, caminhão) e tipo', () => {
  assert.strictEqual(imp.acharMedida('185/65R15C BRIDGESTONE NOVO').medida, '185/65R15C');
  assert.strictEqual(imp.acharMedida('195/70 R15 C GOODYEAR').medida, '195/70R15C');
  assert.strictEqual(imp.acharMedida('175/65R14 ATR REMOLD').medida, '175/65R14ATR');
  assert.strictEqual(imp.acharMedida('31x10.50R15 BFG').medida, '31X10.50R15');
  assert.strictEqual(imp.acharMedida('1000-20 PNEU NOVO').medida, '1000-20');
  assert.strictEqual(imp.acharTipo('PNEU NOVO'), 'novo');
  assert.strictEqual(imp.acharTipo('pneu remold'), 'remoldado');
  assert.strictEqual(imp.acharTipo('sem palavra'), 'remoldado');
});

test('importação: linha que não dá para entender vai para REVISÃO (não é chutada)', () => {
  const r = imp.interpretarConteudo([
    'Lote recebido do fornecedor - conferir nota',
    'Sem medida nenhuma aqui',
    '175/65R14 LONGWAY NOVO R$ 245,00 qtd 2',
  ].join('\n'));
  assert.strictEqual(r.estatisticas.itens, 1);
  assert.strictEqual(r.estatisticas.revisao, 2);
  assert.match(r.revisao[0].motivo, /medida/);
  assert.strictEqual(r.revisao[0].linha, 'Lote recebido do fornecedor - conferir nota');
});

test('importação: cabeçalho da planilha é ignorado (não vira erro de revisão)', () => {
  const r = imp.interpretarConteudo('MEDIDA;MARCA;TIPO;CUSTO;VENDA;QTD\n175/65R14;LONGWAY;NOVO;180;245;3');
  assert.strictEqual(r.estatisticas.itens, 1);
  assert.strictEqual(r.estatisticas.revisao, 0);
});

test('importação: mesma medida+marca+tipo repetida no arquivo soma a quantidade', () => {
  const r = imp.interpretarConteudo([
    '175/65R14 LONGWAY NOVO R$ 245,00 qtd 2',
    '175/65R14 LONGWAY NOVO R$ 245,00 qtd 3',
  ].join('\n'));
  assert.strictEqual(r.itens.length, 1);
  assert.strictEqual(r.itens[0].quantidade, 5);
  assert.ok(r.itens[0].avisos.some((a) => /mais de uma vez/.test(a)));
});

test('importação PDF com texto: extrai as linhas e interpreta igual ao TXT', () => {
  const pdf = pdfComTexto([
    '175/65R14 LONGWAY NOVO R$ 245,00 qtd 3',
    '185/60R15 GOODYEAR REMOLD R$ 310,00 qtd 2',
  ]);
  const texto = imp.extrairTextoPdf(pdf);
  assert.match(texto, /175\/65R14 LONGWAY/, `texto extraído: ${JSON.stringify(texto)}`);
  assert.strictEqual(imp.pareceEscaneado(texto), false);
  const r = imp.interpretarConteudo(texto);
  assert.strictEqual(r.estatisticas.itens, 2);
  assert.strictEqual(r.itens[1].marca, 'GOODYEAR');
  assert.strictEqual(r.itens[1].quantidade, 2);
});

test('importação PDF escaneado: detecta que não tem texto e avisa que precisa de OCR', async () => {
  const semTexto = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1');
  const texto = imp.extrairTextoPdf(semTexto);
  assert.strictEqual(imp.pareceEscaneado(texto), true, 'PDF só de imagem precisa ser detectado');

  const ocr = await imp.tentarOcr(semTexto);
  if (ocr.ok) {
    // Se o tesseract.js estiver instalado nesta máquina, o caminho de OCR roda de verdade.
    assert.ok(typeof ocr.texto === 'string');
    assert.ok(ocr.confianca >= 0);
  } else {
    assert.match(ocr.motivo, /OCR|escaneado/i);
    assert.ok(ocr.dica, 'sem OCR, o sistema precisa dizer como resolver');
  }
});

test('importação: medida sem perfil (185R14) e de moto (5.60-15 / 2.75-18)', () => {
  const semPerfil = imp.acharMedida('185R14 C');
  assert.ok(semPerfil, 'aceita 185R14 C');
  assert.equal(semPerfil.medida, '185R14C');

  const moto = imp.acharMedida('5.60.15');
  assert.ok(moto, 'aceita 5.60.15');
  assert.equal(moto.medida, '5.60-15');

  const moto2 = imp.acharMedida('2.75-18');
  assert.ok(moto2, 'aceita 2.75-18');
  assert.equal(moto2.medida, '2.75-18');

  // o que já funcionava continua igual
  assert.equal(imp.acharMedida('175/70/13').medida, '175/70R13');
  assert.equal(imp.acharMedida('1000-20').medida, '1000-20');
});

test('importação: prévia diz o que cria e o que atualiza, e respeita somar/substituir', () => {
  const pneus = [
    { id: 'p1', marca: 'LONGWAY', medida: '175/65R14', status: 'novo', quantidade: 10 },
  ];
  const itens = [
    { medida: '175/65R14', marca: 'LONGWAY', tipo: 'novo', quantidade: 3 },
    { medida: '185/60R15', marca: 'GOODYEAR', tipo: 'remoldado', quantidade: 2 },
  ];
  const somar = imp.montarPrevia(itens, { pneus, loja: 'UNICAR', modo: 'somar' });
  assert.strictEqual(somar.criar.length, 1);
  assert.strictEqual(somar.atualizar.length, 1);
  assert.strictEqual(somar.atualizar[0].quantidadeAntes, 10);
  assert.strictEqual(somar.atualizar[0].quantidadeDepois, 13, 'somar = 10 + 3');

  const substituir = imp.montarPrevia(itens, { pneus, loja: 'UNICAR', modo: 'substituir' });
  assert.strictEqual(substituir.atualizar[0].quantidadeDepois, 3, 'substituir = 3');
});

test('importação: separador de campos não quebra preço com vírgula decimal', () => {
  assert.deepStrictEqual(imp.dividirCampos('175/65R14,LONGWAY,NOVO,180,00,245,00,3'),
    ['175/65R14', 'LONGWAY', 'NOVO', '180,00', '245,00', '3']);
  assert.deepStrictEqual(imp.dividirCampos('a;b;c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(imp.dividirCampos('a\tb\tc'), ['a', 'b', 'c']);
  assert.strictEqual(imp.numeroBrl('R$ 1.234,56'), 1234.56);
  assert.strictEqual(imp.numeroBrl('245,00'), 245);
  assert.strictEqual(imp.numeroBrl('189'), 189);
});
