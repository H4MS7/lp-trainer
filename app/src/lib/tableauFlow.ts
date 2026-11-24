// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

/**
 * Simplex helpers for the tableaus the user edits in the UI (string cells).
 * Everything is computed with exact fractions via lib/simplex, so the
 * modelling flow and the simplex trainer share one engine and one pivot rule.
 */
import { Fraction } from './fraction';
import * as Simplex from './simplex';
import type { EditableTableau, TableauSnapshot } from './types';

/**
 * Parse one tableau cell: integers, fractions ("-5/3") and decimals with comma
 * or point ("2,5", "2.5"). Empty → 0. Returns null for anything unparseable.
 */
export function parseCell(raw: string | undefined | null): Fraction | null {
  const s = (raw ?? '').trim().replace(/−/g, '-').replace(/\s+/g, '');
  if (s === '') return Fraction.ZERO;
  if (!/^[+-]?(\d+([.,]\d+)?|\d+\/\d+|[.,]\d+)$/.test(s)) return null;
  try {
    const f = Fraction.fromString(s);
    return f;
  } catch {
    return null;
  }
}

/** Convert an editable tableau to an exact snapshot; null if any cell is invalid. */
export function toSnapshot(t: EditableTableau): TableauSnapshot | null {
  const data: Fraction[][] = [];
  for (const row of t.data) {
    const r: Fraction[] = [];
    for (const cell of row) {
      const f = parseCell(cell);
      if (!f) return null;
      r.push(f);
    }
    data.push(r);
  }
  const numVars = (t.data[0]?.length || 1) - 1;
  return {
    data,
    basis: [...(t.basis || [])],
    nbVars: t.nbVars ? [...t.nbVars] : Array.from({ length: numVars }, (_, j) => `x${j + 1}`),
    pivotRow: t.pivotRow ?? -1,
    pivotCol: t.pivotCol ?? -1,
    isOptimal: !!t.isOptimal,
    zLabel: t.zLabel || 'Z',
  };
}

/** Remove annotations like "(Gesamtmenge)", "(max)", "(Verhältnis 1:3)" but keep pure math in parentheses. */
function stripLabels(s: string): string {
  return s.replace(/\([^()]*\)/g, m => (/^[\d\s.,+\-−x*·]+$/i.test(m.slice(1, -1)) ? m : ''));
}

/**
 * Parse a linear expression like "0,7x1 - 0,3x2 + 5" or "x1 + 9x2".
 * Returns exact coefficients for x1..xn plus the constant term, or null.
 */
export function parseLinear(expr: string, numVars: number): { coeffs: Fraction[]; constant: Fraction } | null {
  const s = expr.replace(/−/g, '-').replace(/[\s*·]/g, '').replace(/,/g, '.');
  const coeffs = Array.from({ length: numVars }, () => Fraction.ZERO);
  let constant = Fraction.ZERO;
  if (s === '') return { coeffs, constant };
  for (const term of s.replace(/(?!^)([+-])/g, '|$1').split('|')) {
    const m = term.match(/^([+-]?)(\d+(?:\.\d+)?|\.\d+)?(?:x(\d+))?$/i);
    if (!m || (!m[2] && !m[3])) return null;
    let val = m[2] ? Fraction.fromString(m[2]) : Fraction.ONE;
    if (m[1] === '-') val = val.neg();
    if (m[3]) {
      const idx = parseInt(m[3], 10) - 1;
      if (idx < 0 || idx >= numVars) return null;
      coeffs[idx] = coeffs[idx].add(val);
    } else {
      constant = constant.add(val);
    }
  }
  return { coeffs, constant };
}

/**
 * Parse one constraint into tableau rows (all in "≤" form):
 *   a·x ≤ b  →  one row  [a | b]
 *   a·x ≥ b  →  one row  [-a | -b]            (negative value → dual simplex steps)
 *   a·x = b  →  two rows [a | b] and [-a | -b] (equality = "≤" and "≥" at once)
 * Variables on the right-hand side are moved to the left ("x2 = 3x1" → "-3x1 + x2 = 0").
 */
