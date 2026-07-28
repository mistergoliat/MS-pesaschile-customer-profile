import {
  classifyCustomerProfileLookup,
  type CustomerOrderRecord,
  type CustomerOrderStateContext,
  type CustomerOrderSummary,
  type CustomerProfileDegradedReason,
  type CustomerProfileLookupResult,
  type CustomerProfileSnapshot,
  type GetCustomerProfileInput,
  type MasterCustomerRecord,
  type OrderStateRecord,
  type PrestashopCustomerRecord,
} from '../../domain/customer-profile/index.js';
import { CustomerProfileBuildError, PrestashopTimeoutError, PrestashopUnavailableError } from './errors.js';
import type {
  Clock,
  CustomerOrdersReader,
  MasterCustomerReader,
  OrderStatesReader,
  PrestashopCustomerReader,
} from './ports.js';

export type GetCustomerProfileDependencies = {
  readonly masterCustomerReader: MasterCustomerReader;
  readonly prestashopCustomerReader: PrestashopCustomerReader;
  readonly customerOrdersReader: CustomerOrdersReader;
  readonly orderStatesReader: OrderStatesReader;
  readonly clock: Clock;
  // Bounds how many recent orders the snapshot carries (CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT).
  readonly recentOrdersLimit: number;
  // Which ps_order_state_lang.id_lang to translate currentStateId against (PRESTASHOP_ORDER_STATE_LANG_ID).
  readonly orderStateLanguageId: number;
};

export type GetCustomerProfile = (input: GetCustomerProfileInput) => Promise<CustomerProfileLookupResult>;

// Algorithm (CP-R1-T03): master_customer is always read first. PrestaShop is only ever
// queried when master_customer exists AND has prestashop_customer_id set. Unclassified
// errors (CRM failures, unknown PrestaShop errors, non-build errors) propagate instead of
// being absorbed into a result — those are service errors (5xx), not lookup outcomes.
export function createGetCustomerProfile(deps: GetCustomerProfileDependencies): GetCustomerProfile {
  return async function getCustomerProfile(input) {
    const masterCustomer = await deps.masterCustomerReader.findById(input.masterCustomerId);

    if (!masterCustomer) {
      return classifyCustomerProfileLookup({
        masterCustomerId: input.masterCustomerId,
        masterCustomerExists: false,
        warnings: [],
      });
    }

    if (masterCustomer.prestashopCustomerId === null) {
      return classifyCustomerProfileLookup({
        masterCustomerId: input.masterCustomerId,
        masterCustomerExists: true,
        linkedPrestashopCustomerId: null,
        degradedReason: null,
        profile: null,
        warnings: [],
      });
    }

    const linkedPrestashopCustomerId = masterCustomer.prestashopCustomerId;
    let prestashopCustomer: PrestashopCustomerRecord | null = null;
    let degradedReason: CustomerProfileDegradedReason | null = null;

    try {
      prestashopCustomer = await deps.prestashopCustomerReader.findById(linkedPrestashopCustomerId);
    } catch (error) {
      if (error instanceof PrestashopTimeoutError) {
        degradedReason = 'prestashop_timeout';
      } else if (error instanceof PrestashopUnavailableError) {
        degradedReason = 'prestashop_unavailable';
      } else {
        throw error;
      }
    }

    if (degradedReason === null && !prestashopCustomer) {
      degradedReason = 'prestashop_customer_not_found';
    }

    // Orders are only ever queried once ps_customer is confirmed to exist — never when
    // master_customer is missing/unlinked, and never when ps_customer itself failed to
    // resolve. A timeout/unavailable failure here reuses the same PrestaShop degraded
    // reasons as the customer read: it is the same dependency, not a new failure cause.
    let recentOrders: readonly CustomerOrderRecord[] | null = null;

    if (degradedReason === null && prestashopCustomer) {
      try {
        recentOrders = await deps.customerOrdersReader.findByCustomerId(linkedPrestashopCustomerId, {
          limit: deps.recentOrdersLimit,
        });
      } catch (error) {
        if (error instanceof PrestashopTimeoutError) {
          degradedReason = 'prestashop_timeout';
        } else if (error instanceof PrestashopUnavailableError) {
          degradedReason = 'prestashop_unavailable';
        } else {
          throw error;
        }
      }
    }

    // Order states are only ever queried once recentOrders was read successfully, and
    // only when there is at least one order — an empty recentOrders never triggers a
    // catalog query. A timeout/unavailable failure here reuses the same PrestaShop
    // degraded reasons as the orders read: same dependency, not a new failure cause.
    let orderStates: readonly OrderStateRecord[] | null = null;

    if (degradedReason === null && prestashopCustomer && recentOrders) {
      const uniqueStateIds = Array.from(new Set(recentOrders.map((order) => order.currentStateId)));
      if (uniqueStateIds.length === 0) {
        orderStates = [];
      } else {
        try {
          orderStates = await deps.orderStatesReader.findByIds(uniqueStateIds, deps.orderStateLanguageId);
        } catch (error) {
          if (error instanceof PrestashopTimeoutError) {
            degradedReason = 'prestashop_timeout';
          } else if (error instanceof PrestashopUnavailableError) {
            degradedReason = 'prestashop_unavailable';
          } else {
            throw error;
          }
        }
      }
    }

    const warnings: string[] = [];
    let profile: CustomerProfileSnapshot | null = null;

    if (degradedReason === null && prestashopCustomer && recentOrders && orderStates) {
      try {
        profile = buildSnapshot(masterCustomer, prestashopCustomer, recentOrders, orderStates, deps.clock, warnings);
      } catch (error) {
        if (error instanceof CustomerProfileBuildError) {
          degradedReason = 'profile_build_failed';
        } else {
          throw error;
        }
      }
    }

    return classifyCustomerProfileLookup({
      masterCustomerId: input.masterCustomerId,
      masterCustomerExists: true,
      linkedPrestashopCustomerId,
      degradedReason,
      profile,
      warnings,
    });
  };
}

