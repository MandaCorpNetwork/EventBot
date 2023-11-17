import 'dotenv/config';
import {
  TeamSpeak,
  QueryProtocol,
  TeamSpeakChannel,
  TextMessageTargetMode,
} from 'ts3-nodejs-library';
import {
  Client,
  Collection,
  GatewayIntentBits,
  GuildScheduledEvent,
  GuildScheduledEventStatus,
} from 'discord.js';
import { EventEmitter } from 'events';
import { Database, verbose } from 'sqlite3';
import { readFileSync } from 'fs';

const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});

type EventEntry = {
  id: string;
  server: string;
  parentid: string;
};

discord.login(process.env.DISCORD_TOKEN);

const bus = new EventEmitter();
verbose();
const db = new Database('Events.sqlite');
const statements = readFileSync('./defaultTable.sql')
  .toString('utf-8')
  .split('//');

for (const statement of statements) {
  db.run(statement);
}
//create a new connection
const teamspeak = new TeamSpeak({
  host: '64.44.28.2',
  protocol: QueryProtocol.RAW,
  queryport: 10011,
  serverport: 9987,
  username: 'serveradmin',
  password: process.env.TEAMSPEAK_PASSWORD,
  nickname: 'Unnamed Alliance Bot v1',
});

teamspeak.on('ready', async () => {
  teamspeak.on('close', async () => {
    console.log('disconnected, trying to reconnect...');
    await teamspeak.reconnect(-1, 1000);
    console.log('reconnected!');
  });
});

discord.on('ready', async () => {
  const events = await getEvents();
  await purgeDeadEvents(events!);
  await syncDiscord(events!);
  await syncTeamspeak(events!);
  setInterval(
    async () => {
      const events = await getEvents();
      await purgeDeadEvents(events!);
      await syncDiscord(events!);
      await syncTeamspeak(events!);
    },
    1_000 * 60 * 1,
  );
});

const servers = ['888735224513593374', '987878339857485845'];

const syncDiscord = async (
  eventsToSync: Collection<
    string,
    GuildScheduledEvent<GuildScheduledEventStatus>
  >,
) => {
  for (const server of servers) {
    console.log('Syncing ', server);
    for (const [event_id, event] of eventsToSync) {
      console.log(`checking ${event_id}`);
      const newEventData = {
        name: event.name,
        entityType: event.entityType,
        privacyLevel: event.privacyLevel,
        scheduledStartTime: event.scheduledStartAt!,
        scheduledEndTime: event.scheduledEndAt!,
        image: event.image,
        entityMetadata: { location: event.entityMetadata?.location! },
        description: event.description!,
      };
      db.get(
        `SELECT * FROM linked_events WHERE parentid = ? AND server = ?`,
        [event_id, server],
        async (err, result) => {
          if (result == null) {
            discord.guilds.cache
              .get(server)
              ?.scheduledEvents.create(newEventData)
              .then((v) => {
                db.run(
                  'INSERT INTO linked_events (id, server, parentid) VALUES (?,?,?)',
                  [v.id, v.guildId, event_id],
                );
              });
          } else {
            try {
              discord.guilds.cache
                .get(server)
                ?.scheduledEvents.edit(
                  (result as any).id as string,
                  newEventData,
                );
            } catch (e) {}
          }
        },
      );
    }
  }
};

const getEvents = async (id?: string) => {
  return await discord.guilds.cache
    .get(id ?? '662951803469692928')
    ?.scheduledEvents.fetch();
};

const syncTeamspeak = async (
  events: Collection<string, GuildScheduledEvent<GuildScheduledEventStatus>>,
) => {
  console.info(`[${new Date().toISOString()}] Syncing Teamspeak...`);
  //! Setup Teamspeak Description
  if (events != undefined) {
    events.sort((a, b) => {
      return (
        (a.scheduledStartTimestamp ?? 0) - (b.scheduledStartTimestamp ?? 0)
      );
    });

    const eventMap = new Map<
      string,
      GuildScheduledEvent<GuildScheduledEventStatus>[]
    >();

    for (const [_, event] of events) {
      let startDate = new Date(event.scheduledStartTimestamp as number);
      const startDay = startDate.toLocaleDateString('en-US', {
        timeZone: 'US/Pacific',
      });
      if (!eventMap.has(startDay)) eventMap.set(startDay, []);
      eventMap.get(startDay)?.push(event);
    }

    let channelDescription = `[U][B][SIZE=+5]Upcoming Events:[/SIZE][/B][/U] [size=+2](en-US PST -08:00)[/size]\n`;

    for (let eventDate of eventMap.keys()) {
      channelDescription += `\n[B]\[${eventDate}\][/B][list=1]`;
      for (const event of eventMap.get(eventDate)!) {
        let desc = event.description ?? '';
        const url = desc.match(
          /Event Details and Signup Link: (https:\/\/discord\.com\/.*)/i,
        )!;
        let timeStringRad = event.scheduledStartAt
          ?.toLocaleString('en-US', { timeZone: 'US/Pacific' })
          .split(',')[1]
          .trim()!;
        let time = timeStringRad.match(/(\d+:\d+):\d+ (.*)/)!;
        channelDescription += `[*] [B]${time[1]} ${time[2]} - [url=${url[1]}]${event.name}[/url][/B]\n\n`;
      }
      channelDescription += '[/list]';
    }
    const channelInfo = await teamspeak.channelInfo('1');
    let oldDescription = channelInfo.channelDescription.split('\n');
    oldDescription.shift();

    if (oldDescription.join('\n') == channelDescription) {
      console.info(`[${new Date().toISOString()}] No changes detected`);
    } else {
      channelDescription =
        `Updated ${new Date().toLocaleString('en-US', {
          timeZone: 'US/Pacific',
        })} PST\n` + channelDescription;
      teamspeak.channelEdit('1', { channelDescription });
    }
    console.info(`[${new Date().toISOString()}] Syncing Teamspeak Completed`);
  }
};

const purgeDeadEvents = async (
  events: Collection<string, GuildScheduledEvent<GuildScheduledEventStatus>>,
) => {
  db.all<EventEntry>('SELECT * FROM linked_events', async (err, response) => {
    for (const event of response) {
      console.info(
        `Checking event ${event.id} for Purge in server ${event.server}`,
      );
      if (!events.has(event.parentid)) {
        try {
          console.info(`Purging event ${event.id} from ${event.server}`);
          await discord.guilds.cache
            .get(event.server)
            ?.scheduledEvents.delete(event.id);
        } catch (err) {}
        db.run(`DELETE FROM linked_events WHERE id=?`, [event.id]);
      }
    }
  });
};
