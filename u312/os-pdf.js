// UNICAR - Ordem de Serviço em PDF (versão DIGITAL, para enviar pelo WhatsApp)
// ---------------------------------------------------------------------------
// Uma folha A4, uma via só (não é a folha de corte), preto e branco com a cor da loja.
// Usa pdfkit (JavaScript puro: roda no Windows sem instalar nada além do npm ci).
// As logos em public/logos/pdf/*.png existem porque o pdfkit NÃO lê .webp.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { marcaDaLoja } = require('./marcas');
const { rotuloPagamento } = require('./pagamento');

const STATUS_ROTULO = {
  aberta: 'Aberta', 'em andamento': 'Em andamento', concluida: 'Concluída',
  entregue: 'Entregue', cancelada: 'Cancelada', orcamento: 'Orçamento',
};

const GARANTIA_PADRAO = 'Garantia de 90 dias para o serviço executado e para os pneus montados, contra defeito '
  + 'de fabricação. Não cobre mau uso, impacto, perfuração, desgaste irregular ou serviço executado por terceiros.';
const PRAZO_PADRAO = 'Entrega na data prevista. A loja avisa por telefone/WhatsApp quando o veículo estiver pronto.';

function numero(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function brl(v) {
  const n = numero(v);
  if (!v && v !== 0) return '';
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}
function dataBR(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function horaBR(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// hex -> [r,g,b] para o pdfkit
function cor(hex, padrao = [176, 24, 27]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return padrao;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function logoPng(codigoLoja) {
  const arquivo = path.join(__dirname, 'public', 'logos', 'pdf', `loja_${String(codigoLoja || '').toUpperCase()}.png`);
  return fs.existsSync(arquivo) ? arquivo : null;
}

// Gera o PDF e devolve um Buffer (nada é gravado em disco).
function gerarPDF(os, loja, opcoes = {}) {
  const config = {
    garantia: (opcoes.config && opcoes.config.garantia) || GARANTIA_PADRAO,
    prazo: (opcoes.config && opcoes.config.prazo) || PRAZO_PADRAO,
  };
  const marca = marcaDaLoja(loja.codigo);
  const acento = cor((loja && loja.cor) || marca.cor);
  const cliente = os.cliente || {};
  const veiculo = os.veiculo || {};
  const itens = Array.isArray(os.itens) ? os.itens : [];
  const documentoLoja = [loja.cnpj ? `CNPJ ${loja.cnpj}` : '', loja.telefone || '', loja.endereco || '']
    .filter(Boolean).join('  ·  ') || (marca.subtitulo || '');

  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 36, left: 40, right: 40 }, info: {
    Title: `Ordem de Serviço ${os.numero || ''}`.trim(),
    Author: loja.nome || marca.titulo || 'UNICAR',
    Subject: 'Ordem de Serviço',
  } });
  const pedacos = [];
  doc.on('data', (d) => pedacos.push(d));
  const pronto = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const esquerda = doc.page.margins.left;
  let y = doc.page.margins.top;

  // ---------- cabeçalho ----------
  const logo = logoPng(loja.codigo);
  if (logo) {
    try { doc.image(logo, esquerda, y, { fit: [56, 56] }); } catch (e) { /* logo inválida não derruba o PDF */ }
  }
  const textoX = logo ? esquerda + 64 : esquerda;
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(15)
    .text((loja.nome || marca.titulo || 'UNICAR').toUpperCase(), textoX, y, { width: largura - (textoX - esquerda) - 150 });
  doc.font('Helvetica').fontSize(8).fillColor('#555555')
    .text(documentoLoja, textoX, doc.y + 2, { width: largura - (textoX - esquerda) - 150 });

  // bloco do documento (direita)
  const dirX = esquerda + largura - 150;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(acento)
    .text('ORDEM DE SERVIÇO', dirX, y, { width: 150, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111')
    .text(os.numero || '—', dirX, y + 15, { width: 150, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#555555')
    .text(`${dataBR(os.aberturaEm)} ${horaBR(os.aberturaEm)}${os.status ? ` · ${STATUS_ROTULO[os.status] || os.status}` : ''}`,
      dirX, y + 31, { width: 150, align: 'right' });

  y = Math.max(doc.y, y + 58) + 6;
  doc.moveTo(esquerda, y).lineTo(esquerda + largura, y).lineWidth(1.6).strokeColor(acento).stroke();
  y += 10;

  // ---------- cliente / veículo ----------
  const campo = (rotulo, valor, x, larguraCampo, altura = 26) => {
    doc.roundedRect(x, y, larguraCampo, altura, 3).lineWidth(0.5).strokeColor('#cccccc').stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor('#777777').text(rotulo.toUpperCase(), x + 5, y + 4, { width: larguraCampo - 10 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111')
      .text(String(valor || '—'), x + 5, y + 12, { width: larguraCampo - 10, ellipsis: true, lineBreak: false });
  };
  const g = 6;
  const col = (fracao) => (largura - g * 5) * fracao;
  campo('Cliente', cliente.nome, esquerda, col(0.42));
  campo('Telefone', cliente.telefone || cliente.whatsapp, esquerda + col(0.42) + g, col(0.22));
  campo('Placa', veiculo.placa, esquerda + col(0.64) + g * 2, col(0.14));
  campo('KM', veiculo.km, esquerda + col(0.78) + g * 3, col(0.10));
  campo('Atendente', os.responsavel && os.responsavel.nome, esquerda + col(0.88) + g * 4, col(0.12));
  y += 32;
  campo('Veículo', [veiculo.marca, veiculo.modelo, veiculo.ano].filter(Boolean).join(' '), esquerda, col(0.58));
  campo('Defeito relatado', os.defeito || '—', esquerda + col(0.58) + g, col(0.42));
  y += 36;

  // ---------- tabela de itens ----------
  const colunas = [
    { titulo: '#', largura: 18, alinhamento: 'left' },
    { titulo: 'Descrição dos serviços e peças', largura: largura - 18 - 40 - 78 - 78, alinhamento: 'left' },
    { titulo: 'Qtd', largura: 40, alinhamento: 'right' },
    { titulo: 'Valor unit.', largura: 78, alinhamento: 'right' },
    { titulo: 'Total', largura: 78, alinhamento: 'right' },
  ];
  doc.rect(esquerda, y, largura, 16).fillColor('#f2f2f2').fill();
  let x = esquerda;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#333333');
  for (const c of colunas) {
    doc.text(c.titulo.toUpperCase(), x + 4, y + 5, { width: c.largura - 8, align: c.alinhamento });
    x += c.largura;
  }
  y += 16;
  doc.font('Helvetica').fontSize(9);
  for (let i = 0; i < Math.max(itens.length, 3); i += 1) {
    const item = itens[i];
    const alturaLinha = 17;
    if (y + alturaLinha > doc.page.height - 190) { doc.addPage(); y = doc.page.margins.top; }
    if (i % 2 === 1) doc.rect(esquerda, y, largura, alturaLinha).fillColor('#fafafa').fill();
    doc.moveTo(esquerda, y + alturaLinha).lineTo(esquerda + largura, y + alturaLinha).lineWidth(0.3).strokeColor('#dddddd').stroke();
    x = esquerda;
    const valores = item ? [
      String(i + 1),
      item.descricao || '',
      numero(item.quantidade) ? String(numero(item.quantidade)) : '',
      brl(item.valorUnitario),
      brl(item.total),
    ] : [String(i + 1), '', '', '', ''];
    doc.font('Helvetica').fontSize(9).fillColor('#111111');
    for (let c = 0; c < colunas.length; c += 1) {
      doc.text(valores[c], x + 4, y + 5, { width: colunas[c].largura - 8, align: colunas[c].alinhamento, ellipsis: true, lineBreak: false });
      x += colunas[c].largura;
    }
    y += alturaLinha;
  }
  y += 12;

  // ---------- totais e pagamento ----------
  const caixaTotal = { x: esquerda + largura - 170, largura: 170 };
  doc.font('Helvetica').fontSize(8.5).fillColor('#555555')
    .text('Forma de pagamento', esquerda, y, { width: largura - 190 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111111')
    .text(rotuloPagamento(os) || '—', esquerda, y + 11, { width: largura - 190, height: 30, ellipsis: true });
  doc.roundedRect(caixaTotal.x, y - 2, caixaTotal.largura, 34, 4).lineWidth(1.2).strokeColor(acento).stroke();
  doc.font('Helvetica').fontSize(7).fillColor('#777777').text('TOTAL GERAL', caixaTotal.x + 8, y + 4);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(acento)
    .text(brl(os.total) || 'R$ 0,00', caixaTotal.x + 8, y + 12, { width: caixaTotal.largura - 16, align: 'right' });
  y += 44;

  // ---------- observações, garantia, prazo ----------
  const escreve = (rotulo, texto) => {
    if (!texto) return;
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#777777').text(rotulo.toUpperCase(), esquerda, y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#222222').text(texto, esquerda, y + 9, { width: largura, lineGap: 1 });
    y = doc.y + 6;
  };
  escreve('Observações', os.observacoesCliente);
  escreve('Garantia', config.garantia);
  escreve('Prazo de entrega', config.prazo);

  // ---------- rodapé ----------
  const rodapeY = doc.page.height - 72;
  doc.moveTo(esquerda, rodapeY).lineTo(esquerda + largura, rodapeY).lineWidth(0.5).strokeColor('#dddddd').stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor('#777777')
    .text(`${loja.nome || ''}  ·  ${loja.telefone || ''}`, esquerda, rodapeY + 8, { width: largura, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(7).fillColor('#999999')
    .text(`OS ${os.numero || ''} · documento digital gerado pelo sistema Unicar · ${dataBR(Date.now())}`,
      esquerda, rodapeY + 22, { width: largura, align: 'center', lineBreak: false });

  doc.end();
  return pronto;
}

// Texto que acompanha o PDF no WhatsApp
function mensagemDaOS(os, loja) {
  const cliente = (os.cliente && os.cliente.nome) || '';
  const primeiro = String(cliente).split(' ')[0] || 'cliente';
  const nomeLoja = (loja && (loja.nome || loja.codigo)) || 'Unicar';
  const total = os.total ? ` no valor de ${brl(os.total)}` : '';
  return `Olá, ${primeiro}! Sua Ordem de Serviço ${os.numero || ''} da ${nomeLoja}${total} está aqui em PDF.`
    + ' Qualquer dúvida é só chamar nesta conversa.';
}

// nome do arquivo: OS-UNICAR-000007.pdf (sem acento e sem espaço)
function nomeArquivo(os) {
  const base = String(os.numero || 'OS').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${base}.pdf`;
}

module.exports = { gerarPDF, mensagemDaOS, nomeArquivo, GARANTIA_PADRAO, PRAZO_PADRAO };
