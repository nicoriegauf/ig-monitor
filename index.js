const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

var bancache = {};
var unbancache = {};

async function check(username) {
    const req = await fetch("https://instagram.com/"+username+'/', {
        "credentials": "omit",
        "headers": {
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
        "method": "GET",
        "mode": "cors"
    });
    const res = await req.text();
    const sp = res.split('<meta property="og:description" content="');
    if (sp.length > 1) {
        return sp[1].split('-')[0];
    } else {
        return 'N/A';
    }
}

function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes >= 60) {
        return `${totalMinutes} minutes`;
    } else {
        return `${hours} hours, ${minutes} minutes, ${seconds} seconds`;
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
    return totalMin >= 60 ? `${totalMin} minutes` : `${h} hours, ${m} minutes, ${s} seconds`;
}

function buildRecoveredEmbed(username, followers, timeDisplay) {
    return new EmbedBuilder()
        .setColor('#000000')
        .setTitle(`Account Recovered | @${username} 🏆✅`)
        .setDescription(`Followers: ${followers} | ⏱ Time taken: ${timeDisplay}`);
}

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 90000;

let watchedAccounts = {};
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

client.once('ready', () => {
    console.log(`We have logged in as ${client.user.tag}`);
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
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing User ID').setDescription('Usage: `!giveaccess <user id>`').setColor(0xFF0000)] });
            return;
        }
        const userIdToAdd = args[1];
        if (allowedUserIds.includes(userIdToAdd)) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Already Has Access').setDescription(`User **${userIdToAdd}** already has access.`).setColor(0xFFC107)] });
            return;
        }
        allowedUserIds.push(userIdToAdd);
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Access Granted').setDescription(`User **${userIdToAdd}** has been granted access.`).setColor(0x28A745)] });

    } else if (message.content.startsWith('!unban')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription('Usage: `!unban <username>`').setColor(0xFF0000)] });
            return;
        }
        const username = args[1];
        const startTime = new Date();
        const info = await check(username);

        if (info.length == 3) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Account Banned').setDescription(`**@${username}** is currently banned. Monitoring for reactivation...`).setColor(0x000000)] });
            unbancache[username] = info;
            watchedAccounts[username] = true;
            unbanWatchList.push(username);
            let hasSentEmbed = false;
            const intv = setInterval(async function() {
                try {
                    const infoa = await check(username);
                    const timeDiffSeconds = Math.floor(Math.abs(Date.now() - startTime) / 1000);
                    const timeDisplay = formatTime(timeDiffSeconds);
                    const followerMatch = infoa.match(/(\d[\d,]*)\s*Followers/i);
                    const followers = followerMatch ? followerMatch[1] : 'N/A';
                    if (infoa.length > 3 && !hasSentEmbed) {
                        await message.channel.send({ embeds: [buildRecoveredEmbed(username, followers, timeDisplay)] });
                        hasSentEmbed = true;
                        clearInterval(intv);
                        const idx = unbanWatchList.indexOf(username);
                        if (idx > -1) unbanWatchList.splice(idx, 1);
                    }
                } catch (error) {
                    console.error(`Error monitoring ${username}:`, error);
                }
            }, CHECK_INTERVAL);
        } else {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Not Banned').setDescription(`**@${username}** is not banned.`).setColor(0xFF0000)] });
        }

    } else if (message.content.startsWith('!ban')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Missing Username').setDescription('Usage: `!ban <username>`').setColor(0xFF0000)] });
            return;
        }
        const username = args[1];
        const startTime = new Date();
        const info = await check(username);

        if (info.length != 3) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('👀 Monitoring Initiated').setDescription(`**@${username}** is currently valid. Monitoring for bans...`).setColor(0x000000)] });
            watchedAccounts[username] = true;
            banWatchList.push(username);
            const intv = setInterval(async function() {
                const infoa = await check(username);
                if (infoa.length == 3) {
                    const timeDiffSeconds = Math.floor(Math.abs(Date.now() - startTime) / 1000);
                    const timeDisplay = formatTime(timeDiffSeconds);
                    await message.channel.send({ embeds: [new EmbedBuilder().setColor('#000000').setTitle(`Account Has Been Smoked! | @${username} ✅`).setDescription(`⏱ Time taken: ${timeDisplay}`)] });
                    const idx = banWatchList.indexOf(username);
                    if (idx > -1) banWatchList.splice(idx, 1);
                    clearInterval(intv);
                }
            }, CHECK_INTERVAL);
        } else {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❌ Already Banned').setDescription(`**@${username}** is already banned.`).setColor(0xFF0000)] });
        }

    } else if (message.content.startsWith('!banlist')) {
        const desc = banWatchList.length === 0 ? 'No accounts monitored for bans.' : banWatchList.map(u => `• @${u}`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📜 Ban Watch List').setDescription(desc).setColor(0x000000)] });

    } else if (message.content.startsWith('!unbanlist')) {
        const desc = unbanWatchList.length === 0 ? 'No accounts monitored for unbans.' : unbanWatchList.map(u => `• @${u}`).join('\n');
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📜 Unban Watch List').setDescription(desc).setColor(0x000000)] });

    } else if (message.content.startsWith('!help')) {
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📖 Help').setDescription('**!ban <username>** - Monitor for ban.\n**!unban <username>** - Monitor for unban.\n**!banlist** - Show ban watch list.\n**!unbanlist** - Show unban watch list.\n**!giveaccess <id>** - Grant access.\n**!fake <username> <unbandauer> <followers> <sendezeit>** - Fake Nachricht.\n**!fakefast <username> <unbandauer> <followers> <sendezeit>** - Gleich wie !fake.\n**!help** - This message.').setColor(0x000000)] });

    } else if (message.content.startsWith('!fakefast') || message.content.startsWith('!fake')) {
        const args = message.content.split(' ');
        const cmd = args[0];

        if (args.length < 5) {
            await message.channel.send(`❌ **Usage:** \`${cmd} <username> <unbandauer> <followers> <sendezeit>\`\n**Beispiel:** \`${cmd} cr7fan 00:08:14 3247 00:28:03\``);
            return;
        }

        const fakeUsername = args[1];
        const fakeUnbanTime = parseHHMMSS(args[2]);
        const fakeFollowers = parseInt(args[3]);
        const fakeSendTime = parseHHMMSS(args[4]);

        if (!fakeUnbanTime || !fakeSendTime) {
            await message.channel.send('❌ Zeit muss im Format `hh:mm:ss` angegeben werden.');
            return;
        }
        if (isNaN(fakeFollowers)) {
            await message.channel.send('❌ Follower müssen eine Zahl sein.');
            return;
        }

        const fakeTimeDisplay = timeToDisplay(fakeUnbanTime.h, fakeUnbanTime.m, fakeUnbanTime.s);
        const fakeDelay = fakeSendTime.totalMs;
        const fakeMin = Math.floor(fakeDelay / 60000);
        const fakeSec = Math.floor((fakeDelay % 60000) / 1000);

        await message.channel.send(`⏳ Fake-Nachricht für **@${fakeUsername}** wird in **${fakeMin} Minuten und ${fakeSec} Sekunden** gesendet...`);

        setTimeout(async () => {
            await message.channel.send({ embeds: [buildRecoveredEmbed(fakeUsername, fakeFollowers, fakeTimeDisplay)] });
        }, fakeDelay);
    }
});

async function sendErrorDM(userId, errorMessage) {
    try {
        const user = await client.users.fetch(userId);
        await user.send({ embeds: [new EmbedBuilder().setTitle('❌ Error').setDescription(`An error occurred: **${errorMessage}**`).setColor(0xFF0000)] });
    } catch (dmError) {
        console.error('Failed to send error DM:', dmError);
    }
}

client.login(TOKEN);
```

**Danach wie immer:**
```
git add index.js
git commit -m "remove links, update fake commands"
git push
```
```
node index.js
```

**Neues Fake-Format:**
```
!fake cr7fan 00:08:14 3247 00:28:03