"use client";

// Importacao de extrato do banco (OFX/CSV) com conciliacao.
//
// A tela tem uma ordem deliberada: primeiro o que ainda espera decisao, depois
// o envio de um arquivo novo, e so no fim o historico. Quem abre aqui na
// segunda vez vem terminar o que comecou, nao mandar outro arquivo.
//
// O QUE ESTA TELA NAO FAZ SOZINHA
// --------------------------------
// Nenhuma linha vira lancamento sem um clique. A conciliacao e uma SUGESTAO
// mostrada lado a lado com o que ela encontrou -- o usuario ve "casou com
// 'Mercado' de 10/09, mesmo valor" e decide. Conciliacao automatica erra em
// silencio, e o erro dela e apagar do app um gasto que aconteceu de verdade.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileUp,
  Link2,
  Loader2,
  Repeat,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { FinancialAccount, TransactionCategory } from "@/types/financial";
import { CampoDeData } from "@/components/ui/campo-de-data";
import { lerValor } from "@/lib/statement";
import { mesDaFaturaPeloNome } from "@/lib/extrato-c6";
import { detectarOrigem, ROTULO_DA_ORIGEM_DETECTADA } from "@/lib/extrato-mercadopago";
import { NovaContaRapida } from "@/components/contas/NovaContaRapida";
import type { AccountType } from "@/types/financial";

import { Dica } from "@/components/ui/dica";
const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

// 'YYYY-MM-DD' formatado sem passar por new Date(): a string ISO e lida como
// UTC e, no Brasil, voltaria um dia no fuso local.
const dataCurta = (iso: string | null) => {
  if (!iso) return "--";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
};

// De onde e o arquivo (087, issue #447). A conta e a fatura do C6 tem formatos
// diferentes, e um lido como o outro erra o sinal ou a data das parcelas.
type Origem = "auto" | "c6_conta" | "c6_cartao" | "mercadopago_conta";

const ROTULO_DA_ORIGEM: Record<Origem, string> = {
  auto: "OFX ou CSV (detectar sozinho)",
  c6_conta: "C6 Bank: conta corrente",
  c6_cartao: "C6 Bank: fatura do cartão",
  mercadopago_conta: "Mercado Pago: extrato da conta",
};

// Valor especial do seletor de conta: abre o cadastro rapido ali mesmo.
const NOVA_CONTA = "__nova_conta__";

const TIPOS_FORA_DO_CARTAO: AccountType[] = ["checking", "savings", "digital", "debit_card", "cash", "investment", "other"];

/** O que o cadastro rapido ja traz preenchido para cada origem do arquivo. */
const CONTA_SUGERIDA: Record<Origem, { nome: string; tipo: AccountType; tipos?: AccountType[] }> = {
  auto: { nome: "", tipo: "checking" },
  c6_conta: { nome: "C6", tipo: "checking", tipos: TIPOS_FORA_DO_CARTAO },
  c6_cartao: { nome: "Cartão C6", tipo: "credit_card", tipos: ["credit_card"] },
  mercadopago_conta: { nome: "Mercado Pago", tipo: "digital", tipos: TIPOS_FORA_DO_CARTAO },
};

/** 'AAAA-MM' do mes corrente, no fuso do aparelho. */
const mesAtual = () => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
};

/** O que o usuario mudou na linha antes de confirmar. */
interface Edicao {
  data: string;
  valor: string;
  descricao: string;
}

interface StatementImport {
  id: string;
  source?: Origem;
  invoice_month?: string | null;
  account_id: string;
  file_name: string;
  file_format: "ofx" | "csv";
  period_start: string | null;
  period_end: string | null;
  entry_count: number;
  duplicate_count: number;
  created_at: string;
  pending_count: number;
  account: { name: string; color_hex?: string } | null;
}

interface Sugestao {
  transaction: { id: string; description: string; amount: number; transaction_date: string } | null;
  day_gap: number;
  similarity: number;
  /** existente - extrato, em reais; 0 no casamento exato, centavos no aproximado */
  amount_gap?: number;
}

interface StatementEntry {
  id: string;
  fingerprint: string;
  posted_at: string;
  amount: number;
  description: string;
  memo: string | null;
  status: "pending" | "imported" | "linked" | "ignored";
  transaction_id: string | null;
  suggestion: Sugestao | null;
  category_suggestion: SugestaoCategoria | null;
  // 087: o que a fatura do C6 traz alem do basico
  installment_number?: number | null;
  installment_total?: number | null;
  purchase_date?: string | null;
  card_last4?: string | null;
  bank_category?: string | null;
  suggested_action?: "ignore" | null;
  // Pix de/para o proprio titular, ou dinheiro reservado no mesmo banco:
  // sugere lancar como transferencia entre contas.
  transfer_hint?: "titular" | "reserva" | null;
  // a mesma linha ja veio em OUTRO extrato desta conta
  duplicate_of?: {
    entry: { id: string; description: string; posted_at: string; status: string };
    day_gap: number;
  } | null;
}

