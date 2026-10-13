const PROVIDER = "DhakaFlix";
const TMDB_API = "https://api.themoviedb.org/3";

const SERVERS = [
    { id: "df7", url: "http://172.16.50.7", root: "/DHAKA-FLIX-7/", types: ["movie"] },
    { id: "df10", url: "http://172.16.50.10", root: "/DHAKA-FLIX-10/", types: ["tv"] },
    { id: "df12", url: "http://172.16.50.12", root: "/DHAKA-FLIX-12/", types: ["tv"] },
    { id: "df14", url: "http://172.16.50.14", root: "/DHAKA-FLIX-14/", types: ["movie", "tv"] },
];

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
};

const AUDIO_TABLE = [
    [/ddp.?51.*truehd.*71|truehd.*71.*ddp.?51/i, "DDP 5.1 + TrueHD 7.1"],
    [/ddp.?51.*ddp.?71|ddp.?71.*ddp.?51/i, "DDP 5.1 + DDP 7.1"],
    [/ddp.?51.*aac.?71|aac.?71.*ddp.?51/i, "DDP 5.1 + AAC 7.1"],
    [/ddp.?51/i, "DDP 5.1"],
    [/truehd/i, "TrueHD 7.1"],
    [/dts.?hd|dts.?x/i, "DTS-HD"],
    [/dts/i, "DTS 5.1"],
    [/aac.*71|71.*aac/i, "AAC 7.1"],
    [/aac.*51|51.*aac/i, "AAC 5.1"],
    [/aac/i, "AAC 2.0"],
];

const QUALITY_RANK = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "hd": 0 };
const MAX_RANK = 5;

async function httpGet(url) {
    try {
        const res = await fetch(url, { headers: { "Accept": "application/json" } });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

async function httpPost(url, body) {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify(body),
        });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

const tmdbCache = new Map();
const tvFolderCache = new Map();
const streamCache = new Map();

function cacheSet(map, key, val, max = 100) {
    if (map.size >= max) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, val);
}

async function getTmdbMeta(tmdbId, mediaType) {
    const cacheKey = `${mediaType}:${tmdbId}`;
    if (tmdbCache.has(cacheKey)) {
        return tmdbCache.get(cacheKey);
    }

    const apiKey = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "01926d2187b6a5d861eefc750e9df3e3";
    if (!apiKey) return null;

    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const data = await httpGet(`${TMDB_API}/${endpoint}/${tmdbId}?api_key=${apiKey}&append_to_response=alternative_titles`);
    if (!data) return null;

    const title = data.name || data.title || "";
    const origTitle = data.original_name || data.original_title || "";
    const releaseDate = data.release_date || data.first_air_date || "";
    const year = releaseDate ? releaseDate.slice(0, 4) : "";
    const isAnimation = Array.isArray(data.genres) && data.genres.some(g => g.id === 16);

    const rawAlts = data.alternative_titles?.titles || data.alternative_titles?.results || [];
    const preferredRegions = new Set(["US", "GB", "CA", "AU", "JP", "KR", "IN", "BD"]);
    const primaryClean = cleanTitle(title).toLowerCase();
    const primaryTokens = extractSequelTokens(title);
    const hasSeasonOrArc = /\b(?:season|part|ova|oad|special|specials|movie|film)\b/i.test(title);
    const hasOrdinal = /\b\d+(?:st|nd|rd|th)\b/i.test(title);
    const primaryHasSub = /\s*[:—]\s*|\s+-\s+/.test(title);

    const aliases = [];
    const seenClean = new Set();
    if (primaryClean) seenClean.add(primaryClean);
    const origClean = cleanTitle(origTitle).toLowerCase();
    if (origClean) seenClean.add(origClean);

    for (const item of rawAlts) {
        let alt = (item.title || "").trim();
        if (!alt) continue;

        if (item.iso_3166_1 && !preferredRegions.has(item.iso_3166_1)) continue;

        // Strip combining marks/diacritics (e.g. Sōsō -> Soso, Bāhubali -> Bahubali)
        const normalized = alt.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (/[^\x20-\x7E\u2019]/.test(normalized)) continue;

        if (extractSequelTokens(alt) !== primaryTokens) continue;

        if (!hasOrdinal && /\b\d+(?:st|nd|rd|th)\b/i.test(alt)) continue;

        if (!hasSeasonOrArc && /\b(?:season|part|ova|oad|special|specials|movie|film)\b/i.test(alt)) {
            continue;
        }

        if (!primaryHasSub && /\s*[:—]\s*|\s+-\s+/.test(alt)) {
            alt = alt.split(/\s*[:—]\s*|\s+-\s+/)[0].trim();
        }

        const altClean = cleanTitle(alt).toLowerCase();
        if (altClean.length < 2 || seenClean.has(altClean)) continue;

        seenClean.add(altClean);
        aliases.push(alt);
        if (aliases.length >= 5) break;
    }

    const meta = { title, origTitle, year, isAnimation, aliases };
    cacheSet(tmdbCache, cacheKey, meta);
    return meta;
}

