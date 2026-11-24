// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

// @ts-nocheck
/**
 * Targeted multi-variable UI flow test.
 * Tests the exact logic from LPModellTrainer.tsx that handles:
 * 1. Non-negativity constraint filtering (the line 342 bug)
 * 2. adoptSolution flow
 * 3. buildStartTableau + buildStartTableauFromParsed
 * 4. Full solve loop (checkSimplexSolution flow)
 * 6. Pivot rule (most negative Z value) and exact cell input/comparison
 * 7. Tutor mode: full guided runs, formulas, mistake diagnosis, mastery
 * 5. Variable count detection
 *
 * Run with: npx tsx src/test-multivar-flow.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildStartTableauFromText, parseConstraint, parseObjective, pivotStep, isOptimalEditable, choosePivotEditable, parseCell, solvePathFrom, compareTableau } from './lib/tableauFlow';
import * as Simplex from './lib/simplex';
import { Fraction } from './lib/fraction';
import { generateProblem, formatProblem } from './lib/generator';
import { buildTutorSteps, currentStepIndex, diagnoseCell, updateMastery, autoLevel, MASTERY_GOAL } from './lib/tutor';
import { describeStartRows } from './lib/tableauFlow';

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

function section(name: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(60)}`);
}

// ─── Extract logic from LPModellTrainer.tsx ──────────────

/** Precise regex: matches ONLY pure non-negativity like "x1, x2 ≥ 0" */
const isNonNegativity = (nb: string) => /^x\d+(,\s*x\d+)*\s*≥\s*0$/.test(nb.trim());

/** Current FIXED pattern: precise regex */
function filterNonNegativity_FIXED(nebenbedingungen: string[]): string[] {
  return nebenbedingungen.filter(nb => !isNonNegativity(nb));
}

/** OLD BROKEN pattern (hardcoded 2-var): for comparison */
function filterNonNegativity_BROKEN(nebenbedingungen: string[]): string[] {
  return nebenbedingungen.filter(nb => !nb.includes('x1, x2 ≥ 0'));
}

/** OLD includes-based pattern: also broken for ratio constraints */
function filterNonNegativity_includesBased(nebenbedingungen: string[]): string[] {
  return nebenbedingungen.filter(nb => !(nb.includes('≥ 0') && nb.includes('x')));
}

/** Line 356-361: detectNumVars */
function detectNumVars(problem: any): number {
  if (problem?.variablen?.length) return problem.variablen.length;
  const zf = problem?.zielfunktion || '';
  const matches = zf.match(/x(\d+)/gi) || [];
  return Math.max(2, ...matches.map(m => parseInt(m.replace(/x/i, ''))));
}

/** buildStartTableau as the component does it for the Musterlösung (real parser from lib/tableauFlow) */
function buildStartTableau(problem: any) {
  const nbs = (problem.nebenbedingungen || []).filter(nb => !isNonNegativity(nb));
  return buildStartTableauFromText(problem.zielfunktion || '', nbs, detectNumVars(problem));
}

/** Equality constraints become two tableau rows (≤ and ≥). */
const isEquality = (nb: string) => !/[≤≥]|<=|>=/.test(nb) && /=/.test(nb.replace(/\([^()]*\)/g, ''));

// The simplex steps are the real implementations from lib/tableauFlow (exact fractions),
// not copies, so this test checks exactly what the UI runs.
const isOptimalLocal = isOptimalEditable;
const choosePivotLocal = choosePivotEditable;
const solvePivotStep = pivotStep;

/** Full solve loop: buildStartTableau → iterate pivots → optimal (mirrors checkSimplexSolution) */
function fullSolveLoop(problem: any): { success: boolean; steps: number; zValue: string; error?: string } {
  const startTab = buildStartTableau(problem);
  if (!startTab) return { success: false, steps: 0, zValue: '', error: 'buildStartTableau returned null' };

  let current = startTab;

  for (let iter = 0; iter < 30; iter++) {
    if (isOptimalLocal(current)) {
      const cols = current.data[0].length;
      return { success: true, steps: iter, zValue: current.data[0][cols - 1] };
    }
    const pivot = choosePivotLocal(current);
    if (pivot.row < 0 || pivot.col < 0) {
      return { success: false, steps: iter, zValue: '', error: `No valid pivot at step ${iter}` };
    }
    current = { ...current, pivotRow: pivot.row, pivotCol: pivot.col };
    const next = solvePivotStep(current);
    if (!next) return { success: false, steps: iter, zValue: '', error: `Pivot failed at step ${iter}` };
    current = { ...next, pivotRow: -1, pivotCol: -1, isOptimal: false };
  }

  return { success: false, steps: 30, zValue: '', error: 'Max iterations exceeded' };
}

// ─── Load problems ──────────────────────────────────────

const allPath = path.resolve(import.meta.dirname || '.', '../../problems/all_problems.json');
const raw = fs.readFileSync(allPath, 'utf-8');
const ALL_PROBLEMS: any[] = JSON.parse(raw);

// ─── Test Suite 1: Non-Negativity Filter Patterns ───────

