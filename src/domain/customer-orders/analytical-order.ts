import { sha256Stable } from '../customer-rfm/checksum.js';

const SCALE = 6;

export const analyticalOrderContractVersion = 'analytical-order-candidate-v1';
export const salesChannelPolicyVersion = 'prestashop-online-orders-candidate-v1';
export const identityPolicyVersion = 'prestashop-customer-identity-candidate-v1';
export const lineEligibilityPolicyVersion = 'eligible-commercial-lines-candidate-v1';
export const monetaryPolicyVersion = 'eligible-product-net-value-tax-incl-candidate-v1';
export const discountAllocationPolicyVersion = 'proportional-largest-remainder-candidate-v1';
export const reconciliationPolicyVersion = 'prestashop-order-reconciliation-candidate-v1';

export type DecimalValue = string;

export type SalesChannelClassification =
  | 'ONLINE_CANDIDATE'
  | 'STORE_CONFIRMED'
  | 'POS_CONFIRMED'
  | 'TECHNICAL'
  | 'AMBIGUOUS';

export type AnalyticalIdentityClassification =
  | 'INDIVIDUAL_CUSTOMER_CANDIDATE'
  | 'GENERIC_CUSTOMER'
  | 'TECHNICAL_ACCOUNT'
  | 'UNRESOLVED';

export type AnalyticalLineClassification =
  | 'COMMERCIAL_PRODUCT'
  | 'COMMERCIAL_SERVICE'
  | 'SELLER_SERVICE'
  | 'LOGISTICS_ARTIFACT'
  | 'TECHNICAL_LINE'
  | 'UNRESOLVED';

export type AnalyticalOrderInclusionStatus = 'INCLUDED' | 'EXCLUDED' | 'QUARANTINED';
export type AnalyticalLineInclusionStatus = 'INCLUDED' | 'EXCLUDED' | 'UNRESOLVED';

export type AnalyticalOrderExclusionReason =
  | 'GENERIC_CUSTOMER'
  | 'TECHNICAL_CUSTOMER'
  | 'SELLER_SERVICE_MARKER'
  | 'STORE_MODULE'
  | 'STORE_SHOP'
  | 'POS_MODULE'
  | 'UNKNOWN_CHANNEL'
  | 'UNRESOLVED_IDENTITY'
  | 'NO_ELIGIBLE_LINES';

export type AnalyticalLineExclusionReason =
  | 'SELLER_SERVICE'
  | 'LOGISTICS_ARTIFACT'
  | 'TECHNICAL_PRODUCT'
  | 'UNRESOLVED_LINE_CLASSIFICATION';

export type AnalyticalLineReconciliationStatus =
  | 'RECONCILED'
  | 'ROUNDING_ONLY'
  | 'PARTIAL'
  | 'UNRESOLVED';

export type AnalyticalOrderDiscountClassification =
  | 'PRODUCT_DISCOUNT'
  | 'FREE_SHIPPING'
  | 'MIXED_PRODUCT_AND_SHIPPING'
  | 'GIFT_PRODUCT'
  | 'UNKNOWN';

export type AnalyticalDiscountAttributionStatus = 'CONFIRMED' | 'PARTIAL' | 'UNRESOLVED';

export type HistoricalCatalogDiagnostic = {
  readonly orderDetailId: number;
  readonly status:
    | 'NOT_RUN'
    | 'MATCH'
    | 'ROUNDING_ONLY'
    | 'MISMATCH'
    | 'CONTEXT_PARTIAL'
    | 'NOT_RECONSTRUCTABLE';
  readonly reconstructedUnitPriceTaxIncl?: DecimalValue;
  readonly deltaTaxIncl?: DecimalValue;
};

export type AnalyticalOrderDiscount = {
  readonly sourceOrderCartRuleId?: number;
  readonly classification: AnalyticalOrderDiscountClassification;
  readonly valueTaxIncl: DecimalValue;
  readonly valueTaxExcl: DecimalValue;
  readonly productApplicableValueTaxIncl: DecimalValue;
  readonly productApplicableValueTaxExcl: DecimalValue;
  readonly shippingDiscountTaxIncl: DecimalValue;
  readonly shippingDiscountTaxExcl: DecimalValue;
  readonly unresolvedDiscountTaxIncl: DecimalValue;
  readonly unresolvedDiscountTaxExcl: DecimalValue;
  readonly attributionStatus: AnalyticalDiscountAttributionStatus;
};

export type AnalyticalOrderLine = {
  readonly orderDetailId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly quantity: number;
  readonly productActive: boolean | null;
  readonly classification: AnalyticalLineClassification;
  readonly inclusionStatus: AnalyticalLineInclusionStatus;
  readonly exclusionReasons: readonly AnalyticalLineExclusionReason[];
  readonly historicalPriceSource: 'ORDER_DETAIL_PERSISTED';
  readonly historicalCatalogDiagnostic: HistoricalCatalogDiagnostic | null;
  readonly unitValueTaxIncl: DecimalValue;
  readonly unitValueTaxExcl: DecimalValue;
  readonly grossLineValueTaxIncl: DecimalValue;
  readonly grossLineValueTaxExcl: DecimalValue;
  readonly allocatedOrderDiscountTaxIncl: DecimalValue;
  readonly allocatedOrderDiscountTaxExcl: DecimalValue;
  readonly netLineValueTaxIncl: DecimalValue;
  readonly netLineValueTaxExcl: DecimalValue;
  readonly reconciliationStatus: AnalyticalLineReconciliationStatus;
};

export type AnalyticalOrderReconciliation = {
  readonly lineSumVsTotalProductsTaxInclDelta: DecimalValue;
  readonly lineSumVsTotalProductsTaxExclDelta: DecimalValue;
  readonly analyticalNetVsExpectedProductNetTaxInclDelta: DecimalValue;
  readonly analyticalNetVsExpectedProductNetTaxExclDelta: DecimalValue;
  readonly totalPaidTaxInclDelta: DecimalValue;
  readonly totalPaidTaxExclDelta: DecimalValue;
  readonly status: 'RECONCILED' | 'ROUNDING_ONLY' | 'PARTIAL' | 'UNRESOLVED';
};

export type AnalyticalOrderPolicyVersions = {
  readonly analyticalOrderContractVersion: string;
  readonly salesChannelPolicyVersion: string;
  readonly identityPolicyVersion: string;
  readonly lineEligibilityPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly discountAllocationPolicyVersion: string;
  readonly reconciliationPolicyVersion: string;
};

