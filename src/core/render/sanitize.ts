/**
 * Text that reaches a pull request comment can come from an untrusted source:
 * a fork's branch name, a pull request title, a dependency name read out of a
 * diff. None of it is allowed to change the shape of the report.
 *
 * The rules applied here are narrow on purpose. GitHub already sanitises HTML
 * in comments; what it does not do is stop text from impersonating PRProof's
 * own marker, breaking a markdown table, or turning a diff into a wave of
 * notifications.
 */

/** GitHub rejects comments above 65 536 characters. Stay well under it. */
export const MAX_COMMENT_LENGTH = 60_000;

const ZERO_WIDTH = '\u200B';

/**
 * Removes HTML comments so untrusted text cannot forge the sticky-comment
 * marker, and escapes angle brackets so it cannot open raw HTML.
 */
export function stripMarkup(input: string): string {
  return input.replace(/<!--[\s\S]*?-->/g, '').replace(/[<>]/g, (char) => (char === '<' ? '&lt;' : '&gt;'));
}

/**
 * Defuses mentions and cross-references by inserting a zero-width space.
 *
 * A malicious (or merely unlucky) pull request title containing `@org/team` or
 * `#1` would otherwise notify people and litter unrelated issues with
 * back-references every time the report is updated.
 */
export function defuseReferences(input: string): string {
  return input.replace(/@(?=[A-Za-z0-9_-])/g, `@${ZERO_WIDTH}`).replace(/#(?=\d)/g, `#${ZERO_WIDTH}`);
}

export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Single-line, comment-safe text. Use for every value that is not ours. */
export function sanitizeText(input: string, maxLength = 300): string {
  const collapsed = stripMarkup(input).replace(/\s+/g, ' ').trim();
  return truncate(defuseReferences(collapsed), maxLength);
}

/** Comment-safe text for a markdown table cell. */
export function sanitizeCell(input: string, maxLength = 120): string {
  return sanitizeText(input, maxLength).replace(/\|/g, '\\|');
}

/**
 * Sanitises text PRProof itself produced (rule titles, details). Markdown is
 * preserved — these strings are authored in this repository — but any embedded
 * untrusted fragment has already been through `sanitizeText`.
 */
export function sanitizeAuthored(input: string, maxLength = 1000): string {
  return truncate(input.replace(/<!--[\s\S]*?-->/g, ''), maxLength);
}

/** Truncates a finished comment body to what GitHub will accept. */
export function capBody(
  body: string,
  notice = '\n\n_Report truncated to fit GitHub comment limits._\n',
): string {
  if (body.length <= MAX_COMMENT_LENGTH) return body;
  return `${body.slice(0, MAX_COMMENT_LENGTH - notice.length)}${notice}`;
}

/**
 * Redacts anything that looks like a credential before command output is shown.
 * Applied to every line PRProof copies out of a subprocess.
 */
export function redactSecrets(line: string): string {
  return line
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted-token]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted-token]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted-token]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-token]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-token]')
    .replace(
      /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_]*)\s*[=:]\s*\S+/gi,
      '$1=[redacted]',
    );
}
