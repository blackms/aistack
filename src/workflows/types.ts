/**
 * Workflow types and interfaces
 */

import type { AgentType } from '../types.js';

export type WorkflowPhase =
  | 'inventory'
  | 'analysis'
  | 'sync'
  | 'consistency'
  | 'adversarial'
  | 'reconciliation';

export type Severity = 'low' | 'medium' | 'high';
export type Verdict = 'PASS' | 'FAIL';

export interface WorkflowAgent {
  name: string;
  role: string;
  type: AgentType;
  objective?: string;
}

export interface Finding {
  claim: string;
  contradiction: string;
  severity: Severity;
  evidence: string[];
  file?: string;
  line?: number;
}

export interface PhaseResult {
  phase: WorkflowPhase;
  success: boolean;
  findings: Finding[];
  artifacts: Record<string, unknown>;
  duration: number;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  agents: {
    primary: WorkflowAgent;
    adversarial?: WorkflowAgent;
  };
  inputs: {
    targetDirectory: string;
    sourceCode: string;
    includes?: string[];
    excludes?: string[];
  };
  phases: WorkflowPhase[];
  constraints: string[];
  maxIterations?: number;
}

export interface WorkflowContext {
  config: WorkflowConfig;
  currentPhase: WorkflowPhase;
  iteration: number;
  results: PhaseResult[];
  inventory: DocumentInfo[];
  verdict?: Verdict;
  startedAt: Date;
}

export interface DocumentInfo {
  path: string;
  type: DocumentType;
  intent: string;
  lastModified: Date;
  codeReferences: string[];
  status: 'pending' | 'synced' | 'outdated' | 'error';
}

export type DocumentType =
  | 'architecture'
  | 'api'
  | 'guide'
  | 'adr'
  | 'ops'
  | 'readme'
  | 'changelog'
  | 'other';

export interface SyncResult {
  file: string;
  changes: DocumentChange[];
  diagrams: DiagramUpdate[];
  removed: string[];
  added: string[];
}

export interface DocumentChange {
  section: string;
  before: string;
  after: string;
  reason: string;
}

export interface DiagramUpdate {
  id: string;
  type: 'mermaid' | 'plantuml' | 'other';
  before: string;
  after: string;
}

export interface WorkflowReport {
  id: string;
  workflow: string;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  verdict: Verdict;
  phases: PhaseResult[];
  summary: {
    documentsScanned: number;
    documentsUpdated: number;
    sectionsRemoved: number;
    sectionsAdded: number;
    diagramsUpdated: number;
    findingsTotal: number;
    findingsBySeverity: Record<Severity, number>;
  };
  confidence: string;
}
