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

const ANTHOLOGY_MAP = [
    {
        pattern: /dahmer/i,
        franchiseTitle: "Monster",
        franchiseYear: "2022",
        diskSeason: 1,
        arcPattern: "DAHMER",
    },
    {
        pattern: /menendez|lyle.*eri[ck]/i,
        franchiseTitle: "Monster",
        franchiseYear: "2022",
        diskSeason: 2,
        arcPattern: "Menendez",
    },
    {
        pattern: /ed\s*g[ea]in|gein/i,
        franchiseTitle: "Monster",
        franchiseYear: "2022",
        diskSeason: 3,
        arcPattern: "Ed Gein",
    },
    {
        pattern: /lizzie\s*borden/i,
        franchiseTitle: "Monster",
        franchiseYear: "2022",
        diskSeason: 4,
        arcPattern: "Lizzie Borden",
    },
    {
        pattern: /doctor who/i,
        yearPattern: /^202[4-9]/,
        franchiseTitle: "Doctor Who",
        franchiseYear: "2005",
        diskSeasonOffset: 13, // 2024 Season 1 -> disk Season 14
        arcPattern: "Doctor Who",
    },
];

function resolveAnthologySeason(titleList, requestedSeason, year) {
    const list = Array.isArray(titleList) ? titleList : [titleList];
    for (const t of list) {
        const entry = ANTHOLOGY_MAP.find(e => {
            if (!e.pattern.test(t)) return false;
            if (e.yearPattern && (!year || !e.yearPattern.test(String(year)))) return false;
            return true;
        });
        if (entry) {
            if (entry.diskSeasonOffset != null) {
                return requestedSeason + entry.diskSeasonOffset;
            }
            // When requested as Season 1 from a standalone miniseries, map to disk season
            if (requestedSeason === 1 && entry.diskSeason != null) return entry.diskSeason;
            return requestedSeason;
        }
    }
    return requestedSeason;
}

async function httpGet(url, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                headers: { "Accept": "application/json" },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) return await res.json();
        } catch {
            if (i < retries) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }
    return null;
}

