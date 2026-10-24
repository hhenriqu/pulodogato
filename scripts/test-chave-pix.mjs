// Testes de lib/chave-pix.ts -- HMO-201, parte 1.
//
// O que estas assercoes protegem e uma coisa so: a chave que o colega do grupo
// copia tem que ser aceita pelo banco dele. Tudo aqui e uma forma de errar
// isso em silencio -- a tela mostra uma chave, o botao copia aquela chave, e o
// unico lugar onde o defeito aparece e o aplicativo bancario de outra pessoa.

import test from "node:test";
import assert from "node:assert/strict";

const {
  validarChavePix,
  cpfEhValido,
  cnpjEhValido,
  telefoneCanonico,
  emailCanonico,
  aleatoriaCanonica,
  formatarChavePix,
  chaveParaCopiar,
  tabelaDePixAusente,
  codigoPixCopiaECola,
  crcDoPix,
  CIDADE_DO_PIX,
  NOME_DO_PIX_SEM_NOME,
} = await import("../.tmp-chave-pix/chave-pix.js");

// ---------------------------------------------------------------------------
// CPF
// ---------------------------------------------------------------------------

test("CPF valido passa, com e sem pontuacao, e sai so com digitos", () => {
  // 529.982.247-25 e um CPF de digito verificador correto.
  assert.equal(cpfEhValido("529.982.247-25"), true);
  assert.equal(cpfEhValido("52998224725"), true);

  const r = validarChavePix("529.982.247-25", "cpf");
  assert.equal(r.ok, true);
  assert.equal(r.chave, "52998224725");
});

test("CPF com um digito trocado e recusado", () => {
  // O caso que importa: nao e lixo, e um CPF quase certo. Sem conferir o
  // digito, esta chave iria para o perfil e o colega pagaria um estranho.
  assert.equal(cpfEhValido("529.982.247-26"), false);
  const r = validarChavePix("529.982.247-26", "cpf");
  assert.equal(r.ok, false);
});

test("CPF de digitos repetidos e recusado mesmo fechando o modulo 11", () => {
  // 111.111.111-11 FECHA a conta do digito verificador. E o valor que alguem
  // digita para testar a tela, e sem a guarda explicita ele entra.
  assert.equal(cpfEhValido("11111111111"), false);
  assert.equal(cpfEhValido("00000000000"), false);
});

test("CPF com quantidade errada de digitos e recusado", () => {
  assert.equal(cpfEhValido("5299822472"), false);
  assert.equal(cpfEhValido("529982247251"), false);
});

// ---------------------------------------------------------------------------
// CNPJ
// ---------------------------------------------------------------------------

test("CNPJ valido passa e sai so com digitos", () => {
  assert.equal(cnpjEhValido("11.222.333/0001-81"), true);
  const r = validarChavePix("11.222.333/0001-81", "cnpj");
  assert.equal(r.ok, true);
  assert.equal(r.chave, "11222333000181");
});

test("CNPJ com digito trocado e recusado", () => {
  assert.equal(cnpjEhValido("11.222.333/0001-82"), false);
});

test("CNPJ de digitos repetidos e recusado", () => {
  assert.equal(cnpjEhValido("11111111111111"), false);
});

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------

test("telefone sai sempre em E.164, venha como vier", () => {
  // As tres formas que uma pessoa real digita, e um unico resultado.
  for (const entrada of [
    "(11) 98888-7777",
    "11988887777",
    "+55 11 98888-7777",
    "5511988887777",
  ]) {
    assert.equal(telefoneCanonico(entrada), "+5511988887777", entrada);
  }
});

test("fixo de 10 digitos e aceito", () => {
  assert.equal(telefoneCanonico("(11) 3333-4444"), "+551133334444");
});

test("fixo do DDD 55 sem DDI nao e confundido com DDI", () => {
  // 5533334444 tem 10 digitos: nunca e lido como tendo DDI, senao sobrariam
  // 8 digitos e o numero de Santa Maria seria recusado.
  assert.equal(telefoneCanonico("5533334444"), "+555533334444");
});

test("celular sem o 9 na frente e recusado", () => {
  // 11 digitos com o terceiro diferente de 9 nao e um celular brasileiro.
  assert.equal(telefoneCanonico("11888887777"), null);
});

test("DDD abaixo de 11 e recusado", () => {
  assert.equal(telefoneCanonico("(09) 98888-7777"), null);
  assert.equal(telefoneCanonico("1098888777"), null);
});

test("telefone curto ou longo demais e recusado", () => {
  assert.equal(telefoneCanonico("988887777"), null);
  assert.equal(telefoneCanonico("119888877771"), null);
});

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

test("email vai para minusculas e perde espaco em volta", () => {
  assert.equal(emailCanonico("  Helio@Example.COM "), "helio@example.com");
});

