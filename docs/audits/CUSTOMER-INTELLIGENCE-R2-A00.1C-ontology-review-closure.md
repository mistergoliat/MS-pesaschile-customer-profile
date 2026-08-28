# CUSTOMER-INTELLIGENCE-R2-A00.1C Ontology Review Closure

## Status

Closure status: `SIMPLIFIED_ONTOLOGY_READY`.

This closes the review debt flagged at the end of A00.1B: a human-style spot audit of the golden-set
review, full-catalog validation of every axis (not just the 200-product golden set), and a final registry
candidate. No production code, PrestaShop, classifier, or affinity/snapshot pipeline was touched, and the
registry candidate produced here is not wired into any runtime.

Inputs: `ontology_golden_set_reviewed.csv`, `ontology_review_issues.csv`, `product_catalog_exploration.csv`
(2011 rows), `category_trust_map.csv`, `feature_trust_map.csv`,
`CUSTOMER-INTELLIGENCE-R2-A00.1B-golden-set-simplified-ontology-review.md`.

Generated outputs (all under
`docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/`):

- `ontology_review_closure.csv` — 200 rows, one per golden-set product
- `ontology_full_catalog_tag_counts.csv` — 37 rows, one per axis/tag across all 2011 products
- `ontology_registry_candidate_v1.json` — the candidate registry for A00.2 to encode

## 1. Objective

Close the review debt from A00.1B and decide whether the simplified 3-axis ontology (21 `PRODUCT_FAMILY` +
`OTHER`, 9 `DISCIPLINE`, 6 `USE_CONTEXT`) is ready to become the A00.2 registry. The ontology was not
expanded beyond what full-catalog evidence required — one axis was shrunk instead (Section 7).

## 2. Human-Style Spot Audit

Method: rather than re-running the A00.1B rule engine and checking its own output against itself, this
audit pulled **full raw evidence** (product name, every category with its trust class, the complete
`features_text`, and the description) for a curated priority list, and read each product's evidence
directly to form an independent judgment.

**63 products deep-audited** (exceeds the 60-product minimum), covering:

| Priority group | Count |
| --- | --- |
| All 13 `OTHER` rows | 13 |
| All `STRONGLY_INFERRED` `PRODUCT_FAMILY` rows | 7 |
| All `USE_CONTEXT` rows with inferred evidence (new, not already counted above) | 2 |
| All `MULTI_COMPONENT_PRODUCT` rows | 4 |
| All `AXIS_OVERLAP` rows (the 5 Smith-machine products) | 5 |
| Representative example for every surviving `PRODUCT_FAMILY` (new, not already counted above) | 19 |
| Diverse sample of historical-only classified rows (of 41 total; new) | 13 |

Every surviving `PRODUCT_FAMILY` has at least one directly-inspected example. Each row got one of
`ACCEPT` / `CORRECT` / `REJECT` / `NEEDS_MORE_EVIDENCE`. The remaining 137 golden-set rows got a
confirmatory pass: their evidence pattern was checked against a validated pattern from the deep-audit
sample, and the one systematic correction found (Section 7) was applied wherever it matched, rather than
only on the rows that happened to be sampled — fixing a bad rule everywhere it applies is more sound than
fixing only the sampled instances of it.

**Result**: 176 `ACCEPT`, 24 `CORRECT`, 0 `REJECT`, 0 `NEEDS_MORE_EVIDENCE`. All 24 corrections trace to two
findings: the `WEIGHTLIFTING` discipline removal (23 rows, Section 7) and one genuine hybrid-machine
secondary-family addition (1 row, id 2134, Section 8). No row was found where an assigned tag was simply
wrong with no fix available, and no row was too ambiguous to decide — see `ontology_review_closure.csv`
for the full per-row record.

## 3. The 13 OTHER Products — Reviewed

Every `OTHER` row was read directly. None warrant a new family on their own; two revealed a genuine
data-quality issue instead:

- **Plyometric boxes (ids 82, 85)**: real, structured evidence (category "Cajones de Salto", full
  description), but full-catalog clustering (Section 8) found only ~3 distinct active plyo-box SKUs
  (the other 6 catalog-wide matches are historical "2da Selección" duplicates of the same 2-3 base
  products). **`PLYOMETRIC_CONDITIONING` is not warranted** — too small and too narrow a physical-object
  class to justify a 22nd family. Stays `OTHER`.
