export const meta = {
  name: 'impl-wave',
  description: 'Implement → Mode (a) review → rework → narrow re-review, one pipeline per Issue. Stops at a verdict; never merges.',
  whenToUse:
    'An impl/review wave of ~4+ independent Issues with non-overlapping touch sets, each with a written brief and a prepared worktree. The lead prepares briefs/worktrees and runs the PR tails (ds-lander) afterwards.',
  phases: [
    { title: 'Implement', detail: 'ds-implementer per Issue, worktree-isolated, opens the PR', model: 'opus' },
    { title: 'Review', detail: 'ds-reviewer Mode (a) verdict pinned to the PR head', model: 'opus' },
    { title: 'Rework', detail: 'only on REQUEST_CHANGES — the implementer addresses the findings', model: 'opus' },
    { title: 'Re-review', detail: 'narrow delta re-review of the prior findings', model: 'opus' },
  ],
}

const SKILL = 'apps/docs/content/skills/request-mode-a-review/SKILL.md'

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    pr: { type: 'number', description: 'PR number opened for this Issue, 0 if none was opened' },
    headSha: { type: 'string' },
    branch: { type: 'string' },
    notes: { type: 'string', description: 'Blockers or deviations, one line each; empty when none' },
  },
  required: ['pr', 'headSha', 'branch'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'BLOCKED'] },
    reviewUrl: { type: 'string' },
    headSha: { type: 'string', description: 'PR head the verdict is pinned to' },
    findings: { type: 'array', description: 'Finding lines verbatim as posted', items: { type: 'string' } },
  },
  required: ['verdict', 'reviewUrl', 'headSha', 'findings'],
}

const given = Array.isArray(args) ? args : []
const items = given.filter((i) => i && i.issue && i.briefPath && i.worktree)
if (items.length !== given.length) log(`impl-wave: dropped ${given.length - items.length} item(s) missing issue/briefPath/worktree.`)
log(`impl-wave over ${items.length} Issue(s): ${items.map((i) => `#${i.issue}`).join(' ')}`)

const spec = (it) => (it.specPath ? `Feature spec: ${it.specPath} — read only the anchors the brief names.` : 'No feature spec — engineering-task PR (AGENTS.md §3.8).')
const bullets = (fs) => fs.map((f) => `- ${f}`).join('\n')

const implPrompt = (it) => `IMPL dispatch for Issue #${it.issue}. Read the brief FIRST, whole: ${it.briefPath}
Follow it exactly. Worktree (already prepared — do NOT create one): ${it.worktree}
${spec(it)}
Open ONE PR with \`gh pr create --body-file <scratchpad file>\`. Do NOT post a Mode (a) verdict and do NOT merge.
Return the PR number, the PR head SHA, and the branch.`

const reviewPrompt = (it, r) => `Mode (a) review of PR #${r.pr} (Issue #${it.issue}).
Follow the review skill in full: ${SKILL}
${spec(it)}
Worktree for reference (do NOT edit anything): ${it.worktree}
Post the structured \`## Mode (a) Review\` comment against the CURRENT head, then return the verdict, the comment URL, the head SHA you reviewed, and the findings verbatim.`

const reworkPrompt = (it, r, rev) => `Rework dispatch for PR #${r.pr} (Issue #${it.issue}) after REQUEST_CHANGES.
Brief: ${it.briefPath} · worktree: ${it.worktree} · review comment: ${rev.reviewUrl}
Address EVERY finding below and do not widen the diff beyond what they require:
${bullets(rev.findings)}
Push to the same branch. Do NOT post a verdict and do NOT merge. Return the new PR head SHA.`

const reReviewPrompt = (it, r, rev, newHead) => `Re-review (rework verification) of PR #${r.pr} (Issue #${it.issue}).
Follow the "Re-review (rework verification)" section of ${SKILL} — the full two-pass review is NOT repeated.
Commit range to verify: ${rev.headSha}..${newHead}
Prior review comment: ${rev.reviewUrl}
Prior findings, verbatim:
${bullets(rev.findings)}
Post a FRESH \`## Mode (a) Review\` comment with a new VERDICT line pinned to the current head.`

const row = (it, pr, headSha, verdict, reviewUrl) => ({ issue: it.issue, pr, headSha, verdict, reviewUrl })

const results = await pipeline(
  items,
  (it) => agent(implPrompt(it), { label: `impl #${it.issue}`, phase: 'Implement', model: 'opus', agentType: 'ds-implementer', schema: IMPL_SCHEMA }),
  async (r, it) => {
    if (!r || !r.pr) return row(it, 0, '', 'BLOCKED', '')
    const rev = await agent(reviewPrompt(it, r), { label: `review #${it.issue}`, phase: 'Review', model: 'opus', agentType: 'ds-reviewer', schema: REVIEW_SCHEMA })
    if (!rev) return row(it, r.pr, r.headSha, 'BLOCKED', '')
    if (rev.verdict !== 'REQUEST_CHANGES') return row(it, r.pr, rev.headSha, rev.verdict, rev.reviewUrl)

    log(`#${it.issue}: REQUEST_CHANGES (${rev.findings.length} findings) — reworking`)
    const fix = await agent(reworkPrompt(it, r, rev), { label: `rework #${it.issue}`, phase: 'Rework', model: 'opus', agentType: 'ds-implementer', schema: IMPL_SCHEMA })
    if (!fix) return row(it, r.pr, rev.headSha, 'BLOCKED', rev.reviewUrl)

    const re = await agent(reReviewPrompt(it, r, rev, fix.headSha), { label: `re-review #${it.issue}`, phase: 'Re-review', model: 'opus', agentType: 'ds-reviewer', schema: REVIEW_SCHEMA })
    if (!re) return row(it, r.pr, fix.headSha, 'BLOCKED', rev.reviewUrl)
    return row(it, r.pr, re.headSha, re.verdict, re.reviewUrl)
  },
)

const out = results.filter(Boolean)
log(`impl-wave done — ${out.filter((r) => r.verdict === 'APPROVE').length}/${out.length} APPROVE. PR tails (pr:land via ds-lander) stay with the lead, from the main tree.`)
return out
