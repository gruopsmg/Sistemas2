// UNICAR - Marca de cada loja (logo, marca d'água e nome do cabeçalho)
//
// As imagens ficam em public/logos (o Express já serve /logos/...). Este módulo só diz
// QUAL arquivo usar em cada loja e como escrever o nome no topo e na OS.
// Para trocar uma logo: substitua o arquivo em public/logos com o mesmo nome.

const LOJAS_MARCA = {
  // A cor é a da logomarca de cada loja (usada nos acentos da OS impressa e do timbrado).
  UNICAR: {
    titulo: 'AUTO CENTER UNICAR',
    subtitulo: 'São Pedro da Aldeia - RJ · Estoque de pneus',
    logo: 'loja_UNICAR_logo.webp',
    marcaDagua: 'marca_agua_UNICAR.png',
    cor: '#d02b2b', // vermelho da logo
  },
  MATRIZ: {
    titulo: 'MATRIZ',
    subtitulo: 'Estoque de pneus',
    logo: 'loja_MATRIZ_logo.webp',
    marcaDagua: 'marca_agua_MATRIZ.png',
    cor: '#e39012', // laranja/amarelo da logo
  },
  FILIAL: {
    titulo: 'FILIAL',
    subtitulo: 'Estoque de pneus',
    logo: 'loja_FILIAL_logo.webp',
    marcaDagua: 'marca_agua_FILIAL.png',
    cor: '#a5182f', // vinho da logo
  },
};

// Marca do sistema para quem não tem loja (administrador) ou loja sem logo cadastrada.
const MARCA_SISTEMA = {
  titulo: 'UNICAR',
  subtitulo: 'Estoque de pneus',
  logo: '',
  marcaDagua: '',
  cor: '#b3121b',
};

function normalizar(codigo) {
  return String(codigo || '').trim().toUpperCase();
}

function marcaDaLoja(codigo) {
  const chave = normalizar(codigo);
  const marca = LOJAS_MARCA[chave];
  if (!marca) return { ...MARCA_SISTEMA };
  return {
    codigo: chave,
    titulo: marca.titulo,
    subtitulo: marca.subtitulo,
    logo: `/logos/${marca.logo}`,
    marcaDagua: `/logos/${marca.marcaDagua}`,
    cor: marca.cor || MARCA_SISTEMA.cor,
  };
}

// Caminho da logo/marca d'água para o documento (sempre relativo à raiz do site).
function arquivoLogo(codigo) {
  return marcaDaLoja(codigo).logo;
}

function arquivoMarcaDagua(codigo) {
  return marcaDaLoja(codigo).marcaDagua;
}

module.exports = { LOJAS_MARCA, MARCA_SISTEMA, marcaDaLoja, arquivoLogo, arquivoMarcaDagua };
