// UNICAR - Lojas do sistema
//
// As tres lojas (UNICAR, FILIAL, MATRIZ) ficam guardadas dentro do data.json para poderem
// ser ajustadas depois (nome de exibicao, ativa/inativa) sem mexer no codigo.
// A migracao cria esta lista; o sistema tambem se protege se ela nao existir.

const LOJAS_PADRAO = [
  { codigo: 'UNICAR', nome: 'UNICAR', ativa: true, matriz: true, endereco: '', telefone: '', cnpj: '', cor: '' },
  { codigo: 'FILIAL', nome: 'FILIAL', ativa: true, matriz: false, endereco: '', telefone: '', cnpj: '', cor: '' },
  { codigo: 'MATRIZ', nome: 'MATRIZ', ativa: true, matriz: false, endereco: '', telefone: '', cnpj: '', cor: '' },
];

const LOJA_PADRAO_DADOS = 'UNICAR'; // loja atribuida aos dados que ja existiam (ver DECISOES.md)

function normalizarCodigo(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase();
}

function garantirLojas(data) {
  if (!Array.isArray(data.lojas) || data.lojas.length === 0) {
    data.lojas = LOJAS_PADRAO.map((l) => ({ ...l }));
    return data.lojas;
  }
  data.lojas = data.lojas.map((l) => {
    const codigo = normalizarCodigo(l && (l.codigo || l.nome));
    return {
      codigo,
      nome: String((l && l.nome) || codigo),
      ativa: (l && l.ativa) !== false,
      matriz: !!(l && l.matriz),
      // dados que saem no cabecalho da OS impressa (Configuracoes > Lojas)
      endereco: String((l && l.endereco) || ''),
      telefone: String((l && l.telefone) || ''),
      cnpj: String((l && l.cnpj) || ''),
      cor: String((l && l.cor) || ''),
    };
  }).filter((l) => l.codigo);
  if (data.lojas.length === 0) data.lojas = LOJAS_PADRAO.map((l) => ({ ...l }));
  return data.lojas;
}

function listarLojas(data, { somenteAtivas = false } = {}) {
  const lojas = garantirLojas(data);
  return lojas.filter((l) => (somenteAtivas ? l.ativa : true));
}

function acharLoja(data, codigo) {
  const alvo = normalizarCodigo(codigo);
  if (!alvo) return null;
  return garantirLojas(data).find((l) => l.codigo === alvo) || null;
}

function lojaValida(data, codigo) {
  const loja = acharLoja(data, codigo);
  return !!loja && loja.ativa !== false;
}

function rotuloLoja(data, codigo) {
  const loja = acharLoja(data, codigo);
  return loja ? loja.nome : normalizarCodigo(codigo);
}

function codigosDeLojas(data) {
  return garantirLojas(data).map((l) => l.codigo);
}

module.exports = {
  LOJAS_PADRAO,
  LOJA_PADRAO_DADOS,
  normalizarCodigo,
  garantirLojas,
  listarLojas,
  acharLoja,
  lojaValida,
  rotuloLoja,
  codigosDeLojas,
};
