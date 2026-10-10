import { getShoukaku } from '../lavalink.js';

/** Track ends we must not treat as "song finished, play the next one". */
const IGNORED_END_REASONS = new Set(['replaced', 'cleanup']);

/**
 * Plays through a Lavalink node: the node fetches the audio and streams it to
 * Discord, so YouTube sees the node's IP instead of the bot host's.
 */
export class LavalinkEngine {
  /** Encoded tracks stay valid, so no re-resolution before playing. */
  static requiresFreshStream = false;
  static label = 'lavalink';

  constructor(guildId) {
    this.guildId = guildId;
    this.player = null;
    this.paused = false;
    this.started = false;
    this.onTrackEnd = null;
    this.onError = null;
  }

  async connect(voiceChannel) {
    if (this.player) return;

    const shoukaku = getShoukaku();
    if (!shoukaku) throw new Error('Lavalink недоступен.');

    // A connection can outlive our reference to it (crash, failed cleanup),
    // and joining twice throws — so clear any leftover first.
    if (shoukaku.connections.has(this.guildId)) {
      await shoukaku.leaveVoiceChannel(this.guildId).catch(() => {});
    }

    this.player = await shoukaku.joinVoiceChannel({
      guildId: voiceChannel.guild.id,
      channelId: voiceChannel.id,
      shardId: voiceChannel.guild.shardId ?? 0,
      deaf: true,
    });

    this.player.on('end', (data) => {
      if (IGNORED_END_REASONS.has(data?.reason)) return;
      this.started = false;
      this.onTrackEnd?.(data?.reason || 'finished');
    });

    this.player.on('stuck', () => {
      this.started = false;
      this.onTrackEnd?.('stuck');
    });

    this.player.on('exception', (data) => {
      this.onError?.(new Error(data?.exception?.message || 'Ошибка ноды Lavalink.'));
    });

    this.player.on('closed', (data) => {
      // 4014 = disconnected/moved by Discord; anything else is a real drop.
      this.onError?.(new Error(`Голосовое соединение закрыто (${data?.code}).`), {
        fatal: true,
      });
    });
  }

  async play(track) {
    if (!this.player) throw new Error('Плеер Lavalink не подключён.');
    if (!track.encoded) throw new Error('Трек не подготовлен для Lavalink.');

    this.paused = false;
    this.started = true;
    await this.player.playTrack({ track: { encoded: track.encoded } });
  }

  setPaused(paused) {
    if (!this.player || !this.started) return false;
    if (this.paused === paused) return false;
    this.paused = paused;
    this.player.setPaused(paused).catch((err) => {
      console.error(`[lavalink] setPaused failed: ${err.message}`);
    });
    return true;
  }

  stopCurrent() {
    this.started = false;
    this.player?.stopTrack().catch(() => {});
  }

  get positionMs() {
    return this.player?.position || 0;
  }

  get isPlaying() {
    return Boolean(this.started && !this.paused);
  }

  get isPaused() {
    return Boolean(this.started && this.paused);
  }

  destroy() {
    const shoukaku = getShoukaku();
    this.started = false;
    this.paused = false;
    if (this.player) {
      this.player.removeAllListeners();
      shoukaku?.leaveVoiceChannel(this.guildId).catch(() => {});
      this.player = null;
    }
  }
}
