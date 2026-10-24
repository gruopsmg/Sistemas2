// Linha de base de regressao do UNICAR.
//
// Sobe o sistema numa pasta temporaria (dados proprios), entra como admin e percorre as rotas GET,
// guardando para cada uma: rota, metodo, status e o SHA-256 do corpo (mais o tamanho).
// NAO guarda o conteudo: so a "impressao digital" — assim o arquivo nao carrega dado de cliente,
// mas ainda serve para comparar depois e ver o que mudou.
//
// Uso: node scripts/linha_de_base.js [arquivo-de-saida.json]
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SAIDA = process.argv[2] || path.join(RAIZ, 'linha_de_base.json');
const PORTA = 4900 + crypto.randomInt(0, 90);

const ROTAS = [
  { metodo: 'GET', rota: '/health', publica: true },
  { metodo: 'GET', rota: '/login.html', publica: true },
  { metodo: 'GET', rota: '/', publica: true, espera: 302 },
  { metodo: 'GET', rota: '/index.html', publica: true, espera: 302 },
  { metodo: 'GET', rota: '/data.json', publica: true, espera: 404 },
  { metodo: 'GET', rota: '/backups/data-0000.json', publica: true, espera: 404 },
  { metodo: 'GET', rota: '/api/state', publica: false },
  { metodo: 'GET', rota: '/api/eu', publica: false },
  { metodo: 'GET', rota: '/api/usuarios', publica: false },
  { metodo: 'GET', rota: '/api/auditoria', publica: false },
  { metodo: 'GET', rota: '/api/auditoria?limit=5', publica: false },
  { metodo: 'GET', rota: '/api/backups', publica: false },
  { metodo: 'GET', rota: '/api/diagnostico', publica: false },
  { metodo: 'GET', rota: '/api/rota-inexistente', publica: false, espera: 404 },
];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function principal() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'unicar-base-'));
  const filho = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(PORTA),
      HOST: '127.0.0.1',
      ARQUIVO_DADOS: path.join(pasta, 'dados.json'),
      PASTA_BACKUPS: path.join(pasta, 'backups'),
      PASTA_LOGS: path.join(pasta, 'logs'),
      NIVEL_LOG: 'silencio',
    },
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d.toString(); });
  filho.stderr.on('data', (d) => { saida += d.toString(); });

  const base = `http://127.0.0.1:${PORTA}`;
  const limite = Date.now() + 15000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch (e) { /* subindo */ }
    await espera(150);
  }

  // login para as rotas protegidas
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: 'admin', senha: 'unicar123' }),
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const linhas = [];
  for (const item of ROTAS) {
    try {
      const r = await fetch(base + item.rota, {
        method: item.metodo,
        headers: item.publica ? {} : { cookie },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      const texto = await r.text();
      linhas.push({
        metodo: item.metodo,
        rota: item.rota,
        acesso: item.publica ? 'sem-login' : 'com-login',
        status: r.status,
        statusEsperado: item.espera || 200,
        ok: r.status === (item.espera || 200),
        bytes: Buffer.byteLength(texto),
        sha256: crypto.createHash('sha256').update(texto).digest('hex'),
      });
    } catch (e) {
      linhas.push({ metodo: item.metodo, rota: item.rota, acesso: item.publica ? 'sem-login' : 'com-login', erro: `${e.name}: ${e.message}`, ok: false });
    }
  }

  const resultado = {
    geradoEm: new Date().toISOString(),
    versao: require(path.join(RAIZ, 'package.json')).version,
    node: process.version,
    observacao: 'Linha de base das rotas GET: guarda status e SHA-256 do corpo (sem conteudo). '
      + 'Serve para comparar depois e ver o que mudou.',
    rotas: linhas,
  };
  fs.writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));

  console.log('=== LINHA DE BASE ===');
  for (const l of linhas) {
    const marca = l.ok ? 'OK  ' : 'FALHA';
    console.log(`  ${marca} ${String(l.status || '-').padStart(3)} (esperado ${l.statusEsperado || 200})  ${l.rota.padEnd(28)} ${l.acesso}${l.erro ? '  ' + l.erro : ''}`);
  }
  const falhas = linhas.filter((l) => !l.ok).length;
  console.log(`rotas conferidas: ${linhas.length} | falhas: ${falhas}`);
  console.log('arquivo salvo em:', SAIDA);

  filho.kill('SIGTERM');
  await espera(1500);
  if (filho.exitCode === null) filho.kill('SIGKILL');
  return falhas;
}

principal().then((falhas) => process.exit(falhas ? 1 : 0)).catch((e) => {
  console.error('erro na linha de base:', e);
  process.exit(1);
});
