/**
 * Full-Stack Feature Pipeline Workflow
 *
 * Complete end-to-end workflow for building a full-stack feature:
 * Requirements → Architecture → Research → Code → Test → Review → Documentation
 */

import type {
  WorkflowConfig,
  WorkflowContext,
  PhaseResult,
  Finding,
} from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('full-stack-feature');

export type FeaturePhase =
  | 'requirements'
  | 'architecture'
  | 'research'
  | 'backend'
  | 'frontend'
  | 'testing'
  | 'review'
  | 'documentation';

export interface FeatureWorkflowConfig extends Omit<WorkflowConfig, 'phases'> {
  phases: FeaturePhase[];
  inputs: {
    featureDescription: string;
    requirements: string[];
    targetDirectory: string;
    techStack?: {
      backend?: string[];
      frontend?: string[];
      database?: string;
    };
  };
}

/**
 * Full-Stack Feature Pipeline configuration
 */
export const fullStackFeatureConfig: FeatureWorkflowConfig = {
  id: 'full_stack_feature_pipeline',
  name: 'Full-Stack Feature Pipeline',
  description: 'End-to-end workflow for implementing a complete full-stack feature',
  agents: {
    primary: {
      name: 'Feature Coordinator',
      role: 'Senior Full-Stack Engineer',
      type: 'coordinator',
    },
    adversarial: {
      name: 'Quality Assurance Engineer',
      role: 'Staff QA Engineer',
      type: 'reviewer',
      objective: 'Ensure feature meets all requirements and quality standards',
    },
  },
  inputs: {
    featureDescription: '',
    requirements: [],
    targetDirectory: '.',
  },
  phases: [
    'requirements',
    'architecture',
    'research',
    'backend',
    'frontend',
    'testing',
    'review',
    'documentation',
  ],
  constraints: [
    'All code must be tested',
    'API must be documented',
    'UI must be responsive',
    'Security best practices must be followed',
    'Code must pass review before completion',
  ],
  maxIterations: 2,
};

/**
 * Phase 1: Requirements Analysis
 * Analyze and clarify feature requirements
 */
export const requirementsPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing requirements analysis phase');

  // Validate requirements completeness
  const config = context.config as FeatureWorkflowConfig;
  if (!config.inputs.featureDescription) {
    findings.push({
      claim: 'Feature description is provided',
      contradiction: 'Feature description is empty',
      severity: 'high',
      evidence: [],
    });
  }

  if (config.inputs.requirements.length === 0) {
    findings.push({
      claim: 'Requirements are specified',
      contradiction: 'No requirements provided',
      severity: 'medium',
      evidence: [],
    });
  }

  const artifacts = {
    requirements: config.inputs.requirements,
    description: config.inputs.featureDescription,
    analyzed: true,
  };

  return {
    phase: 'requirements',
    success: findings.filter(f => f.severity === 'high').length === 0,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 2: Architecture Design
 * Design system architecture and data models
 */
export const architecturePhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing architecture design phase');

  const config = context.config as FeatureWorkflowConfig;
  const artifacts = {
    components: [] as string[],
    dataModels: [] as string[],
    apiEndpoints: [] as string[],
    techStack: config.inputs.techStack || {},
  };

  // Basic architecture validation
  if (!config.inputs.techStack) {
    findings.push({
      claim: 'Technology stack is defined',
      contradiction: 'No tech stack specified',
      severity: 'medium',
      evidence: [],
    });
  }

  return {
    phase: 'architecture',
    success: true,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 3: Research
 * Research best practices, libraries, and patterns
 */
export const researchPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing research phase');

  const artifacts = {
    libraries: [] as string[],
    patterns: [] as string[],
    references: [] as string[],
  };

  return {
    phase: 'research',
    success: true,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 4: Backend Implementation
 * Implement backend API, services, and database
 */
export const backendPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing backend implementation phase');

  const artifacts = {
    filesCreated: [] as string[],
    filesModified: [] as string[],
    apiEndpoints: [] as string[],
  };

  return {
    phase: 'backend',
    success: true,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 5: Frontend Implementation
 * Implement UI components and frontend logic
 */
export const frontendPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing frontend implementation phase');

  const artifacts = {
    components: [] as string[],
    pages: [] as string[],
    filesCreated: [] as string[],
  };

  return {
    phase: 'frontend',
    success: true,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 6: Testing
 * Write and run tests for the feature
 */
export const testingPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing testing phase');

  const artifacts = {
    unitTests: [] as string[],
    integrationTests: [] as string[],
    e2eTests: [] as string[],
    coverage: 0,
  };

  // Validate test coverage
  if (artifacts.coverage < 80) {
    findings.push({
      claim: 'Test coverage is above 80%',
      contradiction: `Test coverage is ${artifacts.coverage}%`,
      severity: 'medium',
      evidence: [],
    });
  }

  return {
    phase: 'testing',
    success: true,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 7: Code Review
 * Review code quality, security, and best practices
 */
export const reviewPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing code review phase');

  const artifacts = {
    issuesFound: [] as string[],
    securityIssues: [] as string[],
    approved: false,
  };

  return {
    phase: 'review',
    success: artifacts.issuesFound.length === 0,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase 8: Documentation
 * Create documentation for the feature
 */
export const documentationPhase = async (context: WorkflowContext): Promise<PhaseResult> => {
  const startTime = Date.now();
  const findings: Finding[] = [];

  log.info('Executing documentation phase');

  const artifacts = {
    apiDocs: [] as string[],
    userGuide: '',
    changelog: '',
  };

  return {
    phase: 'documentation',
    success: true,
    findings,
    artifacts,
    duration: Date.now() - startTime,
  };
};

/**
 * Phase executors mapped to phase names
 */
export const phaseExecutors: Record<FeaturePhase, (context: WorkflowContext) => Promise<PhaseResult>> = {
  requirements: requirementsPhase,
  architecture: architecturePhase,
  research: researchPhase,
  backend: backendPhase,
  frontend: frontendPhase,
  testing: testingPhase,
  review: reviewPhase,
  documentation: documentationPhase,
};
