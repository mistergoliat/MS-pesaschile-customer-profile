import { buildCustomerDataProvenance, type CustomerIdentity } from '../../domain/customer-identity/index.js';
import {
  classifyCustomerProfileLookup,
  type CustomerOrderRecord,
  type CustomerOrderStateContext,
  type CustomerProfileLookupResult,
  type CustomerProfileSnapshot,
  type GetCustomerProfileInput,
  type OrderStateRecord,
  type PrestashopCustomerRecord,
} from '../../domain/customer-profile/index.js';
import {
  CustomerProfileBuildError,
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from './errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import type { Clock, CustomerOrdersReader, OrderStatesReader, PrestashopCustomerReader } from './ports.js';

export type GetCustomerProfileDependencies = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly prestashopCustomerReader: PrestashopCustomerReader;
  readonly customerOrdersReader: CustomerOrdersReader;
  readonly orderStatesReader: OrderStatesReader;
  readonly clock: Clock;
  readonly recentOrdersLimit: number;
  readonly orderStateLanguageId: number;
};

export type GetCustomerProfile = (input: GetCustomerProfileInput) => Promise<CustomerProfileLookupResult>;

export function createGetCustomerProfile(deps: GetCustomerProfileDependencies): GetCustomerProfile {
  return async function getCustomerProfile(input) {
    const identityResult = await deps.resolveCustomerIdentity(input.customerId);
    if (identityResult.status !== 'found') {
      return classifyCustomerProfileLookup({
        customerId: input.customerId,
        customerExists: false,
        warnings: [],
      });
    }

    const identity = identityResult.identity;
    let prestashopCustomer: PrestashopCustomerRecord | null;
    try {
      prestashopCustomer = await deps.prestashopCustomerReader.findById(identity.customerId);
    } catch (error) {
      return degradedOrThrow(identity.customerId, error);
    }

    if (!prestashopCustomer) {
      return classifyCustomerProfileLookup({
        customerId: identity.customerId,
        customerExists: true,
        degradedReason: 'customer_profile_unavailable',
        profile: null,
        provenance: null,
        warnings: [],
      });
    }

    let recentOrders: readonly CustomerOrderRecord[];
    try {
      recentOrders = await deps.customerOrdersReader.findByCustomerId(identity.customerId, {
        limit: deps.recentOrdersLimit,
      });
    } catch (error) {
      return degradedOrThrow(identity.customerId, error);
    }

    let orderStates: readonly OrderStateRecord[];
    if (recentOrders.length === 0) {
      orderStates = [];
    } else {
      const uniqueStateIds = Array.from(new Set(recentOrders.map((order) => order.currentStateId)));
      try {
        orderStates = await deps.orderStatesReader.findByIds(uniqueStateIds, deps.orderStateLanguageId);
      } catch (error) {
        return degradedOrThrow(identity.customerId, error);
      }
    }

    const warnings: string[] = [];
    let profile: CustomerProfileSnapshot;
    try {
      profile = buildSnapshot(identity, prestashopCustomer, recentOrders, orderStates, deps.clock, warnings);
    } catch (error) {
      if (error instanceof CustomerProfileBuildError) {
        return classifyCustomerProfileLookup({
          customerId: identity.customerId,
          customerExists: true,
          degradedReason: 'customer_profile_unavailable',
          profile: null,
          provenance: null,
          warnings,
        });
      }
      throw error;
    }

    const provenance = buildCustomerDataProvenance(
      identity,
      [
        { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
        { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_profile' },
        { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'recent_orders' },
      ],
      profile.generatedAt,
    );

    return classifyCustomerProfileLookup({
      customerId: identity.customerId,
      customerExists: true,
      degradedReason: null,
      profile,
      provenance,
      warnings,
    });
  };
}

function buildSnapshot(
  identity: CustomerIdentity,
  prestashop: PrestashopCustomerRecord,
  recentOrders: readonly CustomerOrderRecord[],
  orderStates: readonly OrderStateRecord[],
  clock: Clock,
  warnings: string[],
): CustomerProfileSnapshot {
  let generatedAt: string;
  try {
    generatedAt = clock.now().toISOString();
  } catch (error) {
    throw new CustomerProfileBuildError('failed to build customer profile snapshot', { cause: error });
  }

  if (!prestashop.active) {
    warnings.push('prestashop_customer_inactive');
  }

  const orderStatesById = new Map(orderStates.map((state): [number, OrderStateRecord] => [state.stateId, state]));

  return {
    customerId: identity.customerId,
    generatedAt,
    customer: {
      firstname: prestashop.firstname,
      lastname: prestashop.lastname,
      email: prestashop.email,
      rut: null,
      platformOrigin: 'prestashop',
    },
    prestashop: {
      customerId: prestashop.idCustomer,
      active: prestashop.active,
      shopId: prestashop.idShop,
      createdAt: prestashop.dateAdd,
      updatedAt: prestashop.dateUpd,
    },
    recentOrders: recentOrders.map((order) => toOrderSummary(order, resolveOrderState(order, orderStatesById, warnings))),
    warnings,
  };
}

function toOrderSummary(order: CustomerOrderRecord, currentState: CustomerOrderStateContext) {
  return {
    orderId: order.orderId,
    reference: order.reference,
    currentStateId: order.currentStateId,
    currentState,
    valid: order.valid,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    totalPaidTaxIncl: order.totalPaidTaxIncl,
    totalProductsTaxIncl: order.totalProductsTaxIncl,
    currencyId: order.currencyId,
  };
}

function resolveOrderState(
  order: CustomerOrderRecord,
  orderStatesById: ReadonlyMap<number, OrderStateRecord>,
  warnings: string[],
): CustomerOrderStateContext {
  const state = orderStatesById.get(order.currentStateId);
  if (state) {
    return { stateId: order.currentStateId, name: state.name, resolution: 'resolved' };
  }
  if (!warnings.includes('order_state_label_missing')) {
    warnings.push('order_state_label_missing');
  }
  return { stateId: order.currentStateId, name: null, resolution: 'unknown' };
}

function degradedOrThrow(customerId: number, error: unknown): CustomerProfileLookupResult {
  if (error instanceof PrestashopTimeoutError || error instanceof PrestashopUnavailableError) {
    return {
      status: 'degraded',
      customerId,
      reason: 'prestashop_unavailable',
      profile: null,
      warnings: [],
    };
  }
  if (error instanceof PrestashopSchemaIncompatibleError) {
    return {
      status: 'degraded',
      customerId,
      reason: 'prestashop_schema_incompatible',
      profile: null,
      warnings: [],
    };
  }
  throw error;
}
