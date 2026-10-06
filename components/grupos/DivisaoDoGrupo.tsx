"use client";

/**
 * A CONFIGURACAO DA DIVISAO DO GRUPO (HMO-245, fase 5).
 *
 * "lembrando que o total deve ser 100% entao se eu mexer em um,
 * automaticamente o outro se ajustar."
 *
 * Esta e a tela das fases 1, 3 e 4: o seletor de modo, um slider por membro, e
 * a direita o % e o R$ de cada um. Ela nao tem aritmetica propria -- ver
 * abaixo, porque isso e a decisao central deste arquivo.
 *
 * NENHUMA CONTA MORA AQUI
 * -----------------------
 * Tres numeros aparecem nesta tela, e os tres saem de funcao que ja existe, ja
 * tem teste e ja tem mutante:
 *
 *   * o rebalanceamento ao arrastar e `rebalancear` (lib/divisao-configurada.ts,
 *     fase 1). A regra -- a sobra vai para os OUTROS na proporcao que eles
 *     tinham, e divide igual quando eles somam zero -- e ambigua com tres
 *     membros, e resolve-la aqui de novo e como as duas telas passam a
 *     discordar sobre dinheiro;
 *   * o que a tela ABRE mostrando e `divisaoDoPeriodo` (fase 4), a MESMA funcao
 *     que o fechamento do mes usa para decidir o que vale. Nao e reuso por
 *     economia: e o que garante que a tela nunca mostre 70/30 sobre um mes que
 *     o fechamento rateou igual. Quando a configuracao gravada nao da para
 *     aplicar (modo `custom`, ou soma != 100%), `divisaoDoPeriodo` responde
 *     `equal` -- e esta tela abre em "Igual", concordando com o extrato;
 *   * o R$ de cada um e `ratearPorPeso` (lib/fechamento-do-grupo.ts), a mesma
 *     funcao que produz `por_membro[].devido`. Dividir `total * pct / 100` aqui
 *     seria a quarta copia de uma conta de centavo, e a que nao fecha: R$ 2.000
 *     entre tres daria 666,67 tres vezes, somando 2.000,01.
 *
 * O R$ E PREVIA DO SLIDER, E POR ISSO NAO E `por_membro[].devido`
 * ---------------------------------------------------------------
 * Da resposta do fechamento esta tela le `total` -- o quanto o grupo gasta no
 * mes -- e nao o `devido` de cada um. A diferenca importa: `devido` e a parte
 * calculada com a divisao GRAVADA, e quem esta arrastando o slider quer ver o
 * efeito do numero NOVO, antes de gravar. Mostrar `devido` ao lado de um slider
 * em 70% deixaria a coluna da direita parada em 50% enquanto a esquerda diz 70%
 * -- duas respostas na mesma linha.
 *
 * Como a previa passa pelo MESMO `ratearPorPeso` com o MESMO total, gravar e
 * recarregar devolve exatamente estes numeros. A previa nao e uma segunda conta:
 * e a mesma conta com o peso que ainda nao foi gravado.
 *
 * O ROTULO E "PROPORCIONAL", O VALOR GRAVADO E `percentage`
 * ---------------------------------------------------------
 * `default_split_type` aceita quatro valores, e dois deles se leem como
 * "proporcional": `percentage` e `proportional`. O que esta tela grava e
 * `percentage`, sempre.
 *
 * Nao e detalhe de nomenclatura -- e dinheiro. `proportional` le o SEGUNDO
 * armazem de porcentagem do schema (`group_member_proportions`), que a fase 7
 * aposenta e que `divisaoDoPeriodo` nao sabe aplicar: um grupo gravado como
 * `proportional` cai em `equal` no fechamento. A tela diria "proporcional
 * 70/30" e o mes fecharia 50/50, sem erro em lugar nenhum.
 *
 * SO O ADMIN GRAVA, MAS TODO MUNDO VE
 * -----------------------------------
 * O PUT da fase 3 responde 403 para membro que nao e admin. A tela entao abre
 * em modo leitura para quem nao e admin, em vez de esconder: saber com que
 * divisao o mes fecha e informacao de quem paga a conta, nao privilegio de
 * quem configura. Esconder tambem produziria o pior dos suportes -- "nao
 * aparece nada aqui" -- em vez de "so o admin muda isto".
 *
 * A LINHA SOBRE DESPESA JA LANCADA NAO E DISCLAIMER
 * -------------------------------------------------
 * A 025 trancou repontamento de divisao: mudar de 50/50 para 70/30 muda o
 * fechamento e a despesa NOVA, e nao reescreve uma linha de
 * `group_expense_splits` que o trigger ja gravou. Sem essa frase na tela, o
 * primeiro uso real e "mudei para 70/30 e a conta do mes passado nao mudou".
 *
 * POR QUE `<input type="range">` NATIVO, E POR QUE O CAMPO AO LADO
 * ---------------------------------------------------------------
 * Nao existe `@radix-ui/react-slider` no projeto. A logica de rebalanceamento e
 * nossa de qualquer jeito (ela vem da fase 1), entao a dependencia so traria o
 * arrasto -- e o `range` nativo ja arrasta, ja tem teclado e ja tem leitor de
 * tela. O que ele NAO tem e precisao: acertar "exatamente 70" com o dedo num
 * telefone e sorte. Por isso cada membro tem o `range` E um campo numerico, que
 * tambem e por onde a sonda de navegador dirige a tela -- `range` e notoriamente
 * ruim de dirigir fora de um dedo de verdade.
 *
 * Os dois chamam o MESMO `mexer()`. Dois caminhos de codigo para o mesmo gesto
 * seria um deles rebalanceando e o outro nao, dependendo de onde se tocou.
 *
 * O BOTAO QUE SEMEIA PELA RENDA (fase 6): ELE ESCREVE NOS SLIDERS, E PARA AI
 * --------------------------------------------------------------------------
 * "Clica, os sliders vao para os percentuais da renda, e da para ajustar antes de
 * salvar. A config fica parada depois." Entao o botao NAO grava: ele chama
 * `GET .../semear-divisao`, escreve os pesos no estado e muda o modo para
 * Proporcional. Quem grava continua sendo o "Salvar divisão".
 *
 * Isso tem duas consequencias visiveis aqui:
 *
 *   * ele e so do ADMIN, como os sliders. Dar o botao a quem nao pode salvar
 *     seria mexer numa tela que nao tem como ser gravada -- e o 403 viria no fim,
 *     depois do trabalho;
 *   * os percentuais vem do SERVIDOR somando 10000 (`proporcional`, o mesmo
 *     maior-resto de `igualitario`), entao nao passam por `rebalancear`: nao ha
 *     um membro "arrastado" em torno do qual rebalancear, e rebalancear em torno
 *     de um deles mudaria os outros dois, desfazendo a proporcao que a renda
 *     pediu. O que a tela confere e a INVARIANTE -- conjunto igual ao dela e soma
 *     10000 -- e recusa a resposta que nao fecha, em vez de consertar.
 *
 * E DOIS ROTULOS QUE NAO SAO ENFEITE, PORQUE 0% TIRA A PESSOA DA DIVISAO
 * ----------------------------------------------------------------------
 * `divisaoDaDespesa` OMITE o membro em 0% (`expense_splits.percentage` exige
 * `> 0`). Entao quem nao tem receita lancada no mes e semeado em 0% sai da conta
 * -- e sem rotulo isso e indistinguivel de um acordo de que ele nao paga:
 *
 *   * "sem receita lançada em <mês>" na linha do membro, que e um fato do mes e
 *     sobrevive a qualquer ajuste manual depois;
 *   * "em 0% fica fora da divisão" na linha de quem esta em zero AGORA, semeado
 *     ou arrastado a mao. Este segundo nao depende da semeadura de proposito: o
 *     zero sempre teve essa consequencia, e a tela nunca a dizia.
 *
 * O R$ DA RENDA APARECE SO PARA O PROPRIO DONO -- E QUEM RECORTA E A ROTA
 * -----------------------------------------------------------------------
 * "Percentual para todos; o R$ da renda so para o proprio dono." A tela mostra
 * `renda_centavos` quando ele vem, e ele so vem na linha do `auth.uid()` de quem
 * pediu. O recorte NAO esta aqui: se estivesse, o salario de todo mundo viajaria
 * no JSON e um `view-source` o leria. Ver o cabecalho de
 * app/api/expense-groups/[groupId]/semear-divisao/route.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CENTESIMOS_TOTAIS,
  dePercentual,
  divisaoDoPeriodo,
  igualitario,
  paraPercentual,
  rebalancear,
  type PesoDoMembro,
} from "@/lib/divisao-configurada";
import { ratearPorPeso } from "@/lib/fechamento-do-grupo";
import { rotuloDoMes } from "@/lib/periodo-do-grupo";
import { toCents, toReais } from "@/lib/settlement";
import { formatarValor } from "@/lib/dinheiro";

/** Um membro ATIVO do grupo, como esta tela precisa dele. */
export interface MembroDaDivisao {
  /**
   * `group_members.id`.
   *
   * E a chave em todo este arquivo, e nao `user_id`, porque e ela que o PUT da
   * fase 3 exige no corpo: a rota confere o conjunto contra os `id` dos membros
   * ativos e recusa um conjunto que nao seja exatamente aquele. Usar `user_id`
   * aqui exigiria uma traducao no fim, e uma traducao a mais e uma ordem a mais
   * para sair de sincronia -- o defeito dela e a parte de um no nome do outro.
   */
  member_id: string;
  nome?: string | null;
  /** `group_members.percentage`, como veio do banco (`numeric(5,2)`). */
  percentage?: unknown;
}

