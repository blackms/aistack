/**
 * PR description template builder.
 *
 * The PR body is the single human-readable artefact the workflow produces, so
 * we want it to be self-contained: the original issue link, the plan the
 * coordinator built, the iteration log from the adversarial review loop, and
 * a pointer to the audit trail.
 */

import type { IssueDetails } from './providers.js';
import type { ReviewResult } from '../types.js';

export interface PrBodyInput {
  issue: IssueDetails;
  plan: string;
  reviews: ReviewResult[];
  finalCode?: string;
  auditUrl?: string;
  branch: string;
}

export function buildPrBody(input: PrBodyInput): string {
  const { issue, plan, reviews, auditUrl, branch } = input;
  const issueRef = `#${issue.number}`;

  const sections: string[] = [];

  sections.push(
    `## Summary`,
    ``,
    `Autonomous draft opened by **aistack** in response to issue ${issueRef}: [${issue.title}](${issue.htmlUrl}).`,
    ``,
    `Source branch: \`${branch}\``,
    ``
  );

  sections.push(`## Plan`, ``, plan.trim() || '_No plan produced_', ``);

  sections.push(`## Adversarial review`, ``);
  if (reviews.length === 0) {
    sections.push('_No review iterations recorded_', '');
  } else {
    reviews.forEach((r, idx) => {
      sections.push(
        `### Iteration ${idx + 1} — verdict: **${r.verdict}**`,
        ``,
        r.issues.length === 0
          ? '_No issues reported_'
          : r.issues
              .map(
                (i) =>
                  `- **[${i.severity}]** ${i.title}${i.requiredFix ? ` — fix: ${i.requiredFix}` : ''}`
              )
              .join('\n'),
        ``
      );
    });
  }

  sections.push(
    `## Audit trail`,
    ``,
    auditUrl
      ? `Full agent transcript and decision log: ${auditUrl}`
      : '_Audit trail not available in this run (set `github.auditUrlTemplate` to enable)._',
    ``
  );

  sections.push(
    `---`,
    ``,
    `_This PR was opened automatically by [aistack](https://github.com/blackms/aistack). Review carefully before merging._`
  );

  return sections.join('\n');
}