// master_customer is the canonical authority for name/email/rut; PrestaShop differences
// become warnings, never a reconciliation. See CP-R1-T03 section 13.
function buildSnapshot(
  master: MasterCustomerRecord,
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

  if (normalize(master.email) !== normalize(prestashop.email)) {
    warnings.push('prestashop_email_differs_from_master');
  }
  if (
    normalize(master.firstname) !== normalize(prestashop.firstname) ||
    normalize(master.lastname) !== normalize(prestashop.lastname)
  ) {
    warnings.push('prestashop_name_differs_from_master');
  }
  if (!prestashop.active) {
    warnings.push('prestashop_customer_inactive');
  }

  const orderStatesById = new Map(orderStates.map((state): [number, OrderStateRecord] => [state.stateId, state]));

  return {
    masterCustomerId: master.id,
    generatedAt,
    customer: {
      firstname: master.firstname,
      lastname: master.lastname,
      email: master.email,
      rut: master.rut,
      platformOrigin: master.platformOrigin,
    },
    prestashop: {
      customerId: prestashop.idCustomer,
      active: prestashop.active,
      shopId: prestashop.idShop,
      createdAt: prestashop.dateAdd,
      updatedAt: prestashop.dateUpd,
    },
    // Preserves the reader's own order (date_add DESC, id_order DESC) rather than
    // re-sorting: the SQL contract already guarantees deterministic, most-recent-first
    // ordering (see mysql-customer-orders-reader.ts), so re-sorting here would be
    // redundant work duplicating a guarantee that already exists one layer down.
    recentOrders: recentOrders.map((order) => toOrderSummary(order, resolveOrderState(order, orderStatesById, warnings))),
    warnings,
  };
}

// Every row in ps_orders is a paid order per the PesasChile business rule (see
// CustomerOrderSummary) — currentStateId/valid are carried through unchanged, never
// reinterpreted. customerId is dropped: it is redundant with prestashop.customerId.
function toOrderSummary(order: CustomerOrderRecord, currentState: CustomerOrderStateContext): CustomerOrderSummary {
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

// A stateId absent from the catalog result (missing translation, stale/removed state) is
// `unknown`, never a fabricated label ("Estado desconocido", "En proceso") and never a
// reason to degrade the whole profile — see CP-R1-T05 section 10. The warning is pushed
// at most once per snapshot regardless of how many orders are unresolved.
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

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
