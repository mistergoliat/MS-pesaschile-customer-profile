# CUSTOMER-INTELLIGENCE-R2-A00.1B Golden Set Simplified Ontology Review

## Status

Review status: `SIMPLIFIED_ONTOLOGY_NEEDS_REVIEW`.

This is an offline ontology validation and simplification pass over the 200-product golden set produced
in A00.1. It does not modify production code, PrestaShop, the classifier, or any snapshot/affinity
pipeline. Classification for this stage is restricted to `PRODUCT_FAMILY`, `DISCIPLINE`, and
`USE_CONTEXT`. `TRAINING_OBJECTIVE`, `COMMERCIAL_LEVEL`, and `COMMERCIAL_ROLE` were deliberately not
classified; Section 14 decides whether each should be kept.

Input artifacts (delivered by the user under `docs/audits/product-intelligence-exploration/inputs/`):

- `ontology_golden_set.csv` (200 rows)
- `product_catalog_exploration.csv` (2011 rows, full evidence: name, categories, features, description,
  sales)
- `category_trust_map.csv` (253 categories)
- `feature_trust_map.csv` (75 feature definitions)
- `CUSTOMER-INTELLIGENCE-R2-A00.1-commercial-product-ontology-discovery.md`

Method: rather than hand-typing 200 free-text rows, this review was built as a deterministic,
evidence-gated rule engine (Node.js) applied to the real per-product evidence (name text, PrestaShop
category assignments filtered by the trust map, structured feature values filtered by the trust map), then
iteratively debugged against the actual golden-set vocabulary until every rule was verified against real
product rows. This is exactly the "deterministic high-confidence rules" approach the A00.1 discovery doc
recommended for this kind of pass, and it made rule mistakes inspectable and fixable rather than buried in
free-text judgment calls. Section 22 (Known Limitations) explains why this still needs a human sign-off
pass before being treated as fully authoritative.

Generated review artifacts:

- `docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/ontology_golden_set_reviewed.csv`
- `docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/ontology_review_issues.csv`

## 1. Objective

Validate the commercial ontology proposed in A00.1 against the 200-product golden set using a
deliberately simplified 3-axis model (`PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT`), and determine
whether `TRAINING_OBJECTIVE`, `COMMERCIAL_LEVEL`, and `COMMERCIAL_ROLE` are still needed once the core
structure is validated.

## 2. Principle Applied

The A00.1 proposal's 62-tag, 6-family registry was treated as a candidate list, not a fixed spec. Tags
were merged, dropped, renamed, or newly introduced strictly based on what the golden set's real evidence
(name text, trusted categories, trusted structured features) could support. Two entire candidate families
were rejected outright (`PACK_SET`, and `BOXING_MMA` as a `PRODUCT_FAMILY` — kept only as `DISCIPLINE`);
see Section 9.

## 3. PRODUCT_FAMILY

Method: primary family is matched first from product name (ordered, most-specific-pattern-first regex
rules over accent-stripped lowercase text), falling back to a vote across `SEMANTIC_STRONG`/
`SEMANTIC_WEAK`-trust categories only when no name rule matches. `LEGACY`, `CAMPAIGN`, `NAVIGATION`, and
`UNKNOWN`-trust categories are never used as family evidence. A secondary family is only assigned when the
product name explicitly joins two distinct product nouns with "+" (e.g. `"Pack 105kg Mancuernas
Hexagonales + Rack Vertical"` → `DUMBBELL` + `STORAGE`); ordinary "Pack"/"Set" multi-unit bundles of the
*same* family (e.g. a pack of 4 resistance bands) get a review note, not a secondary tag.

Result: 21 of the 24 candidate families listed in the task brief are used with real evidence in the golden
set. `PACK_SET` and `BOXING_MMA` (as a family) were rejected — see Section 9. `OTHER` is the residual
bucket for the 13 products (6.5%) with no reliable family match; it is not a real ontology tag.

| Family | Count (primary) | Explicit | Strongly inferred |
| --- | ---: | ---: | ---: |
| PROTECTIVE_GEAR | 36 | 35 | 1 |
| CARDIO_MACHINE | 20 | 20 | 0 |
| FLOORING | 19 | 19 | 0 |
| WEIGHT_PLATE | 18 | 16 | 2 |
| BENCH | 14 | 14 | 0 |
| DUMBBELL | 14 | 11 | 3 |
| BARBELL | 12 | 12 | 0 |
| BALL_BAG | 10 | 10 | 0 |
| CABLE_MACHINE | 9 | 9 | 0 |
| RACK_CAGE | 8 | 7 | 1 |
| BAND_SUSPENSION | 7 | 5 | 0 |
| PLATE_LOADED_MACHINE | 6 | 6 | 0 |
| SELECTORIZED_MACHINE | 3 | 3 | 0 |
| BODYWEIGHT_GYMNASTICS | 3 | 3 | 0 |
| KETTLEBELL | 3 | 3 | 0 |
| STORAGE | 2 | 1 | 1 (+1 secondary) |
| ROPE_SLED | 2 | 2 | 0 |
| YOGA_PILATES | 2 | 2 | 0 |
| MACHINE_ATTACHMENT | 1 | 0 | 1 |
| RECOVERY_TOOL | 1 | 1 | 0 |
| APPAREL | 1 | 1 | 0 |
| **OTHER (unclassified)** | **13** | — | — (INSUFFICIENT_EVIDENCE) |
| **Total** | **200** | | (+4 secondary from multi-component bundles) |

Coverage: 187/200 products (93.5%) got a real `PRODUCT_FAMILY`. Semantic clarity and mutual distinction
were checked directly against ambiguous cases; see Section 9 for the resolved boundaries.

## 4. DISCIPLINE

