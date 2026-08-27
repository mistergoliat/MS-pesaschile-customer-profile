# CUSTOMER-INTELLIGENCE-R2-A00.1 Commercial Product Ontology Discovery

## Status

Discovery status: `ONTOLOGY_DISCOVERY_NEEDS_MANUAL_REVIEW`.

This audit uses the A00 export package only. It does not modify production code, PrestaShop, Catalog Service runtime, Customer Profile runtime, classifiers, customer affinity models, or storefront data.

Input artifacts:

- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-exploration/products.xlsx`
- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-exploration/product_catalog_raw.json`
- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-exploration/representative_product_sample.csv`
- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-exploration/metadata.json`
- `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00-product-dataset-exploration.md`

Derived review artifacts:

- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-discovery/category_trust_map.csv`
- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-discovery/feature_trust_map.csv`
- `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-discovery/ontology_golden_set.csv`

## Dataset Readiness

The exported catalog is suitable for ontology discovery because it includes active, inactive, and historical-only sold products with one base-product row per product and separate one-to-many evidence.

Population:

- Total products: 2011
- Current catalog products: 1550
- Historical-only valid-order products missing from current `ps_product`: 461
- Active current products: 889
- Inactive current products: 661
- Products with valid-order sales: 1737
- Products without valid-order sales: 274
- Products with combinations: 134
- Products with relationship evidence: 847

Current active products have materially better semantic coverage than inactive or historical-only products:

| Segment | Products | Revenue tax incl | Units | Description coverage | Feature coverage | Relationship coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current active | 889 | 7,763,048,405 | 230,323 | 83.6% | 99.0% | 78.0% |
| Current inactive | 661 | 2,618,300,158 | 40,215 | 62.6% | 76.6% | 12.9% |
| Historical-only | 461 | 505,945,210 | 10,318 | 0.0% | 0.0% | 15.0% |

Commercial concentration is high but not extreme. Top 200 products represent 58.4% of revenue, 70.2% of units, 61.7% of unique-customer evidence, and 63.6% of valid-order count. Ontology design should therefore not be based only on top sellers.

## Semantic Quality Assessment

The catalog has enough signal for a first ontology, but not enough for fully automated classification without manual review.

Strong signals:

- Product names are generally descriptive for equipment families: bars, plates, racks, benches, treadmills, bikes, flooring, medicine balls, kettlebells, belts, grips, and recovery products.
- Features contain structured commercial/technical semantics, especially `Clasificación de Uso`, `Categoría`, `Material`, `Marca`, `Modelo`, dimensions, load/user limits, grip/sleeve diameter, certification, and tolerances.
- Category assignments expose many real commercial families and disciplines, even though they are mixed with campaigns and navigation nodes.
- Sales aggregates allow prioritizing high-impact products during review without leaking PII.
- Relationship evidence is useful as behavioral context, especially for products with high connectivity, but should not be treated as semantic similarity by itself.

Weak signals:

- Historical-only products lack descriptions, features, categories, active status, and combinations in the current catalog export.
- Categories mix product family, discipline, environment, campaign, brand/series, and legacy/test semantics.
- Some discipline/category evidence appears underrepresented compared with description/name evidence. Example: `Calistenia` has only 1 category-assigned product but about 32 products with textual evidence.
- Broad words such as `fuerza`, `acondicionamiento`, and `cardio` are too noisy to become direct classifier rules without context.
- Variant semantics are mostly size/weight/color. They are important for merchandising, but should not multiply base ontology rows unless a variant truly changes the product family.

## Category Trust Assessment

Categories are valuable but should be used as weighted evidence, not as source-of-truth labels.

Trust map summary:

| Trust class | Category count | Use in ontology work |
| --- | ---: | --- |
| `SEMANTIC_STRONG` | 144 | Strong positive evidence when aligned with name/features |
| `SEMANTIC_WEAK` | 18 | Contextual evidence only |
| `CAMPAIGN` | 39 | Do not use as semantic tag |
| `LEGACY` | 31 | Preserve for diagnostics; weak or no ontology value |
| `NAVIGATION` | 4 | Ignore for semantic classification |
| `UNKNOWN` | 17 | Manual review |

High-count categories show the mixed taxonomy problem:

- Navigation/root: `CATEGORÍAS` has 1554 assigned products.
- Broad axes: `FUERZA` 309, `EQUIPAMIENTO` 257, `ACCESORIOS` 221, `ACONDICIONAMIENTO` 200.
- Campaigns: `CYBERDAY` 199, `PESAS DAYS` 199, `WINTER SALE` 149, `SUMMER SALE` 76, `PRIMAVERA` 73, `FALL SEASON` 66, `NAVIDAD` 50.
- Strong family categories: `Mancuernas` 110, `Discos` 107, `Bancos` 67, `Barras` 64, `Máquinas con Carga de Discos` 60, `Máquinas Home Gym` 60, `Balones & Sacos` 57, `Máquinas Multifuncionales` 53, `Mancuernas Hexagonales` 50, `Máquinas Selectorizadas` 47, `Cardio` 35, `ALMACENAMIENTO` 34, `Barras Pull Up & Push Up` 32.
- Discipline categories: `CrossFit HWM®` 30, `HYROX` 27, `Powerlifting` 8, `Calistenia` 1, `Yoga & Pilates` 1.
- Empty or near-empty discipline categories: `OCR`, `Boxeo & Artes Marciales`, and `Packs CrossFit` are present but have no assigned products in the export.
- Test categories exist and must be excluded from classifier evidence: `Test`, `TESTDEPTI`, `TEST1`, `TEST2`, `TEST3`, `TEST4`.

Recommended category policy:

- Use categories as evidence with trust weights.
- Do not directly map campaign, sale, navigation, root, test, or broad store-section categories to commercial ontology tags.
- Use strong family categories to support high-confidence classifications only when product name or features agree.
- Use discipline categories as useful but incomplete evidence; supplement with name/description/features.

## Feature Trust Assessment

Feature definitions are more structured than categories, but they are heterogeneous. The full map is in `feature_trust_map.csv`.

