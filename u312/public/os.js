// UNICAR - Telas de Ordem de Serviço (OS) e painel das lojas
//
// Este arquivo é carregado DEPOIS do script do sistema, então usa o que já existe:
// as mesmas classes (panel, table, stat-card, filter-chip, badge, btn-*), o mesmo
// toast (#toast) e as mesmas variáveis de cor do tema. Nada de estilo novo inventado.
//
// As abas novas entram no mesmo esquema do sistema: <button class="tab" data-view="os">
// e <div class="view" id="view-os">. A troca de aba é a que já existe.
//
// Toda permissão é conferida de novo no servidor: aqui a gente só evita mostrar
// botão que a pessoa não pode usar.

(() => {
  'use strict';

  // Mesma lista de pagamento.js (o servidor valida e ignora qualquer valor fora dela).
  const FORMAS_PAGAMENTO_OS = [
    { codigo: 'dinheiro', rotulo: 'Dinheiro' },
    { codigo: 'pix', rotulo: 'PIX' },
    { codigo: 'cartao_credito', rotulo: 'Cartão de Crédito' },
    { codigo: 'cartao_debito', rotulo: 'Cartão de Débito' },
    { codigo: 'boleto', rotulo: 'Boleto' },
    { codigo: 'transferencia', rotulo: 'Transferência bancária' },
    { codigo: 'cheque', rotulo: 'Cheque' },
    { codigo: 'crediario', rotulo: 'Crediário / Fiado' },
    { codigo: 'misto', rotulo: 'Misto (mais de uma forma)' },
    { codigo: 'outro', rotulo: 'Outro' },
  ];

  const STATUS = [
    { chave: 'aberta', rotulo: 'Aberta', classe: 'os-aberta' },
    { chave: 'em analise', rotulo: 'Em análise', classe: 'os-analise' },
    { chave: 'aguardando aprovacao', rotulo: 'Aguardando aprovação', classe: 'os-aprovacao' },
    { chave: 'aprovada', rotulo: 'Aprovada', classe: 'os-aprovada' },
    { chave: 'em execucao', rotulo: 'Em execução', classe: 'os-execucao' },
    { chave: 'aguardando peca', rotulo: 'Aguardando peça', classe: 'os-peca' },
    { chave: 'finalizada', rotulo: 'Finalizada', classe: 'os-finalizada' },
    { chave: 'entregue', rotulo: 'Entregue', classe: 'os-entregue' },
    { chave: 'cancelada', rotulo: 'Cancelada', classe: 'os-cancelada' },
  ];
  const TIPOS_ITEM = [
    { chave: 'pneu', rotulo: 'Pneu' },
    { chave: 'peca', rotulo: 'Peça' },
    { chave: 'produto', rotulo: 'Produto' },
    { chave: 'mao de obra', rotulo: 'Mão de obra' },
  ];

  const estado = {
    eu: null,
    lojas: [],
    minhaLoja: null,
    todas: false,
    lista: [],
    filtros: { busca: '', status: '', loja: '', de: '', ate: '' },
    editando: null,
    itens: [],
    mecanicos: [],
    estoque: [],
    painel: null,
  };

  // ---------------------------------------------------------------- utilidades
  const esc = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const brl = (v) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;
  const dataHora = (ms) => (ms ? new Date(Number(ms)).toLocaleString('pt-BR') : '—');
  const dataCurta = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString('pt-BR') : '—');
  const numero = (v) => Number(v) || 0;
  const rotuloStatus = (chave) => (STATUS.find((s) => s.chave === chave) || { rotulo: chave }).rotulo;
  const classeStatus = (chave) => (STATUS.find((s) => s.chave === chave) || { classe: '' }).classe;

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) { window.alert(msg); return; }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  async function pedir(metodo, url, corpo) {
    const resposta = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const tipo = resposta.headers.get('content-type') || '';
    const dados = tipo.includes('json') ? await resposta.json().catch(() => null) : await resposta.text();
    if (!resposta.ok) {
      const msg = (dados && dados.error) || 'Não foi possível concluir a operação.';
      const erro = new Error(msg);
      erro.status = resposta.status;
      erro.corpo = dados; // para a tela poder mostrar, por exemplo, o que falta no estoque
      throw erro;
    }
    return dados;
  }

  const pode = (chave) => !!(estado.eu && estado.eu.permissoes && estado.eu.permissoes[chave]);
  const ehAdmin = () => !!(estado.eu && estado.eu.perfil === 'admin');
  // Mecânico responsável por ESTA OS: o servidor deixa ele andar com a parte técnica
  // (colocar em execução, aguardar peça, finalizar) — a tela precisa oferecer o mesmo.
  const souMecanicoDaOS = (os) => !!(
    os && estado.eu && estado.eu.perfil === 'mecanico' && os.mecanicoId && os.mecanicoId === estado.eu.id
  );
  const podeMudarStatusDa = (os) => pode('mudarStatus') || ehAdmin() || souMecanicoDaOS(os);
  const opcoesLoja = (valor) => estado.lojas
    .map((l) => `<option value="${esc(l.codigo)}"${l.codigo === valor ? ' selected' : ''}>${esc(l.nome)}</option>`)
    .join('');

  // ------------------------------------------------------------------ carregar
  async function carregarContexto() {
    try {
      const eu = await pedir('GET', '/api/eu');
      estado.eu = eu.usuario;
      const lojas = await pedir('GET', '/api/lojas');
      estado.lojas = lojas.lojas || [];
      estado.minhaLoja = lojas.minhaLoja || null;
      estado.todas = !!lojas.todas;
      try {
        const estoque = await pedir('GET', '/api/os-estoque');
        estado.estoque = estoque.itens || [];
      } catch (e) { estado.estoque = []; }
      if (!estado.todas) estado.filtros.loja = '';
      mostrarAbasPermitidas();
      preencherSelectLojaDoUsuario();
      return true;
    } catch (e) {
      return false;
    }
  }

  function mostrarAbasPermitidas() {
    const abaOS = document.getElementById('tabOS');
    const abaPainel = document.getElementById('tabPainelOS');
    const podeVerOS = !!estado.eu;
    if (abaOS) abaOS.style.display = podeVerOS ? '' : 'none';
    if (abaPainel) abaPainel.style.display = pode('verPainelDaLoja') || ehAdmin() ? '' : 'none';
    const rotulo = document.getElementById('userPerfil');
    if (rotulo && estado.eu) {
      const onde = estado.eu.loja ? estado.eu.loja : 'todas as lojas';
      rotulo.textContent = `${estado.eu.perfilRotulo || estado.eu.perfil} · ${onde}`;
    }
  }

  // Preenche o campo "Loja" do cadastro de usuários (aba Usuários, que já existe)
  function preencherSelectLojaDoUsuario() {
    const select = document.getElementById('uLoja');
    if (!select) return;
    select.innerHTML = estado.lojas.map((l) => `<option value="${esc(l.codigo)}">${esc(l.nome)}</option>`).join('');
  }

  // --------------------------------------------------------------- aba: lista
  function desenharListaOS() {
    const container = document.getElementById('view-os');
    if (!container) return;
    const filtroLoja = estado.todas
      ? `<select class="search-input" id="osFiltroLoja" style="max-width:150px;"><option value="">Todas as lojas</option>${opcoesLoja(estado.filtros.loja)}</select>`
      : `<span class="status-pill">🏪 ${esc(estado.minhaLoja || '—')}</span>`;

    container.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-header">
          <h2>Ordens de Serviço</h2>
          <div class="toolbar">
            <input class="search-input" id="osBusca" placeholder="Número, cliente, telefone ou placa…" value="${esc(estado.filtros.busca)}">
            ${filtroLoja}
            <input type="date" class="search-input" id="osDe" style="max-width:150px;" value="${esc(estado.filtros.de)}" title="Abertas a partir de">
            <input type="date" class="search-input" id="osAte" style="max-width:150px;" value="${esc(estado.filtros.ate)}" title="Abertas até">
            <button class="btn-secondary btn-sm" id="osExportar" type="button">📤 Exportar CSV</button>
            <button class="btn-secondary btn-sm" id="osBranco" type="button" title="Imprimir a folha em branco para preencher à mão">🖨️ Versão em branco</button>
            <button class="btn-primary btn-sm" id="osNova" type="button">+ Nova OS</button>
          </div>
        </div>
        <div class="panel-body" style="padding-top:12px;padding-bottom:4px;">
          <div class="filters-row" id="osChips">
            <button class="filter-chip${estado.filtros.status === '' ? ' active' : ''}" data-os-status="">Todas</button>
            ${STATUS.map((s) => `<button class="filter-chip${estado.filtros.status === s.chave ? ' active' : ''}" data-os-status="${s.chave}">${s.rotulo}</button>`).join('')}
          </div>
        </div>
        <div class="table-wrap" id="osTabelaWrap"></div>
      </div>`;

    container.querySelector('#osBusca').addEventListener('input', (e) => {
      estado.filtros.busca = e.target.value;
      clearTimeout(desenharListaOS._t);
      desenharListaOS._t = setTimeout(carregarListaOS, 350);
    });
    container.querySelector('#osDe').addEventListener('change', (e) => { estado.filtros.de = e.target.value; carregarListaOS(); });
    container.querySelector('#osAte').addEventListener('change', (e) => { estado.filtros.ate = e.target.value; carregarListaOS(); });
    const selLoja = container.querySelector('#osFiltroLoja');
    if (selLoja) selLoja.addEventListener('change', (e) => { estado.filtros.loja = e.target.value; carregarListaOS(); });
    container.querySelector('#osExportar').addEventListener('click', exportarCSV);
    container.querySelector('#osNova').addEventListener('click', () => abrirFormularioOS(null));
    container.querySelector('#osBranco').addEventListener('click', abrirModeloEmBranco);
    container.querySelectorAll('#osChips .filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        estado.filtros.status = chip.dataset.osStatus;
        container.querySelectorAll('#osChips .filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        carregarListaOS();
      });
    });
  }

  function desenharTabelaOS() {
    const wrap = document.getElementById('osTabelaWrap');
    if (!wrap) return;
    if (!estado.lista.length) {
      wrap.innerHTML = '<div class="empty-state"><p>Nenhuma ordem de serviço encontrada com esses filtros.</p></div>';
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Número</th>${estado.todas ? '<th class="os-col-loja">Loja</th>' : ''}<th>Cliente</th><th>Placa</th>
            <th>Status</th><th>Total</th><th class="os-col-data">Aberta em</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${estado.lista.map((os) => `
            <tr>
              <td class="os-num"><div class="cell-main">${esc(os.numero)}</div>${os.responsavel ? `<div style="font-size:11.5px;color:var(--text-faint);">${esc(os.responsavel)}</div>` : ''}</td>
              ${estado.todas ? `<td class="os-col-loja">${esc(os.loja)}</td>` : ''}
              <td><div class="cell-main">${esc(os.clienteNome)}</div><div style="font-size:11.5px;color:var(--text-faint);">${esc(os.clienteTelefone)}</div></td>
              <td>${esc(os.placa)}${os.veiculo ? `<div style="font-size:11.5px;color:var(--text-faint);">${esc(os.veiculo)}</div>` : ''}</td>
              <td><span class="badge ${classeStatus(os.status)}">${esc(os.statusRotulo || rotuloStatus(os.status))}</span></td>
              <td>${brl(os.total)}</td>
              <td class="os-col-data">${dataCurta(os.aberturaEm)}</td>
              <td style="white-space:nowrap;">
                <button class="btn-ghost btn-sm" data-os-ver="${esc(os.numero)}" data-os-id="${esc(os.id)}">Ver</button>
                <button class="btn-ghost btn-sm" data-os-imprimir="${esc(os.numero)}">🖨️</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('[data-os-ver]').forEach((b) => b.addEventListener('click', () => abrirDetalheOS(b.dataset.osId)));
    wrap.querySelectorAll('[data-os-imprimir]').forEach((b) => b.addEventListener('click', () => imprimirOS(b.dataset.osImprimir)));
  }

  async function carregarListaOS() {
    const params = new URLSearchParams();
    if (estado.filtros.busca) {
      const bruto = estado.filtros.busca.trim();
      if (/^os-/i.test(bruto)) params.set('numero', bruto);
      else if (/^[a-z]{3}[0-9][a-z0-9]/i.test(bruto) && bruto.length <= 8) params.set('placa', bruto);
      else if (/^[\d\s()+-]+$/.test(bruto)) params.set('telefone', bruto);
      else params.set('cliente', bruto);
    }
    if (estado.filtros.status) params.set('status', estado.filtros.status);
    if (estado.filtros.loja) params.set('loja', estado.filtros.loja);
    if (estado.filtros.de) params.set('de', estado.filtros.de);
    if (estado.filtros.ate) params.set('ate', estado.filtros.ate);
    try {
      const dados = await pedir('GET', `/api/os?${params.toString()}`);
      estado.lista = dados.os || [];
      desenharTabelaOS();
    } catch (e) {
      toast(e.message);
    }
  }

  // Folha em branco: vendedor tira da própria loja; administrador, da loja filtrada.
  function abrirModeloEmBranco() {
    const loja = estado.todas ? (estado.filtros.loja || estado.minhaLoja || '') : (estado.minhaLoja || '');
    window.open('/api/os-branco/imprimir' + (loja ? '?loja=' + encodeURIComponent(loja) : ''), '_blank');
  }

  function exportarCSV() {
    const params = new URLSearchParams();
    if (estado.filtros.status) params.set('status', estado.filtros.status);
    if (estado.filtros.loja) params.set('loja', estado.filtros.loja);
    if (estado.filtros.de) params.set('de', estado.filtros.de);
    if (estado.filtros.ate) params.set('ate', estado.filtros.ate);
    window.location.href = `/api/os-exportar.csv?${params.toString()}`;
  }

  function imprimirOS(chave) {
    window.open(`/api/os/${encodeURIComponent(chave)}/imprimir`, '_blank');
  }

  // ------------------------------------------------------ aba: painel da loja
  async function carregarPainel() {
    const container = document.getElementById('view-painel-os');
    if (!container) return;
    const selectLoja = estado.todas
      ? `<select class="search-input" id="painelLoja" style="max-width:170px;">
           <option value="todas">Todas as lojas</option>${opcoesLoja(estado.painelLoja || '')}
         </select>`
      : `<span class="status-pill">🏪 ${esc(estado.minhaLoja || '—')}</span>`;
    container.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-header">
          <h2>Painel ${esc(estado.todas ? 'das lojas' : 'da loja ' + (estado.minhaLoja || ''))}</h2>
          <div class="toolbar">
            ${selectLoja}
            <input type="date" class="search-input" id="painelDe" style="max-width:150px;" value="${esc(estado.painelDe || '')}" title="A partir de">
            <input type="date" class="search-input" id="painelAte" style="max-width:150px;" value="${esc(estado.painelAte || '')}" title="Até">
            <button class="btn-secondary btn-sm" id="painelAtualizar" type="button">🔄 Atualizar</button>
          </div>
        </div>
        <div class="panel-body"><div id="painelConteudo"><div class="empty-state"><p>Carregando…</p></div></div></div>
      </div>`;
    const sel = container.querySelector('#painelLoja');
    if (sel) sel.addEventListener('change', (e) => { estado.painelLoja = e.target.value; carregarPainel(); });
    container.querySelector('#painelDe').addEventListener('change', (e) => { estado.painelDe = e.target.value; carregarPainel(); });
    container.querySelector('#painelAte').addEventListener('change', (e) => { estado.painelAte = e.target.value; carregarPainel(); });
    container.querySelector('#painelAtualizar').addEventListener('click', carregarPainel);

    const params = new URLSearchParams();
    if (estado.todas && estado.painelLoja && estado.painelLoja !== 'todas') params.set('loja', estado.painelLoja);
    if (estado.painelDe) params.set('de', estado.painelDe);
    if (estado.painelAte) params.set('ate', estado.painelAte);

    try {
      const painel = await pedir('GET', `/api/painel?${params.toString()}`);
      estado.painel = painel;
      desenharPainel(painel);
    } catch (e) {
      const alvo = container.querySelector('#painelConteudo');
      if (alvo) alvo.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    }
  }

  function desenharPainel(painel) {
    const alvo = document.getElementById('painelConteudo');
    if (!alvo) return;
    const porStatus = painel.porStatus || {};
    const cartoes = ['aberta', 'em analise', 'aguardando aprovacao', 'em execucao', 'finalizada', 'entregue', 'cancelada'];
    const destaque = (chave) => (chave === 'cancelada' ? 'bad' : (chave === 'finalizada' || chave === 'entregue' ? 'accent' : ''));

    const listaPendentes = (painel.pendentes || []).map((p) => `
      <tr>
        <td><div class="cell-main">${esc(p.numero)}</div>${estado.todas ? `<div style="font-size:11.5px;color:var(--text-faint);">${esc(p.loja)}</div>` : ''}</td>
        <td>${esc(p.cliente)}<div style="font-size:11.5px;color:var(--text-faint);">${esc(p.telefone)}</div></td>
        <td><span class="badge ${classeStatus(p.status)}">${esc(p.statusRotulo)}</span></td>
        <td>${p.diasAberto === 0 ? 'hoje' : `${p.diasAberto} dia(s)`}</td>
        <td>${brl(p.total)}</td>
      </tr>`).join('') || '<tr><td colspan="5">Nenhuma OS pendente. 🎉</td></tr>';

    const servicos = (painel.servicosMaisRealizados || []).map((s) => `
      <tr><td>${esc(s.descricao)}</td><td>${numero(s.quantidade)}</td><td>${brl(s.valor)}</td></tr>`).join('')
      || '<tr><td colspan="3">Sem serviços registrados no período.</td></tr>';

    const clientes = (painel.clientesRecentes || []).map((c) => `
      <tr>
        <td><div class="cell-main">${esc(c.nome)}</div><div style="font-size:11.5px;color:var(--text-faint);">${esc(c.telefone)}</div></td>
        <td>${esc(c.placa)} ${esc(c.veiculo)}</td>
        <td>${esc(c.ultimaOS)}<div style="font-size:11.5px;color:var(--text-faint);">${dataCurta(c.ultimaEm)}</div></td>
      </tr>`).join('') || '<tr><td colspan="3">Nenhum cliente no período.</td></tr>';

    const tabelaLojas = estado.todas && Array.isArray(painel.porLoja) ? `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-header"><h2>Resumo por loja</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Loja</th><th>Abertas</th><th>Em execução</th><th>Finalizadas</th><th>Entregues</th><th>Canceladas</th><th>Pendentes</th><th>Faturamento</th></tr></thead>
            <tbody>
              ${painel.porLoja.map((l) => `
                <tr>
                  <td><div class="cell-main">${esc(l.nome)}</div></td>
                  <td>${numero((l.porStatus || {})['aberta'])}</td>
                  <td>${numero((l.porStatus || {})['em execucao'])}</td>
                  <td>${numero((l.porStatus || {})['finalizada'])}</td>
                  <td>${numero((l.porStatus || {})['entregue'])}</td>
                  <td>${numero((l.porStatus || {})['cancelada'])}</td>
                  <td>${(l.pendentes || []).length}</td>
                  <td>${brl(l.faturamento)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    alvo.innerHTML = `
      <div class="cards-grid tres" style="margin-bottom:18px;">
        ${cartoes.map((c) => `
          <div class="stat-card">
            <div class="label">${rotuloStatus(c)}</div>
            <div class="value ${destaque(c)}">${numero(porStatus[c])}</div>
            <div class="sub">ordens no período</div>
          </div>`).join('')}
        <div class="stat-card">
          <div class="label">Faturamento</div>
          <div class="value accent">${brl(painel.faturamento)}</div>
          <div class="sub">OS finalizadas e entregues</div>
        </div>
        <div class="stat-card">
          <div class="label">Em andamento</div>
          <div class="value">${brl(painel.emAndamentoValor)}</div>
          <div class="sub">valor das OS abertas</div>
        </div>
        <div class="stat-card">
          <div class="label">Total de OS</div>
          <div class="value">${numero(painel.total)}</div>
          <div class="sub">${esc(painel.nomeLoja || '')}</div>
        </div>
      </div>

      ${tabelaLojas}

      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-header"><h2>OS pendentes</h2></div>
        <div class="table-wrap">
          <table><thead><tr><th>OS</th><th>Cliente</th><th>Status</th><th>Aberta há</th><th>Total</th></tr></thead>
          <tbody>${listaPendentes}</tbody></table>
        </div>
      </div>

      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-header"><h2>Serviços mais realizados</h2></div>
        <div class="table-wrap">
          <table><thead><tr><th>Serviço</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${servicos}</tbody></table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h2>Clientes recentes</h2></div>
        <div class="table-wrap">
          <table><thead><tr><th>Cliente</th><th>Veículo</th><th>Última OS</th></tr></thead><tbody>${clientes}</tbody></table>
        </div>
      </div>`;
  }

  // ------------------------------------------------- formulário (abrir/editar)
  // Opções do seletor "item do estoque" (é o vínculo que permite a baixa automática)
  function opcoesEstoque(estoqueId, estoqueTipo) {
    const escolhido = estoqueId ? `${estoqueTipo || 'pneus'}|${estoqueId}` : '';
    const opcoes = (estado.estoque || []).map((i) => {
      const valor = `${i.tipo}|${i.id}`;
      const icone = i.tipo === 'bebidas' ? '🥤' : '🛞';
      return `<option value="${esc(valor)}"${valor === escolhido ? ' selected' : ''}>${icone} ${esc(i.descricao)} — ${numero(i.quantidade)} un.</option>`;
    }).join('');
    return `<option value="">— não mexe no estoque —</option>${opcoes}`;
  }

  function saldoDoEstoque(estoqueId) {
    if (!estoqueId) return '';
    const item = (estado.estoque || []).find((i) => String(i.id) === String(estoqueId));
    if (!item) return 'item não encontrado no estoque';
    return `disponível: ${numero(item.quantidade)} un.${item.detalhe ? ` · ${item.detalhe}` : ''}`;
  }

  function listaFaltando(faltando) {
    return (faltando || []).map((f) => `• ${f.descricao}: tem ${numero(f.disponivel)}, precisa ${numero(f.necessario)}${f.faltam ? ` (faltam ${numero(f.faltam)})` : ''}`).join('\n');
  }

  function linhaItem(item = {}) {
    const tipo = item.tipo || 'peca';
    return `
      <tr data-os-item data-item-id="${item.id ? esc(item.id) : ''}">
        <td>
          <select data-item-tipo>
            ${TIPOS_ITEM.map((t) => `<option value="${t.chave}"${t.chave === tipo ? ' selected' : ''}>${t.rotulo}</option>`).join('')}
          </select>
        </td>
        <td><input data-item-descricao placeholder="Descrição" value="${esc(item.descricao || '')}"></td>
        <td>
          <select data-item-estoque>${opcoesEstoque(item.estoqueId, item.estoqueTipo)}</select>
          <div data-estoque-saldo style="font-size:11px;color:var(--text-faint);margin-top:2px;">${esc(saldoDoEstoque(item.estoqueId))}</div>
        </td>
        <td><input data-item-qtd type="number" min="0" step="1" style="max-width:80px;" value="${item.quantidade === undefined ? 1 : esc(item.quantidade)}"></td>
        <td><input data-item-valor type="number" min="0" step="0.01" style="max-width:110px;" value="${item.valorUnitario === undefined ? 0 : esc(item.valorUnitario)}"></td>
        <td><input data-item-desconto type="number" min="0" step="0.01" style="max-width:100px;" value="${item.desconto === undefined ? 0 : esc(item.desconto)}"></td>
        <td data-item-total style="white-space:nowrap;">${brl(item.total)}</td>
        <td><button class="btn-danger-ghost btn-sm" type="button" data-item-remover>Tirar</button></td>
      </tr>`;
  }

  // ---- busca de cliente já cadastrado (base única do grupo) ----
  const CAMPOS_CLIENTE = {
    nome: 'osClienteNome', cpfCnpj: 'osClienteDoc', telefone: 'osClienteTel', whatsapp: 'osClienteZap',
    email: 'osClienteEmail', endereco: 'osClienteEndereco', bairro: 'osClienteBairro', cidade: 'osClienteCidade',
    cep: 'osClienteCep', rgIe: 'osClienteRg', midia: 'osClienteMidia', contato: 'osClienteContato', referencia: 'osClienteReferencia',
  };

  function preencherCliente(overlay, cliente) {
    overlay.querySelector('#osClienteId').value = cliente.id || '';
    for (const [campo, id] of Object.entries(CAMPOS_CLIENTE)) {
      const campoEl = overlay.querySelector('#' + id);
      if (!campoEl) continue;
      const valor = cliente[campo] || '';
      if (valor || !campoEl.value) campoEl.value = valor;
    }
    const vinculo = overlay.querySelector('#osClienteVinculo');
    if (vinculo) vinculo.textContent = cliente.id ? `👤 ${cliente.nome} — cliente da base do grupo` : 'Cliente novo: será cadastrado ao salvar';
  }

  function ligarBuscaCliente(overlay) {
    const busca = overlay.querySelector('#osClienteBusca');
    const lista = overlay.querySelector('#osClienteSugestoes');
    const esconder = () => { if (lista) lista.innerHTML = ''; };
    if (!busca || !lista) return;
    let timer = null;

    // se mexer no nome (cliente novo), desfaz o vínculo antigo
    const nome = overlay.querySelector('#osClienteNome');
    if (nome) {
      nome.addEventListener('input', () => {
        const id = overlay.querySelector('#osClienteId');
        if (id && id.value) {
          id.value = '';
          const vinculo = overlay.querySelector('#osClienteVinculo');
          if (vinculo) vinculo.textContent = 'Cliente novo: será cadastrado ao salvar';
        }
      });
    }

    busca.addEventListener('input', () => {
      clearTimeout(timer);
      const termo = busca.value.trim();
      if (termo.length < 2) { esconder(); return; }
      timer = setTimeout(async () => {
        try {
          const r = await pedir('GET', `/api/clientes?limite=8&busca=${encodeURIComponent(termo)}`);
          const achados = (r && r.clientes) || [];
          if (!achados.length) {
            lista.innerHTML = '<div class="sugestao">Nenhum cliente encontrado — os dados abaixo serão usados para cadastrar um novo.</div>';
            return;
          }
          lista.innerHTML = achados.map((c, i) => `
            <div class="sugestao" data-cliente="${esc(c.id)}" data-indice="${i}">
              <span>${esc(c.nome)}${c.cidade ? ` <span class="doc">· ${esc(c.cidade)}</span>` : ''}</span>
              <span class="doc">${esc(c.cpfCnpj || c.telefone || '')}</span>
            </div>`).join('');
          lista.querySelectorAll('[data-cliente]').forEach((linha) => {
            linha.addEventListener('click', () => {
              const cliente = achados[Number(linha.dataset.indice)];
              if (cliente) preencherCliente(overlay, cliente);
              busca.value = '';
              esconder();
            });
          });
        } catch (e) {
          lista.innerHTML = `<div class="sugestao">${esc(e.message)}</div>`;
        }
      }, 220);
    });

    document.addEventListener('click', (ev) => {
      if (!lista.contains(ev.target) && ev.target !== busca) esconder();
    });
  }

  // usado pela tela de Clientes ("Nova OS" com o cliente escolhido)
  window.unicarNovaOSComCliente = function (cliente) {
    if (!pode('criarOS')) { toast('Seu perfil não pode abrir uma OS.'); return; }
    abrirFormularioOS(null);
    const overlay = document.getElementById('osFormOverlay');
    if (overlay && cliente) preencherCliente(overlay, cliente);
  };

  function abrirFormularioOS(os) {
    if (!pode('criarOS') && !os) { toast('Seu perfil não pode abrir uma OS.'); return; }
    estado.editando = os || null;
    estado.itens = os && Array.isArray(os.itens) ? os.itens.map((i) => ({ ...i })) : [];

    const lojaFixa = os ? os.loja : (estado.todas ? (estado.filtros.loja || estado.lojas[0]?.codigo || '') : estado.minhaLoja);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'osFormOverlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:820px;">
        <div class="modal-header">
          <h3>${os ? `Editar ${esc(os.numero)}` : 'Nova Ordem de Serviço'}</h3>
          <button class="close-x" id="osFecharForm">✕</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow:auto;">
          <div class="field-row">
            <div class="field">
              <label>Loja do atendimento</label>
              <select id="osLoja" ${estado.todas ? '' : 'disabled'}>${opcoesLoja(lojaFixa)}</select>
            </div>
            <div class="field">
              <label>Status</label>
              <select id="osStatus">${STATUS.filter((s) => s.chave !== 'cancelada').map((s) => `<option value="${s.chave}"${os && os.status === s.chave ? ' selected' : ''}>${s.rotulo}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Mecânico/Técnico</label>
              <select id="osMecanico"><option value="">— não definido —</option></select>
            </div>
          </div>

          <h4 style="margin:14px 0 6px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;">Cliente</h4>
          <div class="field-row">
            <div class="field" style="grid-column:1/-1;position:relative;">
              <label>Usar cliente já cadastrado (nome, CPF/CNPJ ou telefone)</label>
              <input id="osClienteBusca" placeholder="digite 2 letras ou o CPF…" autocomplete="off">
              <input type="hidden" id="osClienteId" value="${esc(os?.clienteId || '')}">
              <div class="lista-sugestoes" id="osClienteSugestoes"></div>
              <span class="hint" id="osClienteVinculo">${os?.clienteId ? '👤 Cliente da base do grupo' : 'Cliente novo: será cadastrado ao salvar'}</span>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label>Nome completo *</label><input id="osClienteNome" value="${esc(os?.cliente?.nome || '')}"></div>
            <div class="field"><label>CPF/CNPJ</label><input id="osClienteDoc" value="${esc(os?.cliente?.cpfCnpj || '')}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Telefone</label><input id="osClienteTel" value="${esc(os?.cliente?.telefone || '')}"></div>
            <div class="field"><label>WhatsApp</label><input id="osClienteZap" value="${esc(os?.cliente?.whatsapp || '')}"></div>
            <div class="field"><label>E-mail</label><input id="osClienteEmail" value="${esc(os?.cliente?.email || '')}"></div>
          </div>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Endereço</label><input id="osClienteEndereco" value="${esc(os?.cliente?.endereco || '')}"></div>
            <div class="field"><label>Bairro</label><input id="osClienteBairro" value="${esc(os?.cliente?.bairro || '')}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Município</label><input id="osClienteCidade" value="${esc(os?.cliente?.cidade || '')}"></div>
            <div class="field"><label>CEP</label><input id="osClienteCep" value="${esc(os?.cliente?.cep || '')}"></div>
            <div class="field"><label>RG / I.E.</label><input id="osClienteRg" value="${esc(os?.cliente?.rgIe || '')}"></div>
            <div class="field"><label>Mídia</label><input id="osClienteMidia" value="${esc(os?.cliente?.midia || '')}" placeholder="indicação, redes…"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Contato</label><input id="osClienteContato" value="${esc(os?.cliente?.contato || '')}"></div>
            <div class="field" style="flex:2"><label>Ponto de referência</label><input id="osClienteReferencia" value="${esc(os?.cliente?.referencia || '')}"></div>
          </div>

          <h4 style="margin:14px 0 6px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;">Veículo</h4>
          <div class="field-row">
            <div class="field"><label>Placa</label><input id="osVeiculoPlaca" value="${esc(os?.veiculo?.placa || '')}" style="text-transform:uppercase;"></div>
            <div class="field"><label>Marca</label><input id="osVeiculoMarca" value="${esc(os?.veiculo?.marca || '')}"></div>
            <div class="field"><label>Modelo</label><input id="osVeiculoModelo" value="${esc(os?.veiculo?.modelo || '')}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Ano</label><input id="osVeiculoAno" value="${esc(os?.veiculo?.ano || '')}"></div>
            <div class="field"><label>Quilometragem</label><input id="osVeiculoKm" value="${esc(os?.veiculo?.km || '')}"></div>
            <div class="field"><label>Observações do veículo</label><input id="osVeiculoObs" value="${esc(os?.veiculo?.observacoes || '')}"></div>
          </div>

          <div class="field"><label>Serviços solicitados</label><textarea id="osServicos">${esc(os?.servicosSolicitados || '')}</textarea></div>

          <h4 style="margin:14px 0 6px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;">Pneus, peças, produtos e mão de obra</h4>
          <div style="font-size:12px;color:var(--text-faint);margin-bottom:6px;">
            Escolhendo um item do estoque, a quantidade sai sozinha quando a OS entrar em <strong>Em execução</strong>.
          </div>
          <div class="table-wrap">
            <table class="os-itens-tabela">
              <thead><tr><th>Tipo</th><th>Descrição</th><th>Item do estoque</th><th>Qtd.</th><th>Valor un.</th><th>Desconto</th><th>Total</th><th></th></tr></thead>
              <tbody id="osItensCorpo">${estado.itens.map(linhaItem).join('')}</tbody>
            </table>
          </div>
          <button class="btn-secondary btn-sm" type="button" id="osAddItem" style="margin-top:8px;">+ Adicionar item</button>

          <div class="field-row" style="margin-top:14px;">
            <div class="field"><label>Desconto geral</label><input id="osDescontoValor" type="number" min="0" step="0.01" value="${esc(os?.descontoValor || 0)}"></div>
            <div class="field">
              <label>Tipo do desconto</label>
              <select id="osDescontoTipo">
                <option value="valor"${!os || os.descontoTipo !== 'percento' ? ' selected' : ''}>Em reais (R$)</option>
                <option value="percento"${os && os.descontoTipo === 'percento' ? ' selected' : ''}>Em porcentagem (%)</option>
              </select>
            </div>
            <div class="field"><label>Resumo</label><div class="card" style="padding:10px 12px;font-weight:700;" id="osResumo">—</div></div>
          </div>
          <div class="field-row">
            <div class="field" style="grid-column:1/-1;">
              <label>Forma(s) de pagamento <span class="hint">— pode somar várias (ex.: Dinheiro 500 + PIX 500)</span></label>
              <div id="osPagamentos" style="display:flex;flex-direction:column;gap:6px;"></div>
              <div class="toolbar" style="margin-top:8px;">
                <button class="btn-secondary btn-sm" type="button" id="osAddPagamento">+ Adicionar forma de pagamento</button>
                <span id="osPagResumo" style="font-weight:700;"></span>
              </div>
            </div>
          </div>
          <div class="field-row">
            <div class="field" style="grid-column:1/-1;"><label>Observação do pagamento</label><input id="osCondicoes" value="${esc(os?.condicoesPagamento || '')}" placeholder="ex.: restante no dia da entrega"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Autorização do cliente</label><input id="osAutorizado" value="${esc(os?.autorizadoPor || '')}" placeholder="quem autorizou o serviço"></div>
          </div>

          <div class="field-row">
            <div class="field"><label>Observações internas (não saem na impressão do cliente)</label><textarea id="osObsInternas">${esc(os?.observacoesInternas || '')}</textarea></div>
            <div class="field"><label>Observações para o cliente</label><textarea id="osObsCliente">${esc(os?.observacoesCliente || '')}</textarea></div>
          </div>

          <div class="field-row">
            <div class="field" style="grid-column:1/-1;"><label>Defeito relatado pelo cliente (sai na OS impressa)</label><textarea id="osDefeito" rows="2" placeholder="Ex: bolha na lateral, perda de pressão, puxando para a direita…">${esc(os?.defeito || '')}</textarea></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="osCancelarForm">Cancelar</button>
          <button class="btn-primary" id="osSalvarForm">Salvar OS</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const fechar = () => overlay.remove();
    ligarBuscaCliente(overlay);
    overlay.querySelector('#osFecharForm').addEventListener('click', fechar);
    overlay.querySelector('#osCancelarForm').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    // mecânicos da loja escolhida
    const preencherMecanicos = async () => {
      try {
        const lista = await pedir('GET', '/api/os-tecnicos');
        const alvo = overlay.querySelector('#osMecanico');
        const loja = overlay.querySelector('#osLoja').value;
        const filtrados = lista.filter((t) => t.perfil === 'mecanico' && (!t.loja || t.loja === loja || estado.todas));
        alvo.innerHTML = '<option value="">— não definido —</option>'
          + filtrados.map((t) => `<option value="${esc(t.id)}"${os && os.mecanicoId === t.id ? ' selected' : ''}>${esc(t.nome)}</option>`).join('');
      } catch (e) { /* sem técnicos: segue */ }
    };
    preencherMecanicos();
    overlay.querySelector('#osLoja').addEventListener('change', preencherMecanicos);

    // ---- formas de pagamento (várias linhas: forma + valor [+ parcelas no crédito]) ----
    const pagamentosIniciais = () => {
      if (os && Array.isArray(os.pagamentos) && os.pagamentos.length) return os.pagamentos;
      if (os && os.formaPagamento) return [{ forma: os.formaPagamento, valor: 0, parcelas: os.parcelas || 1 }];
      return [{ forma: '', valor: '', parcelas: 1 }];
    };
    const linhaPagamento = (x) => `
      <div data-pagamento style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:center;">
        <div class="field">
          <select data-pag-forma>
            <option value="">— Selecione —</option>
            ${FORMAS_PAGAMENTO_OS.map((f) => `<option value="${f.codigo}"${x.forma === f.codigo ? ' selected' : ''}>${esc(f.rotulo)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><input data-pag-valor type="number" min="0" step="0.01" placeholder="Valor R$" value="${x.valor ? esc(x.valor) : ''}"></div>
        <div class="field" data-pag-parcelas-campo style="${x.forma === 'cartao_credito' ? '' : 'visibility:hidden;'}">
          <select data-pag-parcelas>
            ${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => `<option value="${n}"${Number(x.parcelas || 1) === n ? ' selected' : ''}>${n === 1 ? 'À vista (1x)' : n + 'x'}</option>`).join('')}
          </select>
        </div>
        <button class="btn-ghost btn-sm" type="button" data-pag-remover title="Remover esta forma">✕</button>
      </div>`;
    const lerPagamentos = () => Array.from(overlay.querySelectorAll('[data-pagamento]')).map((linha) => ({
      forma: linha.querySelector('[data-pag-forma]').value,
      valor: Number(linha.querySelector('[data-pag-valor]').value) || 0,
      parcelas: Number(linha.querySelector('[data-pag-parcelas]').value) || 1,
    })).filter((x) => x.forma);
    const somaPagamentos = () => Math.round(Array.from(overlay.querySelectorAll('[data-pag-valor]'))
      .reduce((t, c) => t + (Number(c.value) || 0), 0) * 100) / 100;
    const atualizarPagResumo = () => {
      const alvo = overlay.querySelector('#osPagResumo');
      if (!alvo) return;
      const total = Math.round((estado.totalOS || 0) * 100) / 100;
      const pago = somaPagamentos();
      if (!pago) { alvo.textContent = ''; return; }
      const diff = Math.round((total - pago) * 100) / 100;
      if (diff === 0) alvo.innerHTML = `<span style="color:var(--accent-strong);">Pago ${brl(pago)} ✓ confere com o total</span>`;
      else if (diff > 0) alvo.innerHTML = `Pago ${brl(pago)} · <span style="color:#c0392b;">Falta ${brl(diff)}</span>`;
      else alvo.innerHTML = `Pago ${brl(pago)} · <span style="color:#c0392b;">Passou ${brl(-diff)} do total</span>`;
    };
    const ligarLinhaPagamento = (linha) => {
      const forma = linha.querySelector('[data-pag-forma]');
      forma.addEventListener('change', () => {
        const credito = forma.value === 'cartao_credito';
        linha.querySelector('[data-pag-parcelas-campo]').style.visibility = credito ? '' : 'hidden';
        if (!credito) linha.querySelector('[data-pag-parcelas]').value = '1';
      });
      linha.querySelector('[data-pag-valor]').addEventListener('input', atualizarPagResumo);
      linha.querySelector('[data-pag-remover]').addEventListener('click', () => {
        linha.remove();
        if (!overlay.querySelector('[data-pagamento]')) adicionarPagamento({ forma: '', valor: '', parcelas: 1 });
        atualizarPagResumo();
      });
    };
    const adicionarPagamento = (x) => {
      overlay.querySelector('#osPagamentos').insertAdjacentHTML('beforeend', linhaPagamento(x));
      ligarLinhaPagamento(overlay.querySelector('#osPagamentos').lastElementChild);
    };
    pagamentosIniciais().forEach(adicionarPagamento);
    overlay.querySelector('#osAddPagamento').addEventListener('click', () => {
      // a nova linha já vem com o que falta pagar
      const falta = Math.round(((estado.totalOS || 0) - somaPagamentos()) * 100) / 100;
      adicionarPagamento({ forma: '', valor: falta > 0 ? falta : '', parcelas: 1 });
      atualizarPagResumo();
    });

    // itens: recalcular resumo
    const recalcular = () => {
      const itens = [];
      overlay.querySelectorAll('[data-os-item]').forEach((linha) => {
        const selectEstoque = linha.querySelector('[data-item-estoque]');
        const valorEstoque = selectEstoque ? selectEstoque.value : '';
        const [estoqueTipo, estoqueId] = valorEstoque ? valorEstoque.split('|') : [null, null];
        const item = {
          // O id do item precisa voltar igual: é por ele que o servidor sabe o que já foi baixado
          // e calcula SÓ A DIFERENÇA (sem isso, a edição viraria "removeu + criou de novo").
          id: linha.dataset.itemId || undefined,
          tipo: linha.querySelector('[data-item-tipo]').value,
          descricao: linha.querySelector('[data-item-descricao]').value,
          quantidade: Number(linha.querySelector('[data-item-qtd]').value) || 0,
          valorUnitario: Number(linha.querySelector('[data-item-valor]').value) || 0,
          desconto: Number(linha.querySelector('[data-item-desconto]').value) || 0,
          estoqueId: estoqueId || null,
          estoqueTipo: estoqueId ? estoqueTipo : null,
        };
        item.total = Math.max(0, item.quantidade * item.valorUnitario - item.desconto);
        linha.querySelector('[data-item-total]').textContent = brl(item.total);
        const saldo = linha.querySelector('[data-estoque-saldo]');
        if (saldo) saldo.textContent = saldoDoEstoque(estoqueId);
        itens.push(item);
      });
      estado.itens = itens;
      const subtotal = itens.reduce((s, i) => s + i.total, 0);
      const tipoDesc = overlay.querySelector('#osDescontoTipo').value;
      const valorDesc = Number(overlay.querySelector('#osDescontoValor').value) || 0;
      const desconto = tipoDesc === 'percento' ? subtotal * (Math.min(100, Math.max(0, valorDesc)) / 100) : valorDesc;
      const total = Math.max(0, subtotal - desconto);
      estado.totalOS = total;
      atualizarPagResumo();
      overlay.querySelector('#osResumo').innerHTML = `Subtotal ${brl(subtotal)} · Desconto ${brl(desconto)} · <span style="color:var(--accent-strong);">Total ${brl(total)}</span>`;
    };
    const ligarLinha = (linha) => {
      linha.querySelectorAll('input, select').forEach((campo) => campo.addEventListener('input', recalcular));
      linha.querySelectorAll('input, select').forEach((campo) => campo.addEventListener('change', recalcular));
      linha.querySelector('[data-item-remover]').addEventListener('click', () => { linha.remove(); recalcular(); });
    };
    overlay.querySelectorAll('[data-os-item]').forEach(ligarLinha);
    overlay.querySelector('#osAddItem').addEventListener('click', () => {
      const corpo = overlay.querySelector('#osItensCorpo');
      const temp = document.createElement('tbody');
      temp.innerHTML = linhaItem({});
      const linha = temp.querySelector('tr');
      corpo.appendChild(linha);
      ligarLinha(linha);
      recalcular();
    });
    overlay.querySelector('#osDescontoValor').addEventListener('input', recalcular);
    overlay.querySelector('#osDescontoTipo').addEventListener('change', recalcular);
    recalcular();

    overlay.querySelector('#osSalvarForm').addEventListener('click', async () => {
      const corpo = {
        loja: overlay.querySelector('#osLoja').value,
        status: overlay.querySelector('#osStatus').value,
        mecanicoId: overlay.querySelector('#osMecanico').value || null,
        cliente: {
          clienteId: overlay.querySelector('#osClienteId') ? overlay.querySelector('#osClienteId').value : '',
          nome: overlay.querySelector('#osClienteNome').value,
          cpfCnpj: overlay.querySelector('#osClienteDoc').value,
          telefone: overlay.querySelector('#osClienteTel').value,
          whatsapp: overlay.querySelector('#osClienteZap').value,
          email: overlay.querySelector('#osClienteEmail').value,
          endereco: overlay.querySelector('#osClienteEndereco').value,
          bairro: overlay.querySelector('#osClienteBairro').value,
          cidade: overlay.querySelector('#osClienteCidade').value,
          cep: overlay.querySelector('#osClienteCep').value,
          rgIe: overlay.querySelector('#osClienteRg').value,
          midia: overlay.querySelector('#osClienteMidia').value,
          contato: overlay.querySelector('#osClienteContato').value,
          referencia: overlay.querySelector('#osClienteReferencia').value,
        },
        veiculo: {
          placa: overlay.querySelector('#osVeiculoPlaca').value,
          marca: overlay.querySelector('#osVeiculoMarca').value,
          modelo: overlay.querySelector('#osVeiculoModelo').value,
          ano: overlay.querySelector('#osVeiculoAno').value,
          km: overlay.querySelector('#osVeiculoKm').value,
          observacoes: overlay.querySelector('#osVeiculoObs').value,
        },
        servicosSolicitados: overlay.querySelector('#osServicos').value,
        itens: estado.itens,
        descontoTipo: overlay.querySelector('#osDescontoTipo').value,
        descontoValor: Number(overlay.querySelector('#osDescontoValor').value) || 0,
        pagamentos: lerPagamentos(),
        condicoesPagamento: overlay.querySelector('#osCondicoes').value,
        autorizadoPor: overlay.querySelector('#osAutorizado').value,
        observacoesInternas: overlay.querySelector('#osObsInternas').value,
        observacoesCliente: overlay.querySelector('#osObsCliente').value,
        defeito: overlay.querySelector('#osDefeito') ? overlay.querySelector('#osDefeito').value : '',
      };
      if (!corpo.cliente.nome) { toast('Informe o nome do cliente.'); return; }
      try {
        if (os) {
          const salvo = await pedir('PUT', `/api/os/${encodeURIComponent(os.id)}`, corpo);
          if (corpo.status && salvo.os.status !== corpo.status) {
            await pedir('POST', `/api/os/${encodeURIComponent(os.id)}/status`, { status: corpo.status });
          }
          toast('OS atualizada.');
        } else {
          const criada = await pedir('POST', '/api/os', corpo);
          toast(`OS ${criada.os.numero} criada.`);
        }
        fechar();
        carregarListaOS();
        if (document.getElementById('view-painel-os').classList.contains('active')) carregarPainel();
      } catch (e) {
        const faltando = e.corpo && e.corpo.faltando;
        if (faltando && faltando.length) {
          window.alert(`${e.message}\n\nO que está faltando no estoque:\n${listaFaltando(faltando)}`);
        } else {
          toast(e.message);
        }
      }
    });
  }

  // ------------------------------------------------------------ detalhe da OS
  async function abrirDetalheOS(id) {
    let os;
    try {
      const dados = await pedir('GET', `/api/os/${encodeURIComponent(id)}`);
      os = dados.os;
      estado.podeEditarValores = dados.podeEditarValores;
    } catch (e) { toast(e.message); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:820px;">
        <div class="modal-header">
          <h3>${esc(os.numero)} <span class="badge ${classeStatus(os.status)}">${esc(rotuloStatus(os.status))}</span></h3>
          <button class="close-x" id="osFecharDetalhe">✕</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow:auto;">
          <div class="cards-grid tres" style="margin-bottom:14px;">
            <div class="stat-card"><div class="label">Total</div><div class="value accent">${brl(os.total)}</div><div class="sub">subtotal ${brl(os.subtotal)} · desconto ${brl(os.descontoGeral)}</div></div>
            <div class="stat-card"><div class="label">Aberta em</div><div class="value" style="font-size:16px;">${dataHora(os.aberturaEm)}</div><div class="sub">por ${esc(os.responsavel?.nome || '—')}</div></div>
            <div class="stat-card"><div class="label">Loja</div><div class="value" style="font-size:16px;">${esc(os.loja)}</div><div class="sub">${os.cancelamento ? 'cancelada' : (os.entregaEm ? `entregue em ${dataCurta(os.entregaEm)}` : (os.conclusaoEm ? `concluída em ${dataCurta(os.conclusaoEm)}` : 'em andamento'))}</div></div>
          </div>

          <div class="field-row">
            <div class="field"><label>Cliente</label><div>${esc(os.cliente.nome)}<br><span style="color:var(--text-muted);font-size:12.5px;">${esc(os.cliente.telefone)} ${esc(os.cliente.whatsapp)}<br>${esc(os.cliente.email)}<br>${esc(os.cliente.endereco)}</span></div></div>
            <div class="field"><label>Veículo</label><div>${esc(os.veiculo.placa)} — ${esc(os.veiculo.marca)} ${esc(os.veiculo.modelo)}<br><span style="color:var(--text-muted);font-size:12.5px;">ano ${esc(os.veiculo.ano)} · ${esc(os.veiculo.km)} km<br>${esc(os.veiculo.observacoes)}</span></div></div>
          </div>

          ${os.servicosSolicitados ? `<div class="field"><label>Serviços solicitados</label><div>${esc(os.servicosSolicitados)}</div></div>` : ''}

          <div class="table-wrap" style="margin-top:12px;">
            <table>
              <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd.</th><th>Valor un.</th><th>Desconto</th><th>Total</th></tr></thead>
              <tbody>
                ${(os.itens || []).map((i) => `
                  <tr>
                    <td>${esc((TIPOS_ITEM.find((t) => t.chave === i.tipo) || {}).rotulo || i.tipo)}</td>
                    <td>${esc(i.descricao)}</td>
                    <td>${numero(i.quantidade)}</td>
                    <td>${brl(i.valorUnitario)}</td>
                    <td>${brl(i.desconto)}</td>
                    <td>${brl(i.total)}</td>
                  </tr>`).join('') || '<tr><td colspan="6">Nenhum item.</td></tr>'}
              </tbody>
            </table>
          </div>

          ${os.defeito ? `<div class="field" style="margin-top:12px;"><label>Defeito relatado</label><div>${esc(os.defeito)}</div></div>` : ''}
          ${os.observacoesCliente ? `<div class="field" style="margin-top:12px;"><label>Observações para o cliente</label><div>${esc(os.observacoesCliente)}</div></div>` : ''}
          ${os.observacoesInternas ? `<div class="field" style="margin-top:12px;"><label>Observações internas</label><div>${esc(os.observacoesInternas)}</div></div>` : ''}
          ${os.cancelamento ? `<div class="field" style="margin-top:12px;"><label>Cancelamento</label><div style="color:var(--bad);">${esc(os.cancelamento.motivo)} — ${esc(os.cancelamento.usuario)} em ${dataHora(os.cancelamento.quando)}</div></div>` : ''}

          <h4 style="margin:16px 0 6px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;">Estoque baixado por esta OS</h4>
          <div id="osBaixasInfo">${(os.baixas || []).filter((b) => numero(b.quantidade) > 0).length
            ? `<div class="table-wrap"><table>
                 <thead><tr><th>Item do estoque</th><th>Baixado</th></tr></thead>
                 <tbody>${os.baixas.filter((b) => numero(b.quantidade) > 0).map((b) => `
                   <tr><td>${esc(b.descricao || '—')}</td><td>${numero(b.quantidade)} un.</td></tr>`).join('')}</tbody>
               </table></div>
               <div style="font-size:12px;color:var(--text-faint);margin-top:6px;">
                 Estes itens já saíram do estoque. Se a quantidade aumentar, sai só a diferença; se diminuir ou sair da OS,
                 o sistema devolve ao estoque (estorno). Ao cancelar a OS, tudo volta automaticamente.
               </div>`
            : '<div style="font-size:13px;color:var(--text-faint);">Nada foi baixado por esta OS ainda (a baixa acontece quando ela entra em <strong>Em execução</strong>).</div>'}</div>

          <h4 style="margin:16px 0 6px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;">Histórico (nada é apagado)</h4>
          <div>${(os.historico || []).map((h) => `
            <div class="os-historico-item">
              <strong>${esc(h.resumo)}</strong><br>
              <span style="color:var(--text-faint);font-size:12px;">${dataHora(h.quando)} · ${esc(h.usuario || '')}</span>
            </div>`).join('')}</div>
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
          <button class="btn-secondary" id="osFecharDetalhe2">Fechar</button>
          ${pode('editarOS') && !['entregue', 'cancelada'].includes(os.status) ? '<button class="btn-secondary" id="osEditarDetalhe">✏️ Editar</button>' : ''}
          ${podeMudarStatusDa(os) ? '<button class="btn-secondary" id="osMudarStatus">↻ Mudar status</button>' : ''}
          ${podeMudarStatusDa(os) ? '<button class="btn-secondary" id="osConferirEstoque">📦 Conferir estoque</button>' : ''}
          ${pode('cancelarOS') && os.status !== 'cancelada' ? '<button class="btn-danger-ghost" id="osCancelarOS">Cancelar OS</button>' : ''}
          <button class="btn-secondary" id="osPdfDetalhe">📄 PDF</button>
          <button class="btn-secondary" id="osWhatsappDetalhe">📱 WhatsApp</button>
          <button class="btn-primary" id="osImprimirDetalhe">🖨️ Imprimir</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const fechar = () => overlay.remove();
    overlay.querySelector('#osFecharDetalhe').addEventListener('click', fechar);
    overlay.querySelector('#osFecharDetalhe2').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
    overlay.querySelector('#osImprimirDetalhe').addEventListener('click', () => imprimirOS(os.numero));
    const bPdf = overlay.querySelector('#osPdfDetalhe');
    if (bPdf) bPdf.addEventListener('click', () => window.open(`/api/os/${encodeURIComponent(os.numero)}/pdf`, '_blank'));
    const bWhats = overlay.querySelector('#osWhatsappDetalhe');
    if (bWhats) bWhats.addEventListener('click', () => {
      if (typeof window.unicarEnviarWhatsApp === 'function') window.unicarEnviarWhatsApp(os);
      else toast('A tela do WhatsApp não carregou.');
    });

    const bEditar = overlay.querySelector('#osEditarDetalhe');
    if (bEditar) bEditar.addEventListener('click', () => { fechar(); abrirFormularioOS(os); });

    const bStatus = overlay.querySelector('#osMudarStatus');
    if (bStatus) {
      bStatus.addEventListener('click', async () => {
        // O mecânico só enxerga as opções técnicas que o servidor permite a ele.
        const permitidos = souMecanicoDaOS(os) && !pode('mudarStatus')
          ? STATUS.filter((s) => ['em execucao', 'aguardando peca', 'finalizada'].includes(s.chave))
          : STATUS.filter((s) => s.chave !== 'cancelada');
        const escolha = window.prompt(
          `Novo status para ${os.numero}.\nOpções: ${permitidos.map((s) => s.rotulo).join(', ')}`,
          rotuloStatus(os.status),
        );
        if (!escolha) return;
        try {
          const r = await pedir('POST', `/api/os/${encodeURIComponent(os.id)}/status`, { status: escolha });
          toast(`Status agora: ${rotuloStatus(r.os.status)}`);
          fechar();
          carregarListaOS();
          carregarEstoqueLocal();
        } catch (e) {
          const faltando = e.corpo && e.corpo.faltando;
          if (faltando && faltando.length) {
            window.alert(`${e.message}\n\nO que está faltando no estoque:\n${listaFaltando(faltando)}\n\n`
              + 'Ajuste os itens da OS ou reponha o estoque e tente de novo.');
          } else {
            toast(e.message);
          }
        }
      });
    }

    const bConferir = overlay.querySelector('#osConferirEstoque');
    if (bConferir) {
      bConferir.addEventListener('click', async () => {
        try {
          const r = await pedir('POST', `/api/os/${encodeURIComponent(os.id)}/conferir-estoque`, {});
          if (r.ok) {
            const baixado = (r.baixas || []).length
              ? `Já baixado do estoque: ${r.baixas.map((b) => `${b.descricao} (${numero(b.quantidade)} un.)`).join(', ')}.`
              : 'Nada foi baixado ainda.';
            window.alert(`Estoque suficiente para esta OS. ✅\n\n${baixado}`);
          } else {
            window.alert(`Estoque insuficiente para esta OS:\n\n${listaFaltando(r.faltando)}\n\n`
              + 'Reponha o estoque ou ajuste os itens antes de mudar o status para "Em execução".');
          }
        } catch (e) { toast(e.message); }
      });
    }

    const bCancelar = overlay.querySelector('#osCancelarOS');
    if (bCancelar) {
      bCancelar.addEventListener('click', async () => {
        const motivo = window.prompt('Motivo do cancelamento (obrigatório):');
        if (!motivo) return;
        try {
          await pedir('POST', `/api/os/${encodeURIComponent(os.id)}/cancelar`, { motivo });
          toast('OS cancelada.');
          fechar();
          carregarListaOS();
        } catch (e) { toast(e.message); }
      });
    }
  }

  // --------------------------------------------------------------- ligar tudo
  function ligarAbas() {
    const abaOS = document.getElementById('tabOS');
    const abaPainel = document.getElementById('tabPainelOS');
    if (abaOS) {
      abaOS.addEventListener('click', () => {
        desenharListaOS();
        carregarListaOS();
      });
    }
    if (abaPainel) {
      abaPainel.addEventListener('click', () => { carregarPainel(); });
    }
  }

  async function carregarEstoqueLocal() {
    try {
      const estoque = await pedir('GET', '/api/os-estoque');
      estado.estoque = estoque.itens || [];
    } catch (e) { /* segue com o que já tem */ }
  }

  function marcarViewsProntas() {
    const v1 = document.getElementById('view-os');
    const v2 = document.getElementById('view-painel-os');
    if (v1) v1.innerHTML = '<div class="empty-state"><p>Carregando ordens de serviço…</p></div>';
    if (v2) v2.innerHTML = '<div class="empty-state"><p>Carregando painel…</p></div>';
  }

  async function iniciar() {
    marcarViewsProntas();
    const ok = await carregarContexto();
    if (!ok) return; // sem sessão: a tela principal já cuida disso
    ligarAbas();
    if (window.location.hash === '#os') {
      document.querySelector('.tab[data-view="os"]')?.click();
    }
  }

  // Exposto só para depuração/inspeção (não é usado por outras partes do sistema)
  window.UNICAR_OS = { estado, carregarListaOS, carregarPainel, abrirFormularioOS, abrirDetalheOS };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
