/**
 * Ponto de entrada: carrega os dados, calcula a análise e desenha a tela da rota atual.
 *
 * Fluxo: store (dados) → analisar() (regras financeiras) → view.render() (HTML).
 * Toda alteração passa por store.alterar(), que dispara um novo ciclo.
 */

import { store, criarAdapter, lerConexao } from './data/store.js';
import { analisar } from './domain/cashflow.js';
import { gerarAlertas } from './domain/alerts.js';
import { resumoPessoas } from './domain/people.js';
import { dbVazio } from './domain/schema.js';
import { hojeLocal } from './core/dates.js';
import { esc, $, toast, lerForm } from './ui/dom.js';
import { parseValor, fmt } from './core/money.js';
import { abrirModal } from './ui/modal.js';
import * as F from './ui/forms.js';
import { dadosExemplo } from './data/demo.js';

import * as painel from './ui/views/painel.js';
import * as mes from './ui/views/mes.js';
import * as gastos from './ui/views/gastos.js';
import * as fixos from './ui/views/fixos.js';
import * as cartoes from './ui/views/cartoes.js';
import * as pessoas from './ui/views/pessoas.js';
import * as simulador from './ui/views/simulador.js';
import * as ajustes from './ui/views/ajustes.js';

const ROTAS = {
  '/': { view: painel, titulo: 'Visão geral' },
  '/mes': { view: mes, titulo: 'Mês a mês' },
  '/gastos': { view: gastos, titulo: 'Gastos' },
  '/fixos': { view: fixos, titulo: 'Receitas e fixos' },
  '/cartoes': { view: cartoes, titulo: 'Cartões' },
  '/pessoas': { view: pessoas, titulo: 'Pessoas' },
  '/simulador': { view: simulador, titulo: 'Simulador de compra' },
  '/ajustes': { view: ajustes, titulo: 'Ajustes' },
};

/** Estado só da interface (não é salvo): mês selecionado, filtros, simulação em andamento. */
const ui = {};
let ctx = null;

function rotaAtual() {
  const h = location.hash.replace(/^#/, '') || '/';
  return ROTAS[h] ? h : '/';
}

function render() {
  const hoje = hojeLocal();
  const db = store.db;
  const a = analisar(db, hoje);
  ctx = { db, a, hoje, ui, store, alertas: gerarAlertas(db, a), pessoas: resumoPessoas(db, hoje) };
  const rota = rotaAtual();
  const { view, titulo } = ROTAS[rota];
  const main = $('#conteudo');
  const rolagem = window.scrollY;
  const mesmaRota = main.dataset.rota === rota;
  main.innerHTML = view.render(ctx);
  main.dataset.rota = rota;
  $('#titulo-tela').textContent = titulo;
  document.title = `${titulo} · Finanças`;
  document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('ativo', el.getAttribute('href') === `#${rota}`));
  document.querySelector('.nav-mais')?.removeAttribute('open');
  if (mesmaRota) window.scrollTo(0, rolagem);
  else window.scrollTo(0, 0);
  atualizarStatus();
}

function atualizarStatus() {
  const el = $('#status-dados');
  const { estado } = store.status;
  const textos = { ok: store.adapter?.tipo === 'github' ? 'Sincronizado' : 'Salvo neste navegador', salvando: 'Salvando…', pendente: 'Alterações a enviar', erro: 'Erro ao salvar', conflito: 'Conflito de versões' };
  el.textContent = textos[estado] || '';
  el.className = `status status--${estado}`;
}

/* ------------------------------------------------------------------ */
/* Ações (cliques em elementos com data-acao)                         */
/* ------------------------------------------------------------------ */

const eventoPorId = (id) => ctx.a.eventos.find((e) => e.id === id);

