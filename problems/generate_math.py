#!/usr/bin/env python3
"""
Generate verified coefficient sets for LP problems.

For each type in type_registry.json, generates random n-variable LP problems
with integer coefficients, runs simplex with exact Fraction arithmetic, and
accepts only "nice" problems (all intermediate denominators ≤ MAX_DENOM).

Supports 2, 3, 4, 5 variables via --multivar flag or num_vars parameter.

Output: problems/math_verified/{type_name}.json (2-var)
        problems/math_verified/multivar_{type}_{n}var.json (multi-var)
"""
import argparse
import json
import os
import random
import sys
import time
from fractions import Fraction

MAX_DENOM = 6  # Denominators allowed: 1,2,3,4,5,6

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def is_nice(value: Fraction) -> bool:
    reduced = Fraction(value).limit_denominator(10**9)
    return reduced.denominator <= MAX_DENOM


def generate_random_lp(constraint_count, constraint_types, coeff_ranges, num_vars=2):
    """Generate a random n-variable LP with integer coefficients."""
    obj_range = coeff_ranges["objective"]
    lhs_range = coeff_ranges["lhs"]
    rhs_range = coeff_ranges["rhs"]

    c = [random.randint(*obj_range) for _ in range(num_vars)]

    A = []
    b = []
    ct = []
    for i in range(constraint_count):
        row = [random.randint(*lhs_range) for _ in range(num_vars)]
        rhs = random.randint(*rhs_range)
        A.append(row)
        b.append(rhs)
        # Cycle through available constraint types
        if i < len(constraint_types):
            ct.append(constraint_types[i])
        else:
            ct.append("<=")

    return c, A, b, ct


def simplex_check_nice(c, A, b, constraint_types, optimization):
    """
    Run simplex on the given LP and check if all intermediates are nice.

    Handles <=, >=, and = constraints with n variables.
    For maximization: standard simplex
    For minimization: negate objective (max -Z), then negate result

    Returns (is_all_nice, num_pivots, solution_z, all_values)
    """
    num_vars = len(c)
    m = len(A)

    # Convert to standard form: all <= constraints for maximization
    std_A = []
    std_b = []
    for i in range(m):
        ct = constraint_types[i] if i < len(constraint_types) else "<="
        if ct == "<=":
            std_A.append(list(A[i]))
            std_b.append(b[i])
        elif ct == ">=":
            std_A.append([-A[i][j] for j in range(num_vars)])
            std_b.append(-b[i])
        elif ct == "=":
            std_A.append(list(A[i]))
            std_b.append(b[i])
            std_A.append([-A[i][j] for j in range(num_vars)])
            std_b.append(-b[i])

    sm = len(std_A)

    # For minimization, negate objective: min c'x = max (-c)'x
    if optimization == "minimieren":
        eff_c = [-c[j] for j in range(num_vars)]
    else:
        eff_c = list(c)

    # Build initial tableau: num_vars columns + 1 RHS column
    cols = num_vars + 1
    data = []
    # Z-row: [-c1, -c2, ..., -cn, 0]
    z_row = [Fraction(-eff_c[j]) for j in range(num_vars)] + [Fraction(0)]
    data.append(z_row)
    for i in range(sm):
        row = [Fraction(std_A[i][j]) for j in range(num_vars)] + [Fraction(std_b[i])]
        data.append(row)

    all_values = set()
    for row in data:
        for v in row:
            all_values.add(v)

    basis = ['Z'] + [f'y{i+1}' for i in range(sm)]
    nb_vars = [f'x{j+1}' for j in range(num_vars)]

    max_iters = 50  # More iterations for higher-dimensional problems
    num_pivots = 0

    for _ in range(max_iters):
        # Check for negative b-values (dual simplex needed)
        rhs_col = num_vars  # Last column index
        dual_needed = any(data[i][rhs_col] < 0 for i in range(1, sm + 1))

        if dual_needed:
            pivot_row = min(range(1, sm + 1), key=lambda i: data[i][rhs_col])
            if data[pivot_row][rhs_col] >= 0:
                break

            pivot_col = -1
            min_ratio = float('inf')
            for j in range(num_vars):
                if data[pivot_row][j] < 0:
                    ratio = abs(data[0][j] / data[pivot_row][j])
                    if ratio < min_ratio:
                        min_ratio = ratio
                        pivot_col = j
            if pivot_col < 0:
                return False, num_pivots, None, all_values  # Infeasible
        else:
            pivot_col = -1
            min_z = Fraction(0)
            for j in range(num_vars):
                if data[0][j] < min_z:
                    min_z = data[0][j]
                    pivot_col = j

            if pivot_col < 0:
                break  # Optimal

            pivot_row = -1
            min_ratio = None
            for i in range(1, sm + 1):
                if data[i][pivot_col] > 0:
                    ratio = data[i][rhs_col] / data[i][pivot_col]
                    if ratio >= 0 and (min_ratio is None or ratio < min_ratio):
                        min_ratio = ratio
                        pivot_row = i

            if pivot_row < 0:
                return False, num_pivots, None, all_values  # Unbounded

        # Perform pivot
        pivot_val = data[pivot_row][pivot_col]
        if pivot_val == 0:
            return False, num_pivots, None, all_values

        rows = sm + 1
        new_data = [[Fraction(0)] * cols for _ in range(rows)]

        for i in range(rows):
            for j in range(cols):
                if i == pivot_row and j == pivot_col:
                    new_data[i][j] = Fraction(1) / pivot_val
                elif i == pivot_row:
                    new_data[i][j] = data[i][j] / pivot_val
                elif j == pivot_col:
                    new_data[i][j] = -data[i][j] / pivot_val
                else:
                    new_data[i][j] = data[i][j] - (data[i][pivot_col] * data[pivot_row][j]) / pivot_val

        data = new_data
        num_pivots += 1

        # Basis swap
        entering = nb_vars[pivot_col]
        leaving = basis[pivot_row]
        basis[pivot_row] = entering
        nb_vars[pivot_col] = leaving

        # Collect all values
        for row in data:
            for v in row:
                all_values.add(v)

    # Check for remaining negative b (infeasible)
    rhs_col = num_vars
    for i in range(1, sm + 1):
        if data[i][rhs_col] < -Fraction(1, 1000):
            return False, num_pivots, None, all_values

    # Check optimality (no negative Z-coeffs)
    for j in range(num_vars):
        if data[0][j] < -Fraction(1, 1000):
            return False, num_pivots, None, all_values

    # Get solution Z
    solution_z = data[0][rhs_col]
    if optimization == "minimieren":
        solution_z = -solution_z

    # Check if all values are nice
    all_nice = all(is_nice(v) for v in all_values)

    # Also require solution_z to be nice
    if not is_nice(solution_z):
        all_nice = False

    return all_nice, num_pivots, solution_z, all_values


