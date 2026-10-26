import { AgentType, SessionView } from '../types';
import { Pipeline, PipelineRecipe, PipelineStep } from './types';

export const DEFAULT_RECIPES: PipelineRecipe[] = [
  {
    id: 'fullstack',
    title: 'Full-Stack Feature Pipeline',
    description: 'Claude builds backend API/models ➔ Antigravity integrates UI widgets ➔ Claude verifies tests.',
    steps: [
      {
        title: 'Backend API & Models',
        agent: 'claude',
        role: 'backend',
        instruction: 'Design and implement the core data models, business logic, and API endpoints for this task.',
        autoAdvance: true,
      },
      {
        title: 'UI & Frontend Integration',
        agent: 'antigravity',
        role: 'frontend',
        instruction: 'Consume the newly created backend models/APIs and build responsive UI components/views.',
        autoAdvance: false, // pause for user review before final verification
      },
      {
        title: 'Testing & Verification',
        agent: 'claude',
        role: 'tester',
        instruction: 'Run test suites, verify integration, and ensure no regression or lint errors remain.',
        autoAdvance: true,
      },
    ],
  },
  {
    id: 'review_loop',
    title: 'Peer Review & Audit Loop',
    description: 'Active agent writes feature ➔ Peer agent conducts security & architecture review.',
    steps: [
      {
        title: 'Feature Implementation',
        agent: 'antigravity',
        role: 'general',
        instruction: 'Implement the requested feature cleanly with documentation and unit tests.',
        autoAdvance: true,
      },
      {
        title: 'Independent Peer Review',
        agent: 'claude',
        role: 'reviewer',
        instruction: 'Thoroughly review modified files for edge cases, performance, security, and architectural fit.',
        autoAdvance: false,
      },
      {
        title: 'Refinement & Fixes',
        agent: 'antigravity',
        role: 'general',
        instruction: 'Address feedback from the peer review and verify final clean status.',
        autoAdvance: true,
      },
    ],
  },
];

export class ConductorEngine {
  private activePipeline?: Pipeline;
  private recipes: Map<string, PipelineRecipe> = new Map();

  constructor(customRecipes: PipelineRecipe[] = []) {
    for (const r of [...DEFAULT_RECIPES, ...customRecipes]) {
      this.recipes.set(r.id, r);
    }
  }

  getRecipes(): PipelineRecipe[] {
    return Array.from(this.recipes.values());
  }

  getActivePipeline(): Pipeline | undefined {
    return this.activePipeline;
  }

  createPipelineFromRecipe(recipeId: string, customTitle?: string): Pipeline | undefined {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return undefined;

    const pipeline: Pipeline = {
      id: `pipe-${Date.now().toString(36)}`,
      recipeId: recipe.id,
      title: customTitle || recipe.title,
      description: recipe.description,
      status: 'idle',
      currentStepIndex: 0,
      steps: recipe.steps.map((s, idx) => ({
        ...s,
        id: `step-${idx + 1}`,
        status: 'pending',
      })),
    };

    this.activePipeline = pipeline;
    return pipeline;
  }

  startActivePipeline(): PipelineStep | undefined {
    if (!this.activePipeline || this.activePipeline.steps.length === 0) return undefined;
    this.activePipeline.status = 'running';
    this.activePipeline.startedAt = Date.now();
    this.activePipeline.currentStepIndex = 0;

    const firstStep = this.activePipeline.steps[0];
    firstStep.status = 'running';
    firstStep.startedAt = Date.now();
    return firstStep;
  }

  getCurrentStep(): PipelineStep | undefined {
    if (!this.activePipeline) return undefined;
    return this.activePipeline.steps[this.activePipeline.currentStepIndex];
  }

