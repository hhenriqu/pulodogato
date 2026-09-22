// GET  /api/receipts?transactionId=...   os comprovantes de um lancamento
// POST /api/receipts                     anexa um comprovante (multipart)
//
// O bucket `receipts` e PRIVADO (SECAO 11 do 009). Publico seria uma URL
// adivinhavel com a foto de um boleto: nome, CPF parcial, valor e codigo de
// barras. A leitura sai sempre por URL assinada, com validade curta, gerada
// aqui com o usuario ja autenticado.
//
// O caminho e sempre '<user_id>/<uuid>.<ext>' porque a policy do Storage decide
// o dono pela primeira pasta do nome. Trocar esse prefixo por qualquer outra
// coisa derruba o isolamento entre usuarios.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const BUCKET = "receipts";
/** Espelha o CHECK do 009: 10 MB. Foto de boleto pelo celular da 2-4 MB. */
const TAMANHO_MAXIMO = 10 * 1024 * 1024;
/** Espelha o CHECK do 009 e a allowed_mime_types do bucket. */
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** Quanto tempo a URL assinada vale. Curto: ela costuma ir parar no histórico. */
const VALIDADE_SEGUNDOS = 60 * 10;

const ALVOS = ["transaction_id", "scheduled_transaction_id", "settlement_id"] as const;

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const filtros: Array<[string, string]> = [];
    for (const alvo of ALVOS) {
      // aceita tanto ?transaction_id= quanto ?transactionId=
      const camel = alvo.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const valor = url.searchParams.get(alvo) ?? url.searchParams.get(camel);
      if (valor) filtros.push([alvo, valor]);
    }

    if (filtros.length !== 1) {
      return NextResponse.json(
        { error: "Informe exatamente um de transaction_id, scheduled_transaction_id ou settlement_id" },
        { status: 400 }
      );
    }

    const [coluna, valor] = filtros[0];
    const { data: comprovantes, error } = await supabase
      .from("receipts")
      .select("*")
      .eq(coluna, valor)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erro ao listar comprovantes:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os comprovantes" },
        { status: 500 }
      );
    }

    // Uma chamada so para todas as URLs assinadas, em vez de uma por arquivo.
    const caminhos = (comprovantes ?? []).map((c) => c.storage_path);
    const { data: assinadas } = caminhos.length
      ? await supabase.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_SEGUNDOS)
      : { data: [] };

    const urlPorCaminho = new Map(
      (assinadas ?? []).map((a) => [a.path, a.signedUrl])
    );

    return NextResponse.json({
      receipts: (comprovantes ?? []).map((c) => ({
        ...c,
        // null quando a assinatura falhou: a tela mostra o nome do arquivo sem
        // link, em vez de um link quebrado.
        url: urlPorCaminho.get(c.storage_path) ?? null,
      })),
    });
  } catch (error) {
    console.error("Erro na API de comprovantes:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const form = await request.formData();
    const arquivo = form.get("file");

    if (!(arquivo instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo" }, { status: 400 });
    }

    const alvos = ALVOS.map((a) => [a, form.get(a)] as const).filter(([, v]) => v);
    if (alvos.length !== 1) {
      return NextResponse.json(
        { error: "Informe exatamente um lançamento, conta prevista ou acerto" },
        { status: 400 }
      );
    }

    if (!TIPOS.includes(arquivo.type)) {
      return NextResponse.json(
        { error: "Aceito foto (JPG, PNG, WEBP, HEIC) ou PDF." },
        { status: 415 }
      );
    }

    if (arquivo.size === 0 || arquivo.size > TAMANHO_MAXIMO) {
      return NextResponse.json(
        { error: "O arquivo precisa ter até 10 MB." },
        { status: 413 }
      );
    }

    const [coluna, valor] = alvos[0];

    // O alvo tem que ser do proprio usuario -- ou, no acerto, de um grupo dele.
    // Sem esta checagem, um comprovante poderia ser pendurado no lancamento de
    // outra pessoa: a RLS de `receipts` so exige user_id = auth.uid(), que e o
    // dono do COMPROVANTE, nao o dono do lancamento.
    const tabela =
      coluna === "transaction_id"
        ? "financial_transactions"
        : coluna === "scheduled_transaction_id"
          ? "scheduled_transactions"
          : "group_settlements";

    const { data: alvo } = await supabase
      .from(tabela)
      .select("id")
      .eq("id", valor as string)
      .maybeSingle();

    if (!alvo) {
      return NextResponse.json(
        { error: "Não encontrei o lançamento para anexar o comprovante" },
        { status: 404 }
      );
    }

    // '<user_id>/<uuid>.<ext>' -- ver o cabecalho.
    const caminho = `${user.id}/${crypto.randomUUID()}.${EXTENSAO[arquivo.type]}`;

    const { error: erroUpload } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });

    if (erroUpload) {
      console.error("Erro ao subir comprovante:", erroUpload);
      const faltaBucket = /bucket/i.test(erroUpload.message ?? "");
      return NextResponse.json(
        {
          error: faltaBucket
            ? "O armazenamento de comprovantes ainda não foi criado no Supabase (seção 11 da migration 009)."
            : "Não foi possível enviar o arquivo",
        },
        { status: faltaBucket ? 503 : 500 }
      );
    }

    const { data: comprovante, error: erroLinha } = await supabase
      .from("receipts")
      .insert({
        user_id: user.id,
        [coluna]: valor,
        storage_path: caminho,
        file_name: arquivo.name.slice(0, 200) || `comprovante.${EXTENSAO[arquivo.type]}`,
        mime_type: arquivo.type,
        byte_size: arquivo.size,
      })
      .select()
      .single();

    if (erroLinha || !comprovante) {
      // Sem isto o arquivo fica no bucket sem nenhuma linha apontando para ele:
      // ocupa espaco para sempre e ninguem consegue ver nem apagar.
      console.error("Erro ao registrar comprovante, removendo o arquivo:", erroLinha);
      await supabase.storage.from(BUCKET).remove([caminho]);
      return NextResponse.json(
        { error: "Não foi possível registrar o comprovante" },
        { status: 500 }
      );
    }

    const { data: assinada } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(caminho, VALIDADE_SEGUNDOS);

    return NextResponse.json(
      { receipt: { ...comprovante, url: assinada?.signedUrl ?? null } },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro ao anexar comprovante:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