export function parseConstraint(nb: string, numVars: number): { coeffs: Fraction[]; rhs: Fraction }[] | null {
  const m = stripLabels(nb).match(/^(.*?)(≤|≥|<=|>=|=)(.*)$/);
  if (!m) return null;
  const lhs = parseLinear(m[1], numVars);
  const rhs = parseLinear(m[3], numVars);
  if (!lhs || !rhs) return null;
  const a = lhs.coeffs.map((c, j) => c.sub(rhs.coeffs[j]));
  const b = rhs.constant.sub(lhs.constant);
  const leq = { coeffs: a, rhs: b };
  const geq = { coeffs: a.map(c => c.neg()), rhs: b.neg() };
  const op = m[2];
  if (op === '≤' || op === '<=') return [leq];
  if (op === '≥' || op === '>=') return [geq];
  return [leq, geq];
}

/** Where each start-tableau row comes from (for explanations): one entry per tableau row below Z. */
export interface StartRowInfo { text: string; op: '≤' | '≥' | '='; part?: 'leq' | 'geq' }

export function describeStartRows(nbs: string[]): StartRowInfo[] {
  const rows: StartRowInfo[] = [];
  for (const nb of nbs) {
    const text = nb.replace(/\s*\([^()]*[A-Za-zÄÖÜäöüß]{2,}[^()]*\)\s*$/, '').trim();
    const m = stripLabels(nb).match(/(≤|≥|<=|>=|=)/);
    const op = !m ? '≤' : (m[1] === '≥' || m[1] === '>=') ? '≥' : m[1] === '=' ? '=' : '≤';
    if (op === '=') rows.push({ text, op, part: 'leq' }, { text, op, part: 'geq' });
    else rows.push({ text, op });
  }
  return rows;
}

/** Parse "Z = 12x1 + 11x2 (min)" (also "max: …", "… → max"). */
export function parseObjective(zf: string, numVars: number): { c: Fraction[]; isMin: boolean } | null {
  const isMin = /min/i.test(zf);
  const clean = stripLabels(zf);
  const eq = clean.indexOf('=');
  const expr = (eq >= 0 ? clean.slice(eq + 1) : clean).replace(/max|min|→|->|:/gi, '');
  const lin = parseLinear(expr, numVars);
  if (!lin || lin.coeffs.every(c => c.isZero())) return null;
  return { c: lin.coeffs, isMin };
}

/**
 * Build the start tableau (Tucker form) from the LP as text.
 * Z-row: -c for max, +c for min (label "-Z"); slack variables y1, y2, … as basis.
 * Returns null if the objective or any constraint cannot be parsed.
 */
export function buildStartTableauFromText(zf: string, nbs: string[], numVars: number): EditableTableau | null {
  const obj = parseObjective(zf, numVars);
  if (!obj) return null;
  const rows: { coeffs: Fraction[]; rhs: Fraction }[] = [];
  for (const nb of nbs) {
    const r = parseConstraint(nb, numVars);
    if (!r) return null;
    rows.push(...r);
  }
  const zRow = [...obj.c.map(c => (obj.isMin ? c : c.neg()).toDisplayString()), '0'];
  return {
    data: [zRow, ...rows.map(r => [...r.coeffs.map(c => c.toDisplayString()), r.rhs.toDisplayString()])],
    basis: [obj.isMin ? '-Z' : 'Z', ...rows.map((_, i) => `y${i + 1}`)],
    nbVars: Array.from({ length: numVars }, (_, j) => `x${j + 1}`),
    zLabel: obj.isMin ? '-Z' : 'Z',
    pivotRow: -1, pivotCol: -1, isOptimal: false,
  };
}

/** Is the tableau optimal (Z-row ≥ 0 and all values ≥ 0)? Invalid input → false. */
export function isOptimalEditable(t: EditableTableau): boolean {
  const snap = toSnapshot(t);
  return snap ? Simplex.isOptimal(snap) : false;
}

/** Pivot element according to the app's pivot rule (see Simplex.choosePivot). */
export function choosePivotEditable(t: EditableTableau): { row: number; col: number } {
  const snap = toSnapshot(t);
  return snap ? Simplex.choosePivot(snap) : { row: -1, col: -1 };
}

