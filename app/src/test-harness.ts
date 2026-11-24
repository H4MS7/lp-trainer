// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

// @ts-nocheck
/**
 * Comprehensive test harness for LP Trainer.
 * Run with: npx tsx src/test-harness.ts [suite]
 * Suites: generator, solver, prose, all
 */
import { Fraction } from './lib/fraction';
import { solve, isOptimal, buildInitialTableau, choosePivot, performPivot, toEditable } from './lib/simplex';
import { generateProblem, formatProblem } from './lib/generator';
import type { GeneratorConfig, GeneratedProblem, TableauSnapshot } from './lib/types';
import * as fs from 'fs';
import * as path from 'path';

// ─── Utilities ──────────────────────────────────────────

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

// ─── Suite 1: Generator Tests ───────────────────────────

function testGenerator() {
  section('GENERATOR TESTS');

  const configs: Array<{ nVars: number; nConstraints: number; niceNumbers: boolean; label: string }> = [];

  // Test all var counts 2-5 with various constraint counts
  for (const nVars of [2, 3, 4, 5]) {
    for (const nConstraints of [2, 3, 4, 5]) {
      configs.push({ nVars, nConstraints, niceNumbers: true, label: `${nVars}v/${nConstraints}c/nice` });
      configs.push({ nVars, nConstraints, niceNumbers: false, label: `${nVars}v/${nConstraints}c/ugly` });
    }
  }

  // Also test extreme configs
  configs.push({ nVars: 2, nConstraints: 8, niceNumbers: true, label: '2v/8c/nice' });
  configs.push({ nVars: 5, nConstraints: 8, niceNumbers: false, label: '5v/8c/ugly' });
  configs.push({ nVars: 3, nConstraints: 10, niceNumbers: false, label: '3v/10c/ugly' });

  for (const cfg of configs) {
    const config: GeneratorConfig = {
      nVars: cfg.nVars,
      nConstraints: cfg.nConstraints,
      minTableaus: 1,
      maxTableaus: 8,
      niceNumbers: cfg.niceNumbers,
      maxDenom: 6,
    };

    const seenHashes = new Set<string>();
    const start = performance.now();
    const problem = generateProblem(config, seenHashes, 10000);
    const elapsed = (performance.now() - start).toFixed(0);

    if (problem) {
      // Verify dimensions
      assert(problem.c.length === cfg.nVars, `${cfg.label}: c has ${problem.c.length} vars, expected ${cfg.nVars}`);
      assert(problem.A.length === cfg.nConstraints, `${cfg.label}: A has ${problem.A.length} rows, expected ${cfg.nConstraints}`);
      for (let i = 0; i < problem.A.length; i++) {
        assert(problem.A[i].length === cfg.nVars, `${cfg.label}: A[${i}] has ${problem.A[i].length} cols, expected ${cfg.nVars}`);
      }
      assert(problem.b.length === cfg.nConstraints, `${cfg.label}: b has ${problem.b.length} entries, expected ${cfg.nConstraints}`);

      // Verify solution path
      assert(problem.solutionPath.length >= 2, `${cfg.label}: solution path has ${problem.solutionPath.length} steps`);
      const lastTab = problem.solutionPath[problem.solutionPath.length - 1];
      assert(lastTab.isOptimal === true, `${cfg.label}: last tableau should be optimal`);

      // Verify tableau dimensions in solution path
      for (let s = 0; s < problem.solutionPath.length; s++) {
        const tab = problem.solutionPath[s];
        const expectedRows = cfg.nConstraints + 1;
        const expectedCols = cfg.nVars + 1;
        assert(tab.data.length === expectedRows, `${cfg.label}: step ${s} has ${tab.data.length} rows, expected ${expectedRows}`);
        assert(tab.data[0].length === expectedCols, `${cfg.label}: step ${s} has ${tab.data[0].length} cols, expected ${expectedCols}`);
        assert(tab.basis.length === expectedRows, `${cfg.label}: step ${s} basis length ${tab.basis.length}, expected ${expectedRows}`);
        assert(tab.nbVars.length === cfg.nVars, `${cfg.label}: step ${s} nbVars length ${tab.nbVars.length}, expected ${cfg.nVars}`);
      }

      // Verify nice numbers if applicable
      if (cfg.niceNumbers) {
        let allNice = true;
        for (const tab of problem.solutionPath) {
          for (const row of tab.data) {
            for (const cell of row) {
              if (cell.den > 6n) { allNice = false; break; }
            }
            if (!allNice) break;
          }
          if (!allNice) break;
        }
        assert(allNice, `${cfg.label}: all denominators should be ≤ 6`);
      }

      // Verify format
      const formatted = formatProblem(problem);
      assert(formatted.zielfunktion.includes('(max)'), `${cfg.label}: zielfunktion should end with (max)`);
      assert(formatted.nebenbedingungen.length === cfg.nConstraints + 1, `${cfg.label}: should have ${cfg.nConstraints + 1} NB (incl. non-neg)`);
      const nnLine = formatted.nebenbedingungen[formatted.nebenbedingungen.length - 1];
      const expectedVars = Array.from({ length: cfg.nVars }, (_, j) => `x${j + 1}`).join(', ');
      assert(nnLine.includes(expectedVars), `${cfg.label}: non-negativity should list ${expectedVars}`);

      console.log(`  OK: ${cfg.label} → ${problem.solutionPath.length - 1} pivots, Z=${lastTab.data[0][lastTab.data[0].length - 1].toString()}, ${elapsed}ms`);
    } else {
      assert(false, `${cfg.label}: generation FAILED (10000 attempts, ${elapsed}ms)`);
    }
  }
}

