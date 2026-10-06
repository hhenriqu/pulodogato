// =====================================================
// QUAL CONVITE DE INSTALACAO MOSTRAR, SE ALGUM
// =====================================================
// O banner "Instalar Pulo do Gato" existe desde o inicio do projeto e nunca
// apareceu para ninguem. Eram duas causas somadas, uma por plataforma:
//
// ANDROID -- o banner depende do evento `beforeinstallprompt`, que o Chrome so
// emite depois de conseguir DECODIFICAR um icone de 192px ou mais do manifest.
// Todos os icones eram documentos SVG com nome `.png`, e o Chrome nao aceita
// SVG nesse papel. O evento nunca era emitido. (Corrigido em
// `scripts/generate-pwa-icons.mjs`, com guard em `scripts/check-pwa-assets.mjs`.)
//
// iOS -- `beforeinstallprompt` NAO EXISTE no Safari, e nao e uma falta que vai
// ser corrigida: a Apple nao implementa esse evento. No iOS a instalacao e
// sempre manual, pelo botao Compartilhar > Adicionar a Tela de Inicio. Um app
// que so espera o evento nunca se oferece para instalar no iPhone -- e nao ha
// sintoma nenhum, porque o codigo do banner esta correto e simplesmente nunca
// e alcancado.
//
// Por isso a decisao mora aqui, separada do React: e uma regra de tres estados
// por plataforma, e testa-la pela interface exigiria simular Safari.
// =====================================================

/**
 * `navigator.standalone` nao existe no `lib.dom`: e extensao do Safari no iOS,
 * e e o UNICO jeito de saber ali que o app abriu instalado -- no iOS o
 * `display-mode: standalone` nem sempre responde. Dai o tipo proprio, em vez do
 * `as any` que estava nas duas chamadas.
 */
export type NavegadorIOS = Navigator & { standalone?: boolean };

/**
 * O evento `beforeinstallprompt`, que tambem nao esta no `lib.dom` -- e uma
 * extensao do Chromium. Os dois membros abaixo sao os que o codigo usa de fato:
 * `prompt()` abre o dialogo do sistema e `userChoice` resolve com a escolha.
 */
export type EventoDeInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** O que a interface deve mostrar. */
export type ConviteDeInstalacao =
  /** Nada -- ja instalado, dispensado, ou plataforma sem caminho de instalacao. */
  | "nenhum"
  /** O botao que dispara o prompt do proprio sistema (Chrome/Edge/Android). */
  | "nativo"
  /** As instrucoes de Compartilhar > Adicionar a Tela de Inicio (iOS). */
  | "ios";

/**
 * Por quantos dias "Agora nao" cala o convite.
 *
 * O botao antigo so mexia no estado do React: bastava navegar para outra
 * pagina e o banner voltava. No iOS isso seria pior que no Android, porque la
 * nao existe evento `appinstalled` -- quem instalasse e continuasse usando
 * pelo Safari levaria o mesmo convite para sempre.
 */
export const DIAS_DE_SILENCIO = 30;

export const CHAVE_DISPENSA = "pulodogato:convite-instalacao-dispensado-em";

export interface EstadoDeInstalacao {
  /** `display-mode: standalone`, ou `navigator.standalone` no iOS. */
  standalone: boolean;
  /** O aparelho e iPhone/iPad. */
  ehIOS: boolean;
  /** O navegador ja entregou um `beforeinstallprompt` guardado. */
  temPromptNativo: boolean;
  /** Valor lido de `localStorage`, ou null. */
  dispensadoEm: number | null;
  /** `Date.now()` de quem chama -- parametro para o teste nao depender do relogio. */
  agora: number;
}

export function decidirConvite(estado: EstadoDeInstalacao): ConviteDeInstalacao {
  // Ja instalado. Vem primeiro porque e a unica checagem que vale para as duas
  // plataformas e que torna todas as outras irrelevantes -- convidar a instalar
  // DENTRO do app instalado e o erro mais visivel que este modulo pode cometer.
  if (estado.standalone) return "nenhum";

  if (estado.dispensadoEm !== null) {
    const dias = (estado.agora - estado.dispensadoEm) / 86_400_000;
    // `dias < 0` cobre o relogio do aparelho ter voltado no tempo (fuso, data
    // errada). Sem isso um carimbo no futuro silenciaria o convite para sempre.
    if (dias < DIAS_DE_SILENCIO && dias >= 0) return "nenhum";
  }

  // O prompt nativo ganha do iOS quando os dois valem. Nao deveria acontecer --
  // nenhum navegador no iOS emite `beforeinstallprompt` --, mas se um dia
  // emitir, o caminho de um toque e melhor que a instrucao de tres passos.
  if (estado.temPromptNativo) return "nativo";

  if (estado.ehIOS) return "ios";

  // Desktop sem prompt nativo, ou Android antes de o evento chegar. Nao ha o
  // que oferecer: inventar um convite sem caminho de instalacao atras dele
  // ensina o usuario a ignorar o banner.
  return "nenhum";
}

/**
 * Detecta iPhone/iPad a partir do que o navegador informa.
 *
 * O iPadOS 13 em diante se apresenta como "Macintosh" no user agent, de
 * proposito, para receber os sites de desktop. Testar so por /iPad/ deixa de
 * fora todo iPad moderno -- e como o iPad nao tem `beforeinstallprompt`
 * tambem, o resultado seria um aparelho sem NENHUM caminho de instalacao
 * oferecido. O desempate e `maxTouchPoints`: Mac de verdade devolve 0.
 */
export function detectarIOS(nav: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;

  const pareceMac = /Macintosh|MacIntel/.test(`${nav.userAgent} ${nav.platform ?? ""}`);
  return pareceMac && (nav.maxTouchPoints ?? 0) > 1;
}

/** Le o carimbo de dispensa, tolerando lixo e `localStorage` bloqueado. */
export function lerDispensa(armazenamento: Pick<Storage, "getItem">): number | null {
  try {
    const bruto = armazenamento.getItem(CHAVE_DISPENSA);
    if (!bruto) return null;

    const valor = Number(bruto);
    // `Number("")` e 0, e 0 e um carimbo valido de 1970 que silenciaria tudo.
    // Só numero finito e positivo conta.
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  } catch {
    // Safari em navegacao privada lanca ao ler `localStorage`. Deixar estourar
    // aqui derrubaria a arvore inteira do React por causa de um banner.
    return null;
  }
}