Trust map summary:

| Trust class | Feature count | Use in ontology work |
| --- | ---: | --- |
| `SEMANTIC` | 28 | Direct ontology evidence when value is meaningful |
| `TECHNICAL` | 22 | Useful for product specs and subtyping, not always affinity |
| `LOGISTICS` | 8 | Keep for merchandising/supply context; not semantic affinity |
| `PRESENTATION` | 6 | Low semantic value |
| `NOISE` | 11 | Do not use for classification without manual exception |

Important feature coverage:

- `Peso Neto (N.W.)`: 1187 products
- `Marca`: 1080
- `Garantía Legal`: 968
- `Material`: 947
- `Dimensiones del Empaque`: 741
- `Peso Bruto`: 718
- `Color(es)`: 490
- `Categoría`: 440
- `Dimensiones del producto`: 419
- `Tolerancia`: 390
- `Peso máximo de carga`: 357
- `Peso máximo de usuario`: 356
- `Clasificación de Uso`: 304

`Clasificación de Uso` is the strongest structured commercial-use feature. Observed values distinguish home, semi-commercial, commercial, studio, class H/S/SC, indoor/outdoor traffic, and intensive use. It should seed the `COMMERCIAL_LEVEL` family, but values must be normalized first because the same concept appears in multiple textual forms.

`Categoría` is useful for Olympic/pre-Olympic equipment semantics:

- `Olímpico`: 392 products
- `Preolímpico`: 38
- `Olímpico y Preolímpico`: 10

Recommended feature policy:

- Use `Clasificación de Uso`, `Categoría`, `Certificación`, `Material`, dimensions, capacity, and bar/plate technical fields as high-value evidence.
- Do not use warranty, color, packaging, media/presentation, or logistics fields as affinity drivers.
- Preserve technical features for explainability and merchandising filters, but do not promote every arbitrary feature into ontology fields.

## Recurring Semantic Themes

Observed product-family clusters:

| Theme | Evidence count | Example product ids |
| --- | ---: | --- |
| Olympic bars | 85 | 29, 32, 31, 611, 33 |
| Olympic plates/discs | 13 exact phrase, broader disc family 107+ category products | 1001, 2032, 1902 |
| Hex dumbbells | 49 | 235, 1026, 630, 236, 631 |
| Kettlebells | 39 | 186, 185, 184, 183, 187 |
| Adjustable benches | 28 | 638, 212, 1338, 439, 1550 |
| Treadmills | 19 | 1237, 1238, 458, 1264, 461 |
| Bikes/spinning | 26 | 679, 1486, 430, 1161, 1487 |
| Cable/pulley products | 60 | 534, 1427, 1517, 1506, 289 |
| Power racks | 22 | 252, 1543, 887, 251, 760 |
| Squat racks | 14 | 746, 761, 392, 1545 |
| Rubber tiles/flooring | 15+ | 723, 319, 506, 722 |
| Bands | 20 | 7, 9, 10, 8, 11 |
| Grips/calleras | 21 | 810, 811, 809 |
| Lifting belts | 38 | 816, 818, 814 |
| Foam/recovery | 11+ | 168, 1854, 1855 |
| Medicine balls | 42 | 57, 58, 59 |
| Slam balls | 7 | 1175, 1176, 50 |
| Sand bags | 14 | 1443, 1441 |

Observed discipline/context signals:

| Signal | Products with evidence | Notes |
| --- | ---: | --- |
| CrossFit | 286 broad evidence, 30 category-assigned, 25 tagged, 19 name-based | High commercial value; many matches are description/context evidence and need review |
| WOD | 26 | Strong discipline/context evidence for bars and plates |
| HYROX | 33 broad evidence, 27 category-assigned | Strong emerging discipline signal |
| Powerlifting | 96 broad evidence, 8 category-assigned | Strong in descriptions/name, weak category coverage |
| Weightlifting/Halterofilia | 115 broad evidence | Strong for bars, bumpers, fractional plates, crash pads |
| Calisthenics | 32 broad evidence, 1 category-assigned | Category underrepresents the commercial theme |
| Yoga/Pilates | 35 broad evidence, 1 category-assigned | Mixed with mobility and accessories |
| Boxeo/MMA | 52 broad evidence, 0 category-assigned in matching categories | Requires manual validation because some broad matches are contextual |
| Home gym | 354 broad evidence | Important customer-use context, not a product family |
| Commercial use | 477 broad evidence | Important commercial level/context, not product family |
| Semi-commercial | 145 broad evidence | Useful bridge for studios and small facilities |
| Rehab/recovery | 14 rehab, 26 recovery | Small but strategically distinct |

## Ontology V1 Proposal

Use a multi-label ontology with bounded families. Do not force a product into exactly one commercial bucket. Each tag should carry evidence and confidence.

Proposed top-level families:

| Family | Purpose | Cardinality per product |
| --- | --- | --- |
| `PRODUCT_FAMILY` | What the product physically is | Required for current-catalog products when evidence exists; usually 1-3 |
| `DISCIPLINE` | Sport/training discipline explicitly supported | Optional, multi-label |
| `USE_CONTEXT` | Where/by whom it is intended to be used | Optional, multi-label |
| `TRAINING_OBJECTIVE` | Training goal enabled by the product | Optional, multi-label |
| `COMMERCIAL_LEVEL` | Durability/use intensity tier | Optional, normally 0-1 |
| `COMMERCIAL_ROLE` | Buying role in assortment or project | Optional, multi-label |

### PRODUCT_FAMILY Tags

