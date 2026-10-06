// Testes do motor financeiro. Rodar com:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { dateInMonth, addMonthsKey } from '../js/core/dates.js';
import { parseValor, dividir } from '../js/core/money.js';
import { dbVazio } from '../js/domain/schema.js';
import { faturaDaCompra } from '../js/domain/cards.js';
import { analisar } from '../js/domain/cashflow.js';
import { simular } from '../js/domain/simulator.js';
import { resumoPessoas, divisaoPorPercentual } from '../js/domain/people.js';

const HOJE = '2026-10-06';
const R = (reais) => Math.round(reais * 100);

/** Cenário do enunciado: saldo 2.000, salário 4.500 dia 1, aluguel 1.200 dia 10, cartão fecha 5 / vence 14. */
function cenario() {
  const db = dbVazio(HOJE);
  db.config.horizonteMeses = 1;
  db.config.gastoVariavelMensal = 0;
  db.contas[0].saldo = R(2000);
  db.contas[0].saldoEm = HOJE;
  db.contas[0].saldoAjustadoEm = '2026-10-06T08:00:00.000Z';
  db.cartoes.push({ id: 'nubank', nome: 'Nubank', limite: R(5000), fechamento: 5, vencimento: 14, ativo: true });
  db.receitas.push({ id: 'salario', descricao: 'Salário', valor: R(4500), dia: 1, intervaloMeses: 1, inicio: '2026-01-01', ativa: true });
  db.recorrentes.push({ id: 'aluguel', nome: 'Aluguel', valor: R(1200), dia: 10, forma: 'pix', intervaloMeses: 1, inicio: '2026-01-01', ativo: true, categoriaId: 'moradia' });
  db.pessoas.push({ id: 'joao', nome: 'João' }, { id: 'maria', nome: 'Maria' });
  return db;
}

const compraCartao = (id, valor, parcelas = 1, data = HOJE) => ({ id, descricao: id, valor, data, forma: 'cartao', cartaoId: 'nubank', parcelas, categoriaId: 'compras', criadoEm: '2026-10-06T10:00:00.000Z' });

test('datas: fim de mês e virada de ano', () => {
  assert.equal(dateInMonth(2026, 2, 31), '2026-02-28');
  assert.equal(dateInMonth(2026, 13, 5), '2027-01-05');
  assert.equal(addMonthsKey('2026-12', 1), '2027-01');
  assert.equal(addMonthsKey('2026-01', -1), '2025-12');
});

test('dinheiro: leitura de valores digitados e divisão exata', () => {
  assert.equal(parseValor('1.234,56'), 123456);
  assert.equal(parseValor('R$ 35,9'), 3590);
  assert.equal(parseValor('50'), 5000);
  assert.ok(Number.isNaN(parseValor('abc')));
  const p = dividir(100000, 3);
  assert.equal(p.reduce((a, b) => a + b), 100000);
  assert.deepEqual(p, [33334, 33333, 33333]);
});

test('ciclo da fatura: antes do fechamento entra na atual, no dia ou depois vai para a próxima', () => {
  const c = { fechamento: 5, vencimento: 14 };
  assert.equal(faturaDaCompra(c, '2026-10-04').vencimento, '2026-10-14');
  assert.equal(faturaDaCompra(c, '2026-10-05').vencimento, '2026-11-14');
  assert.equal(faturaDaCompra(c, '2026-10-20').vencimento, '2026-11-14');
  assert.equal(faturaDaCompra(c, '2026-12-10').vencimento, '2027-01-14');
  // Vencimento menor que o fechamento → vence no mês seguinte ao fechamento
  const c2 = { fechamento: 28, vencimento: 7 };
  assert.equal(faturaDaCompra(c2, '2026-10-27').vencimento, '2026-11-07');
  assert.equal(faturaDaCompra(c2, '2026-10-29').vencimento, '2026-12-07');
  // Parcela 12 de uma compra de outubro
  assert.equal(faturaDaCompra(c, '2026-10-06', 11).chave, '2027-10');
});

