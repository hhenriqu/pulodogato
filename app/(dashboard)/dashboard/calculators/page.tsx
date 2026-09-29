"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { valorNumerico } from "@/lib/dinheiro";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, Gift, Palmtree, Landmark, Info, AlertTriangle } from "lucide-react";
import {
  calcularDecimoTerceiro,
  calcularFGTS,
  calcularFerias,
  calcularJurosCompostos,
  INSS_2026,
  IRRF_2026,
  REDUTOR_IRRF_2026,
  type MotivoSaida,
  type ResultadoINSS,
  type ResultadoIRRF,
  type UnidadeTaxa,
} from "@/lib/calculadoras";

// =====================================================
// Calculadoras (HMO-145)
// =====================================================
// Quatro calculadoras que rodam INTEIRAS no navegador: nao ha rota de API, nao
// ha tabela, nao ha migration. Foi por isso que esta tela pode subir junto com
// o merge, sem um segundo passo no banco de producao depois.
//
// A decisao de desenho que vale registrar: toda calculadora mostra o CAMINHO
// do numero, nao so o numero. O INSS aparece faixa a faixa, o IRRF mostra a
// deducao escolhida e o redutor da Lei 15.270 em linha separada. Calculadora
// de folha que so cospe o total nao e conferivel -- e quando o usuario compara
// com o contracheque e da diferenca, ele nao tem como saber quem errou.
//
// Toda cor sai de token. Uma classe de paleta fixa do Tailwind passa no build
// e vira um bloco claro no modo noturno; o `npm run check-color-tokens`
// reprova (HMO-144). O guard varre o texto cru, entao ele reprova ate citar o
// nome de uma dessas classes dentro de um comentario.
// =====================================================

