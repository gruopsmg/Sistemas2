// SMG GROUP - Importação de estoque por arquivo (TXT, CSV/Excel-export, PDF com texto, PDF escaneado)
//
// O que este módulo faz (puro, sem servidor e sem disco — dá para testar direto):
//  1. lê o conteúdo do arquivo e separa em linhas;
//  2. entende cada linha: medida (inclusive C e ATR), marca, tipo (NOVO/REMOLD), custo,
//     preço e quantidade — aceitando tabulação, ponto e vírgula, vírgula e texto livre
//     ("175/65/14 LONGWAY R$ 245,00 qtd 3");
//  3. o que não entendeu NÃO é chutado: vai para a lista de revisão;
//  4. compara com o estoque que já existe (mesma medida + marca + tipo = atualiza).
//
// Nada aqui grava: quem grava é o server.js, e só depois da confirmação na tela.

const zlib = require('zlib');

// ---------- utilidades de texto ----------
const semAcento = (v) => String(v === undefined || v === null ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const chave = (v) => semAcento(v).trim().toLowerCase().replace(/\s+/g, '');

function numeroBrl(texto) {
  // "1.234,56" -> 1234.56 | "245,00" -> 245 | "245.00" -> 245 | "189" -> 189
  const bruto = String(texto || '').replace(/[^\d.,-]/g, '');
  if (!bruto) return null;
  let limpo = bruto;
  if (bruto.includes(',')) limpo = bruto.replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

// Separa os campos de uma linha respeitando vírgula decimal ("245,00" não é separador).
function dividirCampos(linha) {
  const texto = String(linha || '').trim();
  if (!texto) return [];
  if (texto.includes('\t')) return texto.split('\t').map((c) => c.trim()).filter((c) => c !== '');
  if (texto.includes(';')) return texto.split(';').map((c) => c.trim()).filter((c) => c !== '');
  if (texto.includes('|')) return texto.split('|').map((c) => c.trim()).filter((c) => c !== '');
  // vírgula: só separa quando NÃO for decimal (vírgula seguida de exatamente 3 dígitos)
  const partes = [];
  let atual = '';
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === ',') {
      const depois = texto.slice(i + 1, i + 4);
      // decimal do Brasil: vírgula + 2 dígitos (245,00) — não é separador de campo
      const decimal = /^\d{2}(\D|$)/.test(depois) && /\d/.test(texto[i - 1] || '');
      if (!decimal) { partes.push(atual.trim()); atual = ''; continue; }
    }
    atual += c;
  }
  partes.push(atual.trim());
  return partes.filter((c) => c !== '');
}

// ---------- medida, marca, tipo, valores ----------
// Aceita: 175/65R14, 175/65/14, 175/65 R 14, 175 65 14, 185/65R15 C, 195/70R15C,
//         175/65R14 ATR, 31x10.5R15 (medida em polegadas), 1000-20 (caminhão)
function acharMedida(texto) {
  const t = String(texto || '');
  const padroes = [
    /\b(\d{3})\s*\/\s*(\d{2,3})\s*(?:z?r)\s*(\d{2})\s*(c|atr)?\b/i, // 175/65R14 [C|ATR]
    /\b(\d{3})\s*\/\s*(\d{2,3})\s*\/\s*(\d{2})\s*(c|atr)?\b/i,       // 175/65/14
    /\b(\d{3})\s*\/\s*(\d{2,3})\b/i,                                  // 175/65 (sem aro)
    /\b(\d{3})\s+(\d{2})\s+(\d{2})\b/,                                // 175 65 14
    /\b(\d{2})\s*x\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*r?\s*(\d{2})\b/i,    // 31x10.50R15
    /\b(\d{4})-(\d{2})\b/,                                            // 1000-20
    /\b(\d{3})\s*r\s*(\d{2})\s*(c|atr)?\b/i,                          // 185R14 [C] (sem perfil)
    /\b(\d\.\d{2})\s*[.\-]\s*(\d{2})\b/,                              // moto: 5.60-15, 2.75-18
  ];
  for (const re of padroes) {
    const m = t.match(re);
    if (!m) continue;
    return { medida: canonicalizar(m[0]), bruto: m[0] };
  }
  return null;
}