Method: `DISCIPLINE` evidence is restricted to (a) literal name text, (b) `SEMANTIC_STRONG`-trust category
assignment, or (c) a structured feature value gated by product family (the `Categoría` feature = "Olímpico"
/"Preolímpico" only counts for `BARBELL`/`WEIGHT_PLATE` products). Free-text product description was
tried and explicitly rejected as an evidence source — see Section 8/17, issue `SOURCE_CONTRADICTION` on
`REHABILITATION` and `CROSSFIT`, where using description text produced 19 and 25 false-positive tags
respectively on this golden set alone, all "versatility" marketing copy ("useful for CrossFit, rehab,
conditioning...") rather than real discipline evidence.

Result: 9 of the 11 candidate disciplines have real golden-set support. **No product carries more than
one discipline tag** — once free-text and `LEGACY`-category evidence were excluded, the remaining evidence
sources turned out to be mutually exclusive in this sample (Olympic-spec bar/plate certification,
HYROX/Powerlifting/Boxing category assignment, and literal name text never co-occur on the same product).

| Discipline | Total | Explicit | Strongly inferred | Evidence basis |
| --- | ---: | ---: | ---: | --- |
| WEIGHTLIFTING | 23 | 0 | 23 | `Categoría`=Olímpico/Preolímpico feature, gated to BARBELL/WEIGHT_PLATE family |
| CARDIO_ENDURANCE | 20 | 0 | 20 | family=CARDIO_MACHINE implies the discipline |
| HYROX | 8 | 8 | 0 | `HYROX` category (SEMANTIC_STRONG) or literal name |
| POWERLIFTING | 4 | 4 | 0 | `Powerlifting`/`Discos de Powerlifting`/`Barras Powerlifting` category or literal name |
| BOXING_MMA | 3 | 3 | 0 | `Boxeo & MMA` category or literal name |
| CALISTHENICS | 3 | 0 | 3 | family=BODYWEIGHT_GYMNASTICS implies the discipline |
| YOGA_PILATES | 2 | 2 | 0 | `Yoga & Pilates` category or literal "yoga"/"pilates" in name |
| REHABILITATION | 1 | 0 | 1 | RECOVERY_TOOL family + dedicated clinical-device category (Cámaras Hiperbáricas) |
| CROSSFIT | 1 | 1 | 0 | literal "CrossFit" in name (apparel SKU) |
| FUNCTIONAL_TRAINING | 0 | — | — | DROPPED — see Section 10/17 |
| BODYBUILDING | 0 | — | — | DROPPED — see Section 10/17 |

65/200 products (32.5%) carry a discipline tag; 135 (67.5%) carry none, matching the task's expectation
that most products should not be forced into a discipline.

## 5. USE_CONTEXT

Method: primary evidence is the structured `Clasificación de Uso` feature (304 products catalog-wide), with
its 14 observed raw values normalized to 4 buckets (Home/Comercial/Semi-Comercial/Tráfico). When that
feature is absent, `HOME_GYM` may still be `STRONGLY_INFERRED` from the `Máquinas Home Gym` category — but
see Section 9/17 for why that category is unreliable as `PRODUCT_FAMILY` evidence (it is assigned to a
plain adjustable bench, id 592, not just machines). `COMMERCIAL_GYM` can also come from literal "Comercial"
in the name; `SMALL_SPACE` from "de Muro"/"Plegable"/"Pared" (wall-mounted/foldable) name evidence.

| Use context | Total | Explicit | Strongly inferred |
| --- | ---: | ---: | ---: |
| COMMERCIAL_GYM | 24 | 24 | 0 |
| HOME_GYM | 21 | 16 | 5 |
| SMALL_SPACE | 3 | 3 | 0 |
| SEMI_COMMERCIAL_STUDIO | 1 | 1 | 0 |
| CLINICAL_RECOVERY | 1 | 0 | 1 |
| OUTDOOR_HIGH_TRAFFIC | 1 | 1 | 0 |
| CROSSFIT_BOX | 0 | — | — DROPPED — see Section 10/17 |

48/200 products (24%) carry at least one use-context tag (3 products carry two: wall-mounted pulleys get
both `HOME_GYM` and `SMALL_SPACE`).

## 6. Ignore / Non-Semantic Metadata — Exclusion Rules

Reusable exclusion rules applied throughout this review (derived from `category_trust_map.csv` /
`feature_trust_map.csv`):

- **Categories**: never use `CAMPAIGN` (39, e.g. Cyberday, Winter Sale, Pesas Days), `NAVIGATION` (4, e.g.
  `CATEGORÍAS`, `COLECCIONES`), `UNKNOWN` (17, e.g. `Test`, `TESTDEPTI`), or `LEGACY` (31, e.g.
  `CrossFit HWM®`, `Zero Series`) categories as `PRODUCT_FAMILY`/`DISCIPLINE`/`USE_CONTEXT` evidence.
  `LEGACY` is the one that actually caused false positives in an earlier draft (see Section 17) — it reads
  like real semantics (a category literally named "CrossFit HWM®") but is a brand/product-line label, not
  discipline evidence.
- **Features**: never use `NOISE` (11), `PRESENTATION` (6, e.g. `Color(es)`, `Modelo`, `Acabado`), or
  `LOGISTICS` (8, e.g. `Garantía Legal`, `Servicio de Armado`) features as semantic evidence. `TECHNICAL`
  (22) features are kept for spec/explainability but not used to derive family/discipline/context tags in
  this review.
- **Free text**: product description (`shortDescription`/`fullDescription`) is not used as classification
  evidence at all in this review — see Section 4 and Section 17 for the concrete false-positive counts that
  justified dropping it.
- **Sampling metadata**: the golden set's own `reason` column (e.g. `coverage_crossfit`,
  `historical_high_revenue`) is stratification metadata, not product evidence, and was never used for
  classification.

## 7. Golden-Set Review — Deliverable

See `ontology_golden_set_reviewed.csv` (Section 16) for the full 200-row review with `productId`,
`productName`, `catalogPresence`, `primaryProductFamily`, `secondaryProductFamilies`, `disciplines`,
`useContexts`, `classificationEvidence`, `evidenceStrength`, `sourceProblems`, `ontologyProblems`, and
`reviewNotes` per product.