function parseQuality(str) {
    const s = (str || "").toLowerCase();
    if (s.includes("1080p")) return "1080p";
    if (s.includes("720p")) return "720p";
    if (s.includes("2160p") || /\b4k\b/.test(s) || s.includes("uhd")) return "2160p";
    if (s.includes("1440p") || s.includes("2k")) return "1440p";
    if (s.includes("480p")) return "480p";
    return "hd";
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(2) + " GB";
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(0) + " MB";
}

function getSortTag(rank) {
    const inv = Math.max(0, MAX_RANK - rank);
    let bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    return bin.split("").map(b => b === "1" ? "\uFEFF" : "\u200B").join("");
}

function cleanTitle(str) {
    return (str || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and")
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripArticles(str) {
    return (str || "")
        .replace(/^(?:the|a|an)\s+/i, "")
        .trim();
}

function extractFolderTitle(path) {
    const parts = decodeURIComponent(path).split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const match = p.match(/^([^(]+?)\s*(?:\((?:(?:TV\s*)?(?:Series|Cartoon|Mini\s*Series)\s*)?\d{4}|\(\d{4}\)|\d{4}\b)/i);
        if (match) {
            return cleanTitle(match[1]).toLowerCase();
        }
    }
    const last = parts.pop() || "";
    return cleanTitle(last.replace(/\.(mkv|mp4|avi)$/i, "")).toLowerCase();
}

function buildSearchQueries(title) {
    const raw = (title || "").trim();
    if (!raw) return [];

    const queries = new Set();

    // Normalized title without apostrophe-s (e.g. "JoJo's" -> "JoJo")
    const deApos = raw.replace(/['\u2019]s\b/gi, "");
    const words = deApos.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

    // 1. Regex query matching words
    if (words.length > 0) {
        if (words.every(w => w.length <= 2)) {
            queries.add(`\\b${words.join("[-_ .]+")}\\b`);
        } else {
            queries.add(words.join(".*"));
        }
    }

    // 2. Hyphenated compound words preserved (e.g. "K-On", "Spider-Man", "X-Men")
    const hyphens = raw.match(/\b[a-zA-Z0-9]+-[a-zA-Z0-9]+\b/g);
    if (hyphens) {
        hyphens.forEach(h => queries.add(h));
    }

    // 3. Subtitle splitting on colon, em-dash, or spaced hyphen (" - ")
    const subParts = raw.split(/\s*[:\u2014]\s*|\s+-\s+/).map(s => s.trim()).filter(Boolean);
    if (subParts.length > 1) {
        const main = subParts[0].replace(/['\u2019]s\b/gi, "");
        const mainWords = main.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        if (mainWords.length > 0) {
            queries.add(mainWords.join(".*"));
        }
        const sub = subParts[subParts.length - 1].replace(/['\u2019]s\b/gi, "");
        const subWords = sub.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        if (subWords.length > 0) {
            queries.add(subWords.join(".*"));
        }
    }

    // 4. Without articles ("The", "A", "An")
    const withoutArticle = raw.replace(/^(?:the|a|an)\s+/i, "").trim().replace(/['\u2019]s\b/gi, "");
    if (withoutArticle && withoutArticle !== raw) {
        const noArtWords = withoutArticle.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        if (noArtWords.length > 0) {
            queries.add(noArtWords.join(".*"));
        }
    }

    // 5. Clean literal string as fallback
    if (words.length > 0) {
        queries.add(words.join(" "));
    }

    return Array.from(queries);
}

function extractSequelTokens(title) {
    let s = (title || "").replace(/\b(?:19\d{2}|20[0-2]\d)\b/g, " ");
    s = s.replace(/\b(?:2160p|1080p|720p|480p|576p|360p|4k|2k|uhd|fhd|hd)\b/gi, " ");
    s = s.replace(/\b(?:10bit|8bit|12bit|10-bit|8-bit)\b/gi, " ");
    const tokens = [];
    const numMatches = s.match(/\b\d+\b/g);
    if (numMatches) tokens.push(...numMatches);
    const romanMatches = s.match(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi);
    if (romanMatches) tokens.push(...romanMatches.map(r => r.toLowerCase()));
    return tokens.sort().join(",");
}

function matchesMovieTitle(itemHref, targetTitle) {
    const folderTitle = extractFolderTitle(itemHref);
    const cleanedTarget = cleanTitle(targetTitle).toLowerCase();
    if (!folderTitle || !cleanedTarget) return false;
    if (folderTitle === cleanedTarget) return true;
    if (stripArticles(folderTitle) === stripArticles(cleanedTarget)) return true;

    // Check sequel/number tokens (e.g. Steins;Gate vs Steins;Gate 0)
    const tTokens = extractSequelTokens(cleanedTarget);
    const fTokens = extractSequelTokens(folderTitle);
    if (tTokens !== fTokens) return false;

    const fWords = folderTitle.split(/\s+/).filter(Boolean);
    const tWords = cleanedTarget.split(/\s+/).filter(Boolean);
    const fWordSet = new Set(fWords);
    const tWordSet = new Set(tWords);
    if (tWords.length > 1 && tWords.every(w => fWordSet.has(w))) return true;
    if (fWords.length > 1 && fWords.every(w => tWordSet.has(w))) return true;

    return false;
}

function matchesMovieYear(lowerPath, year) {
    if (!year) return true;
    const y = parseInt(year, 10);
    if (isNaN(y)) return true;
    // Allow +/- 1 year tolerance for release date discrepancies
    const acceptable = [String(y), String(y - 1), String(y + 1)];
    return acceptable.some(val => lowerPath.includes(val));
}

function extractTvFolderInfo(path) {
    const parts = decodeURIComponent(path).split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const match = p.match(/^([^(]+?)\s*\((?:(?:TV\s*)?(?:Series|Cartoon|Mini\s*Series)\s*)?(\d{4})(?:[–\-](\d{4})?)?/i);
        if (match) {
            const rawTitle = match[1].trim();
            const baseTitle = rawTitle.split(/\s*[:—]\s*|\s+-\s+/)[0].trim();
            return {
                title: cleanTitle(rawTitle).toLowerCase(),
                baseTitle: cleanTitle(baseTitle).toLowerCase(),
                startYear: match[2],
                endYear: match[3] || null,
            };
        }
    }
    return null;
}

function matchesTvFolder(path, targetTitle, targetYear, serverId) {
    const info = extractTvFolderInfo(path);
    if (!info) {
        return matchesMovieTitle(path, targetTitle);
    }
    const cleanedTarget = cleanTitle(targetTitle).toLowerCase();
    const targetBase = cleanTitle(targetTitle.split(/\s*[:—]\s*|\s+-\s+/)[0]).toLowerCase();

    // Sequel tokens must match (e.g. Steins;Gate vs Steins;Gate 0)
    const tTokens = extractSequelTokens(cleanedTarget);
    const fTokens = extractSequelTokens(info.title);
    if (tTokens !== fTokens) return false;

    // Check if years align when matching target base title (e.g. Code Geass vs Code Geass: Lelouch of the Rebellion)
    const yearsAlign = targetYear && info.startYear ?
        Math.abs(parseInt(targetYear, 10) - parseInt(info.startYear, 10)) <= 1 : false;

    const titleOk = (info.title === cleanedTarget) ||
                    (info.baseTitle === cleanedTarget) ||
                    (info.title === targetBase && yearsAlign) ||
                    (info.baseTitle === targetBase && yearsAlign) ||
                    (stripArticles(info.title) === stripArticles(cleanedTarget)) ||
                    (stripArticles(info.baseTitle) === stripArticles(cleanedTarget)) ||
                    (stripArticles(info.title) === stripArticles(targetBase) && yearsAlign) ||
                    (stripArticles(info.baseTitle) === stripArticles(targetBase) && yearsAlign) ||
                    matchesMovieTitle(path, targetTitle);
    if (!titleOk) return false;

    // Special case for Bleach TYBW folder when queried under classic Bleach S2
    const isTybw = /thousand|tybw/i.test(path);
    if (serverId === "df10" && isTybw) {
        return true;
    }

    if (targetYear && info.startYear) {
        const ty = parseInt(targetYear, 10);
        const sy = parseInt(info.startYear, 10);
        const ey = info.endYear ? parseInt(info.endYear, 10) : sy;
        if (!isNaN(ty) && !isNaN(sy)) {
            if (ty < sy - 1 || ty > ey + 1) return false;
        }
    }
    return true;
}

function extractSeasonFromPath(path) {
    const decoded = decodeURIComponent(path || "");
    const filename = decoded.split("/").filter(Boolean).pop() || "";

    // 1. Filename SxxExx or Sxx
    const fnMatch = filename.match(/\bS(\d{1,2})[._ -]?(?:E\d+|x\d+|\b)/i);
    if (fnMatch) return parseInt(fnMatch[1], 10);

    // 2. Directory Season X or Series X
    const dirMatch = decoded.match(/(?:^|\/)(?:Season|Series)[._ -]?(\d{1,2})(?:[^\/]*)\//i);
    if (dirMatch) return parseInt(dirMatch[1], 10);

    // 3. Short directory /S\d+/
    const shortDirMatch = decoded.match(/(?:^|\/)S(\d{1,2})\//i);
    if (shortDirMatch) return parseInt(shortDirMatch[1], 10);

    return null;
}

function cleanFilenameForEp(fn, targetTitle) {
    let s = fn.replace(/\.(mkv|mp4|avi|webm|ts|m4v)$/i, "");
    s = s.replace(/\[[^\]]+\]/g, " ");
    if (targetTitle) {
        const titles = Array.isArray(targetTitle) ? targetTitle : [targetTitle];
        for (const t of titles) {
            const titleNums = t ? String(t).match(/\d+/g) : null;
            if (titleNums) {
                titleNums.forEach(n => {
                    s = s.replace(new RegExp(`(?<![0-9])${n}(?![0-9])`, "g"), " ");
                });
            }
        }
    }
    s = s.replace(/\b(?:2160p|1080p|720p|480p|576p|360p|4k|2k|uhd|fhd|hd)\b/gi, " ");
    s = s.replace(/\b(?:10bit|8bit|12bit|10-bit|8-bit)\b/gi, " ");
    s = s.replace(/\b(?:7\.1|5\.1|2\.0|1\.0)\b/g, " ");
    s = s.replace(/\b(?:x264|x265|h264|h265|hevc|avc|av1|vc1|aac|ac3|eac3|ddp|dts|truehd|flac|mp3|opus)\b/gi, " ");
    s = s.replace(/\b(?:bluray|blu-ray|bdrip|brrip|webrip|web-rip|web-dl|webdl|hdtv|remux|proper|repack)\b/gi, " ");
    s = s.replace(/\b(?:dual[._ -]?audio|multi[._ -]?audio|hindi|english|japanese|bangla|bengali|esub|msubs?|sub|dub|dubbed)\b/gi, " ");
    s = s.replace(/\b(?:19|20)\d{2}\b/g, " ");
    return s.trim();
}

function passesEpisodeFilter(pathOrFilename, season, episode, allowAbsolute, targetTitle) {
    const raw = decodeURIComponent(pathOrFilename || "");
    const filename = raw.split("/").filter(Boolean).pop() || "";
    const pathSeason = extractSeasonFromPath(raw);

    if (!allowAbsolute) {
        if (pathSeason !== null && pathSeason !== season) {
            return false;
        }
    }

    // Reject specials and OVAs when requesting regular seasons (season > 0)
    if (season > 0 && /(?:^|[^a-zA-Z0-9])(?:special|specials|ova|oad|sp)(?:[^a-zA-Z0-9]|$)/i.test(filename)) {
        return false;
    }

    const s = String(season).padStart(2, "0");
    const ep = String(episode);

    // 1. Explicit SxxExx or Sxx.Exx
    const p1 = new RegExp(`\\bs${s}[. _-]?e0*${ep}(?![0-9])`, "i");
    if (p1.test(filename)) return true;

    // 2. SxEE (e.g., 1x47)
    const p2 = new RegExp(`(?:^|[^a-zA-Z0-9])${season}x0*${ep}(?![0-9])`, "i");
    if (p2.test(filename)) return true;

    // 3. Exx or Episode xx (when file doesn't have a different season marker)
    const p3 = new RegExp(`(?:^|[^a-zA-Z0-9])(?:e|ep|episode)[._ -]?0*${ep}(?![0-9])`, "i");
    if (p3.test(filename)) {
        const fnSeason = filename.match(/\bS(\d{1,2})[._ -]?E\d+/i);
        if (fnSeason && parseInt(fnSeason[1], 10) !== season && !allowAbsolute) {
            return false;
        }
        return true;
    }

    // 4. Standalone episode number in cleaned filename
    const hasExplicitOtherEp = /(?:^|[^a-zA-Z0-9])(?:e|ep|episode)[._ -]?\d+/i.test(filename) ||
        /\bS\d{1,2}[._ -]?E\d+/i.test(filename);
    if (!hasExplicitOtherEp) {
        const cleaned = cleanFilenameForEp(filename, targetTitle);
        const pStandalone = new RegExp(`(?<![0-9])0*${ep}(?![0-9])`);
        if (pStandalone.test(cleaned)) {
            return true;
        }
    }

    // 5. Absolute cross-season fallback
    if (allowAbsolute) {
        const pAbs = new RegExp(`\\bs\\d+e0*${ep}(?![0-9])`, "i");
        if (pAbs.test(filename)) return true;
    }

    return false;
}

function extractAudioDetails(filename, href) {
    const raw = decodeURIComponent(filename + " " + href);
    const parts = [];

    const audioBracketMatch = raw.match(/\[(Dual Audio|Multi Audio|Hindi Dubbed|English Dubbed|Dubbed)[^\]]*\]\s*\[([^\]]+)\]/i);
    if (audioBracketMatch) {
        parts.push(audioBracketMatch[1]);
        parts.push(audioBracketMatch[2].replace(/\+/g, " + "));
    } else {
        const singleBracket = raw.match(/\[(Dual Audio|Multi Audio|Hindi Dubbed|English Dubbed|Hindi \+ English|[^\]]*Audio[^\]]*)\]/i);
        if (singleBracket) {
            parts.push(singleBracket[1]);
        } else {
            if (/dual[- ]?audio/i.test(raw)) parts.push("Dual Audio");
            else if (/multi[- ]?audio/i.test(raw)) parts.push("Multi Audio");

            const langs = [];
            if (/hindi/i.test(raw)) langs.push("Hindi");
            if (/english/i.test(raw)) langs.push("English");
            if (/japanese/i.test(raw)) langs.push("Japanese");
            if (/bangla|bengali/i.test(raw)) langs.push("Bangla");
            if (langs.length) parts.push(langs.join(" + "));
        }
    }

    let codec = "";
    for (const [re, label] of AUDIO_TABLE) {
        if (re.test(raw)) { codec = label; break; }
    }
    if (/\batmos\b/i.test(raw)) codec += (codec ? " " : "") + "Atmos";
    if (codec && !parts.some(p => p.includes(codec))) parts.push(codec);

    return parts.join(" • ") || "Original Audio";
}

function formatCleanTitle(filename) {
    let raw = decodeURIComponent(filename).replace(/\.(mkv|mp4|avi|webm|ts|m4v)$/i, "");

    // 1. Remove bracketed release group / uploader tags and metadata brackets [Toonworld4all], [Multi Audio], [1080p], etc.
    raw = raw.replace(/\[[^\]]+\]/g, " ");

    // 2. Normalize dots and underscores to spaces, preserving decimal numbers (e.g. 1.11, 2.0)
    let clean = raw.replace(/(?<!\d)\.|\.(?!\d)|_/g, " ").replace(/\s+/g, " ").trim();

    // 3. TV Series / Anime: SxxExx, SxEE, Exx, Episode xx
    let tvMatch = clean.match(/^(.*?)(?:\s*[-–]\s*|\s+)(S\d+[\s.-]*E\d+|\b\d{1,2}x\d+\b|\bE\d+\b|\bEpisode\s*\d+\b)/i);

    // 4. Anime standalone episode numbers: 'Title - 01', 'Title - 123', or 'Title 001 1080p'
    if (!tvMatch) {
        let animeMatch = clean.match(/^(.*?)\s*[-–]\s*(\d{1,4})(?:\b|\s+|$)/i);
        if (!animeMatch) {
            animeMatch = clean.match(/^(.*?)\s+(0\d{1,3}|\d{1,3})(?=\s+(?:2160p|1440p|1080p|720p|480p|web|bluray|bdrip|webrip|hdtv|x264|x265|hevc|10bit|multi|dual)|$)/i);
        }
        if (animeMatch) {
            const num = animeMatch[2];
            const parsed = parseInt(num, 10);
            const epFormatted = "E" + (parsed < 100 ? String(parsed).padStart(2, "0") : String(parsed));
            tvMatch = [animeMatch[0], animeMatch[1], epFormatted];
        }
    }

    if (tvMatch) {
        let title = tvMatch[1].replace(/[-–.:\s]+$/, "").trim();
        title = title.replace(/\s*\(\s*\)$/, "").replace(/\s*\($/, "").trim();
        let ep = tvMatch[2].replace(/\s+/g, " ").trim();
        if (/^s\d+[\s.-]*e\d+$/i.test(ep)) ep = ep.toUpperCase().replace(/[\s.-]+/g, "");
        else if (/^e\d+$/i.test(ep)) ep = ep.toUpperCase();
        return title + " • " + ep;
    }

    // 5. Movies: 4-digit release year
    const movieMatch = clean.match(/^(.*?)(?:\s*\(?((?:19\d{2}|20[0-2]\d))\)?)/i);
    if (movieMatch) {
        let title = movieMatch[1].replace(/[-–.:\s]+$/, "").trim();
        title = title.replace(/\s*\(\s*\)$/, "").replace(/\s*\($/, "").trim();
        const year = movieMatch[2];
        return title + " • " + year;
    }

    // 6. Fallback: cut before quality tags
    const parts = clean.split(/\b(?:2160p|1440p|1080p|720p|480p|web-?dl|bluray|bdrip|webrip|hdtv|x264|x265|hevc|10bit)\b/i);
    let fallback = parts[0].replace(/[-–.:\s]+$/, "").trim();
    fallback = fallback.replace(/\s*\(\s*\)$/, "").replace(/\s*\($/, "").trim();
    return fallback || clean;
}

function makeStream(item, serverUrl) {
    const filename = decodeURIComponent(item.href.split("/").filter(Boolean).pop() || "");
    const rawQuality = parseQuality(filename);
    const quality = rawQuality !== "hd" ? rawQuality : parseQuality(decodeURIComponent(item.href));
    const combined = (filename + " " + item.href).toLowerCase();

    let source = "WEB-DL";
    if (/\bbluray|bdrip\b/.test(combined)) source = "Blu-ray";
    else if (/\b(?:webrip|hdrip)\b/.test(combined)) source = "WEB-Rip";
    else if (/\bhdtv\b/.test(combined)) source = "HDTV";

    const isImax = /\bimax\b/.test(combined);
    const isHdr = /\bhdr10\+|hdr10p|hdr10|hdr\b/.test(combined) ? "HDR" : "";
    const isDv = /\b(?:dv|dolby\s*vision)\b/.test(combined) ? "DV" : "";
    const is10Bit = /\b10bit\b/.test(combined) ? "10Bit" : "";

    // TOP LINE: Resolution and video quality tags separated by bullets
    const qualityLabel = quality.toUpperCase();
    const topParts = [qualityLabel, source, isImax && "IMAX", isHdr, isDv, is10Bit].filter(Boolean);
    const topLine = topParts.join(" • ");

    // Line 2: Clean Title • Year / SxxExx
    const cleanTitle = formatCleanTitle(filename);

    // Line 3: Audio details (language, channels, Atmos)
    const audioDetails = extractAudioDetails(filename, item.href);

    // Line 4: File size
    const fileSize = formatBytes(item.size);

    const belowLines = [
        cleanTitle,
        audioDetails,
        fileSize
    ].filter(Boolean).join("\n");

    const rank = QUALITY_RANK[quality] ?? 0;
    const sortTag = getSortTag(rank);
    const fullUrl = `${serverUrl}${item.href}`;

    // Nuvio Mobile/PC prefixes 'quality' to Line 2, creating duplicate resolution.
    // Nuvio TV requires 'quality' to match 'name' to prevent appending '- Unknown'.
    // Detect Mobile/PC host functions (__plugin_sleep, __crypto_md5) to only pass quality on TV.
    const isMobileOrPC = typeof __plugin_sleep !== "undefined" || typeof __crypto_md5 !== "undefined";

    const stream = {
        name: sortTag + topLine,
        title: cleanTitle,
        size: belowLines,
        url: fullUrl,
        headers: { "User-Agent": HEADERS["User-Agent"] },
        _rank: rank,
        _size: item.size || 0,
    };

    if (!isMobileOrPC) {
        stream.quality = qualityLabel;
    }

    return stream;
}

async function h5aiSearch(server, pattern, href) {
    const targetHref = href || server.root;
    const data = await httpPost(`${server.url}${targetHref}`, {
        action: "get",
        search: {
            href: targetHref,
            ignorecase: true,
            pattern: pattern,
        },
    });
    return (data && Array.isArray(data.search)) ? data.search : [];
}

async function searchInsideTvFolders(server, foldersToRecurse, season, episode, targetTitle) {
    const sPad = String(season).padStart(2, "0");
    const epPad = String(episode);
    const isAnimeServer = (server.id === "df10");
    const titleList = Array.isArray(targetTitle) ? targetTitle : [targetTitle];
    const isBleach = titleList.some(t => /bleach/i.test(t));
    const isTybw = isAnimeServer && (titleList.some(t => /thousand|tybw/i.test(t)) || (isBleach && (season === 2 || season === 17)));

    const subSearches = foldersToRecurse.map(async (folderHref) => {
        const isTybwFolder = /thousand|tybw/i.test(folderHref);

        // When watching classic Bleach Season 1, skip standalone TYBW folder
        if (isAnimeServer && !isTybw && isTybwFolder) return [];

        if (isTybw) {
            // TYBW episode: search S17 (Folder 1), S01 (Folder 2), or absolute E<ep> matching TYBW
            const tybwPatterns = [`S17E0*${epPad}(?![0-9])`, `S01E0*${epPad}(?![0-9])`, `E0*${epPad}(?![0-9])`];
            for (const pat of tybwPatterns) {
                const tybwMatches = await h5aiSearch(server, pat, folderHref);
                const tybwFiles = tybwMatches.filter(item => {
                    const path = decodeURIComponent(item.href);
                    const fn = path.split("/").pop();
                    const isTybwFile = /thousand|tybw/i.test(path);
                    const epRegex = new RegExp(`e0*${epPad}(?![0-9])`, "i");
                    return /\.(mkv|mp4|avi)$/i.test(path) &&
                        isTybwFile &&
                        epRegex.test(fn) &&
                        !path.toLowerCase().includes("/specials/");
                });
                if (tybwFiles.length > 0) {
                    return tybwFiles.map(item => makeStream(item, server.url));
                }
            }
            return [];
        }

        // Standard Season pattern SxxEyy
        const epPattern = `S${sPad}E0*${epPad}(?![0-9])`;
        const nestedMatches = await h5aiSearch(server, epPattern, folderHref);
        const epMatches = nestedMatches.filter(item => {
            const path = decodeURIComponent(item.href);
            return /\.(mkv|mp4|avi)$/i.test(path) &&
                passesEpisodeFilter(path, season, episode, false, targetTitle) &&
                !path.toLowerCase().includes("/specials/") &&
                !(isAnimeServer && /thousand|tybw/i.test(path));
        });

        if (epMatches.length > 0) {
            return epMatches.map(item => makeStream(item, server.url));
        }

        // If no strict SxxEyy matches, search by episode number within show folder
        const epNumPattern = `(?<![0-9])0*${epPad}(?![0-9])`;
        const numMatches = await h5aiSearch(server, epNumPattern, folderHref);

        // Tier 1: Strict Season Match (pathSeason === requestedSeason)
        const strictMatches = numMatches.filter(item => {
            const path = decodeURIComponent(item.href);
            return /\.(mkv|mp4|avi)$/i.test(path) &&
                passesEpisodeFilter(path, season, episode, false, targetTitle) &&
                !path.toLowerCase().includes("/specials/") &&
                !(isAnimeServer && /thousand|tybw/i.test(path));
        });

        if (strictMatches.length > 0) {
            return strictMatches.map(item => makeStream(item, server.url));
        }

        // Tier 2: Absolute Fallback for Anime only (e.g. Bleach S02E25 when season === 1)
        if (isAnimeServer) {
            const fallbackMatches = numMatches.filter(item => {
                const path = decodeURIComponent(item.href);
                return /\.(mkv|mp4|avi)$/i.test(path) &&
                    passesEpisodeFilter(path, season, episode, true, targetTitle) &&
                    !path.toLowerCase().includes("/specials/") &&
                    !(isAnimeServer && !isTybw && /thousand|tybw/i.test(path));
            });
            return fallbackMatches.map(item => makeStream(item, server.url));
        }

        return [];
    });

    const nestedStreams = await Promise.all(subSearches);
    return nestedStreams.flat();
}

async function searchTvEpisodes(server, query, season, episode, targetTitle, year) {
    const rootMatches = await h5aiSearch(server, query);
    if (!rootMatches.length) return { streams: [], folders: [] };

    const fileResults = [];
    const foldersToRecurse = [];
    const titleList = Array.isArray(targetTitle) ? targetTitle : [targetTitle];

    for (const item of rootMatches) {
        const decodedHref = decodeURIComponent(item.href);
        const lowerHref = decodedHref.toLowerCase();
        if (lowerHref.includes("/tutorial/") || lowerHref.includes("/documentary/") || lowerHref.includes("/wwe & aew") || lowerHref.includes("/awards & tv shows/")) continue;

        const isVideo = /\.(mkv|mp4|avi)$/i.test(decodedHref);

        if (isVideo) {
            const filename = decodedHref.split("/").pop();
            if (titleList.some(t => matchesTvFolder(decodedHref, t, year, server.id)) &&
                passesEpisodeFilter(decodedHref, season, episode, false, titleList) &&
                !decodedHref.toLowerCase().includes("/specials/")) {
                fileResults.push(makeStream(item, server.url));
            }
        } else if (item.href.endsWith("/")) {
            if (titleList.some(t => matchesTvFolder(decodedHref, t, year, server.id))) {
                foldersToRecurse.push(item.href);
            }
        }
    }

    // If folders exist, exclusively search inside show folders to ensure correct season/part matching
    if (foldersToRecurse.length === 0 && fileResults.length > 0) {
        return { streams: fileResults, folders: [] };
    }

    const nestedStreams = await searchInsideTvFolders(server, foldersToRecurse, season, episode, titleList);
    const combined = foldersToRecurse.length > 0 ? nestedStreams : fileResults;
    const seenHrefs = new Set();
    const uniqueStreams = combined.filter(s => !seenHrefs.has(s.url) && seenHrefs.add(s.url));
    return { streams: uniqueStreams, folders: foldersToRecurse };
}

async function searchMovies(server, query, targetTitle, year) {
    const matches = await h5aiSearch(server, query);
    if (!matches.length) return [];

    const streams = [];
    const seenHrefs = new Set();
    const foldersToInspect = [];
    const titleList = Array.isArray(targetTitle) ? targetTitle : [targetTitle];

    for (const item of matches) {
        const decoded = decodeURIComponent(item.href);
        const isVideo = /\.(mkv|mp4|avi)$/i.test(decoded);
        const lowerPath = decoded.toLowerCase();

        if (lowerPath.includes("tv-web-series") || lowerPath.includes("anime-tv series")) continue;
        if (lowerPath.includes("sample")) continue;

        if (isVideo) {
            if (titleList.some(t => matchesMovieTitle(item.href, t)) && matchesMovieYear(lowerPath, year)) {
                seenHrefs.add(item.href);
                streams.push(makeStream(item, server.url));
            }
        } else if (item.href.endsWith("/")) {
            if (titleList.some(t => matchesMovieTitle(item.href, t)) && matchesMovieYear(lowerPath, year)) {
                foldersToInspect.push(item.href);
            }
        }
    }

    if (foldersToInspect.length > 0) {
        const nestedTasks = foldersToInspect.map(async (folderHref) => {
            const files = await h5aiSearch(server, "mkv|mp4|avi", folderHref);
            return files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.href) && !f.href.toLowerCase().includes("sample"));
        });

        const nestedResults = await Promise.all(nestedTasks);
        for (const fileList of nestedResults) {
            for (const fileItem of fileList) {
                if (!seenHrefs.has(fileItem.href)) {
                    seenHrefs.add(fileItem.href);
                    streams.push(makeStream(fileItem, server.url));
                }
            }
        }
    }

    return streams;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) return [];

        const streamCacheKey = `${mediaType}:${tmdbId}:${season ?? 0}:${episode ?? 0}`;
        if (streamCache.has(streamCacheKey)) {
            return streamCache.get(streamCacheKey);
        }

        const meta = await getTmdbMeta(tmdbId, mediaType);
        if (!meta || !meta.title) return [];

        const candidateTitles = [meta.title];
        if (meta.origTitle && meta.origTitle !== meta.title) {
            candidateTitles.push(meta.origTitle);
        }
        if (Array.isArray(meta.aliases)) {
            for (const alt of meta.aliases) {
                if (!candidateTitles.includes(alt)) {
                    candidateTitles.push(alt);
                }
            }
        }

        // Fast-path: check TV folder cache for already discovered show folders (instant warm search)
        if (mediaType === "tv" && tvFolderCache.has(String(tmdbId))) {
            const cachedServerEntries = tvFolderCache.get(String(tmdbId));
            const subTasks = cachedServerEntries.map(async entry => {
                const s = SERVERS.find(srv => srv.id === entry.serverId);
                if (!s) return [];
                return searchInsideTvFolders(s, entry.folders, season, episode, candidateTitles);
            });
            const subResults = (await Promise.all(subTasks)).flat();
            if (subResults.length > 0) {
                const seenHrefs = new Set();
                const uniqueStreams = subResults.filter(s => !seenHrefs.has(s.url) && seenHrefs.add(s.url));
                uniqueStreams.sort((a, b) => (b._rank - a._rank) || ((b._size || 0) - (a._size || 0)));
                for (const s of uniqueStreams) {
                    delete s._rank;
                    delete s._size;
                }
                cacheSet(streamCache, streamCacheKey, uniqueStreams);
                return uniqueStreams;
            }
        }

        const queriesToTry = new Set();
        for (const t of candidateTitles) {
            for (const q of buildSearchQueries(t)) queriesToTry.add(q);
        }

        let targetServers;
        if (mediaType === "tv") {
            if (meta.isAnimation) {
                // Primary anime server (df10 hosts 99.9% of anime and cartoons)
                targetServers = [SERVERS.find(s => s.id === "df10")].filter(Boolean);
            } else {
                targetServers = SERVERS.filter(s => s.types.includes("tv") && s.id !== "df10");
            }
        } else {
            targetServers = SERVERS.filter(s => s.types.includes(mediaType));
        }

        const allStreams = [];
        const seenUrls = new Set();
        const discoveredFolders = [];

        for (const query of queriesToTry) {
            if (!query) continue;

            const tasks = targetServers.map(async server => {
                if (mediaType === "tv") {
                    const res = await searchTvEpisodes(server, query, season, episode, candidateTitles, meta.year);
                    if (res.folders && res.folders.length > 0) {
                        discoveredFolders.push({ serverId: server.id, folders: res.folders });
                    }
                    return res.streams;
                } else {
                    return searchMovies(server, query, candidateTitles, meta.year);
                }
            });

            const results = await Promise.all(tasks);
            for (const streamList of results) {
                for (const stream of streamList) {
                    if (!seenUrls.has(stream.url)) {
                        seenUrls.add(stream.url);
                        allStreams.push(stream);
                    }
                }
            }

            if (allStreams.length > 0) break;
        }

        // Fallback for animation if df10 didn't have it (e.g. western cartoons on df12/df14)
        if (mediaType === "tv" && meta.isAnimation && allStreams.length === 0) {
            const fallbackServers = SERVERS.filter(s => s.types.includes("tv") && s.id !== "df10");
            for (const query of queriesToTry) {
                if (!query) continue;

                const tasks = fallbackServers.map(async server => {
                    const res = await searchTvEpisodes(server, query, season, episode, candidateTitles, meta.year);
                    if (res.folders && res.folders.length > 0) {
                        discoveredFolders.push({ serverId: server.id, folders: res.folders });
                    }
                    return res.streams;
                });

                const results = await Promise.all(tasks);
                for (const streamList of results) {
                    for (const stream of streamList) {
                        if (!seenUrls.has(stream.url)) {
                            seenUrls.add(stream.url);
                            allStreams.push(stream);
                        }
                    }
                }

                if (allStreams.length > 0) break;
            }
        }

        if (discoveredFolders.length > 0) {
            cacheSet(tvFolderCache, String(tmdbId), discoveredFolders);
        }

        // Sort descending: highest resolution first, then largest file size
        allStreams.sort((a, b) => (b._rank - a._rank) || ((b._size || 0) - (a._size || 0)));
        for (const s of allStreams) {
            delete s._rank;
            delete s._size;
        }

        cacheSet(streamCache, streamCacheKey, allStreams);
        return allStreams;
    } catch {
        return [];
    }
}

module.exports = { getStreams };
