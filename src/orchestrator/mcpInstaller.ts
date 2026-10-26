import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface McpInstallResult {
  claudeConfigPath: string;
  claudeUpdated: boolean;
  antigravityConfigPath: string;
  antigravityUpdated: boolean;
  serverScriptPath: string;
}

export function getMcpServerScriptPath(extensionRoot: string): string {
  return join(extensionRoot, 'bridge', 'agent-mesh-server.js');
}

export async function installMcpMeshConfig(extensionRoot: string): Promise<McpInstallResult> {
  const serverPath = getMcpServerScriptPath(extensionRoot);
  const home = homedir();

  const mcpServerEntry = {
    command: 'node',
    args: [serverPath],
  };

  let claudeUpdated = false;
  const claudeConfigPath = join(home, '.claude', 'config.json');
  try {
    let claudeCfg: any = {};
    if (existsSync(claudeConfigPath)) {
      try {
        claudeCfg = JSON.parse(await readFile(claudeConfigPath, 'utf8'));
      } catch {
        claudeCfg = {};
      }
    } else {
      await mkdir(join(home, '.claude'), { recursive: true });
    }

    if (!claudeCfg.mcpServers) claudeCfg.mcpServers = {};
    claudeCfg.mcpServers['agent-mesh'] = mcpServerEntry;
    await writeFile(claudeConfigPath, JSON.stringify(claudeCfg, null, 2), 'utf8');
    claudeUpdated = true;
  } catch {
    // Non-fatal
  }

  let antigravityUpdated = false;
  const antigravityConfigPath = join(home, '.gemini', 'antigravity-cli', 'mcp_servers.json');
  try {
    let agyCfg: any = {};
    if (existsSync(antigravityConfigPath)) {
      try {
        agyCfg = JSON.parse(await readFile(antigravityConfigPath, 'utf8'));
      } catch {
        agyCfg = {};
      }
    } else {
      await mkdir(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    }

    if (!agyCfg.mcpServers) agyCfg.mcpServers = {};
    agyCfg.mcpServers['agent-mesh'] = mcpServerEntry;
    await writeFile(antigravityConfigPath, JSON.stringify(agyCfg, null, 2), 'utf8');
    antigravityUpdated = true;
  } catch {
    // Non-fatal
  }

  return {
    claudeConfigPath,
    claudeUpdated,
    antigravityConfigPath,
    antigravityUpdated,
    serverScriptPath: serverPath,
  };
}
