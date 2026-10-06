/** Pessoas: quanto cada uma deve, já pagou e falta pagar, com as despesas relacionadas. */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { fmtCurta } from '../../core/dates.js';
import { valor, pilula, barra } from '../components.js';

export function render(ctx) {
  const { pessoas } = ctx;
  const eu = pessoas.find((p) => p.pessoa.eu);
  const outros = pessoas.filter((p) => !p.pessoa.eu);
  const totalAReceber = outros.reduce((s, p) => s + Math.max(0, p.falta), 0);

  return `
  <div class="barra-ferramentas">
    <span class="texto-sec">A receber de outras pessoas: <strong class="num">${fmt(totalAReceber)}</strong> — não entra no "livre para gastar" até o pagamento ser registrado.</span>
    <span class="espaco"></span>
    <button class="btn btn--pri" data-acao="nova-pessoa">+ Pessoa</button>
  </div>
  <div class="grade-pessoas">
    ${outros.map((p) => pessoa(p)).join('')}
    ${!outros.length ? '<section class="cartao-ui"><p class="texto-sec">Cadastre as pessoas com quem você divide despesas. Depois, ao lançar um gasto, use "Mais opções → Quem paga esta despesa".</p></section>' : ''}
  </div>
  ${eu ? `<section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Sua parte</h2><button class="btn btn--sec" data-acao="editar-pessoa" data-id="${esc(eu.pessoa.id)}">Renomear</button></header>
    <p class="texto-sec">Do total que saiu das suas contas e cartões, ${fmt(eu.devido)} é despesa sua; o restante pertence às pessoas acima.</p>
  </section>` : ''}`;
}

function pessoa(p) {
  const quitado = p.falta <= 0 && p.devido > 0;
  return `<section class="cartao-ui pessoa">
    <header class="cartao-ui__topo">
      <h2>${esc(p.pessoa.nome)}</h2>
      <button class="btn-icone" data-acao="editar-pessoa" data-id="${esc(p.pessoa.id)}" aria-label="Editar ${esc(p.pessoa.nome)}">✎</button>
    </header>
    <div class="pessoa__numeros">
      <div><span class="texto-sec">Deve</span><strong class="num">${fmt(p.devido)}</strong></div>
      <div><span class="texto-sec">Pagou</span><strong class="num pos">${fmt(p.pago)}</strong></div>
      <div><span class="texto-sec">Falta</span><strong class="num ${p.falta > 0 ? 'neg' : ''}">${fmt(p.falta)}</strong></div>
    </div>
    ${barra(p.pago, p.devido, quitado ? 'verde' : '')}
    <button class="btn btn--sec btn--largo" data-acao="registrar-acerto" data-id="${esc(p.pessoa.id)}">Registrar pagamento</button>
    <details>
      <summary>Despesas (${p.despesas.length}) e pagamentos (${p.acertos.length})</summary>
      <ul class="tabela">
        ${p.despesas.map((d) => `<li ${d.origem === 'lancamento' ? `class="clicavel" data-acao="editar-lanc" data-id="${esc(d.origemId)}"` : ''}>
          <span class="tabela__data">${fmtCurta(d.data)}</span>
          <span class="tabela__desc">${esc(d.descricao)} ${d.total !== d.valor ? pilula(`de ${fmt(d.total)}`) : ''}</span>
          ${valor(d.valor)}
        </li>`).join('')}
        ${p.acertos.map((a) => `<li class="clicavel" data-acao="editar-acerto" data-id="${esc(a.id)}">
          <span class="tabela__data">${fmtCurta(a.data)}</span>
          <span class="tabela__desc">Pagamento ${a.obs ? `· ${esc(a.obs)}` : ''} ${pilula('pago', 'verde')}</span>
          ${valor(a.valor, { classe: 'pos' })}
        </li>`).join('')}
      </ul>
    </details>
  </section>`;
}
