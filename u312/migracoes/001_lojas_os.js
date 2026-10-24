// Migracao 001 - lojas e Ordens de Servico
//
// O que esta migracao faz (tudo ADITIVO: nenhum dado existente e apagado ou trocado de formato):
//   1. cria a lista de lojas        -> data.lojas
//   2. cria a lista de OS           -> data.os  (vazia)
//   3. cria o contador por loja     -> data.osSequencia
//   4. marca em que loja estao os dados que ja existiam (padrao: UNICAR)
//      -> campos "loja" em pneus, movimentos, garantias, bebidas, bebidasMov e usuarios
//   5. grava a versao do formato    -> data.schemaVersao = 2
//
// O que ela NAO faz: nao apaga, nao renomeia, nao muda valores, nao toca em senhas,
// sessoes, quantidades, precos ou auditoria. Nao cria dado ficticio.

const crypto = require('crypto');
const { LOJAS_PADRAO, LOJA_PADRAO_DADOS, normalizarCodigo } = require('../lojas');

const VERSAO_ALVO = 2;
const VERSAO_ANTERIOR = 1;
// Colecoes que ganham o campo "loja" (as que representam movimento da loja)
const COLECOES_COM_LOJA = ['pneus', 'movimentos', 'garantias', 'bebidas', 'bebidasMov', 'usuarios'];

function contar(data) {
  const contagens = {};
  for (const chave of ['pneus', 'movimentos', 'garantias', 'bebidas', 'bebidasMov', 'usuarios', 'sessoes', 'auditoria', 'os', 'lojas']) {
    if (Array.isArray(data[chave])) contagens[chave] = data[chave].length;
  }
  return contagens;
}

// ---------- simulacao (nao grava nada) ----------
function simular(data) {
  const antes = contar(data);
  const acoes = [];
  if (!Array.isArray(data.lojas) || data.lojas.length === 0) {
    acoes.push(`Criar a lista de lojas: ${LOJAS_PADRAO.map((l) => l.codigo).join(', ')}`);
  }
  if (!Array.isArray(data.os)) acoes.push('Criar a lista de Ordens de Serviço (vazia)');
  if (!data.osSequencia || typeof data.osSequencia !== 'object') acoes.push('Criar o contador de numeração de OS por loja');

  let comLoja = 0;
  let semLoja = 0;
  for (const colecao of COLECOES_COM_LOJA) {
    const lista = Array.isArray(data[colecao]) ? data[colecao] : [];
    for (const registro of lista) {
      if (registro && registro.loja) comLoja += 1;
      else semLoja += 1;
    }
  }
  if (semLoja) acoes.push(`Marcar ${semLoja} registro(s) existente(s) como loja ${LOJA_PADRAO_DADOS}`);
  if (comLoja) acoes.push(`Preservar ${comLoja} registro(s) que já têm loja definida`);

  // Usuarios: o administrador continua com acesso a todas as lojas
  const admins = (data.usuarios || []).filter((u) => u && u.perfil === 'admin');
  const naoAdmins = (data.usuarios || []).filter((u) => u && u.perfil !== 'admin');
  if (admins.length) acoes.push(`Administrador(es) mantidos com acesso a todas as lojas: ${admins.map((u) => u.usuario).join(', ')}`);
  if (naoAdmins.length) acoes.push(`Usuário(s) não administrador(es) passam a ser da loja ${LOJA_PADRAO_DADOS}: ${naoAdmins.map((u) => u.usuario).join(', ')}`);

  acoes.push(`Gravar a versão do formato de dados: ${VERSAO_ANTERIOR} → ${VERSAO_ALVO}`);
  return {
    versaoAtual: Number(data.schemaVersao || VERSAO_ANTERIOR),
    versaoAlvo: VERSAO_ALVO,
    contagensAntes: antes,
    acoes,
    registrosSemLoja: semLoja,
    registrosComLoja: comLoja,
  };
}

