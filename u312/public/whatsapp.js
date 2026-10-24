// UNICAR - Tela do WhatsApp (Configurações > WhatsApp) e botão de envio da OS
// Uma conexão por loja. O WhatsApp aqui só ENVIA a OS: não recebe nem responde nada.
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
    const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
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

  const ROTULO = {
    desconectado: '🔴 Desconectado',
    aguardando: '🟡 Aguardando leitura',
    conectado: '🟢 Conectado',
    erro: '🟠 Erro',
  };

  let temporizador = null;

  function cartaoDaLoja(w, podeAdministrar) {
    const travado = podeAdministrar ? '' : ' disabled';
    const conectado = w.status === 'conectado';
    const qr = w.qr ? `<img src="${esc(w.qr)}" alt="QR Code do WhatsApp" style="width:220px;max-width:100%;background:#fff;border-radius:10px;padding:8px;">` : '';
    const codigo = w.pareamento && w.pareamento.codigo
      ? `<div style="margin-top:8px;font-size:13px;">Código de pareamento: <strong style="font-size:18px;letter-spacing:2px;">${esc(w.pareamento.codigo)}</strong>
         <div class="hint">WhatsApp do celular → Aparelhos conectados → Conectar com número de telefone.</div></div>`
      : '';
    return `
      <div class="panel" style="margin-bottom:12px;" data-loja-whats="${esc(w.loja)}">
        <div class="panel-header" style="padding:10px 14px;">
          <h3 style="margin:0;font-size:15px;">${esc(w.loja)}</h3>
          <span style="font-size:13px;">${ROTULO[w.status] || esc(w.status)}${w.numero ? ` · ${esc(w.numero)}` : ''}</span>
        </div>
        <div class="panel-body" style="padding:12px 14px;">
          ${w.erro ? `<div class="hint" style="color:var(--warn,#e0a100);margin-bottom:8px;">${esc(w.erro)}</div>` : ''}
          <div class="toolbar" style="gap:8px;flex-wrap:wrap;">
            <button class="btn-primary btn-sm" data-acao="conectar"${travado}>Conectar (QR Code)</button>
            <input class="search-input" data-campo="telefone" placeholder="DDD + número da loja" style="max-width:190px;"${travado}>
            <button class="btn-secondary btn-sm" data-acao="codigo"${travado}>Conectar com número</button>
          </div>
          <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-top:8px;">
            <input class="search-input" data-campo="teste" placeholder="número para o teste" style="max-width:190px;"${travado}>
            <button class="btn-secondary btn-sm" data-acao="teste"${travado}>Enviar mensagem de teste</button>
            <button class="btn-danger-ghost btn-sm" data-acao="desconectar"${travado || (conectado || w.status === 'aguardando' ? '' : ' disabled')}>Desconectar</button>
          </div>
          ${qr}
          ${codigo}
          <div class="hint" style="margin-top:8px;">Sessão salva em: ${esc(w.pasta)}${w.sessaoSalva ? ' · já existe' : ' · ainda não criada'}</div>
        </div>
      </div>`;
  }

  async function carregar() {
    const caixa = $('cfgWhatsapp');
    if (!caixa) return;
    let dados;
    try {
      dados = await api('GET', '/api/whatsapp');
    } catch (e) {
      caixa.innerHTML = `<div class="hint">${esc(e.message)}</div>`;
      return;
    }
    caixa.innerHTML = dados.lojas.map((w) => cartaoDaLoja(w, dados.podeAdministrar)).join('')
      + (dados.podeAdministrar ? '' : '<div class="hint">Só o administrador (ou o gerente da loja) conecta o WhatsApp.</div>');

    caixa.querySelectorAll('[data-acao]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const cartao = botao.closest('[data-loja-whats]');
        const loja = cartao.dataset.lojaWhats;
        const acao = botao.dataset.acao;
        const telefone = (cartao.querySelector('[data-campo="telefone"]') || {}).value || '';
        const teste = (cartao.querySelector('[data-campo="teste"]') || {}).value || '';
        botao.disabled = true;
        try {
          if (acao === 'conectar') {
            await api('POST', `/api/whatsapp/${encodeURIComponent(loja)}/conectar`, {});
            avisar('Conexão iniciada. Se aparecer o QR Code, leia no WhatsApp da loja.');
          }
          if (acao === 'codigo') {
            if (!telefone.trim()) { avisar('Digite o número da loja com DDD.', 'erro'); return; }
            const r = await api('POST', `/api/whatsapp/${encodeURIComponent(loja)}/codigo`, { telefone });
            const codigo = r.whatsapp && r.whatsapp.pareamento && r.whatsapp.pareamento.codigo;
            avisar(codigo ? `Código: ${codigo}` : 'Pedido enviado — aguardando o código.');
          }
          if (acao === 'teste') {
            if (!teste.trim()) { avisar('Digite o número que vai receber o teste.', 'erro'); return; }
            await api('POST', `/api/whatsapp/${encodeURIComponent(loja)}/teste`, { numero: teste });
            avisar('Teste enviado.');
          }
          if (acao === 'desconectar') {
            if (!window.confirm(`Desconectar o WhatsApp da loja ${loja}?`)) return;
            await api('POST', `/api/whatsapp/${encodeURIComponent(loja)}/desconectar`, {});
            avisar('WhatsApp desconectado.');
          }
          await carregar();
        } catch (e) {
          avisar(e.message, 'erro');
          botao.disabled = false;
        }
      });
    });
  }

  // chamado pela aba de Configurações
  window.unicarCarregarWhatsapp = function () {
    carregar();
    if (temporizador) clearInterval(temporizador);
    temporizador = setInterval(() => {
      const painel = $('cfgWhatsapp');
      const aba = document.getElementById('view-config');
      if (!painel || !aba || !aba.classList.contains('active')) { clearInterval(temporizador); temporizador = null; return; }
      carregar();
    }, 4000);
  };

  // botão "📱 WhatsApp" na ficha da OS
  window.unicarEnviarWhatsApp = async function (os) {
    const sugerido = (os && os.cliente && (os.cliente.whatsapp || os.cliente.telefone)) || '';
    const numero = window.prompt('Enviar a OS em PDF pelo WhatsApp para qual número?', sugerido);
    if (numero === null) return;
    if (!String(numero).replace(/\D+/g, '')) { avisar('Número inválido.', 'erro'); return; }
    try {
      const r = await api('POST', `/api/os/${encodeURIComponent(os.id || os.numero)}/enviar-whatsapp`, { numero });
      avisar(`OS ${r.os} enviada para ${r.numero}.`);
    } catch (e) {
      avisar(e.message, 'erro');
    }
  };

  document.addEventListener('DOMContentLoaded', () => {});
})();
