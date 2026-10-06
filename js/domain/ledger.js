/**
 * Livro de eventos.
 *
 * Transforma os cadastros (lançamentos, gastos fixos, receitas, pagamentos) em três listas
 * normalizadas, que são a única fonte usada pelos cálculos:
 *
 *  movConta    → dinheiro que entrou ou saiu de uma conta (ou vai sair numa data agendada);
 *  itensCartao → cobranças em cartão, já alocadas na fatura certa (uma por parcela);
 *  pendencias  → o que ainda vai acontecer e não foi confirmado:
 *                receitas a receber, gastos fixos a pagar e faturas em aberto.
 *
 * É aqui que se evita contar dinheiro duas vezes:
 *  - compra no cartão NUNCA gera movimento de conta; ela vira item de fatura, e só a
 *    fatura (ou o pagamento dela) afeta a conta;
 *  - um gasto fixo marcado como pago vira lançamento e deixa de ser pendência;
 *  - uma receita confirmada vira recebimento e deixa de ser "a receber".
 */

import { monthKey, keyToYM, dateInMonth, addMonthsKey, addMonthsDate } from '../core/dates.js';
import { dividir } from '../core/money.js';
import { ehCartao } from './schema.js';
import { faturaDaCompra, faturaPorChave, statusFatura } from './cards.js';

/**
 * Datas em que um item recorrente acontece entre `de` e `ate` (inclusive).
 * item: { dia, intervaloMeses (0 = única, 1 = mensal, 12 = anual...), inicio, fim?, data? }
 */
export function ocorrencias(item, de, ate) {
  const passo = item.intervaloMeses ?? 1;
  if (passo === 0) {
    const data = item.data || item.inicio;
    return data && data >= de && data <= ate ? [{ data, competencia: monthKey(data) }] : [];
  }
  const out = [];
  let k = monthKey(item.inicio);
  for (let guarda = 0; guarda < 1200; guarda++) {
    const { y, m } = keyToYM(k);
    const data = dateInMonth(y, m, item.dia);
    if (data > ate || (item.fim && data > item.fim)) break;
    if (data >= item.inicio && data >= de) out.push({ data, competencia: k });
    k = addMonthsKey(k, passo);
  }
  return out;
}

function tipoLancamento(l) {
  if (l.recorrenteId) return 'fixo';
  return (l.parcelas || 1) > 1 ? 'parcela' : 'variavel';
}

/**
 * @param {object} db   base completa
 * @param {string} hoje data de referência
 * @param {string} fim  último dia considerado na projeção
 */
