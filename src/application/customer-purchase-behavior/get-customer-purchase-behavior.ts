import { buildCustomerDataProvenance, type CustomerIdentity } from '../../domain/customer-identity/index.js';
import type { Clock } from '../customer-profile/ports.js';
import type {
  GetCustomerPurchaseBehaviorInput,
  GetCustomerPurchaseBehaviorResult,
  PurchaseBehaviorConcentration,
  PurchaseBehaviorProduct,
  PurchaseBehaviorVariant,
} from '../../domain/customer-purchase-behavior/index.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import {
  addBehaviorDecimals,
  compareDecimalDesc,
  divideDecimalToBehaviorDecimal,
  divideIntegerToBehaviorDecimal,
  effectiveDiversityFromHhi,
  formatBehaviorDecimal,
  squareBehaviorShare,
  sumBehaviorShares,
} from './behavior-decimal.js';
import type { CustomerProductBehaviorReader, ProductBehaviorVariantRecord } from './ports.js';

const EMPTY_CONCENTRATION: PurchaseBehaviorConcentration = {
  top1Share: '0.000000',
  top3Share: '0.000000',
  hhi: '0.000000',
  effectiveDiversity: '0.000000',
};

export type GetCustomerPurchaseBehaviorDependencies = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly customerProductBehaviorReader: CustomerProductBehaviorReader;
  readonly clock: Clock;
};

export type GetCustomerPurchaseBehavior = (
  input: GetCustomerPurchaseBehaviorInput,
) => Promise<GetCustomerPurchaseBehaviorResult>;

type ProductAggregate = {
  readonly productId: number;
  readonly latestObservedProductName: string;
  readonly latestObservedProductReference: string | null;
  readonly variantCountPurchased: number;
  readonly repeatedVariantCount: number;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly totalSpentTaxIncl: string;
  readonly firstPurchasedAt: Date;
  readonly lastPurchasedAt: Date;
  readonly isRepeated: boolean;
};

export function createGetCustomerPurchaseBehavior(
  deps: GetCustomerPurchaseBehaviorDependencies,
): GetCustomerPurchaseBehavior {
  return async function getCustomerPurchaseBehavior(input) {
    const identityResult = await deps.resolveCustomerIdentity(input.customerId);
    if (identityResult.status !== 'found') {
      return { status: 'customer_not_found', customerId: input.customerId };
    }

    try {
      const calculatedAt = deps.clock.now();
      const customerId = identityResult.identity.customerId;
      const record = await deps.customerProductBehaviorReader.findByCustomerId({
        prestashopCustomerId: customerId,
      });
      return buildAvailableResult(input, record.variants, {
        customerId,
        validOrderCount: record.validOrderCount,
        totalUnits: record.totalProductUnitsPurchased,
        totalSpent: formatBehaviorDecimal(record.totalProductSpentTaxIncl),
        calculatedAt,
        identity: identityResult.identity,
      });
    } catch (error) {
      return degradedOrThrow(input.customerId, error);
    }
  };
}

