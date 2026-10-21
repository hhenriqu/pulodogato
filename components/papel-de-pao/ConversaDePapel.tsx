"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { today } from "@/lib/recurrence";
import {
  TECLAS,
  aoGesto,
  botoes,
  conversaInicial,
  fraseDaPergunta,
  fraseDoResultado,
  frasesDoSaldo,
  mesDoSaldo,
  primeiroNome,
  rotuloDoSaldo,
  tecladoAberto,
  valorNaTela,
  type Conversa,
  type Gesto,
  type TipoDeGesto,
} from "@/lib/conversa-do-papel";
import type {
  MesDaConversa,
  TresNumerosDaConversa,
} from "@/lib/saldo-da-conversa";

/**
 * A TELA DA CONVERSA DO MODO "PAPEL DE PAO" -- HMO-468, F4 do plano da HMO-462.
 *
 * Ela entra no lugar do `PainelDePapel` em
 * `app/(dashboard)/dashboard/page.tsx` quando o modo esta ligado. O modo, a pele
 * (`.papel`), o `ModoPapelProvider`, o `PapelToggle` e o script de pre-pintura
 * NAO mudam: a conversa substitui o PAINEL, nao o MODO. E o `PainelDePapel` nao
 * e apagado aqui -- ele fica desmontado, e a remocao e F6, depois de a conversa
 * estar confirmada em producao.
 *
 * ===========================================================================
 * ESTA TELA E UMA CASCA. ELA NAO SABE CONVERSAR E NAO SABE SOMAR
 * ===========================================================================
 * Nenhuma palavra da conversa esta escrita neste JSX, e nenhum numero e
 * calculado aqui. Tudo o que se le na tela sai de funcoes de
 * `lib/conversa-do-papel.ts` (F1):
 *
 *   `fraseDaPergunta`   a linha grande de cima, nos cinco estados;
 *   `botoes`            quais botoes existem no estado, e com que rotulo;
 *   `TECLAS`            as teclas do teclado numerico, NA ORDEM;
 *   `valorNaTela`       o valor mascarado enquanto ela digita;
 *   `fraseDoResultado`  o resultado dito em uma frase;
 *   `rotuloDoSaldo`     o mes a que o saldo responde;
 *   `frasesDoSaldo`     as TRES linhas, com os tres numeros ja formatados.
 *
 * Escrever qualquer uma dessas coisas aqui criaria a segunda copia dela, e a
 * suite de F1 (`npm run test:conversa-do-papel`) ficaria verde enquanto a tela
 * dissesse outra coisa -- a familia de defeito que este repositorio ja pagou em
 * rotulo de cartao mais de uma vez.
 *
 * O MESMO VALE PARA O DINHEIRO: a formatacao dos tres numeros e a de
 * `frasesDoSaldo`, que e `formatarValor` de `lib/dinheiro.ts`, que e o mesmo
 * formatador do valor que ela digita. Um `toFixed(2)` nesta tela faria os
 * numeros da conferencia sairem de um formatador e o do teclado de outro.
 *
 * ===========================================================================
 * NENHUM SELETOR -- E A GARANTIA DISSO NAO E ESTE COMENTARIO
 * ===========================================================================
 * Nem categoria, nem conta, nem data. O que esta tela pode mandar para o motor
 * e o tipo `Gesto`, que e uma uniao FECHADA de oito nomes; e o que ela manda
 * para a rota sao DOIS campos (`direcao` e `valor`). Um seletor novo nao tem
 * por onde entrar sem mudar o tipo de F1 e o corpo lido por F3 -- os tres
 * defaults (data, conta, categoria) sao resolvidos NO SERVIDOR, e e la que eles
 * tem como ser os mesmos em todo aparelho.
 *
 * ===========================================================================
 * QUEM FALA COM A REDE, E QUANDO
 * ===========================================================================
 * Tres chamadas, e nenhuma delas e um `useEffect` que escuta mudanca de estado:
 *
 *   1. `GET /api/profile` UMA VEZ, na montagem, so para a saudacao;
 *   2. `POST /api/papel-de-pao/conversa` na transicao `confirmando -> pronto`;
 *   3. `GET /api/papel-de-pao/conversa` quando ela pede o Saldo.
 *
 * A ESCRITA MORA NO GESTO, E NAO NUM EFEITO QUE OBSERVA `estado === "pronto"`.
 * Um efeito assim dispara duas vezes no StrictMode do React e grava o
 * lancamento DUAS VEZES -- dinheiro em dobro, sem erro na tela. E pior: ele
 * mudaria a tela para "Anotado." ANTES de a rota responder, e um 409 (nenhuma
 * conta cadastrada) viraria uma tela que diz que anotou e um banco que nao
 * anotou nada. Aqui o `pronto` so e alcancado DEPOIS do 201.
 *
 * ===========================================================================
 * OS TRES NUMEROS APARECEM NOS DOIS LUGARES, E SAO OS MESMOS TRES
 * ===========================================================================
 * No `saldo` porque e o item 5 da issue. E no `pronto` porque o teste de
 * aceitacao da issue-mae e "Gastei 1000, Ganhei 2000 -> a tela mostra
 * `Ganhei 2000`, `Gastei 1000`, `Saldo 1000`, os tres juntos, fechando de
 * cabeca": sem eles ali, conferir o que acabou de ser anotado custaria um toque
 * a mais, e a frase da issue-mae nao se cumpre na tela que ela descreve.
 *
 * Nao e uma segunda leitura: o POST ja devolve os tres numeros RELIDOS pelo
 * mesmo helper do GET (e por isso que a rota os devolve), entao o bloco do
 * `pronto` e o bloco do `saldo` pintam o MESMO estado, pelo MESMO componente,
 * com a MESMA funcao de F1. Uma segunda chamada depois do POST poderia
 * discordar dele; um `+ valor` somado aqui na mao seria a terceira aritmetica.
 *
 * ===========================================================================
 * A RESPOSTA TEM DE SER DO MES QUE A TELA DIZ -- A GUARDA DO `mes`
 * ===========================================================================
 * As rotas `/api/` tem cache de 24h no service worker do PWA. Uma resposta
 * guardada ontem -- ou de 1o de novembro as 00:05, com a tela aberta desde
 * outubro -- traz tres numeros PLAUSIVEIS de OUTRA janela, e eles seriam
 * pintados debaixo do rotulo deste mes. O numero certo com a pergunta errada e
 * exatamente o defeito que a HMO-173 custou, e e o mesmo cuidado que o
 * `PainelDePapel` ja toma com `dados.month !== mesPedido`.
 *
 * A janela esperada sai de `mesDoSaldo(conversa)` (F1 -> F2), que e a mesma
 * funcao de que o rotulo nasce -- comparar com um recorte calculado aqui seria
 * deixar os dois lados discordarem em silencio.
 */

