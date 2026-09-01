import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { spawn } from 'node:child_process';
import { resolveTrack } from './youtube.js';
import {
  buildNowPlayingPayload,
  fetchLyrics,
} from './nowPlaying.js';
import { resolveFfmpegPathAsync } from './bins.js';

async function createTrackResource(track) {
  const ffmpegBin = await resolveFfmpegPathAsync();
  const args = [
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
  ];

  const headers = track.httpHeaders || {};
  if (Object.keys(headers).length > 0) {
    const headerLines =
      Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n') + '\r\n';
    args.push('-headers', headerLines);
  }

  args.push(
    '-i',
    track.streamUrl,
    '-vn',
    '-analyzeduration',
    '0',
    '-loglevel',
    'error',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    '-vbr',
    'on',
    '-compression_level',
    '10',
    '-application',
    'audio',
    '-frame_duration',
    '20',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'ogg',
    'pipe:1',
  );

  const ffmpeg = spawn(ffmpegBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  ffmpeg.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.error(`[ffmpeg] ${msg}`);
  });

  ffmpeg.on('error', (err) => {
    console.error(`[ffmpeg] failed to start (${ffmpegBin}):`, err.message);
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.OggOpus,
    metadata: track,
  });

  resource.playStream.on('close', () => {
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  });

  return resource;
}

export class GuildMusicPlayer {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.current = null;
    this.textChannel = null;
    this.connection = null;
    this.player = createAudioPlayer();
    this.idleTimer = null;
    this.panelMessage = null;
    this.progressTimer = null;
    this.trackStartedAt = 0;
    this.pausedAccumulatedMs = 0;
    this.pauseStartedAt = null;
    this.stopping = false;

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.stopping) {
        this.stopping = false;
        return;
      }
      this.current = null;
      this.stopProgressUpdates();
      this.playNext().catch((err) => {
        console.error(`[${this.guildId}] playNext error:`, err);
        this.textChannel
          ?.send(`Ошибка воспроизведения: ${err.message}`)
          .catch(() => {});
      });
    });

    this.player.on('error', (err) => {
      console.error(`[${this.guildId}] player error:`, err);
      this.textChannel
        ?.send(`Ошибка плеера: ${err.message}`)
        .catch(() => {});
    });
  }

  async connect(voiceChannel) {
    if (
      this.connection &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      return this.connection;
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.subscribe(this.player);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.destroy();
      throw new Error('Не удалось подключиться к голосовому каналу.');
    }

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });

    return this.connection;
  }

  enqueue(track) {
    this.clearIdleTimer();
    this.queue.push(track);
    if (this.current) {
      this.refreshNowPlaying().catch(() => {});
    }
  }

  getPlaybackPosition() {
    if (!this.current || !this.trackStartedAt) return 0;
    let elapsed = Date.now() - this.trackStartedAt - this.pausedAccumulatedMs;
    if (this.pauseStartedAt) {
      elapsed -= Date.now() - this.pauseStartedAt;
    }
    const sec = Math.max(0, elapsed / 1000);
    if (this.current.duration) {
      return Math.min(sec, this.current.duration);
    }
    return sec;
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

    let track = next;
    try {
      const fresh = await resolveTrack(next.url);
      track = { ...next, ...fresh, requestedBy: next.requestedBy };
    } catch (err) {
      console.error(`[${this.guildId}] refresh failed:`, err.message);
      this.textChannel
        ?.send(`Не удалось воспроизвести **${next.title}**: ${err.message}`)
        .catch(() => {});
      return this.playNext({ updatePanel });
    }

    this.current = track;
    this.trackStartedAt = Date.now();
    this.pausedAccumulatedMs = 0;
    this.pauseStartedAt = null;

    const resource = await createTrackResource(track);
    this.player.play(resource);

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
    this.player.stop(true);
    return true;
  }

  pause() {
    const ok = this.player.pause(true);
    if (ok) {
      this.pauseStartedAt = Date.now();
      this.refreshNowPlaying().catch(() => {});
    }
    return ok;
  }

  resume() {
    const ok = this.player.unpause();
    if (ok && this.pauseStartedAt) {
      this.pausedAccumulatedMs += Date.now() - this.pauseStartedAt;
      this.pauseStartedAt = null;
      this.refreshNowPlaying().catch(() => {});
    }
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
    this.stopping = true;
    this.queue = [];
    this.current = null;
    this.stopProgressUpdates();
    this.player.stop(true);
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
    try {
      this.player.stop(true);
    } catch {
      // ignore
    }
    try {
      this.connection?.destroy();
    } catch {
      // ignore
    }
    this.connection = null;
  }

  get isPlaying() {
    return (
      this.player.state.status === AudioPlayerStatus.Playing ||
      this.player.state.status === AudioPlayerStatus.Buffering
    );
  }

  get isPaused() {
    return this.player.state.status === AudioPlayerStatus.Paused;
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
