// UNICAR - Perfis de usuario e permissoes (regra de acesso)
//
// Perfis do sistema (as chaves internas continuam 'admin' e 'operador' para nao quebrar
// nada do que ja existe; 'gerente' e 'mecanico' sao novos):
//   admin      -> Administrador      (todas as lojas)
//   gerente    -> Gerente            (somente a loja dele)
//   operador   -> Operador/Atendente (somente a loja dele)
//   mecanico   -> Mecanico/Tecnico   (somente a loja dele, e nas OS dele)
//
// Este arquivo e a UNICA fonte da verdade sobre "quem pode o que".
// A tela apenas esconde o que a pessoa nao pode; quem decide de verdade e o servidor.

const PERFIS = ['admin', 'gerente', 'operador', 'mecanico'];
const PERFIL_PADRAO = 'operador';

// Como cada perfil aparece na tela
const PERFIL_ROTULO = {
  admin: 'Administrador',
  gerente: 'Gerente',
  operador: 'Operador/Atendente',
  mecanico: 'Mecânico/Técnico',
};

// O que cada perfil pode fazer. Ninguem usa esta tabela "no escuro":
// as rotas chamam pode(perfil, 'chave') antes de agir.
const PODERES = {
  admin: {
    verTodasAsLojas: true,
    administrarUsuarios: true,
    verConfiguracoes: true,
    verRelatorioGeral: true,
    verPainelDaLoja: true,
    verOS: true,
    criarOS: true,
    editarOS: true,
    editarValores: true,
    mudarStatus: true,
    cancelarOS: true,
    editarServicos: true,
    atribuirMecanico: true,
    excluirOS: true,
  },
  gerente: {
    verTodasAsLojas: false,
    administrarUsuarios: false, // gerente nao cria/edita usuarios (o pedido diz: nao cria administradores)
    verConfiguracoes: false,
    verRelatorioGeral: false,
    verPainelDaLoja: true,
    verOS: true,
    criarOS: true,
    editarOS: true,
    editarValores: true,
    mudarStatus: true,
    cancelarOS: true,
    editarServicos: true,
    atribuirMecanico: true,
    excluirOS: false,
  },
  operador: {
    verTodasAsLojas: false,
    administrarUsuarios: false,
    verConfiguracoes: false,
    verRelatorioGeral: false,
    verPainelDaLoja: true,
    verOS: true,
    criarOS: true,
    editarOS: true,
    editarValores: true, // pode mexer em valores enquanto a OS nao foi aprovada (ver os.js)
    mudarStatus: true,
    cancelarOS: false,
    editarServicos: true,
    atribuirMecanico: false,
    excluirOS: false,
  },
  mecanico: {
    verTodasAsLojas: false,
    administrarUsuarios: false,
    verConfiguracoes: false,
    verRelatorioGeral: false,
    verPainelDaLoja: false,
    verOS: true,
    criarOS: false,
    editarOS: true, // so servicos e observacoes tecnicas, apenas nas OS dele
    editarValores: false,
    mudarStatus: false,
    cancelarOS: false,
    editarServicos: true,
    atribuirMecanico: false,
    excluirOS: false,
  },
};

const STATUS_OS = [
  'aberta',
  'em analise',
  'aguardando aprovacao',
  'aprovada',
  'em execucao',
  'aguardando peca',
  'finalizada',
  'entregue',
  'cancelada',
];

const STATUS_ROTULO = {
  'aberta': 'Aberta',
  'em analise': 'Em análise',
  'aguardando aprovacao': 'Aguardando aprovação',
  'aprovada': 'Aprovada',
  'em execucao': 'Em execução',
  'aguardando peca': 'Aguardando peça',
  'finalizada': 'Finalizada',
  'entregue': 'Entregue',
  'cancelada': 'Cancelada',
};

// Aceita variacoes de escrita (com acento, maiuscula) e devolve a chave interna
function normalizarStatus(valor) {
  const limpo = String(valor === undefined || valor === null ? '' : valor)
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
  if (!limpo) return '';
  const direto = STATUS_OS.find((s) => s === limpo);
  if (direto) return direto;
  // "aguardando aprovacao" tambem pode vir como "aguardando aprovacao do cliente"
  const parcial = STATUS_OS.find((s) => limpo.startsWith(s));
  return parcial || '';
}

function normalizarPerfil(valor) {
  const limpo = String(valor === undefined || valor === null ? '' : valor)
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acento: "mecânico" -> "mecanico"
    .replace(/\s+/g, ' ');
  if (limpo === 'administrador') return 'admin';
  if (limpo === 'operador/atendente' || limpo === 'atendente' || limpo === 'operador') return 'operador';
  if (limpo === 'mecanico/tecnico' || limpo === 'tecnico' || limpo === 'mecanico') return 'mecanico';
  return PERFIS.includes(limpo) ? limpo : PERFIL_PADRAO;
}

function permissoesDoPerfil(perfil) {
  return { ...(PODERES[normalizarPerfil(perfil)] || PODERES[PERFIL_PADRAO]) };
}

// Atalho usado nas rotas: pode('operador', 'cancelarOS') -> false
function pode(perfil, chave) {
  const tabela = PODERES[normalizarPerfil(perfil)] || PODERES[PERFIL_PADRAO];
  return !!tabela[chave];
}

// Administrador enxerga todas as lojas; os demais, so a loja do cadastro
function veTodasAsLojas(usuario) {
  return !!usuario && pode(usuario.perfil, 'verTodasAsLojas');
}

// A loja que o usuario pode acessar (null = todas, no caso do admin)
function lojaDoUsuario(usuario) {
  if (!usuario) return null;
  if (veTodasAsLojas(usuario)) return null;
  return usuario.loja || null;
}

// Regra central de acesso a um registro de uma loja
function podeAcessarLoja(usuario, lojaDoRegistro) {
  if (!usuario) return false;
  if (veTodasAsLojas(usuario)) return true;
  if (!usuario.loja) return false; // usuario sem loja definida nao acessa nada
  return String(usuario.loja).toUpperCase() === String(lojaDoRegistro || '').toUpperCase();
}

module.exports = {
  PERFIS,
  PERFIL_PADRAO,
  PERFIL_ROTULO,
  PODERES,
  STATUS_OS,
  STATUS_ROTULO,
  normalizarPerfil,
  normalizarStatus,
  permissoesDoPerfil,
  pode,
  veTodasAsLojas,
  lojaDoUsuario,
  podeAcessarLoja,
};