function testNonNegativityFilters() {
  section('NON-NEGATIVITY FILTER PATTERNS');

  const testCases = [
    { nb: 'x1, x2 ≥ 0', expectedFiltered: true, label: '2-var standard' },
    { nb: 'x1, x2, x3 ≥ 0', expectedFiltered: true, label: '3-var standard' },
    { nb: 'x1, x2, x3, x4 ≥ 0', expectedFiltered: true, label: '4-var standard' },
    { nb: 'x1, x2, x3, x4, x5 ≥ 0', expectedFiltered: true, label: '5-var standard' },
    { nb: '3x1 + 5x2 ≤ 100 (Budget)', expectedFiltered: false, label: 'normal ≤ constraint' },
    { nb: '5x1 + 7x2 + 6x3 + 4x4 ≥ 926 (Mindestrendite)', expectedFiltered: false, label: 'normal ≥ constraint' },
    { nb: '8x1 + 10x2 + 12x3 + 9x4 ≤ 4943 (Gesamtbudget)', expectedFiltered: false, label: '4-var ≤ constraint' },
    { nb: '2x1 + 3x2 ≤ 50', expectedFiltered: false, label: 'simple 2-var constraint' },
  ];

  console.log('\n  Testing FIXED pattern (line 342): nb.includes("≥ 0") && nb.includes("x")');
  for (const tc of testCases) {
    const result = filterNonNegativity_FIXED([tc.nb]);
    const wasFiltered = result.length === 0;
    assert(wasFiltered === tc.expectedFiltered, `FIXED filter ${tc.label}: "${tc.nb}" → filtered=${wasFiltered}, expected=${tc.expectedFiltered}`);
  }

  console.log('\n  Testing BROKEN pattern (old line 342): nb.includes("x1, x2 ≥ 0")');
  for (const tc of testCases) {
    const result = filterNonNegativity_BROKEN([tc.nb]);
    const wasFiltered = result.length === 0;
    if (tc.label.startsWith('3-var') || tc.label.startsWith('4-var') || tc.label.startsWith('5-var')) {
      // These would NOT be filtered by the broken pattern
      assert(wasFiltered === false, `BROKEN filter correctly FAILS for ${tc.label}`);
    }
  }

  console.log('\n  Testing includes-based pattern (old): nb.includes("≥ 0") && nb.includes("x")');
  for (const tc of testCases) {
    const result = filterNonNegativity_includesBased([tc.nb]);
    const wasFiltered = result.length === 0;
    // This pattern has false positives for ratio constraints ending with ≥ 0
  }

  // Test against ALL problems
  console.log('\n  Testing all 421 problems with each filter pattern:');
  let fixedOk = 0, fixedBad = 0;
  let brokenOk = 0, brokenBad = 0;
  let includesOk = 0, includesBad = 0;

  for (const p of ALL_PROBLEMS) {
    const nbs = p.nebenbedingungen || [];
    // Count non-negativity constraints precisely: ones matching the regex pattern
    const nnCount = nbs.filter(nb => isNonNegativity(nb)).length;
    const expectedConstraints = nbs.length - nnCount;

    const fixedResult = filterNonNegativity_FIXED(nbs).length;
    const brokenResult = filterNonNegativity_BROKEN(nbs).length;
    const includesResult = filterNonNegativity_includesBased(nbs).length;

    if (fixedResult === expectedConstraints) fixedOk++; else fixedBad++;
    if (brokenResult === expectedConstraints) brokenOk++; else brokenBad++;
    if (includesResult === expectedConstraints) includesOk++; else includesBad++;
  }

  console.log(`    FIXED (regex):     ${fixedOk} correct, ${fixedBad} wrong`);
  console.log(`    BROKEN (2-var):    ${brokenOk} correct, ${brokenBad} wrong`);
  console.log(`    includes-based:    ${includesOk} correct, ${includesBad} wrong`);

  assert(fixedBad === 0, `FIXED filter should work for all ${ALL_PROBLEMS.length} problems`);
  assert(includesBad > 0, `includes-based filter should have known failures (ratio constraints)`);
}

// ─── Test Suite 2: Variable Count Detection ─────────────

function testVariableDetection() {
  section('VARIABLE COUNT DETECTION');

  const varCounts: Record<number, number> = {};

  for (let i = 0; i < ALL_PROBLEMS.length; i++) {
    const p = ALL_PROBLEMS[i];
    const nVars = detectNumVars(p);

    varCounts[nVars] = (varCounts[nVars] || 0) + 1;

    // Cross-check: variablen array length should match
    if (p.variablen?.length) {
      assert(nVars === p.variablen.length, `#${i} "${p.titel}": detectNumVars=${nVars} matches variablen.length=${p.variablen.length}`);
    }

    // Cross-check: zielfunktion should mention x1..xN
    const zf = p.zielfunktion || '';
    for (let j = 1; j <= nVars; j++) {
      assert(zf.includes(`x${j}`), `#${i} "${p.titel}": zielfunktion mentions x${j}`);
    }

    // Cross-check: non-negativity line should list all variables
    const nnLine = (p.nebenbedingungen || []).find(nb => nb.includes('≥ 0') && nb.includes('x'));
    if (nnLine) {
      for (let j = 1; j <= nVars; j++) {
        assert(nnLine.includes(`x${j}`), `#${i} "${p.titel}": non-negativity lists x${j}`);
      }
    }
  }

  console.log(`\n  Variable count distribution:`);
  for (const [n, count] of Object.entries(varCounts).sort()) {
    console.log(`    ${n}-var: ${count} problems`);
  }
}

// ─── Test Suite 3: buildStartTableau for ALL problems ───