export function construirLivro(db, hoje, fim) {
  const cfg = db.config;
  const inicio = cfg.dataInicio;
  const contaPadrao = (db.contas.find((c) => c.ativa !== false) || db.contas[0])?.id;
  const cartoes = Object.fromEntries(db.cartoes.map((c) => [c.id, c]));

  const movConta = [];
  const itensCartao = [];
  const pendencias = [];

  // 1. Lançamentos (gastos variáveis, parcelados e pagamentos de gastos fixos)
  for (const l of db.lancamentos) {
    const n = Math.max(1, l.parcelas || 1);
    const valores = dividir(l.valor, n);
    const tipo = tipoLancamento(l);
    const base = { lancId: l.id, descricao: l.descricao, categoriaId: l.categoriaId, tipo };

    if (ehCartao(l.forma)) {
      const cartao = cartoes[l.cartaoId];
      if (!cartao) continue;
      for (let i = 0; i < n; i++) {
        const fatura = l.faturaChave
          ? faturaPorChave(cartao, addMonthsKey(l.faturaChave, i))
          : faturaDaCompra(cartao, l.data, i);
        itensCartao.push({
          ...base,
          id: `${l.id}#${i}`,
          cartaoId: cartao.id,
          chave: fatura.chave,
          vencimento: fatura.vencimento,
          data: l.data,
          valor: valores[i],
          parcela: n > 1 ? { i: i + 1, n } : null,
        });
      }
    } else {
      for (let i = 0; i < n; i++) {
        movConta.push({
          ...base,
          id: `${l.id}#${i}`,
          contaId: l.contaId || contaPadrao,
          data: i === 0 ? l.data : addMonthsDate(l.data, i),
          valor: -valores[i],
          criadoEm: l.criadoEm,
          parcela: n > 1 ? { i: i + 1, n } : null,
        });
      }
    }
  }

  // 2. Gastos fixos: no cartão viram itens de fatura; na conta viram pendências até serem pagos
  const pagos = new Set(db.lancamentos.filter((l) => l.recorrenteId).map((l) => `${l.recorrenteId}|${l.competencia}`));
  for (const r of db.recorrentes) {
    if (r.ativo === false) continue;
    for (const oc of ocorrencias(r, inicio, fim)) {
      const base = { recId: r.id, competencia: oc.competencia, descricao: r.nome, categoriaId: r.categoriaId, tipo: 'fixo' };
      if (ehCartao(r.forma)) {
        const cartao = cartoes[r.cartaoId];
        if (!cartao) continue;
        const fatura = faturaDaCompra(cartao, oc.data, 0);
        itensCartao.push({ ...base, id: `${r.id}@${oc.competencia}`, cartaoId: cartao.id, chave: fatura.chave, vencimento: fatura.vencimento, data: oc.data, valor: r.valor, parcela: null });
      } else if (!pagos.has(`${r.id}|${oc.competencia}`)) {
        pendencias.push({ ...base, id: `${r.id}@${oc.competencia}`, data: oc.data, valor: -r.valor, contaId: r.contaId || contaPadrao, atrasado: oc.data < hoje });
      }
    }
  }

  // 3. Receitas ainda não confirmadas
  const recebidas = new Set(db.recebimentos.filter((x) => x.receitaId).map((x) => `${x.receitaId}|${x.competencia}`));
  for (const rc of db.receitas) {
    if (rc.ativa === false) continue;
    for (const oc of ocorrencias(rc, inicio, fim)) {
      if (recebidas.has(`${rc.id}|${oc.competencia}`)) continue;
      pendencias.push({
        id: `${rc.id}@${oc.competencia}`, receitaId: rc.id, competencia: oc.competencia, tipo: 'receita',
        descricao: rc.descricao, data: oc.data, valor: rc.valor, contaId: rc.contaId || contaPadrao, atrasado: oc.data < hoje,
      });
    }
  }

  // 4. Recebimentos, pagamentos de fatura e acertos já registrados
  for (const x of db.recebimentos) {
    movConta.push({ id: x.id, tipo: 'receita', descricao: x.descricao || 'Recebimento', data: x.data, valor: x.valor, contaId: x.contaId || contaPadrao, criadoEm: x.criadoEm, receitaId: x.receitaId });
  }
  for (const p of db.pagamentosFatura) {
    const cartao = cartoes[p.cartaoId];
    movConta.push({ id: p.id, tipo: 'pagamentoFatura', descricao: `Fatura ${cartao?.nome ?? ''}`.trim(), data: p.data, valor: -p.valor, contaId: p.contaId || contaPadrao, criadoEm: p.criadoEm, cartaoId: p.cartaoId, chave: p.chave });
  }
  for (const a of db.acertos) {
    if (!a.contaId) continue; // acerto sem conta (ex.: pago em dinheiro e não depositado) não mexe no saldo
    const pessoa = db.pessoas.find((p) => p.id === a.pessoaId);
    movConta.push({ id: a.id, tipo: 'acerto', descricao: `Acerto de ${pessoa?.nome ?? 'pessoa'}`, data: a.data, valor: a.valor, contaId: a.contaId, criadoEm: a.criadoEm, pessoaId: a.pessoaId });
  }

  // 5. Faturas: agrupa itens por cartão + mês de vencimento e desconta pagamentos
  const mapa = new Map();
  for (const it of itensCartao) {
    const k = `${it.cartaoId}|${it.chave}`;
    if (!mapa.has(k)) mapa.set(k, { cartaoId: it.cartaoId, chave: it.chave, itens: [] });
    mapa.get(k).itens.push(it);
  }
  for (const p of db.pagamentosFatura) {
    const k = `${p.cartaoId}|${p.chave}`;
    if (!mapa.has(k) && cartoes[p.cartaoId]) mapa.set(k, { cartaoId: p.cartaoId, chave: p.chave, itens: [] });
  }

  const faturas = [];
  for (const f of mapa.values()) {
    const cartao = cartoes[f.cartaoId];
    const datas = faturaPorChave(cartao, f.chave);
    const total = f.itens.reduce((s, i) => s + i.valor, 0);
    const totalParcelas = f.itens.filter((i) => i.parcela).reduce((s, i) => s + i.valor, 0);
    const pago = db.pagamentosFatura.filter((p) => p.cartaoId === f.cartaoId && p.chave === f.chave).reduce((s, p) => s + p.valor, 0);
    // Faturas que venceram antes do início do controle são tratadas como quitadas.
    const anterior = datas.vencimento < inicio;
    const aberto = anterior ? 0 : Math.max(0, total - pago);
    const fatura = {
      ...f, ...datas, total, totalParcelas, pago, aberto, anterior,
      status: anterior ? 'anterior' : statusFatura(datas, hoje, aberto),
    };
    // Faturas depois da que está aberta hoje ainda não começaram a receber compras novas.
    if (fatura.status === 'aberta' && f.chave > faturaDaCompra(cartao, hoje).chave) fatura.status = 'futura';
    faturas.push(fatura);
    // Só entram na linha do tempo as faturas dentro do horizonte; as seguintes continuam
    // ocupando o limite do cartão, mas seriam comparadas a receitas que não estão projetadas.
    if (aberto > 0 && datas.vencimento <= fim) {
      // Divide o valor em aberto entre compras parceladas e o restante, proporcionalmente.
      const parteParcelas = total > 0 ? Math.round(aberto * (totalParcelas / total)) : 0;
      pendencias.push({
        id: `fatura@${f.cartaoId}@${f.chave}`, tipo: 'fatura', descricao: `Fatura ${cartao.nome}`,
        cartaoId: f.cartaoId, chave: f.chave, data: datas.vencimento, valor: -aberto,
        parteParcelas, contaId: cartao.contaId || contaPadrao, atrasado: datas.vencimento < hoje,
      });
    }
  }
  faturas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  return { movConta, itensCartao, pendencias, faturas };
}
