// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

/**
 * Browser test for the tutor mode: plays an error-prone learner through complete
 * simplex runs (trainer + after modelling) and checks after every action that the
 * tutor stays consistent. Also checks how help fades with mastery.
 *
 * Run: npm run test:e2e   (starts its own Vite dev server; needs Google Chrome,
 * or set CHROME_PATH to a Chrome/Chromium binary)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; failures.push(msg); console.error(`  FAIL: ${msg}`); }
}

const server = await createServer({ root: appDir, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const panel = page.locator('div.sticky').filter({ hasText: 'Tutor' });
  const title = async () => (await panel.locator('p.font-semibold').first().innerText()).trim();
  // no auto-wait: an absent feedback line must not cost a timeout
  const feedback = async () => (await panel.locator('p.text-red-600').allInnerTexts()).join(' ').trim();
  const panelText = async () => (await panel.innerText()).split('Fortschritt:')[0];
  const target = () => page.locator('input[data-cell].ring-2');
  const tableauOf = t => { const m = t.match(/Tableau (\d+)/); return m ? +m[1] - 1 : 0; };

  async function fresh({ mastery = null } = {}) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(m => {
      localStorage.setItem('lptrainer.tutor.on', '1');
      if (m) localStorage.setItem('lptrainer.tutor.mastery', JSON.stringify(m)); else localStorage.removeItem('lptrainer.tutor.mastery');
    }, mastery);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Nebenbedingungen', { timeout: 20000 });
  }
  async function trainerProblem() {
    await page.getByRole('button', { name: /Simplex Training/ }).click();
    await page.getByRole('button', { name: /Problem generieren/ }).click();
    await panel.waitFor();
  }
  async function modellingProblem(wantMin) {
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      const before = await page.locator('h2').first().innerText();
      await page.getByRole('button', { name: 'Neue Aufgabe' }).last().click();
      // problems are generated asynchronously: wait until the new one is shown
      for (let w = 0; w < 30 && (await page.locator('h2').first().innerText()) === before; w++) await page.waitForTimeout(100);
      found = (await page.locator('text=/- minimieren/').count() > 0) === wantMin;
    }
    ok(found, `found a ${wantMin ? 'minimisation' : 'maximisation'} problem`);
    await page.getByRole('button', { name: 'Lösung anzeigen' }).click();
    await page.getByRole('button', { name: 'Lösung übernehmen' }).click();
    await page.getByRole('button', { name: 'Lösung überprüfen' }).click();
    await panel.waitFor();
  }
  async function reveal() {
    for (let i = 0; i < 4 && !(await panel.getByRole('button', { name: 'Lösung zeigen' }).count()); i++) {
      await panel.getByRole('button', { name: 'Hinweis' }).click();
    }
    await panel.getByRole('button', { name: 'Lösung zeigen' }).click();
    return (await panel.locator('text=/^Lösung:/').locator('..').innerText()).replace(/^Lösung:\s*/, '').trim();
  }
  async function typeInto(loc, text, { submit = 'Enter' } = {}) {
    await loc.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text, { delay: 8 });
    if (submit) await page.keyboard.press(submit);
    await page.waitForTimeout(120);
  }
  const negate = s => (s.startsWith('-') ? s.slice(1) : `-${s}`);

  /** Error-prone learner: every step first gets wrong answers, then the right one. */
  async function chaoticRun(label) {
    let steps = 0, sawDual = false;
    for (let guard = 0; guard < 300; guard++) {
      const t = await title();
      if (/Geschafft/.test(t)) break;
      steps++;
      const ti = tableauOf(t);
      if (/Duale/.test(await panelText())) sawDual = true;
      const res = await reveal();

      if (/Zelle/.test(t)) {
        const cellKey = await target().getAttribute('data-cell');
        const [, r, c] = cellKey.split(':').map(Number);
        ok(cellKey.startsWith(`${ti}:`), `${label} "${t}": ring on ${cellKey} (other tableau)`);
        if (!/^-?0$/.test(res)) {
          await typeInto(target(), negate(res));
          ok(await title() === t, `${label} "${t}": wrong sign "${negate(res)}" was accepted`);
          ok(/Vorzeichen/.test(await feedback()), `${label} "${t}": wrong sign → "${await feedback()}"`);
        }
        // a wrong value that starts with the right one must not be accepted while typing
        await typeInto(target(), `${res}1`);
        ok(await title() === t, `${label} "${t}": "${res}1" was accepted (prefix of the right value)`);
        ok((await feedback()).length > 0, `${label} "${t}": no feedback for "${res}1"`);
        if (/Rechteckregel:/.test(await panelText())) {
          const box = await panel.locator('text=Schritt für Schritt').count();
          ok(box > 0, `${label} "${t}": no worked steps after a wrong rectangle-rule answer`);
        }
        await typeInto(target(), 'x', { submit: 'Tab' });
        ok(/keine gültige Zahl/.test(await feedback()), `${label} "${t}": invalid → "${await feedback()}"`);
        await typeInto(page.locator(`input[data-cell="${cellKey}"]`), res);
        await page.waitForTimeout(150);
        ok(await title() !== t, `${label} "${t}": correct "${res}" not accepted (feedback "${await feedback()}")`);
        ok(await page.locator(`input[data-cell="${cellKey}"]`).inputValue() === res, `${label} "${t}": cell does not show "${res}"`);
        ok(!(await feedback()), `${label} "${t}": old feedback still shown on next step`);
        ok(r >= 0 && c >= 0, 'cell key parsed');
      } else if (/Pivotspalte wählen|Pivotzeile wählen/.test(t)) {
        const isCol = /Pivotspalte/.test(t);
        const sel = page.locator(isCol ? `select[data-pivotcol="${ti}"]` : `select[data-pivotrow="${ti}"]`);
        const labels = (await sel.locator('option').allInnerTexts()).map(s => s.trim()).filter(l => !/\.\.\./.test(l));
        const wrong = labels.find(l => l !== res);
        if (wrong) {
          await sel.selectOption({ label: wrong });
          await page.waitForTimeout(120);
          ok(await title() === t, `${label} "${t}": wrong pivot "${wrong}" accepted`);
          ok(/Nicht diese/.test(await feedback()), `${label} "${t}": wrong pivot → "${await feedback()}"`);
        }
        const opt = page.locator(`input[data-optimal="${ti}"]`);
        if (await opt.isEnabled()) {
          await opt.click();
          await page.waitForTimeout(120);
          ok(!(await opt.isChecked()), `${label} "${t}": "Optimal" could be ticked on a non-optimal tableau`);
          ok(/Noch nicht optimal/.test(await feedback()), `${label} "${t}": premature optimal → "${await feedback()}"`);
        }
        await sel.selectOption({ label: res });
        await page.waitForTimeout(150);
        ok(await title() !== t, `${label} "${t}": correct pivot "${res}" not accepted`);
      } else if (/Beschriftungen/.test(t)) {
        const m = res.match(/Zeile (\d+) = (\S+), Spalte (\d+) = (\S+)/);
        const tab = page.locator('table').nth(ti);
        // like a human: delete the old label character by character, then type the new one
        for (const [input, text] of [[tab.locator('tbody tr').nth(+m[1]).locator('td').first().locator('input'), m[2]],
                                     [tab.locator('thead tr').nth(1).locator('th').nth(+m[3] - 1).locator('input'), m[4]]]) {
          await input.click();
          await page.keyboard.press('End');
          for (let k = 0; k < 6; k++) await page.keyboard.press('Backspace');
          ok(await input.inputValue() === '', `${label} "${t}": label could not be emptied (shows "${await input.inputValue()}")`);
          await page.keyboard.type(text, { delay: 8 });
        }
        await page.waitForTimeout(150);
        ok(await title() !== t, `${label} "${t}": labels not accepted`);
      } else if (/optimal/.test(t)) {
        await page.locator(`input[data-optimal="${ti}"]`).check();
        await page.waitForTimeout(150);
      } else {
        ok(false, `${label}: unknown step "${t}"`);
        break;
      }
    }
    ok(/Geschafft/.test(await title()), `${label}: run did not finish`);
    await page.getByRole('button', { name: 'Simplex prüfen' }).click();
    await page.waitForTimeout(200);
    const check = await page.locator('text=/Perfekt|Es gibt Fehler/').first().innerText();
    ok(/Perfekt/.test(check), `${label}: final check "${check.slice(0, 120)}"`);
    console.log(`  ${label}: ${steps} steps${sawDual ? ' (with dual steps)' : ''}`);
    return { steps, sawDual };
  }

  console.log('\nTUTOR E2E: chaotic learner');
  await fresh(); await trainerProblem(); await chaoticRun('trainer #1');
  await fresh(); await trainerProblem(); await chaoticRun('trainer #2');
  await fresh(); await modellingProblem(true);
  const min = await chaoticRun('modelling (min)');
  ok(min.sawDual, 'modelling (min): dual steps were taught');
  await fresh(); await modellingProblem(false); await chaoticRun('modelling (max)');

  console.log('\nTUTOR E2E: help fades with mastery');
  // clean answers on the start tableau: computed from the LP shown on the page
  await fresh(); await trainerProblem();
  const lp = await page.locator('text=LP-Formulierung').locator('..').innerText();
  const lines = lp.split('\n').map(s => s.trim());
  const zf = lines.find(l => l.startsWith('Z ='));
  const nv = (zf.match(/x\d+/g) || []).length;
  const coef = (expr, j) => { const m = expr.replace(/\s/g, '').match(new RegExp(`([+-]?\\d*)x${j}(?!\\d)`)); return m ? (m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : +m[1]) : 0; };
  const cons = lines.filter(l => l.includes('≤')).map(l => l.replace(/^•\s*/, ''));
  const start = [[...Array.from({ length: nv }, (_, j) => -coef(zf.split('=')[1], j + 1)), 0],
    ...cons.map(c => { const [l, r] = c.split('≤'); return [...Array.from({ length: nv }, (_, j) => coef(l, j + 1)), +r.trim()]; })];
  let rowCells = 0;
  for (let i = 0; i < start.length; i++) for (let j = 0; j <= nv; j++) {
    const txt = await panelText();
    if (i >= 1) {
      rowCells++;
      const ruleShown = /Vorzeichen bei Nebenbedingungen/.test(txt);
      const formulaShown = /Eintrag =/.test(txt);
      if (rowCells === 1) ok(ruleShown && formulaShown, 'mastery 0: rule and formula shown');
      if (rowCells === 2 || rowCells === 3) ok(ruleShown && !formulaShown, `mastery ${rowCells - 1}: rule only (rule ${ruleShown}, formula ${formulaShown})`);
      if (rowCells >= 4) ok(!ruleShown, `mastered (cell ${rowCells}): rule hidden`);
    }
    await typeInto(target(), String(start[i][j]));
  }
  // mastered: hint opens for one step only; a mistake brings full help back
  await fresh({ mastery: { startZ: 3, startRow: 3, pivotCol: 3, pivotRow: 3, labels: 3, pivotElement: 3, pivotRowCell: 3, pivotColCell: 3, rectangle: 3, optimal: 3, dualPivot: 3 } });
  await trainerProblem();
  ok(!/Maximierung/.test(await panelText()), 'mastered: Z-row rule hidden');
  await panel.getByRole('button', { name: 'Hinweis' }).click();
  ok(/Maximierung/.test(await panelText()), 'Hinweis shows the rule');
  const first = await reveal();
  await typeInto(target(), first);
  ok(!/Maximierung/.test(await panelText()), 'next step: hint closed again');
  const second = await reveal();
  await typeInto(target(), negate(second) === second ? `${second}1` : negate(second));
  await typeInto(target(), second);
  ok(await panel.locator('p.font-mono.text-indigo-700').count() > 0, 'after a mistake the skill gets full help again (formula shown)');

  ok(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
} finally {
  await browser.close();
  await server.close();
}

console.log(`\n${'═'.repeat(60)}\n  FINAL RESULTS: ${pass} passed, ${fail} failed\n${'═'.repeat(60)}`);
if (failures.length) { console.log('\nFirst failures:'); failures.slice(0, 15).forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
