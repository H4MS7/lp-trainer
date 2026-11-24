// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

import { Fraction } from './fraction';
import { solve } from './simplex';
import type { GeneratorConfig, GeneratedProblem, TableauSnapshot } from './types';

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Hash a problem for deduplication.
 * Sort constraint rows lexicographically so row order doesn't matter.
 */
function hashProblem(c: number[], A: number[][], b: number[]): string {
  const constraintStrs = A.map((row, i) => [...row, b[i]].join(',')).sort();
  return `${c.join(',')};${constraintStrs.join(';')}`;
}

/**
 * Check whether all intermediate Fraction values in a solution path
 * have denominators ≤ maxDenom.
 */
function isNice(path: TableauSnapshot[], maxDenom: number): boolean {
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

/**
 * Try to generate a single problem. Returns null if it doesn't pass filters.
 */
function tryGenerate(config: GeneratorConfig): GeneratedProblem | null {
  const { nVars, nConstraints, minTableaus, maxTableaus, niceNumbers, maxDenom } = config;

  // Random objective coefficients [1, 30]
  const c: number[] = [];
  for (let j = 0; j < nVars; j++) {
    c.push(randInt(1, 30));
  }

  // Random constraint matrix and RHS
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < nConstraints; i++) {
    const row: number[] = [];
    for (let j = 0; j < nVars; j++) {
      row.push(randInt(1, 12));
    }
    A.push(row);
    b.push(randInt(20, 300));
  }

  // Convert to Fraction
  const cF = c.map(v => Fraction.fromNumber(v));
  const AF = A.map(row => row.map(v => Fraction.fromNumber(v)));
  const bF = b.map(v => Fraction.fromNumber(v));

  // Solve
  const path = solve(cF, AF, bF, true, 50);
  if (!path) return null; // infeasible or unbounded

  // Count pivot steps (tableaus - 1)
  const pivotCount = path.length - 1;
  if (pivotCount < minTableaus || pivotCount > maxTableaus) return null;

  // Check optimal Z > 0
  const lastTableau = path[path.length - 1];
  const cols = lastTableau.data[0].length;
  const zVal = lastTableau.data[0][cols - 1];
  if (!zVal.isPositive()) return null;

  // Nice numbers filter
  if (niceNumbers && !isNice(path, maxDenom)) return null;

  const hash = hashProblem(c, A, b);

  return { c, A, b, isMax: true, solutionPath: path, hash };
}

/**
 * Generate a problem synchronously. Tries up to maxAttempts times.
 */
export function generateProblem(
  config: GeneratorConfig,
  seenHashes: Set<string>,
  maxAttempts: number = 5000
): GeneratedProblem | null {
  for (let i = 0; i < maxAttempts; i++) {
    const problem = tryGenerate(config);
    if (problem && !seenHashes.has(problem.hash)) {
      return problem;
    }
  }
  return null;
}

/**
 * Generate a problem asynchronously with requestAnimationFrame batching
 * to avoid blocking the UI.
 */
export function generateProblemAsync(
  config: GeneratorConfig,
  seenHashes: Set<string>,
  timeoutMs: number = 5000
): Promise<GeneratedProblem | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const BATCH_SIZE = 200;

    function batch() {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const problem = tryGenerate(config);
        if (problem && !seenHashes.has(problem.hash)) {
          resolve(problem);
          return;
        }
      }

      if (performance.now() - start < timeoutMs) {
        requestAnimationFrame(batch);
      } else {
        resolve(null);
      }
    }

    requestAnimationFrame(batch);
  });
}

/**
 * Format a generated problem as displayable LP formulation strings.
 */
export function formatProblem(problem: GeneratedProblem): {
  zielfunktion: string;
  nebenbedingungen: string[];
} {
  const n = problem.c.length;

  // Zielfunktion: Z = c₁x₁ + c₂x₂ + ...
  const terms = problem.c.map((coef, j) => {
    const sign = j === 0 ? '' : ' + ';
    return `${sign}${coef}x${j + 1}`;
  });
  const zielfunktion = `Z = ${terms.join('')} (max)`;

  // Nebenbedingungen
  const nebenbedingungen: string[] = [];
  for (let i = 0; i < problem.A.length; i++) {
    const constraintTerms = problem.A[i].map((coef, j) => {
      const sign = j === 0 ? '' : ' + ';
      return `${sign}${coef}x${j + 1}`;
    });
    nebenbedingungen.push(`${constraintTerms.join('')} ≤ ${problem.b[i]}`);
  }

  // Add non-negativity
  const nnVars = Array.from({ length: n }, (_, j) => `x${j + 1}`).join(', ');
  nebenbedingungen.push(`${nnVars} ≥ 0`);

  return { zielfunktion, nebenbedingungen };
}