| Code | Label | Definition | Evidence | Exclusions | Examples |
| --- | --- | --- | --- | --- | --- |
| `BARBELL_BARS` | Barras | Straight, specialty, Olympic, pre-Olympic, curl, trap, or training bars | name/category/features `barra`, diameters, sleeves, bearings | pull-up bars, rack bars | 29, 32, 31 |
| `WEIGHT_PLATES` | Discos y bumpers | Olympic/pre-Olympic iron, rubber, bumper, fractional, calibrated plates | name/category `disco`, `bumper`, feature `Categoría` | dumbbells, kettlebells | 1001, 2032 |
| `DUMBBELLS` | Mancuernas | Fixed, adjustable, hex, vinyl, cast iron dumbbells and dumbbell sets | name/category `mancuerna` | bars, kettlebells | 235, 1183 |
| `KETTLEBELLS_CLUBBELLS` | Kettlebells y clubbells | Kettlebells, steel kettlebells, clubbells/maces | name/category | dumbbells, balls | 186 |
| `BENCHES` | Bancos | Flat, adjustable, utility, hip-thrust, preacher, and multifunction benches | name/category `banco` | rack seats inside machines | 638, 1550 |
| `RACKS_CAGES_STANDS` | Racks, jaulas y soportes | Power racks, squat racks, cages, stands, pull-up structures | name/category | storage racks unless primary function is storage | 252, 1543 |
| `CABLE_PULLEY_SYSTEMS` | Poleas y cable | Cable machines, wall pulleys, crossovers, lat pulldowns, cable stations | name/category `polea`, `crossover`, `pulldown` | cable accessories only | 534, 1427, 1517 |
| `PLATE_LOADED_MACHINES` | Máquinas con carga de discos | Machines loaded with external plates | category/name/features | free-weight racks | 1273 |
| `SELECTORIZED_MACHINES` | Máquinas selectorizadas | Pin/stack machines and guided commercial stations | category/name | plate-loaded machines | 1504, 1505 |
| `CARDIO_MACHINES` | Cardio | Treadmills, bikes, rowers, ski machines, ellipticals, stair climbers, air bikes | name/category | battle ropes, sleds | 1237, 679, 779 |
| `FLOORING_PLATFORMS` | Piso y plataformas | Rubber tiles, interlock floors, tatami, lifting platforms | name/category `piso`, `palmeta`, `tatami`, `plataforma` | mats for yoga only | 723, 319, 1198, 1322 |
| `STORAGE_ORGANIZERS` | Almacenamiento | Weight trees, dumbbell racks, bar holders, wall storage | category/name `almacenamiento`, `rack vertical` | training racks | 1183 |
| `FUNCTIONAL_BALLS_BAGS` | Balones, sacos y cargas | Medicine balls, slam balls, wall balls, sand bags, power bags | name/category | boxing heavy bags when striking-specific | 57, 1175, 1443 |
| `ROPES_SLEDS_CONDITIONING` | Cuerdas, trineos y acondicionamiento | Battle ropes, climbing ropes, sleds, agility/conditioning gear | name/category | cable machine ropes | 90 |
| `BANDS_SUSPENSION` | Bandas y suspensión | Resistance bands, mini bands, suspension straps, rings when sold as suspension | name/category | belts/straps for lifting | 7 |
| `BODYWEIGHT_GYMNASTICS` | Calistenia y gimnasia | Pull-up bars, dip bars, parallettes, rings, handstand/gymnastics accessories | name/category | barbell bars | 934 |
| `PROTECTIVE_LIFTING_GEAR` | Protección de levantamiento | Belts, knee sleeves, wrist wraps, grips/calleras, straps | name/category | apparel without protective function | 810, 816 |
| `MACHINE_ATTACHMENTS` | Accesorios de máquinas | Handles, cable bars, grips, landmine, machine attachments | name/category | full machines | review required |
| `MOBILITY_RECOVERY_TOOLS` | Movilidad y recuperación | Foam rollers, massage balls, massage guns, compression boots, hyperbaric chamber | name/category/features | yoga mats unless recovery-oriented | 1532, 1649 |
| `YOGA_PILATES_TOOLS` | Yoga y pilates | Yoga mats, Pilates balls, blocks, balance pads, sliding discs | name/category | rubber gym flooring | 161 |
| `BOXING_MMA_GEAR` | Boxeo y artes marciales | Tatami, striking gear, boxing/MMA training accessories | name/category | general conditioning ropes unless explicit | 1322 |
| `APPAREL_MERCH` | Indumentaria y merchandising | Clothing, merch, non-equipment wearables | name/category | protective lifting gear | KILO APPAREL products |
| `SETS_PACKS` | Sets y packs | Bundled products whose main sellable unit is a curated pack/set | name `pack`, `set` | single items sold by unit | 723, 537, 1183 |
| `OTHER_ACCESSORY` | Otro accesorio | Commercially relevant accessories not covered above | name/category | use only after review | review required |

### DISCIPLINE Tags

| Code | Label | Definition | Evidence | Exclusions | Examples |
| --- | --- | --- | --- | --- | --- |
| `CROSSFIT` | CrossFit | Products explicitly positioned for CrossFit, boxes, WOD, functional competition | category/tags/name/description | generic strength products with no discipline signal | 29, 32, 779 |
| `HYROX` | HYROX | Products explicitly assigned or described for HYROX-style competition/training | category/name/description | general conditioning unless explicit | 57, 90, 186 |
| `POWERLIFTING` | Powerlifting | Squat, bench, deadlift and powerlifting-specific gear | category/name/description | generic bodybuilding machines | 252, 7, 816 |
| `WEIGHTLIFTING` | Halterofilia | Olympic lifting and weightlifting equipment | name/description/features/certification | generic strength without Olympic lifting signal | 29, 32 |
| `FUNCTIONAL_TRAINING` | Entrenamiento funcional | General functional/conditioning equipment not limited to CrossFit/HYROX | name/category/description | pure machine bodybuilding | 57, 1175, 1443 |
| `BODYBUILDING_HYPERTROPHY` | Musculación e hipertrofia | Machines, benches, cable and isolation equipment for muscle development | name/category/description | sport-specific bars without hypertrophy context | 1504, 1273 |
| `CALISTHENICS` | Calistenia | Bodyweight, pull-up, dip, parallettes, rings, suspension training | name/category/description | barbell racks unless bodyweight function explicit | 934 |
| `CARDIO_ENDURANCE` | Cardio y resistencia | Running, cycling, rowing, air resistance and endurance equipment | name/category | functional sleds unless cardio positioned | 1237, 679 |
| `YOGA_PILATES` | Yoga y Pilates | Products explicitly for yoga, Pilates, mobility classes | name/category | general floor tiles | 161 |
| `BOXING_MMA` | Boxeo y MMA | Martial arts/boxing training products | category/name | generic conditioning unless explicit striking context | 1322 |
| `REHABILITATION` | Rehabilitación | Clinical, therapeutic, recovery, and rehab-oriented products | name/category/description | generic mobility with no therapy signal | 1532, 1649 |

