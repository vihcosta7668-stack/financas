/**
 * Janela modal baseada em <dialog>. Usada por todos os formulários.
 *
 * abrirModal({
 *   titulo, corpo (HTML do formulário),
 *   rotuloSalvar, perigo: { rotulo, acao } (botão excluir, opcional),
 *   aoEnviar(dados, form) → retorna mensagem de erro (string) para manter aberto, ou nada para fechar,
 *   aoMontar(form) → para ligar eventos internos (chips, campos dependentes)
 * })
 */

import { esc, lerForm } from './dom.js';

export function abrirModal({ titulo, corpo, rotuloSalvar = 'Salvar', perigo = null, aoEnviar, aoMontar, largo = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal ${largo ? 'modal--largo' : ''}`;
  dlg.innerHTML = `<form class="modal__form" novalidate>
      <header class="modal__topo">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="btn-icone" data-fechar aria-label="Fechar">✕</button>
      </header>
      <div class="modal__corpo">${corpo}</div>
      <p class="modal__erro" role="alert" hidden></p>
      <footer class="modal__rodape">
        ${perigo ? `<button type="button" class="btn btn--perigo" data-perigo>${esc(perigo.rotulo)}</button>` : ''}
        <span class="espaco"></span>
        <button type="button" class="btn btn--sec" data-fechar>Cancelar</button>
        ${aoEnviar ? `<button type="submit" class="btn btn--pri">${esc(rotuloSalvar)}</button>` : ''}
      </footer>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  const erro = dlg.querySelector('.modal__erro');

  const fechar = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar]')) fechar();
    if (e.target === dlg) fechar(); // clique fora
  });
  if (perigo) {
    dlg.querySelector('[data-perigo]').addEventListener('click', () => {
      if (confirm(perigo.confirmar || 'Confirmar exclusão?')) { perigo.acao(); fechar(); }
    });
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = aoEnviar?.(lerForm(form), form);
    if (typeof msg === 'string' && msg) {
      erro.textContent = msg;
      erro.hidden = false;
      return;
    }
    fechar();
  });

  aoMontar?.(form, dlg);
  dlg.showModal();
  const foco = form.querySelector('[autofocus]');
  if (foco) setTimeout(() => foco.focus(), 30);
  return { fechar, dlg, form };
}

/** Campo de formulário padrão. */
export function campo(rotulo, controle, { dica = '', classe = '' } = {}) {
  return `<label class="campo ${classe}"><span class="campo__rotulo">${esc(rotulo)}</span>${controle}${dica ? `<span class="campo__dica">${dica}</span>` : ''}</label>`;
}

export function opcoes(lista, selecionado, { vazio = null } = {}) {
  const ops = lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selecionado ?? '') ? 'selected' : ''}>${esc(t)}</option>`);
  if (vazio !== null) ops.unshift(`<option value="">${esc(vazio)}</option>`);
  return ops.join('');
}
