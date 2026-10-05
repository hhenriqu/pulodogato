"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  FRASE_SEM_CONTAS,
  FRASE_SEM_SALARIO,
  type NumeroDoPapel,
} from "@/lib/papel-de-pao";

/**
 * A TELA DOS DOIS NUMEROS -- HMO-286 (3/3 do plano da HMO-279), com o rotulo
 * encurtado pela HMO-294 (4/6).
 *
 * "Salario" e "Total de contas", do mes corrente, e mais nada. Nenhum outro
 * cartao do painel aparece aqui: dois numeros e so, e e por isso que esta e uma
 * TELA IRMA do painel completo e nao um `if` dentro dele.
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
 * nesta tela seria o primeiro cartao de uma tela que a issue pediu vazia.
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
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const resposta = await fetch("/api/papel-de-pao/painel");
        if (!resposta.ok) throw new Error(String(resposta.status));
        const dados = (await resposta.json()) as RespostaDoPainel;
        if (vivo) setEstado({ fase: "pronto", dados });
      } catch {
        // Erro de rede nao vira "R$ 0,00": zero seria uma afirmacao sobre o
        // dinheiro da pessoa, e aqui nao se sabe nada.
        if (vivo) setEstado({ fase: "erro" });
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
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
