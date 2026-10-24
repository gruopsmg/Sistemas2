// Ajuda dos testes do UNICAR (nao e um arquivo de teste: nao termina em .test.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');

// Pasta temporaria propria para cada teste (nunca toca em data.json de verdade)
function novaPasta(prefixo = 'unicar-teste-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

// Configuracao equivalente a de verdade, apontando para a pasta temporaria
function configDeTeste(pasta, extras = {}) {
  return Object.freeze({
    versao: '1.1.0',
    raiz: RAIZ,
    porta: 0,
    host: '127.0.0.1',
    arquivoDados: path.join(pasta, 'dados.json'),
    pastaBackups: path.join(pasta, 'backups'),
    pastaLogs: path.join(pasta, 'logs'),
    nivelLog: 'silencio',
    intervaloBackupMs: 6 * 60 * 60 * 1000,
    maxBackupArquivos: 60,
    limiteMovimentos: 500,
    limiteAuditoria: 3000,
    diasDeLog: 14,
    ambiente: 'teste',
    ...extras,
  });
}

// Registro que nao escreve nada (mantem a saida dos testes limpa)
const registroMudo = { debug() {}, info() {}, aviso() {}, erro() {} };

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sobe o servidor de verdade num processo separado, com dados proprios de teste.
async function subirServidor(pasta, extras = {}) {
  const porta = extras.porta || 0;
  const ambiente = {
    ...process.env,
    PORT: String(porta),
    HOST: '127.0.0.1',
    ARQUIVO_DADOS: path.join(pasta, 'dados.json'),
    PASTA_BACKUPS: path.join(pasta, 'backups'),
    PASTA_LOGS: path.join(pasta, 'logs'),
    NIVEL_LOG: process.env.NIVEL_LOG_TESTE || 'silencio',
    ...(extras.ambiente || {}),
  };
  const filho = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env: ambiente });
  const mostrarSaida = process.env.MOSTRAR_SAIDA_TESTE === '1';
  let saida = '';
  filho.stdout.on('data', (d) => {
    saida += d.toString();
    if (mostrarSaida) process.stdout.write(`[app] ${d}`);
  });
  filho.stderr.on('data', (d) => {
    saida += d.toString();
    if (mostrarSaida) process.stdout.write(`[app:err] ${d}`);
  });

  const base = `http://127.0.0.1:${porta}`;
  const limite = Date.now() + 15000;
  let saudavel = false;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) { saudavel = true; break; }
    } catch (e) {
      /* ainda subindo */
    }
    await esperar(150);
  }
  if (!saudavel) {
    try { filho.kill('SIGKILL'); } catch (e) { /* segue */ }
    throw new Error(`o servidor nao subiu na porta ${porta}. Saida:\n${saida}`);
  }
  return {
    filho,
    base,
    saida: () => saida,
    async encerrar() {
      if (filho.exitCode !== null) return;
      filho.kill('SIGTERM');
      const fim = Date.now() + 8000;
      while (filho.exitCode === null && Date.now() < fim) await esperar(100);
      if (filho.exitCode === null) { try { filho.kill('SIGKILL'); } catch (e) { /* segue */ } }
    },
  };
}

// Pedido HTTP simples que devolve {status, corpo, cabecalhos}
// O limite de tempo e proposital: se o servidor nao responder, o teste FALHA em vez de
// ficar pendurado para sempre (foi assim que descobrimos o pedido preso no Express 4).
async function pedir(base, caminho, opcoes = {}) {
  const r = await fetch(base + caminho, {
    method: opcoes.metodo || 'GET',
    headers: { ...(opcoes.cabecalhos || {}) },
    body: opcoes.corpo,
    redirect: 'manual',
    signal: AbortSignal.timeout(opcoes.limiteMs || 20000),
  });
  const tipo = r.headers.get('content-type') || '';
  const corpo = tipo.includes('json') ? await r.json().catch(() => null) : await r.text();
  return { status: r.status, corpo, cabecalhos: r.headers, bruto: r };
}

async function entrar(base, usuario, senha) {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario, senha }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, cookie, corpo: await r.json().catch(() => null) };
}

module.exports = { RAIZ, novaPasta, configDeTeste, registroMudo, subirServidor, esperar, pedir, entrar };
