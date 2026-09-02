// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createFakeRepository, mockFirebase, type FakeRepository } from '@/test/harness'
import { AppProvider, describeError } from './store'
import { App } from './App'
import { ToastProvider } from '@/ui/components'
import { addDays, todayKey } from '@/domain/date'
import type { Entry, Scale, Tag, TagCategory } from '@/domain/models'

mockFirebase()

beforeAll(() => {
  // jsdom에는 없는 브라우저 API들을 최소한으로 채웁니다.
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
  window.print = vi.fn()
})

afterEach(cleanup)

const TODAY = todayKey()

const categories: TagCategory[] = [
  { id: 'cat-emotion', name: '정서', order: 0 },
  { id: 'cat-body', name: '신체', order: 1 },
]
const tags: Tag[] = [
  { id: 'tag-irritable', name: '짜증', categoryId: 'cat-emotion', order: 0, archived: false },
  { id: 'tag-happy', name: '행복/만족', categoryId: 'cat-emotion', order: 1, archived: false },
  { id: 'tag-headache', name: '두통', categoryId: 'cat-body', order: 2, archived: false },
  { id: 'tag-selfharm', name: '자해/자살충동', categoryId: 'cat-emotion', order: 3, archived: false },
]

function seedEntries(): Entry[] {
  return Array.from({ length: 40 }, (_, i) => {
    const date = addDays(TODAY, -(39 - i))
    const good = i % 2 === 0
    return {
      date,
      mood: (good ? 4 : 2) as Scale,
      energy: (good ? 4 : 2) as Scale,
      sleep: good ? 'good' : 'little',
      tagIds: good ? ['tag-happy'] : ['tag-irritable'],
      memo: good ? '괜찮은 날' : '',
    } satisfies Entry
  })
}

/** 하단 내비게이션 탭으로 이동합니다. 화면 본문에도 같은 이름의 버튼이 있어 영역을 한정합니다. */
async function goToTab(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
  await user.click(within(nav).getByRole('button', { name: label }))
}

function renderApp(repository: FakeRepository) {
  return render(
    <ToastProvider>
      <AppProvider repository={repository}>
        <App />
      </AppProvider>
    </ToastProvider>,
  )
}

describe('앱 부팅', () => {
  it('동의와 온보딩을 마친 사용자에게는 대시보드를 보여줍니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '기록' })).toBeTruthy()
  })

  it('동의 전이면 온보딩을 먼저 보여줍니다', async () => {
    const repo = createFakeRepository({ profile: { consent: null, onboardedAt: undefined } })
    renderApp(repo)
    expect(await screen.findByText(/민감정보 수집·이용 동의/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '대시보드' })).toBeNull()
  })

  it('동의는 했지만 온보딩 미완료면 온보딩을 보여줍니다', async () => {
    const repo = createFakeRepository({ profile: { onboardedAt: undefined } })
    renderApp(repo)
    expect(await screen.findByText(/민감정보 수집·이용 동의/)).toBeTruthy()
  })
})

describe('로딩 실패 처리', () => {
  // 회귀 테스트: onSyncError가 status를 바꾸지 않아, 구독이 실패하면
  // '연결 중…' 화면에 영영 머물렀습니다.
  it('기록 구독이 실패해도 로딩 화면에 갇히지 않습니다', async () => {
    const repo = createFakeRepository({
      tags,
      categories,
      failEntriesWith: { code: 'permission-denied' },
    })
    renderApp(repo)

    expect(await screen.findByRole('heading', { name: '대시보드' }, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByText('연결 중…')).toBeNull()
  })

  it('실패 원인을 화면에 보여줍니다', async () => {
    const repo = createFakeRepository({
      tags,
      categories,
      failEntriesWith: { code: 'permission-denied' },
    })
    renderApp(repo)

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText(/데이터를 완전히 불러오지 못했습니다/)).toBeTruthy()
    expect(screen.getByText(/보안 규칙이 접근을 거부했습니다/)).toBeTruthy()
  })

  it('정상일 때는 오류 배너를 띄우지 않습니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    expect(screen.queryByText(/데이터를 완전히 불러오지 못했습니다/)).toBeNull()
  })
})

describe('describeError', () => {
  it('Firestore 오류 코드를 사용자 문구로 옮깁니다', () => {
    expect(describeError({ code: 'permission-denied' })).toContain('보안 규칙')
    expect(describeError({ code: 'unavailable' })).toContain('네트워크')
    expect(describeError({ code: 'failed-precondition' })).toContain('오프라인 저장소')
    expect(describeError(new Error('그냥 오류'))).toBe('그냥 오류')
  })
})

