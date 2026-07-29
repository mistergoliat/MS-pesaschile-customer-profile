import type { CarrierRecord } from '../../domain/customer-order-status/carrier-record.js';
import {
  resolveDeliveryEstimate,
  resolveDeliveryMethod,
  type CustomerOrderStatus,
  type CustomerOrderStatusWarning,
  type DeliveryMethod,
  type GetCustomerOrderStatusInput,
  type GetCustomerOrderStatusResult,
} from '../../domain/customer-order-status/index.js';
import type { CustomerOrderStatusRecord } from '../../domain/customer-order-status/customer-order-status-record.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../customer-profile/errors.js';
import type { MasterCustomerReader, OrderStatesReader } from '../customer-profile/ports.js';
import type { CarriersReader, CustomerOrderStatusReader } from './ports.js';

export type GetCustomerOrderStatusDependencies = {
  readonly masterCustomerReader: MasterCustomerReader;
  readonly customerOrderStatusReader: CustomerOrderStatusReader;
  // Reused from CP-R1-T05: only ever called with a single-element array here.
  readonly orderStatesReader: OrderStatesReader;
  readonly carriersReader: CarriersReader;
  // Which ps_order_state_lang.id_lang to translate currentStateId against (PRESTASHOP_ORDER_STATE_LANG_ID).
  readonly orderStateLanguageId: number;
  // Which ps_carrier_lang.id_lang / id_shop to read carrier.delay from
  // (PRESTASHOP_CARRIER_LANG_ID / PRESTASHOP_CARRIER_SHOP_ID) — deliberately independent
  // config from orderStateLanguageId, see config.ts.
  readonly carrierLanguageId: number;
  readonly carrierShopId: number;
};

export type GetCustomerOrderStatus = (input: GetCustomerOrderStatusInput) => Promise<GetCustomerOrderStatusResult>;

// Algorithm (CP-R1-T06): master_customer is always read first; PrestaShop is only ever
// queried once master_customer exists AND is linked. The order lookup is scoped by
// (prestashopCustomerId, reference) in the same query — never reference alone — so an
// order that doesn't exist and one that belongs to another customer both come back as
// order_not_found, and neither is ever distinguishable from the response. Unclassified
// errors propagate instead of being absorbed into a result — those are service errors
// (5xx), not lookup outcomes. Deliberately does not read ps_order_history, ps_order_state
// flags or any keyword from currentStateName/carrier name/delay.
export function createGetCustomerOrderStatus(deps: GetCustomerOrderStatusDependencies): GetCustomerOrderStatus {
  return async function getCustomerOrderStatus(input) {
    const masterCustomer = await deps.masterCustomerReader.findById(input.masterCustomerId);

    if (!masterCustomer) {
      return { status: 'customer_not_found' };
    }
    if (masterCustomer.prestashopCustomerId === null) {
      return { status: 'customer_not_linked' };
    }

    const prestashopCustomerId = masterCustomer.prestashopCustomerId;

    let orderRecord: CustomerOrderStatusRecord | null;
    try {
      orderRecord = await deps.customerOrderStatusReader.findByCustomerAndReference(
        prestashopCustomerId,
        input.orderReference,
      );
    } catch (error) {
      return degradedOrThrow(error);
    }

    if (!orderRecord) {
      return { status: 'order_not_found' };
    }

    const warnings: CustomerOrderStatusWarning[] = [];

    let currentStateName: string | null = null;
    try {
      const states = await deps.orderStatesReader.findByIds([orderRecord.currentStateId], deps.orderStateLanguageId);
      const match = states.find((state) => state.stateId === orderRecord.currentStateId);
      if (match) {
        currentStateName = match.name;
      } else {
        warnings.push('order_state_label_missing');
      }
    } catch (error) {
      return degradedOrThrow(error);
    }

    let carrier: CarrierRecord | null;
    try {
      carrier = await deps.carriersReader.findById(orderRecord.carrierId, deps.carrierLanguageId, deps.carrierShopId);
    } catch (error) {
      return degradedOrThrow(error);
    }

    let deliveryMethod: DeliveryMethod;
    if (!carrier) {
      warnings.push('carrier_not_found', 'delivery_method_unknown');
      deliveryMethod = 'unknown';
    } else {
      deliveryMethod = resolveDeliveryMethod(orderRecord.carrierId);
      if (deliveryMethod === 'unknown') {
        warnings.push('delivery_method_unknown');
      }
    }

    const order: CustomerOrderStatus = {
      orderId: orderRecord.orderId,
      reference: orderRecord.reference,
      currentStateId: orderRecord.currentStateId,
      currentStateName,
      deliveryMethod,
      deliveryEstimate: resolveDeliveryEstimate(deliveryMethod),
      lastRecordedUpdateAt: orderRecord.updatedAt.toISOString(),
      source: 'prestashop_current_state',
      isRealTimeTracking: false,
    };

    return { status: 'available', order, warnings };
  };
}

// Same PrestaShop dependency, same two known failure causes as T03–T05 — no new
// degraded reason introduced here. Anything else propagates as a service error.
function degradedOrThrow(error: unknown): GetCustomerOrderStatusResult {
  if (error instanceof PrestashopTimeoutError) {
    return { status: 'degraded', reason: 'prestashop_timeout' };
  }
  if (error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', reason: 'prestashop_unavailable' };
  }
  throw error;
}