## 8. Ontology Problem Types Observed

Of the 10 bounded codes offered, this review actually produced instances of:

| Code | Count (rows) | Example |
| --- | ---: | --- |
| INSUFFICIENT_EVIDENCE | 13 | id 151 AbMat 1.0 — no family rule fits |
| HISTORICAL_DATA_GAP | 50 (sourceProblem on every historical-only row; 9 of those also have no family) | id 370 Pack Grip 105kg — blank catalog row |
| MULTI_COMPONENT_PRODUCT | 4 | id 1183 Pack 105kg Mancuernas Hexagonales + Rack Vertical |
| AXIS_OVERLAP | 5 | id 343/973/1862/2068/2134 Smith-machine family/name mismatch |
| MISSING_TAG | 2 rows + curated | id 82/85 Cajón Pliométrico — no family candidate fits a plyo box |
| TAG_OVERLAP | curated (design-level, not per-row) | FLOORING vs YOGA_PILATES mat boundary; PACK_SET vs family |
| TAG_TOO_BROAD | curated | `Accesorios de Weightlifting` category wrongly voting MACHINE_ATTACHMENT |
| SOURCE_CONTRADICTION | curated | `CrossFit HWM®`/description-text false positives (Section 17) |

`TAG_TOO_NARROW` and `WRONG_FAMILY` were not needed — no candidate tag was found to be too narrow, and no
row-level family assignment was left uncorrected after debugging (each `WRONG_FAMILY` case found during
rule design was fixed before finalizing, and is recorded as a `SOURCE_CONTRADICTION`/`TAG_TOO_BROAD`
curated issue instead, since the mistake was in the rule, not the surviving row).

## 9. Family Confusion Matrix

| Boundary | Resolution | Evidence |
| --- | --- | --- |
| RACK vs STORAGE | Storage/organizer wording ("almacenamiento", "rack vertical", "rack para X") is checked *before* any product-type noun, so a storage rack for a given product type is never misfiled as that product's own family. | id 389 "Rack de Almacenamiento Mancuernas" → `STORAGE`, not `DUMBBELL` |
| RACK/BENCH vs MACHINE (Smith machine) | All 5 golden-set Smith-machine products share the trusted category `Máquinas con Carga de Discos` regardless of "Jaula" (cage) or "Multifuncional" wording in the name. Classified `PLATE_LOADED_MACHINE` deterministically; naming inconsistency flagged as `AXIS_OVERLAP`. | id 343/973/1862/2068/2134 |
| CABLE_MACHINE vs MACHINE_ATTACHMENT | A product is `MACHINE_ATTACHMENT` only when the name itself signals it's an add-on (mount/anchor/accessory wording); a cable/pulley station itself is `CABLE_MACHINE`. | id 437 "Soga de Tríceps - Accesorio Polea" → `CABLE_MACHINE` (it's the accessory's own listing, named as the accessory itself) |
| FLOORING vs YOGA_MAT | Classified `YOGA_PILATES` only when name/category explicitly says "yoga" or "pilates"; generic "colchoneta" (impact/landing mat) and "tatami" default to `FLOORING`. | id 154/872/966/153 (FLOORING) vs id 2132 "Mat de Yoga TPE" / id 1711 "Balón Pilates 65cm" (YOGA_PILATES) |
| BARBELL vs PULL_UP_BAR | `BODYWEIGHT_GYMNASTICS` name patterns (paralelas, dominadas, pull-up, anillas) are checked *before* the generic `\bbarra\b` pattern, so a pull-up/parallel bar is never misfiled as `BARBELL`. | rule-level; no literal pull-up-bar SKU landed in this 200-item sample, but the ordering was verified against id 54 "Par Anillas Olímpicas de Gimnasia" → `BODYWEIGHT_GYMNASTICS` |
| RECOVERY vs REHABILITATION | Kept as genuinely separate axes: `RECOVERY_TOOL` is a `PRODUCT_FAMILY` (a physical object), `REHABILITATION` is a `DISCIPLINE` (clinical intent). Only 1 of the golden set's `RECOVERY_TOOL` product also qualifies for `REHABILITATION` (a hyperbaric chamber, id 1532) — most recovery tools (foam rollers, massage guns) carry no discipline tag at all, showing the axes are not duplicative. | id 1532 |
| PACK_SET vs underlying family | `PACK_SET` dropped entirely as a family (Section 15). A "Pack"/"Set" name gets a review note only; a genuine cross-family bundle (explicit "+" joining two distinct nouns) gets a `secondaryProductFamilies` entry and `MULTI_COMPONENT_PRODUCT` flag instead. | id 1183 (DUMBBELL+STORAGE) vs id 7 "Pack 4 Bandas de Resistencia" (BAND_SUSPENSION only, no secondary) |

## 10. Discipline Confusion

`CROSSFIT`, `HYROX`, `FUNCTIONAL_TRAINING`, `WEIGHTLIFTING`, `POWERLIFTING`, and `BODYBUILDING` were
checked for overlap:

- **CROSSFIT vs HYROX**: genuinely distinct evidence sources (CrossFit = literal name text only, after
  excluding the unreliable `CrossFit HWM®` brand category; HYROX = dedicated `HYROX` trusted category on
  kettlebells/medicine balls/sleds/climbing rope). No product in the golden set carries both.
