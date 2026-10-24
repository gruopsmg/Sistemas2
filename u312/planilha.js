'use strict';

// Leitor de planilha .xlsx sem dependencia externa.
// Um .xlsx e um ZIP com XML dentro. Aqui abrimos o ZIP na mao (zlib) e lemos
// a primeira aba, transformando tudo em texto separado por TAB — formato que o
// importacao.js ja entende (mesma coisa que o Excel cola na area de transferencia).
//
// Se o arquivo estiver quebrado ou for .xls antigo, devolve { ok:false, motivo }.

const zlib = require('zlib');

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

function acharEocd(buf) {
  const minimo = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  return -1;
}

function lerZip(buf) {
  const eocd = acharEocd(buf);
  if (eocd < 0) throw new Error('zip');
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const arquivos = new Map();

  for (let i = 0; i < total; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN) break;
    const metodo = buf.readUInt16LE(pos + 10);
    const comprimido = buf.readUInt32LE(pos + 20);
    const nomeTam = buf.readUInt16LE(pos + 28);
    const extraTam = buf.readUInt16LE(pos + 30);
    const comentTam = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    const nome = buf.slice(pos + 46, pos + 46 + nomeTam).toString('utf8');
    pos += 46 + nomeTam + extraTam + comentTam;

    if (!nome || nome.endsWith('/')) continue;
    arquivos.set(nome, { metodo, comprimido, offsetLocal });
  }
  return arquivos;
}

function extrair(buf, item) {
  const p = item.offsetLocal;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOC) throw new Error('zip');
  const nomeTam = buf.readUInt16LE(p + 26);
  const extraTam = buf.readUInt16LE(p + 28);
  const inicio = p + 30 + nomeTam + extraTam;
  const dados = buf.slice(inicio, inicio + item.comprimido);
  if (item.metodo === 0) return dados;
  if (item.metodo === 8) return zlib.inflateRawSync(dados, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  throw new Error('compressao');
}

function texto(xml) {
  let s = String(xml);
  s = s.replace(/<rPh[\s\S]*?<\/rPh>/g, ''); // ignorar leituras foneticas (japones/chines)
  const partes = [];
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(s))) partes.push(m[1]);
  return decodificar(partes.join(''));
}

function decodificar(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function colunaParaIndice(ref) {
  const letras = String(ref).replace(/\d+/g, '').toUpperCase();
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function lerSharedStrings(xml) {
  const lista = [];
  if (!xml) return lista;
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) lista.push(texto(m[1]));
  return lista;
}

function numero(valor) {
  const n = Number(String(valor).replace(',', '.'));
  if (!isFinite(n)) return String(valor);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10000) / 10000);
}

function lerAba(xml, shared) {
  const linhas = [];
  const reLinha = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = reLinha.exec(xml))) {
    const linha = [];
    const reCelula = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let c;
    let ordem = 0;
    while ((c = reCelula.exec(r[1]))) {
      const attrs = c[2] || c[1] || '';
      const corpo = c[3] || '';
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const tipo = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      const col = ref ? colunaParaIndice(ref) : ordem;
      ordem = col + 1;

      let valor = '';
      if (corpo) {
        if (tipo === 'inlineStr') {
          valor = texto(corpo);
        } else if (tipo === 's') {
          const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          valor = v === undefined ? '' : (shared[Number(v)] || '');
        } else if (tipo === 'str') {
          valor = texto((corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
        } else if (tipo === 'b') {
          const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          valor = v === '1' ? 'VERDADEIRO' : 'FALSO';
        } else if (tipo === 'e') {
          valor = '';
        } else {
          const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          valor = v === undefined ? '' : numero(v);
        }
      }
      linha[col] = String(valor).replace(/[\t\r\n]+/g, ' ').trim();
    }
    linhas.push(linha);
  }
  return linhas;
}

function paraTexto(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || []);
  if (buf.length < 4) return { ok: false, motivo: 'O arquivo está vazio.' };

  // .xls antigo (BIFF) comeca com D0 CF 11 E0
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return {
      ok: false,
      motivo: 'Este arquivo é Excel antigo (.xls). Abra no Excel e use "Salvar como" → .xlsx, ou salve como .csv.',
    };
  }
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    return { ok: false, motivo: 'O arquivo não parece ser uma planilha .xlsx.' };
  }

  let zip;
  try {
    zip = lerZip(buf);
  } catch (e) {
    return { ok: false, motivo: 'Não consegui abrir a planilha. Salve de novo como .xlsx e tente outra vez.' };
  }

  const aba =
    [...zip.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n)) ||
    [...zip.keys()].find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
  if (!aba) return { ok: false, motivo: 'A planilha não tem nenhuma aba com dados.' };

  try {
    const shared = lerSharedStrings(
      zip.has('xl/sharedStrings.xml') ? extrair(buf, zip.get('xl/sharedStrings.xml')).toString('utf8') : ''
    );
    const linhas = lerAba(extrair(buf, zip.get(aba)).toString('utf8'), shared);

    // mantem so linhas que tenham algum conteudo
    const uteis = linhas.filter((l) => l.some((c) => c && String(c).trim()));
    if (!uteis.length) return { ok: false, motivo: 'A planilha está vazia na primeira aba.' };

    const largura = uteis.reduce((m, l) => Math.max(m, l.length), 0);
    const textoFinal = uteis
      .map((l) => {
        const celulas = [];
        for (let i = 0; i < largura; i++) celulas.push(l[i] === undefined ? '' : l[i]);
        return celulas.join('\t').replace(/\t+$/, '');
      })
      .join('\n');

    return {
      ok: true,
      texto: textoFinal,
      rows: uteis,
      linhas: uteis.length,
      aviso: `Planilha lida: ${uteis.length} linha(s), aba "${aba.split('/').pop()}". Confira a prévia antes de confirmar.`,
    };
  } catch (e) {
    return { ok: false, motivo: 'Não consegui ler o conteúdo da planilha. Salve como .csv e tente de novo.' };
  }
}

module.exports = { paraTexto };
