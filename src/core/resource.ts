/** Provider-agnostic resource model — no Google API shapes belong in this file. */
export interface Resource {
  id: string;
  type: string;
  provider: string;
  desiredState: unknown;
}

export type Change =
  | { operation: 'create'; resource: Resource }
  | { operation: 'update'; before: Resource; after: Resource }
  | { operation: 'delete'; resource: Resource };
