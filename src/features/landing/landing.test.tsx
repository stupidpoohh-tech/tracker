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
    // 미리보기에서 '표본이 부족합니다'만 보이면 보여줄 것이 없습니다.
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

describe('첫 화면', () => {
  it('로그인 폼이 아니라 소개 화면이 먼저 나옵니다', async () => {
    renderApp()
    expect(
      await screen.findByRole('heading', { name: /기분·에너지·수면·생리주기를/ }),
    ).toBeTruthy()
    expect(screen.queryByLabelText('이메일')).toBeNull()
  })

  it('예시 데이터를 넣은 실제 대시보드를 보여줍니다', async () => {
    renderApp()
    await screen.findByRole('heading', { name: '실제 화면입니다' })
    // 스크린샷이 아니라 진짜 Dashboard 컴포넌트가 렌더링되어야 합니다.
    expect(screen.getByRole('heading', { name: '대시보드' })).toBeTruthy()
    expect(screen.getByRole('img')).toBeTruthy() // 추세 차트
  })

  it('인사이트 탭으로 바꾸면 인사이트 화면이 나옵니다', async () => {
    const user = userEvent.setup()
    renderApp()
    const tablist = await screen.findByRole('tablist', { name: '화면 미리보기' })
    await user.click(within(tablist).getByRole('tab', { name: '인사이트' }))
    expect(await screen.findByRole('heading', { name: '인사이트' })).toBeTruthy()
  })

  it('예시 화면에서는 저장되지 않는다고 알립니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: '실제 화면입니다' })
    await user.click(screen.getByRole('button', { name: '기록' }))
    expect(await screen.findByText(/예시 화면입니다/)).toBeTruthy()
  })
})

describe('로그인·회원가입 진입', () => {
  it('무료로 시작하기를 누르면 회원가입 화면이 나옵니다', async () => {
    const user = userEvent.setup()
    renderApp()
    const buttons = await screen.findAllByRole('button', { name: '무료로 시작하기' })
    await user.click(buttons[0] as HTMLElement)

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

  it('인증 화면에서 소개 화면으로 돌아올 수 있습니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '로그인' })

    await user.click(screen.getByRole('button', { name: /소개 화면으로/ }))
    expect(await screen.findByRole('heading', { name: '실제 화면입니다' })).toBeTruthy()
  })

  it('소개 화면에서 약관을 읽을 수 있습니다', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '이용약관' }))
    expect(await screen.findByRole('dialog', { name: '이용약관' })).toBeTruthy()
  })
})
