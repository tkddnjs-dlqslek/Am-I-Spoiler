// /api/claude — Claude API proxy

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { ytData, hasAd, searchSnippets, workTitle, lang, outputLang } = req.body;
    const claudeKey = process.env.CLAUDE_KEY;
    if (!claudeKey) return res.status(500).json({ ok: false, error: 'CLAUDE_KEY not configured' });

    const result = await askClaude(ytData, hasAd, searchSnippets, workTitle, claudeKey, lang, outputLang);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

async function askClaude(ytData, hasAd, searchSnippets, workTitle, claudeKey, lang = 'en', outputLang = 'en') {
  const formatComments = (list) =>
    list?.length > 0
      ? list.map((c, i) => `${i + 1}. [likes: ${c.likes}] ${c.text}`).join('\n')
      : 'none';

  const endingCommentsText = formatComments(ytData.endingComments);
  const topCommentsText    = ytData.topComments?.length > 0
    ? formatComments(ytData.topComments)
    : null;

  const adText = hasAd === null ? 'unknown' : (hasAd ? 'yes' : 'no');

  const userContent = `
[Video Title]
${ytData.title}

[Video Description]
${ytData.description}

[Upload Date]
${ytData.publishedAt}

[Duration]
${ytData.duration}

[Has Ads]
${adText}

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
- Ads are NOT a reliable signal — ignore this field for the verdict
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
      max_tokens: 600,
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
              description: `Reasoning in 1–2 sentences (in ${outputLang === 'ko' ? 'Korean' : 'English'})`
            },
            cast:      { type: ['string', 'null'], description: 'Main cast members. null if unknown' },
            synopsis:  { type: ['string', 'null'], description: `2–3 sentence synopsis (in ${outputLang === 'ko' ? 'Korean' : 'English'}). null if unknown` },
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
