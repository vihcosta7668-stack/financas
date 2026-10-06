/**
 * Termômetro financeiro.
 *
 * Combina dois indicadores e assume o pior estado entre eles:
 *
 * 1) FOLGA = livre para gastar hoje ÷ renda mensal recorrente.
 *    Mede quanto sobra depois de garantir TODOS os compromissos projetados no horizonte.
 *      livre < 0                 → vermelho (algum compromisso fica descoberto)
 *      folga < limiar (10%)      → amarelo
 *
 * 2) COMPROMETIMENTO = compromissos dos próximos 90 dias ÷ receitas dos próximos 90 dias.
 *    Mede quanto do dinheiro que ainda vai entrar já tem destino (fixos, faturas, parcelas).
 *    Não inclui a estimativa de gasto variável.
 *      ≥ 90% → vermelho    ≥ 70% → amarelo
 *
 * O ponteiro (0–100) fica sempre dentro da faixa do estado: vermelho 0–33, amarelo 34–66,
 * verde 67–100; a posição dentro da faixa vem da folga.
 */

import { addDays } from '../core/dates.js';
import { soma, fmt } from '../core/money.js';

const pct = (x) => `${Math.round(x * 100)}%`;

export function calcularTermometro(a, cfg) {
  const L = cfg.limiares;
  const limite90 = addDays(a.hoje, 90);
  const prox = a.eventos.filter((e) => e.dataEfetiva <= limite90);
  const obrig = -soma(prox.filter((e) => e.valor < 0 && e.tipo !== 'variavelPrevisto'), (e) => e.valor);
  const receb = soma(prox.filter((e) => e.valor > 0), (e) => e.valor);
  const comprometimento = receb > 0 ? obrig / receb : (obrig > 0 ? Infinity : 0);
  const folga = a.rendaMensal > 0 ? a.livre / a.rendaMensal : null;

  const motivos = [];
  let estado = 'verde';
  const piorar = (novo) => {
    const ordem = { verde: 0, amarelo: 1, vermelho: 2 };
    if (ordem[novo] > ordem[estado]) estado = novo;
  };

  if (a.livre < 0) {
    piorar('vermelho');
    motivos.push(`Faltam ${fmt(-a.livre)} para cobrir os compromissos projetados (ponto mais baixo em ${a.dataMinimo.split('-').reverse().join('/')}).`);
  } else if (folga !== null && folga < L.folgaAmarelo) {
    piorar('amarelo');
    motivos.push(`O livre para gastar (${fmt(a.livre)}) é menos de ${pct(L.folgaAmarelo)} da sua renda mensal.`);
  }

  if (comprometimento >= L.comprometimentoVermelho) {
    piorar('vermelho');
    motivos.push(receb > 0
      ? `${pct(comprometimento)} do que você vai receber nos próximos 90 dias já está comprometido.`
      : 'Há compromissos nos próximos 90 dias e nenhuma receita prevista.');
  } else if (comprometimento >= L.comprometimentoAmarelo) {
    piorar('amarelo');
    motivos.push(`${pct(comprometimento)} do que você vai receber nos próximos 90 dias já está comprometido.`);
  }

  if (!motivos.length) {
    motivos.push(folga !== null
      ? `Sobra ${pct(Math.max(0, folga))} de uma renda mensal depois de todos os compromissos projetados.`
      : 'Todos os compromissos projetados estão cobertos.');
  }

  // Ponteiro: posição dentro da faixa do estado conforme a folga (-10% a +40% da renda)
  const f = folga ?? (a.livre >= 0 ? 0.25 : -0.1);
  const t = Math.max(0, Math.min(1, (f + 0.1) / 0.5));
  const faixa = { vermelho: [2, 31], amarelo: [36, 64], verde: [69, 98] }[estado];
  const nivel = Math.round(faixa[0] + (faixa[1] - faixa[0]) * t);

  return { estado, nivel, folga, comprometimento: Number.isFinite(comprometimento) ? comprometimento : null, obrigacoes90: obrig, receitas90: receb, motivos };
}