### USE_CONTEXT Tags

| Code | Label | Definition | Evidence | Exclusions | Examples |
| --- | --- | --- | --- | --- | --- |
| `HOME_GYM` | Home gym | Intended for home use or home gym assembly | feature `Clasificación de Uso`, category/name/description | products only bought by households without explicit home suitability | 1427, 1550 |
| `SMALL_SPACE` | Espacio reducido | Wall-mounted, foldable, compact, apartment/small-room suitable | name/dimensions/description | ordinary home products with no compact evidence | 1427 |
| `COMMERCIAL_GYM` | Gimnasio comercial | High-use public gym context | `Clasificación de Uso`, commercial language | home-only equipment | 1237, 1504 |
| `STUDIO_SEMI_COMMERCIAL` | Studio/semi-comercial | Studio, semi-commercial, class SC or regular institutional use | `Clasificación de Uso` | full commercial class when explicit | 679 |
| `CROSSFIT_BOX` | Box funcional | Box, WOD, CrossFit facility context | category/tags/description | general commercial gym | 29, 779 |
| `CLINICAL_RECOVERY` | Clínica/recuperación | Clinic, therapy, recovery center context | name/features/description | ordinary mobility accessory | 1532, 1649 |
| `OUTDOOR_HIGH_TRAFFIC` | Alto tráfico exterior | Flooring/equipment for high traffic or outdoor use | feature `Clasificación de Uso`, material | indoor-only equipment | selected flooring products |

### TRAINING_OBJECTIVE Tags

| Code | Label | Definition | Evidence | Exclusions | Examples |
| --- | --- | --- | --- | --- | --- |
| `MAX_STRENGTH` | Fuerza máxima | Heavy lifting, rack/bar/plate/powerlifting use | name/category/description | light rehab only | 252, 29 |
| `HYPERTROPHY` | Hipertrofia | Muscle isolation and bodybuilding development | machines/cable/bench descriptions | pure cardio | 1504, 1273 |
| `CONDITIONING` | Acondicionamiento | Metabolic conditioning, mixed-modal work capacity | balls/bags/ropes/airbike/sleds | steady-state cardio only | 779, 1175 |
| `CARDIO_ENDURANCE` | Resistencia cardiovascular | Running, cycling, rowing and aerobic endurance | cardio machine name/category | generic functional conditioning | 1237, 679 |
| `MOBILITY_FLEXIBILITY` | Movilidad/flexibilidad | Mobility, stretching and range-of-motion tools | yoga, bands, rollers | strength bands used only as resistance | 161 |
| `RECOVERY` | Recuperación | Massage, compression, hyperbaric, soft-tissue recovery | recovery names/categories | general mobility with no recovery signal | 1532, 1649 |
| `REHAB_PREHAB` | Rehab/prehab | Injury prevention, rehabilitation, therapeutic exercise | rehab/therapy evidence | performance-only equipment | 1649 |
| `SKILL_TECHNIQUE` | Técnica/habilidad | Olympic technique, gymnastics skill, jump rope, balance/coordination | name/description | generic accessories | 934 |

### COMMERCIAL_LEVEL Tags

| Code | Label | Definition | Evidence | Exclusions | Examples |
| --- | --- | --- | --- | --- | --- |
| `HOME_LIGHT` | Hogar bajo uso | Low-use home equipment | `Clasificación de Uso` low/home | regular or commercial use | feature-derived |
| `HOME_REGULAR` | Hogar uso regular | Regular home use | `Clasificación de Uso` regular/home | commercial | feature-derived |
| `SEMI_COMMERCIAL` | Semi-comercial/studio | Studio or semi-commercial tier | `Clasificación de Uso`, class SC | full commercial class S | feature-derived |
| `COMMERCIAL_INTENSIVE` | Comercial intensivo | High-use commercial class | `Clasificación de Uso`, class S, commercial descriptions | home-only | 1237, 1504 |
| `COMPETITION_CERTIFIED` | Competición/certificado | Competition-standard or certified equipment | certification/tolerance/product description | ordinary Olympic size without competition claim | Olympic bars/plates with certification |

### COMMERCIAL_ROLE Tags

| Code | Label | Definition | Evidence | Exclusions | Examples |
| --- | --- | --- | --- | --- | --- |
| `CORE_EQUIPMENT` | Equipo central | Main equipment that defines a workout station or category | family + price/sales context | small attachments | 1237, 252 |
| `ACCESSORY_ATTACHMENT` | Accesorio/attachment | Add-on used with another product/system | name/category | standalone machines | cable handles |
| `PROTECTION_SAFETY` | Protección/seguridad | Safety or injury-prevention role | protective family | apparel style only | 810, 816 |
| `FLOORING_INFRASTRUCTURE` | Infraestructura de piso | Flooring/platform infrastructure | flooring family | yoga mats | 723 |
| `STORAGE_ORGANIZATION` | Organización | Storage or organization role | storage family | training racks | 1183 |
| `PACK_BUNDLE` | Pack/bundle | Bundle sold as a commercial package | name `pack`/`set` | single item | 723, 537 |
| `REPLACEMENT_PART` | Repuesto | Replacement part or maintenance item | name/features | normal accessory | review required |

The proposed bounded registry contains 62 tags across six families. This is inside the requested 50-80 tag ceiling and avoids customer-archetype labels.

## Example Classifications For Review

These are proposal examples only. They are not classifier output and should be manually validated before implementation.

