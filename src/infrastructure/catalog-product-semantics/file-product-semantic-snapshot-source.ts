import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProductSemanticSnapshotConsumerError, type ProductSemanticSnapshotSource } from '../../application/product-semantic-snapshot/consumer.js';

const SUPPORTED_SCHEMA_VERSION = '1';

type ActivePointer = {
  readonly snapshotId: string;
  readonly schemaVersion: string;
};

export class FileProductSemanticSnapshotSource implements ProductSemanticSnapshotSource {
  private readonly snapshotsDirectory: string;
  private readonly activePointerPath: string;

  constructor(private readonly rootDirectory: string) {
    this.snapshotsDirectory = join(rootDirectory, 'snapshots');
    this.activePointerPath = join(rootDirectory, 'active.json');
  }

  async getActiveSnapshot(): Promise<unknown | null> {
    const pointer = await this.readActivePointer();
    if (pointer === null) return null;
    if (pointer.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      throw new ProductSemanticSnapshotConsumerError(
        'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION',
        `Unsupported Product Semantic Snapshot schemaVersion: ${pointer.schemaVersion}`,
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(pointer.snapshotId)) {
      throw new ProductSemanticSnapshotConsumerError(
        'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT',
        'Active Product Semantic Snapshot pointer contains an invalid snapshotId',
      );
    }
    const snapshotPath = join(this.snapshotsDirectory, `${pointer.snapshotId.replace(/^sha256:/u, '')}.json`);
    let raw: string;
    try {
      raw = await readFile(snapshotPath, 'utf8');
    } catch {
      throw new ProductSemanticSnapshotConsumerError(
        'PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE',
        'Active Product Semantic Snapshot materialization could not be read',
      );
    }
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(raw) as unknown;
    } catch {
      throw new ProductSemanticSnapshotConsumerError(
        'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT',
        'Active Product Semantic Snapshot is not valid JSON',
      );
    }
    const pointerAfterRead = await this.readActivePointer();
    if (!pointerAfterRead || pointerAfterRead.snapshotId !== pointer.snapshotId || pointerAfterRead.schemaVersion !== pointer.schemaVersion) {
      throw new ProductSemanticSnapshotConsumerError(
        'PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE',
        'Active Product Semantic Snapshot pointer changed during read',
      );
    }
    return snapshot;
  }

  private async readActivePointer(): Promise<ActivePointer | null> {
    let raw: string;
    try {
      raw = await readFile(this.activePointerPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ProductSemanticSnapshotConsumerError(
        'PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE',
        'Active Product Semantic Snapshot pointer could not be read',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ProductSemanticSnapshotConsumerError(
        'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT',
        'Active Product Semantic Snapshot pointer is not valid JSON',
      );
    }
    if (
      typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).snapshotId !== 'string' ||
      typeof (parsed as Record<string, unknown>).schemaVersion !== 'string'
    ) {
      throw new ProductSemanticSnapshotConsumerError(
        'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT',
        'Active Product Semantic Snapshot pointer is malformed',
      );
    }
    const pointer = parsed as { snapshotId: unknown; schemaVersion: unknown };
    return {
      snapshotId: pointer.snapshotId as string,
      schemaVersion: pointer.schemaVersion as string,
    };
  }
}
