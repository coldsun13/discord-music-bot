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
import { resolveFfmpegPathAsync } from '../bins.js';

async function createTrackResource(track) {
  const ffmpegBin = await resolveFfmpegPathAsync();
  const args = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];

  const headers = track.httpHeaders || {};
  if (Object.keys(headers).length > 0) {
    const headerLines =
      Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n') + '\r\n';
    args.push('-headers', headerLines);
  }

  args.push(
    '-i', track.streamUrl,
    '-vn',
    '-analyzeduration', '0',
    '-loglevel', 'error',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-vbr', 'on',
    '-compression_level', '10',
    '-application', 'audio',
    '-frame_duration', '20',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'ogg', 'pipe:1',
  );

  const ffmpeg = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

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

/**
 * Streams audio from this process: yt-dlp resolves the URL, ffmpeg transcodes
 * to Opus. Used when no Lavalink node is reachable.
 */
export class LocalEngine {
  /** Stream URLs expire, so every track has to be re-resolved before playing. */
  static requiresFreshStream = true;
  static label = 'local';

  constructor(guildId) {
    this.guildId = guildId;
    this.connection = null;
    this.resource = null;
    this.player = createAudioPlayer();
    this.onTrackEnd = null;
    this.onError = null;

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.resource = null;
      this.onTrackEnd?.('finished');
    });

    this.player.on('error', (err) => {
      this.onError?.(err);
    });
  }

  async connect(voiceChannel) {
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      return;
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
        this.onError?.(new Error('Голосовое соединение потеряно.'), { fatal: true });
      }
    });
  }

  async play(track) {
    this.resource = await createTrackResource(track);
    this.player.play(this.resource);
  }

  setPaused(paused) {
    return paused ? this.player.pause(true) : this.player.unpause();
  }

  stopCurrent() {
    this.player.stop(true);
  }

  get positionMs() {
    return this.resource?.playbackDuration || 0;
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

  destroy() {
    this.resource = null;
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
}