def fraction_to_number(f):
    """Convert Fraction to int or float for JSON output."""
    if f.denominator == 1:
        return int(f)
    return float(f)


def generate_for_type(type_name, type_def, multiplier=3, num_vars=2):
    """Generate verified math sets for a given type with num_vars variables."""
    target = type_def["target_count"]
    if target == 0:
        return []

    coeff_ranges = type_def["coeff_ranges"]
    optimization = type_def["optimization"]
    constraint_patterns = type_def["constraint_patterns"]
    min_nc, max_nc = type_def["constraint_count"]

    # For multi-var, ensure at least num_vars constraints for a well-posed problem
    if num_vars > 2:
        min_nc = max(min_nc, num_vars)
        max_nc = max(max_nc, num_vars + 1)

    # Extract constraint type sequence
    base_constraint_types = [p["type"] for p in constraint_patterns]

    results = []
    attempts = 0
    # Higher-dimensional problems need more attempts (lower acceptance rate)
    attempt_factor = 100 * (3 ** max(0, num_vars - 2))
    max_attempts = target * multiplier * attempt_factor

    while len(results) < target * multiplier and attempts < max_attempts:
        nc = random.randint(min_nc, max_nc)
        # Build constraint types for this problem
        ct = []
        for i in range(nc):
            if i < len(base_constraint_types):
                ct.append(base_constraint_types[i])
            else:
                # Cycle through patterns
                ct.append(base_constraint_types[i % len(base_constraint_types)])

        c, A, b, constraint_types = generate_random_lp(nc, ct, coeff_ranges, num_vars=num_vars)
        nice, pivots, solution_z, _ = simplex_check_nice(c, A, b, constraint_types, optimization)

        if nice and solution_z is not None and pivots >= 1:
            results.append({
                "c": c,
                "A": A,
                "b": b,
                "constraint_types": constraint_types,
                "optimization": optimization,
                "solution_z": fraction_to_number(solution_z),
                "pivot_count": pivots,
                "num_vars": num_vars
            })

        attempts += 1

    return results


def main():
    parser = argparse.ArgumentParser(description="Generate verified LP math sets")
    parser.add_argument("--multivar", action="store_true", help="Generate multi-variable (3,4,5) problems")
    parser.add_argument("--type", type=str, help="Generate only for this type")
    args = parser.parse_args()

    registry_path = os.path.join(SCRIPT_DIR, "type_registry.json")
    output_dir = os.path.join(SCRIPT_DIR, "math_verified")
    os.makedirs(output_dir, exist_ok=True)

    with open(registry_path) as f:
        registry = json.load(f)

    total_generated = 0

    if args.multivar:
        # Generate multi-variable problems based on multivar_targets in registry
        for type_name, type_def in registry.items():
            multivar_targets = type_def.get("multivar_targets", {})
            if not multivar_targets:
                continue
            if args.type and type_name != args.type:
                continue

            for nv_str, target in multivar_targets.items():
                nv = int(nv_str)
                # Temporarily set target_count for generate_for_type
                mv_def = dict(type_def)
                mv_def["target_count"] = target
                print(f"\n--- {type_name} {nv}-var (target: {target}) ---")
                start = time.time()
                results = generate_for_type(type_name, mv_def, multiplier=3, num_vars=nv)
                elapsed = time.time() - start

                safe_name = type_name.lower().replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
                output_path = os.path.join(output_dir, f"multivar_{safe_name}_{nv}var.json")
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(results, f, indent=2, ensure_ascii=False)

                print(f"  Generated: {len(results)} verified sets in {elapsed:.1f}s")
                print(f"  Saved to: {output_path}")
                total_generated += len(results)
    else:
        # Original 2-variable generation
        for type_name, type_def in registry.items():
            target = type_def.get("target_count", 0)
            if target == 0:
                print(f"  Skipping {type_name} (no generation needed)")
                continue
            if args.type and type_name != args.type:
                continue

            print(f"\n--- {type_name} (target: {target}) ---")
            start = time.time()
            results = generate_for_type(type_name, type_def, multiplier=3)
            elapsed = time.time() - start

            output_path = os.path.join(output_dir, f"{type_name.lower()}.json")
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)

            print(f"  Generated: {len(results)} verified sets in {elapsed:.1f}s")
            print(f"  Saved to: {output_path}")
            total_generated += len(results)

    print(f"\n{'='*60}")
    print(f"Total: {total_generated} verified math sets generated")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
