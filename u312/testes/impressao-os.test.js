// Testes da impressao da OS em duas vias (uma folha A4: cliente em cima, loja embaixo)
const test = require('node:test');
const assert = require('node:assert');
const { htmlImpressao, GARANTIA_PADRAO, PRAZO_PADRAO, paginar, CAPACIDADE } = require('../impressao-os');

const LOJA = {
  codigo: 'MATRIZ', nome: 'UNICAR MATRIZ',
  endereco: 'Rua das Palmeiras, 120 - Centro - Sao Pedro da Aldeia/RJ',
  telefone: '(22) 99888-7766', cnpj: '12.345.678/0001-90',
};

function osDeTeste(quantosItens) {
  const itens = Array.from({ length: quantosItens }, (_, i) => ({
    descricao: `Pneu 175/65 R14 marca${i + 1}`,
    quantidade: 1, valorUnitario: 245.9, total: 245.9, tipo: 'pneu',
    marca: `marca${i + 1}`, medida: '175/65 R14',
    precoCusto: 150.0, // NAO pode aparecer na impressao
  }));
  return {
    id: 'x1', numero: 'OS-UNICAR-000007', loja: 'MATRIZ', status: 'aberta',
    cliente: { nome: 'Cliente do Teste', telefone: '(22) 99999-1111' },
    veiculo: { placa: 'ABC1D23', marca: 'Fiat', modelo: 'Argo', ano: '2020', km: '48000' },
    itens,
    total: itens.reduce((s, i) => s + i.total, 0),
    condicoesPagamento: '3x no cartao',
    defeito: 'Puxando para a direita na estrada',
    observacoesCliente: 'Cliente pediu para conferir o estepe.',
    responsavel: { nome: 'Uiliam' },
    aberturaEm: new Date('2026-10-21T13:40:00Z').getTime(),
  };
}

