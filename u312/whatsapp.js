// UNICAR - Envio da OS pelo WhatsApp (uma conexão por loja)
// ---------------------------------------------------------------------------
// O WhatsApp aqui serve SÓ para enviar a OS digital ao cliente: não é atendimento,
// não é chat e o sistema NÃO responde mensagem nenhuma.
//
// Como funciona:
//   * uma conexão por loja (UNICAR / MATRIZ / FILIAL), com o número da própria loja;
//   * conexão por QR Code (atualiza sozinho quando expira) ou por código de 8 caracteres
//     (WhatsApp > Aparelhos conectados > Conectar com número de telefone);
//   * a sessão fica em disco em ../whatsapp-sessao/<LOJA> (FORA da pasta do sistema, para a
//     atualização — que troca a pasta inteira — não apagar e não pedir QR de novo);
//   * usa @whiskeysockets/baileys (JavaScript puro, sem Docker e sem serviço pago).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const PASTA_BASE = process.env.PASTA_WHATSAPP || path.join(__dirname, '..', 'whatsapp-sessao');

const ESTADOS = { DESCONECTADO: 'desconectado', AGUARDANDO: 'aguardando', CONECTADO: 'conectado', ERRO: 'erro' };

// logger silencioso: o baileys é falante e não queremos isso no console da loja
const logSilencioso = {
  level: 'silent', child() { return this; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

const conexoes = new Map(); // codigoLoja -> estado interno
let enviadorDeTeste = null; // usado pelos testes automatizados

// Gancho de teste: com WHATSAPP_ENVIO_FAKE=1 o envio não vai para o WhatsApp de verdade
// (os testes automatizados usam isso; nunca ligue em produção).
if (process.env.WHATSAPP_ENVIO_FAKE === '1') {
  enviadorDeTeste = async (loja, dados) => ({
    ok: true, numero: dados.numero, em: Date.now(), fake: true, loja,
  });
}

function normalizarCodigoLoja(v) {
  return String(v || '').trim().toUpperCase() || 'UNICAR';
}

// Só números. Completa o 55 (Brasil) quando o usuário digita DDD + número.
function normalizarNumero(bruto) {
  let d = String(bruto === undefined || bruto === null ? '' : bruto).replace(/\D+/g, '');
  if (d.startsWith('0055')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return '';
  if (!d.startsWith('55')) return '';
  return d;
}

function pastaDaLoja(codigoLoja) {
  return path.join(PASTA_BASE, normalizarCodigoLoja(codigoLoja));
}

function estadoDe(codigoLoja) {
  const chave = normalizarCodigoLoja(codigoLoja);
  if (!conexoes.has(chave)) {
    conexoes.set(chave, {
      loja: chave,
      status: ESTADOS.DESCONECTADO,
      qr: null,
      qrAtualizadoEm: null,
      numero: null,
      erro: null,
      pareamento: null,
      desde: Date.now(),
      socket: null,
      tentativas: 0,
      enviando: false,
      ultimoEnvio: null,
    });
  }
  return conexoes.get(chave);
}

function estadoPublico(codigoLoja) {
  const e = estadoDe(codigoLoja);
  return {
    loja: e.loja,
    status: e.status,
    qr: e.status === ESTADOS.AGUARDANDO ? e.qr : null,
    qrAtualizadoEm: e.qrAtualizadoEm,
    numero: e.numero,
    erro: e.erro,
    pareamento: e.pareamento,
    desde: e.desde,
    pasta: pastaDaLoja(e.loja),
    sessaoSalva: fs.existsSync(pastaDaLoja(e.loja)),
  };
}

function listar() {
  const lojas = [];
  for (const chave of conexoes.keys()) lojas.push(estadoPublico(chave));
  return lojas;
}

async function conectar(codigoLoja, opcoes = {}) {
  const chave = normalizarCodigoLoja(codigoLoja);
  const e = estadoDe(chave);

  // já conectado: devolve como está
  if (e.status === ESTADOS.CONECTADO && e.socket) return estadoPublico(chave);

  // fecha um socket pendente antes de abrir outro
  if (e.socket) {
    try { e.socket.ev.removeAllListeners(); e.socket.end(undefined); } catch (erro) { /* ignora */ }
    e.socket = null;
  }

  const telefone = opcoes.telefone ? normalizarNumero(opcoes.telefone) : '';
  if (opcoes.telefone && !telefone) {
    e.status = ESTADOS.ERRO;
    e.erro = 'Telefone inválido. Use DDD + número (ex.: 22999998888).';
    return estadoPublico(chave);
  }

  const baileys = require('@whiskeysockets/baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

  const pasta = pastaDaLoja(chave);
  fs.mkdirSync(pasta, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(pasta);
  let versao = [2, 3000, 0];
  try { ({ version: versao } = await fetchLatestBaileysVersion()); } catch (erro) { /* usa a padrão */ }

  const socket = makeWASocket({
    version: versao,
    auth: state,
    logger: logSilencioso,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ['UNICAR', 'Chrome', '120.0.0'],
    // o sistema não recebe nada: sem histórico, sem notificações de mensagem
    getMessage: async () => undefined,
  });

  e.socket = socket;
  e.status = ESTADOS.AGUARDANDO;
  e.erro = null;
  e.qr = null;
  e.pareamento = telefone ? { telefone, codigo: null, pedidoEm: Date.now() } : null;
  e.desde = Date.now();

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (atualizacao) => {
    const { connection, lastDisconnect, qr } = atualizacao || {};
    if (qr) {
      try {
        e.qr = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
        e.qrAtualizadoEm = Date.now();
        e.status = ESTADOS.AGUARDANDO;
      } catch (erro) {
        e.erro = 'Não consegui desenhar o QR Code.';
      }
    }
    if (connection === 'open') {
      e.status = ESTADOS.CONECTADO;
      e.qr = null;
      e.erro = null;
      e.tentativas = 0;
      e.pareamento = null;
      const id = (socket.user && socket.user.id) || '';
      e.numero = id.split(':')[0] || id.split('@')[0] || null;
      e.desde = Date.now();
    }
    if (connection === 'close') {
      const codigo = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        && lastDisconnect.error.output.statusCode;
      const saiu = codigo === DisconnectReason.loggedOut || codigo === 401;
      e.socket = null;
      if (saiu) {
        e.status = ESTADOS.DESCONECTADO;
        e.numero = null;
        e.qr = null;
        e.pareamento = null;
        e.erro = 'A sessão foi encerrada no celular. Conecte de novo pelo QR Code.';
        try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (erro) { /* ignora */ }
        return;
      }
      // queda de rede: tenta de novo sozinho (até 5 vezes)
      e.tentativas += 1;
      if (e.tentativas <= 5) {
        e.status = ESTADOS.AGUARDANDO;
        e.erro = `Conexão caiu (tentativa ${e.tentativas} de 5). Reconectando…`;
        setTimeout(() => { if (e.status !== ESTADOS.CONECTADO) conectar(chave).catch(() => {}); }, 3000 * e.tentativas);
      } else {
        e.status = ESTADOS.ERRO;
        e.erro = 'Não consegui reconectar. Clique em Conectar para tentar de novo.';
      }
    }
  });

  // código de 8 caracteres (conectar com número de telefone)
  if (telefone) {
    try {
      // o WhatsApp exige o número sem o 55 na frente
      const semPais = telefone.startsWith('55') ? telefone.slice(2) : telefone;
      const codigo = await socket.requestPairingCode(semPais);
      e.pareamento = { telefone, codigo, pedidoEm: Date.now() };
      e.status = ESTADOS.AGUARDANDO;
    } catch (erro) {
      e.erro = `Não consegui gerar o código de pareamento: ${erro.message}`;
      e.status = ESTADOS.ERRO;
    }
  }

  return estadoPublico(chave);
}

async function desconectar(codigoLoja, opcoes = {}) {
  const chave = normalizarCodigoLoja(codigoLoja);
  const e = estadoDe(chave);
  if (e.socket) {
    try {
      if (opcoes.apagar) await e.socket.logout();
      else e.socket.end(undefined);
    } catch (erro) { /* ignora */ }
    try { e.socket.ev.removeAllListeners(); } catch (erro) { /* ignora */ }
    e.socket = null;
  }
  e.status = ESTADOS.DESCONECTADO;
  e.qr = null;
  e.numero = null;
  e.pareamento = null;
  e.erro = null;
  if (opcoes.apagar) {
    try { fs.rmSync(pastaDaLoja(chave), { recursive: true, force: true }); } catch (erro) { /* ignora */ }
  }
  return estadoPublico(chave);
}

function jidDe(numero) {
  return `${numero}@s.whatsapp.net`;
}

async function enviarDocumento(codigoLoja, dados) {
  const chave = normalizarCodigoLoja(codigoLoja);
  const e = estadoDe(chave);
  const numero = normalizarNumero(dados && dados.numero);
  if (!numero) throw new Error('Telefone do cliente inválido. Use DDD + número.');
  if (enviadorDeTeste) return enviadorDeTeste(chave, { ...dados, numero });
  if (e.status !== ESTADOS.CONECTADO || !e.socket) {
    throw new Error(`O WhatsApp da loja ${chave} não está conectado. Vá em Configurações > WhatsApp e conecte.`);
  }
  const jid = jidDe(numero);
  e.enviando = true;
  try {
    await e.socket.sendMessage(jid, {
      document: dados.pdf,
      fileName: dados.nomeArquivo || 'ordem-de-servico.pdf',
      mimetype: 'application/pdf',
      caption: dados.legenda || '',
    });
    e.ultimoEnvio = { numero, em: Date.now(), os: dados.osNumero || null };
    return { ok: true, numero, em: e.ultimoEnvio.em };
  } finally {
    e.enviando = false;
  }
}

async function enviarTexto(codigoLoja, dados) {
  const chave = normalizarCodigoLoja(codigoLoja);
  const e = estadoDe(chave);
  const numero = normalizarNumero(dados && dados.numero);
  if (!numero) throw new Error('Telefone inválido. Use DDD + número.');
  const texto = String((dados && dados.texto) || '').trim();
  if (!texto) throw new Error('Escreva a mensagem.');
  if (enviadorDeTeste) return enviadorDeTeste(chave, { ...dados, numero, texto });
  if (e.status !== ESTADOS.CONECTADO || !e.socket) {
    throw new Error(`O WhatsApp da loja ${chave} não está conectado.`);
  }
  await e.socket.sendMessage(jidDe(numero), { text: texto });
  e.ultimoEnvio = { numero, em: Date.now(), teste: true };
  return { ok: true, numero, em: e.ultimoEnvio.em };
}

// usado só nos testes: troca o envio real por uma função de mentira
function definirEnviador(fn) {
  enviadorDeTeste = typeof fn === 'function' ? fn : null;
}

module.exports = {
  ESTADOS, PASTA_BASE, normalizarNumero, normalizarCodigoLoja, pastaDaLoja,
  conectar, desconectar, enviarDocumento, enviarTexto, estadoPublico, listar, definirEnviador,
};
