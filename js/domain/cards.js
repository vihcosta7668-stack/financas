/**
 * Ciclo de fatura do cartão de crédito.
 *
 * Regra adotada (a mesma da maioria dos bancos brasileiros):
 *  - compra feita ANTES do dia de fechamento entra na fatura que fecha neste mês;
 *  - compra feita NO dia do fechamento ou depois entra na fatura seguinte
 *    (por isso o dia do fechamento costuma ser chamado de "melhor dia de compra");
 *  - o vencimento cai no mesmo mês do fechamento quando o dia de vencimento é maior
 *    que o de fechamento (fecha 5, vence 14) e no mês seguinte quando é menor
 *    (fecha 28, vence 7).
 *
 * Cada fatura é identificada pela CHAVE do mês de vencimento ("2026-11").
 */

import { parse, daysInMonth, normYM, dateInMonth, monthKey, addMonthsKey, keyToYM } from '../core/dates.js';

const pad = (n) => String(n).padStart(2, '0');

/** Mês (AAAA-MM) em que fecha a fatura que recebe uma compra feita em `data`. */
export function mesFechamento(cartao, data) {
  const { y, m, d } = parse(data);
  const diaFech = Math.min(cartao.fechamento, daysInMonth(y, m));
  const r = normYM(y, m + (d >= diaFech ? 1 : 0));
  return `${r.y}-${pad(r.m)}`;
}

/** Datas de fechamento e vencimento da fatura que fecha no mês `keyFech`. */
export function faturaDoFechamento(cartao, keyFech) {
  const { y, m } = keyToYM(keyFech);
  const fechamento = dateInMonth(y, m, cartao.fechamento);
  const offset = cartao.vencimento > cartao.fechamento ? 0 : 1;
  const vencimento = dateInMonth(y, m + offset, cartao.vencimento);
  return { chave: monthKey(vencimento), fechamento, vencimento };
}

/** Fatura onde cai a parcela `indice` (0 = primeira) de uma compra. */
export function faturaDaCompra(cartao, data, indice = 0) {
  return faturaDoFechamento(cartao, addMonthsKey(mesFechamento(cartao, data), indice));
}

/** Fatura identificada pela chave do mês de vencimento. */
export function faturaPorChave(cartao, chave) {
  const offset = cartao.vencimento > cartao.fechamento ? 0 : 1;
  return faturaDoFechamento(cartao, addMonthsKey(chave, -offset));
}

/** Fatura que está recebendo compras hoje (a próxima a fechar). */
export const faturaAtual = (cartao, hoje) => faturaDaCompra(cartao, hoje, 0);

/**
 * aberta  → ainda recebe compras;
 * fechada → já fechou, aguardando pagamento;
 * vencida → passou do vencimento com valor em aberto;
 * paga    → nada em aberto.
 */
export function statusFatura(fatura, hoje, aberto) {
  if (aberto <= 0) return 'paga';
  if (hoje > fatura.vencimento) return 'vencida';
  if (hoje >= fatura.fechamento) return 'fechada';
  return 'aberta';
}
