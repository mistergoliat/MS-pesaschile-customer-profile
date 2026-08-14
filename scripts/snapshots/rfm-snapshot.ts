import 'dotenv/config';
import { loadRfmSnapshotCliConfig } from '../../src/rfm-snapshot-config.js';
import { runRfmSnapshotCommand } from './lib/rfm-snapshot-command.js';

const config = loadRfmSnapshotCliConfig();

await runRfmSnapshotCommand(config, {
  triggerSource: 'manual',
  writeDryRunOutput: true,
});