function testBuildStartTableau() {
  section('BUILD START TABLEAU (all 421 problems)');

  const statsByVars: Record<number, { total: number; ok: number; errors: string[] }> = {};
  const statsByType: Record<string, { total: number; ok: number; errors: string[] }> = {};

  for (let i = 0; i < ALL_PROBLEMS.length; i++) {
    const p = ALL_PROBLEMS[i];
    const nVars = detectNumVars(p);
    const typ = p.typ || 'UNKNOWN';

    if (!statsByVars[nVars]) statsByVars[nVars] = { total: 0, ok: 0, errors: [] };
    if (!statsByType[typ]) statsByType[typ] = { total: 0, ok: 0, errors: [] };
    statsByVars[nVars].total++;
    statsByType[typ].total++;

    const tab = buildStartTableau(p);

    if (!tab) {
      const err = `#${i} "${p.titel}" (${nVars}v): buildStartTableau returned null`;
      statsByVars[nVars].errors.push(err);
      statsByType[typ].errors.push(err);
      assert(false, err);
      continue;
    }

    // Check dimensions
    const expectedConstraints = (p.nebenbedingungen || []).filter(nb => !isNonNegativity(nb))
      .reduce((n, nb) => n + (isEquality(nb) ? 2 : 1), 0);
    const expectedRows = expectedConstraints + 1; // constraints + Z-row
    const expectedCols = nVars + 1; // vars + RHS

    const rowOk = tab.data.length === expectedRows;
    const colOk = tab.data[0].length === expectedCols;
    const basisOk = tab.basis.length === expectedRows;
    const nbVarsOk = tab.nbVars.length === nVars;

    assert(rowOk, `#${i} "${p.titel}" (${nVars}v): rows=${tab.data.length}, expected=${expectedRows}`);
    assert(colOk, `#${i} "${p.titel}" (${nVars}v): cols=${tab.data[0].length}, expected=${expectedCols}`);
    assert(basisOk, `#${i} "${p.titel}" (${nVars}v): basis length=${tab.basis.length}, expected=${expectedRows}`);
    assert(nbVarsOk, `#${i} "${p.titel}" (${nVars}v): nbVars length=${tab.nbVars.length}, expected=${nVars}`);

    // Check nbVars are correct
    for (let j = 0; j < nVars; j++) {
      assert(tab.nbVars[j] === `x${j+1}`, `#${i} "${p.titel}": nbVars[${j}] = "${tab.nbVars[j]}", expected "x${j+1}"`);
    }

    // Check basis labels
    assert(tab.basis[0] === 'Z' || tab.basis[0] === '-Z', `#${i} "${p.titel}": basis[0] = "${tab.basis[0]}", expected Z/-Z`);
    for (let r = 1; r < tab.basis.length; r++) {
      assert(tab.basis[r] === `y${r}`, `#${i} "${p.titel}": basis[${r}] = "${tab.basis[r]}", expected "y${r}"`);
    }

    // Check Z-row has non-zero coefficients
    const zRow = tab.data[0].map(v => parseCell(v));
    const hasZCoeffs = zRow.slice(0, -1).some(v => v !== null && !v.isZero());
    assert(hasZCoeffs, `#${i} "${p.titel}" (${nVars}v): Z-row has non-zero coefficients`);

    // Check all cells are non-empty strings
    let allStrings = true;
    for (const row of tab.data) {
      for (const cell of row) {
        if (typeof cell !== 'string' || cell === '') { allStrings = false; break; }
      }
    }
    assert(allStrings, `#${i} "${p.titel}" (${nVars}v): all cells are non-empty strings`);

    if (rowOk && colOk && basisOk && nbVarsOk && hasZCoeffs && allStrings) {
      statsByVars[nVars].ok++;
      statsByType[typ].ok++;
    } else {
      const err = `#${i} "${p.titel}" (${nVars}v): dimension or content error`;
      statsByVars[nVars].errors.push(err);
      statsByType[typ].errors.push(err);
    }
  }

  console.log(`\n  By variable count:`);
  for (const [n, stats] of Object.entries(statsByVars).sort()) {
    console.log(`    ${n}-var: ${stats.ok}/${stats.total} OK`);
    for (const err of stats.errors.slice(0, 3)) console.log(`      ${err}`);
    if (stats.errors.length > 3) console.log(`      ... and ${stats.errors.length - 3} more`);
  }

  console.log(`\n  By type:`);
  for (const [typ, stats] of Object.entries(statsByType).sort()) {
    console.log(`    ${typ}: ${stats.ok}/${stats.total} OK`);
    for (const err of stats.errors.slice(0, 2)) console.log(`      ${err}`);
  }
}

// ─── Test Suite 4: Full Solve Loop (all 421 problems) ───

function testFullSolveLoop() {
  section('FULL SOLVE LOOP (all 421 problems via UI functions)');

  const statsByVars: Record<number, { total: number; solved: number; errors: string[] }> = {};
  const statsByType: Record<string, { total: number; solved: number; errors: string[] }> = {};

  for (let i = 0; i < ALL_PROBLEMS.length; i++) {
    const p = ALL_PROBLEMS[i];
    const nVars = detectNumVars(p);
    const typ = p.typ || 'UNKNOWN';

    if (!statsByVars[nVars]) statsByVars[nVars] = { total: 0, solved: 0, errors: [] };
    if (!statsByType[typ]) statsByType[typ] = { total: 0, solved: 0, errors: [] };
    statsByVars[nVars].total++;
    statsByType[typ].total++;

    const result = fullSolveLoop(p);

    if (result.success) {
      statsByVars[nVars].solved++;
      statsByType[typ].solved++;
      assert(true, `#${i} solved`);
    } else {
      const err = `#${i} "${p.titel}" (${typ}, ${nVars}v): ${result.error}`;
      statsByVars[nVars].errors.push(err);
      statsByType[typ].errors.push(err);
      assert(false, err);
    }
  }

  console.log(`\n  By variable count:`);
  for (const [n, stats] of Object.entries(statsByVars).sort()) {
    const pct = stats.total > 0 ? ((stats.solved / stats.total) * 100).toFixed(0) : '0';
    console.log(`    ${n}-var: ${stats.solved}/${stats.total} solved (${pct}%)`);
    for (const err of stats.errors.slice(0, 5)) console.log(`      ${err}`);
    if (stats.errors.length > 5) console.log(`      ... and ${stats.errors.length - 5} more`);
  }

  console.log(`\n  By type:`);
  for (const [typ, stats] of Object.entries(statsByType).sort()) {
    const pct = stats.total > 0 ? ((stats.solved / stats.total) * 100).toFixed(0) : '0';
    console.log(`    ${typ}: ${stats.solved}/${stats.total} solved (${pct}%)`);
    for (const err of stats.errors.slice(0, 3)) console.log(`      ${err}`);
  }
}

