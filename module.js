
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
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function stripTags(value) {
  return decodeHtml(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function absoluteUrl(url, base = BASE_URL + '/') {
  if (!url) return '';

  url = decodeHtml(url.trim());

  if (/^(data:|javascript:|mailto:)/i.test(url)) return '';

  try {
    return new URL(url, base).href;
  } catch (_) {
    return '';
  }
}

async function getHtml(url) {
  const response = await fetchv2(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  if (!response) {
    throw new Error('Keine Antwort vom Server');
  }

  if (
    response.ok === false ||
    (response.status && response.status >= 400)
  ) {
    throw new Error(
      'HTTP ' + response.status + ' beim Abruf von ' + url
    );
  }

  return await response.text();
}

function getAttr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const match = tag.match(
    new RegExp(
      `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      'i'
    )
  );

  return match
    ? decodeHtml(match[1] || match[2] || match[3] || '')
    : '';
}

function firstImage(html) {
  const tags = html.match(/<img\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const src =
      getAttr(tag, 'data-src') ||
      getAttr(tag, 'data-original') ||
      getAttr(tag, 'src');

    if (src && !src.startsWith('data:')) {
      return absoluteUrl(src);
    }
  }

  return '';
}

async function searchResults(keyword) {
  try {
    const query = encodeURIComponent(
      String(keyword || '').trim()
    );

    const html = await getHtml(
      `${BASE_URL}/search?q=${query}`
    );

    const results = [];
    const seen = new Set();

    const anchors =
      html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];

    for (const anchor of anchors) {
      const opening = anchor.slice(0, anchor.indexOf('>') + 1);
      const href = absoluteUrl(getAttr(opening, 'href'));

      if (
        !href ||
        !/anime-loads\.org\/media\//i.test(href)
      ) {
        continue;
      }

      const title = stripTags(anchor);

      if (!title || title.length > 180) continue;

      const cleanHref = href.split('#')[0];

      if (seen.has(cleanHref)) continue;

      seen.add(cleanHref);

      const pos = html.indexOf(anchor);

      const nearby = html.slice(
        Math.max(0, pos - 1800),
        Math.min(html.length, pos + 1800)
      );

      results.push({
        title,
        image: firstImage(nearby),
        href: cleanHref
      });
    }

    return JSON.stringify(results);
  } catch (error) {
    console.log(
      'Anime Loads search error:',
      String(error)
    );

    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const html = await getHtml(url);

    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

    const meta = metaTags.find(tag =>
      /\bname\s*=\s*["']description["']/i.test(tag)
    );

    const description = meta
      ? getAttr(meta, 'content')
      : '';

    const titleTag =
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

    const title = titleTag
      ? stripTags(titleTag[1])
      : '';

    const details = {};

    const rows =
      html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
      const cells =
        row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];

      if (cells.length < 2) continue;

      const key = stripTags(cells[0])
        .replace(/:$/, '')
        .trim();

      const value = stripTags(cells[1]);

      if (key && value) {
        details[key] = value;
      }
    }

    const descBlock = html.match(
      /<div\b[^>]*id\s*=\s*["']description["'][^>]*>([\s\S]*?)<\/div>/i
    );

    const fallbackDescription = descBlock
      ? stripTags(descBlock[1])
      : '';

    const yearMatch =
      html.match(
        /(?:Jahr|Erscheinungsjahr)[\s\S]{0,180}?(19\d{2}|20\d{2})/i
      ) ||
      html.match(/\b(19\d{2}|20\d{2})\b/);

    const year =
      details['Jahr'] ||
      (yearMatch
        ? yearMatch[1] || yearMatch[2]
        : 'Unbekannt');

    const genres = [
      details['Hauptgenre'],
      details['Nebengenre'],
      details['Tags']
    ].filter(Boolean).join(', ');

    const episodeInfo = details['Episoden'] || '';

    const extra = [
      genres ? 'Genre: ' + genres : '',
      episodeInfo ? 'Episoden: ' + episodeInfo : ''
    ].filter(Boolean).join(' | ');

    return JSON.stringify({
      description:
        description ||
        fallbackDescription ||
        'Keine Beschreibung verfügbar.',

      aliases: [title, extra]
        .filter(Boolean)
        .join(' | '),

      airdate:
        year === 'Unbekannt'
          ? 'Erscheinungsjahr unbekannt'
          : 'Erscheinungsjahr: ' + year
    });
  } catch (error) {
    console.log(
      'Anime Loads details error:',
      String(error)
    );

    return JSON.stringify({
      description:
        'Details konnten nicht geladen werden: ' +
        String(error),
      aliases: '',
      airdate: ''
    });
  }
}

async function extractEpisodes(url) {
  try {
    const html = await getHtml(url);
    const releases = new Map();

    const re =
      /<a\b[^>]*aria-controls\s*=\s*["']downloads_episodes_(\d+)_(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while ((match = re.exec(html)) !== null) {
      const releaseId = parseInt(match[1], 10);
      const episodeIndex = parseInt(match[2], 10);

      if (
        !Number.isFinite(releaseId) ||
        !Number.isFinite(episodeIndex)
      ) {
        continue;
      }

      if (!releases.has(releaseId)) {
        releases.set(releaseId, []);
      }

      releases.get(releaseId).push({
        index: episodeIndex,
        text: stripTags(match[3])
      });
    }

    if (!releases.size) {
      return JSON.stringify([]);
    }

    let chosenId = [...releases.keys()]
      .sort((a, b) => a - b)[0];

    const releaseListItems =
      html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];

    for (const item of releaseListItems) {
      const opening = item.slice(
        0,
        item.indexOf('>') + 1
      );

      const controls = getAttr(
        opening,
        'aria-controls'
      );

      const relMatch = controls.match(
        /downloads_episodes_(\d+)_/
      );

      if (
        relMatch &&
        /Deutsch|German|Ger Dub|Ger-Dub|DE\b/i.test(
          stripTags(item)
        )
      ) {
        chosenId = parseInt(relMatch[1], 10);
        break;
      }
    }

    const episodes =
      releases.get(chosenId) ||
      releases.values().next().value;

    const base = String(url).split('#')[0];
    const unique = new Map();

    for (
      const episode of episodes.sort(
        (a, b) => a.index - b.index
      )
    ) {
      const number = episode.index + 1;

      if (!unique.has(number)) {
        unique.set(number, {
          href:
            `${base}#streams_episodes_${chosenId}_${episode.index}`,
          number
        });
      }
    }

    return JSON.stringify(
      [...unique.values()].sort(
        (a, b) => a.number - b.number
      )
    );
  } catch (error) {
    console.log(
      'Anime Loads episodes error:',
      String(error)
    );

    return JSON.stringify([]);
  }
}

// Noch nicht implementiert: Stream-Extraktion.
async function extractStreamUrl(url) {
  console.log(
    'Anime Loads stream extraction is not implemented yet:',
    url
  );

  return JSON.stringify({
    streams: []
  });
}
