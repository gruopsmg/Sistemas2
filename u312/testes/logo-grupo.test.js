// Testes da logo ÚNICA do grupo (topo, login e favicon) — v3.0.7
// Regra: topo/login/aba = logo do grupo, igual para todo mundo. Documentos (OS em duas vias e
// PDF do WhatsApp) continuam com a logo de CADA loja.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const grupo = require('../grupo');
const { marcaDaLoja } = require('../marcas');

const RAIZ = path.join(__dirname, '..');
const PUBLIC = path.join(RAIZ, 'public');

function ler(rel) { return fs.readFileSync(path.join(PUBLIC, rel), 'utf-8'); }

test('os arquivos da logo do grupo existem e têm o tamanho certo', () => {
  const arquivos = {
    'logos/grupo-2026.png': [76, 96],            // topo (2x de 48)
    'logos/grupo-2026-login.png': [381, 480],    // login (grande)
    'logos/grupo-2026-icon-32.png': [32, 32],    // favicon
    'logos/grupo-2026-icon-192.png': [192, 192], // atalho do celular
    'logos/apple-touch-icon-2026.png': [192, 192],
  };
  for (const [rel, [largura, altura]] of Object.entries(arquivos)) {
    const caminho = path.join(PUBLIC, rel);
    assert.ok(fs.existsSync(caminho), `falta ${rel}`);
    const d = fs.readFileSync(caminho).subarray(0, 33);
    assert.strictEqual(d.subarray(1, 4).toString(), 'PNG', `${rel} precisa ser PNG`);
    const w = d.readUInt32BE(16);
    const h = d.readUInt32BE(20);
    assert.strictEqual(w, largura, `${rel}: largura ${w} (esperado ${largura})`);
    assert.strictEqual(h, altura, `${rel}: altura ${h} (esperado ${altura})`);
  }
});

test('o padrão do grupo aponta para a logo nova (e migra quem tinha a antiga)', () => {
  assert.strictEqual(grupo.GRUPO_PADRAO.loginLogo, '/logos/grupo-2026-login.png');
  assert.strictEqual(grupo.GRUPO_PADRAO.loginNome, 'SMG GROUP');
  // dado antigo (3.0.2) é migrado sem perder upload personalizado
  const antigo = { grupo: { loginNome: 'SMG GROUP', loginLogo: '/logos/logo_login.png' } };
  assert.strictEqual(grupo.garantirGrupo(antigo).loginLogo, '/logos/grupo-2026-login.png');
  const personalizado = { grupo: { loginLogo: 'data:image/png;base64,AAAA' } };
  assert.strictEqual(grupo.garantirGrupo(personalizado).loginLogo, 'data:image/png;base64,AAAA');
});

test('favicon e atalho do celular apontam para os ícones novos (sem cache)', () => {
  for (const pagina of ['index.html', 'login.html']) {
    const html = ler(pagina);
    assert.match(html, /rel="icon"[^>]*grupo-2026-icon-32\.png\?v=3\.0\.7/, `${pagina}: ícone 32`);
    assert.match(html, /rel="icon"[^>]*grupo-2026-icon-192\.png\?v=3\.0\.7/, `${pagina}: ícone 192`);
    assert.match(html, /apple-touch-icon[^>]*apple-touch-icon-2026\.png\?v=3\.0\.7/, `${pagina}: atalho do celular`);
  }
});

test('a tela de login usa a logo grande do grupo', () => {
  const login = ler('login.html');
  assert.match(login, /src="\/logos\/grupo-2026-login\.png\?v=3\.0\.7"/);
  assert.ok(!/src="\/logos\/logo_login\.png"/.test(login), 'a logo antiga não pode ficar no HTML');
});

test('o TOPO do sistema é do grupo (a logo da loja não entra no cabeçalho)', () => {
  const html = ler('index.html');
  const smg = ler('smg.js');

  // o cabeçalho recebe a identidade do grupo...
  assert.match(html, /window\.unicarAplicarGrupo/, 'o topo precisa aplicar a marca do grupo');
  assert.ok(!/img\.src = marca\.logo;/.test(html), 'o topo não pode mais usar a logo da loja');
  assert.match(html, /brand-mark\.grupo-logo/, 'classe da logo do grupo (não esticar nem cortar)');
  assert.match(html, /object-fit: contain/, 'logo inteira, sem corte');

  // ...e o JS que aplica é o mesmo da tela de Configurações
  assert.match(smg, /function aplicarGrupoNoTopo/);
  assert.match(smg, /window\.unicarAplicarGrupo = \(\) => aplicarGrupoNoTopo/);
  assert.match(smg, /img\.classList\.add\('grupo-logo'\)/);
  assert.match(smg, /document\.querySelectorAll\('link\[rel="icon"\]'\)/, 'o favicon troca junto');
});

test('os documentos CONTINUAM com a logo de cada loja', async () => {
  // marcas.js segue com uma logo por loja...
  assert.match(marcaDaLoja('UNICAR').logo, /loja_UNICAR_logo\.webp/);
  assert.match(marcaDaLoja('MATRIZ').logo, /loja_MATRIZ_logo\.webp/);
  assert.match(marcaDaLoja('FILIAL').logo, /loja_FILIAL_logo\.webp/);

  // ...a OS em duas vias usa a logo da loja da OS...
  const { htmlImpressao } = require('../impressao-os');
  const os = { numero: 'OS-MATRIZ-000001', loja: 'MATRIZ', status: 'aberta', cliente: { nome: 'A' }, veiculo: {}, itens: [], total: 0, aberturaEm: Date.now() };
  const folha = htmlImpressao(os, { codigo: 'MATRIZ', nome: 'MATRIZ' });
  assert.ok(folha.includes('/logos/loja_MATRIZ_logo.webp'), 'OS impressa com a logo da MATRIZ');
  assert.ok(!folha.includes('grupo-2026'), 'a logo do grupo não entra na OS impressa');

  // ...e o PDF do WhatsApp também (o pdfkit usa o PNG da loja)
  const osPdf = require('../os-pdf');
  const pdf = await osPdf.gerarPDF(os, { codigo: 'MATRIZ', nome: 'MATRIZ' });
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  const pngLoja = path.join(PUBLIC, 'logos', 'pdf', 'loja_MATRIZ.png');
  assert.ok(fs.existsSync(pngLoja), 'o PNG da loja para o PDF precisa existir');
  assert.ok(pdf.length > 5000);
});

test('trocar a logo do grupo pela tela continua funcionando', () => {
  const smg = ler('smg.js');
  // o upload grava em /api/config/logo e a identidade é reaplicada no topo
  assert.match(smg, /\/api\/config\/logo/);
  assert.match(smg, /await aplicarIdentidade\(\)/);
  const api = fs.readFileSync(path.join(RAIZ, 'api-novas.js'), 'utf-8');
  assert.match(api, /config\/logo/);
});