// ─── Suite 2: Solver Verification ───────────────────────

function testSolver() {
  section('SOLVER VERIFICATION');

  // Known small problems with hand-verified solutions
  const testCases = [
    {
      label: 'Classic 2x2',
      c: [5, 4],
      A: [[6, 4], [1, 2]],
      b: [24, 6],
      isMax: true,
      expectedOptimal: true,
    },
    {
      label: '3x2 mixed',
      c: [3, 5],
      A: [[1, 0], [0, 1], [1, 1]],
      b: [4, 6, 8],
      isMax: true,
      expectedOptimal: true,
    },
    {
      label: '2x3 more vars',
      c: [2, 3, 4],
      A: [[1, 1, 1], [2, 1, 3]],
      b: [10, 20],
      isMax: true,
      expectedOptimal: true,
    },
    {
      label: '3x4 four vars',
      c: [1, 2, 3, 4],
      A: [[1, 1, 0, 0], [0, 0, 1, 1], [1, 0, 1, 0]],
      b: [10, 10, 8],
      isMax: true,
      expectedOptimal: true,
    },
    {
      label: '4x5 five vars',
      c: [5, 4, 3, 2, 1],
      A: [[1, 1, 1, 0, 0], [0, 0, 1, 1, 1], [1, 0, 0, 1, 0], [0, 1, 0, 0, 1]],
      b: [10, 10, 8, 8],
      isMax: true,
      expectedOptimal: true,
    },
  ];

  for (const tc of testCases) {
    const cF = tc.c.map(v => Fraction.fromNumber(v));
    const AF = tc.A.map(row => row.map(v => Fraction.fromNumber(v)));
    const bF = tc.b.map(v => Fraction.fromNumber(v));

    const path = solve(cF, AF, bF, tc.isMax);

    if (path) {
      assert(path.length >= 2, `${tc.label}: path should have at least 2 tableaus`);
      const last = path[path.length - 1];
      assert(last.isOptimal === true, `${tc.label}: final tableau should be optimal`);

      // Verify optimality: all Z-row coefficients ≥ 0
      const nVarCols = last.data[0].length - 1;
      let zRowOk = true;
      for (let j = 0; j < nVarCols; j++) {
        if (last.data[0][j].isNegative()) { zRowOk = false; break; }
      }
      assert(zRowOk, `${tc.label}: Z-row should have all non-negative coefficients`);

      // Verify all RHS non-negative
      let rhsOk = true;
      for (let i = 1; i < last.data.length; i++) {
        if (last.data[i][nVarCols].isNegative()) { rhsOk = false; break; }
      }
      assert(rhsOk, `${tc.label}: all RHS should be non-negative`);

      // Verify each pivot step
      for (let s = 0; s < path.length - 1; s++) {
        const tab = path[s];
        assert(tab.pivotRow >= 1, `${tc.label} step ${s}: pivot row should be ≥ 1 (not Z-row)`);
        assert(tab.pivotCol >= 0, `${tc.label} step ${s}: pivot col should be ≥ 0`);
        assert(!tab.data[tab.pivotRow][tab.pivotCol].isZero(), `${tc.label} step ${s}: pivot element should not be zero`);
      }

      const zVal = last.data[0][nVarCols];
      console.log(`  OK: ${tc.label} → Z=${zVal.toString()}, ${path.length - 1} pivots, vars=${tc.c.length}`);
    } else {
      assert(tc.expectedOptimal === false, `${tc.label}: solver returned null but expected solution`);
    }
  }

  // Stress test: generate and verify 100 random problems per var count
  for (const nVars of [2, 3, 4, 5]) {
    let solved = 0;
    let failed = 0;
    const start = performance.now();

    for (let trial = 0; trial < 200; trial++) {
      const c = Array.from({ length: nVars }, () => 1 + Math.floor(Math.random() * 30));
      const nConstraints = 2 + Math.floor(Math.random() * 4);
      const A = Array.from({ length: nConstraints }, () =>
        Array.from({ length: nVars }, () => 1 + Math.floor(Math.random() * 12))
      );
      const b = Array.from({ length: nConstraints }, () => 20 + Math.floor(Math.random() * 281));

      const cF = c.map(v => Fraction.fromNumber(v));
      const AF = A.map(row => row.map(v => Fraction.fromNumber(v)));
      const bF = b.map(v => Fraction.fromNumber(v));

      const path = solve(cF, AF, bF, true);
      if (path) {
        solved++;
        const last = path[path.length - 1];
        assert(isOptimal(last), `Stress ${nVars}v trial ${trial}: final should be optimal`);

        // Verify dimensions preserved through solving
        assert(last.data.length === nConstraints + 1, `Stress ${nVars}v trial ${trial}: row count`);
        assert(last.data[0].length === nVars + 1, `Stress ${nVars}v trial ${trial}: col count`);
      } else {
        failed++;
      }
    }

    const elapsed = (performance.now() - start).toFixed(0);
    console.log(`  Stress ${nVars}v: ${solved} solved, ${failed} infeasible/unbounded (200 trials, ${elapsed}ms)`);
  }
}

