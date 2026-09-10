import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAudienceExportProjection,
  createAudienceExport,
  buildAudienceExportArtifact,
  writeGenericCsv,
} from '../../src/application/customer-intelligence-audience/index.js';
import type {
  AudienceEvaluationLineageV1,
  AudienceMembershipResultV1,
} from '../../src/domain/customer-intelligence-audience/index.js';

const lineage: AudienceEvaluationLineageV1 = {
  lineageVersion: 'customer-intelligence-audience-evaluation-lineage-v1',
  evaluatorVersion: 'customer-intelligence-audience-evaluation-v1',
  reproducibilityLevel: 'ACTIVE_SNAPSHOT_CONSISTENT',
  definitionChecksum: 'definition-checksum',
  contextVersion: 'customer-intelligence-audience-context-v1',
  referenceTime: '2026-09-01T00:00:00.000Z',
  population: {
    universeId: 'customer-analytics-population-b-v1',
    identityAuthority: 'prestashop_customer',
    policyVersion: 'population-v1',
    populationSize: 3,
    populationChecksum: 'population-checksum',
  },
  resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
  relevantSnapshotLineage: {
    feature: {
      snapshotId: 'feature-1',
      referenceTime: '2026-09-01T00:00:00.000Z',
      featureVersion: 'features-v1',
      populationPolicyVersion: 'population-v1',
      featureDatasetChecksum: 'feature-checksum',
    },
  },
  evaluatedAt: '2026-09-10T12:00:00.000Z',
};

function membership(ids: readonly number[] = [1, 2, 3]): AudienceMembershipResultV1 {
  return {
    status: 'completed',
    membershipVersion: 'customer-intelligence-audience-membership-v1',
    definition: {
      definitionVersion: 'customer-intelligence-audience-definition-v1',
      root: { kind: 'SCALAR', field: 'commercial.validOrders', operator: 'GTE', value: 1 },
    },
    definitionChecksum: 'definition-checksum',
    evaluationContext: {
      contextVersion: 'customer-intelligence-audience-context-v1',
      referenceTime: lineage.referenceTime,
      population: lineage.population,
      lineage: { feature: lineage.relevantSnapshotLineage.feature, rfm: null, cluster: null, clv: null, commercialAffinity: null },
      resolutionPolicyVersion: lineage.resolutionPolicyVersion,
    },
    lineage: { ...lineage, population: { ...lineage.population, populationSize: ids.length } },
    evaluatedAt: lineage.evaluatedAt,
    counts: { population: ids.length, matched: ids.length, notMatched: 0, unknown: 0 },
    members: ids.map((customerId) => ({ customerId })),
    evaluationChecksum: 'evaluation-checksum',
    membershipChecksum: 'membership-checksum',
    completeness: 'COMPLETE',
    warnings: [],
  };
}