export type AnalyticalOrder = {
  readonly orderId: number;
  readonly prestashopCustomerId: number;
  readonly orderDate: string;
  readonly salesChannel: SalesChannelClassification;
  readonly identity: AnalyticalIdentityClassification;
  readonly currencyId: number;
  readonly shopId: number;
  readonly module: string | null;
  readonly inclusionStatus: AnalyticalOrderInclusionStatus;
  readonly exclusionReasons: readonly AnalyticalOrderExclusionReason[];
  readonly lines: readonly AnalyticalOrderLine[];
  readonly discounts: readonly AnalyticalOrderDiscount[];
  readonly grossEligibleProductValueTaxIncl: DecimalValue;
  readonly grossEligibleProductValueTaxExcl: DecimalValue;
  readonly productApplicableOrderDiscountTaxIncl: DecimalValue;
  readonly productApplicableOrderDiscountTaxExcl: DecimalValue;
  readonly shippingDiscountTaxIncl: DecimalValue;
  readonly shippingDiscountTaxExcl: DecimalValue;
  readonly unresolvedDiscountTaxIncl: DecimalValue;
  readonly unresolvedDiscountTaxExcl: DecimalValue;
  readonly netEligibleProductValueTaxIncl: DecimalValue;
  readonly netEligibleProductValueTaxExcl: DecimalValue;
  readonly excludedTechnicalValueTaxIncl: DecimalValue;
  readonly excludedTechnicalValueTaxExcl: DecimalValue;
  readonly unresolvedLineValueTaxIncl: DecimalValue;
  readonly unresolvedLineValueTaxExcl: DecimalValue;
  readonly shippingValueTaxIncl: DecimalValue;
  readonly shippingValueTaxExcl: DecimalValue;
  readonly wrappingValueTaxIncl: DecimalValue;
  readonly wrappingValueTaxExcl: DecimalValue;
  readonly reconciliation: AnalyticalOrderReconciliation;
  readonly policyVersions: AnalyticalOrderPolicyVersions;
};

export type OnlineSalesScopePolicy = {
  readonly version: string;
  readonly genericCustomerIds: ReadonlySet<number>;
  readonly technicalCustomerIds: ReadonlySet<number>;
  readonly sellerServiceProductIds: ReadonlySet<number>;
  readonly storeShopIds: ReadonlySet<number>;
  readonly storeModules: ReadonlySet<string>;
  readonly posModules: ReadonlySet<string>;
  readonly ambiguousOrderPolicy: 'INCLUDE_AS_CANDIDATE' | 'EXCLUDE' | 'QUARANTINE';
};

export type AnalyticalIdentityPolicy = {
  readonly version: string;
  readonly genericCustomerIds: ReadonlySet<number>;
  readonly technicalCustomerIds: ReadonlySet<number>;
};

export type AnalyticalLineEligibilityPolicy = {
  readonly version: string;
  readonly sellerServiceProductIds: ReadonlySet<number>;
  readonly logisticsArtifactProductIds: ReadonlySet<number>;
  readonly technicalProductIds: ReadonlySet<number>;
  readonly commercialServiceProductIds: ReadonlySet<number>;
  readonly unresolvedProductIds: ReadonlySet<number>;
};

export type AnalyticalMonetaryPolicy = {
  readonly version: string;
  readonly primaryTaxBasis: 'TAX_INCL';
  readonly auxiliaryTaxBasis: 'TAX_EXCL';
  readonly priceAuthority: 'ORDER_DETAIL_PERSISTED';
  readonly allocationMethod: 'LARGEST_REMAINDER';
};

export type AnalyticalOrderPolicies = {
  readonly salesChannel: OnlineSalesScopePolicy;
  readonly identity: AnalyticalIdentityPolicy;
  readonly lineEligibility: AnalyticalLineEligibilityPolicy;
  readonly monetary: AnalyticalMonetaryPolicy;
  readonly discountAllocationVersion: string;
  readonly reconciliationVersion: string;
};

export type RawPrestaShopOrder = {
  readonly orderId: number;
  readonly prestashopCustomerId: number;
  readonly orderDate: string;
  readonly shopId: number;
  readonly currencyId: number;
  readonly module: string | null;
  readonly totalProductsTaxIncl: DecimalValue;
  readonly totalProductsTaxExcl: DecimalValue;
  readonly totalDiscountsTaxIncl: DecimalValue;
  readonly totalDiscountsTaxExcl: DecimalValue;
  readonly totalShippingTaxIncl: DecimalValue;
  readonly totalShippingTaxExcl: DecimalValue;
  readonly totalWrappingTaxIncl: DecimalValue;
  readonly totalWrappingTaxExcl: DecimalValue;
  readonly totalPaidTaxIncl: DecimalValue;
  readonly totalPaidTaxExcl: DecimalValue;
};

export type RawPrestaShopOrderLine = {
  readonly orderDetailId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly quantity: number;
  readonly productActive?: boolean | null;
  readonly unitPriceTaxIncl: DecimalValue;
  readonly unitPriceTaxExcl: DecimalValue;
  readonly totalPriceTaxIncl: DecimalValue;
  readonly totalPriceTaxExcl: DecimalValue;
};

export type RawPrestaShopOrderDiscount = {
  readonly sourceOrderCartRuleId?: number;
  readonly classification: AnalyticalOrderDiscountClassification;
  readonly valueTaxIncl: DecimalValue;
  readonly valueTaxExcl: DecimalValue;
  readonly productApplicableValueTaxIncl?: DecimalValue;
  readonly productApplicableValueTaxExcl?: DecimalValue;
  readonly shippingDiscountTaxIncl?: DecimalValue;
  readonly shippingDiscountTaxExcl?: DecimalValue;
};

export type BuildAnalyticalOrderInput = {
  readonly order: RawPrestaShopOrder;
  readonly lines: readonly RawPrestaShopOrderLine[];
  readonly discounts: readonly RawPrestaShopOrderDiscount[];
  readonly historicalCatalogDiagnostics?: readonly HistoricalCatalogDiagnostic[];
};

export type AnalyticalOrderVerdict =
  | 'CANONICAL_ANALYTICAL_ORDER_CONTRACT_VALIDATED'
  | 'CANONICAL_CONTRACT_VALIDATED_WITH_EXCEPTIONS'
  | 'CANONICAL_CONTRACT_REQUIRES_SCOPE_CONFIRMATION'
  | 'CANONICAL_CONTRACT_REQUIRES_DISCOUNT_EXCEPTION_POLICY'
  | 'CANONICAL_CONTRACT_NOT_STABLE'
  | 'BLOCKED_BY_POLICY_CONFLICT'
  | 'BLOCKED_BY_DATA_CONTRACT'
  | 'BLOCKED_BY_NEW_TEST_REGRESSION';

