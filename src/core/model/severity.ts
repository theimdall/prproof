/**
 * Severity ladder. The order matters: it drives the score caps in
 * `core/scoring`, so it is defined once, here, and derived everywhere else.
 */
export const SEVERITIES = ['info', 'warning', 'high', 'critical'] as const;

export type Severity = (typeof SEVERITIES)[number];

const RANK: Readonly<Record<Severity, number>> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

/** Highest severity of the given list, or `undefined` for an empty list. */
export function maxSeverity(severities: readonly Severity[]): Severity | undefined {
  let winner: Severity | undefined;
  for (const severity of severities) {
    if (winner === undefined || severityRank(severity) > severityRank(winner)) {
      winner = severity;
    }
  }
  return winner;
}

/**
 * Lowers a severity by one step. Used when a check is configured as
 * `required: false` — a non-required failure still matters, but it must not be
 * able to push a pull request into the HIGH RISK band on its own.
 */
export function downgrade(severity: Severity): Severity {
  switch (severity) {
    case 'critical':
      return 'high';
    case 'high':
      return 'warning';
    case 'warning':
      return 'info';
    case 'info':
      return 'info';
  }
}
