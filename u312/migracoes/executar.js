#!/usr/bin/env node
// Executor de migracoes do UNICAR
//
// Uso (na pasta do sistema):
//   node migracoes/executar.js                  -> SIMULA (nao grava nada)
//   node migracoes/executar.js --simular        -> idem
//   node migracoes/executar.js --aplicar        -> aplica (com backup antes e conferencia depois)
//   node migracoes/executar.js --reverter       -> desfaz a migracao
//   node migracoes/executar.js --reverter --forcar  -> desfaz mesmo com OS cadastradas
//   --arquivo=<caminho>  aponta para outro arquivo de dados (padrao: ARQUIVO_DADOS/.env ou data.json)
//
// Regras de seguranca desta ferramenta:
//  - simula por padrao; nada e gravado sem --aplicar/--reverter
//  - sempre faz uma copia do arquivo ANTES de gravar (data.json.antes-migracao-AAAAMMDD-HHMMSS)
//  - nunca deixa diminuir a quantidade de registros: se diminuir, restaura o backup e sai com erro
//  - grava de forma atomica (arquivo temporario + troca) e confere o resultado relendo o arquivo

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const migracao = require('./001_lojas_os');

const args = process.argv.slice(2);
const temFlag = (nome) => args.includes(nome);
const valorDe = (nome) => {
  const arg = args.find((a) => a.startsWith(`${nome}=`));
  return arg ? arg.slice(nome.length + 1) : null;
};

function caminhoDados() {
  const doArg = valorDe('--arquivo');
  if (doArg) return path.resolve(doArg);
  try {
    const { carregarConfig } = require('../config');
    return carregarConfig().config.arquivoDados;
  } catch (e) {
    return path.resolve(__dirname, '..', 'data.json');
  }
}

function sha256(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex');
}

function lerJson(caminho) {
  const texto = fs.readFileSync(caminho, 'utf-8');
  try {
    return JSON.parse(texto);
  } catch (e) {
    console.error(`\n*** Nao consegui ler o arquivo de dados: ${caminho}`);
    console.error(`*** Motivo: ${e.message}`);
    console.error('*** Nada foi alterado. Restaure uma copia de backups/ e tente de novo.\n');
    process.exit(2);
  }
}

function gravarAtomico(caminho, dados) {
  const tmp = `${caminho}.tmp`;
  const texto = JSON.stringify(dados, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, texto);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, caminho);
}

function copiaDeSeguranca(caminho) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const destino = `${caminho}.antes-migracao-${stamp}`;
  fs.copyFileSync(caminho, destino);
  return { destino, sha256: sha256(destino) };
}

function conferirNaoPerdeuNada(antes, depois) {
  const problemas = [];
  for (const [chave, quantos] of Object.entries(antes)) {
    if (chave === 'lojas') continue; // criada pela migracao
    const agora = depois[chave] || 0;
    if (agora < quantos) problemas.push(`${chave}: tinha ${quantos}, ficou com ${agora}`);
  }
  return problemas;
}

function imprimirSimulacao(relatorio) {
  console.log('\n=== SIMULACAO (nada foi gravado) ===');
  console.log(`versao do formato: ${relatorio.versaoAtual} -> ${relatorio.versaoAlvo}`);
  console.log('\nO que vai mudar:');
  for (const acao of relatorio.acoes) console.log(`  - ${acao}`);
  console.log('\nRegistros hoje:');
  for (const [chave, quantos] of Object.entries(relatorio.contagensAntes)) console.log(`  ${chave.padEnd(12)} ${quantos}`);
}

function principal() {
  const caminho = caminhoDados();
  if (!fs.existsSync(caminho)) {
    console.error(`\n*** Arquivo de dados nao encontrado: ${caminho}\n`);
    process.exit(2);
  }
  const dados = lerJson(caminho);
  const antes = migracao.contar(dados);

  const reverter = temFlag('--reverter');
  const aplicar = temFlag('--aplicar');
  const forcar = temFlag('--forcar');

  console.log(`arquivo: ${caminho}`);
  console.log(`sha256 : ${sha256(caminho)}`);

  if (!reverter && !aplicar) {
    imprimirSimulacao(migracao.simular(dados));
    console.log('\nPara aplicar de verdade: node migracoes/executar.js --aplicar\n');
    return;
  }

  // ---- REVERTER ----
  if (reverter) {
    const resultado = migracao.reverter(dados, { forcar });
    if (resultado.recusada) {
      console.error('\n*** REVERSAO RECUSADA');
      console.error(`*** ${resultado.motivo}\n`);
      process.exit(3);
    }
    const backup = copiaDeSeguranca(caminho);
    gravarAtomico(caminho, dados);
    const depois = migracao.contar(lerJson(caminho));
    console.log('\n=== MIGRACAO REVERTIDA ===');
    console.log('campos "loja" removidos:', JSON.stringify(resultado.removidos));
    console.log('campos "loja" preservados (ja alterados por voces):', JSON.stringify(resultado.preservados));
    console.log('copia antes da reversao:', backup.destino);
    console.log('contagens depois:', JSON.stringify(depois));
    console.log(`sha256 agora: ${sha256(caminho)}`);
    console.log(`\nPara voltar atras desta reversao: copie ${backup.destino} por cima de ${path.basename(caminho)}\n`);
    return;
  }

  // ---- APLICAR ----
  const resultado = migracao.aplicar(dados);
  const depois = migracao.contar(dados);
  const problemas = conferirNaoPerdeuNada(antes, depois);
  if (problemas.length) {
    console.error('\n*** MIGRACAO ABORTADA (alguma lista diminuiria):');
    for (const p of problemas) console.error(`  - ${p}`);
    console.error('Nada foi gravado.\n');
    process.exit(4);
  }

  imprimirSimulacao(migracao.simular(lerJson(caminho)));
  const backup = copiaDeSeguranca(caminho);
  gravarAtomico(caminho, dados);

  // Conferencia final: rele o arquivo gravado
  const relido = lerJson(caminho);
  const contagens = migracao.contar(relido);
  const problemasDepois = conferirNaoPerdeuNada(antes, contagens);
  if (problemasDepois.length || !Array.isArray(relido.os) || !Array.isArray(relido.lojas)) {
    console.error('\n*** ALGO DEU ERRADO NA GRAVACAO. Restaurando a copia de seguranca...');
    fs.copyFileSync(backup.destino, caminho);
    console.error(`*** Arquivo restaurado de: ${backup.destino}\n`);
    process.exit(5);
  }

  console.log('\n=== MIGRACAO APLICADA ===');
  console.log('registros marcados com loja:', JSON.stringify(resultado.tocados));
  console.log('lojas criadas:', relido.lojas.map((l) => l.codigo).join(', '));
  console.log('versao do formato agora:', relido.schemaVersao);
  console.log('copia de antes:', backup.destino);
  console.log('contagens depois:');
  for (const [chave, quantos] of Object.entries(contagens)) {
    console.log(`  ${chave.padEnd(12)} ${quantos}${antes[chave] !== undefined && antes[chave] === quantos ? '  (igual)' : ''}`);
  }
  console.log(`\nsha256 agora: ${sha256(caminho)}`);
  console.log('\nPara reverter: node migracoes/executar.js --reverter\n');
}

principal();