| productId | Product | Proposed tags | Evidence | Status | Ambiguity |
| ---: | --- | --- | --- | --- | --- |
| 723 | Pack 10 Palmetas de Caucho 100x100cm 15mm | `PRODUCT_FAMILY:FLOORING_PLATFORMS`; `COMMERCIAL_ROLE:FLOORING_INFRASTRUCTURE,PACK_BUNDLE`; `USE_CONTEXT:CROSSFIT_BOX,COMMERCIAL_GYM` | name, category, sales | mixed explicit/inferred | Context depends on category/description, not name alone |
| 319 | Palmeta de Caucho 100x100cm 15mm (Unidad) | `PRODUCT_FAMILY:FLOORING_PLATFORMS`; `COMMERCIAL_ROLE:FLOORING_INFRASTRUCTURE` | name, category | explicit | Use context needs features/description |
| 534 | Polea de Muro 2.0 ZR Series \| PROmachine | `PRODUCT_FAMILY:CABLE_PULLEY_SYSTEMS`; `USE_CONTEXT:HOME_GYM,SMALL_SPACE`; `TRAINING_OBJECTIVE:HYPERTROPHY` | name, categories, features | mixed | Inactive product; confirm replacement/successor |
| 252 | Power Rack Hell Series \| HWM® | `PRODUCT_FAMILY:RACKS_CAGES_STANDS`; `DISCIPLINE:POWERLIFTING,CROSSFIT`; `TRAINING_OBJECTIVE:MAX_STRENGTH`; `COMMERCIAL_ROLE:CORE_EQUIPMENT` | name, categories, relationships | mixed | Inactive; CrossFit context should be reviewed |
| 1427 | Polea de Muro 1.0 ZR Series \| PROmachine | `PRODUCT_FAMILY:CABLE_PULLEY_SYSTEMS`; `USE_CONTEXT:HOME_GYM,SMALL_SPACE`; `TRAINING_OBJECTIVE:HYPERTROPHY` | name, features, categories | high | Context depends on wall-mounted evidence |
| 1237 | Trotadora Comercial S1 Series LED \| Obelix® | `PRODUCT_FAMILY:CARDIO_MACHINES`; `DISCIPLINE:CARDIO_ENDURANCE`; `USE_CONTEXT:COMMERCIAL_GYM`; `TRAINING_OBJECTIVE:CARDIO_ENDURANCE`; `COMMERCIAL_LEVEL:COMMERCIAL_INTENSIVE` | name, features | explicit | Low ambiguity |
| 679 | Bicicleta de Spinning SP9 \| Obelix | `PRODUCT_FAMILY:CARDIO_MACHINES`; `DISCIPLINE:CARDIO_ENDURANCE`; `USE_CONTEXT:STUDIO_SEMI_COMMERCIAL,COMMERCIAL_GYM`; `TRAINING_OBJECTIVE:CARDIO_ENDURANCE` | name, category, features | high | Studio vs commercial should come from use-class feature |
| 176 | Crossover Lat Pulldown ZR Series \| PROmachine | `PRODUCT_FAMILY:CABLE_PULLEY_SYSTEMS`; `TRAINING_OBJECTIVE:HYPERTROPHY`; `USE_CONTEXT:COMMERCIAL_GYM` | name, categories, features | high | Home/commercial requires feature confirmation |
| 638 | Banco Regulable Amarillo Flúor \| KONG | `PRODUCT_FAMILY:BENCHES`; `TRAINING_OBJECTIVE:MAX_STRENGTH,HYPERTROPHY`; `COMMERCIAL_ROLE:CORE_EQUIPMENT` | name, category, sales | mixed | Color is not semantic |
| 1504 | Dual Cuádriceps / Femoral Sentado MO 2.0 \| Obelix® | `PRODUCT_FAMILY:SELECTORIZED_MACHINES`; `TRAINING_OBJECTIVE:HYPERTROPHY`; `USE_CONTEXT:COMMERCIAL_GYM`; `COMMERCIAL_LEVEL:COMMERCIAL_INTENSIVE` | name, features, categories | high | Low ambiguity |
| 1125 | Cajón Hip Thrust Acolchado \| FullFit | `PRODUCT_FAMILY:BENCHES`; `DISCIPLINE:BODYBUILDING_HYPERTROPHY`; `TRAINING_OBJECTIVE:HYPERTROPHY`; `COMMERCIAL_ROLE:CORE_EQUIPMENT` | name, category | mixed | Could also be functional accessory |
| 29 | Barra Olímpica 15kg 220cm Eco Serie \| PROmachine | `PRODUCT_FAMILY:BARBELL_BARS`; `DISCIPLINE:WEIGHTLIFTING,CROSSFIT`; `TRAINING_OBJECTIVE:MAX_STRENGTH,SKILL_TECHNIQUE`; `COMMERCIAL_LEVEL:COMPETITION_CERTIFIED` when certified | name, features, category | high | Certification must be feature-derived |
| 32 | Barra Olímpica 20kg Training \| HWM® | `PRODUCT_FAMILY:BARBELL_BARS`; `DISCIPLINE:WEIGHTLIFTING,CROSSFIT`; `TRAINING_OBJECTIVE:MAX_STRENGTH,SKILL_TECHNIQUE` | name, category, relationships | high | Competition tier only if explicit |
| 1198 | Piso de Caucho Interlock 100x100cm x 15mm Sin Bordes | `PRODUCT_FAMILY:FLOORING_PLATFORMS`; `COMMERCIAL_ROLE:FLOORING_INFRASTRUCTURE` | name, category | explicit | Context optional |
| 1338 | Banco Regulable Negro \| KONG | `PRODUCT_FAMILY:BENCHES`; `TRAINING_OBJECTIVE:MAX_STRENGTH,HYPERTROPHY` | name, category | high | Color ignored |
| 1505 | Dual Abductor / Aductor MO 2.0 \| Obelix® | `PRODUCT_FAMILY:SELECTORIZED_MACHINES`; `TRAINING_OBJECTIVE:HYPERTROPHY`; `USE_CONTEXT:COMMERCIAL_GYM` | name, features | high | Low ambiguity |
| 779 | Airbike Hurricane 3.0 \| HWM® | `PRODUCT_FAMILY:CARDIO_MACHINES`; `DISCIPLINE:CROSSFIT,FUNCTIONAL_TRAINING,CARDIO_ENDURANCE`; `TRAINING_OBJECTIVE:CONDITIONING,CARDIO_ENDURANCE` | name, category, relationships | high | Discipline order should be evidence-weighted |
| 1273 | Prensa Inclinada 45° Lineal MO 2.0 \| Obelix® | `PRODUCT_FAMILY:PLATE_LOADED_MACHINES`; `TRAINING_OBJECTIVE:HYPERTROPHY,MAX_STRENGTH`; `USE_CONTEXT:COMMERCIAL_GYM` | name, category/features | high | Load type should be feature/category-confirmed |
| 537 | Set 50kg Maletín Cast Iron | `PRODUCT_FAMILY:WEIGHT_PLATES`; `COMMERCIAL_ROLE:PACK_BUNDLE`; `USE_CONTEXT:HOME_GYM`; `TRAINING_OBJECTIVE:MAX_STRENGTH` | name, category | mixed | Could be dumbbell/bar set; verify contents |
| 343 | Jaula Smith Machine \| PROmachine | `PRODUCT_FAMILY:RACKS_CAGES_STANDS,SELECTORIZED_MACHINES`; `TRAINING_OBJECTIVE:HYPERTROPHY,MAX_STRENGTH`; `USE_CONTEXT:COMMERCIAL_GYM` | name, categories | mixed | Hybrid machine/rack product |
| 1551 | Banco Multifunción Leg/Curl Extension ZR Series \| PROmachine | `PRODUCT_FAMILY:BENCHES`; `TRAINING_OBJECTIVE:HYPERTROPHY`; `USE_CONTEXT:HOME_GYM,SMALL_SPACE` | name, category/features | mixed | Could overlap with machine accessory |
| 1183 | Pack 105kg Mancuernas Hexagonales + Rack Vertical \| HWM® | `PRODUCT_FAMILY:DUMBBELLS,STORAGE_ORGANIZERS`; `COMMERCIAL_ROLE:PACK_BUNDLE,STORAGE_ORGANIZATION`; `TRAINING_OBJECTIVE:MAX_STRENGTH,HYPERTROPHY` | name, categories | explicit | Multi-family bundle |
| 1550 | Banco Regulable Alpha \| HWM® | `PRODUCT_FAMILY:BENCHES`; `USE_CONTEXT:HOME_GYM`; `TRAINING_OBJECTIVE:MAX_STRENGTH,HYPERTROPHY` | name, categories/features | high | Home context must be evidence-backed |
| 7 | Pack 4 Bandas de Resistencia \| HWM® | `PRODUCT_FAMILY:BANDS_SUSPENSION`; `DISCIPLINE:POWERLIFTING,CALISTHENICS`; `TRAINING_OBJECTIVE:MOBILITY_FLEXIBILITY,REHAB_PREHAB,MAX_STRENGTH`; `COMMERCIAL_ROLE:PACK_BUNDLE` | name, category/description | mixed | Very multi-use; needs controlled multi-labeling |
| 1532 | Cámara Hiperbárica ST801 1.5ATA \| O2Life | `PRODUCT_FAMILY:MOBILITY_RECOVERY_TOOLS`; `DISCIPLINE:REHABILITATION`; `USE_CONTEXT:CLINICAL_RECOVERY`; `TRAINING_OBJECTIVE:RECOVERY,REHAB_PREHAB` | name, brand/category | high | Distinct non-gym recovery product |
| 1649 | Botas de Compresión Therapy Boots 6.0 \| O2Life | `PRODUCT_FAMILY:MOBILITY_RECOVERY_TOOLS`; `TRAINING_OBJECTIVE:RECOVERY,REHAB_PREHAB`; `USE_CONTEXT:CLINICAL_RECOVERY` | name/category | high | Low ambiguity |
| 186 | Kettlebell Acero 20kg \| HWM® | `PRODUCT_FAMILY:KETTLEBELLS_CLUBBELLS`; `DISCIPLINE:FUNCTIONAL_TRAINING,HYROX,CROSSFIT`; `TRAINING_OBJECTIVE:CONDITIONING,MAX_STRENGTH` | name, category | mixed | Discipline requires category/description support |
| 57 | Balón Medicinal 5kg Color Series \| HWM® | `PRODUCT_FAMILY:FUNCTIONAL_BALLS_BAGS`; `DISCIPLINE:HYROX,CROSSFIT,FUNCTIONAL_TRAINING`; `TRAINING_OBJECTIVE:CONDITIONING` | name, category | high | Exact discipline depends on category |
| 90 | Soga de Trepa 7mt \| HWM® | `PRODUCT_FAMILY:ROPES_SLEDS_CONDITIONING`; `DISCIPLINE:CROSSFIT,HYROX,FUNCTIONAL_TRAINING`; `TRAINING_OBJECTIVE:CONDITIONING,SKILL_TECHNIQUE` | name/category | high | Low ambiguity |
| 934 | Barras Paralelas Ajustables 77-98cm (Par) \| HWM | `PRODUCT_FAMILY:BODYWEIGHT_GYMNASTICS`; `DISCIPLINE:CALISTHENICS`; `TRAINING_OBJECTIVE:SKILL_TECHNIQUE,MAX_STRENGTH` | name/category | high | Low ambiguity |
| 810 | Calleras Stone 1.0 Con 3 Orificios Verde (Par) \| HWM | `PRODUCT_FAMILY:PROTECTIVE_LIFTING_GEAR`; `DISCIPLINE:CROSSFIT,GYMNASTICS`; `COMMERCIAL_ROLE:PROTECTION_SAFETY` | name/category | high | Color ignored |
| 816 | Cinturón de Levantamiento Heavy Duty \| HWM | `PRODUCT_FAMILY:PROTECTIVE_LIFTING_GEAR`; `DISCIPLINE:POWERLIFTING,WEIGHTLIFTING`; `TRAINING_OBJECTIVE:MAX_STRENGTH`; `COMMERCIAL_ROLE:PROTECTION_SAFETY` | name/category | high | Discipline order needs evidence weights |
| 1322 | Tatami Eva Mat Negro/Gris Puzzle c/borde 100x100cm 20mm | `PRODUCT_FAMILY:FLOORING_PLATFORMS,BOXING_MMA_GEAR`; `DISCIPLINE:BOXING_MMA`; `COMMERCIAL_ROLE:FLOORING_INFRASTRUCTURE` | name/category | mixed | Could be generic flooring unless martial-art category exists |
| 161 | Mat de Yoga 6mm \| Mindfullness | `PRODUCT_FAMILY:YOGA_PILATES_TOOLS`; `DISCIPLINE:YOGA_PILATES`; `TRAINING_OBJECTIVE:MOBILITY_FLEXIBILITY` | name/category | explicit | Low ambiguity |
| 1443 | Pack 5 Sand Bags Training \| HWM® | `PRODUCT_FAMILY:FUNCTIONAL_BALLS_BAGS`; `DISCIPLINE:FUNCTIONAL_TRAINING,CROSSFIT,HYROX`; `TRAINING_OBJECTIVE:CONDITIONING`; `COMMERCIAL_ROLE:PACK_BUNDLE` | name/category | mixed | HYROX only if explicit category/description |
| 1175 | Slam Ball Smooth 100lbs \| HWM | `PRODUCT_FAMILY:FUNCTIONAL_BALLS_BAGS`; `DISCIPLINE:FUNCTIONAL_TRAINING,CROSSFIT`; `TRAINING_OBJECTIVE:CONDITIONING` | name/category | high | Low ambiguity |
| 1486 | Bicicleta de Spinning 850S \| VORTEC | `PRODUCT_FAMILY:CARDIO_MACHINES`; `DISCIPLINE:CARDIO_ENDURANCE`; `TRAINING_OBJECTIVE:CARDIO_ENDURANCE`; `USE_CONTEXT:STUDIO_SEMI_COMMERCIAL` if feature-backed | name/features | high | Use context feature-dependent |

