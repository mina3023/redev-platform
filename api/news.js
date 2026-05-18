/**
 * api/news.js
 * 네이버 뉴스 검색 API 프록시
 * GET /api/news?query=재개발&display=20&start=1
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const CLIENT_ID     = process.env.NAVER_CLIENT_ID;
  const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: '네이버 API 키 미설정' });
  }

  const {
    query   = '재개발',
    display = '20',
    start   = '1',
    sort    = 'date',   // date | sim
  } = req.query;

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
    if (!r.ok) {
      return res.status(r.status).json({ error: data.errorMessage || 'API 오류', raw: data });
    }

    // HTML 태그 제거 함수
    const strip = (str = '') => str.replace(/<[^>]*>/g, '').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');

    const items = (data.items || []).map(item => ({
      title:       strip(item.title),
      description: strip(item.description),
      link:        item.originallink || item.link,
      pubDate:     item.pubDate,
      source:      extractSource(item.originallink || item.link),
    }));

    return res.status(200).json({
      success:    true,
      total:      data.total,
      display:    data.display,
      start:      data.start,
      query,
      items,
    });

  } catch (err) {
    console.error('네이버 뉴스 API 오류:', err);
    return res.status(500).json({ error: '뉴스 API 호출 실패', detail: err.message });
  }
}

function extractSource(url = '') {
  try {
    const host = new URL(url).hostname.replace('www.','');
    const map = {
      'hankyung.com':'한국경제','chosun.com':'조선일보','joongang.co.kr':'중앙일보',
      'donga.com':'동아일보','hani.co.kr':'한겨레','mk.co.kr':'매일경제',
      'sedaily.com':'서울경제','edaily.co.kr':'이데일리','newsis.com':'뉴시스',
      'yonhapnews.co.kr':'연합뉴스','news1.kr':'뉴스1','yna.co.kr':'연합뉴스',
      'khan.co.kr':'경향신문','ohmynews.com':'오마이뉴스','moneytoday.co.kr':'머니투데이',
    };
    return map[host] || host.split('.')[0];
  } catch { return '언론사'; }
}
