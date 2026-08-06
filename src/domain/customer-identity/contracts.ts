export const CUSTOMER_PROFILE_CONTRACT_VERSION = 'customer-profile-prestashop-direct-v1';

export type CustomerIdentity = {
  readonly customerId: number;
  readonly externalCustomerId: number;
  readonly identitySource: 'PRESTASHOP';
  readonly identityStatus: 'DIRECT_SOURCE';
  readonly sourceMetadata: {
    readonly platform: 'PRESTASHOP';
    readonly entity: 'ps_customer';
    readonly primaryKey: 'id_customer';
  };
};

export type ResolveCustomerIdentityResult =
  | {
      readonly status: 'found';
      readonly identity: CustomerIdentity;
    }
  | {
      readonly status: 'not_found' | 'invalid_id';
    };

export type CustomerDataSourceEntity =
  | 'ps_customer'
  | 'ps_orders'
  | 'ps_order_detail'
  | 'ps_order_cart_rule'
  | 'derived_purchase_behavior';

export type CustomerDataSource = {
  readonly source: 'PRESTASHOP';
  readonly entity: CustomerDataSourceEntity;
  readonly purpose: string;
};

export type CustomerDataProvenance = {
  readonly customerIdentity: {
    readonly customerId: number;
    readonly source: 'PRESTASHOP';
    readonly externalCustomerId: string;
    readonly status: 'DIRECT_SOURCE';
  };
  readonly dataSources: readonly CustomerDataSource[];
  readonly generatedAt: string;
  readonly contractVersion: typeof CUSTOMER_PROFILE_CONTRACT_VERSION;
};