async function httpPost(url, body, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: HEADERS,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(25000),
            });
            if (res.ok) return await res.json();
        } catch {
            if (i < retries) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }
    return null;
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
    const normType = (mediaType === "series" || mediaType === "tv") ? "tv" : "movie";
    let rawId = String(tmdbId || "").trim().replace(/^(?:series|movie|tv):/i, "").replace(/^tmdb:/i, "");
    if (rawId.includes(":")) rawId = rawId.split(":")[0];

    const cacheKey = `${normType}:${rawId}`;
    if (tmdbCache.has(cacheKey)) {
        return tmdbCache.get(cacheKey);
    }

    const apiKey = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "01926d2187b6a5d861eefc750e9df3e3";
    if (!apiKey) return null;

    let targetId = rawId;
    let targetType = normType;
    let cinemetaFallback = null;

    // Handle IMDb ID (e.g. "tt13207736")
    let cinemetaExtraTitle = null;
    if (typeof rawId === "string" && rawId.startsWith("tt")) {
        const findData = await httpGet(`${TMDB_API}/find/${rawId}?api_key=${apiKey}&external_source=imdb_id`);
        const found = normType === "tv" ? findData?.tv_results?.[0] : findData?.movie_results?.[0];
        if (found?.id) {
            targetId = found.id;
            targetType = normType;
            // Also check Cinemeta in background in case IMDb ID refers to a specific anime sub-arc (e.g. Bakemonogatari)
            try {
                const cmType = normType === "tv" ? "series" : "movie";
                const cmData = await httpGet(`https://v3-cinemeta.strem.io/meta/${cmType}/${rawId}.json`);
                if (cmData?.meta?.name) {
                    cinemetaExtraTitle = cmData.meta.name;
                }
            } catch {}
        } else {
            // Fallback to Cinemeta if TMDB /find returned no link
            const cmType = normType === "tv" ? "series" : "movie";
            const cmData = await httpGet(`https://v3-cinemeta.strem.io/meta/${cmType}/${rawId}.json`);
            if (cmData?.meta?.name) {
                cinemetaFallback = {
                    title: cmData.meta.name,
                    origTitle: cmData.meta.name,
                    year: (cmData.meta.year || cmData.meta.releaseInfo || "").slice(0, 4),
                    isAnimation: Array.isArray(cmData.meta.genres) && cmData.meta.genres.some(g => /anim/i.test(g)),
                    aliases: [],
                    seasonsMap: {},
                };
            }
        }
    }

    let meta = null;

    if (!cinemetaFallback) {
        const endpoint = targetType === "tv" ? "tv" : "movie";
        const data = await httpGet(`${TMDB_API}/${endpoint}/${targetId}?api_key=${apiKey}&append_to_response=alternative_titles`);
        if (!data) return null;

        const title = data.name || data.title || "";
        const origTitle = data.original_name || data.original_title || "";
        const releaseDate = data.release_date || data.first_air_date || "";
        const year = releaseDate ? releaseDate.slice(0, 4) : "";
        const isAnimation = Array.isArray(data.genres) && data.genres.some(g => g.id === 16);

        // Extract seasons map for anthologies and multi-arc shows (e.g. Bakemonogatari, Night Country, Versace)
        const seasonsMap = {};
        if (targetType === "tv" && Array.isArray(data.seasons)) {
            for (const s of data.seasons) {
                if (s.season_number != null && s.name) {
                    const sName = s.name.trim();
                    if (!/^(?:season|series|miniseries)\s*\d*$/i.test(sName) && !/^specials?$/i.test(sName)) {
                        seasonsMap[s.season_number] = sName;
                    }
                }
            }
        }

        const rawAlts = data.alternative_titles?.titles || data.alternative_titles?.results || [];
        const preferredRegions = new Set(["US", "GB", "CA", "AU", "JP", "KR", "IN", "BD"]);
        const primaryClean = cleanTitle(title).toLowerCase();
        const primaryTokens = extractSequelTokens(title);
        const hasSeasonOrArc = /\b(?:season|part|ova|oad|special|specials|movie|film)\b/i.test(title);
        const hasOrdinal = /\b\d+(?:st|nd|rd|th)\b/i.test(title);
        const primaryHasSub = /\s*[:—–]\s*|\s+-\s+/.test(title);

        const aliases = [];
        const seenClean = new Set();
        if (primaryClean) seenClean.add(primaryClean);
        const origClean = cleanTitle(origTitle).toLowerCase();
        if (origClean) seenClean.add(origClean);

        if (cinemetaExtraTitle) {
            const cmClean = cleanTitle(cinemetaExtraTitle).toLowerCase();
            if (cmClean && !seenClean.has(cmClean)) {
                seenClean.add(cmClean);
                aliases.push(cinemetaExtraTitle);
            }
        }

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

            if (!primaryHasSub && /\s*[:—–]\s*|\s+-\s+/.test(alt)) {
                alt = alt.split(/\s*[:—–]\s*|\s+-\s+/)[0].trim();
            }

            const altClean = cleanTitle(alt).toLowerCase();
            if (altClean.length < 2 || seenClean.has(altClean)) continue;

            seenClean.add(altClean);
            aliases.push(alt);
            if (aliases.length >= 5) break;
        }

        meta = { title, origTitle, year, isAnimation, aliases, seasonsMap };
    } else {
        meta = cinemetaFallback;
    }

    // Auto-enrich aliases with subtitle parts and anthology franchise info
    const fullTitles = [meta.title, meta.origTitle].filter(Boolean);
    for (const ft of fullTitles) {
        const subParts = ft.split(/\s*[:—–]\s*|\s+-\s+/).map(s => s.trim()).filter(Boolean);
        if (subParts.length > 1) {
            for (const sp of subParts) {
                const spClean = cleanTitle(sp).toLowerCase();
                if (spClean.length >= 2 && !meta.aliases.some(a => cleanTitle(a).toLowerCase() === spClean)) {
                    meta.aliases.push(sp);
                }
            }
        }
        for (const entry of ANTHOLOGY_MAP) {
            if (entry.pattern.test(ft)) {
                const fClean = cleanTitle(entry.franchiseTitle).toLowerCase();
                if (!meta.aliases.some(a => cleanTitle(a).toLowerCase() === fClean)) {
                    meta.aliases.push(entry.franchiseTitle);
                }
                break;
            }
        }
    }

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

function normalizePlural(str) {
    return (str || "").toLowerCase().replace(/\b([a-zA-Z]+)s\b/g, "$1");
}