export type AnalyticalOrderCondition =
  | 'ORDER_DETAIL_IS_HISTORICAL_AUTHORITY'
  | 'USE_TAX_INCL_AS_PRIMARY'
  | 'KEEP_TAX_EXCL_AS_AUXILIARY'
  | 'EXCLUDE_CONFIRMED_TECHNICAL_LINES'
  | 'ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY'
  | 'DO_NOT_ALLOCATE_FREE_SHIPPING'
  | 'SCOPE_ONLINE_REMAINS_CANDIDATE'
  | 'RFM_READY_FOR_READ_ONLY_ADOPTION'
  | 'T08_READY_FOR_READ_ONLY_ADOPTION'
  | 'T09_READY_FOR_READ_ONLY_ADOPTION';

export function defaultAnalyticalOrderPolicies(input: {
  readonly genericCustomerIds?: readonly number[];
  readonly technicalCustomerIds?: readonly number[];
  readonly sellerServiceProductIds?: readonly number[];
  readonly logisticsArtifactProductIds?: readonly number[];
  readonly technicalProductIds?: readonly number[];
  readonly commercialServiceProductIds?: readonly number[];
  readonly unresolvedProductIds?: readonly number[];
  readonly storeShopIds?: readonly number[];
  readonly storeModules?: readonly string[];
  readonly posModules?: readonly string[];
  readonly ambiguousOrderPolicy?: OnlineSalesScopePolicy['ambiguousOrderPolicy'];
} = {}): AnalyticalOrderPolicies {
  const genericCustomerIds = toNumberSet(input.genericCustomerIds ?? []);
  const technicalCustomerIds = toNumberSet(input.technicalCustomerIds ?? []);
  const sellerServiceProductIds = toNumberSet(input.sellerServiceProductIds ?? []);
  return {
    salesChannel: {
      version: salesChannelPolicyVersion,
      genericCustomerIds,
      technicalCustomerIds,
      sellerServiceProductIds,
      storeShopIds: toNumberSet(input.storeShopIds ?? []),
      storeModules: toModuleSet(input.storeModules ?? []),
      posModules: toModuleSet(input.posModules ?? []),
      ambiguousOrderPolicy: input.ambiguousOrderPolicy ?? 'INCLUDE_AS_CANDIDATE',
    },
    identity: {
      version: identityPolicyVersion,
      genericCustomerIds,
      technicalCustomerIds,
    },
    lineEligibility: {
      version: lineEligibilityPolicyVersion,
      sellerServiceProductIds,
      logisticsArtifactProductIds: toNumberSet(input.logisticsArtifactProductIds ?? []),
      technicalProductIds: toNumberSet(input.technicalProductIds ?? []),
      commercialServiceProductIds: toNumberSet(input.commercialServiceProductIds ?? []),
      unresolvedProductIds: toNumberSet(input.unresolvedProductIds ?? []),
    },
    monetary: {
      version: monetaryPolicyVersion,
      primaryTaxBasis: 'TAX_INCL',
      auxiliaryTaxBasis: 'TAX_EXCL',
      priceAuthority: 'ORDER_DETAIL_PERSISTED',
      allocationMethod: 'LARGEST_REMAINDER',
    },
    discountAllocationVersion: discountAllocationPolicyVersion,
    reconciliationVersion: reconciliationPolicyVersion,
  };
}

