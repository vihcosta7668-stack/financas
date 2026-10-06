/**
 * Tela inicial, pensada para leitura em poucos segundos:
 * 1) quanto pode gastar (o número principal, com cor de situação);
 * 2) botão grande para registrar um gasto;
 * 3) três números de apoio (na conta, vai receber, contas a pagar);
 * 4) próximas contas com botão de uma ação.
 * Detalhes, gráficos e explicações ficam nas outras telas.
 */

import { esc } from '../dom.js';
import { fmt } from '../../core/money.js';
import { fmtCurta, diffDays } from '../../core/dates.js';

const SITUACAO = {
  verde: { titulo: 'Tudo em dia', frase: 'Pode usar sem atrasar nenhuma conta.' },
  amarelo: { titulo: 'Atenção', frase: 'Sobra pouco. Gaste com cuidado.' },
  vermelho: { titulo: 'Cuidado', frase: '' },
};

export function render(ctx) {
  const { a, db } = ctx;
  const semDados = !db.receitas.length && !db.lancamentos.length && !db.recorrentes.length && !db.cartoes.length;
  if (semDados) return comecar(db);

  const estado = a.termometro.estado;
  const s = SITUACAO[estado];
  const livre = Math.max(0, a.livre);
  const frase = a.livre < 0 ? `Faltam ${fmt(-a.livre)} para pagar todas as contas.` : s.frase;

  // Contas até o próximo recebimento (ou próximos 30 dias, se não houver receita cadastrada)
  const limite = a.proxReceita?.dataEfetiva;
  const aPagar = a.eventos.filter((e) => e.valor < 0 && e.tipo !== 'variavelPrevisto'
    && (limite ? e.dataEfetiva < limite : diffDays(a.hoje, e.dataEfetiva) <= 30));
  const totalAPagar = aPagar.reduce((t, e) => t - e.valor, 0);

  const proximos = a.eventos
    .filter((e) => ['fixo', 'fatura', 'receita'].includes(e.tipo) && diffDays(a.hoje, e.dataEfetiva) <= 30)
    .slice(0, 5);

  return `
  <section class="inicio-destaque inicio-destaque--${estado}">
    <span class="inicio-situacao"><i></i>${s.titulo}</span>
    <p class="inicio-rotulo">Você pode gastar</p>
    <p class="inicio-valor num">${esc(fmt(livre))}</p>
    <p class="inicio-frase">${esc(frase)}</p>
  </section>

  <button class="inicio-botao" data-acao="novo-gasto">+ Registrar gasto</button>

  <section class="inicio-numeros">
    <a class="inicio-numero" href="#/ajustes">
      <span>Na conta</span>
      <strong class="num ${a.saldoAtual < 0 ? 'neg' : ''}">${esc(fmt(a.saldoAtual))}</strong>
    </a>
    <a class="inicio-numero" href="#/fixos">
      <span>Vai receber${a.proxReceita ? ` dia ${fmtCurta(a.proxReceita.dataEfetiva)}` : ''}</span>
      <strong class="num">${esc(fmt(a.proxReceita?.valor || 0))}</strong>
    </a>
    <a class="inicio-numero" href="#/mes">
      <span>A pagar${limite ? ` até ${fmtCurta(limite)}` : ' em 30 dias'}</span>
      <strong class="num">${esc(fmt(totalAPagar))}</strong>
    </a>
  </section>

  <section class="inicio-lista">
    <h2>Próximas contas</h2>
    ${proximos.length ? `<ul>${proximos.map((e) => item(e, a.hoje)).join('')}</ul>` : '<p class="inicio-vazio">Nenhuma conta nos próximos 30 dias.</p>'}
  </section>

  <a class="inicio-detalhes" href="#/mes">Ver mais detalhes</a>`;
}

function quando(e, hoje) {
  if (e.atrasado) return 'Atrasada';
  const d = diffDays(hoje, e.data);
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Amanhã';
  return `Dia ${fmtCurta(e.data)}`;
}

function item(e, hoje) {
  const entrada = e.valor > 0;
  const botao = e.tipo === 'receita'
    ? `<button class="inicio-acao" data-acao="confirmar-receita" data-id="${esc(e.id)}">Recebi</button>`
    : e.tipo === 'fixo'
      ? `<button class="inicio-acao" data-acao="pagar-fixo" data-id="${esc(e.id)}">Paguei</button>`
      : `<button class="inicio-acao" data-acao="pagar-fatura" data-cartao="${esc(e.cartaoId)}" data-chave="${esc(e.chave)}">Paguei</button>`;
  return `<li class="${e.atrasado ? 'atrasada' : ''}">
    <div class="inicio-item">
      <strong>${esc(e.descricao)}</strong>
      <span>${quando(e, hoje)}</span>
    </div>
    <span class="num ${entrada ? 'pos' : ''}">${entrada ? '+ ' : ''}${esc(fmt(Math.abs(e.valor)))}</span>
    ${botao}
  </li>`;
}

function comecar(db) {
  const conta = db.contas[0];
  return `
  <section class="inicio-destaque">
    <p class="inicio-rotulo">Bem-vinda!</p>
    <p class="inicio-frase">Para o app mostrar quanto você pode gastar, preencha estas informações:</p>
  </section>
  <div class="inicio-passos">
    <button class="inicio-passo" data-acao="ajustar-conta" data-id="${esc(conta?.id || '')}"><b>1</b>Quanto tenho na conta hoje</button>
    <button class="inicio-passo" data-acao="nova-receita"><b>2</b>Quanto recebo e em que dia</button>
    <button class="inicio-passo" data-acao="novo-fixo"><b>3</b>Contas que pago todo mês</button>
    <button class="inicio-passo" data-acao="novo-cartao"><b>4</b>Meus cartões de crédito</button>
  </div>`;
}
