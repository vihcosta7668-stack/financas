/**
 * Componentes visuais reutilizáveis. Gráficos em SVG puro, sem bibliotecas externas:
 * o aplicativo não carrega nenhum script de terceiros (ver docs/ARQUITETURA.md, Segurança).
 */

import { esc } from './dom.js';
import { fmt } from '../core/money.js';
import { diffDays, fmtCurta, nomeMes, monthKey, addMonthsKey, startOfMonth } from '../core/dates.js';

export const ESTADOS = {
  verde: { nome: 'Confortável', classe: 'verde' },
  amarelo: { nome: 'Atenção', classe: 'amarelo' },
  vermelho: { nome: 'Crítico', classe: 'vermelho' },
};

export function valor(cents, { classe = '' } = {}) {
  return `<span class="num ${cents < 0 ? 'neg' : ''} ${classe}">${esc(fmt(cents))}</span>`;
}

export function kpi({ rotulo, valor: v, sub = '', tom = '', acao = '' }) {
  const tag = acao ? 'button' : 'div';
  return `<${tag} class="kpi ${tom ? `kpi--${tom}` : ''}" ${acao}>
    <span class="kpi__rotulo">${esc(rotulo)}</span>
    <span class="kpi__valor num ${v < 0 ? 'neg' : ''}">${esc(fmt(v))}</span>
    ${sub ? `<span class="kpi__sub">${sub}</span>` : ''}
  </${tag}>`;
}

