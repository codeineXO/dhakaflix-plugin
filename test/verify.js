const assert = require("assert");
const dhakaflix = require("../dhakaflix.js");

// Colors for terminal output
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

const pass = (msg) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = (msg, err) => console.log(`  ${RED}✗${RESET} ${BOLD}${msg}${RESET}: ${err}`);
const warn = (msg) => console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
const header = (title) => console.log(`\n${BOLD}${CYAN}=== ${title} ===${RESET}`);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(desc, fn) {
    totalTests++;
    try {
        fn();
        pass(desc);
        passedTests++;
    } catch (e) {
        fail(desc, e.message);
        failedTests++;
    }
}

async function checkAsync(desc, fn) {
    totalTests++;
    try {
        await fn();
        pass(desc);
        passedTests++;
    } catch (e) {
        fail(desc, e.message);
        failedTests++;
    }
}

// -------------------------------------------------------------
// STAGE 1: Offline Unit Checks (Folder Parsing & Regex Logic)
// -------------------------------------------------------------
function runUnitTests() {
    header("STAGE 1: Offline Unit Checks (Regex & Parsing Logic)");

    if (!dhakaflix.extractTvFolderInfo) {
        warn("Internal helpers not exported yet from dhakaflix.js. Skipping pure unit tests.");
        return;
    }

    const { extractTvFolderInfo, matchesTvFolder, matchesMovieTitle, passesEpisodeFilter } = dhakaflix;

    // 1. Parenthesized alternate titles in TV / Anime folders
    check("Parses Money Heist with Spanish title in parens", () => {
        const info = extractTvFolderInfo("/TV Series ♥  A  —  L/Money Heist (La Casa de Papel) (TV Series 2017–2021) 1080p [Multi Audio]/");
        assert.ok(info, "Info should not be null");
        assert.strictEqual(info.startYear, "2017");
        assert.ok(info.aliases.includes("la casa de papel") || info.title.includes("money heist"));
    });

    check("Parses Erased with Romaji title in parens", () => {
        const info = extractTvFolderInfo("/Anime-TV Series ♥  A  —  F/Erased (Boku Dake ga Inai Machi) (TV Cartoon 2016– ) 1080p [Dual Audio]/");
        assert.ok(info, "Info should not be null");
        assert.strictEqual(info.startYear, "2016");
        assert.ok(info.aliases.includes("boku dake ga inai machi") || info.title.includes("erased"));
    });

    check("Parses WandaVision with hyphenated TV Mini-Series", () => {
        const info = extractTvFolderInfo("/TV-WEB-Series/WandaVision (TV Mini-Series 2021) 1080p/");
        assert.ok(info, "Info should not be null");
        assert.strictEqual(info.startYear, "2021");
        assert.strictEqual(info.title, "wandavision");
    });

    check("Parses Rick and Morty with plural 'TV Cartoons'", () => {
        const info = extractTvFolderInfo("/Anime & Cartoon TV Series/Rick and Morty (TV Cartoons 2013– ) 1080p/");
        assert.ok(info, "Info should not be null");
        assert.strictEqual(info.startYear, "2013");
        assert.strictEqual(info.title, "rick and morty");
    });

    check("Parses The Grand Tour with TV Talk-Show", () => {
        const info = extractTvFolderInfo("/TV-WEB-Series/The Grand Tour (TV Talk-Show 2016–2024) 1080p/");
        assert.ok(info, "Info should not be null");
        assert.strictEqual(info.startYear, "2016");
        assert.strictEqual(info.title, "the grand tour");
    });

    check("Parses How to Sell Drugs Online (Fast) with sub-clause in parens", () => {
        const info = extractTvFolderInfo("/TV-WEB-Series/How to Sell Drugs Online (Fast) (TV Series 2019–2025) 1080p [Dual Audio]/");
        assert.ok(info, "Info should not be null");
        assert.strictEqual(info.startYear, "2019");
    });

    // 2. Sequel Disambiguation
    check("Steins;Gate does not match Steins;Gate 0 folder", () => {
        const ok = matchesTvFolder("/Anime/Steins-Gate 0 (TV Cartoon 2018– ) 1080p/", "Steins;Gate", "2011", "df10");
        assert.strictEqual(ok, false);
    });

    check("Steins;Gate 0 matches Steins;Gate 0 folder", () => {
        const ok = matchesTvFolder("/Anime/Steins-Gate 0 (TV Cartoon 2018– ) 1080p/", "Steins;Gate 0", "2018", "df10");
        assert.strictEqual(ok, true);
    });

    check("The Batman (2022) does not match Batman (1989)", () => {
        const ok = matchesMovieTitle("/English Movies/Batman (1989) 1080p/", "The Batman", "2022");
        assert.strictEqual(ok, false);
    });

    check("Dune (2021) does not match Dune: Part Two (2024)", () => {
        const ok = matchesMovieTitle("/English Movies/Dune-Part Two (2024) 1080p/", "Dune");
        assert.strictEqual(ok, false);
    });

    // 3. Episode Cross-Season Leak Check
    check("Episode filter rejects S02E25 when requesting S01E25", () => {
        const ok = passesEpisodeFilter("/Show/Season 2/Show.S02E25.1080p.mkv", 1, 25, false, "Show");
        assert.strictEqual(ok, false, "S02 file should not match season 1 request");
    });

    check("Episode filter allows absolute episode numbering without season tag", () => {
        const ok = passesEpisodeFilter("/Show/[Judas] Show - 25 [1080p].mkv", 1, 25, true, "Show");
        assert.strictEqual(ok, true, "Absolute episode 25 should match");
    });

    // 4. Android TV / QuickJS compatibility test (missing setTimeout / clearTimeout)
    check("QuickJS compatibility: functions without throwing when setTimeout/clearTimeout are missing", () => {
        const fs = require("fs");
        const code = fs.readFileSync(require.resolve("../dhakaflix.js"), "utf8");
        // Eval in isolated function with shadowed timers
        let caughtError = null;
        try {
            eval(`(function() {
                var setTimeout = undefined;
                var clearTimeout = undefined;
                ${code}
            })()`);
        } catch (e) {
            caughtError = e;
        }
        assert.strictEqual(caughtError, null, "dhakaflix.js must load and initialize without ReferenceError in QuickJS environment");
    });
}