describe('A04.3 generic audience export', () => {
  it('projects exactly one deterministic row per authoritative member and canonical field order', () => {
    const result = buildAudienceExportProjection({
      membership: membership([9, 2, 5]),
      selectedFields: ['lastname', 'customerId', 'email'],
      contacts: [
        { customerId: 9, email: ' NINE@EXAMPLE.COM ', firstname: 'Nine', lastname: 'Z' },
        { customerId: 2, email: null, firstname: null, lastname: 'B' },
      ],
    });

    expect(result.selectedFields).toEqual(['customerId', 'email', 'lastname']);
    expect(result.rows).toEqual([
      { customerId: 2, email: null, lastname: 'B' },
      { customerId: 5, email: null, lastname: null },
      { customerId: 9, email: 'nine@example.com', lastname: 'Z' },
    ]);
    expect(result.rows).toHaveLength(3);
    expect(result.missingContactCount).toBe(1);
  });

  it('rejects an unexpected customer returned by bulk hydration', () => {
    expect(() => buildAudienceExportProjection({
      membership: membership([1, 2]),
      contacts: [{ customerId: 99, email: null, firstname: null, lastname: null }],
    })).toThrow(/bulk contact hydration/i);
  });

  it('rejects duplicate customer rows returned by bulk hydration', () => {
    expect(() => buildAudienceExportProjection({
      membership: membership([1, 2]),
      contacts: [
        { customerId: 1, email: null, firstname: null, lastname: null },
        { customerId: 1, email: null, firstname: null, lastname: null },
      ],
    })).toThrow(/bulk contact hydration/i);
  });

  it('rejects unsupported fields and a selection without the required customerId', () => {
    expect(() => buildAudienceExportProjection({ membership: membership([1]), contacts: [], selectedFields: ['phone'] })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_FIELD' }),
    );
    expect(() => buildAudienceExportProjection({ membership: membership([1]), contacts: [], selectedFields: ['email'] })).toThrowError(
      expect.objectContaining({ code: 'REQUIRED_FIELD_MISSING' }),
    );
  });

  it('writes hardened deterministic CSV with CRLF, final newline, null blanks, UTF-8, and formula protection', () => {
    const input = {
      selectedFields: ['customerId', 'email', 'firstname', 'lastname'] as const,
      rows: [
        { customerId: 1, email: 'a,b@example.com', firstname: '="cmd', lastname: 'Pérez' },
        { customerId: 2, email: 'normal@example.com', firstname: '+cmd', lastname: 'line\r\nquote"' },
      ],
      maxBytes: 10000,
    };
    const first = writeGenericCsv(input);
    const second = writeGenericCsv(input);
    expect(first.equals(second)).toBe(true);
    expect(first.toString('utf8')).toBe(
      'customerId,email,firstname,lastname\r\n'
      + '1,"a,b@example.com","\'=""cmd",Pérez\r\n'
      + "2,normal@example.com,'+cmd,\"line\r\nquote\"\"\"\r\n",
    );
  });

  it('does not formula-escape customerId and fails before truncating on the byte limit', () => {
    const csv = writeGenericCsv({ rows: [{ customerId: -1 }], selectedFields: ['customerId'], maxBytes: 100 });
    expect(csv.toString('utf8')).toBe('customerId\r\n-1\r\n');
    expect(() => writeGenericCsv({ rows: [{ customerId: 1, firstname: 'x'.repeat(100) }], selectedFields: ['customerId', 'firstname'], maxBytes: 10 })).toThrowError(
      expect.objectContaining({ code: 'EXPORT_SIZE_LIMIT_EXCEEDED' }),
    );
  });

  it('creates a zero-member CSV without hydrating and preserves checksum lineage', async () => {
    const readByCustomerIds = vi.fn(async () => []);
    const result = await createAudienceExport({ contactReader: { readByCustomerIds }, clock: () => '2026-09-10T12:00:00.000Z' })({
      membership: membership([]),
      fields: ['customerId', 'email'],
      format: 'CSV',
    });
    expect(readByCustomerIds).not.toHaveBeenCalled();
    expect(result.rowCount).toBe(0);
    expect(result.artifact.toString('utf8')).toBe('customerId,email\r\n');
    expect(result.artifact.toString('utf8')).not.toContain('EXT_ID');
    expect('destination' in result).toBe(false);
    expect(result.membershipChecksum).toBe('membership-checksum');
    expect(result.evaluationChecksum).toBe('evaluation-checksum');
    expect(result.lineage).toBeDefined();
  });

  it('rejects Brevo flow and global hydration failures before producing an artifact', async () => {
    const readByCustomerIds = vi.fn(async () => { throw new Error('down'); });
    await expect(createAudienceExport({ contactReader: { readByCustomerIds } })({ membership: membership([1]), format: 'BREVO_CONTACT_IMPORT_CSV' as never })).rejects.toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }),
    );
    await expect(createAudienceExport({ contactReader: { readByCustomerIds } })({ membership: membership([1]), format: 'CSV' })).rejects.toThrowError(
      expect.objectContaining({ code: 'CONTACT_HYDRATION_FAILED' }),
    );
  });

  it('creates an XLSX with Audience and Metadata sheets, safe text, counts, checksums, and lineage', async () => {
    const result = await buildAudienceExportArtifact({
      membership: membership([2, 1]),
      contacts: [
        { customerId: 1, email: '=cmd', firstname: null, lastname: 'A' },
        { customerId: 2, email: null, firstname: 'B', lastname: null },
      ],
      fields: ['lastname', 'customerId', 'email'],
      format: 'XLSX',
      generatedAt: '2026-09-10T12:00:00.000Z',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.artifact as any);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Audience', 'Metadata']);
    const audience = workbook.getWorksheet('Audience')!;
    expect(audience.getRow(1).values).toEqual([, 'customerId', 'email', 'lastname']);
    expect(audience.getRow(2).values).toEqual([, 1, '=cmd', 'A']);
    expect(audience.getRow(3).values).toEqual([, 2]);
    expect(audience.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

    const metadata = workbook.getWorksheet('Metadata')!;
    const values = new Map<string, unknown>();
    metadata.eachRow((row, rowNumber) => {
      if (rowNumber > 1) values.set(String(row.getCell(1).value), row.getCell(2).value);
    });
    expect(values.get('membershipChecksum')).toBe('membership-checksum');
    expect(values.get('evaluationChecksum')).toBe('evaluation-checksum');
    expect(values.get('population')).toBe(2);
    expect(values.get('matched')).toBe(2);
    expect(values.get('featureSnapshotId')).toBe('feature-1');
    expect([...values.keys()]).not.toContain('memberIds');
    expect(JSON.stringify([...values.values()])).not.toContain('=cmd');
  });

  it('enforces XLSX final buffer size', async () => {
    await expect(buildAudienceExportArtifact({
      membership: membership([1]),
      contacts: [{ customerId: 1, email: 'a@example.com', firstname: null, lastname: null }],
      format: 'XLSX',
      limits: { maxOutputBytes: 10 },
    })).rejects.toThrowError(expect.objectContaining({ code: 'EXPORT_SIZE_LIMIT_EXCEEDED' }));
  });
});
