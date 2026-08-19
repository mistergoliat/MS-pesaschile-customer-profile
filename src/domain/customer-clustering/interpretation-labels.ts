// CP-R2-T01 canonical V1 interpretations (docs/experiments/CP-R2-T01-behavioral-clustering-v1-
// controlled-experiment.md, Section 20/21) — descriptions strictly limited to observed
// variables, no category/manufacturer/geography/profession inference (task Section 43/49).
// These are reference labels used for Hungarian-matching a freshly trained candidate model's
// clusters back to their T01 story (see the Python training script); a model's ACTUAL
// interpretation mapping is whatever the trained-model-specific matching produces and is
// stored in customer_cluster_interpretation, versioned by (modelId, clusterId,
// interpretationVersion) — never a hardcoded position-based label.
export const t01ReferenceInterpretations: readonly { readonly label: string; readonly description: string }[] = [
  {
    label: 'LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS',
    description:
      'Repeat buyers with long customer tenure, long purchase intervals, and no activity in the trailing year.',
  },
  {
    label: 'NEW_BURST_THEN_LAPSED_BUYERS',
    description:
      'Newer customers whose repeat orders happened close together, then went dormant with no recent activity.',
  },
  {
    label: 'HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS',
    description:
      'Repeat buyers with the highest spend, the broadest catalog reach, and the lowest product-spend concentration.',
  },
  {
    label: 'RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS',
    description:
      'Newer-tenure repeat buyers with the most recent orders and consistent activity in the trailing year.',
  },
];
