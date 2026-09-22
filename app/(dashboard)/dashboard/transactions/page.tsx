import { redirect } from "next/navigation";

// -----------------------------------------------------------------------------
// ESTA TELA DIZIA "Nenhuma transacao encontrada" PARA QUEM TINHA TRANSACOES
// -----------------------------------------------------------------------------
// Ate a HMO-124 este arquivo era uma casca: montava o cabecalho "Transacoes",
// dois botoes sem onClick ("Filtrar" e "Exportar") e um estado vazio fixo --
// "Nenhuma transacao encontrada / Suas transacoes aparecerao aqui quando voce
// comecar a usar o sistema". Ela NUNCA consultava nada. Alguem com duzentos
// lancamentos abria o item "Transacoes" do menu e lia que nao tinha nenhum.
//
// Isso e pior do que um erro: um erro manda a pessoa procurar ajuda, um zero
// confiante manda ela concluir que o app perdeu os dados dela.
//
// A lista de verdade sempre esteve em /dashboard/personal-finance, que le
// financial_transactions com filtro, categoria, rateio e anexo. Em vez de
// construir uma segunda tela de lancamentos -- duas telas para a mesma coisa
// divergem na primeira mudanca -- esta rota passa a levar para la, e o item
// duplicado saiu do menu lateral.
//
// A rota continua existindo porque ha links antigos apontando para ela.
// -----------------------------------------------------------------------------

export default function TransactionsPage() {
  redirect("/dashboard/personal-finance");
}
