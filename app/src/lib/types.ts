// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Felix Flösch

import type { Fraction } from './fraction';

export interface TableauSnapshot {
  data: Fraction[][];
  basis: string[];
  nbVars: string[];
  pivotRow: number;
  pivotCol: number;
  isOptimal: boolean;
  zLabel: string;
}

export interface EditableTableau {
  data: string[][];
  basis: string[];
  nbVars: string[];
  pivotRow: number;
  pivotCol: number;
  isOptimal: boolean;
  zLabel: string;
}

export interface GeneratorConfig {
  nVars: number;
  nConstraints: number;
  minTableaus: number;
  maxTableaus: number;
  niceNumbers: boolean;
  maxDenom: number;
}

export interface GeneratedProblem {
  c: number[];
  A: number[][];
  b: number[];
  isMax: boolean;
  solutionPath: TableauSnapshot[];
  hash: string;
}

export type AppMode = 'modellierung' | 'simplex';