export function buildAnalyticalOrder(
  input: BuildAnalyticalOrderInput,
  policies: AnalyticalOrderPolicies = defaultAnalyticalOrderPolicies(),
): AnalyticalOrder {
  assertInput(input);
  assertPolicies(policies);
  const identity = classifyIdentity(input.order, policies.identity);
  const rawLineClassifications = input.lines.map((line) => classifyLine(line, policies.lineEligibility));
  const salesChannel = classifySalesChannel(input.order, rawLineClassifications, policies.salesChannel);
  const normalizedDiscounts = input.discounts.map(normalizeDiscount);
  const lineShells = input.lines.map((line, index) => buildLineShell(line, rawLineClassifications[index]!, input.historicalCatalogDiagnostics ?? []));
  const eligibleLines = lineShells.filter((line) => line.inclusionStatus === 'INCLUDED');
  const grossEligibleProductValueTaxIncl = sumMoney(eligibleLines.map((line) => line.grossLineValueTaxIncl));
  const grossEligibleProductValueTaxExcl = sumMoney(eligibleLines.map((line) => line.grossLineValueTaxExcl));
  const productApplicableOrderDiscountTaxIncl = sumMoney(normalizedDiscounts.map((discount) => discount.productApplicableValueTaxIncl));
  const productApplicableOrderDiscountTaxExcl = sumMoney(normalizedDiscounts.map((discount) => discount.productApplicableValueTaxExcl));
  const allocatedIncl = allocateByLargestRemainder(productApplicableOrderDiscountTaxIncl, eligibleLines.map((line) => line.grossLineValueTaxIncl));
  const allocatedExcl = allocateByLargestRemainder(productApplicableOrderDiscountTaxExcl, eligibleLines.map((line) => line.grossLineValueTaxExcl));
  const allocationByLine = new Map<number, { readonly incl: string; readonly excl: string }>();
  eligibleLines.forEach((line, index) => {
    allocationByLine.set(line.orderDetailId, {
      incl: allocatedIncl[index] ?? '0.000000',
      excl: allocatedExcl[index] ?? '0.000000',
    });
  });
  const lines = lineShells.map((line) => {
    const allocation = allocationByLine.get(line.orderDetailId) ?? { incl: '0.000000', excl: '0.000000' };
    const netLineValueTaxIncl = line.inclusionStatus === 'INCLUDED'
      ? maxZero(subMoney(line.grossLineValueTaxIncl, allocation.incl))
      : '0.000000';
    const netLineValueTaxExcl = line.inclusionStatus === 'INCLUDED'
      ? maxZero(subMoney(line.grossLineValueTaxExcl, allocation.excl))
      : '0.000000';
    return {
      ...line,
      allocatedOrderDiscountTaxIncl: allocation.incl,
      allocatedOrderDiscountTaxExcl: allocation.excl,
      netLineValueTaxIncl,
      netLineValueTaxExcl,
      reconciliationStatus: lineReconciliationStatus(line, netLineValueTaxIncl, netLineValueTaxExcl),
    };
  });
  const allocatedProductDiscountTaxIncl = sumMoney(lines.map((line) => line.allocatedOrderDiscountTaxIncl));
  const allocatedProductDiscountTaxExcl = sumMoney(lines.map((line) => line.allocatedOrderDiscountTaxExcl));
  const unresolvedDiscountTaxIncl = sumMoney([
    ...normalizedDiscounts.map((discount) => discount.unresolvedDiscountTaxIncl),
    maxZero(subMoney(productApplicableOrderDiscountTaxIncl, allocatedProductDiscountTaxIncl)),
  ]);
  const unresolvedDiscountTaxExcl = sumMoney([
    ...normalizedDiscounts.map((discount) => discount.unresolvedDiscountTaxExcl),
    maxZero(subMoney(productApplicableOrderDiscountTaxExcl, allocatedProductDiscountTaxExcl)),
  ]);
  const netEligibleProductValueTaxIncl = sumMoney(lines.map((line) => line.netLineValueTaxIncl));
  const netEligibleProductValueTaxExcl = sumMoney(lines.map((line) => line.netLineValueTaxExcl));
  const excludedTechnicalValueTaxIncl = sumMoney(lines.filter((line) => line.inclusionStatus === 'EXCLUDED').map((line) => line.grossLineValueTaxIncl));
  const excludedTechnicalValueTaxExcl = sumMoney(lines.filter((line) => line.inclusionStatus === 'EXCLUDED').map((line) => line.grossLineValueTaxExcl));
  const unresolvedLineValueTaxIncl = sumMoney(lines.filter((line) => line.inclusionStatus === 'UNRESOLVED').map((line) => line.grossLineValueTaxIncl));
  const unresolvedLineValueTaxExcl = sumMoney(lines.filter((line) => line.inclusionStatus === 'UNRESOLVED').map((line) => line.grossLineValueTaxExcl));
  const reconciliation = reconcileOrder({
    order: input.order,
    lines,
    grossEligibleProductValueTaxIncl,
    grossEligibleProductValueTaxExcl,
    productApplicableOrderDiscountTaxIncl,
    productApplicableOrderDiscountTaxExcl,
    allocatedProductDiscountTaxIncl,
    allocatedProductDiscountTaxExcl,
    netEligibleProductValueTaxIncl,
    netEligibleProductValueTaxExcl,
    discounts: normalizedDiscounts,
  });
  const exclusionReasons = orderExclusionReasons({
    order: input.order,
    identity,
    salesChannel,
    lineClassifications: rawLineClassifications,
    lines,
    policies,
  });
  const inclusionStatus = orderInclusionStatus(salesChannel, exclusionReasons, policies.salesChannel.ambiguousOrderPolicy);
  return {
    orderId: input.order.orderId,
    prestashopCustomerId: input.order.prestashopCustomerId,
    orderDate: input.order.orderDate,
    salesChannel,
    identity,
    currencyId: input.order.currencyId,
    shopId: input.order.shopId,
    module: normalizeModule(input.order.module),
    inclusionStatus,
    exclusionReasons,
    lines,
    discounts: normalizedDiscounts,
    grossEligibleProductValueTaxIncl,
    grossEligibleProductValueTaxExcl,
    productApplicableOrderDiscountTaxIncl,
    productApplicableOrderDiscountTaxExcl,
    shippingDiscountTaxIncl: sumMoney(normalizedDiscounts.map((discount) => discount.shippingDiscountTaxIncl)),
    shippingDiscountTaxExcl: sumMoney(normalizedDiscounts.map((discount) => discount.shippingDiscountTaxExcl)),
    unresolvedDiscountTaxIncl,
    unresolvedDiscountTaxExcl,
    netEligibleProductValueTaxIncl,
    netEligibleProductValueTaxExcl,
    excludedTechnicalValueTaxIncl,
    excludedTechnicalValueTaxExcl,
    unresolvedLineValueTaxIncl,
    unresolvedLineValueTaxExcl,
    shippingValueTaxIncl: money(input.order.totalShippingTaxIncl),
    shippingValueTaxExcl: money(input.order.totalShippingTaxExcl),
    wrappingValueTaxIncl: money(input.order.totalWrappingTaxIncl),
    wrappingValueTaxExcl: money(input.order.totalWrappingTaxExcl),
    reconciliation,
    policyVersions: policyVersionsFor(policies),
  };
}

export function buildCanonicalAnalyticalOrderVerdict(orders: readonly AnalyticalOrder[]): {
  readonly primaryVerdict: AnalyticalOrderVerdict;
  readonly conditions: readonly AnalyticalOrderCondition[];
  readonly rationale: readonly string[];
} {
  const hasPartialReconciliation = orders.some((order) => order.reconciliation.status === 'PARTIAL' || order.reconciliation.status === 'UNRESOLVED');
  const hasUnresolvedDiscount = orders.some((order) => compareMoney(order.unresolvedDiscountTaxIncl, '0.000000') > 0);
  const hasAmbiguous = orders.some((order) => order.salesChannel === 'AMBIGUOUS');
  let primaryVerdict: AnalyticalOrderVerdict = 'CANONICAL_ANALYTICAL_ORDER_CONTRACT_VALIDATED';
  if (hasUnresolvedDiscount) {
    primaryVerdict = 'CANONICAL_CONTRACT_REQUIRES_DISCOUNT_EXCEPTION_POLICY';
  } else if (hasAmbiguous) {
    primaryVerdict = 'CANONICAL_CONTRACT_REQUIRES_SCOPE_CONFIRMATION';
  } else if (hasPartialReconciliation) {
    primaryVerdict = 'CANONICAL_CONTRACT_VALIDATED_WITH_EXCEPTIONS';
  }
  return {
    primaryVerdict,
    conditions: [
      'ORDER_DETAIL_IS_HISTORICAL_AUTHORITY',
      'USE_TAX_INCL_AS_PRIMARY',
      'KEEP_TAX_EXCL_AS_AUXILIARY',
      'EXCLUDE_CONFIRMED_TECHNICAL_LINES',
      'ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY',
      'DO_NOT_ALLOCATE_FREE_SHIPPING',
      'SCOPE_ONLINE_REMAINS_CANDIDATE',
      'RFM_READY_FOR_READ_ONLY_ADOPTION',
      'T08_READY_FOR_READ_ONLY_ADOPTION',
      'T09_READY_FOR_READ_ONLY_ADOPTION',
    ],
    rationale: [
      `orderCount=${orders.length}`,
      `includedOrderCount=${orders.filter((order) => order.inclusionStatus === 'INCLUDED').length}`,
      `excludedOrderCount=${orders.filter((order) => order.inclusionStatus === 'EXCLUDED').length}`,
      `quarantinedOrderCount=${orders.filter((order) => order.inclusionStatus === 'QUARANTINED').length}`,
    ],
  };
}

