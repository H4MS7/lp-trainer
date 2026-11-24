// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

/**
 * Tutor mode: walks the learner through the simplex method cell by cell in a
 * fixed order (start tableau → pivot choice → swap labels → pivot element →
 * pivot row → pivot column → rectangle rule → … → optimum).
 *
 * Everything here is pure: the current step is derived from the user's
 * tableaus (first step that is not done yet), so the UI only renders it.
 */
import { Fraction } from './fraction';
import { parseCell } from './tableauFlow';
import type { StartRowInfo } from './tableauFlow';
import type { EditableTableau, TableauSnapshot } from './types';

export type SkillId =
  | 'startZ' | 'startRow' | 'pivotCol' | 'pivotRow' | 'dualPivot' | 'labels'
  | 'pivotElement' | 'pivotRowCell' | 'pivotColCell' | 'rectangle' | 'optimal';

export const SKILLS: { id: SkillId; label: string }[] = [
  { id: 'startZ', label: 'Starttableau: Z-Zeile' },
  { id: 'startRow', label: 'Starttableau: Nebenbedingungen' },
  { id: 'pivotCol', label: 'Pivotspalte wählen' },
  { id: 'pivotRow', label: 'Pivotzeile wählen' },
  { id: 'dualPivot', label: 'Duale Schritte' },
  { id: 'labels', label: 'Variablen tauschen' },
  { id: 'pivotElement', label: 'Pivotelement' },
  { id: 'pivotRowCell', label: 'Pivotzeile berechnen' },
  { id: 'pivotColCell', label: 'Pivotspalte berechnen' },
  { id: 'rectangle', label: 'Rechteckregel' },
  { id: 'optimal', label: 'Optimum erkennen' },
];

/** Correct answers in a row (without extra hints) after which a skill counts as mastered. */
export const MASTERY_GOAL = 3;

export type Mastery = Partial<Record<SkillId, number>>;

/** Hint level shown automatically: 3 = rule + formula + numbers, 1 = rule only, 0 = task only. */
export function autoLevel(streak: number): number {
  if (streak >= MASTERY_GOAL) return 0;
  if (streak >= 1) return 1;
  return 3;
}

/** clean = right without asking for more help, hint = needed extra help, wrong = had a wrong attempt. */
export function updateMastery(m: Mastery, skill: SkillId, outcome: 'clean' | 'hint' | 'wrong'): Mastery {
  const cur = m[skill] ?? 0;
  const next = outcome === 'clean' ? Math.min(MASTERY_GOAL, cur + 1) : outcome === 'wrong' ? 0 : cur;
  return { ...m, [skill]: next };
}

export type HighlightRole = 'target' | 'pivot' | 'old' | 'row' | 'col' | 'candidate' | 'chosen';
/** key: `${tableau}:${row}:${col}` */
export type Highlights = Record<string, HighlightRole>;

export interface StartInfo { isMin: boolean; objective: string; rows: StartRowInfo[] }

export interface TutorStep {
  id: string;
  tableau: number;
  kind: 'cell' | 'pivotCol' | 'pivotRow' | 'labels' | 'optimal';
  skill: SkillId;
  row?: number;
  col?: number;
  expected?: Fraction;
  expectedPivotRow?: number;
  expectedPivotCol?: number;
  expectedBasis?: string[];
  expectedNbVars?: string[];
  /** Values used in the calculation, for diagnosing typical mistakes. */
  calc?: { old?: Fraction; rowVal?: Fraction; colVal?: Fraction; pivot?: Fraction };
  title: string;
  rule: string;
  formula?: string;
  numbers?: string;
  /** Worked intermediate steps (without the final result), shown as the highest hint level / after a mistake. */
  workedSteps?: string[];
  result: string;
  highlights: Highlights;
}

