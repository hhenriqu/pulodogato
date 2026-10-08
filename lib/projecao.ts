// =====================================================
// A PROJECAO POR CONTA: "SOBRA OU FALTA NO DIA 30?"
// =====================================================
// Saldo de hoje mais tudo que esta previsto ate a data, conta por conta. E a
// aritmetica que a GET /api/projection publica, e o unico leitor dela e a tela
// de orcamentos (`app/(dashboard)/dashboard/budgets/page.tsx`): o card
// "Projecao fim do mes", o "A pagar" da aba Projecao e a lista por conta.
//
// Funcao pura: nao le banco, nao pede login, nao grava. A rota busca as linhas
// e repassa -- mesmo desenho do lib/safe-to-spend.ts e do
// lib/cash-flow-forecast.ts, e pela mesma razao: e o que permite a prova de
// correcao caber em teste unitario (`npm run test:projecao`), sem Postgres no
// meio. A rota NAO era testavel antes desta extracao: a consulta de previstas
// usa embed (`recurring_rule:recurring_rules(transaction_type)`), e duble de
// rota com embed projeta `undefined` em tudo -- o teste passaria sem ver nada.
//
// E uma leitura pura por decisao de desenho: nao existe tabela de projecao e
// nao deve existir. Ela muda a cada lancamento, e uma tabela precisaria de
// trigger em `financial_transactions` E em `scheduled_transactions` para nao
// mentir.
//
// O que entra: contas previstas com status 'pending' e vencimento ate a data,
// incluindo as ja VENCIDAS -- uma conta que venceu ontem e nao foi paga
// continua sendo dinheiro que vai sair. Ficam de fora 'paid' (ja virou
// transacao real e ja esta no saldo), 'skipped' e 'cancelled'. O filtro de
// status e da rota; o do horizonte esta aqui tambem, de proposito, para que o
// recorte seja uma decisao testavel e nao um detalhe da consulta.
//
// -----------------------------------------------------------------------
// A FATURA FECHADA FICA FORA DO `scheduled_out` (HMO-293 / HMO-342)
// -----------------------------------------------------------------------
// Este arquivo decide o OPOSTO do lib/cash-flow-forecast.ts, de proposito.
// Quem ler os dois -- tres, com o lib/safe-to-spend.ts -- vai achar que um
// esta errado. Nenhum esta, e o paragrafo "por que os tres discordam", mais
// abaixo, e a razao de este cabecalho existir: sem ele, "consertar" a
// divergencia reintroduz um desconto em dobro que custou duas issues para ser
// medido.
//
// O DEFEITO, medido em producao na conta de teste (HMO-293, fatura de R$ 300
// fechada pelo fluxo do app, cartao com fechamento dia 5 e vencimento dia 15):
//
//   | etapa                       | saldo do cartao | `scheduled_out` | projecao do cartao | `projected_total` |
//   |-----------------------------|-----------------|-----------------|--------------------|-------------------|
//   | baseline da conta           |               0 |               0 |                  0 |            −88,87 |
//   | depois da compra de R$ 300  |            −300 |               0 |               −300 |           −388,87 |
//   | depois de fechar a fatura   |            −300 |         **300** |           **−600** |      **−688,87**  |
//
// O unico evento entre as duas ultimas leituras foi o clique em "fechar", que
// nao mexe no saldo (−300 → −300). O mesmo R$ 300 passou a existir duas vezes:
// as compras ja rebaixaram o `current_balance` do cartao no INSERT (trigger
// `update_account_balance`), e a conta prevista que `POST
// /api/card-invoices/close` pendura no `account_id` do PROPRIO cartao entrava
// de novo em `scheduled_out`.
//
// O ARGUMENTO que fecha a questao nao e "o safe-to-spend faz assim". E este:
// **a conta prevista da fatura e UMA PERNA de uma transferencia cuja outra
// perna ainda nao existe.** Pagar fatura nao e despesa: sao duas pernas
// `transfer` (−total na pagadora, +total no cartao). No fechamento o app
// deliberadamente nao sabe quem paga -- adivinhar a pagadora foi exatamente o
// que produziu a despesa em dobro da HMO-149. Somar uma perna so a qualquer
// agregado quebra o agregado.
//
// AS QUATRO OPCOES, com os numeros da medicao acima:
//
//   |       | tratamento                            | cartao           | `projected_total` | veredito |
//   |-------|---------------------------------------|------------------|-------------------|----------|
//   | hoje  | entra em `scheduled_out` do cartao    | −600             | −688,87           | ERRADO: desconta a mesma compra duas vezes |
//   | **A** | **`ehFatura` fica fora** (ESCOLHIDA)  | **−300**         | **−388,87**       | certo nos dois niveis |
//   | B     | entra como `scheduled_in` do cartao   | 0                | −88,87            | certo por conta, mas INFLA o total em 300: credita o cartao sem debitar ninguem |
//   | C     | pendurar na conta pagadora            | —                | —                 | IMPOSSIVEL: a pagadora so existe na baixa (HMO-149) |
//   | D     | tirar cartao da projecao (estilo `cash-flow-forecast`) | linha desaparece | −88,87 | total certo, mas joga fora o periodo aberto e as assinaturas do cartao |
//
// A D tem duas desvantagens que nao sao obvias e que justificam a A:
//
//   * **a D mente para menos.** A compra feita depois do fechamento ainda nao
//     foi faturada e nao tem conta prevista nenhuma: ela so existe dentro do
//     `current_balance` do cartao. Tirar o cartao da projecao faz esse
//     dinheiro desaparecer do numero;
//   * **a D mataria a assinatura cobrada no cartao.** Assinatura cadastrada
//     como conta prevista com `account_id` do cartao NAO e fatura, e pagar com
//     o cartao rebaixa o cartao de verdade -- ela DEVE continuar em
//     `scheduled_out`.
//
// DAI O CRITERIO: a chave canonica em `notes` (`ehFatura`, de
// `lib/chave-da-fatura.ts`), NUNCA `account_type`. Excluir por tipo de conta
// apagaria a distincao entre a fatura e a assinatura cobrada no cartao, e o
// `test-projecao.mjs` tem um caso so para isso ("assinatura do cartao NAO e
// excluida") -- ele existe para matar exatamente esse conserto.
//
// POR QUE OS TRES DISCORDAM, e cada um esta certo na sua pergunta:
//
//   | modulo                    | a pergunta                      | a fatura fechada |
//   |---------------------------|---------------------------------|------------------|
//   | lib/safe-to-spend.ts      | "quanto posso gastar este mes"  | FORA: a divida vem inteira do saldo do cartao |
//   | lib/cash-flow-forecast.ts | "em que DIA o saldo fica negativo" | DENTRO: o saldo do cartao nao tem vencimento, a fatura tem -- e o dinheiro sai da corrente naquele dia |
//   | lib/projecao.ts (aqui)    | "qual vai ser o saldo DESTA conta" | FORA: a perna que debitaria a pagadora nao existe, e o cartao ja esta debitado |
//
// O que une os tres: o mesmo dinheiro nunca e contado duas vezes. O
// `cash-flow-forecast` pode incluir a fatura porque o saldo inicial dele NAO
// desconta cartao nenhum; aqui o cartao tem linha propria e ja carrega a
// divida no `current_balance`.
//
// -----------------------------------------------------------------------
// O RESIDUO HONESTO
// -----------------------------------------------------------------------
// Com a opcao A, a linha do cartao nao reflete o credito que o pagamento da
// fatura vai dar nele: cartao com R$ 3.000 em 10x mostra `projected_balance`
// −3.000, e no dia 30, se a fatura de 300 for paga, ele estara em −2.700. E o
// preco de nao ter a outra perna, e e o lado CONSERVADOR do erro.
//
// NAO porte a "armadilha 10" (descontar so a fatura deste mes, HMO-290) para
// ca. La a pergunta e "quanto ESTE MES cobra"; aqui e "qual vai ser o saldo
// desta conta", e em 10x a pessoa deve os R$ 3.000 mesmo. Trazer a armadilha
// 10 para a projecao inflaria o saldo projetado do cartao em R$ 2.700. E a
// mesma assimetria da decisao 4.2 do plano da HMO-281, que manteve o
// lib/net-worth.ts fora.
//
// -----------------------------------------------------------------------
// A DIRECAO SAI DA VIEW, E NAO DA REGRA -- HMO-256
// -----------------------------------------------------------------------
// Receita prevista AVULSA (sem regra de recorrencia) era somada como conta a
// PAGAR. A direcao saia de `recurring_rules.transaction_type`, e previsao
// avulsa nao tem regra: TODA avulsa caia em `expense`, inclusive a de receita,
// que /api/scheduled-transactions aceita desde a HMO-188. O erro era DUPLO --
// a receita somava em `scheduled_out` E deixava de somar em `scheduled_in` --,
// e as duas metades erram para o mesmo lado: o saldo projetado afundava em
// DOIS vezes o valor da receita.
//
// Agora a rota le a view `scheduled_transactions_effective` (027), que resolve
// a precedencia ocorrencia -> regra -> 'expense' UMA vez, no banco, e entrega
// `direction`. Quem traduz `direction` em "entra ou sai" e `direcaoDaAgenda`
// (lib/previsto-x-realizado.ts), a MESMA funcao que o safe-to-spend usa desde
// a HMO-308 -- refazer o COALESCE aqui criaria a segunda copia da precedencia,
// e a copia esquecida e exatamente o defeito que esta issue conserta.
//
// NAO HA FLAG `direcao_indisponivel` AQUI, ao contrario do safe-to-spend. A
// forma da resposta e congelada (logo abaixo), e o campo novo e justamente o
// que a HMO-187 provou caro numa rota cacheada. O lado seguro ja esta coberto
// pelo fim do COALESCE da view: `direction` nulo cai em despesa.
//
// A forma da resposta e CONGELADA: nenhum campo entra ou sai. A rota e
// cacheada pelo service worker, e campo novo em rota cacheada foi o que quase
// quebrou o painel na HMO-187. Os espelhos no cliente sao `AccountProjection`
// e `ProjectionSummary` em `types/financial.ts`.
// =====================================================