export function summarizeAnalyticalOrders(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  return {
    orderCount: orders.length,
    includedOrderCount: orders.filter((order) => order.inclusionStatus === 'INCLUDED').length,
    excludedOrderCount: orders.filter((order) => order.inclusionStatus === 'EXCLUDED').length,
    quarantinedOrderCount: orders.filter((order) => order.inclusionStatus === 'QUARANTINED').length,
    netEligibleProductValueTaxIncl: sumMoney(orders.map((order) => order.netEligibleProductValueTaxIncl)),
    netEligibleProductValueTaxExcl: sumMoney(orders.map((order) => order.netEligibleProductValueTaxExcl)),
    grossEligibleProductValueTaxIncl: sumMoney(orders.map((order) => order.grossEligibleProductValueTaxIncl)),
    productApplicableOrderDiscountTaxIncl: sumMoney(orders.map((order) => order.productApplicableOrderDiscountTaxIncl)),
    shippingDiscountTaxIncl: sumMoney(orders.map((order) => order.shippingDiscountTaxIncl)),
    unresolvedDiscountTaxIncl: sumMoney(orders.map((order) => order.unresolvedDiscountTaxIncl)),
    excludedTechnicalValueTaxIncl: sumMoney(orders.map((order) => order.excludedTechnicalValueTaxIncl)),
    unresolvedLineValueTaxIncl: sumMoney(orders.map((order) => order.unresolvedLineValueTaxIncl)),
    checksum: analyticalOrderChecksum(orders.map((order) => publicOrderForChecksum(order))),
  };
}

export function countAnalyticalOrdersBy<T extends string>(
  orders: readonly AnalyticalOrder[],
  keyOf: (order: AnalyticalOrder) => T,
): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const order of orders) {
    const key = keyOf(order);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) as Record<T, number>;
}

export function countAnalyticalLinesBy<T extends string>(
  orders: readonly AnalyticalOrder[],
  keyOf: (line: AnalyticalOrderLine, order: AnalyticalOrder) => T,
): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const order of orders) {
    for (const line of order.lines) {
      const key = keyOf(line, order);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) as Record<T, number>;
}

export function analyticalOrderChecksum(value: unknown): string {
  return sha256Stable({ version: analyticalOrderContractVersion, value });
}

export function assertAnalyticalOrderReportHasNoPii(report: unknown): void {
  assertNoPii(report, 'report');
}

export function money(value: string | number): string {
  return fromScaled(toScaled(String(value)));
}

export function sumMoney(values: readonly string[]): string {
  return fromScaled(values.reduce((sum, value) => sum + toScaled(value), 0n));
}

export function subMoney(left: string, right: string): string {
  return fromScaled(toScaled(left) - toScaled(right));
}