const fmt = (f: Fraction) => f.toDisplayString();
const fmtP = (f: Fraction) => (f.isNegative() ? `(${fmt(f)})` : fmt(f));
const approx = (f: Fraction) => {
  const s = fmt(f);
  return s.includes('/') ? `${s} ≈ ${f.toNumber().toFixed(2).replace('.', ',')}` : s;
};
const rowName = (t: TableauSnapshot, i: number) => (i === 0 ? (t.zLabel || 'Z') : t.basis[i]);
const colName = (t: TableauSnapshot, j: number) => (j < t.data[0].length - 1 ? t.nbVars[j] : 'Wert');
const key = (t: number, i: number, j: number) => `${t}:${i}:${j}`;

function startSteps(t0: TableauSnapshot, start?: StartInfo): TutorStep[] {
  const steps: TutorStep[] = [];
  const n = t0.data[0].length - 1;
  const isMin = start?.isMin ?? t0.zLabel === '-Z';
  for (let i = 0; i < t0.data.length; i++) {
    for (let j = 0; j <= n; j++) {
      const v = t0.data[i][j];
      const base = {
        id: `t0:${i}:${j}`, tableau: 0, kind: 'cell' as const, row: i, col: j, expected: v,
        title: `Starttableau: Zelle ${rowName(t0, i)} | ${colName(t0, j)}`,
        result: fmt(v), highlights: { [key(0, i, j)]: 'target' as HighlightRole },
      };
      if (i === 0) {
        if (j === n) {
          steps.push({ ...base, skill: 'startZ', rule: 'Zu Beginn sind alle x = 0. Welchen Wert hat dann die Zielfunktion?', formula: 'Wert = Zielfunktion bei x = 0' });
        } else {
          const c = isMin ? v : v.neg();
          steps.push({
            ...base, skill: 'startZ',
            rule: 'Vorzeichen in der Z-Zeile: Bei Maximierung wird der Koeffizient umgedreht (Z − c·x = 0), bei Minimierung rechnest du mit −Z und übernimmst ihn unverändert.\n'
              + (isMin
                ? `Hier wird minimiert → Koeffizient von ${t0.nbVars[j]} unverändert in die −Z-Zeile.`
                : `Hier wird maximiert → Koeffizient von ${t0.nbVars[j]} mit umgekehrtem Vorzeichen.`),
            formula: isMin ? `Eintrag = Koeffizient von ${t0.nbVars[j]}` : `Eintrag = −(Koeffizient von ${t0.nbVars[j]})`,
            numbers: `${start?.objective ? start.objective + ': ' : ''}Koeffizient von ${t0.nbVars[j]} = ${fmt(c)}`,
          });
        }
        continue;
      }
      const info = start?.rows[i - 1];
      const negated = info ? (info.op === '≥' || info.part === 'geq') : false;
      const orig = negated ? v.neg() : v;
      const isValue = j === n;
      const what = isValue ? 'rechte Seite' : `Koeffizient von ${t0.nbVars[j]}`;
      // cell-specific: name exactly what goes into this cell
      const target = isValue ? 'die rechte Seite' : `den Koeffizienten von ${t0.nbVars[j]}`;
      const dest = isValue ? ' in die Wert-Spalte' : '';
      const general = 'Vorzeichen bei Nebenbedingungen: ≤ wird unverändert übernommen, ≥ wird mit −1 multipliziert (damit sie als ≤ ins Tableau passt), eine Gleichung wird zu einer ≤- und einer ≥-Zeile.\n';
      let rule = `${general}Hier ≤ → ${target} unverändert${dest}.`;
      if (info?.op === '≥') rule = `${general}Hier ≥ → ${target} mit −1 multipliziert${dest}${isValue ? ' (der Wert wird dabei negativ)' : ''}.`;
      if (info?.op === '=' && info.part === 'leq') rule = `${general}Hier Gleichung, erste Zeile (≤-Teil) → ${target} unverändert${dest}.`;
      if (info?.op === '=' && info.part === 'geq') rule = `${general}Hier Gleichung, zweite Zeile (≥-Teil) → ${target} mit −1 multipliziert${dest}.`;
      steps.push({
        ...base, skill: 'startRow', rule,
        formula: negated ? `Eintrag = −(${what})` : `Eintrag = ${what}`,
        numbers: `${info ? info.text + ': ' : ''}${what} = ${fmt(orig)}`,
      });
    }
  }
  return steps;
}