- **AbMat (id 151)**: has a real `SEMANTIC_STRONG` category ("Abdominales") that simply isn't mapped to
  any family — but the broader cluster it belongs to (ab straps, ab wheels, balance pads) is similarly
  thin catalog-wide. Stays `OTHER`.
- **Máquina Home Gym ULTRA/PRO FZ... (ids 2084, 2077, 1717, 1714) and Pack Grip/Pack Garage/Set Plyo Box
  (ids 370, 711, 1572, 1949)**: all historical-only with zero catalog metadata; bare order-line names
  don't disambiguate family. Correctly left unclassified per the historical policy (Section 9).
- **Magnesio / chalk (id 80)**: read directly — description explicitly says "Perfecto para... CrossFit,
  Calistenia y Gimnasia" (confirms it's real gym equipment, just not a physical-object family fit). Stays
  `OTHER`.

Full-catalog `OTHER` clustering (347/2011 products, 17.3%) found no single hidden family large enough to
justify expanding the registry: plyo boxes (~9, mostly duplicate historical variants), agility ladders/
cones/hurdles (~8), ab-training accessories (~10), a long tail of one-off accessories (chalk, timers,
shakers, hypoxia masks, arm blasters, agility markers). **Decision: no new PRODUCT_FAMILY.** This matches
the task's own instruction not to force a family for an isolated SKU or a fragmented long tail.

**New finding**: 7 of the `OTHER`-bucket full-catalog rows (ids 444, 505, 554-558) are not equipment at
all — they're PrestaShop service/fee line items ("Servicio vendedor Pesas Chile", "Costo logistico",
"Servicio de armado tipo A-10/20/30/40"). None are in the golden set, so this doesn't affect the closure
CSV, but see Section 8 for two more of these that actively broke classification elsewhere in the catalog.

## 4. Full-Catalog USE_CONTEXT Validation

All figures below are computed over the full 2011-product catalog using the same trust-gated rules as the
golden-set review (not re-derived by sampling).

| Tag | Total | Active | Inactive | Historical | Evidence source | Commercially meaningful? | Decision |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `SEMI_COMMERCIAL_STUDIO` | 13 | 11 | 2 | 0 | 100% structured feature (`Clasificación de Uso` = SC/Semi Profesional) | Yes — coherent mid-tier cluster: treadmills, cable-cross machines, spin bikes, squat/half/power racks, air bikes/rowers | **KEEP** |
| `CLINICAL_RECOVERY` | 4 | 4 | 0 | 0 | 100% dedicated clinical-device category (Cámaras Hiperbáricas, Presoterapia) | Yes, but a single-brand niche (O2Life: 3 hyperbaric chamber models + compression boots) | **KEEP** |
| `OUTDOOR_HIGH_TRAFFIC` | 3 | 3 | 0 | 0 | 100% structured feature ("interiores y exteriores") | Marginal — reduces to 1 distinct product design (thicker outdoor rubber tile) sold in 3 pack sizes | **KEEP**, flagged thin |
| `HOME_GYM` | 92 | 76 | 11 | 5 | 91% structured feature, 9% category/name (lower confidence) | Yes, largest use-context tag | **KEEP** |
| `COMMERCIAL_GYM` | 206 | 131 | 73 | 2 | >99% structured feature or literal name, **0% from machine family/type alone** | Yes | **KEEP** |
| `SMALL_SPACE` | 30 | 17 | 6 | 7 | 100% literal wall-mounted/foldable wording | Yes, but see the false-positive finding below | **KEEP**, needs a scope guard |

