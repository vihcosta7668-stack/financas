# Arquitetura e regras de cálculo

Este documento registra as decisões do projeto e as fórmulas usadas. Quando uma regra mudar no código, atualize a seção correspondente.

## 1. Visão geral

Aplicação web estática (HTML, CSS e JavaScript em módulos ES), sem etapa de build e sem dependências em tempo de execução. Roda direto no GitHub Pages e no navegador do celular.

```
index.html ──► js/main.js ──► store (dados) ──► analisar() (regras) ──► view.render() (HTML)
                                   ▲                                          │
                                   └──────── store.alterar() ◄── formulários ─┘
```

O ciclo é sempre o mesmo: os formulários registram fatos na base; a cada alteração a análise é recalculada do zero a partir desses fatos; as telas apenas exibem o resultado. Nenhuma tela faz conta financeira própria, e nenhum total fica salvo — tudo é derivado. Isso elimina a classe de erro em que um saldo salvo deixa de bater com os lançamentos.

### Por que sem framework

- O GitHub Pages serve arquivos estáticos; qualquer framework exigiria build e um passo extra de publicação.
- O aplicativo guarda um token de acesso no navegador (seção 6). Não carregar scripts de terceiros (CDN de gráficos, analytics) reduz a superfície de ataque. A Content-Security-Policy do `index.html` bloqueia qualquer script que não seja deste site.
- O volume de dados de uma pessoa é pequeno; recalcular tudo a cada alteração leva poucos milissegundos.

Se no futuro a interface crescer a ponto de pedir um framework, a camada `js/domain` (regras) não depende do DOM e pode ser reaproveitada sem mudanças.

## 2. Estrutura de pastas

| Pasta | Conteúdo | Depende de |
|---|---|---|
| `js/core/` | Datas (`dates.js`) e dinheiro em centavos (`money.js`) | nada |
| `js/domain/` | Regras financeiras: modelo (`schema`), ciclo de fatura (`cards`), livro de eventos (`ledger`), fluxo de caixa (`cashflow`), termômetro, simulador, pessoas, alertas | `core` |
| `js/data/` | Estado e persistência: `store.js` e adapters (`local`, `github`), dados de exemplo | `domain`, `core` |
| `js/ui/` | Componentes, formulários, modal e uma view por tela | todas as anteriores |
| `tests/` | Testes do motor financeiro (`node --test tests/*.test.mjs`) | `domain`, `core` |

A regra de dependência é de cima para baixo: `domain` nunca importa `ui` nem `data`. É isso que permite testar as regras no Node, sem navegador.

## 3. Modelo de dados

Toda a base é um único documento JSON. Valores em **centavos inteiros**; datas em `"AAAA-MM-DD"`; meses em `"AAAA-MM"`.

| Coleção | O que guarda | Campos principais |
|---|---|---|
| `config` | Parâmetros de cálculo | `dataInicio`, `horizonteMeses`, `reservaMinima`, `gastoVariavelMensal`, `mesesCascata`, `limiares` |
| `contas` | Contas e o último saldo conferido | `saldo`, `saldoEm`, `saldoAjustadoEm` |
| `cartoes` | Cartões de crédito | `limite`, `fechamento`, `vencimento`, `contaId` (conta que paga), `cor`, `ativo` |
| `pessoas` | Pessoas que dividem despesas; uma delas tem `eu: true` | `nome` |
| `categorias` | Categorias configuráveis | `nome`, `cor` |
| `receitas` | Receitas recorrentes ou únicas | `valor`, `dia`, `intervaloMeses` (0 = única), `inicio`, `fim`, `contaId` |
| `recorrentes` | Gastos fixos | `valor`, `dia`, `forma`, `contaId`/`cartaoId`, `intervaloMeses`, `inicio`, `fim`, `responsavelId`, `divisao` |
| `lancamentos` | Gastos variáveis, compras parceladas e pagamentos de gastos fixos | `valor` (total), `data`, `forma`, `contaId`/`cartaoId`, `parcelas`, `faturaChave?`, `divisao`, `recorrenteId?`, `competencia?`, `criadoEm` |
| `recebimentos` | Confirmação de que uma receita entrou | `receitaId`, `competencia`, `data`, `valor`, `contaId` |
| `pagamentosFatura` | Pagamento de fatura | `cartaoId`, `chave` (mês de vencimento), `data`, `valor`, `contaId` |
| `acertos` | Pagamentos que outras pessoas fizeram a você | `pessoaId`, `valor`, `data`, `contaId?` |