## Golden Set

Generated file: `ontology_golden_set.csv`.

Golden set size: 200 products.

Population mix:

- Current active: 133
- Current inactive: 17
- Historical-only: 50

Stratification reasons:

- High revenue current active: 45
- High revenue current inactive: 17
- Historical high revenue: 25
- Coverage slices across recurring themes: 113

Theme coverage intentionally includes bars, plates, dumbbells, kettlebells, benches, bikes, treadmills, racks, pulleys, machines, flooring, storage, bands, grips, belts, knee sleeves, balls, ropes, sand bags, slam balls, recovery, calisthenics, HYROX, CrossFit, Powerlifting, Yoga/Pilates, and Boxeo/MMA.

Recommended review workflow:

1. Manually assign ontology tags for all 200 golden-set rows.
2. Mark evidence type per tag: explicit structured feature, explicit category, explicit name, explicit description, inferred, or rejected.
3. Record ambiguous cases and missing ontology tags.
4. Use the reviewed set as classifier tests before classifying the full 2011-product universe.

## Classification Pipeline Design

Recommended future implementation sequence:

1. Load A00-style product evidence snapshot.
2. Normalize text, categories, feature values, and combination summaries without mutating source data.
3. Apply the category trust map and feature trust map.
4. Run deterministic high-confidence rules for obvious product families and structured use classifications.
5. Produce LLM-assisted proposals only for uncertain or multi-label cases, constrained to the approved ontology registry.
6. Validate proposals against the golden set and reject outputs with unsupported tags.
7. Persist a product semantic snapshot with evidence, confidence, and review status.
8. Consume only reviewed or confidence-thresholded tags in later customer-affinity work.