// ─── Test Suite 5: adoptSolution → initializeSimplexTableaus flow ───

function testAdoptSolutionFlow() {
  section('ADOPT SOLUTION → SIMPLEX INIT FLOW (all 421 problems)');

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < ALL_PROBLEMS.length; i++) {
    const p = ALL_PROBLEMS[i];
    const nVars = detectNumVars(p);

    // Simulate adoptSolution (line 101-118)
    const realNB = (p.nebenbedingungen || []).filter(nb => !isNonNegativity(nb));
    const paddedNB = [...realNB];
    while (paddedNB.length < 4) paddedNB.push('');

    // Count expected constraints = total - non-negativity constraints
    const nnCount = (p.nebenbedingungen || []).filter(nb => isNonNegativity(nb)).length;
    const expectedConstraints = (p.nebenbedingungen || []).length - nnCount;
    assert(realNB.length === expectedConstraints,
      `#${i} "${p.titel}" (${nVars}v): adoptSolution realNB.length=${realNB.length}, expected=${expectedConstraints}`);

    // Simulate initializeSimplexTableaus (line 363-376)
    const numC = (p.nebenbedingungen || []).filter(nb => !isNonNegativity(nb)).length;
    assert(numC === expectedConstraints,
      `#${i} "${p.titel}" (${nVars}v): initSimplex numC=${numC}, expected=${expectedConstraints}`);

    const rows = numC + 1;
    const empty = {
      data: Array(rows).fill(null).map(() => Array(nVars + 1).fill('')),
      basis: ['Z', ...Array(numC).fill(null).map((_, idx) => `y${idx+1}`)],
      nbVars: Array(nVars).fill(null).map((_, j) => `x${j+1}`),
      pivotRow: -1, pivotCol: -1, isOptimal: false,
    };

    // Verify dimensions
    assert(empty.data.length === rows, `#${i}: init tableau rows=${empty.data.length}, expected=${rows}`);
    assert(empty.data[0].length === nVars + 1, `#${i}: init tableau cols=${empty.data[0].length}, expected=${nVars + 1}`);
    assert(empty.nbVars.length === nVars, `#${i}: init nbVars length=${empty.nbVars.length}, expected=${nVars}`);
    assert(empty.basis.length === rows, `#${i}: init basis length=${empty.basis.length}, expected=${rows}`);

    // Simulate checkSolution comparison: line 342
    const correctNB_fixed = (p.nebenbedingungen || []).filter(nb => !isNonNegativity(nb));
    const userNBcount = realNB.length;

    // The check at line 343: ok = zfOk && userNB.length >= correctNB.length
    const lengthOk = userNBcount >= correctNB_fixed.length;
    assert(lengthOk, `#${i} "${p.titel}" (${nVars}v): userNB(${userNBcount}) >= correctNB(${correctNB_fixed.length})`);

    if (lengthOk && realNB.length === expectedConstraints && numC === expectedConstraints) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n  Full flow: ${passed}/${ALL_PROBLEMS.length} passed, ${failed} failed`);
}

// ─── Test Suite 6: Highlight Validation (multi-var) ─────

function testHighlightValidation() {
  section('HIGHLIGHT VALIDATION (multi-var problems only)');

  const multiVar = ALL_PROBLEMS.filter(p => detectNumVars(p) >= 3);
  console.log(`  Testing ${multiVar.length} multi-var problems`);

  let highlightOk = 0;
  let highlightBad = 0;

  for (let i = 0; i < multiVar.length; i++) {
    const p = multiVar[i];
    const beschreibung = p.beschreibung || '';
    const nVars = detectNumVars(p);

    if (!p.highlights) {
      assert(false, `#${i} "${p.titel}" (${nVars}v): no highlights`);
      highlightBad++;
      continue;
    }

    let allOk = true;

    // Check zielfunktion highlights
    for (const h of p.highlights.zielfunktion || []) {
      if (!beschreibung.includes(h.text)) {
        assert(false, `#${i} "${p.titel}" (${nVars}v): ZF highlight not in beschreibung: "${h.text}"`);
        allOk = false;
      }
    }

    // Check nebenbedingungen highlights
    for (const nbHighlights of p.highlights.nebenbedingungen || []) {
      for (const h of nbHighlights) {
        if (!beschreibung.includes(h.text)) {
          assert(false, `#${i} "${p.titel}" (${nVars}v): NB highlight not in beschreibung: "${h.text}"`);
          allOk = false;
        }
      }
    }

    if (allOk) {
      highlightOk++;
      assert(true, `highlights ok for #${i}`);
    } else {
      highlightBad++;
    }
  }

  console.log(`\n  Highlights: ${highlightOk}/${multiVar.length} OK, ${highlightBad} with errors`);
}

// ─── Test Suite 7: Fallback default checks ──────────────

function testFallbackDefaults() {
  section('FALLBACK DEFAULTS (["x1","x2"] patterns)');

  // Test that nbVars is always properly set, never falling through to defaults
  for (let i = 0; i < ALL_PROBLEMS.length; i++) {
    const p = ALL_PROBLEMS[i];
    const nVars = detectNumVars(p);
    const tab = buildStartTableau(p);
    if (!tab) continue;

    // Simulate addNewTableau (line 383-389)
    const ntNbVars = [...(tab.nbVars || ['x1', 'x2'])];
    assert(ntNbVars.length === nVars,
      `#${i} "${p.titel}" (${nVars}v): addNewTableau nbVars length=${ntNbVars.length}, expected=${nVars}`);

    // After one pivot step, check nbVars preserved
    if (!isOptimalLocal(tab)) {
      const pivot = choosePivotLocal(tab);
      if (pivot.row >= 0 && pivot.col >= 0) {
        const withPivot = { ...tab, pivotRow: pivot.row, pivotCol: pivot.col };
        const next = solvePivotStep(withPivot);
        if (next) {
          assert(next.nbVars.length === nVars,
            `#${i} "${p.titel}" (${nVars}v): after pivot nbVars length=${next.nbVars.length}, expected=${nVars}`);

          // Check that addNewTableau would get correct nbVars from this
          const nt2NbVars = [...(next.nbVars || ['x1', 'x2'])];
          assert(nt2NbVars.length === nVars,
            `#${i} "${p.titel}" (${nVars}v): addNewTableau after pivot nbVars length=${nt2NbVars.length}, expected=${nVars}`);
        }
      }
    }
  }
}



