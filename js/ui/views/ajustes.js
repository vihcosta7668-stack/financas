/** Ajustes: contas e saldos, categorias, parâmetros de cálculo, armazenamento e backup. */

import { esc } from '../dom.js';
import { fmt, paraCampo } from '../../core/money.js';
import { fmtData } from '../../core/dates.js';
import { pontoCor, pilula } from '../components.js';
import { lerConexao } from '../../data/store.js';

const pct = (x) => Math.round(x * 100);

export function render(ctx) {
  const { db, a, store } = ctx;
  const cfg = db.config;
  const L = cfg.limiares;
  const con = lerConexao();
  const st = store.status;
  const auto = a.estimativa.origem !== 'manual';

  return `
  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Contas e saldo</h2><button class="btn btn--sec" data-acao="nova-conta">+ Conta</button></header>
    <p class="texto-sec">O saldo é o ponto de partida de todos os cálculos. Confira com o app do banco de vez em quando e ajuste aqui.</p>
    <ul class="tabela tabela--cad">${a.contas.map((c) => `<li>
      <span class="tabela__desc"><strong>${esc(c.nome)}</strong><small>ajustado em ${fmtData(c.saldoEm)} para ${fmt(c.saldo)}</small></span>
      <span class="num ${c.saldoAtual < 0 ? 'neg' : ''}">${fmt(c.saldoAtual)}</span>
      <button class="btn btn--mini" data-acao="ajustar-conta" data-id="${esc(c.id)}">Ajustar saldo</button>
    </li>`).join('')}
    ${db.contas.filter((c) => c.ativa === false).map((c) => `<li class="inativo"><span class="tabela__desc"><strong>${esc(c.nome)}</strong> ${pilula('inativa')}</span><span></span><button class="btn btn--mini" data-acao="ajustar-conta" data-id="${esc(c.id)}">Editar</button></li>`).join('')}</ul>
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Como o painel calcula</h2></header>
    <form data-form="config" class="config">
      <div class="grade2">
        <label class="campo"><span class="campo__rotulo">Reserva mínima</span><input name="reservaMinima" inputmode="decimal" value="${esc(paraCampo(cfg.reservaMinima))}"><span class="campo__dica">Valor que o painel nunca considera disponível.</span></label>
        <label class="campo"><span class="campo__rotulo">Gasto variável previsto por mês</span><input name="gastoVariavelMensal" inputmode="decimal" placeholder="automático" value="${esc(auto ? '' : paraCampo(cfg.gastoVariavelMensal))}">
          <span class="campo__dica">${auto ? (a.estimativa.origem === 'media' ? `Automático: média de ${a.estimativa.meses} ${a.estimativa.meses === 1 ? 'mês' : 'meses'} = ${fmt(a.estimativa.valor)}.` : 'Automático, mas ainda sem histórico — informe um valor para a projeção não ficar otimista.') : 'Deixe vazio para usar a média dos últimos 3 meses.'} Usado só nos meses futuros.</span></label>
      </div>
      <div class="grade3">
        <label class="campo"><span class="campo__rotulo">Meses projetados</span><input type="number" name="horizonteMeses" min="1" max="36" value="${cfg.horizonteMeses}"></label>
        <label class="campo"><span class="campo__rotulo">Meses na cascata do painel</span><input type="number" name="mesesCascata" min="0" max="6" value="${cfg.mesesCascata}"><span class="campo__dica">0 = só este mês; 1 = este e o próximo.</span></label>
        <label class="campo"><span class="campo__rotulo">Início do controle</span><input type="date" name="dataInicio" value="${esc(cfg.dataInicio)}"><span class="campo__dica">Faturas e contas que venceram antes desta data são consideradas quitadas.</span></label>
      </div>
      <details class="mais">
        <summary>Limites do termômetro e dos alertas</summary>
        <div class="grade3">
          <label class="campo"><span class="campo__rotulo">Folga mínima (% da renda)</span><input type="number" name="folgaAmarelo" min="0" max="100" value="${pct(L.folgaAmarelo)}"></label>
          <label class="campo"><span class="campo__rotulo">Comprometimento: atenção (%)</span><input type="number" name="comprometimentoAmarelo" min="0" max="200" value="${pct(L.comprometimentoAmarelo)}"></label>
          <label class="campo"><span class="campo__rotulo">Comprometimento: crítico (%)</span><input type="number" name="comprometimentoVermelho" min="0" max="200" value="${pct(L.comprometimentoVermelho)}"></label>
          <label class="campo"><span class="campo__rotulo">Alerta de limite do cartão (%)</span><input type="number" name="limiteCartaoAlerta" min="0" max="100" value="${pct(L.limiteCartaoAlerta)}"></label>
          <label class="campo"><span class="campo__rotulo">Avisar vencimentos com (dias)</span><input type="number" name="diasAlertaVencimento" min="0" max="15" value="${L.diasAlertaVencimento}"></label>
        </div>
      </details>
      <button class="btn btn--pri" type="submit">Salvar parâmetros</button>
    </form>
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Categorias</h2><button class="btn btn--sec" data-acao="nova-categoria">+ Categoria</button></header>
    <div class="chips">${db.categorias.map((c) => `<button class="chip-btn" data-acao="editar-categoria" data-id="${esc(c.id)}">${pontoCor(c.cor)}${esc(c.nome)}</button>`).join('')}</div>
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Onde os dados ficam</h2>${statusPilula(st)}</header>
    <p>Destino atual: <strong>${con?.tipo === 'github' ? `repositório privado ${esc(con.owner)}/${esc(con.repo)} (${esc(con.path)})` : 'somente este navegador'}</strong>.</p>
    ${st.msg ? `<p class="aviso">${esc(st.msg)}</p>` : ''}
    ${st.estado === 'conflito' ? '<button class="btn btn--pri" data-acao="recarregar-remoto">Descartar as alterações deste aparelho e recarregar</button>' : ''}
    ${['erro', 'pendente'].includes(st.estado) && con?.tipo === 'github' ? '<button class="btn btn--sec" data-acao="tentar-gravar">Tentar enviar de novo</button>' : ''}
    <details class="mais" ${con?.tipo === 'github' ? '' : 'open'}>
      <summary>${con?.tipo === 'github' ? 'Alterar conexão com o GitHub' : 'Guardar os dados num repositório privado do GitHub'}</summary>
      <ol class="passos">
        <li>Crie um repositório <strong>privado</strong> só para os dados (ex.: <code>financas-dados</code>). Pode ser vazio, com um README.</li>
        <li>Em GitHub → Settings → Developer settings → Personal access tokens → <em>Fine-grained tokens</em>, gere um token com acesso <strong>apenas a esse repositório</strong> e permissão <strong>Contents: Read and write</strong>. Defina uma data de expiração.</li>
        <li>Preencha abaixo. O token fica salvo só neste navegador e é enviado apenas para api.github.com.</li>
      </ol>
      <form data-form="github" class="config">
        <div class="grade2">
          <label class="campo"><span class="campo__rotulo">Usuário ou organização</span><input name="owner" value="${esc(con?.owner || '')}" autocomplete="off" required></label>
          <label class="campo"><span class="campo__rotulo">Repositório privado</span><input name="repo" value="${esc(con?.repo || '')}" autocomplete="off" required></label>
        </div>
        <div class="grade2">
          <label class="campo"><span class="campo__rotulo">Branch</span><input name="branch" value="${esc(con?.branch || 'main')}"></label>
          <label class="campo"><span class="campo__rotulo">Arquivo</span><input name="path" value="${esc(con?.path || 'financas.json')}"></label>
        </div>
        <label class="campo"><span class="campo__rotulo">Token (fine-grained)</span><input name="token" type="password" autocomplete="off" placeholder="${con?.token ? 'manter o token salvo' : 'github_pat_…'}"></label>
        <fieldset class="bloco">
          <legend>Ao conectar</legend>
          <label class="check"><input type="radio" name="modo" value="enviar" checked><span>Enviar os dados deste aparelho para o repositório</span></label>
          <label class="check"><input type="radio" name="modo" value="carregar"><span>Carregar os dados que já estão no repositório</span></label>
        </fieldset>
        <button class="btn btn--pri" type="submit">Testar e conectar</button>
        ${con?.tipo === 'github' ? '<button class="btn btn--sec" type="button" data-acao="desconectar">Desconectar (voltar a guardar só neste navegador)</button>' : ''}
      </form>
    </details>
  </section>

  <section class="cartao-ui">
    <header class="cartao-ui__topo"><h2>Backup</h2></header>
    <div class="botoes">
      <button class="btn btn--sec" data-acao="exportar">Baixar backup (.json)</button>
      <label class="btn btn--sec">Importar backup<input type="file" accept="application/json,.json" data-acao-arquivo="importar" hidden></label>
      <button class="btn btn--sec" data-acao="carregar-exemplo">Carregar dados de exemplo</button>
      <button class="btn btn--perigo" data-acao="apagar-tudo">Apagar todos os dados</button>
    </div>
    <p class="texto-sec">Última alteração: ${db.atualizadoEm ? new Date(db.atualizadoEm).toLocaleString('pt-BR') : '—'}</p>
  </section>`;
}

function statusPilula(st) {
  const mapa = { ok: ['salvo', 'verde'], salvando: ['salvando…', 'amarelo'], pendente: ['alterações a enviar', 'amarelo'], erro: ['erro ao salvar', 'vermelho'], conflito: ['conflito', 'vermelho'] };
  const [t, tom] = mapa[st.estado] || mapa.ok;
  return pilula(t, tom);
}
