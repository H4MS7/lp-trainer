# LP Problem JSON Schema

Each problem must be a valid JSON object with this exact structure.
ALL numbers in the beschreibung MUST exactly match the coefficients in zielfunktion and nebenbedingungen.
The highlights MUST reference actual text snippets from beschreibung.

## Format

```json
{
  "titel": "Short descriptive title (German)",
  "beschreibung": "A realistic word problem in German. Must contain ALL numbers that appear in the constraints. Written as a coherent business scenario with specific quantities, prices, and limits.",
  "typ": "Produktionsproblem|Mischungsproblem|Transportproblem|Ressourcenallokation",
  "optimierungsziel": "maximieren|minimieren",
  "variablen": ["x1 = Meaning of x1", "x2 = Meaning of x2"],
  "zielfunktion": "Z = ax1 + bx2 (max|min)",
  "nebenbedingungen": ["ax1 + bx2 ≤ c (Label)", "x1, x2 ≥ 0"],
  "hinweis": "A helpful hint for the student (German)",
  "highlights": {
    "zielfunktion": [
      {"text": "exact text from beschreibung for coeff a", "bedeutung": "a × x₁"},
      {"text": "exact text from beschreibung for coeff b", "bedeutung": "b × x₂"}
    ],
    "nebenbedingungen": [
      [
        {"text": "exact text for constraint 1 LHS term 1", "bedeutung": "ax₁"},
        {"text": "exact text for constraint 1 LHS term 2", "bedeutung": "+ bx₂"},
        {"text": "exact text for constraint 1 RHS", "bedeutung": "≤ c"}
      ]
    ]
  }
}
```

## Rules

1. Use ONLY 2 variables (x1, x2)
2. Use comma as decimal separator in German text (e.g., "2,50€") but dot or comma in math (either works, the parser handles both)
3. The last nebenbedingung is ALWAYS "x1, x2 ≥ 0" (non-negativity)
4. Constraint labels in parentheses: "4x1 + 2x2 ≤ 160 (Arbeitsstunden)"
5. For minimization: use (min) in zielfunktion
6. For maximization: use (max) in zielfunktion
7. Inequality types: ≤ for "at most"/"available"/"capacity", ≥ for "at least"/"minimum requirement", = for exact requirements
8. For ≥ constraints in mixing problems, convert percentages to absolute values in the constraint (e.g., "mindestens 20% Protein" with 1000kg total → "0,1x1 + 0,4x2 ≥ 200")
9. Ratio constraints like "x2 darf nicht mehr als doppelt so viel wie x1" → "x2 ≤ 2x1" which is written as "-2x1 + x2 ≤ 0" or "x2 ≤ 2x1"
10. Every number in every constraint MUST appear somewhere in beschreibung
11. highlights.nebenbedingungen has one inner array per constraint (excluding x1,x2≥0)
12. highlights.zielfunktion texts must be EXACT substrings of beschreibung
13. All text in German

## Example

```json
{
  "titel": "Gürtelproduktion",
  "beschreibung": "Ein Unternehmen stellt zwei Gürteltypen A und B mit einem Deckungsbeitrag von 2,00€ bzw. 1,50€ je Stück her. Ein A-Gürtel benötigt doppelt so viel Zeit wie ein B-Gürtel. Falls nur B-Gürtel produziert würden, könnte das Unternehmen 1000 Stück pro Tag anfertigen. Die Lederbelieferung erlaubt nur 800 Gürtel pro Tag. Es stehen 400 Schnallen Typ A und 700 Schnallen Typ B zur Verfügung.",
  "typ": "Produktionsproblem",
  "optimierungsziel": "maximieren",
  "variablen": ["x1 = Anzahl Gürtel Typ A", "x2 = Anzahl Gürtel Typ B"],
  "zielfunktion": "Z = 2x1 + 1,5x2 (max)",
  "nebenbedingungen": [
    "2x1 + x2 ≤ 1000 (Zeitkapazität)",
    "x1 + x2 ≤ 800 (Leder)",
    "x1 ≤ 400 (Schnallen A)",
    "x2 ≤ 700 (Schnallen B)",
    "x1, x2 ≥ 0"
  ],
  "hinweis": "A-Gürtel braucht doppelt so viel Zeit: 2x1 + x2.",
  "highlights": {
    "zielfunktion": [
      {"text": "Deckungsbeitrag von 2,00€", "bedeutung": "2 × x₁"},
      {"text": "1,50€ je Stück", "bedeutung": "1,5 × x₂"}
    ],
    "nebenbedingungen": [
      [
        {"text": "doppelt so viel Zeit", "bedeutung": "2x₁"},
        {"text": "wie ein B-Gürtel", "bedeutung": "+ x₂"},
        {"text": "1000 Stück pro Tag", "bedeutung": "≤ 1000"}
      ],
      [
        {"text": "Lederbelieferung", "bedeutung": "x₁ + x₂"},
        {"text": "800 Gürtel pro Tag", "bedeutung": "≤ 800"}
      ],
      [
        {"text": "400 Schnallen Typ A", "bedeutung": "x₁ ≤ 400"}
      ],
      [
        {"text": "700 Schnallen Typ B", "bedeutung": "x₂ ≤ 700"}
      ]
    ]
  }
}
```
