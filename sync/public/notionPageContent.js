/**
 * Notion page body & text helpers for anime entries.
 * Keeps block trees / styling out of sync orchestration (notionSync.js).
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
    emptyParagraph,
    divider,
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