// ─── Test Suite: LP text parser + independent optimum ───
function solveSquare(M: Fraction[][], r: Fraction[]): Fraction[] | null {
  const n = M.length;
  const A = M.map((row, i) => [...row, r[i]]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let i = col; i < n; i++) if (!A[i][col].isZero()) { piv = i; break; }
    if (piv < 0) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let i = 0; i < n; i++) {
      if (i === col || A[i][col].isZero()) continue;
      const f = A[i][col].div(A[col][col]);
      for (let j = col; j <= n; j++) A[i][j] = A[i][j].sub(f.mul(A[col][j]));
    }
  }
  return A.map((row, i) => row[n].div(row[i]));
}

/** Optimum by enumerating all vertices of {A x ≤ b, x ≥ 0} — independent of the simplex code. */
function vertexOptimum(c: Fraction[], rows: { coeffs: Fraction[]; rhs: Fraction }[], isMin: boolean): Fraction | null {
  const n = c.length;
  const cons = [...rows, ...c.map((_, j) => ({ coeffs: c.map((_, k) => (k === j ? Fraction.ONE.neg() : Fraction.ZERO)), rhs: Fraction.ZERO }))];
  let best: Fraction | null = null;
  const pick: number[] = [];
  const rec = (start: number) => {
    if (pick.length === n) {
      const x = solveSquare(pick.map(i => cons[i].coeffs), pick.map(i => cons[i].rhs));
      if (!x) return;
      for (const k of cons) {
        const lhs = k.coeffs.reduce((acc, a, j) => acc.add(a.mul(x[j])), Fraction.ZERO);
        if (k.rhs.lt(lhs)) return; // violated
      }
      const z = c.reduce((acc, cj, j) => acc.add(cj.mul(x[j])), Fraction.ZERO);
      if (best === null || (isMin ? z.lt(best) : best.lt(z))) best = z;
      return;
    }
    for (let i = start; i < cons.length; i++) { pick.push(i); rec(i + 1); pick.pop(); }
  };
  rec(0);
  return best;
}

function testParserAndIndependentOptimum() {
  section('LP TEXT PARSER + INDEPENDENT OPTIMUM (vertex enumeration)');
  const F = (n: number, d = 1) => new Fraction(BigInt(n), BigInt(d));
  const rowsEq = (got, want: [number[], number][]) =>
    !!got && got.length === want.length && got.every((r, i) => r.coeffs.every((c, j) => c.equals(F(want[i][0][j] * 10, 10))) && r.rhs.equals(F(want[i][1] * 10, 10)));

  assert(rowsEq(parseConstraint('x1 + x2 <= 10', 2), [[[1, 1], 10]]), 'parse <=');
  assert(rowsEq(parseConstraint('0,7x1 - 0,3x2 ≥ 0 (Mindestanteil A)', 2), [[[-0.7, 0.3], 0]]), 'parse minus term with decimal comma (≥ negated)');
  assert(rowsEq(parseConstraint('-3x1 + x2 ≤ 0 (Verhältnis B zu A)', 2), [[[-3, 1], 0]]), 'parse leading minus');
  assert(rowsEq(parseConstraint('x1 + x2 = 1000 (Gesamtmenge)', 2), [[[1, 1], 1000], [[-1, -1], -1000]]), 'parse equality → two rows');
  assert(rowsEq(parseConstraint('x2 = 3x1 (Verhältnis 1:3)', 2), [[[-3, 1], 0], [[3, -1], 0]]), 'parse variables on the right-hand side');
  assert(rowsEq(parseConstraint('2x1 ≥ 5 + x2', 2), [[[-2, 1], -5]]), 'parse mixed sides');
  assert(parseConstraint('2y1 + x2 ≤ 4', 2) === null, 'unknown variable → null');
  assert(parseConstraint('x3 ≤ 4', 2) === null, 'variable index out of range → null');
  const obj = parseObjective('Z = x1 + 9x2 (min)', 2);
  assert(!!obj && obj.isMin && obj.c[0].equals(F(1)) && obj.c[1].equals(F(9)), 'objective with implicit coefficient 1');
  const obj2 = parseObjective('Z = 0,4x1 + 0,9x2 (max)', 2);
  assert(!!obj2 && !obj2.isMin && obj2.c[0].equals(F(2, 5)), 'objective with decimal comma');

  let checked = 0;
  for (let i = 0; i < ALL_PROBLEMS.length; i++) {
    const p = ALL_PROBLEMS[i];
    const n = detectNumVars(p);
    const o = parseObjective(p.zielfunktion, n);
    const rows = (p.nebenbedingungen || []).filter(nb => !isNonNegativity(nb)).flatMap(nb => parseConstraint(nb, n) || []);
    const start = buildStartTableau(p);
    const solved = start ? solvePathFrom(start) : null;
    const expected = o ? vertexOptimum(o.c, rows, o.isMin) : null;
    if (!o || !solved || !solved.optimal || !expected) {
      assert(false, `#${i} "${p.titel}": parse/solve failed (obj ${!!o}, optimal ${solved?.optimal}, vertex ${!!expected})`);
      continue;
    }
    const last = solved.path[solved.path.length - 1];
    const v = last.data[0][last.data[0].length - 1];
    // Tableau stores Z for max and -Z for min ("-Z" row)
    const z = o.isMin ? v.neg() : v;
    assert(z.equals(expected), `#${i} "${p.titel}": simplex Z = ${z.toDisplayString()}, vertex optimum = ${expected.toDisplayString()}`);
    checked++;
  }
  console.log(`  ${checked} static problems: simplex optimum == vertex enumeration`);
}