function buildAvailableResult(
  input: GetCustomerPurchaseBehaviorInput,
  variants: readonly ProductBehaviorVariantRecord[],
  totals: {
    readonly customerId: number;
    readonly validOrderCount: number;
    readonly totalUnits: number;
    readonly totalSpent: string;
    readonly calculatedAt: Date;
    readonly identity: CustomerIdentity;
  },
): GetCustomerPurchaseBehaviorResult {
  validateTotals(totals, variants);
  const products = rollupProducts(variants);
  const repeatedVariants = variants.filter((variant) => variant.orderCount >= 2);
  const repeatedVariantSpend = addBehaviorDecimals(repeatedVariants.map((variant) => variant.totalSpentTaxIncl));
  const sortedProducts = sortProducts(products);
  const sortedVariants = sortVariants(variants);
  const generatedAt = totals.calculatedAt.toISOString();

  return {
    status: 'available',
    customerId: totals.customerId,
    currencyIsoCode: 'CLP',
    calculatedAt: generatedAt,
    summary: {
      validOrderCount: totals.validOrderCount,
      distinctProductCount: products.length,
      distinctVariantCount: variants.length,
      repeatedProductCount: products.filter((product) => product.isRepeated).length,
      repeatedVariantCount: repeatedVariants.length,
      repeatProductRate: divideIntegerToBehaviorDecimal(
        products.filter((product) => product.isRepeated).length,
        products.length,
      ),
      repeatVariantRate: divideIntegerToBehaviorDecimal(repeatedVariants.length, variants.length),
      repeatedVariantSpendShare: divideDecimalToBehaviorDecimal(repeatedVariantSpend, totals.totalSpent),
      productSpendConcentration: concentration(sortedProducts.map((product) => product.totalSpentTaxIncl), totals.totalSpent),
      variantSpendConcentration: concentration(sortedVariants.map((variant) => variant.totalSpentTaxIncl), totals.totalSpent),
    },
    topProducts: sortedProducts.slice(0, input.topProducts).map((product) => toPublicProduct(product, totals)),
    topVariants: sortedVariants.slice(0, input.topVariants).map((variant) => toPublicVariant(variant, totals)),
    provenance: buildCustomerDataProvenance(
      totals.identity,
      [
        { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
        { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'purchase_behavior' },
        { source: 'PRESTASHOP', entity: 'ps_order_detail', purpose: 'purchase_behavior' },
        { source: 'PRESTASHOP', entity: 'derived_purchase_behavior', purpose: 'purchase_behavior' },
      ],
      generatedAt,
    ),
  };
}

function validateTotals(
  totals: { readonly validOrderCount: number; readonly totalUnits: number; readonly totalSpent: string; readonly calculatedAt: Date },
  variants: readonly ProductBehaviorVariantRecord[],
): void {
  if (!Number.isSafeInteger(totals.validOrderCount) || totals.validOrderCount < 0) {
    throw new Error(`Invalid validOrderCount: ${String(totals.validOrderCount)}`);
  }
  if (!Number.isSafeInteger(totals.totalUnits) || totals.totalUnits < 0) {
    throw new Error(`Invalid totalProductUnitsPurchased: ${String(totals.totalUnits)}`);
  }
  if (Number.isNaN(totals.calculatedAt.getTime())) {
    throw new Error('Invalid calculatedAt');
  }
  formatBehaviorDecimal(totals.totalSpent);

  const sumUnits = variants.reduce((total, variant) => total + variant.totalQuantityPurchased, 0);
  const sumSpent = addBehaviorDecimals(variants.map((variant) => variant.totalSpentTaxIncl));
  if (sumUnits !== totals.totalUnits) {
    throw new Error('Variant quantities are incompatible with global total');
  }
  if (formatBehaviorDecimal(sumSpent) !== formatBehaviorDecimal(totals.totalSpent)) {
    throw new Error('Variant spend is incompatible with global total');
  }
  if (variants.length === 0 && (totals.validOrderCount !== 0 || totals.totalUnits !== 0 || totals.totalSpent !== '0.000000')) {
    throw new Error('Empty purchase behavior requires zero totals');
  }
}

function rollupProducts(variants: readonly ProductBehaviorVariantRecord[]): ProductAggregate[] {
  const byProduct = new Map<number, ProductBehaviorVariantRecord[]>();
  for (const variant of variants) {
    const group = byProduct.get(variant.productId) ?? [];
    group.push(variant);
    byProduct.set(variant.productId, group);
  }

  return Array.from(byProduct.entries()).map(([productId, productVariants]) => {
    const latest = [...productVariants].sort(compareLatestVariant)[0]!;

    return {
      productId,
      latestObservedProductName: latest.latestObservedProductName,
      latestObservedProductReference: latest.latestObservedProductReference,
      variantCountPurchased: productVariants.length,
      repeatedVariantCount: productVariants.filter((variant) => variant.orderCount >= 2).length,
      orderCount: latest.productOrderCount,
      totalQuantityPurchased: productVariants.reduce((total, variant) => total + variant.totalQuantityPurchased, 0),
      totalSpentTaxIncl: addBehaviorDecimals(productVariants.map((variant) => variant.totalSpentTaxIncl)),
      firstPurchasedAt: latest.productFirstPurchasedAt,
      lastPurchasedAt: latest.productLastPurchasedAt,
      isRepeated: latest.productOrderCount >= 2,
    };
  });
}

function toPublicVariant(
  variant: ProductBehaviorVariantRecord,
  totals: { readonly validOrderCount: number; readonly totalUnits: number; readonly totalSpent: string; readonly calculatedAt: Date },
): PurchaseBehaviorVariant {
  return {
    productId: variant.productId,
    productAttributeId: variant.productAttributeId,
    productName: variant.productName,
    productReference: variant.productReference,
    orderCount: variant.orderCount,
    totalQuantityPurchased: variant.totalQuantityPurchased,
    totalSpentTaxIncl: formatBehaviorDecimal(variant.totalSpentTaxIncl),
    spendShare: divideDecimalToBehaviorDecimal(variant.totalSpentTaxIncl, totals.totalSpent),
    orderShare: divideIntegerToBehaviorDecimal(variant.orderCount, totals.validOrderCount),
    quantityShare: divideIntegerToBehaviorDecimal(variant.totalQuantityPurchased, totals.totalUnits),
    firstPurchasedAt: variant.firstPurchasedAt.toISOString(),
    lastPurchasedAt: variant.lastPurchasedAt.toISOString(),
    daysSinceLastPurchase: daysSince(totals.calculatedAt, variant.lastPurchasedAt),
    isRepeated: variant.orderCount >= 2,
  };
}

function toPublicProduct(
  product: ProductAggregate,
  totals: { readonly validOrderCount: number; readonly totalUnits: number; readonly totalSpent: string; readonly calculatedAt: Date },
): PurchaseBehaviorProduct {
  return {
    productId: product.productId,
    latestObservedProductName: product.latestObservedProductName,
    latestObservedProductReference: product.latestObservedProductReference,
    variantCountPurchased: product.variantCountPurchased,
    repeatedVariantCount: product.repeatedVariantCount,
    orderCount: product.orderCount,
    totalQuantityPurchased: product.totalQuantityPurchased,
    totalSpentTaxIncl: formatBehaviorDecimal(product.totalSpentTaxIncl),
    spendShare: divideDecimalToBehaviorDecimal(product.totalSpentTaxIncl, totals.totalSpent),
    orderShare: divideIntegerToBehaviorDecimal(product.orderCount, totals.validOrderCount),
    quantityShare: divideIntegerToBehaviorDecimal(product.totalQuantityPurchased, totals.totalUnits),
    firstPurchasedAt: product.firstPurchasedAt.toISOString(),
    lastPurchasedAt: product.lastPurchasedAt.toISOString(),
    daysSinceLastPurchase: daysSince(totals.calculatedAt, product.lastPurchasedAt),
    isRepeated: product.isRepeated,
  };
}

function concentration(spentValues: readonly string[], totalSpent: string): PurchaseBehaviorConcentration {
  if (spentValues.length === 0 || totalSpent === '0.000000') {
    return EMPTY_CONCENTRATION;
  }
  const shares = spentValues.map((spent) => divideDecimalToBehaviorDecimal(spent, totalSpent));
  const hhi = sumBehaviorShares(shares.map(squareBehaviorShare));
  return {
    top1Share: shares[0] ?? '0.000000',
    top3Share: sumBehaviorShares(shares.slice(0, 3)),
    hhi,
    effectiveDiversity: effectiveDiversityFromHhi(hhi),
  };
}

function sortVariants(variants: readonly ProductBehaviorVariantRecord[]): ProductBehaviorVariantRecord[] {
  return [...variants].sort((a, b) => {
    const spent = compareDecimalDesc(a.totalSpentTaxIncl, b.totalSpentTaxIncl);
    if (spent !== 0) return spent;
    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;
    if (a.totalQuantityPurchased !== b.totalQuantityPurchased) return b.totalQuantityPurchased - a.totalQuantityPurchased;
    if (a.lastPurchasedAt.getTime() !== b.lastPurchasedAt.getTime()) {
      return b.lastPurchasedAt.getTime() - a.lastPurchasedAt.getTime();
    }
    if (a.productId !== b.productId) return a.productId - b.productId;
    return a.productAttributeId - b.productAttributeId;
  });
}

function sortProducts(products: readonly ProductAggregate[]): ProductAggregate[] {
  return [...products].sort((a, b) => {
    const spent = compareDecimalDesc(a.totalSpentTaxIncl, b.totalSpentTaxIncl);
    if (spent !== 0) return spent;
    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;
    if (a.totalQuantityPurchased !== b.totalQuantityPurchased) return b.totalQuantityPurchased - a.totalQuantityPurchased;
    if (a.lastPurchasedAt.getTime() !== b.lastPurchasedAt.getTime()) {
      return b.lastPurchasedAt.getTime() - a.lastPurchasedAt.getTime();
    }
    return a.productId - b.productId;
  });
}

function compareLatestVariant(a: ProductBehaviorVariantRecord, b: ProductBehaviorVariantRecord): number {
  if (a.lastPurchasedAt.getTime() !== b.lastPurchasedAt.getTime()) {
    return b.lastPurchasedAt.getTime() - a.lastPurchasedAt.getTime();
  }
  if (a.productId !== b.productId) return b.productId - a.productId;
  return b.productAttributeId - a.productAttributeId;
}

function daysSince(now: Date, then: Date): number {
  const diff = now.getTime() - then.getTime();
  if (diff < 0) {
    throw new Error('lastPurchasedAt cannot be in the future');
  }
  return Math.floor(diff / 86_400_000);
}

function degradedOrThrow(customerId: number, error: unknown): GetCustomerPurchaseBehaviorResult {
  if (error instanceof PrestashopTimeoutError || error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', customerId, reason: 'prestashop_unavailable' };
  }
  if (error instanceof PrestashopSchemaIncompatibleError) {
    return { status: 'degraded', customerId, reason: 'prestashop_schema_incompatible' };
  }
  throw error;
}