// ─── Suite 3: Prose Problem Tests ───────────────────────

function testProseProblems() {
  section('PROSE PROBLEM TESTS');

  const allPath = path.resolve(import.meta.dirname || '.', '../../problems/all_problems.json');
  const raw = fs.readFileSync(allPath, 'utf-8');
  const problems = JSON.parse(raw);

  console.log(`  Loaded ${problems.length} problems from all_problems.json`);

  const typeStats: Record<string, { total: number; solvable: number; errors: string[] }> = {};

  for (let i = 0; i < problems.length; i++) {
    const p = problems[i];
    const typ = p.typ || 'UNKNOWN';
    if (!typeStats[typ]) typeStats[typ] = { total: 0, solvable: 0, errors: [] };
    typeStats[typ].total++;

    // Parse zielfunktion to extract coefficients
    const zfMatch = p.zielfunktion?.match(/Z\s*=\s*(.+)\s*\((max|min)\)/i);
    if (!zfMatch) {
      typeStats[typ].errors.push(`#${i} "${p.titel}": can't parse zielfunktion "${p.zielfunktion}"`);
      continue;
    }

    const isMax = zfMatch[2].toLowerCase() === 'max';
    const zfBody = zfMatch[1];

    // Extract coefficients from zielfunktion (handles "5x1", "x1", "+x2", "-x1" etc.)
    const cMap = new Map<number, number>();
    const termRegex = /([+-]?\s*(?:\d+(?:[.,]\d+)?)?)\s*x(\d+)/g;
    let m;
    while ((m = termRegex.exec(zfBody)) !== null) {
      const raw = m[1].replace(/\s/g, '').replace(',', '.');
      const coef = (raw === '' || raw === '+') ? 1 : raw === '-' ? -1 : parseFloat(raw);
      const varIdx = parseInt(m[2]) - 1;
      cMap.set(varIdx, coef);
    }

    if (cMap.size === 0) {
      typeStats[typ].errors.push(`#${i} "${p.titel}": no coefficients in zielfunktion`);
      continue;
    }

    const nVars = Math.max(...cMap.keys()) + 1;
    const c: number[] = Array(nVars).fill(0);
    for (const [idx, coef] of cMap) c[idx] = coef;

    // Parse nebenbedingungen (skip non-negativity)
    const A: number[][] = [];
    const b: number[] = [];
    const constraintTypes: string[] = [];

    for (const nb of p.nebenbedingungen || []) {
      if (/x\d.*≥\s*0/.test(nb) && !nb.includes('x1') && !nb.includes('x2')) continue;
      if (/^x\d.*≥\s*0$/.test(nb.trim())) continue;
      if (/^x\d+,\s*x\d+.*≥\s*0$/.test(nb.trim())) continue;

      // Match patterns like "3x1 + 5x2 ≤ 100" or "x2 ≤ 2x1"
      const parts = nb.split(/([≤≥=])/);
      if (parts.length < 3) continue;

      const lhs = parts[0];
      const op = parts[1];
      const rhsStr = parts.slice(2).join('').replace(/\s*\(.*\)/, '').replace(',', '.').trim();

      // Parse variable terms and constant from RHS (handles "2x1" on RHS)
      const rhsTermRegex = /([+-]?\s*(?:\d+(?:\.\d+)?)?)\s*x(\d+)/g;
      let rhsConst = rhsStr;
      let rhm;
      const row: number[] = Array(nVars).fill(0);

      // First parse LHS variable terms
      const lhsTerms = /([+-]?\s*(?:\d+(?:[.,]\d+)?)?)\s*x(\d+)/g;
      let lm;
      while ((lm = lhsTerms.exec(lhs)) !== null) {
        const raw = lm[1].replace(/\s/g, '').replace(',', '.');
        const coef = (raw === '' || raw === '+') ? 1 : raw === '-' ? -1 : parseFloat(raw);
        const varIdx = parseInt(lm[2]) - 1;
        if (varIdx < nVars) row[varIdx] = coef;
      }

      // Then parse RHS variable terms (move to LHS with negated sign)
      while ((rhm = rhsTermRegex.exec(rhsStr)) !== null) {
        const raw = rhm[1].replace(/\s/g, '');
        const coef = (raw === '' || raw === '+') ? 1 : raw === '-' ? -1 : parseFloat(raw);
        const varIdx = parseInt(rhm[2]) - 1;
        if (varIdx < nVars) row[varIdx] -= coef; // Move to LHS with negation
        rhsConst = rhsConst.replace(rhm[0], ''); // Remove var term from RHS
      }

      const rhs = parseFloat(rhsConst.trim()) || 0;

      if (op === '≤') {
        A.push(row);
        b.push(rhs);
        constraintTypes.push('<=');
      } else if (op === '≥') {
        // Convert ≥ to ≤ by multiplying by -1
        A.push(row.map(v => -v));
        b.push(-rhs);
        constraintTypes.push('>=');
      } else if (op === '=') {
        A.push(row);
        b.push(rhs);
        A.push(row.map(v => -v));
        b.push(-rhs);
        constraintTypes.push('=');
      }
    }

    if (A.length === 0) {
      typeStats[typ].errors.push(`#${i} "${p.titel}": no parseable constraints`);
      continue;
    }

    // Solve
    const cF = c.map(v => Fraction.fromNumber(v));
    const AF = A.map(row => row.map(v => Fraction.fromNumber(v)));
    const bF = b.map(v => Fraction.fromNumber(v));

    try {
      const path = solve(cF, AF, bF, isMax);
      if (path) {
        typeStats[typ].solvable++;
        const last = path[path.length - 1];
        assert(isOptimal(last), `Prose #${i} "${p.titel}": solution should be optimal`);
      } else {
        typeStats[typ].errors.push(`#${i} "${p.titel}": solver returned null (infeasible/unbounded)`);
      }
    } catch (e: any) {
      typeStats[typ].errors.push(`#${i} "${p.titel}": solver threw: ${e.message}`);
    }
  }

  // Report by type
  console.log(`\n  Results by type:`);
  for (const [typ, stats] of Object.entries(typeStats).sort()) {
    const pct = stats.total > 0 ? ((stats.solvable / stats.total) * 100).toFixed(0) : '0';
    console.log(`  ${typ}: ${stats.solvable}/${stats.total} solvable (${pct}%)`);
    for (const err of stats.errors.slice(0, 3)) {
      console.log(`    ${err}`);
    }
    if (stats.errors.length > 3) {
      console.log(`    ... and ${stats.errors.length - 3} more errors`);
    }
  }
}

