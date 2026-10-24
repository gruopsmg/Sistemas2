// UNICAR - Camada de armazenamento do data.json
//
// O que esta camada garante (e o que o codigo antigo nao garantia):
//  1. Arquivo ilegivel NUNCA e substituido por um arquivo vazio. O sistema tenta o
//     data.json.bak; se nenhum dos dois abrir, ele para com mensagem clara.
//  2. Gravacao atomica: escreve em data.json.tmp, confirma no disco (fsync) e renomeia
//     por cima. Queda de energia no meio nao trunca mais o arquivo.
//  3. Antes de cada gravacao, o arquivo bom anterior vira data.json.bak.
//  4. A fila de gravacao nao "envenena": um erro numa gravacao nao impede as seguintes.
//  5. Se o arquivo principal estiver ilegivel, o sistema entra em MODO SEGURO (somente
//     leitura) e recusa gravar, em vez de sobrescrever dado que pode ser recuperado.

const fs = require('fs');
const path = require('path');

// Campos novos (estoque por loja, identidade do grupo, chat) nascem na leitura, sem migracao
// destrutiva: nada e apagado, nada e renomeado no dado. Ver estoques.js / grupo.js / chat.js.
const estoquesMod = require('./estoques');
const lojasMod = require('./lojas');
const grupoMod = require('./grupo');
const chatMod = require('./chat');

const ERROS_QUE_VALEM_TENTAR_DE_NOVO = ['EPERM', 'EBUSY', 'EACCES', 'EMFILE'];

class ErroArmazenamento extends Error {
  constructor(mensagem, { status = 500, codigo = 'ERRO_DADOS', dica = '' } = {}) {
    super(mensagem);
    this.name = 'ErroArmazenamento';
    this.status = status;
    this.codigo = codigo;
    this.dica = dica;
  }
}

function estruturaVazia() {
  return {
    pneus: [],
    movimentos: [],
    garantias: [],
    bebidas: [],
    bebidasMov: [],
    usuarios: [],
    sessoes: [],
    auditoria: [],
    os: [],
    lojas: [],
    osSequencia: {},
  };
}

// Mantem compativel com data.json antigo (sem garantias, bebidas, usuarios ou auditoria)
function garantirFormato(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return estruturaVazia();
  const listas = ['pneus', 'movimentos', 'garantias', 'bebidas', 'bebidasMov', 'usuarios', 'sessoes', 'auditoria', 'os', 'lojas', 'chatSalas', 'chatMensagens', 'chamados', 'importacoes'];
  for (const nome of listas) {
    if (!Array.isArray(dados[nome])) dados[nome] = [];
  }
  if (!dados.osSequencia || typeof dados.osSequencia !== 'object' || Array.isArray(dados.osSequencia)) {
    dados.osSequencia = {};
  }

  // ---- campos novos (idempotentes: rodam a cada leitura e nao duplicam nada) ----
  // 1) lojas (o nome de exibicao continua sendo o do cadastro: UNICAR/FILIAL/MATRIZ)
  lojasMod.garantirLojas(dados);
  // 2) estoque separado por loja: quantidade que ja existia vai para a loja principal
  estoquesMod.migrarLista(dados.pneus, lojasMod.codigosDeLojas(dados));
  // 3) identidade do grupo (nome/subtitulo/logo/prefixo das OS novas)
  grupoMod.garantirGrupo(dados);
  // 4) salas do chat interno (geral, uma por par de lojas, chamados)
  chatMod.garantirChat(dados, dados.lojas);

  return dados;
}

// Espera sincrona curta (usada nas novas tentativas do rename no Windows)
function esperarBloqueando(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      /* ultimo recurso */
    }
  }
}

function clonar(dados) {
  return JSON.parse(JSON.stringify(dados));
}

