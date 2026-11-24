#!/usr/bin/env python3
"""
Generate prose LP problems using Claude API.

For each type, loads verified math sets and exemplars, then uses Claude
to generate German prose word problems wrapping the exact coefficients.
The LLM only generates: titel, beschreibung, variablen, hinweis, highlights.
The zielfunktion and nebenbedingungen are deterministically constructed.

Supports n-variable problems (2, 3, 4, 5) via --vars flag.

Usage:
    python3 generate_prose.py [--type TYPE] [--count N] [--vars N] [--concurrency N] [--dry-run]
"""
import argparse
import asyncio
import json
import os
import random
import re
import sys
import time

import anthropic

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL = "claude-sonnet-4-20250514"
MAX_RETRIES = 3


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_registry():
    return load_json(os.path.join(SCRIPT_DIR, "type_registry.json"))


def load_math_sets(type_name, num_vars=2):
    if num_vars > 2:
        safe_name = type_name.lower().replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
        path = os.path.join(SCRIPT_DIR, "math_verified", f"multivar_{safe_name}_{num_vars}var.json")
    else:
        path = os.path.join(SCRIPT_DIR, "math_verified", f"{type_name.lower()}.json")
    if not os.path.exists(path):
        return []
    return load_json(path)


def load_exemplars(type_name, num_vars=2):
    """Load exemplar problems for a given type and variable count."""
    # Map type names to file names
    name_map = {
        "Investitionsoptimierung": "investitionsoptimierung",
        "Maschinenparametrierung": "maschinenparametrierung",
        "Diätproblem": "diaetproblem",
        "Emissionsoptimierung": "emissionsoptimierung",
        "Schichtplanung": "schichtplanung",
        "Energiemix": "energiemix",
        "Kapazitätsplanung": "it_kapazitaetsplanung",
        "Medienplanung": "medienplanung",
        "Lagerhaltung": "lagerhaltung",
        "Qualitätskontrolle": "qualitaetskontrolle",
        "Flächennutzung": "flaechennutzung",
        "Wartungsplanung": "wartungsplanung",
    }
    fname = name_map.get(type_name, type_name.lower())

    exemplars = []
    # For multi-var, try loading multivar exemplars first
    if num_vars > 2:
        mv_path = os.path.join(SCRIPT_DIR, "exemplars", f"multivar_{fname}.json")
        if os.path.exists(mv_path):
            all_mv = load_json(mv_path)
            # Filter exemplars matching the requested variable count (or one below as fallback)
            for ex in all_mv:
                nv = len(ex.get("variablen", []))
                if nv == num_vars or nv == num_vars - 1:
                    exemplars.append(ex)
            if exemplars:
                return exemplars

    # Fall back to standard 2-var exemplars
    path = os.path.join(SCRIPT_DIR, "exemplars", f"{fname}.json")
    if not os.path.exists(path):
        return []
    return load_json(path)


def format_number_german(n):
    """Format a number for German text (comma as decimal separator)."""
    if isinstance(n, int) or (isinstance(n, float) and n == int(n)):
        return str(int(n))
    return str(n).replace('.', ',')


def format_constraint(a1, a2, b, op, label):
    """Build a constraint string like '3x1 + 2x2 ≤ 120 (Label)'."""
    parts = []

    # Format x1 term
    a1_str = format_coeff(a1, is_first=True)
    if a1_str:
        parts.append(a1_str)

    # Format x2 term
    a2_str = format_coeff(a2, is_first=(not parts))
    if a2_str:
        parts.append(a2_str)

    lhs = ' '.join(parts) if parts else "0"
    op_sym = {"<=": "≤", ">=": "≥", "=": "="}[op]
    b_fmt = format_number_german(b)

    return f"{lhs} {op_sym} {b_fmt} ({label})"


def format_coeff(val, is_first=False, var_suffix=""):
    """Format a coefficient for a constraint."""
    if val == 0:
        return ""
    abs_val = abs(val)
    sign = "" if val > 0 and is_first else ("+ " if val > 0 else "- ")

    if abs_val == 1:
        num_str = ""
    else:
        num_str = format_number_german(abs_val)

    return f"{sign}{num_str}"