Do not calculate customer affinity directly from raw categories. Do not use relationship snapshots as semantic tags. Relationship data may support review prioritization and co-purchase context only.

## What Not To Model In V1

Exclude from ontology tags:

- Campaigns and promotions: Cyberday, Black Friday, Winter Sale, Summer Sale, Navidad, Pesas Days.
- Root/navigation nodes: `CATEGORÍAS`, `FUERZA`, `EQUIPAMIENTO`, `ACCESORIOS` unless used only as weak context.
- Test/legacy categories.
- Color as a semantic preference unless a future merchandising use case requires it.
- Warranty, package dimensions, media/presentation fields, stock status, and logistics.
- Brand/manufacturer as an affinity ontology tag. Keep brand as a separate product attribute.
- Every weight/size variant as a separate semantic tag.
- Customer archetypes such as home-gym user, CrossFit customer, powerlifter customer, or commercial buyer. Those belong to future customer-affinity modeling, not product ontology.

## Historical-Only Policy

Historical-only products should remain in the semantic corpus because they represent real commercial behavior. However:

- Treat missing current-catalog fields as unknown, not negative evidence.
- Classify from historical name and order detail only when the name is strong enough.
- Lower confidence when descriptions, features, categories, and combinations are unavailable.
- Prefer mapping to current successor products only after a curated replacement relationship exists.
- Include historical-only rows in golden-set review because they may explain customer purchase histories.

## Future Product Semantic Snapshot

Recommended future storage shape:

| Field | Meaning |
| --- | --- |
| `snapshotId` | Immutable run id/version |
| `generatedAt` | Snapshot generation time |
| `ontologyVersion` | Approved ontology version |
| `productId` | Base product id |
| `catalogPresence` | current_active, current_inactive, historical_only |
| `family` | Ontology family such as `PRODUCT_FAMILY` |
| `code` | Ontology tag code |
| `label` | Human-readable label |
| `relevance` | high, medium, low |
| `confidence` | high, medium, low |
| `evidenceType` | structured_feature, category, name, description, relationship_context, inferred |
| `evidenceJson` | Bounded evidence excerpts and source ids |
| `sourceTextHash` | Hash of normalized source evidence |
| `reviewStatus` | unreviewed, accepted, rejected, needs_review |
| `reviewerNotes` | Manual notes, no PII |

