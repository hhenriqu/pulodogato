"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  FRASE_SEM_CONTAS,
  FRASE_SEM_SALARIO,
  type NumeroDoPapel,
} from "@/lib/papel-de-pao";
import {
  ehPeriodoCorrente,
  passoDeMes,
  periodoCorrente,
  rotuloDoPeriodo,
  type Periodo,
} from "@/lib/periodo-do-painel";

/**
 * A TELA DOS DOIS NUMEROS -- HMO-286 (3/3 do plano da HMO-279), com o rotulo
 * encurtado pela HMO-294 (4/6) e o passo de mes da HMO-295 (5/6).
 *
 * "Salario" e "Total de contas", e mais nada. Nenhum outro cartao do painel
 * aparece aqui: dois numeros e so, e e por isso que esta e uma TELA IRMA do
 * painel completo e nao um `if` dentro dele.
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
 * chamadas de rede para mostrar dois numeros -- no aparelho de quem escolheu o
 * modo justamente por querer menos.
 *
 * Aqui e UMA chamada, para uma rota que existe para esta tela.
 *
 * A LETRA MANUSCRITA, DE NOVO E EXPLICITA
 * ---------------------------------------
 * O modo ja poe a manuscrita na tela inteira (`.papel body` em
 * `app/globals.css`). `font-papel` nos valores nao e redundancia: e o padrao 5
 * aprovado -- os dois numeros em corpo GRANDE e na manuscrita --, e pedir a
 * fonte no proprio elemento mantem isso verdade se a regra do `body` mudar.
 * A utilitaria existe no `tailwind.config.js` exatamente para este caso.
 *
 * NAO HA BOTAO DE ACAO AQUI, e e deliberado: "dois numeros e so" esta escrito
 * no escopo da issue, e a navegacao do modo ja existe -- o menu reduzido da
 * HMO-284 tem as sete telas, e o papelzinho desliga o modo. Um atalho a mais
 * nesta tela seria o primeiro cartao de uma tela que a issue pediu vazia. As
 * duas setas e o "Hoje" da HMO-295 nao sao excecao a isso: nenhum dos tres leva
 * a outra tela nem escreve nada -- os tres mexem em QUAL mes estes mesmos dois
 * numeros respondem, e sem eles os numeros respondiam uma pergunta que a tela
 * nao deixava mudar.
 */

/** A resposta de GET /api/papel-de-pao/painel. */
interface RespostaDoPainel {
  month: string;
  range: { from: string; to: string };
  salario_previsto: NumeroDoPapel;
  total_de_contas: NumeroDoPapel;
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
        rotulo="Salário"
        numero={estado.fase === "pronto" ? estado.dados.salario_previsto : null}
        fase={estado.fase}
        fraseVazia={FRASE_SEM_SALARIO}
      />
      <NumeroGrande
        rotulo="Total de contas"
        numero={estado.fase === "pronto" ? estado.dados.total_de_contas : null}
        fase={estado.fase}
        fraseVazia={FRASE_SEM_CONTAS}
      />
    </div>
  );
}

function NumeroGrande({
  rotulo,
  numero,
  fase,
  fraseVazia,
}: {
  rotulo: string;
  numero: NumeroDoPapel | null;
  fase: Estado["fase"];
  fraseVazia: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6 pb-6">
        <p className="text-sm text-muted-foreground mb-1">{rotulo}</p>
        <p
          className="font-papel text-4xl sm:text-5xl leading-tight break-words"
          data-rotulo={rotulo}
        >
          <Valor fase={fase} numero={numero} fraseVazia={fraseVazia} />
        </p>
      </CardContent>
    </Card>
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
  numero: NumeroDoPapel | null;
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
