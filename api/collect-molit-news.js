export default async function handler(req, res) {
  try {
    // RSS 가져오기
    const rssRes = await fetch('https://www.korea.kr/rss/pressrelease.xml');
    const xml = await rssRes.text();

    // XML 파싱 (국토교통부만 필터)
    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    
    for (const match of itemMatches) {
      const block = match[1];
      const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || '';
      const link = block.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1] || '';
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      const description = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]?.slice(0, 500) || '';

      if (title.includes('국토교통부') || title.includes('[국토부]')) {
        items.push({
          title,
          link,
          pub_date: pubDate ? new Date(pubDate).toISOString() : null,
          description
        });
      }
    }

    if (items.length === 0) {
      return res.status(200).json({ message: '국토부 항목 없음', count: 0 });
    }

    // Supabase에 저장
    const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/molit_news`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(items)
    });

    if (!sbRes.ok) {
      const err = await sbRes.text();
      return res.status(500).json({ error: err });
    }

    return res.status(200).json({ message: '저장 완료', count: items.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