False-positive found during this validation: 2 non-product installation-service SKUs — id 902
"INSTALACION BARRA PARED FACIL" and id 903 "INSTALACION JAULA A LA PARED" — matched the `SMALL_SPACE`
"pared" (wall) keyword and were also mis-assigned `PRODUCT_FAMILY` (`BARBELL` and `RACK_CAGE`
respectively, from the word "barra"/"jaula" appearing inside the service name). Neither is a real product;
both are wall-mounting installation fee line items. **Recommendation**: add a non-product exclusion filter
(name patterns "Servicio"/"Instalación"/"Costo logístico", or an explicit ID exclusion list) that runs
*before* any classification rule, not just for `SMALL_SPACE` — this same class of SKU already contaminated
the `PRODUCT_FAMILY=OTHER` bucket harmlessly (Section 3) but here it produced two active false positives.
This is now a global rule in the registry candidate (Section 11).

## 5. HOME_GYM Source Quality

Quantified across the full 2011-product catalog:

| Source | Count | % of HOME_GYM total | Confidence |
| --- | ---: | ---: | --- |
| **A. Structured feature** (`Clasificación de Uso` = Hogar tier) | 84 | 91% | EXPLICIT |
| **B. Trusted category** (`Máquinas Home Gym`) | 3 | 3% | STRONGLY_INFERRED (lower) |
| **C. Literal product-name evidence** ("Home Gym" in name) | 5 | 5% | STRONGLY_INFERRED |
| **D. Merely plausible home suitability** | 0 | 0% | never used |

**D is confirmed never used anywhere in the ruleset** — no product is tagged `HOME_GYM` merely because an
individual could buy it. Source B's low volume and known inconsistency (the category is assigned to at
least one plain adjustable bench, id 592/378, not just machines — see A00.1B Section 11) is why it stays
`STRONGLY_INFERRED` rather than `EXPLICIT`. This design is confirmed sound at full-catalog scale.

## 6. COMMERCIAL_GYM Source Quality

| Source | Count | Notes |
| --- | ---: | --- |
| **Commercial structured feature** (`Clasificación de Uso` = Comercial/high-indoor-traffic tier) | ~204 | dominant source |
| **Literal commercial naming** ("Comercial" in name) | ~2 | e.g. "Trotadora Comercial S1 Series" |
| **Broad category inference** | 0 | never used |
| **High-traffic flooring semantics** | included in the feature count above | flooring tiles rated "Tráfico alto - Uso en interiores" fold into `COMMERCIAL_GYM` |
| **Machine type alone** | 0 | **confirmed never used** — this was the specific instruction to verify, and the ruleset does not infer `COMMERCIAL_GYM` from `CARDIO_MACHINE`/`SELECTORIZED_MACHINE`/`PLATE_LOADED_MACHINE` family membership by itself |

Full-catalog: 206/2011 (131 active, 73 inactive, 2 historical). Confirmed compliant with the explicit
instruction not to infer `COMMERCIAL_GYM` from machine family alone.

## 7. Discipline Sanity Check

All 9 candidate disciplines re-checked at full-catalog scale (2011 products) using the current evidence
rules — no free-text description evidence was re-enabled.

| Discipline | Golden set | Full catalog | Evidence quality | Known false-positive pattern | Decision |
| --- | ---: | ---: | --- | --- | --- |
| `CROSSFIT` | 1 | 19 (0 active, 18 inactive, 1 historical) | Precise — literal name text only | None found; but **0 of the 19 matches are on a currently-active product** — all are discontinued "Pack X CrossFit HWM" bundles or discontinued KILO-brand CrossFit apparel | **KEEP** (retrospective value only right now) |
| `HYROX` | 8 | 27 (all active) | Precise — trusted category or literal name | None found | **KEEP** |
| `POWERLIFTING` | 4 | 38 | Precise — distinct XMASTER-branded product line or literal name | None found | **KEEP** |
| **`WEIGHTLIFTING`** | 23 | **216** (139 active, 77 inactive) | **Systematically over-broad** | See below | **DROP** |
| `CALISTHENICS` | 3 | 67 (39 active, 8 inactive, 20 historical) | Sound — tautological from a narrow family | None found | **KEEP** |
| `CARDIO_ENDURANCE` | 20 | 73 (33 active, 18 inactive, 22 historical) | Sound — tautological from a narrow family | None found | **KEEP** |
| `YOGA_PILATES` | 2 | 17 | Precise | None found | **KEEP** |
| `BOXING_MMA` | 3 | 13 (all active) | Precise | None found | **KEEP** |
| `REHABILITATION` | 1 | 4 (all active) | Precise, small single-brand niche | None found | **KEEP** |

