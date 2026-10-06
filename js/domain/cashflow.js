/**
 * Fluxo de caixa: saldo atual, projeção, "livre para gastar" e visão mensal.
 *
 * Ponto de partida: o saldo informado de cada conta (saldo + data do ajuste).
 * Tudo que aconteceu depois desse ajuste é somado; tudo que ainda vai acontecer
 * entra numa linha do tempo, em ordem de data, e gera o saldo projetado dia a dia.
 *
 * LIVRE PARA GASTAR HOJE = menor saldo projetado no horizonte − reserva mínima.
 * Um gasto feito hoje reduz todos os saldos futuros pelo mesmo valor; por isso o
 * valor que pode ser gasto sem deixar nenhum compromisso descoberto é exatamente
 * o ponto mais baixo da curva (e não o saldo do fim do mês, nem o saldo de hoje).
 */

import { monthKey, addMonthsKey, startOfMonth, endOfMonth, monthDiff } from '../core/dates.js';
import { soma, dividir } from '../core/money.js';
import { construirLivro } from './ledger.js';
import { ehCartao } from './schema.js';
import { calcularTermometro } from './thermometer.js';

/** O movimento já está refletido no saldo informado da conta? */
function posAjuste(conta, mov) {
  if (mov.data > conta.saldoEm) return true;
  if (mov.data < conta.saldoEm) return false;
  // Mesmo dia do ajuste: só conta se foi registrado depois do ajuste.
  return !!(mov.criadoEm && conta.saldoAjustadoEm && mov.criadoEm > conta.saldoAjustadoEm);
}

/**
 * Estimativa de gasto variável mensal usada nos meses futuros.
 * Manual (config.gastoVariavelMensal) ou média dos últimos 3 meses completos
 * registrados após o início do controle, considerando compras à vista sem vínculo com gasto fixo.
 */
export function estimativaVariavel(db, hoje) {
  const manual = db.config.gastoVariavelMensal;
  if (manual != null) return { valor: manual, origem: 'manual', meses: 0 };
  const mesAtual = monthKey(hoje);
  const meses = [];
  for (let i = 3; i >= 1; i--) {
    const k = addMonthsKey(mesAtual, -i);
    if (startOfMonth(k) >= db.config.dataInicio) meses.push(k);
  }
  if (!meses.length) return { valor: 0, origem: 'sem-historico', meses: 0 };
  const set = new Set(meses);
  const total = soma(db.lancamentos.filter((l) => !l.recorrenteId && (l.parcelas || 1) === 1 && set.has(monthKey(l.data))), (l) => l.valor);
  return { valor: Math.round(total / meses.length), origem: 'media', meses: meses.length };
}

/** Renda mensal recorrente (receitas anuais etc. convertidas para o mês). */
export function rendaMensal(db) {
  return Math.round(soma(db.receitas.filter((r) => r.ativa !== false && (r.intervaloMeses ?? 1) > 0), (r) => r.valor / (r.intervaloMeses || 1)));
}

/**
 * Análise completa. Todas as telas leem deste objeto; nenhuma tela faz conta financeira própria.
 */
