import { describe, expect, it } from 'vitest';
import { ConductorEngine, DEFAULT_RECIPES } from '../src/orchestrator/conductor';
import { SessionView } from '../src/types';

describe('ConductorEngine', () => {
  it('loads default recipes and creates a pipeline', () => {
    const conductor = new ConductorEngine();
    const recipes = conductor.getRecipes();

    expect(recipes.length).toBeGreaterThanOrEqual(2);
    expect(recipes[0].id).toBe('fullstack');

    const pipe = conductor.createPipelineFromRecipe('fullstack');
    expect(pipe).toBeDefined();
    expect(pipe!.steps).toHaveLength(3);
    expect(pipe!.status).toBe('idle');
    expect(pipe!.steps[0].agent).toBe('claude');
    expect(pipe!.steps[1].agent).toBe('antigravity');
  });

  it('starts pipeline and advances steps through to completion', () => {
    const conductor = new ConductorEngine();
    conductor.createPipelineFromRecipe('review_loop');

    const firstStep = conductor.startActivePipeline();
    expect(firstStep).toBeDefined();
    expect(firstStep!.status).toBe('running');
    expect(conductor.getActivePipeline()!.status).toBe('running');

    // Advance step 1
    const { nextStep: step2, finished: f1 } = conductor.advanceStep('Feature completed', ['src/feature.ts']);
    expect(f1).toBe(false);
    expect(step2).toBeDefined();
    expect(step2!.title).toBe('Independent Peer Review');

    // Advance step 2
    const { nextStep: step3, finished: f2 } = conductor.advanceStep('Review passed');
    expect(f2).toBe(false);
    expect(step3).toBeDefined();

    // Advance step 3 (last step)
    const { finished: f3 } = conductor.advanceStep('Refinements complete');
    expect(f3).toBe(true);
    expect(conductor.getActivePipeline()!.status).toBe('completed');
  });

  it('formats prompt with previous step files attached', () => {
    const conductor = new ConductorEngine();
    const pipe = conductor.createPipelineFromRecipe('fullstack')!;
    pipe.steps[0].status = 'completed';
    pipe.steps[0].filesTouched = ['/app/api.ts', '/app/models.ts'];

    const step2 = pipe.steps[1];
    const prompt = conductor.formatPromptForStep(step2, [pipe.steps[0]]);

    expect(prompt).toContain('🎼 [Orchestrator Conductor: UI & Frontend Integration]');
    expect(prompt).toContain('Target Agent: **Antigravity**');
    expect(prompt).toContain('- `/app/api.ts`');
    expect(prompt).toContain('- `/app/models.ts`');
  });

  it('detects when an agent session finishes work after step start', () => {
    const conductor = new ConductorEngine();
    conductor.createPipelineFromRecipe('fullstack');
    const step = conductor.startActivePipeline()!;

    const session: SessionView = {
      sessionId: 'sess-1',
      agent: 'claude',
      inWorkspace: true,
      live: {
        pid: 1234,
        sessionId: 'sess-1',
        cwd: '/ws',
        name: 'claude-1',
        status: 'idle',
        updatedAt: step.startedAt! + 10_000,
      },
      filesTouched: ['/ws/server.ts'],
    };

    const check = conductor.checkSessionProgress([session]);
    expect(check.readyToAdvance).toBe(true);
    expect(check.files).toEqual(['/ws/server.ts']);
  });
});