import { ehFatura } from "@/lib/chave-da-fatura";
import { direcaoDaAgenda } from "@/lib/previsto-x-realizado";
import { lastDayOfMonth } from "@/lib/recurrence";

/** O que o calculo precisa saber sobre uma conta. */
export interface ContaParaProjetar {
  id: string;
  name: string;
  account_type: string;
  current_balance: number | string | null;
}

/**
 * Uma conta prevista do jeito que a rota entrega.
 *
 * `amount` e sempre positivo por CHECK (005): a direcao NAO esta no sinal, ela
 * esta em `direction` -- e por isso que uma receita prevista lida como despesa
 * nao tem sintoma nenhum no valor.
 */
export interface PrevistaParaProjetar {
  id: string;
  account_id?: string | null;
  amount: number | string;
  due_date: string;
  notes?: string | null;
  /**
   * A coluna homonima de `scheduled_transactions_effective` (027), com a
   * precedencia ocorrencia -> regra -> 'expense' JA resolvida no banco.
   *
   * Opcional e `| null` porque o `null` e o unico sintoma possivel de a view
   * ter sido trocada por uma que nao entregue a coluna; nesse caso
   * `direcaoDaAgenda` manda a linha para `expense`, que e o lado conservador
   * (ler despesa como receita prometeria dinheiro que nao vem).
   */
  direction?: string | null;
}