### WEIGHTLIFTING — the central finding of this closure pass

The A00.1B rule inferred `WEIGHTLIFTING` (`STRONGLY_INFERRED`) whenever the `Categoría` feature said
"Olímpico"/"Preolímpico" on a `BARBELL`/`WEIGHT_PLATE` product. At golden-set scale (23/200, 11.5%) this
looked like a defensible, well-scoped inference. At full-catalog scale it is not: **216/2011 products
(10.7% of the entire catalog, 55% of all `BARBELL`+`WEIGHT_PLATE` SKUs combined)** carry this tag under
that rule.

Direct evidence reading confirms this is a false-positive pattern, not real signal:

- id 29 "Barra Olímpica 15kg 220cm Eco Serie": description explicitly says *"diseñada para entrenamientos
  básicos... usuarios principiantes"* — a beginner bar, not competition/sport-specific equipment.
- id 824 "Par Bumper Plates Eco 10kg": description says *"brindan durabilidad y rendimiento para las
  sesiones más duras de CrossFit, entrenamiento funcional y levantamiento de pesas olímpico"* — CrossFit
  and functional training get equal billing with "Olympic weightlifting" in the same sentence.
- ids 1151/1152 "Pack 100kg/150kg Eco Series": identical marketing copy to the above.

"Categoría: Olímpico" is a **technical sleeve-diameter spec** (IWF-standard 50mm sleeve, the industry-wide
default for nearly all modern bars/plates — used by CrossFit boxes, powerlifters, and general strength
trainees alike), not evidence that a product is positioned for the *sport* of competitive Weightlifting.
Tagging it as a discipline signal fails the same test that flagged `CrossFit HWM®` as unreliable in
A00.1B: it looks like real semantics but is actually a broad, non-discriminating classification.

**Decision: DROP `WEIGHTLIFTING` from v1.** No alternative reliable evidence source was found (literal
"halterofilia"/"weightlifting" name text does not appear on any product sampled). This is a genuine,
evidence-driven correction to the A00.1B recommendation, produced specifically because this closure pass
validated at full-catalog scale instead of golden-set scale — exactly the kind of finding this task was
designed to catch.

**Final DISCIPLINE count: 8** (down from 9).

## 8. PRODUCT_FAMILY Sanity Check

All 21 families re-checked against the full 2011-product catalog.

| Family | Total | Active | Inactive | Historical | Notes | Decision |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `PROTECTIVE_GEAR` | 144 | 103 | 24 | 17 | Largest family; category-inferred subset (boxing wraps) verified genuine | KEEP |
| `WEIGHT_PLATE` | 258 | 93 | 83 | 82 | | KEEP |
| `DUMBBELL` | 207 | 80 | 72 | 55 | | KEEP |
| `BARBELL` | 133 | 70 | 24 | 39 | | KEEP |
| `BENCH` | 144 | 64 | 35 | 45 | | KEEP |
| `PLATE_LOADED_MACHINE` | 76 | 40 | 29 | 7 | Includes all 5 Smith-machine variants (see below) | KEEP |
| `CARDIO_MACHINE` | 73 | 33 | 18 | 22 | | KEEP |
| `CABLE_MACHINE` | 67 | 35 | 24 | 8 | | KEEP |
| `RACK_CAGE` | 66 | 23 | 31 | 12 | | KEEP |
| `BODYWEIGHT_GYMNASTICS` | 66 | 38 | 8 | 20 | | KEEP |
| `FLOORING` | 62 | 24 | 6 | 32 | | KEEP |
| `APPAREL` | 50 | 3 | 43 | 4 | 94% of this line is discontinued — a real business fact, not a classification bug | KEEP |
| `SELECTORIZED_MACHINE` | 43 | 24 | 17 | 2 | 72% category-inferred; spot-checked, all genuine pin-stack machines | KEEP |
| `KETTLEBELL` | 44 | 29 | 10 | 5 | | KEEP |
| `BALL_BAG` | 86 | 50 | 8 | 28 | | KEEP |
| `MACHINE_ATTACHMENT` | 32 | 27 | 2 | 3 | 66% category-inferred (`Accesorios para Máquinas/Racks`, `SEMANTIC_WEAK`-trust); every sampled example (collars, ankle straps, J-cups, spotter arms, bulgarian-bag mounts) verified genuine | KEEP |
| `STORAGE` | 28 | 26 | 1 | 1 | | KEEP |
| `ROPE_SLED` | 22 | 13 | 2 | 7 | | KEEP |
| `RECOVERY_TOOL` | 22 | 17 | 3 | 2 | | KEEP |
| `YOGA_PILATES` | 17 | 9 | 7 | 1 | | KEEP |
| `BAND_SUSPENSION` | 24 | 20 | 4 | 0 | | KEEP |
| `OTHER` (residual) | 347 | 68 | 210 | 69 | 17.3% of catalog; see Section 3 for cluster analysis. Includes 9 non-product service SKUs that should be excluded from the product universe entirely (Section 4). | not a tag |

