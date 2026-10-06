/** Cartões de crédito: limite, fatura atual e próximas faturas com seus itens. */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { fmtCurta, nomeMes } from '../../core/dates.js';
import { valor, pilula, barra, vazio } from '../components.js';

const TOM_STATUS = { aberta: '', futura: '', fechada: 'amarelo', vencida: 'vermelho', paga: 'verde', anterior: '' };

export function render(ctx) {
  const { a } = ctx;
  const cartoes = [...a.cartoes].sort((x, y) => (y.ativo !== false) - (x.ativo !== false));
  return `
  <div class="barra-ferramentas"><span class="texto-sec">O limite disponível não é dinheiro: ele só mostra quanto o banco ainda aceita cobrar.</span><span class="espaco"></span><button class="btn btn--pri" data-acao="novo-cartao">+ Cartão</button></div>
  ${cartoes.length ? cartoes.map((c) => cartao(c, a)).join('') : vazio('Nenhum cartão cadastrado.', '<button class="btn btn--pri" data-acao="novo-cartao">+ Cartão</button>')}`;
}

function cartao(c, a) {
  const visiveis = c.faturas.filter((f) => f.status !== 'anterior' && (f.aberto > 0 || f.vencimento >= a.hoje.slice(0, 8) + '01'));
  const tom = c.usoPct > 0.8 ? 'vermelho' : c.usoPct > 0.6 ? 'amarelo' : '';
  return `<section class="cartao-ui cartao-credito ${c.ativo === false ? 'inativo' : ''}" style="--cor-cartao:${esc(c.cor || '#7a5af0')}">
    <header class="cartao-ui__topo">
      <h2><span class="cartao-credito__chip"></span>${esc(c.nome)} ${c.banco ? `<small>${esc(c.banco)}</small>` : ''} ${c.ativo === false ? pilula('inativo') : ''}</h2>
      <button class="btn btn--sec" data-acao="editar-cartao" data-id="${esc(c.id)}">Editar</button>
    </header>
    <div class="cartao-credito__limite">
      <div><span class="texto-sec">Usado</span><strong class="num">${fmt(c.usado)}</strong></div>
      <div><span class="texto-sec">Disponível</span><strong class="num ${c.disponivel < 0 ? 'neg' : ''}">${fmt(c.disponivel)}</strong></div>
      <div><span class="texto-sec">Limite</span><strong class="num">${fmt(c.limite)}</strong></div>
    </div>
    ${barra(c.usado, c.limite, tom)}
    <p class="texto-sec">Fecha dia ${c.fechamento}, vence dia ${c.vencimento}. ${c.faturaAberta ? `Compras de hoje entram na fatura de ${nomeMes(c.faturaAberta.chave)} (vence ${fmtCurta(c.faturaAberta.vencimento)}).` : ''}</p>
    ${visiveis.length ? `<ul class="faturas">${visiveis.slice(0, 8).map((f) => `<li>
      <details>
        <summary>
          <span class="faturas__mes">${esc(nomeMes(f.chave))}</span>
          <span class="texto-sec">vence ${fmtCurta(f.vencimento)}</span>
          ${pilula(f.status, TOM_STATUS[f.status])}
          <span class="num">${fmt(f.total)}</span>
          ${f.aberto > 0 && f.aberto !== f.total ? `<span class="texto-sec">aberto ${fmt(f.aberto)}</span>` : ''}
          ${f.aberto > 0 && f.status !== 'futura' ? `<button class="btn btn--mini" data-acao="pagar-fatura" data-cartao="${esc(c.id)}" data-chave="${esc(f.chave)}">Pagar</button>` : ''}
        </summary>
        <ul class="tabela">${[...f.itens].sort((x, y) => x.data.localeCompare(y.data)).map((i) => `<li ${i.lancId ? `class="clicavel" data-acao="editar-lanc" data-id="${esc(i.lancId)}"` : ''}>
          <span class="tabela__data">${fmtCurta(i.data)}</span>
          <span class="tabela__desc">${esc(i.descricao)} ${i.parcela ? pilula(`${i.parcela.i}/${i.parcela.n}`) : ''}${i.tipo === 'fixo' ? pilula('fixo') : ''}</span>
          ${valor(i.valor)}
        </li>`).join('') || '<li class="texto-sec">Sem itens.</li>'}</ul>
      </details>
    </li>`).join('')}</ul>` : '<p class="texto-sec">Nenhuma fatura em aberto.</p>'}
  </section>`;
}