function pivotSteps(t: number, tab: TableauSnapshot): TutorStep[] {
  const n = tab.data[0].length - 1;
  const rows = tab.data.length;
  const pr = tab.pivotRow, pc = tab.pivotCol;
  const dual = tab.data.slice(1).some(r => r[n].isNegative());
  const hlZ: Highlights = {};
  for (let j = 0; j < n; j++) hlZ[key(t, 0, j)] = j === pc ? 'chosen' : 'candidate';
  const colStep: TutorStep = {
    id: `t${t}:pivotCol`, tableau: t, kind: 'pivotCol', skill: dual ? 'dualPivot' : 'pivotCol', expectedPivotCol: pc,
    title: `Tableau ${t + 1}: Pivotspalte wählen (Auswahlfeld „Spalte…“)`,
    rule: dual
      ? 'Duale Schritte, Spalte: In der Pivotzeile kommen nur negative Elemente in Frage. Wähle den kleinsten Betrag von Z-Wert ÷ Element, bei Gleichstand die linke Spalte.'
      : 'Noch nicht optimal, denn in der Z-Zeile steht ein negativer Wert. Pivotspalte = Spalte mit dem kleinsten (negativsten) Z-Wert, bei Gleichstand die linke.',
    formula: dual ? 'min |Z-Wert ÷ Element| über negative Elemente der Pivotzeile' : 'min Z-Wert (nur negative)',
    numbers: dual
      ? tab.nbVars.map((v, j) => (tab.data[pr][j].isNegative() ? `${v}: |${fmt(tab.data[0][j])} ÷ ${fmtP(tab.data[pr][j])}| = ${approx(tab.data[0][j].div(tab.data[pr][j]).abs())}` : `${v}: –`)).join(' · ')
      : tab.nbVars.map((v, j) => `${v}: ${fmt(tab.data[0][j])}`).join(' · '),
    result: tab.nbVars[pc],
    highlights: dual ? Object.fromEntries(tab.nbVars.map((_, j) => [key(t, pr, j), j === pc ? 'chosen' : 'candidate'])) as Highlights : hlZ,
  };
  const hlRows: Highlights = {};
  for (let i = 1; i < rows; i++) hlRows[key(t, i, dual ? n : pc)] = i === pr ? 'chosen' : 'candidate';
  if (!dual) for (let i = 1; i < rows; i++) hlRows[key(t, i, n)] = 'candidate';
  const rowStep: TutorStep = {
    id: `t${t}:pivotRow`, tableau: t, kind: 'pivotRow', skill: dual ? 'dualPivot' : 'pivotRow', expectedPivotRow: pr,
    title: `Tableau ${t + 1}: Pivotzeile wählen (Auswahlfeld „Zeile…“)`,
    rule: dual
      ? 'Duale Schritte: In der Wert-Spalte steht ein negativer Wert, das Tableau ist noch nicht zulässig. Pivotzeile = Zeile mit dem kleinsten (negativsten) Wert, bei Gleichstand die obere.'
      : 'Pivotzeile = kleinster Quotient Wert ÷ Element der Pivotspalte, nur für positive Elemente, bei Gleichstand die obere Zeile.',
    formula: dual ? 'min Wert (nur negative)' : `min Wert ÷ Element in Spalte ${tab.nbVars[pc]} (Element > 0)`,
    numbers: dual
      ? tab.basis.slice(1).map((b, k) => `${b}: ${fmt(tab.data[k + 1][n])}`).join(' · ')
      : tab.basis.slice(1).map((b, k) => {
        const a = tab.data[k + 1][pc];
        return a.isPositive() ? `${b}: ${fmt(tab.data[k + 1][n])} ÷ ${fmt(a)} = ${approx(tab.data[k + 1][n].div(a))}` : `${b}: – (Element ${fmt(a)} ≤ 0)`;
      }).join(' · '),
    result: tab.basis[pr],
    highlights: hlRows,
  };
  return dual ? [rowStep, colStep] : [colStep, rowStep];
}

