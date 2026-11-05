"use client";

/**
 * Dica: o texto explicativo que antes ficava sempre aberto na tela, agora atras
 * de um iconezinho de informacao ao lado do titulo ou do rotulo que ele explica.
 *
 * - No mouse, abre ao passar por cima e fecha ao sair.
 * - No toque (celular/PWA), abre e fecha com um toque. Tocar fora ou apertar
 *   Esc fecha.
 * - O balao vai para o <body> (portal) com posicao fixa, para nao ser cortado
 *   por um card com overflow escondido e nao estourar a largura da tela.
 *
 * O conteudo continua o mesmo de antes: pode ter valores calculados, <strong>
 * e quebras -- so deixou de ocupar espaco o tempo todo.
 *
 * O TEXTO CONTINUA NO HTML, escondido so dos olhos (`sr-only`) e ligado ao
 * botao por `aria-describedby`. Leitor de tela le a explicacao sem precisar
 * abrir nada, e as suites que renderizam o componente com
 * `renderToStaticMarkup` continuam achando a frase que elas protegem. O balao
 * visivel e uma copia, marcada `aria-hidden` para nao ser lida duas vezes.
 *
 * `interativa`: para texto com link dentro. O balao passa a aceitar clique (o
 * mouse pode ir do icone ate ele sem fechar, e o toque fixa o balao aberto), e
 * a copia escondida fica `inert` para os links dela nao entrarem na ordem do
 * Tab sem aparecer. Nao use dentro de Dialog do Radix: ele trata o clique no
 * balao (que mora no <body>) como clique fora e fecha o dialogo.
 */
import { Info } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const MARGEM = 8;
const LARGURA_MAXIMA = 320;

interface DicaProps {
  children: ReactNode;
  /** Nome acessivel do botao. Ex.: "Como o saldo e calculado". */
  rotulo?: string;
  className?: string;
  /** O conteudo tem link: o balao aceita clique. Ver o cabecalho. */
  interativa?: boolean;
}

export function Dica({
  children,
  rotulo = "Mais informações",
  className,
  interativa = false,
}: DicaProps) {
  const id = useId();
  const idDoTexto = `${id}-texto`;
  const botao = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLDivElement>(null);
  const copia = useRef<HTMLSpanElement>(null);
  const fechamento = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aberta, setAberta] = useState(false);
  const [presa, setPresa] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number; largura: number } | null>(
    null,
  );
  const [montado, setMontado] = useState(false);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (interativa) copia.current?.setAttribute("inert", "");
  }, [interativa]);

  const cancelarFechamento = useCallback(() => {
    if (fechamento.current) clearTimeout(fechamento.current);
    fechamento.current = null;
  }, []);

  // Com link no balao, o mouse precisa de tempo para atravessar do icone ate
  // ele; sem link, fecha na hora.
  const fecharDepois = useCallback(() => {
    cancelarFechamento();
    if (!interativa) {
      setAberta(false);
      return;
    }
    fechamento.current = setTimeout(() => setAberta(false), 200);
  }, [interativa, cancelarFechamento]);

  useEffect(() => cancelarFechamento, [cancelarFechamento]);

  const fechar = useCallback(() => {
    setAberta(false);
    setPresa(false);
  }, []);

  const posicionar = useCallback(() => {
    const b = botao.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const largura = Math.min(LARGURA_MAXIMA, vw - MARGEM * 2);
    const left = Math.min(
      Math.max(r.left + r.width / 2 - largura / 2, MARGEM),
      vw - largura - MARGEM,
    );
    const altura = balao.current?.offsetHeight ?? 0;
    const cabeEmbaixo = r.bottom + 6 + altura + MARGEM <= vh;
    const top = cabeEmbaixo || r.top - 6 - altura < MARGEM ? r.bottom + 6 : r.top - 6 - altura;
    setPosicao({ top, left, largura });
  }, []);

  useLayoutEffect(() => {
    if (!aberta) return;
    posicionar();
    // Segunda passada: so agora o balao tem altura medida.
    const raf = requestAnimationFrame(posicionar);
    return () => cancelAnimationFrame(raf);
  }, [aberta, posicionar]);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        fechar();
        botao.current?.focus();
      }
    };
    const aoTocarFora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (botao.current?.contains(alvo) || balao.current?.contains(alvo)) return;
      fechar();
    };
    window.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocarFora);
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocarFora);
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberta, fechar, posicionar]);

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        aria-expanded={aberta}
        aria-describedby={idDoTexto}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          cancelarFechamento();
          setAberta(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !presa) fecharDepois();
        }}
        onFocus={() => setAberta(true)}
        onBlur={() => {
          if (!presa) setAberta(false);
        }}
        onClick={(e) => {
          // Nao deixa o toque abrir/fechar um card ou seguir um link em volta.
          e.preventDefault();
          e.stopPropagation();
          if (presa) {
            fechar();
          } else {
            setAberta(true);
            setPresa(true);
          }
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span ref={copia} id={idDoTexto} className="sr-only">
        {children}
      </span>
      {montado &&
        aberta &&
        createPortal(
          <div
            ref={balao}
            aria-hidden={!interativa}
            onPointerEnter={cancelarFechamento}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse" && !presa) fecharDepois();
            }}
            style={{
              position: "fixed",
              // O balao so de texto nao recebe clique: dentro de um Dialog do
              // Radix (que corta o clique fora do conteudo dele) um toque no
              // balao viraria um toque "fora" e fecharia o dialogo.
              pointerEvents: interativa ? "auto" : "none",
              top: posicao?.top ?? -9999,
              left: posicao?.left ?? -9999,
              width: posicao?.largura ?? LARGURA_MAXIMA,
            }}
            className="z-[100] rounded-md border bg-popover px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-md"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
