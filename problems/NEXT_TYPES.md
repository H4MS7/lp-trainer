# Next LP Problem Types - Ready to Generate

## Status
- 160 baseline problems DONE and integrated (batches 1-8)
- Catalogue: see CATALOGUE.md
- App running at `app/` (Vite + React + Tailwind)
- Dropdown is data-driven (auto-detects types from ALL_PROBLEMS)
- Highlighting fixed: exact substring matching only, no digit extraction

## New Types to Generate

### 1. Investitionsoptimierung
- **Structure:** Max Rendite, ≤ Risikobudget, ≥ Mindestrendite, ≤ Kapital
- **Variables:** x₁ = Betrag in Anlage A, x₂ = Betrag in Anlage B
- **What's new:** Coefficients are interest rates (0.05, 0.08), financial vocabulary
- **Scenarios:** Aktien/Anleihen, Immobilien/ETF, Krypto/Gold, Startup/Festgeld, Rohstoffe/Staatsanleihen
- **Difficulty:** mittel-schwer (2-4 NB)
- **Count target:** 20 problems

### 2. Maschinenparametrierung
- **Structure:** Max Durchsatz (or min Kosten), ≤ Leistung, ≤ Werkzeugverschleiß, ≥ Oberflächengüte
- **Variables:** x₁ = Drehzahl (RPM), x₂ = Vorschub (mm/min) — or similar continuous physical quantities
- **What's new:** Variables are NOT "how many of A/B" but physical parameters. Constraints from physics/engineering.
- **Scenarios:** CNC-Fräse, Laserschneider, 3D-Drucker (Geschwindigkeit/Schichthöhe), Schweißroboter, Extruder, Spritzgussmaschine, Walzwerk, Brennofen (Temperatur/Zeit)
- **Difficulty:** schwer (unfamiliar framing forces rethinking)
- **Count target:** 15 problems

### 3. Diätproblem (Ernährungsplan)
- **Structure:** Min Kosten, multiple ≥ constraints (Kalorien, Protein, Vitamine, Ballaststoffe)
- **Variables:** x₁ = kg/Portionen Lebensmittel A, x₂ = kg/Portionen Lebensmittel B
- **What's new:** Classic LP type, many minimum requirements, food/nutrition vocabulary
- **Scenarios:** Reis/Linsen, Kartoffeln/Hühnchen, Haferflocken/Eier, Tofu/Quinoa, Brot/Käse, Nudeln/Gemüse, Astronautennahrung, Sportlerdiät, Krankenhausessen, Schulkantine
- **Difficulty:** einfach-mittel (2-4 NB)
- **Count target:** 20 problems

### 4. Emissionsoptimierung
- **Structure:** Max Gewinn with CO₂-cap (≤ Emissionszertifikate), ≤ Ressourcen, ≥ Mindestproduktion
- **Variables:** x₁ = Menge Verfahren A, x₂ = Menge Verfahren B
- **What's new:** Environmental constraint as binding limit. "Unsichtbare Kosten" — emission isn't a resource you buy, it's a limit you must respect.
- **Scenarios:** Stahlwerk (Hochofen/Elektrolichtbogen), Kraftwerk (Kohle/Gas), Zementfabrik, Chemiefabrik, Raffinerie, Brauerei mit Nachhaltigkeitsziel, Logistik (LKW/Bahn), Landwirtschaft (konventionell/bio)
- **Difficulty:** mittel-schwer (3-4 NB)
- **Count target:** 20 problems

### 5. Schichtplanung (Personaleinsatz)
- **Structure:** Min Personalkosten (or Min Anzahl), ≥ Mindestbesetzung pro Zeitfenster
- **Variables:** x₁ = Anzahl Schicht A, x₂ = Anzahl Schicht B
- **What's new:** Covering problem structure. IMPORTANT: choose coefficients so optimal solution is INTEGER (no "0.33 Mitarbeiter").
- **Scenarios:** Krankenhaus, Callcenter, Fabrikschichten, Hotelrezeption, Supermarktkasse, Feuerwehr, Polizeiwache, Flughafensicherheit, Gastronomie, Bibliothek
- **Difficulty:** mittel (3 NB, but tricky interpretation)
- **Count target:** 15 problems (integer-clean solutions only!)

