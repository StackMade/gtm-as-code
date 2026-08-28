import type { AuthClient } from 'google-auth-library';
import type { Resource } from '../../../core/resource.js';
import { GtmApiError, extractApiStatus } from './errors.js';
import { buildOwnershipNotes, parseOwnershipNotes } from './ownership.js';

const BASE_URL = 'https://www.googleapis.com/tagmanager/v2';

export interface GtmWorkspaceRef {
  accountId: string;
  containerId: string;
  workspaceId: string;
}

/** A GTM container version, as returned by `create_version`, `versions.list`, and `versions/live`. */
export interface GtmVersionRef {
  containerVersionId: string;
  name?: string;
  notes?: string;
}

const KINDS = {
  variable: { collection: 'variables', field: 'variable', idField: 'variableId', type: 'gtm.variable' },
  trigger: { collection: 'triggers', field: 'trigger', idField: 'triggerId', type: 'gtm.trigger' },
  tag: { collection: 'tags', field: 'tag', idField: 'tagId', type: 'gtm.tag' },
} as const;

export type GtmKind = keyof typeof KINDS;

/** GTM's own id field name for a kind's objects (`variableId`/`triggerId`/`tagId`). */
export function gtmIdField(kind: GtmKind): 'variableId' | 'triggerId' | 'tagId' {
  return KINDS[kind].idField;
}

/** A GTM API variable/trigger/tag payload, as GTM itself represents it. */
export type GtmObject = Record<string, unknown> & { notes?: string };

type GtmListResponse = Record<string, unknown> & { nextPageToken?: string };

/** Resolves the workspace id to operate on: the configured one, or the container's first workspace. */
export async function resolveWorkspaceId(
  auth: AuthClient,
  accountId: string,
  containerId: string,
  workspace?: string,
): Promise<string> {
  if (workspace) return workspace;
  try {
    const response = await auth.request<{ workspace?: Array<{ workspaceId: string }> }>({
      url: `${BASE_URL}/accounts/${accountId}/containers/${containerId}/workspaces`,
    });
    const first = response.data.workspace?.[0];
    if (!first) throw new Error('Container has no workspaces');
    return first.workspaceId;
  } catch (error) {
    throw new GtmApiError('resolve default workspace for', containerId, extractApiStatus(error), { cause: error });
  }
}

export class GtmClient {
  constructor(
    private readonly auth: AuthClient,
    private readonly ref: GtmWorkspaceRef,
  ) {}

  private collectionUrl(kind: GtmKind): string {
    const { accountId, containerId, workspaceId } = this.ref;
    return `${BASE_URL}/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/${KINDS[kind].collection}`;
  }

