# As notas dos steps do `verificacao.yml`

A prosa deste arquivo morava dentro do `.github/workflows/verificacao.yml`, e
saiu de la por um motivo medido, nao por estilo: **o GitHub nao da partida num
workflow de mais de 512.000 bytes.** Nao reprova um step, nao abre job nenhum --
devolve `jobs: 0` e um vermelho sem log nenhum para ler.

O arquivo passou dos 512.000 em 2026-10-20 (commit `def4b80`, 514.256 bytes) e
chegou a 529.779. Dai em diante NENHUMA das 163 assercoes e NENHUM dos 98
controles negativos deste workflow rodou: os 40 runs seguintes da `main` saem
com `jobs=0`, e a ultima execucao de verdade foi 2026-10-10. Isto e a HMO-473,
medida pela HMO-491.

Dos 529.779 bytes, 349.292 eram comentario -- 66% do arquivo. O que saiu daqui
foram os 231.702 bytes de comentario YAML que ficavam **entre** os steps. Os
comentarios de **dentro** dos `run: |` continuam no YAML, e de proposito:
alguns sao ancora de `sed` de controle negativo, e mover um deles mataria o
mutante calado (a classe que a HMO-231 fechou).

## A regra, para quem escrever o proximo step

A nota do step novo entra AQUI. No YAML vai uma linha so, com o nome exato do
step:

    # nota: verificacao-notas.md -> "<o nome do step>"

O `scripts/check-tamanho-dos-workflows.mjs` reprova o PR que faz qualquer
workflow passar do teto, e roda no `build.yml` -- que nao tem filtro de
`paths` e e o unico workflow deste repositorio que sempre da partida.

## Sobre os steps que foram unificados

Quatro comandos estavam invocados em mais de um step (`test:tela-do-cartao` em
quatro, `test:campos-lancamento` em tres, `test:recorrencia-edicao` e
`test:pwa-precache` em dois). A segunda invocacao do mesmo `npm run` nao
afirma nada que a primeira nao tenha afirmado -- a suite roda inteira toda vez
-- e em `test:tela-do-cartao` ela REPROVAVA: o terceiro estagio do comando,
`resolve-next-subpaths`, encontra a arvore ja resolvida pela primeira passagem
e sai 1 de proposito, dizendo que o passo virou no-op. Como os steps rodam em
serie e param no primeiro vermelho, essa repeticao derrubava o job no step 35
de 295 -- ou seja, mesmo com o arquivo abaixo do teto, 260 steps continuariam
sem rodar.

Ficou a primeira ocorrencia de cada um. As notas das outras estao preservadas
aqui, na secao do step que ficou, cada uma dizendo de qual step ela veio.

<!-- As notas comecam abaixo. Cada secao e um step, e a prosa vai dentro de uma
     cerca ~~~~~~, palavra por palavra como estava no YAML. -->

## Compilar a saida de todas as suites de uma vez, num processo so

~~~~~~
A COMPILACAO DAS SUITES, UMA VEZ SO (HMO-263).

Os alvos test:* disparavam uma invocacao de tsc por suite -- 98 hoje,
209s medidos. O custo era a partida do compilador e o reparse dos
MESMOS arquivos de lib/: 573 arquivos distintos lidos 18.368 vezes.

Aqui os 98 saem de um processo unico que reaproveita o AST ja parseado:
~28s. Cada alvo continua sendo seu proprio programa, com o seu tsconfig
e o seu outDir -- nao ha uniao de include, porque varios tsconfig sao
estreitos de proposito (provam que um modulo compila SEM um import).
A saida foi comparada byte a byte com a dos 98 tsc separados: 98
diretorios, 470 arquivos, zero diferencas.

Depois daqui, cada `npm run test:*` encontra a saida dele pronta e so
roda as assercoes. O reaproveitamento e por sha256 das ENTRADAS, entao
um mutante de controle negativo muda o hash e FORCA recompilacao: ele
nao pode morrer verde sobre o artefato de antes.

O que este passo NAO acelera: os blocos de controle negativo. Eles
rodam a suite numa COPIA da arvore, uma vez por mutante -- um alvo, um
processo, nada a compartilhar. La o alvo e delegado ao tsc, para ficar
exatamente na velocidade de antes em vez de pagar travessia sem lote.
~~~~~~

## O reaproveitamento da compilacao decide por conteudo, nao por data

~~~~~~
A decisao "esta saida ainda vale?" e o que o lote acima introduziu, e
errar para o lado do "vale" faria um controle negativo ficar verde
sobre o artefato de antes -- o rotulo dizendo que o mutante morreu sem
ele ter sido compilado. Esta suite fixa que a decisao e por sha256 do
CONTEUDO: mutar recompila, restaurar recompila, e mexer so na data do
arquivo NAO recompila (uma implementacao por mtime devolveria os 285s).
~~~~~~

## Fotografar a arvore antes dos controles negativos

~~~~~~
A FOTOGRAFIA DA ARVORE, para os passos-guarda dos controles negativos.

O guarda compara com ESTA foto, e nao com `git diff --quiet`, por dois
motivos: um `npm ci` pode legitimamente tocar arquivo rastreado, e
comparar com a foto deixa a sequencia reproduzivel na maquina de quem
desenvolve, onde a arvore quase nunca esta limpa.
~~~~~~

## Tabelas citadas pelo codigo existem nas migrations

~~~~~~
=======================================================================
CODIGO NAO CITA TABELA FORA DO SCHEMA
origem: code-schema-drift.yml (job `drift`)
=======================================================================
Prova, a cada mudanca no codigo, que toda tabela consultada pela aplicacao
existe no schema versionado.

Vive separado do db-verify de proposito, por duas razoes:

  1. O db-verify e filtrado por `paths: ['database/**', ...]`. A deriva que a
     HMO-124 encontrou nasce do lado do CODIGO -- uma rota nova que cita uma
     tabela que ninguem criou nao toca em database/ nenhuma vez, e passaria
     por baixo daquele filtro. Este job nao tem filtro de path.

  2. Nao precisa de Postgres. Roda em segundos, entao pode ser obrigatorio em
     todo PR sem virar pedagio.

O modo de falha que ele cobre e o silencioso: o cliente do Supabase aceita
qualquer string em `.from()`, o `tsc` e o `next build` passam, e o erro so
aparece em producao como PGRST205 dentro de um catch que devolve 500 --
tela vazia para o usuario, CI verde para nos.
~~~~~~

## Colunas pedidas pelo codigo existem nas relacoes

~~~~~~
A mesma deriva um nivel abaixo, e a que escapou por meses: o nome da
TABELA certo e o da COLUNA inventado. `GET /api/anomalies` respondia 500
em producao para todo usuario porque lia `transaction_categories.user_id`,
coluna que nunca existiu, e o passo acima nao tinha como ver -- a tabela
existe. Le o schema de database/schema-columns.json; o db-verify prova que
aquele arquivo continua igual ao banco que as migrations constroem.
~~~~~~

## Toda migration e exercitada pelo db-verify

~~~~~~
Mora aqui, e nao no db-verify, pela mesma razao do passo acima: o
db-verify e filtrado por `paths` e este job nao. Uma migration nova
TOCA em database/, entao o filtro nao e o problema -- o problema e que
quem esquece o step do db-verify recebe o job VERDE, porque o arquivo
esquecido e justamente o que nao roda. A verificacao precisa vir de um
job que nao dependa do db-verify ter sido atualizado (HMO-145).
~~~~~~

## Toda suite de teste roda em algum workflow

~~~~~~
Mesma familia do passo acima, e pela mesma razao. O
test:recurrence-detector entrou na main pelo PR #20 e ficou dias sem
rodar em workflow nenhum: o script existia, nada o chamava, e os jobs
continuavam verdes. Uma suite que ninguem executa da sensacao de
cobertura enquanto a regressao passa.
~~~~~~

## Todo runner de mutante roda em algum workflow, ou esta declarado

~~~~~~
A MESMA familia, um nivel acima, e o numero era pior: 62 runners
`scripts/mutantes-*` na arvore, 19 invocados por algum step, 43 que
nenhum job executava (HMO-322). Entre os 43 estava o
`mutantes-crivos.mjs`, com alvo proprio no package.json -- apagado na
HMO-332, junto com o alvo, porque ninguem defendeu a afirmacao que ele
media. O `test:crivos` logo abaixo, que e a afirmacao, ficou.

Runner de mutante e o aparelho que prova que uma suite MEDE o que diz
medir. Um que ninguem roda nao prova nada e nao da sintoma -- o arquivo
esta la, com o nome certo, e ler a arvore sugere que a afirmacao tem
controle negativo. O `check-tests-in-ci` ao lado existe desde a HMO-145
e nunca cobriu os `mutantes-*`; por isso 43 puderam acumular calados.

Isto NAO liga os 43: cada job custa a partida mais o arredondamento para
o minuto cheio, e a franquia e de 2.000 min/mes (HMO-261). O que a
verificacao exige e que "fora do CI" seja uma DECLARACAO com motivo
escrito, e nao um acidente. O `nao-triado` tem teto, e o teto so desce.
~~~~~~

## A verificacao dos runners de mutante sabe falhar