test('cartão não desconta o saldo; Pix desconta na hora', () => {
  const db = cenario();
  db.lancamentos.push(compraCartao('roupa', R(900)));
  let a = analisar(db, HOJE);
  assert.equal(a.saldoAtual, R(2000));
  assert.equal(a.cartoes[0].usado, R(900));
  assert.equal(a.cartoes[0].disponivel, R(4100));

  db.lancamentos.push({ id: 'almoco', descricao: 'Almoço', valor: R(35), data: HOJE, forma: 'pix', criadoEm: '2026-10-06T12:00:00.000Z' });
  a = analisar(db, HOJE);
  assert.equal(a.saldoAtual, R(1965));
});

test('lançamento anterior ao ajuste de saldo não é descontado de novo', () => {
  const db = cenario();
  db.lancamentos.push({ id: 'cafe', descricao: 'Café', valor: R(10), data: HOJE, forma: 'pix', criadoEm: '2026-10-06T07:00:00.000Z' });
  db.lancamentos.push({ id: 'ontem', descricao: 'Ontem', valor: R(50), data: '2026-10-05', forma: 'debito', criadoEm: '2026-10-06T09:00:00.000Z' });
  assert.equal(analisar(db, HOJE).saldoAtual, R(2000));
});

test('livre para gastar = menor saldo projetado, sem contar nada duas vezes', () => {
  const db = cenario();
  db.lancamentos.push(compraCartao('roupa', R(900)));
  db.lancamentos.push(compraCartao('notebook', R(4800), 12));
  const a = analisar(db, HOJE);
  // 10/10 aluguel → 800 | 01/11 salário → 5.300 | 10/11 aluguel → 4.100 | 14/11 fatura (900 + 400) → 2.800
  assert.equal(a.minimo, R(800));
  assert.equal(a.dataMinimo, '2026-10-10');
  assert.equal(a.livre, R(800));
  assert.equal(a.livreAteReceita, R(800));

  const c = a.cascata;
  assert.equal(c.aReceber, R(4500));
  assert.equal(c.contasFixas, R(2400));
  assert.equal(c.cartao, R(900));
  assert.equal(c.parcelas, R(400));
  assert.equal(c.saldoFinal, R(2800));
  assert.equal(a.meses.at(-1).saldoFim, R(2800));

  // Parcelamento: 12 parcelas, nenhuma paga, 4.800 restantes
  const p = a.parcelamentos.find((x) => x.lancamento.id === 'notebook');
  assert.equal(p.parcelas.length, 12);
  assert.equal(p.restantes, 12);
  assert.equal(p.valorRestante, R(4800));
  assert.equal(p.ultimaChave, '2027-10');
  // Limite: a compra parcelada ocupa o valor total
  assert.equal(a.cartoes[0].disponivel, R(5000 - 900 - 4800));
});

test('reserva mínima reduz o livre para gastar', () => {
  const db = cenario();
  db.config.reservaMinima = R(300);
  assert.equal(analisar(db, HOJE).livre, R(2000 - 1200 - 300));
});

test('gasto fixo pago sai das pendências e desconta o saldo uma única vez', () => {
  const db = cenario();
  db.lancamentos.push({ id: 'pg', descricao: 'Aluguel', valor: R(1200), data: HOJE, forma: 'pix', recorrenteId: 'aluguel', competencia: '2026-10', criadoEm: '2026-10-06T12:00:00.000Z' });
  const a = analisar(db, HOJE);
  assert.equal(a.saldoAtual, R(800));
  assert.equal(a.eventos.filter((e) => e.tipo === 'fixo' && e.competencia === '2026-10').length, 0);
  assert.equal(a.minimo, R(800));
});

test('pagamento de fatura baixa a fatura e o saldo', () => {
  const db = cenario();
  db.lancamentos.push(compraCartao('mercado', R(300), 1, '2026-10-02')); // fatura de 14/10
  db.pagamentosFatura.push({ id: 'pf', cartaoId: 'nubank', chave: '2026-10', data: HOJE, valor: R(300), contaId: 'conta_principal', criadoEm: '2026-10-06T12:00:00.000Z' });
  const a = analisar(db, HOJE);
  assert.equal(a.saldoAtual, R(1700));
  assert.equal(a.livro.faturas.find((f) => f.chave === '2026-10').status, 'paga');
  assert.equal(a.cartoes[0].usado, 0);
});

