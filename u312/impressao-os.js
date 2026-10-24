// UNICAR - Impressao da Ordem de Servico em DUAS VIAS (uma folha A4)
// ---------------------------------------------------------------------------
// Pedido do dono (21/10):
//   * UMA folha A4 retrato dividida ao meio: em cima VIA DO CLIENTE, embaixo VIA DA LOJA;
//   * no meio, linha tracejada com tesoura e "Recorte aqui";
//   * cada via cabe inteira na sua metade (~148 mm), sem cortar conteudo;
//   * 8 a 10 linhas de itens; passando disso entra o modo compacto e, se ainda nao couber,
//     sai em mais de uma folha mantendo sempre cliente em cima / loja embaixo, com "Folha x/y";
//   * opcoes antes de imprimir: duas vias (padrao), so via do cliente, so via da loja e PDF;
//   * preto e branco com poucos acentos; nada de custo, lucro ou margem.
// A logo, o nome e os dados (endereco/telefone/CNPJ) vem da loja da OS; o texto de garantia
// e prazo vem de Configuracoes (data.impressao) com um padrao seguro.
// ---------------------------------------------------------------------------

const { marcaDaLoja } = require('./marcas');
const { rotuloPagamento } = require('./pagamento');

const GARANTIA_PADRAO = 'Garantia de 90 dias para o serviço executado e para os pneus montados, contra defeito de fabricação. '
  + 'Não cobre mau uso, impacto, perfuração, desgaste irregular ou serviço executado por terceiros.';
const PRAZO_PADRAO = 'Entrega na data prevista acima. A loja avisa por telefone/WhatsApp assim que o veículo estiver pronto.';

// Capacidade de cada via (em linhas de itens)
const CAPACIDADE = { normal: 8, compacto: 10, compactoMax: 12 };

