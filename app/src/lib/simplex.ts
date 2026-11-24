// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

import { Fraction } from './fraction';
import type { TableauSnapshot } from './types';

/**
 * Build the initial Tucker tableau for:
 *   max/min Z = c·x  subject to  Ax ≤ b, x ≥ 0
 *
 * Layout (Tucker form):
 *   Row 0 (Z-row): [-c₁, -c₂, ..., -cₙ, 0]  for max
 *                   [ c₁,  c₂, ...,  cₙ, 0]  for min
 *   Row i (constraint i): [a_{i1}, a_{i2}, ..., a_{in}, b_i]
 *
 * Basis: ['Z', 'y1', 'y2', ...]  (slack variables)
 * nbVars: ['x1', 'x2', ..., 'xn']
 */
export function buildInitialTableau(
  c: Fraction[],
  A: Fraction[][],
  b: Fraction[],
  isMax: boolean
): TableauSnapshot {
  const n = c.length;
  const m = A.length;

  const data: Fraction[][] = [];

  // Z-row
  const zRow: Fraction[] = [];
  for (let j = 0; j < n; j++) {
    zRow.push(isMax ? c[j].neg() : c[j]);
  }
  zRow.push(Fraction.ZERO); // Z value
  data.push(zRow);

  // Constraint rows
  for (let i = 0; i < m; i++) {
    const row: Fraction[] = [];
    for (let j = 0; j < n; j++) {
      row.push(A[i][j]);
    }
    row.push(b[i]);
    data.push(row);
  }

  const basis = [isMax ? 'Z' : '-Z'];
  for (let i = 1; i <= m; i++) basis.push(`y${i}`);

  const nbVars: string[] = [];
  for (let j = 1; j <= n; j++) nbVars.push(`x${j}`);

  return {
    data,
    basis,
    nbVars,
    pivotRow: -1,
    pivotCol: -1,
    isOptimal: false,
    zLabel: isMax ? 'Z' : '-Z',
  };
}

/**
 * Check if all Z-row coefficients ≥ 0 and all RHS values ≥ 0.
 */
export function isOptimal(tableau: TableauSnapshot): boolean {
  const cols = tableau.data[0].length;
  const n = cols - 1; // number of variable columns

  // All Z-row coefficients (variable columns) must be ≥ 0
  for (let j = 0; j < n; j++) {
    if (tableau.data[0][j].isNegative()) return false;
  }

  // All RHS values must be ≥ 0
  for (let i = 1; i < tableau.data.length; i++) {
    if (tableau.data[i][cols - 1].isNegative()) return false;
  }

  return true;
}

/**
 * Choose the pivot element (the rule the app teaches and checks against).
 *
 * Primal step: pivot column = most negative Z-row coefficient (Dantzig's rule),
 * ties → leftmost column; pivot row = smallest ratio value / column entry over
 * positive entries, ties → topmost row.
 * Dual step (some RHS negative, e.g. from ≥ constraints): pivot row = most
 * negative RHS; pivot column = smallest |Z-coeff / row entry| over negative
 * entries, ties → leftmost.
 *
 * Dantzig's rule can cycle on degenerate problems; solve() gives up after
 * maxIter steps, so generators simply discard such problems.
 */
export function choosePivot(tableau: TableauSnapshot): { row: number; col: number } {
  const data = tableau.data;
  const rows = data.length;
  const cols = data[0].length;
  const n = cols - 1; // value column index

  // Check for negative RHS (dual simplex needed)
  let dualNeeded = false;
  for (let i = 1; i < rows; i++) {
    if (data[i][n].isNegative()) { dualNeeded = true; break; }
  }

  if (dualNeeded) {
    // Dual simplex: choose row with most negative RHS
    let minB = Fraction.ZERO;
    let pivotRow = -1;
    for (let i = 1; i < rows; i++) {
      if (data[i][n].lt(minB)) { minB = data[i][n]; pivotRow = i; }
    }
    if (pivotRow < 0) return { row: -1, col: -1 };

    // Column: smallest |Z-coeff / pivot-row-coeff| for negative coefficients
    let minRatio: Fraction | null = null;
    let pivotCol = -1;
    for (let j = 0; j < n; j++) {
      if (data[pivotRow][j].isNegative()) {
        const ratio = data[0][j].abs().div(data[pivotRow][j].abs());
        if (minRatio === null || ratio.lt(minRatio)) {
          minRatio = ratio;
          pivotCol = j;
        }
      }
    }
    return { row: pivotRow, col: pivotCol };
  }

  // Primal simplex: most negative Z-coefficient, ties → leftmost (strict lt keeps the first)
  let pivotCol = -1;
  let minZ = Fraction.ZERO;
  for (let j = 0; j < n; j++) {
    if (data[0][j].lt(minZ)) {
      minZ = data[0][j];
      pivotCol = j;
    }
  }
  if (pivotCol < 0) return { row: -1, col: -1 }; // Optimal

  // Row: smallest non-negative ratio b/a over positive a, ties → topmost
  let minRatio: Fraction | null = null;
  let pivotRow = -1;
  for (let i = 1; i < rows; i++) {
    if (data[i][pivotCol].isPositive()) {
      const ratio = data[i][n].div(data[i][pivotCol]);
      if (ratio.isNegative()) continue; // skip negative ratios
      if (minRatio === null || ratio.lt(minRatio)) {
        minRatio = ratio;
        pivotRow = i;
      }
    }
  }
  return { row: pivotRow, col: pivotCol };
}

