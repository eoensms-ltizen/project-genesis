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
import type { Agent, AgentState } from "../types";

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
  ChopTree: { kind: "chop", cadence: 0.45, volume: 0.78 },
  Mine: { kind: "mine", cadence: 0.65, volume: 0.72 },
  BuildHouse: { kind: "hammer", cadence: 0.5, volume: 0.55 },
  BuildTile: { kind: "hammer", cadence: 0.42, volume: 0.55 },
  CraftTool: { kind: "hammer", cadence: 0.62, volume: 0.46 },
  Furnish: { kind: "hammer", cadence: 0.58, volume: 0.46 },
  FarmWork: { kind: "farm", cadence: 0.64, volume: 0.42 },
  Plant: { kind: "farm", cadence: 0.64, volume: 0.4 },
  Transplant: { kind: "farm", cadence: 0.78, volume: 0.38 },
  Pave: { kind: "gravel", cadence: 0.58, volume: 0.46 },
  Cook: { kind: "cook", cadence: 1.05, volume: 0.44 },
  Clean: { kind: "sweep", cadence: 0.68, volume: 0.42 },
  Worship: { kind: "bell", cadence: 3.6, volume: 0.34 },
  Hunt: { kind: "hunt", cadence: 1.05, volume: 0.42 },
  Tame: { kind: "tame", cadence: 1.1, volume: 0.36 },
  LoadWood: { kind: "pickup", cadence: 0.7, volume: 0.34 },
  StoreWood: { kind: "pickup", cadence: 0.7, volume: 0.34 },
  WithdrawWood: { kind: "pickup", cadence: 0.7, volume: 0.34 },
  CollectIngredients: { kind: "pickup", cadence: 0.62, volume: 0.3 },
  Serve: { kind: "pickup", cadence: 0.62, volume: 0.3 },
  Ride: { kind: "ride", cadence: 1.45, volume: 0.34 },
};

const KIND_MIN_GAP: Record<SoundKind, number> = {
  chop: 0.14,
  mine: 0.2,
  hammer: 0.16,
  farm: 0.18,
  cook: 0.45,
  sweep: 0.2,
  gravel: 0.2,
  bell: 1,
  tame: 0.36,
  hunt: 0.34,
  pickup: 0.24,
  ride: 0.6,
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

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.26 : 0.0001, this.context?.currentTime ?? 0, 0.04);
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

  tick(agents: Agent[]) {
    if (!this.enabled || !this.context || this.context.state !== "running") {
      return;
    }

    void this.ensureSamples();

    const now = this.context.currentTime;
    const liveKeys = new Set<string>();
    for (const agent of agents) {
      const cue = WORK_CUES[agent.state];
      if (!cue || agent.actionTimer < 0.05) {
        continue;
      }

      const beat = Math.floor(agent.actionTimer / cue.cadence);
      const key = `${agent.id}:${agent.state}`;
      liveKeys.add(key);
      if (this.lastBeat.get(key) === beat) {
        continue;
      }
      this.lastBeat.set(key, beat);

      const lastKindAt = this.lastKindAt.get(cue.kind) ?? -Infinity;
      if (now - lastKindAt < KIND_MIN_GAP[cue.kind]) {
        continue;
      }
      this.lastKindAt.set(cue.kind, now);
      this.play(cue.kind, cue.volume);
    }

    for (const key of this.lastBeat.keys()) {
      if (!liveKeys.has(key)) {
        this.lastBeat.delete(key);
      }
    }
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

  private ensureContext(): AudioContext {
    if (this.context && this.master) {
      return this.context;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = this.enabled ? 0.26 : 0.0001;
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
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    gain.gain.value = Math.max(0.0001, volume * 0.7);
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  private playFallback(kind: SoundKind, volume: number) {
    switch (kind) {
      case "chop":
        this.noise(0.055, volume * 0.2, "lowpass", 650);
        this.tone(118, 0.07, "triangle", volume * 0.12);
        break;
      case "mine":
        this.tone(720, 0.035, "square", volume * 0.08);
        this.tone(180, 0.065, "triangle", volume * 0.1, 0.018);
        this.noise(0.045, volume * 0.08, "highpass", 1800);
        break;
      case "hammer":
        this.tone(260, 0.04, "square", volume * 0.08);
        this.tone(120, 0.065, "triangle", volume * 0.08, 0.012);
        break;
      case "farm":
        this.noise(0.13, volume * 0.09, "bandpass", 900);
        this.tone(150, 0.05, "triangle", volume * 0.035);
        break;
      case "cook":
        this.noise(0.24, volume * 0.06, "highpass", 2800);
        this.tone(420, 0.09, "sine", volume * 0.025);
        break;
      case "sweep":
        this.noise(0.18, volume * 0.08, "bandpass", 1300);
        break;
      case "gravel":
        this.noise(0.1, volume * 0.09, "highpass", 900);
        this.tone(95, 0.05, "triangle", volume * 0.04);
        break;
      case "bell":
        this.tone(660, 0.58, "sine", volume * 0.055);
        this.tone(990, 0.5, "sine", volume * 0.03, 0.012);
        break;
      case "tame":
        this.tone(520, 0.12, "sine", volume * 0.045);
        this.tone(780, 0.1, "sine", volume * 0.03, 0.08);
        break;
      case "hunt":
        this.tone(95, 0.08, "sawtooth", volume * 0.04);
        this.noise(0.04, volume * 0.06, "highpass", 2200);
        break;
      case "pickup":
        this.tone(210, 0.07, "triangle", volume * 0.045);
        this.noise(0.045, volume * 0.04, "lowpass", 1000);
        break;
      case "ride":
        this.noise(0.28, volume * 0.045, "bandpass", 520);
        this.tone(165, 0.18, "triangle", volume * 0.025);
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
    if (!this.master) {
      return;
    }
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterType: BiquadFilterType, frequency: number) {
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

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = filterType;
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    source.stop(context.currentTime + duration + 0.02);
  }
}
