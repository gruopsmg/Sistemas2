// Testes da configuracao: padroes, leitura de .env e recusa de valor invalido.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { novaPasta } = require('./ajuda');
const { carregarConfig, lerArquivoEnv } = require('../config');

function comAmbiente(trocar, executar) {
  const antes = {};
  for (const chave of Object.keys(trocar)) {
    antes[chave] = process.env[chave];
    if (trocar[chave] === undefined) delete process.env[chave];
    else process.env[chave] = trocar[chave];
  }
  try {
    return executar();
  } finally {
    for (const chave of Object.keys(trocar)) {
      if (antes[chave] === undefined) delete process.env[chave];
      else process.env[chave] = antes[chave];
    }
  }
}

const LIMPAS = {
  PORT: undefined, HOST: undefined, ARQUIVO_DADOS: undefined, PASTA_BACKUPS: undefined,
  PASTA_LOGS: undefined, NIVEL_LOG: undefined, INTERVALO_BACKUP_MS: undefined,
  MAX_BACKUP_ARQUIVOS: undefined, LIMITE_MOVIMENTOS: undefined, LIMITE_AUDITORIA: undefined,
  DIAS_DE_LOG: undefined, NODE_ENV: undefined,
};

test('sem configuracao nenhuma, os padroes sao os mesmos do sistema antigo', () => {
  comAmbiente(LIMPAS, () => {
    const { config, problemas } = carregarConfig();
    assert.strictEqual(config.porta, 3000, 'porta padrao continua 3000');
    assert.strictEqual(config.host, '0.0.0.0', 'host padrao continua todos os aparelhos da rede');
    assert.strictEqual(path.basename(config.arquivoDados), 'data.json');
    assert.strictEqual(path.basename(config.pastaBackups), 'backups');
    assert.strictEqual(config.limiteMovimentos, 500, 'limite de movimentos segue igual ao de antes');
    assert.strictEqual(config.limiteAuditoria, 3000, 'limite da auditoria segue igual ao de antes');
    assert.strictEqual(config.intervaloBackupMs, 6 * 60 * 60 * 1000);
    assert.strictEqual(config.maxBackupArquivos, 60);
    assert.deepStrictEqual(problemas, []);
  });
});

test('variaveis de ambiente mudam a configuracao', () => {
  comAmbiente({ ...LIMPAS, PORT: '3001', HOST: '127.0.0.1', LIMITE_MOVIMENTOS: '5000', NIVEL_LOG: 'aviso' }, () => {
    const { config, problemas } = carregarConfig();
    assert.strictEqual(config.porta, 3001);
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.limiteMovimentos, 5000);
    assert.strictEqual(config.nivelLog, 'aviso');
    assert.deepStrictEqual(problemas, []);
  });
});

test('valor invalido e recusado em vez de aceito em silencio', () => {
  comAmbiente({ ...LIMPAS, PORT: 'abc' }, () => {
    const { problemas } = carregarConfig();
    assert.ok(problemas.some((p) => p.includes('PORT')), 'PORT invalida precisa virar problema');
  });
  comAmbiente({ ...LIMPAS, PORT: '99999' }, () => {
    const { problemas } = carregarConfig();
    assert.ok(problemas.some((p) => p.includes('PORT')));
  });
  comAmbiente({ ...LIMPAS, NIVEL_LOG: 'barulhento' }, () => {
    const { problemas } = carregarConfig();
    assert.ok(problemas.some((p) => p.includes('NIVEL_LOG')));
  });
});

test('leitor de .env: comentarios, aspas e ambiente ganhando do arquivo', () => {
  const pasta = novaPasta();
  const arquivo = path.join(pasta, '.env');
  fs.writeFileSync(arquivo, [
    '# comentario',
    '',
    'PORT=3001',
    'HOST="127.0.0.1"',
    'NIVEL_LOG=aviso',
    'LINHA SEM IGUAL',
    'VAZIO=',
  ].join('\n'));

  const valores = lerArquivoEnv(arquivo);
  assert.strictEqual(valores.PORT, '3001');
  assert.strictEqual(valores.HOST, '127.0.0.1', 'aspas precisam ser removidas');
  assert.strictEqual(valores.NIVEL_LOG, 'aviso');
  assert.strictEqual(valores.VAZIO, '');
  assert.ok(!('LINHA SEM IGUAL' in valores));

  assert.deepStrictEqual(lerArquivoEnv(path.join(pasta, 'nao-existe.env')), {}, 'sem arquivo, sem valores');
});
