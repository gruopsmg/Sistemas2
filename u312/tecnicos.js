// UNICAR - Cadastro de técnicos / mecânicos
// ---------------------------------------------------------------------------
// O técnico NÃO precisa ter login no sistema: basta cadastrar aqui para ele aparecer
// na lista "Mecânico responsável" da OS. (Quem já tem usuário com perfil Mecânico/Técnico
// continua aparecendo na lista, como antes.)
//
// Regras:
//   * quem cadastra: administrador (qualquer loja) e gerente (só a própria loja);
//   * cada técnico pertence a uma loja; no admin pode ficar "todas as lojas" (loja vazia);
//   * não se apaga técnico que já está em alguma OS: ele é DESATIVADO (some da lista de
//     novas OS, mas as OS antigas continuam mostrando o nome);
//   * nome repetido na mesma loja não é permitido (compara sem acento/maiúscula).
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const CAMPOS_TEXTO = { nome: 100, telefone: 24, especialidade: 80, observacoes: 300 };

function texto(v, limite) {
  const t = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  return limite ? t.slice(0, limite) : t;
}

function chaveNome(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function garantirTecnicos(data) {
  if (!Array.isArray(data.tecnicos)) data.tecnicos = [];
  return data.tecnicos;
}

function tecnicoPublico(t) {
  return {
    id: t.id, nome: t.nome, telefone: t.telefone || '', especialidade: t.especialidade || '',
    observacoes: t.observacoes || '', loja: t.loja || '', ativo: t.ativo !== false,
    criadoEm: t.criadoEm || null, alteradoEm: t.alteradoEm || null,
  };
}

function osDoTecnico(data, id) {
  return (Array.isArray(data.os) ? data.os : []).filter((o) => o.mecanicoId === id).length;
}

// quem enxerga/mexe em qual técnico
function podeMexer(usuario, tecnico) {
  if (!usuario) return false;
  if (usuario.perfil === 'admin') return true;
  if (usuario.perfil !== 'gerente') return false;
  return !!usuario.loja && String(tecnico.loja || '').toUpperCase() === String(usuario.loja).toUpperCase();
}

function listar(data, usuario) {
  const lista = garantirTecnicos(data).filter((t) => (usuario.perfil === 'admin'
    ? true
    : !!usuario.loja && String(t.loja || '').toUpperCase() === String(usuario.loja).toUpperCase()));
  return lista
    .map((t) => ({ ...tecnicoPublico(t), osCount: osDoTecnico(data, t.id) }))
    .sort((a, b) => (a.ativo === b.ativo ? a.nome.localeCompare(b.nome, 'pt-BR') : (a.ativo ? -1 : 1)));
}

// Cria (sem id) ou edita (com id). Devolve { tecnico, criado } ou { erro, status }.
function salvar(data, b, usuario) {
  const lista = garantirTecnicos(data);
  const entrada = b || {};
  const existente = entrada.id ? lista.find((t) => t.id === String(entrada.id)) : null;
  if (entrada.id && !existente) return { erro: 'Técnico não encontrado.', status: 404 };
  if (existente && !podeMexer(usuario, existente)) return { erro: 'Este técnico é de outra loja.', status: 403 };

  const nome = texto(entrada.nome !== undefined ? entrada.nome : existente && existente.nome, CAMPOS_TEXTO.nome);
  if (!nome) return { erro: 'Informe o nome do técnico.', status: 400 };

  // loja: gerente só na própria; admin escolhe (vazio = todas as lojas)
  let loja;
  if (usuario.perfil === 'admin') {
    const pedida = entrada.loja !== undefined ? entrada.loja : (existente ? existente.loja : '');
    loja = String(pedida || '').trim().toUpperCase();
    if (loja) {
      const lojas = Array.isArray(data.lojas) ? data.lojas : [];
      if (lojas.length && !lojas.some((l) => l.codigo === loja)) return { erro: 'Loja inválida.', status: 400 };
    }
  } else {
    if (!usuario.loja) return { erro: 'Seu usuário não está ligado a nenhuma loja.', status: 403 };
    loja = String(usuario.loja).toUpperCase();
  }

  const repetido = lista.find((t) => t.id !== (existente && existente.id)
    && chaveNome(t.nome) === chaveNome(nome) && String(t.loja || '') === loja);
  if (repetido) return { erro: 'Já existe um técnico com esse nome nesta loja.', status: 400 };

  const agora = Date.now();
  const alvo = existente || { id: crypto.randomUUID(), criadoEm: agora };
  alvo.nome = nome;
  alvo.loja = loja;
  for (const campo of ['telefone', 'especialidade', 'observacoes']) {
    if (entrada[campo] !== undefined) alvo[campo] = texto(entrada[campo], CAMPOS_TEXTO[campo]);
    else if (alvo[campo] === undefined) alvo[campo] = '';
  }
  if (entrada.ativo !== undefined) alvo.ativo = entrada.ativo !== false && entrada.ativo !== 'false';
  else if (alvo.ativo === undefined) alvo.ativo = true;
  alvo.alteradoEm = agora;
  if (!existente) lista.push(alvo);
  return { tecnico: alvo, criado: !existente };
}

// Apaga de vez só quem nunca foi usado numa OS; senão, desativa.
function remover(data, id, usuario) {
  const lista = garantirTecnicos(data);
  const alvo = lista.find((t) => t.id === id);
  if (!alvo) return { erro: 'Técnico não encontrado.', status: 404 };
  if (!podeMexer(usuario, alvo)) return { erro: 'Este técnico é de outra loja.', status: 403 };
  if (osDoTecnico(data, id) > 0) {
    alvo.ativo = false;
    alvo.alteradoEm = Date.now();
    return { tecnico: alvo, desativado: true };
  }
  data.tecnicos = lista.filter((t) => t.id !== id);
  return { tecnico: alvo, apagado: true };
}

// Técnicos cadastrados, no formato da lista "Mecânico responsável" da OS
function paraListaDaOS(data, usuario, veTodas) {
  return garantirTecnicos(data)
    .filter((t) => t.ativo !== false)
    .filter((t) => veTodas || !t.loja || (usuario.loja && String(t.loja).toUpperCase() === String(usuario.loja).toUpperCase()))
    .map((t) => ({ id: t.id, nome: t.nome, perfil: 'mecanico', loja: t.loja || null, cadastro: true }));
}

module.exports = { garantirTecnicos, tecnicoPublico, listar, salvar, remover, paraListaDaOS, chaveNome };
