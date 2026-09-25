// =====================================================
// ONDE A FILA OFFLINE FICA GUARDADA
// =====================================================
// IndexedDB, e de proposito burro: aqui nao ha nenhuma decisao. Toda regra de
// "o que pode entrar", "em que ordem sai" e "o que fazer com cada erro" mora em
// `lib/offline-queue.ts`, que e testavel sem navegador.
//
// Por que IndexedDB e nao localStorage: o localStorage e SINCRONO e o navegador
// pode limpa-lo sob pressao de memoria com mais folga. A fila guarda a unica
// copia de um lancamento que a pessoa ja deu como salvo -- perder isso e perder
// dinheiro do controle dela.
//
// A REGRA QUE VALE MAIS QUE O RESTO DESTE ARQUIVO: se a gravacao falhar, quem
// chamou PRECISA saber. Um `catch {}` aqui faria a tela dizer "salvo offline"
// com a fila vazia, e o lancamento sumiria sem nenhum sintoma -- que e a pior
// coisa que este modulo pode fazer. Por isso toda funcao abaixo propaga o erro.
// =====================================================

import type { ItemDaFila } from "./offline-queue";

const BANCO = "pulodogato-offline";
const LOJA = "lancamentos";
const VERSAO = 1;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponivel neste navegador"));
      return;
    }

    const req = indexedDB.open(BANCO, VERSAO);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA)) {
        db.createObjectStore(LOJA, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Falha ao abrir o banco local"));
    // Navegacao anonima em alguns navegadores deixa o `open` pendurado para
    // sempre em vez de dar erro. Sem isto, "Salvar" offline ficaria girando.
    req.onblocked = () => reject(new Error("Banco local bloqueado por outra aba"));
  });
}

function transacionar<T>(
  modo: IDBTransactionMode,
  executar: (loja: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(LOJA, modo);
        const req = executar(tx.objectStore(LOJA));

        // O sucesso e confirmado no COMMIT da transacao, nao no `onsuccess` do
        // request: um request pode ter sucesso e a transacao abortar depois
        // (cota estourada e o caso real). Confirmar cedo demais diria "salvo"
        // para um lancamento que nao ficou gravado.
        let valor: T;
        req.onsuccess = () => {
          valor = req.result;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(valor);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Falha na transacao local"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Transacao local abortada"));
        };
      })
  );
}

export function lerFila(): Promise<ItemDaFila[]> {
  return transacionar<ItemDaFila[]>("readonly", (loja) => loja.getAll());
}

export function gravarItem(item: ItemDaFila): Promise<unknown> {
  return transacionar("readwrite", (loja) => loja.put(item));
}

export function removerItem(id: string): Promise<unknown> {
  return transacionar("readwrite", (loja) => loja.delete(id));
}

/** Usado pela tela para descartar um lancamento que falhou de vez. */
export function limparFalhados(ids: string[]): Promise<unknown[]> {
  return Promise.all(ids.map(removerItem));
}
