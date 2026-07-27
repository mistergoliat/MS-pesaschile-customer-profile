import {
  classifyCustomerProfileLookup,
  type CustomerProfileDegradedReason,
  type CustomerProfileLookupResult,
  type CustomerProfileSnapshot,
  type GetCustomerProfileInput,
  type MasterCustomerRecord,
  type PrestashopCustomerRecord,
} from '../../domain/customer-profile/index.js';
import { CustomerProfileBuildError, PrestashopTimeoutError, PrestashopUnavailableError } from './errors.js';
import type { Clock, MasterCustomerReader, PrestashopCustomerReader } from './ports.js';

export type GetCustomerProfileDependencies = {
  readonly masterCustomerReader: MasterCustomerReader;
  readonly prestashopCustomerReader: PrestashopCustomerReader;
  readonly clock: Clock;
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

    const warnings: string[] = [];
    let profile: CustomerProfileSnapshot | null = null;

    if (degradedReason === null && prestashopCustomer) {
      try {
        profile = buildSnapshot(masterCustomer, prestashopCustomer, deps.clock, warnings);
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
    warnings,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
