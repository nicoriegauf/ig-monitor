const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

const WATCHLIST_FILE = './watchlist.json';

function loadWatchlist() {
    try {
        if (fs.existsSync(WATCHLIST_FILE)) {
            return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load watchlist:', e);
    }
    return { unban: [], ban: [] };
}

function saveWatchlist(data) {
    try {
        fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to save watchlist:', e);
    }
}

// Proxy rotation — set PROXY_URLS=http://user:pass@host:port,http://... in .env
// If empty, requests go out directly (no proxy)
const PROXY_URLS = process.env.PROXY_URLS ? process.env.PROXY_URLS.split(',').map(s => s.trim()).filter(Boolean) : [];
let proxyIndex = 0;
function getNextProxy() {
    if (PROXY_URLS.length === 0) return null;
    const url = PROXY_URLS[proxyIndex % PROXY_URLS.length];
    proxyIndex++;
    return url;
}

// Per-proxy stats for !status command
const proxyStats = {};
function initProxyStats() {
    const keys = PROXY_URLS.length > 0 ? PROXY_URLS : ['direct'];
    for (const url of keys) {
        proxyStats[url] = { ok: 0, ratelimited: 0, error: 0, lastStatus: 'unknown', lastCheck: null };
    }
}
function recordProxyStat(proxyUrl, status) {
    const key = proxyUrl || 'direct';
    if (!proxyStats[key]) proxyStats[key] = { ok: 0, ratelimited: 0, error: 0, lastStatus: 'unknown', lastCheck: null };
    proxyStats[key][status === 'ok' ? 'ok' : status === 'ratelimited' ? 'ratelimited' : 'error']++;
    proxyStats[key].lastStatus = status;
    proxyStats[key].lastCheck = new Date();
}
initProxyStats();

// Returns { status: 'active' | 'banned' | 'error', followers: number | null }
//   active  → API returns data.user with follower count
//   banned  → API returns {"status":"ok"} with no user data
//   error   → session expired, rate-limit or network issue → skip tick
async function check(username) {
    const proxyUrl = getNextProxy();
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
        "Accept": "*/*",
        "X-IG-App-ID": "936619743392459",
        "Referer": "https://www.instagram.com/",
    };
    if (IG_SESSION_ID) headers["Cookie"] = "sessionid=" + IG_SESSION_ID;
    const fetchOptions = { headers, method: "GET" };
    if (proxyUrl) fetchOptions.agent = new HttpsProxyAgent(proxyUrl);

    try {
        const req = await fetch("https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username), fetchOptions);

        if (req.status === 401 || req.status === 403) {
            console.log('[check] ' + new Date().toISOString() + ' | @' + username + ' | SESSION EXPIRED (HTTP ' + req.status + ')');
            recordProxyStat(proxyUrl, 'error');
            return { status: 'error', followers: null };
        }
        if (req.status !== 200) {
            console.log('[check] ' + new Date().toISOString() + ' | @' + username + ' | HTTP ' + req.status);
            recordProxyStat(proxyUrl, 'ratelimited');
            return { status: 'error', followers: null };
        }

        const json = await req.json();

        // Explicit rate-limit message
        if (json.message && json.message.toLowerCase().includes('wait')) {
            console.log('[check] ' + new Date().toISOString() + ' | @' + username + ' | RATE-LIMITED ("Please wait") — skip');
            recordProxyStat(proxyUrl, 'ratelimited');
            return { status: 'error', followers: null };
        }

        if (json.data && json.data.user) {
            const followers = json.data.user.edge_followed_by ? json.data.user.edge_followed_by.count : 0;
            console.log('[check] ' + new Date().toISOString() + ' | @' + username + ' | ACTIVE | followers: ' + followers);
            recordProxyStat(proxyUrl, 'ok');
            return { status: 'active', followers };
        }

        // {"status":"ok"} with no user = banned/not found
        // Canary check to rule out rate-limit
        const rateLimited = await isRateLimited(fetchOptions, proxyUrl);
        if (rateLimited) {
            console.log('[check] ' + new Date().toISOString() + ' | @' + username + ' | RATE-LIMITED (canary failed) — skip');
            recordProxyStat(proxyUrl, 'ratelimited');
            return { status: 'error', followers: null };
        }

        console.log('[check] ' + new Date().toISOString() + ' | @' + username + ' | BANNED');
        recordProxyStat(proxyUrl, 'ok');
        return { status: 'banned', followers: null };

    } catch (e) {
        console.error('[check] ' + new Date().toISOString() + ' | @' + username + ' | EXCEPTION:', e.message);
        recordProxyStat(proxyUrl, 'error');
        return { status: 'error', followers: null };
    }
}

// Canary: check @cristiano with same session — if no user data returned, we're rate-limited
async function isRateLimited(fetchOptions, proxyUrl) {
    try {
        const req = await fetch("https://www.instagram.com/api/v1/users/web_profile_info/?username=cristiano", fetchOptions);
        if (req.status !== 200) return true;
        const json = await req.json();
        return !(json.data && json.data.user);
    } catch (e) {
        return true;
    }
}

function formatFollowers(count) {
    if (count === null || count === undefined) return 'N/A';
    return count.toLocaleString('de-DE');
}

function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes >= 60) {
        return totalMinutes + ' minutes';
    } else {
        return hours + ' hours, ' + minutes + ' minutes, ' + seconds + ' seconds';
    }
}