/** O modo que esta tela sabe gravar. Ver o cabecalho sobre `proportional`. */
type Modo = "equal" | "percentage";

/**
 * Com o que a tela ABRE: o modo e os pesos que o fechamento do mes esta
 * aplicando HOJE.
 *
 * Quem decide e `divisaoDoPeriodo` -- a MESMA funcao do fechamento --, e nao uma
 * leitura propria da coluna. Ver o cabecalho: e isso que garante que a tela
 * nunca abra em 70/30 sobre um mes que fechou igual. Um grupo gravado como
 * `percentage` com os quatro zeros do `DEFAULT 0.00` (o estado de todo grupo que
 * ninguem configurou) abre em "Igual", porque e igual que o fechamento dele esta
 * rateando.
 *
 * Em `equal` os pesos exibidos sao `igualitario`, e NAO o que esta na coluna.
 * Um grupo que ja foi 70/30 e voltou para "Igual" tem 70 e 30 parados na coluna:
 * mostra-los sob o rotulo "Igual" seria a tela se contradizendo em dois
 * centimetros de distancia. `igualitario` distribui 10000 por maior resto, entao
 * tres membros abrem em 33,34 / 33,33 / 33,33 -- somando 100% cravado.
 */
function divisaoQueOMesAplica(
  membros: MembroDaDivisao[],
  gravado: unknown
): { modo: Modo; pesos: PesoDoMembro[] } {
  const aplicada = divisaoDoPeriodo(
    gravado,
    // `user_id` aqui recebe o `member_id`: `divisaoDoPeriodo` nao interpreta a
    // chave, so a devolve ao lado do peso. Passar o `member_id` e o que mantem
    // uma chave so em todo o arquivo.
    membros.map((m) => ({ user_id: m.member_id, percentage: m.percentage }))
  );

  if (aplicada.aplicado === "percentage") {
    return {
      modo: "percentage",
      pesos: aplicada.pesos.map((p) => ({
        member_id: p.user_id,
        centesimos: p.peso,
      })),
    };
  }

  return {
    modo: "equal",
    pesos: igualitario(membros.map((m) => m.member_id)),
  };
}

