import type { AuthClient } from 'google-auth-library';
import { Ga4ApiError, extractApiStatus } from './errors.js';

const BASE_URL = 'https://analyticsdata.googleapis.com/v1beta';

export interface PropertyQuotaBucket {
  consumed: number;
  remaining: number;
}

/** A subset of `runReport`'s `propertyQuota` — the buckets that actually run out in practice. */
export interface PropertyQuota {
  tokensPerDay?: PropertyQuotaBucket;
  tokensPerHour?: PropertyQuotaBucket;
  concurrentRequests?: PropertyQuotaBucket;
}

interface RunReportResponse {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  /** Total rows matching the query, independent of how many `rows` actually carries — GA4's signal that a response was truncated. */
  rowCount?: number;
  propertyQuota?: PropertyQuota;
}

/** The largest row count `runReport` accepts per request; well above any realistic distinct-`eventName` count. */
const MAX_REPORT_ROWS = 100000;

const NOT_SET = '(not set)';

/**
 * Wraps the GA4 **Data** API (`analyticsdata.googleapis.com`) — a different host and request
 * shape than `Ga4Client`'s Admin API, but the same `analytics.readonly` scope covers both.
 * Read-only by construction: `runReport` is the only endpoint this tool needs, for `verify`
 * (did a declared event actually fire) and `doctor` (is the property's API quota healthy).
 */
export class Ga4DataClient {
  constructor(
    private readonly auth: AuthClient,
    private readonly propertyId: string,
  ) {}

  private async runReport(body: Record<string, unknown>): Promise<RunReportResponse> {
    try {
      const response = await this.auth.request<RunReportResponse>({
        url: `${BASE_URL}/properties/${this.propertyId}:runReport`,
        method: 'POST',
        data: body,
      });
      return response.data;
    } catch (error) {
      throw new Ga4ApiError('run report for', this.propertyId, extractApiStatus(error), { cause: error });
    }
  }

  /**
   * Event name -> event count over the trailing `days`. An event with no rows at all is absent
   * from the map. Requests the API's max row count and checks `rowCount` against what actually
   * came back: a silently truncated response would make `verify` report a real, firing event as
   * "never received" — worse than not checking at all — so a truncated response throws instead of
   * returning a partial map.
   */
  async eventCounts(days: number): Promise<Map<string, number>> {
    const response = await this.runReport({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      limit: MAX_REPORT_ROWS,
    });
    const rows = response.rows ?? [];
    if (response.rowCount !== undefined && response.rowCount > rows.length) {
      throw new Error(
        `GA4 reported ${response.rowCount} distinct event names but returned only ${rows.length} rows for property ` +
          `"${this.propertyId}" — the response was truncated. verify has no pagination for this case; investigate why ` +
          'the property has this many distinct event names before trusting its output.',
      );
    }
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = row.dimensionValues?.[0]?.value;
      if (name) counts.set(name, Number(row.metricValues?.[0]?.value ?? '0'));
    }
    return counts;
  }

  /**
   * Whether `eventName` was ever recorded with a non-empty value for the custom-dimension-backed
   * event parameter `dimensionParameter`, over the trailing `days`. Only parameters registered as
   * a GA4 custom dimension (`dimension: true` in config) are queryable this way — the Data API has
   * no way to inspect an arbitrary, unregistered event parameter. Throws (via `Ga4ApiError`,
   * `INVALID_ARGUMENT`) if the dimension isn't registered on the property yet.
   *
   * ponytail: `verify` calls this once per checked parameter (one `runReport` each), so a config
   * with many `dimension: true` parameters means many requests. Batch multiple `customEvent:`
   * dimensions into one report per event if `doctor`'s quota check starts flagging this.
   */
  async hasParameterValue(eventName: string, dimensionParameter: string, days: number): Promise<boolean> {
    const response = await this.runReport({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: `customEvent:${dimensionParameter}` }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: eventName } } },
    });
    return (response.rows ?? []).some((row) => {
      const value = row.dimensionValues?.[0]?.value;
      return value !== undefined && value !== NOT_SET;
    });
  }

  /** Property-level API token quota, read off a minimal report via `returnPropertyQuota`. */
  async quota(): Promise<PropertyQuota | undefined> {
    const response = await this.runReport({
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      metrics: [{ name: 'eventCount' }],
      limit: 1,
      returnPropertyQuota: true,
    });
    return response.propertyQuota;
  }
}
