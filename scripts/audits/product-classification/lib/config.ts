export const CATALOG_SHOP_ID_ENV = 'PRESTASHOP_CATALOG_SHOP_ID';

export type CatalogShopIdResolution =
  | {
      readonly ok: true;
      readonly shopId: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'invalid';
    };

export function resolveCatalogShopId(env: Readonly<Record<string, string | undefined>>): CatalogShopIdResolution {
  const raw = env[CATALOG_SHOP_ID_ENV];
  if (raw === undefined || raw.trim() === '') {
    return { ok: false, reason: 'missing' };
  }
  if (!/^\d+$/.test(raw)) {
    return { ok: false, reason: 'invalid' };
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, shopId: parsed };
}

export function catalogShopExists(row: Record<string, unknown> | null | undefined): boolean {
  return Number(row?.shopCount ?? 0) > 0;
}

