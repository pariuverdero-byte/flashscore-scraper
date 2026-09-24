// All daily workflows for a site must share one concurrency group. The lookup
// deliberately fails closed: an unavailable WordPress API must not create posts.
export function ticketSlug(date, type) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid ticket date');
  return `daily-ticket-${date}-${type}`;
}

export async function findPublishedTicket({ endpoint, auth, date, type, categoryId, fetchImpl = fetch }) {
  const slug = ticketSlug(date, type);
  const label = date.split('-').reverse().join('.');
  async function query(params) {
    const response = await fetchImpl(`${endpoint}?${new URLSearchParams(params)}`, {
      headers: { Authorization: auth, Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Duplicate check failed: HTTP ${response.status}`);
    const posts = await response.json();
    if (!Array.isArray(posts)) throw new Error('Duplicate check returned invalid posts');
    return { posts, pages: Number(response.headers.get('x-wp-totalpages') || 1) };
  }
  const exact = await query({ slug, status: 'publish', context: 'edit' });
  if (exact.posts.length) return exact.posts[0];
  // Recognize articles created before stable slugs were introduced, including
  // titles containing teams and odds. Match ticket date, not publication date.
  for (let page = 1; ; page++) {
    const result = await query({ search: label, categories: String(categoryId), status: 'publish', context: 'edit', per_page: '100', page: String(page) });
    const found = result.posts.find(post => {
      const title = post.title?.raw || post.title?.rendered || '';
      const content = post.content?.raw || post.content?.rendered || '';
      return title.includes(`(${label})`) || new RegExp(`(?:Data biletului|Ticket date):\\s*(?:<[^>]+>\\s*)*${label.replaceAll('.', '\\.')}`).test(content);
    });
    if (found) return found;
    if (page >= result.pages) return null;
  }
}