/**
 * Exchange step at the pivot selected in `prev`.
 * Returns null if no pivot is selected, a cell is invalid or the pivot is 0.
 */
export function pivotStep(prev: EditableTableau): EditableTableau | null {
  if (!prev || prev.pivotRow < 0 || prev.pivotCol < 0) return null;
  const snap = toSnapshot(prev);
  if (!snap) return null;
  if (snap.data[prev.pivotRow]?.[prev.pivotCol]?.isZero() !== false) return null;
  const next = Simplex.performPivot(snap);
  return { ...Simplex.toEditable(next), pivotRow: -1, pivotCol: -1, isOptimal: false };
}

/**
 * Full exact solution path from an editable start tableau.
 * Every tableau except the last carries its pivot position.
 */
export function solvePathFrom(start: EditableTableau, maxIter = 50): { path: TableauSnapshot[]; optimal: boolean } | null {
  const first = toSnapshot(start);
  if (!first) return null;
  const path: TableauSnapshot[] = [{ ...first, pivotRow: -1, pivotCol: -1, isOptimal: false }];
  for (let iter = 0; iter < maxIter; iter++) {
    const current = path[path.length - 1];
    if (Simplex.isOptimal(current)) {
      path[path.length - 1] = { ...current, isOptimal: true };
      return { path, optimal: true };
    }
    const pivot = Simplex.choosePivot(current);
    if (pivot.row < 0 || pivot.col < 0) return { path, optimal: false }; // unbounded / infeasible
    const withPivot = { ...current, pivotRow: pivot.row, pivotCol: pivot.col };
    path[path.length - 1] = withPivot;
    path.push(Simplex.performPivot(withPivot));
  }
  return { path, optimal: false }; // did not converge (e.g. cycling)
}

/**
 * Compare a user tableau with the correct one. Labels case-insensitive,
 * values exact. Returns German error messages (empty = correct).
 */
export function compareTableau(user: EditableTableau, correct: TableauSnapshot): string[] {
  const fehler: string[] = [];
  const cRows = correct.data.length;
  const cCols = correct.data[0]?.length || 0;
  if (user.data.length !== cRows || (user.data[0]?.length || 0) !== cCols) {
    fehler.push(`Falsche Dimensionen: ${user.data.length}x${user.data[0]?.length || 0} statt ${cRows}x${cCols}`);
    return fehler;
  }
  for (let r = 1; r < correct.basis.length; r++) {
    if ((user.basis?.[r] || '').trim().toLowerCase() !== correct.basis[r].toLowerCase()) {
      fehler.push(`Zeile ${r}: Basisvariable "${user.basis?.[r] || ''}" sollte "${correct.basis[r]}" sein`);
    }
  }
  for (let c = 0; c < correct.nbVars.length; c++) {
    if ((user.nbVars?.[c] || '').trim().toLowerCase() !== correct.nbVars[c].toLowerCase()) {
      fehler.push(`Spalte ${c + 1}: "${user.nbVars?.[c] || ''}" sollte "${correct.nbVars[c]}" sein`);
    }
  }
  for (let r = 0; r < cRows; r++) {
    for (let c = 0; c < cCols; c++) {
      const raw = user.data[r][c];
      const val = parseCell(raw);
      const ok = val !== null && val.equals(correct.data[r][c]);
      if (!ok) {
        const rowName = r === 0 ? (correct.zLabel || 'Z') : (correct.basis[r] || `Zeile ${r}`);
        const colName = c < cCols - 1 ? (correct.nbVars[c] || `Spalte ${c + 1}`) : 'Wert';
        const shown = (raw ?? '').trim() === '' ? 'leer' : raw;
        fehler.push(val === null
          ? `${rowName}, ${colName}: "${raw}" ist keine gültige Zahl (erlaubt: 3, -5/3, 2,5)`
          : `${rowName}, ${colName}: Ist ${shown}, sollte ${correct.data[r][c].toDisplayString()} sein`);
      }
    }
  }
  return fehler;
}
