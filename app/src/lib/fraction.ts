// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint) {
    if (den === 0n) throw new Error('Division by zero');
    // Keep denominator positive
    if (den < 0n) { num = -num; den = -den; }
    const g = gcd(num < 0n ? -num : num, den);
    this.num = num / g;
    this.den = den / g;
  }

  static of(num: bigint, den: bigint = 1n): Fraction {
    return new Fraction(num, den);
  }

  static ZERO = new Fraction(0n, 1n);
  static ONE = new Fraction(1n, 1n);
  static MINUS_ONE = new Fraction(-1n, 1n);

  static fromNumber(n: number): Fraction {
    if (Number.isInteger(n)) return new Fraction(BigInt(n), 1n);
    // Convert via string to avoid floating-point issues
    const s = n.toString();
    const dot = s.indexOf('.');
    if (dot < 0) return new Fraction(BigInt(n), 1n);
    const decimals = s.length - dot - 1;
    const scale = 10n ** BigInt(decimals);
    const num = BigInt(s.replace('.', ''));
    return new Fraction(num, scale);
  }

  static fromString(s: string): Fraction {
    s = s.trim();
    if (!s) return Fraction.ZERO;

    // Handle sign
    let negative = false;
    if (s.startsWith('-')) { negative = true; s = s.substring(1).trim(); }
    else if (s.startsWith('+')) { s = s.substring(1).trim(); }

    let result: Fraction;

    if (s.includes('/')) {
      // Fraction notation: "3/4"
      const parts = s.split('/');
      const num = BigInt(parts[0].trim());
      const den = BigInt(parts[1].trim());
      result = new Fraction(num, den);
    } else {
      // Decimal: handle both "3.5" and "3,5" (German)
      const normalized = s.replace(',', '.');
      if (normalized.includes('.')) {
        const parts = normalized.split('.');
        const intPart = parts[0] || '0';
        const fracPart = parts[1] || '0';
        const scale = 10n ** BigInt(fracPart.length);
        const num = BigInt(intPart) * scale + BigInt(fracPart);
        result = new Fraction(num, scale);
      } else {
        result = new Fraction(BigInt(s), 1n);
      }
    }

    return negative ? result.neg() : result;
  }

  add(other: Fraction): Fraction {
    return new Fraction(
      this.num * other.den + other.num * this.den,
      this.den * other.den
    );
  }

  sub(other: Fraction): Fraction {
    return new Fraction(
      this.num * other.den - other.num * this.den,
      this.den * other.den
    );
  }

  mul(other: Fraction): Fraction {
    return new Fraction(this.num * other.num, this.den * other.den);
  }

  div(other: Fraction): Fraction {
    if (other.num === 0n) throw new Error('Division by zero');
    return new Fraction(this.num * other.den, this.den * other.num);
  }

  neg(): Fraction {
    return new Fraction(-this.num, this.den);
  }

  abs(): Fraction {
    return this.num < 0n ? this.neg() : this;
  }

  inv(): Fraction {
    if (this.num === 0n) throw new Error('Cannot invert zero');
    return new Fraction(this.den, this.num);
  }

  compareTo(other: Fraction): number {
    const diff = this.num * other.den - other.num * this.den;
    if (diff < 0n) return -1;
    if (diff > 0n) return 1;
    return 0;
  }

  equals(other: Fraction): boolean { return this.compareTo(other) === 0; }
  lt(other: Fraction): boolean { return this.compareTo(other) < 0; }
  gt(other: Fraction): boolean { return this.compareTo(other) > 0; }
  leq(other: Fraction): boolean { return this.compareTo(other) <= 0; }
  geq(other: Fraction): boolean { return this.compareTo(other) >= 0; }

  isZero(): boolean { return this.num === 0n; }
  isPositive(): boolean { return this.num > 0n; }
  isNegative(): boolean { return this.num < 0n; }
  isInteger(): boolean { return this.den === 1n; }

  toString(): string {
    if (this.den === 1n) return this.num.toString();
    return `${this.num}/${this.den}`;
  }

  toDecimal(maxDecimals: number = 4): string {
    if (this.den === 1n) return this.num.toString();
    const sign = this.num < 0n ? '-' : '';
    const absNum = this.num < 0n ? -this.num : this.num;
    const intPart = absNum / this.den;
    let remainder = absNum % this.den;
    if (remainder === 0n) return `${sign}${intPart}`;
    let fracStr = '';
    for (let i = 0; i < maxDecimals; i++) {
      remainder *= 10n;
      fracStr += (remainder / this.den).toString();
      remainder = remainder % this.den;
      if (remainder === 0n) break;
    }
    return `${sign}${intPart}.${fracStr}`;
  }

  // Display for UI: use German decimal comma for display
  toDisplayString(): string {
    if (this.den === 1n) return this.num.toString();
    // Try to show as finite decimal
    let testDen = this.den;
    while (testDen % 2n === 0n) testDen /= 2n;
    while (testDen % 5n === 0n) testDen /= 5n;
    if (testDen === 1n) {
      // Finite decimal: show it exactly (never truncated, so the displayed value
      // can be typed back in or re-parsed without changing it). Very long
      // decimals (> 6 places) read better as a fraction.
      const exact = this.toDecimal(64);
      if ((exact.split('.')[1]?.length ?? 0) <= 6) return exact.replace('.', ',');
    }
    // Show as fraction
    return this.toString();
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }
}