// ---------- aplicar ----------
function aplicar(data) {
  const relatorio = simular(data);
  if (Number(data.schemaVersao || VERSAO_ANTERIOR) >= VERSAO_ALVO) {
    // ja migrado: garante o formato e nao mexe em mais nada
    garantirBase(data);
    return { ...relatorio, jaMigrado: true };
  }

  garantirBase(data);

  const tocados = {};
  for (const colecao of COLECOES_COM_LOJA) {
    const lista = Array.isArray(data[colecao]) ? data[colecao] : [];
    let marcados = 0;
    for (const registro of lista) {
      if (!registro || typeof registro !== 'object') continue;
      if (registro.loja) continue;
      if (colecao === 'usuarios' && registro.perfil === 'admin') {
        registro.loja = null; // administrador: todas as lojas
      } else {
        registro.loja = LOJA_PADRAO_DADOS;
      }
      marcados += 1;
    }
    if (marcados) tocados[colecao] = marcados;
  }

  data.schemaVersao = VERSAO_ALVO;
  if (!Array.isArray(data.migracoes)) data.migracoes = [];
  data.migracoes.push({
    versao: VERSAO_ALVO,
    nome: '001_lojas_os',
    quando: Date.now(),
    id: crypto.randomUUID(),
    lojaPadrao: LOJA_PADRAO_DADOS,
    tocados,
    contagens: contar(data),
  });

  return { ...relatorio, aplicada: true, tocados, contagensDepois: contar(data) };
}

function garantirBase(data) {
  if (!Array.isArray(data.lojas) || data.lojas.length === 0) {
    data.lojas = LOJAS_PADRAO.map((l) => ({ ...l }));
  }
  if (!Array.isArray(data.os)) data.os = [];
  if (!data.osSequencia || typeof data.osSequencia !== 'object' || Array.isArray(data.osSequencia)) {
    data.osSequencia = {};
  }
  for (const loja of data.lojas) {
    const codigo = normalizarCodigo(loja.codigo || loja.nome);
    loja.codigo = codigo;
    if (typeof data.osSequencia[codigo] !== 'number') {
      const existentes = data.os.filter((o) => o.loja === codigo).length;
      data.osSequencia[codigo] = existentes;
    }
  }
  return data;
}

// ---------- reverter ----------
// Remove apenas o que a migracao criou. Se ja existirem OS cadastradas, a reversao e
// recusada (apagar OS seria perder trabalho real) — nesse caso, so com --forcar.
function reverter(data, { forcar = false } = {}) {
  const marcador = Array.isArray(data.migracoes)
    ? [...data.migracoes].reverse().find((m) => m.versao === VERSAO_ALVO)
    : null;

  const quantasOS = Array.isArray(data.os) ? data.os.length : 0;
  if (quantasOS > 0 && !forcar) {
    return {
      recusada: true,
      motivo: `Existem ${quantasOS} OS cadastrada(s). Reverter apagaria essas ordens. `
        + 'Faça backup e, se tiver certeza, rode com --forcar.',
      quantasOS,
      contagens: contar(data),
    };
  }

  const tocados = (marcador && marcador.tocados) || {};
  const removidos = {};
  const preservados = {};

  for (const colecao of COLECOES_COM_LOJA) {
    const lista = Array.isArray(data[colecao]) ? data[colecao] : [];
    let limpos = 0;
    let mantidos = 0;
    for (const registro of lista) {
      if (!registro || typeof registro !== 'object') continue;
      const eraDesteMarcador = tocados[colecao] !== undefined;
      // So tira o campo se ele ainda estiver com o valor que a migracao colocou
      // (se alguem ja trocou a loja do registro, isso e dado novo: preserva)
      const valorDaMigracao = registro.perfil === 'admin' ? null : LOJA_PADRAO_DADOS;
      if (registro.loja !== undefined && (!eraDesteMarcador || registro.loja === valorDaMigracao)) {
        delete registro.loja;
        limpos += 1;
      } else if (registro.loja !== undefined) {
        mantidos += 1;
      }
    }
    if (limpos) removidos[colecao] = limpos;
    if (mantidos) preservados[colecao] = mantidos;
  }

  const contagensDepois = contar({ ...data, os: data.os, lojas: data.lojas });
  data.schemaVersao = VERSAO_ANTERIOR;
  delete data.lojas;
  delete data.os;
  delete data.osSequencia;
  if (Array.isArray(data.migracoes)) {
    data.migracoes = data.migracoes.filter((m) => m.versao !== VERSAO_ALVO);
    if (data.migracoes.length === 0) delete data.migracoes;
  }

  return {
    revertida: true,
    removidos,
    preservados,
    contagensAntes: contagensDepois,
    contagensDepois: contar(data),
    aviso: 'Campos "loja" que já tinham sido alterados manualmente foram mantidos.',
  };
}

module.exports = {
  VERSAO_ALVO,
  VERSAO_ANTERIOR,
  COLECOES_COM_LOJA,
  contar,
  simular,
  aplicar,
  reverter,
  garantirBase,
};