/**
 * O peso com que a PREVIA em reais rateia o total -- e por que ele nao e sempre
 * o percentual que esta na tela.
 *
 * Em `equal` o fechamento usa peso 1 para todos e IGNORA a coluna
 * (`divisaoDoPeriodo`), entao a previa tambem tem de usar 1. A diferenca nao e
 * teorica: R$ 2.000 entre tres com peso 1 da 666,67 / 666,67 / 666,66, e com os
 * percentuais de `igualitario` (33,34 / 33,33 / 33,33) daria 666,80 / 666,60 /
 * 666,60. Treze centavos de distancia entre a previa e o extrato, todo mes, num
 * grupo de tres.
 *
 * A raiz e que a divisao igual de tres NAO cabe em `numeric(5,2)` -- 100/3 nao
 * tem duas casas. A arquitetura ja resolveu isso tirando a coluna do caminho em
 * `equal`; o que esta tela precisa e nao reintroduzir o problema na previa.
 *
 * Consequencia assumida: em `equal`, com tres membros, a coluna mostra 33,34% ao
 * lado de R$ 666,67 (que e 33,333%). O numero da ESQUERDA e o que fica gravado
 * na coluna; o da DIREITA e o dinheiro que o fechamento vai cobrar. Entre os
 * dois, quem tem de estar certo e o dinheiro.
 */