  /**
   * Raw remote objects (managed and unmanaged) for one kind, following
   * `nextPageToken` to the end. A partial listing would look to `diff` like
   * resources that do not exist remotely, and `apply` would create duplicates.
   */
  async list(kind: GtmKind): Promise<GtmObject[]> {
    const objects: GtmObject[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const response = await this.auth.request<GtmListResponse>({
          url: this.collectionUrl(kind),
          params: pageToken ? { pageToken } : undefined,
        });
        objects.push(...((response.data[KINDS[kind].field] as GtmObject[] | undefined) ?? []));
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (error) {
      throw new GtmApiError(`list ${kind}s`, this.ref.containerId, extractApiStatus(error), { cause: error });
    }
    return objects;
  }

  /** Remote state filtered to resources this tool owns, as the generic Resource model. */
  async listManaged(kind: GtmKind): Promise<Resource[]> {
    const objects = await this.list(kind);
    const resources: Resource[] = [];
    for (const object of objects) {
      const ownership = parseOwnershipNotes(object.notes);
      if (!ownership) continue;
      resources.push({ id: ownership.resourceId, type: KINDS[kind].type, provider: 'google', desiredState: object });
    }
    return resources;
  }

  /** Creates a GTM object, stamping it with ownership metadata for `resourceId`. */
  async create(kind: GtmKind, resourceId: string, payload: GtmObject): Promise<GtmObject> {
    const body = { ...payload, notes: buildOwnershipNotes(resourceId, payload.notes) };
    try {
      const response = await this.auth.request<GtmObject>({ url: this.collectionUrl(kind), method: 'POST', data: body });
      return response.data;
    } catch (error) {
      throw new GtmApiError(`create ${kind}`, resourceId, extractApiStatus(error), { cause: error });
    }
  }

  /** Updates an existing GTM object by its GTM-assigned id, preserving ownership metadata. */
  async update(kind: GtmKind, resourceId: string, gtmId: string, payload: GtmObject): Promise<GtmObject> {
    const body = { ...payload, notes: buildOwnershipNotes(resourceId, payload.notes) };
    try {
      const response = await this.auth.request<GtmObject>({
        url: `${this.collectionUrl(kind)}/${gtmId}`,
        method: 'PUT',
        data: body,
      });
      return response.data;
    } catch (error) {
      throw new GtmApiError(`update ${kind}`, resourceId, extractApiStatus(error), { cause: error });
    }
  }

  async delete(kind: GtmKind, resourceId: string, gtmId: string): Promise<void> {
    try {
      await this.auth.request({ url: `${this.collectionUrl(kind)}/${gtmId}`, method: 'DELETE' });
    } catch (error) {
      throw new GtmApiError(`delete ${kind}`, resourceId, extractApiStatus(error), { cause: error });
    }
  }

  private builtInVariablesUrl(): string {
    const { accountId, containerId, workspaceId } = this.ref;
    return `${BASE_URL}/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/built_in_variables`;
  }

  /** API `type` values currently enabled in this workspace. */
  async listEnabledBuiltInVariables(): Promise<string[]> {
    try {
      const response = await this.auth.request<{ builtInVariable?: Array<{ type: string }> }>({
        url: this.builtInVariablesUrl(),
      });
      return (response.data.builtInVariable ?? []).map((v) => v.type);
    } catch (error) {
      throw new GtmApiError('list built-in variables for', this.ref.containerId, extractApiStatus(error), { cause: error });
    }
  }

  /** Enables one or more built-in variables by their API `type`. Idempotent — already-enabled types are a no-op. */
  async enableBuiltInVariables(types: string[]): Promise<void> {
    if (types.length === 0) return;
    try {
      await this.auth.request({
        url: this.builtInVariablesUrl(),
        method: 'POST',
        params: types.map((type) => ['type', type]),
      });
    } catch (error) {
      throw new GtmApiError('enable built-in variables for', this.ref.containerId, extractApiStatus(error), { cause: error });
    }
  }

  /** Creates a container version from this workspace's current state. Does not publish it. */
  async createVersion(name: string, notes: string): Promise<GtmVersionRef> {
    const { accountId, containerId, workspaceId } = this.ref;
    try {
      const response = await this.auth.request<{ containerVersion?: GtmVersionRef; compilerError?: boolean }>({
        url: `${BASE_URL}/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}:create_version`,
        method: 'POST',
        data: { name, notes },
      });
      if (response.data.compilerError) throw new GtmApiError('create version for', containerId, 'COMPILER_ERROR');
      if (!response.data.containerVersion) throw new GtmApiError('create version for', containerId, 'EMPTY_RESPONSE');
      return response.data.containerVersion;
    } catch (error) {
      if (error instanceof GtmApiError) throw error;
      throw new GtmApiError('create version for', containerId, extractApiStatus(error), { cause: error });
    }
  }

  /**
   * True if this workspace has diverged from the container in a way GTM can't auto-merge,
   * typically a human editing the same workspace through the UI. `apply` checks this before
   * writing so it refuses to proceed rather than silently overwriting those edits.
   */
  async hasSyncConflicts(): Promise<boolean> {
    const { accountId, containerId, workspaceId } = this.ref;
    try {
      const response = await this.auth.request<{ mergeConflict?: unknown[]; syncStatus?: { mergeConflict?: boolean } }>({
        url: `${BASE_URL}/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}:sync`,
        method: 'POST',
      });
      return Boolean(response.data.syncStatus?.mergeConflict) || Boolean(response.data.mergeConflict?.length);
    } catch (error) {
      throw new GtmApiError('sync workspace for', containerId, extractApiStatus(error), { cause: error });
    }
  }

  /** Publishes an already-created container version, making it live. */
  async publishVersion(containerVersionId: string): Promise<void> {
    const { accountId, containerId } = this.ref;
    try {
      await this.auth.request({
        url: `${BASE_URL}/accounts/${accountId}/containers/${containerId}/versions/${containerVersionId}:publish`,
        method: 'POST',
      });
    } catch (error) {
      throw new GtmApiError('publish version', containerVersionId, extractApiStatus(error), { cause: error });
    }
  }

  /** All container versions, in the order the API returns them. */
  async listVersions(): Promise<GtmVersionRef[]> {
    const { accountId, containerId } = this.ref;
    try {
      const response = await this.auth.request<{ containerVersionHeader?: GtmVersionRef[] }>({
        url: `${BASE_URL}/accounts/${accountId}/containers/${containerId}/versions`,
      });
      return response.data.containerVersionHeader ?? [];
    } catch (error) {
      throw new GtmApiError('list versions for', containerId, extractApiStatus(error), { cause: error });
    }
  }

  /** The container's currently published version, or `null` if nothing has ever been published. */
  async liveVersion(): Promise<GtmVersionRef | null> {
    const { accountId, containerId } = this.ref;
    try {
      const response = await this.auth.request<GtmVersionRef>({
        url: `${BASE_URL}/accounts/${accountId}/containers/${containerId}/versions/live`,
      });
      return response.data;
    } catch (error) {
      if (extractApiStatus(error) === 'NOT_FOUND') return null;
      throw new GtmApiError('resolve the live version for', containerId, extractApiStatus(error), { cause: error });
    }
  }
}
