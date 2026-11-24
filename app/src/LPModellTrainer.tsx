// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

// @ts-nocheck
import React, { useState, useEffect, Fragment } from 'react';
import { AlertCircle, CheckCircle, RefreshCw, BookOpen, Brain, Table, Plus, ArrowRight, X } from 'lucide-react';
import ALL_PROBLEMS from './data/problems';
import ALL_TEMPLATES from './data/templates';
import { generateFromTemplateAsync } from './lib/templateEngine';
import type { ProblemTemplate } from './lib/templateEngine';
import { Fraction } from './lib/fraction';
import * as Simplex from './lib/simplex';
import { generateProblemAsync, formatProblem } from './lib/generator';
import type { GeneratorConfig, GeneratedProblem, AppMode, EditableTableau } from './lib/types';

interface SimplexFeedback {
  korrekt: boolean;
  gesamtfeedback: string;
  tableauFeedback: Array<{ tableauNummer: number; korrekt: boolean; fehler?: string[]; hinweise?: string[] }>;
}

/** True if nb is a pure non-negativity constraint like "x1, x2 ≥ 0" (any var count) */
const isNonNegativity = (nb: string) => /^x\d+(,\s*x\d+)*\s*≥\s*0$/.test(nb.trim());

const LPModellTrainer = () => {
  const [currentProblem, setCurrentProblem] = useState<any>(null);
  const [userSolution, setUserSolution] = useState({
    zielfunktion: '',
    nebenbedingungen: ['', '', '', '']
  });
  const [feedback, setFeedback] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [showDetailedExplanation, setShowDetailedExplanation] = useState(true);
  const [problemType, setProblemType] = useState('all');
  const [simplexPhase, setSimplexPhase] = useState('setup');
  const [simplexTableaus, setSimplexTableaus] = useState<EditableTableau[]>([]);
  const [currentTableauIndex, setCurrentTableauIndex] = useState(0);
  const [simplexFeedback, setSimplexFeedback] = useState<SimplexFeedback | null>(null);
  const [lastGeneratedTopics, setLastGeneratedTopics] = useState<string[]>([]);

  const [appMode, setAppMode] = useState<AppMode>('modellierung');
  const [modellVarCount, setModellVarCount] = useState('all');
  const [modellNiceNumbers, setModellNiceNumbers] = useState(false);
  const [genVars, setGenVars] = useState(2);
  const [genConstraints, setGenConstraints] = useState(3);
  const [genMinTableaus, setGenMinTableaus] = useState(2);
  const [genMaxTableaus, setGenMaxTableaus] = useState(4);
  const [genNiceNumbers, setGenNiceNumbers] = useState(true);
  const [genMaxDenom, setGenMaxDenom] = useState(6);
  const [generatedProblem, setGeneratedProblem] = useState<GeneratedProblem | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [seenHashes] = useState(() => new Set<string>());
  const [generatedCount, setGeneratedCount] = useState(0);

  const adoptSolution = () => {
    if (currentProblem) {
      const realNB = currentProblem?.nebenbedingungen?.filter(nb => !isNonNegativity(nb)) || [];
      const paddedNB = [...realNB];
      while (paddedNB.length < 4) paddedNB.push('');
      setUserSolution({ zielfunktion: currentProblem.zielfunktion || '', nebenbedingungen: paddedNB });
      setShowSolution(false);
      const adoptedFeedback = {
        korrekt: true, zielfunktionKorrekt: true,
        alternativerAnsatz: { gefunden: false, beschreibung: "", beispiel: "" },
        nebenbedingungen: realNB.map(nb => ({ eingabe: nb, korrekt: true, kommentar: "Aus Musterlösung übernommen" })),
        gesamtfeedback: "Musterlösung übernommen - Sie können nun mit dem Simplex-Algorithmus fortfahren.",
        fehlendeNebenbedingungen: [], tipps: []
      };
      setFeedback(adoptedFeedback);
      if (currentProblem) { initializeSimplexTableaus(); setSimplexPhase('solving'); }
    }
  };

  const getColorClass = (index) => {
    const colors = ['bg-red-100 text-red-700','bg-blue-100 text-blue-700','bg-green-100 text-green-700','bg-yellow-100 text-yellow-700','bg-purple-100 text-purple-700','bg-pink-100 text-pink-700','bg-indigo-100 text-indigo-700','bg-orange-100 text-orange-700'];
    return colors[(index || 0) % colors.length];
  };

  const enrichHighlightsWithColors = (highlights) => {
    if (!highlights) return { zielfunktion: [], nebenbedingungen: [] };
    const colorMap = new Map();
    let colorIndex = 0;
    const getColorForText = (text) => {
      const normalized = text.toLowerCase().replace(/\s+/g, '').replace(/[€]/g, '');
      for (const [key, color] of colorMap.entries()) {
        if (key === normalized || (normalized.includes(key) && key.match(/\d+/)) || (key.includes(normalized) && normalized.match(/\d+/))) return color;
      }
      colorMap.set(normalized, colorIndex);
      return colorIndex++;
    };
    const enriched = { zielfunktion: [], nebenbedingungen: [] };
    highlights.zielfunktion?.forEach(h => { enriched.zielfunktion.push({ ...h, colorIndex: getColorForText(h.text) }); });
    highlights.nebenbedingungen?.forEach(nb => {
      const eNB = [];
      nb?.forEach(h => { eNB.push({ ...h, colorIndex: getColorForText(h.text) }); });
      enriched.nebenbedingungen.push(eNB);
    });
    return enriched;
  };

  const renderHighlightedText = (text, highlights) => {
    if (!text || !highlights) return text;
    const allHighlights = [];
    highlights.zielfunktion?.forEach((h, i) => {
      if (h.text && h.text !== "maximieren" && h.text !== "minimieren")
        allHighlights.push({ text: h.text, colorIndex: h.colorIndex !== undefined ? h.colorIndex : i, type: 'ziel' });
    });
    highlights.nebenbedingungen?.forEach((nb, nbI) => {
      nb?.forEach((h, hI) => {
        if (h.text) allHighlights.push({ text: h.text, colorIndex: h.colorIndex !== undefined ? h.colorIndex : (nbI * 3 + hI + 2), type: 'nb' });
      });
    });
    // Sort longest first so longer matches take priority over shorter ones
    allHighlights.sort((a, b) => b.text.length - a.text.length);
    const occurrences = [];
    allHighlights.forEach(highlight => {
      // Exact substring match only - no individual digit extraction
      const searchTexts = new Set([highlight.text, highlight.text.replace(/\s+/g, ' ').trim()]);
      // Also try with comma/dot swapped for decimal numbers in the full text
      searchTexts.add(highlight.text.replace(/,/g, '.'));
      searchTexts.add(highlight.text.replace(/\./g, ','));
      searchTexts.forEach(st => {
        if (st.length < 2) return; // Never match single characters
        let si = 0, idx = text.toLowerCase().indexOf(st.toLowerCase(), si);
        while (idx !== -1) {
          const hasOvlp = occurrences.some(ex =>
            (idx >= ex.start && idx < ex.end) || (idx + st.length > ex.start && idx + st.length <= ex.end) ||
            (ex.start >= idx && ex.start < idx + st.length));
          if (!hasOvlp) occurrences.push({ start: idx, end: idx + st.length, highlight, originalText: text.substring(idx, idx + st.length) });
          si = idx + 1; idx = text.toLowerCase().indexOf(st.toLowerCase(), si);
        }
      });
    });
    occurrences.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const filtered = [];
    occurrences.forEach(occ => {
      if (!filtered.some(ex => (occ.start >= ex.start && occ.start < ex.end) || (occ.end > ex.start && occ.end <= ex.end))) filtered.push(occ);
    });
    const elements = [];
    let lastIdx = 0;
    filtered.forEach((occ, i) => {
      if (occ.start > lastIdx) elements.push(<span key={`t-${i}`}>{text.substring(lastIdx, occ.start)}</span>);
      elements.push(<span key={`h-${i}`} className={`${getColorClass(occ.highlight.colorIndex)} px-1.5 py-0.5 rounded mx-0.5 font-medium`}>{occ.originalText}</span>);
      lastIdx = occ.end;
    });
    if (lastIdx < text.length) elements.push(<span key="end">{text.substring(lastIdx)}</span>);
    return <Fragment>{elements}</Fragment>;
  };

  const getHighlightsForProblem = (problem) => {
    if (!problem) return { zielfunktion: [], nebenbedingungen: [] };
    if (problem.highlights) return problem.highlights;
    return { zielfunktion: [], nebenbedingungen: [] };
  };

  const renderDetailedSolution = () => {
    if (!currentProblem) return null;
    const highlights = getHighlightsForProblem(currentProblem);
    const enrichedHighlights = enrichHighlightsWithColors(highlights);
    return (
      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800"><span className="font-semibold">💡 Tipp:</span> Die farbigen Markierungen zeigen, wie Teile des Aufgabentexts in die mathematische Formulierung übersetzt werden.</p>
        </div>
        <div className="bg-white rounded-lg p-5 shadow-inner border border-gray-200">
          <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><span className="text-2xl">1️⃣</span> Variablen definieren</h4>
          <div className="ml-8 space-y-2">
            {currentProblem?.variablen?.map((v, i) => (<div key={i} className="flex items-start gap-2"><span className="text-indigo-600 font-mono font-bold">•</span><span className="font-mono">{v}</span></div>))}
          </div>
        </div>
        <div className="bg-white rounded-lg p-5 shadow-inner border border-gray-200">
          <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><span className="text-2xl">2️⃣</span> Zielfunktion aufstellen</h4>
          <div className="ml-8 space-y-3">
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-sm text-gray-600 mb-2">Aus dem Aufgabentext:</p>
              <div className="space-y-1">
                {enrichedHighlights?.zielfunktion?.map((h, i) => (<div key={i} className="flex items-center gap-2"><span className={`px-2 py-1 rounded text-sm font-medium ${getColorClass(h.colorIndex)}`}>{h.text}</span><ArrowRight className="w-4 h-4 text-gray-500" /><span className="font-mono">{h.bedeutung}</span></div>))}
              </div>
            </div>
            <div className="flex items-center gap-3"><span className="text-lg font-bold text-indigo-600">Ergebnis:</span><span className="font-mono text-lg bg-indigo-50 px-3 py-1 rounded">{currentProblem?.zielfunktion}</span></div>
          </div>
        </div>
        <div className="bg-white rounded-lg p-5 shadow-inner border border-gray-200">
          <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><span className="text-2xl">3️⃣</span> Nebenbedingungen identifizieren</h4>
          <div className="ml-8 mb-6">
            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
              <p className="text-sm font-semibold text-amber-700 mb-3">📋 Aufgabentext mit markierten Schlüsselstellen:</p>
              <div className="text-gray-700 leading-relaxed">{renderHighlightedText(currentProblem.beschreibung, enrichedHighlights)}</div>
            </div>
          </div>
          <div className="ml-8 space-y-4">
            {currentProblem?.nebenbedingungen?.map((nb, i) => {
              const isNN = isNonNegativity(nb);
              if (isNN) return (<div key={i} className="border-l-4 border-gray-300 pl-4 py-2"><div className="bg-yellow-50 p-3 rounded-lg"><p className="text-sm font-semibold text-yellow-800 mb-1">⚠️ Nichtnegativitätsbedingung</p><p className="font-mono mt-2 text-yellow-700">{nb}</p></div></div>);
              const realNBIdx = currentProblem?.nebenbedingungen?.slice(0, i).filter(n => !isNonNegativity(n)).length || 0;
              return (
                <div key={i} className="border-l-4 border-indigo-300 pl-4 py-2">
                  <div className="bg-gray-50 p-3 rounded-lg mb-2">
                    <p className="text-sm text-gray-600 mb-2">Beschränkung {realNBIdx + 1}:</p>
                    {enrichedHighlights?.nebenbedingungen?.[realNBIdx] && (
                      <div className="space-y-1">
                        {enrichedHighlights.nebenbedingungen[realNBIdx].map((h, j) => (<div key={j} className="flex items-center gap-2 flex-wrap"><span className={`px-2 py-1 rounded text-sm font-medium ${getColorClass(h.colorIndex)}`}>{h.text}</span><ArrowRight className="w-4 h-4 text-gray-500" /><span className="font-mono text-sm">{h.bedeutung}</span></div>))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3"><span className="font-bold text-gray-700">Formel:</span><span className="font-mono bg-green-50 px-3 py-1 rounded">{nb}</span></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg p-5 border border-indigo-200">
          <h4 className="font-bold text-indigo-800 mb-3">📊 Vollständiges LP-Modell:</h4>
          <div className="bg-white rounded-lg p-4 font-mono space-y-2">
            <p className="text-indigo-600 font-bold font-mono">{currentProblem?.zielfunktion}</p>
            <p className="text-gray-600">unter den Nebenbedingungen:</p>
            {currentProblem?.nebenbedingungen?.map((nb, i) => (<p key={i} className="ml-4 font-mono">{nb}</p>))}
          </div>
        </div>
      </div>
    );
  };

  const generateNewProblem = async () => {
    setIsLoading(true); setFeedback(null); setShowSolution(false); setSimplexPhase('setup'); setSimplexTableaus([]); setCurrentTableauIndex(0); setSimplexFeedback(null);
    setUserSolution({ zielfunktion: '', nebenbedingungen: ['', '', '', ''] });

    // Try template-based generation first
    let templates: ProblemTemplate[] = ALL_TEMPLATES;
    if (problemType !== 'all') {
      const typeFiltered = templates.filter(t => t.typ === problemType);
      if (typeFiltered.length > 0) templates = typeFiltered;
    }
    if (modellVarCount !== 'all') {
      const nv = parseInt(modellVarCount);
      const varFiltered = templates.filter(t => t.numVars === nv);
      if (varFiltered.length > 0) templates = varFiltered;
    }

    if (templates.length > 0) {
      const template = templates[Math.floor(Math.random() * templates.length)];
      try {
        const filled = await generateFromTemplateAsync(template, {
          niceNumbers: modellNiceNumbers,
          maxDenom: 6,
          maxAttempts: 5000,
        });
        if (filled) {
          setCurrentProblem(filled);
          setIsLoading(false);
          return;
        }
      } catch (e) { console.log('Template-Generierung fehlgeschlagen:', e); }
    }

    // Fallback to static problems
    let selected = ALL_PROBLEMS;
    if (problemType !== 'all') {
      const typeFiltered = selected.filter(p => p.typ === problemType);
      if (typeFiltered.length > 0) selected = typeFiltered;
    }
    if (modellVarCount !== 'all') {
      const nv = parseInt(modellVarCount);
      const varFiltered = selected.filter(p => detectNumVars(p) === nv);
      if (varFiltered.length > 0) selected = varFiltered;
    }
    const rp = JSON.parse(JSON.stringify(selected[Math.floor(Math.random() * selected.length)]));
    setCurrentProblem(rp);
    setIsLoading(false);
  };

  const checkSolution = async () => {
    if (!currentProblem) return;
    setIsLoading(true);
    const userZF = userSolution.zielfunktion.toLowerCase().replace(/\s/g, '');
    const correctZF = (currentProblem?.zielfunktion || '').toLowerCase().replace(/\s/g, '');
    const zfOk = userZF.includes('max') === correctZF.includes('max') && userZF.includes('min') === correctZF.includes('min') && userZF.match(/\d+/g)?.sort().join('') === correctZF.match(/\d+/g)?.sort().join('');
    const userNB = userSolution.nebenbedingungen.filter(nb => nb.trim());
    const correctNB = currentProblem?.nebenbedingungen?.filter(nb => !isNonNegativity(nb)) || [];
    const ok = zfOk && userNB.length >= correctNB.length;
    const fd = {
      korrekt: ok, zielfunktionKorrekt: zfOk, alternativerAnsatz: { gefunden: false, beschreibung: "", beispiel: "" },
      nebenbedingungen: userNB.map((nb, i) => ({ eingabe: nb, korrekt: i < correctNB.length, kommentar: i < correctNB.length ? "Erkannt" : "Zusätzlich" })),
      gesamtfeedback: ok ? "Korrekt! Sie können mit dem Simplex fortfahren." : "Bitte überprüfen Sie Ihre Lösung.",
      fehlendeNebenbedingungen: userNB.length < correctNB.length ? [`Es fehlen ${correctNB.length - userNB.length} NB`] : [],
      tipps: ok ? [] : ["Überprüfen Sie Variablen und NB-Anzahl", "Prüfen Sie max/min"]
    };
    setFeedback(fd);
    if (fd.korrekt) { startSimplex(); }
    setIsLoading(false);
  };

  const detectNumVars = (problem: any): number => {
    if (problem?.variablen?.length) return problem.variablen.length;
    const zf = problem?.zielfunktion || '';
    const matches = zf.match(/x(\d+)/gi) || [];
    return Math.max(2, ...matches.map(m => parseInt(m.replace(/x/i, ''))));
  };

  const initializeSimplexTableaus = () => {
    if (!currentProblem) return;
    const numC = currentProblem?.nebenbedingungen?.filter(nb => !isNonNegativity(nb)).length || 0;
    const numVars = detectNumVars(currentProblem);
    const rows = numC + 1;
    const empty = {
      data: Array(rows).fill(null).map(() => Array(numVars + 1).fill('')),
      basis: ['Z', ...Array(numC).fill(null).map((_, i) => `y${i+1}`)],
      nbVars: Array(numVars).fill(null).map((_, j) => `x${j+1}`),
      pivotRow: -1, pivotCol: -1, isOptimal: false,
      zLabel: currentProblem?.optimierungsziel === 'minimieren' ? '-Z' : 'Z'
    };
    setSimplexTableaus([empty]);
  };

  const startSimplex = () => {
    initializeSimplexTableaus();
    setSimplexPhase('solving');
  };

  const addNewTableau = () => {
    if (!simplexTableaus.length) return;
    const last = simplexTableaus[simplexTableaus.length - 1];
    const nt = { data: last.data.map(r => r.map(() => '')), basis: [...last.basis], nbVars: [...(last.nbVars || ['x1', 'x2'])], pivotRow: -1, pivotCol: -1, isOptimal: false, zLabel: last.zLabel };
    setSimplexTableaus([...simplexTableaus, nt]);
    setCurrentTableauIndex(simplexTableaus.length);
  };

  const deleteTableau = (index) => {
    if (simplexTableaus.length <= 1) return;
    const nt = simplexTableaus.filter((_, i) => i !== index);
    setSimplexTableaus(nt);
    if (currentTableauIndex >= nt.length) setCurrentTableauIndex(nt.length - 1);
  };

  const [showPrintView, setShowPrintView] = useState(false);

  const downloadHTML = () => {
    const nbList = (userSolution.nebenbedingungen.filter(nb => nb.trim()).length > 0
      ? userSolution.nebenbedingungen.filter(nb => nb.trim())
      : currentProblem?.nebenbedingungen || []);

    let tableausHTML = '';
    simplexTableaus.forEach((tab, ti) => {
      const nbv = tab.nbVars || ['x1', 'x2'];
      let rowsHTML = '';
      tab.data?.forEach((row, ri) => {
        const label = ri === 0 ? (tab.zLabel || 'Z') : (tab.basis?.[ri] || `y${ri}`);
        const bg = ri === 0 ? '#f3f4f6' : '#dcfce7';
        const cells = row.map((c, ci) => {
          const isPivot = tab.pivotRow === ri && tab.pivotCol === ci;
          const cellBg = isPivot ? 'background:#fde68a;font-weight:bold' : '';
          return `<td style="border:1px solid #bbb;padding:8px 16px;text-align:center;${cellBg}">${c || '0'}</td>`;
        }).join('');
        rowsHTML += `<tr><td style="border:1px solid #bbb;padding:8px 16px;font-weight:bold;background:${bg}">${label}</td>${cells}</tr>`;
      });
      const pivotInfo = tab.pivotRow >= 0 && tab.pivotCol >= 0
        ? `<p style="font-size:13px;color:#666;margin:4px 0 0">Pivot: ${tab.basis?.[tab.pivotRow]} / ${nbv[tab.pivotCol]}</p>` : '';
      const optInfo = tab.isOptimal ? '<p style="font-size:13px;color:#16a34a;font-weight:bold;margin:4px 0 0">✓ Optimale Lösung</p>' : '';
      tableausHTML += `<div style="margin-bottom:28px;page-break-inside:avoid">
        <h3 style="margin:0 0 8px;color:#1e1b4b">Tableau ${ti} ${tab.isOptimal ? '(Optimal)' : ''}</h3>
        <table style="border-collapse:collapse;font-size:15px">
          <tr><th style="border:1px solid #bbb;padding:8px 16px;background:#e5e7eb">Tab. ${ti}</th>
          ${nbv.map(v => `<th style="border:1px solid #bbb;padding:8px 16px;background:#fef3c7">${v}</th>`).join('')}
          <th style="border:1px solid #bbb;padding:8px 16px;background:#e5e7eb">Wert</th></tr>
          ${rowsHTML}</table>${pivotInfo}${optInfo}</div>`;
    });

    let feedbackHTML = '';
    if (simplexFeedback) {
      const border = simplexFeedback.korrekt ? '#16a34a' : '#dc2626';
      const bg = simplexFeedback.korrekt ? '#f0fdf4' : '#fef2f2';
      feedbackHTML = `<div style="margin-top:24px;padding:20px;border:2px solid ${border};border-radius:8px;background:${bg}">
        <h3 style="margin:0 0 12px">${simplexFeedback.korrekt ? '✅ Simplex korrekt' : '❌ Fehler gefunden'}</h3>
        ${(simplexFeedback.tableauFeedback || []).map(tf => `<div style="margin:8px 0;padding:10px;background:white;border-radius:6px;border:1px solid #e5e7eb">
          <strong>Tableau ${tf.tableauNummer}: ${tf.korrekt ? '✓' : '✗'}</strong>
          ${(tf.fehler || []).map(f => `<div style="color:#dc2626;font-size:13px;margin:2px 0 2px 12px">• ${f}</div>`).join('')}
          ${(tf.hinweise || []).map(h => `<div style="color:#2563eb;font-size:13px;margin:2px 0 2px 12px">💡 ${h}</div>`).join('')}
        </div>`).join('')}
        <div style="margin-top:16px;white-space:pre-wrap;line-height:1.6">${simplexFeedback.gesamtfeedback || ''}</div>
      </div>`;
    }

    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${currentProblem?.titel || 'LP-Aufgabe'} – LP-Modell Trainer</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;max-width:820px;margin:0 auto;padding:32px;color:#1a1a2e;line-height:1.5}
h1{font-size:24px;color:#1e1b4b;border-bottom:3px solid #6366f1;padding-bottom:8px}
h2{font-size:18px;color:#4338ca;margin-top:28px}
.box{padding:18px;border-radius:8px;margin-bottom:16px}
.mono{font-family:'Courier New',monospace}
@media print{body{padding:16px}}</style></head><body>
<h1>LP-Modell Trainer</h1>
<div class="box" style="background:#f8fafc;border:1px solid #e2e8f0">
  <h2 style="margin-top:0">${currentProblem?.titel || ''} <span style="font-size:13px;color:#6366f1;font-weight:normal">${currentProblem?.typ || ''} – ${currentProblem?.optimierungsziel || ''}</span></h2>
  <p>${currentProblem?.beschreibung || ''}</p></div>
<div class="box" style="background:#eef2ff;border:1px solid #c7d2fe">
  <h3 style="margin:0 0 8px;color:#3730a3">LP-Formulierung</h3>
  <p class="mono" style="font-size:17px"><strong>${userSolution.zielfunktion || currentProblem?.zielfunktion}</strong></p>
  <p style="margin:8px 0 4px;font-weight:600">Nebenbedingungen:</p>
  ${nbList.map(nb => `<p class="mono" style="margin:2px 0 2px 20px">• ${nb}</p>`).join('')}</div>
<h2>Simplex-Algorithmus</h2>
${tableausHTML}${feedbackHTML}
<p style="font-size:11px;color:#999;margin-top:48px;border-top:1px solid #eee;padding-top:8px">LP-Modell Trainer – exportiert am ${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'})} · © 2026 Felix Flösch</p>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentProblem?.titel || 'LP-Aufgabe').replace(/[^a-zA-Z0-9äöüÄÖÜß\-_ ]/g, '')}_${new Date().toISOString().slice(0,10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printPDF = () => {
    setShowPrintView(true);
    setTimeout(() => { window.print(); }, 300);
  };

  const updateTableauCell = (ti, row, col, val) => {
    const nt = [...simplexTableaus]; nt[ti].data[row][col] = val; setSimplexTableaus(nt);
  };

  const updateTableauBasis = (ti, row, val) => {
    if (row === 0) return;
    const nt = [...simplexTableaus]; nt[ti].basis[row] = val; setSimplexTableaus(nt);
  };

  // ===== LOKALER SIMPLEX-SOLVER =====
  const solvePivotStep = (prevTableau) => {
    if (!prevTableau || prevTableau.pivotRow < 0 || prevTableau.pivotCol < 0) return null;
    const pRow = prevTableau.pivotRow;
    const pCol = prevTableau.pivotCol;
    const oldData = prevTableau.data.map(r => r.map(c => parseFloat(c) || 0));
    const rows = oldData.length;
    const cols = oldData[0].length;
    const pivotVal = oldData[pRow][pCol];
    if (pivotVal === 0) return null;

    // Neue Daten berechnen
    const newData = Array(rows).fill(null).map(() => Array(cols).fill(0));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (i === pRow && j === pCol) {
          // Pivot-Element → Kehrwert
          newData[i][j] = 1 / pivotVal;
        } else if (i === pRow) {
          // Pivot-Zeile → ÷ Pivot
          newData[i][j] = oldData[i][j] / pivotVal;
        } else if (j === pCol) {
          // Pivot-Spalte → ÷ (-Pivot)
          newData[i][j] = oldData[i][j] / (-pivotVal);
        } else {
          // Rechteckregel
          newData[i][j] = oldData[i][j] - (oldData[i][pCol] * oldData[pRow][j]) / pivotVal;
        }
      }
    }

    // Basistausch: Variablennamen tauschen
    const oldBasis = [...prevTableau.basis];
    const oldNBVars = [...(prevTableau.nbVars || ['x1', 'x2'])];
    const newBasis = [...oldBasis];
    const newNBVars = [...oldNBVars];
    // Eingehende Variable (aus Spalte) kommt in Basis
    // Ausgehende Variable (aus Zeile) kommt in NB
    const eingehend = oldNBVars[pCol];
    const ausgehend = oldBasis[pRow];
    newBasis[pRow] = eingehend;
    newNBVars[pCol] = ausgehend;

    // Runden auf sinnvolle Stellen
    const round = (v) => {
      const r = Math.round(v * 10000) / 10000;
      if (Math.abs(r - Math.round(r)) < 0.0001) return Math.round(r);
      if (Math.abs(r * 2 - Math.round(r * 2)) < 0.001) return Math.round(r * 10000) / 10000;
      return Math.round(r * 1000) / 1000;
    };

    const roundedData = newData.map(r => r.map(v => round(v)));

    return {
      data: roundedData.map(r => r.map(v => String(v))),
      basis: newBasis,
      nbVars: newNBVars,
      zLabel: prevTableau.zLabel || 'Z'
    };
  };

  const buildStartTableau = () => {
    if (!currentProblem) return null;
    // Nutze die Nutzereingabe, Fallback auf Musterlösung
    const zf = userSolution.zielfunktion || currentProblem?.zielfunktion || '';
    const allNBs = (userSolution.nebenbedingungen.filter(nb => nb.trim()).length > 0
      ? userSolution.nebenbedingungen.filter(nb => nb.trim())
      : currentProblem?.nebenbedingungen || []);
    const nbs = allNBs.filter(nb => !isNonNegativity(nb));

    const isMin = zf.toLowerCase().includes('min');
    const numVars = detectNumVars(currentProblem);

    // Parse objective coefficients for x1..xn
    const zfClean = zf.replace(/,/g, '.');
    const cArr: number[] = [];
    for (let j = 1; j <= numVars; j++) {
      const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*x${j}`, 'i');
      const m = zfClean.match(re);
      cArr.push(m ? parseFloat(m[1]) : 0);
    }
    if (cArr.every(v => v === 0)) {
      // Fallback: versuche Musterlösung
      const fallbackZF = (currentProblem?.zielfunktion || '').replace(/,/g, '.');
      const fbArr: number[] = [];
      for (let j = 1; j <= numVars; j++) {
        const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*x${j}`, 'i');
        const m = fallbackZF.match(re);
        fbArr.push(m ? parseFloat(m[1]) : 0);
      }
      if (fbArr.every(v => v === 0)) return null;
      return buildStartTableauFromParsed(fbArr, isMin,
        (currentProblem?.nebenbedingungen || []).filter(nb => !isNonNegativity(nb)),
        numVars);
    }
    return buildStartTableauFromParsed(cArr, isMin, nbs, numVars);
  };

  const buildStartTableauFromParsed = (cArr: number[], isMin: boolean, nbs: string[], numVars: number) => {
    // Parse Nebenbedingungen
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

    // Z-row
    for (let j = 0; j < numVars; j++) {
      data[0][j] = String(isMin ? cArr[j] : -cArr[j]);
    }
    data[0][numVars] = '0';

    // Constraint rows
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
  };

  const choosePivotLocal = (tableau) => {
    if (!tableau) return { row: -1, col: -1 };
    const data = tableau.data.map(r => r.map(c => parseFloat(c) || 0));
    const rows = data.length;
    const cols = data[0].length;
    const valCol = cols - 1;

    // Check für negative b-Werte (Dual-Simplex)
    let dualNeeded = false;
    for (let i = 1; i < rows; i++) {
      if (data[i][valCol] < -0.0001) { dualNeeded = true; break; }
    }

    if (dualNeeded) {
      // Dual-Simplex: Wähle Zeile mit negativstem b-Wert
      let minB = 0, pivotRow = -1;
      for (let i = 1; i < rows; i++) {
        if (data[i][valCol] < minB) { minB = data[i][valCol]; pivotRow = i; }
      }
      if (pivotRow < 0) return { row: -1, col: -1 };
      // Spalte: kleinster Quotient |Z-Koeff / Pivot-Spalten-Koeff| für negative Koeffizienten
      let minRatio = Infinity, pivotCol = -1;
      for (let j = 0; j < valCol; j++) {
        if (data[pivotRow][j] < -0.0001) {
          const ratio = Math.abs(data[0][j] / data[pivotRow][j]);
          if (ratio < minRatio) { minRatio = ratio; pivotCol = j; }
        }
      }
      return { row: pivotRow, col: pivotCol };
    }

    // Primaler Simplex: Spalte mit negativstem Z-Wert
    let minZ = 0, pivotCol = -1;
    for (let j = 0; j < valCol; j++) {
      if (data[0][j] < minZ) { minZ = data[0][j]; pivotCol = j; }
    }
    if (pivotCol < 0) return { row: -1, col: -1 }; // Optimal

    // Zeile: kleinster positiver Quotient b/a
    let minRatio = Infinity, pivotRow = -1;
    for (let i = 1; i < rows; i++) {
      if (data[i][pivotCol] > 0.0001) {
        const ratio = data[i][valCol] / data[i][pivotCol];
        if (ratio >= 0 && ratio < minRatio) { minRatio = ratio; pivotRow = i; }
      }
    }
    return { row: pivotRow, col: pivotCol };
  };

  const isOptimalLocal = (tableau) => {
    if (!tableau) return false;
    const data = tableau.data.map(r => r.map(c => parseFloat(c) || 0));
    const cols = data[0].length;
    const valCol = cols - 1;
    // All Z-row coefficients >= 0
    for (let j = 0; j < valCol; j++) {
      if (data[0][j] < -0.0001) return false;
    }
    // All b-values >= 0
    for (let i = 1; i < data.length; i++) {
      if (data[i][valCol] < -0.0001) return false;
    }
    return true;
  };

  const solveTableau = async (tableauIndex) => {
    if (!currentProblem || !simplexTableaus[tableauIndex]) return;
    setIsLoading(true);

    try {
      const nt = [...simplexTableaus];
      let result;

      if (tableauIndex === 0) {
        // Starttableau lokal aufbauen
        result = buildStartTableau();
        if (!result) { setSimplexFeedback({ korrekt: false, gesamtfeedback: '❌ Konnte LP nicht parsen. Prüfe die Formulierung.', tableauFeedback: [] }); setIsLoading(false); return; }
      } else {
        // Folgetableau aus vorherigem berechnen
        const prev = nt[tableauIndex - 1];
        if (prev.pivotRow < 0 || prev.pivotCol < 0) {
          setSimplexFeedback({ korrekt: false, gesamtfeedback: '❌ Bitte zuerst Pivot im vorherigen Tableau wählen.', tableauFeedback: [] }); setIsLoading(false); return;
        }
        result = solvePivotStep(prev);
        if (!result) { setSimplexFeedback({ korrekt: false, gesamtfeedback: '❌ Pivot-Element ist 0 – ungültiger Pivot.', tableauFeedback: [] }); setIsLoading(false); return; }
      }

      const tableau = { ...nt[tableauIndex] };
      tableau.data = result.data;
      tableau.basis = result.basis;
      tableau.nbVars = result.nbVars;
      tableau.zLabel = result.zLabel;

      // Optimalität prüfen und Pivot wählen
      const cols = tableau.data[0]?.length || 0;
      const valCol = cols - 1;
      if (isOptimalLocal(tableau)) {
        tableau.isOptimal = true;
        tableau.pivotRow = -1;
        tableau.pivotCol = -1;
      } else {
        tableau.isOptimal = false;
        const pivot = choosePivotLocal(tableau);
        tableau.pivotRow = pivot.row;
        tableau.pivotCol = pivot.col;
      }

      nt[tableauIndex] = tableau;
      setSimplexTableaus(nt);

      // Erklärung generieren
      if (tableau.isOptimal) {
        const bvars = tableau.basis.slice(1);
        const vals = tableau.data.slice(1).map(r => r[valCol]);
        const zVal = tableau.data[0][valCol];
        const explanation = `✅ Optimale Lösung erreicht! Z = ${zVal}. ${bvars.map((b, i) => `${b} = ${vals[i]}`).join(', ')}. Nichtbasisvariablen ${(tableau.nbVars || []).join(', ')} = 0.`;
        setSimplexFeedback({ korrekt: true, gesamtfeedback: explanation, tableauFeedback: [] });
      } else if (tableau.pivotRow >= 0 && tableau.pivotCol >= 0) {
        const pivotBV = tableau.basis[tableau.pivotRow];
        const pivotNBV = (tableau.nbVars || [])[tableau.pivotCol];
        const pivotVal = tableau.data[tableau.pivotRow][tableau.pivotCol];
        setSimplexFeedback({ korrekt: true, gesamtfeedback: `✅ Pivot gewählt: ${pivotBV}/${pivotNBV} (Wert: ${pivotVal}). ${pivotNBV} kommt in die Basis, ${pivotBV} verlässt sie.`, tableauFeedback: [] });
      }
    } catch (error) {
      console.log('Solve fehlgeschlagen:', error);
      setSimplexFeedback({ korrekt: false, gesamtfeedback: `❌ Fehler: ${error.message}`, tableauFeedback: [] });
    }
    setIsLoading(false);
  };

  const checkSimplexSolution = async () => {
    if (!currentProblem) return;
    setIsLoading(true);

    // Lokal die korrekte Lösung berechnen und vergleichen
    try {
      const correctTableaus = [];
      const startTab = buildStartTableau();
      if (!startTab) { setSimplexFeedback({ korrekt: false, gesamtfeedback: '❌ LP konnte nicht geparsed werden.', tableauFeedback: [] }); setIsLoading(false); return; }

      correctTableaus.push(startTab);
      let current = startTab;

      // Iteriere bis optimal (max 20 Iterationen)
      for (let iter = 0; iter < 20; iter++) {
        if (isOptimalLocal(current)) break;
        const pivot = choosePivotLocal(current);
        if (pivot.row < 0 || pivot.col < 0) break;
        current = { ...current, pivotRow: pivot.row, pivotCol: pivot.col };
        const next = solvePivotStep(current);
        if (!next) break;
        const nextTab = { ...next, pivotRow: -1, pivotCol: -1, isOptimal: false };
        correctTableaus.push(nextTab);
        current = nextTab;
      }

      // Vergleiche mit Nutzertableaus
      const tfb = [];
      let allCorrect = true;

      simplexTableaus.forEach((userTab, i) => {
        const fb = { tableauNummer: i, korrekt: true, fehler: [], hinweise: [] };
        if (i >= correctTableaus.length) {
          fb.korrekt = false;
          fb.fehler.push('Zu viele Tableaus – Lösung sollte bereits optimal sein.');
          allCorrect = false;
          tfb.push(fb); return;
        }
        const correct = correctTableaus[i];
        const userData = userTab.data.map(r => r.map(c => parseFloat(c) || 0));
        const correctData = correct.data.map(r => r.map(c => parseFloat(c) || 0));
        const cols = correctData[0]?.length || 0;

        // Prüfe Dimensionen
        if (userData.length !== correctData.length) {
          fb.korrekt = false; fb.fehler.push(`Falsche Anzahl Zeilen: ${userData.length} statt ${correctData.length}`);
          allCorrect = false; tfb.push(fb); return;
        }

        // Prüfe Basis-Labels
        const userBasis = userTab.basis || [];
        const correctBasis = correct.basis || [];
        for (let r = 0; r < correctBasis.length; r++) {
          if (userBasis[r]?.toLowerCase() !== correctBasis[r]?.toLowerCase()) {
            fb.fehler.push(`Zeile ${r}: Basisvariable "${userBasis[r]}" sollte "${correctBasis[r]}" sein`);
            fb.korrekt = false; allCorrect = false;
          }
        }

        // Prüfe NB-Vars
        const userNB = userTab.nbVars || ['x1', 'x2'];
        const correctNB = correct.nbVars || ['x1', 'x2'];
        for (let c = 0; c < correctNB.length; c++) {
          if (userNB[c]?.toLowerCase() !== correctNB[c]?.toLowerCase()) {
            fb.fehler.push(`Spalte ${c + 1}: "${userNB[c]}" sollte "${correctNB[c]}" sein`);
            fb.korrekt = false; allCorrect = false;
          }
        }

        // Prüfe Zellwerte (Toleranz 0.01)
        for (let r = 0; r < correctData.length; r++) {
          for (let c = 0; c < correctData[r].length; c++) {
            const diff = Math.abs(userData[r][c] - correctData[r][c]);
            if (diff > 0.01) {
              const bv = correct.basis[r] || `Zeile ${r}`;
              const colName = c < cols - 1 ? (correct.nbVars?.[c] || `Spalte ${c+1}`) : 'Wert';
              fb.fehler.push(`${bv}, ${colName}: Ist ${userData[r][c]}, sollte ${correctData[r][c]} sein`);
              fb.korrekt = false; allCorrect = false;
            }
          }
        }

        if (fb.korrekt) fb.hinweise.push('Alle Werte korrekt!');
        tfb.push(fb);
      });

      // Prüfe ob zu wenige Tableaus
      if (simplexTableaus.length < correctTableaus.length) {
        allCorrect = false;
        tfb.push({ tableauNummer: simplexTableaus.length, korrekt: false, fehler: [`Es fehlen noch ${correctTableaus.length - simplexTableaus.length} Tableau(s) bis zur optimalen Lösung.`], hinweise: [] });
      }

      const lastCorrect = correctTableaus[correctTableaus.length - 1];
      const lcCols = lastCorrect.data[0]?.length || 0;
      const lcValCol = lcCols - 1;
      const zVal = lastCorrect.data[0][lcValCol];
      const bvInfo = lastCorrect.basis.slice(1).map((b, i) => `${b} = ${lastCorrect.data[i+1][lcValCol]}`).join(', ');

      setSimplexFeedback({
        korrekt: allCorrect,
        tableauFeedback: tfb,
        optimaleLoesungKorrekt: allCorrect,
        gesamtfeedback: allCorrect
          ? `✅ Perfekt! Alle Tableaus sind korrekt. Optimale Lösung: Z = ${zVal}, ${bvInfo}`
          : `❌ Es gibt Fehler. Korrekte optimale Lösung wäre: Z = ${zVal}, ${bvInfo}`
      });
      if (allCorrect) setSimplexPhase('done');
    } catch (error) {
      console.log('Check fehlgeschlagen:', error);
      setSimplexFeedback({ korrekt: false, gesamtfeedback: `❌ Fehler beim Prüfen: ${error.message}`, tableauFeedback: [] });
    }
    setIsLoading(false);
  };

  // ===== GENERATOR MODE FUNCTIONS =====

  const generateSimplexProblem = async () => {
    setIsGenerating(true);
    setSimplexFeedback(null);
    setSimplexTableaus([]);
    setCurrentTableauIndex(0);

    const config: GeneratorConfig = {
      nVars: genVars,
      nConstraints: genConstraints,
      minTableaus: genMinTableaus,
      maxTableaus: genMaxTableaus,
      niceNumbers: genNiceNumbers,
      maxDenom: genMaxDenom,
    };

    const problem = await generateProblemAsync(config, seenHashes);
    if (problem) {
      seenHashes.add(problem.hash);
      setGeneratedProblem(problem);
      setGeneratedCount(prev => prev + 1);

      // Initialize empty tableaus with correct dimensions
      const numVars = problem.c.length;
      const numConstraints = problem.A.length;
      const rows = numConstraints + 1;
      const cols = numVars + 1;
      const empty: EditableTableau = {
        data: Array(rows).fill(null).map(() => Array(cols).fill('')),
        basis: ['Z', ...Array(numConstraints).fill(null).map((_, i) => `y${i+1}`)],
        nbVars: Array(numVars).fill(null).map((_, j) => `x${j+1}`),
        pivotRow: -1,
        pivotCol: -1,
        isOptimal: false,
        zLabel: 'Z',
      };
      setSimplexTableaus([empty]);
      setSimplexPhase('solving');
    }
    setIsGenerating(false);
  };

  const checkGeneratedSolution = () => {
    if (!generatedProblem) return;
    setIsLoading(true);

    const correctPath = generatedProblem.solutionPath;
    const tfb = [];
    let allCorrect = true;

    simplexTableaus.forEach((userTab, i) => {
      const fb = { tableauNummer: i, korrekt: true, fehler: [] as string[], hinweise: [] as string[] };
      if (i >= correctPath.length) {
        fb.korrekt = false;
        fb.fehler.push('Zu viele Tableaus – Lösung sollte bereits optimal sein.');
        allCorrect = false;
        tfb.push(fb);
        return;
      }

      const correct = correctPath[i];
      const correctData = correct.data;

      // Check dimensions
      if (userTab.data.length !== correctData.length || userTab.data[0]?.length !== correctData[0]?.length) {
        fb.korrekt = false;
        fb.fehler.push(`Falsche Dimensionen: ${userTab.data.length}x${userTab.data[0]?.length} statt ${correctData.length}x${correctData[0]?.length}`);
        allCorrect = false;
        tfb.push(fb);
        return;
      }

      // Check basis labels
      for (let r = 0; r < correct.basis.length; r++) {
        if (userTab.basis[r]?.toLowerCase() !== correct.basis[r]?.toLowerCase()) {
          fb.fehler.push(`Zeile ${r}: Basisvariable "${userTab.basis[r]}" sollte "${correct.basis[r]}" sein`);
          fb.korrekt = false;
          allCorrect = false;
        }
      }

      // Check NB vars
      for (let c = 0; c < correct.nbVars.length; c++) {
        if (userTab.nbVars[c]?.toLowerCase() !== correct.nbVars[c]?.toLowerCase()) {
          fb.fehler.push(`Spalte ${c + 1}: "${userTab.nbVars[c]}" sollte "${correct.nbVars[c]}" sein`);
          fb.korrekt = false;
          allCorrect = false;
        }
      }

      // Check cell values using exact Fraction comparison
      for (let r = 0; r < correctData.length; r++) {
        for (let c = 0; c < correctData[r].length; c++) {
          const userVal = Fraction.fromString(userTab.data[r][c] || '0');
          const correctVal = correctData[r][c];
          if (!userVal.equals(correctVal)) {
            const bv = correct.basis[r] || `Zeile ${r}`;
            const colIdx = correctData[r].length - 1;
            const colName = c < colIdx ? (correct.nbVars[c] || `Spalte ${c+1}`) : 'Wert';
            fb.fehler.push(`${bv}, ${colName}: Ist ${userTab.data[r][c] || '0'}, sollte ${correctVal.toDisplayString()} sein`);
            fb.korrekt = false;
            allCorrect = false;
          }
        }
      }

      if (fb.korrekt) fb.hinweise.push('Alle Werte korrekt!');
      tfb.push(fb);
    });

    // Check if too few tableaus
    if (simplexTableaus.length < correctPath.length) {
      allCorrect = false;
      tfb.push({
        tableauNummer: simplexTableaus.length,
        korrekt: false,
        fehler: [`Es fehlen noch ${correctPath.length - simplexTableaus.length} Tableau(s) bis zur optimalen Lösung.`],
        hinweise: [],
      });
    }

    const lastCorrect = correctPath[correctPath.length - 1];
    const cols = lastCorrect.data[0].length;
    const zVal = lastCorrect.data[0][cols - 1].toDisplayString();
    const bvInfo = lastCorrect.basis.slice(1).map((b, i) => `${b} = ${lastCorrect.data[i+1][cols-1].toDisplayString()}`).join(', ');

    setSimplexFeedback({
      korrekt: allCorrect,
      tableauFeedback: tfb,
      gesamtfeedback: allCorrect
        ? `✅ Perfekt! Alle Tableaus sind korrekt. Optimale Lösung: Z = ${zVal}, ${bvInfo}`
        : `❌ Es gibt Fehler. Korrekte optimale Lösung wäre: Z = ${zVal}, ${bvInfo}`,
    });
    if (allCorrect) setSimplexPhase('done');
    setIsLoading(false);
  };

  const solveGeneratedTableau = (tableauIndex: number) => {
    if (!generatedProblem) return;
    const correctPath = generatedProblem.solutionPath;
    if (tableauIndex >= correctPath.length) return;

    const correct = correctPath[tableauIndex];
    const editable = Simplex.toEditable(correct);

    const nt = [...simplexTableaus];
    nt[tableauIndex] = editable;
    setSimplexTableaus(nt);

    if (correct.isOptimal) {
      const cols = correct.data[0].length;
      const zVal = correct.data[0][cols - 1].toDisplayString();
      const bvInfo = correct.basis.slice(1).map((b, i) => `${b} = ${correct.data[i+1][cols-1].toDisplayString()}`).join(', ');
      setSimplexFeedback({ korrekt: true, gesamtfeedback: `✅ Optimale Lösung erreicht! Z = ${zVal}. ${bvInfo}. Nichtbasisvariablen ${correct.nbVars.join(', ')} = 0.`, tableauFeedback: [] });
    } else if (correct.pivotRow >= 0 && correct.pivotCol >= 0) {
      const pivotBV = correct.basis[correct.pivotRow];
      const pivotNBV = correct.nbVars[correct.pivotCol];
      const pivotVal = correct.data[correct.pivotRow][correct.pivotCol].toDisplayString();
      setSimplexFeedback({ korrekt: true, gesamtfeedback: `✅ Pivot gewählt: ${pivotBV}/${pivotNBV} (Wert: ${pivotVal}). ${pivotNBV} kommt in die Basis, ${pivotBV} verlässt sie.`, tableauFeedback: [] });
    }
  };

  // ===== SHARED TABLEAU RENDERING =====

  const renderTableaus = () => (
    <div className="space-y-6">
      {simplexTableaus?.map((tableau, ti) => {
        if (!tableau) return null;
        const nbVars = tableau.nbVars || ['x1', 'x2'];
        const numVarCols = nbVars.length;
        return (
          <div key={ti} className="border-2 border-gray-200 rounded-xl p-4 bg-gray-50 relative">
            <h4 className="text-base font-semibold text-gray-700 mb-3">Tableau {ti + 1} {ti === currentTableauIndex && <span className="text-sm text-purple-600">(Aktuell)</span>}</h4>
            {simplexTableaus.length > 1 && (
              <button onClick={() => deleteTableau(ti)} className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors" title="Tableau löschen">
                <X className="w-5 h-5" />
              </button>
            )}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border-2 border-gray-300 p-2 bg-gray-200 w-20" rowSpan={2}>Tab. {ti}</th>
                    <th className="border-2 border-gray-300 p-2 bg-yellow-100 text-sm" colSpan={numVarCols + 1}>Nichtbasisvariablen</th>
                  </tr>
                  <tr>
                    {nbVars.map((v, vi) => (
                      <th key={vi} className="border-2 border-gray-300 p-1 bg-yellow-100 w-20">
                        <input type="text" value={v} onChange={e => {
                          const nt = [...simplexTableaus];
                          if (!nt[ti].nbVars) nt[ti].nbVars = [...nbVars];
                          nt[ti].nbVars[vi] = e.target.value;
                          setSimplexTableaus(nt);
                        }} className="w-14 px-1 py-1 text-center border rounded text-sm font-bold bg-transparent" />
                      </th>
                    ))}
                    <th className="border-2 border-gray-300 p-1.5 bg-gray-100 w-20 text-sm">Wert</th>
                  </tr>
                </thead>
                <tbody>
                  {tableau.data?.map((row, ri) => (
                    <tr key={ri}>
                      <td className={`border-2 border-gray-300 p-1 font-bold ${ri === 0 ? 'bg-gray-100' : 'bg-green-100'}`}>
                        {ri === 0 ? (
                          <input type="text" value={tableau.zLabel || 'Z'} onChange={e => { const nt = [...simplexTableaus]; nt[ti].zLabel = e.target.value; setSimplexTableaus(nt); }} className="w-14 px-1 py-1 text-center border rounded text-sm font-bold bg-transparent" />
                        ) : (
                          <input type="text" value={tableau.basis?.[ri] || `y${ri}`} onChange={e => updateTableauBasis(ti, ri, e.target.value)} className="w-14 px-1 py-1 text-center border rounded text-sm bg-transparent" placeholder={`y${ri}`} />
                        )}
                      </td>
                      {row?.map((cell, ci) => (
                        <td key={ci} className={`border-2 border-gray-300 p-1 ${ci === row.length - 1 ? 'bg-gray-50' : ''}`}>
                          <input type="text" value={cell} onChange={e => updateTableauCell(ti, ri, ci, e.target.value)} className={`w-16 px-1 py-1 text-center border rounded text-sm ${tableau.pivotRow === ri && tableau.pivotCol === ci ? 'bg-yellow-200 border-yellow-500 font-bold' : ci === row.length - 1 ? 'bg-gray-50' : 'bg-white'}`} placeholder="0" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <label className="text-xs font-medium text-gray-600">Pivot:</label>
              <select className="px-2 py-1 border rounded text-xs" onChange={e => { const nt = [...simplexTableaus]; nt[ti].pivotRow = parseInt(e.target.value); setSimplexTableaus(nt); }} value={tableau.pivotRow}>
                <option value={-1}>Zeile...</option>{tableau.basis?.slice(1).map((b, i) => <option key={i} value={i+1}>{b}</option>)}
              </select>
              <select className="px-2 py-1 border rounded text-xs" onChange={e => { const nt = [...simplexTableaus]; nt[ti].pivotCol = parseInt(e.target.value); setSimplexTableaus(nt); }} value={tableau.pivotCol}>
                <option value={-1}>Spalte...</option>
                {nbVars.map((v, i) => <option key={i} value={i}>{v}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={tableau?.isOptimal || false} onChange={e => { const nt = [...simplexTableaus]; nt[ti].isOptimal = e.target.checked; setSimplexTableaus(nt); }} className="w-3 h-3" /><span>Optimal</span></label>
              <button onClick={() => appMode === 'simplex' ? solveGeneratedTableau(ti) : solveTableau(ti)} disabled={isLoading} className="ml-auto px-3 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1">
                {isLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                Tableau lösen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const addNebenbedingung = () => { setUserSolution({ ...userSolution, nebenbedingungen: [...userSolution.nebenbedingungen, ''] }); };
  const updateNebenbedingung = (i, v) => { const nb = [...userSolution.nebenbedingungen]; nb[i] = v; setUserSolution({ ...userSolution, nebenbedingungen: nb }); };

  useEffect(() => { generateNewProblem(); }, []);

  return (
    <div className="max-w-7xl mx-auto p-4 bg-gradient-to-br from-blue-50 to-indigo-50 min-h-screen">
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-indigo-600" />
            <div><h1 className="text-2xl font-bold text-gray-800">LP-Modell Trainer</h1><p className="text-xs text-gray-500">Modellierung & Simplex</p></div>
          </div>
          {appMode === 'modellierung' && (
            <button onClick={generateNewProblem} disabled={isLoading} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> Neue Aufgabe
            </button>
          )}
        </div>

        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg mb-4">
          <button
            onClick={() => setAppMode('modellierung')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${appMode === 'modellierung' ? 'bg-white shadow text-indigo-700' : 'text-gray-600 hover:text-gray-800'}`}
          >
            <BookOpen className="w-4 h-4 inline mr-1" /> Modellierung
          </button>
          <button
            onClick={() => setAppMode('simplex')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${appMode === 'simplex' ? 'bg-white shadow text-purple-700' : 'text-gray-600 hover:text-gray-800'}`}
          >
            <Table className="w-4 h-4 inline mr-1" /> Simplex Training
          </button>
        </div>

        {appMode === 'modellierung' && (
          <>
            {(() => {
              // Each dropdown sees templates filtered by the OTHER filter
              const forTypeDropdown = modellVarCount !== 'all'
                ? ALL_TEMPLATES.filter(t => t.numVars === parseInt(modellVarCount))
                : ALL_TEMPLATES;
              const forVarsDropdown = problemType !== 'all'
                ? ALL_TEMPLATES.filter(t => t.typ === problemType)
                : ALL_TEMPLATES;

              const typeOptions = [...new Set(forTypeDropdown.map(t => t.typ))].sort();
              const varOptions = [2, 3, 4, 5].filter(nv => forVarsDropdown.some(t => t.numVars === nv));

              return (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Aufgabentyp</label>
                    <select value={problemType} onChange={e => setProblemType(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="all">Alle Typen ({forTypeDropdown.length} Vorlagen)</option>
                      {typeOptions.map(typ => {
                        const count = forTypeDropdown.filter(t => t.typ === typ).length;
                        return <option key={typ} value={typ}>{typ} ({count})</option>;
                      })}
                    </select></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Variablen</label>
                    <select value={modellVarCount} onChange={e => setModellVarCount(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="all">Alle ({forVarsDropdown.length} Vorlagen)</option>
                      {varOptions.map(nv => {
                        const count = forVarsDropdown.filter(t => t.numVars === nv).length;
                        return <option key={nv} value={String(nv)}>{nv} Variablen ({count})</option>;
                      })}
                    </select></div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" checked={modellNiceNumbers} onChange={e => setModellNiceNumbers(e.target.checked)} className="rounded" />
                      <span className="text-gray-700">Schöne Zahlen</span>
                    </label>
                  </div>
                  <div className="flex items-end"><button onClick={generateNewProblem} className="w-full px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg text-sm">Neue Aufgabe</button></div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {appMode === 'simplex' && (
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Table className="w-5 h-5 text-purple-600" /> Problem-Generator
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Variablen</label>
              <input type="range" min={2} max={5} value={genVars} onChange={e => setGenVars(+e.target.value)} className="w-full" />
              <span className="text-sm text-gray-600">{genVars}</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nebenbedingungen</label>
              <input type="range" min={2} max={10} value={genConstraints} onChange={e => setGenConstraints(+e.target.value)} className="w-full" />
              <span className="text-sm text-gray-600">{genConstraints}</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Tableaus</label>
              <input type="range" min={1} max={genMaxTableaus} value={genMinTableaus} onChange={e => setGenMinTableaus(+e.target.value)} className="w-full" />
              <span className="text-sm text-gray-600">{genMinTableaus}</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Tableaus</label>
              <input type="range" min={genMinTableaus} max={8} value={genMaxTableaus} onChange={e => setGenMaxTableaus(+e.target.value)} className="w-full" />
              <span className="text-sm text-gray-600">{genMaxTableaus}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={genNiceNumbers} onChange={e => setGenNiceNumbers(e.target.checked)} className="w-4 h-4 text-purple-600 rounded" />
              Schöne Zahlen
            </label>
            {genNiceNumbers && (
              <select value={genMaxDenom} onChange={e => setGenMaxDenom(+e.target.value)} className="px-2 py-1 border rounded text-sm">
                <option value={6}>Max Nenner: 6</option>
                <option value={12}>Max Nenner: 12</option>
              </select>
            )}
            <span className="text-xs text-gray-500 ml-auto">Generiert: {generatedCount}</span>
          </div>
          <button
            onClick={generateSimplexProblem}
            disabled={isGenerating}
            className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            Problem generieren
          </button>
        </div>
      )}

      {appMode === 'simplex' && generatedProblem && (
        <>
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl shadow-lg p-4 mb-4 border border-indigo-200">
            <h4 className="text-sm font-semibold text-indigo-800 mb-2 flex items-center gap-2"><BookOpen className="w-4 h-4" />LP-Formulierung</h4>
            <div className="bg-white rounded-lg p-3 font-mono">
              <p className="text-indigo-600 font-bold">{formatProblem(generatedProblem).zielfunktion}</p>
              <p className="text-gray-600 text-sm mt-1">unter den Nebenbedingungen:</p>
              {formatProblem(generatedProblem).nebenbedingungen.map((nb, i) => (
                <p key={i} className="text-gray-700 text-sm ml-4">• {nb}</p>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Table className="w-6 h-6 text-purple-600" />Simplex-Algorithmus
            </h3>
            <div className="bg-purple-50 rounded-lg p-3 mb-4 text-sm text-purple-800">
              <p className="font-medium mb-1">Füllen Sie die Tableaus schrittweise aus.</p>
              <p className="text-purple-700">Z-Zeile oben • Basisvariablen y₁, y₂... • Spalten x₁, x₂{genVars > 2 ? `, ..., x${genVars}` : ''} • Letzte Spalte = Werte</p>
            </div>

            {renderTableaus()}

            <div className="mt-4 flex gap-2 flex-wrap">
              <button onClick={addNewTableau} className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" />Neues Tableau</button>
              <button onClick={checkGeneratedSolution} disabled={isLoading} className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg disabled:opacity-50 font-semibold text-sm">Simplex prüfen</button>
              <button onClick={generateSimplexProblem} disabled={isGenerating} className="px-3 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">Neues Problem</button>
            </div>
          </div>
        </>
      )}

      {appMode === 'modellierung' && currentProblem && (
        <>
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-gray-800">{currentProblem?.titel}</h2>
              <span className="px-3 py-1 bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-700 rounded-full text-xs font-semibold">{currentProblem?.typ} - {currentProblem?.optimierungsziel}</span>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4 whitespace-pre-line">{currentProblem?.beschreibung}</p>
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-3 mb-4">
              <div className="flex items-start gap-2"><BookOpen className="w-4 h-4 text-indigo-600 mt-0.5" /><div><p className="font-semibold text-indigo-700 text-sm">Hinweis:</p><p className="text-sm text-gray-700">{currentProblem?.hinweis}</p></div></div>
            </div>

            {(simplexPhase === 'setup' || simplexPhase === 'solving') && (
              <div className="space-y-4">
                <div><label className="block text-sm font-semibold text-gray-700 mb-2">Zielfunktion (Z = ...)</label>
                  <input type="text" value={userSolution.zielfunktion} onChange={e => setUserSolution({...userSolution, zielfunktion: e.target.value})} placeholder="z.B. Z = 2x1 + 3x2 (max)" className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-base" /></div>
                <div>
                  <div className="flex items-center justify-between mb-2"><label className="text-sm font-semibold text-gray-700">Nebenbedingungen</label>
                    <button onClick={addNebenbedingung} className="px-3 py-1 bg-green-500 text-white rounded-lg text-xs">+ Nebenbedingung</button></div>
                  <div className="space-y-2">{userSolution.nebenbedingungen.map((nb, i) => (
                    <input key={i} type="text" value={nb} onChange={e => updateNebenbedingung(i, e.target.value)} placeholder={`NB ${i+1} (z.B. 2x1 + x2 ≤ 100)`} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg text-sm" />
                  ))}</div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={checkSolution} disabled={isLoading || !userSolution.zielfunktion} className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg disabled:opacity-50 font-semibold">Lösung überprüfen</button>
                  <button onClick={() => setShowSolution(!showSolution)} className="px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg font-semibold">{showSolution ? 'Verbergen' : 'Lösung anzeigen'}</button>
                </div>
              </div>
            )}
          </div>

          {showSolution && currentProblem && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl shadow-xl p-6 mb-6 border-2 border-amber-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-green-600" />Musterlösung</h3>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showDetailedExplanation} onChange={e => setShowDetailedExplanation(e.target.checked)} className="w-3 h-3" /><span>Detaillierte Erklärung</span></label>
              </div>
              {showDetailedExplanation ? renderDetailedSolution() : (
                <div className="space-y-3">
                  <div className="bg-white rounded-lg p-4"><p className="font-semibold text-gray-700 mb-1">Variablen:</p>{currentProblem?.variablen?.map((v, i) => <p key={i} className="text-gray-600 ml-4 text-sm">• {v}</p>)}</div>
                  <div className="bg-white rounded-lg p-4"><p className="font-semibold text-gray-700 mb-1">Zielfunktion:</p><p className="text-indigo-600 font-mono ml-4">{currentProblem?.zielfunktion}</p></div>
                  <div className="bg-white rounded-lg p-4"><p className="font-semibold text-gray-700 mb-1">NB:</p>{currentProblem?.nebenbedingungen?.map((nb, i) => <p key={i} className="text-gray-600 ml-4 text-sm">• {nb}</p>)}</div>
                </div>
              )}
              {simplexPhase === 'setup' && (<div className="mt-4 flex justify-center"><button onClick={adoptSolution} className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold flex items-center gap-2"><CheckCircle className="w-5 h-5" />Lösung übernehmen</button></div>)}
            </div>
          )}

          {feedback && (
            <div className={`rounded-2xl shadow-xl p-6 mb-6 ${feedback?.korrekt ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200' : 'bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-200'}`}>
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2">{feedback?.korrekt ? <><CheckCircle className="w-5 h-5 text-green-600" /> Sehr gut!</> : <><AlertCircle className="w-5 h-5 text-red-600" /> Noch nicht ganz richtig</>}</h3>
              {feedback?.alternativerAnsatz?.gefunden && (<div className="bg-purple-50 rounded-lg p-3 border border-purple-200 mb-3"><p className="font-semibold text-purple-800 text-sm">🎯 Alternativer Lösungsweg erkannt!</p><p className="text-gray-700 text-sm">{feedback.alternativerAnsatz.beschreibung}</p></div>)}
              <div className="bg-white rounded-lg p-3 mb-3"><p className="font-semibold text-sm">Zielfunktion: {feedback?.zielfunktionKorrekt ? '✓ Korrekt' : '✗ Überprüfen'}</p></div>
              {feedback?.nebenbedingungen?.length > 0 && (<div className="bg-white rounded-lg p-3 mb-3"><p className="font-semibold text-sm mb-2">Nebenbedingungen:</p>{feedback.nebenbedingungen.map((nb, i) => (<div key={i} className="ml-4 mb-1"><p className={`text-sm ${nb.korrekt ? 'text-green-600' : 'text-red-600'}`}>{nb.korrekt ? '✓' : '✗'} {nb.eingabe}</p>{nb.kommentar && <p className="text-xs text-gray-600 ml-5">{nb.kommentar}</p>}</div>))}</div>)}
              {feedback?.fehlendeNebenbedingungen?.length > 0 && (<div className="bg-yellow-50 rounded-lg p-3 mb-3 border border-yellow-200">{feedback.fehlendeNebenbedingungen.map((nb, i) => <p key={i} className="text-yellow-700 text-sm">• {nb}</p>)}</div>)}
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><p className="text-gray-700 text-sm">{feedback?.gesamtfeedback}</p></div>
              {feedback?.tipps?.length > 0 && (<div className="bg-purple-50 rounded-lg p-3 mt-3">{feedback.tipps.map((t, i) => <p key={i} className="text-purple-700 text-sm">💡 {t}</p>)}</div>)}
            </div>
          )}

          {simplexPhase === 'solving' && (
            <>
              <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl shadow-lg p-4 mb-4 border border-indigo-200">
                <h4 className="text-sm font-semibold text-indigo-800 mb-2 flex items-center gap-2"><BookOpen className="w-4 h-4" />LP-Formulierung (Referenz)</h4>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="bg-white rounded-lg p-3"><p className="font-mono text-indigo-600">{userSolution.zielfunktion || currentProblem?.zielfunktion}</p>
                    {currentProblem?.optimierungsziel === 'minimieren' && <p className="text-xs text-amber-600 mt-1">⚠️ Minimierung: "-Z" im Tableau!</p>}</div>
                  <div className="bg-white rounded-lg p-3 text-sm font-mono text-gray-600 space-y-1">
                    {(userSolution.nebenbedingungen.filter(nb => nb.trim()).length > 0 ? userSolution.nebenbedingungen.filter(nb => nb.trim()) : currentProblem?.nebenbedingungen || []).map((nb, i) => <p key={i}>• {nb}</p>)}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Table className="w-6 h-6 text-purple-600" />Simplex-Algorithmus</h3>
                <div className="bg-purple-50 rounded-lg p-3 mb-4 text-sm text-purple-800">
                  <p className="font-medium mb-1">Füllen Sie die Tableaus schrittweise aus.</p>
                  <p className="text-purple-700">Z-Zeile oben • Basisvariablen y₁, y₂... • Spalten x₁, x₂ • Letzte Spalte = Werte • Bei Min: "-Z" verwenden</p>
                </div>

                {renderTableaus()}

                <div className="mt-4 flex gap-2 flex-wrap">
                  <button onClick={addNewTableau} className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" />Neues Tableau</button>
                  <button onClick={checkSimplexSolution} disabled={isLoading} className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg disabled:opacity-50 font-semibold text-sm">Simplex prüfen</button>
                  <button onClick={() => setShowSolution(!showSolution)} className="px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg text-sm">{showSolution ? 'Verbergen' : 'Musterlösung'}</button>
                  <button onClick={downloadHTML} className="px-3 py-2 bg-gray-600 text-white rounded-lg text-sm flex items-center gap-1" title="Als HTML herunterladen">
                    <BookOpen className="w-4 h-4" />Download
                  </button>
                  <button onClick={() => { setSimplexPhase('setup'); setSimplexTableaus([]); setSimplexFeedback(null); }} className="px-3 py-2 bg-gray-500 text-white rounded-lg text-sm">Zurück zur LP</button>
                </div>
              </div>
            </>
          )}

          {simplexFeedback && (
            <div className={`rounded-2xl shadow-xl p-6 mb-6 ${simplexFeedback?.korrekt ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200' : 'bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-200'}`}>
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2">{simplexFeedback?.korrekt ? <><CheckCircle className="w-5 h-5 text-green-600" /> Simplex korrekt!</> : <><AlertCircle className="w-5 h-5 text-red-600" /> Überprüfen</>}</h3>
              {simplexFeedback?.tableauFeedback?.map((tf, i) => (
                <div key={i} className="mb-3 bg-white rounded-lg p-3">
                  <p className="font-semibold text-sm">Tableau {tf.tableauNummer}: {tf.korrekt ? '✓' : '✗'}</p>
                  {tf.fehler?.map((f, j) => <p key={j} className="text-red-600 text-xs ml-4">• {f}</p>)}
                  {tf.hinweise?.map((h, j) => <p key={j} className="text-blue-600 text-xs ml-4">💡 {h}</p>)}
                </div>
              ))}
              <p className="text-gray-700 text-sm mt-2 whitespace-pre-wrap">{simplexFeedback?.gesamtfeedback}</p>
            </div>
          )}
        </>
      )}

      {appMode === 'simplex' && simplexFeedback && (
        <div className={`rounded-2xl shadow-xl p-6 mb-6 ${simplexFeedback?.korrekt ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200' : 'bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-200'}`}>
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">{simplexFeedback?.korrekt ? <><CheckCircle className="w-5 h-5 text-green-600" /> Simplex korrekt!</> : <><AlertCircle className="w-5 h-5 text-red-600" /> Überprüfen</>}</h3>
          {simplexFeedback?.tableauFeedback?.map((tf, i) => (
            <div key={i} className="mb-3 bg-white rounded-lg p-3">
              <p className="font-semibold text-sm">Tableau {tf.tableauNummer}: {tf.korrekt ? '✓' : '✗'}</p>
              {tf.fehler?.map((f, j) => <p key={j} className="text-red-600 text-xs ml-4">• {f}</p>)}
              {tf.hinweise?.map((h, j) => <p key={j} className="text-blue-600 text-xs ml-4">💡 {h}</p>)}
            </div>
          ))}
          <p className="text-gray-700 text-sm mt-2 whitespace-pre-wrap">{simplexFeedback?.gesamtfeedback}</p>
        </div>
      )}

      {showPrintView && (
        <div className="fixed inset-0 bg-white z-50 overflow-auto p-8 print-view" style={{fontFamily:'Arial,sans-serif'}}>
          <style>{`@media screen { .print-view .no-print { display:block } } @media print { .print-view .no-print { display:none } .print-view { position:static !important; } }`}</style>
          <button onClick={() => setShowPrintView(false)} className="no-print fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg z-50">Schließen</button>
          <h1 className="text-2xl font-bold mb-4">LP-Modell Trainer</h1>
          <div className="mb-4 p-4 bg-gray-50 border rounded-lg">
            <h2 className="text-lg font-bold">{currentProblem?.titel} <span className="text-sm text-indigo-600">{currentProblem?.typ} - {currentProblem?.optimierungsziel}</span></h2>
            <p className="mt-2 text-gray-700">{currentProblem?.beschreibung}</p>
          </div>
          <div className="mb-4 p-4 bg-indigo-50 rounded-lg">
            <h3 className="font-bold mb-2">LP-Formulierung</h3>
            <p className="font-mono text-lg font-bold">{userSolution.zielfunktion || currentProblem?.zielfunktion}</p>
            <p className="mt-2 font-semibold">Nebenbedingungen:</p>
            {(userSolution.nebenbedingungen.filter(nb => nb.trim()).length > 0 ? userSolution.nebenbedingungen.filter(nb => nb.trim()) : currentProblem?.nebenbedingungen || []).map((nb, i) => (
              <p key={i} className="font-mono ml-4">• {nb}</p>
            ))}
          </div>
          <h2 className="text-lg font-bold mb-3">Simplex-Algorithmus</h2>
          {simplexTableaus.map((tab, ti) => {
            const nbv = tab.nbVars || ['x1', 'x2'];
            return (
              <div key={ti} className="mb-6" style={{pageBreakInside:'avoid'}}>
                <h3 className="font-bold mb-2">Tableau {ti} {tab.isOptimal ? '(Optimal)' : ''}</h3>
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-gray-400 px-3 py-1.5 bg-gray-200">Tab. {ti}</th>
                      {nbv.map((v, vi) => <th key={vi} className="border border-gray-400 px-3 py-1.5 bg-yellow-100">{v}</th>)}
                      <th className="border border-gray-400 px-3 py-1.5 bg-gray-200">Wert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tab.data?.map((row, ri) => {
                      const label = ri === 0 ? (tab.zLabel || 'Z') : (tab.basis?.[ri] || `y${ri}`);
                      return (
                        <tr key={ri}>
                          <td className={`border border-gray-400 px-3 py-1.5 font-bold ${ri === 0 ? 'bg-gray-100' : 'bg-green-100'}`}>{label}</td>
                          {row.map((c, ci) => {
                            const isPivot = tab.pivotRow === ri && tab.pivotCol === ci;
                            return <td key={ci} className={`border border-gray-400 px-3 py-1.5 text-center ${isPivot ? 'bg-yellow-200 font-bold' : ''}`}>{c || '0'}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {tab.pivotRow >= 0 && tab.pivotCol >= 0 && (
                  <p className="text-xs text-gray-500 mt-1">Pivot: {tab.basis?.[tab.pivotRow]} / {nbv[tab.pivotCol]}</p>
                )}
                {tab.isOptimal && <p className="text-xs text-green-600 font-bold">✓ Optimal</p>}
              </div>
            );
          })}
          {simplexFeedback && (
            <div className={`mt-4 p-4 border-2 rounded-lg ${simplexFeedback.korrekt ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
              <h3 className="font-bold mb-2">{simplexFeedback.korrekt ? '✓ Simplex korrekt' : '✗ Fehler gefunden'}</h3>
              {simplexFeedback.tableauFeedback?.map((tf, i) => (
                <div key={i} className="mb-2 p-2 bg-white rounded">
                  <p className="font-semibold text-sm">Tableau {tf.tableauNummer}: {tf.korrekt ? '✓' : '✗'}</p>
                  {tf.fehler?.map((f, j) => <p key={j} className="text-red-600 text-xs ml-4">• {f}</p>)}
                </div>
              ))}
              <p className="mt-2 text-sm whitespace-pre-wrap">{simplexFeedback.gesamtfeedback}</p>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-8 border-t pt-2">LP-Modell Trainer – {new Date().toLocaleDateString('de-DE')} · © 2026 Felix Flösch</p>
        </div>
      )}

      <footer className="text-center text-xs text-gray-400 mt-6 pb-2">
        LP-Modell Trainer · © 2026 <a href="https://github.com/H4MS7" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-600">Felix Flösch</a> · <a href="https://github.com/H4MS7/lp-modell-trainer" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-600">Quellcode auf GitHub</a> · Lizenz: <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-600">GPLv3</a>
      </footer>
    </div>
  );
};

export default LPModellTrainer;