function brl(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(fracao: number, casas = 2): string {
  return `${(fracao * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

/**
 * Le um campo numerico sem transformar vazio em zero de forma confusa.
 *
 * SO para os campos que NAO sao dinheiro (taxa, anos, meses, dependentes, dias).
 * Ele trata o ponto como separador de MILHAR, entao passar um valor de
 * `CampoDeValor` por aqui multiplica por cem em silencio:
 *
 *   num("1000.00")  ->  100000
 *
 * Campo de dinheiro se le com `valorNumerico` (lib/dinheiro.ts), que e a
 * conversao que combina com o que o campo emite.
 */
function num(texto: string): number {
  const limpo = texto.replace(/\./g, "").replace(",", ".");
  const valor = Number.parseFloat(limpo);
  return Number.isFinite(valor) ? valor : 0;
}

function CampoNumero({
  id,
  rotulo,
  valor,
  aoMudar,
  dinheiro,
  prefixo,
  sufixo,
  passo = "0.01",
  dica,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  /**
   * O campo e de dinheiro: entra mascarado (HMO-171) e o estado guarda o valor
   * plano. Quem le esse estado usa `valorNumerico`, NAO `num`.
   *
   * Nao ha `prefixo` junto com isto: a mascara ja escreve o simbolo dentro do
   * campo, e o "R$" absoluto que ficava a esquerda passaria a aparecer duas
   * vezes -- uma sobre a outra, porque os dois ocupam a mesma posicao.
   */
  dinheiro?: boolean;
  prefixo?: string;
  sufixo?: string;
  passo?: string;
  dica?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {dinheiro ? (
        <CampoDeValor id={id} value={valor} onChange={aoMudar} />
      ) : (
        <div className="relative">
          {prefixo && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {prefixo}
            </span>
          )}
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min="0"
            step={passo}
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
            className={prefixo ? "pl-10" : sufixo ? "pr-10" : undefined}
          />
          {sufixo && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {sufixo}
            </span>
          )}
        </div>
      )}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

/** Uma linha de resultado. `destaque` marca o numero que o usuario veio buscar. */
function Linha({
  rotulo,
  valor,
  destaque,
  negativo,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  negativo?: boolean;
  detalhe?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <span className={destaque ? "font-medium" : "text-sm text-muted-foreground"}>{rotulo}</span>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </div>
      <span
        className={
          destaque
            ? "text-lg font-semibold tabular-nums"
            : negativo
              ? "text-sm tabular-nums text-destructive"
              : "text-sm tabular-nums"
        }
      >
        {negativo ? `- ${valor}` : valor}
      </span>
    </div>
  );
}

/**
 * Detalhamento do INSS e do IRRF.
 *
 * Existe porque o valor sozinho nao e conferivel. O INSS progressivo e o
 * redutor da Lei 15.270 produzem numeros que nao batem com a conta de cabeca
 * de ninguem -- sem o caminho a tela parece estar errada justamente quando
 * esta certa.
 */
function DetalheTributos({ inss, irrf }: { inss: ResultadoINSS; irrf: ResultadoIRRF }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">INSS</span>
          <span className="text-sm tabular-nums">{brl(inss.contribuicao)}</span>
        </div>
        <ul className="mt-1 space-y-0.5">
          {inss.porFaixa.map((faixa) => (
            <li key={faixa.ate} className="flex justify-between text-xs text-muted-foreground">
              <span>
                ate {brl(faixa.ate)} &middot; {pct(faixa.aliquota, 1)}
              </span>
              <span className="tabular-nums">{brl(faixa.parcela)}</span>
            </li>
          ))}
        </ul>
        {inss.tetoAtingido && (
          <p className="mt-1 text-xs text-muted-foreground">
            Teto atingido: acima de {brl(INSS_2026.teto)} a contribuicao para de crescer.
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Aliquota efetiva: {pct(inss.aliquotaEfetiva)}
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">IRRF</span>
          <span className="text-sm tabular-nums">{brl(irrf.imposto)}</span>
        </div>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          <li className="flex justify-between">
            <span>
              Deducao {irrf.deducaoAplicada === "simplificado" ? "simplificada" : "legal"}
            </span>
            <span className="tabular-nums">- {brl(irrf.valorDeducao)}</span>
          </li>
          <li className="flex justify-between">
            <span>Base de calculo</span>
            <span className="tabular-nums">{brl(irrf.base)}</span>
          </li>
          <li className="flex justify-between">
            <span>Tabela progressiva ({pct(irrf.aliquotaFaixa, 1)})</span>
            <span className="tabular-nums">{brl(irrf.impostoTabela)}</span>
          </li>
          {irrf.redutor > 0 && (
            <li className="flex justify-between">
              <span>Reducao da Lei 15.270/2025</span>
              <span className="tabular-nums">- {brl(irrf.redutor)}</span>
            </li>
          )}
        </ul>
        {irrf.isentoPelaLei15270 && (
          <Badge variant="outline" className="mt-2 border-success text-success">
            Isento pela Lei 15.270/2025
          </Badge>
        )}
      </div>
    </div>
  );
}

function Resultado({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card className="bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Juros compostos
// ---------------------------------------------------------------------------

function CalculadoraJuros() {
  const [inicial, setInicial] = useState("1000");
  const [aporte, setAporte] = useState("300");
  const [taxa, setTaxa] = useState("10");
  const [unidade, setUnidade] = useState<UnidadeTaxa>("ANUAL");
  const [anos, setAnos] = useState("10");

  const meses = Math.round(num(anos) * 12);
  const r = useMemo(
    () =>
      calcularJurosCompostos({
        valorInicial: valorNumerico(inicial),
        aporteMensal: valorNumerico(aporte),
        taxa: num(taxa),
        unidadeTaxa: unidade,
        meses,
      }),
    [inicial, aporte, taxa, unidade, meses],
  );

  // Um ponto por ano, para a tabela nao virar 360 linhas.
  const porAno = r.evolucao.filter((p) => p.mes % 12 === 0);

  // O `grid-cols-1` nao e redundante, e ele que conserta a HMO-168 nesta tela.
  //
  // `grid` sozinho cria UMA coluna implicita de tamanho `auto`, e trilho `auto`
  // tem o min-content do conteudo como piso -- ele cresce alem do container em
  // vez de apertar. Aqui o par "Taxa de juros / Periodo da taxa" tem min-content
  // de 364px, entao num aparelho de 320px o trilho ficava com 364px dentro de um
  // container de 288px e a pagina inteira andava 60px para o lado. Os dois
  // numeros sao medidos no navegador, em producao, nao estimados.
  //
  // `grid-cols-1` do Tailwind e `repeat(1, minmax(0, 1fr))`: o `minmax(0, ...)`
  // remove esse piso, o trilho passa a caber no container e quem aperta e o
  // conteudo -- que e o que se espera de um formulario em tela estreita. De `lg`
  // para cima nada muda, as duas colunas voltam.
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <CampoNumero id="j-inicial" rotulo="Valor inicial" valor={inicial} aoMudar={setInicial} dinheiro />
        <CampoNumero id="j-aporte" rotulo="Aporte mensal" valor={aporte} aoMudar={setAporte} dinheiro />
        <div className="grid grid-cols-2 gap-3">
          <CampoNumero id="j-taxa" rotulo="Taxa de juros" valor={taxa} aoMudar={setTaxa} sufixo="%" passo="0.1" />
          <div className="space-y-1.5">
            <Label htmlFor="j-unidade">Periodo da taxa</Label>
            <Select value={unidade} onValueChange={(v) => setUnidade(v as UnidadeTaxa)}>
              <SelectTrigger id="j-unidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANUAL">Ao ano</SelectItem>
                <SelectItem value="MENSAL">Ao mes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <CampoNumero
          id="j-anos"
          rotulo="Prazo"
          valor={anos}
          aoMudar={setAnos}
          sufixo="anos"
          passo="1"
          dica={`${meses} meses`}
        />

        <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Taxa ao ano e convertida pela equivalencia real ({pct(r.taxaMensalEfetiva / 100, 4)} ao
            mes), e nao dividida por 12. Os aportes entram no fim de cada mes.
          </span>
        </p>
      </div>

      <div className="space-y-4">
        <Resultado titulo="Resultado">
          <Linha rotulo="Montante final" valor={brl(r.montante)} destaque />
          <Linha rotulo="Total investido" valor={brl(r.totalInvestido)} />
          <Linha rotulo="Juros ganhos" valor={brl(r.jurosGanhos)} />
          <Linha
            rotulo="Parte do montante que e juros"
            valor={r.montante > 0 ? pct(r.jurosGanhos / r.montante) : "0,00%"}
          />
        </Resultado>

        {porAno.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ano a ano</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-medium">Ano</th>
                      <th className="py-1.5 text-right font-medium">Investido</th>
                      <th className="py-1.5 text-right font-medium">Juros</th>
                      <th className="py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porAno.map((p) => (
                      <tr key={p.mes} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5">{p.mes / 12}</td>
                        <td className="py-1.5 text-right tabular-nums">{brl(p.investido)}</td>
                        <td className="py-1.5 text-right tabular-nums">{brl(p.juros)}</td>
                        <td className="py-1.5 text-right font-medium tabular-nums">{brl(p.montante)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 13o salario
// ---------------------------------------------------------------------------

function CalculadoraDecimoTerceiro() {
  const [salario, setSalario] = useState("3000");
  const [meses, setMeses] = useState("12");
  const [dependentes, setDependentes] = useState("0");

  const r = useMemo(
    () =>
      calcularDecimoTerceiro({
        salarioBruto: valorNumerico(salario),
        mesesTrabalhados: num(meses),
        dependentes: num(dependentes),
      }),
    [salario, meses, dependentes],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <CampoNumero id="d-salario" rotulo="Salario bruto mensal" valor={salario} aoMudar={setSalario} dinheiro />
        <CampoNumero
          id="d-meses"
          rotulo="Meses trabalhados no ano"
          valor={meses}
          aoMudar={setMeses}
          passo="1"
          dica="Fracao de mes com 15 dias ou mais conta como mes cheio."
        />
        <CampoNumero id="d-dep" rotulo="Dependentes" valor={dependentes} aoMudar={setDependentes} passo="1" />

        <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A 1a parcela (ate 30/11) sai <strong>sem desconto</strong>. Todo o INSS e o IRRF do 13o
            sao retidos de uma vez na 2a parcela, ate 20/12. O IRRF do 13o e calculado isolado do
            salario do mes.
          </span>
        </p>
      </div>

      <div className="space-y-4">
        <Resultado titulo={`13o de ${r.avos}/12 avos`}>
          <Linha rotulo="13o bruto" valor={brl(r.bruto)} />
          <Linha rotulo="1a parcela (ate 30/11)" valor={brl(r.primeiraParcela)} destaque detalhe="Sem descontos" />
          <Linha
            rotulo="2a parcela (ate 20/12)"
            valor={brl(Math.abs(r.segundaParcela))}
            destaque
            negativo={r.segundaParcela < 0}
            detalhe={
              r.segundaParcela < 0
                ? "O adiantamento passou do devido: ha valor a devolver."
                : "Ja com INSS e IRRF descontados"
            }
          />
          <div className="border-t border-border pt-2">
            <Linha rotulo="Liquido total no ano" valor={brl(r.liquido)} />
          </div>
        </Resultado>

        <DetalheTributos inss={r.inss} irrf={r.irrf} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ferias
// ---------------------------------------------------------------------------

function CalculadoraFerias() {
  const [salario, setSalario] = useState("3000");
  const [dias, setDias] = useState("30");
  const [abono, setAbono] = useState("0");
  const [adiantarDecimo, setAdiantarDecimo] = useState(false);
  const [dependentes, setDependentes] = useState("0");

  const r = useMemo(
    () =>
      calcularFerias({
        salarioBruto: valorNumerico(salario),
        diasFerias: num(dias),
        diasAbono: num(abono),
        adiantarDecimoTerceiro: adiantarDecimo,
        dependentes: num(dependentes),
      }),
    [salario, dias, abono, adiantarDecimo, dependentes],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <CampoNumero id="f-salario" rotulo="Salario bruto mensal" valor={salario} aoMudar={setSalario} dinheiro />
        <div className="grid grid-cols-2 gap-3">
          <CampoNumero id="f-dias" rotulo="Dias de descanso" valor={dias} aoMudar={setDias} passo="1" />
          <CampoNumero
            id="f-abono"
            rotulo="Dias vendidos"
            valor={abono}
            aoMudar={setAbono}
            passo="1"
            dica="Abono: no maximo 10"
          />
        </div>
        <CampoNumero id="f-dep" rotulo="Dependentes" valor={dependentes} aoMudar={setDependentes} passo="1" />

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <Label htmlFor="f-adiantar">Adiantar metade do 13o</Label>
            <p className="text-xs text-muted-foreground">Permitido junto com as ferias.</p>
          </div>
          <Switch id="f-adiantar" checked={adiantarDecimo} onCheckedChange={setAdiantarDecimo} />
        </div>

        {r.avisos.map((aviso) => (
          // O par `border-warning/30 bg-warning/10` com o texto herdando o
          // foreground e o padrao ja usado no relatorio e na tela de extrato.
          // O acento fica so no icone: texto na cor do aviso sobre um veu de
          // 10% da mesma cor tem contraste baixo no tema claro.
          <p
            key={aviso}
            className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>{aviso}</span>
          </p>
        ))}

        <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            O 1/3 constitucional <strong>e</strong> tributado. O abono pecuniario (dias vendidos), o
            1/3 dele e o adiantamento do 13o <strong>nao</strong> sao: entram inteiros no liquido.
          </span>
        </p>
      </div>

      <div className="space-y-4">
        <Resultado titulo="Resultado">
          <Linha rotulo="Ferias (descanso)" valor={brl(r.feriasBruto)} />
          <Linha rotulo="1/3 constitucional" valor={brl(r.tercoConstitucional)} />
          {r.abonoBruto > 0 && (
            <>
              <Linha rotulo="Abono pecuniario" valor={brl(r.abonoBruto)} detalhe="Isento de INSS e IRRF" />
              <Linha rotulo="1/3 sobre o abono" valor={brl(r.tercoAbono)} detalhe="Isento de INSS e IRRF" />
            </>
          )}
          {r.adiantamentoDecimo > 0 && (
            <Linha
              rotulo="Adiantamento do 13o"
              valor={brl(r.adiantamentoDecimo)}
              detalhe="Tributado no 13o, em dezembro"
            />
          )}
          <div className="border-t border-border pt-2">
            <Linha rotulo="Total bruto" valor={brl(r.totalBruto)} />
            <Linha rotulo="INSS" valor={brl(r.inss.contribuicao)} negativo />
            <Linha rotulo="IRRF" valor={brl(r.irrf.imposto)} negativo />
            <Linha rotulo="Liquido a receber" valor={brl(r.liquido)} destaque />
          </div>
        </Resultado>

        <DetalheTributos inss={r.inss} irrf={r.irrf} />
        <p className="text-xs text-muted-foreground">
          Base tributavel: {brl(r.baseTributavel)} (ferias + 1/3).
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FGTS
// ---------------------------------------------------------------------------

const ROTULO_SAIDA: Record<MotivoSaida, string> = {
  SEM_JUSTA_CAUSA: "Dispensa sem justa causa (multa de 40%)",
  ACORDO: "Acordo entre as partes (multa de 20%)",
  PEDIDO_DEMISSAO: "Pedido de demissao (sem multa)",
  JUSTA_CAUSA: "Dispensa por justa causa (sem multa)",
};

function CalculadoraFGTS() {
  const [salario, setSalario] = useState("3000");
  const [meses, setMeses] = useState("24");
  const [saldoInicial, setSaldoInicial] = useState("0");
  const [motivo, setMotivo] = useState<MotivoSaida>("SEM_JUSTA_CAUSA");

  const r = useMemo(
    () =>
      calcularFGTS({
        salarioBruto: valorNumerico(salario),
        mesesTrabalhados: num(meses),
        saldoInicial: valorNumerico(saldoInicial),
        motivoSaida: motivo,
      }),
    [salario, meses, saldoInicial, motivo],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <CampoNumero id="g-salario" rotulo="Salario bruto mensal" valor={salario} aoMudar={setSalario} dinheiro />
        <CampoNumero id="g-meses" rotulo="Meses a projetar" valor={meses} aoMudar={setMeses} passo="1" />
        <CampoNumero
          id="g-saldo"
          rotulo="Saldo que ja existe na conta"
          valor={saldoInicial}
          aoMudar={setSaldoInicial}
          dinheiro
        />
        <div className="space-y-1.5">
          <Label htmlFor="g-motivo">Motivo da saida</Label>
          <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoSaida)}>
            <SelectTrigger id="g-motivo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_SAIDA) as MotivoSaida[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {ROTULO_SAIDA[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Deposito de 8% do bruto, mais um deposito extra por ano referente ao 13o. Juros de 3% ao
            ano creditados mes a mes, sem TR. Se voce ja aderiu ao saque-aniversario, a multa real e
            maior que a exibida: a base legal inclui os depositos ja sacados.
          </span>
        </p>
      </div>

      <div className="space-y-4">
        <Resultado titulo="Projecao">
          <Linha rotulo="Deposito mensal (8%)" valor={brl(r.depositoMensal)} />
          <Linha rotulo="Total depositado no periodo" valor={brl(r.totalDepositado)} />
          <Linha rotulo="Rendimento" valor={brl(r.rendimento)} />
          <div className="border-t border-border pt-2">
            <Linha rotulo="Saldo projetado" valor={brl(r.saldoFinal)} destaque />
            {r.percentualMulta > 0 && (
              <Linha
                rotulo={`Multa rescisoria (${pct(r.percentualMulta, 0)})`}
                valor={brl(r.multa)}
                detalhe="Paga pelo empregador"
              />
            )}
            <Linha rotulo="Total a sacar" valor={brl(r.totalRescisao)} destaque />
          </div>
        </Resultado>

        {r.evolucao.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Mes a mes</CardTitle>
              <CardDescription>Ultimos 12 meses do periodo.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">Mes</th>
                    <th className="py-1.5 text-right font-medium">Deposito</th>
                    <th className="py-1.5 text-right font-medium">Juros</th>
                    <th className="py-1.5 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.evolucao.slice(-12).map((p) => (
                    <tr key={p.mes} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5">{p.mes}</td>
                      <td className="py-1.5 text-right tabular-nums">{brl(p.deposito)}</td>
                      <td className="py-1.5 text-right tabular-nums">{brl(p.juros)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{brl(p.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function CalculatorsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calculadoras</h1>
        <p className="text-muted-foreground">
          Juros compostos, 13o salario, ferias e FGTS. As contas rodam no seu navegador: nada do que
          voce digitar aqui e enviado ou gravado.
        </p>
      </div>

      <Tabs defaultValue="juros">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="juros" className="gap-1.5">
            <TrendingUp className="h-4 w-4" />
            Juros
          </TabsTrigger>
          <TabsTrigger value="decimo" className="gap-1.5">
            <Gift className="h-4 w-4" />
            13o
          </TabsTrigger>
          <TabsTrigger value="ferias" className="gap-1.5">
            <Palmtree className="h-4 w-4" />
            Ferias
          </TabsTrigger>
          <TabsTrigger value="fgts" className="gap-1.5">
            <Landmark className="h-4 w-4" />
            FGTS
          </TabsTrigger>
        </TabsList>

        <TabsContent value="juros" className="mt-6">
          <CalculadoraJuros />
        </TabsContent>
        <TabsContent value="decimo" className="mt-6">
          <CalculadoraDecimoTerceiro />
        </TabsContent>
        <TabsContent value="ferias" className="mt-6">
          <CalculadoraFerias />
        </TabsContent>
        <TabsContent value="fgts" className="mt-6">
          <CalculadoraFGTS />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Tabelas vigentes em {INSS_2026.vigencia}: INSS com teto de {brl(INSS_2026.teto)}, IRRF com
        deducao de {brl(IRRF_2026.deducaoPorDependente)} por dependente e desconto simplificado de{" "}
        {brl(IRRF_2026.descontoSimplificado)}, e a reducao da Lei 15.270/2025 para rendimentos de
        ate {brl(REDUTOR_IRRF_2026.limite)}. Os valores sao uma estimativa e podem diferir do
        contracheque por acordos coletivos, adicionais e outros descontos.
      </p>
    </div>
  );
}
