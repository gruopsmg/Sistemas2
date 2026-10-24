// UNICAR - Cadastro de clientes (base ÚNICA, compartilhada por todas as lojas)
// ---------------------------------------------------------------------------
// Pedido do dono (21/10): um botão "Clientes" com a lista completa, e ao abrir uma
// OS nova poder usar um cliente já salvo (ou cadastrar um novo na hora).
//
// Regras:
//   * a base é do GRUPO: qualquer loja vê e usa qualquer cliente (sem filtro de loja);
//   * todo usuário logado pode incluir e editar; apagar é só do administrador;
//   * a chave do cliente é o documento (CPF/CNPJ) quando existe; sem documento, o nome
//     normalizado (maiúsculas, sem acento, espaços colapsados);
//   * criar OS com cliente já existente NÃO duplica: atualiza o cadastro e conta a OS;
//   * nada é destrutivo: os campos antigos das OS continuam como estão.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const CAMPOS_TEXTO = {
  nome: 120, cpfCnpj: 24, telefone: 24, whatsapp: 24, email: 120, endereco: 200,
  bairro: 80, cidade: 80, cep: 12, rgIe: 24, contato: 80, midia: 40, referencia: 160,
};

function texto(v, limite) {
  const t = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  return limite ? t.slice(0, limite) : t;
}

function soDigitos(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\D+/g, '');
}

