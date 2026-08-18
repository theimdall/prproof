import { COMMENT_MARKER } from '../core/render/markdown.js';
import { isForbidden, type ApiComment, type GitHubApi } from './api.js';

export type CommentAction = 'created' | 'updated' | 'unchanged' | 'forbidden';

export interface CommentResult {
  readonly action: CommentAction;
  readonly commentId: number | null;
  readonly message: string;
}

/**
 * Only bot-authored comments are considered PRProof's own.
 *
 * The hidden marker alone is not enough: a contributor could paste it into a
 * comment of their own, and PRProof would then keep overwriting a human's text.
 */
function isOwnReport(comment: ApiComment): boolean {
  if (!comment.body?.includes(COMMENT_MARKER)) return false;
  const user = comment.user;
  if (!user) return false;
  return user.type === 'Bot' || user.login.endsWith('[bot]');
}

/**
 * Posts or updates the single PRProof comment.
 *
 * Three behaviours make this quiet enough to leave switched on: one comment per
 * pull request, no API write when the body is byte-identical to what is already
 * there, and a graceful exit when the token cannot write — which is the normal
 * case for a pull request opened from a fork.
 */
export async function upsertReportComment(
  api: GitHubApi,
  pullNumber: number,
  body: string,
): Promise<CommentResult> {
  try {
    const comments = await api.listIssueComments(pullNumber);
    const existing = comments.find(isOwnReport);

    if (existing) {
      if (existing.body === body) {
        return { action: 'unchanged', commentId: existing.id, message: 'Report is already up to date.' };
      }
      await api.updateIssueComment(existing.id, body);
      return { action: 'updated', commentId: existing.id, message: 'Updated the existing PRProof comment.' };
    }

    await api.createIssueComment(pullNumber, body);
    return { action: 'created', commentId: null, message: 'Posted the PRProof report.' };
  } catch (error) {
    if (isForbidden(error)) {
      return {
        action: 'forbidden',
        commentId: null,
        message:
          'The token is not allowed to write comments. This is expected for pull requests from forks; ' +
          'see docs/fork-pull-requests.md for the reporting workflow that handles them.',
      };
    }
    throw error;
  }
}
