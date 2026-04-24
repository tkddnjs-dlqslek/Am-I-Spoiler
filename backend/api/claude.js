// /api/claude — Claude API proxy

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const { ytData, searchSnippets, workTitle, lang, outputLang } = await req.json();
    const claudeKey = process.env.CLAUDE_KEY;
    if (!claudeKey) return new Response(JSON.stringify({ ok: false, error: 'CLAUDE_KEY not configured' }), { status: 500, headers });

    const result = await askClaude(ytData, searchSnippets, workTitle, claudeKey, lang, outputLang);
    return new Response(JSON.stringify({ ok: true, data: result }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
  }
}

async function askClaude(ytData, searchSnippets, workTitle, claudeKey, lang = 'en', outputLang = 'en') {
  const formatComments = (list) =>
    list?.length > 0
      ? list.map((c, i) => `${i + 1}. [likes: ${c.likes}] ${c.text}`).join('\n')
      : 'none';

  const endingCommentsText = formatComments(ytData.endingComments);
  const topCommentsText    = ytData.topComments?.length > 0
    ? formatComments(ytData.topComments)
    : null;

  const userContent = `
[Video Title]
${ytData.title}

[Video Description]
${ytData.description}

[Upload Date]
${ytData.publishedAt}

[Duration]
${ytData.duration}

[Comments containing "${lang === 'ko' ? '결말' : 'ending'}" — up to 30, sorted by likes — primary signal]
${endingCommentsText}
${topCommentsText ? `\n[Top comments (supplementary)]\n${topCommentsText}` : ''}

[Work Title (confirmed)]
${workTitle || 'Unknown'}

[Web Search Results — airing status]
${searchSnippets || 'No results'}
`.trim();

  const systemPrompt = `You are an expert at analyzing whether a YouTube review video covers the ending of a movie, drama, webtoon, or manga.

Use these criteria to decide:
- If comments complain "no ending", "cut off in the middle", "where's part 2", "cliffhanger" → likely NO ending
- If the title contains words like "ending", "finale", "complete", "final episode", "결말", "완결", "엔딩" → likely HAS ending
- If the title contains "part 1", "review 1", "first half", "1부", "전편" → likely NO ending
- If the work is currently airing/in theaters → ending unlikely to be covered
- If duration is very short (under PT10M) → likely a partial review
${lang === 'ko'
  ? '- Note: comments are in Korean. "결말 없음" = no ending, "1부냐" = is this part 1?, "중간에 끊음" = cuts off midway, "2편 언제" = when is part 2'
  : '- Note: comments are in English. Look for phrases like "no ending", "cliffhanger", "part 1 only", "cuts off", "where\'s the rest"'}

For workTitle, cast, synopsis:
- Only fill these in if the work title is clearly stated in the video title or description
- The work title is already confirmed and provided above — use it for context
- If uncertain about cast/synopsis, set to null — it is better to return null than to guess incorrectly

${outputLang === 'ko'
  ? 'All text output fields (reason, synopsis, cast, workTitle) must be written in Korean (한국어).'
  : 'All text output fields (reason, synopsis, cast, workTitle) must be written in English.'}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      tools: [{
        name: 'spoiler_result',
        description: 'Returns the structured analysis result of the video.',
        input_schema: {
          type: 'object',
          properties: {
            verdict: {
              type: 'string',
              enum: ['contains_ending', 'no_ending', 'uncertain'],
              description: 'Whether the video covers the ending of the work'
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence level of the verdict'
            },
            reason: {
              type: 'string',
              description: `One concise sentence (in ${outputLang === 'ko' ? 'Korean' : 'English'})`
            },
            cast:      { type: ['string', 'null'], description: 'Main cast members. null if unknown' },
            synopsis:  { type: ['string', 'null'], description: `One short sentence (in ${outputLang === 'ko' ? 'Korean' : 'English'}). null if unknown` },
            isAiring:  { type: ['boolean', 'null'], description: 'true if currently airing/in theaters, false if finished, null if unknown' },
          },
          required: ['verdict', 'confidence', 'reason']
        }
      }],
      tool_choice: { type: 'tool', name: 'spoiler_result' },
      messages: [{ role: 'user', content: userContent }]
    })
  });

  const json = await r.json();
  if (json.error) throw new Error(`Claude API error: ${json.error.message}`);

  const toolUse = json.content?.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude API: unexpected response format');

  return toolUse.input;
}