  formatPromptForStep(step: PipelineStep, previousSteps: PipelineStep[]): string {
    const lines: string[] = [];
    lines.push(`🎼 [Orchestrator Conductor: ${step.title}]`);
    lines.push(`> Target Agent: **${step.agent === 'claude' ? 'Claude Code' : 'Antigravity'}**`);
    if (step.role) lines.push(`> Assigned Role: \`${step.role}\``);
    lines.push('');
    lines.push('### 🎯 Task Instructions');
    lines.push(step.instruction);
    lines.push('');

    // Attach artifacts or context from previous steps if available
    const completedWithFiles = previousSteps.filter(
      (s) => s.status === 'completed' && s.filesTouched && s.filesTouched.length > 0,
    );
    if (completedWithFiles.length > 0) {
      lines.push('### 📂 Context & Files from Previous Steps:');
      for (const prev of completedWithFiles) {
        lines.push(`- **${prev.title}** (${prev.agent}):`);
        for (const file of prev.filesTouched!.slice(0, 8)) {
          lines.push(`  - \`${file}\``);
        }
      }
      lines.push('');
    }

    lines.push('Please proceed with this assigned step. Notify or finish when complete.');
    return lines.join('\n');
  }

  advanceStep(outputSummary?: string, filesTouched?: string[]): { nextStep?: PipelineStep; finished: boolean } {
    if (!this.activePipeline) return { finished: true };
    const curIndex = this.activePipeline.currentStepIndex;
    const curStep = this.activePipeline.steps[curIndex];

    if (curStep) {
      curStep.status = 'completed';
      curStep.completedAt = Date.now();
      if (outputSummary) curStep.outputSummary = outputSummary;
      if (filesTouched && filesTouched.length > 0) curStep.filesTouched = filesTouched;
    }

    const nextIndex = curIndex + 1;
    if (nextIndex >= this.activePipeline.steps.length) {
      this.activePipeline.status = 'completed';
      this.activePipeline.completedAt = Date.now();
      return { finished: true };
    }

    this.activePipeline.currentStepIndex = nextIndex;
    const nextStep = this.activePipeline.steps[nextIndex];

    if (curStep?.autoAdvance) {
      nextStep.status = 'running';
      nextStep.startedAt = Date.now();
      this.activePipeline.status = 'running';
    } else {
      nextStep.status = 'paused'; // awaiting manual start/approval
      this.activePipeline.status = 'paused';
    }

    return { nextStep, finished: false };
  }

  pausePipeline(): void {
    if (this.activePipeline && this.activePipeline.status === 'running') {
      this.activePipeline.status = 'paused';
      const cur = this.getCurrentStep();
      if (cur && cur.status === 'running') cur.status = 'paused';
    }
  }

  resumePipeline(): PipelineStep | undefined {
    if (this.activePipeline && this.activePipeline.status === 'paused') {
      this.activePipeline.status = 'running';
      const cur = this.getCurrentStep();
      if (cur) {
        cur.status = 'running';
        if (!cur.startedAt) cur.startedAt = Date.now();
        return cur;
      }
    }
    return undefined;
  }

  cancelPipeline(): void {
    if (this.activePipeline) {
      this.activePipeline.status = 'failed';
      this.activePipeline = undefined;
    }
  }

  /**
   * Called on session updates: if current step's agent session was busy and is now idle,
   * step can be auto-advanced if autoAdvance is enabled.
   */
  checkSessionProgress(
    recentSessions: SessionView[],
  ): { readyToAdvance: boolean; step?: PipelineStep; files?: string[] } {
    const cur = this.getCurrentStep();
    if (!cur || cur.status !== 'running') return { readyToAdvance: false };

    // Find the latest session for the current step's agent
    const matching = recentSessions.filter((s) => (s.agent || 'claude') === cur.agent);
    if (matching.length === 0) return { readyToAdvance: false };

    const session = matching[0];
    const isIdle = !session.live || session.live.status === 'idle';
    const lastAt = Math.max(session.live?.updatedAt ?? 0, session.usage?.lastAt ?? 0);

    // If session has activity that finished after step started
    if (isIdle && cur.startedAt && lastAt > cur.startedAt) {
      return {
        readyToAdvance: true,
        step: cur,
        files: session.filesTouched,
      };
    }

    return { readyToAdvance: false };
  }
}
