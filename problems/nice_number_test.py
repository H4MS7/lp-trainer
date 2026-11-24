#!/usr/bin/env python3
"""
Test: What fraction of random 2-var LP problems produce "nice" simplex tableaux?

"Nice" = all intermediate values are integers or fractions p/q with q ≤ max_denom.
"""
import random
import time
from fractions import Fraction

MAX_DENOM = 6  # Denominators allowed: 1,2,3,4,5,6 (so 1/3, 2/5, 5/6 etc. are OK)

def is_nice(value: Fraction) -> bool:
    """Check if a fraction has denominator ≤ MAX_DENOM."""
    reduced = Fraction(value).limit_denominator(10**9)
    return reduced.denominator <= MAX_DENOM

def generate_random_lp(num_constraints, coeff_range=(1, 15), rhs_range=(20, 500), obj_range=(1, 50)):
    """Generate a random 2-variable LP with integer coefficients."""
    # Objective: max c1*x1 + c2*x2
    c = [random.randint(*obj_range), random.randint(*obj_range)]

    # Constraints: a_i1*x1 + a_i2*x2 <= b_i
    A = []
    b = []
    for _ in range(num_constraints):
        row = [random.randint(*coeff_range), random.randint(*coeff_range)]
        # RHS: make it a random multiple to increase chances of nice pivots
        rhs = random.randint(*rhs_range)
        A.append(row)
        b.append(rhs)

    return c, A, b

def simplex_check_nice(c, A, b):
    """
    Run simplex on max c'x s.t. Ax <= b, x >= 0.
    Return (is_all_nice, num_pivots, all_tableau_values).
    Uses Fraction arithmetic for exact computation.

    Tableau format (matching the app's Tucker/exchange tableau):
    - Row 0: Z-row with coefficients [-c1, -c2, 0] (for max)
    - Row i: constraint i with [a_i1, a_i2, b_i]
    - Basis: [Z, y1, y2, ...]
    - Non-basis: [x1, x2]
    """
    m = len(A)

    # Build initial tableau with Fractions
    # Columns: x1, x2, RHS (value)
    data = []
    # Z-row: -c1, -c2, 0 (for maximization)
    data.append([Fraction(-c[0]), Fraction(-c[1]), Fraction(0)])
    # Constraint rows
    for i in range(m):
        data.append([Fraction(A[i][0]), Fraction(A[i][1]), Fraction(b[i])])

    all_values = set()
    for row in data:
        for v in row:
            all_values.add(v)

    basis = ['Z'] + [f'y{i+1}' for i in range(m)]
    nb_vars = ['x1', 'x2']

    max_iters = 20
    num_pivots = 0

    for _ in range(max_iters):
        # Check for negative b-values (dual simplex needed)
        dual_needed = any(data[i][2] < 0 for i in range(1, m+1))

        if dual_needed:
            # Dual simplex: pick row with most negative b
            pivot_row = min(range(1, m+1), key=lambda i: data[i][2])
            if data[pivot_row][2] >= 0:
                break

            # Pick column: min ratio |Z-coeff / pivot-col-coeff| for negative entries
            pivot_col = -1
            min_ratio = float('inf')
            for j in range(2):
                if data[pivot_row][j] < 0:
                    ratio = abs(data[0][j] / data[pivot_row][j])
                    if ratio < min_ratio:
                        min_ratio = ratio
                        pivot_col = j
            if pivot_col < 0:
                return False, num_pivots, all_values  # Infeasible
        else:
            # Primal simplex: pick column with most negative Z-coeff
            pivot_col = -1
            min_z = Fraction(0)
            for j in range(2):
                if data[0][j] < min_z:
                    min_z = data[0][j]
                    pivot_col = j

            if pivot_col < 0:
                # Optimal! All Z-coeffs >= 0
                break

            # Pick row: minimum ratio b_i / a_ij for positive a_ij
            pivot_row = -1
            min_ratio = None
            for i in range(1, m+1):
                if data[i][pivot_col] > 0:
                    ratio = data[i][2] / data[i][pivot_col]
                    if ratio >= 0 and (min_ratio is None or ratio < min_ratio):
                        min_ratio = ratio
                        pivot_row = i

            if pivot_row < 0:
                return False, num_pivots, all_values  # Unbounded

        # Perform pivot (Tucker tableau exchange)
        pivot_val = data[pivot_row][pivot_col]
        if pivot_val == 0:
            return False, num_pivots, all_values

        rows = m + 1
        cols = 3
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

    # Check if all values are nice
    all_nice = all(is_nice(v) for v in all_values)
    return all_nice, num_pivots, all_values