function pesoDaPrevia(modo: Modo, peso: PesoDoMembro): number {
  return modo === "equal" ? 1 : peso.centesimos;
}

/** O percentual, em pt-BR, para o rotulo e para o campo. */
function textoDoPercentual(centesimos: number): string {
  return paraPercentual(centesimos).toFixed(2).replace(".", ",");
}

/**
 * O texto do campo de volta para centesimo de ponto -- so os DIGITOS.
 *
 * E a mesma mecanica de `aoDigitarValor` (lib/dinheiro.ts), que e como todo
 * campo numerico deste app recebe numero: so digito conta, e as duas ultimas
 * casas sao a fracao. Aqui isso cai redondo, porque o centesimo de ponto JA e a
 * segunda casa decimal do percentual -- digitar "7000" e pedir 70,00%.
 *
 * POR QUE NAO `type="number"`, QUE ERA O OBVIO
 * --------------------------------------------
 * Porque ele descarta a virgula CALADO, e o preco disso e dinheiro. O teclado
 * numerico do telefone em pt-BR entrega virgula; um `input type="number"` com
 * virgula e um campo INVALIDO, e o navegador devolve `value === ""` -- nao o
 * texto digitado. Medido na sonda desta issue: com `type="number"`, digitar
 * "70,5" fazia o campo ler `""`, o membro cair para 0,00% e o OUTRO saltar para
 * 100% -- a conta da casa inteira no nome de uma pessoa, por causa de uma tecla.
 *
 * Com extracao de digitos nao existe texto invalido: a virgula e descartada
 * junto com qualquer outra coisa que nao seja digito, e o campo nunca recebe um
 * valor que ele nao sabe ler.
 *
 * O corte em 5 digitos e o teto: 10000 centesimos e 100%, e `rebalancear` ja
 * limita nele. Sem o corte, digitar sem parar faria o `Number` crescer sem
 * limite antes do limite -- sem defeito visivel, mas tambem sem motivo.
 */
function centesimosDigitados(texto: string): number {
  // A poda de zero a esquerda vem ANTES do corte, e e so por causa dele:
  // `Number("007")` ja e 7, entao sozinha ela nao muda nada -- o que ela evita e
  // o corte gastar as cinco casas em zeros e devolver "00000", ou seja 0%, para
  // um texto que tinha digito significativo depois. Em `aoDigitarValor` ela tem
  // outra razao (lá o texto e fatiado, nao convertido); aqui e esta.
  const digitos = texto.replace(/\D/g, "").replace(/^0+/, "").slice(0, 5);

  // `/100` porque o texto ja esta em centesimos de ponto e `dePercentual` espera
  // PONTO percentual: "7000" -> 70 -> 7000 centesimos. Sem ele "7000" viraria
  // 700.000 centesimos, que o teto corta para 100%.
  return dePercentual(Number(digitos || 0) / 100);
}

