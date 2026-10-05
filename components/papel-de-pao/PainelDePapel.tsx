"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { caminhoDoCartaoNoMes } from "@/lib/fatura-do-cartao";
import {
  FRASE_SEM_CONTAS,
  FRASE_SEM_SALARIO,
  ROTULO_DAS_DESPESAS,
  ROTULO_DAS_RECEITAS,
  TITULO_SEM_RESPOSTA,
  type LinhaDoDetalhe,
  type NumeroDoPapel,
  type SobraOuFalta,
} from "@/lib/papel-de-pao";
import {
  ehPeriodoCorrente,
  passoDeMes,
  periodoCorrente,
  rotuloDoPeriodo,
  type Periodo,
} from "@/lib/periodo-do-painel";

/**
 * A TELA DO MODO PAPEL DE PAO -- HMO-286 (3/3 do plano da HMO-279), com o rotulo
 * encurtado pela HMO-294 (4/6), o passo de mes da HMO-295 (5/6) e o cartao
 * "Quanto Sobra ou Quanto Falta" da HMO-296 (6/6).
 *
 * TRES CARTOES, e esses tres: "Salario", "Total de contas" e a diferenca entre
 * RECEITAS e DESPESAS do mes. Nenhum outro cartao do painel completo aparece
 * aqui, e e por isso que esta e uma TELA IRMA dele e nao um `if` dentro dele.
 *
 * O TERCEIRO CARTAO NAO FAZ CONTA NENHUMA (HMO-296). Titulo, valor e as duas
 * parcelas vem prontos no `sobra_ou_falta` da resposta, calculados por
 * `sobraOuFalta` em lib/papel-de-pao.ts sobre as MESMAS pernas que alimentam os
 * dois cartoes de cima. Recalcular aqui criaria a segunda definicao de
 * "Receitas - Despesas", e a copia esquecida e o defeito: o "Total de contas"
 * desta tela nao e "a soma dos `amount` de despesa" -- ele tira a compra
 * individual no cartao, junta a fatura aberta, divide a minha parte da linha de
 * grupo e descarta `skipped`/`cancelled`. Uma segunda soma erraria nesses quatro
 * elos ao mesmo tempo e pareceria certa na tela.
 *
 * ===========================================================================
 * O PASSO DE MES (HMO-295)
 * ===========================================================================
 * "E ter a opcao de ver mes a mes pro usuario saber quando ele ja tem de contas
 * pro mes seguinte" -- o pedido e literal, e o que entra e literalmente um
 * passo: `< outubro de 2026 >`, mais um "Hoje" que aparece SO fora do mes
 * corrente. O mesmo gesto do painel grande.
 *
 * NAO ENTRA O `SeletorDePeriodo`. Ele e o seletor completo -- presets, modo
 * intervalo, dois campos de data mascarados e o rascunho do par (ver
 * `extremoDigitado`) --, e traze-lo arrastaria a tela mais delicada do app para
 * dentro do modulo mais simples. Tambem nao faria sentido: este painel so sabe
 * responder MES (a rota recebe `?month=AAAA-MM`), e metade dos controles
 * daquele seletor produz intervalo.
 *
 * NENHUMA MATEMATICA DE MES NOVA. `passoDeMes`, `periodoCorrente`,
 * `ehPeriodoCorrente` e `rotuloDoPeriodo` vem de lib/periodo-do-painel.ts, que
 * e o que o painel completo usa. A segunda implementacao de "o mes seguinte"
 * neste repositorio seria o defeito e nao a feature: a primeira ja carrega a
 * correcao de fuso que custou a HMO-173, e `rotuloDoPeriodo` ja tira o nome do
 * mes dos COMPONENTES da string ISO (`iso.slice(5, 7)`) em vez de um `new Date`
 * -- `new Date("2026-11-01")` e meia-noite UTC e em Sao Paulo imprime
 * *outubro*.
 *
 * O ESTADO E UM `Periodo`, E NAO UMA STRING `AAAA-MM`
 * ---------------------------------------------------
 * Porque e o que aquelas quatro funcoes falam. Guardar `"2026-11"` aqui
 * obrigaria a converter nas duas pontas, e a conversao e exatamente onde a
 * aritmetica de mes voltaria a ser escrita a mao. O mes que vai para a
 * querystring sai de `periodo.de.slice(0, 7)`, que e a mesma derivacao que a
 * rota faz para ECOAR o mes de volta -- e e isso que faz os dois lados
 * concordarem sobre o que "o mes pedido" significa.
 *
 * O ESTADO NAO VAI PARA A URL, diferente do painel completo (`?de=&ate=`). Nao
 * ha por que: o modo simples nao tem link para compartilhar nem navegacao entre
 * recortes, e por o par na URL traria o `useSearchParams`/`router.replace` do
 * painel grande para dentro da tela que a issue pediu minima.
 *
 * O ROTULO E "Salario", E O CAMPO CONTINUA `salario_previsto`
 * ----------------------------------------------------------
 * O rotulo da tela encurtou; o campo da resposta de
 * `GET /api/papel-de-pao/painel` NAO. Ele e fio, nao tela: renomea-lo mexeria
 * na rota e na suite para comprar nada. `NOME_DA_CATEGORIA_DE_SALARIO` tambem
 * fica como esta -- ele e o nome da categoria no banco, semeado pelo `001`, que
 * agora por coincidencia tem o mesmo texto do rotulo. Sao duas constantes
 * diferentes com o mesmo valor, e juntar as duas faria o rotulo da tela mudar
 * junto com o seed.
 *
 * `FRASE_SEM_SALARIO` ("nenhum salario previsto para este mes") segue inteira,
 * em minuscula e dentro do cartao -- ela diz o que o numero nao tem, e le bem
 * debaixo do titulo curto. Nao confunda as duas: um `grep` por "salario
 * previsto" que ignore caixa acha a frase, nao o rotulo.
 *
 * POR QUE TELA IRMA, E NAO "esconder os cartoes"
 * ----------------------------------------------
 * `app/(dashboard)/dashboard/page.tsx` tem 1.295 linhas e dispara OITO
 * requisicoes em paralelo no `useEffect`. Esconder cartoes nao serve: os hooks
 * rodam antes de qualquer `if` de renderizacao, entao o modo simples faria oito
 * chamadas de rede para mostrar tres numeros -- no aparelho de quem escolheu o
 * modo justamente por querer menos.
 *
 * Aqui e UMA chamada, para uma rota que existe para esta tela. O terceiro cartao
 * da HMO-296 nao a duplicou: ele e a diferenca de duas pernas da mesma leitura.
 *
 * A LETRA MANUSCRITA, DE NOVO E EXPLICITA
 * ---------------------------------------
 * O modo ja poe a manuscrita na tela inteira (`.papel body` em
 * `app/globals.css`). `font-papel` nos valores nao e redundancia: e o padrao 5
 * aprovado -- os numeros em corpo GRANDE e na manuscrita --, e pedir a fonte no
 * proprio elemento mantem isso verdade se a regra do `body` mudar.
 * A utilitaria existe no `tailwind.config.js` exatamente para este caso.
 *
 * A LINHA DAS PARCELAS do terceiro cartao e a excecao declarada ao "corpo
 * grande": ela e pequena de proposito, porque e CONFERENCIA e nao resposta. O
 * que ela responde esta no numero grande logo acima dela.
 *
 * ===========================================================================
 * O CHEVRON DOS DOIS CARTOES DE CIMA (HMO-300, 9/10)
 * ===========================================================================
 * "No Dashboard nos cards de salario e contas ter um chevron na direita que
 * voce pode expandir uma lista com detalhes das contas" -- o pedido e literal,
 * e o desenho inteiro sai de uma regra so: A SOMA DAS LINHAS ABERTAS E
 * EXATAMENTE O TOTAL DO CARTAO FECHADO. Uma lista que nao fecha com o numero de
 * cima e pior que cartao nenhum: ela transforma um numero conferivel num numero
 * desmentido pela propria tela.
 *
 * Por isso a lista NAO e montada aqui. Ela chega pronta no `detalhe` de cada
 * numero, construida por `somarPerna` na MESMA passada que produziu o total --
 * mesma peneira, mesma janela, mesmo status, mesma divisao da parte do grupo.
 * Ver `NumeroGrande` para o que isso proibe nesta tela.
 *
 * SO OS DOIS DE CIMA TEM SETA. O terceiro cartao ja mostra as duas parcelas
 * dele, e a "lista" dele seria a uniao das outras duas -- um terceiro lugar
 * para a mesma soma divergir. Padrao aprovado na revisao 3 do plano (item 4 de
 * 9.5).
 *
 * NAO HA BOTAO DE ACAO AQUI, e e deliberado: a navegacao do modo ja existe -- o
 * menu reduzido da HMO-284 tem as sete telas, e o papelzinho desliga o modo. Um
 * atalho a mais nesta tela seria o primeiro cartao de uma tela que a issue pediu
 * minima. As duas setas e o "Hoje" da HMO-295 nao sao excecao a isso: nenhum dos
 * tres leva a outra tela nem escreve nada -- os tres mexem em QUAL mes estes
 * mesmos numeros respondem, e sem eles os numeros respondiam uma pergunta que a
 * tela nao deixava mudar.
 */

