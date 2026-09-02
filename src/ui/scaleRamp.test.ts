import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 척도 입력의 색 단계 검사.
 *
 * 눈으로 고르지 않습니다. 계열색을 1에서 5로 갈수록 진하게 깔면 5단계 쪽에서
 * 글자가 배경에 묻히기 쉽습니다. 토큰이나 혼합비를 고치면 이 검사가 다시
 * 계산하므로, 대비가 무너진 채로 배포되지 않습니다.
 *
 * 기준은 WCAG AA 본문 4.5:1이고, 반올림 여유를 두어 4.6으로 잡았습니다.
 */

const MIN_CONTRAST = 4.6

const tokens = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')
const base = readFileSync(resolve(__dirname, 'base.css'), 'utf8')

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  const value = hex.trim().replace('#', '')
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb
}

/** color-mix(in srgb, A p%, B)와 같은 계산입니다. */
function mix(a: Rgb, b: Rgb, ratio: number): Rgb {
  return a.map((v, i) => Math.round(v * ratio + (b[i] as number) * (1 - ratio))) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return ((hi as number) + 0.05) / ((lo as number) + 0.05)
}

/** 토큰 값을 블록별로 읽습니다. 라이트는 첫 정의, 다크는 마지막 정의입니다. */
function token(name: string, theme: 'light' | 'dark'): Rgb {
  const matches = [...tokens.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))]
  expect(matches.length, `${name} 토큰을 찾지 못했습니다`).toBeGreaterThan(0)
  const picked = theme === 'light' ? matches[0] : matches[matches.length - 1]
  return parseHex((picked as RegExpMatchArray)[1] as string)
}

/** base.css에서 단계별 혼합비를 읽습니다. 값이 바뀌면 검사도 따라 바뀝니다. */
function stepRatios(): number[] {
  return [1, 2, 3, 4, 5].map((step) => {
    const rule = new RegExp(
      `\\[data-step='${step}'\\][^}]*color-mix\\(in srgb, var\\(--tint\\) (\\d+)%`,
      's',
    )
    const found = base.match(rule)
    expect(found, `${step}단계 혼합비를 찾지 못했습니다`).not.toBeNull()
    return Number((found as RegExpMatchArray)[1]) / 100
  })
}

function trackRatios(): number[] {
  const block = base.match(/\.scale-track \{[^}]*\}/s)
  expect(block, '.scale-track 규칙을 찾지 못했습니다').not.toBeNull()
  const found = [
    ...(block as RegExpMatchArray)[0].matchAll(/var\(--tint\) (\d+)%/g),
  ].map((m) => Number(m[1]) / 100)
  expect(found.length).toBe(2)
  return found
}

const THEMES = ['light', 'dark'] as const
const SERIES = ['series-mood', 'series-energy'] as const

describe('척도 입력의 색 단계', () => {
  it('선택된 단계마다 숫자가 배경과 충분히 구분됩니다', () => {
    const ratios = stepRatios()
    for (const theme of THEMES) {
      const surface = token('surface', theme)
      const ink = token('text', theme)
      for (const series of SERIES) {
        const tint = token(series, theme)
        ratios.forEach((ratio, index) => {
          const background = mix(tint, surface, ratio)
          const value = contrast(background, ink)
          expect(
            value,
            `${theme}/${series} ${index + 1}단계 대비 ${value.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST)
        })
      }
    }
  })

  it('트랙 그라데이션 위에서도 숫자가 읽힙니다', () => {
    for (const theme of THEMES) {
      const sunken = token('surface-sunken', theme)
      const ink = token('text', theme)
      for (const series of SERIES) {
        const tint = token(series, theme)
        for (const ratio of trackRatios()) {
          const value = contrast(mix(tint, sunken, ratio), ink)
          expect(value, `${theme}/${series} 트랙 대비 ${value.toFixed(2)}`).toBeGreaterThanOrEqual(
            MIN_CONTRAST,
          )
        }
      }
    }
  })

  it('단계가 갈수록 진해집니다 — 방향이 뒤집히지 않습니다', () => {
    const ratios = stepRatios()
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i] as number).toBeGreaterThan(ratios[i - 1] as number)
    }
  })
})
