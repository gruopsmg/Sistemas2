// Chat interno: envio de mensagem de verdade (e não só a tela).
//
// Cobre o que já quebrou na loja: texto que sumia quando o envio falhava,
// conversa que não existia mais, usuário fora da conversa e o aviso por socket
// derrubando um envio que já tinha sido gravado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { novaPasta, subirServidor, pedir, entrar } = require('./ajuda');
const migracao = require('../migracoes/001_lojas_os');

const REFERENCIA = process.env.UNICAR_DADOS_REFERENCIA
  || path.join(__dirname, '..', '..', 'app-unicar', 'data.json');

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(senha), salt, 64).toString('hex')}`;
}

function preparar() {
  const pasta = novaPasta();
  const alvo = path.join(pasta, 'dados.json');
  fs.copyFileSync(REFERENCIA, alvo);
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf-8'));
  migracao.aplicar(dados);

  const admin = dados.usuarios.find((u) => u.perfil === 'admin');
  admin.senhaHash = hashSenha('teste123');
  admin.precisaTrocarSenha = false;

  // usuário de loja, para o caminho normal
  const operador = dados.usuarios.find((u) => u.perfil === 'operador') || dados.usuarios[1];
  operador.senhaHash = hashSenha('teste123');
  operador.ativo = true;
  operador.loja = operador.loja || 'UNICAR';

  // usuário SEM loja (é o caso que faz o envio falhar com "não participa")
  dados.usuarios.push({
    id: 'sem-loja-teste',
    usuario: 'semloja',
    nome: 'Sem Loja',
    perfil: 'operador',
    loja: '',
    ativo: true,
    senhaHash: hashSenha('teste123'),
    criadoEm: Date.now(),
  });

  dados.chatMensagens = [];
  dados.chamados = [];
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2));
  return { pasta, admin, operador };
}

const lerDados = (pasta) => JSON.parse(fs.readFileSync(path.join(pasta, 'dados.json'), 'utf-8'));

test('chat: envio grava a mensagem, valida e não perde o que foi escrito', async (t) => {
  const { pasta, operador } = preparar();
  const servidor = await subirServidor(pasta, { porta: 5970 + crypto.randomInt(0, 20) });
  t.after(async () => { await servidor.encerrar(); });
  const base = servidor.base;

  const loginAdmin = await entrar(base, 'admin', 'teste123');
  const loginOp = await entrar(base, operador.usuario, 'teste123');
  const loginSem = await entrar(base, 'semloja', 'teste123');
  assert.ok(loginOp.cookie, 'login do operador falhou');

  // 1) envio normal na conversa geral
  const texto = `mensagem de teste ${Date.now()}`;
  const envio = await pedir(base, '/api/chat/sala/geral/mensagem', {
    metodo: 'POST',
    corpo: JSON.stringify({ texto }),
    cabecalhos: { cookie: loginOp.cookie, 'content-type': 'application/json' },
  });
  assert.equal(envio.status, 200, JSON.stringify(envio.corpo));
  assert.equal(envio.corpo.mensagem.texto, texto);

  const gravada = lerDados(pasta).chatMensagens.find((m) => m.texto === texto);
  assert.ok(gravada, 'a mensagem não foi gravada no arquivo de dados');
  assert.equal(gravada.autorId, operador.id);

  // 2) texto vazio: 400 e nada gravado
  const antes = lerDados(pasta).chatMensagens.length;
  const vazia = await pedir(base, '/api/chat/sala/geral/mensagem', {
    metodo: 'POST',
    corpo: JSON.stringify({ texto: '   ' }),
    cabecalhos: { cookie: loginOp.cookie, 'content-type': 'application/json' },
  });
  assert.equal(vazia.status, 400);
  assert.match(vazia.corpo.error, /Escreva a mensagem/i);
  assert.equal(lerDados(pasta).chatMensagens.length, antes);

  // 3) conversa que não existe mais: 404 com mensagem clara
  const inexistente = await pedir(base, '/api/chat/sala/loja:que-nao-existe/mensagem', {
    metodo: 'POST',
    corpo: JSON.stringify({ texto: 'oi' }),
    cabecalhos: { cookie: loginOp.cookie, 'content-type': 'application/json' },
  });
  assert.equal(inexistente.status, 404);
  assert.match(inexistente.corpo.error, /não existe mais|nao existe mais/i);

  // 4) usuário sem loja não participa de conversa de loja: 403 e nada gravado
  const antesSem = lerDados(pasta).chatMensagens.length;
  const semLoja = await pedir(base, '/api/chat/sala/geral/mensagem', {
    metodo: 'POST',
    corpo: JSON.stringify({ texto: 'tentativa do sem loja' }),
    cabecalhos: { cookie: loginSem.cookie, 'content-type': 'application/json' },
  });
  assert.equal(semLoja.status, 403, JSON.stringify(semLoja.corpo));
  assert.match(semLoja.corpo.error, /não participa|nao participa/i);
  assert.equal(lerDados(pasta).chatMensagens.length, antesSem);

  // 5) admin sempre participa
  const doAdmin = await pedir(base, '/api/chat/sala/chamados/mensagem', {
    metodo: 'POST',
    corpo: JSON.stringify({ texto: 'mensagem do admin' }),
    cabecalhos: { cookie: loginAdmin.cookie, 'content-type': 'application/json' },
  });
  assert.equal(doAdmin.status, 200);

  // 6) duas mensagens seguidas: nenhuma se perde
  const total = lerDados(pasta).chatMensagens.length;
  for (const n of [1, 2, 3]) {
    const r = await pedir(base, '/api/chat/sala/geral/mensagem', {
      metodo: 'POST',
      corpo: JSON.stringify({ texto: `sequencia ${n}` }),
      cabecalhos: { cookie: loginOp.cookie, 'content-type': 'application/json' },
    });
    assert.equal(r.status, 200);
  }
  assert.equal(lerDados(pasta).chatMensagens.length, total + 3);
});

test('chat: o aviso por socket não pode derrubar um envio já gravado', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'api-novas.js'), 'utf-8');
  assert.match(
    fonte,
    /try \{ if \(ctx\.avisarChat\) ctx\.avisarChat\('mensagem'/,
    'o aviso por socket precisa estar protegido por try/catch (senão o envio volta 500 depois de gravar)',
  );
});

test('som: libera sozinho no primeiro toque e toca em mensagem nova e chamado', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'smg.js'), 'utf-8');
  assert.match(fonte, /function liberarSomSozinho/, 'falta a liberação automática do áudio');
  assert.match(fonte, /liberarSomSozinho\(\);/, 'a liberação automática precisa ser chamada ao abrir a tela');
  assert.match(fonte, /addEventListener\('pointerdown', liberar, true\)/, 'o som tem de liberar no primeiro clique');
  assert.match(fonte, /if \(autor !== euId\) tocarBipe\(\);/, 'mensagem de outra pessoa precisa tocar o bipe');
  assert.match(fonte, /iniciarAlarme\(chamado\)/, 'chamado novo precisa tocar a sirene');
});

test('chat: a tela não limpa o texto antes de o servidor confirmar', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'smg.js'), 'utf-8');
  const trecho = fonte.slice(fonte.indexOf('async function enviarMensagem'), fonte.indexOf('async function enviarMensagem') + 1600);
  const posEnvio = trecho.indexOf('await api(');
  const posLimpa = trecho.indexOf('campo.value = \'\'');
  assert.ok(posEnvio > 0, 'não achei a chamada de envio');
  assert.ok(posLimpa > posEnvio, 'o campo não pode ser limpo antes da resposta do servidor');
  assert.match(trecho, /se der erro|O texto continua no campo/i);
});