function parseHHMMSS(timeRaw) {
    const parts = timeRaw.split(':');
    if (parts.length !== 3) return null;
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const s = parseInt(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return { h, m, s, totalMs: (h * 3600 + m * 60 + s) * 1000, totalMin: h * 60 + m };
}

function timeToDisplay(h, m, s) {
    const totalMin = h * 60 + m;
    return totalMin >= 60 ? totalMin + ' minutes' : h + ' hours, ' + m + ' minutes, ' + s + ' seconds';
}

function buildRecoveredEmbed(username, followers, timeDisplay) {
    return new EmbedBuilder()
        .setColor('#000000')
        .setTitle('Account Recovered | @' + username + ' 🏆✅')
        .setDescription('Followers: ' + followers + ' | ⏱ Time taken: ' + timeDisplay);
}

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 90000;
const IG_SESSION_ID = process.env.IG_SESSION_ID || '';

const allowedUserIds = [...ALLOWED_USER_IDS];
const banWatchList = [];
const unbanWatchList = [];
const activeIntervals = {};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
});

function startUnbanMonitor(username, channelId, startTime) {
    if (unbanWatchList.includes(username)) return;
    unbanWatchList.push(username);
    const intv = setInterval(async function() {
        try {
            const result = await check(username);
            if (result.status === 'error') return; // skip tick, retry next interval
            if (result.status === 'active') {
                clearInterval(intv);
                delete activeIntervals[username];
                const idx = unbanWatchList.indexOf(username);
                if (idx > -1) unbanWatchList.splice(idx, 1);
                const timeDiffSeconds = Math.floor(Math.abs(Date.now() - startTime) / 1000);
                const timeDisplay = formatTime(timeDiffSeconds);
                const followers = formatFollowers(result.followers);
                const channel = await client.channels.fetch(channelId);
                await channel.send({ embeds: [buildRecoveredEmbed(username, followers, timeDisplay)] });
                const wl = loadWatchlist();
                wl.unban = wl.unban.filter(e => e.username !== username);
                saveWatchlist(wl);
            }
        } catch (error) {
            console.error('[unban] Error monitoring @' + username + ':', error);
        }
    }, CHECK_INTERVAL);
    activeIntervals[username] = intv;
}

function startBanMonitor(username, channelId, startTime) {
    if (banWatchList.includes(username)) return;
    banWatchList.push(username);
    const intv = setInterval(async function() {
        try {
            const result = await check(username);
            if (result.status === 'error') return; // skip tick, retry next interval
            if (result.status === 'banned') {
                clearInterval(intv);
                delete activeIntervals[username];
                const idx = banWatchList.indexOf(username);
                if (idx > -1) banWatchList.splice(idx, 1);
                const timeDiffSeconds = Math.floor(Math.abs(Date.now() - startTime) / 1000);
                const timeDisplay = formatTime(timeDiffSeconds);
                const channel = await client.channels.fetch(channelId);
                await channel.send({ embeds: [new EmbedBuilder().setColor('#000000').setTitle('Account Has Been Smoked! | @' + username + ' ✅').setDescription('⏱ Time taken: ' + timeDisplay)] });
                const wl = loadWatchlist();
                wl.ban = wl.ban.filter(e => e.username !== username);
                saveWatchlist(wl);
            }
        } catch (error) {
            console.error('[ban] Error monitoring @' + username + ':', error);
        }
    }, CHECK_INTERVAL);
    activeIntervals[username] = intv;
}