def build_zielfunktion(c, optimization):
    """Build zielfunktion string from coefficients (n variables)."""
    max_min = "(max)" if optimization == "maximieren" else "(min)"
    terms = []
    for j, cj in enumerate(c):
        cj_str = format_number_german(cj)
        var = f"x{j+1}"
        if j == 0:
            terms.append(f"{cj_str}{var}")
        else:
            terms.append(f"+ {cj_str}{var}")
    return f"Z = {' '.join(terms)} {max_min}"


def build_nebenbedingungen(A, b, constraint_types, labels):
    """Build nebenbedingungen list from matrix data (n variables)."""
    num_vars = len(A[0]) if A else 2
    nbs = []
    op_map = {"<=": "≤", ">=": "≥", "=": "="}
    for i in range(len(A)):
        row = A[i]
        bi = b[i]
        op = op_map[constraint_types[i]]
        label = labels[i] if i < len(labels) else f"NB{i+1}"

        parts = []
        for j in range(num_vars):
            aj = row[j]
            var = f"x{j+1}"
            if aj == 0:
                continue
            if parts:
                # Not the first term
                if aj > 0:
                    if aj == 1:
                        parts.append(f"+ {var}")
                    else:
                        parts.append(f"+ {format_number_german(aj)}{var}")
                else:
                    if aj == -1:
                        parts.append(f"- {var}")
                    else:
                        parts.append(f"- {format_number_german(abs(aj))}{var}")
            else:
                # First term
                if aj == 1:
                    parts.append(var)
                elif aj == -1:
                    parts.append(f"-{var}")
                else:
                    parts.append(f"{format_number_german(aj)}{var}")

        lhs = " ".join(parts) if parts else "0"
        nbs.append(f"{lhs} {op} {format_number_german(bi)} ({label})")

    # Non-negativity constraint
    var_list = ", ".join(f"x{j+1}" for j in range(num_vars))
    nbs.append(f"{var_list} ≥ 0")
    return nbs


