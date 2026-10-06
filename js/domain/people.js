/**
 * Divisão de despesas entre pessoas.
 *
 * Todo lançamento do aplicativo é pago com uma conta ou cartão SEU. Quando parte dele
 * pertence a outra pessoa, essa parte vira um valor que ela deve a você.
 *
 *  - `divisao: [{ pessoaId, valor }]` define quanto cabe a cada um (soma = valor total);
 *  - sem divisão, a despesa é 100% do `responsavelId` (padrão: você);
 *  - pagamentos das pessoas são registrados em `acertos` e abatem a dívida.
 *
 * O que os outros devem NÃO entra no "livre para gastar" até o acerto ser registrado
 * (com conta de destino), porque não há garantia de quando o dinheiro volta.
 */

import { soma, dividir } from '../core/money.js';
import { ocorrencias } from './ledger.js';

/** Partes de uma despesa por pessoa. */
export function partes(item, valor, idEu) {
  if (item.divisao?.length) return item.divisao.filter((d) => d.valor > 0);
  return [{ pessoaId: item.responsavelId || idEu, valor }];
}

/** Converte percentuais em valores que somam exatamente o total. */
export function divisaoPorPercentual(total, linhas) {
  const somaPct = soma(linhas, (l) => l.pct);
  if (!somaPct) return [];
  const valores = linhas.map((l) => Math.floor((total * l.pct) / somaPct));
  let resto = total - soma(valores);
  for (let i = 0; resto > 0; i = (i + 1) % valores.length, resto--) valores[i] += 1;
  return linhas.map((l, i) => ({ pessoaId: l.pessoaId, valor: valores[i], pct: l.pct }));
}

/** Divide igualmente entre as pessoas informadas. */
export function divisaoIgual(total, pessoaIds) {
  const v = dividir(total, pessoaIds.length);
  return pessoaIds.map((pessoaId, i) => ({ pessoaId, valor: v[i] }));
}

export function resumoPessoas(db, hoje) {
  const eu = db.pessoas.find((p) => p.eu)?.id;
  const despesas = []; // { pessoaId, valor, descricao, data, origem }

  for (const l of db.lancamentos) {
    if (l.data > hoje) continue;
    for (const p of partes(l, l.valor, eu)) despesas.push({ pessoaId: p.pessoaId, valor: p.valor, descricao: l.descricao, data: l.data, total: l.valor, origemId: l.id, origem: 'lancamento' });
  }
  for (const r of db.recorrentes) {
    if (r.ativo === false) continue;
    if (!r.divisao?.length && (!r.responsavelId || r.responsavelId === eu)) continue;
    for (const oc of ocorrencias(r, db.config.dataInicio, hoje)) {
      // Se o gasto fixo foi pago com um lançamento, a divisão já veio do lançamento.
      if (db.lancamentos.some((l) => l.recorrenteId === r.id && l.competencia === oc.competencia)) continue;
      for (const p of partes(r, r.valor, eu)) despesas.push({ pessoaId: p.pessoaId, valor: p.valor, descricao: r.nome, data: oc.data, total: r.valor, origemId: r.id, origem: 'recorrente' });
    }
  }

  return db.pessoas.map((pessoa) => {
    const minhas = despesas.filter((d) => d.pessoaId === pessoa.id).sort((a, b) => b.data.localeCompare(a.data));
    const acertos = db.acertos.filter((a) => a.pessoaId === pessoa.id).sort((a, b) => b.data.localeCompare(a.data));
    const devido = soma(minhas, (d) => d.valor);
    const pago = pessoa.eu ? 0 : soma(acertos, (a) => a.valor);
    return { pessoa, despesas: minhas, acertos, devido, pago, falta: pessoa.eu ? 0 : devido - pago };
  });
}
