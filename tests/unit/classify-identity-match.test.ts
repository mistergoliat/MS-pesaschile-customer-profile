import { describe, expect, it } from 'vitest';
import { classifyIdentityMatch } from '../../src/domain/master-customer-population/index.js';

describe('classifyIdentityMatch (master-customer-population, offline only)', () => {
  it('resolves when an explicit PrestaShop link exists, even alongside email candidates', () => {
    const result = classifyIdentityMatch({
      explicitPrestashopCustomerId: 42,
      hasUsableEmail: true,
      emailCandidates: [{ prestashopCustomerId: 99 }, { prestashopCustomerId: 100 }],
    });

    expect(result).toEqual({
      status: 'resolved',
      reason: 'explicit_prestashop_link',
      resolvedPrestashopCustomerId: 42,
      candidatePrestashopCustomerId: null,
    });
  });

  it('is unlinked when the email is missing or unusable', () => {
    const result = classifyIdentityMatch({
      explicitPrestashopCustomerId: null,
      hasUsableEmail: false,
      emailCandidates: [],
    });

    expect(result).toEqual({
      status: 'unlinked',
      reason: 'missing_or_unusable_email',
      resolvedPrestashopCustomerId: null,
      candidatePrestashopCustomerId: null,
    });
  });

  it('is unlinked when a usable email matches no ps_customer', () => {
    const result = classifyIdentityMatch({
      explicitPrestashopCustomerId: null,
      hasUsableEmail: true,
      emailCandidates: [],
    });

    expect(result).toEqual({
      status: 'unlinked',
      reason: 'no_exact_email_match',
      resolvedPrestashopCustomerId: null,
      candidatePrestashopCustomerId: null,
    });
  });

  it('is provisional with a candidate id (not resolved) on exactly one email match', () => {
    const result = classifyIdentityMatch({
      explicitPrestashopCustomerId: null,
      hasUsableEmail: true,
      emailCandidates: [{ prestashopCustomerId: 7 }],
    });

    expect(result).toEqual({
      status: 'provisional',
      reason: 'single_exact_email_match_safe_for_backfill',
      resolvedPrestashopCustomerId: null,
      candidatePrestashopCustomerId: 7,
    });
  });

  it('is conflicted on multiple email matches, e.g. the cross-shop duplicate emails from CP-R1-T01', () => {
    const result = classifyIdentityMatch({
      explicitPrestashopCustomerId: null,
      hasUsableEmail: true,
      emailCandidates: [{ prestashopCustomerId: 1 }, { prestashopCustomerId: 2 }],
    });

    expect(result).toEqual({
      status: 'conflicted',
      reason: 'multiple_exact_email_matches',
      resolvedPrestashopCustomerId: null,
      candidatePrestashopCustomerId: null,
    });
  });
});
