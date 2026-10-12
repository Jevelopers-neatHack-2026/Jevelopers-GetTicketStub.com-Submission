// The installed @types/node (v20) predates node:sqlite. This declares the small part we use; delete it
// when @types/node is 22.13 or newer.
declare module "node:sqlite" {
  export type SQLInputValue = string | number | bigint | null | Uint8Array;
  export interface StatementSync {
    get(...params: SQLInputValue[]): unknown;
    all(...params: SQLInputValue[]): unknown[];
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
