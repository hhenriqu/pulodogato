"use client";

// -----------------------------------------------------------------------------
// OS DOIS BOTOES DO MENU MOBILE, NUM SO LUGAR
// -----------------------------------------------------------------------------
// O menu do celular tem dois controles, e eles moram em componentes
// diferentes: o hamburguer fica no DashboardHeader, o X fica dentro da gaveta
// no Sidebar. Nenhum dos dois sabia da existencia do outro, e foi exatamente
// dai que veio a HMO-161 -- os dois apareciam ao mesmo tempo, um em cima do
// outro.
//
// O DEFEITO, E POR QUE NADA O DENUNCIAVA
// --------------------------------------
// A gaveta do Sidebar fica montada o tempo todo: fechada, ela apenas desliza
// para fora da tela com uma translacao de -100% da propria largura. O X, porem,
// estava posicionado FORA dos limites do painel, empurrado para a direita da
// borda dele por uma margem negativa -- o padrao classico de "botao de fechar
// flutuando sobre o veu".
//
// Uma translacao move o painel, nao a tela. Com o painel deslocado exatamente
// a propria largura para a esquerda, a borda direita dele cai em x = 0, e o X
// que vivia 3rem depois dessa borda reaparece DENTRO da tela, a poucos pixels
// do canto superior esquerdo -- ou seja, em cima do hamburguer do header. Os
// dois tem o mesmo z-index e a gaveta e renderizada depois, entao o X ganhava
// a sobreposicao.
//
// Nada disso quebra: compila, nao ha erro de runtime, o menu abre e fecha
// normalmente. O unico sintoma e visual, e so no celular -- por isso durou.
//
// O SEGUNDO DEFEITO, QUE O PRIMEIRO ESCONDIA
// ------------------------------------------
// O mesmo `-mr-12` tornava o menu IMPOSSIVEL de fechar em tela estreita. O
// painel e `max-w-xs w-full`: num aparelho de 320px de largura ele ocupa a tela
// inteira, o veu fica todo coberto, e o X -- que mora depois da borda direita
// do painel -- vai para fora da area visivel. Sem X alcancavel e sem veu para
// tocar, a gaveta so fechava navegando para outra tela.
//
// Por isso o X agora fica DENTRO do painel. Isso resolve os dois de uma vez:
// dentro dos limites, a translacao leva o botao junto quando a gaveta fecha, e
// ele continua alcancavel em qualquer largura.
//
// AS DUAS TRAVAS, E POR QUE SAO DUAS
// ----------------------------------
//   1. `MobileMenuClose` devolve null com o menu fechado. Esta e a trava que o
//      teste enxerga (scripts/test-menu-mobile.mjs renderiza os dois botoes nos
//      dois estados e conta os icones).
//   2. O X esta dentro do painel. Esta e a trava que sobrevive a um refactor
//      que perca a de cima -- e a unica que resolve a tela de 320px.
//
// Teste nenhum le geometria de CSS, entao a trava 2 e verificada por leitura.
// A 1 existe para que a regressao volte vermelha em CI, e nao no celular de
// quem usa o app.
//
// POR QUE O HAMBURGUER NAO TROCA MAIS DE ICONE
// --------------------------------------------
// O header trocava Menu por X quando o menu abria. Isso nunca foi visivel: com
// a gaveta aberta o painel opaco cobre justamente o canto onde o botao esta.
// O que a troca produzia era um SEGUNDO X na arvore, e dois lugares capazes de
// desenhar o mesmo icone e o que transforma um erro de posicionamento num erro
// de sobreposicao.
//
// Agora vale uma regra so, e ela e a que o usuario pediu: existe X na tela
// quando, e somente quando, o menu esta aberto. O hamburguer fica montado
// sempre -- tirar ele da arvore faria o titulo do header pular para a esquerda
// durante a animacao, visivel na faixa de tela que o painel nao cobre.
// -----------------------------------------------------------------------------

import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Liga o hamburguer a gaveta para quem navega por leitor de tela: sem isto o
 * `aria-expanded` do botao anuncia "expandido" sem dizer o que expandiu.
 */
export const ID_MENU_MOBILE = "menu-mobile";

interface MobileMenuToggleProps {
  /** Usado so para o `aria-expanded` -- o icone nao muda com o estado. */
  aberto: boolean;
  onToggle: () => void;
}

/** O hamburguer do header. Abre a gaveta; nunca desenha o X. */
export function MobileMenuToggle({ aberto, onToggle }: MobileMenuToggleProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      aria-expanded={aberto}
      aria-controls={ID_MENU_MOBILE}
      aria-label="Abrir menu"
    >
      <Menu className="h-6 w-6" />
    </Button>
  );
}

interface MobileMenuCloseProps {
  aberto: boolean;
  onClose: () => void;
}

/**
 * O X da gaveta. Mora DENTRO do painel, no canto superior direito, e sai da
 * arvore quando o menu esta fechado.
 */
export function MobileMenuClose({ aberto, onClose }: MobileMenuCloseProps) {
  if (!aberto) return null;

  return (
    <div className="absolute top-0 right-0 pt-3 pr-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar menu"
        // O fundo aqui e o do painel, que vem do tema -- entao o icone tem que
        // vir do tema tambem. Enquanto o botao flutuava sobre o veu escuro ele
        // era fixo e claro nos dois temas; dentro do painel, a mesma cor fica
        // invisivel no tema claro.
        className="flex items-center justify-center h-10 w-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <X className="h-6 w-6" />
      </button>
    </div>
  );
}