const ACOES = {
  ir: (el) => { location.hash = el.dataset.href; },
  'novo-gasto': () => F.formLancamento(store.db),
  'editar-lanc': (el) => { const l = store.db.lancamentos.find((x) => x.id === el.dataset.id); if (l) F.formLancamento(store.db, l); },
  'nova-receita': () => F.formReceita(store.db),
  'editar-receita': (el) => F.formReceita(store.db, store.db.receitas.find((x) => x.id === el.dataset.id)),
  'novo-fixo': () => F.formRecorrente(store.db),
  'editar-fixo': (el) => F.formRecorrente(store.db, store.db.recorrentes.find((x) => x.id === el.dataset.id)),
  'novo-cartao': () => F.formCartao(store.db),
  'editar-cartao': (el) => F.formCartao(store.db, store.db.cartoes.find((x) => x.id === el.dataset.id)),
  'nova-conta': () => F.formConta(store.db),
  'ajustar-conta': (el) => {
    const c = store.db.contas.find((x) => x.id === el.dataset.id);
    const atual = ctx.a.contas.find((x) => x.id === c.id)?.saldoAtual ?? c.saldo;
    F.formConta(store.db, c, atual);
  },
  'nova-pessoa': () => F.formPessoa(store.db),
  'editar-pessoa': (el) => F.formPessoa(store.db, store.db.pessoas.find((x) => x.id === el.dataset.id)),
  'registrar-acerto': (el) => {
    const r = ctx.pessoas.find((p) => p.pessoa.id === el.dataset.id);
    F.formAcerto(store.db, r.pessoa, r.falta);
  },
  'editar-acerto': (el) => {
    const ac = store.db.acertos.find((x) => x.id === el.dataset.id);
    F.formAcerto(store.db, store.db.pessoas.find((p) => p.id === ac.pessoaId), 0, ac);
  },
  'nova-categoria': () => F.formCategoria(store.db),
  'editar-categoria': (el) => F.formCategoria(store.db, store.db.categorias.find((x) => x.id === el.dataset.id)),
  'pagar-fatura': (el) => {
    const f = ctx.a.livro.faturas.find((x) => x.cartaoId === el.dataset.cartao && x.chave === el.dataset.chave);
    if (f) F.formPagarFatura(store.db, f);
  },
  'confirmar-receita': (el) => { const e = eventoPorId(el.dataset.id); if (e) F.formConfirmarReceita(store.db, e); },
  'pagar-fixo': (el) => { const e = eventoPorId(el.dataset.id); if (e) F.formPagarFixo(store.db, e); },
  mes: (el) => { ui.mes = el.dataset.mes; render(); },
  'ir-mes': (el) => { ui.mes = el.dataset.mes; if (rotaAtual() !== '/mes') location.hash = '#/mes'; else render(); },
  'mes-gastos': (el) => { ui.mesGastos = el.dataset.mes; render(); },
  'registrar-simulacao': (el) => {
    const s = ui.simulacao;
    const op = simulador.montarOpcoes(store.db, s)[Number(el.dataset.i)];
    const total = op.valorTotal ?? s.valor;
    F.formLancamento(store.db, null, {
      descricao: s.descricao, valor: total, precoAVista: total !== s.valor ? s.valor : undefined,
      parcelas: op.parcelas || 1, forma: op.tipo === 'cartao' ? 'cartao' : op.tipo === 'carne' ? 'boleto' : 'pix', cartaoId: op.cartaoId, contaId: op.contaId,
    });
  },
  'explicar-termometro': explicarTermometro,
  'carregar-exemplo': () => {
    if (!confirm('Substituir os dados atuais por dados de exemplo fictícios?')) return;
    store.substituir(dadosExemplo(hojeLocal()));
    location.hash = '#/';
    toast('Dados de exemplo carregados');
  },
  'apagar-tudo': () => {
    if (!confirm('Apagar TODOS os dados? Baixe um backup antes, se quiser guardar.')) return;
    store.substituir(dbVazio(hojeLocal()));
    toast('Dados apagados');
  },
  exportar: () => {
    const blob = new Blob([JSON.stringify(store.db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `financas-backup-${hojeLocal()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  desconectar: async () => {
    if (!confirm('Parar de sincronizar com o GitHub? Os dados continuam neste navegador e no repositório.')) return;
    await store.conectar(null, { levarDados: true });
    render();
  },
  'tentar-gravar': () => store.gravarAgora(),
  'recarregar-remoto': async () => { await store.recarregar(); toast('Dados recarregados'); },
};

function explicarTermometro() {
  const t = ctx.a.termometro;
  const L = store.db.config.limiares;
  const p = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  abrirModal({
    titulo: 'Como o termômetro é calculado',
    corpo: `<p>O termômetro olha para dois números e mostra o pior estado entre eles.</p>
      <h3>1. Folga</h3>
      <p>Livre para gastar hoje ÷ renda mensal recorrente. Hoje: <strong>${p(t.folga)}</strong>.</p>
      <p class="texto-sec">"Livre para gastar" é o ponto mais baixo do saldo projetado nos próximos ${store.db.config.horizonteMeses} meses (já contando receitas, contas fixas, faturas, parcelas e a estimativa de gasto variável), menos a reserva mínima. Abaixo de zero: crítico. Abaixo de ${p(L.folgaAmarelo)} da renda: atenção.</p>
      <h3>2. Comprometimento</h3>
      <p>Compromissos dos próximos 90 dias ÷ receitas dos próximos 90 dias. Hoje: <strong>${p(t.comprometimento)}</strong> (${esc(fmt(t.obrigacoes90))} de ${esc(fmt(t.receitas90))}).</p>
      <p class="texto-sec">Mostra quanto do dinheiro que ainda vai entrar já tem destino. A partir de ${p(L.comprometimentoAmarelo)}: atenção. A partir de ${p(L.comprometimentoVermelho)}: crítico.</p>
      <p class="texto-sec">Os limites podem ser alterados em Ajustes.</p>`,
  });
}

/* ------------------------------------------------------------------ */
/* Formulários dentro das telas                                        */
/* ------------------------------------------------------------------ */

const FORMS = {
  simular(form) {
    const s = simulador.lerSimulacao(form);
    if (!(s.valor > 0)) { toast('Informe o preço à vista', 'erro'); return; }
    ui.simulacao = s;
    render();
    document.querySelector('.sim__resultados')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  config(form) {
    const d = lerForm(form);
    const reserva = parseValor(d.reservaMinima || '0');
    const variavel = d.gastoVariavelMensal.trim() ? parseValor(d.gastoVariavelMensal) : null;
    if (!Number.isFinite(reserva) || (variavel !== null && !Number.isFinite(variavel))) { toast('Valor inválido', 'erro'); return; }
    const fr = (n) => Math.max(0, Number(d[n]) || 0) / 100;
    store.alterar((db) => {
      Object.assign(db.config, {
        reservaMinima: reserva,
        gastoVariavelMensal: variavel,
        horizonteMeses: Math.min(36, Math.max(1, Number(d.horizonteMeses) || 12)),
        mesesCascata: Math.min(6, Math.max(0, Number(d.mesesCascata) || 0)),
        dataInicio: d.dataInicio || db.config.dataInicio,
      });
      Object.assign(db.config.limiares, {
        folgaAmarelo: fr('folgaAmarelo'), comprometimentoAmarelo: fr('comprometimentoAmarelo'), comprometimentoVermelho: fr('comprometimentoVermelho'),
        limiteCartaoAlerta: fr('limiteCartaoAlerta'), diasAlertaVencimento: Math.max(0, Number(d.diasAlertaVencimento) || 0),
      });
    });
    toast('Parâmetros salvos');
  },
  async github(form) {
    const d = lerForm(form);
    const anterior = lerConexao();
    const con = { tipo: 'github', owner: d.owner.trim(), repo: d.repo.trim(), branch: d.branch.trim() || 'main', path: d.path.trim() || 'financas.json', token: d.token.trim() || anterior?.token };
    if (!con.owner || !con.repo || !con.token) { toast('Preencha usuário, repositório e token', 'erro'); return; }
    try {
      const info = await criarAdapter(con).testar();
      if (!info.privado && !confirm('ATENÇÃO: este repositório é PÚBLICO. Seus dados financeiros ficariam visíveis para qualquer pessoa. Continuar mesmo assim?')) return;
      if (info.permissoes && !info.permissoes.push) { toast('O token não tem permissão de escrita neste repositório', 'erro'); return; }
      await store.conectar(con, { levarDados: d.modo !== 'carregar' });
      toast('Conectado ao repositório');
      render();
    } catch (e) {
      toast(e.message, 'erro');
    }
  },
};

/* ------------------------------------------------------------------ */
/* Inicialização                                                       */
/* ------------------------------------------------------------------ */

function ligarEventos() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-acao]');
    if (!el || el.closest('dialog')) return;
    const fn = ACOES[el.dataset.acao];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form || form.closest('dialog')) return;
    e.preventDefault();
    FORMS[form.dataset.form]?.(form);
  });
  // Filtros da tela de gastos (atualizam sem perder o foco da busca)
  document.addEventListener('input', (e) => {
    const k = e.target.dataset?.filtro;
    if (!k) return;
    ui[k] = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const novo = document.querySelector(`[data-filtro="${k}"]`);
    if (novo && e.target.type === 'search') { novo.focus(); novo.setSelectionRange(pos, pos); }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.dataset?.acaoArquivo !== 'importar') return;
    const arq = e.target.files[0];
    if (!arq) return;
    try {
      const db = JSON.parse(await arq.text());
      if (!db || !Array.isArray(db.lancamentos)) throw new Error('Arquivo não parece um backup deste aplicativo.');
      if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
      store.substituir(db);
      toast('Backup importado');
    } catch (err) {
      toast(err.message, 'erro');
    }
  });
  // Atalho de teclado: N abre "novo gasto"
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      F.formLancamento(store.db);
    }
  });
  window.addEventListener('hashchange', render);
  // Gráficos têm largura diferente no celular: redesenha ao cruzar o limite
  let largura = window.innerWidth < 600;
  window.addEventListener('resize', () => { const agora = window.innerWidth < 600; if (agora !== largura && store.db && !document.querySelector('dialog[open]')) { largura = agora; render(); } });
  // Ao voltar para a aba no dia seguinte, recalcula com a nova data
  document.addEventListener('visibilitychange', () => { if (!document.hidden && store.db) render(); });
}

async function iniciar() {
  ligarEventos();
  await store.iniciar();
  store.ouvir(() => render());
  render();
}

iniciar().catch((e) => {
  console.error(e);
  $('#conteudo').innerHTML = `<section class="cartao-ui"><h2>Não foi possível iniciar</h2><p>${esc(e.message)}</p></section>`;
});