/** O corpo de `GET`/`POST /api/papel-de-pao/conversa` no que esta tela usa. */
interface RespostaDaConversa {
  mes?: MesDaConversa;
  numeros?: TresNumerosDaConversa;
  error?: string;
}

/**
 * Os tres numeros, e as tres coisas que NAO sao eles.
 *
 * `vazio` nao e `{0,0,0}`, e `erro` nao e `{0,0,0}`: "Saldo R$ 0,00" e uma
 * afirmacao sobre o dinheiro dela, e nas duas situacoes essa afirmacao e falsa.
 * A mesma escolha que o `PainelDePapel` ja fez em `Valor`.
 */
type EstadoDoSaldo =
  | { fase: "vazio" }
  | { fase: "carregando" }
  | { fase: "pronto"; numeros: TresNumerosDaConversa }
  | { fase: "erro"; frase: string };

/** A frase de erro que a rota mandou, ou a generica quando nao deu para ler. */
async function fraseDoErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as RespostaDaConversa;
    if (typeof corpo.error === "string" && corpo.error !== "") return corpo.error;
  } catch {
    // Corpo que nao e JSON (um HTML de erro do proxy, por exemplo) cai aqui.
  }
  return "Não consegui falar com o app agora. Tente de novo.";
}

export function ConversaDePapel() {
  /**
   * O relogio entra UMA VEZ, na montagem, e por `today()` -- o de
   * America/Sao_Paulo, o mesmo de que a rota tira a data do lancamento e a
   * janela do saldo. `new Date().toISOString()` aqui apontaria para o mes
   * seguinte entre 21:00 e 23:59 do ultimo dia do mes, e a tela diria "seu
   * saldo de novembro" com os numeros de outubro dentro.
   *
   * Em `useState` com inicializador preguicoso, e nao numa variavel de render:
   * a tela nao pode trocar de mes sozinha no meio de uma digitacao.
   */
  const [conversa, setConversa] = useState<Conversa>(() =>
    conversaInicial({ nome: "", hoje: today() })
  );
  const [saldo, setSaldo] = useState<EstadoDoSaldo>({ fase: "vazio" });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * O numero do pedido em voo. Resposta de um pedido que ja foi substituido e
   * DESCARTADA -- sem isso, o Saldo pedido duas vezes depressa pode pintar a
   * resposta da primeira por cima da segunda.
   */
  const pedido = useRef(0);

  // ---------------------------------------------------------------------------
  // O NOME, UMA VEZ, E SEM CONSEQUENCIA QUANDO FALHA
  // ---------------------------------------------------------------------------
  // `GET /api/profile` e a rota que o app ja tem para isto. Falha de rede, 401
  // ou perfil sem nome deixam `nome` vazio, e `fraseDaPergunta` ja responde por
  // esse caso com "Olá, o que deseja?" -- sem virgula solta e sem o e-mail como
  // rede, que nao e conversa.
  //
  // O `nome` e o UNICO campo da conversa escrito fora de `aoGesto`, e e por
  // isso que ele e escrito com `setConversa(c => ...)` em vez de um
  // `conversaInicial` novo: re-semear a conversa aqui apagaria a digitacao de
  // quem comecou a anotar antes de a resposta chegar.
  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const resposta = await fetch("/api/profile");
        if (!resposta.ok) return;
        const perfil = (await resposta.json()) as { full_name?: string | null };
        if (!vivo) return;
        const nome = primeiroNome(perfil?.full_name);
        if (nome === "") return;
        setConversa((atual) => (atual.nome === nome ? atual : { ...atual, nome }));
      } catch {
        // Sem nome a saudacao continua certa. Nao ha o que avisar.
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  /**
   * A resposta e deste mes? Ver a secao da guarda do `mes` no cabecalho.
   *
   * `undefined` reprova junto: corpo sem `mes` e corpo que nao da para conferir,
   * e aceita-lo seria desligar a guarda exatamente no caso (resposta velha de
   * cache, de uma versao anterior da rota) em que ela serve.
   */
  const ehDesteMes = useCallback(
    (mes: MesDaConversa | undefined): boolean => {
      const esperado = mesDoSaldo(conversa);
      return mes?.de === esperado.de && mes?.ate === esperado.ate;
    },
    [conversa]
  );

  const aplicar = useCallback(
    async (tipo: TipoDeGesto, digito?: string) => {
      if (ocupado) return;

      const gesto = (
        tipo === "digito" ? { tipo, digito: digito ?? "" } : { tipo }
      ) as Gesto;
      const proxima = aoGesto(conversa, gesto);

      // `proxima === conversa` quer dizer "este gesto nao faz sentido aqui" --
      // a identidade e contrato de F1. Nada muda, nem a frase de erro: um toque
      // perdido nao pode apagar o aviso que ela ainda nao leu.
      if (proxima === conversa) return;

      // -----------------------------------------------------------------------
      // A ESCRITA -- a unica transicao que grava dinheiro
      // -----------------------------------------------------------------------
      if (conversa.estado === "confirmando" && proxima.estado === "pronto") {
        const lancamento = conversa.lancamento;
        // Sem lancamento nao ha o que gravar, e `confirmando` sem ele e estado
        // que F1 nao produz. Recusar aqui e mais barato que um corpo sem valor.
        if (!lancamento) return;

        const meu = ++pedido.current;
        setOcupado(true);
        setErro(null);

        try {
          const resposta = await fetch("/api/papel-de-pao/conversa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // DOIS CAMPOS. A data, a conta e a categoria sao do servidor -- ver
            // a secao dos seletores no cabecalho. O `valor` e a GRANDEZA, sem
            // sinal: quem o inverte para despesa e a rota, num lugar so.
            body: JSON.stringify({
              direcao: lancamento.direcao,
              valor: lancamento.valor,
            }),
          });

          if (meu !== pedido.current) return;

          if (!resposta.ok) {
            // FICA EM `confirmando`. A tela nao pode dizer "Anotado." por um
            // lancamento que o banco recusou, e daqui o "Sim, anotar" ainda
            // esta na tela para tentar de novo sem redigitar o valor.
            setErro(await fraseDoErro(resposta));
            return;
          }

          const corpo = (await resposta.json()) as RespostaDaConversa;
          if (meu !== pedido.current) return;

          setConversa(proxima);
          setSaldo(
            corpo.numeros && ehDesteMes(corpo.mes)
              ? { fase: "pronto", numeros: corpo.numeros }
              : {
                  fase: "erro",
                  frase:
                    "Anotei, mas não consegui conferir os três números agora.",
                }
          );
        } catch {
          if (meu === pedido.current) {
            setErro("Não consegui falar com o app agora. Tente de novo.");
          }
        } finally {
          if (meu === pedido.current) setOcupado(false);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // O SALDO -- leitura, e sempre fresca
      // -----------------------------------------------------------------------
      if (proxima.estado === "saldo") {
        const meu = ++pedido.current;
        setConversa(proxima);
        setErro(null);
        setSaldo({ fase: "carregando" });

        try {
          const resposta = await fetch("/api/papel-de-pao/conversa");
          if (meu !== pedido.current) return;

          if (!resposta.ok) {
            setSaldo({ fase: "erro", frase: await fraseDoErro(resposta) });
            return;
          }

          const corpo = (await resposta.json()) as RespostaDaConversa;
          if (meu !== pedido.current) return;

          setSaldo(
            corpo.numeros && ehDesteMes(corpo.mes)
              ? { fase: "pronto", numeros: corpo.numeros }
              : { fase: "erro", frase: "Não consegui somar o mês agora." }
          );
        } catch {
          if (meu === pedido.current) {
            setSaldo({ fase: "erro", frase: "Não consegui somar o mês agora." });
          }
        }
        return;
      }

      // Todo o resto e so o motor: escolher a palavra, digitar, apagar, voltar.
      setErro(null);
      setConversa(proxima);
    },
    [conversa, ehDesteMes, ocupado]
  );

  const digitando = tecladoAberto(conversa);
  const resultado = fraseDoResultado(conversa);

  return (
    <div className="p-4 sm:p-6 max-w-md mx-auto space-y-6">
      {/* A PERGUNTA -- a unica linha grande da tela, nos cinco estados. */}
      <p
        id="conversa-pergunta"
        className="font-papel text-3xl sm:text-4xl leading-tight text-center break-words"
      >
        {fraseDaPergunta(conversa)}
      </p>

      {/* O RESULTADO, em uma frase, e so no `pronto`. */}
      {resultado !== null && (
        <p
          id="conversa-resultado"
          className="font-papel text-2xl text-center text-muted-foreground break-words"
        >
          {resultado}
        </p>
      )}

      {digitando && (
        <>
          <p
            id="conversa-valor"
            className="font-papel text-5xl text-center leading-tight break-words"
          >
            {valorNaTela(conversa)}
          </p>
          <Teclado aoTocar={aplicar} ocupado={ocupado} />
        </>
      )}

      {/* OS TRES NUMEROS -- no `saldo` e no `pronto`, o mesmo bloco. */}
      {(conversa.estado === "saldo" || conversa.estado === "pronto") && (
        <TresNumeros
          saldo={saldo}
          rotuloDoMes={rotuloDoSaldo(conversa)}
          // No `saldo` o mes ja esta na pergunta de cima
          // (`Seu saldo de outubro de 2026`); repeti-lo seria ruido. No
          // `pronto` a pergunta e a saudacao, e sem esta linha os tres numeros
          // responderiam uma pergunta que a tela nao faz.
          mostrarOMes={conversa.estado === "pronto"}
        />
      )}

      {erro !== null && (
        <p
          id="conversa-erro"
          role="alert"
          className="text-center text-destructive break-words"
        >
          {erro}
        </p>
      )}

      {/* OS BOTOES DO ESTADO -- quais e com que rotulo e decisao de F1. */}
      <div className="grid gap-3">
        {botoes(conversa).map((botao) => (
          <Button
            key={botao.gesto}
            id={`conversa-${botao.gesto}`}
            data-gesto={botao.gesto}
            // GRANDES, que e o pedido da issue: `h-16` e o dobro do `lg` do
            // Button, e `text-xl` e a letra de quem le a tela com o braco
            // esticado.
            className="h-16 text-xl font-papel"
            variant={botao.gesto === "voltar" ? "outline" : "default"}
            disabled={ocupado}
            // `() => aplicar(...)`, e NUNCA `onClick={aplicar}`: o primeiro
            // argumento que o React passa e o MouseEvent, e ele chegaria no
            // lugar do tipo do gesto.
            onClick={() => aplicar(botao.gesto)}
          >
            {botao.rotulo}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * O TECLADO NUMERICO GRANDE.
 *
 * A ORDEM DOS DIGITOS E A DE `TECLAS`, lida do motor: tres linhas de 1 a 9 e o
 * zero depois do nove. Escrever os dez numeros neste JSX seria a segunda copia
 * da ordem, e um teclado que comecasse pelo zero e um defeito que nenhuma
 * assercao de conta pega.
 *
 * `Limpar` e `⌫` nao sao digitos e nao estao em `TECLAS`: eles ocupam as duas
 * celulas que sobram na ultima linha, de um lado e do outro do zero. Sao gestos
 * do motor (`limpar`, `apagar`) como qualquer outro -- esta tela nao mexe no
 * acumulador.
 */
function Teclado({
  aoTocar,
  ocupado,
}: {
  aoTocar: (tipo: TipoDeGesto, digito?: string) => void;
  ocupado: boolean;
}) {
  const digito = (tecla: string) => (
    <Button
      key={tecla}
      data-tecla={tecla}
      variant="outline"
      className="h-16 text-2xl font-papel"
      disabled={ocupado}
      onClick={() => aoTocar("digito", tecla)}
    >
      {tecla}
    </Button>
  );

  return (
    <div className="grid grid-cols-3 gap-2" data-teclado="">
      {TECLAS.slice(0, 9).map(digito)}
      <Button
        id="conversa-limpar"
        data-gesto="limpar"
        variant="ghost"
        className="h-16 text-base"
        disabled={ocupado}
        onClick={() => aoTocar("limpar")}
      >
        Limpar
      </Button>
      {TECLAS.slice(9).map(digito)}
      <Button
        id="conversa-apagar"
        data-gesto="apagar"
        variant="ghost"
        className="h-16 text-2xl"
        aria-label="Apagar o último dígito"
        disabled={ocupado}
        onClick={() => aoTocar("apagar")}
      >
        ⌫
      </Button>
    </div>
  );
}

/**
 * AS TRES LINHAS, SEMPRE AS TRES -- `Ganhei`, `Gastei`, `Saldo`.
 *
 * Quais linhas, em que ordem, com que rotulo e com que numero e tudo
 * `frasesDoSaldo` (F1) sobre os numeros que a rota devolveu. Esta funcao nao
 * escolhe nada e nao recalcula nada: em particular, ela NAO pinta
 * `ganhei - gastei` no lugar do `saldo` que chegou. A conta fecharia sempre, e
 * e justamente por nao fechar que uma soma errada de F2 apareceria aqui.
 */
function TresNumeros({
  saldo,
  rotuloDoMes,
  mostrarOMes,
}: {
  saldo: EstadoDoSaldo;
  rotuloDoMes: string;
  mostrarOMes: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6 pb-6">
        {mostrarOMes && (
          <p className="text-sm text-muted-foreground mb-2 text-center">
            Seu saldo de {rotuloDoMes}
          </p>
        )}

        {saldo.fase === "carregando" && (
          <p className="text-center text-muted-foreground text-2xl">…</p>
        )}

        {saldo.fase === "erro" && (
          <p className="text-center text-muted-foreground" data-saldo-erro="">
            {saldo.frase}
          </p>
        )}

        {saldo.fase === "vazio" && (
          <p className="text-center text-muted-foreground">
            indisponível agora
          </p>
        )}

        {saldo.fase === "pronto" && (
          // `conversa-tres-numeros`, e NAO `conversa-saldo`: no estado
          // `pronto` o botao «Saldo» esta na tela e ele ja e
          // `id="conversa-saldo"` (o id sai do nome do gesto). Dois elementos
          // com o mesmo id fariam `querySelector` devolver o primeiro, e a
          // sonda que procura os tres numeros acharia um botao.
          <ul id="conversa-tres-numeros" className="space-y-2">
            {frasesDoSaldo(saldo.numeros).map((linha) => (
              <li
                key={linha.rotulo}
                data-saldo={linha.rotulo}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="font-papel text-2xl">{linha.rotulo}</span>
                <span className="font-papel text-2xl break-words">
                  {linha.valor}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