**Por que um arquivo e não nove.** Com arquivos separados, uma alteração que mexe em duas coleções (pagar um gasto fixo cria um lançamento e muda uma pendência) exigiria dois commits; se o segundo falhar, a base fica inconsistente. Um documento único é gravado de forma atômica, gera um commit por alteração e tem um único `sha` para detectar conflito. O volume esperado (alguns milhares de lançamentos por ano) cabe com folga.

**Evolução.** `schema.js` tem `VERSAO` e a função `migrar()`. Ao mudar a estrutura, incremente a versão e escreva o passo de migração; bases antigas são atualizadas ao abrir.

## 4. Regras financeiras

### 4.1 Três tipos de dinheiro

| Conceito | O que é | Onde aparece |
|---|---|---|
| Saldo real | Dinheiro na conta agora | "Saldo em conta" |
| Dinheiro futuro | Receitas ainda não recebidas | "A receber"; nunca entra no saldo antes de confirmado |
| Limite do cartão | Quanto o banco aceita cobrar | Tela Cartões; **nunca** somado a nada |

### 4.2 Saldo atual

```
saldo atual = saldo informado no último ajuste
            + movimentos da conta registrados depois do ajuste e com data até hoje
```

Movimentos de conta: lançamentos via Pix/débito/transferência/dinheiro/boleto (saída), recebimentos (entrada), pagamentos de fatura (saída), acertos com conta de destino (entrada).

Um movimento com a mesma data do ajuste só é somado se foi registrado depois do ajuste (`criadoEm > saldoAjustadoEm`). Movimentos com data anterior ao ajuste já estão no saldo informado. Isso permite conferir o saldo no app do banco a qualquer momento sem descontar nada duas vezes.

### 4.3 Livro de eventos (`ledger.js`)

Os cadastros viram três listas:

- **movConta** — entradas e saídas de conta (realizadas ou agendadas para datas futuras, como parcelas de carnê).
- **itensCartao** — cobranças em cartão, uma por parcela, já alocadas na fatura correta. Gastos fixos no cartão geram um item por mês automaticamente.
- **pendências** — o que ainda vai acontecer: receitas não confirmadas, gastos fixos na conta ainda não pagos e faturas com valor em aberto.

Regras que impedem contagem dupla:

1. Compra no cartão nunca gera movimento de conta. Ela entra na fatura; só a fatura (pendência) ou o pagamento dela (movimento) afeta a conta.
2. Gasto fixo marcado como pago vira lançamento com `recorrenteId` + `competencia` e deixa de ser pendência daquele mês.
3. Receita confirmada vira recebimento e deixa de ser "a receber" daquele mês.
4. Pagamento de fatura reduz o valor em aberto da fatura na mesma medida em que reduz o saldo.
5. Tudo que venceu antes de `config.dataInicio` é considerado resolvido (faturas e contas antigas não aparecem como atrasadas).

### 4.4 Ciclo da fatura (`cards.js`)

- Compra **antes** do dia de fechamento → fatura que fecha neste mês.
- Compra **no** dia do fechamento **ou depois** → fatura seguinte (o "melhor dia de compra").
- Vencimento no mesmo mês do fechamento se `vencimento > fechamento` (fecha 5, vence 14); no mês seguinte se menor (fecha 28, vence 7).
- A parcela *k* de uma compra cai *k* faturas depois da primeira.
- Dias inexistentes (31 em fevereiro) viram o último dia do mês.
- `faturaChave` no lançamento permite forçar a fatura quando o banco alocou diferente.