// Deixa a medida sempre no mesmo formato: 175/65R14, 195/70R15C, 31X10.50R15, 1000-20.
// É isso que faz "175/65/14", "175 65 14" e "175/65R14" serem o MESMO pneu na hora de
// comparar com o estoque (senão a importação criaria duplicado).
function canonicalizar(bruto) {
  const t = String(bruto || '').replace(/\s+/g, '').toUpperCase();
  const suf = (t.match(/(ATR|C)$/) || [null, ''])[1] || '';
  const base = suf ? t.slice(0, -suf.length) : t;

  if (base.includes('X')) {
    const m = base.match(/^(\d{2})X(\d{1,2}(?:[.,]\d{1,2})?)R?(\d{2})$/);
    if (m) return `${m[1]}X${m[2].replace(',', '.')}R${m[3]}${suf}`;
    return base + suf;
  }
  // moto/diagonal: 5.60.15 ou 5.60-15 -> 5.60-15
  const moto = base.match(/^(\d\.\d{2})[.\-](\d{2})$/);
  if (moto) return `${moto[1]}-${moto[2]}${suf}`;

  // sem perfil: 185R14 -> 185R14 (aro direto)
  const semPerfil = base.match(/^(\d{3})R(\d{2})$/);
  if (semPerfil) return `${semPerfil[1]}R${semPerfil[2]}${suf}`;

  if (base.includes('-') && !base.includes('/')) return base + suf; // 1000-20

  const m = base.match(/^(\d{3})\/?(\d{2,3})\/?R?(\d{2})?$/);
  if (m) {
    const larg = m[1];
    const perfil = m[2];
    const aro = m[3];
    return aro ? `${larg}/${perfil}R${aro}${suf}` : `${larg}/${perfil}${suf}`;
  }
  return base + suf;
}

// Texto que sobra depois de tirar medida, números e palavras de controle = marca
function acharMarca(resto) {
  const lixo = [
    /r\$\s*[\d.,]+/gi, /\bqtd\.?\s*:?\s*\d+\b/gi, /\bquantidade\s*:?\s*\d+\b/gi,
    /\b\d+\s*(?:un|und|unid|pcs?|pecas?|peças?)\b/gi, /\bnovo\b/gi, /\bnovos\b/gi,
    /\bremold\b/gi, /\bremoldado\b/gi, /\brecapado\b/gi, /\bcusto\b/gi, /\bpreco\b/gi,
    /\bpreço\b/gi, /\bvenda\b/gi, /[\d.,]+/g, /\bc\b/gi, /\batr\b/gi,
  ];
  let texto = String(resto || '');
  for (const re of lixo) texto = texto.replace(re, ' ');
  const palavras = texto.split(/[^A-Za-zÀ-ÿ0-9&.-]+/).map((p) => p.trim()).filter((p) => p.length >= 2);
  if (!palavras.length) return '';
  return palavras.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
}

function acharTipo(texto) {
  const t = semAcento(texto).toLowerCase();
  if (/\bnovo\b|\bnovos\b|\bzero\b/.test(t)) return 'novo';
  // Regra do dono: sem a palavra NOVO, entra como REMOLD
  return 'remoldado';
}