describe('대시보드', () => {
  it('구간 통계를 계산해 보여줍니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    // 기본 30일 구간, 40일치 기록 → 30일 모두 기록됨.
    // KPI는 카드가 아니라 열이고, 주 숫자와 보조 단위를 나눠 렌더링합니다.
    const kpi = (await screen.findByText('/30일')).closest('.kpi-item') as HTMLElement
    expect(within(kpi).getByText('30')).toBeTruthy()
    expect(within(kpi).getByText('기록')).toBeTruthy()
    expect(screen.getByText('평균 기분')).toBeTruthy()
  })

  it('오늘이 차트 구간에 포함됩니다 (v3 회귀)', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    const chart = await screen.findByRole('img')
    const label = chart.getAttribute('aria-label') ?? ''
    // 30일 구간이 오늘로 끝나야 30일 전부가 기록으로 잡힙니다.
    expect(label).toContain('30일 중 30일 기록됨')
  })

  it('기록이 없으면 안내를 보여줍니다', async () => {
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    expect(await screen.findByText(/이 구간에는 기록이 없습니다/)).toBeTruthy()
  })

  it('7일 구간으로 전환할 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '7일' }))

    const kpi = (await screen.findByText('/7일', {}, { timeout: 3000 })).closest(
      '.kpi-item',
    ) as HTMLElement
    expect(within(kpi).getByText('7')).toBeTruthy()
  })

  it('구간 선택이 텍스트 탭으로 표시됩니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    const group = screen.getByRole('group', { name: '표시 구간' })
    expect(within(group).getAllByRole('button')).toHaveLength(5)
    expect(within(group).getByRole('button', { name: '30일' }).getAttribute('aria-pressed')).toBe('true')
    // 알약 안에 알약이 들어가는 세그먼트 컨트롤은 쓰지 않습니다.
    expect(document.querySelector('.segmented')).toBeNull()
  })

  it('수면·주기 계층을 껐다 켤 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({
      entries: seedEntries(),
      tags,
      categories,
      profile: { modules: { mood: true, energy: true, sleep: true, cycle: false } },
    })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })

    const toggle = screen.getByRole('button', { name: '수면' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('적게 잠')).toBeTruthy()

    await user.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    // 꺼지면 보조 열쇠도 사라져 범례가 기분·에너지만 남습니다.
    expect(screen.queryByText('적게 잠')).toBeNull()
  })

  it('기록이 많으면 더보기로 나머지를 펼칩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })

    const before = document.querySelectorAll('.record-row').length
    expect(before).toBe(6)
    await user.click(screen.getByRole('button', { name: /더보기/ }))
    expect(document.querySelectorAll('.record-row').length).toBeGreaterThan(before)
  })
})

describe('기록 화면', () => {
  it('한 화면에 모든 항목이 펼쳐집니다 (v3는 7단계 위저드)', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    for (const section of ['기분', '에너지', '수면', '태그', '메모']) {
      expect(await screen.findByRole('heading', { name: section })).toBeTruthy()
    }
    // 저장 버튼이 없습니다 — 자동 저장입니다.
    expect(screen.queryByRole('button', { name: '저장하기' })).toBeNull()
  })

  it('기분을 선택하면 자동으로 저장됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    await user.click(await screen.findByRole('radio', { name: '기분 4 — 좋음' }))
    await waitFor(() => expect(repo.state.entries[TODAY]?.mood).toBe(4), { timeout: 3000 })
    expect(await screen.findByText('저장됨')).toBeTruthy()
  })

  it('같은 값을 다시 누르면 선택이 해제됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    const button = await screen.findByRole('radio', { name: '기분 3 — 보통' })
    await user.click(button)
    await waitFor(() => expect(repo.state.entries[TODAY]?.mood).toBe(3), { timeout: 3000 })
    await user.click(button)
    // 다른 값이 없으면 빈 기록이 되어 문서 자체가 삭제됩니다.
    await waitFor(() => expect(repo.state.entries[TODAY]).toBeUndefined(), { timeout: 3000 })
  })

  it('기분과 에너지가 2 이상 벌어지면 혼재 상태를 알립니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    await user.click(await screen.findByRole('radio', { name: '기분 5 — 매우 좋음' }))
    await user.click(await screen.findByRole('radio', { name: '에너지 1 — 매우 낮음' }))
    expect(await screen.findByText(/혼재 상태로 표시됩니다/)).toBeTruthy()
  })

  it('자해 관련 태그를 고르면 위기 자원을 안내합니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    await user.click(await screen.findByRole('button', { name: '자해/자살충동' }))
    expect(await screen.findByText(/지금 힘드시다면 도움을 받으실 수 있습니다/)).toBeTruthy()
    expect(screen.getByText('자살예방 상담전화')).toBeTruthy()
    expect(screen.getByText('109')).toBeTruthy()
  })

  it('기분 1점만 골라도 위기 자원을 안내합니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    await user.click(await screen.findByRole('radio', { name: '기분 1 — 매우 나쁨' }))
    expect(await screen.findByText(/지금 힘드시다면/)).toBeTruthy()
  })

  it('생리주기를 끄면 해당 항목이 나타나지 않습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({
      tags,
      categories,
      profile: { modules: { mood: true, energy: true, sleep: true, cycle: false } },
    })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))
    await screen.findByRole('heading', { name: '기분' })
    expect(screen.queryByRole('heading', { name: '생리주기' })).toBeNull()
  })

  it('생리주기를 켜면 시작 기록을 만들 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({
      tags,
      categories,
      profile: { modules: { mood: true, energy: true, sleep: true, cycle: true } },
    })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await user.click(screen.getByRole('button', { name: '기록' }))

    await user.click(await screen.findByRole('button', { name: /이 날 생리 시작/ }))
    await waitFor(() => expect(repo.state.cycles).toHaveLength(1))
    expect(repo.state.cycles[0]?.startDate).toBe(TODAY)
  })
})

