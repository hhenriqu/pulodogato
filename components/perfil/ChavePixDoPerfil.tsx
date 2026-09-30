"use client";

/**
 * O campo de chave Pix da tela de Perfil (HMO-201, parte 1).
 *
 * POR QUE TEM O PROPRIO BOTAO DE SALVAR
 * -------------------------------------
 * O resto da tela de Perfil grava em `profiles` com um unico Save no cabecalho.
 * A chave Pix nao mora em `profiles` -- mora em `user_pix_keys`, com policy
 * propria (ver migration 032). Pendurar a escrita dela no Save de cima
 * significaria que uma chave invalida derruba o salvamento do nome, do apelido
 * e da bio junto; e que apagar a chave (DELETE) precisaria caber num UPDATE de
 * outra tabela.
 *
 * Separado, cada um falha sozinho e diz o que falhou.
 *
 * A VALIDACAO ACONTECE ANTES DE GRAVAR, E O QUE VAI PARA O BANCO E A FORMA
 * CANONICA
 * ------------------------------------------------------------------------
 * `validarChavePix` devolve a chave ja normalizada. E ela que e gravada -- nao
 * o que foi digitado. O colega do grupo vai copiar exatamente esta string e
 * colar no aplicativo do banco dele; `(11) 98888-7777` nao e uma chave Pix,
 * `+5511988887777` e.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound, Save, Trash2 } from "lucide-react";
import {
  ROTULO_DA_CHAVE_PIX,
  TIPOS_DE_CHAVE_PIX,
  formatarChavePix,
  validarChavePix,
  type TipoDeChavePix,
} from "@/lib/chave-pix";

export function ChavePixDoPerfil({ userId }: { userId: string }) {
  const supabase = createClient();

  const [tipo, setTipo] = useState<TipoDeChavePix>("cpf");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  // A chave que esta GRAVADA hoje, para a previa e para saber se ha o que
  // apagar. Distinta de `valor`, que e o que esta sendo digitado agora.
  const [gravada, setGravada] = useState<{
    chave: string;
    tipo: TipoDeChavePix;
  } | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      const { data, error } = await supabase
        .from("user_pix_keys")
        .select("pix_key, pix_key_type")
        .eq("user_id", userId)
        .maybeSingle();

      if (!vivo) return;

      // `maybeSingle` devolve `data: null` sem erro quando nao ha chave -- que
      // e o estado normal de quem nunca cadastrou. So erro de verdade vira
      // aviso; senao a tela abriria reclamando com quem nao fez nada errado.
      if (error) {
        console.error("Erro ao ler a chave Pix:", error);
        toast.error("Não foi possível carregar sua chave Pix");
      } else if (data) {
        const t = data.pix_key_type as TipoDeChavePix;
        setGravada({ chave: data.pix_key, tipo: t });
        setTipo(t);
        setValor(data.pix_key);
      }

      setCarregando(false);
    })();

    return () => {
      vivo = false;
    };
  }, [supabase, userId]);

  const salvar = async () => {
    const resultado = validarChavePix(valor, tipo);

    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }

    setErro(null);
    setSalvando(true);

    // `upsert` por `user_id`: a tabela tem PK em user_id, entao cadastrar e
    // trocar a chave sao a mesma escrita. Sem isto, trocar a chave exigiria
    // saber se ja existe linha -- uma consulta a mais e uma corrida a mais.
    const { error } = await supabase.from("user_pix_keys").upsert(
      {
        user_id: userId,
        pix_key: resultado.chave,
        pix_key_type: resultado.tipo,
      },
      { onConflict: "user_id" }
    );

    setSalvando(false);

    if (error) {
      console.error("Erro ao salvar a chave Pix:", error);
      toast.error("Não foi possível salvar a chave Pix");
      return;
    }

    setGravada({ chave: resultado.chave, tipo: resultado.tipo });
    // O campo passa a mostrar a forma canonica: e ela que foi gravada, e
    // deixar o texto digitado na tela faria a pessoa achar que guardamos
    // `(11) 98888-7777`.
    setValor(resultado.chave);
    toast.success("Chave Pix salva. Seus grupos já podem copiá-la.");
  };

  const apagar = async () => {
    setSalvando(true);

    const { error } = await supabase
      .from("user_pix_keys")
      .delete()
      .eq("user_id", userId);

    setSalvando(false);

    if (error) {
      console.error("Erro ao apagar a chave Pix:", error);
      toast.error("Não foi possível remover a chave Pix");
      return;
    }

    setGravada(null);
    setValor("");
    setErro(null);
    toast.success("Chave Pix removida");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Chave Pix
        </CardTitle>
        <CardDescription>
          Quem divide um grupo de despesas com você vê esta chave e pode copiá-la
          para te pagar. Ninguém mais no aplicativo tem acesso a ela.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* `grid-cols-1` explicito: sem ele o grid vira uma linha so no
            celular e a tela ganha rolagem horizontal (HMO-184). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tipo_chave_pix">Tipo</Label>
            {/* `<select>` nativo, e nao o Select do Radix: o Radix nao
                renderiza o valor escolhido no servidor, o que torna esta tela
                impossivel de sondar sem navegador (HMO-186). */}
            <select
              id="tipo_chave_pix"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={tipo}
              disabled={carregando || salvando}
              onChange={(e) => {
                setTipo(e.target.value as TipoDeChavePix);
                // Trocar o tipo invalida o erro anterior: ele falava do tipo
                // antigo, e deixa-lo na tela acusa o texto novo de um defeito
                // que nao e dele.
                setErro(null);
              }}
            >
              {TIPOS_DE_CHAVE_PIX.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_DA_CHAVE_PIX[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="chave_pix">Chave</Label>
            <Input
              id="chave_pix"
              value={valor}
              disabled={carregando || salvando}
              onChange={(e) => {
                setValor(e.target.value);
                setErro(null);
              }}
              placeholder={
                tipo === "cpf"
                  ? "000.000.000-00"
                  : tipo === "cnpj"
                  ? "00.000.000/0000-00"
                  : tipo === "telefone"
                  ? "(11) 98888-7777"
                  : tipo === "email"
                  ? "voce@exemplo.com"
                  : "00000000-0000-0000-0000-000000000000"
              }
            />
            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>
        </div>

        {gravada && (
          <p className="text-sm text-muted-foreground">
            Chave atual:{" "}
            <span className="font-medium text-foreground">
              {formatarChavePix(gravada.chave, gravada.tipo)}
            </span>{" "}
            ({ROTULO_DA_CHAVE_PIX[gravada.tipo]})
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={salvar}
            disabled={carregando || salvando}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {salvando ? "Salvando..." : "Salvar chave Pix"}
          </Button>

          {gravada && (
            <Button
              variant="outline"
              onClick={apagar}
              disabled={salvando}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Remover
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
