import type { AnalyticsConfig, ResourceDef } from '../config/schema.js';

export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

type Category = 'variable' | 'trigger' | 'tag';

function nodeId(category: Category, id: string): string {
  return `${category}:${id}`;
}

const VARIABLE_REF = /\{\{\s*([^}]+?)\s*\}\}/g;

function collectVariableRefs(def: ResourceDef, variableIds: Set<string>): Set<string> {
  const refs = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(VARIABLE_REF)) {
        const name = match[1];
        if (variableIds.has(name)) refs.add(name);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(def);
  return refs;
}

/** Edges point from prerequisite to dependant, so a topological sort is a valid apply order. */
export class DependencyGraph {
  private readonly edges = new Map<string, Set<string>>();
  private readonly nodes = new Set<string>();

  addNode(node: string): void {
    this.nodes.add(node);
    if (!this.edges.has(node)) this.edges.set(node, new Set());
  }

  addEdge(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    this.edges.get(from)!.add(to);
  }

  /** Kahn's algorithm. Throws CircularDependencyError if a cycle exists. */
  topologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    for (const node of this.nodes) inDegree.set(node, 0);
    for (const targets of this.edges.values()) {
      for (const target of targets) inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }

    const queue = [...this.nodes].filter((node) => inDegree.get(node) === 0).sort();
    const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const target of [...(this.edges.get(node) ?? [])].sort()) {
        const remaining = inDegree.get(target)! - 1;
        inDegree.set(target, remaining);
        if (remaining === 0) queue.push(target);
      }
    }

    if (order.length !== this.nodes.size) {
      const remaining = [...this.nodes].filter((node) => !order.includes(node)).sort();
      throw new CircularDependencyError(remaining);
    }

    return order;
  }
}

export function buildDependencyGraph(config: AnalyticsConfig): DependencyGraph {
  const graph = new DependencyGraph();
  const variableIds = new Set(Object.keys(config.gtm.variables));

  for (const [id, variable] of Object.entries(config.gtm.variables)) {
    const self = nodeId('variable', id);
    graph.addNode(self);
    for (const variableId of collectVariableRefs(variable, variableIds)) {
      if (variableId !== id) graph.addEdge(nodeId('variable', variableId), self);
    }
  }

  for (const [id, trigger] of Object.entries(config.gtm.triggers)) {
    const self = nodeId('trigger', id);
    graph.addNode(self);
    for (const variableId of collectVariableRefs(trigger, variableIds)) {
      graph.addEdge(nodeId('variable', variableId), self);
    }
  }

  for (const [id, tag] of Object.entries(config.gtm.tags)) {
    const self = nodeId('tag', id);
    graph.addNode(self);
    for (const triggerId of [...(tag.trigger ?? []), ...(tag.exceptTrigger ?? [])]) {
      graph.addEdge(nodeId('trigger', triggerId), self);
    }
    for (const variableId of collectVariableRefs(tag, variableIds)) {
      graph.addEdge(nodeId('variable', variableId), self);
    }
  }

  return graph;
}
