import { describe, expect, it } from 'vitest';
import {
  resolveBusinessMetric,
  resolveBusinessMetricByName,
  businessEntityLabel,
  formatBusinessValue,
  formatBusinessRank,
  formatRatio,
  CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_INSTRUCTIONS,
} from '../../src/domain/customer-intelligence-copilot/index.js';

describe('Customer Intelligence Copilot business semantics registry (task MARKETING-R1-T05.8.6 Section 8/9)', () => {
  it('maps raw analytical fields/aliases to business labels and formats, never echoing internal RFM score aliases', () => {
    expect(resolveBusinessMetric({ aggregation: 'count', alias: 'customer_count' })).toMatchObject({ name: 'customerCount', label: 'Clientes', format: 'count' });
    expect(resolveBusinessMetric({ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' })).toMatchObject({ label: 'Ticket promedio', format: 'currency_clp' });
    expect(resolveBusinessMetric({ aggregation: 'sum', field: 'commercial.totalSpentTaxIncl', alias: 'gasto' })).toMatchObject({ label: 'Gasto total', format: 'currency_clp' });
    expect(resolveBusinessMetric({ aggregation: 'avg', field: 'rfm.rScore', alias: 'avg_r' })).toMatchObject({ name: 'averageRecencyScore', label: 'Recencia promedio', format: 'decimal' });
    expect(resolveBusinessMetric({ aggregation: 'avg', field: 'rfm.fScore', alias: 'avg_f' })).toMatchObject({ label: 'Frecuencia promedio' });
    expect(resolveBusinessMetric({ aggregation: 'avg', field: 'rfm.mScore', alias: 'avg_m' })).toMatchObject({ label: 'Valor monetario promedio' });
  });

  it('formats CLP currency without decimals and with Spanish thousands separators', () => {
    expect(formatBusinessValue(381304.04, 'currency_clp')).toBe('$381.304');
    expect(formatBusinessValue(130552.92, 'currency_clp')).toBe('$130.553');
  });

  it('formats percentages with a comma decimal separator', () => {
    expect(formatBusinessValue(0.226, 'percentage')).toBe('22,6%');
  });

  it('formats counts with Spanish thousands separators and no decimals', () => {
    expect(formatBusinessValue(3973, 'count')).toBe('3.973');
    expect(formatBusinessValue(10158, 'count')).toBe('10.158');
  });

  it('formats ranking position with the abbreviated Spanish ordinal', () => {
    expect(formatBusinessRank(1, 4)).toBe('1.er lugar de 4');
    expect(formatBusinessRank(2, 4)).toBe('2.o lugar de 4');
  });

  it('formats a ratio as "X veces"', () => {
    expect(formatRatio(381304.04, 130552.92)).toMatch(/^2,9 veces$/);
  });

  it('labels RFM segment and cluster entities in business-readable Spanish, including the unassigned case', () => {
    expect(businessEntityLabel('cluster', 3)).toBe('Cluster 3 - Clientes recurrentes de alto valor y compra diversificada');
    expect(businessEntityLabel('cluster', 'LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS')).toBe('Clientes recurrentes historicos actualmente inactivos');
    expect(businessEntityLabel('cluster', null)).toBe('Clientes sin cluster asignado');
    expect(businessEntityLabel('rfm_segment', 'AT_RISK_HIGH_VALUE')).toBe('Segmento RFM AT_RISK_HIGH_VALUE');
    expect(businessEntityLabel('rfm_segment', null)).toBe('Clientes sin segmento RFM');
  });

  it('resolveBusinessMetricByName resolves a canonical semantic name (e.g. from PrimaryFinding.metric) without the original AnalyticalMetricSpec', () => {
    expect(resolveBusinessMetricByName('averageOrderValue')).toMatchObject({ label: 'Ticket promedio', format: 'currency_clp' });
    expect(resolveBusinessMetricByName('customerCount')).toMatchObject({ label: 'Clientes', format: 'count' });
  });

  it('the v5 tool synthesis prompt explicitly prohibits internal codes, aliases, query ids, and implementation details', () => {
    const combined = CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_INSTRUCTIONS.join(' ');
    expect(combined).toMatch(/internal cluster codes, internal aliases/i);
    expect(combined).toMatch(/query ids/i);
    expect(combined).toMatch(/business terminology/i);
    expect(combined).toMatch(/recommendation with prediction/i);
  });
});
