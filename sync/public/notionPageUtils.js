/**
 * Notion page body, property shapes, and block-level API helpers.
 * Pure block construction + rich_text helpers; HTTP is injected for replacePageContent.
 */

/** Split plain text into Notion paragraph blocks (≤ chunkSize chars each). */
export function splitTextIntoParagraphs(text = '', chunkSize = 1800) {
  const paragraphs = text.split(/\n+/);
  const blocks = [];

  for (const p of paragraphs) {
    let remaining = p;
    while (remaining.length > 0) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: remaining.slice(0, chunkSize) } }],
        },
      });
      remaining = remaining.slice(chunkSize);
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: '' } }] },
    });
  }

  return blocks;
}

/**
 * Block array appended to a new/updated anime page (page body).
 * Edit here for headings, callouts, columns, etc.
 *
 * @param {{ notesText: string, malSynopsisText: string }} parts
 * @returns {object[]} Notion API block objects
 */
export function buildAnimePageChildren({ notesText, malSynopsisText }) {
  const paragraphBlocks = splitTextIntoParagraphs(String(notesText ?? ''));
  const malSynopsisBlocks = splitTextIntoParagraphs(String(malSynopsisText ?? ''));

  const emptyParagraph = {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: '' } }] },
  };
  const divider = {
    object: 'block',
    type: 'divider',
    divider: {},
  };

  return [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'My Comments' } }] },
    },
    ...paragraphBlocks,
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'MAL Synopsis' } }] },
    },
    ...malSynopsisBlocks,
    emptyParagraph,
    divider,
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{
          type: 'text',
          text: { content: 'Kathir Meyyappan' },
          annotations: { color: 'gray' },
        }],
      },
    },
  ];
}

/** Notion `rich_text` property from a plain string (empty → empty rich_text). */
export function notionRichTextProperty(value) {
  const s = String(value ?? '');
  if (!s) return { rich_text: [] };
  return { rich_text: [{ type: 'text', text: { content: s } }] };
}

/**
 * Append page body blocks after a PATCH with erase_content.
 * @param {string} pageId
 * @param {object[]} children
 * @param {object} config
 * @param {object|null} [stats]
 * @param {{ notionHeaders: (c: object) => object, apiFetchNotionRetry: (url: string, opts: object, c: object) => Promise<Response> }} notionFetch
 */
export async function replacePageContent(pageId, children, config, stats, notionFetch) {
  if (!children || children.length === 0) return;

  const { notionHeaders, apiFetchNotionRetry } = notionFetch;
  const headers = notionHeaders(config);
  const appendRes = await apiFetchNotionRetry(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ children }),
  }, config);

  if (!appendRes.ok) {
    if (stats) stats.errors = (stats.errors ?? 0) + 1;
    const text = await appendRes.text();
    throw new Error(`Failed to append children for page ${pageId} (${appendRes.status}): ${text.slice(0, 500)}`);
  }
}