/**
 * UM DOS DOIS NUMEROS, COMO ELE CHEGA PELO FIO.
 *
 * `detalhe` e OPCIONAL aqui e OBRIGATORIO em `NumeroDoPapel`, e a diferenca nao
 * e descuido: este tipo descreve o CORPO QUE CHEGA, e o cache do PWA guarda as
 * rotas /api/ por 24h. No dia do deploy da HMO-300 existe um corpo valido, do
 * mes certo, SEM este campo -- lido como obrigatorio ele viraria um
 * `undefined.length` e levaria a tela inteira, nao a seta. Ausente, o cartao
 * fica exatamente como era antes desta issue: o numero, e nenhum chevron.
 *
 * E a mesma razao, e o mesmo desenho, do `sobra_ou_falta?` logo abaixo.
 */
type NumeroNoFio = Omit<NumeroDoPapel, "detalhe"> & {
  detalhe?: LinhaDoDetalhe[];
};

/** A resposta de GET /api/papel-de-pao/painel. */
interface RespostaDoPainel {
  month: string;
  range: { from: string; to: string };
  salario_previsto: NumeroNoFio;
  total_de_contas: NumeroNoFio;
  /**
   * OPCIONAL de proposito, e isto nao e frouxura de tipo: este campo descreve o
   * que CHEGA PELO FIO, e o cache do PWA guarda as rotas /api/ por 24h. No dia
   * do deploy da HMO-296 existe um corpo valido, do mes certo, SEM este campo --
   * e lido como obrigatorio ele viraria um `undefined.titulo` e levaria a tela
   * inteira, nao o cartao. Ausente, o cartao diz *indisponivel*, que e o mesmo
   * que ele diz quando uma das parcelas nao foi lida.
   */
  sobra_ou_falta?: SobraOuFalta;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "erro" }
  | { fase: "pronto"; dados: RespostaDoPainel };

