/**
 * Datas como texto ISO "AAAA-MM-DD" e meses como "AAAA-MM".
 *
 * Trabalhar com strings (e não com objetos Date) evita os erros clássicos de
 * fuso horário: uma data cadastrada como 01/10 nunca vira 30/09 por causa do UTC.
 * Todas as contas internas usam Date.UTC.
 */

const pad = (n) => String(n).padStart(2, '0');

export function parse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Normaliza ano/mês fora do intervalo (ex.: mês 13 → janeiro do ano seguinte). */
export function normYM(y, m) {
  const t = y * 12 + (m - 1);
  const ny = Math.floor(t / 12);
  return { y: ny, m: t - ny * 12 + 1 };
}

/** Data no mês informado; dia 31 em fevereiro vira o último dia de fevereiro. */
export function dateInMonth(y, m, day) {
  const n = normYM(y, m);
  return iso(n.y, n.m, Math.min(day, daysInMonth(n.y, n.m)));
}

export const monthKey = (date) => date.slice(0, 7);

export function keyToYM(key) {
  const [y, m] = key.split('-').map(Number);
  return { y, m };
}

export function addMonthsKey(key, n) {
  const { y, m } = keyToYM(key);
  const r = normYM(y, m + n);
  return `${r.y}-${pad(r.m)}`;
}

/** Soma meses a uma data mantendo o dia (ou usando `dia` quando informado). */
export function addMonthsDate(date, n, dia) {
  const { y, m, d } = parse(date);
  return dateInMonth(y, m + n, dia ?? d);
}

export function addDays(date, n) {
  const { y, m, d } = parse(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dias de `a` até `b` (positivo quando b é depois de a). */
export function diffDays(a, b) {
  const A = parse(a);
  const B = parse(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

export function monthDiff(ka, kb) {
  const a = keyToYM(ka);
  const b = keyToYM(kb);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export const startOfMonth = (key) => `${key}-01`;

export function endOfMonth(key) {
  const { y, m } = keyToYM(key);
  return iso(y, m, daysInMonth(y, m));
}

export function hojeLocal() {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function nomeMes(key, { ano = true, curto = false } = {}) {
  const { y, m } = keyToYM(key);
  const nome = curto ? MESES[m - 1].slice(0, 3) : MESES[m - 1];
  return ano ? `${nome} ${curto ? String(y).slice(2) : y}` : nome;
}

export function fmtData(date) {
  const { y, m, d } = parse(date);
  return `${pad(d)}/${pad(m)}/${y}`;
}

export function fmtCurta(date) {
  const { m, d } = parse(date);
  return `${pad(d)}/${pad(m)}`;
}
