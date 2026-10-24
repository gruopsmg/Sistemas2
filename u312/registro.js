// UNICAR - Registro (log) em arquivo + tela
// Nao usa biblioteca externa. Se nao conseguir escrever o arquivo, o sistema continua
// funcionando: log nunca pode derrubar a loja.

const fs = require('fs');
const path = require('path');

const PESOS = { debug: 10, info: 20, aviso: 30, erro: 40, silencio: 99 };

function dataArquivo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function criarRegistro({ pasta, nivel = 'info', diasDeLog = 14, tela = true }) {
  const pesoMinimo = PESOS[nivel] !== undefined ? PESOS[nivel] : PESOS.info;
  let pastaOk = false;

  try {
    fs.mkdirSync(pasta, { recursive: true });
    pastaOk = true;
  } catch (e) {
    pastaOk = false;
  }

  function escreverArquivo(nome, linha) {
    if (!pastaOk) return;
    try {
      fs.appendFileSync(path.join(pasta, nome), linha + '\n');
    } catch (e) {
      /* log nao pode quebrar o sistema */
    }
  }

  function montar(nivelMsg, mensagem, extra) {
    const agora = new Date();
    const hora = agora.toISOString();
    let texto = `[${hora}] ${nivelMsg.toUpperCase()} ${mensagem}`;
    if (extra !== undefined && extra !== null) {
      if (extra instanceof Error) {
        texto += ` | ${extra.name}: ${extra.message}`;
        if (extra.stack) texto += `\n${extra.stack}`;
      } else if (typeof extra === 'object') {
        try {
          texto += ` | ${JSON.stringify(extra)}`;
        } catch (e) {
          texto += ' | [dados nao serializaveis]';
        }
      } else {
        texto += ` | ${extra}`;
      }
    }
    return { texto, nome: `app-${dataArquivo(agora)}.log` };
  }

  function registrar(nivelMsg, mensagem, extra) {
    if (PESOS[nivelMsg] < pesoMinimo) return;
    const { texto, nome } = montar(nivelMsg, mensagem, extra);
    if (tela) {
      const saida = nivelMsg === 'erro' ? console.error : console.log;
      saida(texto);
    }
    escreverArquivo(nome, texto);
    if (nivelMsg === 'erro' || nivelMsg === 'aviso') {
      escreverArquivo(`erros-${dataArquivo()}.log`, texto);
    }
  }

  // Apaga logs antigos (nao deixa a pasta crescer para sempre)
  function limparAntigos() {
    if (!pastaOk) return { apagados: 0 };
    let apagados = 0;
    try {
      const limite = Date.now() - diasDeLog * 24 * 60 * 60 * 1000;
      for (const nome of fs.readdirSync(pasta)) {
        if (!nome.endsWith('.log')) continue;
        const completo = path.join(pasta, nome);
        try {
          if (fs.statSync(completo).mtimeMs < limite) {
            fs.unlinkSync(completo);
            apagados += 1;
          }
        } catch (e) {
          /* segue */
        }
      }
    } catch (e) {
      /* segue */
    }
    return { apagados };
  }

  return {
    nivel,
    pasta,
    pastaOk,
    limparAntigos,
    debug: (m, e) => registrar('debug', m, e),
    info: (m, e) => registrar('info', m, e),
    aviso: (m, e) => registrar('aviso', m, e),
    erro: (m, e) => registrar('erro', m, e),
  };
}

module.exports = { criarRegistro };
