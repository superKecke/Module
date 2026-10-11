
const BASE_URL = 'https://www.anime-loads.org';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(value) {
  return decodeHtml(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function absoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return decodeHtml(url);
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('#')) return BASE_URL + '/media/dragon-ball-z' + url;
  return BASE_URL + (url.startsWith('/') ? '' : '/') + url;
}

async function getHtml(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!response || response.ok === false) {
    throw new Error('HTTP request failed' + (response ? ': ' + response.status : ''));
  }

  return await response.text();
}

function getAttr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(
    new RegExp('\\b' + escaped + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')
  );

  return match ? decodeHtml(match[1] || match[2] || match[3] || '') : '';
}

async function searchResults(keyword) {
  try {
    const query = encodeURIComponent(String(keyword || '').trim());
    const html = await getHtml(`${BASE_URL}/search?q=${query}`);

    const results = [];
    const seen = new Set();

    const anchorRegex =
      /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while ((match = anchorRegex.exec(html)) !== null) {
      const href = decodeHtml(match[1] || match[2] || match[3] || '');

      if (
        !/^\/media\//.test(href) &&
        !/^https?:\/\/www\.anime-loads\.org\/media\//i.test(href)
      ) {
        continue;
      }

      const fullHref = absoluteUrl(href);

      if (seen.has(fullHref)) continue;

      const anchorHtml = match[4] || '';
      const title = stripTags(anchorHtml);

      if (!title || title.length > 180) continue;

      let image = '';
      const imgMatch = anchorHtml.match(/<img\b[^>]*>/i);

      if (imgMatch) {
        image =
          getAttr(imgMatch[0], 'data-src') ||
          getAttr(imgMatch[0], 'src') ||
          getAttr(imgMatch[0], 'data-original');
      }

      if (!image) {
        const nearby = html.slice(Math.max(0, match.index - 800), match.index);
        const imgs = [...nearby.matchAll(/<img\b[^>]*>/gi)];

        if (imgs.length) {
          const lastImg = imgs[imgs.length - 1][0];

          image =
            getAttr(lastImg, 'data-src') ||
            getAttr(lastImg, 'src') ||
            getAttr(lastImg, 'data-original');
        }
      }

      image = absoluteUrl(image);

      seen.add(fullHref);
      results.push({
        title,
        image,
        href: fullHref
      });
    }

    return JSON.stringify(results);
  } catch (error) {
    console.log('Anime Loads search error:', String(error));
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const html = await getHtml(url);

    const metaDescription = html.match(
      /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i
    );

    const description = metaDescription
      ? getAttr(metaDescription[0], 'content')
      : '';

    const titleMatch =
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    const yearMatch = html.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : 'Unknown';

    const genreMatch = html.match(
      /Hauptgenre[\s\S]{0,500}?<[^>]*>\s*([^<]+)\s*</i
    );

    const genre = genreMatch ? stripTags(genreMatch[1]) : '';

    return JSON.stringify({
      description: description || 'Keine Beschreibung verfügbar.',
      aliases: [title, genre ? 'Genre: ' + genre : '']
        .filter(Boolean)
        .join(' | '),
      airdate:
        year === 'Unknown'
          ? 'Erscheinungsjahr unbekannt'
          : 'Erscheinungsjahr: ' + year
    });
  } catch (error) {
    console.log('Anime Loads details error:', String(error));

    return JSON.stringify({
      description: 'Beschreibung konnte nicht geladen werden.',
      aliases: '',
      airdate: ''
    });
  }
}

async function extractEpisodes(url) {
  try {
    const html = await getHtml(url);

    const results = [];
    const seen = new Set();

    const anchorRegex =
      /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while ((match = anchorRegex.exec(html)) !== null) {
      const href = decodeHtml(match[1] || match[2] || match[3] || '');

      // Nur Episoden-Links aus dem Streams-Bereich berücksichtigen.
      if (!/#streams_episodes_\d+_\d+/.test(href)) continue;

      const title = stripTags(match[4]);
      const numberMatch = title.match(/^\s*(\d{1,4})\b/);

      if (!numberMatch) continue;

      const number = parseInt(numberMatch[1], 10);
      const episodeHref = absoluteUrl(href);

      if (!Number.isFinite(number) || seen.has(episodeHref)) continue;

      seen.add(episodeHref);

      results.push({
        href: episodeHref,
        number
      });
    }

    results.sort((a, b) => a.number - b.number);

    return JSON.stringify(results);
  } catch (error) {
    console.log('Anime Loads episodes error:', String(error));
    return JSON.stringify([]);
  }
}

// Platzhalter: Stream-Extraktion folgt nach dem Test der ersten drei Funktionen.
async function extractStreamUrl(url) {
  console.log(
    'Anime Loads stream extraction is not implemented yet:',
    url
  );

  return JSON.stringify({
    streams: []
  });
}
