// SMG GROUP - Chat interno entre as lojas + chamados
//
// Regras (definidas pelo dono, conferidas por teste):
//  - uma sala por par de lojas (falar com cada outra loja), um grupo geral e a sala "Chamados";
//  - cada loja so ve as conversas em que participa; o administrador ve tudo;
//  - apagar mensagem: so administrador (a mensagem nao some do arquivo: fica marcada como apagada);
//  - chamado tem titulo, mensagem, prioridade, foto opcional, vinculo opcional e status;
//  - "visto" por mensagem e por chamado (e o que desliga o alarme sonoro na tela);
//  - tudo que muda fica na auditoria (quem abriu, quem respondeu, quem apagou).
//
// Este modulo e puro: nao escreve arquivo nem fala com socket. O server.js chama e emite.

const TIPOS_SALA = ['geral', 'loja', 'chamados'];
const STATUS_CHAMADO = ['aberto', 'em atendimento', 'resolvido'];
const PRIORIDADES = ['normal', 'urgente'];
const SALA_GERAL = 'geral';
const SALA_CHAMADOS = 'chamados';

function texto(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim();
}

function chave(valor) {
  return texto(valor).toUpperCase();
}

// Id estavel do par de lojas: UNICAR+FILIAL -> "loja:filial-unicar"
function idSalaDaLoja(a, b) {
  const par = [chave(a), chave(b)].filter(Boolean).sort();
  return `loja:${par.join('-').toLowerCase()}`;
}

function codigosDaLojaSala(salaId) {
  const bruto = String(salaId || '').replace(/^loja:/, '');
  return bruto.split('-').map(chave).filter(Boolean);
}

// Cria as salas que faltam (idempotente: pode rodar a cada leitura sem duplicar).
function garantirChat(data, lojas) {
  if (!data || typeof data !== 'object') return data;
  for (const nome of ['chatSalas', 'chatMensagens', 'chamados']) {
    if (!Array.isArray(data[nome])) data[nome] = [];
  }
  const codigos = (Array.isArray(lojas) ? lojas : [])
    .map((l) => chave(typeof l === 'string' ? l : l && l.codigo))
    .filter(Boolean);
  if (!codigos.length) return data;

  const temSala = (id) => data.chatSalas.some((s) => s && s.id === id);

  if (!temSala(SALA_GERAL)) {
    data.chatSalas.push({
      id: SALA_GERAL,
      tipo: 'geral',
      nome: 'Grupo geral',
      participantes: [...codigos],
      criadoEm: Date.now(),
    });
  } else {
    const sala = data.chatSalas.find((s) => s.id === SALA_GERAL);
    sala.participantes = [...codigos];
  }

  if (!temSala(SALA_CHAMADOS)) {
    data.chatSalas.push({
      id: SALA_CHAMADOS,
      tipo: 'chamados',
      nome: 'Chamados',
      participantes: [...codigos],
      criadoEm: Date.now(),
    });
  }

  for (let i = 0; i < codigos.length; i += 1) {
    for (let j = i + 1; j < codigos.length; j += 1) {
      const id = idSalaDaLoja(codigos[i], codigos[j]);
      if (temSala(id)) continue;
      const a = codigos[i];
      const b = codigos[j];
      data.chatSalas.push({
        id,
        tipo: 'loja',
        nome: `${a} ↔ ${b}`,
        participantes: [a, b],
        criadoEm: Date.now(),
      });
    }
  }
  return data;
}

// Quais salas esse usuario enxerga (admin: todas)
function salasVisiveis(data, usuario) {
  garantirChat(data, data && data.lojas);
  const todas = data.chatSalas;
  if (!usuario) return [];
  if (usuario.perfil === 'admin') return todas.slice();
  const loja = chave(usuario.loja);
  if (!loja) return [];
  return todas.filter((s) => Array.isArray(s.participantes) && s.participantes.map(chave).includes(loja));
}

function podeVerSala(data, usuario, salaId) {
  return salasVisiveis(data, usuario).some((s) => s.id === salaId);
}