export function compareMoney(left: string, right: string): number {
  const a = toScaled(left);
  const b = toScaled(bString(right));
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function absMoney(value: string): string {
  return fromScaled(absScaled(toScaled(value)));
}

function classifyIdentity(order: RawPrestaShopOrder, policy: AnalyticalIdentityPolicy): AnalyticalIdentityClassification {
  if (policy.technicalCustomerIds.has(order.prestashopCustomerId) || order.prestashopCustomerId <= 0) return 'TECHNICAL_ACCOUNT';
  if (policy.genericCustomerIds.has(order.prestashopCustomerId)) return 'GENERIC_CUSTOMER';
  if (!Number.isSafeInteger(order.prestashopCustomerId)) return 'UNRESOLVED';
  return 'INDIVIDUAL_CUSTOMER_CANDIDATE';
}

function classifySalesChannel(
  order: RawPrestaShopOrder,
  lineClassifications: readonly AnalyticalLineClassification[],
  policy: OnlineSalesScopePolicy,
): SalesChannelClassification {
  const module = normalizeModule(order.module);
  if (policy.technicalCustomerIds.has(order.prestashopCustomerId) || policy.genericCustomerIds.has(order.prestashopCustomerId)) return 'TECHNICAL';
  if (lineClassifications.includes('SELLER_SERVICE')) return 'TECHNICAL';
  if (policy.storeShopIds.has(order.shopId)) return 'STORE_CONFIRMED';
  if (module && policy.storeModules.has(module)) return 'STORE_CONFIRMED';
  if (module && policy.posModules.has(module)) return 'POS_CONFIRMED';
  if (module === null && policy.storeShopIds.size + policy.storeModules.size + policy.posModules.size > 0) return 'AMBIGUOUS';
  return 'ONLINE_CANDIDATE';
}

function classifyLine(line: RawPrestaShopOrderLine, policy: AnalyticalLineEligibilityPolicy): AnalyticalLineClassification {
  if (policy.sellerServiceProductIds.has(line.productId)) return 'SELLER_SERVICE';
  if (policy.logisticsArtifactProductIds.has(line.productId)) return 'LOGISTICS_ARTIFACT';
  if (policy.technicalProductIds.has(line.productId)) return 'TECHNICAL_LINE';
  if (policy.commercialServiceProductIds.has(line.productId)) return 'COMMERCIAL_SERVICE';
  if (policy.unresolvedProductIds.has(line.productId)) return 'UNRESOLVED';
  return 'COMMERCIAL_PRODUCT';
}

function buildLineShell(
  line: RawPrestaShopOrderLine,
  classification: AnalyticalLineClassification,
  diagnostics: readonly HistoricalCatalogDiagnostic[],
): Omit<AnalyticalOrderLine, 'allocatedOrderDiscountTaxIncl' | 'allocatedOrderDiscountTaxExcl' | 'netLineValueTaxIncl' | 'netLineValueTaxExcl' | 'reconciliationStatus'> {
  const inclusionStatus = lineInclusionStatus(classification);
  return {
    orderDetailId: line.orderDetailId,
    productId: line.productId,
    productAttributeId: line.productAttributeId,
    quantity: line.quantity,
    productActive: line.productActive ?? null,
    classification,
    inclusionStatus,
    exclusionReasons: lineExclusionReasons(classification),
    historicalPriceSource: 'ORDER_DETAIL_PERSISTED',
    historicalCatalogDiagnostic: diagnostics.find((diagnostic) => diagnostic.orderDetailId === line.orderDetailId) ?? null,
    unitValueTaxIncl: money(line.unitPriceTaxIncl),
    unitValueTaxExcl: money(line.unitPriceTaxExcl),
    grossLineValueTaxIncl: money(line.totalPriceTaxIncl),
    grossLineValueTaxExcl: money(line.totalPriceTaxExcl),
  };
}

function normalizeDiscount(discount: RawPrestaShopOrderDiscount): AnalyticalOrderDiscount {
  const valueTaxIncl = money(discount.valueTaxIncl);
  const valueTaxExcl = money(discount.valueTaxExcl);
  const productApplicable =
    discount.classification === 'PRODUCT_DISCOUNT'
      ? { incl: valueTaxIncl, excl: valueTaxExcl }
      : discount.classification === 'MIXED_PRODUCT_AND_SHIPPING'
        ? {
            incl: money(discount.productApplicableValueTaxIncl ?? '0.000000'),
            excl: money(discount.productApplicableValueTaxExcl ?? '0.000000'),
          }
        : { incl: '0.000000', excl: '0.000000' };
  const shipping =
    discount.classification === 'FREE_SHIPPING'
      ? { incl: valueTaxIncl, excl: valueTaxExcl }
      : discount.classification === 'MIXED_PRODUCT_AND_SHIPPING'
        ? {
            incl: money(discount.shippingDiscountTaxIncl ?? '0.000000'),
            excl: money(discount.shippingDiscountTaxExcl ?? '0.000000'),
          }
        : { incl: '0.000000', excl: '0.000000' };
  const accountedIncl = sumMoney([productApplicable.incl, shipping.incl]);
  const accountedExcl = sumMoney([productApplicable.excl, shipping.excl]);
  const unresolvedIncl = ['UNKNOWN', 'GIFT_PRODUCT'].includes(discount.classification)
    ? valueTaxIncl
    : maxZero(subMoney(valueTaxIncl, accountedIncl));
  const unresolvedExcl = ['UNKNOWN', 'GIFT_PRODUCT'].includes(discount.classification)
    ? valueTaxExcl
    : maxZero(subMoney(valueTaxExcl, accountedExcl));
  const attributionStatus: AnalyticalDiscountAttributionStatus =
    discount.classification === 'UNKNOWN' || discount.classification === 'GIFT_PRODUCT'
      ? 'UNRESOLVED'
      : discount.classification === 'MIXED_PRODUCT_AND_SHIPPING' && (compareMoney(unresolvedIncl, '0.000000') > 0 || compareMoney(unresolvedExcl, '0.000000') > 0)
        ? 'PARTIAL'
        : 'CONFIRMED';
  return {
    ...(discount.sourceOrderCartRuleId === undefined ? {} : { sourceOrderCartRuleId: discount.sourceOrderCartRuleId }),
    classification: discount.classification,
    valueTaxIncl,
    valueTaxExcl,
    productApplicableValueTaxIncl: productApplicable.incl,
    productApplicableValueTaxExcl: productApplicable.excl,
    shippingDiscountTaxIncl: shipping.incl,
    shippingDiscountTaxExcl: shipping.excl,
    unresolvedDiscountTaxIncl: unresolvedIncl,
    unresolvedDiscountTaxExcl: unresolvedExcl,
    attributionStatus,
  };
}

function allocateByLargestRemainder(discount: string, weights: readonly string[]): readonly string[] {
  const discountScaled = toScaled(discount);
  const scaledWeights = weights.map(toScaled);
  const totalWeight = scaledWeights.reduce((sum, value) => sum + value, 0n);
  if (discountScaled <= 0n || totalWeight <= 0n || weights.length === 0) return weights.map(() => '0.000000');
  const raw = scaledWeights.map((weight, index) => {
    const numerator = discountScaled * weight;
    return {
      index,
      floor: numerator / totalWeight,
      remainder: numerator % totalWeight,
      weight,
    };
  });
  const allocations = raw.map((entry) => entry.floor);
  let residue = discountScaled - raw.reduce((sum, entry) => sum + entry.floor, 0n);
  const ranked = [...raw].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    if (left.weight !== right.weight) return left.weight > right.weight ? -1 : 1;
    return left.index - right.index;
  });
  for (const entry of ranked) {
    if (residue <= 0n) break;
    allocations[entry.index] = allocations[entry.index]! + 1n;
    residue -= 1n;
  }
  return allocations.map(fromScaled);
}

function reconcileOrder(input: {
  readonly order: RawPrestaShopOrder;
  readonly lines: readonly AnalyticalOrderLine[];
  readonly grossEligibleProductValueTaxIncl: string;
  readonly grossEligibleProductValueTaxExcl: string;
  readonly productApplicableOrderDiscountTaxIncl: string;
  readonly productApplicableOrderDiscountTaxExcl: string;
  readonly allocatedProductDiscountTaxIncl: string;
  readonly allocatedProductDiscountTaxExcl: string;
  readonly netEligibleProductValueTaxIncl: string;
  readonly netEligibleProductValueTaxExcl: string;
  readonly discounts: readonly AnalyticalOrderDiscount[];
}): AnalyticalOrderReconciliation {
  const lineSumVsTotalProductsTaxInclDelta = subMoney(sumMoney(input.lines.map((line) => line.grossLineValueTaxIncl)), input.order.totalProductsTaxIncl);
  const lineSumVsTotalProductsTaxExclDelta = subMoney(sumMoney(input.lines.map((line) => line.grossLineValueTaxExcl)), input.order.totalProductsTaxExcl);
  const expectedProductNetTaxIncl = maxZero(subMoney(input.grossEligibleProductValueTaxIncl, input.allocatedProductDiscountTaxIncl));
  const expectedProductNetTaxExcl = maxZero(subMoney(input.grossEligibleProductValueTaxExcl, input.allocatedProductDiscountTaxExcl));
  const analyticalNetVsExpectedProductNetTaxInclDelta = subMoney(input.netEligibleProductValueTaxIncl, expectedProductNetTaxIncl);
  const analyticalNetVsExpectedProductNetTaxExclDelta = subMoney(input.netEligibleProductValueTaxExcl, expectedProductNetTaxExcl);
  const expectedPaidTaxIncl = sumMoney([
    subMoney(input.order.totalProductsTaxIncl, input.order.totalDiscountsTaxIncl),
    input.order.totalShippingTaxIncl,
    input.order.totalWrappingTaxIncl,
  ]);
  const expectedPaidTaxExcl = sumMoney([
    subMoney(input.order.totalProductsTaxExcl, input.order.totalDiscountsTaxExcl),
    input.order.totalShippingTaxExcl,
    input.order.totalWrappingTaxExcl,
  ]);
  const totalPaidTaxInclDelta = subMoney(expectedPaidTaxIncl, input.order.totalPaidTaxIncl);
  const totalPaidTaxExclDelta = subMoney(expectedPaidTaxExcl, input.order.totalPaidTaxExcl);
  const status = reconciliationStatus([
    lineSumVsTotalProductsTaxInclDelta,
    lineSumVsTotalProductsTaxExclDelta,
    analyticalNetVsExpectedProductNetTaxInclDelta,
    analyticalNetVsExpectedProductNetTaxExclDelta,
    totalPaidTaxInclDelta,
    totalPaidTaxExclDelta,
  ], input);
  return {
    lineSumVsTotalProductsTaxInclDelta,
    lineSumVsTotalProductsTaxExclDelta,
    analyticalNetVsExpectedProductNetTaxInclDelta,
    analyticalNetVsExpectedProductNetTaxExclDelta,
    totalPaidTaxInclDelta,
    totalPaidTaxExclDelta,
    status,
  };
}