// nome comparável: sem acento, maiúsculo, sem pontuação, espaços simples
function normalizarNome(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chaveDocumento(v) {
  const d = soDigitos(v);
  return d.length >= 11 ? d : '';
}

function chaveDe(cliente) {
  const doc = chaveDocumento(cliente && cliente.cpfCnpj);
  if (doc) return `doc:${doc}`;
  const nome = normalizarNome(cliente && cliente.nome);
  return nome ? `nome:${nome}` : '';
}

function normalizarCliente(bruto, base) {
  const b = bruto || {};
  const saida = {};
  for (const [campo, limite] of Object.entries(CAMPOS_TEXTO)) {
    if (b[campo] !== undefined) saida[campo] = texto(b[campo], limite);
    else if (base && base[campo] !== undefined) saida[campo] = base[campo];
  }
  saida.nome = saida.nome !== undefined ? saida.nome : (base && base.nome) || '';
  return saida;
}

function garantirClientes(data) {
  if (!Array.isArray(data.clientes)) data.clientes = [];
  // Limpa NO LUGAR: trocar o array por um novo quebra quem já guardou a referência
  // (era o mesmo defeito do estoques.js: o push caía num array solto e o cliente sumia).
  const invalidos = data.clientes.filter((c) => !c || typeof c !== 'object');
  if (invalidos.length) {
    for (const lixo of invalidos) {
      const i = data.clientes.indexOf(lixo);
      if (i >= 0) data.clientes.splice(i, 1);
    }
  }
  if (data.clientesMigrados !== true) {
    migrarDeOS(data);
    data.clientesMigrados = true;
  }
  return data.clientes;
}

// Cria a base a partir das OS que já existem (uma vez). Não apaga nada.
function migrarDeOS(data) {
  const lista = Array.isArray(data.clientes) ? data.clientes : (data.clientes = []);
  const indice = new Map();
  for (const c of lista) {
    const k = chaveDe(c);
    if (k) indice.set(k, c);
  }
  let criados = 0;
  const ordens = Array.isArray(data.os) ? data.os : [];
  for (const os of ordens) {
    const cliente = os && os.cliente;
    if (!cliente || !texto(cliente.nome)) continue;
    const k = chaveDe(cliente);
    if (!k) continue;
    let alvo = indice.get(k);
    if (!alvo) {
      alvo = {
        id: crypto.randomUUID(),
        ...normalizarCliente(cliente),
        origem: 'os',
        criadoEm: os.aberturaEm || Date.now(),
        alteradoEm: os.aberturaEm || Date.now(),
        criadoPor: 'migração',
        osCount: 0,
        ultimoUsoEm: os.aberturaEm || null,
      };
      lista.push(alvo);
      indice.set(k, alvo);
      criados += 1;
    }
    alvo.osCount = (alvo.osCount || 0) + 1;
    if (!alvo.ultimoUsoEm || (os.aberturaEm || 0) > alvo.ultimoUsoEm) alvo.ultimoUsoEm = os.aberturaEm || alvo.ultimoUsoEm;
    for (const campo of Object.keys(CAMPOS_TEXTO)) {
      if (!alvo[campo] && texto(cliente[campo])) alvo[campo] = texto(cliente[campo], CAMPOS_TEXTO[campo]);
    }
    if (os) os.clienteId = os.clienteId || alvo.id;
  }
  return { criados, total: lista.length };
}

function acharCliente(data, id) {
  const lista = garantirClientes(data);
  return lista.find((c) => c.id === id) || null;
}

function acharPorChave(data, nome, documento) {
  const lista = garantirClientes(data);
  const doc = chaveDocumento(documento);
  if (doc) {
    const porDoc = lista.find((c) => chaveDocumento(c.cpfCnpj) === doc);
    if (porDoc) return porDoc;
  }
  const alvo = normalizarNome(nome);
  if (!alvo) return null;
  return lista.find((c) => normalizarNome(c.nome) === alvo) || null;
}

// Busca livre: nome (sem acento), CPF/CNPJ parcial, telefone.
function buscarClientes(data, termo, limite = 30) {
  const lista = garantirClientes(data);
  const t = texto(termo);
  if (!t) {
    return lista
      .slice()
      .sort((a, b) => normalizarNome(a.nome).localeCompare(normalizarNome(b.nome)))
      .slice(0, limite);
  }
  const nome = normalizarNome(t);
  const digitos = soDigitos(t);
  const achados = lista.filter((c) => {
    if (nome && normalizarNome(c.nome).includes(nome)) return true;
    if (digitos.length >= 3) {
      const campos = [c.cpfCnpj, c.telefone, c.whatsapp, c.cep].map(soDigitos).join(' ');
      if (campos.includes(digitos)) return true;
    }
    return false;
  });
  return achados
    .sort((a, b) => (b.osCount || 0) - (a.osCount || 0) || normalizarNome(a.nome).localeCompare(normalizarNome(b.nome)))
    .slice(0, limite);
}

// Cria ou atualiza. Devolve { cliente, criado }.
function salvarCliente(data, dados, usuario) {
  const lista = garantirClientes(data);
  const base = dados && dados.id ? acharCliente(data, dados.id) : null;
  const limpos = normalizarCliente(dados, base);
  if (!limpos.nome) return { erro: 'Informe o nome do cliente.' };

  // sem id: tenta achar pelo documento/nome para não duplicar
  let alvo = base || acharPorChave(data, limpos.nome, limpos.cpfCnpj);
  const agora = Date.now();
  if (alvo) {
    Object.assign(alvo, limpos, { alteradoEm: agora });
    if (usuario && usuario.nome) alvo.alteradoPor = usuario.nome;
    return { cliente: alvo, criado: false };
  }
  alvo = {
    id: crypto.randomUUID(),
    ...limpos,
    origem: 'manual',
    criadoEm: agora,
    alteradoEm: agora,
    criadoPor: (usuario && usuario.nome) || 'sistema',
    osCount: 0,
    ultimoUsoEm: null,
  };
  lista.push(alvo);
  return { cliente: alvo, criado: true };
}

// Ao salvar uma OS: usa o cliente escolhido ou cadastra/atualiza a partir do formulário.
function clienteDaOS(data, dadosCliente, clienteId, usuario) {
  const id = clienteId ? String(clienteId) : '';
  const existente = id ? acharCliente(data, id) : null;
  const nome = texto(dadosCliente && dadosCliente.nome);
  const doc = texto(dadosCliente && dadosCliente.cpfCnpj);
  if (!existente && !nome) return { data: { nome, cpfCnpj: doc }, criado: false };

  const resultado = existente
    ? salvarCliente(data, { ...dadosCliente, nome: nome || existente.nome, id: existente.id }, usuario)
    : salvarCliente(data, { ...dadosCliente, nome, cpfCnpj: doc }, usuario);
  if (resultado.erro) return { data: { nome, cpfCnpj: doc }, criado: false };

  const cliente = resultado.cliente;
  const agora = Date.now();
  cliente.osCount = (cliente.osCount || 0) + 1;
  cliente.ultimoUsoEm = agora;
  return { data: { ...normalizarCliente(cliente) }, clienteId: cliente.id, cliente, criado: resultado.criado };
}

function clientePublico(c) {
  if (!c) return null;
  const saida = { id: c.id, osCount: c.osCount || 0, ultimoUsoEm: c.ultimoUsoEm || null };
  for (const campo of Object.keys(CAMPOS_TEXTO)) saida[campo] = c[campo] || '';
  return saida;
}

function removerCliente(data, id) {
  const lista = garantirClientes(data);
  const i = lista.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const alvo = lista[i];
  if ((alvo.osCount || 0) > 0) return { erro: 'Este cliente tem OS registradas. Não pode ser apagado.' };
  lista.splice(i, 1);
  return true;
}

// ---------------------------------------------------------------- importação
const COLUNAS = {
  nome: ['nome', 'cliente', 'razao', 'razão', 'nome/razao', 'nome/razão', 'nome razao'],
  cpfCnpj: ['cpf', 'cnpj', 'cpf/cnpj', 'cpfcnpj', 'documento', 'cpf_cnpj'],
  telefone: ['telefone', 'fone', 'tel', 'contato'],
  whatsapp: ['celular', 'whatsapp', 'cel', 'radio', 'rádio', 'celular/radio'],
  rgIe: ['rg', 'ie', 'rg/ie', 'identidade'],
  endereco: ['endereco', 'endereço', 'rua', 'logradouro'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio', 'município', 'cidade-uf', 'cidade/uf'],
  cep: ['cep'],
  email: ['email', 'e-mail'],
  contato: ['contato'],
};

function detectarSeparador(linha) {
  const opcoes = [['\t', (linha.match(/\t/g) || []).length], [';', (linha.match(/;/g) || []).length], ['|', (linha.match(/\|/g) || []).length]];
  opcoes.sort((a, b) => b[1] - a[1]);
  if (opcoes[0][1] > 0) return opcoes[0][0];
  if ((linha.match(/,/g) || []).length >= 2 && !/\d,\d/.test(linha)) return ',';
  return null;
}

function mapearCabecalho(celulas) {
  const mapa = {};
  celulas.forEach((celula, i) => {
    const c = normalizarNome(celula).toLowerCase();
    for (const [campo, nomes] of Object.entries(COLUNAS)) {
      if (nomes.some((n) => c === normalizarNome(n).toLowerCase())) { mapa[campo] = i; break; }
    }
  });
  return mapa;
}

// Aceita CSV/TXT com cabeçalho ou linhas soltas ("NOME 123.456.789-00 (22) 99999-9999").
function lerLista(conteudo) {
  const linhas = String(conteudo || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return { clientes: [], ignoradas: 0 };
  const sep = detectarSeparador(linhas[0]);
  const primeira = sep ? linhas[0].split(sep) : [linhas[0]];
  const mapa = mapearCabecalho(primeira);
  const temCabecalho = Object.keys(mapa).length > 0 && mapa.nome !== undefined;
  const inicio = temCabecalho ? 1 : 0;
  const clientes = [];
  let ignoradas = 0;

  for (let i = inicio; i < linhas.length; i += 1) {
    const linha = linhas[i];
    let cliente = null;
    if (temCabecalho && sep) {
      const c = linha.split(sep).map((x) => x.trim());
      cliente = {};
      for (const [campo, idx] of Object.entries(mapa)) cliente[campo] = c[idx] || '';
    } else {
      // linha solta: tenta achar CPF/CNPJ e telefone; o resto é o nome
      const doc = linha.match(/\d{2,3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
      const fone = linha.match(/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/);
      let nome = linha;
      if (doc) nome = nome.replace(doc[0], ' ');
      if (fone) nome = nome.replace(fone[0], ' ');
      nome = nome.replace(/[;|\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      cliente = { nome, cpfCnpj: doc ? doc[0] : '', telefone: fone ? fone[0] : '' };
    }
    const nome = texto(cliente.nome);
    if (!nome || normalizarNome(nome).length < 3) { ignoradas += 1; continue; }
    clientes.push(cliente);
  }
  return { clientes, ignoradas, temCabecalho };
}

// Prévia: diz o que aconteceria (nada é gravado).
function previaImportacao(data, conteudo) {
  const { clientes, ignoradas, temCabecalho } = lerLista(conteudo);
  const vistos = new Set();
  const novos = [];
  const atualizados = [];
  for (const bruto of clientes) {
    const k = chaveDe(bruto);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    const existente = acharPorChave(data, bruto.nome, bruto.cpfCnpj);
    if (existente) atualizados.push({ ...bruto, existente: clientePublico(existente) });
    else novos.push(bruto);
  }
  return { novos, atualizados, ignoradas, total: clientes.length, temCabecalho };
}

function aplicarImportacao(data, conteudo, usuario) {
  const { clientes } = lerLista(conteudo);
  let criados = 0;
  let atualizados = 0;
  for (const bruto of clientes) {
    if (!texto(bruto.nome)) continue;
    const existente = acharPorChave(data, bruto.nome, bruto.cpfCnpj);
    const r = salvarCliente(data, existente ? { ...bruto, id: existente.id } : bruto, usuario);
    if (r.erro) continue;
    if (r.criado) criados += 1; else atualizados += 1;
  }
  return { criados, atualizados, total: criados + atualizados };
}

module.exports = {
  CAMPOS_TEXTO, texto, soDigitos, normalizarNome, chaveDocumento, chaveDe,
  normalizarCliente, garantirClientes, migrarDeOS, acharCliente, acharPorChave,
  buscarClientes, salvarCliente, clienteDaOS, clientePublico, removerCliente,
  lerLista, previaImportacao, aplicarImportacao,
};
