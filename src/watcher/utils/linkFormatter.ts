import type { NormalizedEvent } from '../types/provider.js';

/**
 * Formats a link with text and URL according to the provider's markdown format
 *
 * @param text - Display text for the link
 * @param url - URL to link to
 * @param provider - Provider name (github, gitlab, linear, slack, etc.)
 * @returns Formatted link string
 */
export function formatLink(text: string, url: string, provider: string): string {
  // Handle missing or empty URLs
  if (!url || url.trim() === '') {
    return text;
  }

  // Escape special characters in text for markdown (but not for Slack)
  const sanitizedText = provider === 'slack' ? text : escapeMarkdown(text);

  // Provider-specific formatting
  switch (provider.toLowerCase()) {
    case 'slack':
      return formatSlackLink(sanitizedText, url);
    case 'github':
    case 'gitlab':
    case 'linear':
    default:
      // Default to standard markdown format
      return formatMarkdownLink(sanitizedText, url);
  }
}

/**
 * Formats a resource link from a NormalizedEvent
 * Creates a clickable link with the repository and number as the display text
 *
 * @param event - Normalized event containing resource information
 * @returns Formatted resource link or plain text fallback
 */
export function formatResourceLink(event: NormalizedEvent): string {
  const { resource, provider } = event;

  // Special handling for Slack - use title instead of repository#number
  if (provider === 'slack') {
    // Use the resource title which is "Message in #CHANNEL_ID"
    const displayText = resource.title || 'Slack message';

    // If URL is available (from polling with permalink), format as link
    if (resource.url && resource.url.trim() !== '') {
      return formatLink(displayText, resource.url, provider);
    }

    // For webhook events without permalink, just return the display text
    return displayText;
  }

  // Standard format for GitHub/GitLab/Linear (e.g., "owner/repo#123")
  const displayText = `${resource.repository}#${resource.number}`;

  // If URL is not available, return plain text
  if (!resource.url || resource.url.trim() === '') {
    return displayText;
  }

  return formatLink(displayText, resource.url, provider);
}

/**
 * Formats a standard markdown link [text](url)
 * Used by GitHub, GitLab, Linear, and as default
 */
function formatMarkdownLink(text: string, url: string): string {
  return `[${text}](${url})`;
}

/**
 * Formats a Slack mrkdwn link <url|text>
 * Slack uses a different format than standard markdown
 */
function formatSlackLink(text: string, url: string): string {
  // Slack format: <url|text>
  // Escape special characters in URL if needed
  const sanitizedUrl = url.replace(/[<>]/g, '');
  return `<${sanitizedUrl}|${text}>`;
}

/**
 * Escapes markdown special characters in text
 * Prevents breaking markdown formatting
 */
function escapeMarkdown(text: string): string {
  // Escape characters that have special meaning in markdown: [ ] ( ) * _ ` # + - . !
  return text.replace(/([[\]()\\*_`#+\-.!])/g, '\\$1');
}
