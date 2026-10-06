/**
 * Modelo de dados.
 *
 * Toda a base fica num único documento JSON (ver docs/ARQUITETURA.md, seção 3).
 * Valores monetários em centavos; datas em "AAAA-MM-DD"; meses em "AAAA-MM".
 * Ao mudar a estrutura, incremente VERSAO e escreva o passo em `migrar`.
 */

export const VERSAO = 1;

/** Formas de pagamento e se saem da conta ou vão para a fatura. */
export const FORMAS = {
  pix: { nome: 'Pix', meio: 'conta' },
  debito: { nome: 'Débito', meio: 'conta' },
  transferencia: { nome: 'Transferência', meio: 'conta' },
  dinheiro: { nome: 'Dinheiro', meio: 'conta' },
  boleto: { nome: 'Boleto', meio: 'conta' },
  cartao: { nome: 'Cartão de crédito', meio: 'cartao' },
};

export const ehCartao = (forma) => FORMAS[forma]?.meio === 'cartao';

export const CATEGORIAS_PADRAO = [
  ['alimentacao', 'Alimentação', '#e07a3f'],
  ['transporte', 'Transporte', '#3f7fe0'],
  ['moradia', 'Moradia', '#7a5af0'],
  ['saude', 'Saúde', '#d0465f'],
  ['lazer', 'Lazer', '#1fa38a'],
  ['compras', 'Compras', '#c9a227'],
  ['educacao', 'Educação', '#2f9bc4'],
  ['assinaturas', 'Assinaturas', '#8a64b8'],
  ['viagens', 'Viagens', '#43a047'],
  ['outros', 'Outros', '#8a8f98'],
];

export function novoId(prefixo = 'id') {
  const r = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
  return `${prefixo}_${r.replace(/-/g, '').slice(0, 12)}`;
}

export function agoraISO() {
  return new Date().toISOString();
}

/** Base vazia, pronta para o primeiro uso. */
export function dbVazio(hoje) {
  return {
    versao: VERSAO,
    atualizadoEm: agoraISO(),
    config: {
      // Tudo que vence antes desta data é considerado já resolvido (faturas e contas antigas).
      dataInicio: hoje,
      // Até quantos meses à frente o fluxo de caixa é projetado.
      horizonteMeses: 12,
      // Valor que o painel nunca considera disponível (colchão de segurança), em centavos.
      reservaMinima: 0,
      // Estimativa de gasto variável por mês para os meses futuros. null = média automática.
      gastoVariavelMensal: null,
      // Meses exibidos na cascata do painel (0 = só o mês atual, 1 = atual + próximo).
      mesesCascata: 1,
      limiares: {
        folgaAmarelo: 0.10, // folga abaixo de 10% da renda mensal → atenção
        comprometimentoAmarelo: 0.70, // 70% da renda dos próximos 3 meses já comprometida → atenção
        comprometimentoVermelho: 0.90,
        limiteCartaoAlerta: 0.20,
        diasAlertaVencimento: 3,
      },
    },
    contas: [
      { id: 'conta_principal', nome: 'Conta principal', saldo: 0, saldoEm: hoje, saldoAjustadoEm: agoraISO(), ativa: true },
    ],
    cartoes: [],
    pessoas: [{ id: 'eu', nome: 'Eu', eu: true }],
    categorias: CATEGORIAS_PADRAO.map(([id, nome, cor]) => ({ id, nome, cor })),
    receitas: [],
    recorrentes: [],
    lancamentos: [],
    recebimentos: [],
    pagamentosFatura: [],
    acertos: [],
  };
}

const COLECOES = ['contas', 'cartoes', 'pessoas', 'categorias', 'receitas', 'recorrentes',
  'lancamentos', 'recebimentos', 'pagamentosFatura', 'acertos'];

/**
 * Garante que uma base lida do armazenamento tem todos os campos esperados.
 * Preenche o que faltar com o padrão, sem apagar nada que já exista.
 */
export function migrar(db, hoje) {
  const base = dbVazio(hoje);
  if (!db || typeof db !== 'object') return base;
  const out = { ...db };
  out.config = { ...base.config, ...(db.config || {}), limiares: { ...base.config.limiares, ...(db.config?.limiares || {}) } };
  for (const c of COLECOES) if (!Array.isArray(out[c])) out[c] = base[c];
  if (!out.pessoas.some((p) => p.eu)) out.pessoas.unshift({ id: 'eu', nome: 'Eu', eu: true });
  if (!out.contas.length) out.contas = base.contas;
  // Futuras migrações: if (out.versao < 2) { ... out.versao = 2; }
  out.versao = VERSAO;
  return out;
}

/** Pessoa "eu" (dona do aplicativo). */
export const pessoaEu = (db) => db.pessoas.find((p) => p.eu);
