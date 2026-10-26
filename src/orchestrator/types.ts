import { AgentType, SessionView } from '../types';

export type OrchestratorMode = 'monitor' | 'conductor' | 'mesh';

export type AgentRole = 'architect' | 'backend' | 'frontend' | 'tester' | 'reviewer' | 'general';

export interface PipelineStep {
  id: string;
  title: string;
  agent: AgentType;
  role?: AgentRole;
  instruction: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  autoAdvance: boolean;
  sourceSessionId?: string;
  startedAt?: number;
  completedAt?: number;
  filesTouched?: string[];
  outputSummary?: string;
}

export interface PipelineRecipe {
  id: string;
  title: string;
  description: string;
  steps: Array<Omit<PipelineStep, 'id' | 'status' | 'startedAt' | 'completedAt'>>;
}

export interface Pipeline {
  id: string;
  recipeId?: string;
  title: string;
  description: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentStepIndex: number;
  steps: PipelineStep[];
  startedAt?: number;
  completedAt?: number;
}

export interface AgentMeshMessage {
  id: string;
  fromAgent: AgentType | string;
  toAgent: AgentType | string;
  type: 'task_delegation' | 'finding_broadcast' | 'question' | 'task_result';
  subject: string;
  content: string;
  contextFiles?: string[];
  timestamp: number;
  status: 'unread' | 'read' | 'in_progress' | 'completed';
}

export interface MeshState {
  version: number;
  lastUpdated: number;
  activeAgents: Array<{
    agent: AgentType;
    sessionId?: string;
    cwd?: string;
    status: 'idle' | 'busy' | 'offline';
    lastActive: number;
  }>;
  messages: AgentMeshMessage[];
}
