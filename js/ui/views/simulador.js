/** Simulador de compra: compara formas de pagamento usando o mesmo cálculo do painel. */

import { esc } from '../dom.js';
import { fmt, fmtSinal, parseValor, paraCampo } from '../../core/money.js';
import { nomeMes, fmtCurta } from '../../core/dates.js';
import { termometro, ESTADOS, pilula, compacto, larguraGrafico } from '../components.js';
import { simular } from '../../domain/simulator.js';

const CORES = ['#8a8f98', '#1f6f5c', '#c46a1b', '#3f6fd0', '#9b4fb0'];

export function render(ctx) {
  const { db, ui, hoje } = ctx;
  const s = ui.simulacao || { descricao: '', valor: null, avista: true, cartao1: { ativo: db.cartoes.length > 0, parcelas: 1 }, cartao2: { ativo: db.cartoes.length > 0, parcelas: 10 }, carne: { ativo: false, parcelas: 10 } };
  const cartoes = db.cartoes.filter((c) => c.ativo !== false);
  const optCartoes = (sel) => cartoes.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const linhaCartao = (k, rotulo) => `<div class="sim__opcao">
      <label class="check"><input type="checkbox" name="${k}_ativo" ${s[k].ativo && cartoes.length ? 'checked' : ''} ${cartoes.length ? '' : 'disabled'}><span>${rotulo}</span></label>
      <select name="${k}_cartao" aria-label="Cartão">${optCartoes(s[k].cartaoId)}</select>
      <label class="inline">em <input type="number" name="${k}_parcelas" min="1" max="48" value="${s[k].parcelas || 1}">x</label>
      <label class="inline">total <input name="${k}_total" inputmode="decimal" placeholder="mesmo valor" value="${esc(paraCampo(s[k].total))}"></label>
    </div>`;

  let resultado = '';
  if (s.valor > 0) {
    const opcoes = montarOpcoes(db, s);
    if (opcoes.length) resultado = resultados(simular(db, hoje, { descricao: s.descricao, valor: s.valor }, opcoes), s);
  }

  return `
  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>O que você quer comprar?</h2></header>
    <form class="sim" data-form="simular">
      <div class="grade2">
        <label class="campo"><span class="campo__rotulo">Produto</span><input name="descricao" value="${esc(s.descricao)}" placeholder="Ex.: celular"></label>
        <label class="campo"><span class="campo__rotulo">Preço à vista</span><input name="valor" inputmode="decimal" placeholder="0,00" value="${esc(paraCampo(s.valor))}" required></label>
      </div>
      <fieldset class="bloco">
        <legend>Formas de pagamento para comparar</legend>
        <div class="sim__opcao"><label class="check"><input type="checkbox" name="avista" ${s.avista ? 'checked' : ''}><span>À vista (Pix/débito)</span></label></div>
        ${linhaCartao('cartao1', 'Cartão')}
        ${linhaCartao('cartao2', 'Cartão (outra condição)')}
        <div class="sim__opcao">
          <label class="check"><input type="checkbox" name="carne_ativo" ${s.carne.ativo ? 'checked' : ''}><span>Carnê / boleto</span></label>
          <label class="inline">em <input type="number" name="carne_parcelas" min="1" max="48" value="${s.carne.parcelas || 1}">x</label>
          <label class="inline">total <input name="carne_total" inputmode="decimal" placeholder="mesmo valor" value="${esc(paraCampo(s.carne.total))}"></label>
        </div>
        ${cartoes.length ? '' : '<p class="campo__dica">Cadastre um cartão para simular compras no crédito.</p>'}
        <p class="campo__dica">Se o parcelado tiver juros, informe o total que você pagaria; a diferença aparece no resultado.</p>
      </fieldset>
      <button class="btn btn--pri" type="submit">Simular</button>
    </form>
  </section>
  ${resultado}`;
}

/** Converte o estado da tela nas opções aceitas pelo simulador. */
export function montarOpcoes(db, s) {
  const cartoes = db.cartoes.filter((c) => c.ativo !== false);
  const opcoes = [];
  if (s.avista) opcoes.push({ tipo: 'avista', forma: 'pix', contaId: db.contas[0]?.id });
  for (const k of ['cartao1', 'cartao2']) if (s[k].ativo && cartoes.length) opcoes.push({ tipo: 'cartao', cartaoId: s[k].cartaoId || cartoes[0].id, parcelas: s[k].parcelas || 1, valorTotal: s[k].total || undefined });
  if (s.carne.ativo) opcoes.push({ tipo: 'carne', parcelas: s.carne.parcelas || 1, valorTotal: s.carne.total || undefined, contaId: db.contas[0]?.id });
  return opcoes;
}