const SERVICOS_MODELO = [
  'Troca de oleo', 'Alinhamento', 'Balanceamento', 'Cambagem / caster',
  'Montagem de pneu', 'Desmontagem', 'Reparo de pneu', 'Calibragem',
  'Higienizacao do ar', 'Revisao de freios', 'Suspensao', 'Outros',
];

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function numero(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function brl(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = numero(v);
  if (!n) return '';
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

const STATUS_ROTULO_LOCAL = {
  aberta: 'Aberta', 'em andamento': 'Em andamento', concluida: 'Concluída',
  entregue: 'Entregue', cancelada: 'Cancelada', orcamento: 'Orçamento',
};

// ---------------------------------------------------------------------------
// Paginacao: quantas folhas e quais itens em cada uma
// ---------------------------------------------------------------------------
function paginar(itens, pedacos) {
  const total = itens.length;
  if (pedacos && pedacos > 1) {
    const porFolha = CAPACIDADE.compactoMax;
    const folhas = [];
    for (let i = 0; i < total; i += porFolha) folhas.push(itens.slice(i, i + porFolha));
    return { folhas, compacto: true };
  }
  return { folhas: [itens], compacto: total > CAPACIDADE.normal };
}

// ---------------------------------------------------------------------------
// Uma via (metade da folha)
// ---------------------------------------------------------------------------
function viaHTML(ctx) {
  const { os, loja, tipo, itens, compacto, folha, totalFolhas, inicioItem, totalItens, modelo, config, extras } = ctx;
  const cliente = os.cliente || {};
  const veiculo = os.veiculo || {};
  const marca = marcaDaLoja(loja.codigo);
  const nomeLoja = (loja && loja.nome) || loja.codigo;
  const numeroOS = modelo ? '' : (os.numero || '');
  const etiqueta = tipo === 'cliente' ? 'VIA DO CLIENTE' : 'VIA DA LOJA';
  const assinaturaDe = tipo === 'cliente' ? 'Assinatura da loja' : 'Assinatura do cliente (de acordo)';
  const status = modelo ? '' : (STATUS_ROTULO_LOCAL[os.status] || os.status || '');
  const documentoLoja = [loja.cnpj ? `CNPJ ${loja.cnpj}` : '', loja.telefone || '', loja.endereco || ''].filter(Boolean);
  // cor da loja: a da logomarca (marcas.js), com a possibilidade de o dono trocar em Configurações
  const cor = String((loja && loja.cor) || marca.cor || '#b3121b');
  const timbrado = marca.marcaDagua || marca.logo || '';

  const linhas = itens.map((item, i) => {
    const detalhe = [item.marca, item.medida].filter(Boolean).join(' ');
    const jaTem = detalhe && String(item.descricao || '').toLowerCase()
      .includes(String(item.medida || '').toLowerCase());
    return `<tr>
      <td class="c">${inicioItem + i + 1}</td>
      <td>${esc(item.descricao)}${detalhe && !jaTem ? ` <span class="det">(${esc(detalhe)})</span>` : ''}</td>
      <td class="c">${numero(item.quantidade) || ''}</td>
      <td class="r">${brl(item.valorUnitario) || ''}</td>
      <td class="r">${brl(item.total) || ''}</td>
    </tr>`;
  }).join('');

  // no modelo em branco, o cliente preenche a mao
  // completa ate 10 linhas: sobra espaco para escrever a mao e a via nao fica com buraco no meio
  const MINIMO_LINHAS = 10;
  const quantasVazias = Math.max(0, MINIMO_LINHAS - itens.length);
  const vazias = Array.from({ length: quantasVazias }, (_, i) => {
    const n = inicioItem + itens.length + i + 1;
    return `<tr class="vazia"><td class="c">${n}</td><td></td><td></td><td></td><td></td></tr>`;
  }).join('');

  const totalGeral = modelo ? '' : (brl(os.total) || '');
  const rodapeFolha = totalFolhas > 1
    ? `<span class="folha-num">Folha ${folha}/${totalFolhas}</span>` : '';

  return `<section class="via via-${tipo}${compacto ? ' compacto' : ''}" style="--acento:${esc(cor)}">
  ${timbrado ? `<div class="timbrado" aria-hidden="true"><img src="${esc(timbrado)}" alt=""></div>` : ''}
  <header class="cab">
    <div class="loja">
      ${marca.logo ? `<img class="logo" src="${esc(marca.logo)}" alt="Logo ${esc(nomeLoja)}">` : `<div class="logo-txt">${esc(marca.titulo || nomeLoja)}</div>`}
      <div class="loja-dados">
        <div class="loja-nome">${esc(nomeLoja)}</div>
        <div class="loja-linha">${esc(documentoLoja.join(' · ')) || esc(marca.subtitulo || '')}</div>
      </div>
    </div>
    <div class="doc">
      <div class="titulo-doc">ORDEM DE SERVIÇO</div>
      <div class="numero">${numeroOS ? `Nº <b>${esc(numeroOS)}</b>` : 'Nº <span class="vazio"></span>'}</div>
      <div class="quando">${modelo ? 'Data ___/___/______' : `${dataBR(os.aberturaEm)} ${horaBR(os.aberturaEm)}`}${status ? ` · ${esc(status)}` : ''}</div>
    </div>
    <div class="etiqueta">${etiqueta}${rodapeFolha}</div>
  </header>

  <div class="linha-campos">
    <div class="campo w-cliente"><span class="rot">Cliente</span><span class="val">${esc(cliente.nome)}</span></div>
    <div class="campo w-fone"><span class="rot">Telefone</span><span class="val">${esc(cliente.telefone || cliente.whatsapp)}</span></div>
    <div class="campo w-placa"><span class="rot">Placa</span><span class="val">${esc(veiculo.placa)}</span></div>
    <div class="campo w-veic"><span class="rot">Veículo</span><span class="val">${esc([veiculo.marca, veiculo.modelo, veiculo.ano].filter(Boolean).join(' '))}</span></div>
    <div class="campo w-km"><span class="rot">KM</span><span class="val">${esc(veiculo.km)}</span></div>
    <div class="campo w-atend"><span class="rot">Atendente</span><span class="val">${esc((os.responsavel && os.responsavel.nome) || '')}</span></div>
  </div>

  <div class="tabela-wrap"><table class="itens">
    <thead><tr>
      <th class="c" style="width:6%">#</th><th>Descrição dos serviços e peças</th>
      <th class="c" style="width:8%">Qtd</th><th class="r" style="width:17%">Valor unit.</th><th class="r" style="width:17%">Total</th>
    </tr></thead>
    <tbody>${linhas}${vazias}</tbody>
  </table></div>

  <div class="fechamento">
    <div class="obs">
      ${os.defeito ? `<div class="bloco"><span class="rot">Defeito relatado</span><span class="txt">${esc(os.defeito)}</span></div>` : ''}
      ${os.observacoesCliente ? `<div class="bloco"><span class="rot">Observações</span><span class="txt">${esc(os.observacoesCliente)}</span></div>` : ''}
      ${!os.defeito && !os.observacoesCliente ? '<div class="bloco"><span class="rot">Defeito relatado / observações</span><span class="txt vago">—</span></div>' : ''}
    </div>
    <div class="valores">
      <div class="par pagto"><span>Forma de pagamento</span><b>${esc(rotuloPagamento(os)) || '&nbsp;'}</b></div>
      ${totalFolhaHTML(ctx)}
      <div class="par total"><span>Total geral</span><b>${totalGeral || 'R$ ____,__'}</b></div>
    </div>
  </div>

  <div class="garantia">
    <b>Garantia:</b> ${esc(config.garantia)}<br>
    <b>Prazo:</b> ${esc(config.prazo)}${extras.entregaPrevista ? ` &nbsp;·&nbsp; <b>Entrega prevista:</b> ${esc(extras.entregaPrevista)}` : ''}
  </div>

  <footer class="assinaturas">
    <div class="assinatura"><div class="risco"></div><span>${assinaturaDe}</span></div>
    <div class="assinatura entrega"><div class="risco"></div><span>Data de entrega prevista</span></div>
  </footer>
</section>`;
}

function totalFolhaHTML(ctx) {
  if (!(ctx.totalFolhas > 1)) return '';
  const soma = ctx.itens.reduce((s, i) => s + numero(i.total), 0);
  return `<div class="par"><span>Subtotal da folha · ${ctx.itens.length} it.</span><b>${brl(soma) || 'R$ 0,00'}</b></div>`;
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------
function htmlImpressao(os, loja, opcoes = {}) {
  const modelo = !!opcoes.modelo;
  const config = {
    garantia: (opcoes.config && opcoes.config.garantia) || GARANTIA_PADRAO,
    prazo: (opcoes.config && opcoes.config.prazo) || PRAZO_PADRAO,
  };
  const itens = Array.isArray(os.itens) ? os.itens : [];
  const totalItens = itens.length;
  const pedacos = totalItens > CAPACIDADE.compacto ? Math.ceil(totalItens / CAPACIDADE.compactoMax) : 1;
  const { folhas, compacto } = paginar(itens, pedacos);
  const via = opcoes.via === 'cliente' || opcoes.via === 'loja' ? opcoes.via : 'duas';
  const nomeLoja = (loja && loja.nome) || (loja && loja.codigo) || '';
  const numeroOS = modelo ? 'Modelo' : esc(os.numero || '');

  const entregaPrevista = os.entregaPrevistaEm ? dataBR(os.entregaPrevistaEm)
    : (os.previsaoEntrega ? dataBR(os.previsaoEntrega) : '');

  let inicio = 0;
  const folhasHTML = folhas.map((pedaco, indice) => {
    const ctx = {
      os, loja, itens: pedaco, compacto, folha: indice + 1, totalFolhas: folhas.length,
      inicioItem: inicio, totalItens, modelo, config, extras: { entregaPrevista },
    };
    inicio += pedaco.length;
    const cliente = via !== 'loja' ? viaHTML({ ...ctx, tipo: 'cliente' }) : '';
    const lojaVia = via !== 'cliente' ? viaHTML({ ...ctx, tipo: 'loja' }) : '';
    return `<div class="folha" data-folha="${indice + 1}">
  ${cliente}
  ${via === 'duas' ? '<div class="corte"><span>&#9986; Recorte aqui</span></div>' : ''}
  ${lojaVia}
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${numeroOS} - OS ${esc(nomeLoja)}</title>
<style>
  @page { size: A4 portrait; margin: 4mm; }
  * { box-sizing: border-box; }
  :root { --tinta:#111; --fraco:#555; --linha:#c9c9c9; --acento:#b3121b; } /* --acento é trocado por via */
  html, body { margin: 0; padding: 0; background: #eceef1; color: var(--tinta);
    font-family: "Segoe UI", Roboto, Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .barra { position: sticky; top: 0; z-index: 30; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    justify-content: center; padding: 10px 12px; background: #16181c; color: #fff; font-size: 13px; }
  .barra strong { font-weight: 700; }
  .barra label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
  .barra button, .barra a { font: inherit; font-weight: 700; cursor: pointer; border-radius: 8px;
    border: 1px solid #3a4048; background: #2a3039; color: #fff; padding: 8px 14px; text-decoration: none; }
  .barra button.principal { background: var(--acento); border-color: var(--acento); }
  .barra .dica { width: 100%; text-align: center; font-size: 11px; color: #b9bec7; }

  .folha { position: relative; width: 202mm; height: 289mm; margin: 10px auto; background: #fff;
    padding: 0; box-shadow: 0 8px 30px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden; }

  .via { height: 140mm; padding: 3.5mm 4mm 3mm; display: flex; flex-direction: column; gap: 1.6mm;
    font-size: 9pt; line-height: 1.22; overflow: hidden; position: relative; }

  /* timbrado: a logomarca grande no meio da via, bem clara, atrás de tudo */
  .timbrado { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    z-index: 0; pointer-events: none; }
  .timbrado img { width: 62%; max-height: 80%; object-fit: contain; opacity: .12;
    mix-blend-mode: multiply; filter: grayscale(1) contrast(1.05); }
  .via > .cab, .via > .linha-campos, .via > .tabela-wrap, .via > .fechamento,
  .via > .garantia, .via > .assinaturas { position: relative; z-index: 1; }

  .corte { height: 7mm; display: flex; align-items: center; gap: 2mm; color: var(--fraco); font-size: 8pt;
    padding: 0 4mm; }
  .corte::before, .corte::after { content: ""; flex: 1 1 auto; border-top: .35mm dashed #8a8a8a; }
  .corte span { white-space: nowrap; letter-spacing: .22em; text-transform: uppercase; font-weight: 700; }

  .cab { display: flex; align-items: flex-start; gap: 3mm; padding-bottom: 1.4mm; border-bottom: .7mm solid var(--acento); }
  .cab .loja { display: flex; align-items: center; gap: 2.4mm; flex: 1 1 52%; min-width: 0; }
  .cab .logo { max-height: 13mm; max-width: 34mm; object-fit: contain; }
  .cab .logo-txt { font-size: 15pt; font-weight: 800; letter-spacing: .02em; }
  .loja-nome { font-size: 11pt; font-weight: 800; letter-spacing: .02em; line-height: 1.1; }
  .loja-linha { font-size: 7.6pt; color: var(--fraco); line-height: 1.25; max-width: 62mm; }
  .cab .doc { text-align: right; flex: 0 1 auto; }
  .titulo-doc { font-size: 9.5pt; font-weight: 800; letter-spacing: .1em; color: var(--acento); }
  .cab .numero { font-size: 11pt; font-weight: 700; }
  .cab .numero b { color: var(--acento); }
  .cab .numero .vazio { display: inline-block; min-width: 22mm; border-bottom: .3mm solid var(--tinta); }
  .quando { font-size: 7.6pt; color: var(--fraco); }
  .etiqueta { position: absolute; right: 4mm; top: 0; background: var(--acento); color: #fff;
    font-size: 7.6pt; font-weight: 800; letter-spacing: .12em; padding: .8mm 2.6mm; border-radius: 0 0 1.4mm 1.4mm;
    text-align: center; line-height: 1.25; }
  .etiqueta .folha-num { display: block; font-size: 6.6pt; letter-spacing: .06em; opacity: .85; }
  .cab .doc { padding-top: 5.4mm; }

  .linha-campos { display: flex; gap: 1.4mm; }
  .campo { border: .25mm solid var(--linha); border-radius: 1mm; padding: .7mm 1.4mm .9mm; min-width: 0; }
  .campo .rot { display: block; font-size: 6.6pt; letter-spacing: .1em; text-transform: uppercase; color: var(--fraco); font-weight: 700; }
  .campo .val { display: block; font-size: 9pt; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .w-cliente { flex: 3 1 0; } .w-fone { flex: 1.5 1 0; } .w-placa { flex: 1 1 0; }
  .w-veic { flex: 2.4 1 0; } .w-km { flex: .8 1 0; } .w-atend { flex: 1.5 1 0; }

  .tabela-wrap { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  table.itens { width: 100%; flex: 1 1 auto; border-collapse: collapse; }
  table.itens th { background: #f0f0f0; border-bottom: .3mm solid var(--tinta); font-size: 7.4pt;
    letter-spacing: .08em; text-transform: uppercase; text-align: left; padding: .9mm 1.4mm; }
  table.itens td { border-bottom: .25mm solid var(--linha); padding: .7mm 1.4mm; font-size: 9pt; height: 4.6mm; }
  table.itens .det { font-size: 7.6pt; color: var(--fraco); }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }

  .fechamento { display: flex; gap: 2mm; align-items: flex-start; }
  .obs { flex: 1 1 0; min-width: 0; }
  .bloco { margin-bottom: .8mm; }
  .bloco .rot, .valores .par span, .garantia b { font-size: 6.8pt; letter-spacing: .08em;
    text-transform: uppercase; color: var(--fraco); font-weight: 700; }
  .bloco .txt { display: block; font-size: 8.4pt; line-height: 1.25; max-height: 8mm; overflow: hidden; }
  .valores { flex: 0 0 66mm; font-size: 8.2pt; }
  .valores .par b { white-space: nowrap; }
  .valores .par { display: flex; justify-content: space-between; gap: 2mm; border-bottom: .2mm dotted var(--linha); padding: .5mm 0; }
  .valores .par b { font-weight: 700; }
  .valores .par.pagto { align-items: flex-start; }
  .valores .par.pagto b { white-space: normal; text-align: right; font-size: 8.5pt; line-height: 1.2; }
  .valores .total { border: .5mm solid var(--acento); border-radius: 1mm; padding: .9mm 1.4mm;
    background: #f4f4f4; font-size: 10pt; }
  .valores .total b { font-size: 11pt; color: var(--acento); }

  .garantia { font-size: 7.4pt; color: #222; line-height: 1.28; border-top: .25mm solid var(--linha); padding-top: 1mm; }
  .garantia b { color: var(--tinta); }

  .assinaturas { display: flex; gap: 6mm; padding-top: 1mm; }
  .assinatura { flex: 1 1 0; text-align: center; }
  .assinatura .risco { border-top: .3mm solid var(--tinta); margin-bottom: .3mm; }
  .assinatura span { font-size: 7.4pt; color: var(--fraco); }
  .assinatura.entrega { flex: 0 0 52mm; }

  /* modo compacto: quando a OS tem 9 itens ou mais */
  .via.compacto { font-size: 8.4pt; gap: 1.2mm; padding: 3mm 3.4mm 2.6mm; }
  .via.compacto .campo .val { font-size: 8.4pt; }
  .via.compacto table.itens td { font-size: 8.4pt; height: 3.9mm; padding: .45mm 1.2mm; }
  .via.compacto table.itens th { padding: .7mm 1.2mm; }
  .via.compacto .bloco .txt { font-size: 8pt; max-height: 6mm; }
  .via.compacto .garantia { font-size: 7pt; }
  .via.compacto .cab .logo { max-height: 11mm; }

  @media print {
    html, body { background: #fff; }
    .barra { display: none !important; }
    .folha { margin: 0; box-shadow: none; width: 202mm; height: 289mm; page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }
  }
  @media screen and (max-width: 820px) {
    .folha { width: 100%; height: auto; }
    .via { height: auto; }
  }
</style>
</head>
<body>
<div class="barra">
  <strong>Imprimir OS</strong>
  <label><input type="radio" name="via" value="duas" checked> Duas vias na mesma folha</label>
  <label><input type="radio" name="via" value="cliente"> Só via do cliente</label>
  <label><input type="radio" name="via" value="loja"> Só via da loja</label>
  <button class="principal" type="button" onclick="window.print()">&#128424; Imprimir / Salvar em PDF</button>
  <a href="javascript:window.close()">Fechar</a>
  <span class="dica">No diálogo de impressão: papel A4, escala 100%, margens padrão, sem cabeçalho/rodapé. Para PDF escolha "Salvar como PDF".</span>
</div>
${folhasHTML}
<script>
  (function () {
    var radios = document.querySelectorAll('input[name="via"]');
    function aplicar() {
      var escolha = 'duas';
      radios.forEach(function (r) { if (r.checked) escolha = r.value; });
      document.querySelectorAll('.via-cliente').forEach(function (el) { el.style.display = escolha === 'loja' ? 'none' : ''; });
      document.querySelectorAll('.via-loja').forEach(function (el) { el.style.display = escolha === 'cliente' ? 'none' : ''; });
      document.querySelectorAll('.corte').forEach(function (el) { el.style.display = escolha === 'duas' ? '' : 'none'; });
    }
    radios.forEach(function (r) { r.addEventListener('change', aplicar); });
    aplicar();
  })();
</script>
</body>
</html>`;
}

module.exports = {
  htmlImpressao, GARANTIA_PADRAO, PRAZO_PADRAO, CAPACIDADE, SERVICOS_MODELO,
  paginar, viaHTML,
};
