// Medida de pneu: aceita do jeito que a pessoa fala e devolve no padrão da loja.
// Usado pela tela de cadastro (navegador) e pelos testes (Node).
(function (raiz) {
  'use strict';

  // "1856515", "185/65/15", "185 65 15", "185/65R15", "185/65 R15 ATR",
  // "31x10.5R15", "1000-20" -> { ok, texto: "185/65 R15", largura, perfil, aro }
  function normalizarMedida(bruta) {
    const original = String(bruta || '').trim();
    if (!original) return { ok: false, texto: '', motivo: 'Digite a medida.' };

    let t = original.toUpperCase().replace(/\s+/g, ' ').trim();
    let sufixo = '';
    const suf = t.match(/\s*(ATR|C)$/);
    if (suf) { sufixo = suf[1]; t = t.slice(0, suf.index).trim(); }

    const pol = t.match(/^(\d{2})\s*X\s*(\d{1,2}(?:[.,]\d)?)\s*R?\s*(\d{2})$/);
    if (pol) {
      return {
        ok: true,
        texto: `${pol[1]}x${pol[2].replace(',', '.')}R${pol[3]}${sufixo ? ' ' + sufixo : ''}`,
        largura: pol[1],
        perfil: pol[2],
        aro: pol[3],
      };
    }

    const cam = t.match(/^(\d{4})\s*-\s*(\d{2})$/);
    if (cam) {
      return {
        ok: true,
        texto: `${cam[1]}-${cam[2]}${sufixo ? ' ' + sufixo : ''}`,
        largura: cam[1],
        perfil: '',
        aro: cam[2],
      };
    }

    const m = t.match(/^(\d{3})\s*[\/\s]?\s*(\d{2,3})\s*[\/\s]?\s*R?\s*(\d{2})?$/);
    if (m) {
      const largura = m[1];
      const perfil = m[2];
      const aro = m[3];
      if (!aro) {
        return { ok: false, texto: original, motivo: 'Falta o aro (ex.: 185/65 R15).' };
      }
      if (Number(perfil) < 25 || Number(perfil) > 85) {
        return { ok: false, texto: original, motivo: 'Perfil fora do normal (25 a 85).' };
      }
      if (Number(aro) < 12 || Number(aro) > 26) {
        return { ok: false, texto: original, motivo: 'Aro fora do normal (12 a 26).' };
      }
      if (Number(largura) < 125 || Number(largura) > 395) {
        return { ok: false, texto: original, motivo: 'Largura fora do normal (125 a 395).' };
      }
      // Padrão da loja: sem espaço entre perfil e aro, sufixo separado por espaço.
      return {
        ok: true,
        texto: `${largura}/${perfil}R${aro}${sufixo ? ' ' + sufixo : ''}`,
        largura,
        perfil,
        aro,
      };
    }

    return { ok: false, texto: original, motivo: 'Não entendi a medida. Use 185/65 R15.' };
  }

  const api = { normalizarMedida };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.unicarMedida = api;
})(typeof window !== 'undefined' ? window : null);