// ---------- mensagens ----------
function criarMensagem(data, { salaId, usuario, texto: corpo, tipo = 'mensagem' }) {
  garantirChat(data, data && data.lojas);
  const limpo = texto(corpo);
  if (!limpo) return { ok: false, erro: 'Escreva a mensagem.' };
  if (limpo.length > 4000) return { ok: false, erro: 'Mensagem muito longa (máximo 4000 caracteres).' };
  if (!podeVerSala(data, usuario, salaId)) return { ok: false, erro: 'Você não participa desta conversa.' };
  const msg = {
    id: require('crypto').randomUUID(),
    salaId,
    autorId: usuario.id || null,
    autor: usuario.nome || 'Alguém',
    loja: chave(usuario.loja) || null,
    texto: limpo,
    tipo: tipo === 'sistema' ? 'sistema' : 'mensagem',
    criadoEm: Date.now(),
    vistoPor: [], // [{ usuarioId, nome, em }]
    apagada: false,
  };
  data.chatMensagens.unshift(msg);
  const limite = 4000;
  if (data.chatMensagens.length > limite) data.chatMensagens.length = limite;
  return { ok: true, mensagem: msg };
}

function marcarSalaVista(data, { salaId, usuario }) {
  garantirChat(data, data && data.lojas);
  let marcadas = 0;
  const agora = Date.now();
  for (const msg of data.chatMensagens) {
    if (msg.salaId !== salaId) continue;
    if (!Array.isArray(msg.vistoPor)) msg.vistoPor = [];
    if (msg.vistoPor.some((v) => v.usuarioId === usuario.id)) continue;
    msg.vistoPor.push({ usuarioId: usuario.id || null, nome: usuario.nome || '', em: agora });
    marcadas += 1;
  }
  return marcadas;
}

function apagarMensagem(data, { mensagemId, usuario }) {
  const msg = data.chatMensagens.find((m) => m.id === mensagemId);
  if (!msg) return { ok: false, erro: 'Mensagem não encontrada.' };
  if (usuario.perfil !== 'admin') return { ok: false, erro: 'Só o administrador pode apagar mensagem.' };
  msg.apagada = true;
  msg.apagadaPor = usuario.nome || '';
  msg.apagadaEm = Date.now();
  msg.texto = '';
  return { ok: true, mensagem: msg };
}

// ---------- chamados ----------
function proximoNumeroChamado(data) {
  const ano = new Date().getFullYear();
  const doAno = data.chamados.filter((c) => String(c.numero || '').startsWith(`CH-${ano}-`));
  return `CH-${ano}-${String(doAno.length + 1).padStart(4, '0')}`;
}

function criarChamado(data, usuario, entrada = {}) {
  garantirChat(data, data && data.lojas);
  const titulo = texto(entrada.titulo);
  const mensagem = texto(entrada.mensagem);
  if (!titulo) return { ok: false, erro: 'Escreva o título do chamado.' };
  if (!mensagem) return { ok: false, erro: 'Escreva a mensagem do chamado.' };
  const de = chave(entrada.de || usuario.loja);
  const para = chave(entrada.para);
  if (!de || !para) return { ok: false, erro: 'Informe a loja de origem e a loja que vai atender.' };
  if (de === para) return { ok: false, erro: 'O chamado tem que ser para outra loja.' };
  const prioridade = PRIORIDADES.includes(entrada.prioridade) ? entrada.prioridade : 'normal';
  const agora = Date.now();
  const chamado = {
    id: require('crypto').randomUUID(),
    numero: proximoNumeroChamado(data),
    de,
    para,
    titulo,
    mensagem,
    prioridade,
    foto: texto(entrada.foto) || null, // data URL da imagem (opcional)
    vinculo: entrada.vinculo && typeof entrada.vinculo === 'object' ? {
      tipo: texto(entrada.vinculo.tipo), // 'pneu' | 'os' | 'transferencia' | 'medida'
      id: texto(entrada.vinculo.id),
      rotulo: texto(entrada.vinculo.rotulo),
    } : null,
    status: 'aberto',
    criadoEm: agora,
    criadoPor: usuario.nome || '',
    criadoPorId: usuario.id || null,
    vistoPor: [], // quem ja viu (desliga o alarme)
    mensagens: [{
      id: require('crypto').randomUUID(),
      autor: usuario.nome || '',
      loja: de,
      texto: mensagem,
      criadoEm: agora,
      tipo: 'abertura',
    }],
    historico: [{ em: agora, usuario: usuario.nome || '', acao: 'aberto', texto: `Chamado aberto por ${de} para ${para}.` }],
  };
  data.chamados.unshift(chamado);
  return { ok: true, chamado };
}

function acharChamado(data, chaveChamado) {
  const alvo = texto(chaveChamado);
  if (!alvo) return null;
  return data.chamados.find((c) => c.id === alvo || String(c.numero).toUpperCase() === alvo.toUpperCase()) || null;
}