function exchangeSteps(t: number, prev: TableauSnapshot, cur: TableauSnapshot): TutorStep[] {
  const steps: TutorStep[] = [];
  const pr = prev.pivotRow, pc = prev.pivotCol;
  const p = prev.data[pr][pc];
  const rows = cur.data.length, n = cur.data[0].length - 1;
  const entering = prev.nbVars[pc], leaving = prev.basis[pr];
  steps.push({
    id: `t${t}:labels`, tableau: t, kind: 'labels', skill: 'labels',
    expectedBasis: cur.basis, expectedNbVars: cur.nbVars,
    title: `Tableau ${t + 1}: Beschriftungen anpassen – Variable der Pivotzeile und der Pivotspalte tauschen`,
    rule: 'Austausch: Die Variable der Pivotspalte kommt in die Basis, die Variable der Pivotzeile wird Nichtbasisvariable. Die beiden tauschen ihre Plätze.',
    formula: `Zeile ${pr}: ${leaving} → ${entering} · Spalte ${pc + 1}: ${entering} → ${leaving}`,
    numbers: `${entering} kommt in die Basis, ${leaving} verlässt sie.`,
    result: `Zeile ${pr} = ${entering}, Spalte ${pc + 1} = ${leaving}`,
    highlights: { [key(t - 1, pr, pc)]: 'pivot' },
  });
  const order: [number, number][] = [[pr, pc]];
  for (let j = 0; j <= n; j++) if (j !== pc) order.push([pr, j]);
  for (let i = 0; i < rows; i++) if (i !== pr) order.push([i, pc]);
  for (let i = 0; i < rows; i++) for (let j = 0; j <= n; j++) if (i !== pr && j !== pc) order.push([i, j]);
  for (const [i, j] of order) {
    const v = cur.data[i][j];
    const old = prev.data[i][j];
    const base = {
      id: `t${t}:${i}:${j}`, tableau: t, kind: 'cell' as const, row: i, col: j, expected: v,
      title: `Tableau ${t + 1}: Zelle ${rowName(cur, i)} | ${colName(cur, j)}`, result: fmt(v),
    };
    const hl: Highlights = { [key(t, i, j)]: 'target', [key(t - 1, pr, pc)]: 'pivot' };
    if (i === pr && j === pc) {
      steps.push({ ...base, skill: 'pivotElement', calc: { old, pivot: p }, highlights: hl,
        rule: 'Pivotelement: Kehrwert des alten Pivotelements.', formula: 'neu = 1 ÷ Pivot', numbers: `1 ÷ ${fmtP(p)}` });
    } else if (i === pr) {
      hl[key(t - 1, i, j)] = 'old';
      steps.push({ ...base, skill: 'pivotRowCell', calc: { old, pivot: p }, highlights: hl,
        workedSteps: [`${fmt(old)} ÷ ${fmtP(p)} = ? (${old.isZero() ? '0 geteilt durch eine Zahl bleibt 0' : `Vorzeichen: ${old.isNegative() === p.isNegative() ? 'gleiche Vorzeichen → positiv' : 'verschiedene Vorzeichen → negativ'}`})`],
        rule: 'Pivotzeile: alten Wert durch das Pivotelement teilen.', formula: 'neu = alt ÷ Pivot', numbers: `${fmt(old)} ÷ ${fmtP(p)}` });
    } else if (j === pc) {
      hl[key(t - 1, i, j)] = 'old';
      steps.push({ ...base, skill: 'pivotColCell', calc: { old, pivot: p }, highlights: hl,
        workedSteps: [`1. Vorzeichen des Pivotelements umdrehen: −(${fmt(p)}) = ${fmt(p.neg())}`, `2. ${fmt(old)} ÷ ${fmtP(p.neg())} = ?`],
        rule: 'Pivotspalte: alten Wert durch das negative Pivotelement teilen.', formula: 'neu = alt ÷ (−Pivot)', numbers: `${fmt(old)} ÷ ${fmtP(p.neg())}` });
    } else {
      const rowVal = prev.data[pr][j], colVal = prev.data[i][pc];
      hl[key(t - 1, i, j)] = 'old'; hl[key(t - 1, pr, j)] = 'row'; hl[key(t - 1, i, pc)] = 'col';
      const prod = rowVal.mul(colVal);
      const q = prod.div(p);
      const tip = q.den !== 1n && old.den === 1n ? ` (Tipp: ${fmt(old)} = ${old.num * q.den}/${q.den})` : '';
      steps.push({ ...base, skill: 'rectangle', calc: { old, rowVal, colVal, pivot: p }, highlights: hl,
        workedSteps: [
          `1. Produkt: ${fmtP(rowVal)} · ${fmtP(colVal)} = ${fmt(prod)}`,
          `2. durch das Pivotelement: ${fmtP(prod)} ÷ ${fmtP(p)} = ${fmt(q)}`,
          `3. vom alten Wert abziehen: ${fmt(old)} − ${fmtP(q)} = ?${tip}`,
        ],
        rule: 'Rechteckregel: vom alten Wert das Produkt aus dem Wert in der Pivotzeile (gleiche Spalte) und dem Wert in der Pivotspalte (gleiche Zeile) geteilt durch das Pivotelement abziehen.',
        formula: 'neu = alt − (Pivotzeile · Pivotspalte) ÷ Pivot',
        numbers: `${fmt(old)} − (${fmtP(rowVal)} · ${fmtP(colVal)}) ÷ ${fmtP(p)}` });
    }
  }
  return steps;
}

