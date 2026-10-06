/**
 * Formulários de cadastro. Cada função abre um modal, valida e grava via store.alterar.
 * Nenhum cálculo financeiro acontece aqui: os formulários só registram fatos.
 */

import { abrirModal, campo, opcoes } from './modal.js';
import { esc, toast, $$ } from './dom.js';
import { parseValor, paraCampo, fmt, soma } from '../core/money.js';
import { hojeLocal, fmtData, fmtCurta, nomeMes, addMonthsKey } from '../core/dates.js';
import { novoId, agoraISO, FORMAS, ehCartao } from '../domain/schema.js';
import { divisaoIgual, divisaoPorPercentual } from '../domain/people.js';
import { faturaDaCompra, faturaPorChave } from '../domain/cards.js';
import { store } from '../data/store.js';

const FREQUENCIAS = [[1, 'Mensal'], [2, 'Bimestral'], [3, 'Trimestral'], [6, 'Semestral'], [12, 'Anual']];
const FORMAS_CONTA = Object.entries(FORMAS).filter(([, f]) => f.meio === 'conta').map(([k, f]) => [k, f.nome]);
const ULTIMO_PG = 'financas.ultimoPagamento';

const inputValor = (nome, v, extra = '') => `<input name="${nome}" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(paraCampo(v))}" ${extra}>`;
const contasAtivas = (db) => db.contas.filter((c) => c.ativa !== false);
const cartoesAtivos = (db) => db.cartoes.filter((c) => c.ativo !== false);
const opcoesContas = (db, sel) => opcoes(contasAtivas(db).map((c) => [c.id, c.nome]), sel || contasAtivas(db)[0]?.id);
const opcoesCategorias = (db, sel) => opcoes(db.categorias.map((c) => [c.id, c.nome]), sel, { vazio: 'Sem categoria' });
const opcoesPessoas = (db, sel) => opcoes(db.pessoas.map((p) => [p.id, p.nome]), sel || db.pessoas.find((p) => p.eu)?.id);

function exigirValor(txt, nome = 'Valor') {
  const v = parseValor(txt);
  if (!Number.isFinite(v) || v <= 0) return { erro: `${nome}: informe um valor maior que zero.` };
  return { v };
}

/* ------------------------------------------------------------------ */
/* Divisão entre pessoas                                               */
/* ------------------------------------------------------------------ */

function editorDivisao(db, item = {}) {
  const modo = item.divisao?.length ? (item.divisao.every((d) => d.pct != null) ? 'pct' : 'valor') : 'sozinho';
  const linha = (p) => {
    const d = item.divisao?.find((x) => x.pessoaId === p.id);
    const v = modo === 'pct' ? (d?.pct ?? '') : paraCampo(d?.valor);
    return `<div class="div__linha">
      <label class="check"><input type="checkbox" name="div_on_${p.id}" ${d || (!item.divisao?.length && p.eu) ? 'checked' : ''}><span>${esc(p.nome)}</span></label>
      <input name="div_v_${p.id}" inputmode="decimal" value="${esc(v)}" placeholder="${modo === 'pct' ? '%' : '0,00'}" class="div__valor">
    </div>`;
  };
  return `<fieldset class="divisao">
    <legend>Quem paga esta despesa</legend>
    <div class="seg">
      ${[['sozinho', 'Uma pessoa'], ['igual', 'Dividir igual'], ['valor', 'Por valor'], ['pct', 'Por %']].map(([k, t]) => `<label><input type="radio" name="divModo" value="${k}" ${k === modo ? 'checked' : ''}><span>${t}</span></label>`).join('')}
    </div>
    <div class="div__sozinho">${campo('Responsável', `<select name="responsavelId">${opcoesPessoas(db, item.responsavelId)}</select>`)}</div>
    <div class="div__pessoas">${db.pessoas.map(linha).join('')}</div>
    ${db.pessoas.length < 2 ? '<p class="campo__dica">Cadastre pessoas na tela Pessoas para dividir despesas.</p>' : ''}
  </fieldset>`;
}

function ligarDivisao(form) {
  const atualizar = () => {
    const modo = form.querySelector('[name="divModo"]:checked')?.value || 'sozinho';
    form.querySelector('.div__sozinho').hidden = modo !== 'sozinho';
    form.querySelector('.div__pessoas').hidden = modo === 'sozinho';
    $$('.div__valor', form).forEach((el) => { el.hidden = modo === 'igual'; el.placeholder = modo === 'pct' ? '%' : '0,00'; });
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'divModo') atualizar(); });
  atualizar();
}

