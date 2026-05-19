declare module '@iarna/toml' {
  export type AnyJson = string | number | boolean | null | AnyJson[] | JsonMap;
  export interface JsonMap {
    [key: string]: AnyJson;
  }

  export function parse(input: string): unknown;
  export function stringify(input: JsonMap): string;
}
