#!/usr/bin/env python3
"""Validate all template JSON files in problems/templates/."""

import json
import os
import re
import sys
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent / "templates"

def find_placeholders(text: str) -> set[str]:
    """Extract all {key} placeholders from a string."""
    return set(re.findall(r'\{(\w+)\}', text))

def fill_placeholders(text: str, values: dict[str, int]) -> str:
    """Replace {key} with values."""
    def repl(m):
        k = m.group(1)
        return str(values.get(k, m.group(0)))
    return re.sub(r'\{(\w+)\}', repl, text)

def validate_template(filepath: Path) -> list[str]:
    """Validate a single template. Returns list of error messages."""
    errors = []

    try:
        with open(filepath) as f:
            t = json.load(f)
    except json.JSONDecodeError as e:
        return [f"Invalid JSON: {e}"]

    # Required fields
    required = ["id", "typ", "optimierungsziel", "numVars", "variablen",
                 "objective", "constraints", "coefficients", "titel",
                 "beschreibung", "hinweis", "highlights"]
    for field in required:
        if field not in t:
            errors.append(f"Missing field: {field}")

    if errors:
        return errors

    coeff_keys = set(t["coefficients"].keys())
    n = t["numVars"]

    # Check variablen count matches numVars
    if len(t["variablen"]) != n:
        errors.append(f"variablen count {len(t['variablen'])} != numVars {n}")

    # Check objective keys
    if len(t["objective"]) != n:
        errors.append(f"objective count {len(t['objective'])} != numVars {n}")
    for key in t["objective"]:
        if key not in coeff_keys:
            errors.append(f"objective key '{key}' not in coefficients")

    # Check constraints
    for i, ct in enumerate(t["constraints"]):
        if ct["type"] not in ("<=", ">=", "="):
            errors.append(f"Constraint {i}: invalid type '{ct['type']}'")
        if len(ct["row"]) != n:
            errors.append(f"Constraint {i}: row length {len(ct['row'])} != numVars {n}")
        for key in ct["row"]:
            if key not in coeff_keys:
                errors.append(f"Constraint {i}: row key '{key}' not in coefficients")
        if ct["rhs"] not in coeff_keys:
            errors.append(f"Constraint {i}: rhs key '{ct['rhs']}' not in coefficients")

    # Check coefficient ranges
    for key, rng in t["coefficients"].items():
        if "min" not in rng or "max" not in rng:
            errors.append(f"Coefficient '{key}': missing min/max")
            continue
        if rng["min"] > rng["max"]:
            errors.append(f"Coefficient '{key}': min {rng['min']} > max {rng['max']}")
        if rng["min"] < 0:
            errors.append(f"Coefficient '{key}': min {rng['min']} < 0")

    # Check all placeholders in beschreibung are in coefficients
    desc_placeholders = find_placeholders(t["beschreibung"])
    for p in desc_placeholders:
        if p not in coeff_keys:
            errors.append(f"beschreibung placeholder '{{{p}}}' not in coefficients")

    # Check all coefficient keys appear somewhere
    all_text = t["beschreibung"] + t["hinweis"]
    all_text_placeholders = find_placeholders(all_text)
    # Also check highlights
    for h in t["highlights"].get("zielfunktion", []):
        all_text_placeholders |= find_placeholders(h.get("text", ""))
        all_text_placeholders |= find_placeholders(h.get("bedeutung", ""))
    for group in t["highlights"].get("nebenbedingungen", []):
        for h in group:
            all_text_placeholders |= find_placeholders(h.get("text", ""))
            all_text_placeholders |= find_placeholders(h.get("bedeutung", ""))

    # Check highlight texts are substrings of beschreibung
    # Use midpoint values for testing
    mid_values = {}
    for key, rng in t["coefficients"].items():
        mid_values[key] = (rng["min"] + rng["max"]) // 2

    filled_desc = fill_placeholders(t["beschreibung"], mid_values)

    for h in t["highlights"].get("zielfunktion", []):
        filled_text = fill_placeholders(h["text"], mid_values)
        if filled_text not in filled_desc:
            errors.append(f"Zielfunktion highlight '{filled_text}' not substring of beschreibung")

    for gi, group in enumerate(t["highlights"].get("nebenbedingungen", [])):
        for h in group:
            filled_text = fill_placeholders(h["text"], mid_values)
            if filled_text not in filled_desc:
                errors.append(f"NB[{gi}] highlight '{filled_text}' not substring of beschreibung")

    # Check highlight count matches constraints
    nb_highlights = t["highlights"].get("nebenbedingungen", [])
    if len(nb_highlights) != len(t["constraints"]):
        errors.append(f"nebenbedingungen highlight groups ({len(nb_highlights)}) != constraints ({len(t['constraints'])})")

    return errors


def main():
    if not TEMPLATES_DIR.exists():
        print(f"ERROR: {TEMPLATES_DIR} does not exist")
        sys.exit(1)

    total = 0
    failed = 0
    type_counts = {}
    var_counts = {}

    for type_dir in sorted(TEMPLATES_DIR.iterdir()):
        if not type_dir.is_dir():
            continue

        type_name = type_dir.name
        type_counts[type_name] = 0

        for filepath in sorted(type_dir.glob("*.json")):
            total += 1
            type_counts[type_name] += 1

            errors = validate_template(filepath)

            # Track var counts
            try:
                with open(filepath) as f:
                    t = json.load(f)
                nv = t.get("numVars", "?")
                key = f"{type_name}_{nv}v"
                var_counts[key] = var_counts.get(key, 0) + 1
            except:
                pass

            if errors:
                failed += 1
                print(f"\nFAIL: {filepath.relative_to(TEMPLATES_DIR)}")
                for e in errors:
                    print(f"  - {e}")

    print(f"\n{'='*60}")
    print(f"Total templates: {total}")
    print(f"Passed: {total - failed}")
    print(f"Failed: {failed}")
    print(f"\nPer type:")
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")
    print(f"\nPer type+vars:")
    for k, c in sorted(var_counts.items()):
        print(f"  {k}: {c}")

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