function optimalStep(t: number, tab: TableauSnapshot): TutorStep {
  const n = tab.data[0].length - 1;
  const zRaw = tab.data[0][n];
  const isMin = tab.zLabel === '-Z';
  const z = isMin ? zRaw.neg() : zRaw;
  const basisVals = tab.basis.slice(1).map((b, k) => `${b} = ${fmt(tab.data[k + 1][n])}`).join(', ');
  const hl: Highlights = {};
  for (let j = 0; j < n; j++) hl[key(t, 0, j)] = 'candidate';
  for (let i = 1; i < tab.data.length; i++) hl[key(t, i, n)] = 'candidate';
  return {
    id: `t${t}:optimal`, tableau: t, kind: 'optimal', skill: 'optimal',
    title: `Tableau ${t + 1}: Ist das Tableau optimal? Dann „Optimal“ anhaken.`,
    rule: 'Optimal, wenn in der Z-Zeile kein negativer Wert mehr steht und alle Werte in der Wert-Spalte ≥ 0 sind.',
    formula: 'Basisvariablen = Wert-Spalte, Nichtbasisvariablen = 0, Zielfunktionswert oben rechts',
    numbers: `${isMin ? `−Z = ${fmt(zRaw)}, also Z = ${fmt(z)}` : `Z = ${fmt(z)}`}; ${basisVals}; ${tab.nbVars.join(', ')} = 0`,
    result: `Z = ${fmt(z)}`,
    highlights: hl,
  };
}

