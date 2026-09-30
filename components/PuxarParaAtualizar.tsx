"use client";

/**
 * Puxar para atualizar (HMO-201, parte 4).
 *
 * A aritmetica do gesto esta em `lib/puxar-para-atualizar.ts`, com teste. Aqui
 * fica so o que precisa de DOM: ouvir o toque e desenhar o indicador.
 *
 * POR QUE `location.reload()` E NAO `router.refresh()`
 * ----------------------------------------------------
 * `router.refresh()` do Next revalida os Server Components. Quase toda tela
 * deste app e `"use client"` e busca os proprios dados com `fetch` dentro de
 * `useEffect`; para elas o `router.refresh()` nao refaz busca nenhuma -- a
 * pessoa puxa, ve a animacao, e os numeros continuam os mesmos. Um recarregar
 * de verdade e o que corresponde ao que ela pediu.
 *
 * O cache do PWA nao atrapalha aqui: a regra de runtime das rotas `/api/` e
 * NetworkFirst (ver lib/pwa-runtime-cache.js), entao com rede ela vai na rede.
 * Sem rede o recarregar devolve o que esta guardado, ja carimbado como vindo
 * do aparelho -- que e o comportamento certo, e nao um refresh silenciosamente
 * inutil.
 *
 * `passive: false` NO `touchmove`, E SO NELE
 * ------------------------------------------
 * Para impedir que o navegador role a pagina enquanto o indicador desce, o
 * handler precisa poder chamar `preventDefault()`, e isso exige um listener
 * NAO passivo. Ele e registrado assim apenas no `touchmove`; `touchstart` e
 * `touchend` ficam passivos, que e o que mantem a rolagem normal fluida.
 */

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  DESLOCAMENTO_MAXIMO,
  GESTO_INERTE,
  deveAtualizar,
  lerGesto,
  type LeituraDoGesto,
} from "@/lib/puxar-para-atualizar";

export function PuxarParaAtualizar() {
  const [leitura, setLeitura] = useState<LeituraDoGesto>(GESTO_INERTE);
  const [atualizando, setAtualizando] = useState(false);

  // Em `ref` e nao em estado: sao valores lidos DENTRO do handler de toque, a
  // cada movimento do dedo. Em estado, cada leitura exigiria refazer o
  // listener, e um handler com valor velho e justamente como um gesto passa a
  // ser avaliado contra a posicao errada.
  const inicioY = useRef<number | null>(null);
  const scrollNoInicio = useRef(0);
  const atualizandoRef = useRef(false);

  // O handler de `touchend` e criado UMA vez e nao enxerga o `leitura` atual
  // pelo closure. Este ref e a ponte: sem ele, soltar decidiria sempre com o
  // estado do primeiro render -- ou seja, nunca atualizaria.
  const leituraAtual = useRef(leitura);

  useEffect(() => {
    atualizandoRef.current = atualizando;
  }, [atualizando]);

  useEffect(() => {
    leituraAtual.current = leitura;
  }, [leitura]);

  useEffect(() => {
    const posicaoDaRolagem = () =>
      window.scrollY ?? document.documentElement.scrollTop ?? 0;

    const aoTocar = (e: TouchEvent) => {
      // Multitoque e pinca de zoom, nao puxao.
      if (e.touches.length !== 1) {
        inicioY.current = null;
        return;
      }
      inicioY.current = e.touches[0].clientY;
      scrollNoInicio.current = posicaoDaRolagem();
    };

    const aoMover = (e: TouchEvent) => {
      if (inicioY.current === null || e.touches.length !== 1) return;

      const nova = lerGesto({
        scrollTopNoInicio: scrollNoInicio.current,
        deltaY: e.touches[0].clientY - inicioY.current,
        atualizando: atualizandoRef.current,
      });

      // Segurar a rolagem so enquanto o indicador esta de fato aparecendo. Um
      // `preventDefault()` incondicional aqui mataria a rolagem da pagina
      // inteira -- o app ficaria travado no topo.
      if (nova.estado !== "inerte" && e.cancelable) e.preventDefault();

      setLeitura(nova);
    };

    const aoSoltar = () => {
      const soltou = leituraAtual.current;
      inicioY.current = null;

      if (deveAtualizar(soltou)) {
        setAtualizando(true);
        // O indicador fica no lugar durante o recarregamento: some junto com a
        // pagina. Zerar antes daria um pisca-pisca entre soltar e recarregar.
        window.location.reload();
        return;
      }

      setLeitura(GESTO_INERTE);
    };

    window.addEventListener("touchstart", aoTocar, { passive: true });
    window.addEventListener("touchmove", aoMover, { passive: false });
    window.addEventListener("touchend", aoSoltar, { passive: true });
    window.addEventListener("touchcancel", aoSoltar, { passive: true });

    return () => {
      window.removeEventListener("touchstart", aoTocar);
      window.removeEventListener("touchmove", aoMover);
      window.removeEventListener("touchend", aoSoltar);
      window.removeEventListener("touchcancel", aoSoltar);
    };
  }, []);

  const visivel = atualizando || leitura.estado !== "inerte";
  if (!visivel) return null;

  const deslocamento = atualizando
    ? DESLOCAMENTO_MAXIMO / 2
    : leitura.deslocamento;

  return (
    <div
      // `pointer-events-none`: o indicador nunca pode interceptar o toque que
      // o criou.
      className="fixed inset-x-0 top-0 z-50 flex justify-center pointer-events-none print:hidden"
      style={{ transform: `translateY(${deslocamento}px)` }}
      aria-hidden="true"
    >
      <div className="mt-2 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 shadow-lg">
        <RefreshCw
          className={`h-4 w-4 text-primary ${
            atualizando ? "animate-spin" : ""
          }`}
          style={
            atualizando
              ? undefined
              : // Gira conforme o dedo desce: o gesto responde antes de
                // cruzar o limiar, em vez de parecer inerte ate o fim.
                { transform: `rotate(${leitura.deslocamento * 3}deg)` }
          }
        />
        <span className="text-xs font-medium">
          {atualizando
            ? "Atualizando..."
            : leitura.estado === "solte"
            ? "Solte para atualizar"
            : "Puxe para atualizar"}
        </span>
      </div>
    </div>
  );
}