/** Converte os campos de divisão em { responsavelId, divisao } ou { erro }. */
function lerDivisao(dados, db, total) {
  const modo = dados.divModo || 'sozinho';
  if (modo === 'sozinho') return { responsavelId: dados.responsavelId || null, divisao: null };
  const marcadas = db.pessoas.filter((p) => dados[`div_on_${p.id}`]);
  if (!marcadas.length) return { erro: 'Marque ao menos uma pessoa na divisão.' };
  if (modo === 'igual') return { responsavelId: null, divisao: divisaoIgual(total, marcadas.map((p) => p.id)) };
  if (modo === 'pct') {
    const linhas = marcadas.map((p) => ({ pessoaId: p.id, pct: Number(String(dados[`div_v_${p.id}`]).replace(',', '.')) || 0 }));
    const s = soma(linhas, (l) => l.pct);
    if (Math.abs(s - 100) > 0.01) return { erro: `Os percentuais somam ${s.toLocaleString('pt-BR')}%; precisam somar 100%.` };
    return { responsavelId: null, divisao: divisaoPorPercentual(total, linhas) };
  }
  const linhas = marcadas.map((p) => ({ pessoaId: p.id, valor: parseValor(dados[`div_v_${p.id}`]) || 0 }));
  const s = soma(linhas, (l) => l.valor);
  if (s !== total) return { erro: `A divisão soma ${fmt(s)}, mas o total é ${fmt(total)}.` };
  return { responsavelId: null, divisao: linhas };
}

/* ------------------------------------------------------------------ */
/* Lançamento (gasto variável / compra parcelada)                      */
/* ------------------------------------------------------------------ */

