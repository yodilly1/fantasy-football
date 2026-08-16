const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const response = await fetch('https://boi.org.il/PublicApi/GetExchangeRate?key=USD', {
      headers: { accept: 'application/json', 'user-agent': 'UWC-League-HQ/1.0' },
    });
    if (!response.ok) throw new Error(`Bank of Israel returned ${response.status}.`);
    const body = await response.json();
    const rate = Number(body.currentExchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Bank of Israel returned an invalid rate.');
    return Response.json({ rate, lastUpdated: body.lastUpdate, source: 'Bank of Israel representative USD/ILS rate' }, { headers: corsHeaders });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : 'Exchange rate unavailable.' }, { status: 502, headers: corsHeaders });
  }
});