/** Uma linha da lista por conta. Espelha `AccountProjection`. */
export interface ProjecaoDaConta {
  account_id: string;
  account_name: string;
  account_type: string;
  /** Saldo de hoje, mantido por trigger. */
  current_balance: number;
  /** Contas previstas a pagar ate o fim do periodo (positivo = vai sair). */
  scheduled_out: number;
  /** Receitas previstas a receber ate o fim do periodo. */
  scheduled_in: number;
  /** current_balance - scheduled_out + scheduled_in. */
  projected_balance: number;
  /** True quando a projecao fecha no vermelho e o saldo de hoje nao esta. */
  goes_negative: boolean;
}

/** A resposta da GET /api/projection. Espelha `ProjectionSummary`. */
export interface ResumoDaProjecao {
  /** 'YYYY-MM-DD' -- ate onde a projecao foi calculada. */
  through: string;
  current_total: number;
  projected_total: number;
  scheduled_out: number;
  scheduled_in: number;
  /** Contas vencidas ainda nao pagas; ja estao "fora" do previsto. */
  overdue_total: number;
  accounts: ProjecaoDaConta[];
}

export interface EntradaDaProjecao {
  contas: ContaParaProjetar[];
  previstas: PrevistaParaProjetar[];
  /** 'YYYY-MM-DD' do app (`today()`), nao do Postgres. */
  hoje: string;
  /** 'YYYY-MM-DD' do fim do horizonte, inclusive. */
  ate: string;
}