function acharQuantidade(texto, posicaoMedida) {
  const t = String(texto || '');
  const comRotulo = t.match(/(?:qtd\.?|quantidade|qtde)\s*:?\s*(\d{1,5})/i);
  if (comRotulo) return Number(comRotulo[1]);
  const comUnidade = t.match(/\b(\d{1,5})\s*(?:un|und|unid|pcs?|pecas?|peças?)\b/i);
  if (comUnidade) return Number(comUnidade[1]);

  // Linha de lista (bem comum em PDF/foto): "175/70 R13 PIRELLI NOVO 8 R$ 289,90"
  // Tira a medida, tira o dinheiro; se sobrar UM número solto, ele é a quantidade.
  if (/R\$/i.test(t)) {
    let resto = t.replace(/R\$\s*[\d.,]+/gi, ' ');
    resto = resto.replace(/\d{3}\s*[\/x]?\s*\d{2,3}\s*R?\s*\d{2}/gi, ' ');
    resto = resto.replace(/\b\d{1,3}(?:\.\d{3})*(?:,\d{2})\b/g, ' ');
    const soltos = resto.match(/(?:^|\s)(\d{1,4})(?=\s|$)/g) || [];
    if (soltos.length === 1) return Number(String(soltos[0]).trim());
  }
  return null;
}

function acharValores(texto) {
  const t = String(texto || '');
  const comMoeda = [...t.matchAll(/r\$\s*([\d.,]+)/gi)].map((m) => numeroBrl(m[1])).filter((n) => n !== null);
  if (comMoeda.length >= 2) return { custo: comMoeda[0], venda: comMoeda[1] };
  if (comMoeda.length === 1) return { custo: null, venda: comMoeda[0] };
  return { custo: null, venda: null };
}

// ---------- interpretar uma linha ----------
// Campos esperados (em qualquer ordem, com ou sem cabeçalho):
//   medida | marca | tipo | custo | preço | quantidade
const CABECALHOS = /^(marca|medida|modelo|produto|descri|descrição|preco|preço|custo|qtd|quantidade|tipo|localiza)/i;

function interpretarLinha(linha) {
  const original = String(linha === undefined || linha === null ? '' : linha).trim();
  if (!original) return { ok: false, motivo: 'linha vazia', original };
  if (original.length < 4) return { ok: false, motivo: 'linha curta demais', original };
  if (CABECALHOS.test(original) && !acharMedida(original)) {
    return { ok: false, motivo: 'cabeçalho da planilha', original, ignorar: true };
  }

  const achado = acharMedida(original);
  if (!achado) return { ok: false, motivo: 'não achei a medida do pneu', original };

  const campos = dividirCampos(original);
  const semMedida = original.replace(achado.bruto, ' ');
  const marca = acharMarca(semMedida);
  if (!marca) return { ok: false, motivo: 'não achei a marca', original, medida: achado.medida };

  const tipo = acharTipo(original);
  let { custo, venda } = acharValores(original);

  // Sem "R$": usa a posição dos campos numéricos (planilha sem formatação de moeda).
  if (custo === null && venda === null && campos.length >= 3) {
    const numeros = campos.map((c) => (/^[\d.,]+$/.test(c) ? numeroBrl(c) : null)).filter((n) => n !== null && n > 0);
    if (numeros.length >= 2) { custo = numeros[0]; venda = numeros[1]; }
    else if (numeros.length === 1) venda = numeros[0];
  }

  const quantidade = acharQuantidade(original, achado.medida);
  const avisos = [];
  let qtdFinal = quantidade;
  if (qtdFinal === null) {
    // coluna de quantidade no fim da planilha (último campo só com número pequeno)
    const ultimo = campos[campos.length - 1];
    if (/^\d{1,4}$/.test(String(ultimo || ''))) qtdFinal = Number(ultimo);
  }
  if (qtdFinal === null || !Number.isFinite(qtdFinal)) {
    qtdFinal = 1;
    avisos.push('quantidade não estava no arquivo: entrou 1 (confira antes de confirmar)');
  }
  if (qtdFinal <= 0) return { ok: false, motivo: 'quantidade zero ou negativa', original, medida: achado.medida };
  if (venda === null) avisos.push('preço de venda não encontrado');
  if (custo === null) avisos.push('custo não encontrado');

  return {
    ok: true,
    original,
    medida: achado.medida,
    marca,
    tipo,
    custo,
    preco: venda,
    quantidade: qtdFinal,
    avisos,
    chave: `${chave(achado.medida)}|${chave(marca)}|${tipo}`,
  };
}

