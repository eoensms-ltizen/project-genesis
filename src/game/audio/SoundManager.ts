import workBellUrl from "../../assets/audio/work-bell.ogg";
import workChopUrl from "../../assets/audio/work-chop.ogg";
import workCookOneUrl from "../../assets/audio/work-cook-1.ogg";
import workCookTwoUrl from "../../assets/audio/work-cook-2.ogg";
import workFarmOneUrl from "../../assets/audio/work-farm-1.ogg";
import workFarmTwoUrl from "../../assets/audio/work-farm-2.ogg";
import workGravelUrl from "../../assets/audio/work-gravel.ogg";
import workHammerOneUrl from "../../assets/audio/work-hammer-1.ogg";
import workHammerTwoUrl from "../../assets/audio/work-hammer-2.ogg";
import workHuntUrl from "../../assets/audio/work-hunt.ogg";
import workMineOneUrl from "../../assets/audio/work-mine-1.ogg";
import workMineTwoUrl from "../../assets/audio/work-mine-2.ogg";
import workPickupUrl from "../../assets/audio/work-pickup.ogg";
import workRideUrl from "../../assets/audio/work-ride.ogg";
import workSweepUrl from "../../assets/audio/work-sweep.ogg";
import workTameUrl from "../../assets/audio/work-tame.ogg";
import type { Agent, AgentState, GameClock, WeatherState } from "../types";

type SoundKind =
  | "chop"
  | "mine"
  | "hammer"
  | "farm"
  | "cook"
  | "sweep"
  | "gravel"
  | "bell"
  | "tame"
  | "hunt"
  | "pickup"
  | "ride";

type Cue = {
  kind: SoundKind;
  cadence: number;
  volume: number;
};

type SoundFrameContext = {
  clock: GameClock;
  weather: WeatherState;
  focusWeights?: Map<string, number>;
};

type Candidate = {
  agent: Agent;
  cue: Cue;
  beat: number;
  key: string;
  focus: number;
  score: number;
};

type NoiseLayer = {
  source: AudioBufferSourceNode;
  gain: GainNode;
};

const SAMPLE_URLS: Record<SoundKind, string[]> = {
  chop: [workChopUrl],
  mine: [workMineOneUrl, workMineTwoUrl],
  hammer: [workHammerOneUrl, workHammerTwoUrl],
  farm: [workFarmOneUrl, workFarmTwoUrl],
  cook: [workCookOneUrl, workCookTwoUrl],
  sweep: [workSweepUrl],
  gravel: [workGravelUrl],
  bell: [workBellUrl],
  tame: [workTameUrl],
  hunt: [workHuntUrl],
  pickup: [workPickupUrl],
  ride: [workRideUrl],
};

const WORK_CUES: Partial<Record<AgentState, Cue>> = {
  ChopTree: { kind: "chop", cadence: 0.72, volume: 0.62 },
  Mine: { kind: "mine", cadence: 0.9, volume: 0.58 },
  BuildHouse: { kind: "hammer", cadence: 0.74, volume: 0.48 },
  BuildTile: { kind: "hammer", cadence: 0.62, volume: 0.48 },
  CraftTool: { kind: "hammer", cadence: 0.86, volume: 0.42 },
  Furnish: { kind: "hammer", cadence: 0.82, volume: 0.42 },
  FarmWork: { kind: "farm", cadence: 0.95, volume: 0.34 },
  Plant: { kind: "farm", cadence: 0.94, volume: 0.32 },
  Transplant: { kind: "farm", cadence: 1.1, volume: 0.3 },
  Pave: { kind: "gravel", cadence: 0.86, volume: 0.36 },
  Cook: { kind: "cook", cadence: 1.65, volume: 0.36 },
  Clean: { kind: "sweep", cadence: 1.05, volume: 0.32 },
  Worship: { kind: "bell", cadence: 5.2, volume: 0.26 },
  Hunt: { kind: "hunt", cadence: 1.35, volume: 0.32 },
  Tame: { kind: "tame", cadence: 1.55, volume: 0.28 },
  LoadWood: { kind: "pickup", cadence: 1.1, volume: 0.26 },
  StoreWood: { kind: "pickup", cadence: 1.1, volume: 0.26 },
  WithdrawWood: { kind: "pickup", cadence: 1.1, volume: 0.26 },
  CollectIngredients: { kind: "pickup", cadence: 1, volume: 0.24 },
  Serve: { kind: "pickup", cadence: 1, volume: 0.24 },
  Ride: { kind: "ride", cadence: 2.1, volume: 0.28 },
};

