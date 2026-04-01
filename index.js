const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
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

// Returns { status: 'active' | 'banned' | 'error', description: string | null }
// Detection based on comparing live accounts:
//   active  → <title> contains username + og:description with "Followers"
//   banned  → <title> is just "Instagram" (generic), no og:description
//   error   → unexpected response (rate limit, network issue) → skip tick, retry later
async function check(username) {
    try {
        const req = await fetch("https://instagram.com/" + username + '/', {
            credentials: "omit",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Sec-GPC": "1",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Priority": "u=4"
            },
            method: "GET",
            mode: "cors"
        });
        const html = await req.text();

        // Active account: og:description contains "Followers"
        const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (ogDescMatch && /followers/i.test(ogDescMatch[1])) {
            return { status: 'active', description: ogDescMatch[1] };
        }

        // Banned account: title is just "Instagram" (no username, no profile data)
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        if (titleMatch && titleMatch[1].trim() === 'Instagram') {
            return { status: 'banned', description: null };
        }

        // Anything else (partial response, login redirect, rate limit) → skip
        return { status: 'error', description: null };
    } catch (e) {
        return { status: 'error', description: null };
    }
}

function parseFollowers(description) {
    if (!description) return 'N/A';
    const match = description.match(/([\d,]+)\s*Followers/i);
    return match ? match[1] : 'N/A';
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

const allowedUserIds = [...ALLOWED_USER_IDS];
const banWatchList = [];
const unbanWatchList = [];

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
    let hasSentEmbed = false;
    const intv = setInterval(async function() {
        try {
            const result = await check(username);
            if (result.status === 'error') {
                console.log('[unban] Check error for @' + username + ', skipping tick...');
                return;
            }
            if (result.status === 'active' && !hasSentEmbed) {
                hasSentEmbed = true;
                clearInterval(intv);
                const idx = unbanWatchList.indexOf(username);
                if (idx > -1) unbanWatchList.splice(idx, 1);
                const timeDiffSeconds = Math.floor(Math.abs(Date.now() - startTime) / 1000);
                const timeDisplay = formatTime(timeDiffSeconds);
                const followers = parseFollowers(result.description);
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
}

function startBanMonitor(username, channelId, startTime) {
    if (banWatchList.includes(username)) return;
    banWatchList.push(username);
    const intv = setInterval(async function() {
        try {
            const result = await check(username);
            if (result.status === 'error') {
                console.log('[ban] Check error for @' + username + ', skipping tick...');
                return;
            }
            if (result.status === 'banned') {
                clearInterval(intv);
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
}

client.once('ready', () => {
    console.log('We have logged in as ' + client.user.tag);
    const wl = loadWatchlist();
    for (const entry of wl.unban) {
        console.log('Resuming unban monitor for @' + entry.username + ' in channel ' + entry.channelId);
        startUnbanMonitor(entry.username, entry.channelId, entry.startTime);
    }
    for (const entry of wl.ban) {
        console.log('Resuming ban monitor for @' + entry.username + ' in channel ' + entry.channelId);
        startBanMonitor(entry.username, entry.channelId, entry.startTime);
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

    } else if (message.content.startsWith('!unbanlist')) {
        const desc = unbanWatchList.length === 0 ? 'No accounts monitored for unbans.' : unbanWatchList.map(function(u) { return '• @' + u; }).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📜 Unban Watch List').setDescription(desc).setColor(0x000000)] });

    } else if (message.content.startsWith('!unban')) {
        const args = message.content.split(' ');
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
        const args = message.content.split(' ');
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

    } else if (message.content.startsWith('!help')) {
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📖 Help').setDescription('!ban <username> - Monitor for ban.\n!unban <username> - Monitor for unban.\n!banlist - Show ban watch list.\n!unbanlist - Show unban watch list.\n!giveaccess <id> - Grant access.\n!fake <username> <unbandauer> <followers> <sendezeit> - Fake Nachricht.\n!fakefast <username> <unbandauer> <followers> <sendezeit> - Gleich wie !fake.\n!help - This message.').setColor(0x000000)] });

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
