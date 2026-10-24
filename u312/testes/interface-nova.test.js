// Testes de guarda da interface nova (celular + identidade + arquivos servidos).
// São testes de FONTE (rápidos, sem navegador): garantem que as regras que fizemos na mão
// continuem valendo se alguém mexer no CSS/JS depois.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf-8');

test('celular de 390 px: as telas novas têm regra de quebra (sem rolagem lateral)', () => {
  const html = ler('public/index.html');
  assert.match(html, /@media \(max-width: 760px\)/, 'precisa existir o bloco de celular');
  const bloco = html.slice(html.indexOf('@media (max-width: 760px)'));
  assert.match(bloco, /\.topbar-actions \{[^}]*flex-wrap: wrap/, 'as ações do topo precisam quebrar linha');
  assert.match(bloco, /\.chat-grid \{ grid-template-columns: 1fr/, 'o chat precisa virar uma coluna');
  assert.match(bloco, /\.table-wrap \{ overflow-x: auto/, 'tabela larga rola dentro da caixa, não na página');
});

test('o JS novo não inventa cores: usa só as variáveis do tema', () => {
  const fonte = ler('public/smg.js');
  execFileSync(process.execPath, ['--check', path.join(RAIZ, 'public', 'smg.js')]);
  const semVariaveis = fonte.replace(/var\(--[a-z-]+[^)]*\)/g, '');
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(semVariaveis), 'smg.js não pode ter cor fixa (#rrggbb)');
  assert.ok(!/rgb\(\s*\d/.test(semVariaveis), 'smg.js não pode ter cor rgb() fixa');
});

test('a logo do GRUPO existe; a OS segue numerando como antes', () => {
  assert.ok(fs.existsSync(path.join(RAIZ, 'public', 'logos', 'grupo-2026-login.png')), 'logo do grupo (login) precisa existir');
  const grupo = require('../grupo');
  assert.strictEqual(grupo.GRUPO_PADRAO.loginLogo, '/logos/grupo-2026-login.png');
  assert.strictEqual(grupo.GRUPO_PADRAO.loginNome, 'SMG GROUP');
  assert.strictEqual(grupo.GRUPO_PADRAO.prefixoOS, 'OS', 'padrão = numeração de OS igual à de antes');
  const marcas = require('../marcas');
  assert.strictEqual(marcas.MARCA_SISTEMA.titulo, 'UNICAR', 'a marca do sistema é UNICAR');
  assert.strictEqual(marcas.LOJAS_MARCA.UNICAR.titulo, 'AUTO CENTER UNICAR');
});

test('o chat tem alarme que repete e botão Visto (som não pode tocar para sempre)', () => {
  const fonte = ler('public/smg.js');
  assert.match(fonte, /iniciarAlarme/, 'precisa existir o alarme');
  assert.match(fonte, /setInterval\([\s\S]{0,400}30000/, 'o alarme precisa repetir a cada 30 s');
  assert.match(fonte, /btnVistoAlarme/, 'precisa ter o botão Visto que para o alarme');
  assert.match(fonte, /pararAlarme/, 'precisa existir como parar o alarme');
  assert.match(fonte, /AudioContext/, 'a sirene é gerada pelo navegador (Web Audio)');
  assert.match(fonte, /btnAtivarSons/, 'precisa do botão "Ativar sons" (o navegador exige clique)');
});

test('a marca do sistema no HTML continua UNICAR (o SMG é só na tela de login)', () => {
  const html = ler('public/index.html');
  assert.ok(html.includes('<h1>UNI<span class="hl">CAR</span></h1>'), 'marca do topo continua UNICAR');
  assert.ok(html.includes('<title>UNICAR · Estoque de Pneus (rede local)</title>'), 'título da aba continua UNICAR');
  assert.ok(!html.includes('Logo SMG GROUP'), 'o HTML do sistema não deve trocar a logo pelo SMG');
  const login = ler('public/login.html');
  assert.ok(login.includes('marcaNome'), 'a tela de login carrega o nome da marca do servidor');
});
