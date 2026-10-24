// UNICAR - Tela de Técnicos / Mecânicos (cadastro simples, sem login)
// Só aparece para administrador (todas as lojas) e gerente (a própria loja).
// O servidor confere tudo de novo: aqui só evitamos mostrar o que a pessoa não pode usar.
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

  const estado = { eu: null, lojas: [], lista: [], carregado: false };
  const ehAdmin = () => !!estado.eu && estado.eu.perfil === 'admin';

  async function descobrirQuemSou() {
    try {
      const eu = await api('GET', '/api/eu');
      estado.eu = eu.usuario;
      if (!estado.eu || (estado.eu.perfil !== 'admin' && estado.eu.perfil !== 'gerente')) return;
      const l = await api('GET', '/api/lojas');
      estado.lojas = l.lojas || [];
      if ($('tabTecnicos')) $('tabTecnicos').style.display = '';
    } catch (e) { /* sem sessão: a aba continua escondida */ }
  }

  function preencherLojas(selecionada) {
    const alvo = $('tecnicoLoja');
    if (!alvo) return;
    if (ehAdmin()) {
      alvo.disabled = false;
      alvo.innerHTML = '<option value="">Todas as lojas</option>'
        + estado.lojas.map((l) => `<option value="${esc(l.codigo)}">${esc(l.nome || l.codigo)}</option>`).join('');
      alvo.value = selecionada || '';
    } else {
      const minha = estado.eu.loja || '';
      alvo.innerHTML = `<option value="${esc(minha)}">${esc(minha)}</option>`;
      alvo.value = minha;
      alvo.disabled = true;
    }
  }

  async function carregar() {
    const tbody = $('tecnicosTabela');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Carregando…</td></tr>';
    try {
      const dados = await api('GET', '/api/tecnicos');
      estado.lista = dados.tecnicos || [];
      estado.carregado = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${esc(e.message)}</td></tr>`;
      return;
    }
    if (!estado.lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum técnico cadastrado ainda — use “+ Novo técnico”.</td></tr>';
      return;
    }
    tbody.innerHTML = estado.lista.map((t) => `
      <tr${t.ativo ? '' : ' style="opacity:.55;"'}>
        <td><strong>${esc(t.nome)}</strong></td>
        <td>${esc(t.loja) || 'Todas'}</td>
        <td>${esc(t.telefone) || '<span class="hint">—</span>'}</td>
        <td>${esc(t.especialidade) || '<span class="hint">—</span>'}</td>
        <td>${t.osCount || 0}</td>
        <td>${t.ativo ? 'Ativo' : 'Inativo'}</td>
        <td class="toolbar">
          <button class="btn-ghost btn-sm" data-editar-tecnico="${esc(t.id)}">Editar</button>
          <button class="btn-ghost btn-sm" data-alternar-tecnico="${esc(t.id)}">${t.ativo ? 'Desativar' : 'Reativar'}</button>
          <button class="btn-ghost btn-sm" data-apagar-tecnico="${esc(t.id)}">Apagar</button>
        </td>
      </tr>`).join('');
  }

  function abrirFormulario(t) {
    $('tecnicoForm').style.display = '';
    $('tecnicoFormTitulo').textContent = t ? 'Editar técnico' : 'Novo técnico';
    $('tecnicoId').value = t ? t.id : '';
    $('tecnicoNome').value = t ? t.nome : '';
    $('tecnicoTelefone').value = t ? t.telefone : '';
    $('tecnicoEspecialidade').value = t ? t.especialidade : '';
    $('tecnicoObs').value = t ? t.observacoes : '';
    preencherLojas(t ? t.loja : '');
    $('tecnicoStatus').textContent = '';
    $('tecnicoNome').focus();
  }

  const fecharFormulario = () => { $('tecnicoForm').style.display = 'none'; };

  async function salvar() {
    const corpo = {
      nome: $('tecnicoNome').value,
      telefone: $('tecnicoTelefone').value,
      loja: $('tecnicoLoja').value,
      especialidade: $('tecnicoEspecialidade').value,
      observacoes: $('tecnicoObs').value,
    };
    if (!corpo.nome.trim()) { avisar('Informe o nome do técnico.', 'erro'); return; }
    const id = $('tecnicoId').value;
    try {
      await api(id ? 'PUT' : 'POST', id ? `/api/tecnicos/${encodeURIComponent(id)}` : '/api/tecnicos', corpo);
      avisar(id ? 'Técnico atualizado.' : 'Técnico cadastrado.');
      fecharFormulario();
      carregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  function ligar() {
    descobrirQuemSou();
    if (!$('view-tecnicos')) return;
    $('btnNovoTecnico').addEventListener('click', () => abrirFormulario(null));
    $('btnCancelarTecnico').addEventListener('click', fecharFormulario);
    $('btnSalvarTecnico').addEventListener('click', salvar);

    $('tecnicosTabela').addEventListener('click', async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const achar = (id) => estado.lista.find((t) => t.id === id);
      try {
        if (b.dataset.editarTecnico) {
          abrirFormulario(achar(b.dataset.editarTecnico));
        } else if (b.dataset.alternarTecnico) {
          const t = achar(b.dataset.alternarTecnico);
          await api('PUT', `/api/tecnicos/${encodeURIComponent(t.id)}`, { ativo: !t.ativo });
          avisar(t.ativo ? 'Técnico desativado.' : 'Técnico reativado.');
          carregar();
        } else if (b.dataset.apagarTecnico) {
          const t = achar(b.dataset.apagarTecnico);
          const aviso = t.osCount
            ? `${t.nome} já está em ${t.osCount} OS. Ele será apenas DESATIVADO (as OS antigas continuam com o nome). Continuar?`
            : `Apagar o técnico ${t.nome}?`;
          if (!window.confirm(aviso)) return;
          const r = await api('DELETE', `/api/tecnicos/${encodeURIComponent(t.id)}`);
          avisar(r.desativado ? 'Técnico desativado.' : 'Técnico apagado.');
          carregar();
        }
      } catch (e) {
        avisar(e.message, 'erro');
      }
    });

    document.addEventListener('click', (ev) => {
      const aba = ev.target.closest && ev.target.closest('.tab');
      if (!aba || aba.dataset.view !== 'tecnicos') return;
      carregar();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
  else ligar();
})();
