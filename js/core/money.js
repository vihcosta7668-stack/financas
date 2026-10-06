/**
 * Dinheiro é sempre guardado em CENTAVOS inteiros.
 * Somar 0,1 + 0,2 em ponto flutuante dá 0,30000000000000004; em centavos dá 30.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmt(cents) {
  return BRL.format((cents || 0) / 100);
}

/** Valor com sinal explícito: +R$ 10,00 / -R$ 10,00. */
export function fmtSinal(cents) {
  return (cents > 0 ? '+' : '') + fmt(cents);
}

/**
 * Converte texto digitado ("1.234,56", "50", "R$ 35,9") ou número (em reais) para centavos.
 * Retorna NaN quando não for possível interpretar.
 */
export function parseValor(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input ?? '').trim().replace(/R\$|\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const f = Number(s);
  return Number.isFinite(f) ? Math.round(f * 100) : NaN;
}

/** Centavos → texto para preencher um campo de formulário ("1234,56"). */
export function paraCampo(cents) {
  if (cents == null || Number.isNaN(cents)) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Divide um total em n parcelas que somam exatamente o total.
 * A diferença de centavos fica na primeira parcela, como fazem as operadoras.
 */
export function dividir(total, n) {
  const base = Math.floor(total / n);
  const resto = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? resto : 0));
}

export function soma(lista, f = (x) => x) {
  let t = 0;
  for (const x of lista) t += f(x) || 0;
  return t;
}
