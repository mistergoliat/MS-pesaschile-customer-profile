import type { AudienceExportFieldIdV1, AudienceExportRowV1 } from '../../domain/customer-intelligence-audience/index.js';

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8' as const;

export class AudienceExportSizeLimitError extends Error {
  readonly code = 'EXPORT_SIZE_LIMIT_EXCEEDED' as const;
  readonly maxBytes: number;
  readonly actualBytes: number;

  constructor(maxBytes: number, actualBytes: number) {
    super(`Audience export exceeds the configured ${maxBytes} byte limit`);
    this.name = 'AudienceExportSizeLimitError';
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

export function writeGenericCsv(input: {
  readonly rows: readonly AudienceExportRowV1[];
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly maxBytes: number;
}): Buffer {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const append = (record: string): void => {
    const chunk = Buffer.from(record, 'utf8');
    byteLength += chunk.byteLength;
    if (byteLength > input.maxBytes) throw new AudienceExportSizeLimitError(input.maxBytes, byteLength);
    chunks.push(chunk);
  };

  append(`${input.selectedFields.map((field) => csvEscape(field)).join(',')}\r\n`);
  for (const row of input.rows) {
    append(`${input.selectedFields.map((field) => csvEscape(csvCellValue(row, field), field)).join(',')}\r\n`);
  }
  return Buffer.concat(chunks, byteLength);
}

function csvCellValue(row: AudienceExportRowV1, field: AudienceExportFieldIdV1): string {
  if (field === 'customerId') return String(row.customerId);
  return row[field] ?? '';
}

function csvEscape(value: string, field?: AudienceExportFieldIdV1): string {
  const protectedValue = field !== undefined && isCustomerTextField(field) && startsWithFormulaCharacter(value)
    ? `'${value}`
    : value;
  const quoted = /[",\r\n]/u.test(protectedValue);
  return quoted ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue;
}

function isCustomerTextField(field: AudienceExportFieldIdV1): boolean {
  return field === 'email' || field === 'firstname' || field === 'lastname';
}

function startsWithFormulaCharacter(value: string): boolean {
  return /^[=+\-@]/u.test(value);
}
