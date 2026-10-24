// UNICAR - Tela de Clientes (base ÚNICA do grupo: todas as lojas veem e usam a mesma lista)
// Depende só do que o index.html já expõe (window.toast). Fica separado do smg.js para
// não engordar o arquivo das outras telas.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function avisar(msg, tipo) {
    if (typeof window.toast === 'function') { window.toast(msg, tipo); return; }
    window.alert(msg);
  }

  async function api(metodo, caminho, corpo) {
    const opcoes = { method: metodo, headers: {} };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    const resposta = await fetch(caminho, opcoes);
    let dados = null;
    try { dados = await resposta.json(); } catch (e) { dados = null; }
    if (!resposta.ok) throw new Error((dados && (dados.error || dados.erro)) || `Erro ${resposta.status}`);
    return dados || {};
  }

  const estado = { carregado: false, busca: '', lista: [] };

  // ------------------------------------------------------------------ lista
  async function carregar(busca) {
    if (busca !== undefined) estado.busca = busca;
    const tbody = $('clientesTabela');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Carregando…</td></tr>';
    let dados;
    try {
      const q = estado.busca ? `?busca=${encodeURIComponent(estado.busca)}&limite=200` : '?limite=200';
      dados = await api('GET', '/api/clientes' + q);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${esc(e.message)}</td></tr>`;
      return;
    }
    estado.lista = dados.clientes || [];
    estado.carregado = true;
    if ($('clientesResumo')) {
      $('clientesResumo').textContent = estado.busca
        ? `${estado.lista.length} encontrado(s) de ${dados.total} na base`
        : `${dados.total} cliente(s) na base do grupo`;
    }
    if (!estado.lista.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${estado.busca ? 'Nenhum cliente com esse termo.' : 'Nenhum cliente cadastrado ainda — o primeiro entra ao salvar uma OS ou em “+ Novo cliente”.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = estado.lista.map((c) => `
      <tr>
        <td><strong>${esc(c.nome)}</strong>${c.osCount ? ` <span class="hint">(${c.osCount} OS)</span>` : ''}</td>
        <td>${esc(c.cpfCnpj) || '<span class="hint">—</span>'}</td>
        <td>${esc(c.telefone || c.whatsapp) || '<span class="hint">—</span>'}</td>
        <td>${esc(c.cidade) || '<span class="hint">—</span>'}</td>
        <td>${c.osCount || 0}</td>
        <td class="toolbar">
          <button class="btn-ghost btn-sm" data-editar-cliente="${esc(c.id)}">Editar</button>
          <button class="btn-ghost btn-sm" data-nova-os="${esc(c.id)}">Nova OS</button>
          <button class="btn-ghost btn-sm" data-apagar-cliente="${esc(c.id)}">Apagar</button>
        </td>
      </tr>`).join('');
  }

  // ------------------------------------------------------------------ formulário
  const CAMPOS = {
    nome: 'clienteNome', cpfCnpj: 'clienteDoc', rgIe: 'clienteRg', telefone: 'clienteTelefone',
    whatsapp: 'clienteZap', email: 'clienteEmail', endereco: 'clienteEndereco', bairro: 'clienteBairro',
    cidade: 'clienteCidade', cep: 'clienteCep',
  };

  function abrirFormulario(cliente) {
    $('clienteForm').style.display = '';
    $('clienteImportar').style.display = 'none';
    $('clienteFormTitulo').textContent = cliente ? 'Editar cliente' : 'Novo cliente';
    $('clienteId').value = cliente ? cliente.id : '';
    for (const [campo, id] of Object.entries(CAMPOS)) $(id).value = (cliente && cliente[campo]) || '';
    $('clienteStatus').textContent = '';
    $('clienteNome').focus();
  }

  function fecharFormulario() {
    $('clienteForm').style.display = 'none';
  }

  async function salvar() {
    const corpo = {};
    for (const [campo, id] of Object.entries(CAMPOS)) corpo[campo] = $(id).value.trim();
    if (!corpo.nome) { avisar('Informe o nome do cliente.', 'erro'); return; }
    const id = $('clienteId').value;
    try {
      if (id) await api('PUT', `/api/clientes/${encodeURIComponent(id)}`, corpo);
      else await api('POST', '/api/clientes', corpo);
      $('clienteStatus').textContent = '✅ Salvo';
      fecharFormulario();
      avisar(id ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      await carregar();
      const anterior = document.querySelector('.tab[data-view="os"]');
      if (anterior) document.dispatchEvent(new CustomEvent('unicar:clientes-mudou'));
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function apagar(id) {
    const c = estado.lista.find((x) => x.id === id);
    if (!c) return;
    if (!window.confirm(`Apagar o cliente "${c.nome}"?`)) return;
    try {
      await api('DELETE', `/api/clientes/${encodeURIComponent(id)}`);
      avisar('Cliente apagado.');
      await carregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  // ------------------------------------------------------------------ importação
  let conteudoImportado = '';

  async function lerArquivo() {
    const campo = $('arquivoClientes');
    const arquivo = campo && campo.files && campo.files[0];
    if (!arquivo) { avisar('Escolha um arquivo .csv ou .txt.', 'erro'); return null; }
    if (arquivo.size > 4 * 1024 * 1024) { avisar('Arquivo grande demais (limite de 4 MB).', 'erro'); return null; }
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result || ''));
      leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
      leitor.readAsText(arquivo, 'utf-8');
    });
  }

  async function verPrevia() {
    try {
      const conteudo = await lerArquivo();
      if (conteudo === null) return;
      conteudoImportado = conteudo;
      const r = await api('POST', '/api/clientes/importar/previa', { conteudo });
      const amostra = (lista, rotulo) => {
        if (!lista.length) return '';
        return `<div style="margin-top:8px;"><strong>${rotulo} (${lista.length})</strong>
          <ul style="margin:6px 0 0 18px;font-size:13px;">${lista.slice(0, 12).map((c) =>
            `<li>${esc(c.nome)}${c.cpfCnpj ? ` — ${esc(c.cpfCnpj)}` : ''}</li>`).join('')}
          ${lista.length > 12 ? `<li>… e mais ${lista.length - 12}</li>` : ''}</ul></div>`;
      };
      $('previaClientes').innerHTML = `
        <div style="border:1px solid var(--border);border-radius:10px;padding:10px;">
          <strong>Prévia</strong> — nada foi gravado ainda.
          <div style="margin-top:6px;font-size:13px;">
            🟢 ${r.novosTotal} cliente(s) novo(s) · 🟡 ${r.atualizadosTotal} já existente(s) (serão atualizados) ·
            ⚪ ${r.ignoradas} linha(s) ignorada(s)
            ${r.temCabecalho ? '' : ' · <em>sem cabeçalho: usei nome/documento/telefone de cada linha</em>'}
          </div>
          ${amostra(r.novos, 'Novos')}
          ${amostra(r.atualizados, 'Já existem')}
        </div>`;
      $('btnConfirmarClientes').disabled = !(r.novosTotal || r.atualizadosTotal);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function confirmarImportacao() {
    if (!conteudoImportado) { avisar('Veja a prévia antes de confirmar.', 'erro'); return; }
    try {
      const r = await api('POST', '/api/clientes/importar', { conteudo: conteudoImportado });
      avisar(`Importado: ${r.criados} novo(s), ${r.atualizados} atualizado(s).`);
      $('clienteImportar').style.display = 'none';
      $('previaClientes').innerHTML = '';
      conteudoImportado = '';
      await carregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  // ------------------------------------------------------------------ ligações
  let temporizador = null;
  function ligar() {
    if (!$('view-clientes')) return;

    const busca = $('clienteBusca');
    if (busca) {
      busca.addEventListener('input', () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => carregar(busca.value.trim()), 250);
      });
    }

    $('btnNovoCliente').addEventListener('click', () => abrirFormulario(null));
    $('btnSalvarCliente').addEventListener('click', salvar);
    $('btnCancelarCliente').addEventListener('click', fecharFormulario);
    $('btnImportarClientes').addEventListener('click', () => {
      $('clienteImportar').style.display = '';
      $('clienteForm').style.display = 'none';
    });
    $('btnCancelarImportarClientes').addEventListener('click', () => {
      $('clienteImportar').style.display = 'none';
      $('previaClientes').innerHTML = '';
      conteudoImportado = '';
    });
    $('btnPreviaClientes').addEventListener('click', verPrevia);
    $('btnConfirmarClientes').addEventListener('click', confirmarImportacao);

    $('clientesTabela').addEventListener('click', (ev) => {
      const editar = ev.target.closest('[data-editar-cliente]');
      if (editar) {
        const c = estado.lista.find((x) => x.id === editar.dataset.editarCliente);
        if (c) abrirFormulario(c);
        return;
      }
      const apagarBtn = ev.target.closest('[data-apagar-cliente]');
      if (apagarBtn) { apagar(apagarBtn.dataset.apagarCliente); return; }
      const novaOS = ev.target.closest('[data-nova-os]');
      if (novaOS) {
        const c = estado.lista.find((x) => x.id === novaOS.dataset.novaOs);
        if (!c) return;
        if (typeof window.unicarNovaOSComCliente === 'function') {
          window.unicarNovaOSComCliente(c);
        } else {
          avisar('Abra a aba Ordens de Serviço e use a busca de cliente.', 'erro');
        }
      }
    });

    // carrega quando a aba é aberta (as abas do index.html trocam a classe .active)
    document.addEventListener('click', (ev) => {
      const aba = ev.target.closest && ev.target.closest('.tab');
      if (!aba || aba.dataset.view !== 'clientes') return;
      if (!estado.carregado) carregar();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
  else ligar();

  // a tela de OS avisa quando a base mudou (para a busca refletir na hora)
  document.addEventListener('unicar:clientes-mudou', () => { estado.carregado = false; });
})();