function podeVerChamado(usuario, chamado) {
  if (!usuario || !chamado) return false;
  if (usuario.perfil === 'admin') return true;
  const loja = chave(usuario.loja);
  return !!loja && (chave(chamado.de) === loja || chave(chamado.para) === loja);
}

function responderChamado(data, usuario, chaveChamado, corpo) {
  const chamado = acharChamado(data, chaveChamado);
  if (!chamado) return { ok: false, erro: 'Chamado não encontrado.' };
  if (!podeVerChamado(usuario, chamado)) return { ok: false, erro: 'Este chamado é de outra loja.' };
  const limpo = texto(corpo);
  if (!limpo) return { ok: false, erro: 'Escreva a resposta.' };
  const agora = Date.now();
  chamado.mensagens.push({
    id: require('crypto').randomUUID(),
    autor: usuario.nome || '',
    loja: chave(usuario.loja) || 'admin',
    texto: limpo,
    criadoEm: agora,
    tipo: 'resposta',
  });
  if (chamado.status === 'aberto') chamado.status = 'em atendimento';
  chamado.historico.push({ em: agora, usuario: usuario.nome || '', acao: 'respondeu', texto: 'Respondeu o chamado (status: em atendimento).' });
  return { ok: true, chamado };
}

function mudarStatusChamado(data, usuario, chaveChamado, novoStatus) {
  const chamado = acharChamado(data, chaveChamado);
  if (!chamado) return { ok: false, erro: 'Chamado não encontrado.' };
  if (!podeVerChamado(usuario, chamado)) return { ok: false, erro: 'Este chamado é de outra loja.' };
  if (!STATUS_CHAMADO.includes(novoStatus)) return { ok: false, erro: 'Status de chamado inválido.' };
  const antes = chamado.status;
  if (antes === novoStatus) return { ok: true, chamado };
  chamado.status = novoStatus;
  chamado.historico.push({
    em: Date.now(),
    usuario: usuario.nome || '',
    acao: 'status',
    texto: `Status: ${antes} → ${novoStatus}.`,
  });
  return { ok: true, chamado };
}

// "Visto" do chamado -> desliga o alarme sonoro de quem clicou
function marcarChamadoVisto(data, usuario, chaveChamado) {
  const chamado = acharChamado(data, chaveChamado);
  if (!chamado) return { ok: false, erro: 'Chamado não encontrado.' };
  if (!podeVerChamado(usuario, chamado)) return { ok: false, erro: 'Este chamado é de outra loja.' };
  if (!Array.isArray(chamado.vistoPor)) chamado.vistoPor = [];
  const jaViu = chamado.vistoPor.some((v) => v.usuarioId === usuario.id);
  if (!jaViu) {
    chamado.vistoPor.push({ usuarioId: usuario.id || null, nome: usuario.nome || '', em: Date.now() });
  }
  return { ok: true, chamado, jaViu };
}

// Quantas mensagens/chamados esse usuario ainda nao viu (contador do menu)
function naoLidas(data, usuario) {
  garantirChat(data, data && data.lojas);
  const salas = new Set(salasVisiveis(data, usuario).map((s) => s.id));
  const porSala = {};
  let total = 0;
  for (const msg of data.chatMensagens) {
    if (!salas.has(msg.salaId)) continue;
    if (msg.autorId && msg.autorId === usuario.id) continue; // o que eu escrevi nao conta
    const visto = Array.isArray(msg.vistoPor) && msg.vistoPor.some((v) => v.usuarioId === usuario.id);
    if (visto) continue;
    porSala[msg.salaId] = (porSala[msg.salaId] || 0) + 1;
    total += 1;
  }
  const chamadosAbertos = data.chamados.filter((c) => podeVerChamado(usuario, c)
    && c.status !== 'resolvido'
    && !(Array.isArray(c.vistoPor) && c.vistoPor.some((v) => v.usuarioId === usuario.id)));
  return { total: total + chamadosAbertos.length, porSala, chamados: chamadosAbertos.length };
}

module.exports = {
  TIPOS_SALA,
  STATUS_CHAMADO,
  PRIORIDADES,
  SALA_GERAL,
  SALA_CHAMADOS,
  idSalaDaLoja,
  codigosDaLojaSala,
  garantirChat,
  salasVisiveis,
  podeVerSala,
  criarMensagem,
  marcarSalaVista,
  apagarMensagem,
  criarChamado,
  acharChamado,
  podeVerChamado,
  responderChamado,
  mudarStatusChamado,
  marcarChamadoVisto,
  naoLidas,
};
