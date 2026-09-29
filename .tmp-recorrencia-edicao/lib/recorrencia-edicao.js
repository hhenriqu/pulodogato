// ---------------------------------------------------------------------------
// ALTERAR UMA OCORRENCIA: SO ESTA, OU ESTA E AS PROXIMAS (HMO-170)
// ---------------------------------------------------------------------------
// A issue pede tres coisas de uma edicao numa serie que se repete:
//
//   - "alterar apenas esse registro"      -> `apenas_esta`
//   - "esse e os proximos"                -> `esta_e_proximas`
//   - "mas nunca mudar o que ja passou"   -> a garantia que vale nos DOIS casos
//
// O que este arquivo decide e SO isto: dado o alcance e a ocorrencia clicada
// (a ancora), quais linhas recebem a alteracao. Ele nao fala com o banco, e por
// isso da para testar a regra que erra dinheiro sem subir Postgres.
//
// O QUE E "O QUE JA PASSOU"
// -------------------------
// Nao e "data no passado". E `status = 'paid'`: a ocorrencia paga tem uma
// `financial_transactions` amarrada nela (a coluna `transaction_id` da migration
// 005), ou seja o dinheiro ja se moveu e o mes ja fechou. Mudar o valor dela
// reescreveria um extrato que a pessoa ja conferiu.
//
// Uma conta VENCIDA e nao paga continua sendo presente: ela e uma obrigacao
// aberta, aparece em "Vencidas" na tela de contas previstas, e e justamente a
// que a pessoa vai querer corrigir ("a luz veio 340, nao 300"). Tratar
// `due_date < hoje` como passado impediria a correcao mais comum que existe.
//
// Por isso a barreira NAO e a data de hoje: e a data da ANCORA. Quem clicou em
// novembro pediu para mexer de novembro para frente, e outubro em aberto nao
// pode ser arrastado junto -- nem quando outubro ainda esta pendente.
//
// POR QUE A ANCORA E A BARREIRA, E NAO `hoje`
// -------------------------------------------
// Uma versao anterior desta regra usava `due_date >= hoje`, copiada da rota que
// edita a REGRA (`/api/recurring-rules/{id}`, que propaga para "todas as
// pendentes futuras"). Nas duas telas isso parece igual, e nao e: editando a
// ancora de dezembro com o alcance "esta e as proximas", o filtro por `hoje`
// tambem reescreveria outubro e novembro, que estao pendentes e sao ANTERIORES
// a ancora. A pessoa pediu "daqui para frente" e recebeu "desde sempre".
// ---------------------------------------------------------------------------
export const ALCANCES = ["apenas_esta", "esta_e_proximas"];
export function ehAlcanceValido(valor) {
    return ALCANCES.includes(valor);
}
/**
 * Quais linhas esta edicao toca.
 *
 * `ancora` e a ocorrencia clicada. `irmas` sao as outras ocorrencias da MESMA
 * regra (a ancora pode vir na lista ou nao; o resultado e o mesmo).
 *
 * A ancora entra sempre, mesmo paga: quem barra a edicao de uma ocorrencia paga
 * e a rota, com um 409 que explica o estorno, e nao este calculo. Se a barra
 * estivesse aqui, o pedido voltaria um "nada para atualizar" generico.
 */
export function planejarEdicao(alcance, ancora, irmas) {
    const base = {
        ids: [ancora.id],
        atualizarRegra: false,
        ancoraEm: ancora.due_date,
        preservadas: [],
    };
    // Conta avulsa (sem regra) nao tem "proximas": ela e uma linha so. Aceitar
    // `esta_e_proximas` aqui e inofensivo justamente porque nao ha irma para
    // arrastar, e recusar obrigaria a tela a saber disso antes de pedir.
    if (alcance === "apenas_esta" || !ancora.recurring_rule_id)
        return base;
    const daMesmaRegra = irmas.filter((o) => o.id !== ancora.id && o.recurring_rule_id === ancora.recurring_rule_id);
    const alcancadas = [];
    const preservadas = [];
    for (const irma of daMesmaRegra) {
        // A barreira. `>=` e sobre a data da ancora, nao sobre hoje -- ver o
        // cabecalho. Duas ocorrencias no mesmo dia (possivel numa serie que trocou
        // de dia de vencimento) andam juntas, que e a leitura de "as proximas".
        if (irma.due_date < ancora.due_date) {
            preservadas.push(irma.id);
            continue;
        }
        // Paga e passado, mesmo com vencimento depois da ancora: quem adiantou o
        // pagamento de dezembro ja moveu o dinheiro de dezembro.
        //
        // 'skipped' e 'cancelled' tambem ficam fora, por outro motivo: a pessoa
        // tirou aquele mes da agenda de proposito. Reescrever o valor de uma
        // ocorrencia pulada nao a ressuscita, mas deixa a linha inconsistente com
        // a decisao que a criou, e a proxima leitura nao sabe qual das duas vale.
        if (irma.status !== "pending") {
            preservadas.push(irma.id);
            continue;
        }
        alcancadas.push(irma.id);
    }
    return {
        ids: [ancora.id, ...alcancadas],
        atualizarRegra: true,
        ancoraEm: ancora.due_date,
        preservadas,
    };
}
/**
 * Os campos que uma edicao de ocorrencia pode propagar para as proximas.
 *
 * `due_date` NAO esta aqui, e essa ausencia e a decisao mais importante deste
 * arquivo. Copiar a data da ancora para as irmas colocaria dezembro, janeiro e
 * fevereiro todos vencendo no mesmo dia -- o indice unico
 * `idx_scheduled_rule_due_unique` (005) recusaria a segunda, e a edicao
 * voltaria um erro de banco sem relacao visivel com o que foi pedido.
 *
 * Mudar o DIA de vencimento de uma serie e alterar o calendario dela, e isso
 * vive na regra (`due_day` em `/api/recurring-rules/{id}`), que sabe apagar a
 * agenda pendente e gerar de novo. A rota recusa a combinacao em vez de aplicar
 * so na ancora: aplicar metade calada e o modo de falha que este projeto ja
 * pagou varias vezes.
 */
export const CAMPOS_PROPAGAVEIS = [
    "description",
    "amount",
    "category_id",
    "account_id",
    "notes",
];
/**
 * O patch cabe no alcance pedido?
 *
 * Devolve o motivo da recusa em vez de um booleano para que a rota responda o
 * que fazer ("mude o dia na regra"), e nao so que nao deu.
 */
export function conferirPatchNoAlcance(alcance, campos) {
    if (alcance !== "esta_e_proximas")
        return { ok: true };
    const naoPropagaveis = campos.filter((campo) => !CAMPOS_PROPAGAVEIS.includes(campo));
    if (naoPropagaveis.includes("due_date")) {
        return {
            ok: false,
            mensagem: 'Mudar o vencimento de várias parcelas é uma alteração no gasto fixo, não em uma conta. Altere o dia na regra, ou escolha "alterar apenas esta".',
        };
    }
    if (naoPropagaveis.length > 0) {
        return {
            ok: false,
            mensagem: `Estes campos valem só para uma ocorrência: ${naoPropagaveis.join(", ")}. Escolha "alterar apenas esta".`,
        };
    }
    return { ok: true };
}