/**
 * Perform Tucker exchange (Rechteckregel) at the given pivot position.
 * Returns a new TableauSnapshot with swapped basis/nbVars.
 */
export function performPivot(tableau: TableauSnapshot): TableauSnapshot {
  const pRow = tableau.pivotRow;
  const pCol = tableau.pivotCol;
  if (pRow < 0 || pCol < 0) throw new Error('No pivot selected');

  const oldData = tableau.data;
  const rows = oldData.length;
  const cols = oldData[0].length;
  const pivotVal = oldData[pRow][pCol];
  if (pivotVal.isZero()) throw new Error('Pivot element is zero');

  const newData: Fraction[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: Fraction[] = [];
    for (let j = 0; j < cols; j++) {
      if (i === pRow && j === pCol) {
        // Pivot element → reciprocal
        row.push(pivotVal.inv());
      } else if (i === pRow) {
        // Pivot row → divide by pivot
        row.push(oldData[i][j].div(pivotVal));
      } else if (j === pCol) {
        // Pivot column → divide by -pivot
        row.push(oldData[i][j].div(pivotVal.neg()));
      } else {
        // Rechteckregel
        row.push(
          oldData[i][j].sub(
            oldData[i][pCol].mul(oldData[pRow][j]).div(pivotVal)
          )
        );
      }
    }
    newData.push(row);
  }

  // Basis exchange
  const newBasis = [...tableau.basis];
  const newNBVars = [...tableau.nbVars];
  const entering = newNBVars[pCol];
  const leaving = newBasis[pRow];
  newBasis[pRow] = entering;
  newNBVars[pCol] = leaving;

  return {
    data: newData,
    basis: newBasis,
    nbVars: newNBVars,
    pivotRow: -1,
    pivotCol: -1,
    isOptimal: false,
    zLabel: tableau.zLabel,
  };
}

/**
 * Solve a full LP problem and return the sequence of tableaus.
 * Returns null if infeasible or unbounded (no solution in maxIter steps).
 */
export function solve(
  c: Fraction[],
  A: Fraction[][],
  b: Fraction[],
  isMax: boolean,
  maxIter: number = 50
): TableauSnapshot[] | null {
  const initial = buildInitialTableau(c, A, b, isMax);
  const path: TableauSnapshot[] = [initial];
  let current = initial;

  for (let iter = 0; iter < maxIter; iter++) {
    if (isOptimal(current)) {
      current = { ...current, isOptimal: true };
      path[path.length - 1] = current;
      return path;
    }

    const pivot = choosePivot(current);
    if (pivot.row < 0 || pivot.col < 0) return null; // unbounded or infeasible

    current = { ...current, pivotRow: pivot.row, pivotCol: pivot.col };
    path[path.length - 1] = current;

    const next = performPivot(current);
    current = next;
    path.push(current);
  }

  return null; // didn't converge
}

/**
 * Convert a TableauSnapshot to an EditableTableau (string-based for UI).
 */
export function toEditable(snapshot: TableauSnapshot): {
  data: string[][];
  basis: string[];
  nbVars: string[];
  pivotRow: number;
  pivotCol: number;
  isOptimal: boolean;
  zLabel: string;
} {
  return {
    data: snapshot.data.map(row => row.map(f => f.toDisplayString())),
    basis: [...snapshot.basis],
    nbVars: [...snapshot.nbVars],
    pivotRow: snapshot.pivotRow,
    pivotCol: snapshot.pivotCol,
    isOptimal: snapshot.isOptimal,
    zLabel: snapshot.zLabel,
  };
}