Cada fatura é identificada pelo mês de vencimento (`"2026-11"`). Status: `aberta` (recebendo compras), `futura` (só parcelas já programadas), `fechada`, `vencida`, `paga`.

**Limite disponível** = limite − soma do valor em aberto de todas as faturas do cartão, incluindo parcelas futuras (os bancos bloqueiam o valor total de uma compra parcelada).

### 4.5 Linha do tempo e "livre para gastar"

Todos os eventos futuros dentro do horizonte (padrão: 12 meses) são ordenados por data; pendências atrasadas são posicionadas em hoje. Na mesma data, saídas vêm antes de entradas. Partindo do saldo atual, calcula-se o saldo após cada evento.

```
LIVRE PARA GASTAR HOJE = menor saldo projetado no horizonte − reserva mínima
```

Justificativa: um gasto feito hoje reduz todos os saldos futuros pelo mesmo valor. O maior valor que pode ser gasto sem que nenhum compromisso fique descoberto é, portanto, a distância entre o ponto mais baixo da curva e a reserva. Usar o saldo de hoje superestima (ignora contas que vencem antes do salário); usar o saldo do fim do mês também (ignora o aperto do meio do mês e os meses seguintes).

O painel informa a data e o evento que definem esse mínimo, para que o número seja verificável.

**Gasto variável previsto.** Sem ele, a projeção dos meses futuros supõe que você não gastará nada além das contas fixas, o que infla o livre. A estimativa é o valor de `config.gastoVariavelMensal` ou, se vazio, a média dos últimos 3 meses completos de compras à vista (sem gastos fixos e sem parcelados). Entra a partir do mês seguinte, dividida em quatro partes (dias 7, 14, 21 e 28). O mês atual não recebe estimativa: o "livre para gastar" é justamente o orçamento dele.

**Horizonte.** Faturas e parcelas que vencem depois do horizonte continuam ocupando o limite do cartão, mas não entram na linha do tempo, porque seriam comparadas com receitas que não estão projetadas.

### 4.6 Cascata do painel

Decompõe o caminho do saldo atual até o saldo projetado no fim da janela (`mesesCascata`, padrão: este mês e o próximo):

```
saldo atual + a receber − contas fixas − cartão − parcelas − outros agendados − variável previsto
= saldo projetado no fim da janela
```

Os grupos são mutuamente exclusivos. "Cartão" e "Parcelas" dividem cada fatura em aberto proporcionalmente entre compras parceladas e o restante; parcelas de carnê/boleto entram em "Parcelas". A soma é verificada nos testes contra o saldo projetado.

### 4.7 Termômetro

Dois indicadores; o estado final é o pior entre eles.

| Indicador | Fórmula | Vermelho | Amarelo |
|---|---|---|---|
| Folga | livre para gastar ÷ renda mensal recorrente | livre < 0 | folga < 10% |
| Comprometimento | compromissos dos próximos 90 dias ÷ receitas dos próximos 90 dias (sem a estimativa de variável) | ≥ 90% | ≥ 70% |

A folga responde "sobra dinheiro depois de tudo o que já está previsto?". O comprometimento responde "quanto do dinheiro que ainda vai entrar já tem destino?" — é o indicador que denuncia excesso de parcelas mesmo quando o saldo ainda parece bom. Os limites são configuráveis em Ajustes.

### 4.8 Simulador

Acrescenta a compra hipotética a uma **cópia** da base e roda o mesmo `analisar()` do painel. O resultado da simulação é, por construção, idêntico ao que o painel mostraria se a compra fosse registrada. Para cada forma de pagamento compara: saldo hoje, livre para gastar, termômetro, faturas atingidas, limite do cartão, juros (diferença entre total parcelado e preço à vista) e saldo no fim de cada mês. Uma opção é "viável" se o livre continua ≥ 0 e, no cartão, se o limite disponível cobre o total.

