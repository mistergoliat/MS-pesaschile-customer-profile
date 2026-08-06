import { describe, expect, it, vi } from 'vitest';
import { createResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CustomerIdentityRepository } from '../../src/application/customer-identity/ports.js';

function repositoryReturning(found: boolean): CustomerIdentityRepository {
  return {
    findByCustomerId: vi.fn(async (customerId) =>
      found
        ? {
            customerId,
            externalCustomerId: customerId,
            identitySource: 'PRESTASHOP' as const,
            identityStatus: 'DIRECT_SOURCE' as const,
            sourceMetadata: {
              platform: 'PRESTASHOP' as const,
              entity: 'ps_customer' as const,
              primaryKey: 'id_customer' as const,
            },
          }
        : null,
    ),
  };
}

describe('resolveCustomerIdentity', () => {
  it('returns found for a valid existing customerId (number input)', async () => {
    const repository = repositoryReturning(true);
    const resolveCustomerIdentity = createResolveCustomerIdentity({
      customerIdentityRepository: repository,
    });

    const result = await resolveCustomerIdentity(22066);

    expect(result).toEqual({
      status: 'found',
      identity: {
        customerId: 22066,
        externalCustomerId: 22066,
        identitySource: 'PRESTASHOP',
        identityStatus: 'DIRECT_SOURCE',
        sourceMetadata: {
          platform: 'PRESTASHOP',
          entity: 'ps_customer',
          primaryKey: 'id_customer',
        },
      },
    });
    expect(repository.findByCustomerId).toHaveBeenCalledWith(22066);
  });

  it('returns found for a valid existing customerId (numeric string input, as received from HTTP route params)', async () => {
    const repository = repositoryReturning(true);
    const resolveCustomerIdentity = createResolveCustomerIdentity({
      customerIdentityRepository: repository,
    });

    const result = await resolveCustomerIdentity('22066');

    expect(result).toEqual({
      status: 'found',
      identity: expect.objectContaining({ customerId: 22066, externalCustomerId: 22066 }),
    });
    // The repository always receives a parsed number, never the raw string.
    expect(repository.findByCustomerId).toHaveBeenCalledWith(22066);
  });

  it('returns not_found for a valid but missing customerId', async () => {
    const repository = repositoryReturning(false);
    const resolveCustomerIdentity = createResolveCustomerIdentity({
      customerIdentityRepository: repository,
    });

    const result = await resolveCustomerIdentity(999);

    expect(result).toEqual({ status: 'not_found' });
    expect(repository.findByCustomerId).toHaveBeenCalledWith(999);
  });

  it.each([
    ['zero', 0],
    ['negative integer', -1],
    ['decimal', 1.5],
    ['non-numeric string', 'abc'],
    ['decimal string', '1.5'],
    ['exponent notation string', '1e10'],
    ['exponent notation number', 1e21],
    ['leading plus sign', '+5'],
    ['leading minus sign string', '-5'],
    ['whitespace-padded numeric string', ' 5 '],
    ['empty string', ''],
    ['hex-looking string', '0x5'],
    ['overflow beyond MAX_SAFE_INTEGER', '9007199254740993'],
    ['huge 20-digit numeric string', '99999999999999999999'],
    ['Infinity', Infinity],
    ['NaN', NaN],
    ['boolean true', true],
    ['null', null],
    ['undefined', undefined],
    ['array', [22066]],
    ['plain object', { customerId: 22066 }],
    // A masterCustomerId is never a valid input shape here on its own (only a positive
    // safe-integer numeric value/string is), but this also documents that even a
    // masterCustomerId that happens to be numeric is treated as an opaque customerId
    // candidate, never specially recognized or routed differently.
    ['bigint (not accepted, not coerced)', 22066n],
  ])('returns invalid_id without hitting the repository for %s', async (_label, input) => {
    const repository = repositoryReturning(true);
    const resolveCustomerIdentity = createResolveCustomerIdentity({
      customerIdentityRepository: repository,
    });

    await expect(resolveCustomerIdentity(input)).resolves.toEqual({ status: 'invalid_id' });
    expect(repository.findByCustomerId).not.toHaveBeenCalled();
  });

  it('accepts the largest safe positive integer and the smallest positive integer', async () => {
    const repository = repositoryReturning(true);
    const resolveCustomerIdentity = createResolveCustomerIdentity({
      customerIdentityRepository: repository,
    });

    await expect(resolveCustomerIdentity(Number.MAX_SAFE_INTEGER)).resolves.toMatchObject({ status: 'found' });
    await expect(resolveCustomerIdentity(1)).resolves.toMatchObject({ status: 'found' });
    expect(repository.findByCustomerId).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    expect(repository.findByCustomerId).toHaveBeenCalledWith(1);
  });

  // No identity/PII resolution path exists at all: the port is `findByCustomerId(number)`
  // only (see application/customer-identity/ports.ts) - there is no email/phone/rut/name
  // parameter to fall back to, and no masterCustomerId parameter either. The real SQL
  // (parametrized, id_customer only, no PII columns selected) is covered by
  // mysql-prestashop-customer-identity-repository.test.ts.
});