/** Lê o formulário do simulador para o estado da tela. */
export function lerSimulacao(form) {
  const f = (n) => form.elements[n];
  const num = (n) => Math.max(1, Number(f(n)?.value) || 1);
  const tot = (n) => { const v = parseValor(f(n)?.value); return v > 0 ? v : null; };
  return {
    descricao: f('descricao').value.trim(),
    valor: parseValor(f('valor').value),
    avista: f('avista').checked,
    cartao1: { ativo: !!f('cartao1_ativo')?.checked, cartaoId: f('cartao1_cartao')?.value, parcelas: num('cartao1_parcelas'), total: tot('cartao1_total') },
    cartao2: { ativo: !!f('cartao2_ativo')?.checked, cartaoId: f('cartao2_cartao')?.value, parcelas: num('cartao2_parcelas'), total: tot('cartao2_total') },
    carne: { ativo: f('carne_ativo').checked, parcelas: num('carne_parcelas'), total: tot('carne_total') },
  };
}

function resultados(sim, s) {
  const { base, resultados: rs, melhor } = sim;
  return `
  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Impacto de comprar ${esc(s.descricao || 'isto')} por ${fmt(s.valor)}</h2></header>
    <p class="texto-sec">Hoje, sem a compra: livre para gastar ${fmt(base.livre)} · termômetro ${ESTADOS[base.termometro.estado].nome.toLowerCase()}.</p>
    ${melhor ? `<p class="destaque">Entre as opções viáveis, <strong>${esc(melhor.rotulo)}</strong> é a que preserva o maior livre para gastar (${fmt(melhor.livreDepois)}).</p>` : '<p class="destaque destaque--ruim">Nenhuma das opções cabe nos compromissos projetados sem deixar alguma conta descoberta.</p>'}
    <div class="sim__resultados">
      ${rs.map((r, i) => `<article class="sim__card ${r.viavel ? '' : 'sim__card--inviavel'}">
        <header>
          <i class="leg" style="background:${CORES[(i + 1) % CORES.length]}"></i>
          <h3>${esc(r.rotulo)}</h3>
          ${r.viavel ? pilula('cabe', 'verde') : pilula('não cabe', 'vermelho')}
        </header>
        <div class="sim__numeros">
          <div><span class="texto-sec">Saldo hoje</span><strong class="num">${fmt(r.saldoHojeDepois)}</strong></div>
          <div><span class="texto-sec">Livre para gastar</span><strong class="num ${r.livreDepois < 0 ? 'neg' : ''}">${fmt(r.livreDepois)}</strong><small class="num">${fmtSinal(r.livreDepois - r.livreAntes)}</small></div>
          <div class="sim__termo">${termometro(r.termometro, { compacto: true })}<span class="estado estado--${r.termometro.estado}">${ESTADOS[r.termometro.estado].nome}</span></div>
        </div>
        <ul class="sim__texto">${r.narrativa.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        ${r.parcelas.length > 1 ? `<div class="parcelados__meses">${r.parcelas.map((p) => `<span title="${fmtCurta(p.vencimento)} · ${fmt(p.valor)}">${esc(nomeMes(p.chave, { ano: false, curto: true }))}</span>`).join('')}</div>` : ''}
        <button class="btn btn--sec" data-acao="registrar-simulacao" data-i="${i}">Registrar esta compra</button>
      </article>`).join('')}
    </div>
  </section>
  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Saldo no fim de cada mês</h2></header>
    ${graficoComparativo(rs)}
  </section>`;
}

function graficoComparativo(rs) {
  const W = larguraGrafico(); const H = 220; const m = { t: 14, r: 12, b: 28, l: 52 };
  const meses = rs[0].meses.map((x) => x.chave);
  const series = [{ nome: 'Sem a compra', v: rs[0].meses.map((x) => x.saldoFimAntes) }, ...rs.map((r) => ({ nome: r.rotulo, v: r.meses.map((x) => x.saldoFimDepois) }))];
  const todos = series.flatMap((s) => s.v).concat([0]);
  let min = Math.min(...todos); let max = Math.max(...todos);
  if (max === min) max = min + 100;
  const x = (i) => m.l + ((W - m.l - m.r) * i) / Math.max(1, meses.length - 1);
  const y = (v) => m.t + (H - m.t - m.b) * (1 - (v - min) / (max - min));
  const linhas = series.map((s, si) => `<polyline fill="none" stroke="${CORES[si % CORES.length]}" stroke-width="${si === 0 ? 1.5 : 2.2}" ${si === 0 ? 'stroke-dasharray="4 4"' : ''} points="${s.v.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  const eixoX = meses.map((k, i) => `<text class="graf__eixo" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(nomeMes(k, { ano: false, curto: true }))}</text>`).join('');
  const eixoY = [min, 0, max].filter((v, i, arr) => arr.indexOf(v) === i).map((v) => `<text class="graf__eixo" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(compacto(v))}</text>`).join('');
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo projetado no fim de cada mês para cada opção">
    <line class="graf__zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>${eixoY}${eixoX}${linhas}</svg>
    <div class="legenda">${series.map((s, si) => `<span><i class="leg" style="background:${CORES[si % CORES.length]}"></i>${esc(s.nome)}</span>`).join('')}</div>`;
}
