#!/usr/bin/env python3
"""
Test nice-number acceptance rates for n-variable LP problems.
n = 2, 3, 4, 5 variables with proportionally more constraints.
"""
import random
import time
from fractions import Fraction

MAX_DENOM = 6

def is_nice(value: Fraction, max_d=None) -> bool:
    if max_d is None:
        max_d = MAX_DENOM
    reduced = Fraction(value).limit_denominator(10**9)
    return reduced.denominator <= max_d

def generate_random_lp(n_vars, n_constraints, coeff_range=(1, 12), rhs_range=(20, 300), obj_range=(1, 30)):
    """Generate a random n-variable LP with integer coefficients."""
    c = [random.randint(*obj_range) for _ in range(n_vars)]
    A = []
    b = []
    for _ in range(n_constraints):
        row = [random.randint(*coeff_range) for _ in range(n_vars)]
        rhs = random.randint(*rhs_range)
        A.append(row)
        b.append(rhs)
    return c, A, b

def simplex_check_nice(c, A, b):
    """
    Run simplex on max c'x s.t. Ax <= b, x >= 0 with n variables.
    Return (is_all_nice, num_pivots, worst_denom).
    Uses Tucker tableau exchange (same as app).
    """
    n = len(c)  # number of variables
    m = len(A)  # number of constraints

    # Build initial tableau
    # Columns: x1, x2, ..., xn, RHS
    cols = n + 1  # n variables + RHS column
    rows = m + 1  # Z-row + m constraints

    data = [[Fraction(0)] * cols for _ in range(rows)]

    # Z-row: -c1, -c2, ..., -cn, 0
    for j in range(n):
        data[0][j] = Fraction(-c[j])
    data[0][n] = Fraction(0)

    # Constraint rows
    for i in range(m):
        for j in range(n):
            data[i+1][j] = Fraction(A[i][j])
        data[i+1][n] = Fraction(b[i])

    worst_denom = 1
    basis = ['Z'] + [f'y{i+1}' for i in range(m)]
    nb_vars = [f'x{j+1}' for j in range(n)]

    max_iters = 50
    num_pivots = 0

    for _ in range(max_iters):
        # Check for negative b-values (dual simplex)
        dual_needed = any(data[i][n] < 0 for i in range(1, m+1))

        if dual_needed:
            pivot_row = min(range(1, m+1), key=lambda i: data[i][n])
            if data[pivot_row][n] >= 0:
                break

            pivot_col = -1
            min_ratio = None
            for j in range(n):
                if data[pivot_row][j] < 0:
                    ratio = abs(data[0][j] / data[pivot_row][j])
                    if min_ratio is None or ratio < min_ratio:
                        min_ratio = ratio
                        pivot_col = j
            if pivot_col < 0:
                return False, num_pivots, worst_denom
        else:
            # Primal simplex: most negative Z-coefficient
            pivot_col = -1
            min_z = Fraction(0)
            for j in range(n):
                if data[0][j] < min_z:
                    min_z = data[0][j]
                    pivot_col = j

            if pivot_col < 0:
                break  # Optimal

            # Minimum ratio test
            pivot_row = -1
            min_ratio = None
            for i in range(1, m+1):
                if data[i][pivot_col] > 0:
                    ratio = data[i][n] / data[i][pivot_col]
                    if ratio >= 0 and (min_ratio is None or ratio < min_ratio):
                        min_ratio = ratio
                        pivot_row = i

            if pivot_row < 0:
                return False, num_pivots, worst_denom

        # Pivot
        pivot_val = data[pivot_row][pivot_col]
        if pivot_val == 0:
            return False, num_pivots, worst_denom

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

                # Track worst denominator
                d = abs(new_data[i][j].denominator)
                if d > worst_denom:
                    worst_denom = d
                    if d > MAX_DENOM:
                        return False, num_pivots + 1, worst_denom

        data = new_data
        num_pivots += 1

        # Basis swap
        entering = nb_vars[pivot_col]
        leaving = basis[pivot_row]
        basis[pivot_row] = entering
        nb_vars[pivot_col] = leaving

    all_nice = worst_denom <= MAX_DENOM
    return all_nice, num_pivots, worst_denom

def test(n_vars, n_constraints, trials=10000):
    nice = 0
    pivot_hist = {}
    t0 = time.time()

    for _ in range(trials):
        c, A, b = generate_random_lp(n_vars, n_constraints)
        ok, pivots, _ = simplex_check_nice(c, A, b)
        if ok:
            nice += 1
            pivot_hist[pivots] = pivot_hist.get(pivots, 0) + 1

    elapsed = time.time() - t0
    rate = nice / trials * 100
    speed = trials / elapsed

    print(f"  {n_vars} vars, {n_constraints} NB: {rate:5.1f}% accept | {speed:,.0f}/sec | pivots: {dict(sorted(pivot_hist.items()))}")
    return rate

def main():
    global MAX_DENOM
    random.seed(42)
    print("=" * 80)
    print("NICE NUMBER TEST: n-variable LP problems")
    print(f"Max denominator: {MAX_DENOM}, coeffs [1,12], RHS [20,300], obj [1,30]")
    print("=" * 80)

    configs = [
        # (n_vars, n_constraints, description)
        (2, 2, "2 vars, 2 NB (trivial)"),
        (2, 3, "2 vars, 3 NB (current easy)"),
        (2, 4, "2 vars, 4 NB (current hard)"),
        (3, 3, "3 vars, 3 NB"),
        (3, 4, "3 vars, 4 NB"),
        (3, 5, "3 vars, 5 NB"),
        (3, 6, "3 vars, 6 NB"),
        (4, 4, "4 vars, 4 NB"),
        (4, 5, "4 vars, 5 NB"),
        (4, 6, "4 vars, 6 NB"),
        (4, 7, "4 vars, 7 NB"),
        (5, 5, "5 vars, 5 NB"),
        (5, 6, "5 vars, 6 NB"),
        (5, 7, "5 vars, 7 NB"),
        (5, 8, "5 vars, 8 NB"),
        (5, 10, "5 vars, 10 NB (exam-level)"),
    ]

    print()
    for n_vars, n_constraints, desc in configs:
        test(n_vars, n_constraints, trials=5000)

    # Now test with relaxed denominator (MAX_DENOM = 12)
    print()
    print("=" * 80)
    print("RELAXED: Max denominator = 12")
    print("=" * 80)
    MAX_DENOM = 12
    print()
    for n_vars, n_constraints, desc in [(3, 5, ""), (4, 6, ""), (5, 8, ""), (5, 10, "")]:
        test(n_vars, n_constraints, trials=5000)

    # Multi-pivot filter: only accept problems needing >= 3 pivots
    print()
    print("=" * 80)
    print("MULTI-PIVOT FILTER: only problems needing >= 3 pivots (harder simplex)")
    print("Max denominator = 6")
    print("=" * 80)
    MAX_DENOM = 6
    print()
    for n_vars, n_constraints in [(3, 5), (4, 6), (5, 8)]:
        nice = 0
        t0 = time.time()
        trials = 10000
        for _ in range(trials):
            c, A, b = generate_random_lp(n_vars, n_constraints)
            ok, pivots, _ = simplex_check_nice(c, A, b)
            if ok and pivots >= 3:
                nice += 1
        elapsed = time.time() - t0
        print(f"  {n_vars} vars, {n_constraints} NB, >=3 pivots: {nice/trials*100:.2f}% accept | {trials/elapsed:,.0f}/sec")

if __name__ == '__main__':
    main()
