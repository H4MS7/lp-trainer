# Nice Number Generation Strategy

## Problem
Simplex pivot operations can produce ugly numbers (7.1598...) when dividing by pivot elements. Exam-style problems should have "nice" intermediate values: integers or simple fractions (denominator ≤ 6 or ≤ 12).

## Solution: Generate-and-Test
No brute-forcing, no GPU needed. Simple random generation + exact arithmetic filtering.

## Tested Results

### 2-Variable Problems (nice_number_test.py)
- **Max denominator: 6** (allows 1/2, 1/3, 2/3, 1/4, 3/4, 1/5, 2/5, 3/5, 4/5, 1/6, 5/6)
- Coefficients: [1,15], RHS: [20,500], Objective: [1,50]
- 2 NB: 21% acceptance, 5600 problems/sec
- 3 NB: 16% acceptance, 4000 problems/sec
- 4 NB: 13.4% acceptance, 3400 problems/sec
- 5 NB: 13.1% acceptance, 2800 problems/sec
- **Valid problem space: ~10^17** — no repeats possible

### n-Variable Problems (nice_number_test_nvar.py)
Coefficients: [1,12], RHS: [20,300], Objective: [1,30]

#### Strict denominator ≤ 6 (any pivot count)
| Config | Accept % | Speed |
|--------|----------|-------|
| 2v, 2nb | 30.1% | 13,484/sec |
| 2v, 3nb | 22.7% | 10,596/sec |
| 3v, 5nb | 16.2% | 6,498/sec |
| 4v, 6nb | 13.8% | 5,124/sec |
| 5v, 8nb | 10.1% | 3,581/sec |
| 5v, 10nb | 9.1% | 3,274/sec |

#### Relaxed denominator ≤ 12 (any pivot count)
| Config | Accept % | Speed |
|--------|----------|-------|
| 3v, 5nb | 58.2% | 3,660/sec |
| 4v, 6nb | 46.0% | 2,539/sec |
| 5v, 8nb | 33.7% | 1,679/sec |
| 5v, 10nb | 32.7% | 1,391/sec |

#### Relaxed ≤ 12 + multi-pivot filter (exam difficulty)
| Config | ≥2 pivots | ≥3 pivots |
|--------|-----------|-----------|
| 3v, 5nb | 12.5% (405/sec) | 0.22% (9/sec) |
| 4v, 6nb | 13.2% (368/sec) | 0.41% (11/sec) |
| 5v, 8nb | 12.1% (208/sec) | 0.51% (9/sec) |
| 5v, 10nb | 11.0% (162/sec) | 0.41% (6/sec) |

**≥4 pivots is nearly impossible with random generation** (~0.01%). Would need structural tricks.

### Key Takeaway
For exam-level problems (5 vars, 8-10 NB, ≥2 pivots, denom ≤12): **100+ valid problems per second**. Even ≥3 pivots still yields 6-11/sec. Multi-variable nice-number generation is completely viable.

## Recommended Settings by Difficulty

| Difficulty | Vars | NB | Max Denom | Min Pivots | Accept Rate |
|-----------|------|----|-----------|------------|-------------|
| einfach | 2 | 2-3 | 6 | any | 22-30% |
| mittel | 2-3 | 3-5 | 6 | ≥2 | ~5-12% |
| schwer | 3-5 | 5-8 | 12 | ≥2 | ~12% |
| exam-level | 5 | 8-10 | 12 | ≥3 | ~0.4% |

## Architecture
1. Generate random integer coefficients for constraint matrix, RHS, objective
2. Run simplex with Python `Fraction` (exact arithmetic, zero floating-point error)
3. Check ALL intermediate tableau values: denominator ≤ MAX_DENOM
4. Accept only clean problems
5. Optionally filter for minimum pivot count (for difficulty)
6. Store the verified coefficient set (A, b, c) + full simplex solution path
7. Wrap prose around the verified numbers using templates or LLM

## Tuning Knobs
- `MAX_DENOM`: 6 (strict) or 12 (relaxed). Strict for easy/medium, relaxed for hard/exam.
- `coeff_range`: [1,12] works well. Larger = more variety but lower acceptance.
- `rhs_range`: [20,300]. Larger = more realistic numbers.
- `min_pivots`: ≥2 for medium difficulty, ≥3 for hard. Don't go higher than 3.
- `must_have_fractional`: Require non-integer intermediates (so it's not trivially easy).

## Integration Plan
1. Build a Python generator that outputs verified (A, b, c, simplex_path) tuples
2. The simplex_path includes all intermediate tableaux (for the app to verify against)
3. Prose generation becomes purely cosmetic — just dress up the numbers
4. Can generate infinite problems at runtime in the browser (port to JS with exact fractions)
5. OR precompute a huge pool and serve from static data

## Open Questions
- Port to JavaScript (for browser-side generation)? Python `Fraction` → JS BigInt-based?
- Or precompute N thousand problems server-side and embed?
- Integration with the prose template system (how to plug numbers into stories)
- App currently hardcoded for 2 variables — needs generalization for n-variable support

## Test Scripts
- `nice_number_test.py` — 2-variable acceptance rates
- `nice_number_test_nvar.py` — n-variable acceptance rates (2-5 vars)
