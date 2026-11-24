#!/usr/bin/env python3
"""
Enhanced validator for LP problem JSON files.
Supports all 16 types, strict highlight checks, number consistency, and dedup.
"""
import json
import glob
import re
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

VALID_TYPES = [
    'Produktionsproblem', 'Mischungsproblem', 'Transportproblem', 'Ressourcenallokation',
    'Investitionsoptimierung', 'Maschinenparametrierung', 'Diätproblem', 'Emissionsoptimierung',
    'Schichtplanung', 'Energiemix', 'Kapazitätsplanung', 'Medienplanung',
    'Lagerhaltung', 'Qualitätskontrolle', 'Flächennutzung', 'Wartungsplanung'
]


def extract_numbers(text):
    """Extract all numbers from text, handling German comma decimals."""
    nums = set()
    for m in re.finditer(r'\d+(?:[.,]\d+)?', text):
        s = m.group()
        nums.add(s)
        nums.add(s.replace(',', '.'))
        nums.add(s.replace('.', ','))
        try:
            nums.add(str(float(s.replace(',', '.'))))
            val = float(s.replace(',', '.'))
            if val == int(val):
                nums.add(str(int(val)))
        except ValueError:
            pass
    nums.discard(None)
    return nums


def check_highlight_substring(beschreibung, highlights, problem_title):
    """Check that highlight texts are actual substrings of beschreibung."""
    errors = []
    if not highlights:
        errors.append("Missing highlights object")
        return errors

    for h in highlights.get('zielfunktion', []):
        if h.get('text') and h['text'] not in beschreibung:
            errors.append(f"ZF highlight '{h['text']}' not found in beschreibung")

    for i, nb_highlights in enumerate(highlights.get('nebenbedingungen', [])):
        if nb_highlights:
            for h in nb_highlights:
                if h.get('text') and h['text'] not in beschreibung:
                    errors.append(f"NB[{i}] highlight '{h['text']}' not found in beschreibung")
    return errors


def check_numbers_in_text(beschreibung, zielfunktion, nebenbedingungen, title, unit_conversion=False):
    """Check that constraint numbers appear in the beschreibung."""
    errors = []
    text_nums = extract_numbers(beschreibung)

    # Check zielfunktion coefficients
    zf_clean = zielfunktion.replace(',', '.')
    for m in re.finditer(r'(\d+(?:\.\d+)?)', zf_clean):
        num = m.group()
        found = False
        for tn in text_nums:
            try:
                if abs(float(tn.replace(',', '.')) - float(num)) < 0.001:
                    found = True
                    break
            except ValueError:
                pass
        if not found and num not in ['1', '2']:
            errors.append(f"ZF coefficient {num} not found in beschreibung")

    # Check nebenbedingungen
    for nb in nebenbedingungen:
        if '≥ 0' in nb and 'x' in nb.lower():
            continue  # Skip non-negativity
        nb_clean = nb.replace(',', '.').split('(')[0]
        for m in re.finditer(r'(\d+(?:\.\d+)?)', nb_clean):
            num = m.group()
            if num in ['1', '2'] and ('x1' in nb or 'x2' in nb):
                continue
            found = False
            for tn in text_nums:
                try:
                    if abs(float(tn.replace(',', '.')) - float(num.replace(',', '.'))) < 0.001:
                        found = True
                        break
                except ValueError:
                    pass
            if not found:
                if unit_conversion:
                    continue  # Skip for unit conversion problems
                errors.append(f"NB coefficient {num} from '{nb[:50]}...' not found in beschreibung")

    return errors


def check_constraint_types(nebenbedingungen, typ):
    """Check that constraint inequality symbols are reasonable for the type."""
    errors = []
    for nb in nebenbedingungen:
        if '≥ 0' in nb and 'x' in nb.lower():
            continue
        # Just check that constraints use valid symbols
        has_symbol = '≤' in nb or '≥' in nb or '=' in nb
        if not has_symbol:
            errors.append(f"Constraint missing inequality symbol: '{nb[:50]}...'")
    return errors


