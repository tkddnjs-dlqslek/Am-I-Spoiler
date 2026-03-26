// /api/extract-title — 경량 Claude 호출: workTitle만 추출 (max_tokens: 100)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { title, description } = req.body;
    const claudeKey = process.env.CLAUDE_KEY;
    if (!claudeKey) return res.status(500).json({ ok: false, error: 'CLAUDE_KEY not configured' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: `Extract the exact title of the movie, drama, or anime being reviewed from the YouTube video title and description.
- Return the most commonly known title (original or official title)
- If the video is clearly a review/recap of a specific work, return that work's title
- Return null if the work title cannot be clearly identified`,
        tools: [{
          name: 'extract_title',
          description: 'Extract the work title from the video',
          input_schema: {
            type: 'object',
            properties: {
              workTitle: {
                type: ['string', 'null'],
                description: 'Exact title of the reviewed work. null if unclear.'
              }
            },
            required: ['workTitle']
          }
        }],
        tool_choice: { type: 'tool', name: 'extract_title' },
        messages: [{
          role: 'user',
          content: `Video title: ${title}\nDescription: ${(description || '').slice(0, 200)}`
        }]
      })
    });

    const json = await r.json();
    if (json.error) return res.status(500).json({ ok: false, error: json.error.message });

    const toolUse = json.content?.find(b => b.type === 'tool_use');
    const workTitle = toolUse?.input?.workTitle ?? null;

    res.json({ ok: true, data: workTitle });
  } catch (e) {
    res.json({ ok: true, data: null }); // non-fatal, fallback to raw title
  }
}