// -------------------------------------------------------------
// STAGE 2: Live Server Benchmark Suite
// -------------------------------------------------------------
const BENCHMARK_TITLES = [
    // --- TV Series (Mainstream & Tricky Formats) ---
    {
        name: "Money Heist (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 71446,
        season: 1,
        episode: 1,
        mustInclude: ["Money Heist", "La Casa de Papel"],
        mustNotInclude: []
    },
    {
        name: "WandaVision (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 85271,
        season: 1,
        episode: 1,
        mustInclude: ["WandaVision"],
        mustNotInclude: []
    },
    {
        name: "Breaking Bad (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 1396,
        season: 1,
        episode: 1,
        mustInclude: ["Breaking Bad"],
        mustNotInclude: []
    },
    {
        name: "Monsters: Menendez Story (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 225634,
        season: 1,
        episode: 1,
        mustInclude: ["Menendez"],
        mustNotInclude: ["Dahmer"]
    },
    {
        name: "Dark Desire (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 105214,
        season: 1,
        episode: 1,
        mustInclude: ["Dark Desire", "Oscuro Deseo"],
        mustNotInclude: []
    },

    // --- Anime & Cartoons ---
    {
        name: "Rick and Morty (S01E01)",
        type: "tv",
        tmdbId: 60625,
        season: 1,
        episode: 1,
        mustInclude: ["Rick and Morty"],
        mustNotInclude: []
    },
    {
        name: "ERASED (Anime S01E01)",
        type: "tv",
        tmdbId: 65249,
        season: 1,
        episode: 1,
        mustInclude: ["DHAKA-FLIX-10", "Erased"],
        mustNotInclude: ["DHAKA-FLIX-12"] // Must not return 2017 live action series
    },
    {
        name: "Steins;Gate (2011 S01E01)",
        type: "tv",
        tmdbId: 42509,
        season: 1,
        episode: 1,
        mustInclude: ["Steins-Gate (TV Cartoon 2011"],
        mustNotInclude: ["Steins-Gate 0", "Steins;Gate 0"]
    },
    {
        name: "Steins;Gate 0 (2018 S01E01)",
        type: "tv",
        tmdbId: 78102,
        season: 1,
        episode: 1,
        mustInclude: ["Steins-Gate 0", "Steins;Gate 0"],
        mustNotInclude: []
    },
    {
        name: "Bleach (Classic S01E01)",
        type: "tv",
        tmdbId: 30984,
        season: 1,
        episode: 1,
        mustInclude: ["Bleach"],
        mustNotInclude: ["Thousand-Year", "TYBW"]
    },
    {
        name: "Bleach: Thousand-Year Blood War (S02E01)",
        type: "tv",
        tmdbId: 30984,
        season: 2,
        episode: 1,
        mustInclude: ["Thousand", "TYBW"],
        mustNotInclude: []
    },
    {
        name: "Frieren: Beyond Journey's End (S01E01)",
        type: "tv",
        tmdbId: 209867,
        season: 1,
        episode: 1,
        mustInclude: ["Frieren", "Sousou no Frieren"],
        mustNotInclude: []
    },
    {
        name: "Attack on Titan (S01E01)",
        type: "tv",
        tmdbId: 1429,
        season: 1,
        episode: 1,
        mustInclude: ["Attack on Titan"],
        mustNotInclude: []
    },

    {
        name: "Game of Thrones (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 1399,
        season: 1,
        episode: 1,
        mustInclude: ["Game of Thrones"],
        mustNotInclude: []
    },
    {
        name: "Stranger Things (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 66732,
        season: 1,
        episode: 1,
        mustInclude: ["Stranger Things"],
        mustNotInclude: []
    },
    {
        name: "Jujutsu Kaisen (S01E01)",
        type: "tv",
        tmdbId: 95479,
        season: 1,
        episode: 1,
        mustInclude: ["Jujutsu Kaisen"],
        mustNotInclude: []
    },
    {
        name: "Demon Slayer (S01E01)",
        type: "tv",
        tmdbId: 85937,
        season: 1,
        episode: 1,
        mustInclude: ["Demon Slayer", "Kimetsu no Yaiba"],
        mustNotInclude: []
    },
    // --- Anthologies, Multi-Arcs & Franchises ---
    {
        name: "American Crime Story - S01E01 (O.J. Simpson)",
        type: "tv",
        server: "df12",
        tmdbId: 64513,
        season: 1,
        episode: 1,
        mustInclude: ["Crime Story", "Simpson", "People v"],
        mustNotInclude: ["Versace", "Impeachment"]
    },
    {
        name: "American Crime Story - S02E01 (Versace)",
        type: "tv",
        server: "df12",
        tmdbId: 64513,
        season: 2,
        episode: 1,
        mustInclude: ["American Crime Story", "Season 2", "S02"],
        mustNotInclude: ["Simpson", "Impeachment", "S01"]
    },
    {
        name: "True Detective - S04E01 (Night Country)",
        type: "tv",
        server: "df12",
        tmdbId: 46648,
        season: 4,
        episode: 1,
        mustInclude: ["True Detective", "Season 4", "S04"],
        mustNotInclude: []
    },
    {
        name: "Monogatari / Bakemonogatari (S01E01)",
        type: "tv",
        tmdbId: 46195,
        season: 1,
        episode: 1,
        mustInclude: ["Bakemonogatari"],
        mustNotInclude: ["Nisemonogatari", "Kizumonogatari", "Nekomonogatari"]
    },
    {
        name: "Doctor Who 2024 (S01E01 -> S14)",
        type: "tv",
        server: "df12",
        tmdbId: 239770,
        season: 1,
        episode: 1,
        mustInclude: ["Doctor Who", "Season 14"],
        mustNotInclude: ["Season 01", "Rose"]
    },
    {
        name: "The Office US (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 2316,
        season: 1,
        episode: 1,
        mustInclude: ["The Office US"],
        mustNotInclude: ["The Office UK"]
    },
    {
        name: "The Office UK (S01E01)",
        type: "tv",
        server: "df12",
        tmdbId: 2996,
        season: 1,
        episode: 1,
        mustInclude: ["The Office UK"],
        mustNotInclude: ["The Office US"]
    },
    {
        name: "Fullmetal Alchemist 2003 (S01E01)",
        type: "tv",
        tmdbId: 37863,
        season: 1,
        episode: 1,
        mustInclude: ["Fullmetal Alchemist"],
        mustNotInclude: ["Brotherhood"]
    },
    {
        name: "Fate/Zero (S01E01)",
        type: "tv",
        tmdbId: 45845,
        season: 1,
        episode: 1,
        mustInclude: ["Fate-Zero", "Fate Zero", "Fate/Zero"],
        mustNotInclude: ["stay night", "Blade Works", "Apocrypha"]
    },

    // --- Movies ---
    {
        name: "The Batman (2022)",
        type: "movie",
        tmdbId: 414906,
        mustInclude: ["The Batman (2022)", "The.Batman.2022", "The%20Batman%20%282022%29"],
        mustNotInclude: ["1989"]
    },
    {
        name: "Dune (2021)",
        type: "movie",
        tmdbId: 438631,
        mustInclude: ["Dune"],
        mustNotInclude: ["Part Two", "Part%20Two", "Part-Two"]
    },
    {
        name: "Dune: Part Two (2024)",
        type: "movie",
        tmdbId: 693134,
        mustInclude: ["Part Two", "Part%20Two", "Part-Two"],
        mustNotInclude: []
    },
    {
        name: "Deadpool & Wolverine (2024)",
        type: "movie",
        tmdbId: 533535,
        mustInclude: ["Deadpool"],
        mustNotInclude: []
    },
    {
        name: "Inside Out 2 (2024)",
        type: "movie",
        tmdbId: 1022789,
        mustInclude: ["Inside Out 2", "Inside%20Out%202"],
        mustNotInclude: []
    },
    {
        name: "Oppenheimer (2023)",
        type: "movie",
        tmdbId: 872585,
        mustInclude: ["Oppenheimer"],
        mustNotInclude: []
    },
    {
        name: "Interstellar (2014)",
        type: "movie",
        tmdbId: 157336,
        mustInclude: ["Interstellar"],
        mustNotInclude: []
    },
    {
        name: "Spider-Man: Across the Spider-Verse (2023)",
        type: "movie",
        tmdbId: 569094,
        mustInclude: ["Across the Spider-Verse", "Across%20the%20Spider-Verse"],
        mustNotInclude: ["Into the Spider-Verse"]
    }
];