// ---------- interpretar o arquivo inteiro ----------
function interpretarConteudo(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  const itens = [];
  const revisao = [];
  let vazias = 0;
  for (const linha of linhas) {
    if (!String(linha).trim()) { vazias += 1; continue; }
    const r = interpretarLinha(linha);
    if (r.ok) { itens.push(r); continue; }
    if (r.ignorar) continue;
    revisao.push({ linha: r.original, motivo: r.motivo });
  }
  // duplicados dentro do próprio arquivo: soma a quantidade e avisa
  const porChave = new Map();
  const consolidado = [];
  for (const item of itens) {
    const existente = porChave.get(item.chave);
    if (!existente) { porChave.set(item.chave, item); consolidado.push(item); continue; }
    existente.quantidade += item.quantidade;
    existente.avisos = [...new Set([...(existente.avisos || []), 'aparece mais de uma vez no arquivo: quantidades somadas'])];
  }
  return {
    itens: consolidado,
    revisao,
    estatisticas: { linhasLidas: linhas.length, itens: consolidado.length, revisao: revisao.length, vazias },
  };
}


// ---------- planilha com cabeçalho (Excel/CSV em colunas) ----------
// Quando o arquivo tem cabeçalho, o certo é ler por COLUNA e não adivinhar pelo texto.
// Sinônimos aceitos (sem acento, minúsculo):
const COLUNAS = {
  medida: ['medida', 'pneu', 'tamanho', 'especificacao', 'descricao medida'],
  marca: ['marca', 'fabricante', 'montadora'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'qnt', 'estoque', 'saldo', 'estoque atual', 'qtd estoque'],
  precoVenda: ['preco', 'preco venda', 'valor', 'valor venda', 'venda', 'preco de venda', 'preco venda r$'],
  precoCusto: ['custo', 'preco custo', 'valor custo', 'compra', 'preco de compra', 'preco custo r$'],
  status: ['status', 'tipo', 'condicao', 'situacao', 'estado'],
  localizacao: ['local', 'localizacao', 'prateleira', 'posicao', 'endereco', 'localizacao fisica'],
  estoqueMinimo: ['minimo', 'estoque minimo', 'min', 'qtd minima'],
  descricao: ['descricao', 'produto', 'nome', 'item', 'referencia'],
};

function normalizarCabecalho(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapearColunas(cabecalho) {
  const mapa = {};
  const usados = new Set();
  const normalizados = cabecalho.map((c) => normalizarCabecalho(c));

  // 1a passada: nome exato
  for (const campo of Object.keys(COLUNAS)) {
    normalizados.forEach((nome, i) => {
      if (mapa[campo] !== undefined || usados.has(i) || !nome) return;
      if (COLUNAS[campo].includes(nome)) { mapa[campo] = i; usados.add(i); }
    });
  }
  // 2a passada: contém a palavra (ex.: "Preço de venda (R$)")
  for (const campo of Object.keys(COLUNAS)) {
    normalizados.forEach((nome, i) => {
      if (mapa[campo] !== undefined || usados.has(i) || !nome) return;
      if (COLUNAS[campo].some((sin) => nome === sin || nome.startsWith(sin + ' ') || nome.endsWith(' ' + sin))) {
        mapa[campo] = i; usados.add(i);
      }
    });
  }
  return mapa;
}

function valorDaCelula(linha, indice) {
  if (indice === undefined || indice < 0) return '';
  const v = linha[indice];
  return v === undefined || v === null ? '' : String(v).trim();
}

function tipoCanonico(bruto) {
  const t = normalizarCabecalho(bruto);
  if (!t) return 'novo';
  if (t.includes('usad') || t.includes('semi')) return 'usado';
  if (t.includes('recauch')) return 'recauchutado';
  if (t.includes('novo')) return 'novo';
  return acharTipo(bruto) || 'novo';
}

// Separa uma linha de CSV/TXT respeitando aspas: "175/70 R13";"Pirelli";8
function separarLinhaTabela(linha) {
  const t = String(linha === undefined || linha === null ? '' : linha);
  const delim = t.includes(';') ? ';' : t.includes('\t') ? '\t' : t.includes('|') ? '|' : ',';
  const saida = [];
  let atual = '';
  let dentro = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      if (dentro && t[i + 1] === '"') { atual += '"'; i++; } else { dentro = !dentro; }
      continue;
    }
    if (!dentro && c === delim) { saida.push(atual.trim()); atual = ''; continue; }
    atual += c;
  }
  saida.push(atual.trim());
  return saida;
}

