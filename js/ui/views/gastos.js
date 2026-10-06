/** Lançamentos: lista de gastos do mês com filtros e acompanhamento das compras parceladas. */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { nomeMes, fmtCurta, fmtData, addMonthsKey, monthKey } from '../../core/dates.js';
import { valor, pilula, pontoCor, barra, vazio } from '../components.js';
import { FORMAS } from '../../domain/schema.js';

export function render(ctx) {
  const { db, a, ui } = ctx;
  const mes = ui.mesGastos || a.mesAtual;
  const filtroCat = ui.filtroCat || '';
  const busca = (ui.busca || '').toLowerCase();

  const itens = db.lancamentos
    .filter((l) => monthKey(l.data) === mes)
    .filter((l) => !filtroCat || (l.categoriaId || '') === filtroCat)
    .filter((l) => !busca || l.descricao.toLowerCase().includes(busca))
    .sort((x, y) => y.data.localeCompare(x.data) || (y.criadoEm || '').localeCompare(x.criadoEm || ''));
  const total = itens.reduce((s, l) => s + l.valor, 0);
  const cat = (id) => db.categorias.find((c) => c.id === id);

  const grupos = new Map();
  for (const l of itens) {
    if (!grupos.has(l.data)) grupos.set(l.data, []);
    grupos.get(l.data).push(l);
  }

  const meioDe = (l) => {
    if (l.forma === 'cartao') {
      const c = db.cartoes.find((x) => x.id === l.cartaoId);
      return pilula(c?.nome || 'cartão');
    }
    return pilula(FORMAS[l.forma]?.nome || l.forma);
  };
  const pessoasDe = (l) => {
    if (!l.divisao?.length) {
      const p = l.responsavelId && db.pessoas.find((x) => x.id === l.responsavelId && !x.eu);
      return p ? pilula(`de ${p.nome}`) : '';
    }
    return pilula(`dividido · ${l.divisao.length}`);
  };

  const ativos = a.parcelamentos.filter((p) => !p.concluido);

  return `
  <div class="barra-ferramentas">
    <nav class="nav-mes nav-mes--compacta">
      <button class="btn-icone" data-acao="mes-gastos" data-mes="${addMonthsKey(mes, -1)}" aria-label="Mês anterior">←</button>
      <strong>${esc(nomeMes(mes))}</strong>
      <button class="btn-icone" data-acao="mes-gastos" data-mes="${addMonthsKey(mes, 1)}" aria-label="Próximo mês">→</button>
    </nav>
    <select data-filtro="filtroCat" aria-label="Filtrar por categoria">
      <option value="">Todas as categorias</option>
      ${db.categorias.map((c) => `<option value="${esc(c.id)}" ${c.id === filtroCat ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
    </select>
    <input type="search" data-filtro="busca" value="${esc(ui.busca || '')}" placeholder="Buscar" aria-label="Buscar gasto">
    <button class="btn btn--pri" data-acao="novo-gasto">+ Novo gasto</button>
  </div>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Gastos lançados</h2><span class="num">${itens.length} · ${fmt(total)}</span></header>
    <p class="texto-sec">Compras parceladas aparecem pelo valor total na data da compra. Gastos fixos no cartão entram direto na fatura e não são listados aqui.</p>
    ${itens.length ? [...grupos.entries()].map(([data, ls]) => `
      <h3 class="dia">${fmtData(data)}</h3>
      <ul class="tabela">${ls.map((l) => `<li class="clicavel" data-acao="editar-lanc" data-id="${esc(l.id)}">
        <span class="tabela__desc">${pontoCor(cat(l.categoriaId)?.cor)}${esc(l.descricao)}
          ${meioDe(l)}${(l.parcelas || 1) > 1 ? pilula(`${l.parcelas}x`) : ''}${l.recorrenteId ? pilula('fixo') : ''}${pessoasDe(l)}</span>
        ${valor(l.valor)}
      </li>`).join('')}</ul>`).join('') : vazio('Nenhum gasto encontrado.', '<button class="btn btn--pri" data-acao="novo-gasto">+ Novo gasto</button>')}
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Compras parceladas em andamento</h2><span class="num">${fmt(a.totais.parcelasFuturas)} restantes</span></header>
    ${ativos.length ? `<ul class="parcelados">${ativos.map((p) => {
      const l = p.lancamento;
      const c = db.cartoes.find((x) => x.id === l.cartaoId);
      return `<li class="clicavel" data-acao="editar-lanc" data-id="${esc(l.id)}">
        <div class="parcelados__topo">
          <strong>${esc(l.descricao)}</strong>
          <span class="num">${fmt(p.valorParcela)} × ${l.parcelas}</span>
        </div>
        ${barra(p.pagas, l.parcelas)}
        <div class="parcelados__info texto-sec">
          <span>parcela ${p.atual} de ${l.parcelas}</span>
          <span>${p.restantes} restantes · ${fmt(p.valorRestante)}</span>
          <span>${c ? esc(c.nome) : 'carnê/boleto'} · até ${esc(nomeMes(p.ultimaChave, { curto: true }))}</span>
        </div>
        <div class="parcelados__meses">${p.parcelas.map((x) => `<span class="${x.paga ? 'paga' : ''}" title="${fmtCurta(x.vencimento)} · ${fmt(x.valor)}">${esc(nomeMes(x.chave, { ano: false, curto: true }))}</span>`).join('')}</div>
      </li>`;
    }).join('')}</ul>` : '<p class="texto-sec">Nenhuma compra parcelada em andamento.</p>'}
  </section>`;
}
