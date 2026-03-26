// /api/extract-title — 경량 Claude 호출: workTitle만 추출 (max_tokens: 100)

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
    const { title, description } = await req.json();
    const claudeKey = process.env.CLAUDE_KEY;
    if (!claudeKey) return new Response(JSON.stringify({ ok: false, error: 'CLAUDE_KEY not configured' }), { status: 500, headers });

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
    if (json.error) return new Response(JSON.stringify({ ok: false, error: json.error.message }), { status: 500, headers });

    const toolUse = json.content?.find(b => b.type === 'tool_use');
    const workTitle = toolUse?.input?.workTitle ?? null;

    return new Response(JSON.stringify({ ok: true, data: workTitle }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: true, data: null }), { headers }); // non-fatal fallback
  }
}