function numero(valor: number | string | null | undefined): number {
  const bruto = Number(valor ?? 0);
  return Number.isFinite(bruto) ? bruto : 0;
}

/** Ultimo dia do mes de `iso`, em ISO. O horizonte default da rota. */
export function fimDoMes(iso: string): string {
  const [ano, mes] = iso.split("-").map(Number);
  const ultimo = lastDayOfMonth(ano, mes);
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

export function calcularProjecao({
  contas,
  previstas,
  hoje,
  ate,
}: EntradaDaProjecao): ResumoDaProjecao {
  const porConta = new Map<string, ProjecaoDaConta>();

  for (const conta of contas) {
    const saldo = numero(conta.current_balance);
    porConta.set(conta.id, {
      account_id: conta.id,
      account_name: conta.name,
      account_type: conta.account_type,
      current_balance: saldo,
      scheduled_out: 0,
      scheduled_in: 0,
      projected_balance: saldo,
      goes_negative: false,
    });
  }

  // Previstas sem conta vinculada entram no total geral, mas nao tem onde somar
  // por conta -- o usuario nao disse de onde o dinheiro sai.
  let semContaOut = 0;
  let semContaIn = 0;
  let vencidoTotal = 0;

  for (const p of previstas) {
    if (p.due_date > ate) continue;

    const projecao = p.account_id ? porConta.get(p.account_id) : undefined;

    // OPCAO A (ver cabecalho): a conta prevista da fatura e uma perna solta de
    // transferencia, e a divida ja esta no `current_balance` do cartao. O
    // criterio e a chave canonica em `notes`, NUNCA `projecao.account_type`:
    // assinatura cobrada no cartao nao e fatura e tem de continuar descontando.
    if (ehFatura(p.notes)) continue;

    const ehReceita = direcaoDaAgenda(p.direction) === "income";
    const valor = Math.abs(numero(p.amount));

    if (p.due_date < hoje) vencidoTotal += ehReceita ? 0 : valor;

    if (!projecao) {
      if (ehReceita) semContaIn += valor;
      else semContaOut += valor;
      continue;
    }

    if (ehReceita) projecao.scheduled_in += valor;
    else projecao.scheduled_out += valor;
  }

  const projecoes = Array.from(porConta.values()).map((p) => {
    const projetado = p.current_balance - p.scheduled_out + p.scheduled_in;
    return {
      ...p,
      projected_balance: projetado,
      // So interessa avisar quando a projecao MUDA a resposta: uma conta que ja
      // esta negativa hoje nao e uma descoberta. Mesma decisao do
      // `comecaNegativo` do lib/cash-flow-forecast.ts.
      goes_negative: projetado < 0 && p.current_balance >= 0,
    };
  });

  projecoes.sort((a, b) => a.projected_balance - b.projected_balance);

  const saldoAtual = projecoes.reduce((s, p) => s + p.current_balance, 0);
  const saiTotal =
    projecoes.reduce((s, p) => s + p.scheduled_out, 0) + semContaOut;
  const entraTotal =
    projecoes.reduce((s, p) => s + p.scheduled_in, 0) + semContaIn;

  return {
    through: ate,
    current_total: saldoAtual,
    projected_total: saldoAtual - saiTotal + entraTotal,
    scheduled_out: saiTotal,
    scheduled_in: entraTotal,
    overdue_total: vencidoTotal,
    accounts: projecoes,
  };
}
