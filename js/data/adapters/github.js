/**
 * Armazenamento num repositório PRIVADO do GitHub, via API REST de conteúdo.
 *
 * O código do aplicativo fica no repositório público (GitHub Pages); os dados ficam em
 * outro repositório, privado, num único arquivo JSON. O navegador lê e grava esse arquivo
 * diretamente em api.github.com usando um token de acesso pessoal (fine-grained) que:
 *   - é digitado por você na tela de Ajustes;
 *   - fica salvo apenas no localStorage deste navegador;
 *   - nunca é escrito no código nem enviado a nenhum outro servidor.
 *
 * Cada gravação vira um commit no repositório privado, o que dá histórico e backup de graça.
 * Conflitos (dois aparelhos gravando ao mesmo tempo) são detectados pelo `sha` do arquivo.
 */

const API = 'https://api.github.com';

export class ConflitoError extends Error {
  constructor() {
    super('Os dados foram alterados em outro aparelho. Recarregue para obter a versão mais recente.');
    this.name = 'ConflitoError';
  }
}

function paraBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function deBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubAdapter {
  /**
   * @param {{owner:string, repo:string, path?:string, branch?:string, token:string}} cfg
   */
  constructor(cfg) {
    this.tipo = 'github';
    this.cfg = { path: 'financas.json', branch: 'main', ...cfg };
    this.descricao = `GitHub · ${this.cfg.owner}/${this.cfg.repo}`;
    this.sha = null;
  }

  url() {
    const { owner, repo, path } = this.cfg;
    return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  headers() {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async ler() {
    const res = await fetch(`${this.url()}?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) { this.sha = null; return null; } // arquivo ainda não existe
    if (!res.ok) throw await erroDaApi(res);
    const json = await res.json();
    this.sha = json.sha;
    // Arquivos acima de 1 MB vêm sem `content`; nesse caso busca o conteúdo bruto.
    if (!json.content && json.download_url) {
      const raw = await fetch(this.url() + `?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: { ...this.headers(), Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
      return JSON.parse(await raw.text());
    }
    return JSON.parse(deBase64(json.content));
  }

  async gravar(db) {
    const body = {
      message: `Atualização ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      content: paraBase64(JSON.stringify(db, null, 2)),
      branch: this.cfg.branch,
    };
    if (this.sha) body.sha = this.sha;
    const res = await fetch(this.url(), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 409 || (res.status === 422 && !this.sha)) throw new ConflitoError();
    if (!res.ok) throw await erroDaApi(res);
    const json = await res.json();
    this.sha = json.content.sha;
  }

  /** Verifica acesso antes de salvar a conexão. */
  async testar() {
    const { owner, repo } = this.cfg;
    const res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: this.headers() });
    if (!res.ok) throw await erroDaApi(res);
    const info = await res.json();
    return { privado: info.private, permissoes: info.permissions };
  }
}

async function erroDaApi(res) {
  let msg = '';
  try { msg = (await res.json()).message; } catch { /* sem corpo */ }
  const dicas = {
    401: 'Token inválido ou expirado.',
    403: 'O token não tem permissão de leitura e escrita de conteúdo neste repositório, ou o limite de requisições foi atingido.',
    404: 'Repositório não encontrado — confira o dono, o nome e se o token tem acesso a ele.',
  };
  const e = new Error(`${dicas[res.status] || 'Falha ao acessar o GitHub.'} (${res.status}${msg ? `: ${msg}` : ''})`);
  e.status = res.status;
  return e;
}
