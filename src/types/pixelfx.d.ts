// pixelfx 是纯 ESM、无类型声明的仓库包，这里给出最小可用声明。
declare module "pixelfx" {
  export type Frame = {
    w: number;
    h: number;
    ox: number;
    oy: number;
    color: Uint32Array;
    light: Uint32Array;
  };
  export type FxMod = {
    meta?: {
      name?: string;
      duration?: number;
      loop?: boolean;
      actor?: number;
      options?: Record<string, unknown>;
      [k: string]: unknown;
    };
    create?: (opts: Record<string, unknown>) => unknown;
    draw?: (p: unknown, t: number, opts: Record<string, unknown>) => void;
    drawBack?: (p: unknown, t: number, opts: Record<string, unknown>) => void;
  };
  export type Fx = {
    meta: Record<string, unknown>;
    options: Record<string, unknown>;
    readonly t: number;
    update(dt: number): void;
    draw(frame: Frame, layer?: "back" | "front"): void;
    stop(): void;
    done(): boolean;
  };
  export function createFrame(w: number, h: number, ox?: number, oy?: number): Frame;
  export function clearFrame(f: Frame): Frame;
  export function createFx(
    mod: FxMod,
    opts?: Record<string, unknown>,
  ): Fx;
  export function composite(
    f: Frame,
    out: Uint8ClampedArray,
    bg?: number | Uint32Array | null,
    lightK?: number,
  ): Uint8ClampedArray;
}

declare module "pixelfx/fx/*" {
  const mod: {
    meta?: Record<string, unknown>;
    draw?: unknown;
    drawBack?: unknown;
    create?: unknown;
  };
  export = mod;
}