export function DivisaoDoGrupo({
  groupId,
  membros,
  modoGravado,
  mes,
  ehAdmin,
  /**
   * O total do mes em reais, quando quem ja sabe e o chamador.
   *
   * Existe para a sonda de navegador poder medir a ligacao slider -> R$ sem
   * rede, e para um chamador que ja carregou o fechamento nao pedir de novo.
   * `undefined` (o caso do app) faz esta tela buscar; `null` significa "nao ha
   * total", e e diferente de `undefined`.
   */
  totalDoMes,
  aoGravar,
}: {
  groupId: string;
  membros: MembroDaDivisao[];
  modoGravado: unknown;
  /** `YYYY-MM`. Vem do seletor da tela, para nao haver dois meses na mesma aba. */
  mes: string;
  ehAdmin: boolean;
  totalDoMes?: number | null;
  aoGravar?: () => void;
}) {
  // O estado inicial dos dois sai da MESMA chamada: pedir modo e pesos a duas
  // chamadas separadas e como eles passam a discordar ("Igual" selecionado com
  // 70/30 nos sliders) no dia em que uma das duas mudar de regra.
  const [inicial] = useState(() => divisaoQueOMesAplica(membros, modoGravado));
  const [modo, setModo] = useState<Modo>(inicial.modo);
  const [pesos, setPesos] = useState<PesoDoMembro[]>(inicial.pesos);
  const [totalBuscado, setTotalBuscado] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [semeando, setSemeando] = useState(false);

  /**
   * O que a ultima semeadura DISSE -- separado dos pesos, que ela so escreveu.
   *
   * Guarda o `mes` junto porque o mes e PROP: trocar de mes no seletor nao
   * remonta este componente, e um rotulo "sem receita lançada" de outubro
   * pendurado na tela de novembro seria uma afirmacao falsa sobre um mes que
   * ninguem leu. Ver `semeado`, logo abaixo.
   */
  const [semeadura, setSemeadura] = useState<{
    mes: string;
    /** `member_id` de quem saiu em 0% por nao ter receita no mes. */
    semRenda: string[];
    /** NINGUEM lancou receita: a semeadura caiu na divisao igual. */
    semRendaNenhuma: boolean;
    /** A renda de QUEM PEDIU, em centavos. `null` = a rota nao mandou. */
    rendaPropria: number | null;
  } | null>(null);

  const total = totalDoMes !== undefined ? totalDoMes : totalBuscado;

  // A semeadura so fala do mes dela. Guarda em vez de `useEffect` que limpa:
  // um efeito por mudanca de prop teria de rodar DEPOIS do render, e o render
  // do meio mostraria o rotulo do mes velho.
  const semeado = semeadura && semeadura.mes === mes ? semeadura : null;

  useEffect(() => {
    if (totalDoMes !== undefined) return;

    // `vivo` em vez de `AbortController` porque o que precisa ser evitado nao e
    // a chamada: e a resposta de um mes ANTIGO chegando depois da do mes novo e
    // sobrescrevendo a coluna de R$ com os numeros do mes errado.
    let vivo = true;

    (async () => {
      try {
        const r = await fetch(
          `/api/expense-groups/${groupId}/fechamento?mes=${mes}`
        );
        if (!r.ok) {
          if (vivo) setTotalBuscado(null);
          return;
        }
        const d = await r.json();
        if (vivo) setTotalBuscado(typeof d?.total === "number" ? d.total : null);
      } catch {
        if (vivo) setTotalBuscado(null);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [groupId, mes, totalDoMes]);

  /**
   * O centavo de cada membro na previa, por `member_id`.
   *
   * `null` enquanto o total nao chegou: a tela mostra "—" em vez de R$ 0,00,
   * que se leria como "o grupo nao gastou nada neste mes".
   */
  const centavosPorMembro = useMemo(() => {
    if (total === null) return null;
    return ratearPorPeso(
      toCents(total),
      // A mesma chave do resto do arquivo. `ratearPorPeso` tambem so devolve a
      // chave que recebeu. O peso vem de `pesoDaPrevia` -- ver lá por que em
      // `equal` ele nao e o percentual da tela.
      pesos.map((p) => ({ user_id: p.member_id, peso: pesoDaPrevia(modo, p) }))
    );
  }, [total, pesos, modo]);

  /**
   * O gesto, de qualquer uma das duas entradas.
   *
   * Toda mudanca passa por `rebalancear`, entao nao existe estado intermediario
   * em que a lista desta tela nao some 100% -- e portanto nao existe caminho em
   * que o botao grave um conjunto que a rota vai recusar pela soma.
   */
  const mexer = useCallback((memberId: string, centesimos: number) => {
    setSalvo(false);
    setPesos((atuais) => rebalancear(atuais, memberId, centesimos));
  }, []);

  const trocarModo = useCallback(
    (novo: Modo) => {
      setSalvo(false);
      setErro(null);
      setModo(novo);
      // "Igual" reescreve os pesos em vez de apenas desabilitar os sliders: o
      // que vai ser GRAVADO e a lista de percentuais (a fase 3 exige `members`
      // tambem em `equal`), e deixar 70/30 na coluna com o modo em "Igual"
      // gravaria uma tela que diz uma coisa e uma coluna que diz outra.
      if (novo === "equal") {
        setPesos(igualitario(membros.map((m) => m.member_id)));
      }
    },
    [membros]
  );

  /**
   * O botao da fase 6: os sliders vao para a proporcao da receita do mes.
   *
   * Nao grava. Ver o cabecalho: a decisao e "semear, nao viver" -- e a diferenca
   * entre as duas e exatamente este botao existir em vez de o fechamento reler a
   * renda todo mes.
   */
  async function semear() {
    setSemeando(true);
    setErro(null);
    setSalvo(false);

    try {
      const r = await fetch(
        `/api/expense-groups/${groupId}/semear-divisao?mes=${mes}`
      );
      const d = await r.json().catch(() => null);

      if (!r.ok) {
        setErro(
          typeof d?.error === "string"
            ? d.error
            : "Não foi possível semear a divisão pela receita do mês."
        );
        return;
      }

      const linhas: unknown[] = Array.isArray(d?.membros) ? d.membros : [];
      const porMembro = new Map<string, Record<string, unknown>>();
      for (const l of linhas) {
        const linha = l as Record<string, unknown>;
        if (typeof linha?.member_id === "string") {
          porMembro.set(linha.member_id, linha);
        }
      }

      // A lista que vale e a DESTA tela, na ordem dela: o render casa
      // `pesos[i]` com `membros[i]`, entao aceitar a ordem do servidor poria o
      // percentual de um no slider do outro no dia em que as duas ordens
      // divergissem.
      const novos: PesoDoMembro[] = membros.map((m) => ({
        member_id: m.member_id,
        centesimos: Number(porMembro.get(m.member_id)?.centesimos),
      }));

      // A invariante, conferida em vez de consertada. Um membro que entrou (ou
      // saiu) do grupo entre o render e o clique faz o conjunto divergir, e
      // normalizar aqui gravaria uma divisao que a renda nao pediu -- com a tela
      // somando 100% e nada denunciando.
      const soma = novos.reduce((acc, p) => acc + p.centesimos, 0);
      const completo = novos.every((p) => Number.isFinite(p.centesimos));

      if (!completo || soma !== CENTESIMOS_TOTAIS) {
        setErro(
          "A lista de membros do grupo mudou enquanto esta tela estava aberta. " +
            "Recarregue antes de semear pela receita."
        );
        return;
      }

      // Proporcional, e nao Igual: o que a renda produziu e uma lista de
      // percentuais, e em modo `equal` o fechamento IGNORA a coluna -- os
      // sliders mostrariam 70/30 sobre um mes que fecharia metade a metade.
      setModo("percentage");
      setPesos(novos);

      const propria = linhas
        .map((l) => l as Record<string, unknown>)
        .find((l) => typeof l?.renda_centavos === "number");

      setSemeadura({
        mes,
        semRenda: membros
          .map((m) => m.member_id)
          .filter((id) => porMembro.get(id)?.tem_renda === false),
        semRendaNenhuma: d?.sem_renda_nenhuma === true,
        rendaPropria:
          typeof propria?.renda_centavos === "number"
            ? propria.renda_centavos
            : null,
      });
    } catch {
      setErro("Não foi possível semear a divisão pela receita do mês.");
    } finally {
      setSemeando(false);
    }
  }

  async function gravar() {
    setSalvando(true);
    setErro(null);
    setSalvo(false);

    try {
      const r = await fetch(`/api/expense-groups/${groupId}/split-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_split_type: modo,
          members: pesos.map((p) => ({
            member_id: p.member_id,
            percentage: paraPercentual(p.centesimos),
          })),
        }),
      });

      const d = await r.json().catch(() => null);

      if (!r.ok) {
        setErro(
          typeof d?.error === "string"
            ? d.error
            : "Não foi possível gravar a divisão do grupo."
        );
        return;
      }

      setSalvo(true);
      aoGravar?.();
    } catch {
      setErro("Não foi possível gravar a divisão do grupo.");
    } finally {
      setSalvando(false);
    }
  }

  // Grupo sem membro ativo nenhum nao tem divisao a configurar, e a tela sem
  // este caminho mostraria cabecalho, seletor de modo e uma lista vazia -- que
  // se le como "quebrou".
  if (membros.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este grupo não tem membros ativos para dividir a conta.
      </p>
    );
  }

  const nomeDe = (m: MembroDaDivisao) =>
    // Nome ausente e caminho NORMAL, nao defeito: nenhuma policy de `profiles`
    // olha `group_members`, entao ser do mesmo grupo nao da acesso ao perfil do
    // outro. Sem este rotulo a linha apareceria com um slider sem dono.
    (m.nome ?? "").trim() || "Membro do grupo";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Como o fechamento do mês divide a conta do grupo entre os membros.
        </p>
        {/*
          A linha da 025. Ver o cabecalho: sem ela o primeiro uso real e "mudei
          para 70/30 e a conta do mes passado nao mudou".
        */}
        <p className="text-sm text-muted-foreground" id="divisao-aviso-retroativo">
          Mudar a divisão vale para o fechamento e para as despesas novas. As
          despesas já lançadas mantêm a divisão com que foram lançadas.
        </p>
      </div>

      {/* O seletor de modo. Dois botoes, e nao um Select: sao duas opcoes, e um
          Select esconderia metade da escolha atras de um toque. */}
      <div className="flex gap-2" role="group" aria-label="Modo de divisão">
        {(
          [
            ["equal", "Igual"],
            ["percentage", "Proporcional"],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            id={`divisao-modo-${valor}`}
            aria-pressed={modo === valor}
            disabled={!ehAdmin}
            onClick={() => trocarModo(valor)}
            className={
              "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 " +
              (modo === valor
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted")
            }
          >
            {rotulo}
          </button>
        ))}
      </div>

      {/*
        O botao da fase 6. So para o admin: ele escreve nos sliders, e quem nao
        pode salvar nao tem o que fazer com eles.
      */}
      {ehAdmin && (
        <div className="space-y-2 rounded-md border p-3">
          <button
            type="button"
            id="divisao-semear"
            disabled={semeando}
            onClick={semear}
            className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-muted disabled:opacity-60"
          >
            {semeando
              ? "Lendo a receita..."
              : "Semear pela receita do mês"}
          </button>
          {/*
            A legenda diz as DUAS coisas que a pessoa precisa saber antes de
            clicar, e as duas sao decisoes do Helio: o periodo (recebida +
            prevista, a mesma regua da despesa do mes) e que a divisao fica
            PARADA depois. Sem a segunda frase o botao se le como "passar a
            dividir pela renda", que e outra feature.
          */}
          <p className="text-sm text-muted-foreground" id="divisao-semear-legenda">
            Leva os sliders para a proporção da receita de cada um em{" "}
            {rotuloDoMes(mes)} — recebida e prevista, a mesma régua das despesas
            do mês. Você ajusta antes de salvar, e a divisão não muda sozinha
            depois.
          </p>
          {semeado?.semRendaNenhuma && (
            <p className="text-sm text-warning" id="divisao-semear-sem-renda-nenhuma">
              Ninguém do grupo lançou receita em {rotuloDoMes(mes)}. Não há
              proporção para aplicar, então os sliders foram para a divisão
              igual.
            </p>
          )}
          {semeado?.rendaPropria !== null &&
            semeado?.rendaPropria !== undefined && (
              <p className="text-sm text-muted-foreground" id="divisao-semear-renda-propria">
                A sua receita em {rotuloDoMes(mes)}:{" "}
                {formatarValor(toReais(semeado.rendaPropria))}. Só você vê este
                valor — os outros membros veem apenas as porcentagens.
              </p>
            )}
        </div>
      )}

      <div className="space-y-4">
        {pesos.map((p, i) => {
          const membro = membros[i];
          const centavos = centavosPorMembro?.get(p.member_id);
          const percentual = paraPercentual(p.centesimos);

          return (
            <div key={p.member_id} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  id={`divisao-nome-${p.member_id}`}
                  className="text-sm font-medium truncate"
                >
                  {nomeDe(membro)}
                </span>
                {/*
                  A coluna da direita: % e R$.

                  Os dois sao SPAN com id, e nao o `value` do campo numerico, de
                  proposito -- o React escreve `value` como PROPRIEDADE, e o
                  atributo que sai num dump de DOM e o inicial. Medir o atributo
                  seria uma sonda que nunca ve a mudanca que ela foi escrita para
                  provar.
                */}
                <span className="shrink-0 text-sm tabular-nums">
                  <span id={`divisao-pct-${p.member_id}`} className="font-medium">
                    {/* O MESMO texto do campo ao lado, pela mesma funcao: dois
                        formatadores para o mesmo numero e como eles passam a
                        discordar em uma casa decimal. */}
                    {textoDoPercentual(p.centesimos)}%
                  </span>
                  <span
                    id={`divisao-valor-${p.member_id}`}
                    className="text-muted-foreground"
                  >
                    {" · "}
                    {/*
                      SEM moeda, ou seja em real -- mesmo num grupo de viagem em
                      dolar. O total que esta tela rateia vem de
                      `valorDoFechamento`, que ja multiplicou cada linha pela
                      cotacao do dia da compra: o numero E real, e rotula-lo com
                      a moeda da viagem seria o valor certo com o simbolo errado.
                      E a mesma escolha do FechamentoDoMes, que tambem chama
                      `formatarValor` sem segundo argumento.
                    */}
                    {centavos === undefined
                      ? "—"
                      : formatarValor(toReais(centavos))}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  id={`divisao-slider-${p.member_id}`}
                  aria-label={`Percentual de ${nomeDe(membro)}`}
                  min={0}
                  max={100}
                  step={1}
                  /*
                    O passo e 1 ponto percentual, e por isso o valor do `range`
                    e o percentual ARREDONDADO -- nao o exato.

                    Tres membros em divisao igual ficam em 33,34 / 33,33 /
                    33,33, que nao sao multiplos do passo: o navegador encaixa o
                    polegar no degrau mais proximo de qualquer jeito, e mandar
                    33,33 num `range` de passo 1 deixaria o React corrigindo a
                    propriedade a cada render. O numero EXATO continua no rotulo
                    e no campo ao lado, que e quem acerta "exatamente 70".
                    Passo 0,01 resolveria o encaixe e quebraria o teclado: cada
                    seta andaria um centesimo de ponto, 10.000 degraus de ponta
                    a ponta.
                  */
                  value={Math.round(percentual)}
                  disabled={!ehAdmin || modo === "equal"}
                  onChange={(e) =>
                    // `* 100`: o `range` anda de ponto percentual inteiro e a
                    // unidade da fase 1 e o CENTESIMO de ponto. Sem isso
                    // arrastar para 70 pediria 0,70%.
                    mexer(p.member_id, Number(e.target.value) * 100)
                  }
                  // `accent-primary` e token: `accent-blue-500` nao muda no tema
                  // escuro e o `check-color-tokens` reprova.
                  className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="flex shrink-0 items-center gap-1">
                  {/*
                    `type="text"` com `inputMode="decimal"`: o teclado do
                    telefone continua numerico, e a virgula dele deixa de
                    zerar o campo -- ver `centesimosDigitados`.
                  */}
                  <input
                    type="text"
                    id={`divisao-campo-${p.member_id}`}
                    aria-label={`Percentual exato de ${nomeDe(membro)}`}
                    inputMode="decimal"
                    value={textoDoPercentual(p.centesimos)}
                    disabled={!ehAdmin || modo === "equal"}
                    onChange={(e) =>
                      mexer(p.member_id, centesimosDigitados(e.target.value))
                    }
                    className="h-9 w-20 rounded-md border bg-background px-2 text-right text-sm tabular-nums disabled:opacity-60"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>

              {/*
                Os dois rotulos do zero. Ver o cabecalho: membro em 0% e OMITIDO
                por `divisaoDaDespesa`, e sem dizer isso a tela a semeadura tira
                a pessoa da conta em silencio.

                Eles sao separados de proposito. O primeiro e um fato do MES (e
                continua verdadeiro depois de o admin arrastar o slider dele para
                30%); o segundo descreve o estado ATUAL do slider, e aparece
                tambem para quem foi posto em zero a mao, sem semeadura nenhuma.
              */}
              {semeado?.semRenda.includes(p.member_id) && (
                <p
                  id={`divisao-sem-renda-${p.member_id}`}
                  className="text-sm text-muted-foreground"
                >
                  Sem receita lançada em {rotuloDoMes(mes)}.
                </p>
              )}
              {p.centesimos === 0 && (
                <p
                  id={`divisao-fora-${p.member_id}`}
                  className="text-sm text-warning"
                >
                  Em 0% fica fora da divisão: as despesas novas do grupo não
                  terão parte para {nomeDe(membro)}.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {total === null && (
        <p className="text-sm text-muted-foreground">
          O valor em reais de cada um aparece quando o fechamento deste mês
          carregar.
        </p>
      )}

      {erro && (
        <p className="text-sm text-destructive" id="divisao-erro">
          {erro}
        </p>
      )}

      {ehAdmin ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="divisao-gravar"
            disabled={salvando}
            onClick={gravar}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar divisão"}
          </button>
          {salvo && (
            <span className="text-sm text-success" id="divisao-salvo">
              Divisão salva.
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Só o administrador do grupo muda a divisão.
        </p>
      )}
    </div>
  );
}
