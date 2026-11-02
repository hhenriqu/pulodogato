/**
 * A VISAO DA CASA (migration 078): o mes da familia somado.
 *
 * O banco devolve, por `resultado_da_casa`, uma linha por (membro que
 * compartilha, mes, moeda) com o Resultado do PAINEL dele -- o mesmo numero de
 * `lib/services/resultado-do-mes.ts` -- e o `interno_expense`: a parte dele do
 * que OUTRO membro da casa pagou. Este modulo faz a conta que a tela mostra:
 *
 *   saiu da casa   = soma(saiu de cada um)  - soma(interno)
 *   entrou na casa = soma(entrou de cada um)
 *   resultado      = entrou - saiu
 *
 * POR QUE TIRAR O INTERNO
 * -----------------------
 * Ana paga o mercado de 90 e a casa divide em tres: a Ana tem -90 (quem paga
 * conta inteiro) e o Beto -30 (a parte dele do que outro pagou). Somar os dois
 * da -120, e a casa gastou 90. Os 30 do Beto sao uma divida dentro da casa, nao
 * dinheiro que saiu dela. O teste SQL da 078 mede o caso inteiro e o controle
 * negativo (sem tirar o interno a soma passa).
 *
 * Moedas nunca se somam entre si: o resultado e um bloco por moeda, como no
 * painel (022).
 *
 * Tudo em centavos inteiros: somar 0,1 + 0,2 em ponto flutuante numa familia
 * de cinco pessoas e doze meses e pedir para o total terminar em ,9999.
 */

export interface LinhaDoResultadoDaCasa {
  user_id: string;
  /** Primeiro dia do mes, 'AAAA-MM-01'. */
  month: string;
  currency: string;
  income: number | string;
  expense: number | string;
  net: number | string;
  transaction_count?: number | string | null;
  interno_expense: number | string;
}

export interface MembroDaCasa {
  member_id: string;
  user_id: string | null;
  nome: string;
  role: string;
  dependente: boolean;
  compartilha: boolean;
  sou_eu: boolean;
}

export interface SaldoDaCasa {
  tipo: "conjunta" | "pessoal";
  account_id: string | null;
  nome_da_conta: string | null;
  account_type: string | null;
  user_id: string;
  currency: string;
  saldo: number | string;
}

export interface TotalDaCasa {
  currency: string;
  entrou: number;
  saiu: number;
  resultado: number;
  /** O que foi tirado da soma por ser divida entre membros. */
  interno: number;
}

export interface ResultadoDoMembro {
  user_id: string;
  nome: string;
  currency: string;
  entrou: number;
  saiu: number;
  resultado: number;
}

export interface ResumoDaCasa {
  /** Um bloco por moeda; a moeda principal primeiro, depois em ordem alfabetica. */
  totais: TotalDaCasa[];
  /** Um por (membro que compartilha, moeda), pelo nome. */
  porMembro: ResultadoDoMembro[];
  /** Quantos membros com conta NAO compartilham: a tela diz que a soma esta incompleta. */
  naoCompartilham: number;
}