### 6. Energiemix
- **Structure:** Min Kosten (or Max Einspeisung), ≥ Mindestleistung, ≤ Netzkapazität, ≤ Verfügbarkeit
- **Variables:** x₁ = MWh/kW von Quelle A, x₂ = MWh/kW von Quelle B
- **What's new:** Energy vocabulary, availability constraints (Sonne scheint nur X Stunden), timely topic
- **Scenarios:** Solar/Wind, Biomasse/Wasserkraft, Geothermie/Photovoltaik, BHKW/Wärmepumpe, Offshore-Wind/Onshore-Wind, Batteriespeicher-Allokation
- **Difficulty:** mittel-schwer (3-4 NB)
- **Count target:** 15 problems

### 7. Kapazitätsplanung (IT/Cloud)
- **Structure:** Max Requests (or Min Kosten), ≤ CPU, ≤ RAM, ≤ Budget, ≤ Storage
- **Variables:** x₁ = Anzahl Instanztyp A, x₂ = Anzahl Instanztyp B
- **What's new:** Tech/CS vocabulary (vCPUs, GB RAM, IOPS), relatable for CS students
- **Scenarios:** Cloud-VMs, Container-Pods, Datenbankinstanzen, CDN-Knoten, GPU-Cluster, Kubernetes-Nodes, Load-Balancer-Tiers, Backup-Server
- **Difficulty:** mittel (3 NB)
- **Count target:** 15 problems

### 8. Medienplanung (Marketing-Mix)
- **Structure:** Max Conversions (or Max Reichweite), ≤ Budget, ≥ Mindestreichweite, ≤ Frequenz-Cap
- **Variables:** x₁ = Ausgaben/Einheiten Kanal A, x₂ = Ausgaben/Einheiten Kanal B
- **What's new:** Marketing vocabulary, reach/frequency/conversion metrics
- **Scenarios:** TV/Social-Media, Google-Ads/Instagram, Plakatwerbung/Radio, Newsletter/Influencer, Print/Online, Podcast-Werbung/YouTube-Ads, Messe/Webinar
- **Difficulty:** mittel (3-4 NB)
- **Count target:** 15 problems

### 9. Lagerhaltung (Bestandsoptimierung)
- **Structure:** Min Gesamtkosten (Bestell + Lager), ≥ Mindestbestand, ≤ Lagerkapazität, ≤ Budget
- **Variables:** x₁ = Bestellmenge Produkt A, x₂ = Bestellmenge Produkt B
- **What's new:** Trade-off between ordering cost and holding cost, different cost structure
- **Scenarios:** Supermarkt, Apotheke, Ersatzteillager, Baumaterial, Elektronikversand, Buchhandlung
- **Difficulty:** mittel-schwer (3-4 NB)
- **Count target:** 15 problems

### 10. Qualitätskontrolle
- **Structure:** Min Prüfkosten, ≥ Fehlererkennungsrate, ≤ Prüfzeit, ≤ Gerätekapazität
- **Variables:** x₁ = Anzahl Prüfungen Methode A, x₂ = Anzahl Prüfungen Methode B
- **What's new:** Statistical flavour, quality metrics as constraints
- **Scenarios:** Halbleiterfertigung, Lebensmittelkontrolle, Autoinspektion, Medizinprodukte, Softwaretesting, Brückeninspektion
- **Difficulty:** mittel (3 NB)
- **Count target:** 10 problems

### 11. Flächennutzung
- **Structure:** Max Ertrag, ≤ Fläche, ≥ Eigenversorgung, ≤ Wasserbudget, ≥ Brachepflicht
- **Variables:** x₁ = Hektar Nutzung A, x₂ = Hektar Nutzung B
- **What's new:** Land-use conflict (food vs energy), ecological constraints, percentage-of-total
- **Scenarios:** Weizen/Solar, Mais/Windpark, Wald/Weide, Bio/Konventionell, Wohnbau/Grünfläche
- **Difficulty:** schwer (4-5 NB with ecological percentage constraints)
- **Count target:** 10 problems

