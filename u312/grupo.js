// UNICAR - Identidade do SISTEMA e marca da TELA DE LOGIN
//
// O sistema (telas, topo, título da aba, rodapé, relatórios) continua UNICAR, como antes.
// O que é configurável aqui é a MARCA DA TELA DE LOGIN (nome, subtítulo e logo) — o dono
// usa "SMG GROUP" no login e mantém UNICAR dentro do sistema.
//
// O QUE NÃO MUDA: código interno das lojas (UNICAR/FILIAL/MATRIZ), marca de cada loja
// (marcas.js) e os números de OS já emitidos.

const GRUPO_PADRAO = {
  // tela de login (o que o administrador edita em Configurações)
  loginNome: 'SMG GROUP',
  loginSubtitulo: 'Gestão de estoque e serviços',
  loginLogo: '/logos/grupo-2026-login.png',
  // sistema
  prefixoOS: 'OS', // vazio/OS = numeração de sempre: OS-UNICAR-000001
  criadoEm: null,
  atualizadoEm: null,
};

function texto(valor, padrao = '') {
  const t = valor === undefined || valor === null ? '' : String(valor).trim();
  return t || padrao;
}

// v3.0.7: a logo do grupo mudou de arquivo. Quem já tinha o caminho antigo salvo é migrado
// (sem apagar nada: só troca o caminho padrão antigo pelo novo).
const LOGO_ANTIGA = '/logos/logo_login.png';

function garantirGrupo(data) {
  if (!data || typeof data !== 'object') return { ...GRUPO_PADRAO };
  const atual = data.grupo && typeof data.grupo === 'object' && !Array.isArray(data.grupo) ? data.grupo : {};
  // Compatibilidade: se o dado já tiver os campos antigos (nome/subtitulo/logo), aproveita
  // como marca do login (foi assim que a 3.0.0 gravou) — nada é perdido.
  const logoSalva = texto(atual.loginLogo, texto(atual.logo, GRUPO_PADRAO.loginLogo));
  data.grupo = {
    loginNome: texto(atual.loginNome, texto(atual.nome, GRUPO_PADRAO.loginNome)),
    loginSubtitulo: texto(atual.loginSubtitulo, texto(atual.subtitulo, GRUPO_PADRAO.loginSubtitulo)),
    // a logo antiga (arquivo da 3.0.2) vira a logo nova do grupo; upload personalizado é mantido
    loginLogo: logoSalva === LOGO_ANTIGA ? GRUPO_PADRAO.loginLogo : logoSalva,
    prefixoOS: normalizarPrefixo(atual.prefixoOS),
    criadoEm: atual.criadoEm || Date.now(),
    atualizadoEm: atual.atualizadoEm || null,
  };
  return data.grupo;
}

// Prefixo das OS: 'OS' (ou vazio) = numeração de sempre (OS-UNICAR-000001).
// Qualquer outro valor entra como bloco extra: OS-SMG-UNICAR-000001.
function normalizarPrefixo(valor) {
  const limpo = String(valor === undefined || valor === null ? '' : valor)
    .trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '');
  return limpo || 'OS';
}

// Aplica o que o administrador mandou da tela de Configurações (marca do login + prefixo).
function atualizarGrupo(data, entrada = {}) {
  const grupo = garantirGrupo(data);
  if (entrada.loginNome !== undefined || entrada.nome !== undefined) {
    grupo.loginNome = texto(entrada.loginNome !== undefined ? entrada.loginNome : entrada.nome, grupo.loginNome);
  }
  if (entrada.loginSubtitulo !== undefined || entrada.subtitulo !== undefined) {
    // subtítulo é o único que pode ficar vazio de propósito? não: mantém o atual se vier vazio
    grupo.loginSubtitulo = texto(entrada.loginSubtitulo !== undefined ? entrada.loginSubtitulo : entrada.subtitulo, grupo.loginSubtitulo);
  }
  if (entrada.loginLogo !== undefined && texto(entrada.loginLogo)) grupo.loginLogo = texto(entrada.loginLogo);
  if (entrada.prefixoOS !== undefined) grupo.prefixoOS = normalizarPrefixo(entrada.prefixoOS);
  grupo.atualizadoEm = Date.now();
  return grupo;
}

// Nome de exibição da loja: é o nome que está no cadastro (UNICAR/FILIAL/MATRIZ por padrão).
function nomeDaLoja(data, codigo) {
  const alvo = String(codigo || '').trim().toUpperCase();
  const lista = Array.isArray(data && data.lojas) ? data.lojas : [];
  const loja = lista.find((l) => String(l.codigo).toUpperCase() === alvo);
  return (loja && texto(loja.nome)) || alvo;
}

module.exports = {
  GRUPO_PADRAO,
  garantirGrupo,
  atualizarGrupo,
  normalizarPrefixo,
  nomeDaLoja,
};
