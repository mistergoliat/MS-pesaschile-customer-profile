import type { CarrierRecord } from '../../domain/customer-order-status/carrier-record.js';
import { buildCustomerDataProvenance } from '../../domain/customer-identity/index.js';
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
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import type { Clock, OrderStatesReader } from '../customer-profile/ports.js';
import type { CarriersReader, CustomerOrderStatusReader } from './ports.js';

export type GetCustomerOrderStatusDependencies = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly customerOrderStatusReader: CustomerOrderStatusReader;
  readonly orderStatesReader: OrderStatesReader;
  readonly carriersReader: CarriersReader;
  readonly clock: Clock;
  readonly orderStateLanguageId: number;
  readonly carrierLanguageId: number;
  readonly carrierShopId: number;
};

export type GetCustomerOrderStatus = (input: GetCustomerOrderStatusInput) => Promise<GetCustomerOrderStatusResult>;

export function createGetCustomerOrderStatus(deps: GetCustomerOrderStatusDependencies): GetCustomerOrderStatus {
  return async function getCustomerOrderStatus(input) {
    const identityResult = await deps.resolveCustomerIdentity(input.customerId);
    if (identityResult.status !== 'found') {
      return { status: 'customer_not_found', customerId: input.customerId };
    }

    const customerId = identityResult.identity.customerId;

    let orderRecord: CustomerOrderStatusRecord | null;
    try {
      orderRecord = await deps.customerOrderStatusReader.findByCustomerAndReference(customerId, input.orderReference);
    } catch (error) {
      return degradedOrThrow(customerId, error);
    }

    if (!orderRecord) {
      return { status: 'order_not_found', customerId };
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
      return degradedOrThrow(customerId, error);
    }

    let carrier: CarrierRecord | null;
    try {
      carrier = await deps.carriersReader.findById(orderRecord.carrierId, deps.carrierLanguageId, deps.carrierShopId);
    } catch (error) {
      return degradedOrThrow(customerId, error);
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

    return {
      status: 'available',
      customerId,
      order,
      warnings,
      provenance: buildCustomerDataProvenance(
        identityResult.identity,
        [
          { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
          { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'order_status' },
        ],
        deps.clock.now().toISOString(),
      ),
    };
  };
}

function degradedOrThrow(customerId: number, error: unknown): GetCustomerOrderStatusResult {
  if (error instanceof PrestashopTimeoutError || error instanceof PrestashopUnavailableError) {
    return { status: 'degraded', customerId, reason: 'prestashop_unavailable' };
  }
  if (error instanceof PrestashopSchemaIncompatibleError) {
    return { status: 'degraded', customerId, reason: 'prestashop_schema_incompatible' };
  }
  throw error;
}
