declare module 'js-yaml' {
  export function dump(obj: unknown, options?: Record<string, unknown>): string;
  export function load(str: string, options?: Record<string, unknown>): unknown;
}
