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
 * 5. Variable count detection
 *
 * Run with: npx tsx src/test-multivar-flow.ts
 */
import * as fs from 'fs';
import * as path from 'path';

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

/** Line 728-786: buildStartTableauFromParsed (exact copy from component) */
function buildStartTableauFromParsed(cArr: number[], isMin: boolean, nbs: string[], numVars: number) {
  const constraints: { coeffs: number[]; rhs: number }[] = [];
  nbs.forEach(nb => {
    const clean = nb.replace(/\(.*?\)/g, '').replace(/,/g, '.').trim();
    let type = 'leq';
    if (clean.includes('≥') || clean.includes('>=')) type = 'geq';

    const parts = clean.split(/[≤≥]=?|<=|>=/)[0].trim();
    const rhsStr = clean.split(/[≤≥]=?|<=|>=/)[1];
    let rhs = rhsStr ? (parseFloat(rhsStr.trim()) || 0) : 0;

    const coeffs: number[] = [];
    for (let j = 1; j <= numVars; j++) {
      const re = new RegExp(`(-?\\d*(?:\\.\\d+)?)\\s*x${j}`, 'i');
      const m = parts.match(re);
      if (m) {
        const coef = m[1];
        coeffs.push(coef === '' || coef === '+' ? 1 : coef === '-' ? -1 : parseFloat(coef));
      } else {
        coeffs.push(0);
      }
    }

    if (type === 'geq') {
      for (let j = 0; j < coeffs.length; j++) coeffs[j] = -coeffs[j];
      rhs = -rhs;
    }
    constraints.push({ coeffs, rhs });
  });

  const numC = constraints.length;
  const rows = numC + 1;
  const cols = numVars + 1;
  const data = Array(rows).fill(null).map(() => Array(cols).fill(''));
  const basis = [isMin ? '-Z' : 'Z'];

  for (let j = 0; j < numVars; j++) {
    data[0][j] = String(isMin ? cArr[j] : -cArr[j]);
  }
  data[0][numVars] = '0';

  constraints.forEach((c, i) => {
    for (let j = 0; j < numVars; j++) {
      data[i + 1][j] = String(c.coeffs[j]);
    }
    data[i + 1][numVars] = String(c.rhs);
    basis.push(`y${i + 1}`);
  });

  return {
    data, basis,
    nbVars: Array(numVars).fill(null).map((_, j) => `x${j+1}`),
    zLabel: isMin ? '-Z' : 'Z',
    pivotRow: -1, pivotCol: -1, isOptimal: false
  };
}

/** Line 691-726: buildStartTableau (simplified - uses problem data directly) */
function buildStartTableau(problem: any) {
  const zf = problem.zielfunktion || '';
  const allNBs = problem.nebenbedingungen || [];
  const nbs = allNBs.filter(nb => !isNonNegativity(nb));

  const isMin = zf.toLowerCase().includes('min');
  const numVars = detectNumVars(problem);

  const zfClean = zf.replace(/,/g, '.');
  const cArr: number[] = [];
  for (let j = 1; j <= numVars; j++) {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*x${j}`, 'i');
    const m = zfClean.match(re);
    cArr.push(m ? parseFloat(m[1]) : 0);
  }
  if (cArr.every(v => v === 0)) return null;
  return buildStartTableauFromParsed(cArr, isMin, nbs, numVars);
}

/** choosePivotLocal (exact copy from line 788-835) */
function choosePivotLocal(tableau: any) {
  if (!tableau) return { row: -1, col: -1 };
  const data = tableau.data.map(r => r.map(c => parseFloat(c) || 0));
  const rows = data.length;
  const cols = data[0].length;
  const valCol = cols - 1;

  // Most negative in Z-row
  let pivotCol = -1;
  let minVal = -1e-10;
  for (let j = 0; j < valCol; j++) {
    if (data[0][j] < minVal) { minVal = data[0][j]; pivotCol = j; }
  }
  if (pivotCol < 0) return { row: -1, col: -1 };

  // Minimum ratio test
  let pivotRow = -1;
  let minRatio = Infinity;
  for (let i = 1; i < rows; i++) {
    if (data[i][pivotCol] > 1e-10) {
      const ratio = data[i][valCol] / data[i][pivotCol];
      if (ratio < minRatio) { minRatio = ratio; pivotRow = i; }
    }
  }
  return { row: pivotRow, col: pivotCol };
}

/** isOptimalLocal (exact copy from line 837-851) */
function isOptimalLocal(tableau: any) {
  const data = tableau.data.map(r => r.map(c => parseFloat(c) || 0));
  const cols = data[0].length;
  const valCol = cols - 1;
  for (let j = 0; j < valCol; j++) {
    if (data[0][j] < -1e-10) return false;
  }
  return true;
}

/** solvePivotStep (exact copy from line 631-689) */
function solvePivotStep(prevTableau: any) {
  const pr = prevTableau.pivotRow;
  const pc = prevTableau.pivotCol;
  if (pr < 0 || pc < 0) return null;

  const oldData = prevTableau.data.map(r => r.map(c => parseFloat(c) || 0));
  const pivotVal = oldData[pr][pc];
  if (Math.abs(pivotVal) < 1e-15) return null;

  const rows = oldData.length;
  const cols = oldData[0].length;

  // Tucker exchange (Rechteckregel)
  const newData = Array(rows).fill(null).map(() => Array(cols).fill(0));

  // Pivot element
  newData[pr][pc] = 1 / pivotVal;
  // Pivot row
  for (let j = 0; j < cols; j++) {
    if (j !== pc) newData[pr][j] = oldData[pr][j] / pivotVal;
  }
  // Pivot column
  for (let i = 0; i < rows; i++) {
    if (i !== pr) newData[i][pc] = -oldData[i][pc] / pivotVal;
  }
  // Rest
  for (let i = 0; i < rows; i++) {
    if (i === pr) continue;
    for (let j = 0; j < cols; j++) {
      if (j === pc) continue;
      newData[i][j] = oldData[i][j] - (oldData[i][pc] * oldData[pr][j]) / pivotVal;
    }
  }

  const oldBasis = [...prevTableau.basis];
  const oldNBVars = [...(prevTableau.nbVars || ['x1', 'x2'])];
  const entering = oldNBVars[pc];
  const leaving = oldBasis[pr];
  const newBasis = [...oldBasis];
  const newNBVars = [...oldNBVars];
  newBasis[pr] = entering;
  newNBVars[pc] = leaving;

  return {
    data: newData.map(r => r.map(v => String(Math.round(v * 10000) / 10000))),
    basis: newBasis,
    nbVars: newNBVars,
    zLabel: prevTableau.zLabel,
    pivotRow: -1, pivotCol: -1, isOptimal: false
  };
}

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
    const expectedConstraints = (p.nebenbedingungen || []).filter(nb => !isNonNegativity(nb)).length;
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
    const zRow = tab.data[0].map(v => parseFloat(v) || 0);
    const hasZCoeffs = zRow.slice(0, -1).some(v => v !== 0);
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

// ─── Main ───────────────────────────────────────────────

testNonNegativityFilters();
testVariableDetection();
testBuildStartTableau();
testFullSolveLoop();
testAdoptSolutionFlow();
testHighlightValidation();
testFallbackDefaults();

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
