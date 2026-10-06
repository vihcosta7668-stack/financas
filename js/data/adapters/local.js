/**
 * Armazenamento no próprio navegador (localStorage).
 * Os dados ficam só neste aparelho/navegador. Bom para começar e para uso offline;
 * para usar em mais de um aparelho, conecte o repositório privado (adapters/github.js).
 */

const CHAVE = 'financas.db';

export class LocalAdapter {
  constructor() {
    this.tipo = 'local';
    this.descricao = 'Este navegador';
  }

  async ler() {
    const txt = localStorage.getItem(CHAVE);
    return txt ? JSON.parse(txt) : null;
  }

  async gravar(db) {
    localStorage.setItem(CHAVE, JSON.stringify(db));
  }
}

/** Cópia local usada como cache e plano B quando o repositório remoto não responde. */
export const cacheLocal = {
  ler() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; }
  },
  gravar(db) {
    try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch { /* cota cheia: ignora */ }
  },
  limpar() { localStorage.removeItem(CHAVE); },
};
