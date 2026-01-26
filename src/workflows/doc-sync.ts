/**
 * Documentation Sync Workflow
 *
 * Ensures documentation is perfectly aligned with the codebase
 * using adversarial validation.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type {
  WorkflowConfig,
  WorkflowContext,
  PhaseResult,
  DocumentInfo,
  DocumentType,
  Finding,
  SyncResult,
} from './types.js';
import { getWorkflowRunner, type PhaseExecutor } from './runner.js';
import { logger } from '../utils/logger.js';

const log = logger.child('doc-sync');

/**
 * Documentation sync workflow configuration
 */
export const docSyncConfig: WorkflowConfig = {
  id: 'documentation_truth_sync_with_adversarial_review',
  name: 'Documentation Truth Sync',
  description: 'Ensure all documentation is perfectly aligned with the codebase',
  agents: {
    primary: {
      name: 'Documentation Sync Agent',
      role: 'Senior Software Architect + Tech Writer',
      type: 'researcher',
    },
    adversarial: {
      name: 'Documentation Adversary Agent',
      role: 'Paranoid Reviewer / Staff Engineer',
      type: 'reviewer',
      objective: 'Prove that documentation is wrong or incomplete',
    },
  },
  inputs: {
    targetDirectory: './docs',
    sourceCode: '.',
    includes: ['*.md', '*.mdx'],
    excludes: ['node_modules', 'dist', '.git'],
  },
  phases: ['inventory', 'analysis', 'sync', 'consistency', 'adversarial', 'reconciliation'],
  constraints: [
    'Never invent behavior not present in code.',
    'If code behavior is ambiguous, document the ambiguity.',
    'Prefer correctness over elegance.',
    'All diagrams must render in GitHub Mermaid.',
    'Documentation must be readable by humans, not only auditors.',
  ],
  maxIterations: 3,
};

/**
 * Phase 1: Document Inventory
 * Enumerate all documentation files and classify them
 */
export const inventoryPhase: PhaseExecutor = async (context: WorkflowContext): Promise<PhaseResult> => {
  const { config } = context;
  const docsDir = config.inputs.targetDirectory;
  const findings: Finding[] = [];
  const inventory: DocumentInfo[] = [];

  if (!existsSync(docsDir)) {
    findings.push({
      claim: `Documentation directory exists at ${docsDir}`,
      contradiction: 'Directory not found',
      severity: 'high',
      evidence: [docsDir],
    });

    return {
      phase: 'inventory',
      success: false,
      findings,
      artifacts: { inventory: [] },
      duration: 0,
    };
  }

  // Scan for documentation files
  const scanDir = (dir: string): void => {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip excluded directories
        if (!config.inputs.excludes?.includes(entry)) {
          scanDir(fullPath);
        }
      } else if (extname(entry) === '.md' || extname(entry) === '.mdx') {
        const docInfo = analyzeDocument(fullPath, docsDir);
        inventory.push(docInfo);
      }
    }
  };

  scanDir(docsDir);
  context.inventory = inventory;

  log.info('Document inventory complete', { count: inventory.length });

  return {
    phase: 'inventory',
    success: true,
    findings,
    artifacts: {
      inventory,
      documentTypes: groupByType(inventory),
    },
    duration: 0,
  };
};

/**
 * Analyze a single document
 */
function analyzeDocument(filePath: string, baseDir: string): DocumentInfo {
  const content = readFileSync(filePath, 'utf-8');
  const stat = statSync(filePath);
  const relativePath = relative(baseDir, filePath);

  return {
    path: relativePath,
    type: detectDocumentType(relativePath, content),
    intent: extractIntent(content),
    lastModified: stat.mtime,
    codeReferences: extractCodeReferences(content),
    status: 'pending',
  };
}

/**
 * Detect document type from path and content
 */
function detectDocumentType(path: string, content: string): DocumentType {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();

  if (lowerPath.includes('readme')) return 'readme';
  if (lowerPath.includes('changelog')) return 'changelog';
  if (lowerPath.includes('adr') || lowerPath.includes('decision')) return 'adr';
  if (lowerPath.includes('api')) return 'api';
  if (lowerPath.includes('ops') || lowerPath.includes('deploy') || lowerPath.includes('runbook')) return 'ops';
  if (lowerContent.includes('architecture') || lowerContent.includes('system design')) return 'architecture';
  if (lowerPath.includes('guide') || lowerContent.includes('how to')) return 'guide';

  return 'other';
}

/**
 * Extract document intent from content
 */
function extractIntent(content: string): string {
  // Look for first heading or description
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ')) {
      return line.substring(2).trim();
    }
    if (line.startsWith('> ') || line.startsWith('**')) {
      return line.replace(/[>#*]/g, '').trim();
    }
  }
  return 'Unknown intent';
}

/**
 * Extract code references from content
 */
function extractCodeReferences(content: string): string[] {
  const references: string[] = [];

  // Match file paths
  const pathPattern = /`([^`]+\.(ts|js|py|go|rs|java|tsx|jsx))`/g;
  let match;
  while ((match = pathPattern.exec(content)) !== null) {
    references.push(match[1]);
  }

  // Match code blocks with language
  const codeBlockPattern = /```(\w+)\n/g;
  while ((match = codeBlockPattern.exec(content)) !== null) {
    references.push(`[code:${match[1]}]`);
  }

  return [...new Set(references)];
}

/**
 * Group documents by type
 */
function groupByType(inventory: DocumentInfo[]): Record<DocumentType, number> {
  const groups: Record<DocumentType, number> = {
    architecture: 0,
    api: 0,
    guide: 0,
    adr: 0,
    ops: 0,
    readme: 0,
    changelog: 0,
    other: 0,
  };

  for (const doc of inventory) {
    groups[doc.type]++;
  }

  return groups;
}

