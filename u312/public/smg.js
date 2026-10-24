// SMG GROUP - Telas novas: identidade do grupo, estoque por loja, importação e chat interno.
//
// Este arquivo é carregado depois do script principal (e do os.js) e não mexe no que já existe:
// ele ACRESCENTA as telas novas (estoque por loja, importar, chat e configurações).
// A marca do sistema continua UNICAR; a tela de login usa a marca configurada (SMG).
//
// Regras que valem aqui:
//  - todas as cores usam as variáveis do tema (--accent, --yellow, --bad, --good);
//  - nada de framework: mesmo padrão do resto do sistema (HTML puro + fetch);
//  - o servidor é quem manda: esconder botão na tela não é permissão.

(function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dinheiro = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
  const quando = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const hoje = new Date();
    const mesmoDia = d.toDateString() === hoje.toDateString();
    return mesmoDia
      ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  async function api(metodo, caminho, corpo) {
    const opcoes = { method: metodo, headers: {} };
    if (corpo !== undefined) {
      opcoes.headers['content-type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    const r = await fetch(caminho, opcoes);
    let dados = null;
    try { dados = await r.json(); } catch (e) { dados = null; }
    if (!r.ok) {
      const erro = new Error((dados && (dados.error || dados.mensagem)) || `Falha (${r.status})`);
      erro.status = r.status;
      erro.dados = dados;
      throw erro;
    }
    return dados;
  }

  function avisar(texto, tipo) {
    if (typeof window.toast === 'function') { window.toast(texto, tipo); return; }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = texto;
    el.className = 'toast show' + (tipo ? ' ' + tipo : '');
    clearTimeout(avisar._t);
    avisar._t = setTimeout(() => { el.className = 'toast'; }, 4000);
  }

  const estado = {
    eu: null,
    grupo: null,
    lojas: [],
    abaAtual: '',
    chat: { salas: [], salaAtiva: null, mensagens: [], chamados: [], online: null },
    previa: null,
  };

  const ehAdmin = () => !!(estado.eu && estado.eu.perfil === 'admin');
  // Nome de exibição da loja (o código interno UNICAR/FILIAL/MATRIZ não aparece na tela)
  const nomeDaLoja = (codigo) => {
    const alvo = String(codigo || '').toUpperCase();
    if (alvo === 'ADMIN' || !alvo) return 'Administração';
    const loja = (estado.lojas || []).find((l) => String(l.codigo).toUpperCase() === alvo);
    return (loja && loja.nome) || alvo;
  };
  const minhaLoja = () => (estado.eu && estado.eu.loja) || '';

  // ---------------------------------------------------------------- identidade do grupo
  // Logo única do grupo no cabeçalho, no título da aba (favicon) e no atalho do celular
  function aplicarGrupoNoTopo(marca) {
    if (!marca) return false;
    const logo = marca.logo || '/logos/grupo-2026.png?v=3.0.7';
    const logoTopo = /logo_login|grupo-2026-login/.test(logo) ? '/logos/grupo-2026.png?v=3.0.7' : logo;
    const img = document.querySelector('.brand-mark');
    const titulo = document.querySelector('.brand-text h1');
    const sub = document.querySelector('.brand-text p');
    if (img) {
      if (!img.dataset.original) img.dataset.original = img.src;
      img.classList.add('grupo-logo');
      img.src = logoTopo;
      img.alt = `Logo ${marca.nome || 'do grupo'}`;
      // nunca deixa imagem quebrada na tela
      img.addEventListener('error', () => { img.src = '/logos/grupo-2026.png?v=3.0.7'; }, { once: true });
    }
    if (titulo && marca.nome) titulo.textContent = marca.nome;
    if (sub && marca.subtitulo) sub.textContent = marca.subtitulo;
    // favicon: usa o ÍCONE quadrado (32/192), não a logo alta — e respeita upload personalizado
    const personalizada = /^data:image\//.test(String(marca.logo || ''));
    const icone32 = personalizada ? marca.logo : '/logos/grupo-2026-icon-32.png?v=3.0.7';
    const icone192 = personalizada ? marca.logo : '/logos/grupo-2026-icon-192.png?v=3.0.7';
    for (const link of document.querySelectorAll('link[rel="icon"]')) {
      const tamanho = link.getAttribute('sizes') || '';
      link.href = tamanho.includes('192') ? icone192 : icone32;
    }
    for (const link of document.querySelectorAll('link[rel="apple-touch-icon"]')) link.href = icone192;
    return true;
  }
  window.unicarAplicarGrupo = () => aplicarGrupoNoTopo(estado.marcaLogin);
  window.unicarGrupoNoTopo = aplicarGrupoNoTopo;

  async function aplicarIdentidade() {
    try {
      estado.grupo = await api('GET', '/api/grupo');
      estado.lojas = estado.grupo.lojas || [];
    } catch (e) {
      return;
    }
    const g = estado.grupo;
    const marcaLogin = g.login || { nome: g.nome, subtitulo: g.subtitulo, logo: g.logo };
    estado.marcaLogin = marcaLogin;
    // v3.0.7: o topo, a aba do navegador e a tela de login usam a MESMA logo do GRUPO.
    // (Os documentos continuam com a logo de cada loja.)
    aplicarGrupoNoTopo(marcaLogin);

    // Preenche a tela de Configurações, que edita essa marca do grupo.
    if ($('cfgNome')) $('cfgNome').value = marcaLogin.nome || '';
    if ($('cfgSubtitulo')) $('cfgSubtitulo').value = marcaLogin.subtitulo || '';
    if ($('cfgPrefixo')) $('cfgPrefixo').value = (g.prefixoOS && g.prefixoOS !== 'OS') ? g.prefixoOS : '';
    const previa = $('cfgPreviaLogo');
    if (previa && marcaLogin.logo) {
      previa.innerHTML = `<img src="${esc(marcaLogin.logo)}" alt="logo da tela de login" style="max-width:200px;border-radius:10px;background:#fff;padding:8px;">`;
    }

    preencherSelectsDeLoja();
  }

  function preencherSelectsDeLoja() {
    const lojas = estado.lojas.length ? estado.lojas
      : [{ codigo: 'UNICAR', nome: 'UNICAR' }, { codigo: 'FILIAL', nome: 'FILIAL' }, { codigo: 'MATRIZ', nome: 'MATRIZ' }];
    const opcoes = (incluirTodas) => (incluirTodas ? '<option value="">Todas as lojas</option>' : '')
      + lojas.map((l) => `<option value="${esc(l.codigo)}">${esc(l.nome || l.codigo)}</option>`).join('');
    const fixas = [['selLojaEstoque', ehAdmin()], ['impLoja', false], ['transfDe', false], ['transfPara', false], ['chamPara', false]];
    for (const [id, todas] of fixas) {
      const el = $(id);
      if (!el) continue;
      const antes = el.value;
      el.innerHTML = opcoes(todas);
      if (!ehAdmin() && minhaLoja() && lojas.some((l) => l.codigo === minhaLoja())) el.value = minhaLoja();
      else if (antes) el.value = antes;
      if (!el.value && el.options.length) el.value = el.options[0].value;
    }
    // funcionário não escolhe loja: fica travado na dele
    if (!ehAdmin()) {
      for (const id of ['impLoja', 'transfDe']) {
        const el = $(id);
        if (el) { el.value = minhaLoja(); el.disabled = true; }
      }
    }
  }

  // ---------------------------------------------------------------- abas novas
  function montarAbas() {
    const ehAdm = ehAdmin();
    if ($('tabEstoqueLojas')) $('tabEstoqueLojas').style.display = ehAdm ? '' : 'none';
    if ($('tabImportar')) $('tabImportar').style.display = '';
    if ($('tabChat')) $('tabChat').style.display = '';
    // Clientes: base única do grupo — liberado para qualquer usuário logado
    if ($('tabClientes')) $('tabClientes').style.display = '';
    if ($('tabConfig')) $('tabConfig').style.display = ehAdm ? '' : 'none';
    if (!ehAdm && $('btnDistribuir')) $('btnDistribuir').style.display = 'none';
  }

  document.addEventListener('click', (ev) => {
    const aba = ev.target.closest && ev.target.closest('.tab');
    if (!aba) return;
    const alvo = aba.dataset.view;
    if (!['estoque-lojas', 'importar', 'chat', 'config'].includes(alvo)) return;
    estado.abaAtual = alvo;
    if (alvo === 'estoque-lojas') carregarEstoquePorLoja();
    if (alvo === 'importar') carregarImportacoes();
    if (alvo === 'chat') abrirChat();
    if (alvo === 'config') {
      carregarConfigImpressao();
      if (typeof window.unicarCarregarWhatsapp === 'function') window.unicarCarregarWhatsapp();
    }
  });

  // ---------------------------------------------------------------- estoque por loja
  async function carregarEstoquePorLoja() {
    const tabela = $('tabelaEstoqueLojas');
    if (!tabela) return;
    const loja = $('selLojaEstoque') ? $('selLojaEstoque').value : '';
    tabela.innerHTML = '<tbody><tr><td class="empty-state">Carregando…</td></tr></tbody>';
    let dados;
    try {
      dados = await api('GET', '/api/estoque/consolidado' + (loja ? `?loja=${encodeURIComponent(loja)}` : ''));
    } catch (e) {
      tabela.innerHTML = `<tbody><tr><td class="empty-state">${esc(e.message)}</td></tr></tbody>`;
      return;
    }
    const colunas = dados.lojas || [];
    if ($('avisoEstoqueLoja')) {
      $('avisoEstoqueLoja').textContent = ehAdmin()
        ? 'Administrador: as colunas mostram cada loja lado a lado. Para reorganizar o que já existe, use "Distribuir estoque atual".'
        : `Você vê e movimenta somente o estoque da loja ${minhaLoja()}.`;
    }
    const cabecalho = ['Marca', 'Medida', 'Tipo', ...colunas.map((c) => `Loja ${esc(nomeDaLoja(c))}`), 'Total', 'Mínimo'];
    const linhas = (dados.linhas || []).slice(0, 500).map((l) => {
      const celulas = colunas.map((c) => {
        const registro = (l.lojas || []).find((x) => x.loja === c) || { quantidade: 0, minimo: 0 };
        const baixo = registro.minimo > 0 && registro.quantidade < registro.minimo;
        return `<td class="centro"${baixo ? ' style="color:var(--bad);font-weight:700;"' : ''}>${registro.quantidade}${baixo ? ' ⚠' : ''}</td>`;
      }).join('');
      return `<tr><td>${esc(l.marca)}</td><td>${esc(l.medida)}</td><td>${l.status === 'novo' ? 'Novo' : 'Remold'}</td>${celulas}<td class="centro"><strong>${l.total}</strong></td><td class="centro">${(l.lojas || []).map((x) => x.minimo).join('/')}</td></tr>`;
    }).join('');
    tabela.innerHTML = `<thead><tr>${cabecalho.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas || '<tr><td class="empty-state" colspan="8">Nenhum pneu cadastrado.</td></tr>'}</tbody>`;

    preencherSelectPneus(dados.linhas || []);
  }

  function preencherSelectPneus(linhas) {
    const el = $('transfPneu');
    if (!el) return;
    el.innerHTML = linhas.map((l) => `<option value="${esc(l.id)}">${esc(l.marca)} ${esc(l.medida)} (${l.status === 'novo' ? 'novo' : 'remold'}) — total ${l.total}</option>`).join('');
  }

  async function abrirDistribuicao() {
    const painel = $('painelDistribuir');
    if (!painel || !ehAdmin()) return;
    painel.style.display = '';
    const loja = $('selLojaEstoque') ? $('selLojaEstoque').value : '';
    const dados = await api('GET', '/api/estoque/consolidado' + (loja ? `?loja=${encodeURIComponent(loja)}` : ''));
    const colunas = dados.lojas || [];
    const linhas = (dados.linhas || []).slice(0, 200).map((l) => {
      const celulas = colunas.map((c) => {
        const registro = (l.lojas || []).find((x) => x.loja === c) || { quantidade: 0 };
        return `<td><input class="search-input dist-input" style="max-width:80px;" type="number" min="0" data-pneu="${esc(l.id)}" data-loja="${esc(c)}" value="${registro.quantidade}"></td>`;
      }).join('');
      return `<tr><td>${esc(l.marca)} ${esc(l.medida)}</td>${celulas}<td class="centro" data-total="${esc(l.id)}">${l.total}</td></tr>`;
    }).join('');
    $('tabelaDistribuir').innerHTML = `<thead><tr><th>Pneu</th>${colunas.map((c) => `<th>${esc(nomeDaLoja(c))}</th>`).join('')}<th>Total atual</th></tr></thead><tbody>${linhas}</tbody>`;
    if ($('resultadoDistribuicao')) $('resultadoDistribuicao').innerHTML = '';
    painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function salvarDistribuicao() {
    const campos = Array.from(document.querySelectorAll('.dist-input'));
    const porPneu = new Map();
    for (const campo of campos) {
      const id = campo.dataset.pneu;
      if (!porPneu.has(id)) porPneu.set(id, {});
      porPneu.get(id)[campo.dataset.loja] = Number(campo.value) || 0;
    }
    const itens = Array.from(porPneu.entries()).map(([pneuId, lojas]) => ({ pneuId, lojas }));
    if (!itens.length) { avisar('Nada para distribuir.', 'erro'); return; }
    try {
      const r = await api('POST', '/api/estoque/distribuir', { itens });
      const alvo = $('resultadoDistribuicao');
      if (alvo) {
        alvo.innerHTML = r.erros && r.erros.length
          ? `<p class="alerta">${r.erros.map((e) => esc(`${e.descricao || e.pneuId}: ${e.erro}`)).join('<br>')}</p>`
          : `<p class="hint">✅ ${r.alterados} pneu(s) redistribuído(s).</p>`;
      }
      avisar(r.ok ? 'Distribuição salva.' : 'Confira os avisos.', r.ok ? '' : 'erro');
      carregarEstoquePorLoja();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function transferir() {
    const pneuId = $('transfPneu') ? $('transfPneu').value : '';
    const de = $('transfDe') ? $('transfDe').value : '';
    const para = $('transfPara') ? $('transfPara').value : '';
    const quantidade = Number($('transfQtd') ? $('transfQtd').value : 0);
    const confirmadoPor = $('transfQuem') ? $('transfQuem').value.trim() : '';
    if (!confirmadoPor) { avisar('Escreva o nome de quem está recebendo.', 'erro'); return; }
    try {
      const r = await api('POST', '/api/estoque/transferir', { pneuId, de, para, quantidade, confirmadoPor });
      const alvo = $('resultadoTransferencia');
      if (alvo) {
        alvo.innerHTML = `<p class="hint">✅ ${r.quantidade} un. de ${esc(r.de)} → ${esc(r.para)}. Agora: `
          + (r.saldo || []).map((s) => `${esc(nomeDaLoja(s.loja))}: ${s.quantidade}`).join(' · ') + '</p>';
      }
      avisar('Transferência feita.');
      carregarEstoquePorLoja();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  // ---------------------------------------------------------------- importação
  function arquivoParaBase64(arquivo) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => {
        const texto = String(leitor.result || '');
        resolve(texto.slice(texto.indexOf(',') + 1));
      };
      leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
      leitor.readAsDataURL(arquivo);
    });
  }

  async function verPrevia() {
    const entrada = $('impArquivo');
    const status = $('impStatus');
    if (!entrada || !entrada.files || !entrada.files[0]) { avisar('Escolha um arquivo.', 'erro'); return; }
    const arquivo = entrada.files[0];
    if (arquivo.size > 10 * 1024 * 1024) { avisar('O arquivo passa de 10 MB.', 'erro'); return; }
    if (status) status.textContent = 'Lendo o arquivo…';
    try {
      const conteudo = await arquivoParaBase64(arquivo);
      const r = await api('POST', '/api/importar/previa', {
        nome: arquivo.name,
        conteudo,
        loja: $('impLoja') ? $('impLoja').value : '',
        modo: $('impModo') ? $('impModo').value : 'somar',
      });
      estado.previa = r;
      mostrarPrevia(r);
      if (status) status.textContent = '';
    } catch (e) {
      if (status) status.textContent = '';
      avisar(e.message + (e.dados && e.dados.dica ? ` — ${e.dados.dica}` : ''), 'erro');
    }
  }

  function mostrarPrevia(r) {
    const painel = $('painelPreviaImportacao');
    if (!painel) return;
    painel.style.display = '';
    const avisoLeitura = r.avisoPlanilha || r.avisoOcr;
    $('impAvisoOcr').innerHTML = avisoLeitura ? `<p class="alerta">${r.avisoPlanilha ? '📄' : '⚠️'} ${esc(avisoLeitura)}</p>` : '';
    $('impResumo').innerHTML = `
      <div class="stat-card"><div class="label">Criar</div><div class="value">${r.criar.length}</div><div class="sub">pneus novos</div></div>
      <div class="stat-card"><div class="label">Atualizar</div><div class="value">${r.atualizar.length}</div><div class="sub">já existem (${r.modo === 'substituir' ? 'definir' : 'somar'})</div></div>
      <div class="stat-card"><div class="label">Revisar</div><div class="value ${r.revisao.length ? 'bad' : ''}">${r.revisao.length}</div><div class="sub">linhas não entendidas</div></div>`;
    $('impQtdCriar').textContent = r.criar.length;
    $('impQtdAtualizar').textContent = r.atualizar.length;
    $('impQtdRevisao').textContent = r.revisao.length;

    $('tabelaCriar').innerHTML = `<thead><tr><th>Marca</th><th>Medida</th><th>Tipo</th><th>Qtd</th><th>Custo</th><th>Preço</th></tr></thead><tbody>`
      + (r.criar.map((i) => `<tr><td>${esc(i.marca)}</td><td>${esc(i.medida)}</td><td>${i.tipo === 'novo' ? 'Novo' : 'Remold'}</td><td class="centro">${i.quantidade}</td><td>${i.custo ? dinheiro(i.custo) : '—'}</td><td>${i.preco ? dinheiro(i.preco) : '—'}</td></tr>`).join('')
        || '<tr><td class="empty-state" colspan="6">Nenhum pneu novo.</td></tr>') + '</tbody>';

    $('tabelaAtualizar').innerHTML = `<thead><tr><th>Marca</th><th>Medida</th><th>Tipo</th><th>Qtd no arquivo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>`
      + (r.atualizar.map((i) => `<tr><td>${esc(i.marca)}</td><td>${esc(i.medida)}</td><td>${i.tipo === 'novo' ? 'Novo' : 'Remold'}</td><td class="centro">${i.quantidade}</td><td class="centro">${i.quantidadeAntes}</td><td class="centro"><strong>${i.quantidadeDepois}</strong></td></tr>`).join('')
        || '<tr><td class="empty-state" colspan="6">Nada para atualizar.</td></tr>') + '</tbody>';

    $('tabelaRevisao').innerHTML = `<thead><tr><th>Linha do arquivo</th><th>Motivo</th></tr></thead><tbody>`
      + (r.revisao.map((i) => `<tr><td>${esc(i.linha)}</td><td>${esc(i.motivo)}</td></tr>`).join('')
        || '<tr><td class="empty-state" colspan="2">Nenhuma linha para revisar. 🎉</td></tr>') + '</tbody>';
    painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function confirmarImportacao() {
    if (!estado.previa) return;
    try {
      const r = await api('POST', '/api/importar/confirmar', { id: estado.previa.id });
      $('resultadoImportacao').innerHTML = `<p class="hint">✅ Importado na loja ${esc(r.loja)}: ${r.criados} criado(s), ${r.atualizados} atualizado(s). `
        + `<a href="/api/importacoes/${encodeURIComponent(r.id)}/resultado.csv">Baixar o resultado (CSV)</a></p>`;
      avisar('Importação concluída.');
      estado.previa = null;
      $('painelPreviaImportacao').style.display = 'none';
      carregarImportacoes();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function carregarImportacoes() {
    const tabela = $('tabelaImportacoes');
    if (!tabela) return;
    try {
      const r = await api('GET', '/api/importacoes');
      tabela.innerHTML = `<thead><tr><th>Arquivo</th><th>Loja</th><th>Modo</th><th>Criados</th><th>Atualizados</th><th>Revisão</th><th>Quem</th><th>Quando</th><th></th></tr></thead><tbody>`
        + ((r.importacoes || []).map((i) => `<tr><td>${esc(i.arquivo)}</td><td>${esc(i.loja)}</td><td>${i.modo === 'substituir' ? 'Definir' : 'Somar'}</td><td class="centro">${i.criados}</td><td class="centro">${i.atualizados}</td><td class="centro">${i.revisao}</td><td>${esc(i.usuario)}</td><td>${quando(i.confirmadoEm || i.criadoEm)}</td><td><a href="/api/importacoes/${encodeURIComponent(i.id)}/resultado.csv">CSV</a></td></tr>`).join('')
          || '<tr><td class="empty-state" colspan="9">Nenhuma importação feita ainda.</td></tr>') + '</tbody>';
    } catch (e) {
      tabela.innerHTML = `<tbody><tr><td class="empty-state">${esc(e.message)}</td></tr></tbody>`;
    }
  }

  // ---------------------------------------------------------------- som (alarme)
  const som = {
    ctx: null,
    volume: 1,
    ligado: true,
    alarme: null,       // { intervalo, chamadoId, ate }
  };

  function carregarPreferenciasDeSom() {
    const v = localStorage.getItem('smg_som_volume');
    if (v !== null) som.volume = Math.max(0, Math.min(1, Number(v) / 100));
    const ligado = localStorage.getItem('smg_som_ligado');
    if (ligado !== null) som.ligado = ligado === '1';
    if ($('chatVolume')) $('chatVolume').value = Math.round(som.volume * 100);
    if ($('chatSomLigado')) $('chatSomLigado').checked = som.ligado;
  }

  function salvarPreferenciasDeSom() {
    localStorage.setItem('smg_som_volume', String(Math.round(som.volume * 100)));
    localStorage.setItem('smg_som_ligado', som.ligado ? '1' : '0');
  }

  // O navegador só libera áudio depois de um gesto do usuário. Em vez de exigir o
  // botão "Ativar sons", o som se libera SOZINHO no primeiro clique/toque em
  // qualquer lugar da tela — vale para o resto da sessão e fica guardado.
  function liberarSomSozinho() {
    if (som.autoLiberado) return;
    som.autoLiberado = true;

    const liberar = () => {
      const ctx = garantirAudio();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      localStorage.setItem('smg_sons_ok', '1');
      if ($('painelSom')) $('painelSom').style.display = 'none';
      atualizarStatusSom();
      window.removeEventListener('pointerdown', liberar, true);
      window.removeEventListener('keydown', liberar, true);
      window.removeEventListener('touchstart', liberar, true);
      capturarSons();
    };

    window.addEventListener('pointerdown', liberar, true);
    window.addEventListener('keydown', liberar, true);
    window.addEventListener('touchstart', liberar, true);

    // se já foi liberado numa visita anterior, tenta retomar o áudio na hora
    if (localStorage.getItem('smg_sons_ok') === '1') {
      const ctx = garantirAudio();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }
  }

  // Sons curtos sintetizados (sem arquivo): mensagem nova e confirmação.
  function capturarSons() {
    // alguns navegadores suspendem o áudio ao trocar de aba; retoma ao voltar
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const ctx = garantirAudio();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      }
    });
  }

  function garantirAudio() {
    if (!som.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      som.ctx = new Ctx();
    }
    if (som.ctx.state === 'suspended') som.ctx.resume().catch(() => {});
    return som.ctx;
  }

  // Sirene de ~3 segundos, volume máximo do navegador (respeitando o volume escolhido)
  function tocarSirene(vezes) {
    if (!som.ligado) return;
    const ctx = garantirAudio();
    if (!ctx) return;
    const inicio = ctx.currentTime;
    const total = vezes || 1;
    const ganho = ctx.createGain();
    ganho.gain.value = som.volume;
    ganho.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.connect(ganho);
    for (let i = 0; i < total; i += 1) {
      const base = inicio + i * 1.5;
      osc.frequency.setValueAtTime(880, base);
      osc.frequency.setValueAtTime(620, base + 0.35);
      osc.frequency.setValueAtTime(880, base + 0.7);
      osc.frequency.setValueAtTime(620, base + 1.05);
    }
    ganho.gain.setValueAtTime(som.volume, inicio);
    ganho.gain.exponentialRampToValueAtTime(0.001, inicio + total * 1.5);
    osc.start(inicio);
    osc.stop(inicio + total * 1.5 + 0.05);
  }

  // Aviso curto para mensagem comum
  function tocarBipe() {
    if (!som.ligado) return;
    const ctx = garantirAudio();
    if (!ctx) return;
    const ganho = ctx.createGain();
    ganho.gain.value = som.volume * 0.5;
    ganho.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1040;
    osc.connect(ganho);
    ganho.gain.setValueAtTime(som.volume * 0.5, ctx.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  // Repete a cada 30 s até alguém clicar em "Visto"
  function iniciarAlarme(chamado) {
    pararAlarme();
    tocarSirene(2);
    const id = chamado && chamado.id;
    som.alarme = {
      chamadoId: id,
      ate: Date.now() + 10 * 60 * 1000,
      intervalo: setInterval(() => {
        if (!som.alarme || Date.now() > som.alarme.ate) { pararAlarme(); return; }
        tocarSirene(2);
        piscarTitulo();
      }, 30000),
    };
    piscarTitulo();
    mostrarFaixaAlarme(chamado);
    notificarNavegador(chamado);
  }

  function pararAlarme() {
    if (som.alarme && som.alarme.intervalo) clearInterval(som.alarme.intervalo);
    som.alarme = null;
    const faixa = $('faixaAlarme');
    if (faixa) faixa.remove();
    document.title = document.title.replace(/^🚨\s*/, '');
    if (piscarTitulo._t) { clearInterval(piscarTitulo._t); piscarTitulo._t = null; }
  }

  function piscarTitulo() {
    if (piscarTitulo._t) return;
    let ligado = false;
    const base = document.title.replace(/^🚨\s*/, '').replace(/^•\s*/, '');
    piscarTitulo._t = setInterval(() => {
      ligado = !ligado;
      document.title = ligado ? `🚨 ${base}` : `• ${base}`;
      if (!som.alarme) { clearInterval(piscarTitulo._t); piscarTitulo._t = null; document.title = base; }
    }, 900);
  }

  function mostrarFaixaAlarme(chamado) {
    let faixa = $('faixaAlarme');
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.id = 'faixaAlarme';
      faixa.className = 'alarme-topo';
      document.body.insertBefore(faixa, document.body.firstChild);
    }
    faixa.innerHTML = `<span>🚨 Chamado ${esc(chamado && chamado.numero ? chamado.numero : '')}`
      + `${chamado ? ` de ${esc(nomeDaLoja(chamado.de))}: ${esc(chamado.titulo)}` : ''}</span>`
      + `<button class="btn-ghost btn-sm" id="btnVistoAlarme">Visto</button>`;
    const botao = $('btnVistoAlarme');
    if (botao) botao.onclick = async () => {
      try {
        if (chamado && chamado.id) await api('POST', `/api/chamados/${encodeURIComponent(chamado.id)}/visto`);
      } catch (e) { /* segue: o importante é parar o barulho */ }
      pararAlarme();
      carregarChamados();
    };
  }

  function notificarNavegador(chamado) {
    if (document.visibilityState === 'visible') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(`Chamado ${chamado.numero || ''}`, { body: `${chamado.titulo}\n${chamado.mensagem || ''}` });
    }
  }

  async function ativarSons() {
    const ctx = garantirAudio();
    if (!ctx) { avisar('Este navegador não tem áudio.', 'erro'); return; }
    localStorage.setItem('smg_sons_ok', '1');
    if ($('painelSom')) $('painelSom').style.display = 'none';
    tocarBipe();
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) { /* segue */ }
    }
    atualizarStatusSom('Sons ativados.');
  }

  function atualizarStatusSom(extra) {
    const alvo = $('somStatus');
    if (!alvo) return;
    const liberado = localStorage.getItem('smg_sons_ok') === '1';
    const rodando = !!(som.ctx && som.ctx.state === 'running');
    if (!liberado) {
      alvo.textContent = '🔇 O navegador só libera o som depois de um clique. Clique em "Ativar sons".';
      return;
    }
    if (!som.ligado) {
      alvo.textContent = '🔕 Som desligado por você (o alarme de chamado não toca).';
      return;
    }
    alvo.textContent = rodando
      ? `🔊 Som ligado (volume ${Math.round(som.volume * 100)}%)${extra ? ` · ${extra}` : ''}`
      : `🔈 Sons liberados (volume ${Math.round(som.volume * 100)}%). Se não ouvir nada, confira o volume do computador.`;
  }

  // ---------------------------------------------------------------- chat
  async function abrirChat() {
    if (localStorage.getItem('smg_sons_ok') !== '1' && $('painelSom')) $('painelSom').style.display = '';
    atualizarStatusSom();
    await carregarSalas();
    await carregarChamados();
    conectarSocket();
  }

  async function carregarSalas() {
    try {
      const r = await api('GET', '/api/chat/salas');
      estado.chat.salas = r.salas || [];
      atualizarBadge(r.naoLidas);
      renderSalas();
      preencherSelectChamado();
      if (!estado.chat.salaAtiva && estado.chat.salas.length) {
        const primeira = estado.chat.salas[0];
        abrirSala(primeira.id);
      }
    } catch (e) {
      if ($('chatSalas')) $('chatSalas').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    }
  }

  function atualizarBadge(naoLidas) {
    const badge = $('chatBadge');
    if (!badge) return;
    const total = (naoLidas && (naoLidas.total || 0)) || 0;
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = total > 0 ? '' : 'none';
  }

  function nomeDaSala(sala) {
    if (sala.tipo !== 'loja') return sala.nome;
    const partes = (sala.participantes || []).map(nomeDaLoja);
    return partes.length === 2 ? `${partes[0]} ↔ ${partes[1]}` : sala.nome;
  }

  function renderSalas() {
    const alvo = $('chatSalas');
    if (!alvo) return;
    alvo.innerHTML = estado.chat.salas.map((s) => `
      <button class="chat-sala${s.id === estado.chat.salaAtiva ? ' ativa' : ''}" data-sala="${esc(s.id)}">
        ${s.tipo === 'chamados' ? '🚨 ' : (s.tipo === 'geral' ? '👥 ' : '🏬 ')}${esc(nomeDaSala(s))}
      </button>`).join('');
    alvo.querySelectorAll('[data-sala]').forEach((b) => {
      b.onclick = () => abrirSala(b.dataset.sala);
    });
  }

  function preencherSelectChamado() {
    const el = $('chamPara');
    if (!el) return;
    const minhasLojas = estado.chat.salas.filter((s) => s.tipo === 'loja').map((s) => s.participantes || []).flat();
    const codigos = Array.from(new Set(minhasLojas)).filter((c) => c !== minhaLoja());
    el.innerHTML = codigos.map((c) => `<option value="${esc(c)}">${esc(nomeDaLoja(c))}</option>`).join('')
      || '<option value="">(sem outra loja)</option>';
  }

  async function abrirSala(salaId) {
    estado.chat.salaAtiva = salaId;
    renderSalas();
    try {
      const r = await api('GET', `/api/chat/sala/${encodeURIComponent(salaId)}`);
      estado.chat.mensagens = r.mensagens || [];
      const sala = estado.chat.salas.find((x) => x.id === salaId);
      if ($('chatSalaNome')) $('chatSalaNome').textContent = sala ? nomeDaSala(sala) : r.sala.nome;
      if ($('chatSalaInfo')) $('chatSalaInfo').textContent = `${r.sala.tipo}`;
      renderMensagens();
      await api('POST', `/api/chat/sala/${encodeURIComponent(salaId)}/visto`).catch(() => {});
      const n = await api('GET', '/api/chat/naolidas').catch(() => null);
      if (n) atualizarBadge(n);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  function renderMensagens() {
    const alvo = $('chatMensagens');
    if (!alvo) return;
    const lista = estado.chat.mensagens.slice().reverse();
    alvo.innerHTML = lista.map((m) => `
      <div class="chat-msg${m.autorId && estado.eu && m.autorId === estado.eu.id ? ' eu' : ''}${m.apagada ? ' apagada' : ''}">
        <span class="msg-autor">${esc(m.autor)}${m.loja ? ` · ${esc(nomeDaLoja(m.loja))}` : ''}</span>
        ${esc(m.texto)}<span class="msg-hora">${quando(m.criadoEm)}</span>
        ${m.vistoPor && m.vistoPor.length ? `<span class="msg-hora">visto por ${esc(m.vistoPor.slice(0, 3).join(', '))}</span>` : ''}
      </div>`).join('') || '<div class="empty-state"><p>Nenhuma mensagem ainda.</p></div>';
    alvo.scrollTop = alvo.scrollHeight;
  }

  // Envio de mensagem no chat: NUNCA perde o texto digitado.
  // - segura o clique repetido (evita mensagem duplicada);
  // - mantém o texto no campo até o servidor confirmar;
  // - se der erro, devolve o texto e explica o que fazer.
  let enviandoMensagem = false;

  async function enviarMensagem() {
    const campo = $('chatTexto');
    const botao = $('btnEnviarChat');
    if (!campo || !estado.chat.salaAtiva) return;
    if (enviandoMensagem) return;
    const texto = campo.value.trim();
    if (!texto) return;

    enviandoMensagem = true;
    if (botao) { botao.disabled = true; botao.dataset.rotulo = botao.textContent; botao.textContent = 'Enviando…'; }
    try {
      await api('POST', `/api/chat/sala/${encodeURIComponent(estado.chat.salaAtiva)}/mensagem`, { texto });
      campo.value = '';
      await abrirSala(estado.chat.salaAtiva);
    } catch (e) {
      // devolve o texto para ele tentar de novo sem digitar tudo outra vez
      if (!campo.value.trim()) campo.value = texto;
      const motivo = (e && e.status === 503)
        ? 'O sistema não conseguiu gravar agora. Tente de novo em 2 segundos.'
        : ((e && e.message) || 'Não consegui enviar a mensagem.');
      avisar(`${motivo} O texto continua no campo.`, 'erro');
    } finally {
      enviandoMensagem = false;
      if (botao) { botao.disabled = false; if (botao.dataset.rotulo) botao.textContent = botao.dataset.rotulo; }
    }
  }

  async function carregarChamados() {
    const alvo = $('listaChamados');
    if (!alvo) return;
    try {
      const r = await api('GET', '/api/chamados');
      estado.chat.chamados = r.chamados || [];
      alvo.innerHTML = estado.chat.chamados.map((c) => `
        <div class="chamado-card ${c.prioridade === 'urgente' ? 'urgente' : ''} ${c.status === 'resolvido' ? 'resolvido' : ''}">
          <div class="chamado-topo">
            <strong>${esc(c.numero)} · ${esc(c.titulo)}</strong>
            <span class="badge">${esc(c.status)} · ${esc(c.prioridade)}</span>
          </div>
          <p class="hint">${esc(nomeDaLoja(c.de))} → ${esc(nomeDaLoja(c.para))} · ${quando(c.criadoEm)} · por ${esc(c.criadoPor)}</p>
          <p>${esc(c.mensagem)}</p>
          ${c.vinculo ? `<p class="hint">Vinculado a ${esc(c.vinculo.tipo)}: ${esc(c.vinculo.rotulo || c.vinculo.id)}</p>` : ''}
          ${c.foto ? `<p><img src="${esc(c.foto)}" alt="foto do chamado" style="max-width:180px;border-radius:8px;"></p>` : ''}
          <div class="chamado-hist">${(c.historico || []).slice(-3).map((h) => `${quando(h.em)} · ${esc(h.usuario)}: ${esc(h.texto)}`).join('<br>')}</div>
          <div class="toolbar" style="margin-top:8px;">
            <input class="search-input" placeholder="Responder…" data-resposta="${esc(c.id)}" style="max-width:260px;">
            <button class="btn-primary btn-sm" data-responder="${esc(c.id)}">Responder</button>
            <button class="btn-ghost btn-sm" data-status="${esc(c.id)}" data-novo="resolvido">Resolver</button>
            ${c.visto ? '' : `<button class="btn-ghost btn-sm" data-visto="${esc(c.id)}">Visto</button>`}
          </div>
        </div>`).join('') || '<div class="empty-state"><p>Nenhum chamado.</p></div>';

      alvo.querySelectorAll('[data-responder]').forEach((b) => {
        b.onclick = async () => {
          const campo = alvo.querySelector(`[data-resposta="${b.dataset.responder}"]`);
          try {
            await api('POST', `/api/chamados/${encodeURIComponent(b.dataset.responder)}/responder`, { texto: campo.value });
            carregarChamados();
            avisar('Resposta enviada.');
          } catch (e) { avisar(e.message, 'erro'); }
        };
      });
      alvo.querySelectorAll('[data-status]').forEach((b) => {
        b.onclick = async () => {
          try {
            await api('POST', `/api/chamados/${encodeURIComponent(b.dataset.status)}/status`, { novo: b.dataset.novo, status: b.dataset.novo });
            carregarChamados();
          } catch (e) { avisar(e.message, 'erro'); }
        };
      });
      alvo.querySelectorAll('[data-visto]').forEach((b) => {
        b.onclick = async () => {
          try {
            await api('POST', `/api/chamados/${encodeURIComponent(b.dataset.visto)}/visto`);
            pararAlarme();
            carregarChamados();
          } catch (e) { avisar(e.message, 'erro'); }
        };
      });
    } catch (e) {
      alvo.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    }
  }

  async function criarChamado() {
    const titulo = $('chamTitulo') ? $('chamTitulo').value.trim() : '';
    const mensagem = $('chamMensagem') ? $('chamMensagem').value.trim() : '';
    const para = $('chamPara') ? $('chamPara').value : '';
    const prioridade = $('chamPrioridade') ? $('chamPrioridade').value : 'normal';
    const tipoVinculo = $('chamVinculo') ? $('chamVinculo').value : '';
    const textoVinculo = $('chamVinculoTexto') ? $('chamVinculoTexto').value.trim() : '';
    let foto = null;
    const campoFoto = $('chamFoto');
    if (campoFoto && campoFoto.files && campoFoto.files[0]) {
      foto = `data:${campoFoto.files[0].type};base64,${await arquivoParaBase64(campoFoto.files[0])}`;
    }
    try {
      const r = await api('POST', '/api/chamados', {
        titulo,
        mensagem,
        para,
        prioridade,
        foto,
        vinculo: tipoVinculo ? { tipo: tipoVinculo, rotulo: textoVinculo, id: textoVinculo } : null,
      });
      $('resultadoChamado').innerHTML = `<p class="hint">✅ Chamado ${esc(r.chamado.numero)} aberto.</p>`;
      $('painelNovoChamado').style.display = 'none';
      limparFormularioChamado();
      carregarChamados();
      carregarSalas();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  function limparFormularioChamado() {
    for (const id of ['chamTitulo', 'chamMensagem', 'chamVinculoTexto']) {
      const el = $(id);
      if (el) el.value = '';
    }
    const foto = $('chamFoto');
    if (foto) foto.value = '';
  }

  // tempo real: mensagens, chamados, presença e o alarme
  let socketChat = null;
  function conectarSocket() {
    if (socketChat || typeof window.io !== 'function') return;
    socketChat = window.io();

    socketChat.on('chat', (evento) => {
      const euId = estado.eu && estado.eu.id;
      if (evento.tipo === 'chamado') {
        const chamado = evento.chamado || {};
        const meu = chamado.de === minhaLoja() || (estado.eu && chamado.criadoPorId === euId);
        carregarChamados();
        carregarSalas();
        if (!meu) {
          iniciarAlarme(chamado);           // alarme alto + repete a cada 30 s
        } else {
          tocarBipe();
        }
        return;
      }
      if (evento.tipo === 'mensagem') {
        const autor = evento.mensagem && evento.mensagem.autorId;
        if (estado.chat.salaAtiva === evento.salaId) abrirSala(evento.salaId);
        if (autor !== euId) tocarBipe();
        carregarSalas();
        return;
      }
      if (evento.tipo && evento.tipo.startsWith('chamado')) {
        carregarChamados();
        return;
      }
      if (evento.tipo === 'apagada' || evento.tipo === 'visto') {
        if (estado.chat.salaAtiva) abrirSala(estado.chat.salaAtiva);
      }
    });

    socketChat.on('presenca', (dados) => {
      estado.chat.online = dados;
      const alvo = $('chatOnline');
      if (alvo) {
        const partes = Object.entries(dados.porLoja || {}).map(([loja, n]) => `${nomeDaLoja(loja)}: ${n}`);
        alvo.textContent = `🟢 online agora — ${partes.join(' · ') || 'ninguém'}`;
      }
    });
  }

  // ---------------------------------------------------------------- configurações
  function redimensionarImagem(arquivo, larguraMaxima) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => {
        const img = new Image();
        img.onload = () => {
          const escala = Math.min(1, larguraMaxima / (img.width || larguraMaxima));
          const largura = Math.max(1, Math.round((img.width || larguraMaxima) * escala));
          const altura = Math.max(1, Math.round((img.height || larguraMaxima) * escala));
          const canvas = document.createElement('canvas');
          canvas.width = largura;
          canvas.height = altura;
          canvas.getContext('2d').drawImage(img, 0, 0, largura, altura);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Não consegui ler a imagem.'));
        img.src = leitor.result;
      };
      leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
      leitor.readAsDataURL(arquivo);
    });
  }

  async function salvarConfiguracoes() {
    const nome = $('cfgNome').value.trim();
    const subtitulo = $('cfgSubtitulo').value.trim();
    const prefixoOS = $('cfgPrefixo').value.trim();
    const status = $('cfgStatus');
    try {
      await api('POST', '/api/config/grupo', { loginNome: nome, loginSubtitulo: subtitulo, prefixoOS });
      const arquivo = $('cfgLogo').files[0];
      if (arquivo) {
        const imagem = await redimensionarImagem(arquivo, 600); // largura máxima 600 px
        await api('POST', '/api/config/logo', { imagem });
      }
      if (status) status.textContent = '✅ Salvo';
      avisar('Configurações da tela de login salvas.');
      await aplicarIdentidade();
      const img = $('cfgPreviaLogo');
      if (img && estado.grupo) img.innerHTML = `<img src="${esc(estado.grupo.logo)}" alt="logo do grupo" style="max-width:220px;border-radius:10px;">`;
    } catch (e) {
      if (status) status.textContent = '';
      avisar(e.message, 'erro');
    }
  }

  // ------------------------------------------- dados da OS impressa (lojas, garantia, prazo)
  async function carregarConfigImpressao() {
    const box = $('cfgImpressao');
    if (!box) return;
    let dados;
    try {
      dados = await api('GET', '/api/os-config');
    } catch (e) {
      box.innerHTML = `<span class="hint">${esc(e.message)}</span>`;
      return;
    }
    estado.configImpressao = dados;
    const somenteLeitura = dados.podeEditar === false ? ' disabled' : '';
    const lojas = (dados.lojas || []).map((l) => `
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;">
        <strong>${esc(l.nome || l.codigo)}</strong>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:8px;">
          <div class="field-row"><label>Nome na OS</label>
            <input class="search-input" data-loja="${esc(l.codigo)}" data-campo="nome" value="${esc(l.nome || '')}"${somenteLeitura}></div>
          <div class="field-row"><label>Telefone</label>
            <input class="search-input" data-loja="${esc(l.codigo)}" data-campo="telefone" value="${esc(l.telefone || '')}" placeholder="(22) 99999-0000"${somenteLeitura}></div>
          <div class="field-row"><label>CNPJ</label>
            <input class="search-input" data-loja="${esc(l.codigo)}" data-campo="cnpj" value="${esc(l.cnpj || '')}" placeholder="00.000.000/0001-00"${somenteLeitura}></div>
          <div class="field-row" style="grid-column:1/-1;"><label>Endereço</label>
            <input class="search-input" data-loja="${esc(l.codigo)}" data-campo="endereco" value="${esc(l.endereco || '')}" placeholder="Rua, número, bairro, cidade"${somenteLeitura}></div>
          <div class="field-row"><label>Cor da loja na OS (a da logomarca)</label>
            <input type="color" data-loja="${esc(l.codigo)}" data-campo="cor" value="${esc(l.cor || '')}" style="width:64px;height:34px;padding:2px;"${somenteLeitura}></div>
        </div>
      </div>`).join('');
    box.innerHTML = `${lojas}
      <div class="field-row"><label>Texto de garantia (sai em cada via, vale para todas as lojas)</label>
        <textarea id="cfgGarantia" rows="2" class="search-input"${somenteLeitura}>${esc(dados.impressao.garantia)}</textarea></div>
      <div class="field-row"><label>Prazo de entrega (sai em cada via, vale para todas as lojas)</label>
        <input id="cfgPrazo" class="search-input" value="${esc(dados.impressao.prazo)}"${somenteLeitura}></div>`;
  }

  async function salvarConfigImpressao() {
    const status = $('cfgImpressaoStatus');
    const lojas = [...document.querySelectorAll('#cfgImpressao [data-loja]')].reduce((acc, el) => {
      const codigo = el.dataset.loja;
      const item = acc.find((l) => l.codigo === codigo) || { codigo };
      item[el.dataset.campo] = el.value.trim();
      if (!acc.includes(item)) acc.push(item);
      return acc;
    }, []);
    try {
      await api('PUT', '/api/os-config', {
        lojas,
        impressao: {
          garantia: $('cfgGarantia') ? $('cfgGarantia').value.trim() : undefined,
          prazo: $('cfgPrazo') ? $('cfgPrazo').value.trim() : undefined,
        },
      });
      if (status) status.textContent = '✅ Salvo';
      avisar('Dados da OS impressa salvos.');
    } catch (e) {
      if (status) status.textContent = '';
      avisar(e.message, 'erro');
    }
  }

  // ---------------------------------------------------------------- ligação dos botões
  function ligarBotoes() {
    const pares = [
      ['btnRecarregarEstoque', carregarEstoquePorLoja],
      ['btnDistribuir', abrirDistribuicao],
      ['btnSalvarDistribuicao', salvarDistribuicao],
      ['btnCancelarDistribuicao', () => { $('painelDistribuir').style.display = 'none'; }],
      ['btnTransferir', transferir],
      ['btnPreviaImportacao', verPrevia],
      ['btnConfirmarImportacao', confirmarImportacao],
      ['btnCancelarImportacao', () => { estado.previa = null; $('painelPreviaImportacao').style.display = 'none'; }],
      ['btnEnviarChat', enviarMensagem],
      ['btnAtivarSons', ativarSons],
      ['btnAbrirChamado', () => { $('painelNovoChamado').style.display = ''; $('painelNovoChamado').scrollIntoView({ behavior: 'smooth' }); }],
      ['btnCancelarChamado', () => { $('painelNovoChamado').style.display = 'none'; }],
      ['btnCriarChamado', criarChamado],
      ['btnAtualizarChamados', carregarChamados],
      ['btnSalvarConfig', salvarConfiguracoes],
      ['btnSalvarImpressao', salvarConfigImpressao],
    ];
    for (const [id, acao] of pares) {
      const el = $(id);
      if (el) el.addEventListener('click', acao);
    }
    const texto = $('chatTexto');
    if (texto) {
      texto.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviarMensagem(); }
      });
    }
    const volume = $('chatVolume');
    if (volume) {
      volume.addEventListener('input', () => {
        som.volume = Math.max(0, Math.min(1, Number(volume.value) / 100));
        salvarPreferenciasDeSom();
        atualizarStatusSom();
      });
      volume.addEventListener('change', () => tocarBipe());
    }
    const ligado = $('chatSomLigado');
    if (ligado) {
      ligado.addEventListener('change', () => {
        som.ligado = ligado.checked;
        salvarPreferenciasDeSom();
        atualizarStatusSom();
        if (som.ligado) { pararAlarme(); }
      });
    }
    const selLoja = $('selLojaEstoque');
    if (selLoja) selLoja.addEventListener('change', carregarEstoquePorLoja);
  }

  // ---------------------------------------------------------------- início
  async function iniciar() {
    try {
      const eu = await api('GET', '/api/eu');
      estado.eu = eu.usuario;
    } catch (e) {
      return; // não logado: a tela principal já redireciona
    }
    carregarPreferenciasDeSom();
    liberarSomSozinho();
    await aplicarIdentidade();
    montarAbas();
    ligarBotoes();
    conectarSocket();
    // contador de não lidas de tempos em tempos (mesmo fora da aba de chat)
    setInterval(async () => {
      try {
        const n = await api('GET', '/api/chat/naolidas');
        atualizarBadge(n);
      } catch (e) { /* silencioso */ }
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
