import { buildCustomerDataProvenance } from '../../domain/customer-identity/index.js';
import {
  calculateCommercialDateMetrics,
  divideDecimalMoneyByInteger,
  formatDecimalMoney,
  type GetCustomerCommercialSummaryInput,
  type GetCustomerCommercialSummaryResult,
} from '../../domain/customer-commercial-summary/index.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import type { Clock } from '../customer-profile/ports.js';
import type { CommercialOrdersSummaryReader, CommercialProductsSummaryReader } from './ports.js';

export type GetCustomerCommercialSummaryDependencies = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly commercialOrdersSummaryReader: CommercialOrdersSummaryReader;
  readonly commercialProductsSummaryReader: CommercialProductsSummaryReader;
  readonly clock: Clock;
};

export type GetCustomerCommercialSummary = (
  input: GetCustomerCommercialSummaryInput,
) => Promise<GetCustomerCommercialSummaryResult>;

export function createGetCustomerCommercialSummary(
  deps: GetCustomerCommercialSummaryDependencies,
): GetCustomerCommercialSummary {
  return async function getCustomerCommercialSummary(input) {
    const identityResult = await deps.resolveCustomerIdentity(input.customerId);
    if (identityResult.status !== 'found') {
      return { status: 'customer_not_found', customerId: input.customerId };
    }

    try {
      const customerId = identityResult.identity.customerId;
      const orders = await deps.commercialOrdersSummaryReader.findByCustomerId(customerId);
      const products = await deps.commercialProductsSummaryReader.findByCustomerId(customerId);
      const generatedAt = deps.clock.now().toISOString();

      const dateMetrics = calculateCommercialDateMetrics({
        totalOrders: orders.totalOrders,
        firstOrderAt: orders.firstOrderAt,
        lastOrderAt: orders.lastOrderAt,
        clock: deps.clock,
      });

      return {
        status: 'available',
        customerId,
        summary: {
          totalOrders: orders.totalOrders,
          totalSpentTaxIncl: formatDecimalMoney(orders.totalSpentTaxIncl),
          averageOrderValueTaxIncl: divideDecimalMoneyByInteger(orders.totalSpentTaxIncl, orders.totalOrders),
          ...dateMetrics,
          totalUnitsPurchased: products.totalUnitsPurchased,
          distinctProductsPurchased: products.distinctProductsPurchased,
          cancelledOrderCount: orders.cancelledOrderCount,
          refundedOrderCount: orders.refundedOrderCount,
          currencyIsoCode: 'CLP',
        },
        provenance: buildCustomerDataProvenance(
          identityResult.identity,
          [
            { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
            { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'commercial_summary' },
            { source: 'PRESTASHOP', entity: 'ps_order_detail', purpose: 'commercial_summary' },
          ],
          generatedAt,
        ),
      };
    } catch (error) {
      return degradedOrThrow(input.customerId, error);
    }
  };
}

function degradedOrThrow(customerId: number, error: unknown): GetCustomerCommercialSummaryResult {
  if (error instanceof PrestashopTimeoutError || error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', customerId, reason: 'prestashop_unavailable' };
  }
  if (error instanceof PrestashopSchemaIncompatibleError) {
    return { status: 'degraded', customerId, reason: 'prestashop_schema_incompatible' };
  }
  throw error;
}