function reconciliationStatus(
  deltas: readonly string[],
  input: { readonly lines: readonly AnalyticalOrderLine[]; readonly discounts: readonly AnalyticalOrderDiscount[] },
): AnalyticalOrderReconciliation['status'] {
  if (input.lines.some((line) => line.inclusionStatus === 'UNRESOLVED') || input.discounts.some((discount) => discount.attributionStatus === 'UNRESOLVED')) {
    return 'UNRESOLVED';
  }
  if (input.discounts.some((discount) => discount.attributionStatus === 'PARTIAL')) return 'PARTIAL';
  const max = deltas.map(absMoney).sort(compareMoney).at(-1) ?? '0.000000';
  if (compareMoney(max, '0.000000') === 0) return 'RECONCILED';
  if (compareMoney(max, '1.000000') <= 0) return 'ROUNDING_ONLY';
  return 'PARTIAL';
}

function lineReconciliationStatus(
  line: Omit<AnalyticalOrderLine, 'allocatedOrderDiscountTaxIncl' | 'allocatedOrderDiscountTaxExcl' | 'netLineValueTaxIncl' | 'netLineValueTaxExcl' | 'reconciliationStatus'>,
  netTaxIncl: string,
  netTaxExcl: string,
): AnalyticalLineReconciliationStatus {
  if (line.inclusionStatus === 'UNRESOLVED') return 'UNRESOLVED';
  if (line.historicalCatalogDiagnostic?.status === 'MISMATCH' || line.historicalCatalogDiagnostic?.status === 'CONTEXT_PARTIAL') return 'PARTIAL';
  if (compareMoney(netTaxIncl, '0.000000') === 0 && compareMoney(line.grossLineValueTaxIncl, '0.000000') > 0) return 'PARTIAL';
  if (compareMoney(netTaxExcl, '0.000000') < 0) return 'UNRESOLVED';
  return 'RECONCILED';
}

function orderExclusionReasons(input: {
  readonly order: RawPrestaShopOrder;
  readonly identity: AnalyticalIdentityClassification;
  readonly salesChannel: SalesChannelClassification;
  readonly lineClassifications: readonly AnalyticalLineClassification[];
  readonly lines: readonly AnalyticalOrderLine[];
  readonly policies: AnalyticalOrderPolicies;
}): readonly AnalyticalOrderExclusionReason[] {
  return [
    ...(input.identity === 'GENERIC_CUSTOMER' ? (['GENERIC_CUSTOMER'] as const) : []),
    ...(input.identity === 'TECHNICAL_ACCOUNT' ? (['TECHNICAL_CUSTOMER'] as const) : []),
    ...(input.identity === 'UNRESOLVED' ? (['UNRESOLVED_IDENTITY'] as const) : []),
    ...(input.lineClassifications.includes('SELLER_SERVICE') ? (['SELLER_SERVICE_MARKER'] as const) : []),
    ...(input.salesChannel === 'STORE_CONFIRMED' && input.policies.salesChannel.storeShopIds.has(input.order.shopId) ? (['STORE_SHOP'] as const) : []),
    ...(input.salesChannel === 'STORE_CONFIRMED' && moduleMatches(input.order.module, input.policies.salesChannel.storeModules) ? (['STORE_MODULE'] as const) : []),
    ...(input.salesChannel === 'POS_CONFIRMED' ? (['POS_MODULE'] as const) : []),
    ...(input.salesChannel === 'AMBIGUOUS' ? (['UNKNOWN_CHANNEL'] as const) : []),
    ...(input.lines.length > 0 && input.lines.every((line) => line.inclusionStatus !== 'INCLUDED') ? (['NO_ELIGIBLE_LINES'] as const) : []),
  ];
}

function orderInclusionStatus(
  salesChannel: SalesChannelClassification,
  exclusionReasons: readonly AnalyticalOrderExclusionReason[],
  ambiguousPolicy: OnlineSalesScopePolicy['ambiguousOrderPolicy'],
): AnalyticalOrderInclusionStatus {
  if (salesChannel === 'AMBIGUOUS') {
    if (ambiguousPolicy === 'QUARANTINE') return 'QUARANTINED';
    if (ambiguousPolicy === 'EXCLUDE') return 'EXCLUDED';
    return exclusionReasons.filter((reason) => reason !== 'UNKNOWN_CHANNEL').length === 0 ? 'INCLUDED' : 'EXCLUDED';
  }
  return exclusionReasons.length === 0 && salesChannel === 'ONLINE_CANDIDATE' ? 'INCLUDED' : 'EXCLUDED';
}

function lineInclusionStatus(classification: AnalyticalLineClassification): AnalyticalLineInclusionStatus {
  if (classification === 'COMMERCIAL_PRODUCT' || classification === 'COMMERCIAL_SERVICE') return 'INCLUDED';
  if (classification === 'UNRESOLVED') return 'UNRESOLVED';
  return 'EXCLUDED';
}

function lineExclusionReasons(classification: AnalyticalLineClassification): readonly AnalyticalLineExclusionReason[] {
  if (classification === 'SELLER_SERVICE') return ['SELLER_SERVICE'];
  if (classification === 'LOGISTICS_ARTIFACT') return ['LOGISTICS_ARTIFACT'];
  if (classification === 'TECHNICAL_LINE') return ['TECHNICAL_PRODUCT'];
  if (classification === 'UNRESOLVED') return ['UNRESOLVED_LINE_CLASSIFICATION'];
  return [];
}