export function analisar(db, hoje) {
  const cfg = db.config;
  const mesAtual = monthKey(hoje);
  const ultimoMes = addMonthsKey(mesAtual, cfg.horizonteMeses);
  const fim = endOfMonth(ultimoMes);
  const livro = construirLivro(db, hoje, fim);

  // ---- Saldo atual -------------------------------------------------------
  const contasAtivas = db.contas.filter((c) => c.ativa !== false);
  const idsAtivos = new Set(contasAtivas.map((c) => c.id));
  const contas = contasAtivas.map((c) => {
    const movs = livro.movConta.filter((m) => m.contaId === c.id && m.data <= hoje && posAjuste(c, m));
    return { ...c, saldoAtual: c.saldo + soma(movs, (m) => m.valor) };
  });
  const saldoAtual = soma(contas, (c) => c.saldoAtual);

  // ---- Linha do tempo futura ---------------------------------------------
  const estimativa = estimativaVariavel(db, hoje);
  const eventos = [];
  for (const m of livro.movConta) {
    if (m.data > hoje && m.data <= fim && idsAtivos.has(m.contaId)) eventos.push({ ...m, dataEfetiva: m.data, agendado: true });
  }
  for (const p of livro.pendencias) {
    eventos.push({ ...p, dataEfetiva: p.data < hoje ? hoje : p.data });
  }
  if (estimativa.valor > 0) {
    // A estimativa é distribuída em 4 partes (dias 7, 14, 21 e 28), imitando um gasto contínuo
    // ao longo do mês, em vez de um único débito no dia 1 que distorceria o ponto mínimo.
    const partes = dividir(estimativa.valor, 4);
    for (let k = addMonthsKey(mesAtual, 1); k <= ultimoMes; k = addMonthsKey(k, 1)) {
      [7, 14, 21, 28].forEach((dia, i) => {
        const data = `${k}-${String(dia).padStart(2, '0')}`;
        eventos.push({ id: `var@${k}#${i}`, tipo: 'variavelPrevisto', descricao: 'Gasto variável previsto', data, dataEfetiva: data, valor: -partes[i], competencia: k });
      });
    }
  }
  // Mesma data: saídas antes das entradas (visão conservadora).
  eventos.sort((a, b) => a.dataEfetiva.localeCompare(b.dataEfetiva) || a.valor - b.valor);

  let saldo = saldoAtual;
  let minimo = saldoAtual;
  let dataMinimo = hoje;
  for (const e of eventos) {
    saldo += e.valor;
    e.saldoApos = saldo;
    if (saldo < minimo) { minimo = saldo; dataMinimo = e.dataEfetiva; }
  }
  const reserva = cfg.reservaMinima || 0;
  const livre = minimo - reserva;

  // Próximo recebimento e folga até ele
  const proxReceita = eventos.find((e) => e.tipo === 'receita' && e.valor > 0);
  let minAteReceita = saldoAtual;
  if (proxReceita) {
    for (const e of eventos) {
      if (e.dataEfetiva >= proxReceita.dataEfetiva) break;
      minAteReceita = Math.min(minAteReceita, e.saldoApos);
    }
  } else {
    minAteReceita = minimo;
  }

  // ---- Cascata: do saldo atual ao saldo projetado no fim da janela --------
  const fimJanela = endOfMonth(addMonthsKey(mesAtual, cfg.mesesCascata ?? 1));
  const janela = eventos.filter((e) => e.dataEfetiva <= fimJanela);
  const cascata = {
    fimJanela,
    aReceber: soma(janela.filter((e) => e.valor > 0), (e) => e.valor),
    contasFixas: -soma(janela.filter((e) => e.tipo === 'fixo'), (e) => e.valor),
    cartao: -soma(janela.filter((e) => e.tipo === 'fatura'), (e) => e.valor + (e.parteParcelas || 0)),
    parcelas: soma(janela.filter((e) => e.tipo === 'fatura'), (e) => e.parteParcelas || 0)
      - soma(janela.filter((e) => e.tipo === 'parcela'), (e) => e.valor),
    outros: -soma(janela.filter((e) => e.valor < 0 && ['variavel', 'pagamentoFatura'].includes(e.tipo)), (e) => e.valor),
    variavelPrevisto: -soma(janela.filter((e) => e.tipo === 'variavelPrevisto'), (e) => e.valor),
  };
  cascata.saldoFinal = saldoAtual + cascata.aReceber - cascata.contasFixas - cascata.cartao - cascata.parcelas - cascata.outros - cascata.variavelPrevisto;

  // ---- Cartões -----------------------------------------------------------
  const cartoes = db.cartoes.map((c) => {
    const faturas = livro.faturas.filter((f) => f.cartaoId === c.id);
    const usado = soma(faturas, (f) => f.aberto);
    const atual = faturas.find((f) => f.status === 'aberta') || null;
    const proxima = faturas.find((f) => f.aberto > 0) || null;
    return { ...c, faturas, usado, disponivel: c.limite - usado, usoPct: c.limite > 0 ? usado / c.limite : 0, faturaAberta: atual, proximaAPagar: proxima };
  });

  // ---- Totais do horizonte -----------------------------------------------
  const compromissos = eventos.filter((e) => e.valor < 0 && e.tipo !== 'variavelPrevisto');
  const parcelamentos = resumirParcelamentos(db, livro, hoje);
  const totais = {
    aReceber: soma(eventos.filter((e) => e.valor > 0), (e) => e.valor),
    comprometido: -soma(compromissos, (e) => e.valor),
    cartaoComprometido: soma(cartoes, (c) => c.usado),
    parcelasFuturas: soma(parcelamentos, (p) => p.valorRestante),
  };

  const meses = projetarMeses({ db, livro, eventos, hoje, mesAtual, ultimoMes, saldoAtual, contas });

  const analise = {
    hoje, mesAtual, fim, livro, contas, saldoAtual, eventos, minimo, dataMinimo, reserva, livre,
    proxReceita, livreAteReceita: minAteReceita - reserva, estimativa, cascata, cartoes, totais,
    parcelamentos, meses, rendaMensal: rendaMensal(db),
  };
  analise.termometro = calcularTermometro(analise, cfg);
  return analise;
}