/** All tutor steps for a correct solution path (path[t].pivotRow/Col set on every non-final tableau). */
export function buildTutorSteps(path: TableauSnapshot[], start?: StartInfo): TutorStep[] {
  if (!path.length) return [];
  const steps: TutorStep[] = [...startSteps(path[0], start)];
  for (let t = 0; t < path.length; t++) {
    if (t > 0) steps.push(...exchangeSteps(t, path[t - 1], path[t]));
    const tab = path[t];
    if (tab.isOptimal) { steps.push(optimalStep(t, tab)); break; }
    if (tab.pivotRow < 0 || tab.pivotCol < 0) break; // unbounded / infeasible: nothing more to teach
    steps.push(...pivotSteps(t, tab));
  }
  return steps;
}

const sameLabels = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((x, i) => (x || '').trim().toLowerCase() === (b[i] || '').toLowerCase());

export function isStepDone(step: TutorStep, tabs: EditableTableau[]): boolean {
  const t = tabs[step.tableau];
  if (!t) return false;
  switch (step.kind) {
    case 'cell': {
      const raw = t.data[step.row!]?.[step.col!];
      if (raw == null || raw.trim() === '') return false;
      const v = parseCell(raw);
      return v !== null && v.equals(step.expected!);
    }
    case 'pivotCol': return t.pivotCol === step.expectedPivotCol;
    case 'pivotRow': return t.pivotRow === step.expectedPivotRow;
    case 'labels': return sameLabels(t.basis.slice(1), step.expectedBasis!.slice(1)) && sameLabels(t.nbVars, step.expectedNbVars);
    case 'optimal': return !!t.isOptimal;
  }
}

/** Index of the first step that is not done yet (steps.length when everything is done). */
export function currentStepIndex(steps: TutorStep[], tabs: EditableTableau[]): number {
  const i = steps.findIndex(s => !isStepDone(s, tabs));
  return i < 0 ? steps.length : i;
}

/** Explain a wrong cell entry, recognising typical mistakes. */
export function diagnoseCell(step: TutorStep, raw: string): string {
  const v = parseCell(raw);
  if (v === null) return `„${raw}“ ist keine gültige Zahl. Erlaubt sind z. B. 3, -5/3 oder 2,5.`;
  const e = step.expected!;
  const c = step.calc || {};
  if (!e.isZero() && v.equals(e.neg())) return 'Fast: Der Betrag stimmt, aber das Vorzeichen nicht.';
  if (step.skill === 'pivotElement' && c.pivot && v.equals(c.pivot)) return 'Gesucht ist der Kehrwert des Pivotelements: 1 ÷ Pivot.';
  if (c.old && !c.old.equals(e) && v.equals(c.old)) return 'Das ist noch der alte Wert. Beim Austausch ändert sich diese Zelle.';
  if (step.skill === 'pivotColCell' && c.old && c.pivot && v.equals(c.old.div(c.pivot))) return 'In der Pivotspalte teilst du durch −Pivot, nicht durch Pivot.';
  if (step.skill === 'rectangle' && c.old && c.rowVal && c.colVal && c.pivot) {
    if (v.equals(c.old.sub(c.rowVal.mul(c.colVal)))) return 'Rechteckregel: Das Produkt muss noch durch das Pivotelement geteilt werden.';
    if (v.equals(c.old.add(c.rowVal.mul(c.colVal).div(c.pivot)))) return 'Rechteckregel: Das Produkt wird abgezogen, nicht addiert.';
    if (v.equals(c.old.sub(c.rowVal.mul(c.colVal)).div(c.pivot))) return 'Rechteckregel: Nur das Produkt wird durch das Pivotelement geteilt, nicht der alte Wert. Bring den alten Wert dafür auf denselben Nenner.';
    if (v.equals(c.old.sub(c.rowVal.mul(c.colVal).div(c.pivot.neg())))) return 'Rechteckregel: Durch das Pivotelement teilen, nicht durch −Pivot (das gilt nur für die Pivotspalte).';
  }
  if (Math.abs(v.toNumber() - e.toNumber()) < 0.01) return 'Knapp daneben, vermutlich gerundet. Bitte exakt eingeben, z. B. als Bruch (1/3).';
  return 'Das stimmt noch nicht.';
}
