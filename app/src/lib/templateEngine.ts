// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

import { Fraction } from './fraction';
import { solve } from './simplex';
import type { TableauSnapshot } from './types';

// ── Template types ──────────────────────────────────────────────────

export interface CoefficientRange {
  min: number;
  max: number;
  label: string;
}

export interface ConstraintTemplate {
  type: '<=' | '>=' | '=';
  label: string;
  row: string[];   // coefficient keys, e.g. ["a11","a12"]
  rhs: string;     // rhs key, e.g. "b1"
}

export interface HighlightEntry {
  text: string;       // template with {placeholders}
  bedeutung: string;  // template with {placeholders}
}

export interface ProblemTemplate {
  id: string;
  typ: string;
  optimierungsziel: 'maximieren' | 'minimieren';
  numVars: number;
  variablen: string[];
  objective: string[];           // keys into coefficients, e.g. ["c1","c2"]
  constraints: ConstraintTemplate[];
  coefficients: Record<string, CoefficientRange>;
  titel: string;
  beschreibung: string;          // template with {placeholders}
  hinweis: string;
  highlights: {
    zielfunktion: HighlightEntry[];
    nebenbedingungen: HighlightEntry[][];
  };
}

/** A fully filled problem object — matches static problem format exactly. */
export interface FilledProblem {
  titel: string;
  beschreibung: string;
  typ: string;
  optimierungsziel: string;
  variablen: string[];
  zielfunktion: string;
  nebenbedingungen: string[];
  hinweis: string;
  highlights: {
    zielfunktion: { text: string; bedeutung: string }[];
    nebenbedingungen: { text: string; bedeutung: string }[][];
  };
}

export interface GenerateOptions {
  niceNumbers?: boolean;
  maxDenom?: number;
  maxAttempts?: number;
}

// ── Core engine ─────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pick random integer values for all coefficient keys within their ranges. */
export function randomizeCoefficients(
  template: ProblemTemplate
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, range] of Object.entries(template.coefficients)) {
    values[key] = randInt(range.min, range.max);
  }
  return values;
}

/** Check feasibility by running the simplex solver. Returns solution path or null. */
export function checkFeasibility(
  template: ProblemTemplate,
  values: Record<string, number>
): TableauSnapshot[] | null {
  const isMax = template.optimierungsziel === 'maximieren';

  // Build objective vector
  const c = template.objective.map(k => Fraction.fromNumber(values[k]));

  // Build constraint matrix and rhs
  const A: Fraction[][] = [];
  const b: Fraction[] = [];
  for (const ct of template.constraints) {
    const row = ct.row.map(k => Fraction.fromNumber(values[k]));
    // For >= constraints, negate to convert to <= form: -a·x ≤ -b
    if (ct.type === '>=') {
      A.push(row.map(f => f.neg()));
      b.push(Fraction.fromNumber(-values[ct.rhs]));
    } else {
      A.push(row);
      b.push(Fraction.fromNumber(values[ct.rhs]));
    }
  }

  return solve(c, A, b, isMax, 50);
}

/** Check if all intermediate fractions have denominators ≤ maxDenom. */
export function checkNiceNumbers(
  path: TableauSnapshot[],
  maxDenom: number
): boolean {
  const limit = BigInt(maxDenom);
  for (const tableau of path) {
    for (const row of tableau.data) {
      for (const cell of row) {
        if (cell.den > limit) return false;
      }
    }
  }
  return true;
}

/** Replace {key} placeholders with actual values in a string. */
function replacePlaceholders(
  text: string,
  values: Record<string, number>
): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    const v = values[key];
    return v !== undefined ? String(v) : `{${key}}`;
  });
}

/** Build zielfunktion string from template + values. */
function buildZielfunktion(
  template: ProblemTemplate,
  values: Record<string, number>
): string {
  const terms = template.objective.map((key, j) => {
    const coef = values[key];
    const sign = j === 0 ? '' : ' + ';
    return `${sign}${coef}x${j + 1}`;
  });
  const dir = template.optimierungsziel === 'maximieren' ? 'max' : 'min';
  return `Z = ${terms.join('')} (${dir})`;
}