test("email sem dominio ou sem arroba e recusado", () => {
  assert.equal(emailCanonico("helio@example"), null);
  assert.equal(emailCanonico("helio.example.com"), null);
  assert.equal(emailCanonico("helio@ example.com"), null);
});

test("email acima de 77 caracteres e recusado", () => {
  // O teto e do arranjo Pix. Um email valido mas longo demais e aceito pelo
  // app e recusado pelo banco -- o defeito que so aparece na mao do colega.
  const longo = `${"a".repeat(70)}@example.com`;
  assert.ok(longo.length > 77);
  assert.equal(emailCanonico(longo), null);
});

// ---------------------------------------------------------------------------
// Chave aleatoria (EVP)
// ---------------------------------------------------------------------------

test("chave aleatoria aceita UUID e normaliza para minusculas", () => {
  assert.equal(
    aleatoriaCanonica("E7F4B1C2-3A5D-4E6F-8901-23456789ABCD"),
    "e7f4b1c2-3a5d-4e6f-8901-23456789abcd"
  );
});

test("chave aleatoria recusa o que nao e UUID", () => {
  assert.equal(aleatoriaCanonica("e7f4b1c2-3a5d-4e6f-8901-23456789abc"), null);
  assert.equal(aleatoriaCanonica("nao-e-uuid"), null);
});

// ---------------------------------------------------------------------------
// O tipo e escolhido, nao adivinhado
// ---------------------------------------------------------------------------

test("o mesmo texto da resultados diferentes conforme o tipo escolhido", () => {
  // 11988887777 e um telefone valido. Como CPF tem 11 digitos tambem, e o
  // digito verificador nao fecha -- entao ele e recusado em vez de virar,
  // calado, uma chave de CPF que nao existe.
  assert.equal(validarChavePix("11988887777", "telefone").ok, true);
  assert.equal(validarChavePix("11988887777", "cpf").ok, false);
});

test("chave em branco e recusada em todos os tipos", () => {
  for (const tipo of ["cpf", "cnpj", "email", "telefone", "aleatoria"]) {
    assert.equal(validarChavePix("   ", tipo).ok, false, tipo);
  }
});

test("todo erro traz uma frase para quem esta digitando", () => {
  const r = validarChavePix("abc", "cpf");
  assert.equal(r.ok, false);
  assert.ok(r.erro.length > 10, "a mensagem de erro nao pode ser vazia");
});

// ---------------------------------------------------------------------------
// O QUE SE VE x O QUE SE COPIA
// ---------------------------------------------------------------------------

test("a formatacao e so para o olho e nunca e o que se copia", () => {
  // Esta e a assercao que impede o defeito mais provavel desta feature: a tela
  // mostra `529.982.247-25`, o botao copia `529.982.247-25`, e o banco do
  // colega diz que a chave nao existe.
  const canonica = "52998224725";
  assert.equal(formatarChavePix(canonica, "cpf"), "529.982.247-25");
  assert.equal(chaveParaCopiar(canonica), "52998224725");
  assert.notEqual(
    formatarChavePix(canonica, "cpf"),
    chaveParaCopiar(canonica),
    "se estes dois forem iguais, alguem trocou a chave copiada pela formatada"
  );
});

test("telefone e formatado com DDD e traco, e copiado em E.164", () => {
  assert.equal(formatarChavePix("+5511988887777", "telefone"), "(11) 98888-7777");
  assert.equal(formatarChavePix("+551133334444", "telefone"), "(11) 3333-4444");
  assert.equal(chaveParaCopiar("+5511988887777"), "+5511988887777");
});

test("email e chave aleatoria aparecem como estao", () => {
  assert.equal(
    formatarChavePix("helio@example.com", "email"),
    "helio@example.com"
  );
  const uuid = "e7f4b1c2-3a5d-4e6f-8901-23456789abcd";
  assert.equal(formatarChavePix(uuid, "aleatoria"), uuid);
});

test("formatar nao estraga valor de tamanho inesperado", () => {
  // Uma linha gravada antes desta validacao existir, ou por outro caminho.
  // Formatar tem que devolver o texto intacto em vez de recortar pedacos.
  assert.equal(formatarChavePix("123", "cpf"), "123");
  assert.equal(formatarChavePix("123", "telefone"), "123");
});

// ---------------------------------------------------------------------------
// A JANELA EM QUE O CODIGO JA SUBIU E A MIGRATION AINDA NAO
// ---------------------------------------------------------------------------
// Producao nao tem runner de migration: o deploy publica codigo, nao schema.
// Entre o merge e o momento em que alguem cola a 032 no SQL Editor, o app novo
// conversa com o banco velho. Tratar isso como falha poria um toast vermelho
// na tela de Perfil de todo mundo, por uma feature que ninguem pediu ainda.