export function formLancamento(db, existente = null, preset = {}) {
  const l = existente || preset;
  const hoje = hojeLocal();
  const ultimo = localStorage.getItem(ULTIMO_PG) || 'conta';
  const pgAtual = l.forma ? (ehCartao(l.forma) ? `cartao:${l.cartaoId}` : 'conta') : ultimo;
  const cartoes = cartoesAtivos(db);
  const pgValido = pgAtual === 'conta' || cartoes.some((c) => `cartao:${c.id}` === pgAtual) ? pgAtual : 'conta';
  const catSel = l.categoriaId ?? null;
  const n = l.parcelas || 1;

  const chipsCat = db.categorias.map((c) => `<label class="chip"><input type="radio" name="categoriaId" value="${esc(c.id)}" ${c.id === catSel ? 'checked' : ''}><span>${pontoCat(c.cor)}${esc(c.nome)}</span></label>`).join('');
  const chipsPg = [`<label class="chip"><input type="radio" name="pg" value="conta" ${pgValido === 'conta' ? 'checked' : ''}><span>Pix / débito</span></label>`]
    .concat(cartoes.map((c) => `<label class="chip"><input type="radio" name="pg" value="cartao:${esc(c.id)}" ${pgValido === `cartao:${c.id}` ? 'checked' : ''}><span>${pontoCat(c.cor)}${esc(c.nome)}</span></label>`)).join('');

  const corpo = `
    <div class="valor-grande">
      <span>R$</span>${inputValor('valor', l.precoAVista ?? l.valor, 'autofocus required aria-label="Valor"')}
    </div>
    ${campo('Descrição', `<input name="descricao" value="${esc(l.descricao || '')}" placeholder="Ex.: almoço (opcional)" autocomplete="off">`)}
    <div class="campo"><span class="campo__rotulo">Categoria</span><div class="chips">${chipsCat}</div></div>
    <div class="campo"><span class="campo__rotulo">Pagamento</span><div class="chips">${chipsPg}</div>
      ${cartoes.length ? '' : '<span class="campo__dica">Cadastre seus cartões na tela Cartões para lançar compras no crédito.</span>'}</div>
    <details class="mais" ${existente && (n > 1 || l.divisao?.length || l.obs) ? 'open' : ''}>
      <summary>Mais opções</summary>
      <div class="grade2">
        ${campo('Data', `<input type="date" name="data" value="${esc(l.data || hoje)}">`)}
        ${campo('Parcelas', `<input type="number" name="parcelas" min="1" max="48" value="${n}">`)}
      </div>
      <div class="grade2" data-so-parcelado ${n > 1 ? '' : 'hidden'}>
        ${campo('Valor de cada parcela', inputValor('valorParcela', n > 1 && l.precoAVista ? Math.round(l.valor / n) : null), { dica: 'Preencha se o parcelado tiver juros; o total passa a ser parcela × quantidade.' })}
        <p class="campo__dica" data-resumo-parcela></p>
      </div>
      <div class="grade2" data-so-conta>
        ${campo('Forma', `<select name="formaConta">${opcoes(FORMAS_CONTA, ehCartao(l.forma) ? 'pix' : l.forma || 'pix')}</select>`)}
        ${campo('Conta', `<select name="contaId">${opcoesContas(db, l.contaId)}</select>`)}
      </div>
      <div data-so-cartao>${campo('Lançar na fatura', `<select name="faturaChave"><option value="">Automático pela data da compra</option></select>`, { dica: 'Use só para corrigir uma compra que o banco colocou em outra fatura.' })}</div>
      ${editorDivisao(db, l)}
      ${campo('Observações', `<textarea name="obs" rows="2">${esc(l.obs || '')}</textarea>`)}
    </details>`;

  abrirModal({
    titulo: existente ? 'Editar gasto' : 'Novo gasto',
    corpo,
    perigo: existente ? { rotulo: 'Excluir', confirmar: 'Excluir este gasto (e todas as parcelas)?', acao: () => { store.alterar((d) => { d.lancamentos = d.lancamentos.filter((x) => x.id !== existente.id); }); toast('Gasto excluído'); } } : null,
    aoMontar(form) {
      ligarDivisao(form);
      const atualizar = () => {
        const pg = form.querySelector('[name="pg"]:checked')?.value || 'conta';
        const nParc = Math.max(1, Number(form.parcelas.value) || 1);
        form.querySelector('[data-so-conta]').hidden = pg !== 'conta';
        form.querySelector('[data-so-cartao]').hidden = pg === 'conta';
        form.querySelector('[data-so-parcelado]').hidden = nParc <= 1;
        if (pg !== 'conta') {
          const cartao = db.cartoes.find((c) => `cartao:${c.id}` === pg);
          const auto = faturaDaCompra(cartao, form.data.value || hoje);
          const sel = form.faturaChave;
          const atual = sel.value || l.faturaChave || '';
          const chaves = [-1, 0, 1, 2].map((i) => addMonthsKey(auto.chave, i));
          sel.innerHTML = `<option value="">Automático (vence ${fmtCurta(auto.vencimento)})</option>` + chaves.map((k) => `<option value="${k}" ${k === atual ? 'selected' : ''}>Fatura de ${nomeMes(k)}</option>`).join('');
        }
        const v = parseValor(form.valor.value);
        const vp = parseValor(form.valorParcela.value);
        const alvo = form.querySelector('[data-resumo-parcela]');
        if (nParc > 1 && v > 0) {
          const total = vp > 0 ? vp * nParc : v;
          alvo.textContent = `${nParc}x de ${fmt(vp > 0 ? vp : Math.round(v / nParc))} = ${fmt(total)}${vp > 0 && total > v ? ` (juros de ${fmt(total - v)})` : ''}`;
        } else alvo.textContent = '';
      };
      form.addEventListener('input', atualizar);
      form.addEventListener('change', atualizar);
      atualizar();
    },
    aoEnviar(dados) {
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      const parcelas = Math.max(1, Math.min(48, Number(dados.parcelas) || 1));
      const vp = parseValor(dados.valorParcela);
      const total = parcelas > 1 && vp > 0 ? vp * parcelas : v;
      const div = lerDivisao(dados, db, total);
      if (div.erro) return div.erro;
      const pg = dados.pg || 'conta';
      const categoria = db.categorias.find((c) => c.id === dados.categoriaId);
      const registro = {
        id: existente?.id || novoId('l'),
        descricao: dados.descricao.trim() || categoria?.nome || 'Gasto',
        valor: total,
        precoAVista: total !== v ? v : undefined,
        data: dados.data || hoje,
        categoriaId: dados.categoriaId || null,
        parcelas,
        forma: pg === 'conta' ? (dados.formaConta || 'pix') : 'cartao',
        contaId: pg === 'conta' ? dados.contaId : null,
        cartaoId: pg === 'conta' ? null : pg.slice(7),
        faturaChave: pg === 'conta' ? null : (dados.faturaChave || null),
        responsavelId: div.responsavelId,
        divisao: div.divisao,
        obs: dados.obs?.trim() || '',
        recorrenteId: existente?.recorrenteId,
        competencia: existente?.competencia,
        criadoEm: existente?.criadoEm || agoraISO(),
      };
      localStorage.setItem(ULTIMO_PG, pg);
      store.alterar((d) => {
        const i = d.lancamentos.findIndex((x) => x.id === registro.id);
        if (i >= 0) d.lancamentos[i] = registro; else d.lancamentos.push(registro);
      });
      toast(existente ? 'Gasto atualizado' : `${fmt(total)} registrado${parcelas > 1 ? ` em ${parcelas}x` : ''}`);
    },
  });
}

