import {
  CUSTOMER_INTELLIGENCE_COPILOT_XLSX_EXPORT_VERSION,
} from '../../domain/customer-intelligence-copilot/index.js';
import type { AnalyticalQueryResult, AnalyticalResultCell } from '../../domain/customer-intelligence-query/index.js';
import type { CopilotSession, CopilotSessionQueryResult } from './contracts.js';

export type BuildCopilotXlsxExportInput = {
  readonly session: CopilotSession;
  readonly source: CopilotSessionQueryResult;
  readonly result: AnalyticalQueryResult;
  readonly exportedAt: string;
};

export async function buildCopilotXlsxExport(input: BuildCopilotXlsxExportInput): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MS-pesaschile-customer-profile';
  workbook.created = new Date(input.exportedAt);

  const resultSheet = workbook.addWorksheet('Result');
  resultSheet.columns = input.result.columns.map((column) => ({ header: column.name, key: column.name, width: Math.max(16, column.name.length + 2) }));
  for (const row of input.result.rows) {
    resultSheet.addRow(Object.fromEntries(input.result.columns.map((column) => [column.name, cellForWorkbook(row[column.name] ?? null)])));
  }

  const metadataSheet = workbook.addWorksheet('Metadata');
  metadataSheet.columns = [
    { header: 'key', key: 'key', width: 38 },
    { header: 'value', key: 'value', width: 72 },
  ];
  const context = input.result.context;
  const metadata: readonly [string, string | number | boolean | null][] = [
    ['exportVersion', CUSTOMER_INTELLIGENCE_COPILOT_XLSX_EXPORT_VERSION],
    ['exportedAt', input.exportedAt],
    ['sessionId', input.session.sessionId],
    ['queryId', input.source.queryId],
    ['queryPlanHash', input.source.result.queryPlanHash],
    ['readModelVersion', context.contractVersion],
    ['featureSnapshotId', context.featureSnapshot.snapshotId],
    ['featureReferenceTime', context.featureSnapshot.referenceTime],
    ['featureVersion', context.featureSnapshot.featureVersion],
    ['populationPolicyVersion', context.featureSnapshot.populationPolicyVersion],
    ['rfmSnapshotId', context.rfmSnapshot?.snapshotId ?? null],
    ['rfmReferenceTime', context.rfmSnapshot?.referenceTime ?? null],
    ['rfmCalculationVersion', context.rfmSnapshot?.calculationVersion ?? null],
    ['clusterSnapshotId', context.clusterSnapshot?.snapshotId ?? null],
    ['clusterReferenceTime', context.clusterSnapshot?.referenceTime ?? null],
    ['clusterModelVersion', context.clusterSnapshot?.modelVersion ?? null],
    ['rowCount', input.result.rowCount],
    ['exportComplete', !input.result.execution.truncated],
    ['truncated', input.result.execution.truncated],
  ];
  for (const [key, value] of metadata) metadataSheet.addRow({ key, value });

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

export function createCopilotExportFilename(exportedAt: string): string {
  const safeTimestamp = exportedAt.replace(/[:.]/g, '').replace(/[^0-9TZ-]/g, '');
  return `customer-intelligence-${safeTimestamp}.xlsx`;
}

function cellForWorkbook(value: AnalyticalResultCell): string | number | boolean | null {
  if (value === null) return null;
  return value;
}
