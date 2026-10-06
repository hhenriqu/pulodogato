"use client";

// ---------------------------------------------------------------------------
// A CASCA DE MODAL DAS TRES TELAS DE LANCAMENTO (HMO-249)
// ---------------------------------------------------------------------------
// "Todas as telas de lancamento devem ser exibidas como modal."
//
// As tres telas continuam sendo ROTAS (`/dashboard/movimentacoes/despesa`,
// `/receita`, `/transferencia`), e isso e deliberado. Elas tem muita coisa
// pendurada no endereco:
//
//   ?id=<id>       o lapis da lista de lancamentos abre a edicao
//   ?cartao=<id>   "Lancar gasto neste cartao", de /dashboard/cartoes/[id]
//   ?origem=<rota> esta issue
//
// e sao alvo de link em meia duzia de telas, no app instalado e no menu. Trocar
// a rota por um estado de componente em cada tela de origem significaria
// reimplementar esses tres parametros N vezes, e quebrar todo link ja publicado
// -- inclusive os que o proprio app guardou no cache do service worker.
//
// Entao o modal e montado AQUI, dentro da rota: `open` nasce `true` (a rota E o
// modal) e fechar nao e mudar estado, e NAVEGAR. Quem fecha -- o X, o Esc, o
// clique fora, o Cancelar -- vai para a tela de origem, que e o que a segunda
// metade da issue pede.
//
// POR QUE NAO INTERCEPTING ROUTES
// -------------------------------
// O jeito "nativo" do App Router de desenhar isto e rota paralela + rota
// interceptada (`@modal/(.)movimentacoes/despesa`), que mantem a tela de origem
// MONTADA atras do modal. Duas coisas pesaram contra:
//
//   - a tela de origem ficaria montada e DESATUALIZADA. As listas deste app
//     buscam no cliente, dentro de `useEffect`: depois de salvar, a pessoa veria
//     o modal fechar sobre uma lista sem o lancamento que ela acabou de fazer --
//     "nao salvou" e a leitura obvia, e ela lancaria de novo. `router.refresh()`
//     nao resolve: ele reexecuta o servidor, nao o `useEffect` do cliente.
//   - a interceptacao vale para navegacao do cliente. Carregamento direto da URL
//     (link do e-mail, atalho do app instalado, recarregar a pagina) cai na rota
//     cheia, e teriamos DOIS desenhos da mesma tela para manter.
//
// Com o modal dentro da rota, fechar e uma navegacao de verdade: a tela de
// origem remonta, busca de novo, e o lancamento novo esta la.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ModalDeLancamentoProps {
  titulo: string;
  descricao: string;
  /** Avisos que nao sao o formulario (sem rede, catalogo velho, grupo travado). */
  aviso?: ReactNode;
  /** Chamado pelo X, pelo Esc e pelo clique fora. Navega para a origem. */
  aoFechar: () => void;
  children: ReactNode;
}

export function ModalDeLancamento({
  titulo,
  descricao,
  aviso,
  aoFechar,
  children,
}: ModalDeLancamentoProps) {
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      {/*
        As tres classes de tamanho, e o que cada uma conserta:

        `max-w-3xl`     o padrao de `DialogContent` e `max-w-lg` (32rem), e o
                        formulario de despesa tem seletor de categoria, bloco de
                        parcelamento e bloco de rateio. Em 32rem o rateio
                        (avatar + select de participante + percentual) estoura
                        na horizontal -- e `grid` sem `grid-cols-1` e exatamente
                        o que faz o celular rolar de lado.
        `w-[calc(100vw-2rem)]`
                        no celular, `w-full` com `max-w-3xl` encosta nas duas
                        bordas; o X fica em cima do recorte da tela. A margem de
                        1rem de cada lado e o que deixa o botao de fechar
                        alcancavel.
        `max-h-[90vh] overflow-y-auto`
                        o formulario e MAIS ALTO que a tela do celular. Sem isto
                        o `translate-y-[-50%]` de `DialogContent` centraliza um
                        conteudo maior que a viewport: o topo e o rodape ficam
                        fora, e o botao Salvar deixa de existir para quem abriu
                        no telefone. Com `max-h` + rolagem o modal rola por
                        dentro.
      */}
      <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {aviso}
        {children}
      </DialogContent>
    </Dialog>
  );
}