/** Build nebenbedingungen strings from template + values. */
function buildNebenbedingungen(
  template: ProblemTemplate,
  values: Record<string, number>
): string[] {
  const nbs: string[] = [];
  for (const ct of template.constraints) {
    const terms = ct.row.map((key, j) => {
      const coef = values[key];
      const sign = j === 0 ? '' : ' + ';
      return `${sign}${coef}x${j + 1}`;
    });
    const op = ct.type === '<=' ? '≤' : ct.type === '>=' ? '≥' : '=';
    nbs.push(`${terms.join('')} ${op} ${values[ct.rhs]} (${ct.label})`);
  }
  // Non-negativity
  const vars = Array.from({ length: template.numVars }, (_, j) => `x${j + 1}`).join(', ');
  nbs.push(`${vars} ≥ 0`);
  return nbs;
}

/** Fill all placeholders in a template to produce a standard problem object. */
export function fillTemplate(
  template: ProblemTemplate,
  values: Record<string, number>
): FilledProblem {
  return {
    titel: template.titel,
    beschreibung: replacePlaceholders(template.beschreibung, values),
    typ: template.typ,
    optimierungsziel: template.optimierungsziel,
    variablen: [...template.variablen],
    zielfunktion: buildZielfunktion(template, values),
    nebenbedingungen: buildNebenbedingungen(template, values),
    hinweis: replacePlaceholders(template.hinweis, values),
    highlights: {
      zielfunktion: template.highlights.zielfunktion.map(h => ({
        text: replacePlaceholders(h.text, values),
        bedeutung: replacePlaceholders(h.bedeutung, values),
      })),
      nebenbedingungen: template.highlights.nebenbedingungen.map(group =>
        group.map(h => ({
          text: replacePlaceholders(h.text, values),
          bedeutung: replacePlaceholders(h.bedeutung, values),
        }))
      ),
    },
  };
}

/** Generate a problem from a template synchronously. */
export function generateFromTemplate(
  template: ProblemTemplate,
  opts: GenerateOptions = {}
): FilledProblem | null {
  const { niceNumbers = false, maxDenom = 6, maxAttempts = 2000 } = opts;

  for (let i = 0; i < maxAttempts; i++) {
    const values = randomizeCoefficients(template);
    const path = checkFeasibility(template, values);
    if (!path) continue;

    // Optimal Z must be positive
    const last = path[path.length - 1];
    const cols = last.data[0].length;
    const zVal = last.data[0][cols - 1];
    if (!zVal.isPositive()) continue;

    if (niceNumbers && !checkNiceNumbers(path, maxDenom)) continue;

    return fillTemplate(template, values);
  }
  return null;
}

/** Generate a problem asynchronously with requestAnimationFrame batching. */
export function generateFromTemplateAsync(
  template: ProblemTemplate,
  opts: GenerateOptions = {}
): Promise<FilledProblem | null> {
  const { niceNumbers = false, maxDenom = 6, maxAttempts = 5000 } = opts;
  const BATCH_SIZE = 200;

  return new Promise((resolve) => {
    let attempts = 0;

    function batch() {
      for (let i = 0; i < BATCH_SIZE && attempts < maxAttempts; i++, attempts++) {
        const values = randomizeCoefficients(template);
        const path = checkFeasibility(template, values);
        if (!path) continue;

        const last = path[path.length - 1];
        const cols = last.data[0].length;
        const zVal = last.data[0][cols - 1];
        if (!zVal.isPositive()) continue;

        if (niceNumbers && !checkNiceNumbers(path, maxDenom)) continue;

        resolve(fillTemplate(template, values));
        return;
      }

      if (attempts < maxAttempts) {
        requestAnimationFrame(batch);
      } else {
        resolve(null);
      }
    }

    requestAnimationFrame(batch);
  });
}
