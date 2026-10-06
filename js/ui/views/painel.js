/** Tela principal: quanto posso gastar, termômetro, cascata, alertas e próximos eventos. */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { fmtCurta, fmtData, nomeMes, diffDays } from '../../core/dates.js';
import { kpi, valor, termometro, graficoSaldo, barra, listaCategorias, ESTADOS, pilula } from '../components.js';
import { gastosPorCategoria } from '../../domain/cashflow.js';

const ICONE_ALERTA = { critico: '●', atencao: '●', info: '●' };

export function render(ctx) {
  const { a, db, alertas } = ctx;
  const t = a.termometro;
  const vazio = !db.receitas.length && !db.lancamentos.length && !db.recorrentes.length && !db.cartoes.length;

  const ptMin = a.eventos.find((e) => e.dataEfetiva === a.dataMinimo && e.saldoApos === a.minimo);
  const limitador = a.dataMinimo === a.hoje
    ? 'Seu saldo de hoje é o ponto mais baixo da projeção.'
    : `O limite vem de ${fmtData(a.dataMinimo)}${ptMin ? ` (${esc(ptMin.descricao)})` : ''}, quando o saldo projetado chega a ${fmt(a.minimo)}.`;

  const cat = gastosPorCategoria(db, a, a.mesAtual);
  const totalMes = cat.reduce((s, c) => s + c.valor, 0);

  return `
  ${vazio ? boasVindas() : ''}
  <section class="hero hero--${t.estado}">
    <div class="hero__principal">
      <span class="hero__rotulo">Livre para gastar hoje</span>
      <span class="hero__valor num ${a.livre < 0 ? 'neg' : ''}">${esc(fmt(a.livre))}</span>
      <p class="hero__explica">${limitador}${a.reserva > 0 ? ` Já descontada a reserva de ${fmt(a.reserva)}.` : ''}</p>
      ${a.livre >= 0 && a.proxReceita && a.livreAteReceita > a.livre ? `<p class="hero__explica">Até o próximo recebimento (${fmtCurta(a.proxReceita.dataEfetiva)}) o saldo fica acima de ${fmt(a.livreAteReceita + a.reserva)}, mas gastar mais que ${fmt(a.livre)} agora deixa um compromisso futuro descoberto.</p>` : ''}
    </div>
    <div class="hero__termo">
      ${termometro(t)}
      <div class="hero__estado">
        <strong class="estado estado--${t.estado}">${ESTADOS[t.estado].nome}</strong>
        <ul>${t.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
        <button class="link" data-acao="explicar-termometro">Como é calculado</button>
      </div>
    </div>
  </section>

  <section class="kpis">
    ${kpi({ rotulo: 'Saldo em conta', valor: a.saldoAtual, sub: a.contas.length > 1 ? `${a.contas.length} contas` : 'dinheiro disponível agora', acao: 'data-acao="ir" data-href="#/ajustes"' })}
    ${kpi({ rotulo: 'A receber', valor: a.cascata.aReceber, sub: `até ${fmtCurta(a.cascata.fimJanela)}${a.proxReceita ? ` · próximo ${fmtCurta(a.proxReceita.dataEfetiva)}` : ''}`, tom: 'pos' })}
    ${kpi({ rotulo: 'Comprometido', valor: a.totais.comprometido, sub: `contas, faturas e parcelas até ${nomeMes(a.meses.at(-1).chave, { curto: true })}`, acao: 'data-acao="ir" data-href="#/mes"' })}
    ${kpi({ rotulo: 'No cartão', valor: a.totais.cartaoComprometido, sub: cartoesResumo(a), acao: 'data-acao="ir" data-href="#/cartoes"' })}
    ${kpi({ rotulo: 'Parcelas futuras', valor: a.totais.parcelasFuturas, sub: `${a.parcelamentos.filter((p) => !p.concluido).length} compras parceladas`, acao: 'data-acao="ir" data-href="#/gastos"' })}
  </section>

  <div class="colunas">
    <section class="cartao-ui">
      <header class="cartao-ui__topo"><h2>Do saldo de hoje até ${fmtData(a.cascata.fimJanela)}</h2></header>
      ${cascata(a)}
    </section>
    <section class="cartao-ui">
      <header class="cartao-ui__topo"><h2>Alertas</h2></header>
      ${alertas.length ? `<ul class="alertas">${alertas.map((al) => `<li class="alerta alerta--${al.nivel}">
          <span class="alerta__icone" aria-hidden="true">${ICONE_ALERTA[al.nivel]}</span>
          <span>${esc(al.texto)}</span>
          ${al.rota ? `<a class="link" href="${al.rota}">ver</a>` : ''}
        </li>`).join('')}</ul>` : '<p class="texto-sec">Nenhum alerta no momento.</p>'}
    </section>
  </div>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Saldo projetado</h2><span class="texto-sec">até ${fmtData(a.fim)}${a.estimativa.valor ? ` · inclui ${fmt(a.estimativa.valor)}/mês de gasto variável previsto` : ''}</span></header>
    ${graficoSaldo(a)}
  </section>

  <div class="colunas">
    <section class="cartao-ui">
      <header class="cartao-ui__topo"><h2>Próximos 30 dias</h2><a class="link" href="#/mes">visão mensal</a></header>
      ${proximos(a)}
    </section>
    <section class="cartao-ui">
      <header class="cartao-ui__topo"><h2>Gastos de ${nomeMes(a.mesAtual, { ano: false })}</h2><span class="num">${fmt(totalMes)}</span></header>
      ${a.estimativa.valor > 0 ? `<div class="meta"><span class="texto-sec">Referência mensal de gasto variável: ${fmt(a.estimativa.valor)}</span>${barra(variavelMes(db, a), a.estimativa.valor, variavelMes(db, a) > a.estimativa.valor ? 'vermelho' : '')}</div>` : ''}
      ${listaCategorias(cat, totalMes)}
    </section>
  </div>`;
}