function policyVersionsFor(policies: AnalyticalOrderPolicies): AnalyticalOrderPolicyVersions {
  return {
    analyticalOrderContractVersion,
    salesChannelPolicyVersion: policies.salesChannel.version,
    identityPolicyVersion: policies.identity.version,
    lineEligibilityPolicyVersion: policies.lineEligibility.version,
    monetaryPolicyVersion: policies.monetary.version,
    discountAllocationPolicyVersion: policies.discountAllocationVersion,
    reconciliationPolicyVersion: policies.reconciliationVersion,
  };
}

function assertInput(input: BuildAnalyticalOrderInput): void {
  assertPositiveInt(input.order.orderId, 'orderId');
  assertInt(input.order.prestashopCustomerId, 'prestashopCustomerId');
  assertPositiveInt(input.order.shopId, 'shopId');
  assertPositiveInt(input.order.currencyId, 'currencyId');
  if (Number.isNaN(new Date(normalizeDate(input.order.orderDate)).getTime())) throw new Error('Invalid orderDate');
  [
    input.order.totalProductsTaxIncl,
    input.order.totalProductsTaxExcl,
    input.order.totalDiscountsTaxIncl,
    input.order.totalDiscountsTaxExcl,
    input.order.totalShippingTaxIncl,
    input.order.totalShippingTaxExcl,
    input.order.totalWrappingTaxIncl,
    input.order.totalWrappingTaxExcl,
    input.order.totalPaidTaxIncl,
    input.order.totalPaidTaxExcl,
  ].forEach(money);
  for (const line of input.lines) {
    assertPositiveInt(line.orderDetailId, 'orderDetailId');
    assertInt(line.productId, 'productId');
    assertInt(line.productAttributeId, 'productAttributeId');
    assertInt(line.quantity, 'quantity');
    [line.unitPriceTaxIncl, line.unitPriceTaxExcl, line.totalPriceTaxIncl, line.totalPriceTaxExcl].forEach(money);
  }
  for (const discount of input.discounts) {
    [discount.valueTaxIncl, discount.valueTaxExcl].forEach(money);
    if (discount.productApplicableValueTaxIncl !== undefined) money(discount.productApplicableValueTaxIncl);
    if (discount.productApplicableValueTaxExcl !== undefined) money(discount.productApplicableValueTaxExcl);
    if (discount.shippingDiscountTaxIncl !== undefined) money(discount.shippingDiscountTaxIncl);
    if (discount.shippingDiscountTaxExcl !== undefined) money(discount.shippingDiscountTaxExcl);
  }
}

function assertPolicies(policies: AnalyticalOrderPolicies): void {
  for (const [name, value] of Object.entries(policyVersionsFor(policies))) {
    if (value.trim() === '') throw new Error(`Missing policy version: ${name}`);
  }
  if (policies.monetary.primaryTaxBasis !== 'TAX_INCL') throw new Error('Analytical order contract requires TAX_INCL primary basis');
  if (policies.monetary.auxiliaryTaxBasis !== 'TAX_EXCL') throw new Error('Analytical order contract requires TAX_EXCL auxiliary basis');
  if (policies.monetary.priceAuthority !== 'ORDER_DETAIL_PERSISTED') throw new Error('Analytical order contract requires order_detail price authority');
  if (policies.monetary.allocationMethod !== 'LARGEST_REMAINDER') throw new Error('Analytical order contract requires largest remainder allocation');
}

function publicOrderForChecksum(order: AnalyticalOrder): Record<string, unknown> {
  return {
    orderId: order.orderId,
    prestashopCustomerId: order.prestashopCustomerId,
    orderDate: order.orderDate,
    salesChannel: order.salesChannel,
    identity: order.identity,
    inclusionStatus: order.inclusionStatus,
    exclusionReasons: order.exclusionReasons,
    netEligibleProductValueTaxIncl: order.netEligibleProductValueTaxIncl,
    policyVersions: order.policyVersions,
  };
}

function maxZero(value: string): string {
  return compareMoney(value, '0.000000') < 0 ? '0.000000' : value;
}

function toNumberSet(values: readonly number[]): ReadonlySet<number> {
  const normalized = values.map(Number).filter((value) => Number.isSafeInteger(value) && value >= 0);
  return new Set([...new Set(normalized)].sort((left, right) => left - right));
}

function toModuleSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map((value) => normalizeModule(value)).filter((value): value is string => value !== null).sort());
}

function normalizeModule(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function moduleMatches(module: string | null, modules: ReadonlySet<string>): boolean {
  const normalized = normalizeModule(module);
  return normalized !== null && modules.has(normalized);
}

function normalizeDate(value: string): string {
  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
}

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
}

function toScaled(value: string): bigint {
  const trimmed = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error(`Invalid money decimal: ${value}`);
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const unsigned = trimmed.replace(/^-/, '');
  const [whole, fractional = ''] = unsigned.split('.');
  const raw = BigInt(`${whole}${fractional}`);
  if (fractional.length === SCALE) return sign * raw;
  if (fractional.length < SCALE) return sign * raw * 10n ** BigInt(SCALE - fractional.length);
  const divisor = 10n ** BigInt(fractional.length - SCALE);
  const quotient = raw / divisor;
  const remainder = raw % divisor;
  return sign * (remainder * 2n >= divisor ? quotient + 1n : quotient);
}

function fromScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(SCALE + 1, '0');
  return `${sign}${raw.slice(0, -SCALE)}.${raw.slice(-SCALE)}`;
}

function absScaled(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function bString(value: string): string {
  return value;
}

function assertNoPii(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPii(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenKey(key)) throw new Error(`Analytical order report contains forbidden field: ${path}.${key}`);
      assertNoPii(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenString(value)) {
    throw new Error(`Analytical order report contains PII-shaped value at ${path}`);
  }
}

function isForbiddenKey(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  return [
    'email',
    'phone',
    'telefono',
    'rut',
    'dni',
    'document',
    'firstname',
    'lastname',
    'address',
    'street',
    'card',
    'authorization',
    'paymentdata',
  ].some((forbidden) => normalized.includes(forbidden));
}

function isForbiddenString(value: string): boolean {
  const trimmed = value.trim();
  if (
    /^-?\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{8,64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}/.test(trimmed) ||
    /^[A-Z0-9_<>:-]+$/i.test(trimmed)
  ) {
    return false;
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed) || /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed);
}
