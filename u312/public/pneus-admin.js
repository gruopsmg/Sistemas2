// Cadastro de pneus (somente administrador)
// -----------------------------------------------------------------------------
// Tela separada, carregada depois do smg.js: dá para CADASTRAR um pneu novo e
// AJUSTAR a quantidade (entrada/saída) de qualquer pneu do estoque, com marca e
// medida digitadas do jeito simples (o sistema normaliza para 185/65 R15).
//
// Regras:
//  - só aparece para perfil admin (o servidor também barra quem não é da loja);
//  - nada de framework: HTML puro + fetch, igual ao resto do sistema;
//  - toda movimentação passa por /api/movimentos (grava histórico + auditoria).

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dinheiro = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

  const MARCAS = [
    'Pirelli', 'Goodyear', 'Michelin', 'Bridgestone', 'Continental', 'Firestone',
    'Dunlop', 'Hankook', 'Kumho', 'Goodmark', 'Achilles', 'Delinte', 'Sunny',
    'Lanvigator', 'Triangle', 'Roadstone', 'Westlake', 'Xbri', 'Magion', 'Speedmax',
    'General Tire', 'Barum', 'Nexen', 'Toyo', 'Yokohama', 'GT Radial',
  ];

  // Medidas mais vendidas: um clique em vez de digitar
  const MEDIDAS_COMUNS = [
    '155/70 R13', '165/70 R13', '175/70 R13', '175/65 R14', '185/65 R14',
    '185/60 R15', '195/55 R15', '195/65 R15', '205/55 R16', '215/60 R16',
    '225/45 R17', '265/70 R16',
  ];

  const MOTIVOS = {
    entrada: [
      ['Compra de fornecedor', 'compra'],
      ['Devolução de cliente', 'devolucao'],
      ['Ajuste de inventário (contagem)', 'ajuste'],
      ['Transferência recebida', 'transferencia'],
    ],
    saida: [
      ['Venda', 'venda'],
      ['Aplicado na OS (baixa)', 'os'],
      ['Perda / avaria', 'perda'],
      ['Devolução ao fornecedor', 'devolucao'],
      ['Ajuste de inventário (contagem)', 'ajuste'],
      ['Transferência enviada', 'transferencia'],
    ],
  };

  const estado = {
    eu: null,
    lojas: [],
    pneus: [],
    busca: '',
    aba: null,
    tela: null,
    iniciado: false,
    movimento: null,
  };

  // ---------------------------------------------------------------- utilidades
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

  // A conta da medida fica em /pneus-medida.js (a mesma usada nos testes).
  const normalizarMedida = (window.unicarMedida && window.unicarMedida.normalizarMedida)
    || ((bruta) => ({ ok: false, texto: String(bruta || ''), motivo: 'Recarregue a página.' }));

  function numeroOuZero(v) {
    const n = Number(String(v === undefined ? '' : v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  // ---------------------------------------------------------------- estrutura
  function criarAba() {
    const barra = document.querySelector('.tabs');
    if (!barra || $('tabPneusAdmin')) return;
    const botao = document.createElement('button');
    botao.className = 'tab';
    botao.id = 'tabPneusAdmin';
    botao.dataset.view = 'pneus-admin';
    botao.textContent = 'Cadastro de pneus';
    barra.appendChild(botao);
  }

  function criarTela() {
    if ($('view-pneus-admin')) return;
    const main = document.querySelector('main') || document.body;
    const secao = document.createElement('section');
    secao.className = 'view';
    secao.id = 'view-pneus-admin';
    secao.innerHTML = `
      <div class="padmin-wrap">
        <div class="panel padmin-form">
          <h2>Adicionar pneu ao estoque</h2>
          <p class="padmin-sub">Marca e medida do jeito que você fala. O sistema ajusta o formato sozinho.</p>

          <div class="padmin-campo">
            <label for="paMarca">Marca</label>
            <input id="paMarca" list="paMarcas" placeholder="Pirelli, Goodyear, Michelin…" autocomplete="off">
            <datalist id="paMarcas">${MARCAS.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
            <div class="padmin-chips" id="paMarcasChips">
              ${['Pirelli', 'Goodyear', 'Michelin', 'Bridgestone', 'Goodmark'].map((m) => `<button type="button" class="padmin-chip" data-marca="${esc(m)}">${esc(m)}</button>`).join('')}
            </div>
          </div>

          <div class="padmin-campo">
            <label for="paMedida">Medida</label>
            <div class="padmin-medida-linha">
              <input id="paMedida" placeholder="185/65 R15 ou 1856515" autocomplete="off" inputmode="numeric">
              <span class="padmin-selo" id="paMedidaSelo">—</span>
            </div>
            <p class="padmin-dica" id="paMedidaDica">Digite a medida: largura, perfil e aro.</p>
            <div class="padmin-chips" id="paMedidaChips">
              ${MEDIDAS_COMUNS.map((m) => `<button type="button" class="padmin-chip" data-medida="${esc(m)}">${esc(m.replace(' R', '/R'))}</button>`).join('')}
            </div>
          </div>

          <div class="padmin-campo">
            <label>Tipo</label>
            <div class="padmin-seg" id="paStatus">
              <button type="button" class="padmin-seg-btn ativo" data-status="novo">Novo</button>
              <button type="button" class="padmin-seg-btn" data-status="remoldado">Remoldado</button>
            </div>
          </div>

          <div class="padmin-grade">
            <div class="padmin-campo">
              <label for="paQtd">Quantidade</label>
              <div class="padmin-stepper">
                <button type="button" id="paQtdMenos" aria-label="Diminuir">−</button>
                <input id="paQtd" value="1" inputmode="numeric">
                <button type="button" id="paQtdMais" aria-label="Aumentar">+</button>
              </div>
            </div>
            <div class="padmin-campo">
              <label for="paMinimo">Estoque mínimo</label>
              <input id="paMinimo" value="0" inputmode="numeric">
            </div>
            <div class="padmin-campo">
              <label for="paLocal">Local</label>
              <input id="paLocal" placeholder="Prateleira / box">
            </div>
            <div class="padmin-campo">
              <label for="paLoja">Loja</label>
              <select id="paLoja"></select>
            </div>
            <div class="padmin-campo">
              <label for="paCusto">Custo (R$)</label>
              <input id="paCusto" placeholder="0,00" inputmode="decimal">
            </div>
            <div class="padmin-campo">
              <label for="paVenda">Venda (R$)</label>
              <input id="paVenda" placeholder="0,00" inputmode="decimal">
            </div>
          </div>

          <button type="button" class="btn-primary padmin-btn" id="paSalvar" disabled>Cadastrar pneu</button>
          <p class="padmin-msg" id="paMsg"></p>
        </div>

        <div class="panel padmin-lista">
          <div class="padmin-lista-topo">
            <h2>Estoque</h2>
            <input id="paBusca" placeholder="Buscar marca, medida ou código">
          </div>
          <div class="padmin-tabela-wrap">
            <table class="table padmin-tabela">
              <thead>
                <tr><th>Marca</th><th>Medida</th><th>Tipo</th><th>Loja / Qtd</th><th>Custo</th><th>Venda</th><th class="padmin-acoes-col">Quantidade</th></tr>
              </thead>
              <tbody id="paTbody"><tr><td colspan="7" class="empty-state">Carregando…</td></tr></tbody>
            </table>
          </div>
          <p class="padmin-rodape" id="paRodape"></p>
        </div>
      </div>

      <div class="padmin-modal" id="paMovModal" style="display:none;">
        <div class="padmin-modal-box">
          <div class="padmin-modal-topo">
            <h3 id="paMovTitulo">Movimentar</h3>
            <button type="button" class="close-x" id="paMovFechar">✕</button>
          </div>
          <p class="padmin-sub" id="paMovDesc"></p>
          <div class="padmin-campo">
            <label for="paMovQtd">Quantidade</label>
            <div class="padmin-stepper">
              <button type="button" id="paMovMenos" aria-label="Diminuir">−</button>
              <input id="paMovQtd" value="1" inputmode="numeric">
              <button type="button" id="paMovMais" aria-label="Aumentar">+</button>
            </div>
          </div>
          <div class="padmin-campo">
            <label for="paMovMotivo">Motivo</label>
            <select id="paMovMotivo"></select>
          </div>
          <div class="padmin-campo">
            <label for="paMovObs">Observação (opcional)</label>
            <input id="paMovObs" placeholder="Ex.: cliente pediu 4, saiu 2">
          </div>
          <div class="padmin-modal-acoes">
            <button type="button" class="btn-secondary" id="paMovCancelar">Cancelar</button>
            <button type="button" class="btn-primary" id="paMovConfirmar">Confirmar</button>
          </div>
          <p class="padmin-msg" id="paMovMsg"></p>
        </div>
      </div>

      <style>
        .padmin-wrap { display: grid; gap: 16px; grid-template-columns: 1fr; }
        @media (min-width: 1100px) { .padmin-wrap { grid-template-columns: 420px minmax(0, 1fr); align-items: start; } }
        .padmin-form, .padmin-lista { padding: 16px; }
        .padmin-form h2, .padmin-lista h2 { margin: 0; font-size: 17px; }
        .padmin-sub { margin: 4px 0 14px; font-size: 12.5px; color: var(--muted); line-height: 1.45; }
        .padmin-campo { margin-bottom: 12px; }
        .padmin-campo label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 5px; }
        .padmin-campo input, .padmin-campo select {
          width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
          background: var(--panel-2, rgba(255,255,255,.03)); color: inherit; font-size: 14px;
        }
        .padmin-campo input:focus, .padmin-campo select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
        .padmin-grade { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .padmin-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .padmin-chip {
          border: 1px solid var(--border); background: transparent; color: var(--muted);
          border-radius: 999px; padding: 5px 11px; font-size: 12px; cursor: pointer;
        }
        .padmin-chip:hover { border-color: var(--accent); color: var(--accent); }
        .padmin-medida-linha { display: flex; gap: 8px; align-items: center; }
        .padmin-selo {
          flex: 0 0 auto; min-width: 96px; text-align: center; padding: 9px 10px; border-radius: 10px;
          font-size: 13px; font-weight: 700; background: rgba(255,255,255,.05); border: 1px solid var(--border);
        }
        .padmin-selo.ok { border-color: var(--good, #43a047); color: var(--good, #43a047); }
        .padmin-selo.erro { border-color: var(--bad, #e53935); color: var(--bad, #e53935); }
        .padmin-dica { margin: 6px 0 0; font-size: 11.5px; color: var(--muted); }
        .padmin-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .padmin-seg-btn { border: 0; background: transparent; padding: 9px 16px; font-size: 13px; cursor: pointer; color: var(--muted); }
        .padmin-seg-btn.ativo { background: var(--accent); color: #0b0f14; font-weight: 700; }
        .padmin-stepper { display: inline-flex; align-items: center; gap: 6px; }
        .padmin-stepper button {
          width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--border);
          background: transparent; color: inherit; font-size: 17px; cursor: pointer; line-height: 1;
        }
        .padmin-stepper input { width: 64px; text-align: center; }
        .padmin-btn { width: 100%; margin-top: 6px; }
        .padmin-btn[disabled] { opacity: .45; cursor: not-allowed; }
        .padmin-msg { margin: 10px 0 0; font-size: 12.5px; min-height: 18px; }
        .padmin-msg.erro { color: var(--bad, #e53935); }
        .padmin-msg.ok { color: var(--good, #43a047); }
        .padmin-lista-topo { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .padmin-lista-topo input { max-width: 260px; width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: inherit; font-size: 13px; }
        .padmin-tabela-wrap { overflow-x: auto; }
        .padmin-tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
        .padmin-tabela th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 8px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .padmin-tabela td { padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,.05); vertical-align: middle; }
        .padmin-tabela tr:hover td { background: rgba(255,255,255,.03); }
        .padmin-acoes-col { text-align: right; }
        .padmin-qtd { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
        .padmin-qtd .num { min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
        .padmin-qtd button {
          width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border);
          background: transparent; color: inherit; cursor: pointer; font-size: 15px; line-height: 1;
        }
        .padmin-qtd button:hover { border-color: var(--accent); color: var(--accent); }
        .padmin-qtd .menos:hover { border-color: var(--bad, #e53935); color: var(--bad, #e53935); }
        .padmin-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
        .padmin-rodape { margin: 10px 0 0; font-size: 11.5px; color: var(--muted); }
        .padmin-modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 70; padding: 16px; }
        .padmin-modal-box { background: var(--panel, #17191d); border: 1px solid var(--border); border-radius: 16px; padding: 18px; width: 100%; max-width: 420px; }
        .padmin-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .padmin-modal-topo h3 { margin: 0; font-size: 16px; }
        .padmin-modal-acoes { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
      </style>
    `;
    main.appendChild(secao);
  }

  // ---------------------------------------------------------------- formulário
  let medAtual = { ok: false, texto: '' };
  let statusAtual = 'novo';

  function atualizarSeloMedida() {
    const campo = $('paMedida');
    const selo = $('paMedidaSelo');
    const dica = $('paMedidaDica');
    if (!campo || !selo) return;
    const bruto = campo.value.trim();
    if (!bruto) {
      medAtual = { ok: false, texto: '' };
      selo.textContent = '—';
      selo.className = 'padmin-selo';
      if (dica) dica.textContent = 'Digite a medida: largura, perfil e aro.';
      return validarFormulario();
    }
    const r = normalizarMedida(bruto);
    medAtual = r;
    selo.textContent = r.ok ? r.texto : 'medida';
    selo.className = 'padmin-selo ' + (r.ok ? 'ok' : 'erro');
    if (dica) dica.textContent = r.ok ? 'Vai ser salvo como ' + r.texto : r.motivo;
    validarFormulario();
  }

  function validarFormulario() {
    const marca = ($('paMarca') && $('paMarca').value.trim()) || '';
    const botao = $('paSalvar');
    if (botao) botao.disabled = !(marca.length >= 2 && medAtual.ok);
  }

  function valorStepper(id) {
    const el = $(id);
    return Math.max(0, Math.round(numeroOuZero(el && el.value)));
  }

  async function carregarLojas() {
    const sel = $('paLoja');
    if (!sel) return;
    try {
      const dados = await api('GET', '/api/lojas');
      estado.lojas = (dados && dados.lojas) || [];
    } catch (e) {
      estado.lojas = [];
    }
    sel.innerHTML = estado.lojas.map((l) => `<option value="${esc(l.codigo)}">${esc(l.nome || l.codigo)}</option>`).join('');
    const minha = estado.eu && estado.eu.loja;
    if (minha && estado.lojas.some((l) => l.codigo === minha)) sel.value = minha;
  }

  async function cadastrarPneu() {
    const msg = $('paMsg');
    const botao = $('paSalvar');
    const marca = $('paMarca').value.trim();
    const corpo = {
      marca,
      medida: medAtual.texto,
      status: statusAtual,
      quantidade: valorStepper('paQtd'),
      estoqueMinimo: valorStepper('paMinimo'),
      localizacao: $('paLocal').value.trim(),
      precoCusto: numeroOuZero($('paCusto').value),
      precoVenda: numeroOuZero($('paVenda').value),
      loja: $('paLoja').value,
    };
    if (msg) { msg.textContent = ''; msg.className = 'padmin-msg'; }
    if (botao) botao.disabled = true;
    try {
      await api('POST', '/api/pneus', corpo);
      avisar('Pneu cadastrado.', 'good');
      if (msg) { msg.textContent = 'Cadastrado: ' + marca + ' ' + medAtual.texto; msg.className = 'padmin-msg ok'; }
      resetarFormulario(false);
      await carregarPneus();
    } catch (e) {
      if (e.status === 409 && e.dados && e.dados.existente) {
        const existente = e.dados.existente;
        const somar = window.confirm(
          `${existente.marca} ${existente.medida} (${existente.status}) já está no estoque com \
${existente.quantidade} un.\n\nSomar ${corpo.quantidade} un. a esse pneu?`
        );
        if (!somar) {
          if (msg) { msg.textContent = 'Cadastro cancelado (pneu já existia).'; msg.className = 'padmin-msg erro'; }
          return;
        }
        try {
          await api('POST', '/api/pneus/' + existente.id + '/somar', {
            quantidade: corpo.quantidade,
            loja: corpo.loja,
          });
          avisar('Quantidade somada ao pneu existente.', 'good');
          if (msg) {
            msg.textContent = `Somado: ${existente.marca} ${existente.medida} (+${corpo.quantidade} un.)`;
            msg.className = 'padmin-msg ok';
          }
          resetarFormulario(false);
          await carregarPneus();
        } catch (e2) {
          if (msg) { msg.textContent = e2.message; msg.className = 'padmin-msg erro'; }
        }
      } else if (msg) {
        msg.textContent = e.message;
        msg.className = 'padmin-msg erro';
      }
    } finally {
      if (botao) botao.disabled = !(medAtual.ok && ($('paMarca').value.trim().length >= 2));
    }
  }

  function resetarFormulario(tudo) {
    if (tudo) {
      $('paMarca').value = '';
      $('paMedida').value = '';
      statusAtual = 'novo';
      document.querySelectorAll('#paStatus .padmin-seg-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.status === 'novo'));
      atualizarSeloMedida();
    }
    $('paQtd').value = '1';
    $('paMinimo').value = '0';
    $('paLocal').value = '';
    $('paCusto').value = '';
    $('paVenda').value = '';
    validarFormulario();
  }

  // ---------------------------------------------------------------- lista
  async function carregarPneus() {
    const tbody = $('paTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Carregando…</td></tr>';
    try {
      const dados = await api('GET', '/api/state');
      estado.pneus = (dados && dados.pneus) || [];
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${esc(e.message)}</td></tr>`;
      return;
    }
    renderizarPneus();
  }

  // O estoque por loja vem como objeto: { quantidade, minimo, localizacao }.
  function quantidadeNaLoja(pneu, loja) {
    if (!loja) return Number(pneu.quantidade) || 0;
    const porLoja = pneu.estoques && pneu.estoques[loja];
    if (porLoja && typeof porLoja === 'object') return Number(porLoja.quantidade) || 0;
    if (porLoja !== undefined && porLoja !== null) return Number(porLoja) || 0;
    return pneu.loja === loja ? (Number(pneu.quantidade) || 0) : 0;
  }

  function renderizarPneus() {
    const tbody = $('paTbody');
    const rodape = $('paRodape');
    if (!tbody) return;

    const loja = ($('paLoja') && $('paLoja').value) || '';
    const busca = (estado.busca || '').toLowerCase();
    const lista = estado.pneus
      .filter((p) => !busca || `${p.marca} ${p.medida} ${p.status}`.toLowerCase().includes(busca))
      .slice()
      .sort((a, b) => `${a.marca} ${a.medida}`.localeCompare(`${b.marca} ${b.medida}`));

    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum pneu. Cadastre o primeiro ao lado.</td></tr>';
      if (rodape) rodape.textContent = '';
      return;
    }

    tbody.innerHTML = lista.map((p) => {
      const qtd = quantidadeNaLoja(p, loja);
      const alerta = Number(p.estoqueMinimo) > 0 && qtd <= Number(p.estoqueMinimo);
      return `<tr data-id="${esc(p.id)}">
        <td><strong>${esc(p.marca)}</strong></td>
        <td>${esc(p.medida)}</td>
        <td><span class="padmin-tag">${p.status === 'remoldado' ? 'Remoldado' : 'Novo'}</span></td>
        <td>${esc(loja || p.loja || '')} · <strong>${qtd}</strong>${alerta ? ' <span class="padmin-tag" style="color:var(--bad,#e53935);border-color:currentColor">baixo</span>' : ''}</td>
        <td>${p.precoCusto ? dinheiro(p.precoCusto) : '—'}</td>
        <td>${p.precoVenda ? dinheiro(p.precoVenda) : '—'}</td>
        <td>
          <span class="padmin-qtd">
            <button type="button" class="menos" data-mov="saida" data-id="${esc(p.id)}" title="Retirar do estoque">−</button>
            <span class="num">${qtd}</span>
            <button type="button" data-mov="entrada" data-id="${esc(p.id)}" title="Adicionar ao estoque">+</button>
          </span>
        </td>
      </tr>`;
    }).join('');

    const unidades = lista.reduce((t, p) => t + quantidadeNaLoja(p, loja), 0);
    if (rodape) {
      rodape.textContent = `${lista.length} pneu(s) · ${unidades} unidade(s) em ${loja || 'todas as lojas'}`;
    }
  }

  // ---------------------------------------------------------------- movimento
  function abrirMovimento(id, tipo) {
    const pneu = estado.pneus.find((p) => p.id === id);
    if (!pneu) return;
    estado.movimento = { pneu, tipo };
    const modal = $('paMovModal');
    if (!modal) return;
    $('paMovTitulo').textContent = (tipo === 'entrada' ? 'Entrada' : 'Saída') + ' de estoque';
    $('paMovDesc').textContent = `${pneu.marca} ${pneu.medida} (${pneu.status === 'remoldado' ? 'remoldado' : 'novo'})`;
    $('paMovQtd').value = '1';
    $('paMovObs').value = '';
    const msg = $('paMovMsg');
    if (msg) { msg.textContent = ''; msg.className = 'padmin-msg'; }
    $('paMovMotivo').innerHTML = MOTIVOS[tipo]
      .map(([rotulo, valor]) => `<option value="${esc(valor)}">${esc(rotulo)}</option>`)
      .join('');
    modal.style.display = 'flex';
  }

  function fecharMovimento() {
    const modal = $('paMovModal');
    if (modal) modal.style.display = 'none';
    estado.movimento = null;
  }

  async function confirmarMovimento() {
    if (!estado.movimento) return;
    const { pneu, tipo } = estado.movimento;
    const qtd = valorStepper('paMovQtd');
    const msg = $('paMovMsg');
    const botao = $('paMovConfirmar');
    if (!qtd) {
      if (msg) { msg.textContent = 'Informe a quantidade.'; msg.className = 'padmin-msg erro'; }
      return;
    }
    const motivoRotulo = $('paMovMotivo').selectedOptions[0]
      ? $('paMovMotivo').selectedOptions[0].textContent
      : '';
    const obs = $('paMovObs').value.trim();
    if (botao) botao.disabled = true;
    try {
      await api('POST', '/api/movimentos', {
        pneuId: pneu.id,
        tipo,
        quantidade: qtd,
        motivo: obs ? `${motivoRotulo} — ${obs}` : motivoRotulo,
        loja: $('paLoja') ? $('paLoja').value : '',
      });
      avisar(tipo === 'entrada' ? 'Entrada registrada.' : 'Saída registrada.', 'good');
      fecharMovimento();
      await carregarPneus();
    } catch (e) {
      if (msg) { msg.textContent = e.message; msg.className = 'padmin-msg erro'; }
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  // ---------------------------------------------------------------- eventos
  function ligar() {
    $('paMarca').addEventListener('input', validarFormulario);
    $('paMedida').addEventListener('input', atualizarSeloMedida);

    document.querySelectorAll('#paMarcasChips .padmin-chip').forEach((b) => {
      b.addEventListener('click', () => { $('paMarca').value = b.dataset.marca; validarFormulario(); });
    });
    document.querySelectorAll('#paMedidaChips .padmin-chip').forEach((b) => {
      b.addEventListener('click', () => { $('paMedida').value = b.dataset.medida; atualizarSeloMedida(); });
    });
    document.querySelectorAll('#paStatus .padmin-seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        statusAtual = b.dataset.status;
        document.querySelectorAll('#paStatus .padmin-seg-btn').forEach((x) => x.classList.toggle('ativo', x === b));
      });
    });

    $('paQtdMais').addEventListener('click', () => { $('paQtd').value = String(valorStepper('paQtd') + 1); });
    $('paQtdMenos').addEventListener('click', () => { $('paQtd').value = String(Math.max(0, valorStepper('paQtd') - 1)); });
    $('paSalvar').addEventListener('click', cadastrarPneu);
    $('paBusca').addEventListener('input', () => { estado.busca = $('paBusca').value.trim(); renderizarPneus(); });
    $('paLoja').addEventListener('change', renderizarPneus);

    $('paTbody').addEventListener('click', (ev) => {
      const botao = ev.target.closest && ev.target.closest('button[data-mov]');
      if (!botao) return;
      abrirMovimento(botao.dataset.id, botao.dataset.mov);
    });

    $('paMovFechar').addEventListener('click', fecharMovimento);
    $('paMovCancelar').addEventListener('click', fecharMovimento);
    $('paMovConfirmar').addEventListener('click', confirmarMovimento);
    $('paMovMenos').addEventListener('click', () => { $('paMovQtd').value = String(Math.max(1, valorStepper('paMovQtd') - 1)); });
    $('paMovMais').addEventListener('click', () => { $('paMovQtd').value = String(valorStepper('paMovQtd') + 1); });
    $('paMovModal').addEventListener('click', (ev) => { if (ev.target === $('paMovModal')) fecharMovimento(); });

    // A aba é criada depois do script principal, então ela não ganhou o
    // tratador genérico: aqui ela faz a troca de tela sozinha.
    const aba = $('tabPneusAdmin');
    if (aba) {
      aba.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
        aba.classList.add('active');
        const tela = $('view-pneus-admin');
        if (tela) tela.classList.add('active');
        carregarPneus();
      });
    }
    window.addEventListener('unicar:estado', () => {
      if ($('view-pneus-admin') && $('view-pneus-admin').classList.contains('active')) carregarPneus();
    });
  }

  // ---------------------------------------------------------------- início
  async function iniciar() {
    if (estado.iniciado) return;
    let eu = null;
    try {
      const r = await fetch('/api/eu');
      if (!r.ok) return; // ainda não logado: tenta de novo no próximo ciclo
      const json = await r.json();
      eu = json && json.usuario;
    } catch (e) {
      return;
    }
    if (!eu) return;
    estado.eu = eu;
    if (eu.perfil !== 'admin') return; // tela só do administrador

    estado.iniciado = true;
    criarAba();
    criarTela();
    await carregarLojas();
    ligar();
    atualizarSeloMedida();
    await carregarPneus();
  }

  // tenta entrar algumas vezes (a tela de login aparece antes do usuário existir)
  let tentativas = 0;
  const timer = setInterval(async () => {
    tentativas += 1;
    await iniciar();
    if (estado.iniciado || tentativas > 120) clearInterval(timer);
  }, 1500);

  document.addEventListener('DOMContentLoaded', () => { void iniciar(); });
  window.unicarPneusAdmin = { normalizarMedida };
})();
