import type { Clock } from '../../application/customer-profile/ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