async function runLiveBenchmarks() {
    header("STAGE 2: Live Server Benchmark Suite (Querying DhakaFlix BDIX)");

    let df12Online = false;
    try {
        const res = await fetch("http://172.16.50.12", { signal: AbortSignal.timeout(2000) });
        if (res.ok) df12Online = true;
    } catch {}

    if (!df12Online) {
        warn("DhakaFlix Server df12 (http://172.16.50.12) is currently offline / hung on BDIX. TV Series hosted exclusively on df12 will be skipped.");
    }

    for (const item of BENCHMARK_TITLES) {
        if (!df12Online && item.server === "df12") {
            warn(`${item.name}: Skipped (df12 server currently offline on BDIX)`);
            continue;
        }

        await checkAsync(`${item.name}`, async () => {
            let streams = item.type === "tv"
                ? await dhakaflix.getStreams(item.tmdbId, item.type, item.season, item.episode)
                : await dhakaflix.getStreams(item.tmdbId, item.type);

            // If empty due to transient BDIX socket drop, retry once after a short breather
            if (!streams || streams.length === 0) {
                await new Promise(r => setTimeout(r, 1000));
                streams = item.type === "tv"
                    ? await dhakaflix.getStreams(item.tmdbId, item.type, item.season, item.episode)
                    : await dhakaflix.getStreams(item.tmdbId, item.type);
            }

            // 1. Must find at least 1 stream
            assert.ok(streams && streams.length > 0, `0 streams returned for ${item.name}`);

            // 2. Check for contamination or mismatches
            for (const s of streams) {
                const url = decodeURIComponent(s.url);

                // Check positive include (any of the mustInclude strings)
                if (item.mustInclude && item.mustInclude.length > 0) {
                    const matchedAny = item.mustInclude.some(str => url.toLowerCase().includes(str.toLowerCase()));
                    assert.ok(
                        matchedAny,
                        `Contamination: Stream URL does not contain any of [${item.mustInclude.join(", ")}]:\n    URL: ${s.url}`
                    );
                }

                // Check negative include (must NOT contain any of mustNotInclude strings)
                if (item.mustNotInclude && item.mustNotInclude.length > 0) {
                    for (const badStr of item.mustNotInclude) {
                        assert.ok(
                            !url.toLowerCase().includes(badStr.toLowerCase()),
                            `Contamination: Stream URL contains forbidden term '${badStr}':\n    URL: ${s.url}`
                        );
                    }
                }
            }
        });
    }
}

async function main() {
    console.log(`${BOLD}${CYAN}Starting DhakaFlix Test & Verification Suite...${RESET}\n`);
    const startTime = Date.now();

    runUnitTests();
    await runLiveBenchmarks();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${BOLD}========================================${RESET}`);
    console.log(`${BOLD}Total Tests:${RESET} ${totalTests}`);
    console.log(`${GREEN}${BOLD}Passed:${RESET}      ${passedTests}`);
    console.log(`${failedTests > 0 ? RED : GREEN}${BOLD}Failed:${RESET}      ${failedTests}`);
    console.log(`${BOLD}Time Elapsed:${RESET} ${elapsed}s`);
    console.log(`${BOLD}========================================${RESET}\n`);

    if (failedTests > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
