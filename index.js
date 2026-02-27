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
    console.log(req)
    const sp = res.split('<meta property="og:description" content="');
    console.log(sp.length);
    if (sp.length > 1) {
        return sp[1].split('-')[0];
    } else {
        return 'N/A'
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

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 90000;

let watchedAccounts = {};
let storedFollowerData = {};

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

function formatTimestamp(date) {
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!giveaccess')) {
        const args = message.content.split(' ');

        if (!allowedUserIds.includes(message.author.id)) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Access Denied')
                .setDescription('You do not have permission to use this command.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Permission required', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        if (args.length < 2 || !args[1]) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('❌ Missing User ID')
                .setDescription('You need to specify a user ID to give access.\n\n**Usage:** `!giveaccess <user id>`')
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const userIdToAdd = args[1];

        if (allowedUserIds.includes(userIdToAdd)) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('👀 Already Has Access')
                .setDescription(`User with ID **${userIdToAdd}** already has access.`)
                .setColor(0xFFC107)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Access already granted', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        allowedUserIds.push(userIdToAdd);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by @${message.author.username}` })
            .setTitle('✅ Access Granted')
            .setDescription(`User with ID **${userIdToAdd}** has been granted access.`)
            .setColor(0x28A745)
            .setThumbnail(message.author.displayAvatarURL())
            .setFooter({ text: 'Access granted successfully', iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });

    } else if (message.content.startsWith('!unbanwatch')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('❌ Missing Username')
                .setDescription('You need to specify a username to unbanwatch.\n\n**Usage:** `!unbanwatch <username>`')
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const username = args[1];
        const startTime = new Date();
        const info = await check(username);

        if (info.length == 3) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('👀 Account Banned')
                .setDescription(`The Instagram account **@${username}** is currently banned. Monitoring for reactivation...`)
                .setColor(0x000000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Monitoring in progress', iconURL: client.user.displayAvatarURL() })
                .setImage('https://media.giphy.com/media/niNTPEoAhOSli/giphy.gif');

            await message.channel.send({ embeds: [embed] });
            unbancache[username] = info;
            watchedAccounts[username] = true;
            unbanWatchList.push(username);

            let hasSentEmbed = false;

            const intv = setInterval(async function() {
                try {
                    const infoa = await check(username);
                    const currentTime = Date.now();
                    const timeDifferenceSeconds = Math.floor(Math.abs(currentTime - startTime) / 1000);
                    const timeDisplay = formatTime(timeDifferenceSeconds);

                    const followerMatch = infoa.match(/(\d[\d,]*)\s*Followers/i);
                    const followers = followerMatch ? followerMatch[1] : 'N/A';

                    if (infoa.length > 3 && !hasSentEmbed) {
                        const embed = new EmbedBuilder()
                            .setTitle(`Account has been reactivated Successfully! | ${username} ✅`)
                            .setDescription(`Account Recovered | @${username} 🏆✅ | Followers: ${followers} | ⏱ Time taken: ${timeDisplay}`)
                            .setColor(0x000000)
                            .setFooter({ text: 'Monitor Bot v1', iconURL: client.user.displayAvatarURL() })
                            .setTimestamp();

                        await message.channel.send({ embeds: [embed] });
                        hasSentEmbed = true;
                        clearInterval(intv);

                        const indexUnban = unbanWatchList.indexOf(username);
                        if (indexUnban > -1) {
                            unbanWatchList.splice(indexUnban, 1);
                        }
                    }
                } catch (error) {
                    console.error(`Error during monitoring for ${username}:`, error);
                    sendErrorDM(message.author.id, error.message);
                }
            }, CHECK_INTERVAL);
        } else {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('❌ Invalid for Unban Watch')
                .setDescription(`The Instagram account **@${username}** is not banned and cannot be watched for reactivation.`)
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }

    } else if (message.content.startsWith('!banwatch')) {
        const args = message.content.split(' ');
        if (args.length < 2 || !args[1]) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username}` })
                .setTitle('❌ Missing Username')
                .setDescription('You need to specify a username to banwatch.\n\n**Usage:** `!banwatch <username>`')
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const username = args[1];
        const startTime = new Date();
        const info = await check(username);

        if (info.length != 3) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('👀 Monitoring Initiated')
                .setDescription(`The Instagram account **@${username}** is currently valid. Monitoring for any bans...`)
                .setColor(0x000000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Monitoring in progress', iconURL: client.user.displayAvatarURL() })
                .setImage('https://media.giphy.com/media/niNTPEoAhOSli/giphy.gif');

            await message.channel.send({ embeds: [embed] });
            watchedAccounts[username] = true;
            banWatchList.push(username);

            const intv = setInterval(async function() {
                const infoa = await check(username);
                if (infoa.length == 3) {
                    const currentTime = Date.now();
                    const timeDifferenceSeconds = Math.floor(Math.abs(currentTime - startTime) / 1000);
                    const timeDisplay = formatTime(timeDifferenceSeconds);

                    const embed = new EmbedBuilder()
                        .setTitle(`Account Has Been Smoked! | ${username} ✅`)
                        .setDescription(`@${username} 🏆✅ | ⏰ Time taken: ${timeDisplay}`)
                        .setColor(0x000000)
                        .setFooter({ text: 'Monitor Bot v1', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();

                    const index = banWatchList.indexOf(username);
                    if (index > -1) {
                        banWatchList.splice(index, 1);
                    }
                    await message.channel.send({ embeds: [embed] });
                    clearInterval(intv);
                }
            }, CHECK_INTERVAL);
        } else {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Requested by @${message.author.username} ${formatTimestamp(startTime)}` })
                .setTitle('❌ Invalid for Ban Watch')
                .setDescription(`The Instagram account **@${username}** is already banned and cannot be watched for bans.`)
                .setColor(0xFF0000)
                .setThumbnail(message.author.displayAvatarURL())
                .setFooter({ text: 'Please try again', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }

    } else if (message.content.startsWith('!banlist')) {
        if (banWatchList.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('📜 Ban Watch List')
                .setDescription('No accounts are currently being monitored for bans.')
                .setColor(0x000000)
                .setFooter({ text: 'Ban watch list is empty', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('📜 Ban Watch List')
                .setDescription(banWatchList.map(username => `• **@${username}**`).join('\n'))
                .setColor(0x000000)
                .setFooter({ text: 'Current ban watch list', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }

    } else if (message.content.startsWith('!unbanlist')) {
        if (unbanWatchList.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('📜 Unban Watch List')
                .setDescription('No accounts are currently being monitored for unbans.')
                .setColor(0x000000)
                .setFooter({ text: 'Unban watch list is empty', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('📜 Unban Watch List')
                .setDescription(unbanWatchList.map(username => `• **@${username}**`).join('\n'))
                .setColor(0x000000)
                .setFooter({ text: 'Current unban watch list', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
        }

    } else if (message.content.startsWith('!help')) {
        const embed = new EmbedBuilder()
            .setTitle('📖 Help - Available Commands')
            .setDescription(`
            **!banwatch <username>** - Starts monitoring an Instagram account for being banned.
            **!unbanwatch <username>** - Starts monitoring an Instagram account for being unbanned.
            **!banlist** - Displays a list of all accounts currently being monitored for bans.
            **!unbanlist** - Displays a list of all accounts currently being monitored for unbans.
            **!giveaccess <user id>** - Grants access to a user by adding them to the allowed list.
            **!fake <username> <hh:mm:ss> <followers>** - Sendet nach zufälliger Zeit (1-30 Min) eine gefakte Unban-Meldung.
            **!help** - Displays this help message.
            `)
            .setColor(0x000000)
            .setThumbnail('https://media.giphy.com/media/or0s8qzLMNyJW/giphy.gif')
            .setFooter({ text: 'Requested by ' + message.author.username, iconURL: client.user.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });

    } else if (message.content.startsWith('!fake')) {
        const args = message.content.split(' ');

        if (args.length < 4) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Falsche Verwendung')
                .setDescription('**Usage:** `!fake <username> <hh:mm:ss> <followers>`\n\n**Beispiel:** `!fake lenas_links 04:05:00 1173`\n\nDie Erfolgsmeldung kommt nach einer zufälligen Zeit zwischen 1-30 Minuten.')
                .setColor(0xFF0000)
                .setFooter({ text: 'Monitor Bot v1', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [embed] });
            return;
        }

        const fakeUsername = args[1];
        const fakeTimeRaw = args[2];
        const fakeFollowers = parseInt(args[3]);

        const timeParts = fakeTimeRaw.split(':');
        if (timeParts.length !== 3 || timeParts.some(p => isNaN(parseInt(p)))) {
            await message.channel.send('❌ Zeit muss im Format `hh:mm:ss` angegeben werden. Beispiel: `00:11:28`');
            return;
        }

        if (isNaN(fakeFollowers)) {
            await message.channel.send('❌ Follower müssen eine Zahl sein.');
            return;
        }

        const hours = parseInt(timeParts[0]);
        const minutes = parseInt(timeParts[1]);
        const seconds = parseInt(timeParts[2]);
        const totalMinutes = hours * 60 + minutes;

        let timeDisplay;
        if (totalMinutes >= 60) {
            timeDisplay = `${totalMinutes} minutes`;
        } else {
            timeDisplay = `${hours} hours, ${minutes} minutes, ${seconds} seconds`;
        }

        // Zufällige Wartezeit zwischen 1 und 30 Minuten in Millisekunden
        const randomDelay = Math.floor(Math.random() * (30 * 60 - 60 + 1) + 60) * 1000;
        const randomMinutes = Math.floor(randomDelay / 60000);
        const randomSeconds = Math.floor((randomDelay % 60000) / 1000);

        await message.channel.send(`⏳ Fake-Nachricht für **@${fakeUsername}** wird in **${randomMinutes} Minuten und ${randomSeconds} Sekunden** gesendet...`);

        setTimeout(async () => {
            const embed = new EmbedBuilder()
                .setColor('#000000')
                .setTitle(`Account has been reactivated Successfully! | ${fakeUsername} ✅`)
                .setDescription(`Account Recovered | @${fakeUsername} 🏆✅ | Followers: ${fakeFollowers} | ⏱ Time taken: ${timeDisplay}`)
                .setFooter({ text: 'Monitor Bot v1', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });
        }, randomDelay);
    }
});

async function sendErrorDM(userId, errorMessage) {
    try {
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by @${user.username} ${formatTimestamp(new Date())}` })
            .setTitle('❌ Error')
            .setDescription(`An error occurred: **${errorMessage}**`)
            .setColor(0xFF0000)
            .setFooter({ text: 'Please try again later', iconURL: client.user.displayAvatarURL() })
            .setImage('https://media.giphy.com/media/niNTPEoAhOSli/giphy.gif');

        await user.send({ embeds: [embed] });
    } catch (dmError) {
        console.error('Failed to send error DM:', dmError);
    }
}

client.login(TOKEN);
