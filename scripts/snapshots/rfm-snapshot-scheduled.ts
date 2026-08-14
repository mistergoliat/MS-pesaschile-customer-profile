import 'dotenv/config';
import { loadRfmSnapshotScheduledConfig } from '../../src/rfm-snapshot-config.js';
import { runRfmSnapshotCommand } from './lib/rfm-snapshot-command.js';

const config = loadRfmSnapshotScheduledConfig();

await runRfmSnapshotCommand(
  {
    ...config,
    dryRun: false,
    referenceTime: null,
  },
  {
    triggerSource: 'scheduled',
    writeDryRunOutput: false,
  },
);
