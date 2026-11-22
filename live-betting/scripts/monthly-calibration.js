const endpoint = 'https://pariuverde.ro/wp-json/pv-live-calibration/v1/monthly';
const preview = process.env.PREVIEW === 'true';
const { WP_USER, WP_APP_PASS, OPENAI_API_KEY } = process.env;
if (!WP_USER || !WP_APP_PASS || !OPENAI_API_KEY) throw new Error('Missing WordPress or OpenAI secret.');

const headers = {
  Authorization: `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString('base64')}`,
  'Content-Type': 'application/json',
};
const snapshot = await fetch(preview ? `${endpoint}?preview=1` : endpoint, {
  headers, signal: AbortSignal.timeout(30_000),
});
if (!snapshot.ok) throw new Error(`WordPress history endpoint returned HTTP ${snapshot.status}.`);
const { month, summary, delivered, has_analysis: hasAnalysis } = await snapshot.json();
if (!/^\d{4}-\d{2}$/.test(month) || !Number.isInteger(summary?.episodes)) throw new Error('Invalid monthly snapshot.');
if (!preview && delivered) {
  console.log(`Monthly review for ${month} already delivered.`);
  process.exit(0);
}

let text = '';
if (!preview && hasAnalysis) {
  console.log('Using the analysis already saved by WordPress for the delivery retry.');
} else if (summary.episodes === 0 && !preview) {
  text = `Raport ${month}. Nu am observat semnale în această lună. Păstrăm pragurile și continuăm colectarea.`;
} else {
  const model = 'gpt-5.6-luna';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1800,
      instructions: [
        'Scrie în română o revizuire lunară concisă pentru administratorul unui motor de semnale sportive.',
        'Folosește exclusiv statisticile primite. Raportează numărătorul și numitorul fiecărei rate din semnalele decise.',
        'Separă câștigurile și pierderile de semnalele în așteptare, neconfirmate și cazurile fără gol ulterior.',
        'Intervalele reprezintă observări ale feedului la cinci minute și mai multe semnale pot proveni din aceeași partidă.',
        'Arată ce piețe și intervale merită investigate, propune cel mult două ipoteze verificabile pentru testare în paralel și criteriile de succes.',
        'Când eșantionul e mic, păstrează pragurile și indică datele care lipsesc. Nu inventa pragurile curente și nu estima ROI din cota minimă recomandată.',
        'Recomandările sunt pentru verificare umană. Nu recomanda pariuri individuale și nu presupune că se aplică automat modificări.',
        'Răspunde în text simplu, în cel mult 450 de cuvinte.',
      ].join(' '),
      input: JSON.stringify({ month, ...summary }),
    }),
  });
  if (!response.ok) throw new Error(`OpenAI Responses returned HTTP ${response.status}.`);
  const output = await response.json();
  text = (output.output ?? []).flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (output.status !== 'completed' || !text) throw new Error('OpenAI did not return a completed review.');
  console.log(`OpenAI generated a review for ${month} using ${model} (${summary.episodes} logged intervals).`);
}

if (preview) {
  console.log('Preview complete. No report email sent.');
} else {
  const sent = await fetch(endpoint, {
    method: 'POST', headers, signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ month, text }),
  });
  if (!sent.ok || !(await sent.json()).delivered) throw new Error(`WordPress could not deliver the report (HTTP ${sent.status}).`);
  console.log(`WordPress accepted delivery for ${month}.`);
}
