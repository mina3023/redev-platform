/**
 * api/news.js
 * 네이버 뉴스 검색 API + 국토부 보도자료 RSS 프록시
 * GET /api/news?query=재개발&display=20
 * GET /api/news?type=molit → 국토부 보도자료 (정책브리핑 RSS)
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type = 'naver', query = '재개발', display = '20', start = '1', sort = 'date' } = req.query;

  // ── 국토부 보도자료 RSS (대한민국 정책브리핑 국토교통부 전용)
  if (type === 'molit') {
    try {
      const rssUrl = 'https://www.korea.kr/rss/dept_mltm.xml';
      const r = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; REDEV-AI/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(8000),
      });
      const xml = await r.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      const results = items.slice(0, 10).map(match => {
        const block = match[1];
        const get = (tag) => {
          const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
          return m ? m[1].trim().replace(/<[^>]*>/g, '') : '';
        };
        return {
          title:   get('title'),
          link:    get('link') || get('guid'),
          pubDate: get('pubDate'),
          desc:    get('description').slice(0, 100),
        };
      }).filter(i => i.title);
      return res.status(200).json({ success: true, type: 'molit', items: results });
    } catch(err) {
      return res.status(200).json({ success: false, error: '국토부 RSS 호출 실패', detail: err.message });
    }
  }

  // ── 네이버 뉴스 검색
  const CLIENT_ID     = process.env.NAVER_CLIENT_ID;
  const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: '네이버 API 키 미설정' });
  }

  try {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&start=${start}&sort=${sort}`;
    const r = await fetch(url, {
      headers: {
        'X-Naver-Client-Id':     CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.errorMessage || 'API 오류' });

    const strip = (s = '') => s
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const items = (data.items || []).map(item => ({
      title:       strip(item.title),
      description: strip(item.description),
      link:        item.originallink || item.link,
      pubDate:     item.pubDate,
      source:      extractSource(item.originallink || item.link),
    }));

    return res.status(200).json({ success: true, total: data.total, query, items });

  } catch(err) {
    return res.status(500).json({ error: '뉴스 API 호출 실패', detail: err.message });
  }
}

function extractSource(url = '') {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    const map = {
      'hankyung.com':'한국경제', 'chosun.com':'조선일보', 'joongang.co.kr':'중앙일보',
      'donga.com':'동아일보', 'hani.co.kr':'한겨레', 'mk.co.kr':'매일경제',
      'sedaily.com':'서울경제', 'edaily.co.kr':'이데일리', 'newsis.com':'뉴시스',
      'yonhapnews.co.kr':'연합뉴스', 'news1.kr':'뉴스1', 'yna.co.kr':'연합뉴스',
      'khan.co.kr':'경향신문', 'ohmynews.com':'오마이뉴스', 'moneytoday.co.kr':'머니투데이',
      'korea.kr':'정책브리핑', 'molit.go.kr':'국토교통부',
    };
    return map[host] || host.split('.')[0];
  } catch { return '언론사'; }
}
