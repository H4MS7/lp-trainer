// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

import { SKILLS, MASTERY_GOAL } from './lib/tutor';
import type { TutorStep, Mastery } from './lib/tutor';

interface Props {
  step: TutorStep | null;
  stepIndex: number;
  total: number;
  level: number;
  revealed: boolean;
  feedback: string | null;
  mastery: Mastery;
  doneText: string;
  onHint: () => void;
  onReveal: () => void;
  onResetMastery: () => void;
}

const Dots = ({ streak }: { streak: number }) => (
  <span className="font-mono tracking-widest">
    {Array.from({ length: MASTERY_GOAL }, (_, k) => (k < streak ? '●' : '○')).join('')}
    {streak >= MASTERY_GOAL && <span className="ml-1 text-green-600 tracking-normal font-sans">sitzt</span>}
  </span>
);

const LEGEND: Record<string, [string, string]> = {
  old: ['bg-orange-100 border-orange-400', 'alter Wert'],
  row: ['bg-sky-100 border-sky-400', 'Pivotzeile'],
  col: ['bg-emerald-100 border-emerald-400', 'Pivotspalte'],
  pivot: ['bg-yellow-200 border-yellow-500', 'Pivotelement'],
  candidate: ['bg-indigo-50 border-indigo-300', 'zu vergleichen'],
};

/** Colour key for the cells highlighted in the tableaus. */
const Legend = ({ roles }: { roles: string[] }) => {
  const shown = Object.keys(LEGEND).filter(r => roles.includes(r) || (r === 'candidate' && roles.includes('chosen')));
  if (!shown.length) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-600">
      {shown.map(r => <span key={r} className="flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${LEGEND[r][0]}`} />{LEGEND[r][1]}</span>)}
    </p>
  );
};

/** Sticky guidance box for tutor mode (see lib/tutor.ts). Kept compact so it does not hide the tableaus. */
export default function TutorPanel({ step, stepIndex, total, level, revealed, feedback, mastery, doneText, onHint, onReveal, onResetMastery }: Props) {
  const skill = step ? SKILLS.find(s => s.id === step.skill) : null;
  const maxLevel = step?.workedSteps ? 4 : 3;
  const mastered = SKILLS.filter(s => (mastery[s.id] ?? 0) >= MASTERY_GOAL).length;
  return (
    <div className="sticky top-2 z-20 mb-4 rounded-xl border-2 border-indigo-300 bg-white/95 backdrop-blur shadow-lg px-4 py-3">
      <div className="flex items-center gap-3 text-xs mb-1">
        <span className="font-semibold uppercase tracking-wide text-indigo-500">Tutor · Schritt {Math.min(stepIndex + 1, total)}/{total}</span>
        <div className="h-1.5 w-24 rounded bg-indigo-100 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${total ? (stepIndex / total) * 100 : 0}%` }} /></div>
        {skill && <span className="ml-auto text-indigo-700" title="Richtige Antworten in Folge ohne zusätzliche Hilfe">{skill.label} <Dots streak={mastery[skill.id] ?? 0} /></span>}
      </div>
      {step ? (
        <>
          <p className="font-semibold text-gray-800">{step.title}</p>
          {level >= 1 && <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-line">{step.rule}</p>}
          {level >= 2 && step.formula && <p className="text-sm font-mono text-indigo-700 mt-0.5">{step.formula}</p>}
          {level >= 2 && <Legend roles={Object.values(step.highlights)} />}
          {level >= 3 && step.numbers && <p className="text-sm font-mono text-gray-800 mt-1 bg-indigo-50 rounded px-2 py-0.5">{step.numbers}</p>}
          {level >= 4 && step.workedSteps && (
            <div className="text-sm font-mono text-gray-800 mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              <p className="font-sans text-xs font-semibold text-amber-700 mb-0.5">Schritt für Schritt</p>
              {step.workedSteps.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
          {revealed && <p className="text-sm mt-1"><span className="font-semibold text-amber-700">Lösung:</span> <span className="font-mono">{step.result}</span></p>}
          {feedback && <p className="text-sm text-red-600 mt-1">✗ {feedback}</p>}
        </>
      ) : (
        <p className="font-semibold text-green-700">✓ Geschafft! {doneText}</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        {step && level < maxLevel && <button onClick={onHint} className="px-3 py-1 text-xs rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200">Hinweis</button>}
        {step && !revealed && level >= maxLevel && <button onClick={onReveal} className="px-3 py-1 text-xs rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200">Lösung zeigen</button>}
        <details className="ml-auto text-xs text-gray-600 relative">
          <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">Fortschritt: {mastered} von {SKILLS.length} Zelltypen sitzen</summary>
          <div className="absolute right-0 mt-1 w-72 rounded-lg border border-gray-200 bg-white shadow-lg p-3 z-30">
            <p className="text-gray-500 mb-1">Nach {MASTERY_GOAL} richtigen Antworten in Folge ohne zusätzliche Hilfe zeigt der Tutor die Regel nur noch auf Abruf.</p>
            <ul className="space-y-0.5">
              {SKILLS.map(s => (
                <li key={s.id} className={`flex items-center justify-between ${step?.skill === s.id ? 'font-semibold text-indigo-700' : ''}`}>
                  <span>{s.label}</span><Dots streak={mastery[s.id] ?? 0} />
                </li>
              ))}
            </ul>
            <button onClick={onResetMastery} className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 underline">Fortschritt zurücksetzen</button>
          </div>
        </details>
      </div>
    </div>
  );
}