// ─── Test Suite: tutor mode ─────────────────────────────
/** Play the tutor like a perfect student (as the UI does: auto-add the next tableau). */
function simulateTutor(path: any[], start: any): { ok: boolean; err?: string; steps: number } {
  const steps = buildTutorSteps(path, start);
  const p0 = path[0];
  const tabs: any[] = [{ data: p0.data.map(r => r.map(() => '')), basis: [...p0.basis], nbVars: [...p0.nbVars], pivotRow: -1, pivotCol: -1, isOptimal: false, zLabel: p0.zLabel }];
  let last = -1;
  for (let guard = 0; guard < 20000; guard++) {
    const idx = currentStepIndex(steps, tabs);
    if (idx === steps.length) break;
    if (idx <= last) return { ok: false, err: `no progress at step ${steps[idx].id}`, steps: steps.length };
    last = idx;
    const st = steps[idx];
    if (st.tableau === tabs.length) {
      const prev = tabs[tabs.length - 1];
      tabs.push({ data: prev.data.map(r => r.map(() => '')), basis: [...prev.basis], nbVars: [...prev.nbVars], pivotRow: -1, pivotCol: -1, isOptimal: false, zLabel: prev.zLabel });
    }
    const t = tabs[st.tableau];
    if (!t) return { ok: false, err: `step ${st.id} refers to missing tableau`, steps: steps.length };
    if (st.kind === 'cell') t.data[st.row][st.col] = st.expected.toDisplayString();
    if (st.kind === 'pivotCol') t.pivotCol = st.expectedPivotCol;
    if (st.kind === 'pivotRow') t.pivotRow = st.expectedPivotRow;
    if (st.kind === 'labels') { t.basis = [...st.expectedBasis]; t.nbVars = [...st.expectedNbVars]; }
    if (st.kind === 'optimal') t.isOptimal = true;
    // formulas must reproduce the expected value
    const c = st.calc;
    if (st.kind === 'cell' && c) {
      const want = st.skill === 'pivotElement' ? Fraction.ONE.div(c.pivot)
        : st.skill === 'pivotRowCell' ? c.old.div(c.pivot)
        : st.skill === 'pivotColCell' ? c.old.div(c.pivot.neg())
        : c.old.sub(c.rowVal.mul(c.colVal).div(c.pivot));
      if (!want.equals(st.expected)) return { ok: false, err: `formula mismatch at ${st.id}`, steps: steps.length };
    }
  }
  if (tabs.length !== path.length) return { ok: false, err: `tableaus ${tabs.length} != path ${path.length}`, steps: steps.length };
  for (let i = 0; i < path.length; i++) {
    const f = compareTableau(tabs[i], path[i]);
    if (f.length) return { ok: false, err: `tableau ${i}: ${f[0]}`, steps: steps.length };
  }
  if (!tabs[tabs.length - 1].isOptimal && path[path.length - 1].isOptimal) return { ok: false, err: 'optimal not ticked', steps: steps.length };
  return { ok: true, steps: steps.length };
}