test("tabela ausente e reconhecida pelos dois codigos que a anunciam", () => {
  // 42P01 e o SQLSTATE do Postgres; PGRST205 e o que o PostgREST devolve
  // quando a tabela nao esta no schema cache dele. Os dois aparecem neste
  // caminho e significam a mesma coisa.
  assert.equal(tabelaDePixAusente({ code: "42P01" }), true);
  assert.equal(tabelaDePixAusente({ code: "PGRST205" }), true);
});

test("erro de verdade NAO e confundido com tabela ausente", () => {
  // O contrapeso: se esta funcao respondesse `true` para qualquer coisa, ela
  // engoliria uma falha de RLS ou de rede e a tela ficaria eternamente
  // dizendo "voce nao cadastrou chave" para quem cadastrou.
  assert.equal(tabelaDePixAusente({ code: "42501" }), false);
  assert.equal(tabelaDePixAusente({ code: "PGRST116" }), false);
  assert.equal(tabelaDePixAusente({ message: "Failed to fetch" }), false);
});

test("entrada estranha nao quebra a checagem", () => {
  for (const v of [null, undefined, "42P01", 42, {}]) {
    assert.equal(tabelaDePixAusente(v), false, String(v));
  }
});

// ---------------------------------------------------------------------------
// O PIX COPIA E COLA DO ACERTO
// ---------------------------------------------------------------------------
// O codigo vai para o app do banco de OUTRA pessoa. Um campo com o tamanho
// errado ou um CRC errado e um codigo que o banco recusa -- e a tela do Pulo do
// Gato nao tem como saber. Por isso o primeiro caso e o exemplo do proprio
// manual do BR Code do Banco Central, byte a byte.

const EXEMPLO_DO_BANCO_CENTRAL =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000" +
  "5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

test("o codigo sem valor e o exemplo do manual do BR Code, byte a byte", () => {
  assert.equal(
    codigoPixCopiaECola({
      chave: "123e4567-e12b-12d1-a456-426655440000",
      nome: "Fulano de Tal",
      cidade: "BRASILIA",
    }),
    EXEMPLO_DO_BANCO_CENTRAL
  );
  // O CRC e o CRC16/CCITT-FALSE: o valor de conferencia do algoritmo.
  assert.equal(crcDoPix("123456789"), "29B1");
});

test("o valor entra no campo 54 e o CRC continua batendo", () => {
  const codigo = codigoPixCopiaECola({
    chave: "52998224725",
    valor: 250,
    nome: "Helio",
  });
  assert.ok(codigo.includes("5406250.00"), codigo);
  // A chave CRUA, como o banco aceita -- nunca a formatada da tela.
  assert.ok(codigo.includes("011152998224725"), codigo);
  assert.ok(codigo.includes(`60${String(CIDADE_DO_PIX.length).padStart(2, "0")}${CIDADE_DO_PIX}`));
  const semCrc = codigo.slice(0, -4);
  assert.ok(semCrc.endsWith("6304"));
  assert.equal(codigo.slice(-4), crcDoPix(semCrc));
  // Centavos: 78,39 sai com ponto e duas casas.
  assert.ok(
    codigoPixCopiaECola({ chave: "52998224725", valor: 78.39 }).includes("540578.39")
  );
});

test("nome com acento e emoji vira ASCII; sem nome vai o rotulo do padrao", () => {
  const codigo = codigoPixCopiaECola({ chave: "a@b.co", valor: 10, nome: "Letícia 🌸" });
  assert.ok(codigo.includes("5907Leticia"), codigo);
  const longo = codigoPixCopiaECola({ chave: "a@b.co", nome: "Maria Aparecida dos Santos Oliveira" });
  assert.ok(longo.includes("5925Maria Aparecida dos Sant"), longo);
  const semNome = codigoPixCopiaECola({ chave: "a@b.co", nome: "  " });
  assert.ok(
    semNome.includes(`59${String(NOME_DO_PIX_SEM_NOME.length).padStart(2, "0")}${NOME_DO_PIX_SEM_NOME}`)
  );
});

test("sem chave nao ha codigo; valor zero ou invalido sai sem o campo 54", () => {
  assert.equal(codigoPixCopiaECola({ chave: "", valor: 10 }), null);
  assert.equal(codigoPixCopiaECola({ chave: "   ", valor: 10 }), null);
  for (const valor of [0, -5, Number.NaN, null, undefined]) {
    const codigo = codigoPixCopiaECola({ chave: "a@b.co", valor });
    // O 54 fica entre o 53 e o 58: sem ele, o 58 vem colado no 53.
    assert.ok(codigo.includes("53039865802BR"), String(valor));
  }
});
