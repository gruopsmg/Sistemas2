// UNICAR - Configuracao do sistema
// Le variaveis de ambiente e, se existir, um arquivo .env na pasta do sistema.
// Sem instalar nada: o leitor de .env tem 15 linhas de codigo proprio.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const NIVEL_LOG_VALIDOS = ['debug', 'info', 'aviso', 'erro', 'silencio'];

// Le .env simples: CHAVE=valor, uma por linha, # comenta.
// O ambiente do sistema sempre ganha do arquivo .env.
function lerArquivoEnv(caminho) {
  const valores = {};
  if (!fs.existsSync(caminho)) return valores;
  let texto = '';
  try {
    texto = fs.readFileSync(caminho, 'utf-8');
  } catch (e) {
    return valores; // .env ilegivel nao pode impedir o sistema de subir
  }
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const igual = limpa.indexOf('=');
    if (igual === -1) continue;
    const chave = limpa.slice(0, igual).trim();
    let valor = limpa.slice(igual + 1).trim();
    if (valor.length >= 2) {
      const primeiro = valor[0];
      const ultimo = valor[valor.length - 1];
      if ((primeiro === '"' && ultimo === '"') || (primeiro === "'" && ultimo === "'")) {
        valor = valor.slice(1, -1);
      }
    }
    if (chave && !(chave in valores)) valores[chave] = valor;
  }
  return valores;
}

function inteiro(valor, padrao, { minimo = 1, maximo = Number.MAX_SAFE_INTEGER } = {}) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || Math.trunc(numero) !== numero || numero < minimo || numero > maximo) {
    return padrao;
  }
  return numero;
}

function texto(valor, padrao) {
  const v = valor === undefined || valor === null ? '' : String(valor).trim();
  return v || padrao;
}

function carregarConfig() {
  const doArquivo = lerArquivoEnv(path.join(RAIZ, '.env'));
  const ler = (chave) => (process.env[chave] !== undefined && process.env[chave] !== '' ? process.env[chave] : doArquivo[chave]);

  const nivelLog = texto(ler('NIVEL_LOG'), 'info').toLowerCase();
  const config = {
    versao: require('./package.json').version,
    raiz: RAIZ,
    porta: inteiro(ler('PORT'), 3000, { minimo: 1, maximo: 65535 }),
    host: texto(ler('HOST'), '0.0.0.0'),
    arquivoDados: path.resolve(RAIZ, texto(ler('ARQUIVO_DADOS'), 'data.json')),
    pastaBackups: path.resolve(RAIZ, texto(ler('PASTA_BACKUPS'), 'backups')),
    pastaLogs: path.resolve(RAIZ, texto(ler('PASTA_LOGS'), 'logs')),
    nivelLog: NIVEL_LOG_VALIDOS.includes(nivelLog) ? nivelLog : 'info',
    intervaloBackupMs: inteiro(ler('INTERVALO_BACKUP_MS'), 6 * 60 * 60 * 1000, { minimo: 60 * 1000 }),
    maxBackupArquivos: inteiro(ler('MAX_BACKUP_ARQUIVOS'), 60, { minimo: 1 }),
    limiteMovimentos: inteiro(ler('LIMITE_MOVIMENTOS'), 500, { minimo: 1 }),
    limiteBebidasMov: inteiro(ler('LIMITE_BEBIDAS_MOV'), 500, { minimo: 1 }),
    limiteAuditoria: inteiro(ler('LIMITE_AUDITORIA'), 3000, { minimo: 1 }),
    diasDeLog: inteiro(ler('DIAS_DE_LOG'), 14, { minimo: 1 }),
    ambiente: texto(ler('NODE_ENV'), 'producao'),
  };

  Object.freeze(config);

  // Confere o que, se estiver errado, derruba o sistema na subida (melhor falhar cedo e claro).
  // A validacao olha o valor BRUTO: um PORT digitado errado nao pode virar "3000" em silencio.
  const problemas = [];
  const brutoPorta = ler('PORT');
  if (brutoPorta !== undefined && String(brutoPorta).trim() !== '') {
    const numero = Number(brutoPorta);
    if (!Number.isInteger(numero) || numero < 1 || numero > 65535) {
      problemas.push(`PORT invalida: "${brutoPorta}" (use um numero de 1 a 65535)`);
    }
  }
  const brutoHost = ler('HOST');
  if (brutoHost !== undefined && String(brutoHost).trim() === '') {
    problemas.push('HOST vazio (apague a linha ou informe um endereco, ex.: 0.0.0.0)');
  }
  const brutoNivel = ler('NIVEL_LOG');
  if (brutoNivel !== undefined && !NIVEL_LOG_VALIDOS.includes(String(brutoNivel).toLowerCase())) {
    problemas.push(`NIVEL_LOG invalido: "${brutoNivel}" (use: ${NIVEL_LOG_VALIDOS.join(', ')})`);
  }
  const pastaDados = path.dirname(config.arquivoDados);
  if (!fs.existsSync(pastaDados)) {
    problemas.push(`a pasta do arquivo de dados nao existe: ${pastaDados}`);
  }

  return { config, problemas };
}

module.exports = { carregarConfig, lerArquivoEnv, RAIZ, NIVEL_LOG_VALIDOS };
