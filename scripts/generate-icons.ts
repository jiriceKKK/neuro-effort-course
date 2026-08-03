/**
 * Generates the original PWA icon set locally.
 *
 * No third-party or branded artwork is downloaded — the icons are drawn here from
 * primitives (rounded rectangles + a circle) and encoded as PNG with Node's built-in
 * zlib. The motif is three ascending bars (accumulating effort) and a single dot
 * (the outcome), which is also what favicon.svg draws.
 *
 * Run with: npx tsx scripts/generate-icons.ts
 * The resulting PNGs are committed, so this script only needs to run when the design
 * changes.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

const BACKGROUND = [0x1b, 0x2a, 0x4a] as const
const BAR_LOW = [0x5f, 0x86, 0xc9] as const
const BAR_MID = [0x8c, 0xb4, 0xf0] as const
const BAR_HIGH = [0xc8, 0xdd, 0xff] as const
const DOT = [0xff, 0xd1, 0x66] as const

type Rgb = readonly [number, number, number]

/** Supersampling factor; the canvas is drawn large and averaged down for smooth edges. */
const SCALE = 4

class Canvas {
  readonly size: number
  private readonly pixels: Uint8ClampedArray

  constructor(size: number, background: Rgb) {
    this.size = size
    this.pixels = new Uint8ClampedArray(size * size * 3)
    for (let i = 0; i < size * size; i += 1) {
      this.pixels[i * 3] = background[0]
      this.pixels[i * 3 + 1] = background[1]
      this.pixels[i * 3 + 2] = background[2]
    }
  }

  private set(x: number, y: number, colour: Rgb): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const index = (y * this.size + x) * 3
    this.pixels[index] = colour[0]
    this.pixels[index + 1] = colour[1]
    this.pixels[index + 2] = colour[2]
  }

  /** Coordinates are normalised to 0..1 so the same drawing works at every size. */
  roundedRect(x: number, y: number, width: number, height: number, radius: number, colour: Rgb) {
    const px = x * this.size
    const py = y * this.size
    const pw = width * this.size
    const ph = height * this.size
    const r = Math.min(radius * this.size, pw / 2, ph / 2)

    for (let cy = Math.floor(py); cy < Math.ceil(py + ph); cy += 1) {
      for (let cx = Math.floor(px); cx < Math.ceil(px + pw); cx += 1) {
        const dx = Math.max(px + r - cx, 0, cx - (px + pw - r - 1))
        const dy = Math.max(py + r - cy, 0, cy - (py + ph - r - 1))
        if (dx * dx + dy * dy <= r * r) this.set(cx, cy, colour)
      }
    }
  }

  circle(centreX: number, centreY: number, radius: number, colour: Rgb) {
    const cx = centreX * this.size
    const cy = centreY * this.size
    const r = radius * this.size
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy <= r * r) this.set(x, y, colour)
      }
    }
  }

  /** Box-filter downsample from the supersampled canvas to the final resolution. */
  downsample(target: number): Uint8Array {
    const factor = this.size / target
    const out = new Uint8Array(target * target * 3)
    for (let y = 0; y < target; y += 1) {
      for (let x = 0; x < target; x += 1) {
        let r = 0
        let g = 0
        let b = 0
        let samples = 0
        for (let sy = Math.floor(y * factor); sy < Math.floor((y + 1) * factor); sy += 1) {
          for (let sx = Math.floor(x * factor); sx < Math.floor((x + 1) * factor); sx += 1) {
            const index = (sy * this.size + sx) * 3
            r += this.pixels[index] ?? 0
            g += this.pixels[index + 1] ?? 0
            b += this.pixels[index + 2] ?? 0
            samples += 1
          }
        }
        const outIndex = (y * target + x) * 3
        out[outIndex] = Math.round(r / samples)
        out[outIndex + 1] = Math.round(g / samples)
        out[outIndex + 2] = Math.round(b / samples)
      }
    }
    return out
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(rgb: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8) // bit depth
  header.writeUInt8(2, 9) // colour type: truecolour RGB
  header.writeUInt8(0, 10)
  header.writeUInt8(0, 11)
  header.writeUInt8(0, 12)

  const stride = size * 3
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0 // filter type: none
    Buffer.from(rgb.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/**
 * @param inset Fraction the motif is shrunk toward the centre. Maskable icons need
 *   all meaningful content inside the central 80 % circle, so they use a larger inset.
 */
function drawIcon(size: number, inset: number): Buffer {
  const canvas = new Canvas(size * SCALE, BACKGROUND)
  const at = (value: number) => 0.5 + (value - 0.5) * (1 - inset)

  const barWidth = 0.1 * (1 - inset)
  const gap = 0.055 * (1 - inset)
  const baseline = at(0.72)
  const left = at(0.295)
  const bars: Array<{ height: number; colour: Rgb }> = [
    { height: 0.15, colour: BAR_LOW },
    { height: 0.23, colour: BAR_MID },
    { height: 0.31, colour: BAR_HIGH },
  ]

  bars.forEach((bar, index) => {
    const height = bar.height * (1 - inset)
    canvas.roundedRect(
      left + index * (barWidth + gap),
      baseline - height,
      barWidth,
      height,
      barWidth / 2.4,
      bar.colour,
    )
  })

  canvas.circle(at(0.655), at(0.3), 0.075 * (1 - inset), DOT)

  return encodePng(canvas.downsample(size), size)
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outputs: Array<{ file: string; size: number; inset: number }> = [
    { file: 'icon-192.png', size: 192, inset: 0 },
    { file: 'icon-512.png', size: 512, inset: 0 },
    { file: 'icon-maskable-512.png', size: 512, inset: 0.22 },
    { file: 'apple-touch-icon.png', size: 180, inset: 0.06 },
  ]

  for (const { file, size, inset } of outputs) {
    writeFileSync(resolve(OUTPUT_DIR, file), drawIcon(size, inset))
    console.log(`icon written: public/icons/${file} (${size}×${size})`)
  }
}

main()