function testTutor() {
  section('TUTOR MODE (guided runs, formulas, diagnosis, mastery)');
  const F = (n: number, d = 1) => new Fraction(BigInt(n), BigInt(d));

  // Simplex trainer problems
  const seen = new Set<string>();
  let runs = 0, totalSteps = 0;
  for (let k = 0; k < 60; k++) {
    const cfg = { nVars: 2 + (k % 4), nConstraints: 2 + (k % 5), minTableaus: 1 + (k % 3), maxTableaus: 6, niceNumbers: k % 3 !== 0, maxDenom: 12 };
    const prob = generateProblem(cfg, seen, 3000);
    if (!prob) continue;
    seen.add(prob.hash);
    const f = formatProblem(prob);
    const nbs = f.nebenbedingungen.filter(nb => !isNonNegativity(nb));
    const r = simulateTutor(prob.solutionPath, { isMin: false, objective: f.zielfunktion, rows: describeStartRows(nbs) });
    assert(r.ok, `trainer tutor run ${k}: ${r.err}`);
    runs++; totalSteps += r.steps;
  }
  console.log(`  trainer: ${runs} guided runs, ${totalSteps} steps`);

  // Modelling flow: all static problems (≥ → dual steps, = → two rows, min → -Z)
  let mRuns = 0, mSteps = 0;
  for (const prob of ALL_PROBLEMS) {
    const nbs = (prob.nebenbedingungen || []).filter(nb => !isNonNegativity(nb));
    const start = buildStartTableau(prob);
    const solved = start ? solvePathFrom(start) : null;
    if (!start || !solved) { assert(false, `tutor: no path for ${prob.titel}`); continue; }
    const rows = describeStartRows(nbs);
    assert(rows.length === start.data.length - 1, `describeStartRows matches tableau rows: ${prob.titel}`);
    const r = simulateTutor(solved.path, { isMin: start.zLabel === '-Z', objective: prob.zielfunktion, rows });
    assert(r.ok, `modelling tutor run "${prob.titel}": ${r.err}`);
    mRuns++; mSteps += r.steps;
  }
  console.log(`  modelling flow: ${mRuns} guided runs, ${mSteps} steps`);

  // Number hints never give away the result
  const demo = Simplex.solve([F(17), F(16)], [[F(6), F(3)], [F(9), F(3)], [F(12), F(5)]], [F(31), F(117), F(250)], true)!;
  const demoSteps = buildTutorSteps(demo, { isMin: false, objective: 'Z = 17x1 + 16x2 (max)', rows: describeStartRows(['6x1 + 3x2 ≤ 31', '9x1 + 3x2 ≤ 117', '12x1 + 5x2 ≤ 250']) });
  const leaks = demoSteps.filter(st => st.kind === 'cell' && st.calc && st.numbers && st.numbers.trimEnd().endsWith(`= ${st.result}`));
  assert(leaks.length === 0, `number hints do not end with the result (${leaks.map(l => l.id).join(', ')})`);
  const pc = demoSteps.find(st => st.kind === 'pivotCol')!;
  assert(pc.expectedPivotCol === 0 && !pc.numbers!.includes('→'), 'pivot column hint lists candidates without the answer');

  // Mistake diagnosis on a rectangle cell
  const rect = demoSteps.find(st => st.skill === 'rectangle' && st.calc && !st.expected!.isZero() && !st.calc.rowVal!.mul(st.calc.colVal!).isZero())!;
  const { old, rowVal, colVal, pivot } = rect.calc!;
  assert(diagnoseCell(rect, rect.expected!.neg().toDisplayString()).includes('Vorzeichen'), 'diagnose: sign error');
  assert(diagnoseCell(rect, old!.sub(rowVal!.mul(colVal!)).toDisplayString()).includes('geteilt'), `diagnose: forgot division (${diagnoseCell(rect, old!.sub(rowVal!.mul(colVal!)).toDisplayString())})`);
  assert(diagnoseCell(rect, old!.add(rowVal!.mul(colVal!).div(pivot!)).toDisplayString()).includes('abgezogen'), 'diagnose: added instead of subtracted');
  assert(diagnoseCell(rect, 'abc').includes('keine gültige Zahl'), 'diagnose: invalid input');
  assert(diagnoseCell(rect, old!.sub(rowVal!.mul(colVal!)).div(pivot!).toDisplayString()).includes('Nur das Produkt'), `diagnose: divided the old value too (${diagnoseCell(rect, old!.sub(rowVal!.mul(colVal!)).div(pivot!).toDisplayString())})`);
  // the reported case: -2 − (4 · (−13)) ÷ 6 = 20/3, learner typed 50/6
  const userCase = { ...rect, expected: F(20, 3), calc: { old: F(-2), rowVal: F(4), colVal: F(-13), pivot: F(6) } };
  assert(diagnoseCell(userCase, '50/6').includes('Nur das Produkt'), `diagnose 50/6 (${diagnoseCell(userCase, '50/6')})`);
  assert(diagnoseCell(userCase, '40/6') !== '' && F(40, 6).equals(F(20, 3)), '40/6 equals 20/3');
  // worked steps lead up to the result but never state it
  for (const st of demoSteps.filter(x => x.workedSteps)) {
    assert(st.workedSteps!.every(w => !w.trimEnd().endsWith(`= ${st.result}`)), `worked steps do not give away ${st.id}`);
  }
  assert(demoSteps.filter(x => x.skill === 'rectangle').every(x => x.workedSteps?.length === 3), 'rectangle cells have 3 worked steps');
  const pe = demoSteps.find(st => st.skill === 'pivotElement')!;
  assert(diagnoseCell(pe, pe.calc!.pivot!.toDisplayString()).includes('Kehrwert'), 'diagnose: pivot element not inverted');
  const third = demoSteps.find(st => st.kind === 'cell' && st.expected!.toDisplayString().includes('/'));
  if (third) assert(diagnoseCell(third, third.expected!.toNumber().toFixed(3).replace('.', ',')).includes('gerundet'), 'diagnose: rounded decimal');

  // Mastery: 3 clean in a row → mastered; a mistake resets; a hint keeps the streak
  let m = {};
  for (let i = 0; i < MASTERY_GOAL; i++) m = updateMastery(m, 'rectangle', 'clean');
  assert(m['rectangle'] === MASTERY_GOAL && autoLevel(m['rectangle']) === 0, 'mastery reached after 3 clean answers');
  m = updateMastery(m, 'rectangle', 'hint');
  assert(m['rectangle'] === MASTERY_GOAL, 'hint keeps the streak');
  m = updateMastery(m, 'rectangle', 'wrong');
  assert(m['rectangle'] === 0 && autoLevel(0) === 3, 'mistake resets to full help');
  assert(autoLevel(1) === 1 && autoLevel(2) === 1, 'partial mastery shows the rule only');
}