/**
 * Projeção mês a mês (regime de caixa: quando o dinheiro sai ou entra na conta).
 */
function projetarMeses({ db, livro, eventos, hoje, mesAtual, ultimoMes, saldoAtual, contas }) {
  const ultimoAjuste = contas.reduce((m, c) => (c.saldoEm > m ? c.saldoEm : m), '0000-00-00');
  const realizadosDoMes = livro.movConta.filter((m) => {
    const conta = contas.find((c) => c.id === m.contaId);
    return conta && m.data <= hoje && monthKey(m.data) === mesAtual && posAjuste(conta, m);
  });
  const out = [];
  let saldoInicio = saldoAtual - soma(realizadosDoMes, (m) => m.valor);
  for (let k = mesAtual; k <= ultimoMes; k = addMonthsKey(k, 1)) {
    const evs = eventos.filter((e) => monthKey(e.dataEfetiva) === k);
    const realizados = k === mesAtual ? realizadosDoMes : [];
    const todos = [...realizados, ...evs];
    const porTipo = (t) => -soma(todos.filter((e) => e.tipo === t && e.valor < 0), (e) => e.valor);
    const entradas = soma(todos.filter((e) => e.valor > 0), (e) => e.valor);
    const saidas = -soma(todos.filter((e) => e.valor < 0), (e) => e.valor);
    const saldoFim = saldoInicio + entradas - saidas;
    let menor = k === mesAtual ? saldoAtual : saldoInicio;
    for (const e of evs) menor = Math.min(menor, e.saldoApos);
    out.push({
      chave: k,
      saldoInicio,
      saldoInicioAproximado: k === mesAtual && ultimoAjuste > startOfMonth(k),
      entradas,
      saidas,
      fixos: porTipo('fixo'),
      faturas: porTipo('fatura') + porTipo('pagamentoFatura'),
      parcelas: porTipo('parcela'),
      variaveis: porTipo('variavel'),
      variavelPrevisto: porTipo('variavelPrevisto'),
      comprometido: -soma(evs.filter((e) => e.valor < 0 && e.tipo !== 'variavelPrevisto'), (e) => e.valor),
      saldoFim,
      menorSaldo: menor,
    });
    saldoInicio = saldoFim;
  }
  return out;
}

/** Situação de cada compra parcelada (cartão ou carnê/boleto). */
export function resumirParcelamentos(db, livro, hoje) {
  const out = [];
  for (const l of db.lancamentos) {
    const n = l.parcelas || 1;
    if (n <= 1) continue;
    let parcelas;
    if (ehCartao(l.forma)) {
      parcelas = livro.itensCartao.filter((i) => i.lancId === l.id).map((i) => {
        const f = livro.faturas.find((x) => x.cartaoId === i.cartaoId && x.chave === i.chave);
        const quitada = !f || f.status === 'paga' || f.status === 'anterior';
        return { i: i.parcela.i, valor: i.valor, vencimento: i.vencimento, chave: i.chave, paga: quitada };
      });
    } else {
      parcelas = livro.movConta.filter((m) => m.lancId === l.id).map((m) => ({
        i: m.parcela.i, valor: -m.valor, vencimento: m.data, chave: monthKey(m.data), paga: m.data <= hoje,
      }));
    }
    parcelas.sort((a, b) => a.i - b.i);
    const pagas = parcelas.filter((p) => p.paga).length;
    const restantes = parcelas.filter((p) => !p.paga);
    out.push({
      lancamento: l,
      parcelas,
      total: l.valor,
      valorParcela: parcelas[parcelas.length - 1]?.valor ?? 0,
      pagas,
      atual: Math.min(pagas + 1, n),
      restantes: restantes.length,
      valorRestante: soma(restantes, (p) => p.valor),
      ultimaChave: parcelas[parcelas.length - 1]?.chave,
      concluido: restantes.length === 0,
    });
  }
  return out.sort((a, b) => b.valorRestante - a.valorRestante);
}

