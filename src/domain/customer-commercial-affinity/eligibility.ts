// Structural classification-status eligibility (task Section 15). Pure, semantic-input-only:
// answers "CAN this fact contribute evidence on this axis" — never accumulates, weighs, or
// scores anything (that begins in A01.2). "Eligible" says nothing about whether the fact will
// end up producing a row, only that nothing about its classificationStatus/code rules it out.
//
// classificationStatus policy (design doc Section 11/13, task Section 15):
//   CLASSIFIED / PARTIALLY_CLASSIFIED  -> eligible per available semantic axis
//   OTHER                              -> never eligible for PRODUCT_FAMILY — a downstream
//                                          policy customer-profile owns and applies itself,
//                                          not a flag read off any ontology-side tag metadata
//                                          (design doc Section 11)
//   EXCLUDED_NON_PRODUCT               -> never eligible on any axis
//   NEEDS_REVIEW                       -> never eligible on any axis until resolved

import type { ProductSemanticFact } from './contracts.js';

const OTHER_PRODUCT_FAMILY_CODE = 'OTHER';

export function isProductFamilyEligible(fact: ProductSemanticFact): boolean {
  if (!isSemanticAxisEligible(fact)) return false;
  return fact.primaryProductFamily !== null && fact.primaryProductFamily.code !== OTHER_PRODUCT_FAMILY_CODE;
}

export function isDisciplineEligible(fact: ProductSemanticFact): boolean {
  return isSemanticNonFamilyAxisEligible(fact) && fact.disciplines.length > 0;
}

export function isUseContextEligible(fact: ProductSemanticFact): boolean {
  return isSemanticNonFamilyAxisEligible(fact) && fact.useContexts.length > 0;
}

function isSemanticAxisEligible(fact: ProductSemanticFact): boolean {
  switch (fact.classificationStatus) {
    case 'CLASSIFIED':
    case 'PARTIALLY_CLASSIFIED':
      return true;
    case 'OTHER':
    case 'EXCLUDED_NON_PRODUCT':
    case 'NEEDS_REVIEW':
      return false;
  }
}

// OTHER only means that the catalog could not assign a product family. Any discipline or use
// context tags that the catalog did establish remain valid evidence (A01.4 population policy).
function isSemanticNonFamilyAxisEligible(fact: ProductSemanticFact): boolean {
  return fact.classificationStatus === 'CLASSIFIED' ||
    fact.classificationStatus === 'PARTIALLY_CLASSIFIED' ||
    fact.classificationStatus === 'OTHER';
}
