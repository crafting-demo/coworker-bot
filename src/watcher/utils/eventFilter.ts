/**
 * Escapes special regex characters in a string so it can be used inside a RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true if any botUsername appears as an @mention in the text.
 *
 * Word-boundary detection is applied so that @alice does not match @alice-bot
 * (and vice versa), including usernames that contain hyphens.
 * The match is case-insensitive.
 *
 * For GitHub App bot usernames ending in "[bot]" (e.g. "my-app[bot]"), also
 * matches the bare name without the suffix (e.g. "@my-app"), since users
 * commonly omit "[bot]" when mentioning.
 */
export function isBotMentionedInText(text: string, botUsernames: string[]): boolean {
  if (!text || botUsernames.length === 0) return false;
  return botUsernames.some((username) => {
    const namesToMatch = [username];
    if (username.toLowerCase().endsWith('[bot]')) {
      namesToMatch.push(username.slice(0, -5)); // strip "[bot]" suffix
    }
    return namesToMatch.some((name) => {
      const pattern = new RegExp(
        '(?<![a-zA-Z0-9_-])@' + escapeRegex(name) + '(?![a-zA-Z0-9_-])',
        'i'
      );
      return pattern.test(text);
    });
  });
}

/**
 * Returns true if any botAccountId appears as a Jira wiki markup mention
 * in the text (e.g. "[~accountid:712020:abc123]").
 *
 * This handles comment bodies that arrive as plain wiki markup strings
 * rather than ADF documents.
 */
export function isBotMentionedByAccountId(text: string, accountIds: string[]): boolean {
  if (!text || accountIds.length === 0) return false;
  return accountIds.some((id) => text.includes(`[~accountid:${id}]`));
}

/**
 * Returns true if the assignees list contains a bot username.
 *
 * @param assignees        Provider-specific assignee objects (may be undefined or empty).
 * @param botUsernames     Configured bot usernames to match against.
 * @param getUsernameFrom  Extracts the comparable username string from one assignee object.
 *                         Should return undefined if the field is absent.
 */
export function isBotAssignedInList(
  assignees: unknown[] | undefined,
  botUsernames: string[],
  getUsernameFrom: (a: unknown) => string | undefined
): boolean {
  if (!assignees || assignees.length === 0 || botUsernames.length === 0) return false;
  return assignees.some((a) => {
    const username = getUsernameFrom(a);
    return (
      username !== undefined &&
      botUsernames.some((bot) => bot.toLowerCase() === username.toLowerCase())
    );
  });
}
