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

export interface AttributionSettings {
  name?: string;
  reportingAttributionModel: string;
  acquisitionConversionEventLookbackWindow: string;
  otherConversionEventLookbackWindow: string;
  adsWebConversionDataExportScope?: string;
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
  dimension: { collection: 'customDimensions', field: 'customDimensions', type: 'ga4.dimension', archivable: true, v1alpha: false, scope: 'property' },
  metric: { collection: 'customMetrics', field: 'customMetrics', type: 'ga4.metric', archivable: true, v1alpha: false, scope: 'property' },
  keyEvent: { collection: 'keyEvents', field: 'keyEvents', type: 'ga4.keyEvent', archivable: false, v1alpha: false, scope: 'property' },
  /** Audiences live under `v1alpha`, unlike the other three kinds (confirmed live 2026-08-29). */
  audience: { collection: 'audiences', field: 'audiences', type: 'ga4.audience', archivable: true, v1alpha: true, scope: 'property' },
  /**
   * Nested under a data stream, not the property (confirmed live 2026-08-29: 404s on `v1beta`,
   * `properties.dataStreams.eventCreateRules` in the reference docs). Real DELETE, no archive.
   */
  eventCreateRule: { collection: 'eventCreateRules', field: 'eventCreateRules', type: 'ga4.eventCreateRule', archivable: false, v1alpha: true, scope: 'stream' },
  eventEditRule: { collection: 'eventEditRules', field: 'eventEditRules', type: 'ga4.eventEditRule', archivable: false, v1alpha: true, scope: 'stream' },
  /**
   * `calculatedMetricId` is immutable once created and, unlike every other kind's identity field,
   * is not just a body field: GA4 requires it as a create-time query param (confirmed live
   * 2026-08-29). `createIdParam` tells `create()` to also send it that way.
   */
  calculatedMetric: {
    collection: 'calculatedMetrics',
    field: 'calculatedMetrics',
    type: 'ga4.calculatedMetric',
    archivable: false,
    v1alpha: true,
    scope: 'property',
    createIdParam: 'calculatedMetricId',
  },
  channelGroup: { collection: 'channelGroups', field: 'channelGroups', type: 'ga4.channelGroup', archivable: false, v1alpha: true, scope: 'property' },
  /**
   * Nested under a data stream, like event create/edit rules, but lives on `v1beta` (confirmed live
   * 2026-08-30: `GET .../measurementProtocolSecrets` returns 200 on both versions; `v1beta` is used
   * for parity with `dataStreams` itself). Real DELETE, no archive. `secretValue` is server-generated
   * and output-only — this tool never sends it and never diffs it.
   */
  measurementProtocolSecret: {
    collection: 'measurementProtocolSecrets',
    field: 'measurementProtocolSecrets',
    type: 'ga4.measurementProtocolSecret',
    archivable: false,
    v1alpha: false,
    scope: 'stream',
  },
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

/**
 * By this tool's convention parameterName / eventName / displayName is the config key itself.
 * `eventCreateRule` has no label field of its own; `destinationEvent` is the practical identity
 * field, with the same non-uniqueness caveat `keyEvent`'s `eventName` already carries.
 */
const RESOURCE_ID_FIELD: Record<Ga4Kind, string> = {
  dimension: 'parameterName',
  metric: 'parameterName',
  keyEvent: 'eventName',
  audience: 'displayName',
  eventCreateRule: 'destinationEvent',
  eventEditRule: 'displayName',
  calculatedMetric: 'calculatedMetricId',
  channelGroup: 'displayName',
  measurementProtocolSecret: 'displayName',
};

function resourceId(kind: Ga4Kind, object: Ga4Object): string {
  return String(object[RESOURCE_ID_FIELD[kind]] ?? object.name ?? '');
}

export class Ga4Client {
  constructor(
    private readonly auth: AuthClient,
    private readonly propertyId: string,
  ) {}

  /** `streamName` (a data stream's full resource path) is required when `kind` is stream-scoped. */
  private collectionUrl(kind: Ga4Kind, streamName?: string): string {
    const base = KINDS[kind].v1alpha ? V1ALPHA_BASE_URL : BASE_URL;
    if (KINDS[kind].scope === 'stream') {
      if (!streamName) throw new Error(`ga4.${kind} is stream-scoped but no stream was resolved.`);
      return `${base}/${streamName}/${KINDS[kind].collection}`;
    }
    return `${base}/properties/${this.propertyId}/${KINDS[kind].collection}`;
  }

