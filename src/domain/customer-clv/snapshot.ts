import { CUSTOMER_CLV_HORIZON_MONTHS, type CustomerClvHorizonMonths } from './contracts.js';

export type BuildCustomerClvSnapshotKeyInput = {
  readonly modelVersion: string;
  readonly horizonMonths: CustomerClvHorizonMonths | number;
  readonly populationPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly referenceTime: string;
  readonly modelChecksum?: string;
};

export function buildCustomerClvSnapshotKey(input: BuildCustomerClvSnapshotKeyInput): string {
  return [
    input.modelVersion,
    `${input.horizonMonths}m`,
    input.populationPolicyVersion,
    input.monetaryPolicyVersion,
    input.referenceTime.replace(/[:.]/g, '-'),
    ...(input.modelChecksum === undefined ? [] : [input.modelChecksum]),
  ].join('__');
}

export function isCustomerClvV1Horizon(value: number): value is CustomerClvHorizonMonths {
  return value === CUSTOMER_CLV_HORIZON_MONTHS;
}
