#!/usr/bin/env python3
"""Validate LP problem JSON files for mathematical consistency."""
import json, glob, re, sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))

def extract_numbers(text):
    """Extract all numbers from text, handling German comma decimals."""
    nums = set()
    for m in re.finditer(r'\d+(?:[.,]\d+)?', text):
        s = m.group()
        nums.add(s)
        nums.add(s.replace(',', '.'))
        nums.add(s.replace('.', ','))
        # Also add the float value
        try:
            nums.add(str(float(s.replace(',', '.'))))
            nums.add(str(int(float(s.replace(',', '.')))) if float(s.replace(',', '.')) == int(float(s.replace(',', '.'))) else None)
        except:
            pass
    nums.discard(None)
    return nums

def check_highlight_substring(beschreibung, highlights, problem_title):
    """Check that highlight texts are actual substrings of beschreibung."""
    errors = []
    if not highlights:
        return errors

    for h in highlights.get('zielfunktion', []):
        if h.get('text') and h['text'] not in beschreibung:
            # Try case-insensitive
            if h['text'].lower() not in beschreibung.lower():
                errors.append(f"  ZF highlight '{h['text']}' not found in beschreibung")

    for i, nb_highlights in enumerate(highlights.get('nebenbedingungen', [])):
        if nb_highlights:
            for h in nb_highlights:
                if h.get('text') and h['text'] not in beschreibung:
                    if h['text'].lower() not in beschreibung.lower():
                        errors.append(f"  NB[{i}] highlight '{h['text']}' not found in beschreibung")
    return errors

def check_numbers_in_text(beschreibung, zielfunktion, nebenbedingungen, title):
    """Check that constraint numbers appear in the beschreibung."""
    errors = []
    text_nums = extract_numbers(beschreibung)

    # Check zielfunktion coefficients
    zf_clean = zielfunktion.replace(',', '.')
    for m in re.finditer(r'(\d+(?:\.\d+)?)', zf_clean):
        num = m.group()
        num_comma = num.replace('.', ',')
        found = False
        for tn in text_nums:
            try:
                if abs(float(tn.replace(',', '.')) - float(num)) < 0.001:
                    found = True
                    break
            except:
                pass
        if not found and num not in ['1', '2']:  # x1, x2 don't count
            errors.append(f"  ZF coefficient {num} not found in beschreibung")

    # Check nebenbedingungen
    for nb in nebenbedingungen:
        if '≥ 0' in nb and 'x' in nb.lower():
            continue  # Skip non-negativity
        nb_clean = nb.replace(',', '.').split('(')[0]  # Remove label
        for m in re.finditer(r'(\d+(?:\.\d+)?)', nb_clean):
            num = m.group()
            if num in ['1', '2'] and ('x1' in nb or 'x2' in nb):
                continue  # Variable indices
            found = False
            for tn in text_nums:
                try:
                    if abs(float(tn.replace(',', '.')) - float(num.replace(',', '.'))) < 0.001:
                        found = True
                        break
                except:
                    pass
            if not found:
                errors.append(f"  NB coefficient {num} from '{nb[:50]}...' not found in beschreibung")

    return errors

def validate_structure(problem, idx, filename):
    """Validate a single problem's structure."""
    errors = []
    required = ['titel', 'beschreibung', 'typ', 'optimierungsziel', 'variablen',
                 'zielfunktion', 'nebenbedingungen', 'hinweis', 'highlights']

    for field in required:
        if field not in problem:
            errors.append(f"  Missing field: {field}")

    if not errors:
        # Check typ
        valid_types = ['Produktionsproblem', 'Mischungsproblem', 'Transportproblem', 'Ressourcenallokation']
        if problem['typ'] not in valid_types:
            errors.append(f"  Invalid typ: {problem['typ']}")

        # Check optimierungsziel
        if problem['optimierungsziel'] not in ['maximieren', 'minimieren']:
            errors.append(f"  Invalid optimierungsziel: {problem['optimierungsziel']}")

        # Check zielfunktion has (max) or (min)
        zf = problem['zielfunktion']
        if problem['optimierungsziel'] == 'maximieren' and '(max)' not in zf.lower() and 'max' not in zf.lower():
            errors.append(f"  ZF missing (max): {zf}")
        if problem['optimierungsziel'] == 'minimieren' and '(min)' not in zf.lower() and 'min' not in zf.lower():
            errors.append(f"  ZF missing (min): {zf}")

        # Check non-negativity
        nbs = problem['nebenbedingungen']
        has_nn = any('≥ 0' in nb and 'x' in nb.lower() for nb in nbs)
        if not has_nn:
            errors.append(f"  Missing non-negativity constraint")

        # Check variables
        if len(problem['variablen']) != 2:
            errors.append(f"  Expected 2 variables, got {len(problem['variablen'])}")

        # Check highlights
        h_errors = check_highlight_substring(problem['beschreibung'], problem.get('highlights'), problem['titel'])
        errors.extend(h_errors)

        # Check numbers in text
        n_errors = check_numbers_in_text(problem['beschreibung'], problem['zielfunktion'],
                                          problem['nebenbedingungen'], problem['titel'])
        errors.extend(n_errors)

    return errors

def main():
    files = sorted(glob.glob(os.path.join(HERE, "batch_*.json")))
    total_problems = 0
    total_errors = 0
    total_warnings = 0

    for filepath in files:
        filename = filepath.split('/')[-1]
        try:
            with open(filepath) as f:
                problems = json.load(f)
        except json.JSONDecodeError as e:
            print(f"\n❌ {filename}: INVALID JSON - {e}")
            total_errors += 1
            continue

        file_errors = 0
        print(f"\n{'='*60}")
        print(f"📁 {filename}: {len(problems)} problems")
        print(f"{'='*60}")

        for i, problem in enumerate(problems):
            errors = validate_structure(problem, i, filename)
            if errors:
                file_errors += len(errors)
                print(f"\n  ⚠️  #{i+1} {problem.get('titel', '???')}:")
                for e in errors:
                    print(f"    {e}")

        if file_errors == 0:
            print(f"  ✅ All {len(problems)} problems valid")
        else:
            print(f"\n  ❌ {file_errors} issues found")

        total_problems += len(problems)
        total_errors += file_errors

    print(f"\n{'='*60}")
    print(f"SUMMARY: {total_problems} problems across {len(files)} files")
    print(f"Issues found: {total_errors}")
    print(f"{'='*60}")

    return 0 if total_errors == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
