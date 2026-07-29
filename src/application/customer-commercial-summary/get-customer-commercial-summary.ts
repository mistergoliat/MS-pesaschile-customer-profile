import {
  calculateCommercialDateMetrics,
  divideDecimalMoneyByInteger,
  formatDecimalMoney,
  type GetCustomerCommercialSummaryInput,
  type GetCustomerCommercialSummaryResult,
} from '../../domain/customer-commercial-summary/index.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../customer-profile/errors.js';
import type { Clock, MasterCustomerReader } from '../customer-profile/ports.js';
import type { CommercialOrdersSummaryReader, CommercialProductsSummaryReader } from './ports.js';

export type GetCustomerCommercialSummaryDependencies = {
  readonly masterCustomerReader: MasterCustomerReader;
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
    const masterCustomer = await deps.masterCustomerReader.findById(input.masterCustomerId);

    if (!masterCustomer) {
      return { status: 'customer_not_found' };
    }
    if (masterCustomer.prestashopCustomerId === null) {
      return { status: 'customer_not_linked' };
    }

    try {
      const prestashopCustomerId = masterCustomer.prestashopCustomerId;
      const orders = await deps.commercialOrdersSummaryReader.findByCustomerId(prestashopCustomerId);
      const products = await deps.commercialProductsSummaryReader.findByCustomerId(prestashopCustomerId);

      const dateMetrics = calculateCommercialDateMetrics({
        totalOrders: orders.totalOrders,
        firstOrderAt: orders.firstOrderAt,
        lastOrderAt: orders.lastOrderAt,
        clock: deps.clock,
      });

      return {
        status: 'available',
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
      };
    } catch (error) {
      return degradedOrThrow(error);
    }
  };
}

function degradedOrThrow(error: unknown): GetCustomerCommercialSummaryResult {
  if (error instanceof PrestashopTimeoutError) {
    return { status: 'degraded', reason: 'prestashop_timeout' };
  }
  if (error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', reason: 'prestashop_unavailable' };
  }
  throw error;
}
