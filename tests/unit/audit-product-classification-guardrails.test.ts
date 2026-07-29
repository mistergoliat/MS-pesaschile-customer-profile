import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  catalogShopExists,
  CATALOG_SHOP_ID_ENV,
  resolveCatalogShopId,
} from '../../scripts/audits/product-classification/lib/config.js';
import { assessGrants, evaluateLoad } from '../../scripts/audits/product-classification/lib/guardrails.js';

describe('product classification audit guardrails', () => {
  it('allows SELECT/USAGE-only grants and rejects write/admin grants', () => {
    expect(assessGrants(['GRANT USAGE ON *.* TO `audit`@`%`', 'GRANT SELECT ON `shop`.* TO `audit`@`%`']).safe).toBe(true);
    expect(assessGrants(['GRANT SELECT, INSERT ON `shop`.* TO `audit`@`%`']).safe).toBe(false);
    expect(assessGrants(['GRANT SELECT ON `shop`.* TO `audit`@`%` WITH GRANT OPTION']).safe).toBe(false);
  });

  it('aborts when load is above the shared audit threshold', () => {
    expect(evaluateLoad(1, 100).safe).toBe(true);
    expect(evaluateLoad(80, 100).safe).toBe(false);
  });

  it('keeps product classification outputs ignored while preserving .gitkeep', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toContain('scripts/audits/product-classification/outputs/*');
    expect(gitignore).toContain('!scripts/audits/product-classification/outputs/.gitkeep');
  });

  it('requires PRESTASHOP_CATALOG_SHOP_ID as the explicit catalog shop source', () => {
    expect(CATALOG_SHOP_ID_ENV).toBe('PRESTASHOP_CATALOG_SHOP_ID');
    expect(resolveCatalogShopId({})).toEqual({ ok: false, reason: 'missing' });
    expect(resolveCatalogShopId({ PRESTASHOP_CATALOG_SHOP_ID: '' })).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects invalid catalog shop ids before the audit can query data tables', () => {
    expect(resolveCatalogShopId({ PRESTASHOP_CATALOG_SHOP_ID: '0' })).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveCatalogShopId({ PRESTASHOP_CATALOG_SHOP_ID: '-1' })).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveCatalogShopId({ PRESTASHOP_CATALOG_SHOP_ID: '1.5' })).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveCatalogShopId({ PRESTASHOP_CATALOG_SHOP_ID: String(Number.MAX_SAFE_INTEGER + 1) })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(resolveCatalogShopId({ PRESTASHOP_CATALOG_SHOP_ID: '2' })).toEqual({ ok: true, shopId: 2 });
  });

  it('aborts when the configured catalog shop does not exist in product_shop', () => {
    expect(catalogShopExists({ shopCount: 1 })).toBe(true);
    expect(catalogShopExists({ shopCount: 0 })).toBe(false);
    expect(catalogShopExists(null)).toBe(false);
  });

  it('does not reuse the carrier shop id in the product classification audit', () => {
    const auditScript = readFileSync('scripts/audits/product-classification/audit-product-classification.ts', 'utf8');

    expect(auditScript).toContain('CATALOG_SHOP_ID_ENV');
    expect(auditScript).not.toContain('PRESTASHOP_CARRIER_SHOP_ID');
  });
});