function linhasDeTabela(texto) {
  return String(texto || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => String(l).trim())
    .map(separarLinhaTabela);
}

// A 1a linha parece cabecalho de planilha? (tem medida/descricao e quantidade ou preco)
function temCabecalhoTabela(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) return false;
  const mapa = mapearColunas(linhas[0]);
  const temProduto = mapa.medida !== undefined || mapa.descricao !== undefined;
  const temNumero = mapa.quantidade !== undefined || mapa.precoVenda !== undefined;
  return temProduto && temNumero;
}

// Le uma planilha ja convertida em linhas (array de arrays, com cabecalho na 1a linha).
// Devolve o mesmo formato de interpretarConteudo: { itens, revisao, estatisticas }.
function interpretarTabela(linhas) {
  const todas = (Array.isArray(linhas) ? linhas : []).filter((l) => Array.isArray(l) && l.some((c) => String(c || '').trim()));
  if (todas.length < 2) return { itens: [], revisao: [], estatisticas: { linhasLidas: todas.length, itens: 0, revisao: 0, vazias: 0 } };

  const cabecalho = todas[0];
  const mapa = mapearColunas(cabecalho);
  if (mapa.medida === undefined && mapa.descricao === undefined) {
    return { itens: [], revisao: [], estatisticas: { linhasLidas: todas.length, itens: 0, revisao: 0, vazias: 0 }, semColunas: true };
  }

  const itens = [];
  const revisao = [];
  let vazias = 0;

  for (let i = 1; i < todas.length; i++) {
    const linha = todas[i];
    const juntas = linha.join(' ').trim();
    if (!juntas) { vazias++; continue; }

    // MEDIDA: coluna própria; se não veio, tenta a descrição e, por último, a linha toda
    let medida = '';
    const brutoMedida = valorDaCelula(linha, mapa.medida) || valorDaCelula(linha, mapa.descricao);
    const achado = acharMedida(brutoMedida) || acharMedida(juntas);
    if (achado) medida = achado.medida;
    if (!medida) {
      revisao.push({ linha: juntas, motivo: 'não achei a medida do pneu' });
      continue;
    }

    // MARCA
    let marca = valorDaCelula(linha, mapa.marca);
    if (!marca) {
      const resto = brutoMedida.replace((achado && achado.bruto) || medida, ' ');
      marca = acharMarca(resto) || acharMarca(juntas) || '';
    }
    if (!marca) {
      revisao.push({ linha: juntas, motivo: `não achei a marca (medida ${medida})` });
      continue;
    }

    const avisos = [];
    const qtdBruta = valorDaCelula(linha, mapa.quantidade);
    let quantidade = qtdBruta === '' ? null : numeroBrl(qtdBruta);
    if (quantidade === null || !Number.isFinite(quantidade)) {
      quantidade = 1;
      avisos.push('quantidade não estava na planilha: entrou 1 (confira antes de confirmar)');
    }
    if (quantidade <= 0) {
      revisao.push({ linha: juntas, motivo: 'quantidade zero ou negativa' });
      continue;
    }

    const vendaBruta = valorDaCelula(linha, mapa.precoVenda);
    const custoBruto = valorDaCelula(linha, mapa.precoCusto);
    const preco = vendaBruta === '' ? null : numeroBrl(vendaBruta);
    const custo = custoBruto === '' ? null : numeroBrl(custoBruto);
    if (preco === null) avisos.push('preço de venda não encontrado');
    if (custo === null) avisos.push('custo não encontrado');

    // TIPO: coluna Status quando existe. Sem coluna, a palavra no texto manda;
    // se não houver nenhuma palavra, planilha estruturada entra como NOVO (o padrão do estoque).
    const statusBruto = valorDaCelula(linha, mapa.status);
    let tipo;
    if (statusBruto) {
      tipo = tipoCanonico(statusBruto);
    } else {
      const txt = semAcento(juntas).toLowerCase();
      if (/remold|recauch|usad|semi/.test(txt)) tipo = tipoCanonico(juntas);
      else if (/\bnovo\b|\bnovos\b|\bzero\b/.test(txt)) tipo = 'novo';
      else { tipo = 'novo'; avisos.push('planilha sem coluna Status: entrou como NOVO'); }
    }
    const localizacao = valorDaCelula(linha, mapa.localizacao);
    const minimoBruto = valorDaCelula(linha, mapa.estoqueMinimo);
    const estoqueMinimo = minimoBruto === '' ? null : numeroBrl(minimoBruto);

    itens.push({
      ok: true,
      original: juntas,
      medida,
      marca,
      tipo,
      custo,
      preco,
      quantidade,
      localizacao: localizacao || undefined,
      estoqueMinimo: estoqueMinimo === null ? undefined : estoqueMinimo,
      avisos,
      chave: `${chave(medida)}|${chave(marca)}|${tipo}`,
    });
  }

  // mesma medida+marca repetida: soma quantidade (igual ao texto)
  const porChave = new Map();
  const consolidado = [];
  for (const item of itens) {
    const existente = porChave.get(item.chave);
    if (!existente) { porChave.set(item.chave, item); consolidado.push(item); continue; }
    existente.quantidade += item.quantidade;
    existente.avisos = [...new Set([...(existente.avisos || []), 'aparece mais de uma vez na planilha: quantidades somadas'])];
  }

  return {
    itens: consolidado,
    revisao,
    estatisticas: { linhasLidas: todas.length, itens: consolidado.length, revisao: revisao.length, vazias },
    colunas: mapa,
  };
}