def build_prompt(type_name, type_def, math_set, exemplars, scenario, num_vars=2):
    """Build the Claude prompt for prose generation."""
    c = math_set["c"]
    A = math_set["A"]
    b = math_set["b"]
    ct = math_set["constraint_types"]
    optimization = math_set["optimization"]
    num_constraints = len(A)

    # Format the math for the prompt (n variables)
    max_min = "maximieren" if optimization == "maximieren" else "minimieren"
    zf_terms = " + ".join(f"{c[j]}x{_sub(j+1)}" for j in range(num_vars))
    zf_display = f"Z = {zf_terms} ({max_min[:3]})"
    constraints_display = []
    op_map = {"<=": "≤", ">=": "≥", "=": "="}
    for i in range(num_constraints):
        terms = " + ".join(f"{A[i][j]}x{_sub(j+1)}" for j in range(num_vars))
        constraints_display.append(
            f"  {i+1}. {terms} {op_map[ct[i]]} {b[i]}"
        )

    var_list = ", ".join(f"x{_sub(j+1)}" for j in range(num_vars))
    nn_display = f"{var_list} ≥ 0"

    # Format exemplars for few-shot
    exemplar_text = ""
    if exemplars:
        for ex in exemplars[:2]:
            exemplar_text += f"\n--- EXEMPLAR ---\n{json.dumps(ex, indent=2, ensure_ascii=False)}\n"

    # Variable pattern key depends on num_vars
    var_patterns_key = f"variable_patterns_{num_vars}" if num_vars > 2 else "variable_patterns"
    var_patterns = type_def.get(var_patterns_key, type_def.get("variable_patterns", []))

    var_instructions = ""
    if num_vars > 2:
        var_names = ", ".join(f"x{_sub(j+1)}" for j in range(num_vars))
        var_instructions = f"""
WICHTIG: Dieses Problem hat {num_vars} Variablen ({var_names}).
- Definiere GENAU {num_vars} Variablen in "variablen" (x1 bis x{num_vars})
- Die beschreibung muss {num_vars} verschiedene Produkte/Aktivitäten/Optionen beschreiben
- Jede Variable muss klar einem konkreten Gegenstand im Szenario zugeordnet sein"""

    prompt = f"""Du generierst ein deutsches LP-Textproblem für eine Universitäts-Trainingsapp.

TYP: {type_name}
OPTIMIERUNG: {max_min}
SZENARIO: {scenario}
VARIABLENANZAHL: {num_vars}
{var_instructions}
VERIFIZIERTE ZAHLEN (verwende diese EXAKT):
- Zielfunktion: {zf_display}
- Nebenbedingungen:
{chr(10).join(constraints_display)}
- Nicht-Negativität: {nn_display}

REGELN:
1. Schreibe eine "beschreibung" (150-300 Wörter) die ALLE Koeffizienten als lesbare Zahlen einbettet
2. Deutscher Dezimaltrenner: "2,50€" nicht "2.50€"
3. Für jeden Highlight: kopiere den EXAKTEN Teilstring aus deiner beschreibung
4. Die beschreibung muss ein realistisches, zusammenhängendes Szenario beschreiben
5. Verwende passende Fachbegriffe aus dem Bereich {type_name}
6. Der hinweis soll dem Studierenden helfen, die richtige Modellierung zu finden
7. Jede Zahl in den Constraints MUSS im Beschreibungstext vorkommen

VARIABLEN-MUSTER:
- Beispiele: {json.dumps(var_patterns, ensure_ascii=False)}

FACHVOKABULAR: {json.dumps(type_def.get("vocabulary", []), ensure_ascii=False)}

{exemplar_text}

Generiere das Problem mit dem create_problem Tool. JEDER highlight-Text muss ein zeichengenauer Teilstring der beschreibung sein."""

    return prompt


def _sub(n):
    """Return subscript digit for display in prompts."""
    subs = "₀₁₂₃₄₅₆₇₈₉"
    return ''.join(subs[int(d)] for d in str(n))