const KIND_MIN_GAP: Record<SoundKind, number> = {
  chop: 0.42,
  mine: 0.48,
  hammer: 0.38,
  farm: 0.55,
  cook: 0.85,
  sweep: 0.62,
  gravel: 0.56,
  bell: 2.4,
  tame: 0.9,
  hunt: 0.85,
  pickup: 0.64,
  ride: 1.1,
};

const STATE_PRIORITY: Partial<Record<AgentState, number>> = {
  BuildTile: 1.55,
  BuildHouse: 1.45,
  Mine: 1.45,
  ChopTree: 1.4,
  Cook: 1.25,
  Hunt: 1.2,
  Worship: 1.15,
  Ride: 1.15,
  FarmWork: 1.05,
  Clean: 1.05,
};

export class SoundManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private loadingPromise: Promise<void> | null = null;
  private loadFailed = false;
  private readonly buffers = new Map<SoundKind, AudioBuffer[]>();
  private readonly sampleCursor = new Map<SoundKind, number>();
  private readonly lastBeat = new Map<string, number>();
  private readonly lastKindAt = new Map<SoundKind, number>();
  private rainLayer: NoiseLayer | null = null;
  private windLayer: NoiseLayer | null = null;
  private nextMusicAt = 0;
  private nextThunderAt = 0;
  private musicStep = 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.34 : 0.0001, this.context.currentTime, 0.08);
    }
  }

  async unlock() {
    if (!this.enabled) {
      return;
    }
    const context = this.ensureContext();
    if (context.state === "suspended") {
      await context.resume();
    }
    await this.ensureSamples();
  }

  tick(agents: Agent[], frame: SoundFrameContext) {
    if (!this.enabled || !this.context || this.context.state !== "running") {
      return;
    }

    void this.ensureSamples();
    this.updateMusic(frame);
    this.playFocusedWorkCues(agents, frame);
  }

  destroy() {
    const context = this.context;
    this.context = null;
    this.master = null;
    this.loadingPromise = null;
    this.buffers.clear();
    this.sampleCursor.clear();
    this.lastBeat.clear();
    this.lastKindAt.clear();
    void context?.close();
  }

  private playFocusedWorkCues(agents: Agent[], frame: SoundFrameContext) {
    if (!this.context) {
      return;
    }
    const candidates: Candidate[] = [];
    const liveKeys = new Set<string>();

    for (const agent of agents) {
      const cue = WORK_CUES[agent.state];
      if (!cue || agent.actionTimer < 0.05) {
        continue;
      }

      const focus = frame.focusWeights?.get(agent.id) ?? 0.2;
      if (focus < 0.18) {
        continue;
      }

      const beat = Math.floor(agent.actionTimer / cue.cadence);
      const key = `${agent.id}:${agent.state}`;
      liveKeys.add(key);
      if (this.lastBeat.get(key) === beat) {
        continue;
      }

      const priority = STATE_PRIORITY[agent.state] ?? 1;
      candidates.push({
        agent,
        cue,
        beat,
        key,
        focus,
        score: focus * priority * cue.volume,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const now = this.context.currentTime;
    const maxVoices = frame.clock.isNight ? 1 : 2;
    let played = 0;

    for (const candidate of candidates) {
      if (played >= maxVoices) {
        break;
      }
      const { cue } = candidate;
      const lastKindAt = this.lastKindAt.get(cue.kind) ?? -Infinity;
      if (now - lastKindAt < KIND_MIN_GAP[cue.kind]) {
        continue;
      }
      this.lastKindAt.set(cue.kind, now);
      this.lastBeat.set(candidate.key, candidate.beat);
      this.play(cue.kind, cue.volume * Math.min(1, candidate.focus));
      played += 1;
    }

    for (const key of this.lastBeat.keys()) {
      if (!liveKeys.has(key)) {
        this.lastBeat.delete(key);
      }
    }
  }

  private updateMusic(frame: SoundFrameContext) {
    const context = this.context;
    if (!context || !this.master) {
      return;
    }

    this.ensureWeatherLayers();
    this.updateWeatherLayers(frame.weather);

    const now = context.currentTime;
    if (now >= this.nextMusicAt) {
      const nextDelay = this.scheduleMusicMoment(frame, now);
      this.nextMusicAt = now + nextDelay;
    }

    if (frame.weather.kind === "storm" && now >= this.nextThunderAt) {
      this.scheduleThunder(now, frame.weather.intensity);
      this.nextThunderAt = now + 8 + Math.random() * 11;
    }
  }

  private ensureContext(): AudioContext {
    if (this.context && this.master) {
      return this.context;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = this.enabled ? 0.34 : 0.0001;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return context;
  }

  private ensureSamples(): Promise<void> {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    const context = this.ensureContext();
    this.loadingPromise = Promise.all(
      Object.entries(SAMPLE_URLS).map(async ([kind, urls]) => {
        const decoded = await Promise.all(
          urls.map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Failed to load sound ${url}`);
            }
            return context.decodeAudioData(await response.arrayBuffer());
          }),
        );
        this.buffers.set(kind as SoundKind, decoded);
      }),
    )
      .then(() => {
        this.loadFailed = false;
      })
      .catch((error) => {
        console.warn("[sound] Falling back to procedural sound:", error);
        this.loadFailed = true;
      });
    return this.loadingPromise;
  }

  private ensureWeatherLayers() {
    if (!this.context || !this.master || (this.rainLayer && this.windLayer)) {
      return;
    }
    this.rainLayer = this.createNoiseLayer("highpass", 1800);
    this.windLayer = this.createNoiseLayer("lowpass", 420);
  }

  private createNoiseLayer(filterType: BiquadFilterType, frequency: number): NoiseLayer {
    const context = this.ensureContext();
    if (!this.master) {
      throw new Error("Audio master was not initialized");
    }
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    gain.gain.value = 0.0001;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    return { source, gain };
  }

  private updateWeatherLayers(weather: WeatherState) {
    if (!this.context || !this.rainLayer || !this.windLayer) {
      return;
    }
    const now = this.context.currentTime;
    const rainTarget =
      weather.kind === "storm"
        ? 0.055 + weather.intensity * 0.04
        : weather.kind === "rain"
          ? 0.032 + weather.intensity * 0.03
          : 0.0001;
    const windTarget =
      weather.kind === "storm"
        ? 0.04 + weather.intensity * 0.035
        : weather.kind === "rain"
          ? 0.022
          : weather.kind === "cloudy"
            ? 0.012 + weather.intensity * 0.012
            : 0.0001;
    this.rainLayer.gain.gain.setTargetAtTime(rainTarget, now, 1.2);
    this.windLayer.gain.gain.setTargetAtTime(windTarget, now, 1.8);
  }

  private scheduleMusicMoment(frame: SoundFrameContext, now: number): number {
    const hour = frame.clock.hour + frame.clock.minute / 60;
    const mood = hour >= 5 && hour < 9 ? "morning" : hour >= 18 && hour < 22 ? "evening" : frame.clock.isNight ? "night" : "day";
    const root = mood === "morning" ? 293.66 : mood === "day" ? 261.63 : mood === "evening" ? 220 : 196;
    const clearScale = [0, 2, 4, 7, 9, 12];
    const rainScale = [0, 3, 5, 7, 10, 12];
    const scale = frame.weather.kind === "clear" ? clearScale : rainScale;
    const baseDelay = mood === "night" ? 3.4 : mood === "evening" ? 2.7 : mood === "morning" ? 2.2 : 2.35;
    const weatherDampen = frame.weather.kind === "storm" ? 0.62 : frame.weather.kind === "rain" ? 0.78 : 1;
    const baseVolume = (mood === "night" ? 0.016 : mood === "evening" ? 0.018 : 0.021) * weatherDampen;

    const degree = scale[(this.musicStep + (frame.weather.kind === "clear" ? 0 : 2)) % scale.length];
    const harmony = scale[(this.musicStep + 2) % scale.length] - 12;
    const freq = root * 2 ** (degree / 12);
    const harmonyFreq = root * 2 ** (harmony / 12);

    this.musicTone(freq, mood === "night" ? 1.8 : 1.35, "sine", baseVolume, now);
    if (this.musicStep % 2 === 0) {
      this.musicTone(harmonyFreq, 2.2, "triangle", baseVolume * 0.62, now + 0.03);
    }
    if (mood !== "night" && this.musicStep % 4 === 0) {
      this.musicTone(root / 2, 2.8, "triangle", baseVolume * 0.5, now + 0.04);
    }

    this.musicStep += 1;
    return baseDelay + Math.random() * 0.55;
  }

  private scheduleThunder(now: number, intensity: number) {
    this.musicTone(48 + Math.random() * 12, 1.2, "sawtooth", 0.025 + intensity * 0.02, now);
    this.oneShotNoise(0.42, 0.025 + intensity * 0.025, "lowpass", 170, now + 0.08);
  }

  private play(kind: SoundKind, volume: number) {
    const samples = this.buffers.get(kind);
    if (samples?.length) {
      this.playSample(kind, samples, volume);
      return;
    }
    if (this.loadFailed) {
      this.playFallback(kind, volume);
    }
  }

  private playSample(kind: SoundKind, samples: AudioBuffer[], volume: number) {
    const context = this.ensureContext();
    if (!this.master) {
      return;
    }
    const next = this.sampleCursor.get(kind) ?? 0;
    const buffer = samples[next % samples.length];
    this.sampleCursor.set(kind, next + 1);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 0.97 + Math.random() * 0.06;
    gain.gain.value = Math.max(0.0001, volume * 0.32);
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  private playFallback(kind: SoundKind, volume: number) {
    switch (kind) {
      case "chop":
        this.oneShotNoise(0.055, volume * 0.14, "lowpass", 650);
        this.tone(118, 0.07, "triangle", volume * 0.08);
        break;
      case "mine":
        this.tone(720, 0.035, "square", volume * 0.055);
        this.tone(180, 0.065, "triangle", volume * 0.07, 0.018);
        this.oneShotNoise(0.045, volume * 0.055, "highpass", 1800);
        break;
      case "hammer":
        this.tone(260, 0.04, "square", volume * 0.055);
        this.tone(120, 0.065, "triangle", volume * 0.055, 0.012);
        break;
      case "farm":
        this.oneShotNoise(0.13, volume * 0.06, "bandpass", 900);
        this.tone(150, 0.05, "triangle", volume * 0.025);
        break;
      case "cook":
        this.oneShotNoise(0.24, volume * 0.04, "highpass", 2800);
        this.tone(420, 0.09, "sine", volume * 0.018);
        break;
      case "sweep":
        this.oneShotNoise(0.18, volume * 0.055, "bandpass", 1300);
        break;
      case "gravel":
        this.oneShotNoise(0.1, volume * 0.06, "highpass", 900);
        this.tone(95, 0.05, "triangle", volume * 0.028);
        break;
      case "bell":
        this.tone(660, 0.58, "sine", volume * 0.038);
        this.tone(990, 0.5, "sine", volume * 0.02, 0.012);
        break;
      case "tame":
        this.tone(520, 0.12, "sine", volume * 0.032);
        this.tone(780, 0.1, "sine", volume * 0.02, 0.08);
        break;
      case "hunt":
        this.tone(95, 0.08, "sawtooth", volume * 0.03);
        this.oneShotNoise(0.04, volume * 0.04, "highpass", 2200);
        break;
      case "pickup":
        this.tone(210, 0.07, "triangle", volume * 0.032);
        this.oneShotNoise(0.045, volume * 0.028, "lowpass", 1000);
        break;
      case "ride":
        this.oneShotNoise(0.28, volume * 0.032, "bandpass", 520);
        this.tone(165, 0.18, "triangle", volume * 0.018);
        break;
    }
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ) {
    const context = this.ensureContext();
    this.musicTone(frequency, duration, type, volume, context.currentTime + delay);
  }

  private musicTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    start: number,
  ) {
    const context = this.ensureContext();
    if (!this.master) {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.08);
  }

  private oneShotNoise(
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    frequency: number,
    startTime?: number,
  ) {
    const context = this.ensureContext();
    if (!this.master) {
      return;
    }
    const samples = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, samples, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) {
      const t = i / samples;
      data[i] = (Math.random() * 2 - 1) * (1 - t);
    }

    const start = startTime ?? context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = filterType;
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}
