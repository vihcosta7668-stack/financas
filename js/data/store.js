/**
 * Estado da aplicação e persistência.
 *
 * As telas nunca gravam dados diretamente: chamam `store.alterar(fn)`, que aplica a mudança,
 * guarda uma cópia local imediatamente e agenda a gravação no destino configurado
 * (navegador ou repositório privado no GitHub).
 *
 * Para trocar o JSON por um banco de dados real no futuro, basta criar outro adapter com os
 * métodos `ler()` e `gravar(db)` — nenhuma tela e nenhuma regra financeira precisa mudar.
 */

import { migrar, agoraISO } from '../domain/schema.js';
import { hojeLocal } from '../core/dates.js';
import { LocalAdapter, cacheLocal } from './adapters/local.js';
import { GitHubAdapter, ConflitoError } from './adapters/github.js';

const CHAVE_CONEXAO = 'financas.conexao';
const CHAVE_PENDENTE = 'financas.pendente';

export function lerConexao() {
  try { return JSON.parse(localStorage.getItem(CHAVE_CONEXAO) || 'null'); } catch { return null; }
}

export function salvarConexao(con) {
  if (con) localStorage.setItem(CHAVE_CONEXAO, JSON.stringify(con));
  else localStorage.removeItem(CHAVE_CONEXAO);
}

export function criarAdapter(con) {
  return con?.tipo === 'github' ? new GitHubAdapter(con) : new LocalAdapter();
}

class Store {
  constructor() {
    this.db = null;
    this.adapter = null;
    this.ouvintes = new Set();
    this.status = { estado: 'ok', msg: '' }; // ok | salvando | pendente | erro | conflito
    this.timer = null;
  }

  async iniciar() {
    this.adapter = criarAdapter(lerConexao());
    const hoje = hojeLocal();
    const pendente = localStorage.getItem(CHAVE_PENDENTE) === '1';
    try {
      const remoto = await this.adapter.ler();
      const cache = cacheLocal.ler();
      if (this.adapter.tipo === 'github' && pendente && cache) {
        // Havia alterações locais não enviadas: mantém as locais e tenta enviá-las.
        this.db = migrar(cache, hoje);
        this.agendarGravacao(0);
      } else {
        this.db = migrar(remoto ?? cache, hoje);
        if (!remoto && this.adapter.tipo === 'github') this.agendarGravacao(0);
      }
    } catch (e) {
      this.db = migrar(cacheLocal.ler(), hoje);
      this.setStatus('erro', `Sem acesso aos dados remotos; usando a cópia deste aparelho. ${e.message}`);
    }
    cacheLocal.gravar(this.db);
    return this.db;
  }

  ouvir(fn) {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  notificar() {
    for (const fn of this.ouvintes) fn(this.db, this.status);
  }

  setStatus(estado, msg = '') {
    this.status = { estado, msg };
    this.notificar();
  }

  /** Aplica uma alteração na base e agenda a gravação. */
  alterar(fn) {
    fn(this.db);
    this.db.atualizadoEm = agoraISO();
    cacheLocal.gravar(this.db);
    this.agendarGravacao();
    this.notificar();
  }

  /** Substitui a base inteira (importação, dados de exemplo, apagar tudo). */
  substituir(db) {
    this.db = migrar(db, hojeLocal());
    this.alterar(() => {});
  }

  agendarGravacao(atraso = 1200) {
    if (this.adapter.tipo === 'local') { this.setStatus('ok'); return; } // o cache já é o armazenamento
    localStorage.setItem(CHAVE_PENDENTE, '1');
    this.status = { estado: 'pendente', msg: '' };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.gravarAgora(), atraso);
  }

  async gravarAgora() {
    clearTimeout(this.timer);
    this.setStatus('salvando');
    try {
      await this.adapter.gravar(this.db);
      localStorage.removeItem(CHAVE_PENDENTE);
      this.setStatus('ok');
    } catch (e) {
      this.setStatus(e instanceof ConflitoError ? 'conflito' : 'erro', e.message);
    }
  }

  /** Descarta a cópia local e recarrega do destino (usado após conflito). */
  async recarregar() {
    localStorage.removeItem(CHAVE_PENDENTE);
    const remoto = await this.adapter.ler();
    this.db = migrar(remoto, hojeLocal());
    cacheLocal.gravar(this.db);
    this.setStatus('ok');
  }

  /** Troca o destino dos dados. `levarDados` envia a base atual para o novo destino. */
  async conectar(con, { levarDados }) {
    const novo = criarAdapter(con);
    if (!levarDados) {
      const remoto = await novo.ler();
      if (remoto) this.db = migrar(remoto, hojeLocal());
    } else if (novo.tipo === 'github') {
      await novo.ler(); // obtém o sha atual, se o arquivo já existir
    }
    this.adapter = novo;
    salvarConexao(con);
    cacheLocal.gravar(this.db);
    if (novo.tipo === 'github') await this.gravarAgora();
    else this.setStatus('ok');
  }
}

export const store = new Store();
