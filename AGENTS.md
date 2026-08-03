# satisfactory-control-center

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `IAmMonkeyBoy/satisfactory-control-center`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each using its default label string. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## Implementation workflow

When picking up a work item (a build ticket / GitHub issue), follow this branch-and-PR flow:

1. **Start clean on `main`.** Before creating a branch, make sure the checkout is on `main` with no uncommitted changes (`git switch main`, `git status` clean, pull latest). Never start work on top of a dirty tree or another item's branch.
2. **Create a branch for the work item.** One branch per work item, named for it (e.g. `build/01-scaffold-shared-contract`). Do the implementation there and commit.
3. **On completion, open a PR and mark it ready for review.** Once the item is agreed complete, push the branch and open a pull request that is *ready for review* (not a draft).
4. **Link the work item to the PR.** The PR body must reference the originating issue with a closing keyword (`Closes #13`) so the item and the PR are linked and the issue auto-closes on merge.