function criarArmazenamento({ config, registro }) {
  const arquivo = config.arquivoDados;
  const arquivoBak = `${arquivo}.bak`;
  const arquivoTmp = `${arquivo}.tmp`;
  const pastaBackups = config.pastaBackups;

  let modoSeguro = null; // preenchido com o motivo quando o arquivo principal nao abre
  let dadosSeguros = null; // conteudo do .bak, usado no modo seguro
  let ultimaEscritaEm = null;
  let escritasOk = 0;
  let escritasFalhas = 0;
  let fila = Promise.resolve();

  const log = registro || { debug() {}, info() {}, aviso() {}, erro() {} };

  function lerArquivo(caminho) {
    const texto = fs.readFileSync(caminho, 'utf-8');
    return garantirFormato(JSON.parse(texto));
  }

  function tentarLer(caminho) {
    try {
      if (!fs.existsSync(caminho)) return { ok: false, motivo: 'ausente' };
      return { ok: true, dados: lerArquivo(caminho) };
    } catch (e) {
      return { ok: false, motivo: `${e.name}: ${e.message}`, erro: e };
    }
  }

  function gravarArquivoDeFormaAtomica(dados) {
    const texto = JSON.stringify(dados, null, 2);
    const bytesEsperados = Buffer.byteLength(texto);

    // 1) escreve no temporario e confirma no disco
    const fd = fs.openSync(arquivoTmp, 'w');
    try {
      fs.writeSync(fd, texto);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.statSync(arquivoTmp).size !== bytesEsperados) {
      throw new Error(`gravacao incompleta em ${arquivoTmp} (esperado ${bytesEsperados} bytes)`);
    }

    // 2) guarda o arquivo bom anterior como .bak (melhor esforco: nao impede a gravacao)
    if (fs.existsSync(arquivo)) {
      try {
        fs.copyFileSync(arquivo, arquivoBak);
      } catch (e) {
        log.aviso(`nao consegui atualizar o ${path.basename(arquivoBak)}`, e);
      }
    }

    // 3) troca o arquivo de uma vez (no Windows o antivirus pode segurar por alguns ms)
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      try {
        fs.renameSync(arquivoTmp, arquivo);
        return;
      } catch (e) {
        ultimoErro = e;
        if (!ERROS_QUE_VALEM_TENTAR_DE_NOVO.includes(e.code)) break;
        esperarBloqueando(50 * tentativa);
      }
    }

    // 4) ultimo recurso: grava direto (isso e o comportamento antigo, usado so se o
    //    rename falhar de vez). Fica registrado como aviso.
    try {
      fs.writeFileSync(arquivo, texto);
      try { fs.unlinkSync(arquivoTmp); } catch (e) { /* segue */ }
      log.aviso('a troca atomica falhou; gravei o arquivo direto (confira o backup depois)', ultimoErro);
    } catch (e) {
      try { fs.unlinkSync(arquivoTmp); } catch (e2) { /* segue */ }
      throw e;
    }
  }

  function mensagemArquivoIlegivel(motivoPrincipal, motivoBak) {
    return [
      `O arquivo de dados nao pode ser lido e nao existe copia boa (.bak).`,
      `Arquivo: ${arquivo} (${motivoPrincipal})`,
      `Copia:   ${arquivoBak} (${motivoBak})`,
      'Nada foi apagado. Restaure uma copia da pasta de backups (backups/data-AAAAMMDD-HHMMSS.json)',
      'por cima do arquivo de dados e suba o sistema de novo. Veja RESTAURAR.md.',
    ].join('\n');
  }

  // ---------- subida do sistema ----------
  function inicializar() {
    const principal = tentarLer(arquivo);

    if (principal.ok) {
      const quantos = Object.entries(principal.dados)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => `${k}=${v.length}`)
        .join(' ');
      log.info(`dados carregados de ${path.basename(arquivo)} (${quantos})`);
      return { modoSeguro: null };
    }

    if (principal.motivo === 'ausente') {
      const copia = tentarLer(arquivoBak);
      if (copia.ok) {
        modoSeguro = 'arquivo principal ausente; usando a copia .bak como ponto de partida (somente leitura ate conferir)';
        dadosSeguros = copia.dados;
        log.erro(`o arquivo ${path.basename(arquivo)} desapareceu, mas existe ${path.basename(arquivoBak)}. `
          + 'Entrei em MODO SEGURO (somente leitura) para nao sobrescrever nada. Confira a pasta backups/ e o RESTAURAR.md.');
        return { modoSeguro };
      }
      // Primeira execucao de verdade: cria o arquivo vazio (mesmo comportamento do sistema antigo)
      gravarArquivoDeFormaAtomica(estruturaVazia());
      log.info(`arquivo ${path.basename(arquivo)} criado pela primeira vez (vazio)`);
      return { modoSeguro: null };
    }

    // Arquivo existe mas nao abre: tenta a copia boa
    const copia = tentarLer(arquivoBak);
    if (copia.ok) {
      modoSeguro = `arquivo principal ilegivel (${principal.motivo}); usando a copia .bak (somente leitura)`;
      dadosSeguros = copia.dados;
      log.erro(`o arquivo ${path.basename(arquivo)} esta ilegivel (${principal.motivo}). `
        + `Entrei em MODO SEGURO usando ${path.basename(arquivoBak)} (somente leitura). Nada foi sobrescrito.`);
      return { modoSeguro };
    }

    throw new ErroArmazenamento(mensagemArquivoIlegivel(principal.motivo, copia.motivo), {
      status: 503,
      codigo: 'DADOS_ILEGIVEIS',
      dica: 'Restaure uma copia de backups/ ou de BACKUPS_HERMES/ por cima do arquivo de dados.',
    });
  }

  // ---------- leitura (sincrona: mantem a mesma assinatura usada por auth.js/server.js) ----------
  function carregar() {
    if (modoSeguro) return clonar(dadosSeguros || estruturaVazia());

    const principal = tentarLer(arquivo);
    if (principal.ok) return principal.dados;

    if (principal.motivo !== 'ausente') {
      // Ficou ilegivel durante o uso: tenta a copia e entra em modo seguro
      const copia = tentarLer(arquivoBak);
      if (copia.ok) {
        modoSeguro = `arquivo principal ilegivel (${principal.motivo}); usando a copia .bak (somente leitura)`;
        dadosSeguros = copia.dados;
        log.erro(`o arquivo ${path.basename(arquivo)} ficou ilegivel (${principal.motivo}). MODO SEGURO ativado: `
          + 'o sistema continua lendo a ultima copia boa e RECUSA gravar, para nao perder o que esta no arquivo.');
        return clonar(dadosSeguros);
      }
      throw new ErroArmazenamento(`O arquivo de dados esta ilegivel e nao existe copia .bak.: ${principal.motivo}`, {
        status: 503,
        codigo: 'DADOS_ILEGIVEIS',
      });
    }

    // Arquivo desapareceu durante o uso: nao recria vazio (isso seria perda de dado)
    const copia = tentarLer(arquivoBak);
    if (copia.ok) {
      modoSeguro = 'arquivo principal ausente; usando a copia .bak (somente leitura)';
      dadosSeguros = copia.dados;
      log.erro(`o arquivo ${path.basename(arquivo)} desapareceu durante o uso. MODO SEGURO ativado (somente leitura).`);
      return clonar(dadosSeguros);
    }
    throw new ErroArmazenamento(`O arquivo de dados desapareceu e nao existe copia .bak: ${arquivo}`, {
      status: 503,
      codigo: 'DADOS_ILEGIVEIS',
    });
  }

  // ---------- gravacao ----------
  function salvar(dados) {
    if (modoSeguro) {
      throw new ErroArmazenamento(
        `Sistema em MODO SEGURO: nada pode ser gravado agora (${modoSeguro}). `
        + 'Confira a pasta backups/ e o RESTAURAR.md e reinicie o sistema.',
        { status: 503, codigo: 'MODO_SEGURO', dica: 'Veja RESTAURAR.md, secao 2.' },
      );
    }
    try {
      gravarArquivoDeFormaAtomica(garantirFormato(dados));
      ultimaEscritaEm = Date.now();
      escritasOk += 1;
    } catch (e) {
      escritasFalhas += 1;
      log.erro(`falha ao gravar ${path.basename(arquivo)}`, e);
      // A mensagem que vai para a tela nao pode conter caminho de arquivo nem detalhe
      // tecnico: o detalhe fica no log (acima) e no envelope do erro (para o log central).
      throw new ErroArmazenamento(
        'Não foi possível gravar os dados agora e nada foi perdido. Tente de novo em instantes; '
        + 'se continuar acontecendo, avise o responsável pelo sistema.',
        { status: 500, codigo: 'FALHA_GRAVACAO', detalhe: e.message },
      );
    }
  }

  // Le, deixa alterar e grava, uma gravacao por vez.
  // A fila continua funcionando mesmo quando uma gravacao da erro (antes, um erro
  // deixava a fila travada e o sistema parava de salvar sem avisar).
  function comDados(mutacao) {
    const execucao = fila.then(async () => {
      const dados = carregar();
      const resultado = await mutacao(dados);
      salvar(dados);
      return resultado;
    });
    fila = execucao.then(
      () => {},
      () => {},
    );
    return execucao;
  }

  // ---------- backups ----------
  function nomeArquivoBackup(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `data-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  }

  function listarBackups() {
    if (!fs.existsSync(pastaBackups)) return [];
    return fs
      .readdirSync(pastaBackups)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const completo = path.join(pastaBackups, f);
        const st = fs.statSync(completo);
        return { arquivo: f, tamanho: st.size, criadoEm: st.mtimeMs };
      })
      .sort((a, b) => b.criadoEm - a.criadoEm);
  }

  function fazerBackup() {
    try {
      const origem = modoSeguro ? arquivoBak : arquivo;
      if (!fs.existsSync(origem)) return null;
      if (!fs.existsSync(pastaBackups)) fs.mkdirSync(pastaBackups, { recursive: true });
      const nome = nomeArquivoBackup();
      fs.copyFileSync(origem, path.join(pastaBackups, nome));

      const existentes = listarBackups();
      if (existentes.length > config.maxBackupArquivos) {
        for (const antigo of existentes.slice(config.maxBackupArquivos)) {
          try {
            fs.unlinkSync(path.join(pastaBackups, antigo.arquivo));
          } catch (e) {
            /* segue */
          }
        }
      }
      log.info(`backup automatico salvo em backups/${nome}`);
      return nome;
    } catch (e) {
      log.erro('falha ao fazer o backup automatico', e);
      return null;
    }
  }

  function caminhoBackup(nomePedido) {
    const nome = path.basename(String(nomePedido || '')); // impede sair da pasta de backups
    if (!nome.endsWith('.json')) return null;
    const completo = path.join(pastaBackups, nome);
    return fs.existsSync(completo) ? completo : null;
  }

  function iniciarBackupsAutomaticos() {
    fazerBackup(); // uma copia logo ao ligar
    const timer = setInterval(fazerBackup, config.intervaloBackupMs);
    return () => clearInterval(timer);
  }

  // ---------- diagnostico (usado em /api/diagnostico, so admin) ----------
  function estado() {
    let tamanho = null;
    let modificadoEm = null;
    try {
      const st = fs.statSync(arquivo);
      tamanho = st.size;
      modificadoEm = st.mtimeMs;
    } catch (e) {
      /* arquivo pode nao existir no modo seguro */
    }
    return {
      arquivo: arquivo,
      possuiArquivo: tamanho !== null,
      tamanhoBytes: tamanho,
      modificadoEm,
      possuiBak: fs.existsSync(arquivoBak),
      possuiTmp: fs.existsSync(arquivoTmp),
      modoSeguro,
      ultimaEscritaEm,
      escritasOk,
      escritasFalhas,
      backups: listarBackups().length,
      pastaBackups,
    };
  }

  return {
    arquivo,
    arquivoBak,
    arquivoTmp,
    pastaBackups,
    inicializar,
    carregar,
    salvar,
    comDados,
    fazerBackup,
    listarBackups,
    caminhoBackup,
    iniciarBackupsAutomaticos,
    estado,
    emModoSeguro: () => !!modoSeguro,
    motivoModoSeguro: () => modoSeguro,
  };
}

module.exports = { criarArmazenamento, estruturaVazia, garantirFormato, ErroArmazenamento };