function variavelMes(db, a) {
  return db.lancamentos.filter((l) => !l.recorrenteId && (l.parcelas || 1) === 1 && l.data.slice(0, 7) === a.mesAtual).reduce((s, l) => s + l.valor, 0);
}

function cartoesResumo(a) {
  const ativos = a.cartoes.filter((c) => c.ativo !== false);
  if (!ativos.length) return 'nenhum cartão cadastrado';
  const disp = ativos.reduce((s, c) => s + c.disponivel, 0);
  return `limite disponível ${fmt(disp)}`;
}

function cascata(a) {
  const c = a.cascata;
  const linha = (rotulo, v, sinal, dica = '') => (v || sinal === '=' ? `<li class="cascata__linha ${sinal === '=' ? 'cascata__total' : ''}">
      <span>${rotulo}${dica ? `<small>${dica}</small>` : ''}</span>
      <span class="num ${sinal === '−' ? 'neg-suave' : sinal === '+' ? 'pos' : ''}">${sinal === '=' ? '' : sinal} ${esc(fmt(Math.abs(v)))}</span>
    </li>` : '');
  return `<ul class="cascata">
    ${linha('Saldo atual', a.saldoAtual, ' ')}
    ${linha('A receber', c.aReceber, '+')}
    ${linha('Contas fixas', c.contasFixas, '−')}
    ${linha('Cartão (compras à vista e fixos)', c.cartao, '−')}
    ${linha('Parcelas', c.parcelas, '−', 'no cartão e em carnê/boleto')}
    ${linha('Outros agendados', c.outros, '−')}
    ${linha('Gasto variável previsto', c.variavelPrevisto, '−', 'estimativa para os próximos meses')}
    <li class="cascata__linha cascata__total"><span>Saldo projetado em ${fmtCurta(c.fimJanela)}</span><span class="num ${c.saldoFinal < 0 ? 'neg' : ''}">${esc(fmt(c.saldoFinal))}</span></li>
  </ul>
  <p class="texto-sec">O cartão de crédito só pesa aqui quando a fatura vence; o limite não é tratado como dinheiro. Receitas futuras aparecem como "a receber" e não entram no saldo de hoje.</p>`;
}

function proximos(a) {
  const ate = a.eventos.filter((e) => e.tipo !== 'variavelPrevisto' && diffDays(a.hoje, e.dataEfetiva) <= 30);
  if (!ate.length) return '<p class="texto-sec">Nada previsto para os próximos 30 dias.</p>';
  return `<ul class="linha-tempo">${ate.map((e) => {
    const acao = e.tipo === 'receita' ? `<button class="btn btn--mini" data-acao="confirmar-receita" data-id="${esc(e.id)}">Recebi</button>`
      : e.tipo === 'fixo' ? `<button class="btn btn--mini" data-acao="pagar-fixo" data-id="${esc(e.id)}">Paguei</button>`
        : e.tipo === 'fatura' ? `<button class="btn btn--mini" data-acao="pagar-fatura" data-cartao="${esc(e.cartaoId)}" data-chave="${esc(e.chave)}">Pagar</button>` : '';
    return `<li class="lt ${e.atrasado ? 'lt--atrasado' : ''}">
      <span class="lt__data">${fmtCurta(e.data)}</span>
      <span class="lt__desc">${esc(e.descricao)}${e.atrasado ? pilula('atrasado', 'vermelho') : ''}${e.parcela ? pilula(`${e.parcela.i}/${e.parcela.n}`) : ''}</span>
      ${valor(e.valor, { classe: e.valor > 0 ? 'pos' : '' })}
      <span class="lt__saldo num ${e.saldoApos < 0 ? 'neg' : ''}" title="Saldo projetado após este evento">${esc(fmt(e.saldoApos))}</span>
      <span class="lt__acao">${acao}</span>
    </li>`;
  }).join('')}</ul>`;
}

function boasVindas() {
  return `<section class="cartao-ui boas-vindas">
    <h2>Primeiros passos</h2>
    <p>O painel calcula quanto você pode gastar a partir do que estiver cadastrado. Quatro informações bastam para começar:</p>
    <ol>
      <li><a href="#/ajustes">Saldo atual da sua conta</a></li>
      <li><a href="#/fixos">Salário e outras receitas</a></li>
      <li><a href="#/cartoes">Cartões de crédito e o que já está na fatura</a></li>
      <li><a href="#/fixos">Contas fixas (aluguel, energia, internet…)</a></li>
    </ol>
    <p class="texto-sec">Quer ver como fica antes? <button class="link" data-acao="carregar-exemplo">Carregar dados de exemplo</button> (substitui os dados atuais).</p>
  </section>`;
}
