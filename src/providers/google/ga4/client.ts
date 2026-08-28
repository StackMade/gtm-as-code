import type { AuthClient } from 'google-auth-library';
import type { Resource } from '../../../core/resource.js';
import { findManagedId, isProtected, stateKey, type StateFile } from '../../../core/state.js';
import { Ga4ApiError, extractApiStatus } from './errors.js';

const BASE_URL = 'https://analyticsadmin.googleapis.com/v1beta';
// googleSignalsSettings and a data stream's enhancedMeasurementSettings only exist under v1alpha
// (confirmed live 2026-08-29: both 404 on v1beta). dataRetentionSettings and dataStreams are
// v1beta, like everything else this client touches.
const V1ALPHA_BASE_URL = 'https://analyticsadmin.googleapis.com/v1alpha';

export interface DataRetentionSettings {
  name?: string;
  eventDataRetention: string;
  userDataRetention: string;
  resetUserDataOnNewActivity?: boolean;
}

export interface GoogleSignalsSettings {
  name?: string;
  state: string;
  consent?: string;
}

/** A subset of a web data stream's fields, this tool only looks streams up by URL, never creates one. */
export interface DataStream {
  name: string;
  type: string;
  displayName?: string;
  webStreamData?: { measurementId?: string; defaultUri?: string };
}

export interface EnhancedMeasurementSettings {
  name?: string;
  scrollsEnabled?: boolean;
  outboundClicksEnabled?: boolean;
  siteSearchEnabled?: boolean;
  videoEngagementEnabled?: boolean;
  fileDownloadsEnabled?: boolean;
  formInteractionsEnabled?: boolean;
}

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

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

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
      const desiredState = isProtected(state, this.stateKeyFor(kind, resourceId)) ? { ...object, __protected: true } : object;
      resources.push({ id: resourceId, type: KINDS[kind].type, provider: 'google', desiredState });
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

  /**
   * Looks up an existing web data stream by its URL. This tool never creates or deletes streams,
   * only reads them, so config declares `streamWebsiteUrl` to find the stream its settings apply to.
   */
  async findWebStreamByUrl(url: string): Promise<DataStream | undefined> {
    const streams = await this.listDataStreams();
    const target = stripTrailingSlash(url);
    return streams.find((stream) => stripTrailingSlash(stream.webStreamData?.defaultUri ?? '') === target);
  }

  async listDataStreams(): Promise<DataStream[]> {
    const streams: DataStream[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const response = await this.auth.request<Ga4ListResponse>({
          url: `${BASE_URL}/properties/${this.propertyId}/dataStreams`,
          params: { pageSize: GA4_MAX_PAGE_SIZE, ...(pageToken ? { pageToken } : {}) },
        });
        streams.push(...((response.data.dataStreams as DataStream[] | undefined) ?? []));
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (error) {
      throw new Ga4ApiError('list dataStreams', this.propertyId, extractApiStatus(error), { cause: error });
    }
    return streams;
  }

  async getDataRetentionSettings(): Promise<DataRetentionSettings> {
    try {
      const response = await this.auth.request<DataRetentionSettings>({
        url: `${BASE_URL}/properties/${this.propertyId}/dataRetentionSettings`,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('get dataRetentionSettings', this.propertyId, extractApiStatus(error), { cause: error });
    }
  }

  async updateDataRetentionSettings(patch: Partial<DataRetentionSettings>, updateMask: string[]): Promise<DataRetentionSettings> {
    try {
      const response = await this.auth.request<DataRetentionSettings>({
        url: `${BASE_URL}/properties/${this.propertyId}/dataRetentionSettings`,
        method: 'PATCH',
        params: { updateMask: updateMask.join(',') },
        data: patch,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('update dataRetentionSettings', this.propertyId, extractApiStatus(error), { cause: error });
    }
  }

  async getGoogleSignalsSettings(): Promise<GoogleSignalsSettings> {
    try {
      const response = await this.auth.request<GoogleSignalsSettings>({
        url: `${V1ALPHA_BASE_URL}/properties/${this.propertyId}/googleSignalsSettings`,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('get googleSignalsSettings', this.propertyId, extractApiStatus(error), { cause: error });
    }
  }

  async updateGoogleSignalsSettings(patch: Partial<GoogleSignalsSettings>, updateMask: string[]): Promise<GoogleSignalsSettings> {
    try {
      const response = await this.auth.request<GoogleSignalsSettings>({
        url: `${V1ALPHA_BASE_URL}/properties/${this.propertyId}/googleSignalsSettings`,
        method: 'PATCH',
        params: { updateMask: updateMask.join(',') },
        data: patch,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('update googleSignalsSettings', this.propertyId, extractApiStatus(error), { cause: error });
    }
  }

  /** `streamName` is a data stream's full resource path (e.g. `properties/x/dataStreams/y`). */
  async getEnhancedMeasurementSettings(streamName: string): Promise<EnhancedMeasurementSettings> {
    try {
      const response = await this.auth.request<EnhancedMeasurementSettings>({
        url: `${V1ALPHA_BASE_URL}/${streamName}/enhancedMeasurementSettings`,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('get enhancedMeasurementSettings', streamName, extractApiStatus(error), { cause: error });
    }
  }

  async updateEnhancedMeasurementSettings(
    streamName: string,
    patch: Partial<EnhancedMeasurementSettings>,
    updateMask: string[],
  ): Promise<EnhancedMeasurementSettings> {
    try {
      const response = await this.auth.request<EnhancedMeasurementSettings>({
        url: `${V1ALPHA_BASE_URL}/${streamName}/enhancedMeasurementSettings`,
        method: 'PATCH',
        params: { updateMask: updateMask.join(',') },
        data: patch,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('update enhancedMeasurementSettings', streamName, extractApiStatus(error), { cause: error });
    }
  }
}