function safeDecodeURIComponent(str) {
    if (!str) return "";
    try {
        return decodeURIComponent(str);
    } catch {
        return str;
    }
}

function extractFolderTitle(path) {
    const parts = safeDecodeURIComponent(path).split("/").filter(Boolean);
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

    // Check anthology map for high-priority targeted arc/franchise query
    for (const entry of ANTHOLOGY_MAP) {
        if (entry.pattern.test(raw)) {
            queries.add(entry.arcPattern);
            queries.add(entry.franchiseTitle);
            break;
        }
    }

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

    // 3. Subtitle splitting on colon, en-dash, em-dash, or spaced hyphen (" - ")
    const subParts = raw.split(/\s*[:\u2013\u2014]\s*|\s+-\s+/).map(s => s.trim()).filter(Boolean);
    if (subParts.length > 1) {
        for (const part of subParts) {
            const partClean = part.replace(/['\u2019]s\b/gi, "");
            const pWords = partClean.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
            if (pWords.length > 0) {
                queries.add(pWords.join(".*"));
                if (pWords.length === 1 && pWords[0].endsWith("s") && pWords[0].length > 3) {
                    queries.add(pWords[0].slice(0, -1));
                }
            }
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

    const wordNums = { "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10" };
    s = s.replace(/\b(?:part|volume|vol|chapter|season)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (_, w) => ` ${wordNums[w.toLowerCase()]} `);

    const tokens = [];
    const numMatches = s.match(/\b\d+\b/g);
    if (numMatches) tokens.push(...numMatches);
    const romanMatches = s.match(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi);
    if (romanMatches) tokens.push(...romanMatches.map(r => r.toLowerCase()));
    return tokens.sort().join(",");
}

const STOP_AND_EDITION_WORDS = new Set([
    "the", "a", "an", "and", "of", "in", "on", "to", "for", "with", "by", "at",
    "edition", "cut", "directors", "director", "extended", "unrated",
    "uncensored", "remastered", "restored", "criterion", "imax",
    "anniversary", "special", "repack", "proper", "redux", "final",
    "theatrical", "version", "deluxe", "collector", "collectors"
]);

function matchesMovieTitle(itemHref, targetTitle, targetYear) {
    if (targetYear && !matchesMovieYear(itemHref.toLowerCase(), targetYear)) {
        return false;
    }
    const folderTitle = extractFolderTitle(itemHref);
    const cleanedTarget = cleanTitle(targetTitle).toLowerCase();
    if (!folderTitle || !cleanedTarget) return false;
    if (folderTitle === cleanedTarget) return true;
    if (stripArticles(folderTitle) === stripArticles(cleanedTarget)) return true;
    if (normalizePlural(folderTitle) === normalizePlural(cleanedTarget)) return true;

    // Check sequel/number tokens (e.g. Steins;Gate vs Steins;Gate 0)
    const tTokens = extractSequelTokens(cleanedTarget);
    const fTokens = extractSequelTokens(folderTitle);
    if (tTokens !== fTokens) return false;

    const fWords = folderTitle.split(/\s+/).filter(Boolean);
    const tWords = cleanedTarget.split(/\s+/).filter(Boolean);
    const fWordSet = new Set(fWords);
    const tWordSet = new Set(tWords);

    // Extra words in folder must ONLY be edition or stop words
    const extraInFolder = fWords.filter(w => !tWordSet.has(w));
    const significantExtra = extraInFolder.filter(w => !STOP_AND_EDITION_WORDS.has(w));
    if (significantExtra.length > 0) return false;

    // Extra words in target must ONLY be stop or edition words
    const missingInFolder = tWords.filter(w => !fWordSet.has(w));
    const significantMissing = missingInFolder.filter(w => !STOP_AND_EDITION_WORDS.has(w));
    if (significantMissing.length > 0) return false;

    return true;
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
    const parts = safeDecodeURIComponent(path).split("/").filter(Boolean);
    let arcInfo = null;
    const segmentTitles = [];

    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];

        // Clean any leading index numbers: "1 - Bakemonogatari" -> "bakemonogatari"
        const cleanSeg = cleanTitle(p.replace(/^\d{1,2}\s*[-–._]\s*/, "")).toLowerCase();
        if (cleanSeg && !cleanSeg.startsWith("season ") && !cleanSeg.startsWith("anime tv series") && !cleanSeg.startsWith("tv series") && !cleanSeg.startsWith("dhaka flix")) {
            segmentTitles.push(cleanSeg);
        }

        // Check for Season (Arc Name) e.g. Season 2 (Monsters-The Lyle and Erik Menendez Story)
        const seasonArcMatch = p.match(/^Season\s*(\d+)\s*\(([^)]+)\)/i);
        if (seasonArcMatch && !arcInfo) {
            arcInfo = {
                season: parseInt(seasonArcMatch[1], 10),
                arcTitle: cleanTitle(seasonArcMatch[2]).toLowerCase(),
            };
        }

        // Broad year pattern matching TV Series, TV Cartoons, TV Mini-Series, TV Talk-Show, Reality, (2020), etc.
        const yearPattern = /\(\s*(?:(?:TV|Mini|Cartoon|Series|Serial|Talk|Reality)[^0-9()]*?)?(\d{4})\s*(?:([–\-])\s*(\d{4})?)?\s*\)/i;
        const match = p.match(yearPattern);
        if (match) {
            const prefix = p.slice(0, match.index).trim();
            const startYear = match[1];
            const hasDash = Boolean(match[2]);
            const endYear = match[3] || null;

            const mainMatch = prefix.match(/^([^(]+)/);
            const rawMainTitle = mainMatch ? mainMatch[1].trim() : prefix;
            const baseTitle = rawMainTitle.split(/\s*[:—–]\s*|\s+-\s+/)[0].trim();

            const parensMatches = prefix.match(/\(([^)]+)\)/g) || [];
            const aliases = parensMatches.map(m => cleanTitle(m.slice(1, -1)).toLowerCase()).filter(Boolean);

            // Subfolders strictly inside the show root (e.g. 1 - Bakemonogatari)
            for (let j = i + 1; j < parts.length; j++) {
                const subP = parts[j];
                if (!/\.(mkv|mp4|avi)$/i.test(subP) && !subP.toLowerCase().startsWith("season ")) {
                    const cleanSeg = cleanTitle(subP.replace(/^\d{1,2}\s*[-–._]\s*/, "")).toLowerCase();
                    if (cleanSeg) segmentTitles.push(cleanSeg);
                }
            }

            return {
                title: cleanTitle(rawMainTitle).toLowerCase(),
                fullPrefix: cleanTitle(prefix).toLowerCase(),
                baseTitle: cleanTitle(baseTitle).toLowerCase(),
                aliases,
                startYear,
                endYear,
                isOngoing: hasDash && !endYear,
                arcTitle: arcInfo?.arcTitle || null,
                arcSeason: arcInfo?.season || null,
                segmentTitles,
            };
        }
    }
    return null;
}

function matchesTvFolder(path, targetTitle, targetYear, serverId, isAnimation) {
    const info = extractTvFolderInfo(path);
    if (!info) {
        return matchesMovieTitle(path, targetTitle, targetYear);
    }
    const cleanedTarget = cleanTitle(targetTitle).toLowerCase();
    const targetBase = cleanTitle(targetTitle.split(/\s*[:—–]\s*|\s+-\s+/)[0]).toLowerCase();

    // Check arcTitle match (e.g. Season 2 (Monsters-The Lyle and Erik Menendez Story))
    let arcMatch = false;
    if (info.arcTitle) {
        if (info.arcTitle === cleanedTarget ||
            normalizePlural(info.arcTitle) === normalizePlural(cleanedTarget) ||
            (cleanedTarget.length > 5 && info.arcTitle.includes(cleanedTarget)) ||
            (info.arcTitle.length > 10 && info.arcTitle.includes(cleanedTarget))) {
            arcMatch = true;
        }
    }

    // Check subfolder / segment match (e.g. 1 - Bakemonogatari)
    if (!arcMatch && Array.isArray(info.segmentTitles)) {
        arcMatch = info.segmentTitles.some(seg =>
            seg === cleanedTarget ||
            normalizePlural(seg) === normalizePlural(cleanedTarget)
        );
    }

    // Check parenthetical aliases (e.g. La Casa de Papel for Money Heist, Boku Dake ga Inai Machi for Erased)
    if (!arcMatch && Array.isArray(info.aliases)) {
        arcMatch = info.aliases.some(alias =>
            alias === cleanedTarget ||
            normalizePlural(alias) === normalizePlural(cleanedTarget) ||
            (cleanedTarget.length > 5 && (alias.includes(cleanedTarget) || cleanedTarget.includes(alias)))
        );
    }

    // Sequel tokens must match (e.g. Steins;Gate vs Steins;Gate 0) unless it was an explicit arc/segment match
    if (!arcMatch) {
        const tTokens = extractSequelTokens(cleanedTarget);
        const fTokens = extractSequelTokens(info.title);
        if (tTokens !== fTokens) return false;
    }

    // Check if years align when matching target base title (e.g. Code Geass vs Code Geass: Lelouch of the Rebellion)
    const yearsAlign = targetYear && info.startYear ?
        Math.abs(parseInt(targetYear, 10) - parseInt(info.startYear, 10)) <= 1 : false;

    const titleOk = arcMatch ||
                    (info.title === cleanedTarget) ||
                    (info.fullPrefix === cleanedTarget) ||
                    (info.baseTitle === cleanedTarget) ||
                    (normalizePlural(info.title) === normalizePlural(cleanedTarget)) ||
                    (normalizePlural(info.fullPrefix) === normalizePlural(cleanedTarget)) ||
                    (normalizePlural(info.baseTitle) === normalizePlural(targetBase) && (yearsAlign || info.isOngoing)) ||
                    (info.title === targetBase && (yearsAlign || info.isOngoing)) ||
                    (info.baseTitle === targetBase && (yearsAlign || info.isOngoing)) ||
                    (stripArticles(info.title) === stripArticles(cleanedTarget)) ||
                    (stripArticles(info.fullPrefix) === stripArticles(cleanedTarget)) ||
                    (stripArticles(info.baseTitle) === stripArticles(cleanedTarget)) ||
                    (stripArticles(info.title) === stripArticles(targetBase) && (yearsAlign || info.isOngoing)) ||
                    (stripArticles(info.baseTitle) === stripArticles(targetBase) && (yearsAlign || info.isOngoing)) ||
                    matchesMovieTitle(path, targetTitle, targetYear);
    if (!titleOk) return false;

    // Special case for Bleach TYBW folder when queried under classic Bleach S2
    const isTybw = /thousand|tybw/i.test(path);
    if (serverId === "df10" && isTybw) {
        return true;
    }

    // If searching animation on a non-anime fallback server (DF12/DF14), prevent live action match if years don't align strictly
    if (isAnimation && serverId !== "df10") {
        const lowerPath = safeDecodeURIComponent(path).toLowerCase();
        const isCart = lowerPath.includes("cartoon") || lowerPath.includes("anime") || lowerPath.includes("animation");
        if (!isCart && targetYear && info.startYear) {
            if (parseInt(targetYear, 10) !== parseInt(info.startYear, 10)) {
                return false;
            }
        }
    }

    if (targetYear && info.startYear) {
        const ty = parseInt(targetYear, 10);
        const sy = parseInt(info.startYear, 10);
        const ey = info.endYear ? parseInt(info.endYear, 10) : sy;
        if (!isNaN(ty) && !isNaN(sy)) {
            if (ty < sy - 1) return false;
            if (!info.isOngoing && ty > ey + 1) return false;
        }
    }
    return true;
}

function extractSeasonFromPath(path) {
    const decoded = safeDecodeURIComponent(path || "");
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

function passesEpisodeFilter(pathOrFilename, season, episode, allowAbsolute, targetTitle, competingArcs) {
    const raw = safeDecodeURIComponent(pathOrFilename || "");
    const filename = raw.split("/").filter(Boolean).pop() || "";
    const pathSeason = extractSeasonFromPath(raw);

    // If the path explicitly belongs to a different season, reject it!
    // Absolute cross-season fallback is only allowed for high episode numbers (> 24) where seasons are split continuously
    if (pathSeason !== null && pathSeason !== season) {
        if (!allowAbsolute || parseInt(episode, 10) <= 24) {
            return false;
        }
    }

    // Reject specials and OVAs when requesting regular seasons (season > 0)
    if (season > 0 && /(?:^|[^a-zA-Z0-9])(?:special|specials|ova|oad|sp)(?:[^a-zA-Z0-9]|$)/i.test(filename)) {
        return false;
    }

    // Reject files that belong to a competing arc in an anthology or franchise (e.g. Nisemonogatari leaking into Bakemonogatari)
    if (Array.isArray(competingArcs) && competingArcs.length > 0) {
        const lowerRaw = raw.toLowerCase();
        for (const comp of competingArcs) {
            const compClean = cleanTitle(comp).toLowerCase();
            const compWords = compClean.split(/\s+/).filter(w => w.length > 3 && !/^(?:season|series|the|and|part|miniseries)$/i.test(w));
            if (compWords.length > 0) {
                const compRegex = new RegExp(`\\b(?:${compWords.join("|")})\\b`, "i");
                if (compRegex.test(lowerRaw)) {
                    const titles = Array.isArray(targetTitle) ? targetTitle : [targetTitle];
                    const allowed = titles.some(t => compRegex.test(cleanTitle(t).toLowerCase()));
                    if (!allowed) {
                        return false;
                    }
                }
            }
        }
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

    // 5. Absolute cross-season fallback (only for high episode counts where seasons are split)
    if (allowAbsolute && parseInt(episode, 10) > 24) {
        const pAbs = new RegExp(`\\bs\\d+e0*${ep}(?![0-9])`, "i");
        if (pAbs.test(filename)) return true;
    }

    return false;
}

function extractAudioDetails(filename, href) {
    const raw = safeDecodeURIComponent(filename + " " + href);
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
    let raw = safeDecodeURIComponent(filename).replace(/\.(mkv|mp4|avi|webm|ts|m4v)$/i, "");

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
    const filename = safeDecodeURIComponent(item.href.split("/").filter(Boolean).pop() || "");
    const rawQuality = parseQuality(filename);
    const quality = rawQuality !== "hd" ? rawQuality : parseQuality(safeDecodeURIComponent(item.href));
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

async function searchInsideTvFolders(server, foldersToRecurse, season, episode, targetTitle, targetArc, competingArcs, year) {
    const sPad = String(season).padStart(2, "0");
    const epPad = String(episode);
    const isAnimeServer = (server.id === "df10");
    const titleList = Array.isArray(targetTitle) ? targetTitle : [targetTitle];
    const isBleach = titleList.some(t => /bleach/i.test(t));
    const isTybw = isAnimeServer && (titleList.some(t => /thousand|tybw/i.test(t)) || (isBleach && (season === 2 || season === 17)));

    const effectiveSeason = resolveAnthologySeason(titleList, season, year);
    const effSPad = String(effectiveSeason).padStart(2, "0");

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
                    const path = safeDecodeURIComponent(item.href);
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

        // Standard Season patterns (use mapped effective season if from an anthology)
        const targetSeason = effectiveSeason;
        const targetSPad = String(targetSeason).padStart(2, "0");
        const seasonPatterns = [`S${targetSPad}E0*${epPad}(?![0-9])`];

        for (const epPattern of seasonPatterns) {
            const nestedMatches = await h5aiSearch(server, epPattern, folderHref);
            const epMatches = nestedMatches.filter(item => {
                const path = safeDecodeURIComponent(item.href);
                return /\.(mkv|mp4|avi)$/i.test(path) &&
                    passesEpisodeFilter(path, targetSeason, episode, false, targetTitle, competingArcs) &&
                    !path.toLowerCase().includes("/specials/") &&
                    !(isAnimeServer && /thousand|tybw/i.test(path));
            });

            if (epMatches.length > 0) {
                return epMatches.map(item => makeStream(item, server.url));
            }
        }

        // If no strict SxxEyy matches, search by episode number within show folder
        const epNumPattern = `(?<![0-9])0*${epPad}(?![0-9])`;
        const numMatches = await h5aiSearch(server, epNumPattern, folderHref);

        // Tier 1: Strict Season Match (pathSeason === targetSeason)
        const strictMatches = numMatches.filter(item => {
            const path = safeDecodeURIComponent(item.href);
            return /\.(mkv|mp4|avi)$/i.test(path) &&
                passesEpisodeFilter(path, targetSeason, episode, false, targetTitle, competingArcs) &&
                !path.toLowerCase().includes("/specials/") &&
                !(isAnimeServer && /thousand|tybw/i.test(path));
        });

        if (strictMatches.length > 0) {
            return strictMatches.map(item => makeStream(item, server.url));
        }

        // Tier 2: Absolute Fallback for Anime only (e.g. Bleach S02E25 when season === 1)
        if (isAnimeServer) {
            const fallbackMatches = numMatches.filter(item => {
                const path = safeDecodeURIComponent(item.href);
                return /\.(mkv|mp4|avi)$/i.test(path) &&
                    passesEpisodeFilter(path, season, episode, true, targetTitle, competingArcs) &&
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

async function searchTvEpisodes(server, query, season, episode, targetTitle, year, isAnimation, targetArc, competingArcs) {
    const rootMatches = await h5aiSearch(server, query);
    if (!rootMatches.length) return { streams: [], folders: [] };

    const fileResults = [];
    const foldersToRecurse = [];
    const titleList = Array.isArray(targetTitle) ? targetTitle : [targetTitle];
    const effectiveSeason = resolveAnthologySeason(titleList, season, year);

    for (const item of rootMatches) {
        const decodedHref = safeDecodeURIComponent(item.href);
        const lowerHref = decodedHref.toLowerCase();
        if (lowerHref.includes("/tutorial/") || lowerHref.includes("/documentary/") || lowerHref.includes("/wwe & aew") || lowerHref.includes("/awards & tv shows/")) continue;

        const isVideo = /\.(mkv|mp4|avi)$/i.test(decodedHref);

        if (isVideo) {
            const filename = decodedHref.split("/").pop();
            if (titleList.some(t => matchesTvFolder(decodedHref, t, year, server.id, isAnimation)) &&
                passesEpisodeFilter(decodedHref, effectiveSeason, episode, false, titleList, competingArcs) &&
                !decodedHref.toLowerCase().includes("/specials/")) {
                fileResults.push(makeStream(item, server.url));
            }
        } else if (item.href.endsWith("/")) {
            if (titleList.some(t => matchesTvFolder(decodedHref, t, year, server.id, isAnimation))) {
                foldersToRecurse.push(item.href);
            }
        }
    }

    // If any folder is a specific subfolder matching targetArc or targetTitle, prioritize specific subfolder over parent container
    const specificFolders = foldersToRecurse.filter(f => {
        const decoded = safeDecodeURIComponent(f).toLowerCase();
        if (targetArc) {
            const ca = cleanTitle(targetArc).toLowerCase();
            if (ca.length > 3 && decoded.includes(ca)) return true;
        }
        return titleList.some(t => {
            const ct = cleanTitle(t).toLowerCase();
            return ct.length > 3 && decoded.includes(ct);
        });
    });
    const candidateFolders = specificFolders.length > 0 ? specificFolders : foldersToRecurse;

    // Prune redundant subfolders:
    // If specific subfolders exist (e.g. child folders), discard any broader parent folder that encompasses them
    const prunedFolders = [];
    const sortedFolders = [...candidateFolders].sort((a, b) => b.length - a.length);
    for (const f of sortedFolders) {
        if (!prunedFolders.some(selected => selected !== f && selected.startsWith(f))) {
            prunedFolders.push(f);
        }
    }

    // If folders exist, exclusively search inside show folders to ensure correct season/part matching
    if (prunedFolders.length === 0 && fileResults.length > 0) {
        return { streams: fileResults, folders: [] };
    }

    const nestedStreams = await searchInsideTvFolders(server, prunedFolders, season, episode, titleList, targetArc, competingArcs, year);
    const combined = prunedFolders.length > 0 ? nestedStreams : fileResults;
    const seenHrefs = new Set();
    const uniqueStreams = combined.filter(s => !seenHrefs.has(s.url) && seenHrefs.add(s.url));
    return { streams: uniqueStreams, folders: prunedFolders };
}

async function searchMovies(server, query, targetTitle, year, isAnimation) {
    const matches = await h5aiSearch(server, query);
    if (!matches.length) return [];

    const streams = [];
    const seenHrefs = new Set();
    const foldersToInspect = [];
    const titleList = Array.isArray(targetTitle) ? targetTitle : [targetTitle];

    for (const item of matches) {
        const decoded = safeDecodeURIComponent(item.href);
        const isVideo = /\.(mkv|mp4|avi)$/i.test(decoded);
        const lowerPath = decoded.toLowerCase();

        if (lowerPath.includes("tv-web-series") || lowerPath.includes("anime-tv series")) continue;
        if (lowerPath.includes("sample")) continue;
        if (isAnimation === false && (lowerPath.includes("animation movies") || lowerPath.includes("/anime/"))) continue;

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
        const normType = (mediaType === "series" || mediaType === "tv") ? "tv" : "movie";
        let rawId = String(tmdbId || "").trim().replace(/^(?:series|movie|tv):/i, "").replace(/^tmdb:/i, "");
        let cleanId = rawId;
        let reqSeason = season != null ? parseInt(season, 10) : null;
        let reqEpisode = episode != null ? parseInt(episode, 10) : null;

        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            cleanId = parts[0];
            if (reqSeason == null && parts[1]) reqSeason = parseInt(parts[1], 10);
            if (reqEpisode == null && parts[2]) reqEpisode = parseInt(parts[2], 10);
        }

        if (normType === "tv" && (reqSeason == null || reqEpisode == null)) return [];

        const streamCacheKey = `${normType}:${cleanId}:${reqSeason ?? 0}:${reqEpisode ?? 0}`;
        if (streamCache.has(streamCacheKey)) {
            return streamCache.get(streamCacheKey);
        }

        const meta = await getTmdbMeta(cleanId, normType);
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

        let targetArc = null;
        let competingArcs = [];
        if (normType === "tv" && reqSeason != null && meta.seasonsMap) {
            if (meta.seasonsMap[reqSeason]) {
                targetArc = meta.seasonsMap[reqSeason];
                if (!candidateTitles.includes(targetArc)) {
                    candidateTitles.unshift(targetArc);
                } else {
                    candidateTitles.splice(candidateTitles.indexOf(targetArc), 1);
                    candidateTitles.unshift(targetArc);
                }
            }
            competingArcs = Object.entries(meta.seasonsMap)
                .filter(([sn]) => parseInt(sn, 10) !== reqSeason)
                .map(([, name]) => name);
        }

        // Fast-path: check TV folder cache for already discovered show folders (instant warm search)
        if (normType === "tv" && tvFolderCache.has(String(cleanId))) {
            const cachedServerEntries = tvFolderCache.get(String(cleanId));
            const subTasks = cachedServerEntries.map(async entry => {
                const s = SERVERS.find(srv => srv.id === entry.serverId);
                if (!s) return [];
                return searchInsideTvFolders(s, entry.folders, reqSeason, reqEpisode, candidateTitles, targetArc, competingArcs, meta.year);
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
        if (normType === "tv") {
            if (meta.isAnimation) {
                // Primary anime server (df10 hosts 99.9% of anime and cartoons)
                targetServers = [SERVERS.find(s => s.id === "df10")].filter(Boolean);
            } else {
                targetServers = SERVERS.filter(s => s.types.includes("tv") && s.id !== "df10");
            }
        } else {
            targetServers = SERVERS.filter(s => s.types.includes(normType));
        }

        const allStreams = [];
        const seenUrls = new Set();
        const discoveredFolders = [];

        for (const query of queriesToTry) {
            if (!query) continue;

            const tasks = targetServers.map(async server => {
                try {
                    if (normType === "tv") {
                        const res = await searchTvEpisodes(server, query, reqSeason, reqEpisode, candidateTitles, meta.year, meta.isAnimation, targetArc, competingArcs);
                        if (res.folders && res.folders.length > 0) {
                            discoveredFolders.push({ serverId: server.id, folders: res.folders });
                        }
                        return res.streams;
                    } else {
                        return await searchMovies(server, query, candidateTitles, meta.year, meta.isAnimation);
                    }
                } catch {
                    return [];
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
        if (normType === "tv" && meta.isAnimation && allStreams.length === 0) {
            const fallbackServers = SERVERS.filter(s => s.types.includes("tv") && s.id !== "df10");
            for (const query of queriesToTry) {
                if (!query) continue;

                const tasks = fallbackServers.map(async server => {
                    const res = await searchTvEpisodes(server, query, reqSeason, reqEpisode, candidateTitles, meta.year, meta.isAnimation, targetArc, competingArcs);
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
            cacheSet(tvFolderCache, String(cleanId), discoveredFolders);
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

module.exports = {
    getStreams,
    extractTvFolderInfo,
    matchesTvFolder,
    matchesMovieTitle,
    passesEpisodeFilter,
    cleanTitle,
    extractSequelTokens,
    buildSearchQueries
};
