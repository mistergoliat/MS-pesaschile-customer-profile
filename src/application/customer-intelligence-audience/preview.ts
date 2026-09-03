import type { AudienceEvaluationContextV1 } from '../../domain/customer-intelligence-audience/index.js';
import { CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_AFFINITIES_PER_AXIS, CUSTOMER_INTELLIGENCE_AUDIENCE_PREVIEW_VERSION } from './schema.js';
import type { AudiencePreviewReadRow, AudiencePreviewReader } from './ports.js';

export type AudiencePreviewAffinityV1 = NonNullable<AudiencePreviewReadRow['affinity']>;

export type AudiencePreviewRowV1 = {
  readonly customerId: number;
  readonly commercial: {
    readonly validOrders: number;
    readonly totalSpentTaxIncl: string;
    readonly averageOrderValueTaxIncl: string;
    readonly firstOrderAt: string;
    readonly lastOrderAt: string;
    readonly daysSinceLastOrder: number;
    readonly purchaseFrequencyDays: string | null;
  };
  readonly rfm: AudiencePreviewReadRow['rfm'];
  readonly cluster: AudiencePreviewReadRow['cluster'];
  readonly clv: AudiencePreviewReadRow['clv'];
  readonly affinities: readonly AudiencePreviewAffinityV1[];
  readonly availability: {
    readonly feature: 'AVAILABLE' | 'UNAVAILABLE';
    readonly rfm: 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';
    readonly cluster: 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';
    readonly clv: 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';
    readonly commercialAffinity: 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';
  };
};

export type AudiencePreviewV1 = {
  readonly previewVersion: typeof CUSTOMER_INTELLIGENCE_AUDIENCE_PREVIEW_VERSION;
  readonly limit: number;
  readonly returned: number;
  readonly rows: readonly AudiencePreviewRowV1[];
  readonly truncated: boolean;
  readonly enrichmentStatus: 'available' | 'degraded';
  readonly degradedComponents: readonly string[];
  readonly lineage: AudienceEvaluationContextV1['lineage'];
};

export type AudiencePreviewEnricher = (input: {
  readonly context: AudienceEvaluationContextV1;
  readonly customerIds: readonly number[];
  readonly limit: number;
}) => Promise<AudiencePreviewV1>;

export function createAudiencePreviewEnricher(deps: { readonly reader: AudiencePreviewReader }): AudiencePreviewEnricher {
  return async ({ context, customerIds, limit }) => {
    if (customerIds.length === 0) return emptyPreview(context, limit);
    try {
      const rawRows = await deps.reader.read(context, customerIds);
      const rowsByCustomerId = new Map<number, AudiencePreviewRowV1>();
      for (const raw of rawRows) {
        const current = rowsByCustomerId.get(raw.customerId);
        if (!current) {
          rowsByCustomerId.set(raw.customerId, toPreviewRow(raw, context));
        } else if (raw.affinity) {
          const affinities = [...current.affinities, raw.affinity]
            .sort((left, right) => Number(right.score) - Number(left.score) || left.axis.localeCompare(right.axis) || left.code.localeCompare(right.code))
            .filter((affinity, index, all) => all.slice(0, index).filter((candidate) => candidate.axis === affinity.axis).length < CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_AFFINITIES_PER_AXIS);
          rowsByCustomerId.set(raw.customerId, { ...current, affinities });
        }
      }
      const rows = customerIds.filter((id) => rowsByCustomerId.has(id)).map((id) => rowsByCustomerId.get(id)!);
      return { previewVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_PREVIEW_VERSION, limit, returned: rows.length, rows, truncated: rows.length < customerIds.length, enrichmentStatus: 'available', degradedComponents: [], lineage: context.lineage };
    } catch {
      return { previewVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_PREVIEW_VERSION, limit, returned: 0, rows: [], truncated: customerIds.length > 0, enrichmentStatus: 'degraded', degradedComponents: ['feature', 'rfm', 'cluster', 'clv', 'commercialAffinity'], lineage: context.lineage };
    }
  };
}

function emptyPreview(context: AudienceEvaluationContextV1, limit: number): AudiencePreviewV1 {
  return { previewVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_PREVIEW_VERSION, limit, returned: 0, rows: [], truncated: false, enrichmentStatus: 'available', degradedComponents: [], lineage: context.lineage };
}

function toPreviewRow(row: AudiencePreviewReadRow, context: AudienceEvaluationContextV1): AudiencePreviewRowV1 {
  return {
    customerId: row.customerId,
    commercial: { validOrders: row.validOrders, totalSpentTaxIncl: row.totalSpentTaxIncl, averageOrderValueTaxIncl: row.averageOrderValueTaxIncl, firstOrderAt: row.firstOrderAt, lastOrderAt: row.lastOrderAt, daysSinceLastOrder: row.daysSinceLastOrder, purchaseFrequencyDays: row.purchaseFrequencyDays },
    rfm: row.rfm,
    cluster: row.cluster,
    clv: row.clv,
    affinities: row.affinity ? [row.affinity] : [],
    availability: {
      feature: 'AVAILABLE',
      rfm: contextAvailability(context, 'rfm', row.rfm !== null),
      cluster: contextAvailability(context, 'cluster', row.cluster !== null),
      clv: contextAvailability(context, 'clv', row.clv !== null),
      commercialAffinity: contextAvailability(context, 'commercialAffinity', row.affinityPopulationMember),
    },
  };
}

function contextAvailability(context: AudienceEvaluationContextV1, component: 'rfm' | 'cluster' | 'clv' | 'commercialAffinity', present: boolean): 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE' {
  if (context.lineage[component] === null) return 'UNAVAILABLE';
  return present ? 'AVAILABLE' : 'NOT_IN_POPULATION';
}