export function barra(parte, total, tom = '') {
  const pct = total > 0 ? Math.max(0, Math.min(100, (parte / total) * 100)) : 0;
  return `<div class="barra ${tom ? `barra--${tom}` : ''}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

export function vazio(texto, botao = '') {
  return `<div class="vazio"><p>${texto}</p>${botao}</div>`;
}

export function pilula(texto, tom = '') {
  return `<span class="pilula ${tom ? `pilula--${tom}` : ''}">${esc(texto)}</span>`;
}

export function pontoCor(cor) {
  return `<span class="ponto" style="background:${esc(cor || '#8a8f98')}"></span>`;
}

/** Termômetro vertical: faixas vermelho / amarelo / verde e coluna até o nível. */
export function termometro(t, { compacto = false } = {}) {
  const h = compacto ? 120 : 190;
  const topo = 10;
  const tubo = h - 40;
  const y = (n) => topo + tubo * (1 - n / 100);
  const nivelY = y(t.nivel);
  const w = 64;
  return `<svg class="termo termo--${t.estado}" viewBox="0 0 ${w} ${h}" width="${compacto ? 40 : 64}" height="${h}" role="img" aria-label="Termômetro financeiro: ${ESTADOS[t.estado].nome}">
    <rect class="termo__faixa termo__faixa--verde" x="24" y="${y(100)}" width="16" height="${y(66.5) - y(100)}"/>
    <rect class="termo__faixa termo__faixa--amarelo" x="24" y="${y(66.5)}" width="16" height="${y(33.5) - y(66.5)}"/>
    <rect class="termo__faixa termo__faixa--vermelho" x="24" y="${y(33.5)}" width="16" height="${y(0) - y(33.5)}"/>
    <rect class="termo__tubo" x="24" y="${topo - 4}" width="16" height="${tubo + 8}" rx="8"/>
    <rect class="termo__mercurio" x="28" y="${nivelY}" width="8" height="${y(0) - nivelY + 6}" rx="4"/>
    <circle class="termo__bulbo" cx="32" cy="${h - 18}" r="13"/>
    <line class="termo__marca" x1="42" x2="50" y1="${nivelY}" y2="${nivelY}"/>
  </svg>`;
}

/**
 * Saldo projetado dia a dia (gráfico em degraus).
 * Mostra linha do zero, reserva mínima e o ponto mais baixo.
 */
/** Largura lógica dos gráficos: menor no celular para o texto continuar legível. */
export const larguraGrafico = () => ((globalThis.innerWidth || 1000) < 600 ? 380 : 680);

export function graficoSaldo(a, { altura = 200 } = {}) {
  const W = larguraGrafico();
  const H = altura;
  const m = { t: 16, r: 16, b: 26, l: 16 };
  const pts = [{ d: a.hoje, s: a.saldoAtual }, ...a.eventos.map((e) => ({ d: e.dataEfetiva, s: e.saldoApos }))];
  const fimX = a.fim;
  const total = Math.max(1, diffDays(a.hoje, fimX));
  const vals = pts.map((p) => p.s).concat([0, a.reserva]);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max === min) max = min + 100;
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const x = (d) => m.l + ((W - m.l - m.r) * diffDays(a.hoje, d)) / total;
  const y = (v) => m.t + (H - m.t - m.b) * (1 - (v - min) / (max - min));

  let caminho = `M${x(pts[0].d).toFixed(1)},${y(pts[0].s).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    caminho += ` H${x(pts[i].d).toFixed(1)} V${y(pts[i].s).toFixed(1)}`;
  }
  caminho += ` H${x(fimX).toFixed(1)}`;
  const area = `${caminho} V${y(Math.max(min, Math.min(0, max))).toFixed(1)} H${x(a.hoje).toFixed(1)} Z`;

  const ticks = [];
  for (let k = addMonthsKey(monthKey(a.hoje), 1); startOfMonth(k) <= fimX; k = addMonthsKey(k, 1)) {
    const xx = x(startOfMonth(k));
    ticks.push(`<line class="graf__grade" x1="${xx}" x2="${xx}" y1="${m.t}" y2="${H - m.b}"/><text class="graf__eixo" x="${xx + 3}" y="${H - 8}">${esc(nomeMes(k, { curto: true }))}</text>`);
  }
  const yMin = y(a.minimo);
  const xMin = x(a.dataMinimo);
  const rotMin = `${fmt(a.minimo)} · ${fmtCurta(a.dataMinimo)}`;
  const ancora = xMin > W * 0.7 ? 'end' : 'start';
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo projetado até ${fmtCurta(fimX)}; ponto mais baixo ${esc(rotMin)}">
    ${ticks.join('')}
    <line class="graf__zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>
    ${a.reserva > 0 ? `<line class="graf__reserva" x1="${m.l}" x2="${W - m.r}" y1="${y(a.reserva)}" y2="${y(a.reserva)}"/><text class="graf__eixo" x="${W - m.r}" y="${y(a.reserva) - 4}" text-anchor="end">reserva</text>` : ''}
    <path class="graf__area ${a.minimo < 0 ? 'graf__area--neg' : ''}" d="${area}"/>
    <path class="graf__linha" d="${caminho}"/>
    <circle class="graf__min" cx="${xMin}" cy="${yMin}" r="4.5"/>
    <text class="graf__rotulo" x="${xMin + (ancora === 'end' ? -8 : 8)}" y="${yMin > H * 0.55 ? yMin - 10 : yMin + 18}" text-anchor="${ancora}">mínimo ${esc(rotMin)}</text>
    <text class="graf__eixo" x="${m.l}" y="${H - 8}">hoje</text>
  </svg>`;
}

const SERIES_MES = [
  ['fixos', 'Fixos'],
  ['faturas', 'Faturas'],
  ['parcelas', 'Parcelas (fora do cartão)'],
  ['variaveis', 'Variáveis'],
  ['variavelPrevisto', 'Variável previsto'],
];

/** Barras empilhadas de saídas por mês + marcador de entradas. */
export function graficoMeses(meses, { selecionado = null } = {}) {
  const W = larguraGrafico();
  const H = 220;
  const m = { t: 14, r: 8, b: 34, l: 8 };
  const max = Math.max(1, ...meses.map((x) => Math.max(x.saidas, x.entradas)));
  const bw = (W - m.l - m.r) / meses.length;
  const y = (v) => m.t + (H - m.t - m.b) * (1 - v / max);
  const barras = meses.map((mes, i) => {
    let acum = 0;
    const x0 = m.l + i * bw + bw * 0.18;
    const larg = bw * 0.64;
    const segs = SERIES_MES.map(([k], si) => {
      const v = mes[k];
      if (!v) return '';
      const y1 = y(acum + v);
      const r = `<rect class="graf__serie graf__serie--${si}" x="${x0}" y="${y1}" width="${larg}" height="${y(acum) - y1}"/>`;
      acum += v;
      return r;
    }).join('');
    const ent = mes.entradas ? `<line class="graf__entrada" x1="${x0 - 3}" x2="${x0 + larg + 3}" y1="${y(mes.entradas)}" y2="${y(mes.entradas)}"/>` : '';
    const sel = mes.chave === selecionado ? `<rect class="graf__sel" x="${m.l + i * bw + 1}" y="${m.t - 6}" width="${bw - 2}" height="${H - m.t - m.b + 10}" rx="6"/>` : '';
    return `<g class="graf__mes" data-acao="ir-mes" data-mes="${mes.chave}">${sel}<rect x="${m.l + i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>${segs}${ent}
      <text class="graf__eixo" x="${x0 + larg / 2}" y="${H - 18}" text-anchor="middle">${esc(nomeMes(mes.chave, { ano: false, curto: true }))}</text>
      ${W >= 600 ? `<text class="graf__eixo graf__eixo--sub ${mes.saldoFim < 0 ? 'neg' : ''}" x="${x0 + larg / 2}" y="${H - 5}" text-anchor="middle">${esc(compacto(mes.saldoFim))}</text>` : ''}</g>`;
  }).join('');
  const legenda = SERIES_MES.map(([, nome], si) => `<span><i class="leg leg--${si}"></i>${nome}</span>`).join('') + '<span><i class="leg leg--entrada"></i>Entradas</span>';
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas previstas por mês">${barras}</svg>
    <div class="legenda">${legenda}${W >= 600 ? '<span class="legenda__nota">valor abaixo do mês = saldo projetado no fim do mês</span>' : ''}</div>`;
}

/** 12.345 → "12,3 mil" para rótulos curtos. */
export function compacto(cents) {
  const v = cents / 100;
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (abs >= 1e4) return `${Math.round(v / 1e3)} mil`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1).replace('.', ',')} mil`;
  return `${Math.round(v)}`;
}

/** Barras horizontais por categoria. */
export function listaCategorias(itens, total) {
  if (!itens.length) return vazio('Nenhum gasto registrado neste mês.');
  return `<ul class="cats">${itens.map((it) => `<li>
      <div class="cats__linha">${pontoCor(it.categoria.cor)}<span>${esc(it.categoria.nome)}</span>${valor(it.valor)}</div>
      <div class="barra barra--fina"><span style="width:${((it.valor / Math.max(1, total)) * 100).toFixed(1)}%;background:${esc(it.categoria.cor)}"></span></div>
    </li>`).join('')}</ul>`;
}