// ---------- PDF ----------
// Extrai o texto de PDF COM TEXTO (FlateDecode), sem dependência externa.
// PDF escaneado (só imagem) não tem texto: devolve vazio e o servidor avisa / tenta OCR.
function extrairTextoPdf(buffer) {
  const bruto = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'binary');
  const textoPdf = bruto.toString('latin1');
  const pedacos = [];

  const reStream = /stream\r?\n?([\s\S]*?)endstream/g;
  let m;
  while ((m = reStream.exec(textoPdf)) !== null) {
    const dados = Buffer.from(m[1], 'latin1');
    let conteudo = null;
    try {
      conteudo = zlib.inflateSync(dados).toString('latin1');
    } catch (e) {
      // stream sem compressão (raro, mas acontece em PDF pequeno)
      conteudo = dados.toString('latin1');
    }
    if (!conteudo || !/(Tj|TJ)/.test(conteudo)) continue;
    pedacos.push(extrairOperadoresDeTexto(conteudo));
  }

  return pedacos.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodificarStringPdf(s) {
  // escapa \( \) \\ e octal \ddd
  let saida = String(s || '')
    .replace(/\\([nrtbf])/g, (todo, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (todo, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, '$1');
  return saida;
}

function extrairOperadoresDeTexto(conteudo) {
  const linhas = [];
  let atual = '';
  // (...) Tj  |  [ (..) -1 (..) ] TJ  |  (..) '  | T* / Td / TD
  const re = /\((?:\\.|[^\\()])*\)|\bTJ\b|\bTj\b|\bT\*|\bTd\b|\bTD\b|\bET\b/g;
  let m;
  while ((m = re.exec(conteudo)) !== null) {
    const token = m[0];
    if (token.startsWith('(')) {
      atual += decodificarStringPdf(token.slice(1, -1));
      continue;
    }
    if (token === 'TJ') {
      linhas.push(atual.trim());
      atual = '';
      continue;
    }
    if (token === 'Tj') {
      atual += ' ';
      continue;
    }
    if (token === 'T*' || token === 'Td' || token === 'TD' || token === 'ET') {
      if (atual.trim()) { linhas.push(atual.trim()); atual = ''; }
    }
  }
  if (atual.trim()) linhas.push(atual.trim());
  return linhas.filter((l) => l.trim()).join('\n');
}

// PDF sem texto = provavelmente digitalizado (foto). Só OCR resolve.
function pareceEscaneado(texto) {
  return String(texto || '').replace(/\s/g, '').length < 20;
}

// OCR é OPCIONAL: só funciona se o pacote tesseract.js estiver instalado.
// Sem ele, o sistema avisa em português em vez de fingir que leu.

// ---------- imagem dentro do PDF (para OCR) ----------
// tesseract.js não lê PDF: é preciso tirar a imagem de dentro dele.
// Scanners e "salvar como PDF" do celular geram quase sempre JPEG (DCTDecode).
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function empacotarPng(dados, largura, altura, canais) {
  const zlib = require('zlib');
  const cor = canais === 1 ? 0 : 2; // 0 = cinza, 2 = RGB
  const bytesPorLinha = largura * canais;
  const cru = Buffer.alloc((bytesPorLinha + 1) * altura);
  for (let y = 0; y < altura; y++) {
    cru[y * (bytesPorLinha + 1)] = 0; // sem filtro
    dados.copy(cru, y * (bytesPorLinha + 1) + 1, y * bytesPorLinha, (y + 1) * bytesPorLinha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = cor; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const pedaco = (tipo, conteudo) => {
    const tam = Buffer.alloc(4); tam.writeUInt32BE(conteudo.length, 0);
    const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), conteudo]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo), 0);
    return Buffer.concat([tam, corpo, crc]);
  };
  const idat = zlib.deflateSync(cru);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', idat),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

function extrairImagemDoPdf(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'binary');
  const bin = buf.toString('latin1');
  const re = /\/Subtype\s*\/Image([\s\S]{0,800}?)\bstream\r?\n/g;
  let melhor = null;
  let m;
  while ((m = re.exec(bin))) {
    const dict = m[1];
    const tam = dict.match(/\/Length\s+(\d+)/);
    if (!tam) continue;
    const len = Number(tam[1]);
    const inicio = m.index + m[0].length;
    if (inicio + len > buf.length) continue;
    const largura = Number((dict.match(/\/Width\s+(\d+)/) || [])[1] || 0);
    const altura = Number((dict.match(/\/Height\s+(\d+)/) || [])[1] || 0);
    const filtro = (dict.match(/\/Filter\s*\/(\w+)/) || [])[1] || '';
    const ehCinza = /\/DeviceGray/.test(dict);
    const cand = { dados: buf.slice(inicio, inicio + len), largura, altura, filtro, cinza: ehCinza };
    if (!melhor || cand.largura * cand.altura > melhor.largura * melhor.altura) melhor = cand;
  }
  if (!melhor) return { ok: false, motivo: 'PDF escaneado, mas não encontrei imagem dentro dele (página vazia?). Envie a foto da lista ou a planilha.' };
  if (melhor.filtro === 'DCTDecode') {
    return { ok: true, mime: 'image/jpeg', dados: melhor.dados, largura: melhor.largura, altura: melhor.altura };
  }
  if (melhor.filtro === 'FlateDecode') {
    try {
      const zlib = require('zlib');
      const cru = zlib.inflateSync(melhor.dados);
      const canais = melhor.cinza ? 1 : 3;
      if (cru.length < melhor.largura * melhor.altura * canais) {
        return { ok: false, motivo: 'A imagem do PDF está compactada de um jeito que não consigo abrir. Salve como .jpg ou tire print e envie a foto.' };
      }
      return { ok: true, mime: 'image/png', dados: empacotarPng(cru, melhor.largura, melhor.altura, canais), largura: melhor.largura, altura: melhor.altura };
    } catch (e) {
      return { ok: false, motivo: 'Não consegui abrir a imagem de dentro do PDF. Salve a página como foto (.jpg) e envie.' };
    }
  }
  return { ok: false, motivo: 'A imagem do PDF está em um formato que não consigo ler (ex.: JPEG 2000). Tire um print da tela e envie a foto (.jpg/.png).' };
}