// ─── Test Suite: pivot rule + exact input ───────────────
function testPivotRuleAndInput() {
  section('PIVOT RULE (most negative Z) + EXACT INPUT');
  const F = (n: number, d = 1) => new Fraction(BigInt(n), BigInt(d));
  const eq = (a: Fraction | null, b: Fraction) => a !== null && a.equals(b);

  // Cell parsing
  assert(eq(parseCell('3'), F(3)), 'parseCell 3');
  assert(eq(parseCell('-5/3'), F(-5, 3)), 'parseCell -5/3');
  assert(eq(parseCell('2,5'), F(5, 2)), 'parseCell 2,5 (German decimal comma)');
  assert(eq(parseCell('2.5'), F(5, 2)), 'parseCell 2.5');
  assert(eq(parseCell(' 12,25 '), F(49, 4)), 'parseCell with spaces');
  assert(eq(parseCell('−1/2'), F(-1, 2)), 'parseCell unicode minus');
  assert(eq(parseCell(''), F(0)), 'parseCell empty → 0');
  assert(parseCell('abc') === null, 'parseCell abc → null');
  assert(parseCell('1/0') === null, 'parseCell 1/0 → null');
  assert(parseCell('2x1') === null, 'parseCell 2x1 → null');

  const tab = (z: string[], rows: string[][]) => ({
    data: [z, ...rows], basis: ['Z', ...rows.map((_, i) => `y${i + 1}`)],
    nbVars: z.slice(0, -1).map((_, j) => `x${j + 1}`), pivotRow: -1, pivotCol: -1, isOptimal: false, zLabel: 'Z',
  });

  // Primal: most negative Z value wins (Bland would pick column 0 here)
  let p = choosePivotEditable(tab(['-2', '-27', '0'], [['6', '10', '128'], ['2', '6', '25'], ['5', '6', '199']]));
  assert(p.col === 1, `pivot column = most negative Z value (got ${p.col})`);
  assert(p.row === 2, `pivot row = smallest ratio 25/6 (got ${p.row})`);
  // Ties → leftmost column, topmost row
  p = choosePivotEditable(tab(['-5', '-5', '0'], [['1', '1', '4'], ['2', '1', '8']]));
  assert(p.col === 0 && p.row === 1, `ties → leftmost column, topmost row (got ${p.row}/${p.col})`);
  // Dual step: most negative value
  p = choosePivotEditable(tab(['3', '2', '0'], [['-1', '-1', '-4'], ['-2', '-1', '-10']]));
  assert(p.row === 2, `dual: pivot row = most negative value (got ${p.row})`);
  // Fractions and decimal commas in the user tableau are computed exactly
  const step = pivotStep({ ...tab(['-1/2', '-3', '0'], [['2,5', '1', '10'], ['1', '3', '9']]), pivotRow: 2, pivotCol: 1 });
  assert(step !== null && step.data[0][2] === '9', `pivotStep with fractions/commas (Z = ${step?.data[0][2]})`);
  assert(pivotStep({ ...tab(['-1', '-1', '0'], [['abc', '1', '4']]), pivotRow: 1, pivotCol: 1 }) === null, 'pivotStep rejects invalid cells');

  // Display strings round-trip exactly (no truncation of long decimals)
  for (const [n, d] of [[3, 160], [1, 32], [-7, 64], [1, 3], [123457, 1000], [1, 1048576], [5, 2], [-400, 3]]) {
    const f = F(n, d);
    assert(eq(parseCell(f.toDisplayString()), f), `display round-trip ${n}/${d} → "${f.toDisplayString()}"`);
  }
  assert(F(3, 160).toDisplayString() === '0,01875', `0,01875 shown exactly (got ${F(3, 160).toDisplayString()})`);

  // Exact comparison
  const correct = Simplex.buildInitialTableau([F(1), F(1)], [[F(1, 3), F(5, 2)]], [F(4)], true);
  const user = tab(['-1', '-1', '0'], [['0,33', '2,5', '4']]);
  let fehler = compareTableau(user, correct);
  assert(fehler.length === 1 && fehler[0].includes('sollte 1/3'), `0,33 ≠ 1/3 is reported (${fehler.join('; ')})`);
  user.data[1][0] = '1/3';
  fehler = compareTableau(user, correct);
  assert(fehler.length === 0, `1/3 and 2,5 accepted (${fehler.join('; ')})`);
  user.data[1][1] = 'x';
  fehler = compareTableau(user, correct);
  assert(fehler.length === 1 && fehler[0].includes('keine gültige Zahl'), 'invalid input reported');

  // Generator (simplex trainer) follows the same rule on every primal step
  const seen = new Set<string>();
  let checkedSteps = 0;
  for (let k = 0; k < 60; k++) {
    const cfg = { nVars: 2 + (k % 4), nConstraints: 2 + (k % 5), minTableaus: 2, maxTableaus: 5, niceNumbers: k % 2 === 0, maxDenom: 6 };
    const prob = generateProblem(cfg, seen, 3000);
    if (!prob) continue;
    seen.add(prob.hash);
    for (const t of prob.solutionPath) {
      if (t.pivotCol < 0) continue;
      const n = t.data[0].length - 1;
      if (t.data.slice(1).some(r => r[n].isNegative())) continue; // dual step
      let best = 0;
      for (let j = 1; j < n; j++) if (t.data[0][j].lt(t.data[0][best])) best = j;
      assert(t.pivotCol === best, `generator pivot column = most negative Z (got ${t.pivotCol}, expected ${best})`);
      checkedSteps++;
    }
  }
  assert(checkedSteps > 50, `generator steps checked: ${checkedSteps}`);

  // Modelling flow and trainer engine agree on every static problem
  let agree = 0;
  for (const prob of ALL_PROBLEMS) {
    const start = buildStartTableau(prob);
    const solved = start ? solvePathFrom(start) : null;
    assert(!!solved && solved.optimal, `exact path optimal: ${prob.titel}`);
    if (!solved || !solved.optimal) continue;
    const loop = fullSolveLoop(prob);
    const last = solved.path[solved.path.length - 1];
    const z = last.data[0][last.data[0].length - 1];
    assert(loop.success && eq(parseCell(loop.zValue), z), `UI loop and exact path agree on Z: ${prob.titel}`);
    agree++;
  }
  console.log(`  ${agree} static problems: UI loop == exact path`);
}

// ─── Main ───────────────────────────────────────────────

testNonNegativityFilters();
testVariableDetection();
testBuildStartTableau();
testFullSolveLoop();
testAdoptSolutionFlow();
testHighlightValidation();
testFallbackDefaults();
testPivotRuleAndInput();
testParserAndIndependentOptimum();
testTutor();

console.log(`\n${'═'.repeat(60)}`);
console.log(`  FINAL RESULTS: ${passCount} passed, ${failCount} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log(`\nFirst 20 failures:`);
  for (const f of failures.slice(0, 20)) {
    console.log(`  ✗ ${f}`);
  }
  if (failures.length > 20) {
    console.log(`  ... and ${failures.length - 20} more failures`);
  }
}

process.exit(failCount > 0 ? 1 : 0);