# Tool schema for structured output
PROBLEM_TOOL = {
    "name": "create_problem",
    "description": "Create an LP word problem with all required fields",
    "input_schema": {
        "type": "object",
        "required": ["titel", "beschreibung", "variablen", "hinweis", "highlights", "constraint_labels"],
        "properties": {
            "titel": {
                "type": "string",
                "description": "Short descriptive title in German"
            },
            "beschreibung": {
                "type": "string",
                "description": "The full word problem text in German (150-250 words)"
            },
            "variablen": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Variable definitions: ['x1 = ...', 'x2 = ...', ...] (one per variable)"
            },
            "hinweis": {
                "type": "string",
                "description": "A helpful hint for the student in German"
            },
            "constraint_labels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Short labels for each constraint, e.g. ['Kapital', 'Risiko', 'Mindestrendite']"
            },
            "highlights": {
                "type": "object",
                "required": ["zielfunktion", "nebenbedingungen"],
                "properties": {
                    "zielfunktion": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["text", "bedeutung"],
                            "properties": {
                                "text": {"type": "string", "description": "EXACT substring from beschreibung"},
                                "bedeutung": {"type": "string", "description": "Mathematical meaning"}
                            }
                        }
                    },
                    "nebenbedingungen": {
                        "type": "array",
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["text", "bedeutung"],
                                "properties": {
                                    "text": {"type": "string", "description": "EXACT substring from beschreibung"},
                                    "bedeutung": {"type": "string", "description": "Mathematical meaning"}
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}


def validate_highlights(beschreibung, highlights):
    """Validate that all highlight texts are exact substrings of beschreibung."""
    errors = []
    for h in highlights.get("zielfunktion", []):
        if h.get("text") and h["text"] not in beschreibung:
            errors.append(f"ZF highlight not found: '{h['text']}'")

    for i, nb_hl in enumerate(highlights.get("nebenbedingungen", [])):
        for h in nb_hl:
            if h.get("text") and h["text"] not in beschreibung:
                errors.append(f"NB[{i}] highlight not found: '{h['text']}'")

    return errors


def inject_math_fields(tool_result, math_set):
    """Deterministically construct zielfunktion and nebenbedingungen from math data."""
    c = math_set["c"]
    A = math_set["A"]
    b = math_set["b"]
    ct = math_set["constraint_types"]
    optimization = math_set["optimization"]

    labels = tool_result.get("constraint_labels", [f"NB{i+1}" for i in range(len(A))])

    problem = {
        "titel": tool_result["titel"],
        "beschreibung": tool_result["beschreibung"],
        "typ": "",  # Will be set by caller
        "optimierungsziel": optimization,
        "variablen": tool_result["variablen"],
        "zielfunktion": build_zielfunktion(c, optimization),
        "nebenbedingungen": build_nebenbedingungen(A, b, ct, labels),
        "hinweis": tool_result["hinweis"],
        "highlights": tool_result["highlights"],
    }
    return problem


async def call_claude(client, prompt, semaphore):
    """Call Claude API with tool_use for structured output."""
    async with semaphore:
        try:
            response = await asyncio.to_thread(
                client.messages.create,
                model=MODEL,
                max_tokens=2000,
                tools=[PROBLEM_TOOL],
                tool_choice={"type": "tool", "name": "create_problem"},
                messages=[{"role": "user", "content": prompt}]
            )

            # Extract tool use result
            for block in response.content:
                if block.type == "tool_use" and block.name == "create_problem":
                    return block.input

            return None
        except Exception as e:
            print(f"    API error: {e}")
            return None


async def generate_batch(client, type_name, type_def, math_sets, exemplars, count, concurrency, num_vars=2):
    """Generate a batch of prose problems for a type."""
    semaphore = asyncio.Semaphore(concurrency)
    scenarios = type_def.get("scenarios", [f"{type_name} Szenario"])
    results = []
    failures = 0

    # Limit to requested count
    math_sets = math_sets[:count]

    print(f"\n--- {type_name}: generating {len(math_sets)} problems ---")

    for idx, math_set in enumerate(math_sets):
        scenario = random.choice(scenarios)
        prompt = build_prompt(type_name, type_def, math_set, exemplars, scenario, num_vars=num_vars)

        success = False
        for attempt in range(MAX_RETRIES):
            tool_result = await call_claude(client, prompt, semaphore)
            if tool_result is None:
                print(f"  [{idx+1}/{len(math_sets)}] Attempt {attempt+1}: API returned None")
                continue

            # Inject deterministic math fields
            problem = inject_math_fields(tool_result, math_set)
            problem["typ"] = type_name

            # Validate highlights
            errors = validate_highlights(problem["beschreibung"], problem["highlights"])
            if errors:
                print(f"  [{idx+1}/{len(math_sets)}] Attempt {attempt+1}: {len(errors)} highlight errors")
                for e in errors[:3]:
                    print(f"    - {e}")
                continue

            results.append(problem)
            success = True
            print(f"  [{idx+1}/{len(math_sets)}] OK: {problem['titel']}")
            break

        if not success:
            failures += 1
            print(f"  [{idx+1}/{len(math_sets)}] FAILED after {MAX_RETRIES} attempts")

    print(f"  Results: {len(results)} success, {failures} failures")
    return results


async def generate_batch_concurrent(client, type_name, type_def, math_sets, exemplars, count, concurrency, num_vars=2):
    """Generate a batch with concurrent API calls."""
    semaphore = asyncio.Semaphore(concurrency)
    scenarios = type_def.get("scenarios", [f"{type_name} Szenario"])
    math_sets = math_sets[:count]

    print(f"\n--- {type_name}: generating {len(math_sets)} problems (concurrency={concurrency}) ---")

    async def process_one(idx, math_set):
        scenario = random.choice(scenarios)
        prompt = build_prompt(type_name, type_def, math_set, exemplars, scenario, num_vars=num_vars)

        for attempt in range(MAX_RETRIES):
            tool_result = await call_claude(client, prompt, semaphore)
            if tool_result is None:
                continue

            problem = inject_math_fields(tool_result, math_set)
            problem["typ"] = type_name

            errors = validate_highlights(problem["beschreibung"], problem["highlights"])
            if not errors:
                print(f"  [{idx+1}/{len(math_sets)}] OK: {problem['titel']}")
                return problem
            else:
                print(f"  [{idx+1}/{len(math_sets)}] Attempt {attempt+1}: {len(errors)} highlight errors")

        print(f"  [{idx+1}/{len(math_sets)}] FAILED")
        return None

    tasks = [process_one(idx, ms) for idx, ms in enumerate(math_sets)]
    results = await asyncio.gather(*tasks)
    valid = [r for r in results if r is not None]

    print(f"  Results: {len(valid)}/{len(math_sets)} success")
    return valid


async def main_async(args):
    client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY env var
    registry = load_registry()
    num_vars = args.vars or 2

    types_to_generate = []
    if args.type:
        if args.type not in registry:
            print(f"Unknown type: {args.type}")
            print(f"Available: {', '.join(registry.keys())}")
            return 1
        types_to_generate = [args.type]
    elif num_vars > 2:
        # For multi-var, only generate for types that have multivar_targets
        types_to_generate = [
            t for t, d in registry.items()
            if str(num_vars) in d.get("multivar_targets", {})
        ]
    else:
        types_to_generate = [t for t, d in registry.items() if d.get("target_count", 0) > 0]

    total_generated = 0
    for type_name in types_to_generate:
        type_def = registry[type_name]
        if num_vars > 2:
            target = args.count or type_def.get("multivar_targets", {}).get(str(num_vars), 0)
        else:
            target = args.count or type_def.get("target_count", 10)

        if target == 0:
            continue

        math_sets = load_math_sets(type_name, num_vars=num_vars)
        if not math_sets:
            print(f"  No math sets for {type_name} ({num_vars}-var), skipping")
            continue

        exemplars = load_exemplars(type_name, num_vars=num_vars)
        print(f"  Loaded {len(math_sets)} math sets, {len(exemplars)} exemplars for {type_name} ({num_vars}-var)")

        if args.dry_run:
            # Just show the first prompt
            scenario = random.choice(type_def.get("scenarios", ["Test"]))
            prompt = build_prompt(type_name, type_def, math_sets[0], exemplars, scenario, num_vars=num_vars)
            print(f"\n--- DRY RUN PROMPT for {type_name} ({num_vars}-var) ---")
            print(prompt[:2000])
            print("...")
            continue

        results = await generate_batch_concurrent(
            client, type_name, type_def, math_sets, exemplars, target, args.concurrency, num_vars=num_vars
        )

        if results:
            safe_name = type_name.lower().replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
            if num_vars > 2:
                output_path = os.path.join(SCRIPT_DIR, f"batch_multivar_{safe_name}_{num_vars}var.json")
            else:
                batch_num = 9 + types_to_generate.index(type_name)
                output_path = os.path.join(SCRIPT_DIR, f"batch_{batch_num}_{safe_name}.json")
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            print(f"  Saved {len(results)} problems to {output_path}")
            total_generated += len(results)

    print(f"\n{'='*60}")
    print(f"Total: {total_generated} problems generated")
    print(f"{'='*60}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Generate prose LP problems using Claude API")
    parser.add_argument("--type", type=str, help="Generate only for this type")
    parser.add_argument("--count", type=int, help="Override target count per type")
    parser.add_argument("--vars", type=int, choices=[2, 3, 4, 5], help="Number of variables (default: 2)")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent API calls")
    parser.add_argument("--dry-run", action="store_true", help="Just show prompts, don't call API")
    args = parser.parse_args()

    return asyncio.run(main_async(args))


if __name__ == '__main__':
    sys.exit(main())