function centavos(valor: number | string | null | undefined): number {
  const n = typeof valor === "string" ? Number(valor) : valor ?? 0;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function reais(c: number): number {
  return c / 100;
}

function ordemDasMoedas(principal: string) {
  return (a: string, b: string) =>
    a === principal ? -1 : b === principal ? 1 : a.localeCompare(b);
}

/**
 * Soma o periodo inteiro que veio (um mes ou varios) da casa e de cada membro.
 */
export function resumirACasa(
  linhas: readonly LinhaDoResultadoDaCasa[],
  membros: readonly MembroDaCasa[],
  moedaPrincipal = "BRL"
): ResumoDaCasa {
  const nomePorId = new Map<string, string>();
  for (const m of membros) if (m.user_id) nomePorId.set(m.user_id, m.nome);

  const casa = new Map<string, { entrou: number; saiu: number; interno: number }>();
  const membro = new Map<string, { user_id: string; currency: string; entrou: number; saiu: number }>();

  for (const l of linhas) {
    const moeda = l.currency || moedaPrincipal;
    const entrou = centavos(l.income);
    const saiu = centavos(l.expense);
    const interno = centavos(l.interno_expense);

    const c = casa.get(moeda) ?? { entrou: 0, saiu: 0, interno: 0 };
    c.entrou += entrou;
    c.saiu += saiu;
    c.interno += interno;
    casa.set(moeda, c);

    const chave = `${l.user_id}|${moeda}`;
    const m = membro.get(chave) ?? { user_id: l.user_id, currency: moeda, entrou: 0, saiu: 0 };
    m.entrou += entrou;
    m.saiu += saiu;
    membro.set(chave, m);
  }

  const ordem = ordemDasMoedas(moedaPrincipal);

  const totais: TotalDaCasa[] = Array.from(casa.entries())
    .sort(([a], [b]) => ordem(a, b))
    .map(([currency, c]) => {
      const saiu = c.saiu - c.interno;
      return {
        currency,
        entrou: reais(c.entrou),
        saiu: reais(saiu),
        resultado: reais(c.entrou - saiu),
        interno: reais(c.interno),
      };
    });

  const porMembro: ResultadoDoMembro[] = Array.from(membro.values())
    .map((m) => ({
      user_id: m.user_id,
      nome: nomePorId.get(m.user_id) ?? "Membro",
      currency: m.currency,
      entrou: reais(m.entrou),
      saiu: reais(m.saiu),
      resultado: reais(m.entrou - m.saiu),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome) || ordem(a.currency, b.currency));

  const naoCompartilham = membros.filter((m) => !m.dependente && !m.compartilha).length;

  return { totais, porMembro, naoCompartilham };
}

export interface SaldosResumidos {
  conjuntas: { account_id: string; nome: string; currency: string; saldo: number; dono: string }[];
  porMembro: { user_id: string; nome: string; currency: string; saldo: number }[];
  /** Conjuntas + contas de quem compartilha, por moeda. */
  totais: { currency: string; saldo: number }[];
}

export function resumirSaldos(
  saldos: readonly SaldoDaCasa[],
  membros: readonly MembroDaCasa[],
  moedaPrincipal = "BRL"
): SaldosResumidos {
  const nomePorId = new Map<string, string>();
  for (const m of membros) if (m.user_id) nomePorId.set(m.user_id, m.nome);

  const totais = new Map<string, number>();
  const conjuntas: SaldosResumidos["conjuntas"] = [];
  const porMembro: SaldosResumidos["porMembro"] = [];

  for (const s of saldos) {
    const moeda = s.currency || moedaPrincipal;
    const c = centavos(s.saldo);
    totais.set(moeda, (totais.get(moeda) ?? 0) + c);
    const nome = nomePorId.get(s.user_id) ?? "Membro";
    if (s.tipo === "conjunta" && s.account_id) {
      conjuntas.push({
        account_id: s.account_id,
        nome: s.nome_da_conta ?? "Conta conjunta",
        currency: moeda,
        saldo: reais(c),
        dono: nome,
      });
    } else {
      porMembro.push({ user_id: s.user_id, nome, currency: moeda, saldo: reais(c) });
    }
  }

  const ordem = ordemDasMoedas(moedaPrincipal);
  return {
    conjuntas: conjuntas.sort((a, b) => a.nome.localeCompare(b.nome)),
    porMembro: porMembro.sort((a, b) => a.nome.localeCompare(b.nome) || ordem(a.currency, b.currency)),
    totais: Array.from(totais.entries())
      .sort(([a], [b]) => ordem(a, b))
      .map(([currency, c]) => ({ currency, saldo: reais(c) })),
  };
}

/**
 * O mes pedido na URL (`?mes=2026-10`) como o intervalo que a funcao do banco
 * recebe. Mes invalido ou ausente vira o mes de `hoje`.
 */
export function intervaloDoMes(
  mes: string | null | undefined,
  hoje: Date = new Date()
): { mes: string; desde: string; ate: string } {
  let ano: number;
  let m: number;
  const casou = typeof mes === "string" ? /^(\d{4})-(\d{2})$/.exec(mes) : null;
  if (casou && Number(casou[2]) >= 1 && Number(casou[2]) <= 12) {
    ano = Number(casou[1]);
    m = Number(casou[2]);
  } else {
    ano = hoje.getFullYear();
    m = hoje.getMonth() + 1;
  }
  const mm = String(m).padStart(2, "0");
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return {
    mes: `${ano}-${mm}`,
    desde: `${ano}-${mm}-01`,
    ate: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}`,
  };
}

/** O erro do banco como status HTTP: 42501 = nao e membro, P0002 = nao e casa. */
export function statusDoErroDaCasa(erro: { code?: string | null } | null | undefined): number {
  if (erro?.code === "42501") return 403;
  if (erro?.code === "P0002") return 404;
  return 500;
}