  private objectUrl(kind: Ga4Kind, name: string): string {
    const base = KINDS[kind].v1alpha ? V1ALPHA_BASE_URL : BASE_URL;
    return `${base}/${name}`;
  }

  /**
   * Follows `nextPageToken` to the end: the API returns at most 50 objects per
   * page unless asked otherwise, and a partial listing would look to `diff`
   * like resources that do not exist remotely, so `apply` would duplicate them.
   */
  async list(kind: Ga4Kind, streamName?: string): Promise<Ga4Object[]> {
    const objects: Ga4Object[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const response = await this.auth.request<Ga4ListResponse>({
          url: this.collectionUrl(kind, streamName),
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

  /** Remote state as the generic Resource model, keyed by parameterName/eventName/displayName/destinationEvent. */
  async listResources(kind: Ga4Kind, streamName?: string): Promise<Resource[]> {
    const objects = await this.list(kind, streamName);
    return objects.map((object) => ({
      id: resourceId(kind, object),
      type: KINDS[kind].type,
      provider: 'google',
      desiredState: object,
    }));
  }

  /** Owned resources only — GA4 has no ownership field, so `.analytics/state.json` decides. */
  async listManaged(kind: Ga4Kind, state: StateFile, streamName?: string): Promise<Resource[]> {
    const objects = await this.list(kind, streamName);
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

  /**
   * `resourceIdOverride` is required when the kind's `createIdParam` is set: that id is GA4's
   * immutable, create-time-only identifier, output-only in the body (`calculatedMetricId`), so it
   * cannot be read back out of `payload` the way every other kind's identity field can.
   */
  async create(kind: Ga4Kind, payload: Ga4Object, streamName?: string, resourceIdOverride?: string): Promise<Ga4Object> {
    const createIdParam = (KINDS[kind] as { createIdParam?: string }).createIdParam;
    const id = resourceIdOverride ?? resourceId(kind, payload);
    if (createIdParam && !resourceIdOverride) {
      throw new Error(`ga4.${kind} requires an explicit id for its ${createIdParam} query param.`);
    }
    try {
      const response = await this.auth.request<Ga4Object>({
        url: this.collectionUrl(kind, streamName),
        method: 'POST',
        ...(createIdParam ? { params: { [createIdParam]: id } } : {}),
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError(`create ${kind}`, id, extractApiStatus(error), { cause: error });
    }
  }

  /** `name` is the full resource path returned by `list`/`create` (e.g. `properties/x/customDimensions/y`). */
  async update(kind: Ga4Kind, name: string, patch: Ga4Object, updateMask: string[]): Promise<Ga4Object> {
    try {
      const response = await this.auth.request<Ga4Object>({
        url: this.objectUrl(kind, name),
        method: 'PATCH',
        params: { updateMask: updateMask.join(',') },
        data: patch,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError(`update ${kind}`, name, extractApiStatus(error), { cause: error });
    }
  }

  /** Key events and event create/edit rules support a real DELETE; dimensions/metrics/audiences only support :archive (GA4 has no hard delete for them). */
  async delete(kind: Ga4Kind, name: string): Promise<void> {
    try {
      if (KINDS[kind].archivable) {
        await this.auth.request({ url: `${this.objectUrl(kind, name)}:archive`, method: 'POST' });
      } else {
        await this.auth.request({ url: this.objectUrl(kind, name), method: 'DELETE' });
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

  /** Property-scoped, like `googleSignalsSettings` (confirmed live 2026-08-31: 404 on `v1beta`). */
  async getAttributionSettings(): Promise<AttributionSettings> {
    try {
      const response = await this.auth.request<AttributionSettings>({
        url: `${V1ALPHA_BASE_URL}/properties/${this.propertyId}/attributionSettings`,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('get attributionSettings', this.propertyId, extractApiStatus(error), { cause: error });
    }
  }

  async updateAttributionSettings(patch: Partial<AttributionSettings>, updateMask: string[]): Promise<AttributionSettings> {
    try {
      const response = await this.auth.request<AttributionSettings>({
        url: `${V1ALPHA_BASE_URL}/properties/${this.propertyId}/attributionSettings`,
        method: 'PATCH',
        params: { updateMask: updateMask.join(',') },
        data: patch,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('update attributionSettings', this.propertyId, extractApiStatus(error), { cause: error });
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