/**
 * Detalhe de um mês: o que entra, o que sai e o que foi consumido.
 * Funciona para meses passados (com base nos registros) e futuros (com base na projeção).
 */
export function detalharMes(db, analise, chave) {
  const { livro, eventos } = analise;
  const noMes = (d) => monthKey(d) === chave;
  const projetado = analise.meses.find((m) => m.chave === chave) || null;

  const receitas = [
    ...livro.movConta.filter((m) => m.tipo === 'receita' && noMes(m.data)).map((m) => ({ ...m, status: 'recebido' })),
    ...eventos.filter((e) => e.tipo === 'receita' && noMes(e.data)).map((e) => ({ ...e, status: e.atrasado ? 'atrasado' : 'previsto' })),
  ];
  const fixos = [
    ...livro.movConta.filter((m) => m.tipo === 'fixo' && noMes(m.data)).map((m) => ({ ...m, valor: -m.valor, status: 'pago' })),
    ...eventos.filter((e) => e.tipo === 'fixo' && noMes(e.data)).map((e) => ({ ...e, valor: -e.valor, status: e.atrasado ? 'atrasado' : 'a pagar' })),
    ...livro.itensCartao.filter((i) => i.tipo === 'fixo' && noMes(i.data)).map((i) => ({ ...i, status: 'no cartão' })),
  ];
  const variaveis = [
    ...livro.movConta.filter((m) => m.tipo === 'variavel' && noMes(m.data)).map((m) => ({ ...m, valor: -m.valor, meio: 'conta' })),
    ...livro.itensCartao.filter((i) => i.tipo === 'variavel' && noMes(i.data)).map((i) => ({ ...i, meio: 'cartao' })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  const parcelas = [
    ...livro.itensCartao.filter((i) => i.parcela && noMes(i.vencimento)).map((i) => ({ ...i, meio: 'cartao' })),
    ...livro.movConta.filter((m) => m.tipo === 'parcela' && noMes(m.data)).map((m) => ({ ...m, valor: -m.valor, meio: 'conta', vencimento: m.data })),
  ];
  const faturas = livro.faturas.filter((f) => noMes(f.vencimento));

  return {
    chave, projetado, receitas, fixos, variaveis, parcelas, faturas,
    totais: {
      receitas: soma(receitas, (r) => r.valor),
      fixos: soma(fixos, (f) => f.valor),
      variaveis: soma(variaveis, (v) => v.valor),
      parcelas: soma(parcelas, (p) => p.valor),
      faturas: soma(faturas, (f) => f.total),
    },
    passado: chave < analise.mesAtual,
    distancia: monthDiff(analise.mesAtual, chave),
  };
}

/** Consumo por categoria num mês (pela data da compra, independente da forma de pagamento). */
export function gastosPorCategoria(db, analise, chave) {
  const { livro } = analise;
  // Compras parceladas entram pelo valor total no mês da compra (visão de consumo).
  const totalDaCompra = (x, valor) => (x.parcela ? (db.lancamentos.find((l) => l.id === x.lancId)?.valor ?? valor) : valor);
  const itens = [
    ...livro.movConta.filter((m) => ['variavel', 'fixo', 'parcela'].includes(m.tipo) && monthKey(m.data) === chave && (!m.parcela || m.parcela.i === 1))
      .map((m) => ({ cat: m.categoriaId, valor: totalDaCompra(m, -m.valor) })),
    ...livro.itensCartao.filter((i) => monthKey(i.data) === chave && (!i.parcela || i.parcela.i === 1)).map((i) => ({ cat: i.categoriaId, valor: totalDaCompra(i, i.valor) })),
  ];
  const mapa = new Map();
  for (const it of itens) mapa.set(it.cat || 'outros', (mapa.get(it.cat || 'outros') || 0) + it.valor);
  return [...mapa.entries()].map(([id, valor]) => ({ categoria: db.categorias.find((c) => c.id === id) || { id, nome: 'Sem categoria', cor: '#8a8f98' }, valor }))
    .sort((a, b) => b.valor - a.valor);
}

/** Gasto variável acumulado de um mês até determinado dia (para comparar meses). */
export function gastoAteDia(db, chave, dia) {
  return soma(db.lancamentos.filter((l) => !l.recorrenteId && monthKey(l.data) === chave && Number(l.data.slice(8)) <= dia), (l) => l.valor);
}
