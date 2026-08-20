import { describe, expect, it } from 'vitest';
import { assertNoPiiInAnalyticsValue } from '../../src/domain/customer-analytics/pii-guard.js';

describe('assertNoPiiInAnalyticsValue (task Section 32)', () => {
  it('accepts a realistic manifest shape (ISO timestamps, checksum hex, dunder version keys, prestashopCustomerId)', () => {
    const manifest = {
      featureVersion: 'customer-analytics-features-v1',
      populationPolicyVersion: 'customer-analytics-population-b-v1',
      referenceTime: '2026-08-19T17:58:22.535Z',
      sourceDatasetChecksum: 'f8f786ecd0aa7dcab88826ce8c9e1a21da58761625084888b4fada13db481ef5',
      populationSize: 44935,
      prestashopCustomerId: 22066,
    };
    expect(() => assertNoPiiInAnalyticsValue(manifest)).not.toThrow();
  });

  it('rejects a PII-shaped field name anywhere in the object graph', () => {
    expect(() => assertNoPiiInAnalyticsValue({ nested: { customerEmail: 'x' } })).toThrow(/PII-shaped field/);
  });

  it('rejects an email-shaped string value', () => {
    expect(() => assertNoPiiInAnalyticsValue({ note: 'contact joaquin@example.com' })).toThrow(/PII-shaped value/);
  });

  it('rejects a Chilean-RUT-shaped string value', () => {
    expect(() => assertNoPiiInAnalyticsValue({ value: '12.345.678-9' })).toThrow(/PII-shaped value/);
  });

  it('rejects a phone-number-shaped string value', () => {
    expect(() => assertNoPiiInAnalyticsValue({ value: '+56 9 1234 5678' })).toThrow(/PII-shaped value/);
  });

  it('rejects a firstname/lastname/address field even when not literally named that', () => {
    expect(() => assertNoPiiInAnalyticsValue({ shippingAddress: '123 Main St' })).toThrow(/PII-shaped field/);
  });

  it('allows prestashopCustomerId/customerId as the explicit technical identifiers', () => {
    expect(() => assertNoPiiInAnalyticsValue({ prestashopCustomerId: 22066, customerId: 1 })).not.toThrow();
  });

  it('allows decimal strings, sha256 hex, ISO timestamps, and dunder-joined version keys through the safe-structured-value allowlist', () => {
    expect(() =>
      assertNoPiiInAnalyticsValue({
        ratio: '0.123456',
        checksum: 'f8f786ecd0aa7dcab88826ce8c9e1a21da58761625084888b4fada13db481ef5',
        timestamp: '2026-08-19T00:00:00.000Z',
        snapshotKey: 'customer-analytics-features-v1__customer-analytics-population-b-v1__2026-08-19T00-00-00-000Z',
      }),
    ).not.toThrow();
  });

  it('walks arrays and nested arrays', () => {
    expect(() => assertNoPiiInAnalyticsValue([{ customerEmail: 'x@y.com' }])).toThrow(/PII-shaped/);
  });
});