// ─── Suite 4: Editable/Display Tests ────────────────────

function testDisplay() {
  section('DISPLAY/EDITABLE TESTS');

  // Generate a problem with each var count and check toEditable
  for (const nVars of [2, 3, 4, 5]) {
    const config: GeneratorConfig = {
      nVars,
      nConstraints: 3,
      minTableaus: 1,
      maxTableaus: 6,
      niceNumbers: false,
      maxDenom: 6,
    };

    const problem = generateProblem(config, new Set(), 5000);
    if (!problem) {
      assert(false, `Display ${nVars}v: could not generate problem`);
      continue;
    }

    // Test toEditable
    for (let s = 0; s < problem.solutionPath.length; s++) {
      const tab = problem.solutionPath[s];
      const editable = toEditable(tab);

      assert(editable.data.length === tab.data.length, `Display ${nVars}v step ${s}: row count matches`);
      assert(editable.data[0].length === tab.data[0].length, `Display ${nVars}v step ${s}: col count matches`);
      assert(editable.basis.length === tab.basis.length, `Display ${nVars}v step ${s}: basis length matches`);
      assert(editable.nbVars.length === tab.nbVars.length, `Display ${nVars}v step ${s}: nbVars length matches`);

      // Verify all values are non-empty strings
      for (let r = 0; r < editable.data.length; r++) {
        for (let c = 0; c < editable.data[r].length; c++) {
          assert(typeof editable.data[r][c] === 'string', `Display ${nVars}v step ${s}: cell [${r}][${c}] is string`);
          assert(editable.data[r][c].length > 0, `Display ${nVars}v step ${s}: cell [${r}][${c}] is non-empty`);
        }
      }
    }

    // Test formatProblem
    const formatted = formatProblem(problem);
    const varNames = Array.from({ length: nVars }, (_, j) => `x${j + 1}`);
    for (const vn of varNames) {
      assert(formatted.zielfunktion.includes(vn), `Display ${nVars}v: zielfunktion contains ${vn}`);
    }

    console.log(`  OK: ${nVars}v display/editable tests passed`);
  }
}

// ─── Main ───────────────────────────────────────────────

const suite = process.argv[2] || 'all';

if (suite === 'generator' || suite === 'all') testGenerator();
if (suite === 'solver' || suite === 'all') testSolver();
if (suite === 'prose' || suite === 'all') testProseProblems();
if (suite === 'display' || suite === 'all') testDisplay();

console.log(`\n${'═'.repeat(60)}`);
console.log(`  FINAL RESULTS: ${passCount} passed, ${failCount} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
}

process.exit(failCount > 0 ? 1 : 0);