~~~~~~
Controle negativo da guarda acima, e ela precisa de um por ser TEXTUAL:
os workflows citam runners dentro de comentarios ("A prova de mutacao
completa e `npm run mutantes:retorno-lancamento`"), e uma versao que
lesse comentario absolveria cinco runners sem step nenhum -- o buraco da
HMO-322 reaberto por dentro da propria guarda. Esse e o terceiro mutante.

Roda inteiro numa COPIA em /tmp: a guarda nao tem dependencia externa,
entao nao ha motivo para mutar a arvore de producao e correr o risco de
deixar o mutante gravado quando o processo morre em SIGTERM.
~~~~~~

## Nenhum runner de mutante novo muta a arvore no lugar

~~~~~~
Nenhum runner NOVO muta no lugar um arquivo rastreado (HMO-327).

Um runner que muta a fonte, roda a suite e restaura no fim deixa o
mutante GRAVADO quando morre no meio, e dali em diante toda medicao le o
arquivo errado sem nada no placar dizendo isso. Aconteceu tres vezes
neste repositorio -- duas no mesmo run da HMO-322, a segunda por um
runner ORFAO que seguia em laco e fazia `git status` piscar.

Os sete runners que fazem isso hoje estao declarados como divida
(HMO-337, a migracao para o bloco em /tmp); a lista so pode encolher, e a
guarda reprova se uma entrada dela deixar de corresponder a um runner.

NAO e "instale um handler de SIGTERM": esta medido que num runner de laco
sincrono o handler nunca roda (o event loop nao recebe o controle) e
ainda ENGOLE o sinal, deixando o runner vivo e mutando. O cabecalho da
guarda traz a medicao.
~~~~~~

## A guarda de mutacao no lugar sabe falhar

~~~~~~
Controle negativo da guarda acima -- textual, entao precisa de um. O
mutante que mais importa e o do comentario: os runners FALAM do idioma
proibido em prosa ("este script MUTA OS ARQUIVOS NO DISCO"), e uma versao
que lesse comentario acusaria runner seguro. Roda inteiro numa copia em
/tmp, com repo git de mentira, pela razao que a propria guarda defende.
~~~~~~

## Nenhuma ancora de mutante parou de casar

~~~~~~
Nenhuma ancora de mutante parou de casar (HMO-262).

Um mutante muta por texto literal (`de` -> `para`). Quando a feature
RENOMEIA o trecho, o `de` casa com nada: o mutante nao aplica, a suite
roda sobre o codigo CORRETO e passa, e a guarda que aquele mutante existia
para vigiar fica sem controle negativo nenhum. Foi o que aconteceu com
`parcelamento_volta_para_toda_despesa` -- a HMO-254 trocou `ehNoCartao`
por `natureza === "card"` em lib/lancamento.ts e deixou o `de` para tras.

Isto ja era MEDIDO e nao reprovava: o medidor imprimia "ancora MORTA" e
saia zero, e ninguem o invocava. Agora reprova os tres estados em que uma
ancora deixa de medir (0 ocorrencias, >1, arquivo ausente) e roda tambem
no `npm run pre-commit`, que e onde o rename e FEITO -- nao meses depois.

COBERTURA PARCIAL, de proposito: ele le as familias de forma conhecida
(painel e tupla), 292 mutantes em 14 runners. Os demais tem forma propria
e entram conforme a conversao para bloco avanca; a guarda ABORTA se uma
familia inteira sair da varredura, entao encolher nao passa calado.
~~~~~~

## A guarda de ancora de mutante sabe reprovar

~~~~~~
Controle negativo da guarda acima. Ela le runners por predicado de FORMA,
e um predicado que para de casar faz a varredura medir o conjunto vazio e
imprimir um boletim limpo. Cada estado que ela recusa tem aqui um caso, e
o controle positivo (arvore intacta sai 0) e o que pega o "vermelho pelo
motivo errado". Inclui o caso 6, que trava uma regressao ja medida: o
driver do conversor disparava por "tem argumento" em vez de "eu sou o
programa", e passar um runner para a guarda fazia o conversor REESCREVER
esse runner em disco, sem medir nada.
~~~~~~

## Nenhuma ancora de `sed` dos workflows parou de casar

~~~~~~
A MESMA PERGUNTA, PARA AS ANCORAS QUE VIVEM NESTE ARQUIVO (HMO-231).
As duas guardas acima leem os runners `.mjs`; nenhuma delas olha os 148
`sed -i` dos workflows, e e la que a ancora podre custou mais caro.

O mecanismo: `sed -i` cujo padrao nao casa SAI 0 e nao muda nada. A suite
seguinte roda a fonte INTACTA, passa -- corretamente -- e o `if` do
controle negativo le esse verde como "a suite nao pegou o defeito". A
HMO-199 contou 57 runs vermelhos seguidos assim, na main inclusive, e
NOVE issues abertas em 24h (HMO-205, 212, 213, 214, 217, 222, 223, 229,
230) -- nenhuma pegou a causa, porque o vermelho acusa a suite e o
defeito mora num `sed` dentro de um YAML.

Isto reprova no PR que quebra a ancora. E o que importa: a ancora
apodrece na refatoracao BEM FEITA -- quem dedenta uma linha ou troca um
padding por variavel de safe-area nao tem motivo nenhum para procurar um
`sed` aqui dentro. Foi assim que a HMO-185 matou a ancora do
`menu-mobile`, e o PR #136 consertou UM caso.
~~~~~~

## A guarda de `sed` dos workflows sabe reprovar

~~~~~~
Controle negativo da guarda acima, e ele tem DUAS metades. Exigir que a
guarda reprove nao basta: o caso 13 prova que o mesmo padrao quebrado,
SEM a guarda, volta a mentir (`sed` sai 0, nao muda um byte). Sem essa
metade o controle provaria so que a mensagem nova existe -- e foi assim
que o PR #136 provou que a guarda e quem trabalha.

Os casos 4 e 5 travam os dois erros de dialeto que a varredura da HMO-199
cometeu: o padrao e REGEX (um `includes()` literal da falso negativo em
`--success: [0-9.]* [0-9.]*%`) e e BRE, nao ERE (em ERE o `(` de
`Boolean(categoria)` viraria grupo e a guarda mediria outro padrao).

Roda inteiro em `mkdtempSync`: nao escreve na arvore, e por isso nao tem
`trap` nem nada para restaurar.
~~~~~~

## Os mutantes da guarda de `sed` dos workflows

~~~~~~
E OS MUTANTES DELA. O passo acima prova que a guarda SABE reprovar; este
prova que cada decisao dela esta MEDIDA por algum caso -- perguntas
diferentes, e a segunda e a que apodrece, porque um refator que troque o
dialeto deixa os 74 casos verdes se nenhum deles depender daquela linha.
Ele planta o defeito no FONTE da guarda e exige vermelho no controle.

Achou tres lacunas reais ao ser escrito: o `-E` era conferido no recorte
mas nunca na MEDICAO; a trava que fecha a janela da prova no `sed` de
baixo nao tinha caso alheio (o consumo fechava antes, e o fixture passava
igual sem ela); e o `exit` do conjunto vazio morava em `principal()`, que
nenhum caso chamava. Os tres ganharam caso -- 14/14 mortos.

Roda numa copia do repositorio em `mkdtempSync`, nunca na arvore, que e a
regra que o `check-mutacao-no-lugar.mjs` cobra dos runners novos. 14s,
num job que ja existe.
~~~~~~

## A causa de verdade sai na linha do ABORTADO

~~~~~~
A LINHA QUE OS 45 RUNNERS IMPRIMEM QUANDO O PLACAR NAO VALE (HMO-405).

`resumoDaReprovacao`, em `scripts/mutantes-em-bloco.mjs`, e o texto do
`ABORTADO` do preflight -- o unico sintoma disponivel no momento em que o
controle positivo reprova e alguem precisa descobrir por que. Ate a
HMO-405 ela devolvia so os NOMES dos casos, que e exatamente a parte que
mente quando a suite quebra por motivo estrutural: a sonda de navegador
sem Chromium abortava com "o navegador rodou e reportou as duas paginas",
que se le como defeito do app, enquanto `Aponte CHROMIUM_BIN para um
binario` era descartado. Custou o diagnostico errado duas vezes na
HMO-375, numa issue sobre guarda vermelha -- onde a mensagem passa por
confirmacao do defeito investigado.

Os fixtures sao saida literal do `node --test`, nao string montada a mao:
a forma `AssertionError [ERR_ASSERTION]:` e as 47 falhas com 34 textos
distintos (que `formaDaCausa` colapsa em 2 familias) vieram de corrida de
verdade. Texto puro, nao compila nada e nao abre navegador.
~~~~~~

## Os mutantes da causa na linha do ABORTADO

~~~~~~
Controle da suite acima pelo mecanismo que ela protege: o defeito e
plantado NO FONTE do motor de bloco e cada mutante tem de morrer. Achou
duas coisas reais ao ser escrito -- um `.filter` que nunca disparava (saiu
do motor) e o fato de que `formaDaCausa` nao estava medida, porque no
fixture a causa do Chromium e a primeira da saida e as vagas sairiam
certas sem colapso nenhum. 9/9 mortos.
~~~~~~

## O conferidor da conversao de mutantes sabe falhar

~~~~~~
E o conferidor da CONVERSAO de runner para bloco, que e o que garante que
converter um runner nao perdeu nenhuma entrada da lista de mutantes -- a
unica parte de um runner que carrega conhecimento que nao esta escrito em
nenhum outro lugar do repositorio.

Ele precisa de controle proprio porque JA PASSOU VACUO: a primeira versao
do conversor (HMO-318) apagou os 14 mutantes de um runner e o conferidor
imprimiu `miolo identico (40 bytes)`, porque comparava duas extracoes
igualmente truncadas. O cenario que reproduz esse furo MUTA O CONVERSOR,
e nao o texto convertido -- e o defeito morava no extrator.

Barato o bastante para rodar sem filtro de path: e texto, nao compila nada
e nao abre navegador. O fixture dele e sintetico, entao nao le a arvore.
~~~~~~

## O conferidor da conversao de mutantes sabe falhar (familia tupla)

~~~~~~
O MESMO CONTROLE, PARA A SEGUNDA FAMILIA (HMO-334). Nao e duplicacao: o
passo acima mede o conferidor pela familia DO PAINEL, cujas listas sao de
objetos, e `conferir` escolhe as contagens pela familia do arquivo de
ANTES -- entao aquele fixture nunca passa pelas travas da familia tupla,
que sao outras funcoes porque a lista tem outra forma.

Este tambem e o unico lugar que cobra a EXCLUSIVIDADE dos tres predicados
de familia, varrendo os runners de verdade. A HMO-328 mediu o custo de
errar isso: reconhecer a tupla so por `const mutantes = [` fez o conversor
aceitar um runner da outra familia e produzir um arquivo que nem carregava.

Barato pela mesma razao: e texto. Os dois fixtures sao sinteticos.
~~~~~~

## Nenhum modulo de interface fica sem importador

~~~~~~
Mora aqui pela mesma razao dos passos acima: e deriva do lado do CODIGO,
nao toca em database/, e o sintoma e a AUSENCIA de sintoma. Um modulo de
interface sem importador compila, passa no tsc, passa no next build e
nao cresce o bundle -- o empacotador nunca chega nele. O custo aparece
quando alguem abre o arquivo de nome mais obvio para "evoluir a tela" e
edita codigo que usuario nenhum ve (HMO-163: 2555 linhas assim, e o
arquivo mais convidativo era um dos mortos).
~~~~~~

## Rota nao le query com nome de segmento dinamico

~~~~~~
Mesma familia: deriva do lado do CODIGO, invisivel para tsc e para o
next build, e o sintoma so existe em producao. Numa rota sob `[id]`, o
Next usa a query string para carregar o segmento e consome a chave de
mesmo nome ao montar `params` -- entao `searchParams.get("id")` volta
null com o parametro chegando inteiro na URL. Desfazer aporte
(DELETE /api/goals/[id]/contributions) ficou 100% quebrado assim, com a
tela acusando o usuario de nao informar o que ele informou (HMO-142).
~~~~~~

## Embed do PostgREST qualifica a FK quando ha mais de uma

~~~~~~
Mora aqui porque e deriva de CODIGO contra SCHEMA, e porque o gatilho
dela nao e uma mudanca no codigo -- e uma migration que altera o
significado de codigo que ninguem tocou. Quando a 038 ganhou a segunda
FK de `recurring_rules` para `financial_accounts`, o embed curto
`account:financial_accounts(...)` deixou de ter resposta unica e TRES
rotas intactas passaram a responder 500 com PGRST201 em producao -- a
tela de gastos fixos nao listava nada, e o POST da conta prevista e o
PATCH da baixa gravavam a linha antes de falhar no select do retorno.
tsc, next build e teste puro passam todos verdes nesse estado (HMO-236).
~~~~~~

## Nenhuma tela usa o campo de data nativo

~~~~~~
Mora aqui, e nao num workflow proprio, porque e guard textual sem filtro
de `paths` -- o campo que ele pega nasce numa TELA NOVA, que por
definicao nao esta em nenhuma lista de caminhos escrita hoje.

O que ele guarda: o controle de data nativo le os tres segmentos na
ordem do APARELHO, e essa ordem nao se forca pelo codigo. Quem digitou
10 de marco grava 3 de outubro -- data valida, plausivel, sem erro
nenhum no caminho (medido em Chromium na HMO-238). Num app de dinheiro
esse e o pior dos tres modos de errar do controle nativo, porque e o
unico que nada denuncia.
~~~~~~

## A verificacao do campo de data sabe falhar, e sabe nao falhar

~~~~~~
Controle negativo. As duas peneiras do guard acima sao busca textual, e
busca textual sai VERDE quando para de achar o que deveria conferir.

A segunda peneira (a contagem exata de chamadas) existe exatamente por
isso: a primeira, sozinha, aprova a tela em que o campo foi APAGADO. Os
dois defeitos sao plantados, e os dois tem que ficar vermelhos.

Esta sonda so morde com folga ZERO entre a contagem esperada e a arvore
-- com folga de N, N campos somem com o guard verde. Foi o que aconteceu
entre a HMO-240 e a HMO-242 (ver o comentario de CHAMADAS_ESPERADAS).
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao do campo de data sabe falhar, e sabe nao falhar"'

~~~~~~
Controles negativos. Uma verificacao que nunca viu vermelho nao e
verificacao: se a regex quebrar numa refatoracao, o passo acima passa a
sair verde por nao achar NADA, que e indistinguivel de estar tudo certo.
Aqui plantamos as duas formas de deriva e exigimos vermelho nas duas.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao sabe falhar (code-schema-drift)"'

~~~~~~
Mesmo tratamento para a deriva de COLUNA, e aqui o controle POSITIVO
importa tanto quanto o negativo: um guard de coluna que reprova coluna
valida seria desligado na primeira semana, e a primeira versao deste
mesmo script fazia isso -- a cadeia de `.from()` vazava pela virgula de
um `Promise.all([...])` e ele acusou nove colunas que o codigo nunca
pediu daquelas relacoes.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao de coluna sabe falhar, e sabe nao falhar"'

~~~~~~
O mesmo tratamento para a verificacao de suite fora do CI: ela tambem
sai verde por nao achar nada se a leitura do package.json quebrar.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao de teste fora do CI sabe falhar"'

~~~~~~
E o mesmo para o codigo morto. Aqui o controle da varredura CEGA e o que
mais importa: se a regex do `from` quebrar, ela le quase nenhum import,
conclui que nada esta morto e sai VERDE -- indistinguivel de uma arvore
limpa. O script tem um piso de especificadores lidos justamente por
isso, e a sonda 4 prova que o piso morde.
~~~~~~

## A verificacao de dois alvos no mesmo diretorio de saida sabe falhar

~~~~~~
A TERCEIRA peneira do mesmo arquivo, que a HMO-376 acrescentou, e ela
precisa de controle proprio: o controle acima planta uma suite que
nenhum workflow roda, o que reprova na PRIMEIRA peneira e sai antes de
esta terceira ser avaliada. Sem o passo abaixo, a colisao de outDir
ficaria sem medicao nenhuma.

O defeito que ela existe para pegar (HMO-365, PR #268): dois alvos
`test:*` emitindo para o mesmo outDir. O `npm run compila-suites` recusa
isso -- e o step 6 do db-verify, ANTES de qualquer SQL -- mas aquele job
tem filtro de `paths:` que nao cita todo `scripts/tsconfig.*`, entao o PR
passou verde e a main ficou vermelha depois do merge, sem migration,
suite de banco nem runner de mutante rodando por varios dias.

A colisao e plantada em alvos que JA EXISTEM, e nao por um `test:` novo:
um nome novo reprovaria na primeira peneira e o controle mediria o
criterio errado, verde por motivo nenhum. Por isso tambem a saida e
conferida pelo TEXTO -- "sai 1" nao distingue qual peneira reprovou.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao de codigo morto sabe falhar"'

~~~~~~
Controle do guard de colisao query x segmento dinamico. As duas sondas
cobrem as duas formas reais: o acesso direto e o por apelido, que foi
justamente o que a primeira versao do guard deixou passar.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao de colisao sabe falhar"'

~~~~~~
Controle do guard de embed ambiguo. O controle POSITIVO (sonda 2) pesa
tanto quanto o negativo: um guard que reprovasse o embed qualificado
obrigaria a desfazer a correcao para ficar verde.

A sonda 3 e a que importa mais no longo prazo. Este guard depende de
LER as FKs das migrations, e se esse parser quebrar ele nao acha par
ambiguo nenhum, nao tem o que conferir, e sai VERDE -- indistinguivel
de uma arvore correta. O piso de pares lidos existe para isso, e aqui
exigimos que ele morda.
~~~~~~

## Nenhuma cor fixa fora dos tokens, contraste AA nos dois temas

~~~~~~
=======================================================================
CORES SAEM DOS TOKENS E TEM CONTRASTE
origem: color-tokens.yml (job `tokens`)
=======================================================================
Prova, a cada mudanca no codigo, que o modo noturno continua inteiro.

O modo de falha aqui e silencioso do mesmo jeito que o da deriva de schema:
uma tela nova escrita com `bg-white text-gray-900` compila, passa no tsc,
passa no next build e fica perfeita para quem revisa de dia. Ela so aparece
como um retangulo branco na cara de quem usa o app as 23h -- e ninguem
associa isso ao PR que a introduziu.

O mesmo vale para o contraste: mexer em um --success de 30% para 45% de
luminosidade nao quebra nada, so deixa o valor positivo lavado no fundo
claro. Por isso a verificacao le os tokens e calcula a razao de contraste em
vez de confiar no olho.

Nao precisa de Postgres nem de dependencia: Node puro, roda em segundos.
~~~~~~

## 'A verificacao sabe falhar (color-tokens)'

~~~~~~
Controle negativo. Uma verificacao que nunca viu vermelho nao e
verificacao: se a regex de classes quebrar, o passo acima passa a sair
verde por nao achar NADA -- indistinguivel de estar tudo certo.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao sabe falhar (color-tokens)"'

~~~~~~
Mora aqui, e nao no db-verify, de proposito. O db-verify e filtrado por
`paths: ['database/**', 'lib/...']` -- mexer em app/page.tsx nao casa
com nenhum padrao, o job e pulado, e o PR sai verde com a suite parada.
Este workflow nao tem filtro nenhum.

E e a mesma familia de defeito que o resto do arquivo vigia: uma classe
do Tailwind que compila, passa no tsc, passa no next build, e so erra
no aparelho de quem usa -- ali um retangulo branco as 23h, aqui dois
botoes desencontrados no celular (HMO-160).
~~~~~~

## A preferencia do papel de pao cai no padrao, e o script do <head> funciona

~~~~~~
=======================================================================
MODO "PAPEL DE PAO": A PREFERENCIA E O INTERRUPTOR
origem: nasceu aqui (HMO-283, do plano da HMO-279)
=======================================================================
Passos neste job, e nao num job novo: o custo de CI aqui e o NUMERO DE
JOBS (ver o cabecalho deste arquivo), e as duas suites juntas levam
~5 segundos.

A preferencia. O pedaco que nao teria rede de outra forma e o
PAPEL_INIT_SCRIPT: ele e TEXTO, nao compila, e roda no <head> dentro de
um try/catch que engole qualquer erro dele -- um parentese errado ali
apareceria apenas como o flash da pele normal voltando para quem usa o
modo, e ninguem abre bug para isso. A suite EXECUTA o script contra um
DOM de mentira e compara o resultado com o do modulo.
~~~~~~

## O papelzinho e o espelho dele em Configuracoes trocam a pele do app

~~~~~~
O interruptor, em navegador. Clicar no papelzinho tem que trocar a
classe do <html> E o clique em Configuracoes tem que fazer o mesmo --
medir so um dos dois deixaria metade do que a issue pede sem prova.

Precisa de navegador pela mesma razao do test:divisao-ui-dom abaixo:
`react-dom/server`, que e como as outras suites de componente deste
repo rodam, NAO ve handler. `onClick` nao sai no HTML e nunca e chamado
pelo render, entao a tela renderizaria identica com o handler vazio.

Sem navegador a suite FALHA, e nao pula: suite que se desliga sozinha e
indistinguivel de suite que passou.

O PAINEL SAIU DESTA SUITE NA HMO-470 (F6 do plano da HMO-462). Ate ali a
mesma pagina tambem media o `PainelDePapel` -- o rotulo dos cartoes
(HMO-294), o terceiro cartao (HMO-296), o chevron (HMO-300) e o elo da
fatura (HMO-305), 35 das 48 assercoes. Aquela tela nao existe mais: a
conversa (`ConversaDePapel`) tomou o lugar dela em /dashboard na HMO-468,
e a F6 apagou o painel, a rota e a lib.

O passo FICOU, e isto e o ponto: o que sobrou na suite -- os dois
interruptores, a preferencia e a pele -- e infraestrutura do MODO, que a
F6 nao remove, e esta e a unica medida de navegador que ela tem.
~~~~~~

## O menu do papel de pao tem 3 itens, e o menu normal tem 29

~~~~~~
O MENU REDUZIDO do modo (HMO-284, ampliado pela HMO-294, encolhido pela
HMO-466). Com o modo ligado o menu encolhe de 29 telas para 3, por um
segundo filtro sobre o MESMO array de navegacao.

Eram 5 na HMO-284; 7 com a HMO-294 (`/dashboard/profile` e
`/dashboard/settings`); 8 com a HMO-299 (`/dashboard/expense-groups`).
A HMO-466 levou de volta para 3 -- `/dashboard`, `/dashboard/profile` e
`/dashboard/settings` --, porque a issue-mae (HMO-462) pede o modo como
uma CONVERSA e, com essas palavras, "nada de grupos, nada de contas
divididas". A saida de Grupos REVERTE a HMO-299 de proposito.

AS DUAS QUE SOBRAM AO LADO DA CONVERSA SAO DE NAVEGACAO, nao de feature:
o espelho do interruptor do modo vive em Configuracoes (esconder aquela
tela tranca a pessoa dentro do modo, com o papelzinho do cabecalho como
unica saida), e o nome da saudacao sai do Perfil.

A suite exige EXATAMENTE 3 e EXATAMENTE 29, e nao "contem": com
`contem`, ela ficaria verde enquanto o menu voltasse a crescer -- o
proximo item acrescentado ao array entraria no modo sem ninguem decidir.
Por isso um item novo REPROVA aqui; a mensagem do teste diz o que fazer.
E ela prende nos DOIS sentidos: a HMO-466 teve de reescrever as
contagens uma por uma para ENCOLHER o menu, que e o preco de prender
numero exato e tambem o que ele compra.

Ela tambem fixa o plano em todo caso. `podeVerItem` e o primeiro filtro
e ja existia; sem fixar, a contagem de 29 cai para 27 e a suite passaria
a medir o PLANO em vez do MODO.
~~~~~~

## Os mutantes do menu do papel de pao

~~~~~~
Dois dos dez casos da suite acima afirmam sobre o TEXTO-FONTE do
Sidebar, e nao sobre valor calculado: que ele CHAMA o filtro (nao basta
importar -- `noUnusedLocals` esta desligado, entao apagar a chamada e
deixar o import nao e erro de tsc nem de lint) e que nenhuma pagina
importa o menu reduzido, porque esconder do menu nao e bloquear rota.

Assercao sobre texto e o tipo que mais passa verde sem medir nada, e a
contagem sobre array e o segundo. Por isso os dois tipos levam mutante:
cada um estraga uma coisa e exige que a suite reprove. O runner tem
controle positivo (codigo intacto tem de PASSAR) e confere que cada
ancora casou -- um replace que nao casa com nada nao muda arquivo
nenhum, e isso se le como "mutante sobreviveu" quando o mutante nunca
existiu.
~~~~~~

## O menu tem 8 entradas de primeiro nivel, e nenhuma das 29 telas ficou fora

~~~~~~
O MENU + SUBMENU (HMO-423). O menu lateral tinha 28 itens de primeiro
nivel; agora tem 8 entradas -- duas telas soltas e seis grupos -- com as
29 telas dentro. Esta suite conta ENTRADAS e grupos; a de cima conta
TELAS, que e o que o modo papel de pao filtra. Separadas de proposito:
juntas, um numero mudaria por dois motivos e quem fosse reescreve-lo nao
saberia qual deles tinha mudado.

O que ela prende, e cada um pega um defeito diferente:
  - as 8 entradas, pelo NOME e na ORDEM (uma entrada nova REPROVA, e
    quem a acrescentar decide de proposito se ela merece primeiro nivel);
  - as 28 rotas de antes da issue, uma por uma, numa lista literal:
    agrupar 28 itens a mao perde um pelo caminho SEM NENHUM SINTOMA --
    a tela continua respondendo 200 e so deixa de ser alcancavel
    clicando (foi a HMO-145, e a HMO-124 com Configuracoes dando 404);
  - o pedido da issue: MyBank e a conta de investimento DENTRO de
    Investimentos, com Contas e Cartoes em outra entrada -- e o
    paralelo que a issue pede, e sem a segunda metade ele nao existe;
  - a FIACAO da query: o `?tipo=investment` do item de menu e entregue
    ao `tipoDoRecorte` de lib/contas.ts, que e quem o le na tela. Um
    `?tipo=investments` em qualquer um dos dois lados nao da erro: a
    tela cai calada na lista inteira, com o titulo certo e seis contas
    a mais.
~~~~~~

## Os mutantes do menu agrupado

~~~~~~
A suite acima e feita dos tres tipos de assercao que passam verde sem
medir nada: contagem sobre array, tabela de casos puros e texto-fonte do
Sidebar. Entao os tres levam mutante.

O runner tem controle positivo (codigo intacto tem de PASSAR), confere
que cada ancora casou -- um replace que nao casa com nada nao muda
arquivo nenhum, e isso se le como "mutante sobreviveu" quando o mutante
nunca existiu -- e tem dois SOBREVIVENTES ESPERADOS (trocar o icone de um
grupo, mexer no recuo do submenu): sem eles o runner cobraria so vermelho
e nao haveria nada denunciando uma suite que passasse a prender
decoracao em vez do conteudo do menu.
~~~~~~

## Nenhuma tela do painel volta a empurrar a pagina para o lado

~~~~~~
Oito rotas do painel andavam para o lado no celular (HMO-168), por dois
mecanismos: linha de acao que nao quebra e barra de abas que nao rola.
~~~~~~

## A verificacao de scroll horizontal sabe falhar

~~~~~~
Controle negativo do passo acima, pelo mesmo motivo do de cores: um
teste que le classes por regex passa a sair verde se a regex parar de
encontrar o alvo, e verde-por-nao-olhar e indistinguivel de verde.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao de scroll horizontal sabe falhar"'

~~~~~~
Controle negativo da HMO-185, a outra familia que a mesma suite vigia:
a area util da tela no iPhone. Ela precisa de controle proprio porque
e MAIS invisivel que o scroll horizontal -- `env(safe-area-inset-top)`
vale 0 em todo navegador sem notch, inclusive o deste runner, entao
nem uma medicao em pixels aqui veria a regressao. Sobra afirmar sobre
o mecanismo, e mecanismo afirmado por regex sai verde no dia em que a
regex para de achar o alvo.

Os tres mutantes sao os tres caminhos de volta, e o terceiro foi
medido em navegador antes de entrar aqui (sem o `min-w-0` do bloco da
esquerda a pagina volta a 614px numa viewport de 390).
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao de area util sabe falhar"'

~~~~~~
Terceiro inquilino sem filtro de path, pelo mesmo motivo dos dois de
cima -- e o que ele vigia nao tem dono topico nenhum: as 34 suites deste
repositorio compilam para `.tmp-<nome>/` e cada uma comeca com `rm -rf`
nesse caminho. Enquanto o diretorio estiver no .gitignore isso e inocuo.
Quando um escapa, nada fica vermelho: o .js compilado entra na main como
se fosse fonte, e quem rodar aquela suite passa a APAGAR um arquivo
rastreado e fica com uma delecao fantasma pronta para ser varrida para
dentro do commit seguinte. Aconteceu na HMO-166, que levou junto o
`.tmp-recorrencia-edicao/` da HMO-170 -- o unico dos 34 fora do
.gitignore.
~~~~~~

## Os mutantes da linha da parte de grupo

~~~~~~
A outra metade do antigo mutante 4, agora que a linha da parte de grupo
mora em arquivo proprio (HMO-274) e os dois casos da suite finalmente a
leem de la (HMO-282).

Ele virou runner em vez de mais um `sed` no bloco acima por uma razao
que a HMO-282 pagou para aprender: o `perl` que ficava la mirava
`{parte.description}` dentro de `personal-finance/page.tsx`, de onde o
JSX tinha saido. O mutante nao aplicava em NADA. E isso nao apareceu
porque a suite ja estava vermelha por conta propria -- com a suite
vermelha, todo controle negativo deste formato passa sem medir nada,
porque ele so pergunta "ficou vermelho?". O runner fecha os dois
buracos: exige que cada ancora case exatamente 1x antes de mutar, e roda
a arvore intacta primeiro como controle positivo.

Sao cinco mutantes (os dois `min-w-0`, o `truncate`, o `flex-wrap` e o
`gap-y`) e cada um declara QUAL dos dois casos deve derrubar -- vermelho
em outro caso conta como sobrevivente, senao o mutante estaria medindo a
suite e nao a afirmacao.
~~~~~~

## A verificacao de artefatos sabe falhar

~~~~~~
Controle negativo, pela mesma razao dos outros dois: as duas metades da
verificacao sao varreduras que sairiam verdes se parassem de achar o
alvo. A segunda metade reproduz o estado exato em que a main ficou.
~~~~~~

## tsc --noEmit

~~~~~~
=======================================================================
OS TIPOS FECHAM
origem: build.yml (job `tipos`)
=======================================================================
Prova, a cada PR, as tres coisas que este repositorio nunca provou: que o
projeto COMPILA, que os TIPOS fecham, e que a IMAGEM DOCKER sobe.

Isto e a HMO-119, e a razao de existir dela e um buraco que durou meses: dos
nove workflows que este repositorio tinha antes deste, NENHUM rodava
`next build` nem `tsc --noEmit`. Cada um prova uma regra de negocio muito bem
-- a mascara de dinheiro, o corte de Contas x Cartoes, o isolamento da RLS,
os icones do PWA -- e todos eles passam em verde num commit que nao compila.

O modo de falha nao e teorico. O `type-check` existe no package.json desde o
inicio e so rodava quando alguem se lembrava de rodar; o `pre-commit` que o
chamaria sai 1 na main antes de chegar no lint, entao na pratica ninguem
executava nenhum dos dois. O unico lugar onde o build de verdade acontecia
era a Vercel, DEPOIS do merge -- ou seja, o sinal de "quebrou" chegava com o
codigo ja na main e, quando o autor do commit nao era verificado, a Vercel
nem comecava o build e o sinal nao chegava nunca.

SEM FILTRO DE `paths`, e aqui isso nao e preferencia: um build quebra por
qualquer arquivo do projeto. Qualquer lista de caminhos que eu escrevesse
hoje estaria errada amanha, e foi exatamente assim que tres suites deste
repositorio ficaram paradas em verde -- elas so rodavam no db-verify, que e
filtrado por path.
~~~~~~

## Controle negativo (erro de tipo tem que reprovar)

~~~~~~
Controle negativo. Uma verificacao que nunca viu vermelho nao e
verificacao: se o tsconfig passar a excluir o projeto (um `include`
errado, um `exclude` novo), o passo acima continua saindo 0 e o job fica
verde sem checar uma linha. Aqui um erro de tipo OBVIO tem que reprovar.

O arquivo nasce e morre dentro do job. Fica em `lib/` porque o `include`
de hoje e `**/*.ts` e pegaria qualquer lugar, mas um `include` futuro que
liste diretorios tende a citar `lib` e nao a raiz -- entao `lib/` e onde
o controle tem mais chance de continuar valendo.
~~~~~~

## eslint, zero tolerancia

~~~~~~
=======================================================================
ZERO AVISO DE LINT
origem: HMO-179 (nasce aqui)
=======================================================================
O backlog foi de 142 avisos para zero, e sem este passo ele volta a
crescer: nenhum dos workflows anteriores rodava lint, e o `lint` so
existia no fim da cadeia do `pre-commit`, que saia 1 antes de chegar
nele.

FICA AQUI, E NAO NUM JOB PROPRIO. A HMO-263 acabou de transformar 16
instalacoes em uma; um job novo pagaria `actions/checkout` + `npm ci`
outra vez para rodar alguns segundos de eslint -- e o custo de CI neste
repositorio e o NUMERO DE JOBS, nao o de passos. Mora logo depois do
`tsc` porque as duas verificacoes falam do mesmo arquivo-fonte, e
porque quem quebrou o tipo quase sempre quebrou o lint.

Roda `lint-tudo`, e nao `lint`: `next lint` enxerga apenas `app/`,
`components/`, `lib/`, `pages/` e `src/`. Os 7 avisos que estavam em
`next.config.js`, `tailwind.config.js` e `utils/` eram invisiveis para
ele, inclusive para a contagem de 142 da propria issue.
~~~~~~

## Controle negativo (aviso de lint tem que reprovar)

~~~~~~
Controle negativo. As regras deste projeto sao `warn`, e o `eslint` sai
0 com qualquer numero de warnings -- um passo assim pode ficar verde
para sempre sem conferir nada. Aqui um aviso OBVIO tem que reprovar.

O `git add -N` e necessario: `lint-tudo` monta a lista a partir do
`git ls-files`, entao arquivo nao rastreado nao seria conferido e o
controle passaria vacuo -- exatamente o falso verde que ele existe para
pegar. O arquivo nasce e morre dentro do passo.
~~~~~~

## As regras do ajuste de saldo

~~~~~~
=======================================================================
O AJUSTE FAZ A FATURA FECHAR IGUAL A REAL
origem: ajuste-de-saldo.yml
=======================================================================
O ajuste de saldo da fatura do cartao (HMO-253).

POR QUE ELE MERECE VERIFICACAO PROPRIA
------------------------------
Este e o unico lugar do app onde o usuario escreve um numero com SINAL no
dinheiro de uma fatura. A fatura e `SUM(invoice_amount)` de uma view que
inverte o sinal de `amount`, entao existem duas convencoes opostas sobre o
mesmo valor -- e um ajuste gravado com o sinal trocado faz a fatura andar para
o lado contrario ao que a pessoa pediu, com o numero certo, a tela coerente
consigo mesma, e nada vermelho.

O resto dos modos de falha e da mesma familia: o ajuste de outubro caindo na
fatura de novembro; "Salvar" duas vezes somando o valor duas vezes; a previa
"a fatura passa para R$ 1.290" discordando do que o POST grava. Nenhum deles
da erro, e todos valem dinheiro.

SEM FILTRO DE `paths`, pelo mesmo motivo do cartoes.yml: o comportamento nasce
de quatro lugares em tres diretorios (lib/ajuste-de-fatura.ts,
components/cartoes/*.tsx, a rota e os primitivos de components/ui), e um filtro
que liste os de hoje perde o dia em que alguem mexer no de amanha.

O QUE ESTE JOB NAO COBRE: o banco. Que o dia 1 caia na fatura do mes certo e
que a view inverta o sinal e aritmetica do Postgres, e esta no db-verify
(database/tests/ajuste_de_fatura_test.sql). Uma afirmacao de TypeScript sobre
`card_invoice_month` provaria so que a conta foi repetida duas vezes.
~~~~~~

## As regras do ajuste de saldo da conta

~~~~~~
=======================================================================
O AJUSTE DE SALDO TAMBEM PARA CONTAS (HMO-409)
=======================================================================
A aritmetica e REUSADA -- `ajusteParaFecharEm` e a mesma funcao, com os
25 mutantes do bloco acima atras dela. Esta suite nao a remede. O que
ela mede sao os CINCO pontos em que a conta nao e o cartao, e os cinco
erram calado:

  1. o sinal NAO se inverte. No cartao `amount = -valorNaFatura`,
     porque a view publica `(-t.amount)`; na conta o trigger soma a
     coluna CRUA, entao `amount` E a diferenca. Copiar a inversao de la
     afasta o saldo do banco pelo DOBRO -- com a previa da tela
     concordando, porque e a mesma conta;
  2. a base SUBTRAI o ajuste existente, enquanto a do cartao SOMA (pelo
     mesmo motivo). Copiar o sinal de la erra a base pelo dobro do
     ajuste gravado, e so no SEGUNDO ajuste do mesmo dia;
  3. a chave e por DIA. Por mes, o ajuste de hoje apagaria o de duas
     semanas atras, perdendo a diferenca que apareceu no meio;
  4. a categoria reservada e outra ("Ajuste de saldo"). Reusar "Ajuste
     de fatura" rotula o ajuste da conta corrente como ajuste de cartao
     em todo relatorio por categoria;
  5. `group_id: null` e `is_shared: false` vao LITERAIS no INSERT --
     um ajuste negativo com `group_id` e rateado pelo trigger e vira
     despesa do grupo, dividida com todo mundo, em silencio.

SEM FILTRO DE `paths`, como o resto deste job.

O QUE ESTE JOB NAO COBRE: o banco. Que o saldo FECHE no numero digitado
e que os meses anteriores de `net_worth_history` NAO se mexam sao o
trigger e uma view -- os dois numeros que a issue manda prender estao
em database/tests/ajuste_de_saldo_da_conta_test.sql, no db-verify.
Simula-los aqui seria conferir a simulacao contra ela mesma.
~~~~~~

## O bloco de ajuste, renderizado na tela de Contas

~~~~~~
A ARVORE. A suite acima passa verde com o bloco inteiro faltando na
tela de Contas -- e e justamente na tela que mora o unico defeito desta
feature que a suite do cartao nao teria como pegar: o vocabulario
invertido (ver o mutante 12).
~~~~~~

## 'A verificacao sabe falhar (ajuste-de-saldo-da-conta)'

~~~~~~
Controle negativo. As duas suites acima afirmam muito sobre AUSENCIA --
"nenhum UPDATE em financial_accounts", "o ajuste de ontem nao foi
tocado", "a previa NAO aparece sem base" -- e assercao de ausencia passa
verde tambem quando ela deixa de achar o que deveria procurar.

Cada mutante abaixo e um defeito que alguem escreveria de boa-fe, e a
maioria deles e o que sai de COPIAR o ajuste do cartao sem notar que a
base, o sinal e a chave sao outros.
~~~~~~

## A perna do acerto de grupo (sinal, tipo, moeda e conta)

~~~~~~
=======================================================================
O ACERTO DE GRUPO VIRA LANCAMENTO (HMO-245, fase 11)
=======================================================================
`group_settlements` existia desde a 007 sem gerar lancamento nenhum: o
Pix de uma pessoa para a outra era invisivel nos dois lados e o saldo da
conta corrente nao se mexia. Era o defeito relatado.

POR QUE AQUI, E NAO SO NO DB-VERIFY
-----------------------------------
A metade de banco (saldo antes/depois, o rateio que o trigger inventa se
a perna levar `group_id`, a RLS que recusa a perna da contraparte) esta
em database/tests/hmo245_acerto_vira_lancamento_test.sql, no db-verify,
porque e aritmetica de Postgres. Mas o db-verify e filtrado por `paths`,
e ESTE workflow nao e: `components/grupos/DialogoDeAcerto.tsx` nao esta
na lista de paths de ninguem, e foi exatamente assim que tres suites
deste repositorio ficaram paradas em verde.

O que a suite pura prende -- cada item e dinheiro errado sem excecao
nenhuma:
  - o SINAL por direcao. Quem recebe soma, quem paga subtrai;
    `update_account_balance` faz `current_balance + NEW.amount` sem
    olhar o tipo, entao um sinal invertido afunda a conta de quem acabou
    de RECEBER, com todos os numeros plausiveis na tela;
  - o TIPO `transfer` NOS DOIS LADOS. `income` em quem recebe apaga a
    parte dela no painel pessoal: medido em Postgres, income 200 /
    expense 200 / net 0,00 onde o certo e -200,00, porque
    `personal_category_monthly_totals` (033) ja conta "a minha parte"
    das despesas de grupo e ignora `transfer`;
  - `group_id: null` e `is_shared: false` literais;
  - a moeda da perna saindo da CONTA pela taxa GRAVADA na quitacao, e a
    recusa (em vez da conversao) numa terceira moeda;
  - cartao de credito recusado: a perna cairia DENTRO da fatura;
  - a chave em `notes` carregando o id do acerto -- uma chave constante
    faria o desfazer de um acerto apagar a perna de todos os outros.
~~~~~~

## 'A verificacao sabe falhar (acerto de grupo)'

~~~~~~
Controle negativo. A suite afirma sobre coisas que "parecem certas" nas
duas direcoes -- um tipo plausivel, um sinal plausivel --, e assercao
desse tipo passa verde tambem quando deixa de achar o que vigiava.
Os quatro mutantes foram medidos antes de este bloco existir: os quatro
ficam vermelhos, e a arvore limpa fica verde.
~~~~~~

## A perna da contraparte, o rotulo do estado intermediario e os dois desfazeres

~~~~~~
==================================================================
O OUTRO LADO DO ACERTO (HMO-278, fase 12)
==================================================================
A fase 11, acima, grava a perna de QUEM CLICOU. A fase 12 entrega o
outro lado -- e ele precisa da sessao dele, porque
`financial_transactions_write` e `FOR INSERT WITH CHECK (user_id =
auth.uid())` (`002_rls_lockdown.sql:472`).

Esta suite fixa o que a de cima nao consegue ver, porque a de cima olha
UMA perna:
  - as DUAS sessoes do mesmo acerto dando direcoes OPOSTAS. Com um
    userId so, qualquer direcao "funciona" -- e e por isso que o mutante
    da perna de quem deve (`transfer` -> `expense`) precisa do par para
    ser medido de verdade;
  - o ROTULO do estado intermediario, que e entrega da issue e nao
    enfeite: sem ele, "nao lancado" fica indistinguivel de "nao
    aconteceu" e o Pix nunca entra no extrato de quem nao confirmou;
  - a ASSIMETRIA dos dois desfazeres. Quem registrou desfaz o acerto (a
    perna vai junto); a contraparte remove SO a perna dela. Os dois
    booleanos nunca sao verdadeiros na mesma sessao -- oferecer "desfazer
    so o meu lancamento" a quem registrou reproduz o defeito que a fase
    11 consertou: quitacao gravada com dinheiro nenhum.
~~~~~~

## 'A verificacao sabe falhar (a perna da contraparte)'

~~~~~~
Controle negativo. Quase todo enunciado desta fase e um BOOLEANO, e
booleano e o que uma suite confirma por acidente: basta olhar o lado que
calhou de estar certo.

Aqui o controle e um RUNNER e nao `sed` inline, porque ele precisa de
tres peneiras que o `sed` nao tem: o controle positivo (a arvore intacta
passa), a conferencia de que cada trecho mutado e UNICO no arquivo, e a
recusa de contar como morto o mutante que nem compilou. O runner muta uma
COPIA de lib/ em diretorio temporario -- a fonte do repo nao e tocada em
momento nenhum, entao nao ha arvore para restaurar depois.
~~~~~~

## O acerto de grupo a confirmar na aba Receitas, e o lado ja confirmado

~~~~~~
==================================================================
"ELA PAGOU; EU CONFIRMO" NA ABA RECEITAS (HMO-366, F4 da HMO-360)
==================================================================
A fase 12, acima, poe o estado na tela DO GRUPO. Esta leva o MESMO
estado para a aba Receitas, que e onde a pessoa pergunta "o que
entrou?" -- e sem migration: a policy da 007 ja deixa os dois lados
verem a quitacao, `comoEuVejoOAcerto` ja responde "EU ja lancei?" e o
POST da perna ja existe.

Esta suite fixa o que as de cima nao conseguem ver, porque elas olham
UM acerto por uma sessao:
  - o acerto em que EU PAGO nao entra na aba RECEITAS. Ele tambem esta
    `a_lancar` para mim, e listado aqui poria uma SAIDA de dinheiro na
    aba de receita -- com o dialogo abrindo em `direcao: "recebi"`, a
    perna sairia POSITIVA e a conta de quem pagou SUBIRIA;
  - a quitacao entre outras duas pessoas -- que a policy me deixa LER --
    fica fora;
  - CONFIRMAR MOVE A LINHA DE LADO, e as duas metades sao uma assercao
    so: a perna e `transfer`, e `transfer` nao entra em Receitas
    realizadas -- entao sem o bloco de recebidos confirmar faz a linha
    DESAPARECER da tela. "Cliquei e o valor sumiu" termina em alguem
    lancando a receita a mao, que e a conta duas vezes que a 007
    recusou.
~~~~~~

## 'A verificacao sabe falhar (o acerto na aba Receitas)'

~~~~~~
Controle negativo, pelo mesmo motivo do da fase 12 e com o mesmo
aparelho: os enunciados desta fase sao "esta linha aparece AQUI e nao
ALI", e e isso que uma suite confirma por acidente olhando so o lado que
calhou de estar certo. O runner muta uma COPIA de lib/ em diretorio
temporario -- a fonte do repo nao e tocada, entao nao ha arvore para
restaurar depois.
~~~~~~

## O bloco de ajuste, renderizado na tela do cartao

~~~~~~
A ARVORE. O teste puro acima passa verde com o bloco inteiro faltando na
tela, com a linha do ajuste sem rotulo, e com "Ajustar saldo" oferecido
sobre uma leitura que falhou.
~~~~~~

## 'A verificacao sabe falhar (ajuste-de-saldo)'

~~~~~~
Controle negativo. As suites afirmam sobre AUSENCIA -- "a previa NAO
aparece sem mes", "nenhuma linha recebe o rotulo sem categoria" -- e
assercao de ausencia passa verde tambem quando ela deixa de achar o que
deveria procurar. Uma verificacao que nunca viu vermelho nao e
verificacao.

Cada mutante abaixo e um defeito que alguem escreveria de boa-fe.
~~~~~~

## As duas regras do alcance, e o texto que a tela declara

~~~~~~
=======================================================================
SO ESTA, DESTA EM DIANTE, OU TODAS
origem: alcance-da-serie.yml
=======================================================================
Apagar ou alterar uma conta parcelada ou fixa -- so esta, desta em diante, ou
todas (HMO-228, Fase 6 da HMO-208).

POR QUE ISTO MERECE VERIFICACAO PROPRIA
-------------------------------
Sao DUAS tabelas respondendo a MESMA pergunta com barreiras diferentes, e todo
jeito errado de errar aqui grava dinheiro plausivel:

  - "todas" com barreira de DATA em vez de status reescreve um mes ja
    conferido, e deixa de corrigir a conta vencida que a pessoa queria;
  - apagar "esta e as proximas" sem encerrar a regra faz a conta voltar alguns
    MESES depois, quando ninguem mais liga uma coisa a outra;
  - apagar a parcela 3 de 10 sem conhecer a serie deixa nove linhas, e a
    fatura de cada mes restante segue fechando num valor plausivel e errado;
  - "desta em diante" numa serie de cartao com barreira por data (e nao pelo
    NUMERO) alcanca a parcela errada quando duas caem no mesmo mes de fatura.

Nenhum desses da erro. Todos produzem tela de aparencia normal.

SEM FILTRO DE `paths`, pelo mesmo motivo do parcelamento.yml: o comportamento
nasce de duas regras puras, de tres rotas e de tres telas, e um filtro que
liste os arquivos de hoje perde o dia em que alguem mexer no de amanha.
~~~~~~

## Os dois alcances que a HMO-170 ja entregou

~~~~~~
A SUITE DA HMO-170 CONTINUA VALENDO. Ela cobre os dois primeiros
alcances na edicao, e e onde a assercao `ehAlcanceValido("todas")`
mudou de false para true -- com o porque escrito no lugar dela.
~~~~~~

Nota que vinha do step `O alcance de uma edicao, e o que ele nunca toca`, unificado neste:

~~~~~~
O que erra o HISTORICO (HMO-170). Editar uma movimentacao que se repete
pergunta se a mudanca vale para uma ocorrencia ou para as seguintes, e a
issue e explicita: "nunca mudar o que ja passou". O defeito que esta
suite pega e a barreira errada -- filtrar por `hoje` em vez de pela
ocorrencia clicada passa em todo teste manual (onde a ancora E o mes
corrente) e reescreve os meses entre hoje e a ancora quando ela esta mais
a frente. A pessoa pede "daqui para frente" e recebe "desde sempre".
~~~~~~

## Os mutantes das duas barreiras

~~~~~~
OS MUTANTES. A suite acima passando nao diz, sozinha, que ela esta
medindo o que a justificativa dela afirma.

Medido na HMO-228 ao escrever isto -- 23 mutantes, 23 mortos, TODOS por
assercao e nenhum so pelo compilador. Os dois que dao nome a issue
(`todas_barreira_por_data` e `parcelas_barreira_por_mes_de_fatura`)
trocam a barreira de status por uma de data. O proprio runner reprova se
nenhum mutante morrer por assercao -- uma suite vazia tiraria placar
perfeito.

A HMO-357 somou NOVE mutantes do movimento da serie -- 32/32 mortos,
todos por assercao. Os dois que dao nome a ela:
`movimento_joga_a_serie_toda_na_mesma_fatura` (as dez parcelas caindo no
mesmo mes, com o total da compra ainda certo, entao nenhuma soma
denuncia) e `data_mudada_move_mesmo_com_fatura_escolhida` (as irmas
andando com a ancora PARADA -- o defeito da issue invertido, e pior,
porque a tela mostra a parcela editada no lugar certo).
~~~~~~

## O soft delete da ocorrencia nao rebaixa cancelled para skipped

~~~~~~
O SOFT DELETE NAO ANDA PARA TRAS (HMO-403)
------------------------------------------
Medido em producao pela validacao larga da HMO-400: `DELETE` com
`{alcance:"apenas_esta"}` numa ocorrencia JA `cancelled` respondia 200 e a
reescrevia para `skipped`. Em 6 linhas de uma serie (1 `skipped` + 5
`cancelled`) as seis terminaram `skipped` -- um comando chamado "apagar"
piorou o estado de cinco delas.

POR QUE ESTE STEP E UMA SONDA DE ROTA, E NAO MAIS UM CASO DA REGRA PURA
O step de cima ja prova o PLANO. O defeito vivia DEPOIS dele: o UPDATE da
rota nao tinha filtro de status, entao plano certo e escrita errada
conviviam sem nada reclamar. E os dois oraculos obvios nao servem --
conferir o codigo de resposta nao mede nada (deu 200 nas seis vezes), e a
rota de LISTA filtra `skipped` E `cancelled`, entao a tela diz "sumiu" nos
dois casos. O unico oraculo que distingue os estados e o `status` na
tabela, e e o que esta suite rele.
~~~~~~

## Os mutantes do soft delete monotonico

~~~~~~
OS MUTANTES DO MESMO CONSERTO -- 17/17 mortos, todos por assercao.

Ele mede contra DUAS suites, e isso nao e arrumacao: a rota tem duas
travas para a mesma coisa (o plano escolhe as linhas, e o filtro de status
da escrita confere de novo), e duas guardas que se cobrem fazem os dois
mutantes sobreviverem. Cada mutante nomeia o oraculo que o mata.

O que custou aparelho novo foi `o filtro de status sai da escrita`: para
ter medida ele precisa de uma linha que mude de estado ENTRE a leitura e
a escrita da mesma volta, e a sonda ganhou um gancho para encenar isso.
~~~~~~

## O botao de apagar parcela na fatura

~~~~~~
A TELA DO CARTAO, RENDERIZADA. A regra pura passa verde com o botao de
apagar inteiro fora da tela -- e era a tela do cartao que nao tinha
caminho nenhum para apagar uma parcela.
~~~~~~

Nota que vinha do step `A tela, renderizada`, unificado neste:

~~~~~~
A ARVORE. O teste puro acima passa verde com o total impresso longe do
rotulo do mes, com a frase de vazio dita sem leitura, e com Arquivar
dentro do link do cartao.
~~~~~~

Nota que vinha do step `O rotulo parcela N de M na tela do cartao`, unificado neste:

~~~~~~
O ROTULO NA FATURA. E aqui que a parcela aparece para o usuario -- o
"caminho de volta" sem o qual esta feature grava e desaparece.
~~~~~~

Nota que vinha do step `As acoes da conta prevista do cartao (HMO-460)`, unificado neste:

~~~~~~
AS CONTAS PREVISTAS DO CARTAO GANHAM EDITAR E EXCLUIR (HMO-460, F3 da
HMO-455).

O bloco "N contas previstas neste cartao" da tela do cartao lista a
assinatura cadastrada com o cartao como CONTA. Ela nao tinha botao nenhum,
e nao aparece em Contas a Pagar (a HMO-209 a tirou de la de proposito, para
a mesma despesa nao ser somada ao lado da fatura que ja a contem): ela nao
se editava nem se apagava em lugar NENHUM do app.

Por que o controle negativo existe aqui: os tres defeitos desta familia
respondem 200 e tiram a linha da tela, entao nada no clique os distingue.

  * o alcance ignorado -- quem escolhe "todas as ocorrencias" perde UM mes
    e recebe os outros de volta, meses depois;
  * o campo de valor preenchido com PONTO -- `replace(/\./g, "")` o le como
    separador de milhar, e Salvar sem tocar em nada grava R$ 399,00 numa
    assinatura de R$ 39,90;
  * a frase da serie apontando para Contas a Pagar -- a tela de onde a
    HMO-209 tirou esta linha.

Dois dos nove mutantes sao de FIACAO e nao de regra (o botao que aparece
sem handler, o formulario que entra no bloco que a releitura apaga): a
regra pura passa verde com os dois de pe.
~~~~~~

## 'A verificacao sabe falhar (alcance-da-serie)'

~~~~~~
CONTROLE NEGATIVO.

As assercoes que mais importam nesta feature sao de AUSENCIA ("a parcela
paga NAO foi alterada", "a compra avulsa NAO ganha botao"), e assercao
de ausencia passa verde tambem quando ela deixa de achar o que deveria
procurar. Os mutantes acima cobrem as duas regras puras; estes seis
cobrem o que esta FORA delas -- a FIACAO, que e onde esta familia falha:
a regra do valor tem 32 mutantes mortos e ficou dois meses sem nenhuma
tela a chamando (HMO-361), com todos eles verdes.
~~~~~~

## As regras da tela do cartao

~~~~~~
=======================================================================
CLICAR NO CARTAO MOSTRA OS GASTOS DELE
origem: cartoes.yml
=======================================================================
A tela de gastos de um cartao (HMO-210), que e a Fase 3 da HMO-208.

POR QUE ELA MERECE VERIFICACAO PROPRIA
------------------------------
A Fase 2 (HMO-209) tirou a compra individual de cartao de Contas a Pagar, para
a mesma despesa nao ser somada duas vezes ao lado da fatura cheia. Aquelas
compras passaram a nao ter tela nenhuma, e ESTA e a tela onde elas voltam a
aparecer. Se ela quebrar, a compra no cartao deixa de existir na interface --
o dinheiro esta no banco, a fatura soma certo, e nao ha onde olhar. Nada nisso
da erro.

SEM FILTRO DE `paths`, pelo mesmo motivo do contas.yml: o comportamento desta
tela nasce de quatro lugares em tres diretorios (lib/fatura-do-cartao.ts,
components/cartoes/*.tsx, o formulario de lancamento e os primitivos de
components/ui), e um filtro que liste os de hoje perde o dia em que alguem
mexer no de amanha.

As duas suites renderizam HTML em memoria, rodam em segundos e nao precisam de
banco.
~~~~~~

## O cartao travado no formulario

~~~~~~
O FORMULARIO que esta tela abre. "Lancar gasto neste cartao" entrega
natureza card e o cartao travado; com o seletor livre a pessoa clica num
cartao e grava no outro.
~~~~~~

Nota que vinha do step `'Os campos que cada tela mostra (lancamento)'`, unificado neste:

~~~~~~
O que erra a TELA. A queixa da HMO-162 era de arvore: o formulario
antigo trocava os campos por `if (transaction_type === ...)`, e quem
abria para lancar uma receita via o seletor de natureza da despesa, o
parcelamento e o rateio aparecendo e desaparecendo.
~~~~~~

Nota que vinha do step `O bloco de parcelamento, renderizado`, unificado neste:

~~~~~~
A ARVORE. A suite pura passa verde com o bloco inteiro fora da tela: ela
nao sabe se a checkbox existe, se a pergunta "parcela ou total" aparece,
nem se o resumo que avisa sobre as parcelas anteriores esta renderizado.
~~~~~~

## A fatura do periodo, e o que ainda vai ser cobrado

~~~~~~
A FATURA DO PERIODO (HMO-290). O rotulo "Fatura atual" imprimia
`current_balance` -- a divida INTEIRA do cartao, com as parcelas que o
trigger somou no INSERT. Uma compra de R$ 3.000 em 10x aparecia como
"Fatura atual: R$ 3.000" no mes da compra, que cobra R$ 300 dela.

A suite guarda o que nenhum tipo alcanca: `null` nao e zero (o cartao
ausente da resposta nao e um mes sem compra), soma parcial nao vale como
total, e parcela futura nao e cobranca de hoje.
~~~~~~

## Quanto este mes cobra do cartao, e quanto fica para depois

~~~~~~
O NUMERO DO "POSSO GASTAR" (decisao 4.1 do plano da HMO-281).
O desconto deixou de ser a divida inteira do cartao e passou a ser o que
vence ate o fim do mes. E o ponto de maior risco de dinheiro da issue:
trocar a fonte da divida reabre a porta do desconto duplo que
`current_balance` mantinha fechada.
~~~~~~

## A fatura fechada fica fora do que a projecao desconta

~~~~~~
A PROJECAO DE SALDO E A FATURA FECHADA (HMO-293). Fechar uma fatura de
R$ 300 derrubava o `projected_total` em R$ 300 sem nenhum fato novo: a
conta prevista da fatura entrava no `scheduled_out` enquanto a mesma
divida ja estava no `current_balance` do cartao. Medido em producao,
nao lido no codigo.

O que a suite guarda e o CRITERIO da exclusao: a chave canonica em
`notes`, nunca `account_type`. Assinatura cobrada no cartao nao e
fatura e TEM de continuar descontando -- trocar o criterio por tipo de
conta apaga essa distincao e continua passando no tsc.

Ela mora aqui, e nao no db-verify, de proposito: o db-verify e filtrado
por `paths:`, e foi exatamente assim que tres suites deste repositorio
ficaram paradas em verde (ver o item 2 do cabecalho).
~~~~~~

## 'A verificacao sabe falhar (projecao e fatura fechada)'

~~~~~~
Controle negativo da projecao: 23 mutantes, cada um estragando UMA
decisao do lib/projecao.ts, e todos tem de morrer. O runner muta numa
sombra em /tmp (`criarBlocoDeMutantes`) e roda o bloco num processo so,
entao aqui o custo e tempo de step, nao partida de maquina -- e a fonte
rastreada pelo git nunca e tocada, nem se o job for cancelado no meio.

Ele comeca pelo CONTROLE POSITIVO (arvore intacta tem de passar). Sem
isso um runner quebrado reprovaria todo mutante e imprimiria "23/23
mortos" sobre zero assercoes executadas.
~~~~~~

## 'A verificacao sabe falhar (fatura do periodo)'

~~~~~~
Controle negativo das duas decisoes de dinheiro, plantado um por vez.

A prova de mutacao completa e `npm run mutantes:fatura-do-periodo`
(15 mutantes, 15 mortos, com controle positivo nos dois alvos --
ferramenta de quem escreve o teste). Aqui ficam os tres que mais custam.

O `cmp` DEPOIS DE CADA `sed` NAO E ZELO. Um `sed -i` cujo padrao nao casa
SAI 0 e nao muda nada: o `npm run` seguinte roda a fonte INTACTA, passa,
e o `if` o declara... morto. O mutante seria dado por morto medindo nada.
~~~~~~

## O rotulo de fatura le fatura, e nao o saldo do cartao

~~~~~~
A FIACAO. `current_balance` e `number | string | null` e a fatura e
`number`: as duas atribuicoes compilam, e a fronteira da rota e `any`.
Nada disto aparece no tsc nem na tela -- o numero continua plausivel.
~~~~~~

## 'A verificacao sabe falhar (fatura escolhida)'

~~~~~~
Controle negativo da fiacao, nas DUAS direcoes que ela erra.

A verificacao remove comentario antes de procurar, e isso nao e detalhe:
todos os arquivos citados EXPLICAM por escrito o que ela procura. No
texto cru as buscas proibidas reprovariam sempre (os cabecalhos citam
`current_balance` uma duzia de vezes) e as exigidas aprovariam por
prosa -- a metade perigosa, que nao avisa, so para de verificar.
~~~~~~

## A fatura escolhida esta ligada nos quatro escritores

~~~~~~
A FATURA ESCOLHIDA NO LANCAMENTO (HMO-281 / HMO-289)

As suites puras acima provam as FUNCOES -- qual fatura e o padrao, que
meses entram na janela, e que a serie de parcelas conta a partir da
ancora. Nenhuma delas olha se o formulario MANDA o campo para o banco, e
esse defeito nao aparece no `tsc`: `invoice_month_override` e uma chave
opcional, entao esquece-la compila. A pessoa escolheria a fatura, a tela
diria "salvo", e a compra cairia na fatura da data.
~~~~~~

## 'A verificacao sabe falhar (fatura escolhida no lancamento)'

~~~~~~
Controle negativo do guard acima -- e dos dois oraculos que ele nao
alcanca (a fila offline e a aritmetica da ancora).

Em vez do `sed`+`cmp` dos outros passos deste arquivo, aqui o proprio
runner de mutantes faz o trabalho: ele confere que cada trecho procurado
aparece EXATAMENTE uma vez antes de mutar, roda um controle positivo por
oraculo, e confere o restauro byte a byte depois de cada mutante.

`--so-typescript` porque a outra metade do arquivo muta a migration 041 e
exige um banco-template montado a mao (a cadeia ATE a 040, sem a 041) --
o que nenhum runner de CI tem. Ela e medida A MAO, e o placar dela esta
registrado no db-verify.yml, ao lado do teste da 041; o db-verify roda a
MIGRATION e o TESTE dela, nao os mutantes. Os modos sao explicitos
justamente para que nada seja PULADO em silencio e o placar nao saia
pela metade com cara de inteiro.

Dois destes mutantes ja cobraram: `invoice_month_override` sem os dois
pontos casava com a LEITURA da edicao e ficava verde com a escrita
apagada, e a regex do `undefined` parava no `}` da interpolacao.
~~~~~~

## 'A verificacao sabe falhar (cartoes)'

~~~~~~
Controle negativo. As suites afirmam sobre AUSENCIA -- "a lista NAO traz
a compra do outro cartao", "a tela NAO afirma o vazio sem ter lido" -- e
assercao de ausencia passa verde tambem quando ela deixa de achar o que
deveria procurar. Uma verificacao que nunca viu vermelho nao e
verificacao.
~~~~~~

## Bloco novo nasce visivel, e arrastar para no lugar certo

~~~~~~
=======================================================================
O PAINEL OBEDECE A CONFIGURACAO E O PERIODO, E O RESET APAGA NA ORDEM
origem: configuracoes.yml
=======================================================================
Prova, a cada PR, as duas regras da aba de Configuracoes (HMO-159):

  1. o painel mostra tudo que existe, na ordem que o usuario escolheu;
  2. o "apagar tudo" apaga na ordem certa, e so o que e do usuario.

SEM FILTRO DE `paths`, e por duas razoes diferentes:

  * o teste do painel quebra quando alguem mexe em lib/dashboard-layout.ts,
    que nao esta em database/ nem em nenhuma das listas do db-verify;

  * o teste do reset le database/migrations e confronta com o plano de
    apagamento. Ele precisa rodar quando a MIGRATION muda -- uma policy de
    DELETE removida numa migration nova deixa o reset apagando zero linhas em
    silencio, com a tela dizendo "pronto, a conta esta como nova".

Um filtro de path acertaria um caso e perderia o outro. Os dois testes sao
aritmetica e leitura de arquivo, rodam em segundos, e nao precisam de
Postgres -- entao podem ser obrigatorios em todo PR sem virar pedagio.
~~~~~~

## O painel abre no mes certo, e a transferencia fica fora da soma

~~~~~~
HMO-173. Mora aqui, e nao no db-verify, pelo motivo que o cabecalho
deste arquivo ja explica: o db-verify tem filtro de `paths`, e
lib/periodo-do-painel.ts nao esta em nenhuma das listas dele -- a suite
ficaria no package.json sem nunca rodar num PR que mexesse nela.

O que ela guarda: o mes corrente sai do fuso de Sao Paulo (em UTC, as
22:00 de 30/09 o painel abria em outubro) e a transferencia fica FORA
da agregacao por intervalo (dentro dela, receita e despesa incham
juntas e o saldo liquido continua exato -- o erro nao aparece no numero
que as pessoas conferem).
~~~~~~

## O previsto conta o que foi pago, e a diferenca nao inverte o sinal

~~~~~~
HMO-186. Mora aqui pelo mesmo motivo das duas acima: lib/previsto-x-realizado.ts
nao esta em nenhuma lista de `paths` do db-verify, e a suite ficaria no
package.json sem nunca rodar num PR que mexesse nela.

O que ela guarda: conta prevista JA PAGA continua dentro do previsto (sem
isso o mes fecha em "previsto R$ 0,00 x realizado R$ 6.000" justamente no
dia 30, quando a comparacao tem todos os dados), a receita prevista nao e
contada como despesa (`amount` tem CHECK > 0 -- a direcao nao esta no
sinal), e a diferenca e `realizado - previsto` nas tres linhas.
~~~~~~

## O bloco imprime cada numero na coluna dele, e cala quando nao ha previsao

~~~~~~
A suite acima e aritmetica pura, e passaria verde com o JSX imprimindo o
previsto na coluna "Realizado" -- os dois numeros certos nos lugares
errados nao quebram build nem teste, e nao deixam a tela vazia. Esta
renderiza o bloco com react-dom/server e afirma sobre o HTML.

Ela cobre tambem os dois estados que so existem na marcacao: agenda vazia
e direcao ilegivel NAO podem imprimir "previsto R$ 0,00" -- zero contra o
realizado se le como "tudo acima do previsto", e o que houve foi ausencia
de previsao.
~~~~~~

## Realizado + Previsao = Total esperado, e a conta paga conta uma vez so

~~~~~~
HMO-174. Mora aqui pelo mesmo motivo de todas as acima: lib/realizado-e-previsao.ts
nao esta em nenhuma lista de `paths` do db-verify.

O que ela guarda: Realizado + Previsao = Total esperado, com as duas
parcelas DISJUNTAS. A conta prevista paga aparece so em Realizado (a
view `planned_vs_actual` tem o nome exato da feature e conta a paga nos
dois lados -- correto para variancia, falso aqui, e o total sai alto
pelo valor da conta), a transacao de data futura dentro do mes corrente
nao entra em "ja gastei", e transferencia e fatura de cartao ficam fora
dos dois lados.
~~~~~~

## Os tres numeros saem na ordem certa, e o gasto variavel diz que fica de fora

~~~~~~
A suite acima e aritmetica pura, e passaria verde com o JSX imprimindo
a Previsao debaixo do rotulo "Realizado": os dois numeros certos nas
posicoes trocadas nao quebram build nem teste, e nao deixam a tela
vazia. Esta renderiza os tiles com react-dom/server.

Ela cobre tambem a frase que carrega a decisao de produto: o gasto
variavel e linha propria e a tela precisa DIZER que ele nao esta somado
-- sem isso o usuario soma os dois numeros de despesa de cabeca e
conclui que o app se contradiz.
~~~~~~

## Os crivos leem a unidade certa, e ausencia de dado nao vira reprovacao

~~~~~~
Os crivos de fundamento (HMO-195). Tres defeitos desta lista saem verdes
em build, lint e type-check, e os tres mudam o veredito na tela:

1) UNIDADE. A view devolve razao (`roe` da PETR4 = 0.2649), e o limite do
   usuario e percentual (15). Comparar os dois crus APROVA toda empresa;
   converter duas vezes REPROVA quase todas. A suite fixa a PETR4 no ROE
   real de 26,49% -- o unico numero em que as duas versoes discordam.
2) "ULTIMO BALANCO" e MAX(ano_exercicio) POR EMPRESA. Ano fixo faz a
   empresa que ainda nao entregou a DFP deste ano DESAPARECER da lista;
   nao agrupar repete o mesmo ticker uma vez por ano importado.
3) NULL NAO E REPROVADO. `null > 15` e false em JavaScript, entao a
   ausencia de dado se disfarca de criterio nao atingido -- e num crivo
   de divida o zero APROVA. A suite exige o terceiro estado e NEGA o
   outro: "sem dado" tem de aparecer e "nao atingido" tem de nao.

Cobre tambem a fronteira regulatoria, que e decisao de produto e nao
detalhe: nenhuma nota unica sai do codigo (o resultado e por criterio),
nenhuma migration declara coluna de score, e o vocabulario de
recomendacao ("comprar", "vender", "recomendado") nao aparece na tela.
A trava de vocabulario tem controle negativo proprio na suite.
~~~~~~

## A verificacao do reset sabe falhar

~~~~~~
Controle negativo. O teste do reset confere o plano contra as
migrations lendo arquivo e casando expressao regular -- ou seja, ele
passa a sair VERDE se parar de achar o que deveria conferir. Uma
verificacao que nunca viu vermelho nao e verificacao.

Plantamos aqui os dois defeitos de maior consequencia e exigimos
vermelho nos dois.
~~~~~~

## As regras do corte entre conta e cartao

~~~~~~
=======================================================================
CONTA TEM SALDO, CARTAO TEM FATURA
origem: contas.yml
=======================================================================
Prova, a cada PR, as duas coisas que a HMO-166 separou: as REGRAS do corte
(qual tipo mora em qual tela, o que entra em cada total, o que vai `null` para
o banco) e a ARVORE de cada tela -- Contas sem limite, sem dia de fechamento e
sem dia de vencimento.

SEM FILTRO DE `paths`, e de proposito, pelo mesmo motivo do lancamento.yml: o
comportamento destas telas nasce de tres lugares em dois diretorios
(lib/contas.ts, components/contas/*.tsx e os primitivos de components/ui), e um
filtro que liste os de hoje perde o dia em que alguem mexer no de amanha. Foi
exatamente assim que tres suites deste repositorio ficaram paradas em verde:
elas so rodavam no db-verify, que e filtrado por path.

As duas suites renderizam HTML em memoria, rodam em segundos e nao precisam de
banco -- podem ser obrigatorias em todo PR sem virar pedagio.
~~~~~~

## 'Os campos que cada tela mostra (contas)'

~~~~~~
O que erra a TELA. A queixa da HMO-166 era de arvore: o cadastro era um
formulario so para os oito tipos, e quem abria para cadastrar uma conta
corrente via limite, fechamento e vencimento aparecerem e sumirem
conforme trocava o tipo.
~~~~~~

## 'Os campos que cada tela mostra (aporte de renda fixa)'

~~~~~~
O MESMO defeito de arvore na CARTEIRA (HMO-439): o formulario de
movimentacao pedia quantidade e preco unitario para tudo, inclusive para
um CDB. Alem de absurdo na tela, e perigoso no dado -- o preco medio e
DERIVADO das movimentacoes, entao valor digitado na coluna errada nao
aparece como linha estranha: ele move a media, e dela saem o lucro e a
rentabilidade exibidos.

A suite renderiza `CamposDaMovimentacao` com react-dom/server e mede,
por tipo de ativo, QUAIS campos aparecem -- sempre com o ativo do outro
tipo como controle no mesmo caso. Roda em segundos, sem banco.
~~~~~~

## 'A verificacao sabe falhar (aporte de renda fixa)'

~~~~~~
Controle negativo das DUAS metades da HMO-439. As suites afirmam sobre
AUSENCIA ("o CDB NAO tem campo de quantidade") e sobre COLUNA ("o valor
foi para `quantity`, nao para `unit_price`"), e as duas formas passam
verdes por acidente: ausencia passa quando a sonda deixa de achar o que
deveria procurar, e as duas colunas trocadas somam o MESMO custo.
~~~~~~

## As duas telas abrem sem rede

~~~~~~
O modo offline das duas. A tela antiga era precacheada; as duas novas
entraram no lugar dela. Deixar uma de fora apagaria metade do modo
offline por um caminho que nao parece com isso -- o menu abriria sem rede
com os dois itens e um deles cairia na pagina /offline.
~~~~~~

Nota que vinha do step `O precache leva as telas offline SEM perder os icones`, unificado neste:

~~~~~~
`additionalManifestEntries` SUBSTITUI a varredura de `public/` no
next-pwa 5.6, em vez de somar. Quem mexer em `lib/pwa-precache.js` e
devolver so as rotas tira do precache o manifest e os 20 icones -- e o
app volta a nao ser instalavel, com build verde e 200 em tudo. E o
mesmo modo de falha que motivou este workflow inteiro.
~~~~~~

## O que de um cartao aparece em Contas a Pagar

~~~~~~
O QUE DE UM CARTAO APARECE EM CONTAS A PAGAR (HMO-209). A compra
individual no cartao aparecia na agenda ao lado da fatura cheia daquele
mesmo cartao -- a despesa duas vezes na mesma tela, somada duas vezes no
cabecalho. As quatro maneiras de "consertar" isso errado passam verdes em
qualquer teste manual:
  - filtrar pelo TIPO DA CONTA e mais nada esconde a propria fatura, que
    tambem e uma previsao com o account_id do cartao -- a pessoa deixa de
    ver a unica conta de cartao que ela de fato paga;
  - reconhecer a fatura por texto livre em `notes` faz a descricao escrita
    a mao virar regra de negocio;
  - esconder a linha quando a conta nao e legivel (embed null por RLS, ou
    previsao sem conta) apaga conta a pagar comum em silencio;
  - filtrar so na LISTA deixa o total do cabecalho discordando das linhas
    logo abaixo dele, e o total e o numero errado.
Esta suite roda aqui, e nao no db-verify, porque o db-verify e filtrado
por path e as duas rotas que usam o filtro nao estao nesse filtro.
~~~~~~

## A fatura aberta entra em Contas a Pagar, e uma vez so

~~~~~~
A FATURA ABERTA EM CONTAS A PAGAR (HMO-227). O pedido do dono era que o
total a pagar no cartao aparecesse em contas previstas, no vencimento do
cartao. O modelo de dados ja fazia isso -- depois de alguem clicar
"Fechar fatura" em /dashboard/budgets, uma tela que a maioria nunca
abre. A fatura ABERTA agora e sintetizada a cada leitura, e a sintese
tem quatro maneiras de dar errado sem erro em lugar nenhum:
  - SAIR EM DOBRO ao lado da fatura ja fechada: as duas linhas sao
    plausiveis uma ao lado da outra, e o cabecalho cobra o dobro;
  - INVENTAR VENCIMENTO num cartao sem `due_day`, e a pessoa pagar no
    dia errado por causa de um chute do app;
  - DESAPARECER CALADA no mesmo cartao -- o defeito da issue de volta,
    agora com o app tendo o dado para avisar;
  - SINTETIZAR SO NA LISTA, deixando o "a vencer" do cabecalho MENOR
    que a soma das linhas logo abaixo dele, na mesma tela.
~~~~~~

## A sintese da fatura sabe falhar (mutantes)

~~~~~~
O placar de mutantes da sintese. A suite acima passa com 27 assercoes
verdes, e isso sozinho nao diz nada -- aqui cada decisao dela e quebrada
de proposito e a suite tem de ficar vermelha. O mutante `sem_dedup` e o
controle negativo que a issue nomeou.
~~~~~~

## 'A verificacao sabe falhar (contas)'

~~~~~~
Controle negativo. As suites afirmam sobre AUSENCIA -- "a tela de Contas
nao tem limite" -- e uma asercao de ausencia passa verde tambem quando
ela deixa de achar o que deveria procurar. Uma verificacao que nunca viu
vermelho nao e verificacao.

Plantamos os sete defeitos exatos que a separacao corrigiu ou evita.
~~~~~~

## A mascara, a data emitida e a recusa da data incompleta

~~~~~~
=======================================================================
A MASCARA MOSTRA DD/MM/AAAA E EMITE AAAA-MM-DD
origem: data-digitada.yml
=======================================================================
Prova, a cada PR, a mascara de data dd/mm/aaaa (HMO-238).

O pedido da issue era de ergonomia: "digitar dia mes e ano sem ficar pulando
pro ano". O risco que a troca cria e de DINHEIRO, e em duas direcoes:

  1. O valor emitido tem que continuar AAAA-MM-DD. `validarLancamento` recusa
     qualquer outra coisa com "Informe a data.", e o que passar por ela chega no
     PostgREST como 22007 -- que a tela mostra como "erro ao salvar", sem campo.
  2. Data incompleta tem que emitir VAZIO. Emitir "2026-01-10" para quem digitou
     "10/1" grava um dia que ninguem escolheu, e uma gravacao errada e pior que
     uma recusa porque ninguem vai olhar.

E o defeito que a issue fechou e justamente do tipo que nao reclama: o controle
nativo lia "10/03" na ordem do APARELHO (mm/dd) e gravava 3 de outubro em vez de
10 de marco. Data valida, plausivel, sem erro nenhum no caminho.

SEM FILTRO DE `paths`, de proposito. A mascara e usada pela tela de lancamento e
vai ser usada pelas outras (a issue irma), e um filtro que liste os arquivos de
hoje perde o dia em que alguem mexer no de amanha. Foi assim que tres suites
deste repositorio ficaram paradas em verde: elas so rodavam no db-verify, que e
filtrado por path.

Roda em segundos e nao precisa de banco.
~~~~~~

## 'A verificacao sabe falhar (data-digitada)'

~~~~~~
Controle negativo. As asercoes da suite sao quase todas igualdades de
string, e igualdade de string continua verde quando o codigo vira outra
coisa por baixo -- desde que a outra coisa produza o mesmo texto nos
exemplos escolhidos. Uma verificacao que nunca viu vermelho nao e
verificacao.

A lista de defeitos, o porque de cada um e a exigencia de vermelho moram
em scripts/mutantes-data-digitada.mjs, e nao num bloco de `sed` aqui: `sed`
que nao casa sai 0 sem mudar nada, entao um mutante desatualizado deixava o
CI vermelho pelo motivo errado -- acusando a mascara em vez do mutante.
~~~~~~

## A mascara, e o valor plano por tras dela

~~~~~~
=======================================================================
A MASCARA MOSTRA REAIS E EMITE NUMERO
origem: dinheiro.yml
=======================================================================
Prova, a cada PR, a mascara de valor (HMO-171) -- e principalmente o lado dela
que nao aparece na tela.

O pedido da issue era de aparencia: "qualquer campo de valor deve ser aplicado
a mascara R$1.000,00". O risco que ele cria e de DINHEIRO. Todo formulario
deste app guarda o valor como string e converte com `Number.parseFloat` na
hora de gravar, e:

  Number.parseFloat("1.000,00")  ->  1

Se o texto mascarado vazar para o estado do formulario, mil reais entram no
banco como um real. Nao ha NaN, nao ha excecao, nao ha nada para um catch
pegar: a tela mostra "R$ 1.000,00", a validacao aprova (1 > 0), e o unico jeito
de descobrir e conferir lancamento por lancamento.

SEM FILTRO DE `paths`, de proposito. A mascara e usada por dez telas em dois
diretorios (lib/dinheiro.ts, components/ui/campo-de-valor.tsx e os
formularios), e um filtro que liste os arquivos de hoje perde o dia em que
alguem mexer no de amanha. Foi assim que tres suites deste repositorio ficaram
paradas em verde: elas so rodavam no db-verify, que e filtrado por path.

Roda em segundos e nao precisa de banco.
~~~~~~

## Escrita sob RLS que nao pegou linha nao sai como sucesso

~~~~~~
ZERO LINHA E FALHA, NAO SUCESSO (HMO-203).

A rota de restaurar grupo respondia HTTP 200 "Grupo restaurado com
sucesso!" com a linha intacta no banco -- medido em producao, antes e
depois. Nao era descuido: a policy de UPDATE filtrava a linha (RLS
FILTRA, nao recusa), o PostgREST devolvia 200 com corpo `[]`, e
`supabase-js` sem `.select()` nao entrega contagem. `data` e `error` vinham
os DOIS nulos, entao `if (error)` nao tinha como disparar.

`lib/escrita-conferida.ts` e o criterio dessas rotas, e a suite afirma
sobre o MOTIVO de cada falha, nao sobre `ok === false`: os tres modos de
falhar precisam continuar sendo tres. Colapsar `sem-select` em
`nenhuma-linha` daria a uma rota mal escrita a aparencia de uma rota
barrada pela RLS, e o conserto iria para a policy em vez do `.select()`.

SEM FILTRO DE `paths`, pela mesma razao do passo acima: o modulo e o
criterio de oito rotas de grupo e vai ser usado por mais. Roda em
segundos e nao precisa de banco.
~~~~~~

## 'A verificacao sabe falhar (dinheiro)'

~~~~~~
Controle negativo. As asercoes da suite sao quase todas igualdades de
string, e igualdade de string continua verde quando o codigo vira outra
coisa por baixo -- desde que a outra coisa produza o mesmo texto nos
exemplos escolhidos. Uma verificacao que nunca viu vermelho nao e
verificacao.

A lista de defeitos, o porque de cada um e a exigencia de vermelho moram
em scripts/mutantes-dinheiro.mjs, e nao num bloco de `sed` aqui. A razao
esta no cabecalho daquele arquivo: `sed` que nao casa sai 0 sem mudar
nada, entao um mutante desatualizado deixava o CI vermelho pelo motivo
errado -- acusando a mascara em vez do proprio mutante.
~~~~~~

## A conta arredonda em decimal e recusa o que o campo nao aceita

~~~~~~
A CALCULADORA DO CAMPO (a mesma issue, o mesmo risco)

Ela mora neste workflow, e nao no db-verify, pela razao do comentario no
topo: aqui nao ha filtro de `paths`. E ela pertence a este job e nao a um
proprio porque compartilha a armadilha da mascara -- o que sai da conta
vai direto para o estado de um formulario que grava com `parseFloat`.
Entregar "1.000,00" em vez de "1000.00" gravaria um real.

Alem disso a conta tem dois erros de dinheiro que so ela tem:
`Math.round(n * 100) / 100` perde o centavo de 1,005 (o double e
1.00499999999999989), e um resultado negativo entregue a um campo de
despesa volta do banco positivo, porque as rotas aplicam `-Math.abs`.
~~~~~~

## A moeda oficial e o periodo separado por moeda

~~~~~~
A moeda oficial, a sugestao por lancamento e o periodo separado por
moeda (partes 2 e 3 da HMO-171). Mora neste workflow, e nao no db-verify,
pelo mesmo motivo da suite acima: o db-verify e filtrado por `database/**`
e nao dispararia num PR que so mexe em lib/moeda.ts ou numa tela.

O ultimo caso da suite `dinheiro` tambem depende de rodar aqui: ele le o
CHECK da migration 022 e compara com `MOEDAS`, porque o catalogo de
moedas passou a ter duas copias (TypeScript e SQL) e elas divergem em
silencio na direcao mais provavel -- moeda nova no seletor que o banco
recusa, e a tela mostra "erro ao salvar".
~~~~~~

## A verificacao da moeda sabe falhar

~~~~~~
Controle negativo da suite de cima. As duas regras que mais importam aqui
sao PRECEDENCIAS -- "o lancamento ganha da conta", "a oficial vem
primeiro" -- e precedencia invertida passa pelo tsc e pelo lint sem nada.
~~~~~~

## O guard reconhece o banco de producao, e so barra no preview

~~~~~~
=======================================================================
PREVIEW NAO APONTA PARA O BANCO DE PRODUCAO
origem: env-preview.yml
=======================================================================
HMO-132: preview deployment da Vercel nao fala com o banco de producao.

Preview de branch tambem e build de producao na Vercel, entao `NODE_ENV` nao
separa os dois -- quem separa e `VERCEL_ENV`. Sem o guard de
utils/supabase/env.ts, abrir um PR publica uma URL que escreve no banco real.

SEM FILTRO DE `paths`, de proposito. O modo de falhar desta regra e a
ausencia de sintoma: se o guard parar de disparar, o preview sobe verde e a
unica pista e um lancamento de teste aparecendo na conta real dias depois.
Um filtro de path so acertaria se quem quebrasse o guard mexesse justamente
em utils/supabase/env.ts, e a quebra mais provavel nao e essa -- e alguem
mexer no fluxo de env por outro arquivo. O teste e aritmetica de string, roda
em segundos e nao precisa de Postgres, entao cabe em todo PR sem virar pedagio.
~~~~~~

## 'A verificacao sabe falhar (env-preview)'

~~~~~~
Controle negativo. Uma verificacao que nunca viu vermelho nao e
verificacao: se o guard virar `return false` constante, os sete testes
acima precisam acusar. Sem este passo, um guard desligado passaria o
workflow inteiro em verde -- que e exatamente o estado que a HMO-132
existe para evitar.
~~~~~~

## As regras de um lancamento

~~~~~~
=======================================================================
RECEITA E DESPESA, CADA UMA COM OS SEUS CAMPOS
origem: lancamento.yml
=======================================================================
Prova, a cada PR, as duas coisas que a HMO-165 separou: as REGRAS de um
lancamento (sinal, categoria, campos obrigatorios) e a ARVORE de cada tela --
receita sem natureza de despesa, sem parcelamento e sem rateio.

SEM FILTRO DE `paths`, e de proposito. O comportamento destas telas nasce de
tres lugares em dois diretorios (lib/lancamento.ts,
components/movimentacoes/*.tsx e os primitivos de components/ui), e um filtro
que liste os de hoje perde o dia em que alguem mexer no de amanha. Foi
exatamente assim que tres suites deste repositorio ficaram paradas em verde:
elas so rodavam no db-verify, que e filtrado por path.

As duas suites renderizam HTML em memoria, rodam em segundos e nao precisam de
banco -- podem ser obrigatorias em todo PR sem virar pedagio.
~~~~~~

## 'A verificacao sabe falhar (lancamento)'

~~~~~~
Controle negativo. As duas suites afirmam sobre AUSENCIA -- "a tela de
receita nao tem parcelamento" -- e uma asercao de ausencia passa verde
tambem quando ela deixa de achar o que deveria procurar. Uma verificacao
que nunca viu vermelho nao e verificacao.

Plantamos os tres defeitos exatos que a separacao corrigiu.
~~~~~~

## O destino de cada linha, e a minha parte do que outros pagaram

~~~~~~
=======================================================================
A LISTA MOSTRA TUDO, E DIZ PARA ONDE O DINHEIRO FOI
origem: lancamentos-completos.yml
=======================================================================
Prova, a cada PR, as duas coisas que a HMO-215 pediu da aba Financas Pessoais
-- "todos os lancamentos, indiferente de onde foi" e "indicar o tipo, o valor,
o destino, a categoria":

  1. O DESTINO de cada linha (lib/destino-do-lancamento.ts). `account_id` esta
     em financial_transactions desde o 001 e nao tinha leitor na lista. Sem
     ele, duas despesas iguais em contas diferentes -- mesmo mercado, mesmo
     valor, mesmo dia, uma no cartao e uma no debito -- ficam IDENTICAS na
     tela, e a leitura natural e que a despesa foi lancada em duplicata. Essa
     leitura termina em alguem apagando uma despesa real.

  2. A MINHA PARTE das despesas de grupo que outra pessoa pagou
     (lib/parte-de-grupo-na-lista.ts). Ela esta gravada em
     group_expense_splits, o painel ja a conta como realizado (migration 033),
     e a lista nunca a mostrou -- o mes de quem nao pagou parecia mais barato
     do que foi.

SEM FILTRO DE `paths`, como o workflow lancamento. As duas suites rodam em
milissegundos e nao precisam de banco, entao podem ser obrigatorias em todo PR
sem virar pedagio -- e um filtro que liste os arquivos de hoje perde o dia em
que alguem mexer no de amanha. Foi exatamente assim que tres suites deste
repositorio ficaram paradas em verde (ver scripts/check-tests-in-ci.mjs).
~~~~~~

## 'A verificacao sabe falhar (lancamentos-completos)'

~~~~~~
Controle negativo. A suite afirma sobre SINAL, sobre CONTAGEM e sobre
SENTIDO -- tres coisas que erram dinheiro na tela sem levantar excecao
nenhuma. Uma verificacao que nunca viu vermelho nao e verificacao.

A prova de mutacao completa e `node scripts/mutantes-lancamentos-completos.mjs`
(26 mutantes, ferramenta de quem escreve o teste). Aqui ficam os quatro
que mais custam, plantados um por vez.
~~~~~~

## Quem pagou aparece na linha, e o perfil invisivel vira rotulo

~~~~~~
=======================================================================
A LINHA DA PARTE DE GRUPO DIZ QUEM PAGOU
origem: HMO-274
=======================================================================
Prova, a cada PR, que a linha da minha parte de uma despesa que OUTRA
pessoa pagou mostra o nome dessa pessoa -- e que, quando o perfil nao e
legivel, ela mostra um ROTULO escrito no lugar do nome.

O caminho sem nome nao e excepcional: as policies de SELECT de `profiles`
sao `id = auth.uid()`, `is_public = TRUE` (002) e "conexao aceita" (010),
e NENHUMA olha `group_members`. Dividir a conta com alguem nao da acesso
ao perfil dele, e o PostgREST nao levanta erro nesse caso -- devolve
menos linhas. Entao o fallback roda em producao, e o defeito a evitar e
ele sair em branco: uma linha de parte sem nenhuma mencao a outra pessoa
se le como despesa PROPRIA.

SEM FILTRO DE `paths`, pelo mesmo motivo do `lancamentos-completos`: a
suite roda em milissegundos, nao precisa de banco, e um filtro que liste
os arquivos de hoje perde o dia em que alguem mexer no de amanha.
~~~~~~

## 'A verificacao sabe falhar (pagador-da-parte)'

~~~~~~
Controle negativo. A suite afirma sobre o CONTEUDO de um elemento -- e
uma assercao por presenca de palavra passaria com o selo inexistente,
porque o nome do grupo tambem sai no HTML. Tres mutantes plantados um por
vez, cada um com a trava do `cmp`: um `sed` que nao casa sai com status 0
e o mutante seria dado por morto sem nunca ter existido.
~~~~~~

## Um controle na tela por vez, e o X so com a gaveta aberta

~~~~~~
=======================================================================
O X APARECE SO COM O MENU ABERTO
origem: menu-mobile.yml
=======================================================================
Prova, a cada PR, a regra que a HMO-161 pediu em uma linha: existe X na tela
quando, e somente quando, o menu do celular esta aberto.

O bug que originou isto era invisivel para todo o resto do CI. O X da gaveta
era renderizado sempre e posicionado FORA dos limites do painel; com a gaveta
fechada, a translacao levava o painel para fora da tela e o botao reaparecia
em cima do hamburguer do header. Compila, nao ha erro de runtime, nenhum teste
reclama -- o unico sintoma e visual, e so no celular.

SEM FILTRO DE `paths`, pelo mesmo motivo do configuracoes.yml: o cromo do menu
depende de tres arquivos em dois diretorios (components/MobileMenuChrome.tsx,
components/ui/button.tsx e lib/utils.ts), e o botao do header vive num quarto.
Um filtro que liste os tres perde o dia em que alguem mexer no quarto. O teste
renderiza HTML em memoria, roda em segundos e nao precisa de banco, entao pode
ser obrigatorio em todo PR sem virar pedagio.
~~~~~~

## A verificacao do menu sabe falhar

~~~~~~
Controle negativo. O teste renderiza o componente e conta icones no
HTML -- ou seja, ele passa a sair VERDE se parar de achar o que deveria
contar. Uma verificacao que nunca viu vermelho nao e verificacao.

Plantamos aqui os dois defeitos que a HMO-161 corrigiu, nas formas
exatas em que eles existiam, e exigimos vermelho nos dois.

Cada defeito passa por `planta`, que CONFERE que o sed mexeu no arquivo
antes de rodar a suite. Sem essa conferencia, um padrao que para de
casar -- porque alguem editou a linha por um motivo legitimo -- deixa o
arquivo intacto, a suite sai verde como deve e o controle acusa
"passou verde com o defeito", apontando o dedo para a suite. Foi o que
aconteceu entre a HMO-185 (que trocou `pt-3` pelo calculo do recorte do
iPhone) e a HMO-199: 57 runs vermelhos seguidos, na main inclusive, por
um defeito que nunca foi plantado. Vermelho mentiroso e pior que check
ausente, porque ensina a mergear por cima do vermelho.
~~~~~~

## O cartao do orcamento de grupo, renderizado

~~~~~~
=======================================================================
A BARRA DA VIAGEM E A MESMA NAS DUAS TELAS
origem: orcamento-de-grupo.yml (job `cartao`)
=======================================================================
Prova, a cada PR, que a barra "quanto ja gastamos da viagem" desenha a MESMA
coisa nas duas telas que a mostram: a aba Grupo de Orcamento (HMO-138) e a
tela do grupo (HMO-180).

O erro que este workflow existe para pegar nao quebra nada. Se alguem refizer
a soma dentro do JSX de uma das duas, os numeros batem no dia do commit e
divergem no dia em que uma das duas mudar -- e o sintoma e duas telas
mostrando percentuais diferentes para a mesma viagem, sem erro no console,
sem teste vermelho, e sem que quem olha tenha como saber qual das duas esta
certa. Por isso o desenho mora em um arquivo so e este job afirma sobre o HTML
que sai dele.

SEM FILTRO DE `paths`, e de proposito, pelo mesmo motivo do contas.yml: o que
a barra mostra nasce de tres lugares em dois diretorios
(lib/orcamento-de-grupo.ts, components/financial/CartaoOrcamentoGrupo.tsx e os
primitivos de components/ui), e um filtro que liste os de hoje perde o dia em
que alguem mexer no de amanha. Foi exatamente assim que tres suites deste
repositorio ficaram paradas em verde: elas so rodavam no db-verify, que e
filtrado por path.

A suite renderiza HTML em memoria, roda em segundos e nao precisa de banco --
pode ser obrigatoria em todo PR sem virar pedagio. A suite da CONTA
(test:orcamento-de-grupo) continua no db-verify, junto das outras funcoes
puras de dinheiro.
~~~~~~

## As regras da serie de parcelas

~~~~~~
=======================================================================
PARCELA N DE M, COM BASE PARCELA OU TOTAL
origem: parcelamento.yml
=======================================================================
A compra parcelada no cartao (HMO-211), que e a Fase 4 da HMO-208.

POR QUE ELA MERECE VERIFICACAO PROPRIA
------------------------------
Sao quatro entradas que se combinam -- o valor, se ele e da parcela ou do
total, o N e o M de "parcela N de M" -- e TODO jeito errado de combina-las
grava dinheiro plausivel. Ler o valor como total em vez de parcela divide a
compra por dez. Trocar N por M cria a serie ao contrario. Um off-by-one no laco
poe uma parcela a mais numa fatura de um mes que ainda nao chegou. Nenhum
desses da erro, e a tela que os produz nao mostra nenhum deles.

A suite pura e os mutantes rodam em segundos e nao precisam de banco. A parte
que precisa -- a parcela aparecendo na fatura do mes certo, e as parcelas
anteriores NAO existindo -- esta no db-verify, no teste da 035.

SEM FILTRO DE `paths`, pelo mesmo motivo do cartoes.yml: o comportamento nasce
de lib/lancamento.ts, do componente de campos, da rota de parcelas e da tela da
fatura, e um filtro que liste os de hoje perde o dia em que alguem mexer no de
amanha.
~~~~~~

## Os mutantes da serie

~~~~~~
OS MUTANTES. A suite acima passando nao diz, sozinha, que ela esta
medindo o que a justificativa dela afirma. Cada mutante quebra UMA decisao
e tem de reprovar alguma assercao.

Medido na HMO-211 ao escrever isto: 16 mutantes, 16 mortos, todos por
assercao e nenhum so pelo compilador. O proprio runner falha se nenhum
mutante morrer por assercao -- uma suite vazia tiraria placar perfeito.
~~~~~~

## Os mutantes do campo de parcelas

~~~~~~
O CAMPO DE PARCELAS QUE DEIXA APAGAR O "1" (HMO-226), E POR QUE ELE TEM
RUNNER PROPRIO

O conserto mora em `onChange`, `onFocus` e `onBlur`, e
`renderToStaticMarkup` nao chama nenhum dos tres -- eles nao saem no
HTML. Toda assercao sobre o markup e, por isso, cega para ele: o `|| 1`
pode voltar ao `onChange` e o `value=""` do teste de render continua
saindo igual, porque o estado exibido e escolhido pelo teste. Sem este
runner, o mutante central da issue sobrevive com a assercao "certa" verde
ao lado dele.

Medido na HMO-226 ao escrever isto, em 88s: 12 mutantes, 12 mortos, 10
por assercao. Os outros 2 so compilavam com os campos voltando a ser
`number`, e morrer no `tsc` ali e a prova de que a troca de tipo carrega
peso. O runner reprova sozinho se NENHUM morrer por assercao.
~~~~~~

## Os mutantes da subcategoria nas parcelas

~~~~~~
A SUBCATEGORIA NA SERIE (HMO-218), E POR QUE ELA TEM RUNNER PROPRIO

A divida que a HMO-216 deixou aberta era "falta `subcategory_id` em
`transaction_installments`". Ela mudou de lugar: a HMO-211 reescreveu
esta rota, a RPC `create_installments` perdeu o ultimo chamador do app e
a serie nova vira linhas de `financial_transactions` -- tabela que JA tem
a coluna e a FK composta da 036. O que faltava era a rota COPIAR o campo.

Nenhum dos runners acima pega isso: `mutantes:parcelamento` mede valor,
data e numero da parcela, e um campo a mais ou a menos no objeto do
`insert` nao muda nada do que eles asseveram. O `tsc` tambem nao -- o
campo entra num objeto literal que vai para o supabase-js, e apagar a
linha compila.

Medido na HMO-218 ao escrever isto, em 10s: 8 mutantes, 8 mortos. Dois
deles sao o controle negativo da entrega (a rota volta a descartar o
campo; a tela volta a nao manda-lo), e o da tela so morre porque a
assercao recorta o corpo do `fetch`: o arquivo tem outras duas
ocorrencias de `subcategory_id:`, e um guard de arquivo inteiro ficava
verde com o defeito de pe.
~~~~~~

## Os mutantes da despesa publicada no grupo

~~~~~~
HMO-356. O que `test:despesa-publicada-no-grupo` promete e que a rota de
despesa de grupo deixe de responder SUCESSO quando o UPDATE que publica
`group_id` nao pega linha nenhuma -- o silencio da HMO-203 nesta rota, e
com consequencia pior: sem a coluna, a policy de SELECT de
financial_transactions esconde a despesa de todos os outros membros, e o
grupo divide uma conta que metade dele nao ve.

Nenhuma outra suite alcanca isso. `test:escrita-conferida` prova a FUNCAO
e nao a fiacao; `test:divisao-do-grupo` prova a aritmetica do 70/30 e
nunca ve a resposta HTTP; e o `tsc` nao ve nada, porque o conserto e uma
chamada a mais num `await` cuja forma nao muda.

Medido na HMO-356 ao escrever isto: 8 mutantes, 8 mortos. O primeiro e o
controle negativo da entrega, e ele apaga o RAMO DE ERRO deixando
`conferirEscrita` e `.select("id")` no arquivo -- entao ele e tambem a
prova de que um guard textual nao serviria: o arquivo passou a ter duas
chamadas de `conferirEscrita` com proposito oposto, e `includes` fica
verde matando a que importa.

O que o UPDATE SEM `.eq` ensinou: ele SOBREVIVEU na primeira medicao,
porque a sonda semeava uma linha so e "esta despesa" e "todas as
despesas" eram o mesmo conjunto. Morreu depois de o fixture ganhar uma
despesa PESSOAL vizinha -- a linha que um UPDATE sem filtro arrastaria
para dentro do grupo.
~~~~~~

## Os mutantes do portao de conexao

~~~~~~
HMO-373. O controle negativo de `test:portao-de-conexao`, e o primeiro
mutante da lista e o que a issue pede nominalmente: o filtro da busca
voltando a ser `.eq("allow_connections", true)`, ou seja o estado exato
da `main`, em que o perfil com a coluna NULA fica invisivel.

Esse mutante mora no CALL SITE da rota, e nao no corpo de
`aplicarPortaoDeConexao`, e a razao e que mutar o helper NAO MEDIRIA
NADA: o parametro dele e generico (`Q extends { not(...): Q }`), entao
trocar `.not(...)` por `.eq(...)` ali morre no `tsc` do passo de
compilacao em vez de morrer numa assercao -- e mutante morto pelo
compilador conta erro de tipo como cobertura. No call site o
encadeamento e o do supabase-js de verdade, onde o `.eq` tipa, compila e
roda; quem o mata e a assercao.

A familia que mais vale aqui e a do E-MAIL. `get_user_by_email` (001) e
SECURITY DEFINER e nao sabe de `is_public` nem de `allow_connections`:
ela devolve QUALQUER conta confirmada. Por isso a rota a usa so para
resolver o `id` e RELE `profiles` com os dois portoes -- e os tres
mutantes que tiram um portao da releitura, ou que devolvem a linha da
RPC direto, transformam a busca num oraculo de "este e-mail tem conta no
app". Um deles tambem prova que o e-mail devolvido pela funcao e
descartado: se ele vazasse para o corpo, a busca por NOME passaria a
entregar o e-mail de quem ela achou.

Medido na HMO-373 ao escrever isto: 14 mutantes, 14 mortos.
~~~~~~

## Os mutantes da subcategoria no POST de lancamento

~~~~~~
HMO-224, a irma da de cima na OUTRA rota: o POST de
/api/personal-finance/transactions nao lia `subcategory_id` do corpo e
nao o listava no INSERT. As assercoes de `test:movimentacoes` sobre esta
rota falam de tipo e sinal (HMO-181) e nao distinguem um campo a mais ou
a menos no objeto do `insert`; o `tsc` tambem nao, porque o corpo e
`any` e o objeto literal esta na fronteira do supabase-js.

Medido na HMO-224 ao escrever isto: 9 mutantes, 9 mortos. O primeiro e o
controle negativo da entrega (a rota volta a descartar o campo, que e
literalmente o estado de antes da issue). O segundo apaga o campo do
destructuring e morre no COMPILADOR -- abate legitimo, e a prova de que
as duas metades do conserto estao amarradas.

O ultimo e o conserto zeloso: a rota passa a conferir o par
(category_id, subcategory_id) em TypeScript e cai para null quando nao
acha. Isso recria o defeito original -- subcategoria sumindo em
silencio, com 201 -- e e por isso que ele esta medido: o arbitro do par
e a FK composta da 036, validada em prod.
~~~~~~

## 'A verificacao sabe falhar (parcelamento)'

~~~~~~
Controle negativo. As assercoes mais importantes desta feature sao de
AUSENCIA ("as parcelas 1 e 2 NAO foram criadas", "a compra avulsa NAO
ganha rotulo"), e assercao de ausencia passa verde tambem quando ela
deixa de achar o que deveria procurar. Os mutantes acima cobrem
lib/lancamento.ts; estes dois cobrem o que esta fora dele.
~~~~~~

## O recurso de sinais aparece como "em breve", e o texto antigo sumiu

~~~~~~
=======================================================================
A PAGINA DE PLANOS NAO ANUNCIA RECURSO QUE NAO EXISTE
origem: planos.yml
=======================================================================
Prova, a cada PR, que a interface nao volta a vender um recurso que nao
existe (HMO-198).

A pagina publica de Planos anunciava sinal de trading em tempo real como
recurso incluido no plano de R$ 79,90/mes, sem tabela, rota nem origem de dado
por tras. Nao e divida tecnica comum -- e promessa comercial com preco ao
lado. O conserto foi o rotulo ("em breve"), nunca o recurso, porque
recomendacao de compra e venda e atividade regulada pela CVM.

SEM FILTRO DE `paths`, e a razao aqui e mais forte que a do configuracoes.yml.
Uma das assercoes varre app/, components/, lib/ e types/ INTEIROS atras da
frase antiga -- e a rede que pega o canto que ninguem lembrou de renderizar,
porque o texto vivia em dois mapas separados e ninguem garante que nao vai
nascer um terceiro. Um filtro de path tornaria essa varredura decorativa: o
arquivo novo com a frase antiga nao casaria com padrao nenhum, o job seria
pulado, e o PR ficaria verde com a promessa de volta na tela.

A suite renderiza com react-dom/server, roda em segundos e nao precisa de
Postgres -- cabe como obrigatoria em todo PR sem virar pedagio.
~~~~~~

## 'A verificacao sabe falhar (planos)'

~~~~~~
Controle negativo. A suite acima e quase toda de assercao NEGATIVA
("este texto nao esta na tela"), e assercao negativa e o tipo que passa
verde quando para de enxergar o alvo -- basta o seletor deixar de casar,
ou a pagina deixar de renderizar, para tudo ficar ausente e portanto
aprovado. Plantamos a promessa de volta e exigimos vermelho.
~~~~~~

## Assets do manifest, do layout e do browserconfig

~~~~~~
=======================================================================
TODO ASSET DECLARADO EXISTE E E O QUE DIZ SER
origem: pwa-assets.yml (job `assets`)
=======================================================================
Prova, a cada mudanca no codigo, que o app continua INSTALAVEL no celular.

O modo de falha aqui foi o mais silencioso que este projeto ja teve. Os dez
arquivos de `public/icons/*.png` eram documentos SVG com nome `.png`, e o
`favicon.ico` tambem. Nada reclamava:

  * a Vercel escolhe o `Content-Type` pela EXTENSAO, entao ela servia os
    arquivos como `image/png` com HTTP 200 -- o servidor concordava;
  * o manifest declarava `"type": "image/png"` -- o manifest concordava;
  * `next build`, `tsc` e o lint nao olham dentro de arquivo em `public/`.

E o Chrome no Android so oferece instalar quando consegue DECODIFICAR um
icone de 192px ou mais do manifest; ele nao aceita SVG nesse papel. Como
nenhum dos dez decodificava, o evento `beforeinstallprompt` nunca era
emitido e o banner "Instalar Pulo do Gato" -- escrito, correto e commitado --
nunca aparecia. O app nao podia ser instalado, e a unica evidencia disso era
a ausencia de um banner que ninguem sabia que deveria estar la.

Junto com os icones havia catorze caminhos declarados para arquivos que nunca
existiram (sete telas de abertura do iOS, `/logo_pulodogato.svg`, os icones
dos atalhos, as capturas de tela) e dois atalhos apontando para rotas sem
`page.tsx`. Nenhum deles quebra build: um `<link>` morto nao gera erro.

SEM FILTRO DE `paths`, de proposito. A regressao nasce de qualquer lado --
trocar um icone, renomear uma rota que um atalho cita, acrescentar um
`<link>` no layout. A verificacao e Node puro e roda em segundos, entao pode
ser obrigatoria em todo PR sem virar pedagio.
~~~~~~

## 'A verificacao sabe falhar (pwa-assets)'

~~~~~~
Controle negativo. Uma verificacao que nunca viu vermelho nao e
verificacao -- e esta, em particular, passaria verde se parasse de
achar os arquivos que deve conferir.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao sabe falhar (pwa-assets)"'

~~~~~~
Prova que os icones commitados sao os que o gerador produz hoje. Sem
isto, alguem pode editar um icone a mao e o proximo `npm run
generate-pwa-icons` desfaz a edicao sem aviso -- ou, pior, o gerador
quebra e ninguem descobre ate precisar dele.

`--check` compara os PIXELS decodificados, nao os bytes do arquivo: o
tamanho do fluxo deflate muda com a versao do zlib, entao `git diff`
daria vermelho sempre que o Node do CI diferisse do de quem gerou --
um vermelho sem defeito atras, que ensina todo mundo a ignorar o job.
~~~~~~

## iOS recebe instrucao, Android recebe o prompt, instalado nao recebe nada

~~~~~~
=======================================================================
O CONVITE DE INSTALACAO APARECE NA PLATAFORMA CERTA
origem: pwa-assets.yml (job `convite`)
=======================================================================
Prova, a cada mudanca no codigo, que o app continua INSTALAVEL no celular.

O modo de falha aqui foi o mais silencioso que este projeto ja teve. Os dez
arquivos de `public/icons/*.png` eram documentos SVG com nome `.png`, e o
`favicon.ico` tambem. Nada reclamava:

  * a Vercel escolhe o `Content-Type` pela EXTENSAO, entao ela servia os
    arquivos como `image/png` com HTTP 200 -- o servidor concordava;
  * o manifest declarava `"type": "image/png"` -- o manifest concordava;
  * `next build`, `tsc` e o lint nao olham dentro de arquivo em `public/`.

E o Chrome no Android so oferece instalar quando consegue DECODIFICAR um
icone de 192px ou mais do manifest; ele nao aceita SVG nesse papel. Como
nenhum dos dez decodificava, o evento `beforeinstallprompt` nunca era
emitido e o banner "Instalar Pulo do Gato" -- escrito, correto e commitado --
nunca aparecia. O app nao podia ser instalado, e a unica evidencia disso era
a ausencia de um banner que ninguem sabia que deveria estar la.

Junto com os icones havia catorze caminhos declarados para arquivos que nunca
existiram (sete telas de abertura do iOS, `/logo_pulodogato.svg`, os icones
dos atalhos, as capturas de tela) e dois atalhos apontando para rotas sem
`page.tsx`. Nenhum deles quebra build: um `<link>` morto nao gera erro.

SEM FILTRO DE `paths`, de proposito. A regressao nasce de qualquer lado --
trocar um icone, renomear uma rota que um atalho cita, acrescentar um
`<link>` no layout. A verificacao e Node puro e roda em segundos, entao pode
ser obrigatoria em todo PR sem virar pedagio.
~~~~~~

## O service worker carimba a resposta que veio do aparelho

~~~~~~
=======================================================================
SEM REDE, A TELA NAO AFIRMA O QUE NAO SABE
origem: pwa-assets.yml (job `leitura-honesta`)
=======================================================================
Prova, a cada mudanca no codigo, que o app continua INSTALAVEL no celular.

O modo de falha aqui foi o mais silencioso que este projeto ja teve. Os dez
arquivos de `public/icons/*.png` eram documentos SVG com nome `.png`, e o
`favicon.ico` tambem. Nada reclamava:

  * a Vercel escolhe o `Content-Type` pela EXTENSAO, entao ela servia os
    arquivos como `image/png` com HTTP 200 -- o servidor concordava;
  * o manifest declarava `"type": "image/png"` -- o manifest concordava;
  * `next build`, `tsc` e o lint nao olham dentro de arquivo em `public/`.

E o Chrome no Android so oferece instalar quando consegue DECODIFICAR um
icone de 192px ou mais do manifest; ele nao aceita SVG nesse papel. Como
nenhum dos dez decodificava, o evento `beforeinstallprompt` nunca era
emitido e o banner "Instalar Pulo do Gato" -- escrito, correto e commitado --
nunca aparecia. O app nao podia ser instalado, e a unica evidencia disso era
a ausencia de um banner que ninguem sabia que deveria estar la.

Junto com os icones havia catorze caminhos declarados para arquivos que nunca
existiram (sete telas de abertura do iOS, `/logo_pulodogato.svg`, os icones
dos atalhos, as capturas de tela) e dois atalhos apontando para rotas sem
`page.tsx`. Nenhum deles quebra build: um `<link>` morto nao gera erro.

SEM FILTRO DE `paths`, de proposito. A regressao nasce de qualquer lado --
trocar um icone, renomear uma rota que um atalho cita, acrescentar um
`<link>` no layout. A verificacao e Node puro e roda em segundos, entao pode
ser obrigatoria em todo PR sem virar pedagio.
~~~~~~

## A peneira da origem e o reset do formulario

~~~~~~
=======================================================================
PARA ONDE VOLTA, E O QUE FICA NA TELA
origem: retorno-do-lancamento.yml
=======================================================================
Prova, a cada PR, as duas metades da HMO-249: para onde o modal de lancamento
volta depois de salvar, e o que o "Salvar e continuar" deixa na tela.

AS TRES COISAS QUE ESTA SUITE IMPEDE, E NENHUMA LEVANTA EXCECAO
---------------------------------------------------------------
  1. REDIRECIONAMENTO ABERTO. O `?origem=` vem da URL. Empurrar para ele sem
     peneirar faz o proprio app levar a pessoa para um host de fora logo DEPOIS
     de ela confirmar um lancamento -- o instante em que ela mais confia na
     tela. `//golpe.example` e o caso traicoeiro: ele comeca com `/`, entao a
     guarda obvia (`startsWith("/")`) aprova e o navegador sai do dominio.

  2. O MESMO GASTO GRAVADO DUAS VEZES. Com "Salvar e continuar" ligado, a tela
     nao fecha. Se `valor` e `descricao` ficarem preenchidos, UM segundo clique
     em Salvar grava o lancamento de novo -- dois registros identicos, nada na
     tela dizendo que foram dois, e o saldo da conta errado pelo valor inteiro.
     Na transferencia custa o dobro, porque sao duas pernas (migration 015).

  3. A VOLTA PARA A TELA ERRADA. A origem carrega a query (`?de=&ate=`), que e
     o periodo escolhido. Perde-la devolve a pessoa ao mes corrente depois de
     ela lancar uma despesa de janeiro: a despesa esta gravada e fora da tela,
     que se le exatamente como "nao salvou".

SEM FILTRO DE `paths`, como os workflows `lancamento` e `telas-de-movimentacao`.
A suite roda em milissegundos e nao precisa de banco, entao pode ser
obrigatoria em todo PR sem virar pedagio -- e um filtro que liste os arquivos
de hoje perde o dia em que alguem mexer no de amanha. Foi assim que tres suites
deste repositorio ficaram paradas em verde (ver scripts/check-tests-in-ci.mjs).
~~~~~~

## 'A verificacao sabe falhar (retorno-do-lancamento)'

~~~~~~
Controle negativo. A suite afirma sobre STRINGS DE ROTA e sobre CAMPOS
DE FORMULARIO -- as duas coisas que passam verdes por acaso com mais
facilidade: "o destino e /dashboard/personal-finance" continua
verdadeiro numa funcao que devolve aquela constante SEMPRE, isto e, numa
funcao que desfaz a issue inteira.

A prova de mutacao completa e `npm run mutantes:retorno-lancamento`
(31 mutantes, ferramenta de quem escreve o teste). Aqui ficam os seis
que mais custam, plantados um por vez.
~~~~~~

## A aritmetica das tres telas

~~~~~~
=======================================================================
TOTAL, PREVISTO E REALIZADO DE CADA TIPO
origem: telas-de-movimentacao.yml
=======================================================================
Prova, a cada PR, a aritmetica das tres telas que a HMO-246 pediu -- uma so de
receitas, uma so de despesas, uma so de transferencias, cada uma com Total,
Previsto e Realizado do periodo escolhido.

As cinco armadilhas estao no cabecalho de lib/telas-de-movimentacao.ts, e as
cinco produzem um numero PLAUSIVEL:

  1. previsto (+) e realizado (-) tem sinal OPOSTO e se cancelam: a tela de
     Despesas fecha o mes em R$ 0,00 com as duas despesas na lista ao lado;
  2. a conta prevista com baixa ja virou transacao e esta no lado realizado --
     somar as duas da R$ 319,80 de uma conta de R$ 159,90;
  3. a transferencia e gravada em DUAS pernas com a mesma data: contar as duas
     faz um Pix de R$ 1.000 virar R$ 2.000, e a lista mostra as duas linhas;
  4. a perna de saida de uma transferencia e negativa e tem categoria de
     despesa -- quem filtrar por SINAL poe todo Pix entre contas proprias no
     total de despesas do mes;
  5. a compra no cartao esta DENTRO da fatura, e o lado previsto soma a fatura
     inteira: contar a compra tambem no realizado faz uma compra de R$ 400
     fechar o mes em R$ 800, com as duas linhas visiveis na lista (HMO-260).

Nenhuma delas levanta excecao, nenhuma aparece no tsc, e quatro delas deixam a
lista visivelmente coerente com o total errado.

SEM FILTRO DE `paths`, como os workflows `lancamento` e
`lancamentos-completos`. As duas suites rodam em milissegundos e nao precisam
de banco, entao podem ser obrigatorias em todo PR sem virar pedagio -- e um
filtro que liste os arquivos de hoje perde o dia em que alguem mexer no de
amanha. Foi exatamente assim que tres suites deste repositorio ficaram paradas
em verde (ver scripts/check-tests-in-ci.mjs).
~~~~~~

## Qual numero sai em qual cartao

~~~~~~
A aritmetica acima pode estar exata e a tela imprimir o previsto no
cartao "Realizado": os dois numeros sao plausiveis, nada fica vazio e
nenhuma das 34 assercoes puras olha a marcacao. Este passo renderiza os
tres cartoes com react-dom/server e le o HTML -- incluindo os estados em
que o numero NAO pode aparecer, que e propriedade da marcacao e nao da
funcao.
~~~~~~

## Os nomes dos campos entre a rota e a tela

~~~~~~
O calculo e a marcacao podem estar os dois certos e a tela mostrar
R$ 0,00: `await res.json()` e `any`, entao um campo renomeado entre a
rota e o componente nao e checado pelo tsc. Chega `undefined`, o `??`
vira zero.
~~~~~~

## O contrato dos cartoes sabe falhar

~~~~~~
Controle negativo DO CONTRATO (HMO-250). O passo acima e um guard
textual, e guard textual tem duas mortes silenciosas: ficar vermelho por
motivo errado, ou ficar VERDE POR AUSENCIA.

As duas aconteceram aqui. A HMO-246 levou os tres numeros para
CartoesDaTela.tsx e as assercoes ficaram apontadas para
TelaDeMovimentacao.tsx -- 2 de 8 vermelhas na main, e sem Actions
ninguem viu. E depois de apontadas para o arquivo certo, o pedagio
`podeMostrarNumero(estado) && resumo` era afirmado por um `assert.match`
solto, que se contentava com UM dos dois pontos de uso: apagar o de
dentro de `numero()` pintava os TRES cartoes de R$ 0,00 sem leitura
nenhuma e esta suite seguia verde.

O runner planta um defeito por vez (campo renomeado, pedagio apagado,
travessao apagado) e exige vermelho em cada um -- com controle
positivo proprio, a arvore intacta tem de estar verde ANTES, senao
todo mutante "morreria" por motivo errado. A mutacao vai para uma
SOMBRA em /tmp (`criarBlocoDeMutantes`, oraculo): a arvore rastreada
nunca e tocada, entao nao ha passo de restauro a conferir depois
(HMO-348 -- antes mutava CartoesDaTela.tsx no lugar).
~~~~~~

## 'A verificacao sabe falhar (telas-de-movimentacao)'

~~~~~~
Controle negativo. A suite afirma sobre SINAL, sobre CONTAGEM e sobre
TIPO -- tres coisas que erram dinheiro na tela sem levantar excecao
nenhuma. Uma verificacao que nunca viu vermelho nao e verificacao.

A prova de mutacao completa e `npm run mutantes:telas-de-movimentacao`
(75 mutantes, ferramenta de quem escreve o teste). Aqui ficam os cinco
que mais custam, um por armadilha, plantados um por vez.
~~~~~~

## 'A arvore voltou ao lugar depois de "A verificacao sabe falhar (telas-de-movimentacao)"'

~~~~~~
O MESMO CONTROLE PARA A MARCACAO. Os dois defeitos que a aritmetica
aprova: o numero certo no cartao errado, e o zero confiante.
~~~~~~

## O icone, o rotulo e o href da linha

~~~~~~
=======================================================================
O ICONE, O ROTULO E O CLIQUE DA LINHA (HMO-287)
=======================================================================
"Nas despesas, deveria ter um icone ou algo do genero mostrando a
categoria da despesa."

A HMO-285 fez `natureza` e `fatura` existirem, com 50 blocos de unidade
e 40 mutantes. Toda aquela suite passa verde com a MARCACAO ignorando os
dois campos: a linha de fatura desenhada igual a uma despesa comum nao
quebra build, nao fica vazia e nao muda numero nenhum.
~~~~~~

## A verificacao da linha sabe falhar

~~~~~~
Controle negativo. Os cinco defeitos abaixo tem o mesmo formato: a tela
continua inteira, o valor ao lado continua certo, e nada fica vermelho.
~~~~~~

## Quais acoes cada estado de linha ganha

~~~~~~
=======================================================================
EDITAR, EXCLUIR E CONFIRMAR EM TODO LANCAMENTO (HMO-301)
=======================================================================
"E em ambos os modos verificar pois todos lancamentos devem ter botoes
de editar, excluir ou confirmar pra validar que foi pago ou recebido."

Tres passos, e os tres medem coisas que os outros dois nao alcancam:

  test:acoes-da-linha  -- a REGRA (quais botoes, para onde cada um vai,
                          e o texto de cada pergunta). Os cinco modos de
                          falha dela produzem o MESMO resultado na tela
                          (um botao que aparece) e se separam so depois
                          do clique: 404 da chave sintetica da fatura
                          aberta, 409 da fatura sem conta pagadora, a
                          segunda perna do mesmo dinheiro, a perna de
                          transferencia orfa, e o caro -- a linha de
                          outro membro do grupo, onde o UPDATE recusado
                          pela RLS volta 200 SEM ALTERAR NADA;
  test:secao-da-tela   -- a MARCACAO, que o passo acima ja roda;
  test:lista-na-tela   -- o GESTO, em navegador. Ver abaixo.
~~~~~~

## A verificacao das acoes sabe falhar

~~~~~~
Controle negativo. Cada mutante abaixo e uma das cinco regras removida,
e as cinco falham do mesmo jeito: a tela continua inteira.
~~~~~~

## Confirmar move a linha de Previsto para Realizado

~~~~~~
O GESTO, em navegador de verdade. As duas suites acima passam verde com o
`onClick` VAZIO -- `onClick` nao sai no HTML e nunca e chamado por um
render de servidor, e a tela sai identica.

E o que se mede aqui NAO e "a rota foi chamada": e que A LINHA SAIU de
"Previsto no periodo" e APARECEU em "Realizado no periodo". Essa e a
unica assercao que distingue "chamou a rota" de "o app refletiu o
resultado" -- um aoConfirmar que chamasse a baixa e esquecesse a
releitura responde 200, move o dinheiro no banco, e deixa a linha onde
estava ate alguem trocar de mes e voltar. A pessoa clica de novo, e a
segunda baixa volta 409 em cima de uma operacao que deu certo.

A sonda tambem substitui `window.confirm` e LE a frase que o app passou:
e assim que "o dialogo diz qual das duas coisas vai acontecer" (tirar a
ocorrencia de um gasto fixo da agenda NAO e encerrar a serie) deixa de
ser uma promessa de comentario. As duas respondem 200 e as duas tiram a
linha da tela.

Sem navegador a suite FALHA, e nao pula: suite que se desliga sozinha e
indistinguivel de suite que passou.
~~~~~~

## A sonda do gesto sabe falhar

~~~~~~
Controle negativo da sonda de navegador. Os dois defeitos abaixo sao os
que SO ela ve.
~~~~~~

## O Fluxo de Caixa avisa que o numero e copia do aparelho

~~~~~~
=======================================================================
O FLUXO DE CAIXA DIZ QUANDO O NUMERO E COPIA DO APARELHO
origem: HMO-401 (sai da HMO-400)
=======================================================================
"ao apagar uma receita, ela continua aparecendo no fluxo de caixa" -- e a
medicao em producao mostrou que o servidor apaga certo nas tres formas de
receita. O caminho que sobrou e este, e ele explica o sintoma relatado
SEM nenhum erro de servidor:

o service worker guarda as respostas de `/api/` por SETE dias e serve a
copia guardada quando o servidor passa de dez segundos
(`lib/pwa-runtime-cache.js`). `/api/cash-flow` materializa a agenda antes
de somar e faz seis consultas -- e a leitura mais pesada do app, a com a
maior chance de estourar os dez segundos num celular. A copia chega com
`resposta.ok` verdadeiro e todo campo no lugar: do lado do React nao ha o
que a distinga, a nao ser o carimbo.

Cinco telas ja leem o carimbo e escrevem o aviso. O Fluxo de Caixa era a
unica tela PESADA que nao -- ela fazia `fetch` cru e a previsao de ontem
entrava pelo caminho de SUCESSO, com a data do mergulho anunciada e nada
na tela dizendo de quando era.

`test:pwa-runtime-cache` e `test:offline-leitura` ficam VERDES com a tela
calada: um prova que o service worker carimba, o outro que
`classificarLeitura` le o carimbo. Era a TELA que nao tinha prova.

Sem navegador a suite FALHA, e nao pula: suite que se desliga sozinha e
indistinguivel de suite que passou.
~~~~~~

## A sonda do aviso de copia sabe falhar

~~~~~~
Controle negativo. Aqui ele e METADE do assunto, e nao um apendice: o
defeito simetrico do silencio e a faixa que aparece SEMPRE, e esse nao
tem sintoma nenhum -- a faixa vira moldura, a pessoa para de ler, e o dia
em que o numero for velho de verdade ela nao vai olhar. Os mutantes 1 e 2
sao esse par, plantados na MESMA linha, em direcoes opostas.
~~~~~~

## O cartao no Realizado do painel

~~~~~~
=======================================================================
O CARTAO CONTA PELA FATURA PAGA, NAO PELA COMPRA
origem: HMO-265 (nasceu aqui -- ver o item 1 do cabecalho deste arquivo)
=======================================================================
"Despesa do cartao so e realizada quando fatura do cartao e paga, usar o
valor total do cartao como parametro pra saber se ja foi realizada ou
nao."

A tela de Despesas ja seguia essa regra (HMO-260). O painel nao: o
Realizado dele soma `financial_transactions`, e ali a compra no cartao
era uma despesa como qualquer outra, contada no dia da COMPRA.

AS DUAS METADES SAO UMA SO MUDANCA, e e por isso que um passo so nao
bastaria: tirar a compra sem por a fatura faz o mes em que a fatura foi
paga sair R$ 1.290 MAIS BARATO (um total menor nao parece erro, parece um
mes barato -- HMO-264), e por a fatura sem tirar a compra faz o cartao
contar DUAS vezes (a HMO-149 de volta). Os dois numeros errados sao
plausiveis e nenhum levanta excecao.

DESDE A FASE 6 (072, RN017.3 e RN017.4) a fatura conta no mes do
VENCIMENTO e pelo TOTAL DAS COMPRAS, somada das linhas de
`card_invoice_paid_entries` por lib/fatura-paga-no-resultado.ts -- e nao
mais pela perna de saida do pagamento, no dia e pelo valor pago. O
estorno no cartao abate a fatura, e a linha fora dos totais fica fora.

SEM FILTRO DE `paths`, como todo bloco deste arquivo: a suite roda em
milissegundos, nao precisa de banco, e um filtro escrito hoje perde o dia
em que alguem mexer no arquivo de amanha.
~~~~~~

## 'A verificacao sabe falhar (realizado-do-caixa)'

~~~~~~
Controle negativo. A suite afirma sobre TOTAL -- nao sobre a lista --
porque todos os erros desta regra produzem a lista "certa" e o numero
errado. Uma verificacao que nunca viu vermelho nao e verificacao.

A prova de mutacao completa e `npm run mutantes:realizado-do-caixa`
(11 mutantes desde a fase 6, ferramenta de quem escreve o teste). Aqui
ficam os quatro que mais custam, plantados um por vez -- o terceiro na
soma da fatura (lib/fatura-paga-no-resultado.ts), e nao na regra.

O `cmp` DEPOIS DE CADA `sed` NAO E ZELO. Um `sed -i` cujo padrao nao casa
SAI 0 e nao muda nada: o `npm run` seguinte roda a fonte INTACTA, passa,
e o `if` o declara... morto. O mutante seria dado por morto medindo nada,
e o passo ficaria verde para sempre -- foi assim que um mutante deste
repositorio parou de aplicar quando uma issue renomeou a ancora dele.
~~~~~~

## A regra do cartao pela fatura esta ligada de ponta a ponta

~~~~~~
A REGRA PODE ESTAR PERFEITA E NAO ESTAR LIGADA.

As assercoes e os mutantes acima provam `lib/realizado-do-caixa.ts` e nao
olham quem o chama. O defeito que sobra e de fiacao, e e mudo: o painel
para de mandar `&faturaAte=` (ate a fase 6, `&cartao=fatura`), ou a rota
para de ler a fatura paga ou de aplicar a regra, e /api/reports/cash-flow
responde 200 com um total errado -- sem erro, sem campo faltando, sem
log, e com a suite inteira verde.

O guard varre o fonte SEM comentario e SEM a lista de imports. As duas
remocoes foram medidas: sem a primeira ele le a prosa que descreve o
defeito, e sem a segunda tres das mutacoes do controle negativo abaixo
SOBREVIVIAM -- matar a chamada deixa o `import` intacto e o nome continua
"aparecendo" no arquivo.
~~~~~~

## As duas legendas do criterio do cartao formam um par que se explica

~~~~~~
=======================================================================
AS DUAS LEGENDAS QUE SEPARAM O CONSUMO DO CAIXA
origem: nova (HMO-266)
=======================================================================
O guard acima prova que as duas legendas estao LIGADAS. Ele nao olha o
que elas dizem, e um par de legendas ligadas pode estar errado de tres
formas que o `tsc` nao ve, porque sao strings:

  * as duas TROCADAS de lugar -- cada tela prometendo a diferenca com o
    sinal invertido ("o painel mostra um total maior", quando o consumo e
    sempre >= o caixa). Pior do que legenda nenhuma: manda a pessoa
    procurar um defeito que nao existe no lugar errado;
  * as duas IGUAIS, por copia -- uma das telas exibindo a frase da outra;
  * uma delas descrevendo apenas a PROPRIA tela. Quem comparou os dois
    numeros e chegou na legenda ja sabe o que aquela tela mostra; o que
    ele nao sabe e qual das duas esta errada (nenhuma esta).

DESDE A FASE 6 (072) o par e outro: o relatorio PESSOAL conta o cartao
pela fatura, no mes do vencimento, e o do GRUPO pela compra. A suite
afirma sobre as propriedades do PAR -- cada legenda nomeia a outra
leitura, a primeira frase de cada uma diz o mes da propria, e a do
pessoal diz que a fatura conta pelo total das compras e que a fatura em
aberto ainda nao entra -- e nao sobre o texto literal. A comparacao
e sem acento e em minusculas de proposito: exigir a grafia faria de
qualquer revisao de texto uma suite vermelha, e o sintoma disso e a
proxima pessoa afrouxar a assercao inteira para parar o vermelho.
~~~~~~

## 'A verificacao sabe falhar (legendas do criterio do cartao)'

~~~~~~
Controle negativo. A suite e TEXTUAL, e suite textual e a que mais
facilmente passa a nao medir nada -- os cinco mutantes abaixo sao os
modos de falha que importam, e todos foram medidos vermelhos.
~~~~~~

## O rebalanceamento da divisao do grupo fecha 100% em centesimos inteiros

~~~~~~
=======================================================================
A DIVISAO CONFIGURADA DO GRUPO SOMA 100% CRAVADO
origem: nova (HMO-245, fase 1 -- HMO-267)
=======================================================================
`lib/divisao-configurada.ts` e a regra por tras do slider de porcentagem
do grupo: "o total deve ser 100% entao se eu mexer em um, automaticamente
o outro de ajustar". A porcentagem que ela produz e o PESO com que o
fechamento do mes rateia a conta da casa, entao os defeitos dela sao
defeitos de dinheiro -- e nenhum deles aparece na tela:

  * uma configuracao que soma 99,99% divide 99,99% do aluguel. O
    residual de um centesimo nao tem onde aparecer; ele vira saldo que
    pagamento nenhum zera, semanas depois;
  * com todos os membros em zero -- que e o estado de TODO grupo que
    existe hoje, porque `group_members.percentage` nasce `DEFAULT 0.00`
    e ninguem nunca escreveu nessa coluna -- a proporcao e `0/0`. `NaN`
    nao estoura em JavaScript: atravessa a aritmetica calado e chega na
    tela como "NaN%";
  * membro em 0% entrando na despesa com parte zerada derruba o INSERT
    INTEIRO em 23514, porque `group_members.percentage` aceita 0 e
    `expense_splits.percentage` exige `> 0`.

SEM `paths:`, como todo o resto deste workflow: a suite e pura, roda em
dois segundos, e o dia em que o slider mudar de arquivo um filtro escrito
hoje estaria errado.

A suite roda o node DUAS VEZES, em America/Sao_Paulo e em UTC. O modulo
nao tem data nenhuma, e e por isso que o fuso e verificado: a sandbox de
quem escreve e Sao Paulo e o CI e UTC, entao um `new Date()` que aparecesse
aqui amanha (uma semeadura por mes, um "vigente desde") passaria verde na
maquina de quem escreveu e viraria porcentagem diferente no CI.
~~~~~~

## 'A verificacao sabe falhar (divisao configurada do grupo)'

~~~~~~
Controle negativo. A suite afirma sobre uma SOMA e sobre uma AUSENCIA
("a config soma 10000", "o membro em 0% nao tem parte"), e as duas passam
verde tambem quando deixam de medir o que deveriam.

Os quatro mutantes abaixo sao os que `scripts/mutantes-divisao-configurada.mjs`
mede inteiro (49 deles, todos mortos -- os 8 ultimos sao de
`divisaoDoPeriodo`, a fase 4); estes quatro estao aqui porque sao os que
viram dinheiro. O primeiro e o controle negativo que a issue pede por
nome.
~~~~~~

## Os mutantes da minha parte da despesa de grupo

~~~~~~
=======================================================================
A PARTE E O RATEIO DA DESPESA DE GRUPO: OS DOIS RUNNERS QUE VIRAM STEP
origem: nova (HMO-329, triagem da divida da HMO-322 -- lote 1/4)
=======================================================================
A HMO-322 achou 43 runners de mutante que nenhum workflow invocava. A
regra de triagem (decisao do Helio em 2026-10-07) inverte o onus: apagar
e o DEFAULT, e ganhar step e a excecao que precisa defender a afirmacao
medida. Estes dois a defendem, e sao os dois mais baratos do lote.

POR QUE ESTES DOIS, E NAO OS OUTROS SETE DO LOTE
------------------------------------------------
`lib/parte-do-grupo.ts` e `lib/divisao-do-grupo.ts` sao a aritmetica de
"quanto desta conta e minha" e "como ela se reparte entre os membros". E
a familia que JA custou dinheiro neste repositorio, repetidamente -- e
cada defeito dela e silencioso, porque o numero errado sai formatado em
reais e a barra enche do mesmo jeito:

  * o tipo que a tela manda caindo em divisao IGUAL sem erro: o grupo
    combinado em 70/30 grava 50/50 e a tela diz "sucesso" (HMO-190);
  * a parte voltando a ser o valor CHEIO -- o defeito da HMO-177 -- que
    infla o custo fixo; e o inverso, que e pior, porque um custo fixo
    subestimado faz o safe-to-spend PROMETER dinheiro que nao sobra;
  * membro em 0% com parte zerada, que derruba o INSERT inteiro em 23514
    porque `group_members.percentage` aceita 0 e `expense_splits.
    percentage` exige `> 0`;
  * membro repetido na lista, que cobra a mesma pessoa duas vezes.

`lib/parte-do-grupo.ts` e a entrada do safe-to-spend desde a HMO-306, que
acabou de entrar: e o numero de maior destaque do painel.

MEDIDO AO ESCREVER ISTO, e com a carga anotada de proposito, porque fome
de CPU falsifica medida de tempo (um lote anterior leu "120s exatos" em
quatro runners seguidos e era carga 40 em 2 nucleos):

  parte-do-grupo     14 mutantes, 14 mortos, 28s (load 1,77 / 2 nucleos)
  divisao-do-grupo   28 mutantes, 28 mortos, 77s (load 2,76 / 2 nucleos)

Os outros sete do lote tambem matam 100%, e e por isso que nenhum deles
foi apagado -- mas juntos custam ~7 min por PR, que a franquia de 2.000
min/mes (HMO-261) nao absorve. O caminho deles e a migracao para o motor
de bloco da HMO-319, que ja mediu -66% ao compartilhar UMA compilacao.

NAO ABRE JOB NOVO: o custo de CI deste projeto e o NUMERO de jobs, cada
um arredondado para o minuto cheio, e nao o minuto a mais num job que ja
existe. Sao 105s somados dentro de um job que ja esta de pe.

SEM `paths:`, como o resto deste workflow -- e aqui isso importa mais que
o normal: as suites `test:parte-do-grupo` e `test:divisao-do-grupo` so
tem passo no db-verify.yml, que E filtrado por path. Foi exatamente assim
que tres suites deste repositorio ficaram paradas em verde.

POR QUE O RUNNER INTEIRO, E NAO UM SUBCONJUNTO EM `sed` AQUI NO YAML
-------------------------------------------------------------------
Porque o runner carrega a trava que o `sed` escrito a mao nao tem: ele
exige que a ancora apareca EXATAMENTE UMA VEZ e que o arquivo tenha
mudado de verdade, e ACUSA quando a ancora morre em vez de dar o mutante
por morto. Esta mesma issue consertou duas ancoras mortas descobertas
assim -- uma morta desde a HMO-303 e outra desde a HMO-179. Um bloco de
`sed` inline no lugar delas teria ficado verde mentindo.
~~~~~~

## Os mutantes da parte de grupo no CSV de relatorio

~~~~~~
Os mutantes do CSV de relatorio (HMO-207). Este runner USA
`criarBlocoDeMutantes`, entao a mutacao vive na sombra em /tmp e a
arvore do repositorio nunca e escrita -- ao contrario dos dois acima.

Os dois primeiros sao o que a issue pede pelo nome ("trocar a view nova
pela antiga tem que MATAR a assercao"), nas duas versoes que falham
diferente: uma erra o numero para MAIS (valor cheio no lugar da parte) e
a outra APAGA a linha de dolar, que foi a medicao de producao.

Os dois do `eq("user_id")` so morrem pela recusa de linha repetida: sem
o filtro o CSV ganha uma SEGUNDA linha de USD com o mesmo valor, e um
total comparado por moeda continuaria batendo com a tela.
~~~~~~

## 'A arvore voltou ao lugar depois dos mutantes da parte e do rateio de grupo'

~~~~~~
Os dois runners acima ESCREVEM no fonte e restauram no fim (nenhum dos
dois usa `criarBlocoDeMutantes` ainda). Um `process.exit` dentro de um
try pularia o finally e deixaria lib/ mutado -- e dali em diante todo
passo seguinte mediria o arquivo errado, verde. Este passo e o que
transforma isso em reprovacao.
~~~~~~

## Os mutantes do teto de orcamento do grupo

~~~~~~
=======================================================================
OS CINCO DE GRUPO QUE NAO CABIAM: ~7 MIN VIRARAM 2,0
origem: nova (HMO-335, o resto do lote 1/4 da HMO-322)
=======================================================================
A HMO-329 mediu estes cinco e achou o oposto do que a triagem esperava:
nenhum e falsa cobertura, os cinco matam 100% dos mutantes. O `git rm`
que era o default nao se defendeu para nenhum. O que faltava nao era
justificativa -- era CABER: somavam ~7 min por PR, e a franquia e de
2.000 min/mes (HMO-261).

Nenhum dos cinco usava `criarBlocoDeMutantes` (HMO-319): cada mutante
recompilava o programa INTEIRO e, pior, MUTAVA A ARVORE RASTREADA e
restaurava depois. Migrados para o bloco, a mutacao vai para uma sombra
em /tmp e as voltas dividem um processo e um cache de AST.

MEDIDO NA HMO-335, um runner por vez com `git status` conferido entre
eles, carga anotada ao lado porque fome de CPU ja falsificou duas medidas
desta mesma familia (a HMO-329 corrigiu 86s -> 28s e "120s" -> 72s):

  runner                  placar   antes ->  agora   load (2 nucleos)
  ----------------------  ------   ---------------   ----------------
  orcamento-de-grupo       21/21     84s ->  12s     1,48
  sugestao-de-divisao      17/17     56s ->  16s     0,56
  cartao-orcamento-grupo   16/16     72s ->  19s     0,19
  semeadura                23/23    124s ->  31s     0,44
  divisao-ui-dom           18/18     84s ->  45s     0,86
  ----------------------  ------   ---------------
  total                    95/95    420s -> 123s     -71%

O PLACAR E IDENTICO AO DE ANTES NOS CINCO, e e essa igualdade que prova a
migracao: um runner refatorado que mede MENOS sai mais rapido pelo motivo
errado. Os 95 mutantes continuam morrendo, um por um.

OS DOIS DE NAVEGADOR GANHAM MENOS, e isso e esperado: `divisao-ui-dom` e
a metade de tela do `semeadura` sobem um Chromium por volta, e esse custo
o bloco nao compartilha -- ele compartilha a COMPILACAO. Dai -46% ali
contra -86% em `orcamento-de-grupo`, que e so TypeScript.

NAO HA PASSO COMPANHEIRO DE RESTAURACAO para estes cinco, ao contrario do
bloco da parte e do rateio acima. Nao e esquecimento: um runner em bloco
nunca escreve na arvore rastreada, entao nao existe restauracao que possa
falhar. E a mesma razao pela qual os runners do painel, convertidos na
HMO-328, tambem nao tem o passo.

O QUE CADA UM DEFENDE -- nomeado, porque "cobertura" nao justifica minuto:

  * `semeadura` e o unico do lote que mede AUTORIZACAO, e nao so dinheiro:
    a leitura privilegiada perdendo o `.in(user_id)` (a service role passa
    a ler o app INTEIRO), o portao de pertencimento caindo (quem nao e do
    grupo recebe a divisao dele) e o botao de semear aparecendo para quem
    nao e admin;
  * `orcamento-de-grupo`: o teto de grupo caindo no balde PESSOAL -- um
    "ja gastei" alto que cresce a cada membro novo da viagem, sem erro e
    sem cor diferente -- e o `group_id` perdido na copia do
    carry-forward, que faz o teto da viagem virar pessoal no mes seguinte;
  * `cartao-orcamento-grupo`: o "nao fazer" literal da HMO-180 (refazer a
    soma dentro do JSX, com duas telas mostrando percentuais diferentes
    para a mesma viagem) e o mes passando por `new Date()`, que no fuso de
    Sao Paulo joga o dia 01 para o mes anterior;
  * `sugestao-de-divisao`: a sugestao configurada voltando a ser codigo
    morto (o estado de ANTES da HMO-273) e a parte de 0% voltando ao corpo
    do POST, que faz o lancamento falhar sempre;
  * `divisao-ui-dom`: a FIACAO do painel, que e justamente o que
    `react-dom/server` nao ve porque `onChange` nao sai no HTML --
    inclusive o campo voltando a `type=number`, que descarta a virgula e
    zera a parte do membro, e os dois portoes de admin.

A ORDEM E A DO CUSTO, do mais barato ao mais caro: um defeito de
aritmetica reprova o job em 12s em vez de esperar os dois Chromium.
~~~~~~

## Os mutantes do elo da fatura -- a deteccao reprova quando erra para o lado caro

~~~~~~
=======================================================================
O ELO DA FATURA: OS MUTANTES DA DETECCAO
origem: nova (HMO-307, divida nomeada da HMO-305)
=======================================================================
A HMO-305 entregou `lib/elo-da-fatura.ts` com 23 casos de suite e nenhum
runner de mutante. "A suite cobra a ausencia do rotulo" e "a suite
reprova quando o rotulo acende na linha errada" sao duas afirmacoes
diferentes, e so a segunda vale -- neste modulo a assimetria e o assunto
inteiro: o rotulo que NAO acende deixa o mes em R$ 1.600,00, conferivel;
o rotulo que acende na linha ERRADA poe na tela um botao que, clicado,
esconde uma divida verdadeira.

A MEDICAO ACHOU DOIS FUROS DE VERDADE na primeira volta, e os dois eram
guardas que a suite NOMEAVA sem medir:

  * `citacao_por_substring` -- o caso "Nu" dentro de "Numerario", que o
    comentario da funcao usa para justificar a palavra inteira, e barrado
    pela guarda do NOME CURTO. Trocar o criterio por `includes` ficava
    verde. O caso novo e "Inter" dentro de "Internet": as duas contas
    existem e vencem no mesmo mes;
  * `fatura_fechada_vira_candidata` -- o `!gravada` do laco das faturas
    abertas estava documentado como load-bearing, sem medicao nenhuma.
    Sem ele, ligar uma previsao a uma fatura FECHADA cria duas linhas com
    a mesma chave e nao ha fatura sintetizada para suprimir: o mes
    continua dobrado com a tela dizendo "pronto".

Os dois viraram CASO NOVO na suite, nao mutante removido da lista.

NAO ABRE JOB NOVO -- o custo de CI deste projeto e o NUMERO de jobs, e
este runner usa `criarBlocoDeMutantes`: um processo, uma sombra, doze
voltas que dividem o AST de tudo que nao e o arquivo mutado. A fonte do
repositorio nao e tocada em momento nenhum, entao nao ha passo-guarda de
"a arvore voltou ao lugar" para acompanhar.

SEM `paths:`, como o resto deste workflow -- e aqui isso importa mais que
o normal: a suite do elo so tem passo no db-verify, que E filtrado por
path. Este runner a exercita em todo PR, porque ele le as etapas do
proprio alvo no package.json em vez de repetir a receita a mao.
~~~~~~

## A decisao e a sequencia do pagamento de fatura (dois fusos)

~~~~~~
=======================================================================
PAGAR A FATURA: A DECISAO E A SEQUENCIA, FORA DA TELA
origem: nova (HMO-245, fase 13 -- HMO-310)
=======================================================================
Pagar fatura escolhendo a conta pagadora ja funcionava inteiro -- e so
funcionava DENTRO de app/(dashboard)/dashboard/bills/page.tsx. A fase 13
tirou de la a decisao (lib/pagamento-da-fatura.ts) e o dialogo
(components/fatura/DialogoDePagamentoDaFatura.tsx) para que a tela de
Despesas os use sem copiar uma linha.

O DEFEITO QUE A SUITE EXISTE PARA PEGAR e um galho trocado. Os TRES
sabores de fatura casam em `natureza === "fatura"`; o que separa UMA
escrita de DUAS e `gravada`:

  aberta sintetizada   gravada: false  ->  close + pay
  fechada na agenda    gravada: true   ->  so pay
  previsao ligada      gravada: true   ->  so pay   (o elo, HMO-305)

Com o galho por `natureza`, a previsao DIGITADA que alguem ligou a fatura
passa pelo POST /api/card-invoices/close: a fatura do CARTAO e fechada
porque a pessoa pagou a previsao da CONTA CORRENTE. O `close` responde
201 -- nenhum erro, nenhum log --, e o unico sintoma e uma conta a pagar
que ninguem pediu no mes seguinte.

E ELE SO MORRE POR UM CASO SOBRE A PREVISAO LIGADA. Na fatura ABERTA as
duas expressoes dao a mesma resposta, entao uma suite que so olhe aquele
sabor passa VERDE com a troca feita. O mutante `galho_por_natureza` e a
medicao disso.

DOIS FUSOS, porque a suite toca `mes` / `invoice_month`: a sandbox e
America/Sao_Paulo e o CI e UTC. `mesDoClose` e fatia de string e nao
deveria depender do relogio; rodar nos dois e o que prova que nao passou
a depender.

SEM `paths:`, como o resto deste workflow: a suite e pura e roda em dois
segundos, e um filtro escrito hoje estaria errado no dia em que a decisao
mudar de arquivo.
~~~~~~

## A fiacao do pagamento da fatura esta ligada

~~~~~~
A OUTRA METADE: a decisao pode estar perfeita e nao estar LIGADA.

Quatro defeitos de fiacao, nenhum deles visivel ao `tsc`: o dialogo sem a
frase do patrimonio no toast (quem pagou R$ 1.000 ve o patrimonio parado,
conclui que a baixa nao registrou e paga de novo), o botao desabilitado
sem motivo escrito, a tela sem o dialogo, e -- a exigencia NEGATIVA -- a
tela montando a sequencia das escritas de novo, que e a segunda
implementacao da de-duplicacao de fatura.
~~~~~~

## A contagem de transacoes do grupo conta cada despesa uma vez

~~~~~~
-------------------------------------------------------------------
A CONTAGEM DE TRANSACOES DO GRUPO (HMO-259)
-------------------------------------------------------------------
`GET /api/expense-groups/{id}/balances` devolvia `paid_count +
owed_count` e contava duas vezes a despesa que o membro PAGOU: 18/18/12
num grupo de 12 despesas, medido na conta de teste da HMO-255 em
producao. Nenhum valor em reais depende do numero -- e e justamente por
isso que ele precisa de controle negativo: contador errado nao tem quem o
denuncie, nao aparece em `residual`, nao desequilibra saldo. Ele so
discorda da lista na mesma tela, e quem nota e a pessoa.

SEM `paths:`, como todo o resto deste workflow. Aqui isso e mais do que
consistencia: a contagem reproduz as duas pernas da view
`group_member_balances`, entao mexer na view (database/) ou na rota
(app/) sem tocar lib/contagem-do-grupo.ts e exatamente o caso que um
filtro de path escrito hoje deixaria passar verde.
~~~~~~

## Arquivar o grupo e travado por SALDO em aberto, nao por parte pendente

~~~~~~
-------------------------------------------------------------------
A TRAVESSA DE ARQUIVAR O GRUPO (HMO-426)
-------------------------------------------------------------------
`lib/services/expense-groups.ts` recusava arquivar o grupo quando alguma
parte estava `status = 'pending'`. A HMO-425 tirou do app o
aprovar/recusar a propria parte, e nenhum caminho nosso escreve mais
nada naquela coluna: toda parte nasce 'pending' e fica. Grupo com
qualquer despesa lancada nao podia mais ser arquivado nem apagado, para
sempre -- e a mensagem de recusa nomeava uma acao que nao existia mais.
O criterio passou a ser saldo diferente de zero em
`group_member_balances`, que e o numero que a tela do grupo mostra.

A suite chama os DOIS handlers que consultam a travessa -- apagar o
grupo e sair como ultimo membro -- e rele `is_active` na tabela. Os dois
porque cada um tem a SUA copia do bloco de decisao, e o defeito irmao
desta issue (HMO-145) estava escrito duas vezes, nas duas rotas.

Tres das assercoes sao de AUSENCIA (`escritas: []` nos caminhos de
recusa), e e por isso que elas medem a ordem: a view recorta pelo membro
ATIVO, entao uma travessa consultada DEPOIS do UPDATE que arquiva os
membros responderia "nao ha saldo em aberto" sempre.

SEM `paths:`, como todo o resto deste workflow. Aqui isso importa mais
que consistencia: o `paths:` do db-verify cita `app/**/expense-groups/**`
mas NAO cita `lib/services/expense-groups.ts`, que e onde o criterio
mora -- um filtro escrito hoje deixaria passar verde exatamente o
arquivo que esta suite existe para cobrir.
~~~~~~

## Mutantes da travessa de arquivar o grupo

~~~~~~
Controle negativo. A metade de BANCO deste par vive no db-verify
(`database/tests/hmo426_saldo_em_aberto_trava_arquivar_test.sql`), e ela
prova que a view produz os numeros; estes mutantes provam que a suite de
cima reprova quando a rota deixa de obedece-los.

Medido: 10 mutantes, 10 mortos, TODOS por assercao (nenhum caiu no tsc),
com controle positivo verde. Entre eles o defeito restaurado letra por
letra (o criterio volta a ser o status da parte), a comparacao com zero
apagada, `eq` por `neq`, o recorte por grupo apagado, o colapso do erro
de leitura em "nao ha" (o defeito da HMO-145) e, em CADA uma das duas
rotas, a recusa aplicada ao estado errado e o 503 de "nao deu para
saber" removido.

ANOTADO porque a leitura intuitiva esta errada: o mutante do defeito da
issue NAO morre pelo caso de sucesso. O duble nao emula embed, entao a
consulta velha responde vazio ali e o grupo acertado continua sendo
arquivado. Quem o mata e o lado da PROTECAO (grupo devendo tem de ser
recusado) e a assercao de onde o criterio le. Quem mexer na suite
precisa saber qual assercao e load-bearing antes de "simplificar" essa.
~~~~~~

## Mutantes da contagem de transacoes do grupo

~~~~~~
Controle negativo. A suite afirma IGUALDADES sobre numeros pequenos (12,
1, 0), que e o tipo de afirmacao que fica verde de graca -- e o 12 do caso
da issue e produzido tambem por `owed_count` sozinho, que esta errado.

Medido: 11 mutantes, 11 mortos, TODOS por assercao (nenhum caiu no tsc),
com controle positivo. O runner inteiro roda em ~10s porque muta uma
SOMBRA em /tmp num processo unico (o motor de bloco da HMO-319), entao nao
ha subconjunto a escolher como nos blocos inline acima: o step roda os 11.
~~~~~~

## O canal de e-mail nunca fica desligado em silencio

~~~~~~
-------------------------------------------------------------------
O CANAL DE E-MAIL DO AVISO DE VENCIMENTO (HMO-183)
-------------------------------------------------------------------
A feature mora em dois arquivos com responsabilidades opostas:
`lib/services/email.ts` decide COMO enviar e a rota do cron decide PARA
QUEM e QUANDO. O defeito que da nome a issue nao e um erro -- e um
SILENCIO: sem `RESEND_API_KEY` o canal fica desligado, e o jeito errado
de fazer isso e o cron responder `ok: true` como se tivesse enviado. A
suite exige que o desligamento apareca no corpo da resposta
(`email_desligado`) inclusive no dia em que nao havia nada a avisar --
que e o dia em que um `if (nada a fazer) return` esconderia o estado.

O segundo defeito que ela prende e caro de outra forma: a rota tem de
mandar o e-mail sobre os RECEM-GRAVADOS, nao sobre os alertas do dia.
Sobre a lista errada, o mesmo aviso sai todo dia -- e quem impede isso
nao e contador nenhum no TypeScript, e a UNIQUE da 009 que faz o upsert
devolver lista vazia na segunda execucao.

SEM `paths:`, como todo o resto deste workflow. Aqui isso e load-bearing
e nao consistencia: quatro assercoes leem o TEXTO de
`app/api/cron/bill-alerts/route.ts`, que o tsconfig da suite NAO compila
-- um filtro de path escrito sobre `lib/` deixaria a rota mudar verde.
~~~~~~

## Mutantes do canal de e-mail

~~~~~~
Controle negativo. Medido na HMO-234: 34 mutantes, 34 mortos, 31 por
assercao e 3 pelo tsc, com controle positivo -- em ~32s, porque muta uma
SOMBRA em /tmp num processo unico (o motor de bloco da HMO-319). Os 3 do
compilador sao de tipo (`string | null` onde se espera `string`), e os 31
restantes garantem que o placar nao e o compilador fazendo o trabalho da
suite.
~~~~~~

## O aviso da conta de grupo vai para cada membro

~~~~~~
-------------------------------------------------------------------
O AVISO DA CONTA DE GRUPO VAI PARA CADA MEMBRO (HMO-414)
-------------------------------------------------------------------
A migration 057 fez `bill_alerts` devolver uma linha POR DESTINATARIO
(os membros ativos do grupo, mais o dono). Isso sozinho nao manda um
e-mail a mais, e as duas metades que faltam vivem em rotas com
exigencias OPOSTAS -- e por isso a suite compila as duas juntas:

  * o CRON nao filtra `user_id` (precisa do conjunto inteiro) e grava
    com `onConflict` nomeado. Com `user_id` fora dessa lista, o aviso
    do segundo membro colide com o do primeiro e o `ignoreDuplicates`
    responde `INSERT 0 0` -- SEM ERRO, com o job verde: o fan-out
    inteiro grava UMA linha;
  * o SINO filtra `user_id`. A RLS NAO recorta o fan-out para o leitor
    (`group_members_select` mostra o grupo inteiro a qualquer membro),
    entao sem o filtro um membro de grupo de 3 pessoas ve a mesma conta
    TRES vezes, com `overdue_count` triplicado.

A assercao e sobre o ARGUMENTO que a rota passou ao client, nao sobre o
texto do arquivo: um `includes("user_id")` sobre o fonte fica verde
casando com `user_id: a.user_id` tres linhas acima do `onConflict`.

CONTROLE NEGATIVO dentro da propria suite: a MESMA rota, com o duble
colidindo pela chave do 009, grava 1 de 3 e responde 200. E medido que a
suite reprova contra o codigo de antes -- 3 assercoes vermelhas com o
`onConflict` velho e o filtro do sino apagados.

SEM `paths:`, como todo o resto deste workflow -- e aqui isso tambem e
load-bearing: a suite mede DUAS rotas, e um filtro escrito sobre uma
delas deixaria a outra mudar verde.
~~~~~~

## Nenhuma tela converte coluna date com new Date

~~~~~~
A DATA DE TODO LANCAMENTO DA LISTA APARECIA UM DIA MAIS CEDO (HMO-353).

`transaction_date`, `due_date` e `settled_on` sao colunas `date`: chegam
como a string "2026-10-09", um dia do calendario sem hora e sem fuso.
`new Date("2026-10-09")` nao le isso como um dia -- le como meia-noite
UTC, e em America/Sao_Paulo (UTC-3) isso e 2026-10-08 as 21h. A tela
escrevia 08/10/2026. Medido em producao em 2026-10-09 com a conta de
teste e Chromium headless, nao suposto.

O fuso de TODO usuario deste app e UTC-3, entao valia para toda linha de
toda lista -- e quem confere o extrato do banco contra o app le isso como
"o app GRAVOU errado", nao "o app mostra errado".

SEM `paths:`, como todo o resto deste workflow, e aqui isso e
load-bearing: o defeito volta numa TELA NOVA (`new Date(iso)` e o que o
editor completa sozinho), e tela nova nao esta em nenhuma lista de
caminhos escrita hoje.
~~~~~~

## A verificacao da data na tela sabe falhar, e sabe nao falhar

~~~~~~
Controle negativo. As peneiras do guard acima sao busca textual, e busca
textual sai VERDE quando para de achar o que deveria conferir. Os tres
defeitos abaixo sao formas diferentes do mesmo estrago, e o quarto caso e
o controle positivo -- sem ele um "vermelho pelo motivo errado" passa por
verificacao boa.
~~~~~~

## A data da lista nao aparece um dia mais cedo

~~~~~~
A suite da data na tela. Ela roda em America/Sao_Paulo E em UTC, e isso
nao e zelo -- e a medida que decide se ela mede algo.

Quatro mutantes de lib/data-na-tela.ts, medidos em 2026-10-09:

  mutante                                       Sao_Paulo   UTC
  dataNaTela volta a passar por new Date         MORTO       MORTO
  dataCurtaNaTela perde timeZone: "UTC"          MORTO       VIVO
  dataOuMomentoNaTela manda tudo por new Date    MORTO       VIVO
  dataOuMomentoNaTela textualiza o instante      MORTO       VIVO

TRES DE QUATRO SOBREVIVEM EM UTC, que e o fuso DESTE RUNNER. Uma suite
rodando so aqui passaria verde com o defeito intacto -- ja aconteceu na
HMO-210, mesmo commit, mesma suite, verde em CI e vermelho no sandbox.
Por isso o npm script fixa os dois fusos e a peneira 5 do guard acima
exige que ele continue fixando: tirar um TZ nao quebra teste nenhum.

A suite tambem afirma a PREMISSA (o fuso resolvido e um dos dois) e
REPRODUZ o defeito com new Date cru. Esse segundo controle e quem avisa
se um dia o motor parar de errar e a suite virar cerimonia.
~~~~~~

## Nenhuma tela congela a data de hoje em constante de modulo

~~~~~~
A DATA DE HOJE E LIDA NO GESTO, NUNCA GUARDADA NO MODULO (HMO-315).

`bills/page.tsx` tinha `const HOJE = ...format(new Date())` no topo do
arquivo. Num componente `"use client"` aquilo e avaliado UMA vez, quando
o navegador avalia o chunk -- nao quando a pessoa clica. Este app e PWA
com service worker: a aba atravessa a meia-noite e `HOJE` continua sendo
a data de ONTEM.

Tres dos quatro usos gravavam dinheiro ou data de dinheiro. No dia 1o a
data de ontem cai no MES ANTERIOR: o lancamento troca de mes no fluxo de
caixa e no teto da categoria, a baixa responde 200, a data gravada e
plausivel e NADA na tela acusa. Quem descobre e quem fecha o mes.

A varredura achou o mesmo defeito em QUATRO arquivos escritos por
caminhos diferentes (bills, budgets, goals, payroll), e e isso que
justifica guard em vez de so o conserto: a forma errada e a que se
escreve sem pensar, e a quinta tela nasceria igual.

SEM `paths:`, como todo o resto deste workflow, e aqui isso e
load-bearing pelo mesmo motivo do guard da data na tela: o defeito volta
numa TELA NOVA, que nao esta em nenhuma lista de caminhos escrita hoje.
~~~~~~

## A verificacao da data no clique sabe falhar, e sabe nao falhar

~~~~~~
Controle negativo. O guard e busca textual, e busca textual sai VERDE
quando para de achar o que deveria conferir. As quatro mutacoes abaixo
sao as quatro formas de desfazer a HMO-315 -- duas pela porta da frente
(a constante de modulo volta) e duas pela porta do meio (a data congela
no render em vez do modulo). A quinta e o controle positivo.
~~~~~~

## A baixa grava a data do clique, nao a da montagem

~~~~~~
A suite da data no clique. Ela roda nos DOIS fusos pelo mesmo motivo da
suite acima: o sandbox e Sao Paulo, este runner e UTC, e o instante que
ela usa (23:50 de 31/10 em Sao Paulo) ja virou o dia -- e o MES -- em
UTC. As assercoes sao de valor absoluto para valerem nos dois, o que so
e possivel porque `today()` pede America/Sao_Paulo EXPLICITAMENTE.

O que esta suite mede e o que nenhum guard textual alcanca: o relogio
ANDANDO entre a montagem e o clique. Um teste que chame a funcao uma vez
so passa verde com a constante de modulo intacta -- a constante so erra
quando o tempo passa entre a avaliacao e o uso. Por isso todo caso de
sequencia tem o par, e o par do defeito AFIRMA a data errada com numero
em vez de um `assert.ok(!...)`.

A divisao de trabalho, dita em voz alta: o guard acima pega a FORMA (a
constante voltou ao fonte), esta suite pega o COMPORTAMENTO (a data
gravada e a do clique) e o `tsc` pega o TIPO da prop. Nenhum dos tres
cobre os outros dois.
~~~~~~

## A suite da data no clique sabe falhar

~~~~~~
Controle negativo da suite. Ela so vale se morrer quando `today()` perde
o fuso explicito -- que e a outra metade da HMO-315: trocar o fuso de
Sao Paulo por UTC nao quebra build, nao quebra tipo, e das 21h a
meia-noite grava o dia seguinte. O erro apenas troca de direcao.
~~~~~~

## A regra do pagador no previsto de Despesas

~~~~~~
A REGRA DO PAGADOR no previsto (HMO-363, fase F1 da HMO-360).

A conta de grupo de R$ 1.000 num grupo 70/30 tem DUAS respostas certas na
aba Despesas, e qual vale depende de quem LANCOU: R$ 1.000 quando sou eu
que fronto o pagamento, R$ 300 ("pagar para Leticia") quando e ela.
`previstasComAMinhaParte`, que continua em producao nas outras quatro
leituras, responde R$ 300 nos dois casos -- ela nunca olha `user_id`.

Esta fase NAO LIGA NADA: nenhuma leitura chama a funcao nova ainda. O que
o step mede e a regra e a conciliacao dela com a F3 (o reembolso previsto
na aba Receitas), afirmada em TRES numeros separados -- 1300 de bruto, 600
de liquido, 700 de reembolso. Afirmar so o liquido passaria verde com as
duas parcelas erradas, que e `duas-pernas-mantem-o-total-certo`.
~~~~~~

## Mutantes da regra do pagador no previsto

~~~~~~
Controle negativo. A suite afirma numeros pequenos e redondos (300, 1000,
1300) e igualdades de REFERENCIA -- as duas familias que ficam verdes de
graca.

Medido: 14 mutantes, 14 mortos, TODOS por assercao (nenhum caiu no tsc),
com controle positivo. Os tres que a issue nomeia estao no topo da lista
(`sem_dono`, `dono_invertido`, `sem_abs`). O runner inteiro roda em ~1min
porque muta uma SOMBRA em /tmp num processo unico (o motor de bloco da
HMO-319), entao o step roda os 14 e nao um subconjunto.

DOIS sobreviventes conhecidos foram apagados em vez de escondidos, e as
razoes estao no cabecalho do runner: `igualdade_frouxa` e matematicamente
EQUIVALENTE, e o guarda que o mutante `sem_guarda_do_campo_da_linha`
atacaria era CODIGO MORTO (medido, 0 de 25 pares de entrada diferem) e
saiu de `euFrontoAConta`.
~~~~~~

## Despesas em bruto e reembolso previsto em Receitas

~~~~~~
DESPESAS EM BRUTO + REEMBOLSO PREVISTO EM RECEITAS (HMO-364, fases
F1b/F3/F5 da HMO-360).

As tres fases foram no mesmo release, e isso e a trava central do plano:
com a regra do pagador ligada na aba Despesas, o «Previsto» passa a
contar a conta de grupo que o usuario FRONTA pelo valor cheio. Se o
reembolso previsto nao entrar em Receitas junto, aquele numero infla sem
contrapartida e a tela mostra uma divida que nao e dele.

A SUITE AFIRMA AS DUAS PERNAS EM SEPARADO, e nunca o liquido: o bruto de
Despesas e o reembolso de Receitas se ANULAM por construcao, entao uma
assercao sobre "Despesas menos Receitas" fica verde com as duas parcelas
infladas -- foi assim que a transferencia de duas pernas somou R$ 1.000
em Receitas e R$ 1.000 em Despesas por meses em producao, com o saldo
exato ao lado (`duas-pernas-mantem-o-total-certo`).

Os dois CONTROLES NEGATIVOS estao dentro dela, e sao o que distingue
"ligado" de "nao medi nada": pela regra antiga o mesmo mes da R$ 900 em
vez de R$ 1.200, e sem o reembolso Receitas fica em R$ 5.000 em vez de
R$ 5.300. Nenhum numero esperado e escrito a mao no lado de Receitas --
o R$ 300 sai de `fecharMes` + `creditoAReceber`, as funcoes que a rota
chama.
~~~~~~

## Mutantes da fiacao do bruto e do reembolso

~~~~~~
Controle negativo da FIACAO, que e o que esta fase acrescentou de novo.

A aritmetica das duas metades ja tem mutantes
(`mutantes:regra-do-pagador`, `mutantes:credito-de-grupo`,
`mutantes:telas-de-movimentacao`). O que nenhum deles alcanca e a troca
de `previstasPelaRegraDoPagador` por `previstasComAMinhaParte` na rota:
as duas tem assinatura compativel, a troca COMPILA, nao lanca, e devolve
um «Previsto» R$ 300 menor que parece plausivel.

Medido: 10 mutantes, 10 mortos, com controle positivo nas DUAS suites
que o runner usa. Tres deles sobreviveram na primeira volta -- a sonda
textual casava com o NOME da constante, inclusive na linha de import, e
ficava verde com o JSX desenhando nada. Dois foram repontados para a
suite que renderiza o componente e a terceira assercao passou a exigir a
interpolacao `{LEGENDA_DO_LIQUIDO}`.
~~~~~~

## Pra quem pagar na aba Despesas

~~~~~~
PRA QUEM PAGAR E O CHEVRON NA ABA DESPESAS (HMO-365, fase F2 da
HMO-360).

A fase anterior pos a MINHA PARTE da conta que outro membro frontou no
«Previsto» de Despesas, carimbada com `pagar_para`. O numero estava
certo e a tela era MUDA sobre a quem eu devo -- e esse e o estado que
faz a conta do outro se ler como conta propria.

A SUITE AFIRMA A INVARIANTE `soma(detalhe) === total` POR DESTINATARIO,
que e a entrega herdada da HMO-300: um chevron que abre uma lista que
nao fecha com o numero de cima transforma um numero conferivel num
numero desmentido pela propria tela. Ela sai de graca no codigo (o total
e a soma das MESMAS linhas, no mesmo laco), e e justamente por isso que
ela precisa de assercao: nada no tipo obriga as duas pontas a continuarem
vindo da mesma fonte.

E a peneira de status vem da CONSTANTE de lib/telas-de-movimentacao.ts,
nao de uma copia da lista: `paid`/`skipped`/`cancelled` fora de sincronia
com o cartao «Previsto» faria o painel dizer "pague R$ 500" sobre R$ 300
de divida real, com o cartao de cima, lido da mesma fonte, mostrando
outro numero.
~~~~~~

## Pra quem pagar na tela, no navegador

~~~~~~
A MESMA feature, medida NA TELA por um Chromium -- e nao por assercao
textual sobre o fonte, que e o que a issue pede explicitamente (assercao
de rotulo casa com o comentario e com o dado rotulado).

QUATRO COISAS QUE SO O DOM DENUNCIA, e nenhuma delas quebra build:
  1. o ROTULO SEM A PESSOA. Com o perfil ilegivel pela RLS, um
     `{destino.nome}` solto renderiza NADA -- e `is_public` tem DEFAULT
     true, entao isso quase nunca acontece em teste e acontece em
     producao;
  2. o CHEVRON DESLIGADO. A lista no DOM escondida com `hidden` NAO sai
     do `textContent`, e uma sonda ingenua ficaria verde com a seta
     inerte;
  3. os DOIS CHEVRONS ACOPLADOS por `aria-controls` repetido: abrir um
     abre o outro, com os dois valores certos nos lugares trocados;
  4. o TOTAL NO LUGAR ERRADO -- as 25 assercoes de aritmetica passariam
     todas verdes com o JSX imprimindo o total de um destinatario na
     linha do outro.

O ROTULO DE FALLBACK E CALCULADO POR PRODUCAO na pagina da sonda
(`rotuloDoDestino` extraida do .tmp por regex), e nao entregue pronto no
fixture: com o texto literal no fixture, o caso que a issue manda provar
mediria a si mesmo e ficaria verde com o fallback inteiramente quebrado.
~~~~~~

## Mutantes do pra quem pagar

~~~~~~
Controle negativo das duas suites acima, num runner so.

Medido: 29 mutantes, 29 mortos, 28 deles por ASSERCAO (um so caiu no
tsc), com controle positivo nas duas suites. Cada mutante roda nas duas
e para na primeira que mata, e o relato diz QUAL matou -- marcar a suite
errada produziria "sobreviveu" sobre um defeito que a outra pega, que e o
pior relato possivel porque manda consertar o que nao esta quebrado.

UM sobreviveu na primeira volta e o conserto foi na SUITE, nao no codigo:
`nome_em_branco_vira_nome` apaga o `.trim()` de `rotuloDoDestino`, e pela
porta de `destinosDoPagamento` aquele guarda nunca decide nada (a lib ja
normaliza o nome em branco para `null` antes de chamar). So que a funcao e
EXPORTADA e a sonda de navegador a chama direto, sem normalizacao -- o
guarda e load-bearing para todo outro chamador, entao a saida foi medi-lo
e nao apaga-lo (ao contrario de `euFrontoAConta` na F1, onde 0 de 25 pares
de entrada diferiam e o guarda morto saiu).

E um sobrevivente conhecido esta DECLARADO no cabecalho do runner em vez
de omitido: `marca_calculada_a_parte` e equivalente, porque a lib
normaliza o nome antes de montar o objeto.
~~~~~~

## Quem te paga na tela, no navegador

~~~~~~
-----------------------------------------------------------------------
Quem te paga -- o espelho do painel de cima, na aba Receitas (HMO-422)
-----------------------------------------------------------------------
A issue: o cartao «Previsto» de Receitas dizia R$ 508,42 "de 2 pessoas
em 1 grupo" e a aba nao dizia, em lugar nenhum, QUEM sao as duas pessoas
nem QUAL e o grupo -- so /dashboard/personal-finance dizia, uma tela de
distancia, lendo o MESMO credito pela MESMA lib. A aba Despesas tinha o
painel simetrico desde a HMO-365; Receitas nao tinha.

SEM filtro de caminho, como todo o resto deste workflow: a suite nao
toca no Postgres (o componente recebe props), entao ela nao pertence ao
db-verify.

AS QUATRO COISAS QUE SO O DOM DENUNCIA, e nenhuma delas tem assercao de
funcao pura possivel:
  1. o ROTULO SEM A PESSOA -- `devedor` e `null` quando a RLS nao deixa
     ler o perfil, e um `{linha.devedor}` solto renderiza NADA: "R$ 300
     · Casa" sem mencao a ninguem se le como receita propria, e pior,
     como receita JA RECEBIDA;
  2. a MARCA QUE MENTE -- `full_name` de espacos e verdadeiro em JS, e um
     `data-tem-nome` calculado no JSX diria "sim" sobre um rotulo vazio;
  3. as DUAS LINHAS COLAPSADAS -- a mesma pessoa pode me dever em dois
     grupos, e com a `key` so no devedor o React junta as duas. A
     primeira pintura sai IDENTICA a certa (os dois nos existem), entao
     a evidencia e o aviso do React: a sonda faz patch de
     `console.error` ANTES do UMD e o le;
  4. o SALDO SEM DEVEDOR -- sem a linha final a soma visivel fica abaixo
     do numero que a legenda do cartao cita.

O ROTULO DE FALLBACK E CALCULADO POR PRODUCAO na pagina da sonda
(`devedorNaLinha` e `DEVEDOR_SEM_NOME` extraidas do .tmp por regex), e
nao entregue pronto no fixture: com o texto literal, os casos B e C
mediriam a si mesmos e ficariam verdes com o fallback inteiramente
quebrado.
~~~~~~

## Mutantes do quem te paga

~~~~~~
Controle negativo da suite acima.

Medido: 12 mutantes, 12 mortos (10 por ASSERCAO, 2 pelo tsc), com
controle positivo. UMA suite so e nao duas como no painel irmao, e isso
esta escrito no cabecalho do runner: a aritmetica do credito NAO e deste
componente (ela sai de lib/credito-de-grupo.ts, que tem
`mutantes:credito-de-grupo` proprio), entao a unica suite que pode matar
um mutante de JSX e a de navegador.

`chave_so_do_devedor` SOBREVIVEU na primeira volta e o conserto foi na
SUITE, nao no codigo: o React renderiza os dois nos com chave repetida e
so avisa, entao o DOM da primeira pintura nao distinguia o mutante do
original. A sonda passou a coletar o aviso.
~~~~~~

## MyBank -- a serie do emprestimo, as rotas e o ciclo do Caso A

~~~~~~
-----------------------------------------------------------------------
MyBank -- a serie do emprestimo, as rotas e o ciclo do Caso A
(HMO-370 e HMO-382)
-----------------------------------------------------------------------
SEM `paths:`, como todo o resto deste workflow, e aqui isso e o que
importa: a suite nao toca no Postgres (o duble de client responde no
lugar dele), entao ela nao pertence ao db-verify -- que precisa do
servico de banco e e filtrado por `paths:`. Um dia em que alguem mexa so
em `lib/safe-to-spend.ts` e passe a contar a parcela do MyBank duas
vezes, este step roda de qualquer jeito.

O que ela prova, em uma linha cada:
  * 24x de R$ 10.000 (que NAO divide redondo) somando exatamente o
    principal, com a ultima parcela absorvendo o centavo -- e aqui a
    ultima e a MENOR, que e o caso que distingue `round` de `ceil`;
  * o CASO B nao escrevendo em `scheduled_transactions` nem em
    `financial_transactions`: a assercao e de AUSENCIA, porque emprestar
    para outra pessoa criando conta a pagar no meu nome nao da erro em
    lugar nenhum -- as linhas sao minhas e a RLS as aceita;
  * o devedor nao alcancando `amount` pelo corpo do pedido (o outro lado
    da `mybank_installments_trava_do_devedor` da 053);
  * o UPDATE filtrado pela RLS nao respondendo sucesso;
  * (HMO-382) O CICLO DO CASO A FECHANDO: a baixa da transferencia
    prevista levando a parcela a `paid` com o elo na perna de ENTRADA, o
    estorno a devolvendo a `pending` com os tres campos, e as duas
    ordens que fazem a falha no meio ser sempre "nao aconteceu" em vez de
    "metade aconteceu" -- a parcela baixada ANTES da previsao na ida, e
    devolvida ANTES de qualquer DELETE na volta;
  * (HMO-391) O CANCELAMENTO: o emprestimo virando `cancelled` -- o que
    apaga a divida das DUAS telas de uma vez, porque as duas leituras
    filtram `active` --, as parcelas em aberto acompanhando, e a parcela
    `paid` FICANDO `paid`: ela tem perna em `financial_transactions`, e
    reescreve-la apagaria o registro de um dinheiro que se moveu. Mais a
    previsao ja baixada do Caso A sobrevivendo ao DELETE (`status =
    'pending'` no filtro) e as DUAS guardas de `.length` antes do `.in`:
    clausula `.in` vazia no PostgREST NAO filtra, e sem elas cancelar um
    emprestimo do Caso B levaria a agenda INTEIRA de Contas a Pagar.
  * (HMO-395) A ANTECIPACAO: as N parcelas em aberto de MAIOR vencimento
    virando `paid`, cada uma com a PROPRIA perna de entrada. Nada e
    cancelado e nenhum `amount` e tocado -- a decisao de produto ("duas
    parcelas menos", "as que sobram mantem o valor", "ENCURTA a serie")
    em forma de assercao. O controle desta parte e um teste com UMA
    assercao, e ela e de SOMATORIO: `soma(pagas) + soma(em aberto)` tem
    de continuar sendo o `principal`. O desenho que a HMO-393 propunha --
    cancelar a cauda E pagar a cabeca -- faz essa soma cair de R$ 600
    para R$ 400 sem que nenhum CHECK reclame e com as duas telas
    consistentes entre si, e nenhuma assercao de `status` distingue os
    dois desenhos pelo motivo certo.
~~~~~~

## Mutantes do MyBank -- emprestimo e ciclo do Caso A

~~~~~~
Controle negativo do step acima: 93 mutantes, 93 mortos.

O que a HMO-382 pede por nome e `A PARCELA FICA EM pending`: o dinheiro
anda certo nas 24 vezes (corrente -X, investimento +X) e o painel do
MyBank segue cobrando tudo. E o oposto da familia HMO-149 -- lá o numero
fecha e o fato nao aconteceu; aqui o fato aconteceu e o numero nao mexe
--, e por isso nenhum saldo errado o denuncia depois.

Os dois que a issue HMO-370 pede por nome sao os dois primeiros da lista
do runner: `transfer` virando `expense` no Caso A (o dinheiro sai da
conta corrente e nao chega a de investimento) e o Caso B gravando linha
minha. A guarda do Caso B tem DUAS linhas e por isso tem DOIS mutantes:
apagar so a do caso nao muda o que a rota faz no pedido normal -- lá o
`contaDePagamentoId` ja chega `null` e a segunda guarda devolve `[]` de
qualquer jeito. Quem mata o mutante da guarda do caso e, e so, o teste
que manda `conta_de_pagamento_id` junto com `devedor_id`.

Os tres que a HMO-391 pede por nome sao os tres primeiros da secao do
cancelamento, e os tres apagam dinheiro sem erro nenhum no caminho:
cancelar TAMBEM a parcela `paid` (o unico registro que explica o saldo da
conta de investimento), apagar a previsao JA BAIXADA (as duas pernas da
transferencia ficam orfas no extrato), e INVERTER a ordem 4<->2 -- esse
ultimo e mutado injetando o DELETE das previsoes ANTES do UPDATE do
emprestimo, e quem o mata e a assercao de ORDEM por `indexOf` sobre as
escritas que a rota mandou.

O que a HMO-395 pede por nome e `A ANTECIPACAO CANCELA A CAUDA E PAGA A
CABECA`: o desenho do item 2 da HMO-393, escrito inteiro como mutante.
Ele perdoa R$ 200 de uma divida de R$ 600 e nao da erro em lugar nenhum,
e por isso tem de morrer numa assercao de SOMATORIO e nao de `status` --
os dois desenhos escrevem status diferentes, e so um deles perde dinheiro.
O segundo da secao e o unico desta suite que NAO erra numero nenhum:
`DESC` -> `ASC` na escolha da cauda recebe o mesmo total e deixa a serie
do mesmo tamanho; quem o mata e a assercao de QUAIS parcelas baixaram.

A ANCORA DO MUTANTE DO CANCELAMENTO MUDOU NESTA ENTREGA, e nao por
estilo: `problemaDaAntecipacao` copia a primeira pergunta de
`problemaDoCancelamento` palavra por palavra (e a mesma decisao -- a RLS
filtra em vez de recusar, entao a rota pergunta antes), e a linha passou a
casar duas vezes no arquivo. As duas ancoras ganharam a assinatura da
funcao no comeco. Ver `funcao-nova-que-copia-criterio-torna-ancora-alheia-
ambigua`; `npm run check-ancora-de-mutante` e quem reprova isso.

O QUE A HMO-396 PEDE POR NOME: `A PREVISAO E APAGADA EM VEZ DE BAIXADA`
----------------------------------------------------------------------
Ele e o espelho do mutante do cancelamento, e o espelho e o ponto: as
duas operacoes acham as MESMAS linhas pelo MESMO elo (`mybank:<id>`) e
fazem com elas coisas opostas. O cancelamento APAGA porque nada se moveu;
a antecipacao do Caso A BAIXA porque o dinheiro se moveu -- e a previsao
e o registro de que ele se moveu. Com o DELETE no lugar do UPDATE a
parcela fica paga, R$ 50 saem da conta corrente, e a linha que explica
esse debito desaparece de Contas a Pagar: sobram duas pernas em
`financial_transactions` que nenhuma conta a pagar explica.

O segundo da secao -- `o CASO A NAO LE AS PREVISOES` -- nao perde
dinheiro: ele apaga a unica forma de antecipar um auto-emprestimo. Ele
ocupa o lugar de medicao do mutante `o CASO A entra aqui`, que SAIU desta
lista nesta entrega porque a F3 apagou a ancora dele (a recusa
`caso_a_nao_entra_aqui`). Mante-lo com ancora nova deixaria o porque
dele mentindo -- a serie nao encurta mais "sem nada ter saido da conta",
porque a rota agora move o dinheiro.

E QUATRO ANCORAS DESTA LISTA MUDARAM DE ARQUIVO, nao de texto: os passos
2/2.5/3 da rota da baixa viraram
`lib/services/baixa-da-transferencia-prevista.ts` para que a antecipacao
do Caso A os CHAME em vez de reescrever as quarenta linhas de
movimentacao de dinheiro. O codigo foi movido com a indentacao intacta de
proposito, e a prova da refatoracao e o placar: 80/80 antes, 93/93
depois, com os 80 de antes entre eles.

(HMO-397, F4) 100/100. Os SETE novos sao da frase do ANTES e do criterio
da parcela antecipada, e o mais caro deles e `A PREVIA OMITE QUE O VALOR
DAS QUE SOBRAM NAO MUDA`: ele nao muda numero nenhum -- a tela fica
PLAUSIVEL e a pessoa le "baixaram minha parcela", que e a variante de
produto REJEITADA no cartao `ae436b4a`. A frase e o unico lugar da tela
onde se le QUAL das duas features foi construida, e e por isso que ela
vive em `lib/`: escrita no JSX, passaria por qualquer suite intacta (a
mesma razao que o `avisoDoCancelamento` ja da).

A issue HMO-397 aponta `mutantes-leituras-do-mybank.mjs` para aquele
mutante. Ele esta NESTE runner porque e a suite DESTE que afirma sobre a
frase; plantado no outro ele sobreviveria, e o placar diria "a suite nao
mede isso" sobre uma frase que esta medida.
~~~~~~

## MyBank -- a tela, o seletor e a linha de A receber

~~~~~~
-----------------------------------------------------------------------
MyBank F3 -- a tela /dashboard/mybank e o lado do devedor (HMO-371)
-----------------------------------------------------------------------
SONDA DE NAVEGADOR, e aqui ela e a unica forma de medir o que a issue
pede. As tres coisas que esta suite prova nao aparecem em `tsc`, `lint`
nem `build`:

  * o seletor do cabecalho listando SO conta de investimento. A rota
    recusa conta corrente e a trigger da 053 recusa depois dela -- entao
    o defeito nao e dinheiro errado, e um formulario que OFERECE uma
    opcao que sempre falha: a pessoa escolhe, aperta e leva uma recusa
    que nao sabia que ia levar. So contar as `<option>` do DOM mede isso;
  * o formulario recusando conexao NAO ACEITA, pelos dois lados (quem
    esta `pending` nao aparece como opcao, e apertar sem escolher nao
    chama a rota), com controle positivo ao lado -- sem ele, um
    formulario que recusasse todo mundo passaria a assercao de recusa;
  * a linha de "A receber" com os TRES campos que a issue nomeia (valor,
    `n de m`, quem deve pagar). Uma linha com dois deles fica com
    aparencia perfeita, e e por isso que a assercao e sobre cada ancora
    e nao sobre o texto da linha.

E o lado do devedor: o selo "MyBank — <quem emprestou>" em Contas a
Pagar, o caso do perfil ILEGIVEL (selo so "MyBank", parcela continua na
lista) e o botao mandando `reported`, nunca `paid`.

NO RUNNER DO ACTIONS quem casa e `/usr/bin/google-chrome`, que ja vem na
imagem -- nenhum workflow instala Playwright. NAO e preciso exportar
`CHROMIUM_BIN` em maquina nenhuma: a busca desta sonda VARRE a pasta do
Playwright (`chromium-*`) em vez de fixar a versao no fonte, que foi o
que deixou as quatro sondas antigas 100% vermelhas quando o ambiente
subiu de 1243 para 1248 (consertado na HMO-406, que portou esta busca
para as outras seis). A frase anterior aqui dizia o contrario e ja
contradizia a clausula seguinte; medido na HMO-405 sem variavel nenhuma.
Exportar a variavel a mao hoje so esconderia regressao na deteccao -- e
se um dia o navegador faltar de verdade, o `ABORTADO` do preflight diz
`Aponte CHROMIUM_BIN para um binario` em vez do nome do caso.

(HMO-391) E o botao «Cancelar»: ele existe SO em emprestimo `active` (o
fixture tem os tres estados na MESMA conta, entao "o botao aparece" e "o
botao aparece onde deve" sao perguntas diferentes), a pergunta recusada
nao manda PATCH nenhum, e o TEXTO dela diz o que o cancelamento NAO faz
-- nao registra pagamento e nao amortiza nada. Quem cancela achando que
esta quitando ve a divida desaparecer e conclui que pagou.
~~~~~~

## Mutantes da tela do MyBank

~~~~~~
Controle negativo do step acima: 45 mutantes, 45 mortos.

Os dois que a issue HMO-371 pede por nome sao os dois primeiros da lista
do runner: o filtro de `account_type = 'investment'` caindo (o seletor
passa a oferecer conta corrente e cartao) e o `data-quem-deve` da linha
ficando vazio.

Tres deles so morrem por causa de linhas do FIXTURE que existem para
isso, e vale dizer quais -- sem elas os tres sobrevivem com o codigo
certo do outro lado: um emprestimo `settled` e um `cancelled` COM parcela
em aberto na mesma conta credora (sem eles, "A receber" ignorando o
status do emprestimo da a mesma lista), e uma conexao aceita cujo embed
do MEU lado vem NULO -- o caso que a RLS de `profiles` produz, e o unico
em que decidir o lado por `requester_id` difere de decidir pelo embed.

(HMO-391) Os cinco do botao «Cancelar» entram nesta lista, e o mais
caro deles e `A PERGUNTA DEIXA DE DECIDIR`: o `confirm()` acontece, a
tela parece pedir confirmacao, e a resposta e ignorada -- uma acao
destrutiva cujo "cancelar" nao cancela, que e pior que nao ter a
pergunta, porque a pessoa confia nela. So sonda de navegador mede isso:
ela SUBSTITUI `window.confirm`, le a frase que o app passou e DECIDE a
resposta.

(HMO-397) 62 mutantes, 62 mortos -- os 17 novos sao do gesto «Antecipar»
e do dialogo dele, e DOIS deles sobreviveram na primeira medicao por
falta de linha de fixture. Vale dizer quais, porque e a mesma licao das
tres de cima:

  * `podeAntecipar` perdendo o `status === "active"` precisou de um
    emprestimo `cancelled` COM parcela em aberto (combinacao que o banco
    permite: cancelar nao renumera nem apaga parcela). Sem ele, as duas
    condicoes dao a mesma lista de botoes;
  * a trava virando BOOLEANO GLOBAL precisou do primeiro POST
    PENDURADO. Com a primeira antecipacao ja respondida, o `Set` de ids e
    um booleano se comportam igual -- e o estado e alcancavel pela tela,
    porque o dialogo fecha so na resposta e o botao das outras linhas
    continua clicavel durante o POST.

O mais caro em dinheiro e `A ANTECIPACAO PERDE A TRAVA`: a rota de
antecipacao NAO tem idempotencia por id (a de emprestimo tem, desde a
HMO-390), entao o toque duplo de celular paga a cauda DUAS vezes -- duas
pernas de entrada por parcela e o dobro no extrato. Ele e medido dentro
de `unstable_batchedUpdates` lendo o `disabled` no instante do segundo
clique: fora dele o React descarrega no meio, o botao ja estaria
desabilitado e o mutante que troca o `useRef` pelo estado sobreviveria.
~~~~~~

## MyBank -- o corpo do PATCH de ajuste do emprestimo e a previa dele

~~~~~~
-----------------------------------------------------------------------
MyBank F8 -- o dialogo de AJUSTAR (HMO-480)
-----------------------------------------------------------------------
A F4 e a F7 entregaram o `PATCH /api/mybank/loans/[id]` inteiro e
NENHUMA tela o chamava: pelo painel, um emprestimo ativo so podia ser
cancelado, e corrigir um typo na descricao exigia `curl`.

O que esta suite guarda e a PRESENCA DO CAMPO: campo nao tocado nao vai
no corpo. Mandar `descricao` igual a atual nao e inocuo -- vira ajuste,
grava, e a frase da rota reporta uma mudanca que nao mudou nada. Nenhuma
assercao de VALOR pega isso; so as de `!("x" in pedido)`.

O NOME NAO E `ajuste-na-tela`, E ISSO FOI MEDIDO: aquele ja e o do
ajuste de saldo do CARTAO (HMO-253). A primeira versao desta filha usou
o nome curto, sobrescreveu os dois arquivos daquela suite e criou uma
chave DUPLICADA no package.json -- que JSON.parse resolve pela ultima,
calado.
~~~~~~

## Mutantes do ajuste do emprestimo na tela

~~~~~~
Controle negativo do step acima: 28 mutantes, 28 mortos.

Os mais caros sao os que trocam `total` por `falta_receber` na previa:
os dois numeros COINCIDEM no emprestimo sem nada pago, entao eles so
morrem porque todo fixture de previa da suite tem parcela paga.
~~~~~~

## MyBank -- as sete leituras de dinheiro

~~~~~~
-----------------------------------------------------------------------
MyBank F4 -- as sete leituras de dinheiro (HMO-372)
-----------------------------------------------------------------------
SEM `paths:`, como todo o resto deste workflow, e aqui isso e a entrega:
o defeito que esta fase existe para nao ter nasce de um arquivo que nao
tem "mybank" no nome. Um dia em que alguem mexa so em
`lib/telas-de-movimentacao.ts` ou em `lib/previsto-x-realizado.ts` e a
parcela do auto-emprestimo saia da aba Despesas, este step roda de
qualquer jeito.

A suite sobe QUATRO route handlers com duble de client -- nao toca no
Postgres, entao ela nao pertence ao db-verify (que precisa do servico de
banco e e filtrado por `paths:`).

O que ela prova, em uma linha cada:
  * O CONTROLE NEGATIVO, primeiro: uma conta sem emprestimo nenhum le os
    MESMOS numeros de hoje nas quatro rotas -- R$ 200,00 de conta de luz
    em Contas a Pagar, no «A vencer», no «Previsto» de Despesas, e
    `a_receber_do_mybank: null` em Receitas. E a FORMA entra no controle,
    nao so os numeros: um campo que aparecesse zerado em toda conta do
    app mudaria o contrato da tela sem mudar numero nenhum;
  * leitura 1 -- a parcela do devedor aparecendo em Contas a Pagar pela
    view `mybank_due_entries`, e o auto-emprestimo aparecendo UMA vez (a
    view o exclui; a previsao de `scheduled_transactions` e a unica
    linha dele). A lista E o cabecalho, medidos em separado;
  * leitura 2 -- o auto-emprestimo entrando no «Previsto» de Despesas
    com `natureza: "mybank"` E continuando na aba Transferencias, e o «a
    receber» da conexao entrando no «Previsto» de Receitas em CAMPO
    PROPRIO (nao somado dentro de `reembolso_previsto`, que apagaria a
    medicao do credito de grupo);
  * leitura 3 -- a parcela que EU devo reduzindo o disponivel em
    exatamente R$ 1.000, e a parcela A RECEBER nao o aumentando. A
    direcao e HMO-306/308 e a HMO-364 decidiu nao reverter;
  * leitura 4 (HMO-377) -- a parcela que o DEVEDOR deve aparecendo na aba
    Despesas dele. E a leitura que a HMO-372 deixou de fora de proposito,
    e o numero que ela vale esta medido: a aba Despesas da devedora dizia
    R$ 200,00 enquanto Contas a Pagar dizia R$ 1.200,00, pela MESMA
    divida e no MESMO periodo. O controle que importa e que ela entra UMA
    vez -- as duas fontes (a view e a previsao do Caso A em
    `scheduled_transactions`) sao DISJUNTAS no banco, pelo
    `borrower IS DISTINCT FROM lender` da 053, e nao de-duplicadas na
    rota. E ela NAO vaza para Transferencias: ela e `direction:
    'expense'`, e dizer "andou entre as suas contas" sobre dinheiro que
    foi para a conta de OUTRA PESSOA seria uma frase falsa na tela;
  * O RECORTE DE DATA em cada uma: a view e a divida INTEIRA (24
    parcelas por emprestimo) e nao tem recorte de periodo, de proposito.
    Sem o recorte, o «A vencer» de marco somaria R$ 24.000.

O RELOGIO E CONGELADO na suite (`mock.timers`, 2026-03-05): `today()` sai
de `new Date()` e dele saem `effective_status`, o fim do mes do
safe-to-spend e a janela. Com o relogio de verdade a parcela do dia 10
estaria "a vencer" em nove dias do mes e "vencida" nos outros vinte e um
-- a suite seria vermelha em dois tercos dos dias do ano, e verde no dia
certo com a logica de `overdue` apagada.
~~~~~~

## Mutantes do MyBank F4

~~~~~~
Controle negativo do step acima: 24 mutantes, 24 mortos.

Um por leitura, com ancora NOMEADA -- e as ancoras sao trechos de
codigo, nunca frases de comentario: os quatro arquivos mutados CITAM nos
comentarios as proprias decisoes que as ancoras alcancam
(`lerDividaDoMyBank`, `de: null`, `transfer`), entao uma ancora curta
mutaria a EXPLICACAO e deixaria o codigo intacto. A trava de ocorrencia
unica do runner e o que pega esse caso.

O controle negativo da conta vazia NAO tem mutante proprio, e nao pode
ter: "a conta sem MyBank le os mesmos numeros" e uma afirmacao de
AUSENCIA, e quem a quebra e cada um dos mutantes que faz uma leitura
somar o que nao devia. O mutante do `a_receber_do_mybank: { total: 0 }` e
o caso puro disso -- ele nao muda numero nenhum, e e morto so pelo
controle 3/4, que afirma a FORMA da resposta.
~~~~~~

## Export de relatorio -- as oito leituras conferem o erro

~~~~~~
O EXPORT DE RELATORIO CONFERE O `error` DAS OITO LEITURAS (HMO-378)

Defeito pre-existente, medido e registrado pela HMO-207 e deixado para
ca de proposito. A rota tinha DOZE chamadas `.from(...)`: duas
desestruturavam `error` (so para `console.error`) e ZERO mudavam a
resposta. Uma leitura que falhava virava `data: null`, o `?? []`
seguinte fazia dela uma secao vazia, e o export respondia 200 com um
CSV sem linhas -- com os cabecalhos de download corretos.

O 200 e a parte caro. Na planilha, um arquivo com cabecalho e zero
linhas nao se le como erro: le-se como «nao houve movimento no
periodo». E pior que o irmao `fontes-consistentes-que-discordam`: ali
dois numeros discordam e alguem percebe, aqui o arquivo e internamente
coerente, soma sozinho na planilha, e esta vazio.

34 casos. Doze deles forcam o erro de UMA consulta por vez (uma por
consulta, e nao uma por guarda: as tres do ramo de `cash-flow`
chegam a mesma guarda por caminhos diferentes) e exigem 500 com o NOME
da consulta no corpo. Os outros sao os tres controles positivos, sem os
quais o conserto passaria verde devolvendo 500 sempre:

  A. os cinco relatorios saindo 200 e com as linhas certas, numeros
     escritos como literais;
  B. a janela entre o deploy e a colagem da 033: a view pessoal
     ausente tem de CAIR para a antiga e sair 200. Guardar ANTES da
     queda e o erro que este controle pega, e ele nao tem sintoma
     nenhum fora daquela janela. As duas fontes tem numeros diferentes
     no fixture, senao o controle nao diria QUAL foi lida;
  C. o ramo que nao consulta (extrato sem categoria e sem conta) entra
     na guarda com `{ data: [] }` sem `error` e tem de sair 200 -- uma
     guarda escrita ao contrario reprovaria toda conta nova.
~~~~~~

## Mutantes das guardas de leitura do export

~~~~~~
Controle negativo do step acima: 8 mutantes, 8 mortos.

Um por GUARDA, e a mutacao e a mesma nos oito -- `linhasOuFalha(` volta
a ser uma arrow que descarta o `error` e devolve `r.data ?? []`, que e
literalmente o codigo que estava ali antes da HMO-378. Cada mutante
reconstroi o defeito original em UM ramo e deixa os outros sete
consertados, que e a unica forma de medir se a suite aponta qual ramo
perdeu a guarda. Um mutante unico sobre a funcao mataria as oito de uma
vez e deixaria sete sem conferencia.

As ancoras carregam o NOME DA CONSULTA, e isso e obrigatorio:
`linhasOuFalha(` aparece oito vezes no arquivo e
`const linhas = linhasOuFalha(` aparece duas. A trava de ocorrencia
unica do runner e o que pega a ancora ambigua.
~~~~~~

## MyBank -- a fiacao da linha unica em Contas a Pagar

~~~~~~
-----------------------------------------------------------------------
MyBank -- a parcela em UMA linha de Contas a Pagar (HMO-386)
-----------------------------------------------------------------------
O defeito que este step guarda nao estava dentro de componente nenhum:
ele era a COMPOSICAO da pagina. A F4 (HMO-372) fundiu a divida do
devedor na agenda de `/dashboard/bills`, recortada pela janela; a F3
(HMO-371) ja tinha posto na mesma tela um bloco com a divida inteira. As
duas metades, medidas separadas, estavam CERTAS -- e juntas desenhavam a
mesma parcela duas vezes. Medido em producao antes do conserto: a
descricao aparecia 4 vezes numa tela com 2 parcelas em janela.

POR QUE NENHUM STEP ACIMA VIA ISSO, E POR QUE NADA FICAVA VERMELHO: a
parcela entra em «Total a pagar» UMA vez (ela vem da agenda; o bloco nao
soma nada). Nao havia total para discordar -- era duplicacao de LINHA.

Este guard e textual e roda em milissegundos. Ele exige que Contas a
Pagar desenhe a parcela pela linha propria (com o gesto de `reported`, o
id no DOM e a `key` que nao e `null`), que o bloco da divida inteira
esteja em `/dashboard/mybank`, e PROIBE o bloco de voltar para Contas a
Pagar. Ele le o fonte SEM COMENTARIO de proposito: os tres arquivos
explicam esta decisao em prosa e citam os nomes que ele procura, entao
com os comentarios dentro apagar o render deixaria o guard verde.
~~~~~~

## Mutantes da linha unica do MyBank

~~~~~~
Controle negativo do step acima E dos dois pares de steps anteriores:
12 mutantes, 12 mortos, com TRES oraculos declarados por mutante.

Quatro deles sao medidos pelo guard, e sao os que importam aqui -- guard
cuja assercao nunca foi vista reprovar e guard que pode estar casando
com outra linha do arquivo. Dois merecem o nome:

  * `O BLOCO VOLTA PARA CONTAS A PAGAR` e o defeito da issue remontado;
  * `O BLOCO SOME DAS DUAS TELAS` e a metade cara da saida escolhida:
    tirar o bloco de Contas a Pagar sem ele reaparecer em
    /dashboard/mybank nao conserta a duplicacao, APAGA a resposta de
    "quanto eu ainda devo ao todo". O `tsc` fica verde nesse mutante --
    so sobra um import nao usado em arquivo de app.

Os outros oito medem o gesto (secao J da sonda de navegador) e a funcao
pura que separa os dois status: `status` e o campo de DINHEIRO e vale
'pending' tambem na parcela avisada, de proposito; `mybank_status` e o da
TELA. Um componente que lesse o primeiro ofereceria "Avisar que paguei" a
quem ja avisou, e o segundo PATCH responde 200 sem mudar nada.
~~~~~~

## Mutantes da receita prevista no fluxo de caixa

~~~~~~
A RECEITA PREVISTA NO FLUXO DE CAIXA (HMO-400) -- controle negativo do
step `npm run test:receita-no-fluxo` do db-verify.

9 mutantes, 9 mortos. O PRIMEIRO e a razao deste runner existir, e nao
da para substitui-lo por "rodar a suite contra o codigo de antes": o
codigo antigo lia a TABELA, o fixture da suite enche a VIEW, e entao
NENHUMA previsao chega ao calculo -- a suite fica vermelha por falta de
dado, e isso nao prova que ela distingue o SINAL de uma linha que
chegou. O mutante mantem a leitura da view e troca so a direcao por
"expense": e o defeito da issue isolado da troca de relacao.

Os outros oito cobrem as duas meias-correcoes plausiveis (ler
`transaction_type` cru, que deixa a receita FIXA errada e a avulsa
certa; e reescrever a peneira a mao, que le a transferencia como
entrada) e os recortes da consulta -- o filtro de usuario, que a view
`security_invoker` torna obrigatorio porque ela deixa passar a linha de
grupo dos outros membros, e as tres formas de estragar o `status`, uma
delas ("aceitar tudo que nao foi pago") devolvendo exatamente o sintoma
relatado na issue: a receita apagada reaparecendo no fluxo de caixa.
~~~~~~

## O acerto vira teto do credito a receber

~~~~~~
O ACERTO REGISTRADO VIRA TETO DO CREDITO A RECEBER (HMO-404)
-----------------------------------------------------------
Medido em producao na HMO-367 (`scripts/medicao-hmo367-duas-leituras.mjs`,
12/10/2026, fixture HMO-255): o C pagou os R$ 240,00 que devia a A pela
propria sugestao da tela; a tela do grupo passou a dizer "nada a receber"
e a aba Receitas continuou prometendo R$ 39,99 a receber do MESMO C -- em
outubro, o mes do acerto, E em setembro. No mesmo corpo de resposta a
mesma divida aparecia como *recebida* (bloco da HMO-366) e como *a
receber* no «Previsto».

POR QUE O CRITERIO E UM TETO E NAO UMA SUBTRACAO, em um numero:
`39,99 - 240,00 = -200,01`. O acerto de 240 quita SEIS meses de 40, e o
credito do mes e de um mes -- as duas grandezas nao se subtraem, e nada
liga um acerto ao mes que ele quita (`group_settlements` tem UM
`settled_on` e nenhum elo com a despesa). Entao:

  teto(g, devedor) = max(0, acumulado(g, devedor) - acertos_recebidos(g, devedor))
  credito_do_periodo = min(credito_do_periodo, teto(g, devedor))

A suite alimenta o teto com a saida REAL de `fecharMes` (previsto +
realizado, como a HMO-245 pediu) -- um fechamento escrito a mao nao teria
previsto nem realizado dentro, teria numeros, e passaria igual num mundo
em que o teto saisse da view do 007, que e so realizado.
~~~~~~

## Mutantes do teto do acerto

~~~~~~
CONTROLE NEGATIVO DO STEP ACIMA -- 11 mutantes, 11 mortos, todos por
assercao (nenhum pelo tsc).

Dois merecem o nome:

  * `chave_sem_devedor` agrega o acerto por GRUPO, que e o que a view do
    007 ja faz (`settlements_received` soma todos os pagadores): o Pix do
    C abate o que o D me deve. Ele SO morre com fixture de DOIS devedores
    no mesmo grupo, um que pagou e um que nao -- com um devedor so os
    dois criterios empatam, e trocar a fixture o ressuscita sem nenhuma
    assercao mudar de cor;
  * `teto_no_total` aplica o teto ao total em vez de linha por linha, e o
    numero grande deixa de ser a soma das linhas que a pessoa consegue
    apontar na tela -- criterio da HMO-275.

Os dois pisos (`Math.max(0, ...)` no teto e o descarte da linha zerada)
entram como UM mutante, e nao dois: eles se cobrem entre si, e um de cada
vez sobreviveria com razao -- a mesma conclusao que `residuo_sem_piso`
registrou em mutantes-credito-de-grupo.
~~~~~~

## Os tiles do painel levam a janela da tela

~~~~~~
=======================================================================
OS TILES DO PAINEL LEVAM A JANELA DA TELA NO CLIQUE
origem: HMO-408 (parte 2 do plano da HMO-407)
=======================================================================
Os tiles de Receitas e Despesas viraram Link para `/dashboard/receitas` e
`/dashboard/despesas`. O destino nao e novo e nao ganhou leitura nova; o
que esta issue acrescenta e a JANELA indo junto.

E e ela que precisa de prova. `lerPeriodo`, do outro lado, cai no MES
CORRENTE quando nao acha `?de=&ate=` -- de proposito, para link colado de
fora nao virar tela em branco. Com o link nu essa rede se transforma no
defeito: quem clica num numero de agosto chega em outubro, sem erro, sem
tela vazia e sem nada dizendo que o periodo mudou no caminho.

`test:periodo-painel` prova a FUNCAO e `test:tres-numeros` prova o TILE;
as duas ficam verdes com a pagina passando o mes corrente para o link,
porque nenhuma alcanca a fiacao. Dai a sonda de navegador: ela monta
`app/(dashboard)/dashboard/page.tsx` inteira, com `?de=&ate=` na URL, e
le o `href` dos dois anchors.

Sem navegador a suite FALHA, e nao pula: suite que se desliga sozinha e
indistinguivel de suite que passou.
~~~~~~

## A sonda do painel clicavel sabe falhar

~~~~~~
Controle negativo. Os seis mutantes sao as formas de o link chegar ao
destino sem a janela -- e NENHUMA delas tem sintoma: as seis compilam,
renderizam, abrem a tela certa e mostram numero.

Os mutantes 1 e 2 sao o par que a issue mandou medir: o 1 tira a janela e
o 2 troca a janela da tela pelo mes corrente. Uma sonda que usasse o mes
corrente como periodo de teste ficaria VERDE nos dois.

O 6 e o terceiro link do mesmo arquivo (HMO-415): o «Abrir Despesas» da
legenda do cartao de quanto posso gastar, que ficou nu quando a HMO-408
consertou os dois tiles. Ele nao e redundante com o 1 por um motivo que
esta medido na sonda -- o cartao dele so desenha quando o periodo contem
hoje, e e por isso que o caso D existe.
~~~~~~

## Conta de grupo -- a regra de quem e a linha

~~~~~~
A REGRA PURA de "esta conta de grupo nao e minha", com as tres
condicoes. A mais sutil e o `meuUserId` vazio devolvendo `false`: com
`""` a comparacao de dono seria verdadeira para TODA linha, e a tela
trocaria os quatro botoes de todo mundo pelo botao unico do membro.
~~~~~~

## Conta de grupo -- a linha em Contas a Pagar, no navegador

~~~~~~
A LINHA NOVA, montada num Chromium de verdade. Tudo assercao de
PRESENCA e de COMPORTAMENTO: um botao so, a URL do POST comparada com
o id que entrou, o DELETE do desfazer, e a tarja de atraso saindo de
`my_effective_status` -- o fixture tem `effective_status: "paid"` (o
dono pagou) junto, e lendo a coluna errada a conta apareceria "em dia"
para quem ainda deve. "O botao de pagar sumiu" NAO e medido aqui: isso
passa verde numa tela vazia, e quem o mede e o step seguinte.
~~~~~~

## Conta de grupo -- o despacho na tela e o leitor no grupo

~~~~~~
O DESPACHO, que e o que de fato tira os quatro botoes da linha. Ele e
textual porque a `Linha` da agenda e um fechamento dentro de uma
pagina de 1.600 linhas, que nao se monta em sonda -- a mesma divisao
de trabalho da HMO-386 nesta mesma tela. Le o fonte SEM COMENTARIO de
proposito: os arquivos explicam a decisao em prosa e citam os nomes
que o guard procura.
~~~~~~

## Conta de grupo -- o gesto do membro e o quadro por membro

~~~~~~
O GESTO E O LEITOR, com duble de supabase. A assercao que carrega a
issue e a decisao D1: a rota NAO grava lancamento nenhum. Ela e medida
pela lista FECHADA de tabelas escritas, e nao pela ausencia de uma
delas -- quando o dono da baixa, a trigger ja rateia a despesa e a
parte do membro ja fica realizada em `group_share_entries`, entao um
segundo lancamento aqui a contaria DUAS vezes, sem erro nenhum e com
cara de numero certo.
~~~~~~

## As oito leituras da agenda usam o estado da PESSOA

~~~~~~
AS OITO LEITURAS, e este guard existe porque QUATRO delas nao tem rota
montada em suite nenhuma (previsao, papel de pao, projection e
cash-flow) e o cliente do supabase aqui NAO e tipado: `.eq("status")` e
`.eq("my_status")` passam identicos pelo tsc. Ele tambem prende a
excecao declarada ao contrario -- a tela do GRUPO continua lendo
`status`, porque o grupo nao tem status de pago e a conta paga sai das
previstas de proposito.
~~~~~~

## Os mutantes da convencao my_status (o guard acima sabe reprovar?)

~~~~~~
E O CONTROLE NEGATIVO DAQUELE GUARD (HMO-416). O passo acima sai verde
na arvore certa, e verde na arvore certa nao prova nada: um guard cujo
criterio parou de casar imprime o mesmo `✔`. Este runner planta os dez
defeitos NO FONTE DAS ROTAS -- a reversao de `my_status` para `status`,
a excecao "arrumada" para a coluna nova, o filtro apagado -- e exige
que o guard fique vermelho em cada um.

Ele importa mais que a media porque o mutante principal
(`card_invoices_volta_para_status`) e INERTE em producao: a rota filtra
`user_id` na mao, entao nenhuma suite de comportamento pode mata-lo. O
guard e o unico aparelho que sobra, e isto e o que mede o guard.

Custa segundos e nenhuma instalacao nova: o runner copia a arvore para
/tmp e roda `node` puro, sem build e sem banco.
~~~~~~

## O elo conta <-> ativo nas quatro rotas de investimento

~~~~~~
AS ROTAS DE INVESTIMENTO APRENDEM A CONTA (HMO-436, fase 2 da HMO-432).

Quatro route handlers sobre o `account_id` que a migration 059 criou: o
POST e o PATCH que atrelam (com validacao na propria rota, para o erro
ser um 400 explicado em vez do `check_violation` da trigger virando
500), e os dois GET que devolvem o elo e aceitam `?account_id=` para
recortar.

Os quatro na mesma suite porque a regra e a MESMA nos dois caminhos de
escrita e o recorte e o MESMO nos dois de leitura -- o defeito da
HMO-145 sobreviveu meses justamente por estar escrito duas vezes, com
uma das copias sem teste.
~~~~~~

## Os mutantes do elo conta <-> ativo (a suite acima sabe reprovar?)

~~~~~~
E O CONTROLE NEGATIVO DAQUELA SUITE. Verde na arvore certa nao prova
nada: os doze defeitos abaixo deixam a rota respondendo 200/201 com
corpo plausivel, e e por isso que eles precisam de um aparelho em vez de
leitura. Entre eles, o que esta fase mais nao pode deixar passar --
`/api/investments` voltando a falar com o Banco Central, que derrubaria a
carteira de quem nao tem renda fixa nenhuma num timeout do SGS.

O runner planta cada mutante numa COPIA em /tmp (nao na arvore
rastreada) e exige que a suite fique vermelha em cada um.
~~~~~~

## Os mutantes do patrimonio da carteira (as suites sabem reprovar?)

~~~~~~
O PATRIMONIO QUE VEM DA CARTEIRA (HMO-437, fase 3 da HMO-432).

O controle negativo das TRES suites puras que decidem o numero grande da
tela de patrimonio: `test:net-worth` (a substituicao do saldo digitado
pela carteira atrelada), `test:investments` (a soma por conta) e
`test:renda-fixa` (o valor da posicao, `principal + bruto`). As tres
rodam no db-verify; o que falta e a prova de que elas SABEM REPROVAR.

Por que este runner e menos dispensavel que a media: o defeito central
da fase -- contar a mesma aplicacao duas vezes, no saldo digitado e na
carteira -- nao levanta excecao e nao quebra proporcao nenhuma. Ele
imprime um patrimonio MAIOR, plausivel, exatamente igual ao certo mais o
valor da aplicacao. Uma assercao que parasse de alcancar essa soma
imprimiria o mesmo `✔`.

O runner planta cada mutante numa COPIA em /tmp (nao na arvore
rastreada) e exige que alguma das tres suites fique vermelha em cada um.
~~~~~~

## A calculadora dos tres campos do emprestimo (juro, total, rateio)

~~~~~~
A CALCULADORA DOS TRES CAMPOS DO EMPRESTIMO (HMO-446, F2 da HMO-444).

`lib/juros-do-emprestimo.ts` e pura e nao toca banco nenhum: ela decide o
total a receber a partir da taxa, a taxa a partir do total, e o rateio de
cada parcela entre principal que volta e juro ganho.

Por que ela tem suite propria: o defeito desta familia nao levanta excecao
e nao quebra CHECK nenhum. `(1 + taxa)` virando `(1 - taxa)` faz o MyBank
emprestar R$ 1.000 a 20% e receber R$ 800 de volta -- a serie soma exato, o
banco aceita (`amount > 0`, `principal > 0`) e nenhuma tela reclama. E o
rateio sem a ultima parcela absorvendo o centavo erra o TOTAL sem errar
linha nenhuma: 12 x 83,33 sao 999,96, e os 4 centavos de principal viram
juro sem que nenhuma das 24 pernas explique por que.
~~~~~~

## Os mutantes da calculadora de juros (a suite acima sabe reprovar?)

~~~~~~
O controle negativo da suite acima -- ela SABE REPROVAR?

Os dois mutantes que a issue nomeia estao na lista: `(1 + taxa)` virando
`(1 - taxa)`, e o rateio perdendo a absorcao do centavo. O segundo so morre
numa assercao de SOMA (uma assercao por parcela o absolveria), e por isso o
runner existe em vez de uma leitura do codigo.

O runner planta cada mutante numa COPIA em /tmp (nao na arvore rastreada) e
exige que a suite fique vermelha em cada um.
~~~~~~

## Os tres numeros da conversa do Papel de Pao (ganhei, gastei, saldo)

~~~~~~
OS TRES NUMEROS DA CONVERSA (HMO-465, F2 da HMO-462).

`lib/saldo-da-conversa.ts` e pura e nao toca banco nenhum: ela produz
`ganhei`, `gastei` e `saldo = ganhei - gastei` a partir de linhas de
`financial_transactions` -- REALIZADO, nao previsto. Nenhuma funcao de
`lib/papel-de-pao.ts` entra: aquele le `scheduled_transactions_effective`,
onde a despesa e POSITIVA e quem diz a direcao e a coluna `direction`.

Por que ela tem suite propria: o defeito desta familia nao levanta excecao
e nao quebra CHECK nenhum. Sem o `group_id IS NULL`, a perna de grupo do
custo pessoal dela entra em `gastei` calada. Sem o `Math.abs`, `gastei`
fica NEGATIVO e `ganhei - gastei` passa a SOMAR as pernas -- 2000 e 1000
certos na tela, e o saldo dizendo 3000. A suite roda nos DOIS fusos porque
o mes corrente vem de Sao Paulo e o CI e UTC (HMO-173).
~~~~~~

## Os mutantes dos tres numeros da conversa (a suite acima sabe reprovar?)

~~~~~~
O controle negativo da suite acima -- ela SABE REPROVAR?

Os quatro mutantes que a issue nomeia estao na lista: `!== false` virando
`=== true` (a linha do cache offline sai da soma), o `group_id IS NULL`
saindo, o sinal da despesa, e o mes corrente virando horizonte aberto.
Nenhum dos quatro da erro em lugar nenhum -- os tres numeros saem bem
formatados e so quem soma na mao descobre.

O runner planta cada mutante numa COPIA em /tmp (nao na arvore rastreada) e
exige que a suite fique vermelha em cada um.
~~~~~~

## O motor da conversa do papel de pao (5 estados, o relogio por parametro)

~~~~~~
O MOTOR DA CONVERSA DO MODO PAPEL DE PAO (HMO-464, F1 da HMO-462).

O modo mostrava relatorio -- tres numeros, listas que abrem, navegacao
mes a mes. A issue-mae pede CONVERSA: "Ola {Nome}, o que deseja?",
botao Gastei, Ganhei, Saldo, e vai caminhando.
`lib/conversa-do-papel.ts` e a maquina de estados disso, pura: sem
React, sem rede, sem supabase e sem data do sistema lida por dentro --
o relogio entra por parametro.

Por que ela tem suite propria, e por que a suite roda DUAS VEZES (em
America/Sao_Paulo e em UTC, dentro do proprio alvo): o defeito desta
familia nao levanta excecao. Um `new Date()` escondido no motor faz o
"Saldo" responder por outro mes com a mesma cara de certo, e as 21h do
dia 31 em Sao_Paulo sao o dia 1o em UTC -- com um fuso so, a suite
passaria verde. E a convencao de CENTAVOS do teclado (digitar 1-0-0-0 e
dez reais) nao da erro nenhum quando erra: da um lancamento de valor
plausivel, cem vezes maior ou menor.
~~~~~~

## Os mutantes do motor da conversa (a suite acima sabe reprovar?)

~~~~~~
O controle negativo da suite acima -- ela SABE REPROVAR?

A issue pede com estas palavras que cada transicao tenha um mutante que
a suite mate, e aqui isso paga mais que a media: a suite e quase toda
feita de assercao sobre TEXTO (as frases da conversa, os rotulos dos
botoes) e sobre IDENTIDADE de objeto (`proxima === atual`, que e como o
motor diz "nada aconteceu"). Os dois tipos sao os que mais passam verde
sem medir nada.

O runner planta cada mutante numa COPIA em /tmp (nao na arvore
rastreada), tem controle positivo (codigo intacto tem de PASSAR), cobra
ocorrencia UNICA de cada ancora -- um replace que nao casa nao muda
arquivo nenhum, e isso se le como "mutante sobreviveu" quando o mutante
nunca existiu -- e tem tres SOBREVIVENTES ESPERADOS declarados, que e o
que impede a suite de prender ramo inalcancavel e de cobrar do `.mjs`
uma garantia que e do tsc.
~~~~~~

## A rota da conversa do Papel de Pao (sinal, conta, categoria, mes)

~~~~~~
A ROTA DA CONVERSA (HMO-481, F3 da HMO-462).

POST /api/papel-de-pao/conversa grava "Gastei X"/"Ganhei X" em
`financial_transactions`; GET devolve os tres numeros do mes corrente por
`lib/saldo-da-conversa.ts` (F2). A rota nao faz conta nenhuma -- ela
autentica, resolve os tres defaults (data, conta, categoria), grava e
delega.

Por que ela tem suite propria, com DUBLE e nao com grep: as duas promessas
desta fase sao sobre o OBJETO QUE CHEGOU AO BANCO. `account_id`
PREENCHIDO -- a coluna que /api/personal-finance/transactions nao lista no
insert dele ate hoje, e que e anulavel, entao nada reprova e o
`update_account_balance_trigger` nao move saldo nenhum. E os campos de
divisao de despesa AUSENTES -- uma afirmacao sobre o que NAO esta no
objeto, que nenhum grep prova sozinho (um spread do corpo levaria o campo
de volta sem a palavra aparecer). A suite chama o handler e olha
`escritas` do duble, e tem CONTROLE POSITIVO das chamadas ao duble: sem
ele, uma rota que trocasse o jeito de obter o client deixaria a sonda
vendo "uma resposta qualquer".

A suite roda nos DOIS fusos porque a data do lancamento e a janela do mes
saem de `today()` (Sao Paulo) e o CI e UTC (HMO-173) -- e um dos testes
CONGELA o relogio em 31/10 as 22:00 de Sao Paulo, porque rodar nos dois
fusos nao distingue `today()` de `toISOString()` em 21 das 24 horas.
~~~~~~

## Os mutantes da rota da conversa (a suite acima sabe reprovar?)

~~~~~~
O controle negativo da suite acima -- ela SABE REPROVAR?

Os seis que a issue nomeia estao na lista: o sinal invertido, `account_id`
apagado (em DUAS formas -- `null` grava a linha orfa, `undefined` e o que
o PostgREST descarta do payload), `transaction_type` apagado, o `select`
voltando a nomear colunas, `today()` virando `toISOString()` e a categoria
trocando de direcao. Quase nenhum deles da erro em lugar nenhum: a tela
continua dizendo "anotei" com tres numeros bem formatados, e so quem soma
na mao descobre.

O runner planta cada mutante numa COPIA em /tmp (nao na arvore
rastreada), tem controle positivo (arvore limpa tem de PASSAR) e cobra
ocorrencia UNICA de cada ancora -- um replace que nao casa nao muda
arquivo nenhum, e isso se le como "mutante sobreviveu" quando o mutante
nunca existiu.
~~~~~~

## O lancamento fora dos totais nas duas rotas (PATCH estrito, POST condicional)

~~~~~~
---------------------------------------------------------------------
O LANCAMENTO QUE NAO SOMA NOS TOTAIS -- HMO-452 (F2 da HMO-443)
---------------------------------------------------------------------
"adicionei um ajuste na minha conta investimento, ela entrou como uma
receita de ajuste mas nao quero que ela fique somana nos totais."

A coluna e `financial_transactions.include_in_total` (migration 060),
POSITIVA e `NOT NULL DEFAULT true`. Esta suite mede as DUAS pontas de
escrita dela, que tem formas OPOSTAS de proposito:

  POST  -- condicional. A coluna so e nomeada no INSERT quando o valor e
           `false`. `true` e o DEFAULT, e nomear coluna ausente faz o
           PostgREST responder 42703 e a rota cair em 500: antes de a 060
           ser colada a mao, NENHUM lancamento seria criado pela API.
  PATCH -- estrito (`body.include_in_total === true`), a forma do PATCH
           da 058. Aqui nao existe omitir e cair no DEFAULT: o que entra
           no patch e gravado.

Por que sonda de ROTA com duble, e nao grep nem tsc: `request.json()` e
`any`, e o objeto que vai para o `.insert()`/`.update()` do supabase-js
esta na fronteira permissiva do client -- trocar `=== true` por
`Boolean(...)` COMPILA, e as duas rotas respondem 200/201 com o corpo
completo nos dois casos. A resposta nao distingue o defeito; so o payload
que o handler mandou gravar.

E grep seria pior que inutil: as duas rotas CITAM `Boolean(...)` e
`!include_in_total` nos comentarios, explicando o que nao fazer. Uma
varredura do fonte cru leria a prosa e ficaria verde depois de alguem
trocar o codigo pela forma errada.
~~~~~~

## Os mutantes do lancamento fora dos totais (a suite acima sabe reprovar?)

~~~~~~
O controle negativo da suite acima -- ela SABE REPROVAR?

O primeiro mutante e o que a HMO-452 pede nominalmente:
`Boolean(body.include_in_total)` no lugar do teste estrito. Ele e o unico
defeito desta feature que grava o OPOSTO do pedido -- `Boolean("false")`
e `true`, e o lancamento que a pessoa acabou de desmarcar volta para os
totais com 200 e sem sintoma na tela.

Os dois seguintes sao o estado de ANTES da issue (o campo removido de
cada rota), e depois vem o par que TROCA a forma de uma rota pela da
outra: POST incondicional derruba toda criacao pela API antes da colagem;
PATCH condicional deixa desmarcar funcionar e REMARCAR nao -- os dois
respondendo 200.

As ancoras levam a atribuicao inteira de proposito: as rotas citam as
formas erradas nos comentarios, e uma ancora curta mutaria a prosa, o
codigo ficaria intacto e o mutante "sobreviveria" sem nunca ter existido.
O runner cobra ocorrencia UNICA de cada uma e aborta em vez de mutar a 1a
de duas.
~~~~~~

## O flag «fora dos totais» esta ligado no formulario (checkbox, corpo e edicao)

~~~~~~
---------------------------------------------------------------------
A FIACAO DO FLAG NO FORMULARIO -- HMO-452 (F2 da HMO-443)
---------------------------------------------------------------------
Os dois steps acima provam as DUAS ROTAS, e `test:campos-lancamento`
prova a CHECKBOX. O formulario nao passa por nenhum dos dois:
`gravarTransacao` escreve DIRETO pelo supabase-js (`.insert()` /
`.update()` em `financial_transactions`), sem tocar nas rotas.

Entao a feature pode estar inteira -- rota estrita, 12 mutantes mortos,
checkbox desenhada, selo na lista -- e o Salvar descartar a escolha. Foi
EXATAMENTE o estado desta branch quando este guard nasceu: a checkbox
existia, `somaNosTotais` existia em `ValoresDeLancamento`, o JSDoc de
`somaNosTotaisEstaNaTela` AFIRMAVA que `gravarTransacao` chamava o portao
-- e o campo nao estava no objeto `linha`. A pessoa marcaria, o toast
diria sucesso, e o total continuaria incluindo o ajuste.

NENHUM DOS TRES MODOS DE FALHA APARECE NO `tsc`: o objeto vai para a
fronteira permissiva do supabase-js (campo faltando nao e erro de tipo),
o campo posto so no ramo do insert compila igual, e a edicao que nao
recarrega o flag gravado e um objeto a menos num spread.

O guard mede POSICAO tambem, e nao so presenca: `include_in_total:` tem
de vir ANTES de `let transacao`, que e onde o objeto `linha` termina e os
dois ramos comecam. Dentro do insert, marcar funciona na criacao e e
impossivel de desfazer pelo formulario -- metade do pedido.

Comentario e `import` saem antes da varredura, e aqui isso e
load-bearing de verdade: os arquivos desta feature citam
`include_in_total` e `somaNosTotais` em paragrafos inteiros de prosa, e um
guard sobre o fonte cru leria os proprios comentarios que descrevem o
defeito. Os cinco mutantes (campo fora de `linha`, campo so no insert,
edicao sem recarga, e os dois `!` das inversoes) foram medidos MORTOS.
~~~~~~

## As sete somas em JS honram include_in_total (mensal E intervalo)

~~~~~~
---------------------------------------------------------------------
AS SETE SOMAS EM JAVASCRIPT -- HMO-453 (F3 da HMO-443)
---------------------------------------------------------------------
A 060 pos `AND t.include_in_total` em `category_monthly_totals`, e dali
ele propaga para a cadeia de cinco views e para os cinco leitores delas.
A 063 fez o mesmo em `budget_consumption`, que tem o `SUM` dela proprio
(e e medida no db-verify.yml, com banco de pe). Esta suite e a OUTRA
METADE: as somas que percorrem as LINHAS CRUAS em JavaScript e nao
herdam nada de view nenhuma.

O INVENTARIO FOI FEITO PELA TABELA, E E ISSO QUE TORNA ESTE STEP
NECESSARIO. `git grep -l financial_transactions` nas duas metades
(codigo e `database/migrations`), nao pelo nome da coluna nova --
levantar leitores pelo nome acha `app/` e `lib/` e PERDE as views,
porque uma view que soma a mesma tabela nao cita a coluna nova nem roda
em JS. Foi a licao caro da HMO-431 e o que custou a HMO-441: o numero
grande honrando o flag e o grafico logo abaixo nao.

A ARMADILHA QUE ESTA SUITE EXISTE PARA MEDIR: MENSAL x INTERVALO.
Fluxo de Caixa e Categorias tem DOIS ramos cada -- mes inteiro (as
views, ja filtradas e ja em producao) e intervalo livre (estas somas em
JS). Consertar so um faz "setembro inteiro" e "01/09 a 30/09" darem
numeros DIFERENTES, que e pior que o defeito original: as duas leituras
discordam sem nada que arbitre.

E A SONDA QUE MEDE COM MES INTEIRO CAI NO RAMO MENSAL: o duble nao
preenche `personal_monthly_cash_flow`, a resposta sai
`total_expense = 0` com status 200, e esse zero se le como "a regra
descartou todas as linhas". Por isso TODO periodo da suite vai de
2026-04-20 a 2026-05-31 -- um intervalo que CORTA MES nas duas pontas,
e que cai no ramo de intervalo SEM depender de `cartao=fatura`. Ha um
caso COM o parametro tambem, porque e como o painel principal pergunta
e porque e o unico caminho que usa `COLUNAS_DO_REALIZADO_DE_CAIXA`.

17 blocos. Os quatro que nenhuma outra suite alcanca: o predicado nos
QUATRO estados (true/false/ausente/null), as duas rotas pelo ramo de
intervalo, a HERANCA de `resumoComPartesDeGrupo` medida pelo numero (a
issue pede "confirmar, nao assumir"), e o bloco que afirma que as duas
rotas FECHAM ENTRE SI na mesma fixture -- sem ele, a pizza do painel
pode deixar de fechar com o numero grande em cima dela e as duas suites
de rota continuariam verdes cada uma por conta propria.
~~~~~~

## Os mutantes das sete somas (as seis suites sabem reprovar?)

~~~~~~
17 mutantes, 17 MORTOS -- medidos em 2026-10-21. Eles rodam SEIS suites
(a de cima mais `test:movimentacoes`, `test:telas-de-movimentacao`,
`test:categorias-do-periodo`, `test:realizado-do-caixa` e
`test:variable-spend`), com controle positivo em cada uma: uma suite ja
vermelha faria todo mutante dela aparecer como MORTO sem medir nada.

A ISSUE PEDE ESTE RUNNER NOMINALMENTE: "mutante por cima de cada filtro
novo. Um filtro de opt-out sem mutante e o caso tipico do sobrevivente
que ninguem ve -- o teste passa com o filtro APAGADO se a fixture nao
tiver linha marcada". Toda fixture tocada por esta fase ganhou UMA linha
marcada e UMA nao marcada, e e este arquivo que mede se isso bastou.

AS QUATRO FAMILIAS:
  * o FILTRO APAGADO, um por sitio (6) -- o estado de antes da issue;
  * a POLARIDADE do predicado (5) -- `=== true`, `Boolean(...)`,
    `!campo`, sempre-verdadeiro e invertido. Os tres primeiros sao o
    MESMO defeito escrito de tres formas, e e o pior desta feature: na
    janela entre o deploy e a colagem -- e no cache offline -- o campo
    chega `undefined`, e os tres fazem `undefined` significar "nao
    soma". O relatorio inteiro esvazia, sem erro e com o tsc verde;
  * a COLUNA FORA DO `select` (4) -- o filtro vira no-op SEM que uma
    linha de codigo mude. Observavel no duble porque ele PROJETA so as
    colunas nomeadas;
  * o CONSERTO ZELOSO (2) -- filtrar onde a secao 3c do plano mandou NAO
    filtrar: dentro de `realizadoComCartaoPelaFatura` (segundo filtro no
    mesmo caminho, sem mutante que morra) e nas CONTAGENS de
    `resumoDaTela`, onde a frase "N lançamento(s)" passaria a discordar
    da lista ao lado dela.

As ancoras levam a LINHA DE CODIGO inteira, com indentacao e `;`: os sete
arquivos citam `=== true`, `!linha.include_in_total` e `!== false` em
prosa, e `lib/fora-dos-totais.ts` tem um bloco inteiro so sobre isso. Uma
ancora curta mutaria o comentario e o mutante "sobreviveria" sem nunca
ter existido. O runner cobra ocorrencia UNICA e aborta em vez de mutar a
1a de duas -- `lib/variable-spend.ts` e `lib/categorias-do-periodo.ts`
tem o MESMO `for (const t of apenasNosTotais(transacoes))`.
~~~~~~

## Os dois controles negativos do Atualizar (HMO-477)

~~~~~~
CONTROLE NEGATIVO DOS DOIS RUNNERS DO "Atualizar" (HMO-477, ligados pela HMO-491).

A HMO-477 escreveu estes dois runners no mesmo dia e NAO lhes deu step. O
`check-mutantes-in-ci` os acusou -- "runner de mutante que nenhum workflow roda
e ninguem declarou" -- e, como ele e o step 14 desta fila, o job inteiro morria
ali: 13 de 295 steps rodavam. Foi o primeiro vermelho que apareceu depois que
a HMO-491 devolveu a PARTIDA ao workflow.

Por que ganharam step em vez de declaracao: o `nao-triado` tem TETO e o teto
hoje e ZERO (ver `TETO_NAO_TRIADO` no guard) -- de proposito, para que declarar
nao seja o jeito educado de arquivar o problema. E apagar seria jogar fora
controle negativo escrito no mesmo dia, de proposito, para duas suites que JA
estao no CI (`test:lista-na-tela` e `test:offline-leitura`).

Os dois num step so, e medidos antes de entrar:

    mutantes:atualizar-da-faixa          7/7  mutantes mortos   37s
    mutantes:atualizar-nas-cinco-telas  29/29 mutantes mortos   13s

50s somados para 36 mutantes -- barato porque os dois usam o bloco da HMO-319,
que compartilha uma compilacao entre os mutantes do bloco em vez de recompilar
o programa por mutante.
~~~~~~