const pontoCat = (cor) => `<i class="ponto" style="background:${esc(cor || '#8a8f98')}"></i>`;

/* ------------------------------------------------------------------ */
/* Gasto fixo (recorrente)                                             */
/* ------------------------------------------------------------------ */

export function formRecorrente(db, existente = null) {
  const r = existente || { dia: 10, intervaloMeses: 1, forma: 'pix', inicio: hojeLocal(), ativo: true };
  const cartoes = cartoesAtivos(db);
  const corpo = `
    ${campo('Nome', `<input name="nome" value="${esc(r.nome || '')}" placeholder="Ex.: Aluguel" required autofocus>`)}
    <div class="grade2">
      ${campo('Valor', inputValor('valor', r.valor))}
      ${campo('Dia do vencimento', `<input type="number" name="dia" min="1" max="31" value="${r.dia}">`)}
    </div>
    <div class="grade2">
      ${campo('Categoria', `<select name="categoriaId">${opcoesCategorias(db, r.categoriaId)}</select>`)}
      ${campo('Frequência', `<select name="intervaloMeses">${opcoes(FREQUENCIAS, r.intervaloMeses)}</select>`)}
    </div>
    <div class="grade2">
      ${campo('Forma de pagamento', `<select name="forma">${opcoes(Object.entries(FORMAS).map(([k, f]) => [k, f.nome]), r.forma)}</select>`)}
      <div data-so-conta>${campo('Conta', `<select name="contaId">${opcoesContas(db, r.contaId)}</select>`)}</div>
      <div data-so-cartao>${campo('Cartão', `<select name="cartaoId">${opcoes(cartoes.map((c) => [c.id, c.nome]), r.cartaoId, { vazio: cartoes.length ? null : 'Nenhum cartão cadastrado' })}</select>`)}</div>
    </div>
    <div class="grade2">
      ${campo('Início', `<input type="date" name="inicio" value="${esc(r.inicio)}">`)}
      ${campo('Fim (opcional)', `<input type="date" name="fim" value="${esc(r.fim || '')}">`, { dica: 'Para parcelamentos com data para acabar.' })}
    </div>
    <p class="campo__dica" data-dica-forma></p>
    ${editorDivisao(db, r)}
    <label class="check"><input type="checkbox" name="ativo" ${r.ativo !== false ? 'checked' : ''}><span>Ativo</span></label>`;

  abrirModal({
    titulo: existente ? 'Editar gasto fixo' : 'Novo gasto fixo',
    corpo,
    perigo: existente ? { rotulo: 'Excluir', confirmar: 'Excluir este gasto fixo? Pagamentos já registrados continuam no histórico.', acao: () => store.alterar((d) => { d.recorrentes = d.recorrentes.filter((x) => x.id !== existente.id); }) } : null,
    aoMontar(form) {
      ligarDivisao(form);
      const atualizar = () => {
        const cartao = ehCartao(form.forma.value);
        form.querySelector('[data-so-conta]').hidden = cartao;
        form.querySelector('[data-so-cartao]').hidden = !cartao;
        form.querySelector('[data-dica-forma]').textContent = cartao
          ? 'No cartão, a cobrança entra automaticamente na fatura a cada mês.'
          : 'Na conta, o gasto aparece como "a pagar" até você marcá-lo como pago.';
      };
      form.forma.addEventListener('change', atualizar);
      atualizar();
    },
    aoEnviar(dados) {
      if (!dados.nome.trim()) return 'Informe o nome.';
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      const dia = Number(dados.dia);
      if (!(dia >= 1 && dia <= 31)) return 'Dia do vencimento deve estar entre 1 e 31.';
      const cartao = ehCartao(dados.forma);
      if (cartao && !dados.cartaoId) return 'Escolha o cartão.';
      if (dados.fim && dados.fim < dados.inicio) return 'A data final é anterior ao início.';
      const div = lerDivisao(dados, db, v);
      if (div.erro) return div.erro;
      const reg = {
        id: existente?.id || novoId('r'), nome: dados.nome.trim(), valor: v, dia,
        categoriaId: dados.categoriaId || null, intervaloMeses: Number(dados.intervaloMeses) || 1,
        forma: dados.forma, contaId: cartao ? null : dados.contaId, cartaoId: cartao ? dados.cartaoId : null,
        inicio: dados.inicio || hojeLocal(), fim: dados.fim || null, ativo: dados.ativo,
        responsavelId: div.responsavelId, divisao: div.divisao,
      };
      store.alterar((d) => {
        const i = d.recorrentes.findIndex((x) => x.id === reg.id);
        if (i >= 0) d.recorrentes[i] = reg; else d.recorrentes.push(reg);
      });
      toast('Gasto fixo salvo');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Receita                                                             */
/* ------------------------------------------------------------------ */

export function formReceita(db, existente = null) {
  const r = existente || { dia: 1, intervaloMeses: 1, inicio: hojeLocal(), ativa: true };
  const corpo = `
    ${campo('Descrição', `<input name="descricao" value="${esc(r.descricao || '')}" placeholder="Ex.: Salário" autofocus>`)}
    <div class="grade2">
      ${campo('Valor', inputValor('valor', r.valor))}
      ${campo('Frequência', `<select name="intervaloMeses">${opcoes([[0, 'Uma vez'], ...FREQUENCIAS], r.intervaloMeses ?? 1)}</select>`)}
    </div>
    <div class="grade2" data-recorrente>
      ${campo('Dia do recebimento', `<input type="number" name="dia" min="1" max="31" value="${r.dia ?? 1}">`)}
      ${campo('A partir de', `<input type="date" name="inicio" value="${esc(r.inicio || hojeLocal())}">`)}
    </div>
    <div class="grade2">
      <div data-unica>${campo('Data', `<input type="date" name="data" value="${esc(r.data || hojeLocal())}">`)}</div>
      <div data-recorrente>${campo('Até (opcional)', `<input type="date" name="fim" value="${esc(r.fim || '')}">`)}</div>
      ${campo('Conta de destino', `<select name="contaId">${opcoesContas(db, r.contaId)}</select>`)}
    </div>
    <label class="check"><input type="checkbox" name="ativa" ${r.ativa !== false ? 'checked' : ''}><span>Ativa</span></label>`;

  abrirModal({
    titulo: existente ? 'Editar receita' : 'Nova receita',
    corpo,
    perigo: existente ? { rotulo: 'Excluir', acao: () => store.alterar((d) => { d.receitas = d.receitas.filter((x) => x.id !== existente.id); }) } : null,
    aoMontar(form) {
      const atualizar = () => {
        const unica = form.intervaloMeses.value === '0';
        $$('[data-recorrente]', form).forEach((el) => { el.hidden = unica; });
        $$('[data-unica]', form).forEach((el) => { el.hidden = !unica; });
      };
      form.intervaloMeses.addEventListener('change', atualizar);
      atualizar();
    },
    aoEnviar(dados) {
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      const intervalo = Number(dados.intervaloMeses);
      const reg = {
        id: existente?.id || novoId('rc'), descricao: dados.descricao.trim() || 'Receita', valor: v,
        intervaloMeses: intervalo, dia: Number(dados.dia) || 1,
        inicio: intervalo === 0 ? dados.data : (dados.inicio || hojeLocal()),
        data: intervalo === 0 ? dados.data : null,
        fim: intervalo === 0 ? null : (dados.fim || null),
        contaId: dados.contaId, ativa: dados.ativa,
      };
      store.alterar((d) => {
        const i = d.receitas.findIndex((x) => x.id === reg.id);
        if (i >= 0) d.receitas[i] = reg; else d.receitas.push(reg);
      });
      toast('Receita salva');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Cartão                                                              */
/* ------------------------------------------------------------------ */

export function formCartao(db, existente = null) {
  const c = existente || { fechamento: 5, vencimento: 14, cor: '#7a5af0', ativo: true };
  const corpo = `
    <div class="grade2">
      ${campo('Nome do cartão', `<input name="nome" value="${esc(c.nome || '')}" placeholder="Ex.: Nubank" autofocus>`)}
      ${campo('Banco / instituição', `<input name="banco" value="${esc(c.banco || '')}">`)}
    </div>
    <div class="grade3">
      ${campo('Limite total', inputValor('limite', c.limite))}
      ${campo('Dia de fechamento', `<input type="number" name="fechamento" min="1" max="31" value="${c.fechamento}">`)}
      ${campo('Dia de vencimento', `<input type="number" name="vencimento" min="1" max="31" value="${c.vencimento}">`)}
    </div>
    <div class="grade2">
      ${campo('Conta que paga a fatura', `<select name="contaId">${opcoesContas(db, c.contaId)}</select>`)}
      ${campo('Cor', `<input type="color" name="cor" value="${esc(c.cor)}">`)}
    </div>
    ${existente ? '' : `<fieldset class="bloco">
      <legend>O que já está no cartão hoje</legend>
      <p class="campo__dica">Compras feitas antes de começar a usar o aplicativo. Compras parceladas antigas devem ser lançadas como gastos com a data original, para que as parcelas futuras apareçam.</p>
      <div class="grade2">
        ${campo('Fatura fechada ainda não paga', inputValor('faturaFechada', null), { dica: 'Deixe vazio se não houver.' })}
        ${campo('Já gasto na fatura atual (aberta)', inputValor('faturaAberta', null))}
      </div>
    </fieldset>`}
    <label class="check"><input type="checkbox" name="ativo" ${c.ativo !== false ? 'checked' : ''}><span>Ativo</span></label>`;

  const usado = existente && (db.lancamentos.some((l) => l.cartaoId === existente.id) || db.recorrentes.some((r) => r.cartaoId === existente.id));
  abrirModal({
    titulo: existente ? 'Editar cartão' : 'Novo cartão',
    corpo,
    perigo: existente ? {
      rotulo: 'Excluir', confirmar: usado ? 'Este cartão tem lançamentos. Excluí-lo remove também esses lançamentos e pagamentos. Continuar? (Para manter o histórico, desmarque "Ativo".)' : 'Excluir este cartão?',
      acao: () => store.alterar((d) => {
        d.cartoes = d.cartoes.filter((x) => x.id !== existente.id);
        d.lancamentos = d.lancamentos.filter((l) => l.cartaoId !== existente.id);
        d.recorrentes = d.recorrentes.filter((r) => r.cartaoId !== existente.id);
        d.pagamentosFatura = d.pagamentosFatura.filter((p) => p.cartaoId !== existente.id);
      }),
    } : null,
    aoEnviar(dados) {
      if (!dados.nome.trim()) return 'Informe o nome do cartão.';
      const limite = parseValor(dados.limite);
      if (!(limite >= 0)) return 'Informe o limite total.';
      const fech = Number(dados.fechamento);
      const venc = Number(dados.vencimento);
      if (!(fech >= 1 && fech <= 31 && venc >= 1 && venc <= 31)) return 'Dias de fechamento e vencimento devem estar entre 1 e 31.';
      if (fech === venc) return 'Fechamento e vencimento não podem cair no mesmo dia.';
      const reg = { id: existente?.id || novoId('c'), nome: dados.nome.trim(), banco: dados.banco.trim(), limite, fechamento: fech, vencimento: venc, cor: dados.cor, contaId: dados.contaId, ativo: dados.ativo };
      const iniciais = [];
      if (!existente) {
        const hoje = hojeLocal();
        const aberta = faturaDaCompra(reg, hoje);
        const fechada = faturaPorChave(reg, addMonthsKey(aberta.chave, -1));
        const vf = parseValor(dados.faturaFechada);
        const va = parseValor(dados.faturaAberta);
        if (vf > 0 && fechada.vencimento >= hoje) iniciais.push({ valor: vf, faturaChave: fechada.chave, descricao: 'Saldo da fatura fechada' });
        if (vf > 0 && fechada.vencimento < hoje) iniciais.push({ valor: vf, faturaChave: aberta.chave, descricao: 'Saldo anterior da fatura' });
        if (va > 0) iniciais.push({ valor: va, faturaChave: aberta.chave, descricao: 'Compras anteriores na fatura atual' });
      }
      store.alterar((d) => {
        const i = d.cartoes.findIndex((x) => x.id === reg.id);
        if (i >= 0) d.cartoes[i] = reg; else d.cartoes.push(reg);
        for (const x of iniciais) {
          d.lancamentos.push({ id: novoId('l'), descricao: x.descricao, valor: x.valor, data: hojeLocal(), categoriaId: 'outros', parcelas: 1, forma: 'cartao', cartaoId: reg.id, faturaChave: x.faturaChave, criadoEm: agoraISO() });
        }
      });
      toast('Cartão salvo');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Ações sobre pendências                                              */
/* ------------------------------------------------------------------ */

export function formPagarFatura(db, fatura) {
  const cartao = db.cartoes.find((c) => c.id === fatura.cartaoId);
  abrirModal({
    titulo: `Pagar fatura ${cartao.nome} · ${nomeMes(fatura.chave)}`,
    corpo: `<p class="texto-sec">Total ${fmt(fatura.total)} · em aberto ${fmt(fatura.aberto)} · vence ${fmtData(fatura.vencimento)}</p>
      <div class="grade2">
        ${campo('Valor pago', inputValor('valor', fatura.aberto, 'autofocus'))}
        ${campo('Data do pagamento', `<input type="date" name="data" value="${hojeLocal()}">`)}
      </div>
      ${campo('Pago com a conta', `<select name="contaId">${opcoesContas(db, cartao.contaId)}</select>`)}`,
    rotuloSalvar: 'Registrar pagamento',
    aoEnviar(dados) {
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      store.alterar((d) => d.pagamentosFatura.push({ id: novoId('pf'), cartaoId: cartao.id, chave: fatura.chave, data: dados.data || hojeLocal(), valor: v, contaId: dados.contaId, criadoEm: agoraISO() }));
      toast('Pagamento registrado');
    },
  });
}

export function formConfirmarReceita(db, evento) {
  abrirModal({
    titulo: `Confirmar ${evento.descricao}`,
    corpo: `<p class="texto-sec">Previsto para ${fmtData(evento.data)}: ${fmt(evento.valor)}</p>
      <div class="grade2">
        ${campo('Valor recebido', inputValor('valor', evento.valor, 'autofocus'))}
        ${campo('Data', `<input type="date" name="data" value="${evento.data > hojeLocal() ? evento.data : hojeLocal()}">`)}
      </div>
      ${campo('Conta', `<select name="contaId">${opcoesContas(db, evento.contaId)}</select>`)}`,
    rotuloSalvar: 'Confirmar recebimento',
    aoEnviar(dados) {
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      store.alterar((d) => d.recebimentos.push({ id: novoId('rb'), receitaId: evento.receitaId, competencia: evento.competencia, descricao: evento.descricao, data: dados.data, valor: v, contaId: dados.contaId, criadoEm: agoraISO() }));
      toast('Recebimento confirmado');
    },
  });
}

export function formPagarFixo(db, evento) {
  const r = db.recorrentes.find((x) => x.id === evento.recId);
  abrirModal({
    titulo: `Pagar ${evento.descricao}`,
    corpo: `<p class="texto-sec">Vencimento ${fmtData(evento.data)} · ${nomeMes(evento.competencia)}</p>
      <div class="grade2">
        ${campo('Valor pago', inputValor('valor', -evento.valor, 'autofocus'))}
        ${campo('Data', `<input type="date" name="data" value="${hojeLocal()}">`)}
      </div>
      <div class="grade2">
        ${campo('Forma', `<select name="forma">${opcoes(FORMAS_CONTA, r?.forma && !ehCartao(r.forma) ? r.forma : 'pix')}</select>`)}
        ${campo('Conta', `<select name="contaId">${opcoesContas(db, r?.contaId)}</select>`)}
      </div>`,
    rotuloSalvar: 'Marcar como pago',
    aoEnviar(dados) {
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      // Mantém a divisão do gasto fixo, ajustando proporcionalmente se o valor pago for diferente.
      let divisao = r?.divisao?.length ? r.divisao : null;
      if (divisao && v !== r.valor) divisao = divisaoPorPercentual(v, divisao.map((x) => ({ pessoaId: x.pessoaId, pct: x.valor })));
      store.alterar((d) => d.lancamentos.push({
        id: novoId('l'), descricao: evento.descricao, valor: v, data: dados.data, categoriaId: r?.categoriaId || null, parcelas: 1,
        forma: dados.forma, contaId: dados.contaId, recorrenteId: evento.recId, competencia: evento.competencia,
        responsavelId: r?.responsavelId || null, divisao, criadoEm: agoraISO(),
      }));
      toast('Conta marcada como paga');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Contas, pessoas, categorias, acertos                                */
/* ------------------------------------------------------------------ */

export function formConta(db, existente = null, saldoAtual = null) {
  const c = existente || { ativa: true };
  abrirModal({
    titulo: existente ? `Ajustar ${c.nome}` : 'Nova conta',
    corpo: `${campo('Nome', `<input name="nome" value="${esc(c.nome || '')}" placeholder="Ex.: Conta corrente">`)}
      ${campo('Saldo atual (hoje)', inputValor('saldo', saldoAtual ?? c.saldo ?? 0, 'autofocus'), { dica: 'Confira no app do banco. Lançamentos de hoje registrados antes deste ajuste são considerados incluídos neste saldo.' })}
      <label class="check"><input type="checkbox" name="ativa" ${c.ativa !== false ? 'checked' : ''}><span>Ativa (entra no saldo)</span></label>`,
    perigo: existente && db.contas.length > 1 ? { rotulo: 'Excluir', confirmar: 'Excluir esta conta? Lançamentos ligados a ela passam para a conta principal.', acao: () => store.alterar((d) => { d.contas = d.contas.filter((x) => x.id !== existente.id); }) } : null,
    aoEnviar(dados) {
      const saldo = parseValor(dados.saldo || '0');
      if (!Number.isFinite(saldo)) return 'Saldo inválido.';
      const reg = { ...c, id: c.id || novoId('ct'), nome: dados.nome.trim() || 'Conta', ativa: dados.ativa };
      if (saldo !== saldoAtual || !existente) Object.assign(reg, { saldo, saldoEm: hojeLocal(), saldoAjustadoEm: agoraISO() });
      store.alterar((d) => {
        const i = d.contas.findIndex((x) => x.id === reg.id);
        if (i >= 0) d.contas[i] = reg; else d.contas.push(reg);
      });
      toast('Conta salva');
    },
  });
}

export function formPessoa(db, existente = null) {
  const usada = existente && (db.lancamentos.some((l) => l.responsavelId === existente.id || l.divisao?.some((x) => x.pessoaId === existente.id)) || db.recorrentes.some((r) => r.responsavelId === existente.id || r.divisao?.some((x) => x.pessoaId === existente.id)) || db.acertos.some((a) => a.pessoaId === existente.id));
  abrirModal({
    titulo: existente ? 'Editar pessoa' : 'Nova pessoa',
    corpo: campo('Nome', `<input name="nome" value="${esc(existente?.nome || '')}" autofocus>`),
    perigo: existente && !existente.eu && !usada ? { rotulo: 'Excluir', acao: () => store.alterar((d) => { d.pessoas = d.pessoas.filter((p) => p.id !== existente.id); }) } : null,
    aoEnviar(dados) {
      if (!dados.nome.trim()) return 'Informe o nome.';
      store.alterar((d) => {
        if (existente) d.pessoas.find((p) => p.id === existente.id).nome = dados.nome.trim();
        else d.pessoas.push({ id: novoId('p'), nome: dados.nome.trim() });
      });
    },
  });
}

export function formCategoria(db, existente = null) {
  abrirModal({
    titulo: existente ? 'Editar categoria' : 'Nova categoria',
    corpo: `<div class="grade2">${campo('Nome', `<input name="nome" value="${esc(existente?.nome || '')}" autofocus>`)}${campo('Cor', `<input type="color" name="cor" value="${esc(existente?.cor || '#3f7fe0')}">`)}</div>`,
    perigo: existente ? { rotulo: 'Excluir', confirmar: 'Excluir esta categoria? Os gastos dela ficam "Sem categoria".', acao: () => store.alterar((d) => {
      d.categorias = d.categorias.filter((c) => c.id !== existente.id);
      for (const l of d.lancamentos) if (l.categoriaId === existente.id) l.categoriaId = null;
      for (const r of d.recorrentes) if (r.categoriaId === existente.id) r.categoriaId = null;
    }) } : null,
    aoEnviar(dados) {
      if (!dados.nome.trim()) return 'Informe o nome.';
      store.alterar((d) => {
        if (existente) Object.assign(d.categorias.find((c) => c.id === existente.id), { nome: dados.nome.trim(), cor: dados.cor });
        else d.categorias.push({ id: novoId('cat'), nome: dados.nome.trim(), cor: dados.cor });
      });
    },
  });
}

export function formAcerto(db, pessoa, falta = 0, existente = null) {
  const a = existente || {};
  abrirModal({
    titulo: existente ? 'Editar pagamento' : `Pagamento de ${pessoa.nome}`,
    corpo: `<div class="grade2">
        ${campo('Valor', inputValor('valor', a.valor ?? (falta > 0 ? falta : null), 'autofocus'))}
        ${campo('Data', `<input type="date" name="data" value="${esc(a.data || hojeLocal())}">`)}
      </div>
      ${campo('Entrou em qual conta?', `<select name="contaId"><option value="">Não entrou na conta (ex.: dinheiro em mãos)</option>${opcoes(contasAtivas(db).map((c) => [c.id, c.nome]), existente ? (a.contaId || '') : contasAtivas(db)[0]?.id)}</select>`, { dica: 'Se entrou numa conta, o valor soma ao seu saldo.' })}
      ${campo('Observação', `<input name="obs" value="${esc(a.obs || '')}">`)}`,
    perigo: existente ? { rotulo: 'Excluir', acao: () => store.alterar((d) => { d.acertos = d.acertos.filter((x) => x.id !== existente.id); }) } : null,
    aoEnviar(dados) {
      const { v, erro } = exigirValor(dados.valor);
      if (erro) return erro;
      const reg = { id: a.id || novoId('ac'), pessoaId: pessoa.id, valor: v, data: dados.data, contaId: dados.contaId || null, obs: dados.obs.trim(), criadoEm: a.criadoEm || agoraISO() };
      store.alterar((d) => {
        const i = d.acertos.findIndex((x) => x.id === reg.id);
        if (i >= 0) d.acertos[i] = reg; else d.acertos.push(reg);
      });
      toast('Pagamento registrado');
    },
  });
}