Store tags as rows rather than wide columns so products can carry multiple families and multiple tags per family.

## Customer Affinity Relevance

Future customer commercial affinity should use product ontology tags only after product-level validation.

Most useful for affinity:

- `DISCIPLINE`
- `USE_CONTEXT`
- `TRAINING_OBJECTIVE`
- `PRODUCT_FAMILY`
- `COMMERCIAL_LEVEL`

Useful for purchase-role interpretation:

- `COMMERCIAL_ROLE`
- `SETS_PACKS`
- `FLOORING_INFRASTRUCTURE`
- `PROTECTION_SAFETY`

Do not feed raw categories, campaign labels, colors, warranty, dimensions, stock availability, customer PII, or relationship scores directly into affinity.

## Data Quality Limitations

- Historical-only rows have weak semantic evidence by design.
- Category assignments are dense for many products. Some products have more than 10 categories, and the category count distribution reaches 18.
- 625 products have zero feature rows; this is mostly historical-only plus some inactive/current gaps.
- Relationship evidence covers 847 products and is skewed toward active/current products.
- Category overlap and broad store-section nodes can inflate discipline or family evidence if used naively.
- Duplicate/similar product names, size variants, and pack/set rows should be reviewed so classifier tests do not accidentally reward overfitting to variants.

## Validation

Performed read-only/offline validations:

- Used local exported A00 artifacts only.
- No production code edited.
- No PrestaShop connection opened for A00.1.
- No SQL writes, DDL, DML, or HTTP runtime changes.
- No customer PII exported or reviewed.
- Category trust map generated for all 253 categories.
- Feature trust map generated for all 75 features.
- Golden set generated with 200 products.

## Final Report

CUSTOMER_INTELLIGENCE_R2_A00_1_STATUS:

Complete as offline discovery. No production code, classifier, affinity snapshot, runtime API, or PrestaShop data was modified.

DECISION:

`ONTOLOGY_DISCOVERY_NEEDS_MANUAL_REVIEW`

CATALOG_SEMANTIC_QUALITY:

The A00 export is analysis-ready for ontology design. Current active products have strong feature, description, sales, and relationship coverage. Inactive products remain useful but less complete. Historical-only products are commercially important but semantically sparse and require lower-confidence handling.

CATEGORY_FINDINGS:

PrestaShop categories contain useful product-family and discipline evidence, but they are mixed with navigation, campaign, legacy/series, and test semantics. Category trust-map counts: 144 `SEMANTIC_STRONG`, 18 `SEMANTIC_WEAK`, 39 `CAMPAIGN`, 31 `LEGACY`, 4 `NAVIGATION`, and 17 `UNKNOWN`.

FEATURE_FINDINGS:

Features are commercially useful when treated selectively. Feature trust-map counts: 28 `SEMANTIC`, 22 `TECHNICAL`, 8 `LOGISTICS`, 6 `PRESENTATION`, and 11 `NOISE`. `Clasificación de Uso` and `Categoría` are especially important for commercial level and Olympic/pre-Olympic equipment semantics.

DISCOVERED_ONTOLOGY_FAMILIES:

`PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT`, `TRAINING_OBJECTIVE`, `COMMERCIAL_LEVEL`, and `COMMERCIAL_ROLE`.

ONTOLOGY_V1:

Proposed 62-tag bounded multi-label ontology across six families. It avoids customer archetypes and keeps campaigns, warranty, colors, logistics, raw dimensions, and temporary promotions as attributes/evidence rather than semantic tags.

CLASSIFICATION_EXAMPLES:

36 real product classification proposals are documented in this report, each with product id, product name, grouped ontology tags, evidence status, and ambiguity notes.

CATEGORY_TRUST_MAP:

Generated for all 253 exported categories at `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-discovery/category_trust_map.csv`.

FEATURE_TRUST_MAP:

Generated for all 75 exported feature definitions at `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-discovery/feature_trust_map.csv`.

GOLDEN_SET:

Generated 200-product ontology review set at `scripts/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-discovery/ontology_golden_set.csv`: 133 current active, 17 current inactive, and 50 historical-only products.

CLASSIFICATION_STRATEGY:

V1 should require raw product evidence, normalized semantic evidence, category/feature trust maps, deterministic high-confidence rules, validation against the golden set, human review for ambiguous/multi-label cases, and publication of a versioned semantic snapshot. A constrained LLM proposal stage is optional but should only run after ontology registry approval.

HISTORICAL_PRODUCT_POLICY:

Keep historical-only products in the corpus because they explain real sales. Classify them only when names are strong enough, lower confidence when structured evidence is absent, and do not treat missing features/categories/descriptions as negative signals.

CUSTOMER_AFFINITY_RELEVANCE:

Future affinity should consume reviewed product tags from `DISCIPLINE`, `USE_CONTEXT`, `TRAINING_OBJECTIVE`, `PRODUCT_FAMILY`, `COMMERCIAL_LEVEL`, and selected `COMMERCIAL_ROLE` tags. It should not consume raw categories, campaign names, colors, warranty, dimensions, stock state, PII, or raw relationship scores.

KNOWN_LIMITATIONS:

Manual review is still needed for discipline overlap, historical-only rows, hybrid machines, bundles, category trust decisions, and high-noise broad terms such as `fuerza`, `acondicionamiento`, and `cardio`.

NEXT_SLICE:

Recommended progression:

1. `A00.2` Ontology registry: encode approved families, tags, definitions, exclusions, evidence weights, and deprecations.
2. `A00.3` Product semantic classification pipeline: deterministic rules plus optional constrained proposal stage.
3. `A00.4` Golden-set validation/review: reviewed labels, acceptance thresholds, and regression tests.
4. `A00.5` Product semantic snapshot publication: immutable versioned product-tag evidence snapshot.
5. `A01` Customer Commercial Affinity snapshot: aggregate customer behavior over reviewed product semantics only.
