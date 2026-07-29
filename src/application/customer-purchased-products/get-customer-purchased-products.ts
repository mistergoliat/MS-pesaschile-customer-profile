import type {
  GetPurchasedProductsInput,
  GetPurchasedProductsResult,
  PurchasedProduct,
} from '../../domain/customer-purchased-products/index.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../customer-profile/errors.js';
import type { MasterCustomerReader } from '../customer-profile/ports.js';
import type { PurchasedProductsReader } from './ports.js';

export type GetCustomerPurchasedProductsDependencies = {
  readonly masterCustomerReader: MasterCustomerReader;
  readonly purchasedProductsReader: PurchasedProductsReader;
};

export type GetCustomerPurchasedProducts = (input: GetPurchasedProductsInput) => Promise<GetPurchasedProductsResult>;

export function createGetCustomerPurchasedProducts(
  deps: GetCustomerPurchasedProductsDependencies,
): GetCustomerPurchasedProducts {
  return async function getCustomerPurchasedProducts(input) {
    const masterCustomer = await deps.masterCustomerReader.findById(input.masterCustomerId);

    if (!masterCustomer) {
      return { status: 'customer_not_found' };
    }
    if (masterCustomer.prestashopCustomerId === null) {
      return { status: 'customer_not_linked' };
    }

    try {
      const page = await deps.purchasedProductsReader.findByCustomerId({
        prestashopCustomerId: masterCustomer.prestashopCustomerId,
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
        products,
        pagination: {
          limit: input.limit,
          offset: input.offset,
          returned: products.length,
          hasMore: page.hasMore,
        },
      };
    } catch (error) {
      return degradedOrThrow(error);
    }
  };
}

function degradedOrThrow(error: unknown): GetPurchasedProductsResult {
  if (error instanceof PrestashopTimeoutError) {
    return { status: 'degraded', reason: 'prestashop_timeout' };
  }
  if (error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', reason: 'prestashop_unavailable' };
  }
  throw error;
}