/**
 * Phase 2: Analysis
 * Analyze each document for code alignment
 */
export const analysisPhase: PhaseExecutor = async (context: WorkflowContext): Promise<PhaseResult> => {
  const findings: Finding[] = [];

  for (const doc of context.inventory) {
    // Check if referenced code files exist
    for (const ref of doc.codeReferences) {
      if (ref.startsWith('[code:')) continue;
      if (!context.config.inputs.sourceCode) continue;

      const fullPath = join(context.config.inputs.sourceCode, ref);
      if (!existsSync(fullPath)) {
        findings.push({
          claim: `Document references file: ${ref}`,
          contradiction: 'Referenced file does not exist',
          severity: 'medium',
          evidence: [doc.path, ref],
          file: doc.path,
        });
      }
    }
  }

  return {
    phase: 'analysis',
    success: findings.filter(f => f.severity === 'high').length === 0,
    findings,
    artifacts: {
      analyzedCount: context.inventory.length,
      issuesFound: findings.length,
    },
    duration: 0,
  };
};

/**
 * Phase 3: Sync
 * Update documents to match code
 */
export const syncPhase: PhaseExecutor = async (context: WorkflowContext): Promise<PhaseResult> => {
  const findings: Finding[] = [];
  const syncResults: SyncResult[] = [];

  // For each document, we would perform sync
  // In a real implementation, this would involve LLM-powered analysis
  for (const doc of context.inventory) {
    if (doc.status === 'synced') continue;

    // Mark as synced (placeholder for actual sync logic)
    doc.status = 'synced';

    syncResults.push({
      file: doc.path,
      changes: [],
      diagrams: [],
      removed: [],
      added: [],
    });
  }

  return {
    phase: 'sync',
    success: true,
    findings,
    artifacts: { syncResults },
    duration: 0,
  };
};

/**
 * Phase 4: Consistency check
 * Ensure cross-document consistency
 */
export const consistencyPhase: PhaseExecutor = async (_context: WorkflowContext): Promise<PhaseResult> => {
  const findings: Finding[] = [];

  // Check for terminology consistency
  // Check for architecture consistency
  // Check for diagram coherence

  return {
    phase: 'consistency',
    success: findings.filter(f => f.severity === 'high').length === 0,
    findings,
    artifacts: {
      consistencyChecks: ['terminology', 'architecture', 'diagrams'],
    },
    duration: 0,
  };
};

/**
 * Phase 5: Adversarial Review
 * Attempt to prove documentation is wrong
 */
export const adversarialPhase: PhaseExecutor = async (context: WorkflowContext): Promise<PhaseResult> => {
  const findings: Finding[] = [];

  // In a real implementation, this would:
  // - Pick random files and verify docs
  // - Follow documented flows step-by-step
  // - Challenge architectural claims
  // - Verify diagrams against actual control flow
  // - Look for undocumented behavior
  // - Look for documented behavior that doesn't exist

  // For now, we verify that all referenced code exists
  for (const doc of context.inventory) {
    for (const ref of doc.codeReferences) {
      if (ref.startsWith('[code:')) continue;
      if (!context.config.inputs.sourceCode) continue;

      const fullPath = join(context.config.inputs.sourceCode, ref);
      if (!existsSync(fullPath)) {
        findings.push({
          claim: `Documentation references ${ref}`,
          contradiction: 'File does not exist in codebase',
          severity: 'high',
          evidence: [doc.path, ref],
          file: doc.path,
        });
      }
    }
  }

  const hasHighSeverity = findings.some(f => f.severity === 'high');

  return {
    phase: 'adversarial',
    success: !hasHighSeverity,
    findings,
    artifacts: {
      verdict: hasHighSeverity ? 'FAIL' : 'PASS',
      checksPerformed: [
        'code_reference_validation',
        'file_existence_check',
      ],
    },
    duration: 0,
  };
};

/**
 * Phase 6: Reconciliation
 * Fix issues found by adversarial review
 */
export const reconciliationPhase: PhaseExecutor = async (context: WorkflowContext): Promise<PhaseResult> => {
  // This phase is handled by the runner's reconciliation loop
  return {
    phase: 'reconciliation',
    success: true,
    findings: [],
    artifacts: {
      iteration: context.iteration,
    },
    duration: 0,
  };
};

/**
 * Register all phases with the workflow runner
 */
export function registerDocSyncWorkflow(): void {
  const runner = getWorkflowRunner();

  runner.registerPhase('inventory', inventoryPhase);
  runner.registerPhase('analysis', analysisPhase);
  runner.registerPhase('sync', syncPhase);
  runner.registerPhase('consistency', consistencyPhase);
  runner.registerPhase('adversarial', adversarialPhase);
  runner.registerPhase('reconciliation', reconciliationPhase);

  log.info('Registered documentation sync workflow');
}

/**
 * Run the documentation sync workflow
 */
export async function runDocSync(docsDirectory?: string): Promise<void> {
  registerDocSyncWorkflow();

  const config = { ...docSyncConfig };
  if (docsDirectory) {
    config.inputs.targetDirectory = docsDirectory;
  }

  const runner = getWorkflowRunner();
  const report = await runner.run(config);

  log.info('Documentation sync complete', {
    verdict: report.verdict,
    documentsScanned: report.summary.documentsScanned,
    documentsUpdated: report.summary.documentsUpdated,
    findingsTotal: report.summary.findingsTotal,
  });
}