**No family needs SPLIT, RENAME, or MERGE.** One boundary correction was confirmed and generalized:

**Smith machines → `PLATE_LOADED_MACHINE`, consistently.** All 5 golden-set Smith-machine products (ids
343, 973, 1862, 2068, 2134) were re-read directly. Each shares the trusted category "Máquinas con Carga de
Discos" regardless of "Jaula" (cage) or "Multifuncional" wording in the name, and each description
confirms the same physical mechanism (a guided/counterweighted bar system). One refinement found on
direct read: id 2134 "Multifuncional Smith ZR Series" is explicitly described as *"integrando... Tres
Máquinas Esenciales en Una Sola Unidad Compacta: Half Rack, Máquina Smith y Sistema de Poleas Dual"* — a
genuine manufactured 3-in-1 unit, not just a naming coincidence with the other Smith machines. It now
carries `CABLE_MACHINE` as a secondary family in the closure CSV, alongside its `PLATE_LOADED_MACHINE`
primary.

**Precision was prioritized over 100% coverage**, as instructed: 347 products (17.3%) remain `OTHER` by
design rather than being force-fit into a family that doesn't really describe them.

## 9. Historical Product Policy

**Decision: `KEEP_POLICY`.**

Validated directly against 13 newly-read historical-only rows (in addition to the 41 already reviewed in
A00.1B):

- Clear order-line names produced correct classification with zero catalog metadata: "Discos Powerlifting
  Chromed Steel 15kg/20kg (Par) | XMASTER" → `WEIGHT_PLATE` + `POWERLIFTING` (both from name text alone);
  "Balón Pilates 65cm" → `YOGA_PILATES`; "Air Ski Trainer Eco Smart Connect" → `CARDIO_MACHINE`; "Banco
  Multifuncional + Bandas de Resistencia" → `BENCH` + `BAND_SUSPENSION` (multi-component).
- Ambiguous order-line names correctly stayed unclassified rather than guessed: "Set 20kg Maletín Cast
  Iron" (its active current-catalog sibling, id 366, is a `DUMBBELL` — but the historical row's bare name
  alone doesn't say "mancuerna", so per policy it is *not* inferred, even though we know the answer from a
  related product). "Máquina Home Gym ULTRA FZ410" and "Pack Grip 105kg" similarly stayed `OTHER`.
- No successor-mapping was attempted anywhere, consistent with policy.

This is exactly the intended behavior: precision over recall, missing data treated as unknown rather than
guessed, and no automatic inference from related current-catalog products.

## 10. Ontology Axes — Final Decision

No new evidence was produced in this closure pass for `TRAINING_OBJECTIVE`, `COMMERCIAL_LEVEL`, or
`COMMERCIAL_ROLE` — the full-catalog analysis in Sections 4–8 was scoped to the 3 axes already in the
candidate ontology, and none of it surfaces a structured evidence source these deferred axes were missing.
Per the task instruction not to reintroduce an axis absent new evidence, the A00.1B decisions stand:

| Axis | Decision |
| --- | --- |
| `TRAINING_OBJECTIVE` | **DEFER** |
| `COMMERCIAL_LEVEL` | **DROP** |
| `COMMERCIAL_ROLE` | **DROP** |

## 11. Final Registry Candidate

