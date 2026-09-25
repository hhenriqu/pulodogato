"use client";

// =====================================================
// O QUE A TELA MOSTRA NO LUGAR DO NUMERO QUE ELA NAO TEM
// =====================================================
// Duas pecas, para os dois casos que `lib/offline-leitura.ts` separa:
//
//   - `PainelSemRede`: nao ha dado nenhum. Substitui a lista E os totais --
//     nao acompanha os totais, substitui. Um "R$ 0,00" ao lado do aviso de
//     sem conexao continua sendo um numero na tela, e numero na tela e lido;
//   - `FaixaDadoDoAparelho`: ha dado de verdade, guardado no aparelho, e ele
//     pode ser de ontem. Aqui a tela mostra tudo -- com a data em cima.
//
// A faixa fala de DADO, nao de conexao, pelo mesmo motivo do OfflineBanner:
// "voce esta sem internet" a pessoa ja sabe; "estes numeros sao de ontem as
// 21:40" e a informacao que ela nao tem.
//
// Toda cor sai de token. Uma classe de paleta fixa do Tailwind passa no build
// e vira bloco claro no modo noturno -- o `npm run check-color-tokens`
// reprova (HMO-144), e ele varre o texto cru: citar o nome de uma dessas
// classes dentro de um comentario reprova o commit do mesmo jeito.
// =====================================================

import { CloudOff, RefreshCw, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { descreverMomento } from "@/lib/offline-leitura";

interface PainelSemRedeProps {
  /**
   * O que nao deu para carregar, na frase da pessoa: "suas contas", "as contas
   * previstas". Entra em "Nao deu para carregar ___ agora".
   */
  oQue: string;
  aoTentarDeNovo: () => void;
}

// Sem estado de "tentando" de proposito: as tres telas ja trocam o corpo
// inteiro pelo seu proprio indicador de carregamento enquanto a busca corre,
// entao um segundo indicador aqui seria codigo que nunca pinta.
export function PainelSemRede({ oQue, aoTentarDeNovo }: PainelSemRedeProps) {
  return (
    <Card className="border-warning">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <CloudOff className="h-8 w-8 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Sem conexao. Nao deu para carregar {oQue} agora.
          </p>
          {/*
            A segunda frase existe para responder a pergunta que a primeira
            levanta -- "perdi alguma coisa?". Sem ela, tela vazia depois de um
            aviso e indistinguivel de dado apagado.
          */}
          <p className="text-sm text-muted-foreground">
            Nada foi perdido: seus dados estao no servidor e aparecem assim que
            a conexao voltar.
          </p>
        </div>
        <Button variant="outline" onClick={aoTentarDeNovo} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Tentar de novo
        </Button>
      </CardContent>
    </Card>
  );
}

interface FaixaDadoDoAparelhoProps {
  /** Vem de `Leitura.guardadoEm`; null quando o cabecalho nao deu para ler. */
  guardadoEm: Date | null;
  /**
   * `true` quando a tela tem botao de cadastrar/editar. Acrescenta a frase que
   * evita a pessoa preencher um formulario inteiro para perde-lo no fim.
   */
  soLeitura?: boolean;
  aoTentarDeNovo?: () => void;
}

export function FaixaDadoDoAparelho({
  guardadoEm,
  soLeitura = false,
  aoTentarDeNovo,
}: FaixaDadoDoAparelhoProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm text-foreground print:hidden">
      <CloudOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Estes numeros sao do que ficou guardado no aparelho,{" "}
        {descreverMomento(guardadoEm)}.
        {soLeitura ? " Da para consultar, nao da para alterar." : ""}
      </span>
      {aoTentarDeNovo && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7"
          onClick={aoTentarDeNovo}
        >
          Atualizar
        </Button>
      )}
    </div>
  );
}

interface PainelErroDoServidorProps {
  oQue: string;
  aoTentarDeNovo: () => void;
}

/**
 * O terceiro caso: o servidor respondeu, e respondeu erro.
 *
 * Separado do sem-rede porque a acao da pessoa e outra -- aqui nao adianta
 * procurar sinal. Dizer "sem conexao" a quem esta conectado manda ela
 * reiniciar o roteador por causa de um defeito nosso.
 */
export function PainelErroDoServidor({
  oQue,
  aoTentarDeNovo,
}: PainelErroDoServidorProps) {
  return (
    <Card className="border-destructive">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <ServerCrash className="h-8 w-8 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Deu erro aqui no nosso lado ao carregar {oQue}.
          </p>
          <p className="text-sm text-muted-foreground">
            A conexao esta funcionando. Tente de novo em alguns instantes.
          </p>
        </div>
        <Button variant="outline" onClick={aoTentarDeNovo} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Tentar de novo
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * O travessao que substitui o numero que a tela nao tem.
 *
 * Existe como componente para que o `podeMostrarNumero()` de
 * `lib/offline-leitura.ts` tenha um unico destino visual em todas as telas --
 * e para que ninguem seja tentado a escrever `valor ?? 0` no lugar.
 */
export function NumeroIndisponivel() {
  return (
    <span className="text-muted-foreground" title="Sem dado para mostrar agora">
      &mdash;
    </span>
  );
}
