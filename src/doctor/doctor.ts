import { messageOf, say } from '../cli.ts';
import { FACTORY_MCP } from '../paths.ts';
import type { McpScope } from './checks.ts';
import type { FixOutcome } from './fix.ts';
import { applyFix } from './fix.ts';
import type { ProjectMcp } from './project.ts';
import { applyProjectFix, findProjectMcp } from './project.ts';
import { formatClean, formatFixed, formatReport } from './report.ts';
import { scanMcpConfig } from './scan.ts';

export interface DoctorTargets {
  userMcp: string;
  project: ProjectMcp | undefined;
}

export function doctorTargets(projectDir: string): DoctorTargets {
  return { userMcp: FACTORY_MCP, project: findProjectMcp(projectDir, FACTORY_MCP) };
}

function reportFile(mcpPath: string, scope: McpScope): void {
  const found = scanMcpConfig(mcpPath, scope);
  say(found.length === 0 ? formatClean(mcpPath) : formatReport(found, mcpPath));
}

export function runDoctor(targets: DoctorTargets): void {
  reportFile(targets.userMcp, 'user');
  if (targets.project !== undefined) {
    reportFile(targets.project.file, 'project');
  }
}

function fixFile(mcpPath: string, fix: () => FixOutcome): string | undefined {
  try {
    const outcome = fix();
    say(outcome.fixed.length === 0 ? formatClean(mcpPath) : formatFixed(outcome, mcpPath));
    return undefined;
  } catch (error) {
    return messageOf(error);
  }
}

export function runDoctorFix(targets: DoctorTargets): void {
  const { userMcp, project } = targets;
  const failures = [
    fixFile(userMcp, () => applyFix(userMcp)),
    project === undefined ? undefined : fixFile(project.file, () => applyProjectFix(project)),
  ].filter((failure) => failure !== undefined);
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}