function ehJpegOuPng(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  return false;
}

async function tentarOcr(buffer) {
  let tesseract;
  try {
    tesseract = require('tesseract.js');
  } catch (e) {
    return {
      ok: false,
      motivo: 'PDF escaneado (só imagem). O leitor de OCR não está instalado neste computador.',
      dica: 'Instale com: npm install tesseract.js  (ou envie o arquivo em TXT/Excel)',
    };
  }
  // Descobre o que mandar para o OCR: a foto enviada direto ou a imagem de dentro do PDF
  let imagem = null;
  let mime = 'image/jpeg';
  const ehPdf = buffer.slice(0, 4).toString('latin1') === '%PDF';
  if (ehPdf) {
    const achada = extrairImagemDoPdf(buffer);
    if (!achada.ok) return { ok: false, motivo: achada.motivo, dica: 'Ou envie a planilha (.xlsx/.csv), que não precisa de OCR.' };
    imagem = achada.dados;
    mime = achada.mime;
  } else if (ehJpegOuPng(buffer)) {
    imagem = buffer;
    mime = buffer[0] === 0x89 ? 'image/png' : 'image/jpeg';
  } else {
    return { ok: false, motivo: 'O arquivo não é uma imagem nem um PDF que eu consiga ler.' };
  }

  let worker = null;
  try {
    // worker com tratador de erro: sem isso um erro de leitura derruba o sistema inteiro
    worker = await tesseract.createWorker('por', 1, { errorHandler: () => {} });
    const { data } = await worker.recognize(imagem);
    return { ok: true, texto: String((data && data.text) || ''), confianca: Number(data && data.confidence) || 0 };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const semInternet = /fetch|network|ENOTFOUND|download|traineddata/i.test(msg);
    return {
      ok: false,
      motivo: semInternet
        ? 'O OCR não conseguiu baixar o idioma português. Precisa de internet na primeira vez que ele roda.'
        : `O OCR não conseguiu ler a imagem (${msg.slice(0, 120)}).`,
      dica: 'Tire uma foto mais reta e com boa luz, ou envie a planilha (.xlsx/.csv), que não precisa de OCR.',
    };
  } finally {
    if (worker) { try { await worker.terminate(); } catch (e) { /* ignora */ } }
  }
}

