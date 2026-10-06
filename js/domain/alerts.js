/**
 * Alertas gerados a partir da análise. Cada alerta tem nível (critico | atencao | info),
 * texto e, quando aplicável, uma rota para resolver.
 */

import { diffDays, monthKey, addMonthsKey, parse, fmtCurta } from '../core/dates.js';
import { fmt } from '../core/money.js';
import { gastoAteDia } from './cashflow.js';

const quando = (dias) => (dias < 0 ? `venceu há ${-dias} dia${dias === -1 ? '' : 's'}` : dias === 0 ? 'vence hoje' : dias === 1 ? 'vence amanhã' : `vence em ${dias} dias`);

export function gerarAlertas(db, a) {
  const L = db.config.limiares;
  const out = [];
  const add = (nivel, texto, rota) => out.push({ nivel, texto, rota });

  // Saldo projetado negativo
  if (a.livre < 0) add('critico', `Seus compromissos ultrapassam o dinheiro previsto: faltam ${fmt(-a.livre)} até ${fmtCurta(a.dataMinimo)}.`, '#/mes');

  // Faturas e contas próximas ou vencidas
  for (const e of a.eventos) {
    if (!['fatura', 'fixo'].includes(e.tipo)) continue;
    const dias = diffDays(a.hoje, e.data);
    if (dias > L.diasAlertaVencimento) continue;
    const nome = e.tipo === 'fatura' ? e.descricao : e.descricao;
    add(dias < 0 ? 'critico' : 'atencao', `${nome} (${fmt(-e.valor)}) ${quando(dias)}.`, e.tipo === 'fatura' ? '#/cartoes' : '#/fixos');
  }

  // Receitas atrasadas (não confirmadas)
  for (const e of a.eventos) {
    if (e.tipo === 'receita' && e.atrasado) add('atencao', `${e.descricao} de ${fmtCurta(e.data)} ainda não foi confirmado.`, '#/');
  }

  // Limite de cartão baixo
  for (const c of a.cartoes) {
    if (c.ativo === false || c.limite <= 0) continue;
    const pctDisp = c.disponivel / c.limite;
    if (pctDisp < L.limiteCartaoAlerta) add('atencao', `Limite disponível do ${c.nome} está em ${Math.max(0, Math.round(pctDisp * 100))}% (${fmt(c.disponivel)}).`, '#/cartoes');
  }

  // Dinheiro futuro comprometido
  const t = a.termometro;
  if (t.comprometimento != null && t.comprometimento >= L.comprometimentoAmarelo) {
    add(t.comprometimento >= L.comprometimentoVermelho ? 'critico' : 'atencao', `${Math.round(t.comprometimento * 100)}% do que você vai receber nos próximos 90 dias já está comprometido.`, '#/mes');
  }

  // Parcelas futuras
  if (a.totais.parcelasFuturas > 0) {
    const n = a.parcelamentos.filter((p) => !p.concluido).length;
    add('info', `Você tem ${fmt(a.totais.parcelasFuturas)} em parcelas futuras (${n} compra${n === 1 ? '' : 's'}).`, '#/gastos');
  }

  // Variação do gasto variável em relação à média dos 3 meses anteriores, até o mesmo dia
  const dia = parse(a.hoje).d;
  const anteriores = [1, 2, 3].map((i) => addMonthsKey(a.mesAtual, -i)).filter((k) => `${k}-01` >= db.config.dataInicio);
  if (anteriores.length && dia >= 5) {
    const media = anteriores.reduce((s, k) => s + gastoAteDia(db, k, dia), 0) / anteriores.length;
    const atual = gastoAteDia(db, monthKey(a.hoje), dia);
    if (media > 0 && atual > media * 1.25) {
      add('atencao', `Seus gastos variáveis estão ${Math.round((atual / media - 1) * 100)}% acima da média dos meses anteriores até o dia ${dia}.`, '#/gastos');
    }
  }

  if (a.estimativa.origem === 'sem-historico') {
    add('info', 'Ainda não há histórico para estimar seus gastos variáveis dos próximos meses. Informe uma estimativa em Ajustes para a projeção ficar realista.', '#/ajustes');
  }

  const ordem = { critico: 0, atencao: 1, info: 2 };
  return out.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
}
