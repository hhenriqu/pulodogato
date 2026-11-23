// =====================================================
// A CONTA DO EXTRATO, ACHADA OU CRIADA PELA ORIGEM DO ARQUIVO
// =====================================================
// Pedido do Helio, 23/11/2026: "Quero que ao enviar o csv a conta seja criada
// caso nao exista, assim como o cartao."
//
// Quando o arquivo e de um banco que o app conhece (C6 conta, C6 fatura,
// Mercado Pago conta) e ninguem escolheu a conta, a rota POST /api/statements
// decide sozinha, nesta ordem:
//
//   1. a conta da ULTIMA importacao da mesma origem, se ainda esta ativa e e
//      do tipo certo -- quem mandou o extrato do C6 para "Conta Corrente" uma
//      vez quer que o proximo va para la, mesmo sem "C6" no nome;
//   2. uma conta ativa do tipo certo com o banco no nome ou no bank_name
//      ("C6", "Cartão C6", "Mercado Pago Conta");
//   3. senao, CRIA: o cartao C6 com o vencimento do nome do arquivo, a conta
//      corrente do C6, a conta do Mercado Pago -- com um nome que ainda nao
//      existe (QA do Mercado Pago, B2: "Mercado Pago" ja era a conta de
//      investimento).
//
// O tipo certo e o que a rota ja exige (a fatura so vai para cartao; o
// extrato da conta nunca vai para cartao), e a conta de investimento fica de
// fora do extrato da conta: "C6 Investimentos" nao e a conta corrente do C6.
//
// Sem I/O. Testes: npm run test:conta-do-extrato
// =====================================================

export type OrigemDoBanco = "c6_conta" | "c6_cartao" | "mercadopago_conta";

export interface ContaConhecida {
  id: string;
  name: string;
  account_type: string;
  bank_name?: string | null;
  is_active?: boolean | null;
}

export interface ContaParaCriar {
  name: string;
  account_type: "credit_card" | "checking" | "digital";
  bank_name: string;
  closing_day: number | null;
  due_day: number | null;
  color_hex: string;
  icon: string;
}

export type ContaDoExtrato =
  | { acao: "usar"; id: string; motivo: "ultima_importacao" | "pelo_nome" }
  | { acao: "criar"; conta: ContaParaCriar };

interface Banco {
  banco: string;
  /** Tipos que recebem este arquivo, na ordem de preferencia. */
  tipos: string[];
  reconhece: RegExp;
  nomes: string[];
  criar: Omit<ContaParaCriar, "name" | "closing_day" | "due_day">;
}

const BANCOS: Record<OrigemDoBanco, Banco> = {
  c6_cartao: {
    banco: "C6 Bank",
    tipos: ["credit_card"],
    reconhece: /(^|[^a-z0-9])c6([^a-z0-9]|$)/i,
    nomes: ["Cartão C6", "Cartão C6 Bank"],
    criar: { account_type: "credit_card", bank_name: "C6 Bank", color_hex: "#242424", icon: "credit-card" },
  },
  c6_conta: {
    banco: "C6 Bank",
    tipos: ["checking", "digital", "savings"],
    reconhece: /(^|[^a-z0-9])c6([^a-z0-9]|$)/i,
    nomes: ["C6 Conta", "Conta C6", "C6 Conta Corrente"],
    criar: { account_type: "checking", bank_name: "C6 Bank", color_hex: "#242424", icon: "landmark" },
  },
  mercadopago_conta: {
    banco: "Mercado Pago",
    tipos: ["digital", "checking", "savings"],
    reconhece: /mercado\s*pago/i,
    nomes: ["Mercado Pago Conta", "Conta Mercado Pago"],
    criar: { account_type: "digital", bank_name: "Mercado Pago", color_hex: "#009EE3", icon: "wallet" },
  },
};

/**
 * O dia de vencimento pelo nome do arquivo do C6 ("Fatura_2026-11-20.csv" ->
 * 20). `null` quando o nome nao traz o dia.
 */
export function vencimentoPeloNome(nome: string | null | undefined): number | null {
  const m = String(nome ?? "").match(/fatura[_\- ]?\d{4}-\d{2}-(\d{2})/i);
  if (!m) return null;
  const dia = Number(m[1]);
  return dia >= 1 && dia <= 31 ? dia : null;
}

/**
 * O fechamento do cartao C6 a partir do vencimento: o C6 fecha a fatura 7
 * dias antes de vencer (o cartao do Helio: fecha 13, vence 20). E so o ponto
 * de partida -- o usuario corrige na tela do cartao.
 */
export function fechamentoDoC6(vencimento: number | null): number | null {
  if (vencimento == null) return null;
  const dia = vencimento - 7;
  return dia >= 1 ? dia : dia + 30;
}

function ativa(c: ContaConhecida): boolean {
  return c.is_active !== false;
}

/** Um nome que ainda nao existe entre as contas (de qualquer tipo). */
function nomeLivre(candidatos: string[], contas: readonly ContaConhecida[]): string {
  const usados = new Set(contas.map((c) => c.name.trim().toLowerCase()));
  for (const n of candidatos) if (!usados.has(n.toLowerCase())) return n;
  for (let i = 2; ; i++) {
    const n = `${candidatos[0]} ${i}`;
    if (!usados.has(n.toLowerCase())) return n;
  }
}

export function contaParaOrigem(params: {
  origem: OrigemDoBanco;
  contas: readonly ContaConhecida[];
  /** A conta da importacao mais recente da mesma origem. */
  ultimaUsada?: string | null;
  nomeDoArquivo?: string | null;
}): ContaDoExtrato {
  const banco = BANCOS[params.origem];
  const candidatas = params.contas.filter(
    (c) => ativa(c) && banco.tipos.includes(c.account_type)
  );

  if (params.ultimaUsada) {
    const ultima = candidatas.find((c) => c.id === params.ultimaUsada);
    if (ultima) return { acao: "usar", id: ultima.id, motivo: "ultima_importacao" };
  }

  const doBanco = candidatas
    .filter((c) => banco.reconhece.test(c.name) || banco.reconhece.test(c.bank_name ?? ""))
    .sort((a, b) => banco.tipos.indexOf(a.account_type) - banco.tipos.indexOf(b.account_type));
  if (doBanco.length > 0) return { acao: "usar", id: doBanco[0].id, motivo: "pelo_nome" };

  const ehCartao = params.origem === "c6_cartao";
  const vencimento = ehCartao ? vencimentoPeloNome(params.nomeDoArquivo) : null;
  return {
    acao: "criar",
    conta: {
      ...banco.criar,
      name: nomeLivre(banco.nomes, params.contas),
      due_day: vencimento,
      closing_day: ehCartao ? fechamentoDoC6(vencimento) : null,
    },
  };
}