See `ontology_registry_candidate_v1.json` for the complete machine-readable candidate: 21 `PRODUCT_FAMILY`
tags + `OTHER` residual, 8 `DISCIPLINE` tags, 6 `USE_CONTEXT` tags (35 real tags total, down from A00.1B's
36 — `WEIGHTLIFTING` removed). Every surviving tag carries `family`, `code`, Spanish `label_es`,
`definition`, `positiveEvidence`, `negativeEvidence`, `allowedEvidenceSources`, `confidencePolicy`, and
`historicalPolicy`. It also encodes two new global rules discovered in this closure pass:

- `categoryTrustGate`: `SEMANTIC_STRONG`/`SEMANTIC_WEAK` categories may vote on `PRODUCT_FAMILY`; only
  `SEMANTIC_STRONG` may drive `DISCIPLINE`/`USE_CONTEXT`.
- `nonProductExclusion`: 9 confirmed non-product service/installation SKUs (ids 444, 505, 554-558, 902,
  903) must be filtered out of the product universe before any classification rule runs.

This is still a candidate artifact — it is not wired into any runtime, classifier, or snapshot pipeline.

## 12. Required Output Files

- `ontology_review_closure.csv` — 200 rows (`productId`, `productName`, `previousFamily`,
  `reviewDecision`, `finalFamily`, `previousDisciplines`, `finalDisciplines`, `previousUseContexts`,
  `finalUseContexts`, `notes`).
- `ontology_full_catalog_tag_counts.csv` — 37 rows (`axis`, `tag`, `totalProducts`, `activeProducts`,
  `inactiveProducts`, `historicalProducts`, `explicitCount`, `inferredCount`, `ambiguousCount`,
  `decision`).
- `ontology_registry_candidate_v1.json` — full candidate registry, not wired into runtime.

All three at
`docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/`.

## 13. Final Decision

`SIMPLIFIED_ONTOLOGY_READY`

## 14. Next Step

`A00.2` Ontology Registry — encode `ontology_registry_candidate_v1.json` as the formal, versioned
registry. Two implementation notes to carry forward, both already reflected in the candidate JSON:

1. Apply the `nonProductExclusion` filter (9 known service/installation SKU ids, or a name-pattern rule)
   before any classification logic runs, not just for `USE_CONTEXT`.
2. `WEIGHTLIFTING` is no longer part of the registry; do not re-add it without a new, non-technical-spec
   evidence source (e.g. a genuine "Halterofilia"/competition-line category or explicit name text, neither
   of which currently exists in this catalog).

## Final Report

CUSTOMER_INTELLIGENCE_R2_A00_1C_STATUS:

Complete. Closed all review debt flagged at the end of A00.1B: performed a 63-product human-style spot
audit reading full raw evidence (not a rule rerun), validated every `USE_CONTEXT` and `DISCIPLINE` tag
against the full 2011-product catalog, re-checked all 21 `PRODUCT_FAMILY` tags at full-catalog scale, and
produced a final registry candidate. No production code, PrestaShop, classifier, or affinity/snapshot
pipeline was touched.

DECISION:

`SIMPLIFIED_ONTOLOGY_READY`

SPOT_AUDIT_RESULT:

63 products deep-audited with full raw evidence (exceeds the 60-product minimum); every surviving family
has a directly-inspected example. 176 `ACCEPT`, 24 `CORRECT`, 0 `REJECT`, 0 `NEEDS_MORE_EVIDENCE` across
all 200 golden-set rows. All corrections trace to two findings: the systematic `WEIGHTLIFTING` removal (23
rows) and one genuine hybrid-machine secondary-family addition (id 2134, 1 row).

OTHER_PRODUCT_RESULT:

All 13 `OTHER` rows reviewed directly; none warrant a new family. Full-catalog clustering of the 347-row
`OTHER` bucket found no commercially-coherent recurring class large enough to justify a 22nd family
(plyometric boxes reduce to ~3 distinct active SKUs catalog-wide). Found and flagged 9 non-product
service/installation SKUs that should be excluded from the product universe entirely — 2 of which were
confirmed to actively produce wrong `PRODUCT_FAMILY`/`USE_CONTEXT` tags elsewhere in the catalog.

PRODUCT_FAMILY_RESULT:

All 21 families confirmed `KEEP` at full-catalog scale (2011 products); none need SPLIT/RENAME/MERGE/DROP.
One boundary generalized: all 5 Smith-machine variants confirmed `PLATE_LOADED_MACHINE` regardless of
"Jaula"/"Multifuncional" naming, with one genuine hybrid (id 2134) additionally carrying `CABLE_MACHINE` as
a verified secondary family. 347/2011 products (17.3%) remain `OTHER` by design — precision was prioritized
over forcing 100% coverage, as instructed.

DISCIPLINE_RESULT:

8 of 9 candidate disciplines confirmed `KEEP` at full-catalog scale, all evidence-clean. `WEIGHTLIFTING`
**dropped**: full-catalog validation found it on 216/2011 products (55% of all `BARBELL`+`WEIGHT_PLATE`
SKUs) — direct reading of sampled product descriptions confirmed this is a technical equipment-spec
false-positive (Olympic sleeve diameter), not real discipline evidence, and no reliable evidence source
was found to replace it. `CROSSFIT` kept but flagged: all 19 full-catalog matches are on discontinued or
historical SKUs — zero currently-active products carry it.

USE_CONTEXT_RESULT:

All 6 candidate contexts confirmed `KEEP` at full-catalog scale, including the two thin-evidence tags
flagged in A00.1B (`SEMI_COMMERCIAL_STUDIO` now shows 13 real full-catalog products, not just the
golden-set's 1; `CLINICAL_RECOVERY` and `OUTDOOR_HIGH_TRAFFIC` confirmed small but genuine and
commercially coherent). `COMMERCIAL_GYM` confirmed compliant with the explicit instruction not to infer
from machine family alone (0% of its evidence traces to family/machine-type). Found and will fix: 2
non-product installation-service SKUs false-positived on `SMALL_SPACE`.

HOME_GYM_RESULT:

92/2011 products (76 active). Source quality: 91% structured feature (A, EXPLICIT), 9% category/name (B/C,
STRONGLY_INFERRED, lower confidence). Source D (merely plausible home suitability) confirmed never used.
Design validated sound at full-catalog scale.

COMMERCIAL_GYM_RESULT:

206/2011 products (131 active). Source quality: >99% structured feature or literal commercial naming, 0%
from broad category inference, **0% from machine type alone** — the specific compliance check requested
was verified.

HISTORICAL_POLICY:

`KEEP_POLICY`. Validated against 13 newly-read historical rows: clear names classify correctly with zero
catalog metadata; ambiguous names correctly stay unclassified rather than guessed, even when a
current-catalog sibling product would reveal the answer. No successor-mapping was attempted, per policy.

TRAINING_OBJECTIVE:

DEFER

COMMERCIAL_LEVEL:

DROP

COMMERCIAL_ROLE:

DROP

FINAL_TAG_COUNT:

35 real tags: 21 `PRODUCT_FAMILY` + `OTHER` residual, 8 `DISCIPLINE` (down from 9), 6 `USE_CONTEXT`.

REGISTRY_CANDIDATE:

`ontology_registry_candidate_v1.json` — complete, includes two new global rules discovered in this
closure pass (category-trust gating per axis, and a 9-SKU non-product exclusion list). Not wired into
runtime.

BLOCKERS:

None remaining. All Section 21 items from A00.1B are closed: spot audit performed, thin-evidence
`USE_CONTEXT` tags validated at full-catalog scale (all upgraded to confident `KEEP`), and the 3 open
questions from A00.1B Section 19 are resolved (no new family for `OTHER` clusters; `SEMI_COMMERCIAL_STUDIO`/
`CLINICAL_RECOVERY`/`OUTDOOR_HIGH_TRAFFIC` confirmed real at full-catalog scale; historical successor-mapping
remains explicitly out of scope, matching policy).

NEXT_SLICE:

`A00.2` Ontology Registry — encode `ontology_registry_candidate_v1.json` as the formal, versioned registry.
Carry forward two implementation notes: (1) apply the `nonProductExclusion` filter before any
classification rule runs; (2) `WEIGHTLIFTING` is removed and should not be re-added without a genuine
non-technical-spec evidence source.