test('uma folha A4 com as duas vias e a linha de corte no meio', () => {
  const html = htmlImpressao(osDeTeste(3), LOJA);
  assert.match(html, /@page \{ size: A4 portrait/);
  assert.match(html, /\.folha \{[^}]*height: 289mm/, 'a folha ocupa a altura util da A4');
  assert.match(html, /\.via \{ height: 140mm/, 'cada via tem a metade da folha');
  assert.match(html, /\.corte \{ height: 7mm/, 'faixa de corte entre as vias');
  assert.strictEqual((html.match(/class="via via-cliente/g) || []).length, 1, 'uma via do cliente');
  assert.strictEqual((html.match(/class="via via-loja/g) || []).length, 1, 'uma via da loja');
  assert.match(html, /VIA DO CLIENTE/);
  assert.match(html, /VIA DA LOJA/);
  assert.match(html, /&#9986; Recorte aqui/, 'tesoura + Recorte aqui');
  // cliente acima da loja, corte no meio
  const posCliente = html.indexOf('via via-cliente');
  const posCorte = html.indexOf('class="corte"');
  const posLoja = html.indexOf('via via-loja');
  assert.ok(posCliente < posCorte && posCorte < posLoja, 'ordem: cliente, corte, loja');
  assert.match(html, /page-break-after: always/, 'quebra de pagina controlada');
});

test('as duas metades trazem os mesmos dados da OS', () => {
  const html = htmlImpressao(osDeTeste(4), LOJA);
  const vias = html.split('class="via via-');
  for (const dado of ['Cliente do Teste', 'ABC1D23', 'OS-UNICAR-000007', '3x no cartao',
    'R\\$ 983,60', 'Puxando para a direita', 'Uiliam', '48000']) {
    assert.ok(vias[1].includes(dado.replace(/\\/g, '')), `via do cliente sem "${dado}"`);
    assert.ok(vias[2].includes(dado.replace(/\\/g, '')), `via da loja sem "${dado}"`);
  }
});

test('timbrado grande no meio de CADA via (logo da loja)', () => {
  const html = htmlImpressao(osDeTeste(2), LOJA);
  assert.strictEqual((html.match(/class="timbrado"/g) || []).length, 2, 'uma marca d\'água por via');
  assert.ok(html.includes('/logos/marca_agua_MATRIZ.png'), 'timbrado da loja certa');
  assert.match(html, /\.timbrado \{ position: absolute[^}]*z-index: 0/, 'timbrado atrás do texto');
  assert.match(html, /\.timbrado img \{[^}]*width: 62%/, 'timbrado grande (62% da via)');
  assert.match(html, /\.timbrado img \{[^}]*opacity: \.12/, 'timbrado bem claro para não atrapalhar a leitura');
  assert.match(html, /\.timbrado img \{[^}]*grayscale\(1\)/, 'timbrado em escala de cinza (não briga com a cor da loja)');
  assert.match(html, /\.via > \.cab[^{]*\{[^}]*z-index: 1/, 'conteúdo na frente do timbrado');
});

test('cada loja usa a SUA cor (não é tudo vermelho)', () => {
  const matriz = htmlImpressao(osDeTeste(1), { ...LOJA, cor: '' });
  assert.ok(matriz.includes('--acento:#e39012'), 'MATRIZ usa o laranja da logo');
  const filial = htmlImpressao(osDeTeste(1), { codigo: 'FILIAL', nome: 'FILIAL' });
  assert.ok(filial.includes('--acento:#a5182f'), 'FILIAL usa o vinho da logo');
  const unicar = htmlImpressao(osDeTeste(1), { codigo: 'UNICAR', nome: 'UNICAR' });
  assert.ok(unicar.includes('--acento:#d02b2b'), 'UNICAR usa o vermelho da logo');
  // a cor configurada pela loja manda (troca sem mexer em código)
  const trocada = htmlImpressao(osDeTeste(1), { ...LOJA, cor: '#1e7f4f' });
  assert.ok(trocada.includes('--acento:#1e7f4f'));
  assert.ok(!trocada.includes('--acento:#e39012'), 'a cor configurada substitui a padrão');
  // os acentos que usam a cor
  assert.match(trocada, /\.etiqueta \{[^}]*background: var\(--acento\)/, 'faixa da via na cor da loja');
  assert.match(trocada, /\.titulo-doc \{[^}]*color: var\(--acento\)/, 'título na cor da loja');
  assert.match(trocada, /\.valores \.total \{[^}]*border: \.5mm solid var\(--acento\)/, 'total na cor da loja');
});

test('cabecalho usa logo e dados da loja da OS', () => {
  const html = htmlImpressao(osDeTeste(2), LOJA);
  assert.ok(html.includes('/logos/loja_MATRIZ_logo.webp'), 'logo da loja certa');
  assert.ok(!html.includes('loja_UNICAR_logo'), 'nao pode vazar logo de outra loja');
  assert.match(html, /CNPJ 12\.345\.678\/0001-90/);
  assert.match(html, /\(22\) 99888-7766/);
  assert.match(html, /Rua das Palmeiras/);
  assert.match(html, /ORDEM DE SERVIÇO/);
});

test('assinaturas mudam conforme a via', () => {
  const html = htmlImpressao(osDeTeste(1), LOJA);
  const cliente = html.split('class="via via-')[1];
  const loja = html.split('class="via via-')[2];
  assert.match(cliente, /Assinatura da loja/);
  assert.doesNotMatch(cliente, /Assinatura do cliente/);
  assert.match(loja, /Assinatura do cliente \(de acordo\)/);
  assert.match(html, /Data de entrega prevista/);
});

test('nao mostra custo, lucro nem margem', () => {
  const html = htmlImpressao(osDeTeste(3), LOJA);
  assert.doesNotMatch(html, /precoCusto/i);
  assert.doesNotMatch(html, /custo/i);
  assert.doesNotMatch(html, /lucro|margem/i);
  assert.doesNotMatch(html, /150,00/, 'o custo do item nao pode vazar');
});

test('1 item e 10 itens cabem em uma unica folha', () => {
  const um = htmlImpressao(osDeTeste(1), LOJA);
  const dez = htmlImpressao(osDeTeste(10), LOJA);
  assert.strictEqual((um.match(/class="folha"/g) || []).length, 1);
  assert.strictEqual((dez.match(/class="folha"/g) || []).length, 1);
  assert.strictEqual((dez.match(/class="via via-cliente/g) || []).length, 1, '10 itens nao podem quebrar a via');
  assert.match(dez, /via-cliente compacto/, '10 itens usa o modo compacto');
});

test('8 itens fica normal, 9 entra no compacto', () => {
  assert.strictEqual(paginar(new Array(8).fill({}), 1).compacto, false);
  assert.strictEqual(paginar(new Array(9).fill({}), 1).compacto, true);
  assert.strictEqual((htmlImpressao(osDeTeste(8), LOJA).match(/class="via via-cliente(?! compacto)/g) || []).length, 1);
});

test('muitos itens paginam em folhas com Folha 1/3 e mantem cliente/loja em cada folha', () => {
  const html = htmlImpressao(osDeTeste(25), LOJA);
  const folhas = html.match(/class="folha"/g) || [];
  assert.strictEqual(folhas.length, 3, `25 itens deveriam dar 3 folhas (deu ${folhas.length})`);
  assert.strictEqual((html.match(/class="via via-cliente/g) || []).length, 3);
  assert.strictEqual((html.match(/class="via via-loja/g) || []).length, 3);
  assert.match(html, /Folha 1\/3/);
  assert.match(html, /Folha 3\/3/);
  assert.match(html, /Subtotal da folha/);
});

test('opcoes: so via do cliente, so via da loja (sem linha de corte)', () => {
  const soCliente = htmlImpressao(osDeTeste(3), LOJA, { via: 'cliente' });
  assert.strictEqual((soCliente.match(/class="via via-cliente/g) || []).length, 1);
  assert.strictEqual((soCliente.match(/class="via via-loja/g) || []).length, 0);
  assert.strictEqual((soCliente.match(/class="corte"/g) || []).length, 0);

  const soLoja = htmlImpressao(osDeTeste(3), LOJA, { via: 'loja' });
  assert.strictEqual((soLoja.match(/class="via via-cliente/g) || []).length, 0);
  assert.strictEqual((soLoja.match(/class="via via-loja/g) || []).length, 1);

  // o seletor das tres opcoes existe na tela de impressao
  assert.match(soLoja, /Duas vias na mesma folha/);
  assert.match(soLoja, /S[oó] via do cliente/);
  assert.match(soLoja, /S[oó] via da loja/);
  assert.match(soLoja, /Salvar em PDF/);
});

test('garantia e prazo vem da configuracao, com padrao seguro', () => {
  const padrao = htmlImpressao(osDeTeste(1), LOJA);
  assert.ok(padrao.includes(GARANTIA_PADRAO.slice(0, 40)));
  assert.ok(padrao.includes(PRAZO_PADRAO.slice(0, 30)));

  const proprio = htmlImpressao(osDeTeste(1), LOJA, {
    config: { garantia: 'Garantia da casa: 6 meses no servico.', prazo: 'Retirar em ate 2 dias uteis.' },
  });
  assert.match(proprio, /Garantia da casa: 6 meses no servico\./);
  assert.match(proprio, /Retirar em ate 2 dias uteis\./);
});

test('modelo em branco: sem numero, sem dados e com linhas para preencher', () => {
  const vazio = { numero: '', loja: 'MATRIZ', status: '', cliente: {}, veiculo: {}, itens: [], total: null, responsavel: {} };
  const html = htmlImpressao(vazio, LOJA, { modelo: true });
  assert.match(html, /Nº <span class="vazio"><\/span>/);
  assert.doesNotMatch(html, /Cliente do Teste/);
  assert.doesNotMatch(html, /OS-UNICAR/);
  assert.strictEqual((html.match(/<tr class="vazia"><td class="c">\d+<\/td><td><\/td>/g) || []).length, 20,
    'modelo traz 10 linhas em branco em cada via');
});

test('capacidade oficial: 8 normais, 10 compactos, 12 por folha extra', () => {
  assert.strictEqual(CAPACIDADE.normal, 8);
  assert.strictEqual(CAPACIDADE.compacto, 10);
  assert.strictEqual(CAPACIDADE.compactoMax, 12);
  assert.strictEqual((htmlImpressao(osDeTeste(12), LOJA).match(/class="folha"/g) || []).length, 1);
  assert.strictEqual((htmlImpressao(osDeTeste(13), LOJA).match(/class="folha"/g) || []).length, 2);
});

test('escapa HTML vindo do cliente (sem quebrar o documento)', () => {
  const os = osDeTeste(1);
  os.cliente.nome = '<script>alert(1)</script>';
  os.defeito = 'barulho <b>estranho</b>';
  const html = htmlImpressao(os, LOJA);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
