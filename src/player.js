import { resolveTrack } from './youtube.js';
import { resolveEncodedTrack } from './resolve.js';
import { isLavalinkReady } from './lavalink.js';
import { LavalinkEngine } from './engines/lavalink.js';
import { LocalEngine } from './engines/local.js';
import { buildNowPlayingPayload, fetchLyrics } from './nowPlaying.js';

export class GuildMusicPlayer {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.current = null;
    this.textChannel = null;
    this.voiceChannelId = null;
    this.engine = null;
    this.idleTimer = null;
    this.panelMessage = null;
    this.progressTimer = null;
    this.stopping = false;
  }

  get engineLabel() {
    return this.engine ? this.engine.constructor.label : null;
  }

  async connect(voiceChannel) {
    if (this.engine) {
      this.voiceChannelId = voiceChannel.id;
      await this.engine.connect(voiceChannel);
      return;
    }

    const Engine = isLavalinkReady() ? LavalinkEngine : LocalEngine;
    const engine = new Engine(this.guildId);

    engine.onTrackEnd = () => {
      if (this.stopping) {
        this.stopping = false;
        return;
      }
      this.current = null;
      this.stopProgressUpdates();
      this.playNext().catch((err) => {
        console.error(`[${this.guildId}] playNext error:`, err);
        this.textChannel?.send(`Ошибка воспроизведения: ${err.message}`).catch(() => {});
      });
    };

    engine.onError = (err, { fatal = false } = {}) => {
      console.error(`[${this.guildId}] ${Engine.label} engine error:`, err.message);
      if (fatal) {
        this.destroy();
        return;
      }
      this.textChannel?.send(`Ошибка плеера: ${err.message}`).catch(() => {});
    };

    try {
      await engine.connect(voiceChannel);
    } catch (err) {
      engine.destroy();
      throw err;
    }

    this.engine = engine;
    this.voiceChannelId = voiceChannel.id;
  }

  enqueue(track) {
    this.clearIdleTimer();
    this.queue.push(track);
    if (this.current) {
      this.refreshNowPlaying().catch(() => {});
    }
  }

  getPlaybackPosition() {
    if (!this.current || !this.engine) return 0;
    const sec = this.engine.positionMs / 1000;
    if (this.current.duration) return Math.min(sec, this.current.duration);
    return Math.max(0, sec);
  }

  /** Give the current engine what it needs to actually stream this track. */
  async prepareTrack(track) {
    if (this.engine.constructor.requiresFreshStream) {
      const fresh = await resolveTrack(track.url, {
        fallbackQuery: track.title,
        fallbackDuration: track.duration,
      });
      return { ...track, ...fresh, requestedBy: track.requestedBy };
    }

    if (track.encoded) return track;

    // Playlist entries are enumerated locally, so ask a node for this one now.
    const resolved = await resolveEncodedTrack(track);
    return { ...track, ...resolved, requestedBy: track.requestedBy };
  }

  async playNext({ updatePanel = true } = {}) {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      this.stopProgressUpdates();
      await this.disablePanel();
      this.scheduleIdleLeave();
      return;
    }

    if (!this.engine) throw new Error('Плеер не подключён к голосовому каналу.');

    let track;
    try {
      track = await this.prepareTrack(next);
    } catch (err) {
      console.error(`[${this.guildId}] prepare failed:`, err.message);
      this.textChannel
        ?.send(`Не удалось воспроизвести **${next.title}**: ${err.message}`)
        .catch(() => {});
      return this.playNext({ updatePanel });
    }

    this.current = track;
    await this.engine.play(track);

    if (updatePanel) {
      await this.refreshNowPlaying();
      this.startProgressUpdates();
    }
  }

  /** Bind an existing Discord message as the control panel. */
  async attachPanelMessage(message) {
    this.panelMessage = message;
    if (this.current) {
      await this.refreshNowPlaying();
      this.startProgressUpdates();
    }
  }

  async refreshNowPlaying() {
    if (!this.textChannel || !this.current) return;

    const payload = buildNowPlayingPayload(this);
    try {
      if (this.panelMessage) {
        await this.panelMessage.edit(payload);
        return;
      }
    } catch {
      this.panelMessage = null;
    }

    try {
      this.panelMessage = await this.textChannel.send(payload);
    } catch (err) {
      console.error(`[${this.guildId}] panel send failed:`, err.message);
    }
  }

  startProgressUpdates() {
    this.stopProgressUpdates();
    this.progressTimer = setInterval(() => {
      if (!this.current || this.isPaused) return;
      this.refreshNowPlaying().catch(() => {});
    }, 10_000);
  }

  stopProgressUpdates() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  async disablePanel() {
    this.stopProgressUpdates();
    if (!this.panelMessage) return;
    try {
      await this.panelMessage.edit(buildNowPlayingPayload(this, { disabled: true }));
    } catch {
      // ignore
    }
  }

  skip() {
    if (!this.current && this.queue.length === 0) return false;

    // Nothing playing means no track-end event will arrive to advance us.
    if (!this.current) {
      this.playNext().catch((err) => {
        console.error(`[${this.guildId}] skip error:`, err);
      });
      return true;
    }

    this.engine?.stopCurrent();
    return true;
  }

  pause() {
    const ok = Boolean(this.engine?.setPaused(true));
    if (ok) this.refreshNowPlaying().catch(() => {});
    return ok;
  }

  resume() {
    const ok = Boolean(this.engine?.setPaused(false));
    if (ok) this.refreshNowPlaying().catch(() => {});
    return ok;
  }

  togglePause() {
    if (this.isPaused) return this.resume();
    if (this.isPlaying) return this.pause();
    return false;
  }

  shuffle() {
    if (this.queue.length < 2) return 0;
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.refreshNowPlaying().catch(() => {});
    return this.queue.length;
  }

  async lyrics() {
    if (!this.current) {
      throw new Error('Сейчас ничего не играет.');
    }
    return fetchLyrics(this.current.title);
  }

  stop() {
    // Only swallow a track-end event if one is actually coming.
    this.stopping = Boolean(this.current);
    this.queue = [];
    this.current = null;
    this.stopProgressUpdates();
    this.engine?.stopCurrent();
    this.disablePanel().catch(() => {});
    this.scheduleIdleLeave();
  }

  scheduleIdleLeave() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.destroy(), 60_000);
  }

  clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  destroy() {
    this.clearIdleTimer();
    this.stopProgressUpdates();
    this.queue = [];
    this.current = null;
    this.panelMessage = null;
    this.voiceChannelId = null;
    this.engine?.destroy();
    this.engine = null;
  }

  get isPlaying() {
    return Boolean(this.engine?.isPlaying);
  }

  get isPaused() {
    return Boolean(this.engine?.isPaused);
  }
}

const players = new Map();

export function getPlayer(guildId) {
  let player = players.get(guildId);
  if (!player) {
    player = new GuildMusicPlayer(guildId);
    players.set(guildId, player);
  }
  return player;
}

export function deletePlayer(guildId) {
  const player = players.get(guildId);
  if (player) {
    player.destroy();
    players.delete(guildId);
  }
}