def test_acceptance_rate(num_trials=10000, num_constraints=3):
    """Test what fraction of random LPs produce nice simplex."""
    nice_count = 0
    total_nice_values = set()
    pivot_counts = {}
    worst_denoms = []

    for _ in range(num_trials):
        c, A, b = generate_random_lp(num_constraints)
        is_nice_result, num_pivots, values = simplex_check_nice(c, A, b)

        if is_nice_result:
            nice_count += 1
            pivot_counts[num_pivots] = pivot_counts.get(num_pivots, 0) + 1
        else:
            # Track the worst denominator
            worst = max((v.denominator for v in values if isinstance(v, Fraction)), default=1)
            worst_denoms.append(worst)

    return nice_count, num_trials, pivot_counts, worst_denoms

def main():
    random.seed(42)

    print("=" * 60)
    print("NICE NUMBER ACCEPTANCE RATE TEST")
    print(f"Max allowed denominator: {MAX_DENOM}")
    print("=" * 60)

    for nc in [2, 3, 4, 5]:
        print(f"\n--- {nc} constraints, 10000 trials ---")
        start = time.time()
        nice, total, pivots, worst = test_acceptance_rate(10000, nc)
        elapsed = time.time() - start

        rate = nice / total * 100
        print(f"  Acceptance rate: {nice}/{total} = {rate:.1f}%")
        print(f"  Time: {elapsed:.2f}s ({total/elapsed:.0f} problems/sec)")
        print(f"  Pivot distribution: {pivots}")
        if worst:
            from collections import Counter
            top_denoms = Counter(worst).most_common(5)
            print(f"  Rejected worst denoms: {top_denoms}")

    # Now test: how many unique nice problems can we generate?
    print("\n" + "=" * 60)
    print("DIVERSITY TEST: Generate 1000 unique nice 3-constraint problems")
    print("=" * 60)

    unique_problems = set()
    attempts = 0
    while len(unique_problems) < 1000 and attempts < 100000:
        c, A, b = generate_random_lp(3)
        is_nice_result, _, _ = simplex_check_nice(c, A, b)
        if is_nice_result:
            # Hash by coefficients
            key = (tuple(c), tuple(tuple(row) for row in A), tuple(b))
            unique_problems.add(key)
        attempts += 1

    print(f"  Found {len(unique_problems)} unique nice problems in {attempts} attempts")
    print(f"  Unique/attempt ratio: {len(unique_problems)/attempts*100:.1f}%")

    # Estimate total space
    print("\n" + "=" * 60)
    print("SPACE ESTIMATE")
    print("=" * 60)
    coeff_range = 15  # 1-15
    rhs_range = 481   # 20-500
    obj_range = 50    # 1-50

    # For 3 constraints: coeffs^(3*2) * rhs^3 * obj^2
    total_space = (coeff_range ** 6) * (rhs_range ** 3) * (obj_range ** 2)
    print(f"  Total coefficient space (3 NB): ~{total_space:.2e}")
    print(f"  At ~15% acceptance: ~{total_space * 0.15:.2e} valid nice problems")
    print(f"  You could solve one per second for 1000 years and not repeat.")

if __name__ == '__main__':
    main()
