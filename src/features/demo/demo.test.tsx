// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ToastProvider } from '@/ui/components'
import { AppProvider } from '@/app/store'
import { App } from '@/app/App'
import { todayKey } from '@/domain/date'
import { buildTagIndex } from '@/domain/models'
import { buildInsights, computeOverview } from '@/domain/insights'
import { buildPhaseIndex } from '@/domain/cycle'
import { DEMO_CATEGORIES, DEMO_TAGS, buildDemoData } from './demoData'

// 로그아웃 상태를 만들기 위해 사용자 없는 인증으로 대체합니다.
// harness의 mockFirebase는 로그인된 사용자를 흉내내므로 여기서는 쓰지 않습니다.
vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  app: {},
  onAuth: (cb: (user: unknown) => void) => {
    cb(null)
    return () => {}
  },
  signIn: vi.fn(),
  signUp: vi.fn(),
  logOut: vi.fn(),
  resetPassword: vi.fn(),
  requestEmailVerification: vi.fn(),
  changePassword: vi.fn(),
  reauthenticate: vi.fn(),
  removeAccount: vi.fn(),
  authErrorMessage: (e: unknown) => String(e),
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function renderApp() {
  return render(
    <ToastProvider>
      <AppProvider repository={{} as never}>
        <App />
      </AppProvider>
    </ToastProvider>,
  )
}

describe('예시 데이터', () => {
  const today = todayKey()
  const demo = buildDemoData(today)

  it('충분한 기록을 만듭니다', () => {
    expect(demo.entries.length).toBeGreaterThan(60)
    expect(demo.cycles.length).toBeGreaterThanOrEqual(3)
    expect(demo.tags).toHaveLength(DEMO_TAGS.length)
    expect(demo.categories).toHaveLength(DEMO_CATEGORIES.length)
  })

  it('오늘 기록이 반드시 들어 있습니다', () => {
    expect(demo.entries.some((e) => e.date === today)).toBe(true)
  })

  it('시드가 고정되어 매번 같은 결과를 냅니다', () => {
    const again = buildDemoData(today)
    expect(again.entries.map((e) => `${e.date}:${e.mood}:${e.energy}`)).toEqual(
      demo.entries.map((e) => `${e.date}:${e.mood}:${e.energy}`),
    )
  })

  it('척도가 1~5 범위를 벗어나지 않습니다', () => {
    for (const entry of demo.entries) {
      expect(entry.mood).toBeGreaterThanOrEqual(1)
      expect(entry.mood).toBeLessThanOrEqual(5)
      expect(entry.energy).toBeGreaterThanOrEqual(1)
      expect(entry.energy).toBeLessThanOrEqual(5)
    }
  })

  it('인사이트 카드가 실제로 만들어질 만큼의 신호가 있습니다', () => {
    const phaseIndex = buildPhaseIndex(demo.cycles, demo.entries[0]!.date, today, { today })
    const cards = buildInsights({
      entries: demo.entries,
      phaseIndex,
      tagIndex: buildTagIndex(demo.categories, demo.tags),
      rangeStart: demo.entries[0]!.date,
      rangeEnd: today,
    })
    expect(cards.length).toBeGreaterThanOrEqual(3)
    expect(cards.some((c) => c.kind === 'sleep')).toBe(true)
  })

  it('기록이 빠진 날이 있어 실제 사용 흔적처럼 보입니다', () => {
    const overview = computeOverview(demo.entries, demo.entries[0]!.date, today, today)
    expect(overview.coverage).toBeGreaterThan(0.6)
    expect(overview.coverage).toBeLessThan(1)
  })
})

describe('로그인 전 첫 화면', () => {
  it('소개 페이지가 아니라 진짜 앱 화면이 바로 뜹니다', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: '오늘' })).toBeTruthy()
    // 로그인 폼도, 마케팅 문구도 없습니다.
    expect(screen.queryByLabelText('이메일')).toBeNull()
    expect(screen.queryByText('실제 화면입니다')).toBeNull()
    expect(screen.queryByText('무료로 시작하기')).toBeNull()
  })

  it('예시 데이터로 계산한 실제 발견을 보여줍니다', async () => {
    renderApp()
    await screen.findByRole('heading', { name: '오늘' })
    // 스크린샷이 아니라 진짜 패턴 계산 결과입니다.
    expect(screen.getByRole('button', { name: '자세히 보기' })).toBeTruthy()
  })

  it('예시 데이터에서 관찰까지 경험할 수 있습니다', async () => {
    renderApp()
    await screen.findByRole('heading', { name: '오늘' })
    expect(screen.getByRole('heading', { name: '관찰 중' })).toBeTruthy()
    expect(screen.getByText('수면 ↔ 기분')).toBeTruthy()
  })

  it('하단 내비로 다른 화면도 둘러볼 수 있습니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: '오늘' })

    const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
    await user.click(within(nav).getByRole('button', { name: '패턴' }))
    expect(await screen.findByRole('heading', { name: '나의 패턴' })).toBeTruthy()

    await user.click(within(nav).getByRole('button', { name: '기록' }))
    expect(await screen.findByRole('heading', { name: '기록' })).toBeTruthy()
    expect(screen.getByRole('img')).toBeTruthy() // 추세 차트
  })

  it('패턴 상세까지 들어가 볼 수 있습니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: '오늘' })
    await user.click(screen.getByRole('button', { name: '자세히 보기' }))

    expect(await screen.findByRole('heading', { name: '데이터에서 이렇게 나타났습니다' })).toBeTruthy()
    expect(screen.getByText(/원인과 결과를 판단할 수는 없습니다/)).toBeTruthy()
  })

  it('예시 데이터라는 사실을 얇은 줄로 알립니다', async () => {
    renderApp()
    expect(await screen.findByText('예시 데이터로 둘러보는 중입니다')).toBeTruthy()
  })
})

describe('로그인·회원가입 진입', () => {
  it('시작하기를 누르면 회원가입 화면이 나옵니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '시작하기' }))

    expect(await screen.findByRole('heading', { name: '계정 만들기' })).toBeTruthy()
    expect(screen.getByLabelText('비밀번호 확인')).toBeTruthy()
  })

  it('로그인을 누르면 로그인 화면이 나옵니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(screen.queryByLabelText('비밀번호 확인')).toBeNull()
  })

  it('기록하려고 하면 가입 화면으로 넘깁니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: '오늘' })
    // 예시 화면에서는 저장이 되지 않고 가입으로 안내합니다.
    await user.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByRole('heading', { name: '계정 만들기' })).toBeTruthy()
  })

  it('인증 화면에서 앱 화면으로 돌아올 수 있습니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '로그인' })

    await user.click(screen.getByRole('button', { name: /돌아가기/ }))
    expect(await screen.findByRole('heading', { name: '오늘' })).toBeTruthy()
  })
})