def validate_structure(problem, idx, filename):
    """Validate a single problem's structure."""
    errors = []
    required = ['titel', 'beschreibung', 'typ', 'optimierungsziel', 'variablen',
                'zielfunktion', 'nebenbedingungen', 'hinweis', 'highlights']

    for field in required:
        if field not in problem:
            errors.append(f"Missing field: {field}")

    if errors:
        return errors

    # Check typ
    if problem['typ'] not in VALID_TYPES:
        errors.append(f"Invalid typ: {problem['typ']}")

    # Check optimierungsziel
    if problem['optimierungsziel'] not in ['maximieren', 'minimieren']:
        errors.append(f"Invalid optimierungsziel: {problem['optimierungsziel']}")

    # Check zielfunktion has (max) or (min)
    zf = problem['zielfunktion']
    if problem['optimierungsziel'] == 'maximieren' and '(max)' not in zf.lower() and 'max' not in zf.lower():
        errors.append(f"ZF missing (max): {zf}")
    if problem['optimierungsziel'] == 'minimieren' and '(min)' not in zf.lower() and 'min' not in zf.lower():
        errors.append(f"ZF missing (min): {zf}")

    # Check non-negativity
    nbs = problem['nebenbedingungen']
    has_nn = any('≥ 0' in nb and 'x' in nb.lower() for nb in nbs)
    if not has_nn:
        errors.append("Missing non-negativity constraint")

    # Check variables
    if len(problem['variablen']) != 2:
        errors.append(f"Expected 2 variables, got {len(problem['variablen'])}")

    # Check highlights
    h_errors = check_highlight_substring(problem['beschreibung'], problem.get('highlights'), problem['titel'])
    errors.extend(h_errors)

    # Check numbers in text
    unit_conversion = problem.get('unitConversion', False)
    n_errors = check_numbers_in_text(problem['beschreibung'], problem['zielfunktion'],
                                      problem['nebenbedingungen'], problem['titel'], unit_conversion)
    errors.extend(n_errors)

    # Check constraint types
    ct_errors = check_constraint_types(problem['nebenbedingungen'], problem['typ'])
    errors.extend(ct_errors)

    # Check beschreibung length (should be substantial)
    if len(problem['beschreibung']) < 80:
        errors.append(f"Beschreibung too short ({len(problem['beschreibung'])} chars)")

    return errors


def check_duplicates(problems):
    """Check for duplicate titles."""
    titles = {}
    dupes = []
    for i, p in enumerate(problems):
        t = p.get('titel', '')
        if t in titles:
            dupes.append(f"Duplicate title: '{t}' (indices {titles[t]} and {i})")
        else:
            titles[t] = i
    return dupes


def validate_file(filepath):
    """Validate all problems in a single file."""
    filename = os.path.basename(filepath)
    try:
        with open(filepath, encoding='utf-8') as f:
            problems = json.load(f)
    except json.JSONDecodeError as e:
        return filename, 0, [f"INVALID JSON: {e}"], []

    file_errors = []
    for i, problem in enumerate(problems):
        errors = validate_structure(problem, i, filename)
        if errors:
            file_errors.append((i, problem.get('titel', '???'), errors))

    return filename, len(problems), file_errors, problems


def main():
    # Find all batch files + exemplar files
    patterns = [
        os.path.join(SCRIPT_DIR, 'batch_*.json'),
        os.path.join(SCRIPT_DIR, 'exemplars', '*.json'),
    ]

    files = []
    for pattern in patterns:
        files.extend(sorted(glob.glob(pattern)))

    # Also check all_problems.json if it exists
    all_path = os.path.join(SCRIPT_DIR, 'all_problems.json')
    if os.path.exists(all_path):
        files.append(all_path)

    total_problems = 0
    total_errors = 0
    all_problems = []

    for filepath in files:
        filename, count, file_errors, problems = validate_file(filepath)

        print(f"\n{'='*60}")
        print(f"  {filename}: {count} problems")
        print(f"{'='*60}")

        if isinstance(file_errors, list) and file_errors and isinstance(file_errors[0], str):
            # JSON parse error
            for e in file_errors:
                print(f"  ERROR: {e}")
            total_errors += 1
            continue

        error_count = sum(len(errors) for _, _, errors in file_errors)
        if error_count == 0:
            print(f"  All {count} problems valid")
        else:
            for idx, title, errors in file_errors:
                print(f"\n  #{idx+1} {title}:")
                for e in errors:
                    print(f"    - {e}")

        total_problems += count
        total_errors += error_count
        all_problems.extend(problems)

    # Check for duplicates across all files
    if all_problems:
        dupes = check_duplicates(all_problems)
        if dupes:
            print(f"\n{'='*60}")
            print(f"DUPLICATES FOUND:")
            print(f"{'='*60}")
            for d in dupes:
                print(f"  - {d}")
            total_errors += len(dupes)

    # Type distribution
    if all_problems:
        type_counts = {}
        for p in all_problems:
            t = p.get('typ', 'UNKNOWN')
            type_counts[t] = type_counts.get(t, 0) + 1
        print(f"\n{'='*60}")
        print(f"TYPE DISTRIBUTION:")
        print(f"{'='*60}")
        for t in sorted(type_counts.keys()):
            print(f"  {t}: {type_counts[t]}")

    print(f"\n{'='*60}")
    print(f"SUMMARY: {total_problems} problems validated")
    print(f"Issues found: {total_errors}")
    print(f"{'='*60}")

    return 0 if total_errors == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
