import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  classifyBaselineComparability,
  compareRfmSourceArtifacts,
  stableStringify,
  type RfmSourceArtifactRow,
} from '../../src/domain/customer-rfm/index.js';

const [, , baselineFile, candidateFile] = process.argv;

if (!baselineFile || !candidateFile) {
  throw new Error('Usage: npm run snapshot:rfm:compare-source -- <baseline file> <candidate file>');
}

const outputDir = path.resolve('scripts/snapshots/rfm/drift-outputs');
await mkdir(outputDir, { recursive: true });

const baseline = JSON.parse(await readFile(baselineFile, 'utf8')) as unknown;
const candidate = JSON.parse(await readFile(candidateFile, 'utf8')) as unknown;
const baselineComparability = classifyBaselineComparability(baseline);
const candidateComparability = classifyBaselineComparability(candidate);

if (baselineComparability !== 'ROW_ARTIFACT' || candidateComparability !== 'ROW_ARTIFACT') {
  const output = { baselineComparability, candidateComparability };
  await writeJson('dataset-comparison.json', output);
  console.info(stableStringify(output));
} else {
  const comparison = compareRfmSourceArtifacts(baseline as RfmSourceArtifactRow[], candidate as RfmSourceArtifactRow[]);
  const aggregate = {
    ...comparison,
    affectedPrestashopCustomerIds: comparison.affectedPrestashopCustomerIds.length,
  };
  await writeJson('dataset-comparison.json', aggregate);
  await writeJson('dataset-comparison-affected-technical-ids.json', {
    affectedPrestashopCustomerIds: comparison.affectedPrestashopCustomerIds,
  });
  console.info(stableStringify(aggregate));
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(path.join(outputDir, fileName), `${stableStringify(value)}\n`, 'utf8');
}
