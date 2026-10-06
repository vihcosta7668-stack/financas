/** Visão mensal: navegação entre meses, projeção dos próximos meses e detalhe do mês. */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { nomeMes, fmtCurta, addMonthsKey } from '../../core/dates.js';
import { kpi, valor, graficoMeses, pilula, pontoCor, vazio } from '../components.js';
import { detalharMes } from '../../domain/cashflow.js';

export function render(ctx) {
  const { a, db, ui } = ctx;
  const chave = ui.mes || a.mesAtual;
  const d = detalharMes(db, a, chave);
  const p = d.projetado;
  const primeiro = [db.config.dataInicio, ...db.lancamentos.map((l) => l.data)].sort()[0].slice(0, 7);
  const ultimo = a.meses.at(-1).chave;
  const cat = (id) => db.categorias.find((c) => c.id === id);

  const lista = (titulo, itens, linha, total) => `<section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>${titulo}</h2><span class="num">${fmt(total)}</span></header>
    ${itens.length ? `<ul class="tabela">${itens.map(linha).join('')}</ul>` : '<p class="texto-sec">Nada neste mês.</p>'}
  </section>`;

  const statusPilula = (s) => pilula(s, { atrasado: 'vermelho', 'a pagar': 'amarelo', previsto: 'amarelo', pago: 'verde', recebido: 'verde' }[s] || '');

  return `
  <nav class="nav-mes" aria-label="Navegar entre meses">
    <button class="btn-icone" data-acao="mes" data-mes="${addMonthsKey(chave, -1)}" ${chave <= primeiro ? 'disabled' : ''} aria-label="Mês anterior">←</button>
    <div class="nav-mes__lista">
      ${[-1, 0, 1, 2].map((i) => addMonthsKey(chave, i)).map((k) => `<button class="nav-mes__item ${k === chave ? 'ativo' : ''}" data-acao="mes" data-mes="${k}" ${k < primeiro || k > ultimo ? 'disabled' : ''}>${esc(nomeMes(k, { ano: k.slice(0, 4) !== a.mesAtual.slice(0, 4) }))}</button>`).join('')}
    </div>
    <button class="btn-icone" data-acao="mes" data-mes="${addMonthsKey(chave, 1)}" ${chave >= ultimo ? 'disabled' : ''} aria-label="Próximo mês">→</button>
    ${chave !== a.mesAtual ? `<button class="link" data-acao="mes" data-mes="${a.mesAtual}">hoje</button>` : ''}
  </nav>

  ${p ? `<section class="kpis">
    ${kpi(p.saldoInicioAproximado
      ? { rotulo: `Saldo no último ajuste (${fmtCurta(a.contas.reduce((m, c) => (c.saldoEm > m ? c.saldoEm : m), '0'))})`, valor: p.saldoInicio, sub: 'entradas e saídas ao lado contam a partir do ajuste' }
      : { rotulo: chave === a.mesAtual ? 'Saldo no início do mês' : 'Saldo inicial previsto', valor: p.saldoInicio })}
    ${kpi({ rotulo: 'Entradas', valor: p.entradas, tom: 'pos' })}
    ${kpi({ rotulo: 'Saídas', valor: p.saidas, sub: `${fmt(p.comprometido)} ainda comprometido` })}
    ${kpi({ rotulo: 'Saldo final previsto', valor: p.saldoFim, tom: p.saldoFim < 0 ? 'neg' : '' })}
    ${kpi({ rotulo: 'Menor saldo no mês', valor: p.menorSaldo, sub: 'o que define quanto dá para gastar', tom: p.menorSaldo < a.reserva ? 'neg' : '' })}
  </section>` : `<p class="texto-sec">Mês anterior ao início da projeção: abaixo estão os registros feitos.</p>`}

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Próximos ${a.meses.length} meses</h2><span class="texto-sec">toque num mês para ver o detalhe</span></header>
    ${graficoMeses(a.meses, { selecionado: chave })}
    ${tabelaMeses(a, chave)}
  </section>

  <div class="colunas">
    ${lista('Receitas', d.receitas, (r) => `<li>
        <span class="tabela__data">${fmtCurta(r.data)}</span><span class="tabela__desc">${esc(r.descricao)} ${statusPilula(r.status)}</span>
        ${valor(r.valor, { classe: 'pos' })}
        ${r.status !== 'recebido' ? `<button class="btn btn--mini" data-acao="confirmar-receita" data-id="${esc(r.id)}">Recebi</button>` : '<span></span>'}
      </li>`, d.totais.receitas)}
    ${lista('Gastos fixos', d.fixos, (f) => `<li>
        <span class="tabela__data">${fmtCurta(f.data)}</span><span class="tabela__desc">${pontoCor(cat(f.categoriaId)?.cor)}${esc(f.descricao)} ${statusPilula(f.status)}</span>
        ${valor(f.valor)}
        ${['a pagar', 'atrasado'].includes(f.status) ? `<button class="btn btn--mini" data-acao="pagar-fixo" data-id="${esc(f.id)}">Paguei</button>` : '<span></span>'}
      </li>`, d.totais.fixos)}
  </div>
  <div class="colunas">
    ${lista('Faturas que vencem no mês', d.faturas, (f) => {
      const c = db.cartoes.find((x) => x.id === f.cartaoId);
      return `<li>
        <span class="tabela__data">${fmtCurta(f.vencimento)}</span><span class="tabela__desc">${pontoCor(c?.cor)}${esc(c?.nome)} ${pilula(f.status, { paga: 'verde', vencida: 'vermelho', fechada: 'amarelo', anterior: '' }[f.status])}</span>
        ${valor(f.total)}
        ${f.aberto > 0 ? `<button class="btn btn--mini" data-acao="pagar-fatura" data-cartao="${esc(f.cartaoId)}" data-chave="${esc(f.chave)}">Pagar</button>` : '<span></span>'}
      </li>`;
    }, d.totais.faturas)}
    ${lista('Parcelas que caem no mês', d.parcelas, (x) => `<li>
        <span class="tabela__data">${fmtCurta(x.vencimento)}</span><span class="tabela__desc">${esc(x.descricao)} ${pilula(`${x.parcela.i}/${x.parcela.n}`)} ${x.meio === 'cartao' ? pilula('fatura') : ''}</span>
        ${valor(x.valor)}<span></span>
      </li>`, d.totais.parcelas)}
  </div>
  ${lista('Gastos variáveis', d.variaveis, (x) => `<li class="clicavel" data-acao="editar-lanc" data-id="${esc(x.lancId)}">
      <span class="tabela__data">${fmtCurta(x.data)}</span><span class="tabela__desc">${pontoCor(cat(x.categoriaId)?.cor)}${esc(x.descricao)} ${x.meio === 'cartao' ? pilula(db.cartoes.find((c) => c.id === x.cartaoId)?.nome || 'cartão') : ''}</span>
      ${valor(x.valor)}<span></span>
    </li>`, d.totais.variaveis)}
  ${!d.variaveis.length && !d.fixos.length && !d.receitas.length && d.passado ? vazio('Sem registros neste mês.') : ''}`;
}

function tabelaMeses(a, sel) {
  return `<div class="rolagem"><table class="tab-meses">
    <thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Comprometido</th><th>Saldo final</th><th>Menor saldo</th></tr></thead>
    <tbody>${a.meses.map((m) => `<tr class="${m.chave === sel ? 'sel' : ''}" data-acao="mes" data-mes="${m.chave}">
      <td>${esc(nomeMes(m.chave, { curto: true }))}</td>
      <td class="num pos">${fmt(m.entradas)}</td>
      <td class="num">${fmt(m.saidas)}</td>
      <td class="num">${fmt(m.comprometido)}</td>
      <td class="num ${m.saldoFim < 0 ? 'neg' : ''}">${fmt(m.saldoFim)}</td>
      <td class="num ${m.menorSaldo < a.reserva ? 'neg' : ''}">${fmt(m.menorSaldo)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

