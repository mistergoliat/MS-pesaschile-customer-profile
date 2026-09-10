import type { AudienceExportFieldIdV1, AudienceExportRowV1 } from '../../domain/customer-intelligence-audience/index.js';
import { AudienceExportSizeLimitError } from './csv-writer.js';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;

export type AudienceXlsxMetadataEntry = readonly [string, string | number | boolean | null];

export async function writeGenericXlsx(input: {
  readonly rows: readonly AudienceExportRowV1[];
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly metadata: readonly AudienceXlsxMetadataEntry[];
  readonly maxBytes: number;
  readonly generatedAt: string;
}): Promise<Buffer> {
  const exceljsModule = await import('exceljs');
  const ExcelJS = exceljsModule.default ?? exceljsModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MS-pesaschile-customer-profile';
  workbook.created = new Date(input.generatedAt);

  const audience = workbook.addWorksheet('Audience');
  audience.columns = input.selectedFields.map((field) => ({
    header: field,
    key: field,
    width: Math.max(14, field.length + 2),
  }));
  audience.views = [{ state: 'frozen', ySplit: 1 }];
  audience.autoFilter = { from: 'A1', to: `${columnName(input.selectedFields.length)}1` };
  for (const row of input.rows) {
    const outputRow = audience.addRow(input.selectedFields.map((field) => workbookCellValue(row, field)));
    for (let index = 0; index < input.selectedFields.length; index += 1) {
      const field = input.selectedFields[index];
      if (field !== undefined && field !== 'customerId') {
        const cell = outputRow.getCell(index + 1);
        const value = row[field];
        if (typeof value === 'string') cell.value = value;
      }
    }
  }

  const metadata = workbook.addWorksheet('Metadata');
  metadata.columns = [
    { header: 'key', key: 'key', width: 38 },
    { header: 'value', key: 'value', width: 96 },
  ];
  for (const [key, value] of input.metadata) metadata.addRow({ key, value: metadataCellValue(value) });

  const bytes = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.byteLength > input.maxBytes) throw new AudienceExportSizeLimitError(input.maxBytes, buffer.byteLength);
  return buffer;
}

function workbookCellValue(row: AudienceExportRowV1, field: AudienceExportFieldIdV1): string | number | null {
  if (field === 'customerId') return row.customerId;
  return row[field] ?? null;
}

function metadataCellValue(value: string | number | boolean | null): string | number | boolean | null {
  return value;
}

function columnName(columnNumber: number): string {
  let remaining = columnNumber;
  let result = '';
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result;
}