describe('태그 화면', () => {
  it('이름 변경이 과거 기록을 다시 쓰지 않습니다 (v3는 전량 재기록)', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '태그')

    await user.click(await screen.findByRole('button', { name: '짜증 편집' }))
    const input = await screen.findByLabelText('이름')
    await user.clear(input)
    await user.type(input, '과민/짜증')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() =>
      expect(repo.state.tags.find((t) => t.id === 'tag-irritable')?.name).toBe('과민/짜증'),
    )
    // 기록 문서에는 쓰기가 한 번도 일어나지 않아야 합니다.
    expect(repo.calls.filter((c) => c.startsWith('saveEntry'))).toHaveLength(0)
    expect(repo.calls).toContain('updateTag:tag-irritable')
  })

  it('보관은 기록을 남긴 채 목록에서만 뺍니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '태그')

    await user.click(await screen.findByRole('button', { name: '두통 편집' }))
    await user.click(await screen.findByRole('button', { name: /보관하기/ }))

    await waitFor(() =>
      expect(repo.state.tags.find((t) => t.id === 'tag-headache')?.archived).toBe(true),
    )
    expect(repo.calls.filter((c) => c.startsWith('saveEntry'))).toHaveLength(0)
  })

  it('태그 사용 횟수를 보여줍니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '태그')

    await screen.findByRole('button', { name: '짜증 편집' })
    const chip = screen
      .getAllByRole('button')
      .find((el) => el.classList.contains('chip') && el.textContent?.startsWith('짜증'))
    expect(chip).toBeDefined()
    // 40일 중 20일에 '짜증'을 기록했습니다.
    expect(within(chip as HTMLElement).getByText('20')).toBeTruthy()
  })
})

describe('인사이트 화면', () => {
  it('표본이 충분하면 수면과 기분의 관계를 찾아냅니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '인사이트')

    expect(await screen.findByRole('heading', { name: '인사이트' })).toBeTruthy()
    expect(await screen.findByText(/잘 잠 날의 기분이 더 높습니다/)).toBeTruthy()
  })

  it('기록이 적으면 패턴을 만들지 않고 그 사실을 알립니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries().slice(0, 5), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '인사이트')

    expect(await screen.findByText(/기록이 14일 이상 모이면 패턴을 계산합니다/)).toBeTruthy()
  })

  it('진료 리포트를 열 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '인사이트')
    await user.click(await screen.findByRole('button', { name: /리포트/ }))

    expect(await screen.findByRole('heading', { name: '기분·에너지·수면 기록 요약' })).toBeTruthy()
  })
})

describe('설정 화면', () => {
  it('기록 항목을 끄면 프로필에 반영됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '설정')

    await user.click(await screen.findByRole('switch', { name: '수면 기록' }))
    await waitFor(() => expect(repo.state.profile.modules.sleep).toBe(false))
  })

  it('마지막 남은 항목은 끌 수 없습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({
      tags,
      categories,
      profile: { modules: { mood: true, energy: false, sleep: false, cycle: false } },
    })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '설정')

    await user.click(await screen.findByRole('switch', { name: '기분 기록' }))
    expect(await screen.findByText('최소 한 가지는 켜 두셔야 합니다.')).toBeTruthy()
    expect(repo.state.profile.modules.mood).toBe(true)
  })

  it('테마를 바꾸면 프로필에 저장됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '설정')

    await user.click(await screen.findByRole('button', { name: '어둡게' }))
    await waitFor(() => expect(repo.state.profile.theme).toBe('dark'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('계정 삭제는 비밀번호 확인을 요구합니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await screen.findByRole('heading', { name: '대시보드' })
    await goToTab(user, '설정')

    await user.click(await screen.findByRole('button', { name: /계정 삭제/ }))
    expect(await screen.findByLabelText(/확인을 위해 비밀번호를 입력해주세요/)).toBeTruthy()
    expect(screen.getByText(/먼저 데이터 내보내기/)).toBeTruthy()
  })
})
