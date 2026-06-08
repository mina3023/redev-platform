/**
 * api/yahoo-finance.js
 * Yahoo Finance 시세 조회 프록시
 * GET /api/yahoo-finance?symbol=DJP        → 원자재ETF
 * GET /api/yahoo-finance?symbol=CL=F       → WTI 원유
 * GET /api/yahoo-finance?symbol=KRW=X      → 원달러환율
 * GET /api/yahoo-finance?symbol=%5ETNX     → 미국10년물 (^TNX)
 *
 * 지원 심볼:
 *   DJP    - iShares Bloomberg 원자재 ETF (건설자재 연동)
 *   CL=F   - WTI 원유 선물
 *   KRW=X  - 원달러 환율
 *   ^TNX   - 미국 10년물 국채금리
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터 필요' });

  // 1시간 캐시
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    // Yahoo Finance v8 API (공개 엔드포인트)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://finance.yahoo.com',
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance 응답 오류: ${response.status}`);
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({ error: '시세 데이터 없음', symbol });
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    const prevClose = meta.previousClose || meta.chartPreviousClose;
    const change = price - prevClose;
    const changePct = (change / prevClose) * 100;

    // 날짜 포맷
    const lastDate = new Date(meta.regularMarketTime * 1000);
    const dateStr = lastDate.toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });

    // 심볼별 단위/라벨
    const meta_map = {
      'DJP':   { label: '원자재 ETF(DJP)', unit: '$',  desc: 'iShares Bloomberg 원자재' },
      'CL=F':  { label: 'WTI 원유',        unit: '$',  desc: '달러/배럴' },
      'KRW=X': { label: 'USD/KRW',         unit: '원', desc: '원달러 환율' },
      '^TNX':  { label: '미국 10년물',      unit: '%',  desc: '국채금리' },
    };
    const info = meta_map[symbol] || { label: symbol, unit: '', desc: '' };

    return res.status(200).json({
      success: true,
      symbol,
      label:     info.label,
      unit:      info.unit,
      desc:      info.desc,
      price:     Math.round(price * 100) / 100,
      prevClose: Math.round(prevClose * 100) / 100,
      change:    Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      date:      dateStr,
      currency:  meta.currency || 'USD',
      exchange:  meta.exchangeName || '',
    });

  } catch (err) {
    console.error('Yahoo Finance 오류:', err.message);

    // fallback — 정적 값 반환 (API 실패 시)
    const fallbacks = {
      'DJP':   { price: 27.82, label: '원자재 ETF(DJP)', unit: '$' },
      'CL=F':  { price: 68.5,  label: 'WTI 원유',        unit: '$' },
      'KRW=X': { price: 1385,  label: 'USD/KRW',         unit: '원' },
      '^TNX':  { price: 4.42,  label: '미국 10년물',      unit: '%' },
    };
    const fb = fallbacks[symbol];
    if (fb) {
      return res.status(200).json({
        success: true,
        symbol,
        ...fb,
        change: 0,
        changePct: 0,
        date: '참고값',
        fallback: true,
      });
    }

    return res.status(500).json({
      error: 'Yahoo Finance 조회 실패',
      detail: err.message,
      success: false,
    });
  }
}
