import type { AuthClient } from 'google-auth-library';
import type { Resource } from '../../../core/resource.js';
import { findManagedId, stateKey, type StateFile } from '../../../core/state.js';
import { Ga4ApiError, extractApiStatus } from './errors.js';

const BASE_URL = 'https://analyticsadmin.googleapis.com/v1beta';

const KINDS = {
  dimension: { collection: 'customDimensions', field: 'customDimensions', type: 'ga4.dimension', archivable: true },
  metric: { collection: 'customMetrics', field: 'customMetrics', type: 'ga4.metric', archivable: true },
  keyEvent: { collection: 'keyEvents', field: 'keyEvents', type: 'ga4.keyEvent', archivable: false },
} as const;

export type Ga4Kind = keyof typeof KINDS;

/** A GA4 Admin API object, as GA4 itself represents it (its `name` is the full resource path). */
export type Ga4Object = Record<string, unknown> & { name?: string };

type Ga4ListResponse = Record<string, unknown> & { nextPageToken?: string };

/** The Admin API caps `pageSize` at 200 and coerces anything higher down to it. */
const GA4_MAX_PAGE_SIZE = 200;

/** By this tool's convention parameterName / eventName is the config key itself. */
function resourceId(kind: Ga4Kind, object: Ga4Object): string {
  const key = kind === 'keyEvent' ? 'eventName' : 'parameterName';
  return String(object[key] ?? object.name ?? '');
}

export class Ga4Client {
  constructor(
    private readonly auth: AuthClient,
    private readonly propertyId: string,
  ) {}

  private collectionUrl(kind: Ga4Kind): string {
    return `${BASE_URL}/properties/${this.propertyId}/${KINDS[kind].collection}`;
  }

  /**
   * Follows `nextPageToken` to the end: the API returns at most 50 objects per
   * page unless asked otherwise, and a partial listing would look to `diff`
   * like resources that do not exist remotely, so `apply` would duplicate them.
   */
  async list(kind: Ga4Kind): Promise<Ga4Object[]> {
    const objects: Ga4Object[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const response = await this.auth.request<Ga4ListResponse>({
          url: this.collectionUrl(kind),
          params: { pageSize: GA4_MAX_PAGE_SIZE, ...(pageToken ? { pageToken } : {}) },
        });
        objects.push(...((response.data[KINDS[kind].field] as Ga4Object[] | undefined) ?? []));
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (error) {
      throw new Ga4ApiError(`list ${kind}s`, this.propertyId, extractApiStatus(error), { cause: error });
    }
    return objects;
  }

  /** Remote state as the generic Resource model, keyed by parameterName/eventName. */
  async listResources(kind: Ga4Kind): Promise<Resource[]> {
    const objects = await this.list(kind);
    return objects.map((object) => ({
      id: resourceId(kind, object),
      type: KINDS[kind].type,
      provider: 'google',
      desiredState: object,
    }));
  }

  /** Owned resources only — GA4 has no ownership field, so `.analytics/state.json` decides. */
  async listManaged(kind: Ga4Kind, state: StateFile): Promise<Resource[]> {
    const objects = await this.list(kind);
    const resources: Resource[] = [];
    for (const object of objects) {
      if (!object.name) continue;
      const resourceId = findManagedId(state, 'google', KINDS[kind].type, this.propertyId, String(object.name));
      if (resourceId === null) continue;
      resources.push({ id: resourceId, type: KINDS[kind].type, provider: 'google', desiredState: object });
    }
    return resources;
  }

  /** State-file key for a resource of this kind, scoped to this property. */
  stateKeyFor(kind: Ga4Kind, resourceId: string): string {
    return stateKey('google', KINDS[kind].type, this.propertyId, resourceId);
  }

  async create(kind: Ga4Kind, payload: Ga4Object): Promise<Ga4Object> {
    const id = resourceId(kind, payload);
    try {
      const response = await this.auth.request<Ga4Object>({ url: this.collectionUrl(kind), method: 'POST', data: payload });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError(`create ${kind}`, id, extractApiStatus(error), { cause: error });
    }
  }

  /** `name` is the full resource path returned by `list`/`create` (e.g. `properties/x/customDimensions/y`). */
  async update(kind: Ga4Kind, name: string, patch: Ga4Object, updateMask: string[]): Promise<Ga4Object> {
    try {
      const response = await this.auth.request<Ga4Object>({
        url: `${BASE_URL}/${name}`,
        method: 'PATCH',
        params: { updateMask: updateMask.join(',') },
        data: patch,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError(`update ${kind}`, name, extractApiStatus(error), { cause: error });
    }
  }

  /** Key events support a real DELETE; dimensions/metrics only support :archive (GA4 has no hard delete for them). */
  async delete(kind: Ga4Kind, name: string): Promise<void> {
    try {
      if (KINDS[kind].archivable) {
        await this.auth.request({ url: `${BASE_URL}/${name}:archive`, method: 'POST' });
      } else {
        await this.auth.request({ url: `${BASE_URL}/${name}`, method: 'DELETE' });
      }
    } catch (error) {
      throw new Ga4ApiError(`delete ${kind}`, name, extractApiStatus(error), { cause: error });
    }
  }
}
