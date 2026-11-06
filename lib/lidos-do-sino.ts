/**
 * O "LIDO" DO SINO, sem import nenhum.
 *
 * Mora fora de lib/avisos-do-sino.ts de proposito: aquele arquivo puxa
 * lib/services/notifications.ts (a frase do vencimento), que importa
 * `web-push`, e o hook do sino roda no navegador. Importar um valor de la no
 * cliente levava `web-push` para o bundle e o `next build` parava com
 * "Can't resolve 'net'/'tls'".
 */

/**
 * Os ids lidos que ainda valem: os que estao na lista de agora. O resto e
 * jogado fora, para o que fica guardado no navegador nao crescer sem limite.
 */
export function lidosValidos(lidos: Iterable<string>, ids: Iterable<string>): string[] {
  const atuais = new Set(ids);
  return Array.from(new Set(lidos)).filter((id) => atuais.has(id));
}

export function contarNaoLidos(ids: Iterable<string>, lidos: Iterable<string>): number {
  const marcados = new Set(lidos);
  return Array.from(new Set(ids)).filter((id) => !marcados.has(id)).length;
}
