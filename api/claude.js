export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, system } = req.body;

  // system 메시지를 messages 배열 맨 앞에 추가
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  if (messages && Array.isArray(messages)) {
    openaiMessages.push(...messages);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      stream: true,
      max_tokens: 1000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(response.status).json({ error });
  }

  // 스트리밍 응답을 Claude 형식으로 변환해서 전달
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        res.write('data: [DONE]\n\n');
        continue;
      }
      try {
        const parsed = JSON.parse(data);
        const text = parsed.choices?.[0]?.delta?.content ?? '';
        if (text) {
          // Claude 스트리밍 형식으로 변환
          const claudeFormat = JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text }
          });
          res.write(`data: ${claudeFormat}\n\n`);
        }
      } catch(e) {}
    }
  }

  res.end();
}
