/**
 * Simulador de compra.
 *
 * Em vez de uma regra própria, o simulador acrescenta a compra hipotética a uma CÓPIA da base
 * e roda exatamente o mesmo cálculo do painel. Assim, o resultado da simulação é idêntico ao
 * que o painel mostraria se a compra fosse registrada.
 *
 * Opções suportadas:
 *  { tipo: 'avista', forma: 'pix'|'debito'|..., contaId }
 *  { tipo: 'cartao', cartaoId, parcelas, valorTotal? }   (valorTotal > valor quando há juros)
 *  { tipo: 'carne',  parcelas, valorTotal?, contaId }     (parcelado fora do cartão: boleto/carnê)
 */

import { fmt } from '../core/money.js';
import { nomeMes, fmtData } from '../core/dates.js';
import { analisar } from './cashflow.js';

const ID_SIM = '__simulacao__';

function lancamentoHipotetico(compra, opcao, hoje) {
  const base = {
    id: ID_SIM, descricao: compra.descricao || 'Compra simulada', data: hoje,
    categoriaId: compra.categoriaId || null, criadoEm: '9999-12-31T23:59:59.999Z',
  };
  if (opcao.tipo === 'cartao') {
    return { ...base, valor: opcao.valorTotal ?? compra.valor, forma: 'cartao', cartaoId: opcao.cartaoId, parcelas: opcao.parcelas || 1 };
  }
  if (opcao.tipo === 'carne') {
    return { ...base, valor: opcao.valorTotal ?? compra.valor, forma: 'boleto', contaId: opcao.contaId, parcelas: opcao.parcelas || 1 };
  }
  return { ...base, valor: opcao.valorTotal ?? compra.valor, forma: opcao.forma || 'pix', contaId: opcao.contaId, parcelas: 1 };
}

export function rotuloOpcao(opcao, db) {
  if (opcao.tipo === 'cartao') {
    const c = db.cartoes.find((x) => x.id === opcao.cartaoId);
    return `${c?.nome ?? 'Cartão'} em ${opcao.parcelas}x`;
  }
  if (opcao.tipo === 'carne') return `Carnê/boleto em ${opcao.parcelas}x`;
  return 'À vista na conta';
}

export function simular(db, hoje, compra, opcoes) {
  const base = analisar(db, hoje);
  const resultados = opcoes.map((opcao) => {
    const lanc = lancamentoHipotetico(compra, opcao, hoje);
    const copia = { ...db, lancamentos: [...db.lancamentos, lanc] };
    const a = analisar(copia, hoje);
    const valorTotal = lanc.valor;
    const parcelas = a.livro.itensCartao.filter((i) => i.lancId === ID_SIM).map((i) => ({ chave: i.chave, vencimento: i.vencimento, valor: i.valor }))
      .concat(a.livro.movConta.filter((m) => m.lancId === ID_SIM).map((m) => ({ chave: m.data.slice(0, 7), vencimento: m.data, valor: -m.valor })));
    const cartao = opcao.tipo === 'cartao' ? base.cartoes.find((c) => c.id === opcao.cartaoId) : null;
    const limite = cartao ? { disponivel: cartao.disponivel, suficiente: cartao.disponivel >= valorTotal } : null;
    const meses = a.meses.map((m, i) => ({
      chave: m.chave,
      comprometidoAntes: base.meses[i].comprometido,
      comprometidoDepois: m.comprometido,
      saldoFimAntes: base.meses[i].saldoFim,
      saldoFimDepois: m.saldoFim,
    }));

    const r = {
      opcao, rotulo: rotuloOpcao(opcao, db), valorTotal, juros: valorTotal - compra.valor,
      saldoHojeAntes: base.saldoAtual, saldoHojeDepois: a.saldoAtual,
      livreAntes: base.livre, livreDepois: a.livre,
      minimo: a.minimo, dataMinimo: a.dataMinimo,
      termometroAntes: base.termometro, termometro: a.termometro,
      parcelas, limite, meses,
    };
    r.viavel = r.livreDepois >= 0 && (!limite || limite.suficiente);
    r.narrativa = narrar(r, base, a, compra);
    return r;
  });
  return { base, resultados, melhor: escolherMelhor(resultados) };
}

function narrar(r, base, a, compra) {
  const txt = [];
  const reservaTxt = base.reserva > 0 ? ` (já descontada a reserva de ${fmt(base.reserva)})` : '';
  if (r.opcao.tipo === 'avista') {
    txt.push(`Seu saldo passa de ${fmt(r.saldoHojeAntes)} para ${fmt(r.saldoHojeDepois)} hoje.`);
    const compromissos = a.cascata.contasFixas + a.cascata.cartao + a.cascata.parcelas + a.cascata.outros;
    txt.push(`Até ${fmtData(a.cascata.fimJanela)} você continua com ${fmt(compromissos)} em contas, faturas e parcelas.`);
  } else {
    const n = r.parcelas.length;
    const p0 = r.parcelas[0];
    const pN = r.parcelas[n - 1];
    txt.push(`O saldo de hoje não muda. ${n > 1 ? `${n} parcelas de ${fmt(pN.valor)}` : `O valor de ${fmt(p0.valor)}`} ${n > 1 ? `entram de ${nomeMes(p0.chave)} a ${nomeMes(pN.chave)}` : `entra na fatura de ${nomeMes(p0.chave)}`}, comprometendo ${fmt(r.valorTotal)} do seu dinheiro futuro.`);
    if (r.juros > 0) txt.push(`O parcelamento custa ${fmt(r.juros)} a mais que o preço à vista (${((r.juros / compra.valor) * 100).toFixed(1).replace('.', ',')}%).`);
    if (r.limite && !r.limite.suficiente) txt.push(`O limite disponível do cartão (${fmt(r.limite.disponivel)}) não cobre o valor total — a compra provavelmente seria recusada.`);
  }
  if (r.livreDepois >= 0 && r.livreDepois === r.livreAntes) {
    txt.push(`O livre para gastar hoje continua em ${fmt(r.livreDepois)}: as cobranças caem depois do ponto mais apertado da projeção.`);
  } else if (r.livreDepois >= 0) {
    txt.push(`O livre para gastar cai de ${fmt(r.livreAntes)} para ${fmt(r.livreDepois)}${reservaTxt}.`);
  } else {
    txt.push(`Faltariam ${fmt(-r.livreDepois)} para cobrir seus compromissos; o ponto mais baixo seria em ${fmtData(r.dataMinimo)}, com saldo projetado de ${fmt(r.minimo)}.`);
  }
  const mesApertado = r.meses.reduce((m, x) => (x.saldoFimDepois < m.saldoFimDepois ? x : m), r.meses[0]);
  if (mesApertado && mesApertado.saldoFimDepois !== mesApertado.saldoFimAntes) {
    txt.push(`Mês mais apertado: ${nomeMes(mesApertado.chave)}, com saldo projetado de ${fmt(mesApertado.saldoFimDepois)} no fim do mês.`);
  }
  if (r.termometro.estado !== r.termometroAntes.estado) {
    txt.push(`O termômetro muda de ${r.termometroAntes.estado} para ${r.termometro.estado}.`);
  }
  return txt;
}

/** Entre as opções viáveis, a que preserva o maior "livre para gastar". */
function escolherMelhor(resultados) {
  const viaveis = resultados.filter((r) => r.viavel);
  if (!viaveis.length) return null;
  return viaveis.reduce((m, r) => (r.livreDepois > m.livreDepois ? r : m));
}
