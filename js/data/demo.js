/**
 * Dados de exemplo (fictícios), gerados em relação à data de hoje para o painel sempre
 * parecer atual. Servem para conhecer o aplicativo e para testes visuais.
 */

import { dbVazio, novoId, agoraISO } from '../domain/schema.js';
import { monthKey, addMonthsKey, dateInMonth, keyToYM, startOfMonth } from '../core/dates.js';
import { construirLivro, ocorrencias } from '../domain/ledger.js';

const R = (v) => Math.round(v * 100);
const diaDoMes = (k, dia) => { const { y, m } = keyToYM(k); return dateInMonth(y, m, dia); };

export function dadosExemplo(hoje) {
  const db = dbVazio(hoje);
  const mesAtual = monthKey(hoje);
  const inicioK = addMonthsKey(mesAtual, -3);
  db.config.dataInicio = startOfMonth(inicioK);
  db.config.reservaMinima = R(300);

  db.contas = [{ id: 'conta_principal', nome: 'Conta corrente', saldo: R(4200), saldoEm: hoje, saldoAjustadoEm: agoraISO(), ativa: true }];
  db.cartoes = [
    { id: 'c_roxo', nome: 'Cartão Roxo', banco: 'Banco A', limite: R(9000), fechamento: 5, vencimento: 14, cor: '#7a5af0', contaId: 'conta_principal', ativo: true },
    { id: 'c_laranja', nome: 'Cartão Laranja', banco: 'Banco B', limite: R(2500), fechamento: 28, vencimento: 7, cor: '#e07a3f', contaId: 'conta_principal', ativo: true },
  ];
  db.pessoas.push({ id: 'p_joao', nome: 'João' }, { id: 'p_maria', nome: 'Maria' });
  db.receitas = [
    { id: 'rc_salario', descricao: 'Salário', valor: R(4500), dia: 1, intervaloMeses: 1, inicio: startOfMonth(inicioK), contaId: 'conta_principal', ativa: true },
  ];
  db.recorrentes = [
    { id: 'r_aluguel', nome: 'Aluguel', valor: R(1200), dia: 10, forma: 'pix', contaId: 'conta_principal', categoriaId: 'moradia', intervaloMeses: 1, inicio: startOfMonth(inicioK), ativo: true,
      divisao: [{ pessoaId: 'eu', valor: R(600) }, { pessoaId: 'p_joao', valor: R(600) }] },
    { id: 'r_energia', nome: 'Energia', valor: R(180), dia: 15, forma: 'boleto', contaId: 'conta_principal', categoriaId: 'moradia', intervaloMeses: 1, inicio: startOfMonth(inicioK), ativo: true },
    { id: 'r_internet', nome: 'Internet', valor: R(110), dia: 20, forma: 'cartao', cartaoId: 'c_roxo', categoriaId: 'moradia', intervaloMeses: 1, inicio: startOfMonth(inicioK), ativo: true },
    { id: 'r_academia', nome: 'Academia', valor: R(95), dia: 6, forma: 'cartao', cartaoId: 'c_laranja', categoriaId: 'saude', intervaloMeses: 1, inicio: startOfMonth(inicioK), ativo: true },
    { id: 'r_streaming', nome: 'Streaming', valor: R(45), dia: 12, forma: 'cartao', cartaoId: 'c_roxo', categoriaId: 'assinaturas', intervaloMeses: 1, inicio: startOfMonth(inicioK), ativo: true },
  ];

  // Gastos variáveis: mesmo padrão em cada mês, até hoje
  const modelo = [
    [2, 'Mercado', 320, 'alimentacao', 'c_roxo'], [4, 'Almoço', 35, 'alimentacao', 'pix'], [7, 'Combustível', 200, 'transporte', 'c_laranja'],
    [9, 'Farmácia', 80, 'saude', 'debito'], [13, 'Mercado', 260, 'alimentacao', 'c_roxo'], [16, 'Cinema', 60, 'lazer', 'c_roxo'],
    [18, 'Almoço', 42, 'alimentacao', 'pix'], [21, 'Combustível', 180, 'transporte', 'c_laranja'], [24, 'Roupa', 150, 'compras', 'c_roxo'],
    [27, 'Pizza', 75, 'alimentacao', 'pix'],
  ];
  for (let k = inicioK; k <= mesAtual; k = addMonthsKey(k, 1)) {
    const { y, m } = keyToYM(k);
    for (const [dia, desc, v, cat, meio] of modelo) {
      const data = dateInMonth(y, m, dia);
      if (data > hoje) continue;
      const cartao = meio.startsWith('c_');
      db.lancamentos.push({ id: novoId('l'), descricao: desc, valor: R(v), data, categoriaId: cat, parcelas: 1, forma: cartao ? 'cartao' : meio, cartaoId: cartao ? meio : null, contaId: cartao ? null : 'conta_principal', criadoEm: `${data}T12:00:00.000Z` });
    }
  }
  // Compras parceladas
  const dataNote = diaDoMes(addMonthsKey(mesAtual, -2), 18);
  db.lancamentos.push({ id: novoId('l'), descricao: 'Notebook', valor: R(4800), data: dataNote, categoriaId: 'educacao', parcelas: 12, forma: 'cartao', cartaoId: 'c_roxo', criadoEm: `${dataNote}T12:00:00.000Z` });
  const dataGel = diaDoMes(addMonthsKey(mesAtual, -1), 8);
  db.lancamentos.push({ id: novoId('l'), descricao: 'Geladeira', valor: R(2400), data: dataGel, categoriaId: 'moradia', parcelas: 8, forma: 'boleto', contaId: 'conta_principal', criadoEm: `${dataGel}T12:00:00.000Z` });
  const dataJantar = diaDoMes(mesAtual, 1);
  if (dataJantar <= hoje) {
    db.lancamentos.push({ id: novoId('l'), descricao: 'Jantar de aniversário', valor: R(300), data: dataJantar, categoriaId: 'lazer', parcelas: 1, forma: 'cartao', cartaoId: 'c_roxo', criadoEm: `${dataJantar}T12:00:00.000Z`,
      divisao: [{ pessoaId: 'eu', valor: R(150) }, { pessoaId: 'p_joao', valor: R(100) }, { pessoaId: 'p_maria', valor: R(50) }] });
  }

  // Histórico: o que venceu antes de hoje foi pago/recebido
  for (const rc of db.receitas) {
    for (const oc of ocorrencias(rc, db.config.dataInicio, hoje)) {
      if (oc.data >= hoje) continue;
      db.recebimentos.push({ id: novoId('rb'), receitaId: rc.id, competencia: oc.competencia, descricao: rc.descricao, data: oc.data, valor: rc.valor, contaId: 'conta_principal', criadoEm: `${oc.data}T09:00:00.000Z` });
    }
  }
  for (const r of db.recorrentes.filter((x) => x.forma !== 'cartao')) {
    for (const oc of ocorrencias(r, db.config.dataInicio, hoje)) {
      if (oc.data >= hoje) continue;
      db.lancamentos.push({ id: novoId('l'), descricao: r.nome, valor: r.valor, data: oc.data, categoriaId: r.categoriaId, parcelas: 1, forma: r.forma, contaId: r.contaId, recorrenteId: r.id, competencia: oc.competencia, divisao: r.divisao || null, criadoEm: `${oc.data}T10:00:00.000Z` });
    }
  }
  const livro = construirLivro(db, hoje, hoje);
  for (const f of livro.faturas) {
    if (f.vencimento < hoje && f.total > 0) {
      db.pagamentosFatura.push({ id: novoId('pf'), cartaoId: f.cartaoId, chave: f.chave, data: f.vencimento, valor: f.total, contaId: 'conta_principal', criadoEm: `${f.vencimento}T10:00:00.000Z` });
    }
  }
  db.acertos.push({ id: novoId('ac'), pessoaId: 'p_joao', valor: R(600), data: diaDoMes(addMonthsKey(mesAtual, -1), 11), contaId: 'conta_principal', obs: 'aluguel', criadoEm: agoraISO() });
  return db;
}
