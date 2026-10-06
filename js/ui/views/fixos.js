/** Receitas recorrentes e gastos fixos, com a situação de cada um no mês atual. */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { fmtData, nomeMes } from '../../core/dates.js';
import { kpi, valor, pilula, pontoCor, vazio } from '../components.js';
import { FORMAS, ehCartao } from '../../domain/schema.js';

const FREQ = { 0: 'uma vez', 1: 'mensal', 2: 'bimestral', 3: 'trimestral', 6: 'semestral', 12: 'anual' };

export function render(ctx) {
  const { db, a } = ctx;
  const mes = a.mesAtual;
  const fixoMensal = db.recorrentes.filter((r) => r.ativo !== false).reduce((s, r) => s + r.valor / (r.intervaloMeses || 1), 0);

  const situacaoReceita = (rc) => {
    if (db.recebimentos.some((x) => x.receitaId === rc.id && x.competencia === mes)) return pilula('recebido', 'verde');
    const ev = a.eventos.find((e) => e.receitaId === rc.id && e.competencia === mes);
    if (ev) return `${pilula(ev.atrasado ? 'não confirmado' : 'a receber', ev.atrasado ? 'vermelho' : 'amarelo')} <button class="btn btn--mini" data-acao="confirmar-receita" data-id="${esc(ev.id)}">Recebi</button>`;
    return '';
  };
  const situacaoFixo = (r) => {
    if (ehCartao(r.forma)) return pilula('no cartão');
    if (db.lancamentos.some((l) => l.recorrenteId === r.id && l.competencia === mes)) return pilula('pago', 'verde');
    const ev = a.eventos.find((e) => e.recId === r.id && e.competencia === mes);
    if (ev) return `${pilula(ev.atrasado ? 'atrasado' : 'a pagar', ev.atrasado ? 'vermelho' : 'amarelo')} <button class="btn btn--mini" data-acao="pagar-fixo" data-id="${esc(ev.id)}">Paguei</button>`;
    return '';
  };
  const cat = (id) => db.categorias.find((c) => c.id === id);
  const pessoa = (id) => db.pessoas.find((p) => p.id === id);
  const meio = (r) => (ehCartao(r.forma) ? db.cartoes.find((c) => c.id === r.cartaoId)?.nome || 'cartão' : FORMAS[r.forma]?.nome);

  const receitas = [...db.receitas].sort((x, y) => (y.ativa !== false) - (x.ativa !== false) || y.valor - x.valor);
  const fixos = [...db.recorrentes].sort((x, y) => (y.ativo !== false) - (x.ativo !== false) || x.dia - y.dia);

  return `
  <section class="kpis kpis--3">
    ${kpi({ rotulo: 'Renda mensal recorrente', valor: a.rendaMensal, tom: 'pos' })}
    ${kpi({ rotulo: 'Gastos fixos por mês', valor: Math.round(fixoMensal), sub: a.rendaMensal ? `${Math.round((fixoMensal / a.rendaMensal) * 100)}% da renda` : '' })}
    ${kpi({ rotulo: 'Sobra antes dos variáveis', valor: Math.round(a.rendaMensal - fixoMensal), sub: 'sem contar faturas e parcelas' })}
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Receitas</h2><button class="btn btn--sec" data-acao="nova-receita">+ Receita</button></header>
    ${receitas.length ? `<ul class="tabela tabela--cad">${receitas.map((rc) => `<li class="${rc.ativa === false ? 'inativo' : ''}">
      <button class="tabela__desc link-linha" data-acao="editar-receita" data-id="${esc(rc.id)}">
        <strong>${esc(rc.descricao)}</strong>
        <small>${rc.intervaloMeses === 0 ? `em ${fmtData(rc.data)}` : `dia ${rc.dia} · ${FREQ[rc.intervaloMeses] ?? ''}`}${rc.fim ? ` · até ${fmtData(rc.fim)}` : ''}</small>
      </button>
      ${valor(rc.valor, { classe: 'pos' })}
      <span class="tabela__status">${rc.ativa === false ? pilula('inativa') : situacaoReceita(rc)}</span>
    </li>`).join('')}</ul>` : vazio('Cadastre seu salário: ele é a base de "a receber" e do termômetro.', '<button class="btn btn--pri" data-acao="nova-receita">+ Receita</button>')}
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Gastos fixos</h2><button class="btn btn--sec" data-acao="novo-fixo">+ Gasto fixo</button></header>
    <p class="texto-sec">Situação em ${esc(nomeMes(mes))}. Gastos fixos pagos na conta ficam "a pagar" até você marcar; no cartão, entram sozinhos na fatura.</p>
    ${fixos.length ? `<ul class="tabela tabela--cad">${fixos.map((r) => `<li class="${r.ativo === false ? 'inativo' : ''}">
      <button class="tabela__desc link-linha" data-acao="editar-fixo" data-id="${esc(r.id)}">
        <strong>${pontoCor(cat(r.categoriaId)?.cor)}${esc(r.nome)}</strong>
        <small>dia ${r.dia} · ${FREQ[r.intervaloMeses] ?? ''} · ${esc(meio(r))}${r.divisao?.length ? ` · dividido entre ${r.divisao.length}` : r.responsavelId && !pessoa(r.responsavelId)?.eu ? ` · ${esc(pessoa(r.responsavelId)?.nome)}` : ''}${r.fim ? ` · até ${fmtData(r.fim)}` : ''}</small>
      </button>
      ${valor(r.valor)}
      <span class="tabela__status">${r.ativo === false ? pilula('inativo') : situacaoFixo(r)}</span>
    </li>`).join('')}</ul>` : vazio('Cadastre aluguel, energia, internet, assinaturas e outras contas que se repetem.', '<button class="btn btn--pri" data-acao="novo-fixo">+ Gasto fixo</button>')}
  </section>`;
}