export function PainelDePapel() {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoCorrente());
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  // O MES PEDIDO, na forma que a rota recebe e ecoa de volta. Derivado do
  // periodo, e nao um segundo estado: dois estados para a mesma coisa
  // discordariam no primeiro clique.
  const mesPedido = periodo.de.slice(0, 7);
  const noMesCorrente = ehPeriodoCorrente(periodo);

  useEffect(() => {
    let vivo = true;

    // Volta para "carregando" a cada mes novo. Sem isto, a seta deixaria na
    // tela os numeros do mes ANTERIOR debaixo do rotulo do mes novo pelo tempo
    // da requisicao -- uma afirmacao falsa sobre o dinheiro da pessoa, e das
    // que nao dao erro nem ficam vazias.
    setEstado({ fase: "carregando" });

    (async () => {
      try {
        const resposta = await fetch(
          `/api/papel-de-pao/painel?month=${mesPedido}`
        );
        if (!resposta.ok) throw new Error(String(resposta.status));
        const dados = (await resposta.json()) as RespostaDoPainel;
        if (!vivo) return;

        // A RESPOSTA TEM DE SER DO MES PEDIDO. O `vivo` acima ja descarta a
        // resposta de um efeito que foi substituido, mas ele nao cobre o outro
        // caminho: uma resposta que chega com OUTRO mes dentro. Acontece quando
        // o cache do PWA (24h nas rotas /api/) devolve a de outro mes, e
        // aconteceria tambem se a rota caisse na rede do mes corrente por nao
        // reconhecer o parametro. Nos dois casos o numero seria plausivel e
        // estaria debaixo do rotulo errado -- e e exatamente a familia de
        // defeito que a HMO-173 custou.
        if (dados.month !== mesPedido) {
          setEstado({ fase: "erro" });
          return;
        }

        setEstado({ fase: "pronto", dados });
      } catch {
        // Erro de rede nao vira "R$ 0,00": zero seria uma afirmacao sobre o
        // dinheiro da pessoa, e aqui nao se sabe nada.
        if (vivo) setEstado({ fase: "erro" });
      }
    })();

    return () => {
      vivo = false;
    };
  }, [mesPedido]);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-center gap-1">
        <Button
          id="papel-mes-anterior"
          variant="ghost"
          size="icon"
          aria-label="Mês anterior"
          onClick={() => setPeriodo(passoDeMes(periodo, -1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <span
          id="papel-mes-rotulo"
          data-mes={mesPedido}
          className="font-papel text-lg min-w-[11rem] text-center"
        >
          {rotuloDoPeriodo(periodo)}
        </span>

        <Button
          id="papel-mes-seguinte"
          variant="ghost"
          size="icon"
          aria-label="Mês seguinte"
          onClick={() => setPeriodo(passoDeMes(periodo, 1))}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>

        {/* SO fora do mes corrente -- o mesmo gesto do painel grande. No mes
            corrente ele nao teria para onde levar, e um botao que nao faz nada
            e pior que botao nenhum. */}
        {!noMesCorrente && (
          <Button
            id="papel-mes-hoje"
            variant="ghost"
            size="sm"
            onClick={() => setPeriodo(periodoCorrente())}
          >
            Hoje
          </Button>
        )}
      </div>

      <NumeroGrande
        id="papel-salario"
        rotulo="Salário"
        numero={estado.fase === "pronto" ? estado.dados.salario_previsto : null}
        fase={estado.fase}
        fraseVazia={FRASE_SEM_SALARIO}
      />
      <NumeroGrande
        id="papel-contas"
        rotulo="Total de contas"
        numero={estado.fase === "pronto" ? estado.dados.total_de_contas : null}
        fase={estado.fase}
        fraseVazia={FRASE_SEM_CONTAS}
      />
      <CartaoDeSobra
        cartao={estado.fase === "pronto" ? estado.dados.sobra_ou_falta : undefined}
        fase={estado.fase}
      />
    </div>
  );
}

/**
 * O TERCEIRO CARTAO -- "Quanto Sobra" ou "Quanto Falta" (HMO-296).
 *
 * O titulo vem da resposta porque e ela que conhece o sinal: `sobraOuFalta`
 * escreve "Quanto Sobra" para saldo >= 0 (zero cravado incluido -- o mes fechou,
 * nao faltou nada) e "Quanto Falta" para < 0, e o valor sai em MODULO nos dois
 * casos. Nada disso e decidido aqui, e e deliberado: um `>= 0` escrito nesta
 * tela seria a segunda copia da pergunta, e as duas divergiriam no primeiro
 * ajuste.
 *
 * `valor === null` E INDISPONIVEL, E NAO ZERO -- vale para o cartao inteiro.
 * "Quanto Sobra: R$ 0,00" num mes que nao foi lido e uma afirmacao falsa sobre o
 * dinheiro da pessoa, e das caras: ela leria "o mes fechou" onde o certo e "nao
 * sei".
 */
function CartaoDeSobra({
  cartao,
  fase,
}: {
  cartao: SobraOuFalta | undefined;
  fase: Estado["fase"];
}) {
  // SEM RESPOSTA ainda nao e uma resposta: nas tres fases sem numero o titulo e
  // o nome inteiro do cartao -- a pergunta em aberto --, e nao um dos dois
  // lados dela.
  const titulo = cartao?.titulo ?? TITULO_SEM_RESPOSTA;

  // As duas parcelas ou NENHUMA. Meia linha ("Receitas R$ 9.500,00 −") seria
  // pior que linha nenhuma, e o par tambem e o que o tsc precisa para estreitar
  // os dois `number | null` sem uma asercao de nao-nulo escrita a mao.
  const parcelas =
    cartao != null && cartao.receitas !== null && cartao.despesas !== null
      ? { receitas: cartao.receitas, despesas: cartao.despesas }
      : null;

  return (
    <Card>
      <CardContent className="pt-6 pb-6">
        <p className="text-sm text-muted-foreground mb-1">{titulo}</p>
        <p
          className="font-papel text-4xl sm:text-5xl leading-tight break-words"
          data-rotulo={titulo}
        >
          {fase === "carregando" ? (
            <span className="text-muted-foreground text-2xl">…</span>
          ) : cartao == null || cartao.valor === null ? (
            <span className="text-muted-foreground text-xl">
              indisponível agora
            </span>
          ) : (
            formatCurrency(cartao.valor)
          )}
        </p>

        {/* AS DUAS PARCELAS, e elas nao sao enfeite: sao o que torna o terceiro
            numero conferivel sem abrir o banco, e o que explica na propria tela
            por que ele difere do "Salario" logo acima -- "Receitas" aqui e TODA
            receita prevista do mes, aluguel e reembolso incluidos. Sem a linha,
            tres numeros no painel que nao fecham de olho sao exatamente a forma
            como este app ja enganou alguem antes. */}
        {parcelas && (
          <p className="text-sm text-muted-foreground mt-2" data-parcelas="">
            {ROTULO_DAS_RECEITAS} {formatCurrency(parcelas.receitas)} −{" "}
            {ROTULO_DAS_DESPESAS} {formatCurrency(parcelas.despesas)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * UM DOS DOIS CARTOES DE CIMA, COM O CHEVRON QUE ABRE A LISTA (HMO-300, 9/10).
 *
 * A REGRA QUE DECIDE ESTE COMPONENTE, E E UMA SO: a soma das linhas abertas e
 * exatamente o total impresso acima delas. Ela nao e garantida aqui -- e
 * garantida por construcao em `somarPerna` (lib/papel-de-pao.ts), que devolve o
 * `detalhe` da MESMA passada que produziu o total. Esta tela nao soma, nao
 * filtra e nao divide nada: ela imprime a lista que chegou. Um `filter` ou um
 * `/ membros` escrito aqui seria a segunda definicao do numero, e seria ela a
 * aparecer debaixo dele.
 *
 * SEM SETA QUANDO NAO HA O QUE ABRIR. Tres estados caem no mesmo lugar --
 * carregando, total indisponivel (`null`, que NAO e zero) e lista vazia --, e
 * nos tres o cartao fica como era antes desta issue: o numero ou a frase, e
 * nenhum controle. Seta que abre vazio se le como app quebrado.
 *
 * O `detalhe` AUSENTE cai no mesmo lugar, e e o caso do corpo de 24h atras no
 * cache do PWA (ver `NumeroNoFio`): sem o campo, sem seta.
 *
 * FECHADO POR PADRAO, UM ESTADO POR CARTAO, FORA DA URL. Por cartao porque os
 * dois sao independentes -- abrir as contas nao e pedir para abrir o salario.
 * Fora da URL pela mesma razao do passo de mes: o modo simples nao tem link
 * para compartilhar, e por o par na URL traria `useSearchParams`/`router` para
 * dentro da tela que a issue pediu minima.
 *
 * O ESTADO SOBREVIVE AO PASSO DE MES, de proposito: o cartao nao e remontado
 * pela seta, so os dados trocam. Quem abriu as contas de outubro para conferir
 * quer ver as de novembro abertas tambem. Enquanto a resposta nova nao chega a
 * fase e `carregando`, a seta some e a lista velha sai junto -- ela nao fica na
 * tela debaixo do rotulo do mes novo, que e a mesma regra do `setEstado({ fase:
 * "carregando" })` do efeito.
 *
 * `aria-expanded` NO BOTAO porque a seta e um controle, e nao um enfeite -- e
 * `aria-controls` aponta para o `<ul>`, que so existe quando esta aberto. A
 * alternativa (renderizar sempre e esconder com `hidden`) foi descartada por
 * um motivo medido neste repositorio: `hidden` nao tira o texto do
 * `textContent`, e a sonda que mede "abrir mostra as linhas" ficaria verde com
 * a seta inteiramente desligada.
 */
function NumeroGrande({
  id,
  rotulo,
  numero,
  fase,
  fraseVazia,
}: {
  id: string;
  rotulo: string;
  numero: NumeroNoFio | null;
  fase: Estado["fase"];
  fraseVazia: string;
}) {
  const [aberto, setAberto] = useState(false);

  const linhas = numero?.detalhe ?? [];
  const podeAbrir =
    fase === "pronto" && numero != null && numero.total !== null && linhas.length > 0;

  return (
    <Card>
      <CardContent className="pt-6 pb-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground mb-1">{rotulo}</p>
            <p
              className="font-papel text-4xl sm:text-5xl leading-tight break-words"
              data-rotulo={rotulo}
            >
              <Valor fase={fase} numero={numero} fraseVazia={fraseVazia} />
            </p>
          </div>

          {podeAbrir && (
            <Button
              id={`${id}-chevron`}
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-expanded={aberto}
              aria-controls={`${id}-detalhe`}
              // O rotulo diz o que o clique VAI fazer, e troca com o estado:
              // "Ver os detalhes" num botao ja aberto manda o leitor de tela
              // para o lado errado.
              aria-label={`${aberto ? "Esconder" : "Ver"} os detalhes de ${rotulo}`}
              onClick={() => setAberto((estava) => !estava)}
            >
              <ChevronDown
                className={`h-5 w-5 transition-transform ${aberto ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>

        {podeAbrir && aberto && (
          <ul
            id={`${id}-detalhe`}
            data-detalhe={rotulo}
            className="mt-4 space-y-2 border-t pt-3"
          >
            {linhas.map((linha, indice) => (
              <LinhaDeDetalhe
                // `id` e `null` na fatura sintetizada, e duas faturas abertas
                // no mesmo mes dariam a mesma chave; o indice desempata. A
                // lista nao e reordenavel nem editavel aqui, entao o indice
                // nao carrega o problema que ele carrega noutras listas.
                key={linha.id ?? `${linha.data}:${indice}`}
                linha={linha}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** "28/03" -- dia e mes, dos COMPONENTES da string ISO. */
function diaEMes(data: string): string {
  // Sem `new Date`: `new Date("2026-03-01")` e meia-noite UTC e em
  // America/Sao_Paulo imprime 28 de FEVEREIRO. E o defeito que custou a
  // HMO-173, e aqui ele apareceria como uma lista de datas um dia atrasadas
  // debaixo de um total certo.
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/** O rotulo que impede o valor pela metade de parecer erro de digitacao. */
const ROTULO_DE_GRUPO = "minha parte do grupo";

/**
 * UMA LINHA DA LISTA.
 *
 * O `valor` ja vem como a MINHA parte, dividida pela rota -- esta tela nao
 * divide nada. E e por isso que `de_grupo` tem rotulo: sem ele, metade do
 * aluguel debaixo do nome do aluguel inteiro se le como erro de digitacao, e a
 * pessoa vai procurar um defeito que nao existe.
 *
 * A FATURA ABERTA SINTETIZADA (`gravada: false`) SAI SEM ACAO E COM O CAMINHO
 * DE VOLTA. Ela nao tem `scheduled_transactions.id` -- e calculada de
 * `card_invoice_lines` a cada leitura --, entao nao ha o que editar; o que ela
 * tem e um cartao e um mes, e `caminhoDoCartaoNoMes` monta o link que leva
 * aquela fatura naquele mes (sem o mes, o link abriria o mes corrente do
 * cartao certo -- o destino plausivel e errado que ninguem reporta).
 *
 * `posso_editar` CHEGA E NAO E USADO AQUI. Ele nasce na rota nesta issue
 * (HMO-300) e e a 10/10 quem o consome, em `SecaoDaTela`. Os dois campos estao
 * em corrente de proposito: duas PRs definindo um campo de mesmo nome em
 * paralelo colidem na adicao, e neste repositorio esse conflito ja apareceu
 * exatamente assim.
 */
function LinhaDeDetalhe({ linha }: { linha: LinhaDoDetalhe }) {
  const nome = linha.descricao?.trim() || "sem descrição";

  return (
    <li
      className="flex items-baseline justify-between gap-3 text-sm"
      data-linha-do-detalhe={linha.id ?? ""}
      data-de-grupo={linha.de_grupo ? "sim" : "nao"}
      data-gravada={linha.gravada ? "sim" : "nao"}
    >
      <span className="min-w-0 flex-1 break-words">
        <span className="text-muted-foreground mr-2">{diaEMes(linha.data)}</span>
        {linha.fatura ? (
          <Link
            href={caminhoDoCartaoNoMes(linha.fatura.accountId, linha.fatura.mes)}
            className="underline underline-offset-2"
          >
            {nome}
          </Link>
        ) : (
          nome
        )}
        {linha.de_grupo && (
          <span className="text-muted-foreground"> ({ROTULO_DE_GRUPO})</span>
        )}
      </span>
      <span className="font-papel shrink-0" data-valor-do-detalhe={linha.valor}>
        {formatCurrency(linha.valor)}
      </span>
    </li>
  );
}

/**
 * O valor, ou a frase que o substitui.
 *
 * AS TRES COISAS QUE NAO SAO ZERO, e que uma tela descuidada juntaria num
 * `?? 0`: ainda carregando, a leitura falhou, e nao ha linha prevista no mes.
 * "R$ 0,00" e uma afirmacao sobre o dinheiro do usuario; nos tres casos ela e
 * falsa, e nos tres a tela diz o que de fato sabe. A mesma escolha que
 * `somarPrevistas` ja tomou em `lib/periodo-do-painel.ts`.
 */
function Valor({
  fase,
  numero,
  fraseVazia,
}: {
  fase: Estado["fase"];
  numero: NumeroNoFio | null;
  fraseVazia: string;
}) {
  if (fase === "carregando") {
    return <span className="text-muted-foreground text-2xl">…</span>;
  }

  if (fase === "erro" || numero === null) {
    return (
      <span className="text-muted-foreground text-xl">
        indisponível agora
      </span>
    );
  }

  if (numero.total === null) {
    return <span className="text-muted-foreground text-xl">{fraseVazia}</span>;
  }

  return <>{formatCurrency(numero.total)}</>;
}