- **WEIGHTLIFTING vs POWERLIFTING**: distinct evidence sources (WEIGHTLIFTING = Olympic-spec `Categoría`
  feature on bars/plates; POWERLIFTING = a separate branded product line, "Discos Powerlifting Chromed
  Steel | XMASTER", whose `Categoría` feature is not Olympic-tagged). No overlap observed.
- **FUNCTIONAL_TRAINING**: the category evidence that would support it (`Funcional`, `Gimnasia &
  Funcional`) is `SEMANTIC_WEAK`/`CAMPAIGN`-trust, i.e. explicitly flagged by the trust map as too broad to
  trust. Zero golden-set products qualify under an explicit/reliable rule. **Recommend DROP** (Section 14
  covers the 3 deferred axes; this is a `DISCIPLINE` tag drop, decided here).
- **BODYBUILDING**: no category or feature in either trust map maps to this concept at all. Zero support.
  **Recommend DROP.**
- **The historically most-inflated case (CROSSFIT)** is the clearest evidence that raw categories produce
  false multi-label inflation if used naively: an early draft of this review, using the `CrossFit HWM®`
  category as evidence, tagged 25 products `CROSSFIT`; restricting to name-text and `SEMANTIC_STRONG`
  categories dropped that to 1. This is the single most important corrective finding of this review for
  future classifier design (A00.3): **category-based discipline evidence must be trust-gated, and `LEGACY`
  categories must never be used**, even when their name looks like a real discipline.

## 11. Home Gym Analysis

- **Explicit evidence** (`Clasificación de Uso` = Home tiers): 16 products.
- **Strongly-inferred evidence** (`Máquinas Home Gym` category, no structured feature present): 5 products.
- **Total HOME_GYM-tagged**: 21/200 (10.5%).
- **Small-space evidence** (wall-mounted/foldable): 3 products, all also carrying `HOME_GYM` (wall-mounted
  cable pulleys and a foldable wall power rack).
- **Products plausibly home-suitable but without evidence**: many (e.g. individual dumbbells, kettlebells,
  bands could all plausibly end up in a home gym), but per the task instruction this review does **not**
  infer `HOME_GYM` merely because an individual consumer could buy the product — only 21 products carry the
  tag, all backed by a structured feature, a trusted category, or explicit name text.
- **False-positive risk finding**: the `Máquinas Home Gym` category (the source of the 5 inferred tags) is
  internally inconsistent in PrestaShop — it is assigned to product id 592, "Banco Regulable 3.0" (an
  adjustable bench, not a machine), alongside genuine home-gym multi-station machines. This confirms the
  category conflates `PRODUCT_FAMILY` and `USE_CONTEXT` semantics at the source. This review already
  guards against the worse failure mode (never using it as family evidence), but its 5 `STRONGLY_INFERRED`
  `HOME_GYM` tags should be treated as lower-confidence than the 16 explicit ones.
- **Recommendation**: **(B) explicit + strongly inferred tags**, not (A) explicit-only or (C) a separate
  derived customer model. Rationale: explicit-only would under-cover by ~24% (5/21) and forfeit real
  signal from a `SEMANTIC_STRONG` category; a derived customer model is out of scope for product ontology
  (per A00.1's own "What Not To Model" list) and belongs to a future customer-affinity stage, not this one.
  Critically: **product `HOME_GYM` suitability is not customer `HOME_GYM` identity** — this tag says a
  product is marketed/speced for home use, not that a customer who bought it is a "home gym customer";
  that inference is explicitly deferred to A01 (Customer Commercial Affinity), consistent with A00.1.

## 12. Commercial Gym Analysis

- **Explicit evidence**: 24 products, entirely from `Clasificación de Uso` = Comercial tiers or literal
  "Comercial" in the product name (e.g. "Trotadora Comercial S1 Series").
- **Semi-commercial/studio evidence**: only 1 product in this golden set (`Power Rack Alpha`, `Clasificación
  de Uso` = "USO INTENSIVO - SEMI PROFESIONAL"). The distinction between `COMMERCIAL_GYM` and
  `SEMI_COMMERCIAL_STUDIO` **is** reliably supported by the data — the underlying feature has 3 clean,
  non-overlapping tiers (Hogar/SC/Comercial) — but the golden set sample size for the SC tier (n=1) is too
  small to declare it validated at full-catalog scale. Recommend keeping the tags separate (the evidence
  is clean, not ambiguous) but re-checking frequency against the full 304-product `Clasificación de Uso`
  population before relying on it for customer-facing segmentation.
- **Outdoor/high-traffic evidence**: 1 product (flooring tile, "Tráfico alto - Uso en interiores y
  exteriores"). "Tráfico alto - Uso en interiores" (high traffic, indoors only, no outdoor claim) is folded
  into `COMMERCIAL_GYM` rather than kept as a separate outdoor signal, since it makes no outdoor claim.
- **Machine class / durability evidence**: `CARDIO_MACHINE` and `SELECTORIZED_MACHINE`/`PLATE_LOADED_MACHINE`
  products dominate the `COMMERCIAL_GYM` tag (treadmills, spin bikes, pin-loaded machines), consistent with
  the A00.1 discovery doc's observation that `Clasificación de Uso` is strongest on machines.

## 13. Historical Products

- 50/200 golden-set rows are historical-only (`catalogPresence = historical_order_detail_only`).
- **41/50 (82%) were family-classified**, entirely from clear order-line names (e.g. "Discos Powerlifting
  Chromed Steel 20kg (Par) | XMASTER" is unambiguous even with zero catalog metadata).
- **9/50 (18%) could not be classified** and were left `OTHER`/`INSUFFICIENT_EVIDENCE`: `Pack Grip 105kg`,
  `Pack Garage Kong HWM`, `Set 4 Plyo Box Apilables` (×2), and `Máquina Home Gym ULTRA/PRO FZ...` (×4). Their
  bare order-line names genuinely do not disambiguate family (a "Home Gym Machine" could be
  selectorized/plate-loaded/cable, and its current-catalog counterpart, if any, was not identity-mapped in
  this review per A00.1's own historical-only policy: "prefer mapping to current successor products only
  after a curated replacement relationship exists").
- **Discipline/context on historical rows**: only assigned when the name itself carries it (e.g.
  `POWERLIFTING` on the Chromed Steel discs, `CROSSFIT` on the one apparel SKU). Absent metadata was never
  treated as negative evidence — historical rows with no discipline tag simply have none, same as any
  current-catalog row with no matching evidence.

## 14. Keep / Drop / Defer — Deferred Axes

| Axis | Decision | Justification |
| --- | --- | --- |
| `TRAINING_OBJECTIVE` | **DEFER** | No structured feature or trusted category maps to a training-goal concept (max strength / hypertrophy / conditioning / mobility). Populating it would require free-text description inference, which Section 4/17 already shows produces false positives on this catalog. Revisit only if a structured evidence source is identified, or a downstream commercial-intelligence use case needs a distinction that `DISCIPLINE` + `PRODUCT_FAMILY` cannot already provide (in this review, `RECOVERY_TOOL`→recovery, `YOGA_PILATES`→mobility, `BARBELL`/`RACK_CAGE`/`DUMBBELL`→strength, `BALL_BAG`/`ROPE_SLED`→conditioning already cover most of what it was meant to capture). |
| `COMMERCIAL_LEVEL` | **DROP** | Proven ~1:1 redundant with `USE_CONTEXT` in this review: both would be sourced from the identical `Clasificación de Uso` feature (`HOME_LIGHT`/`HOME_REGULAR`≈`HOME_GYM`, `SEMI_COMMERCIAL`≈`SEMI_COMMERCIAL_STUDIO`, `COMMERCIAL_INTENSIVE`≈`COMMERCIAL_GYM`). Keeping both would be exactly the "ambiguous or duplicated semantics" the task's principle warns against. `COMPETITION_CERTIFIED` (the one sub-concept not already covered) has no supporting evidence in this golden set and can be revisited as a `PRODUCT_FAMILY` attribute (certification/tolerance) if needed later, not a whole new family. |
| `COMMERCIAL_ROLE` | **DROP** | Its candidate tags are each already implied by an existing `PRODUCT_FAMILY` in this review (`PROTECTION_SAFETY`≈`PROTECTIVE_GEAR`, `FLOORING_INFRASTRUCTURE`≈`FLOORING`, `STORAGE_ORGANIZATION`≈`STORAGE`, `ACCESSORY_ATTACHMENT`≈`MACHINE_ATTACHMENT`, `PACK_BUNDLE`≈the `MULTI_COMPONENT_PRODUCT` flag already implemented). `CORE_EQUIPMENT` vs accessory is a coarse binary derivable from family membership if ever needed, not a reason to keep a 7-tag family. `REPLACEMENT_PART` has zero evidence in the golden set. |

## 15. Simplified Ontology V1 (Required Output)

21 `PRODUCT_FAMILY` tags (+ `OTHER` residual), 9 `DISCIPLINE` tags, 6 `USE_CONTEXT` tags — 36 real tags
total, well under the previous 62-tag/6-family proposal.

### PRODUCT_FAMILY

| Code | Etiqueta (ES) | Definition | Positive criteria | Exclusion criteria | Real examples |
| --- | --- | --- | --- | --- | --- |
| `BARBELL` | Barras | Straight/Olympic/specialty training bars | name/category "barra" (not paralelas/dominadas/pull-up) | pull-up bars, storage racks for bars | 29, 32, 611 |
| `WEIGHT_PLATE` | Discos y Bumpers | Iron/bumper/fractional plates | name "disco"/"bumper"/"fraccional" | dumbbells, kettlebells | 824, 111, 330 |
| `DUMBBELL` | Mancuernas | Fixed/hex/adjustable dumbbells | name/category "mancuerna" | kettlebells | 230, 228, 366 |
| `KETTLEBELL` | Kettlebells | Kettlebells/clubbells | name "kettlebell"/"pesa rusa"/"clubbell" | dumbbells | 186, 183, 184 |
| `BENCH` | Bancos | Flat/adjustable/specialty benches | name "banco", GHD, hip-thrust box | machine seats that aren't standalone | 638, 1125, 1096 |
| `RACK_CAGE` | Racks y Jaulas | Power/squat racks, cages, stands | name "power rack"/"squat rack"/"jaula"/"rack" (not storage/Smith) | storage racks, Smith machines | 252, 1543, 746 |
| `CABLE_MACHINE` | Máquinas de Poleas | Cable/pulley stations | name "polea"/"crossover"/"lat pulldown"/"cable" | cable accessories sold alone as attachments | 176, 1427, 899 |
| `PLATE_LOADED_MACHINE` | Máquinas con Carga de Discos | Plate-loaded machines incl. Smith machines | name "prensa"/"carga de discos"/"smith" | selectorized (pin-stack) machines | 1273, 343, 2068 |
| `SELECTORIZED_MACHINE` | Máquinas Selectorizadas | Pin-stack guided machines | name "selectorizad"/"pila de stack"/"dual cuádriceps..." | plate-loaded machines | 1504, 1505, 1269 |
| `CARDIO_MACHINE` | Máquinas de Cardio | Treadmills, bikes, rowers, airbikes | name "trotadora"/"bicicleta"/"spinning"/"airbike"/etc. | — | 1237, 679, 779 |
| `FLOORING` | Piso y Plataformas | Rubber tiles, interlock floors, platforms, impact mats, tatami | name "palmeta"/"piso"/"tatami"/"colchoneta" (no yoga/pilates wording) | yoga/pilates mats | 319, 1198, 1322 |
| `STORAGE` | Almacenamiento | Storage racks/organizers for equipment | name/category "almacenamiento"/"rack vertical"/"rack para X" | training racks (power/squat) | 389 |
| `BALL_BAG` | Balones y Sacos | Medicine balls, slam balls, sand bags, bosu | name "balón medicinal"/"slam ball"/"sand bag"/"bosu" (no "pilates") | pilates balls | 57, 1175 n/a, 1979 |
| `ROPE_SLED` | Cuerdas y Trineos | Climbing/battle ropes, sleds | name "soga"/"cuerda"/"trineo"/"sled" | cable-machine rope accessories | 90, 901 |
| `BAND_SUSPENSION` | Bandas y Suspensión | Resistance bands, tubes, suspension anchors | name "banda"/"suspension"/"tubo elástico"/"x-mount" | lifting straps (protective) | 7, 9, 467 |
| `BODYWEIGHT_GYMNASTICS` | Calistenia y Gimnasia | Pull-up/dip bars, parallettes, rings | name "paralelas"/"dominadas"/"pull up"/"anillas"/"rampa caminata de manos" | barbell bars | 54, 1571 |
| `PROTECTIVE_GEAR` | Protección de Levantamiento | Belts, sleeves, wraps, grips, gloves, boxing wraps/gloves | name "cinturón"/"rodillera"/"muñequera"/"callera"/"guante"/"vendaje" | apparel with no protective function | 816, 1836, 1834 |
| `MACHINE_ATTACHMENT` | Accesorios de Máquina | Cable/rack/bench add-ons | name/category "accesorio" tied to a machine/rack/bench system | standalone machines | 1995 |
| `RECOVERY_TOOL` | Recuperación | Foam rollers, massage tools, hyperbaric chambers | name "foam roller"/"masajeador"/"cámara hiperbárica"/"presoterapia" | generic mobility with no recovery-device identity | 1532 |
| `YOGA_PILATES` | Yoga y Pilates | Yoga mats, pilates balls/tools | name/category "yoga"/"pilates" | generic flooring/impact mats | 2132, 1711 |
| `APPAREL` | Indumentaria | Clothing/merch | name "polera"/"crop top"/"buzo"/etc. | protective gear | 1405 |
| `OTHER` | Otro / Sin Clasificar | Residual — no reliable evidence matched any tag above | — | — | 151 (AbMat), 82/85 (plyo boxes) |

### DISCIPLINE

| Code | Etiqueta (ES) | Definition | Positive criteria | Exclusion criteria | Real examples |
| --- | --- | --- | --- | --- | --- |
| `CROSSFIT` | CrossFit | Explicit CrossFit positioning | literal "CrossFit"/"WOD" in name | `CrossFit HWM®` brand/series category alone (LEGACY-trust) | 1405 |
| `HYROX` | HYROX | Explicit HYROX positioning | `HYROX` category or literal name | — | 90, 186, 901 |
| `POWERLIFTING` | Powerlifting | Powerlifting-specific gear | `Powerlifting`/`Discos de Powerlifting` category or literal name | generic strength equipment | 1630-1633 |
| `WEIGHTLIFTING` | Halterofilia | Olympic lifting equipment | Olympic-spec `Categoría` feature on BARBELL/WEIGHT_PLATE | non-Olympic-spec bars/plates | 29, 32, 824 |
| `CALISTHENICS` | Calistenia | Bodyweight/gymnastics training | `Calistenia` category, literal name, or family=BODYWEIGHT_GYMNASTICS | barbell/rack products | 54, 1571 |
| `CARDIO_ENDURANCE` | Cardio y Resistencia | Cardio/endurance training | family=CARDIO_MACHINE | functional conditioning tools (sleds, balls) | 1237, 679 |
| `YOGA_PILATES` | Yoga y Pilates | Yoga/Pilates practice | `Yoga & Pilates` category or literal name | generic mats/flooring | 2132, 1711 |
| `BOXING_MMA` | Boxeo y MMA | Boxing/martial arts training | `Boxeo & MMA` category or literal name | generic conditioning gloves | 1834, 1835, 1836 |
| `REHABILITATION` | Rehabilitación | Clinical/therapeutic use | literal clinical wording in name, or RECOVERY_TOOL + dedicated clinical-device category | generic recovery tools (foam rollers) without clinical positioning | 1532 |

### USE_CONTEXT

| Code | Etiqueta (ES) | Definition | Positive criteria | Exclusion criteria | Real examples |
| --- | --- | --- | --- | --- | --- |
| `HOME_GYM` | Gimnasio en Casa | Marketed/speced for home use | `Clasificación de Uso`=Hogar, or `Máquinas Home Gym` category, or literal "Home Gym" in name | any product an individual could merely buy, absent the above | 176, 1427, 2061 |
| `SMALL_SPACE` | Espacio Reducido | Wall-mounted/foldable/compact design | literal "de Muro"/"Plegable"/"Pared" in name | ordinary home products with no compact-design evidence | 1427, 534, 251 |
| `COMMERCIAL_GYM` | Gimnasio Comercial | High-use public/commercial facility | `Clasificación de Uso`=Comercial/high-traffic-indoor, or literal "Comercial" in name | home-only equipment | 1237, 1504, 899 |
| `SEMI_COMMERCIAL_STUDIO` | Studio Semi-Comercial | Studio/semi-commercial tier | `Clasificación de Uso`=Semi Profesional/SC | full commercial or home-only tier | 1543 |
| `CLINICAL_RECOVERY` | Recuperación Clínica | Clinic/therapy context | literal clinical wording in name, or dedicated clinical-device category | ordinary recovery accessories | 1532 |
| `OUTDOOR_HIGH_TRAFFIC` | Alto Tráfico Exterior | Outdoor/high-traffic-rated | `Clasificación de Uso`="interiores y exteriores" | indoor-only high-traffic (folded into COMMERCIAL_GYM) | 506 |

## 16. Reviewed Golden Set (Required Output)

`ontology_golden_set_reviewed.csv` — 200 rows, one per golden-set product, columns: `productId`,
`productName`, `catalogPresence`, `primaryProductFamily`, `secondaryProductFamilies`, `disciplines`,
`useContexts`, `classificationEvidence`, `evidenceStrength`, `sourceProblems`, `ontologyProblems`,
`reviewNotes`.

Path:
`docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/ontology_golden_set_reviewed.csv`

## 17. Ontology Issues (Required Output)

`ontology_review_issues.csv` — 27 rows: 13 per-row `MISSING_TAG`/`INSUFFICIENT_EVIDENCE` issues generated
automatically from the review pass, plus 14 curated design-level issues (the `AXIS_OVERLAP`,
`SOURCE_CONTRADICTION`, `TAG_OVERLAP`, `TAG_TOO_BROAD`, and axis-drop findings documented in Sections
9/10/14 above). Columns: `issueType`, `family`, `tag`, `productId`, `productName`, `description`,
`recommendedAction`.

Path:
`docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/ontology_review_issues.csv`

## 18. Tag Coverage (Required Output)

See the count tables in Sections 3 (`PRODUCT_FAMILY`), 4 (`DISCIPLINE`), and 5 (`USE_CONTEXT`) above for
`productCount`/`explicitCount`/`inferredCount` per tag. No `ambiguousCount` column was needed: after the
rule-order and evidence-source fixes made during this review (Section 17), zero products in the reviewed
set carry two conflicting tags in the same axis — the only multi-tag cases are legitimate multi-component
bundles (`PRODUCT_FAMILY`, 4 rows) or genuinely co-occurring use contexts (`USE_CONTEXT`, 3 rows, e.g.
wall-mounted + home).

## 19. Recommended V1

**Final `PRODUCT_FAMILY`** (21 + `OTHER`): `BARBELL`, `WEIGHT_PLATE`, `DUMBBELL`, `KETTLEBELL`, `BENCH`,
`RACK_CAGE`, `CABLE_MACHINE`, `PLATE_LOADED_MACHINE`, `SELECTORIZED_MACHINE`, `CARDIO_MACHINE`,
`FLOORING`, `STORAGE`, `BALL_BAG`, `ROPE_SLED`, `BAND_SUSPENSION`, `BODYWEIGHT_GYMNASTICS`,
`PROTECTIVE_GEAR`, `MACHINE_ATTACHMENT`, `RECOVERY_TOOL`, `YOGA_PILATES`, `APPAREL`, + `OTHER` residual.

**Final `DISCIPLINE`** (9): `CROSSFIT`, `HYROX`, `POWERLIFTING`, `WEIGHTLIFTING`, `CALISTHENICS`,
`CARDIO_ENDURANCE`, `YOGA_PILATES`, `BOXING_MMA`, `REHABILITATION`.

**Final `USE_CONTEXT`** (6): `HOME_GYM`, `SMALL_SPACE`, `COMMERCIAL_GYM`, `SEMI_COMMERCIAL_STUDIO`,
`CLINICAL_RECOVERY`, `OUTDOOR_HIGH_TRAFFIC`.

**Removed tags**: `PACK_SET` (`PRODUCT_FAMILY`) — dropped, replaced by the `MULTI_COMPONENT_PRODUCT`
ontology-problem flag. `FUNCTIONAL_TRAINING`, `BODYBUILDING` (`DISCIPLINE`) — dropped, zero evidence.
`CROSSFIT_BOX` (`USE_CONTEXT`) — dropped, zero evidence.

**Merged tags**: `BOXING_MMA` — merged out of `PRODUCT_FAMILY` (every instance is already `PROTECTIVE_GEAR`
or `FLOORING`); survives only as `DISCIPLINE`.

**Deferred dimensions**: `TRAINING_OBJECTIVE` (no reliable evidence source yet — DEFER). `COMMERCIAL_LEVEL`
and `COMMERCIAL_ROLE` (proven redundant with `USE_CONTEXT`/`PRODUCT_FAMILY` — DROP, not just defer).

**Unresolved questions**:

1. Should the 13 `OTHER`-classified products (esp. the 2 plyo-box SKUs with real evidence but no family
   fit) get a new tag, or stay `OTHER` permanently? Recommend leaving as `OTHER` until conditioning-tool
   SKUs grow enough to justify a new family.
2. Are `SEMI_COMMERCIAL_STUDIO` (n=1), `CLINICAL_RECOVERY` (n=1), and `OUTDOOR_HIGH_TRAFFIC` (n=1) real at
   full-catalog scale, or golden-set sampling noise? The underlying `Clasificación de Uso` feature has 304
   products catalog-wide, so there should be more than 1 example of each — this needs a full-catalog check
   before A00.3 trusts these tags.
3. Should historical-only products ever be mapped to a current-catalog successor to recover family
   evidence for the 9 currently-unclassifiable rows? A00.1 already deferred this pending a curated mapping;
   this review did not build one.

## 20. Decision

`SIMPLIFIED_ONTOLOGY_NEEDS_REVIEW`

## 21. Next Step

Not yet cleared for `A00.2` Ontology Registry. What remains unresolved before it should be:

1. A human spot-audit of `ontology_golden_set_reviewed.csv` — particularly the 13 `OTHER` rows and the 5
   `STRONGLY_INFERRED` `PRODUCT_FAMILY` rows — since this review was executed as a debugged rule engine
   over real evidence rather than a literal per-row manual read. The rules were verified against every
   product they touched during debugging (Sections 9/17 document the bugs found and fixed), but a second
   set of eyes on the final CSV is warranted before this becomes the basis for a registry.
2. Validate `SEMI_COMMERCIAL_STUDIO`, `CLINICAL_RECOVERY`, and `OUTDOOR_HIGH_TRAFFIC` against the full
   2011-product catalog (or at least the full 304-product `Clasificación de Uso` population) — each has
   only 1 golden-set example, too thin to fully trust at v1.
3. Decide the 3 unresolved questions in Section 19.

Once those are closed, proceed to `A00.2` Ontology Registry using the 21+9+6 tag set defined in Section 15.

## 22. Known Limitations

- This review is deterministic-rule-based, not a literal manual read of 200 free-text product pages. The
  ruleset was iteratively debugged against real evidence until every rule was verified on the products it
  actually touched (documented mistakes and fixes: STORAGE-vs-product-noun keyword collision, Smith-machine
  family inconsistency, a broad category wrongly voting `MACHINE_ATTACHMENT`, and the free-text
  description false-positive pattern on `REHABILITATION`/`CROSSFIT`) — see Section 17. This is why the
  decision is `NEEDS_REVIEW`, not `READY`: the methodology is sound and inspectable, but a second
  reviewer should confirm it before it's treated as authoritative.
- Free-text `shortDescription`/`fullDescription` was deliberately excluded from all classification
  evidence after it was shown to produce false positives (Section 4/17). This is a conservative choice —
  it likely under-counts some genuinely evidenced products — but the task explicitly prioritizes precision
  over recall for discipline/context tags ("Only EXPLICIT and clearly justified STRONGLY_INFERRED
  classifications should survive into v1").
- The golden set's own `population` field (`current_active`/`current_inactive`/`historical_only`, 133/17/50)
  differs from the `catalogPresence` field used throughout this review (`current_catalog`/
  `historical_order_detail_only`, 150/50) — the former is a finer-grained stratification label from A00.1's
  sampling, the latter is the A00 export's own catalog-presence field. Both are preserved; `catalogPresence`
  is what's reported in the reviewed CSV per the task's required schema.

## Validation

- No production code, PrestaShop connection, classifier, or snapshot/affinity pipeline was touched.
- Source data: the four input CSVs supplied by the user (originally generated by A00/A00.1 tooling), read
  read-only.
- 200/200 golden-set `productId`s matched a row in `product_catalog_exploration.csv` (0 join failures).
- All classification rules were run against the full 200-row golden set and spot-checked row-by-row across
  the entire set (not sampled) during debugging.

## Final Report

CUSTOMER_INTELLIGENCE_R2_A00_1B_STATUS:

Complete as offline golden-set review. No production code, PrestaShop, classifier, or affinity snapshot
was modified. Reviewed all 200 golden-set products across `PRODUCT_FAMILY`, `DISCIPLINE`, and
`USE_CONTEXT` using a debugged, evidence-gated deterministic rule engine over real product name/category/
feature evidence, filtered by the category and feature trust maps.

DECISION:

`SIMPLIFIED_ONTOLOGY_NEEDS_REVIEW`

PRODUCT_FAMILY_RESULT:

21 of 24 candidate families survive with real golden-set evidence (`PACK_SET` and `BOXING_MMA`-as-family
rejected). 187/200 products (93.5%) got a confident family; 13 (6.5%) remain `OTHER`. Family confusion
boundaries (RACK vs STORAGE, Smith-machine hybrid, FLOORING vs YOGA_MAT, PACK_SET vs underlying family)
were each resolved with a deterministic rule, documented in Section 9.

DISCIPLINE_RESULT:

9 of 11 candidate disciplines survive (`FUNCTIONAL_TRAINING`, `BODYBUILDING` dropped — zero evidence).
65/200 products (32.5%) carry a discipline tag; zero carry more than one. The single biggest correction
made during this review was excluding the `LEGACY`-trust `CrossFit HWM®` category as discipline evidence —
using it inflated `CROSSFIT` from 1 to 25 false-positive tags on this golden set alone.

USE_CONTEXT_RESULT:

6 of 7 candidate contexts survive (`CROSSFIT_BOX` dropped — zero evidence). 48/200 products (24%) carry at
least one use-context tag, sourced almost entirely from the structured `Clasificación de Uso` feature.

HOME_GYM_RESULT:

21/200 products (10.5%): 16 explicit (structured feature), 5 strongly-inferred (category, lower
confidence — the source category is internally inconsistent, assigned even to a plain bench). Recommend
(B) explicit + strongly-inferred product tags for any future customer affinity use, never treating product
`HOME_GYM` suitability as customer `HOME_GYM` identity.

COMMERCIAL_GYM_RESULT:

24/200 products (12%) explicit `COMMERCIAL_GYM`; 1 `SEMI_COMMERCIAL_STUDIO`; 1 `OUTDOOR_HIGH_TRAFFIC`. The
Comercial/Semi-Comercial/Hogar distinction is reliably supported by the source feature, but the SC/outdoor
tiers have too few golden-set examples (n=1 each) to consider fully validated yet.

HISTORICAL_RESULT:

41/50 historical-only products (82%) were safely family-classified from clear order-line names alone; 9/50
(18%) had neither a clear name nor any catalog metadata and were left unclassified rather than guessed.

TRAINING_OBJECTIVE:

DEFER

COMMERCIAL_LEVEL:

DROP

COMMERCIAL_ROLE:

DROP

FINAL_ONTOLOGY:

3 axes, 36 tags: `PRODUCT_FAMILY` (21 + OTHER residual), `DISCIPLINE` (9), `USE_CONTEXT` (6). Full
definitions with Spanish labels, positive/exclusion criteria, and real examples in Section 15.

REMOVED_OR_MERGED_TAGS:

Removed: `PACK_SET` (PRODUCT_FAMILY), `FUNCTIONAL_TRAINING` + `BODYBUILDING` (DISCIPLINE), `CROSSFIT_BOX`
(USE_CONTEXT), `COMMERCIAL_LEVEL` + `COMMERCIAL_ROLE` (whole families, redundant with USE_CONTEXT/
PRODUCT_FAMILY). Merged: `BOXING_MMA` collapsed from PRODUCT_FAMILY into DISCIPLINE-only.

GOLDEN_SET_COVERAGE:

200/200 reviewed. `ontology_golden_set_reviewed.csv` at
`docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/`.

ONTOLOGY_ISSUES:

27 issues logged (13 per-row + 14 curated design-level) in `ontology_review_issues.csv` at the same path.
Most consequential: the `LEGACY`-category and free-text-description false-positive patterns documented in
Section 17, both fixed before finalizing this review.

NEXT_SLICE:

Not yet cleared for `A00.2` Ontology Registry. Close the 3 items in Section 21 (human spot-audit of the
reviewed CSV; full-catalog validation of the 3 thin-evidence USE_CONTEXT tags; resolve the 3 open questions
in Section 19) first.
