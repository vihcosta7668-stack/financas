/**
 * Utilitários mínimos de interface. Sem framework: as telas geram HTML como texto
 * (sempre passando conteúdo do usuário por `esc`) e as ações usam atributos data-acao.
 */

const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto vindo do usuário antes de inserir em HTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Junta pedaços de HTML ignorando vazios/falsos. */
export const juntar = (...partes) => partes.flat().filter((p) => p !== false && p != null && p !== '').join('');

let toastTimer;
export function toast(msg, tom = 'ok') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast--${tom} toast--visivel`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--visivel'), 2600);
}

/** Lê os campos de um formulário como objeto simples. Checkboxes viram boolean. */
export function lerForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = undefined; }
    else out[el.name] = el.value;
  }
  return out;
}
