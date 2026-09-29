"use client";

// -----------------------------------------------------------------------------
// A ABA DE MOEDA NAS CONFIGURACOES (HMO-171, parte 2)
// -----------------------------------------------------------------------------
// Duas escolhas, e a segunda depende da primeira:
//
//   moeda oficial   qual moeda e a "de casa". E o padrao de conta nova e o bloco
//                   que aparece primeiro quando um periodo tem varias moedas.
//   por lancamento  liga o seletor de moeda dentro do formulario de receita e
//                   despesa. A issue e explicita quanto a isso: a checkbox do
//                   lancamento "deve aparecer quando configurado para aparecer
//                   através das configuracoes".
//
// POR QUE O SEGUNDO CAMPO NASCE DESLIGADO
// ---------------------------------------
// Desligado, o app se comporta exatamente como antes desta issue. A maioria das
// pessoas nunca vai ter um lancamento em outra moeda, e nao deveria ganhar um
// campo no formulario que usa todo dia por causa de um recurso que nao usa.
//
// POR QUE TROCAR A MOEDA OFICIAL NAO MEXE EM NADA JA GRAVADO
// ---------------------------------------------------------
// Foi a decisao do Helio na issue ("ficam-brl"), e o texto da tela precisa dizer
// isso em voz alta. A expectativa natural de quem troca "a minha moeda" de real
// para dolar e que a tela passe a ler os valores em dolar -- e se fizessemos
// isso, um historico inteiro de reais seria reinterpretado como dolar na razao de
// 1 para 1, multiplicando o patrimonio da pessoa por cinco sem converter nada. A
// troca vale para o que vier depois; o que existe continua na moeda em que foi
// gravado.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Info, Save } from "lucide-react";
import {
  PREFERENCIA_DE_MOEDA_PADRAO,
  type PreferenciaDeMoeda,
  opcoesDeMoeda,
} from "@/lib/moeda";
import { formatarValor } from "@/lib/dinheiro";

export function ConfiguracaoDeMoeda() {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [preferencia, setPreferencia] = useState<PreferenciaDeMoeda>({
    ...PREFERENCIA_DE_MOEDA_PADRAO,
  });
  const [salva, setSalva] = useState<PreferenciaDeMoeda>({
    ...PREFERENCIA_DE_MOEDA_PADRAO,
  });

  const opcoes = opcoesDeMoeda();

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await fetch("/api/settings/currency");
        if (r.ok) {
          const d = await r.json();
          if (!ativo) return;
          // A rota ja normaliza. Guardar as duas copias (a editada e a gravada) e
          // o que permite o aviso de "não salvo" ser por CONTEUDO -- trocar a
          // moeda e trocar de volta tem que apagar o aviso, senao o botao fica
          // aceso pedindo para salvar o que ja esta gravado.
          setPreferencia(d.moeda);
          setSalva(d.moeda);
        }
      } catch (erro) {
        console.error("Erro ao carregar a preferência de moeda:", erro);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const haMudanca =
    preferencia.oficial !== salva.oficial ||
    preferencia.porLancamento !== salva.porLancamento;

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await fetch("/api/settings/currency", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Os DOIS campos, sempre. A rota recusa corpo sem `porLancamento` de
        // proposito: assumir `false` la desligaria o seletor de quem so quis
        // trocar a moeda oficial.
        body: JSON.stringify({
          oficial: preferencia.oficial,
          porLancamento: preferencia.porLancamento,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error ?? "Não foi possível salvar");
        return;
      }
      setPreferencia(d.moeda);
      setSalva(d.moeda);
      toast.success("Moeda atualizada");
    } catch {
      toast.error("Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Moeda</CardTitle>
        <CardDescription>
          A sua moeda principal e, se você quiser, a opção de escolher outra
          moeda em cada lançamento.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="moeda-oficial">Moeda principal</Label>
          <Select
            value={preferencia.oficial}
            onValueChange={(valor) =>
              setPreferencia((p) => ({ ...p, oficial: valor }))
            }
            disabled={carregando || salvando}
          >
            <SelectTrigger id="moeda-oficial">
              <SelectValue placeholder="Escolha a moeda" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((o) => (
                <SelectItem key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {/* O exemplo sai de `formatarValor`, a MESMA funcao que os valores da
                tela usam -- e nao de um texto escrito na mao. Iene e peso chileno
                nao tem centavos, e um exemplo fixo com duas casas prometeria uma
                subdivisao que a moeda escolhida nao possui. */}
            Os valores vão aparecer assim: {formatarValor(1000, preferencia.oficial)}
          </p>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Trocar a moeda principal <strong>não altera</strong> o que você já
            lançou. Os lançamentos existentes continuam na moeda em que foram
            registrados; a moeda nova vale para o que você criar a partir de
            agora.
          </AlertDescription>
        </Alert>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="moeda-por-lancamento" className="cursor-pointer">
              Escolher a moeda em cada lançamento
            </Label>
            <p className="text-sm text-muted-foreground">
              Liga uma opção de moeda no formulário de receita e despesa, e
              também nas contas. Use se você movimenta mais de uma moeda — nos
              períodos com moedas diferentes, os resultados aparecem separados
              por moeda.
            </p>
          </div>
          <Switch
            id="moeda-por-lancamento"
            checked={preferencia.porLancamento}
            onCheckedChange={(ligado) =>
              setPreferencia((p) => ({ ...p, porLancamento: ligado }))
            }
            disabled={carregando || salvando}
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {haMudanca && (
            <span className="text-sm text-muted-foreground">
              Alterações não salvas
            </span>
          )}
          <Button onClick={salvar} disabled={!haMudanca || salvando || carregando}>
            <Save className="h-4 w-4 mr-2" />
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