// ---------- comparação com o estoque que já existe ----------
// Devolve a prévia: o que vai ser criado, o que vai ser atualizado e o que precisa de revisão.
function montarPrevia(itens, { pneus, loja, modo }) {
  const lista = Array.isArray(pneus) ? pneus : [];
  const criar = [];
  const atualizar = [];
  for (const item of itens) {
    const existente = lista.find((p) => chave(p.medida) === chave(item.medida)
      && chave(p.marca) === chave(item.marca)
      && (p.status || 'novo') === item.tipo);
    if (!existente) { criar.push({ ...item, acao: 'criar' }); continue; }
    atualizar.push({
      ...item,
      acao: 'atualizar',
      pneuId: existente.id,
      quantidadeAntes: Number(existente.quantidade) || 0,
      quantidadeDepois: modo === 'substituir' ? item.quantidade : (Number(existente.quantidade) || 0) + item.quantidade,
    });
  }
  return { modo, loja, criar, atualizar };
}

module.exports = {
  chave,
  numeroBrl,
  dividirCampos,
  acharMedida,
  acharMarca,
  acharTipo,
  acharQuantidade,
  acharValores,
  interpretarLinha,
  interpretarConteudo,
  interpretarTabela,
  linhasDeTabela,
  temCabecalhoTabela,
  extrairTextoPdf,
  extrairImagemDoPdf,
  extrairOperadoresDeTexto,
  pareceEscaneado,
  tentarOcr,
  montarPrevia,
};