test('fatura que venceu antes do início do controle é tratada como quitada', () => {
  const db = cenario();
  db.lancamentos.push(compraCartao('antiga', R(600), 3, '2026-08-20')); // faturas 09, 10, 11
  const a = analisar(db, HOJE);
  assert.equal(a.livro.faturas.find((f) => f.chave === '2026-09').aberto, 0);
  assert.equal(a.livro.faturas.find((f) => f.chave === '2026-10').aberto, R(200));
  const p = a.parcelamentos[0];
  assert.equal(p.pagas, 1);
  assert.equal(p.atual, 2);
  assert.equal(p.valorRestante, R(400));
});

test('estimativa de gasto variável entra nos meses futuros', () => {
  const db = cenario();
  db.config.gastoVariavelMensal = R(1000);
  const a = analisar(db, HOJE);
  // novembro: 800 + 4500 - 1000 (variável) - 1200 = 3100
  assert.equal(a.meses.at(-1).saldoFim, R(3100));
  assert.equal(a.cascata.variavelPrevisto, R(1000));
});

test('termômetro: vermelho quando os compromissos ultrapassam o dinheiro', () => {
  const db = cenario();
  db.contas[0].saldo = R(500);
  const a = analisar(db, HOJE);
  assert.equal(a.livre, R(-700));
  assert.equal(a.termometro.estado, 'vermelho');
  assert.ok(a.termometro.nivel <= 33);
});

test('termômetro: verde com folga e pouco comprometimento', () => {
  const db = cenario();
  db.contas[0].saldo = R(6000);
  const a = analisar(db, HOJE);
  assert.equal(a.termometro.estado, 'verde');
});

test('simulador: à vista reduz o saldo hoje; parcelado compromete meses futuros', () => {
  const db = cenario();
  const { resultados } = simular(db, HOJE, { descricao: 'Celular', valor: R(500) }, [
    { tipo: 'avista', forma: 'pix', contaId: 'conta_principal' },
    { tipo: 'cartao', cartaoId: 'nubank', parcelas: 5, valorTotal: R(550) },
  ]);
  const [avista, cartao] = resultados;
  assert.equal(avista.saldoHojeDepois, R(1500));
  assert.equal(avista.livreDepois, R(300));
  assert.equal(cartao.saldoHojeDepois, R(2000));
  assert.equal(cartao.parcelas.length, 5);
  assert.equal(cartao.parcelas[0].chave, '2026-11');
  assert.equal(cartao.juros, R(50));
  assert.equal(cartao.limite.suficiente, true);
  assert.equal(cartao.livreDepois, R(800)); // primeira parcela só em 14/11, após o salário
  // a base original não foi alterada
  assert.equal(db.lancamentos.length, 0);
});

test('pessoas: divisão por valor, acertos e saldo devedor', () => {
  const db = cenario();
  db.lancamentos.push({ id: 'conta', descricao: 'Conta de luz', valor: R(300), data: HOJE, forma: 'pix', criadoEm: '2026-10-06T12:00:00.000Z',
    divisao: [{ pessoaId: 'eu', valor: R(150) }, { pessoaId: 'joao', valor: R(100) }, { pessoaId: 'maria', valor: R(50) }] });
  db.acertos.push({ id: 'ac', pessoaId: 'joao', valor: R(40), data: HOJE, contaId: 'conta_principal', criadoEm: '2026-10-06T13:00:00.000Z' });
  const r = Object.fromEntries(resumoPessoas(db, HOJE).map((x) => [x.pessoa.id, x]));
  assert.equal(r.joao.devido, R(100));
  assert.equal(r.joao.falta, R(60));
  assert.equal(r.maria.falta, R(50));
  assert.equal(r.eu.devido, R(150));
  // O acerto com conta de destino entra no saldo
  assert.equal(analisar(db, HOJE).saldoAtual, R(2000 - 300 + 40));
});

test('pessoas: divisão por porcentagem soma exatamente o total', () => {
  const d = divisaoPorPercentual(R(100), [{ pessoaId: 'a', pct: 33.33 }, { pessoaId: 'b', pct: 33.33 }, { pessoaId: 'c', pct: 33.34 }]);
  assert.equal(d.reduce((s, x) => s + x.valor, 0), R(100));
});
