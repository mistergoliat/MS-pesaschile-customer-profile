import { buildCustomerDataProvenance } from '../../domain/customer-identity/index.js';
import type {
  GetPurchasedProductsInput,
  GetPurchasedProductsResult,
  PurchasedProduct,
} from '../../domain/customer-purchased-products/index.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import type { Clock } from '../customer-profile/ports.js';
import type { PurchasedProductsReader } from './ports.js';

export type GetCustomerPurchasedProductsDependencies = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly purchasedProductsReader: PurchasedProductsReader;
  readonly clock: Clock;
};

export type GetCustomerPurchasedProducts = (input: GetPurchasedProductsInput) => Promise<GetPurchasedProductsResult>;

export function createGetCustomerPurchasedProducts(
  deps: GetCustomerPurchasedProductsDependencies,
): GetCustomerPurchasedProducts {
  return async function getCustomerPurchasedProducts(input) {
    const identityResult = await deps.resolveCustomerIdentity(input.customerId);
    if (identityResult.status !== 'found') {
      return { status: 'customer_not_found', customerId: input.customerId };
    }

    try {
      const customerId = identityResult.identity.customerId;
      const page = await deps.purchasedProductsReader.findByCustomerId({
        prestashopCustomerId: customerId,
        limit: input.limit,
        offset: input.offset,
      });

      const products = page.products.map(
        (product): PurchasedProduct => ({
          productId: product.productId,
          productAttributeId: product.productAttributeId,
          productName: product.productName,
          productReference: product.productReference,
          totalQuantityPurchased: product.totalQuantityPurchased,
          orderCount: product.orderCount,
          firstPurchasedAt: product.firstPurchasedAt.toISOString(),
          lastPurchasedAt: product.lastPurchasedAt.toISOString(),
          totalSpentTaxIncl: product.totalSpentTaxIncl,
          catalogStatus: product.catalogStatus,
        }),
      );

      return {
        status: 'available',
        customerId,
        products,
        pagination: {
          limit: input.limit,
          offset: input.offset,
          returned: products.length,
          hasMore: page.hasMore,
        },
        provenance: buildCustomerDataProvenance(
          identityResult.identity,
          [
            { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
            { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'purchased_products' },
            { source: 'PRESTASHOP', entity: 'ps_order_detail', purpose: 'purchased_products' },
          ],
          deps.clock.now().toISOString(),
        ),
      };
    } catch (error) {
      return degradedOrThrow(input.customerId, error);
    }
  };
}

function degradedOrThrow(customerId: number, error: unknown): GetPurchasedProductsResult {
  if (error instanceof PrestashopTimeoutError || error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', customerId, reason: 'prestashop_unavailable' };
  }
  if (error instanceof PrestashopSchemaIncompatibleError) {
    return { status: 'degraded', customerId, reason: 'prestashop_schema_incompatible' };
  }
  throw error;
}