// "Pagamento de fatura Cartão de crédito" (Mercado Pago), "PGTO FATURA" etc.
const PAGAMENTO_DE_FATURA = /\b(pagamento|pgto|pag)\.? (de )?fatura\b/i;

const valorNaTela = (v: number) =>
  Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A categoria sugerida para a linha. `origin` distingue a REGRA do usuario
// ("voce ja disse que isto e X") do palpite do catalogo ("acho que e X"), e a
// tela precisa tratar as duas diferente -- ver o rotulo mais abaixo.
interface SugestaoCategoria {
  category_id: string;
  category_name: string;
  origin: "rule" | "catalog";
  matched_key: string;
}

export default function StatementsPage() {
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [contas, setContas] = useState<FinancialAccount[]>([]);
  const [categorias, setCategorias] = useState<TransactionCategory[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [contaEscolhida, setContaEscolhida] = useState("");
  const [origem, setOrigem] = useState<Origem>("auto");
  const [mesDaFatura, setMesDaFatura] = useState(mesAtual());
  // Enquanto o usuario nao mexer no mes, o nome do arquivo do C6
  // ("Fatura_2026-11-20.csv") decide. Depois que ele mexeu, a escolha dele vale.
  const mesTocado = useRef(false);
  const [edicaoPorLinha, setEdicaoPorLinha] = useState<Record<string, Edicao>>({});
  const [enviando, setEnviando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<StatementEntry[]>([]);
  const [carregandoLinhas, setCarregandoLinhas] = useState(false);
  const [categoriaPorLinha, setCategoriaPorLinha] = useState<Record<string, string>>({});
  const [agindoEm, setAgindoEm] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  // Onde o cadastro rapido de conta esta aberto: no envio ('envio') ou no
  // destino da transferencia de uma linha (o id da linha).
  const [criandoContaEm, setCriandoContaEm] = useState<string | null>(null);
  const [destinoPorLinha, setDestinoPorLinha] = useState<Record<string, string>>({});

  const carregarBase = useCallback(async () => {
    try {
      const [rExtratos, rContas, rCategorias] = await Promise.all([
        fetch("/api/statements"),
        fetch("/api/financial-accounts"),
        fetch("/api/personal-finance/categories"),
      ]);

      const extratos = await rExtratos.json();
      if (rExtratos.ok) setImports(extratos.imports ?? []);

      const dadosContas = await rContas.json();
      if (rContas.ok) setContas(dadosContas.accounts ?? dadosContas.data ?? []);

      const dadosCategorias = await rCategorias.json();
      if (rCategorias.ok) setCategorias(dadosCategorias.categories ?? dadosCategorias.data ?? []);
    } catch {
      toast.error("Não foi possível carregar a tela");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarBase();
  }, [carregarBase]);

  // -------------------------------------------------------------------
  // Varredura de assinaturas depois de mexer no extrato
  // -------------------------------------------------------------------
  // Importar extrato e o momento em que aparece a cobranca que o detector de
  // assinaturas procura. Sem este gatilho, a tela /dashboard/recurrences so
  // muda quando o usuario lembra de clicar em "Procurar agora" -- e quem nao
  // sabe que o botao existe nunca ve assinatura nenhuma.
  //
  // UMA varredura por SESSAO de importacao, e nao uma por linha. Quem processa
  // 40 linhas de um OFX dispararia 40 varreduras de 24 meses de historico, cada
  // uma reescrevendo o resultado da anterior. Por isso o clique so levanta uma
  // bandeira; a varredura sai quando o usuario fecha o extrato ou deixa a tela.
  //
  // E fire-and-forget de proposito: a varredura e idempotente e o cron diario
  // passa de qualquer jeito, entao uma falha aqui nao tem o que informar ao
  // usuario -- e um toast de erro sobre um job que ele nao pediu so assustaria.
  const extratoMexido = useRef(false);

  const varrerSeMexeu = useCallback(() => {
    if (!extratoMexido.current) return;
    extratoMexido.current = false;
    fetch("/api/recurrences/scan", { method: "POST" }).catch(() => {});
  }, []);

  // Sair da tela sem fechar o extrato e o caminho mais comum. Sem esta limpeza,
  // a bandeira morreria junto com o componente e a lista de assinaturas so
  // andaria no dia seguinte, pelo cron.
  useEffect(() => varrerSeMexeu, [varrerSeMexeu]);

  const fecharExtrato = useCallback(() => {
    setAbertoId(null);
    varrerSeMexeu();
  }, [varrerSeMexeu]);

  // `silencioso`: depois de resolver uma linha, a fila e relida sem o
  // carregando por cima -- antes a lista sumia e a pagina pulava a cada
  // clique, e com 111 linhas o usuario perdia o lugar (QA do Mercado Pago, B4).
  const abrirExtrato = useCallback(async (id: string, opcoes: { silencioso?: boolean } = {}) => {
    setAbertoId(id);
    if (!opcoes.silencioso) setCarregandoLinhas(true);
    try {
      const r = await fetch(`/api/statements/${id}`);
      const dados = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(dados.error ?? "Não foi possível abrir o extrato");
        setAbertoId(null);
        return;
      }

      const entradas: StatementEntry[] = dados.entries ?? [];
      setLinhas(entradas);

      // O seletor ja abre preenchido com a sugestao. E aqui que a feature
      // aparece para quem usa: em vez de dezenas de escolhas, o usuario percorre
      // a lista clicando "Lançar".
      //
      // Preenche, mas NAO lanca sozinho -- nem quando a sugestao vem de uma
      // regra. A linha do extrato e a ultima chance de olhar para o gasto antes
      // de ele virar dinheiro no app; importar em massa sem ninguem ver
      // transformaria um erro de regra em dezenas de lancamentos errados
      // descobertos so no relatorio do mes.
      //
      // `(m) => ({ ...m, ...novas })` e nao substituicao: o usuario pode ter
      // aberto outro extrato antes e mexido em linhas de la.
      const novas: Record<string, string> = {};
      for (const linha of entradas) {
        if (linha.status === "pending" && linha.category_suggestion) {
          novas[linha.id] = linha.category_suggestion.category_id;
        }
      }
      // O que o usuario ja escolheu ganha da sugestao: a releitura depois de
      // cada clique nao pode desfazer a categoria trocada em outra linha.
      setCategoriaPorLinha((m) => ({ ...novas, ...m }));

      // Os campos editaveis abrem com o que o banco mandou.
      const edicoes: Record<string, Edicao> = {};
      for (const linha of entradas) {
        if (linha.status === "pending") {
          edicoes[linha.id] = {
            data: String(linha.posted_at).slice(0, 10),
            valor: valorNaTela(Number(linha.amount)),
            descricao: linha.description,
          };
        }
      }
      // Mesma regra para data, valor e descricao editados e ainda nao confirmados.
      setEdicaoPorLinha((m) => ({ ...edicoes, ...m }));
    } finally {
      setCarregandoLinhas(false);
    }
  }, []);

  const enviarArquivo = async (arquivo: File) => {
    if (!contaEscolhida) {
      toast.error("Escolha primeiro a conta deste extrato");
      return;
    }

    // "Detectar sozinho" reconhece o CSV do C6 e o do Mercado Pago pelo
    // cabecalho e usa o leitor certo, em vez de cair no CSV generico.
    const conteudo = await arquivo.text();
    let origemDoEnvio: Origem = origem;
    if (origem === "auto") {
      const detectada = detectarOrigem(conteudo);
      if (detectada) {
        origemDoEnvio = detectada;
        setOrigem(detectada);
        toast.info(`Reconheci o arquivo: ${ROTULO_DA_ORIGEM_DETECTADA[detectada]}.`);
      }
    }

    let mes = mesDaFatura;
    if (origemDoEnvio === "c6_cartao" && !mesTocado.current) {
      const peloNome = mesDaFaturaPeloNome(arquivo.name);
      if (peloNome) {
        mes = peloNome;
        setMesDaFatura(peloNome);
      }
    }

    setEnviando(true);
    setAvisos([]);
    try {
      // O arquivo e lido como texto no navegador (acima): extrato e texto puro,
      // e assim nada precisa passar por armazenamento de arquivo.
      const r = await fetch("/api/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: contaEscolhida,
          fileName: arquivo.name,
          content: conteudo,
          source: origemDoEnvio,
          invoiceMonth: origemDoEnvio === "c6_cartao" ? mes : undefined,
        }),
      });
      const dados = await r.json().catch(() => ({}));

      // Os avisos do parser valem mesmo quando o import falha: e ali que esta
      // "nenhuma linha legivel, confira o separador".
      setAvisos(dados.warnings ?? []);

      if (!r.ok) {
        toast.error(dados.error ?? "Falha ao importar");
        return;
      }

      // Tudo repetido: a rota nao guarda importacao vazia (QA B1).
      if (dados.inserted === 0) {
        toast.info(dados.message ?? "Nada novo: todas as linhas deste arquivo já estavam importadas.");
        return;
      }

      toast.success(
        dados.duplicates > 0
          ? `${dados.inserted} lançamento(s) novo(s). ${dados.duplicates} já estavam importados.`
          : `${dados.inserted} lançamento(s) para revisar.`
      );

      await carregarBase();
      if (dados.inserted > 0) await abrirExtrato(dados.import.id);
    } finally {
      setEnviando(false);
      if (inputArquivo.current) inputArquivo.current.value = "";
    }
  };

  const agir = async (linha: StatementEntry, action: string, extra: Record<string, string> = {}) => {
    setAgindoEm(linha.id);
    try {
      const r = await fetch(`/api/statements/entries/${linha.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const dados = await r.json().catch(() => ({}));

      if (!r.ok) {
        toast.error(dados.error ?? "Não foi possível concluir");
        return;
      }

      // So `import` e `reset` mexem no conjunto de lancamentos que o detector
      // le -- um cria a financial_transaction, o outro apaga a que tinha sido
      // criada. `link` aponta para lancamento que ja existia e `ignore` nao
      // toca em nada: varrer depois deles seria trabalho garantidamente inutil.
      if (action === "import" || action === "reset") extratoMexido.current = true;
      // O `link` com centavos de diferenca corrige o valor do lancamento.
      if (action === "link" && dados.adjusted_amount != null) extratoMexido.current = true;

      // A regra nasceu escondida atras de um "Lançar". Se o app nao contar
      // agora, o usuario nunca vai saber que ela existe -- e vai continuar
      // achando que escolhe a categoria toda vez porque nao ha alternativa.
      if (dados.rule_learned) {
        toast.info("Guardei essa categoria: a próxima cobrança deste lugar já vem preenchida.");
      }

      if (dados.aviso) toast.info(dados.aviso);
      else
        toast.success(
          action === "import"
            ? "Lançamento criado"
            : action === "link"
              ? dados.adjusted_amount != null
                ? `Vinculado. O lançamento ficou com o valor do banco, R$ ${valorNaTela(dados.adjusted_amount)}`
                : "Vinculado ao lançamento que já existia"
              : action === "ignore"
                ? "Linha cancelada"
                : "Desfeito"
        );

      if (abertoId) await abrirExtrato(abertoId, { silencioso: true });
      await carregarBase();
    } finally {
      setAgindoEm(null);
    }
  };

  // A conta do extrato aberto: e de onde o dinheiro sai (ou para onde entra)
  // quando a linha vira transferencia.
  const contaDoExtrato = useMemo(
    () => imports.find((i) => i.id === abertoId)?.account_id ?? null,
    [imports, abertoId]
  );

  // Pix entre as proprias contas (QA M1). Grava as DUAS pernas pela rota de
  // transferencia, que ja garante as duas ou nenhuma, e vincula a linha a perna
  // desta conta. Se o vinculo falhar, a transferencia continua certa e a linha
  // aparece de novo com "Parece já lançado", porque casa com a perna.
  const transferir = async (linha: StatementEntry) => {
    const outra = destinoPorLinha[linha.id];
    if (!contaDoExtrato || !outra) {
      toast.error("Escolha a outra conta da transferência");
      return;
    }
    const saiDaqui = Number(linha.amount) < 0;
    const ed = edicaoPorLinha[linha.id];

    setAgindoEm(linha.id);
    try {
      const r = await fetch("/api/movimentacoes/transferencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: ed?.descricao.trim() || linha.description,
          data: ed?.data || String(linha.posted_at).slice(0, 10),
          // O valor e o do banco, sempre: e ele que a perna desta conta precisa
          // ter para o vinculo com a linha bater.
          valor: Math.abs(Number(linha.amount)),
          origem_id: saiDaqui ? contaDoExtrato : outra,
          destino_id: saiDaqui ? outra : contaDoExtrato,
        }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(dados.error ?? "Não foi possível lançar a transferência");
        return;
      }
      extratoMexido.current = true;
      const perna = saiDaqui ? dados.saida : dados.entrada;
      if (perna?.id) {
        await agir(linha, "link", { transaction_id: perna.id });
      } else if (abertoId) {
        await abrirExtrato(abertoId, { silencioso: true });
      }
    } finally {
      setAgindoEm(null);
    }
  };

  // Confirmar em lote (QA do Mercado Pago, M4): 13 de 38 linhas eram
  // "Rendimentos" de centavos, uma a uma. Cada linha vai pela MESMA rota do
  // Confirmar, com a categoria que esta no seletor e as edicoes feitas.
  const confirmarLote = async () => {
    const lote = prontasParaLote;
    if (lote.length === 0) return;
    if (
      !window.confirm(
        `Lançar ${lote.length} linha(s) com a categoria que está escolhida em cada uma? As linhas com aviso ficam para você.`
      )
    )
      return;

    setConfirmandoLote(true);
    let ok = 0;
    try {
      for (const linha of lote) {
        const ed = edicaoPorLinha[linha.id];
        const corpo: Record<string, string> = { action: "import", category_id: categoriaPorLinha[linha.id] };
        if (ed) {
          const v = lerValor(ed.valor);
          if (v !== null && v !== 0) corpo.amount = String(Math.abs(v));
          if (ed.data) corpo.transaction_date = ed.data;
          if (ed.descricao.trim()) corpo.description = ed.descricao.trim();
        }
        const r = await fetch(`/api/statements/entries/${linha.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        if (r.ok) ok++;
      }
    } finally {
      extratoMexido.current = true;
      setConfirmandoLote(false);
      if (ok === lote.length) toast.success(`${ok} lançamento(s) criado(s)`);
      else toast.error(`${ok} de ${lote.length} lançados. As outras continuam na fila.`);
      if (abertoId) await abrirExtrato(abertoId, { silencioso: true });
      await carregarBase();
    }
  };

  const descartar = async (id: string) => {
    // Um clique apagava a fila inteira, com as edicoes feitas nela (QA B3).
    if (
      !window.confirm(
        "Descartar este extrato? As linhas que ainda estão na fila e as edições feitas nelas serão perdidas. Os lançamentos já confirmados continuam."
      )
    )
      return;
    const r = await fetch(`/api/statements/${id}`, { method: "DELETE" });
    const dados = await r.json().catch(() => ({}));

    if (!r.ok) {
      toast.error(dados.error ?? "Não foi possível descartar");
      return;
    }

    toast.success("Extrato descartado");
    // Descartar o extrato NAO apaga as financial_transactions ja criadas a
    // partir dele (ver o comentario do DELETE em /api/statements/[id]), entao a
    // bandeira levantada pelos imports continua valendo e a varredura sai aqui.
    if (abertoId === id) fecharExtrato();
    else varrerSeMexeu();
    await carregarBase();
  };

  const pendentes = useMemo(() => linhas.filter((l) => l.status === "pending"), [linhas]);

  // Linhas que so dependem de um clique: tem categoria escolhida e nenhum
  // alerta (ja lancado, transferencia, duplicata, pagamento de fatura). Sao
  // elas que o "Confirmar em lote" lanca -- as outras pedem olho.
  const prontasParaLote = useMemo(
    () =>
      pendentes.filter(
        (l) =>
          categoriaPorLinha[l.id] &&
          !l.suggestion?.transaction &&
          !l.transfer_hint &&
          !l.duplicate_of &&
          !l.suggested_action &&
          !PAGAMENTO_DE_FATURA.test(l.description)
      ),
    [pendentes, categoriaPorLinha]
  );
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const resolvidas = useMemo(() => linhas.filter((l) => l.status !== "pending"), [linhas]);
  const totalPendente = useMemo(
    () => imports.reduce((s, i) => s + i.pending_count, 0),
    [imports]
  );

  // Despesa e receita tem listas de categoria diferentes: oferecer "Salario"
  // para um debito faria o relatorio por categoria mentir.
  const categoriasPara = (valor: number) =>
    categorias.filter((c) => (valor < 0 ? c.is_expense : !c.is_expense));

  if (carregando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">
          Importar extrato
          <Dica rotulo="Como funciona a importação">
            Mande o OFX ou CSV do banco, o CSV do C6 (da conta ou da fatura) ou o do Mercado Pago. O app separa o que já está lançado do que é novo —
            nada entra sem você confirmar.
          </Dica>
        </h1>
      </div>

      {totalPendente > 0 && !abertoId && (
        <Card className="border-warning/30 bg-warning/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <strong>{totalPendente}</strong> lançamento(s) de extrato esperando sua decisão.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ---------------- envio ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileUp className="h-5 w-5" /> Novo extrato
            <Dica rotulo="Por que escolher a conta antes">
              A conta precisa ser escolhida antes: é por ela que o app sabe com quais lançamentos
              comparar, e é por ela que um arquivo repetido é reconhecido.
            </Dica>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Conta</Label>
              <Select
                value={contaEscolhida}
                onValueChange={(v) => {
                  if (v === NOVA_CONTA) setCriandoContaEm("envio");
                  else setContaEscolhida(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
                  {contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NOVA_CONTA}>+ Criar conta ou cartão</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>De onde é o arquivo</Label>
              <Select value={origem} onValueChange={(v) => setOrigem(v as Origem)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROTULO_DA_ORIGEM) as Origem[]).map((o) => (
                    <SelectItem key={o} value={o}>
                      {ROTULO_DA_ORIGEM[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {origem === "c6_cartao" && (
              <div className="space-y-2">
                <Label htmlFor="mes-da-fatura-importada" className="flex items-center gap-1.5">
                  Mês da fatura
                  <Dica rotulo="Por que o mês da fatura">
                    O C6 repete a data da compra original em cada parcela. A parcela 6/12 de uma
                    compra de maio entra no dia 1 deste mês, e cada linha fica na fatura deste mês.
                  </Dica>
                </Label>
                <Input
                  id="mes-da-fatura-importada"
                  type="month"
                  value={mesDaFatura}
                  onChange={(e) => {
                    mesTocado.current = true;
                    setMesDaFatura(e.target.value);
                  }}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Arquivo</Label>
              <Input
                ref={inputArquivo}
                type="file"
                accept=".ofx,.csv,.txt,text/csv,application/x-ofx"
                disabled={!contaEscolhida || enviando}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) enviarArquivo(f);
                }}
              />
            </div>
          </div>

          {criandoContaEm === "envio" && (
            <NovaContaRapida
              key={origem}
              nomeSugerido={CONTA_SUGERIDA[origem].nome}
              tipoSugerido={CONTA_SUGERIDA[origem].tipo}
              tiposPermitidos={CONTA_SUGERIDA[origem].tipos}
              contasExistentes={contas}
              onUsarExistente={(conta) => {
                setContaEscolhida(conta.id);
                setCriandoContaEm(null);
              }}
              onCriada={(conta) => {
                setContas((lista) => [conta, ...lista]);
                setContaEscolhida(conta.id);
                setCriandoContaEm(null);
              }}
              onCancelar={() => setCriandoContaEm(null)}
            />
          )}

          {enviando && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo o arquivo...
            </p>
          )}

          {avisos.length > 0 && (
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3">
              {avisos.map((a, i) => (
                <p key={i} className="flex gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  {a}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- revisao ---------------- */}
      {abertoId && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Revisar</CardTitle>
              <CardDescription>
                {pendentes.length} esperando decisão · {resolvidas.length} já resolvido(s)
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fecharExtrato}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {carregandoLinhas && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!carregandoLinhas && prontasParaLote.length > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-2 text-sm">
                <span className="text-muted-foreground">
                  {prontasParaLote.length} linha(s) já têm categoria e nenhum aviso.
                </span>
                <Button size="sm" variant="secondary" disabled={confirmandoLote} onClick={confirmarLote}>
                  {confirmandoLote ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-3 w-3" />
                  )}
                  Confirmar as {prontasParaLote.length}
                </Button>
              </div>
            )}

            {!carregandoLinhas && pendentes.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tudo deste extrato já foi resolvido.
              </p>
            )}

            {pendentes.map((linha) => {
              const despesa = Number(linha.amount) < 0;
              const ocupado = agindoEm === linha.id;

              return (
                <div key={linha.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{linha.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {dataCurta(linha.posted_at)}
                        {linha.memo ? ` · ${linha.memo}` : ""}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 font-semibold tabular-nums ${
                        despesa ? "text-destructive" : "text-success"
                      }`}
                    >
                      {moeda(Number(linha.amount))}
                    </p>
                  </div>

                  {(linha.card_last4 || linha.installment_number || linha.bank_category) && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {linha.card_last4 && <Badge variant="outline">cartão final {linha.card_last4}</Badge>}
                      {linha.installment_number && (
                        <Badge variant="outline">
                          parcela {linha.installment_number}/{linha.installment_total}
                        </Badge>
                      )}
                      {linha.purchase_date && (
                        <Badge variant="outline">compra em {dataCurta(linha.purchase_date)}</Badge>
                      )}
                      {linha.bank_category && <Badge variant="outline">C6: {linha.bank_category}</Badge>}
                    </div>
                  )}

                  {/* O pagamento da fatura ja aparece no extrato da conta: chega
                      sugerido para cancelar, mas quem decide e o usuario. */}
                  {/* Pagamento de fatura no extrato da CONTA (QA do Mercado
                      Pago, M3). Transferencia para cartao nao existe no app: a
                      fatura e paga pelo "Pagar" dela, que grava a saida desta
                      conta -- e ai esta linha casa com "É o mesmo". */}
                  {PAGAMENTO_DE_FATURA.test(linha.description) && !linha.card_last4 && !linha.suggestion?.transaction && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
                      <span>
                        Pagamento de fatura de cartão. Registre pelo botão <strong>Pagar</strong> da fatura, na tela do
                        cartão, pagando desta conta; depois volte aqui e esta linha aparece como já lançada.
                      </span>
                      <Link href="/dashboard/cartoes" className="text-primary underline underline-offset-2">
                        Ir para Cartões
                      </Link>
                    </div>
                  )}

                  {linha.suggested_action === "ignore" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                      <span>
                        Pagamento da fatura. Ele já aparece no extrato da conta; lançar aqui contaria
                        duas vezes.
                      </span>
                      <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => agir(linha, "ignore")}>
                        Cancelar esta linha
                      </Button>
                    </div>
                  )}

                  {/* Possivel duplicata de outro extrato da mesma conta (OFX e
                      depois CSV do mesmo mes, por exemplo). */}
                  {linha.duplicate_of && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                      <span className="text-muted-foreground">Possível duplicata: já veio em outro extrato como</span>
                      <strong>{linha.duplicate_of.entry.description}</strong>
                      <span className="text-muted-foreground">
                        em {dataCurta(linha.duplicate_of.entry.posted_at)} (
                        {linha.duplicate_of.entry.status === "pending"
                          ? "ainda pendente lá"
                          : linha.duplicate_of.entry.status === "imported"
                            ? "lançada"
                            : "vinculada"}
                        )
                      </span>
                      <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => agir(linha, "ignore")}>
                        Cancelar esta linha
                      </Button>
                    </div>
                  )}

                  {/* Dinheiro que so mudou de conta (QA M1): como receita ou
                      despesa, inflaria o resultado do mes. */}
                  {linha.transfer_hint && !linha.suggestion?.transaction && (
                    <div className="mt-3 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
                      <p className="flex items-center gap-2">
                        <Repeat className="h-4 w-4 shrink-0 text-primary" />
                        {linha.transfer_hint === "reserva"
                          ? "Parece dinheiro guardado ou resgatado no próprio banco."
                          : "Parece uma transferência entre as suas contas."}{" "}
                        {despesa ? "Para qual conta foi?" : "De qual conta veio?"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={destinoPorLinha[linha.id] ?? ""}
                          onValueChange={(v) => {
                            if (v === NOVA_CONTA) setCriandoContaEm(linha.id);
                            else setDestinoPorLinha((m) => ({ ...m, [linha.id]: v }));
                          }}
                        >
                          <SelectTrigger className="h-8 w-56">
                            <SelectValue placeholder="Escolha a conta" />
                          </SelectTrigger>
                          <SelectContent>
                            {contas
                              .filter((c) => c.id !== contaDoExtrato && c.account_type !== "credit_card")
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            <SelectItem value={NOVA_CONTA}>+ Criar conta</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          disabled={ocupado || !destinoPorLinha[linha.id]}
                          onClick={() => transferir(linha)}
                        >
                          {ocupado ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Repeat className="mr-1 h-3 w-3" />
                          )}
                          Lançar como transferência
                        </Button>
                      </div>
                      {criandoContaEm === linha.id && (
                        <NovaContaRapida
                          nomeSugerido={linha.transfer_hint === "reserva" ? "Reserva" : ""}
                          tipoSugerido={linha.transfer_hint === "reserva" ? "savings" : "checking"}
                          tiposPermitidos={TIPOS_FORA_DO_CARTAO}
                          contasExistentes={contas}
                          onUsarExistente={(conta) => {
                            setDestinoPorLinha((m) => ({ ...m, [linha.id]: conta.id }));
                            setCriandoContaEm(null);
                          }}
                          onCriada={(conta) => {
                            setContas((lista) => [conta, ...lista]);
                            setDestinoPorLinha((m) => ({ ...m, [linha.id]: conta.id }));
                            setCriandoContaEm(null);
                          }}
                          onCancelar={() => setCriandoContaEm(null)}
                        />
                      )}
                    </div>
                  )}

                  {/* A sugestao da conciliacao, com o que ela encontrou a vista.
                      Sem mostrar COM O QUE casou, confirmar e um voto de fe. */}
                  {linha.suggestion?.transaction && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2 text-sm">
                      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">Parece já lançado como</span>
                      <strong>{linha.suggestion.transaction.description}</strong>
                      <span className="text-muted-foreground">
                        em {dataCurta(linha.suggestion.transaction.transaction_date)}
                        {linha.suggestion.day_gap > 0
                          ? ` (${linha.suggestion.day_gap} dia${linha.suggestion.day_gap > 1 ? "s" : ""} de diferença)`
                          : " (mesmo dia)"}
                        {linha.suggestion.amount_gap
                          ? `, R$ ${valorNaTela(linha.suggestion.transaction.amount)} no app: o lançamento fica com o valor do banco`
                          : ""}
                      </span>
                      {/* Botao principal da linha quando ha casamento: o Confirmar
                          ao lado criava o gasto em dobro com um clique distraido (QA B2). */}
                      <Button
                        size="sm"
                        disabled={ocupado}
                        onClick={() =>
                          agir(linha, "link", {
                            transaction_id: linha.suggestion!.transaction!.id,
                          })
                        }
                      >
                        {ocupado ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3 w-3" />
                        )}
                        É o mesmo
                      </Button>
                    </div>
                  )}

                  {edicaoPorLinha[linha.id] && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[150px_120px_1fr]">
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`data-${linha.id}`}>Data</Label>
                        <CampoDeData
                          id={`data-${linha.id}`}
                          value={edicaoPorLinha[linha.id].data}
                          onChange={(v) =>
                            setEdicaoPorLinha((m) => ({ ...m, [linha.id]: { ...m[linha.id], data: v } }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`valor-${linha.id}`}>
                          Valor ({despesa ? "saída" : "entrada"})
                        </Label>
                        <Input
                          id={`valor-${linha.id}`}
                          inputMode="decimal"
                          className="h-9"
                          value={edicaoPorLinha[linha.id].valor}
                          onChange={(e) =>
                            setEdicaoPorLinha((m) => ({ ...m, [linha.id]: { ...m[linha.id], valor: e.target.value } }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`descricao-${linha.id}`}>Descrição</Label>
                        <Input
                          id={`descricao-${linha.id}`}
                          className="h-9"
                          value={edicaoPorLinha[linha.id].descricao}
                          onChange={(e) =>
                            setEdicaoPorLinha((m) => ({ ...m, [linha.id]: { ...m[linha.id], descricao: e.target.value } }))
                          }
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-[180px] flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-xs">Categoria</Label>
                        {/* Regra e catalogo NAO podem ter a mesma cara. A regra
                            e uma decisao que o usuario ja tomou; o catalogo e
                            palpite nosso. Apresentar os dois igual ensinaria
                            ele a confiar no chute tanto quanto na propria
                            escolha -- e e o chute que erra. */}
                        {linha.category_suggestion?.origin === "rule" && (
                          <span className="text-primary text-[11px] font-medium">
                            sua regra: {linha.category_suggestion.matched_key}
                          </span>
                        )}
                        {linha.category_suggestion?.origin === "catalog" && (
                          <span className="text-muted-foreground text-[11px]">
                            sugestão — confira
                          </span>
                        )}
                      </div>
                      <Select
                        value={categoriaPorLinha[linha.id] ?? ""}
                        onValueChange={(v) =>
                          setCategoriaPorLinha((m) => ({ ...m, [linha.id]: v }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Escolha para lançar" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoriasPara(Number(linha.amount)).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      size="sm"
                      variant={linha.suggestion?.transaction ? "outline" : "default"}
                      disabled={ocupado || !categoriaPorLinha[linha.id]}
                      onClick={() => {
                        const ja = linha.suggestion?.transaction;
                        if (
                          ja &&
                          !window.confirm(
                            `Esta linha parece já lançada como "${ja.description}". Criar outro lançamento mesmo assim?`
                          )
                        )
                          return;
                        const ed = edicaoPorLinha[linha.id];
                        const extra: Record<string, string> = { category_id: categoriaPorLinha[linha.id] };
                        if (ed) {
                          // O valor vai sem sinal: o sinal e o do banco (ver a rota).
                          const v = lerValor(ed.valor);
                          if (v === null || v === 0) {
                            toast.error("Valor inválido");
                            return;
                          }
                          extra.amount = String(Math.abs(v));
                          if (ed.data) extra.transaction_date = ed.data;
                          if (ed.descricao.trim()) extra.description = ed.descricao.trim();
                        }
                        agir(linha, "import", extra);
                      }}
                    >
                      {ocupado ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="mr-1 h-4 w-4" />
                      )}
                      Confirmar
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={() => agir(linha, "ignore")}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              );
            })}

            {resolvidas.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {resolvidas.length} linha(s) já resolvida(s)
                </summary>
                <div className="mt-2 space-y-2">
                  {resolvidas.map((linha) => (
                    <div
                      key={linha.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {dataCurta(linha.posted_at)} · {linha.description}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {linha.status === "imported"
                            ? "lançada"
                            : linha.status === "linked"
                              ? "já existia"
                              : "cancelada"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => agir(linha, "reset")}
                          disabled={agindoEm === linha.id}
                        >
                          Desfazer
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------- historico ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Extratos enviados</CardTitle>
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum extrato ainda. Exporte o OFX do seu banco — quase todos oferecem,
              às vezes com o nome &quot;Money&quot; ou &quot;Microsoft Money&quot;.
            </p>
          ) : (
            <div className="space-y-2">
              {imports.map((i) => (
                <div
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.file_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {i.account?.name ?? "conta removida"} ·{" "}
                      {i.period_start ? `${dataCurta(i.period_start)} a ${dataCurta(i.period_end)}` : "sem período"}{" "}
                      · {i.entry_count} novo(s)
                      {i.duplicate_count > 0 ? ` · ${i.duplicate_count} repetido(s)` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {i.pending_count > 0 && (
                      <Badge variant="destructive">{i.pending_count} pendente(s)</Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => abrirExtrato(i.id)}>
                      <Upload className="mr-1 h-3 w-3 rotate-180" /> Revisar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => descartar(i.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