### 4.9 Pessoas

Todo lançamento é pago com uma conta ou cartão seu. A parte de outra pessoa (`divisao` por valor, percentual ou igual; ou `responsavelId` sem divisão) vira valor devido a você. `acertos` registram o que cada pessoa pagou. O que os outros devem **não** entra no livre para gastar até o acerto ser registrado com conta de destino — não há garantia de quando o dinheiro volta.

## 5. Persistência

`store.js` define a interface usada pelo resto do app: `ler()` e `gravar(db)`. Dois adapters:

- **LocalAdapter** — `localStorage` do navegador. Padrão no primeiro uso.
- **GitHubAdapter** — arquivo JSON num repositório privado, via API REST de conteúdo (`GET/PUT /repos/{dono}/{repo}/contents/{arquivo}`). Cada gravação é um commit, o que dá histórico e backup. Gravações são agrupadas (1,2 s após a última alteração). Conflitos entre aparelhos são detectados pelo `sha`; o app mostra o conflito e oferece recarregar.

Mesmo com o GitHub, uma cópia local é mantida como cache: o app abre sem internet e envia as alterações pendentes quando o repositório volta a responder.

**Para trocar por um banco de dados** (Supabase, Firebase, API própria): criar `js/data/adapters/<nome>.js` com `ler()` e `gravar(db)` e incluí-lo em `criarAdapter()`. As regras e as telas não mudam. Se a base crescer a ponto de não caber num documento, o próximo passo é o adapter gravar coleções separadas — a interface com o resto do app continua a mesma.

## 6. Segurança

- O repositório público contém apenas código e documentação. Não há senhas, tokens, nomes ou valores reais no código. Os dados de exemplo são fictícios.
- Os dados financeiros ficam no repositório privado ou só no navegador.
- O token do GitHub é digitado na tela de Ajustes e salvo no `localStorage` do navegador. Ele é enviado somente para `api.github.com` (a CSP bloqueia qualquer outro destino).
- Use um **fine-grained token** restrito ao repositório de dados, com permissão apenas **Contents: Read and write** e data de expiração. Se o aparelho for perdido, revogue o token no GitHub.
- Ao conectar, o app verifica se o repositório é privado e alerta se não for.
- Limitação conhecida: todas as páginas GitHub Pages de um mesmo usuário (`usuario.github.io/qualquer-projeto`) compartilham a mesma origem e, portanto, o mesmo `localStorage`. Não publique outros projetos com JavaScript de terceiros na mesma conta, ou use um domínio próprio para este app.

## 7. Telas

| Rota | Tela | Pergunta que responde |
|---|---|---|
| `#/` | Visão geral | Quanto posso gastar hoje e por quê? |
| `#/mes` | Mês a mês | Como fica cada mês e se estou assumindo compromissos demais |
| `#/gastos` | Gastos | O que gastei e quais parcelados estão em andamento |
| `#/fixos` | Receitas e fixos | O que entra e sai todo mês e o que já foi pago/recebido |
| `#/cartoes` | Cartões | Limite, fatura atual e próximas faturas com itens |
| `#/pessoas` | Pessoas | Quem deve quanto |
| `#/simulador` | Simulador de compra | E se eu comprar isso? |
| `#/ajustes` | Ajustes | Saldo, categorias, parâmetros, armazenamento e backup |

Componentes reutilizáveis (`js/ui/components.js`): `kpi`, `barra`, `pilula`, `termometro`, `graficoSaldo`, `graficoMeses`, `listaCategorias`. Formulários (`js/ui/forms.js`) usam `abrirModal` e o editor de divisão entre pessoas.

## 8. Próximos passos possíveis

- Service worker para funcionar offline como app instalado (o manifesto já existe).
- Importação de extrato OFX/CSV do banco para conciliar lançamentos.
- Metas de gasto por categoria.
- Múltiplos usuários compartilhando a mesma base (exigiria um backend com autenticação; o adapter do GitHub é pensado para uso pessoal).
