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

async function getTmdbMeta(tmdbId, mediaType) {
    const apiKey = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "01926d2187b6a5d861eefc750e9df3e3";
    if (!apiKey) return null;

    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const data = await httpGet(`${TMDB_API}/${endpoint}/${tmdbId}?api_key=${apiKey}`);
    if (!data) return null;

    const title = data.name || data.title || "";
    const origTitle = data.original_name || data.original_title || "";
    const releaseDate = data.release_date || data.first_air_date || "";
    const year = releaseDate ? releaseDate.slice(0, 4) : "";
    const isAnimation = Array.isArray(data.genres) && data.genres.some(g => g.id === 16);

    return { title, origTitle, year, isAnimation };
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
        const match = p.match(/^([^(]+?)\s*(?:\(\d{4}\)|\d{4}\b)/);
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
    const words = raw.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

    // 1. Regex query matching words with any separator (e.g. "Spider.*Man.*Brand.*New.*Day")
    if (words.length > 0) {
        queries.add(words.join(".*"));
    }

    // 2. If title has a colon, dash or hyphen, also add the subtitle part (e.g. "Brand New Day")
    const subParts = raw.split(/[:\-\—]/).map(s => s.trim()).filter(Boolean);
    if (subParts.length > 1) {
        const sub = subParts[subParts.length - 1];
        const subWords = sub.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        if (subWords.length > 0) {
            queries.add(subWords.join(".*"));
        }
    }

    // 3. Without articles ("The", "A", "An")
    const withoutArticle = raw.replace(/^(?:the|a|an)\s+/i, "").trim();
    if (withoutArticle && withoutArticle !== raw) {
        const noArtWords = withoutArticle.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        if (noArtWords.length > 0) {
            queries.add(noArtWords.join(".*"));
        }
    }

    // 4. Clean literal string as fallback
    if (words.length > 0) {
        queries.add(words.join(" "));
    }

    return Array.from(queries);
}

function matchesMovieTitle(itemHref, targetTitle) {
    const folderTitle = extractFolderTitle(itemHref);
    const cleanedTarget = cleanTitle(targetTitle).toLowerCase();
    if (!folderTitle || !cleanedTarget) return false;
    if (folderTitle === cleanedTarget) return true;
    if (stripArticles(folderTitle) === stripArticles(cleanedTarget)) return true;

    const fWords = folderTitle.split(/\s+/).filter(Boolean);
    const tWords = cleanedTarget.split(/\s+/).filter(Boolean);
    if (tWords.length > 1 && tWords.every(w => folderTitle.includes(w))) return true;
    if (fWords.length > 1 && fWords.every(w => cleanedTarget.includes(w))) return true;

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

function passesEpisodeFilter(filename, season, episode) {
    const s = String(season).padStart(2, "0");
    const e = String(episode).padStart(2, "0");
    const pattern = new RegExp(`s${s}[. _-]?e${e}|\\b${season}x${e}\\b|\\be${e}\\b|episode[._ -]?0?${episode}\\b`, "i");
    return pattern.test(filename);
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

    // TOP LINE: Resolution and video quality only (no DhakaFlix)
    const qualityLabel = quality.toUpperCase();
    const topParts = [qualityLabel, source, isImax && "IMAX", isHdr, isDv, is10Bit].filter(Boolean);
    const topLine = topParts.join(" • ");

    // BELOW: full release filename, audio track details, file size
    const audioDetails = extractAudioDetails(filename, item.href);
    const fileSize = formatBytes(item.size);

    const belowLines = [
        filename,
        audioDetails,
        fileSize
    ].filter(Boolean).join("\n");

    const rank = QUALITY_RANK[quality] ?? 0;
    const sortTag = getSortTag(rank);
    const fullUrl = `${serverUrl}${item.href}`;

    return {
        name: sortTag + topLine,
        title: filename,
        size: belowLines,
        url: fullUrl,
        headers: { "User-Agent": HEADERS["User-Agent"] },
    };
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

async function searchTvEpisodes(server, query, season, episode) {
    const rootMatches = await h5aiSearch(server, query);
    if (!rootMatches.length) return [];

    const fileResults = [];
    const foldersToRecurse = [];

    for (const item of rootMatches) {
        const decodedHref = decodeURIComponent(item.href);
        const isVideo = /\.(mkv|mp4|avi)$/i.test(decodedHref);

        if (isVideo) {
            const filename = decodedHref.split("/").pop();
            if (passesEpisodeFilter(filename, season, episode) && !decodedHref.toLowerCase().includes("/specials/")) {
                fileResults.push(makeStream(item, server.url));
            }
        } else if (item.href.endsWith("/")) {
            foldersToRecurse.push(item.href);
        }
    }

    if (fileResults.length > 0) return fileResults;

    const sPad = String(season).padStart(2, "0");
    const epPad = String(episode).padStart(2, "0");
    const epPattern = `S${sPad}E${epPad}`;

    const subSearches = foldersToRecurse.map(async (folderHref) => {
        const nestedMatches = await h5aiSearch(server, epPattern, folderHref);
        const epMatches = nestedMatches.filter(item => {
            const path = decodeURIComponent(item.href);
            return /\.(mkv|mp4|avi)$/i.test(path) && !path.toLowerCase().includes("/specials/");
        });

        if (epMatches.length > 0) {
            return epMatches.map(item => makeStream(item, server.url));
        }

        const fallbackMatches = await h5aiSearch(server, `E${epPad}`, folderHref);
        return fallbackMatches
            .filter(item => {
                const path = decodeURIComponent(item.href);
                return /\.(mkv|mp4|avi)$/i.test(path) &&
                    passesEpisodeFilter(path.split("/").pop(), season, episode) &&
                    !path.toLowerCase().includes("/specials/");
            })
            .map(item => makeStream(item, server.url));
    });

    const nestedStreams = await Promise.all(subSearches);
    return nestedStreams.flat();
}

async function searchMovies(server, query, targetTitle, year) {
    const matches = await h5aiSearch(server, query);
    if (!matches.length) return [];

    const streams = [];
    const seenHrefs = new Set();
    const foldersToInspect = [];

    for (const item of matches) {
        const decoded = decodeURIComponent(item.href);
        const isVideo = /\.(mkv|mp4|avi)$/i.test(decoded);
        const lowerPath = decoded.toLowerCase();

        if (lowerPath.includes("tv-web-series") || lowerPath.includes("anime-tv series")) continue;
        if (lowerPath.includes("sample")) continue;

        if (isVideo) {
            if (matchesMovieTitle(item.href, targetTitle) && matchesMovieYear(lowerPath, year)) {
                seenHrefs.add(item.href);
                streams.push(makeStream(item, server.url));
            }
        } else if (item.href.endsWith("/")) {
            if (matchesMovieTitle(item.href, targetTitle) && matchesMovieYear(lowerPath, year)) {
                foldersToInspect.push(item.href);
            }
        }
    }

    if (foldersToInspect.length > 0) {
        const nestedTasks = foldersToInspect.map(async (folderHref) => {
            const nested = await h5aiSearch(server, "mkv", folderHref);
            const mp4s = await h5aiSearch(server, "mp4", folderHref);
            return [...nested, ...mp4s].filter(f => /\.(mkv|mp4|avi)$/i.test(f.href) && !f.href.toLowerCase().includes("sample"));
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

        const meta = await getTmdbMeta(tmdbId, mediaType);
        if (!meta || !meta.title) return [];

        const queriesToTry = new Set();
        for (const q of buildSearchQueries(meta.title)) queriesToTry.add(q);
        if (meta.origTitle && meta.origTitle !== meta.title) {
            for (const q of buildSearchQueries(meta.origTitle)) queriesToTry.add(q);
        }

        const targetServers = SERVERS.filter(s => s.types.includes(mediaType));
        const allStreams = [];
        const seenUrls = new Set();

        for (const query of queriesToTry) {
            if (!query) continue;

            const tasks = targetServers.map(server => {
                if (mediaType === "tv") {
                    return searchTvEpisodes(server, query, season, episode);
                } else {
                    return searchMovies(server, query, meta.title, meta.year);
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

        return allStreams;
    } catch {
        return [];
    }
}

module.exports = { getStreams };
