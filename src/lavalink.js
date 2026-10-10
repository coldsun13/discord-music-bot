import { Connectors, Shoukaku } from 'shoukaku';

/**
 * Public Lavalink nodes. They fetch YouTube themselves, so the bot is not
 * affected by YouTube blocking the hosting provider's IP address.
 * Override with the LAVALINK_NODES env variable (JSON array of NodeOption).
 */
const DEFAULT_NODES = [
  {
    name: 'serenetia-v4',
    url: 'lavalinkv4.serenetia.com:443',
    auth: 'https://dsc.gg/ajidevserver',
    secure: true,
  },
  {
    name: 'serenetia',
    url: 'lavalink.serenetia.com:443',
    auth: 'https://dsc.gg/ajidevserver',
    secure: true,
  },
  {
    name: 'ajieblogs-v4',
    url: 'lava-v4.ajieblogs.eu.org:443',
    auth: 'https://dsc.gg/ajidevserver',
    secure: true,
  },
];

function readNodes() {
  const raw = process.env.LAVALINK_NODES;
  if (!raw) return DEFAULT_NODES;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
    console.warn('[lavalink] LAVALINK_NODES is empty, using defaults.');
  } catch (err) {
    console.warn(`[lavalink] LAVALINK_NODES is not valid JSON (${err.message}), using defaults.`);
  }
  return DEFAULT_NODES;
}

export function getConfiguredNodes() {
  return readNodes();
}

let shoukaku = null;

export function initLavalink(client) {
  if (shoukaku) return shoukaku;
  if (process.env.LAVALINK_DISABLED === 'true') {
    console.log('[lavalink] disabled via LAVALINK_DISABLED.');
    return null;
  }

  const nodes = readNodes();
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 30,
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 20_000,
    moveOnDisconnect: true,
    userAgent: 'discord-music-bot',
  });

  shoukaku.on('ready', (name) => console.log(`[lavalink] node "${name}" ready.`));
  shoukaku.on('close', (name, code) =>
    console.warn(`[lavalink] node "${name}" closed (code ${code}).`),
  );
  shoukaku.on('disconnect', (name) => console.warn(`[lavalink] node "${name}" disconnected.`));
  shoukaku.on('error', (name, err) =>
    console.warn(`[lavalink] node "${name}" error: ${err?.message || err}`),
  );

  return shoukaku;
}

export function getShoukaku() {
  return shoukaku;
}

/** Nodes we can actually talk to right now, best first. */
export function getReadyNodes() {
  if (!shoukaku) return [];
  return [...shoukaku.nodes.values()]
    .filter((node) => node.sessionId)
    .sort((a, b) => a.penalties - b.penalties);
}

export function getReadyNode() {
  return getReadyNodes()[0] || null;
}

export function isLavalinkReady() {
  return getReadyNodes().length > 0;
}

export function describeNodes() {
  if (!shoukaku) return [];
  return [...shoukaku.nodes.values()].map((node) => ({
    name: node.name,
    connected: Boolean(node.sessionId),
  }));
}