### 12. Wartungsplanung
- **Structure:** Min Gesamtkosten, ≥ Verfügbarkeit, ≤ Technikerstunden, ≤ Budget
- **Variables:** x₁ = Anzahl präventive Wartungen, x₂ = Anzahl reaktive Reparaturen
- **What's new:** Trade-off problem — prevention is cheap but takes time, reaction is expensive but on-demand
- **Scenarios:** Maschinenpark, Fuhrpark, IT-Infrastruktur, Gebäudetechnik, Medizingeräte, Windkraftanlagen
- **Difficulty:** mittel (3 NB)
- **Count target:** 10 problems

## Total new: ~180 problems across 12 new types
## Grand total with baseline: ~340 problems

---

## Unit Trap Integration (across ALL types, new and existing themes)

### Approach
- Unit-trap problems are NOT a separate type — they're variants of any type
- The prose uses one unit, the constraint requires another
- Student must convert; no hint is given
- The solution/highlights show the conversion in `bedeutung` field

### Planned unit traps (stick to metric/SI):
| Domain | Trap | Prose says | Constraint needs |
|--------|------|-----------|-----------------|
| Time | h ↔ min | "2,5 Stunden" | 150 (Minuten) |
| Time | h+min mixed | "3 Stunden 20 Minuten" | 200 (Minuten) |
| Mass | kg ↔ t | "250 kg pro Stück" | 0,25 (Tonnen) |
| Mass | g ↔ kg | "500g pro Stück" | 0,5 (kg) |
| Volume | ml ↔ L | "200 ml pro Stück" | 0,2 (Liter) |
| Length | cm ↔ m | "80 cm Breite" | 0,8 (Meter) |
| Data | MB ↔ GB | "250 MB pro Backup" | 0,25 (GB) |
| Data | GB ↔ TB | "500 GB" | 0,5 (TB) |
| Currency | Cent ↔ Euro | "50 Cent Gewinn" | 0,50 (Euro) |
| Area | m² ↔ ha | "5000 m²" | 0,5 (Hektar) |
| Power | kW ↔ MW | "500 kW" | 0,5 (MW) |
| Quantity | Stück ↔ Dutzend | "3 Dutzend" | 36 (Stück) |

### Technical impact on highlights
- `text` field: matches prose as-is ("500g Kupfer pro Stück")
- `bedeutung` field: shows conversion ("= 0,5 kg → 0,5x₁")
- The constraint coefficient (0.5) does NOT appear in beschreibung — that's the point
- Validator must be adjusted to not flag these as errors
- Add a `unitConversion: true` flag to these problems for the validator

### Count target: 30 unit-trap problems spread across multiple types

---

## Generation Order (suggested)
1. Investitionsoptimierung (20) — most requested
2. Maschinenparametrierung (15) — most structurally novel
3. Diätproblem (20) — classic LP, easy to generate
4. Emissionsoptimierung (20) — topical, good constraint variety
5. Schichtplanung (15) — needs integer-clean solutions, careful
6. Energiemix (15)
7. IT-Kapazitätsplanung (15)
8. Medienplanung (15)
9. Lagerhaltung (15)
10. Qualitätskontrolle (10)
11. Flächennutzung (10)
12. Wartungsplanung (10)
13. Unit-trap variants (30) — last, after all types exist

## Implementation Notes
- Each new type gets its own batch file: batch_9_investition.json, batch_10_maschinen.json, etc.
- After generation: merge into ALL_PROBLEMS, copy to app/src/LPModellTrainer.tsx
- Dropdown auto-updates (data-driven)
- Difficulty filtering already works (counts real NB)
- For unit-trap problems: extend SCHEMA.md with unitConversion flag
