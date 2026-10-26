import { describe, expect, it } from 'vitest';
import { cleanAntigravityPrompt, parseAntigravityTranscript } from '../src/antigravityTranscript';

describe('cleanAntigravityPrompt', () => {
  it('extracts request inside USER_REQUEST tags and strips metadata', () => {
    const raw = `<USER_REQUEST>
Fix the Flutter authentication bug
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-26T14:57:14+07:00.
</ADDITIONAL_METADATA>
<USER_SETTINGS_CHANGE>
The user changed setting \`Model Selection\` from None to Gemini 3.8 Flash (Medium).
</USER_SETTINGS_CHANGE>`;
    expect(cleanAntigravityPrompt(raw)).toBe('Fix the Flutter authentication bug');
  });

  it('handles plain text prompts without XML tags', () => {
    expect(cleanAntigravityPrompt('Check repository status')).toBe('Check repository status');
  });
});

describe('parseAntigravityTranscript', () => {
  it('parses tokens, model, files touched, commands, and thinking', () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: `<USER_REQUEST>Add unit test for user service</USER_REQUEST>
<USER_SETTINGS_CHANGE>The user changed setting \`Model Selection\` from None to Gemini 3.8 Pro.</USER_SETTINGS_CHANGE>`,
      }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-26T07:10:00Z',
        input_tokens: 1500,
        cache_read_tokens: 3000,
        output_tokens: 250,
        thinking: 'I need to inspect the existing user test suite and add a new test case.',
        tool_calls: [
          {
            name: 'run_command',
            args: { CommandLine: '"npm test"', toolSummary: '"Run tests"' },
          },
          {
            name: 'write_file',
            args: { Path: '"/Users/apple/project/test/user.test.ts"', Content: 'test' },
          },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-26T07:11:00Z',
        input_tokens: 500,
        cache_read_tokens: 4500,
        output_tokens: 100,
        tool_calls: [
          {
            name: 'edit_file',
            args: { Path: '"/Users/apple/project/src/user.ts"', Target: 'a', Replacement: 'b' },
          },
        ],
      }),
    ].join('\n');

    const result = parseAntigravityTranscript(lines, 'sess-123');

    expect(result.firstUserPrompt).toBe('Add unit test for user service');
    expect(result.model).toBe('Gemini 3.8 Pro');
    expect(result.usage.totals.input).toBe(2000);
    expect(result.usage.totals.output).toBe(350);
    expect(result.usage.totals.cacheRead).toBe(7500);
    expect(result.usage.totals.messages).toBe(2);
    expect(result.contextTokens).toBe(5000); // 500 input + 4500 cacheRead on last step

    expect(result.filesTouched).toEqual([
      '/Users/apple/project/test/user.test.ts',
      '/Users/apple/project/src/user.ts',
    ]);
    expect(result.commandsRun).toEqual(['npm test']);
    expect(result.lastThinking).toBe('I need to inspect the existing user test suite and add a new test case.');
  });
});