client.once('ready', async () => {
    console.log('We have logged in as ' + client.user.tag);
    const wl = loadWatchlist();
    const allEntries = [
        ...wl.unban.map(e => ({ ...e, type: 'unban' })),
        ...wl.ban.map(e => ({ ...e, type: 'ban' }))
    ];
    // Stagger startup checks by 30s each to avoid rate-limiting
    for (let i = 0; i < allEntries.length; i++) {
        const entry = allEntries[i];
        setTimeout(() => {
            console.log('Resuming ' + entry.type + ' monitor for @' + entry.username + (i > 0 ? ' (staggered)' : ''));
            if (entry.type === 'unban') startUnbanMonitor(entry.username, entry.channelId, entry.startTime);
            else startBanMonitor(entry.username, entry.channelId, entry.startTime);
        }, i * 30000);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!giveaccess')) {
        const args = message.content.split(' ');
        if (!allowedUserIds.includes(message.author.id)) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Access Denied').setDescription('You do not have permission.').setColor(0xFF0000)] });
            return;
        }
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing User ID').setDescription('Usage: !giveaccess <user id>').setColor(0xFF0000)] });
            return;
        }
        const userIdToAdd = args[1];
        if (allowedUserIds.includes(userIdToAdd)) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Has Access').setDescription('User ' + userIdToAdd + ' already has access.').setColor(0xFFC107)] });
            return;
        }
        allowedUserIds.push(userIdToAdd);
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Access Granted').setDescription('User ' + userIdToAdd + ' has been granted access.').setColor(0x28A745)] });

    } else if (message.content.startsWith('!removeunban')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription('Usage: !removeunban <username>').setColor(0xFF0000)] });
            return;
        }
        const username = args[1];
        const idx = unbanWatchList.indexOf(username);
        if (idx === -1) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Found').setDescription('@' + username + ' is not on the unban watch list.').setColor(0xFF0000)] });
            return;
        }
        unbanWatchList.splice(idx, 1);
        if (activeIntervals[username]) { clearInterval(activeIntervals[username]); delete activeIntervals[username]; }
        const wl = loadWatchlist();
        wl.unban = wl.unban.filter(e => e.username !== username);
        saveWatchlist(wl);
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Removed').setDescription('@' + username + ' removed from unban watch list.').setColor(0x28A745)] });

    } else if (message.content.startsWith('!removeban')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription('Usage: !removeban <username>').setColor(0xFF0000)] });
            return;
        }
        const username = args[1];
        const idx = banWatchList.indexOf(username);
        if (idx === -1) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Found').setDescription('@' + username + ' is not on the ban watch list.').setColor(0xFF0000)] });
            return;
        }
        banWatchList.splice(idx, 1);
        if (activeIntervals[username]) { clearInterval(activeIntervals[username]); delete activeIntervals[username]; }
        const wl = loadWatchlist();
        wl.ban = wl.ban.filter(e => e.username !== username);
        saveWatchlist(wl);
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Removed').setDescription('@' + username + ' removed from ban watch list.').setColor(0x28A745)] });

    } else if (message.content.startsWith('!unbanlist')) {
        const desc = unbanWatchList.length === 0 ? 'No accounts monitored for unbans.' : unbanWatchList.map(function(u) { return '• @' + u; }).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📜 Unban Watch List').setDescription(desc).setColor(0x000000)] });

    } else if (message.content.startsWith('!unban')) {
        const args = message.content.trim().split(/\s+/);
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription('Usage: !unban <username>').setColor(0xFF0000)] });
            return;
        }
        const username = args[1];

        if (unbanWatchList.includes(username)) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Monitoring').setDescription('@' + username + ' is already being monitored for unban.').setColor(0xFFC107)] });
            return;
        }

        const result = await check(username);

        if (result.status === 'active') {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Banned').setDescription('@' + username + ' is not banned.').setColor(0xFF0000)] });
            return;
        }

        const startTime = Date.now();
        const desc = result.status === 'error'
            ? 'Instagram nicht erreichbar – @' + username + ' wird trotzdem überwacht.'
            : '@' + username + ' ist gebannt. Überwache auf Reaktivierung...';
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Account Banned').setDescription(desc).setColor(0x000000)] });

        const wl = loadWatchlist();
        if (!wl.unban.find(e => e.username === username)) {
            wl.unban.push({ username, channelId: message.channel.id, startTime });
            saveWatchlist(wl);
        }
        startUnbanMonitor(username, message.channel.id, startTime);

    } else if (message.content.startsWith('!banlist')) {
        const desc = banWatchList.length === 0 ? 'No accounts monitored for bans.' : banWatchList.map(function(u) { return '• @' + u; }).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📜 Ban Watch List').setDescription(desc).setColor(0x000000)] });

    } else if (message.content.startsWith('!ban')) {
        const args = message.content.trim().split(/\s+/);
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription('Usage: !ban <username>').setColor(0xFF0000)] });
            return;
        }
        const username = args[1];

        if (banWatchList.includes(username)) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Monitoring').setDescription('@' + username + ' is already being monitored for ban.').setColor(0xFFC107)] });
            return;
        }

        const result = await check(username);

        if (result.status === 'banned') {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Already Banned').setDescription('@' + username + ' is already banned.').setColor(0xFF0000)] });
            return;
        }

        const startTime = Date.now();
        const desc = result.status === 'error'
            ? 'Instagram nicht erreichbar – @' + username + ' wird trotzdem überwacht.'
            : '@' + username + ' ist aktiv. Überwache auf Ban...';
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Monitoring Initiated').setDescription(desc).setColor(0x000000)] });

        const wl = loadWatchlist();
        if (!wl.ban.find(e => e.username === username)) {
            wl.ban.push({ username, channelId: message.channel.id, startTime });
            saveWatchlist(wl);
        }
        startBanMonitor(username, message.channel.id, startTime);

    } else if (message.content.startsWith('!status')) {
        const lines = [];

        // Proxy health
        const entries = Object.entries(proxyStats);
        if (entries.length === 0 || (entries.length === 1 && entries[0][0] === 'direct')) {
            lines.push('**Proxies:** Keine konfiguriert (direkte IP)');
        } else {
            lines.push('**Proxy Status:**');
            for (const [url, s] of entries) {
                const host = url === 'direct' ? 'direct' : url.split('@').pop();
                const icon = s.lastStatus === 'ok' ? '🟢' : s.lastStatus === 'ratelimited' ? '🔴' : s.lastStatus === 'unknown' ? '⚪' : '🟡';
                const checked = s.lastCheck ? '<t:' + Math.floor(s.lastCheck.getTime() / 1000) + ':R>' : 'noch nie';
                lines.push(icon + ' `' + host + '` — OK: ' + s.ok + ' | RL: ' + s.ratelimited + ' | Err: ' + s.error + ' | zuletzt: ' + checked);
            }
        }

        // Watchlists
        lines.push('');
        lines.push('**Unban Watch (' + unbanWatchList.length + '):** ' + (unbanWatchList.length ? unbanWatchList.map(u => '@' + u).join(', ') : '–'));
        lines.push('**Ban Watch (' + banWatchList.length + '):** ' + (banWatchList.length ? banWatchList.map(u => '@' + u).join(', ') : '–'));

        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📊 Bot Status').setDescription(lines.join('\n')).setColor(0x000000)] });

    } else if (message.content.startsWith('!help')) {
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📖 Help').setDescription('!ban <username> - Monitor for ban.\n!unban <username> - Monitor for unban.\n!removeban <username> - Remove from ban watch list.\n!removeunban <username> - Remove from unban watch list.\n!banlist - Show ban watch list.\n!unbanlist - Show unban watch list.\n!status - Proxy & Rate-Limit Status.\n!giveaccess <id> - Grant access.\n!fake <username> <unbandauer> <followers> <sendezeit> - Fake Nachricht.\n!fakefast <username> <unbandauer> <followers> <sendezeit> - Gleich wie !fake.\n!help - This message.').setColor(0x000000)] });

    } else if (message.content.startsWith('!fakefast') || message.content.startsWith('!fake')) {
        const args = message.content.split(' ');
        const cmd = args[0];

        if (args.length < 5) {
            await message.channel.send('❌ Usage: ' + cmd + ' <username> <unbandauer> <followers> <sendezeit>\nBeispiel: ' + cmd + ' cr7fan 00:08:14 3247 00:28:03');
            return;
        }

        const fakeUsername = args[1];
        const fakeUnbanTime = parseHHMMSS(args[2]);
        const fakeFollowers = parseInt(args[3]);
        const fakeSendTime = parseHHMMSS(args[4]);

        if (!fakeUnbanTime || !fakeSendTime) {
            await message.channel.send('❌ Zeit muss im Format hh:mm:ss angegeben werden.');
            return;
        }
        if (isNaN(fakeFollowers)) {
            await message.channel.send('❌ Follower muessen eine Zahl sein.');
            return;
        }

        const fakeTimeDisplay = timeToDisplay(fakeUnbanTime.h, fakeUnbanTime.m, fakeUnbanTime.s);
        const fakeDelay = fakeSendTime.totalMs;
        const fakeMin = Math.floor(fakeDelay / 60000);
        const fakeSec = Math.floor((fakeDelay % 60000) / 1000);

        await message.channel.send('⏳ Fake-Nachricht fuer @' + fakeUsername + ' wird in ' + fakeMin + ' Minuten und ' + fakeSec + ' Sekunden gesendet...');

        setTimeout(async function() {
            await message.channel.send({ embeds: [buildRecoveredEmbed(fakeUsername, fakeFollowers, fakeTimeDisplay)] });
        }, fakeDelay);
    }
});

client.login(TOKEN);
