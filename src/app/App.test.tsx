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
  Element.prototype.scrollIntoView = vi.fn()
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

/** 수면과 기분이 뚜렷하게 얽힌 40일치. 패턴이 실제로 잡히도록 만듭니다. */
function seedEntries(): Entry[] {
  return Array.from({ length: 40 }, (_, i) => {
    const date = addDays(TODAY, -(39 - i))
    const good = i % 2 === 0
    return {
      date,
      // 기분의 차이를 에너지보다 크게 두어 대표 패턴이 흔들리지 않게 합니다.
      // 에너지는 기분을 완전히 따라가지 않게 흔들어 둡니다 — 딱 맞아떨어지면
      // 기분·에너지 상관이 1이 되어, 실제로는 없을 관계가 대표 발견이 됩니다.
      mood: (good ? 5 : 2) as Scale,
      energy: (good ? (i % 4 === 0 ? 5 : 3) : i % 4 === 1 ? 2 : 3) as Scale,
      sleep: good ? 'good' : 'little',
      tagIds: good ? ['tag-happy'] : ['tag-irritable'],
      memo: good ? '괜찮은 날' : '',
    } satisfies Entry
  })
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

const findHome = () => screen.findByRole('heading', { name: '오늘' })

async function goToTab(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
  await user.click(within(nav).getByRole('button', { name: label }))
}

/** 홈의 10초 기록에서 전체 기록 화면으로 들어갑니다. */
async function openFullLog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const more = screen.queryByRole('button', { name: /더하기/ })
  if (more) await user.click(more)
  else await user.click(screen.getByRole('button', { name: '수정' }))
}

describe('앱 부팅', () => {
  it('동의와 온보딩을 마친 사용자에게는 오늘 화면을 보여줍니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    expect(await findHome()).toBeTruthy()
  })

  it('동의 전이면 온보딩을 먼저 보여줍니다', async () => {
    const repo = createFakeRepository({ profile: { consent: null, onboardedAt: undefined } })
    renderApp(repo)
    expect(await screen.findByText(/민감정보 수집·이용 동의/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '오늘' })).toBeNull()
  })

  it('하단 내비가 오늘·패턴·기록·설정입니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '오늘',
      '패턴',
      '기록',
      '설정',
    ])
  })
})

describe('로딩 실패 처리', () => {
  it('기록 구독이 실패해도 로딩 화면에 갇히지 않습니다', async () => {
    const repo = createFakeRepository({
      tags,
      categories,
      failEntriesWith: { code: 'permission-denied' },
    })
    renderApp(repo)
    expect(await findHome()).toBeTruthy()
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
    expect(screen.getByText(/보안 규칙이 접근을 거부했습니다/)).toBeTruthy()
  })
})

describe('describeError', () => {
  it('Firestore 오류 코드를 사용자 문구로 옮깁니다', () => {
    expect(describeError({ code: 'permission-denied' })).toContain('보안 규칙')
    expect(describeError({ code: 'unavailable' })).toContain('네트워크')
    expect(describeError(new Error('그냥 오류'))).toBe('그냥 오류')
  })
})

describe('오늘 — 10초 기록', () => {
  it('기록이 없으면 기분·에너지를 바로 누를 수 있습니다', async () => {
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    expect(screen.getByRole('heading', { name: '오늘은 어땠나요?' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '기분' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '에너지' })).toBeTruthy()
  })

  it('누르는 즉시 저장됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()

    await user.click(screen.getByRole('radio', { name: '기분 4 — 좋음' }))
    await waitFor(() => expect(repo.state.entries[TODAY]?.mood).toBe(4), { timeout: 3000 })
  })

  it('이미 기록했으면 완료 상태와 수정 진입만 보여줍니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    expect(screen.getByText('오늘 기록 완료')).toBeTruthy()
    expect(screen.getByRole('button', { name: '수정' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '오늘은 어땠나요?' })).toBeNull()
  })

  it('연속 기록을 핵심 지표로 내세우지 않습니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    expect(screen.queryByText('연속 기록')).toBeNull()
  })
})

describe('오늘 — 발견', () => {
  it('데이터가 쌓이면 가장 중요한 발견을 문장으로 보여줍니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    expect(await screen.findByText(/잘 잠 날에 기분이 더 높게 나타납니다/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '자세히 보기' })).toBeTruthy()
  })

  it('기록이 없으면 가짜 발견을 만들지 않고 단계를 안내합니다', async () => {
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    expect(screen.getByText('아직 기록이 없습니다')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '자세히 보기' })).toBeNull()
  })

  it('기록이 적으면 얼마나 더 필요한지 알려줍니다', async () => {
    const repo = createFakeRepository({ entries: seedEntries().slice(-5), tags, categories })
    renderApp(repo)
    await findHome()
    expect(screen.getByText('기록이 시작됐습니다')).toBeTruthy()
  })
})

describe('패턴', () => {
  it('상태별 섹션으로 묶어 보여줍니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '패턴')

    expect(await screen.findByRole('heading', { name: '나의 패턴' })).toBeTruthy()
    expect(screen.getByText(/잘 잠 날에 기분이 더 높게 나타납니다/)).toBeTruthy()
  })

  it('패턴 상세에서 근거와 상관≠인과 고지를 보여줍니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await user.click(screen.getByRole('button', { name: '자세히 보기' }))

    expect(await screen.findByRole('heading', { name: '데이터에서 이렇게 나타났습니다' })).toBeTruthy()
    expect(screen.getByText(/원인과 결과를 판단할 수는 없습니다/)).toBeTruthy()
    expect(screen.getByText('관찰 기간')).toBeTruthy()
    expect(screen.getByText('표본')).toBeTruthy()
  })

  it('관찰하기를 누르면 관찰로 저장됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await user.click(screen.getByRole('button', { name: '자세히 보기' }))
    await user.click(await screen.findByRole('button', { name: '이 패턴 계속 관찰하기' }))

    await waitFor(() => expect(repo.state.observations).toHaveLength(1))
    expect(repo.state.observations[0]?.patternId).toBe('sleep-mood')
  })

  it('관찰 중인 패턴은 홈에 남습니다', async () => {
    const repo = createFakeRepository({
      entries: seedEntries(),
      tags,
      categories,
      observations: [
        { id: 'o1', patternId: 'sleep-mood', label: '수면 ↔ 기분', startedOn: addDays(TODAY, -10) },
      ],
    })
    renderApp(repo)
    await findHome()
    expect(screen.getByRole('heading', { name: '관찰 중' })).toBeTruthy()
    expect(screen.getByText('수면 ↔ 기분')).toBeTruthy()
    expect(screen.getByText(/11일째 관찰 중입니다/)).toBeTruthy()
  })
})

describe('기록 탭 — 기존 조회 기능이 유지됩니다', () => {
  it('구간 탭과 날짜 범위가 동작합니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '기록')

    expect(await screen.findByRole('heading', { name: '기록' })).toBeTruthy()
    const group = screen.getByRole('group', { name: '표시 구간' })
    expect(within(group).getAllByRole('button')).toHaveLength(5)
    expect(screen.getByText(/30\/30일 기록/)).toBeTruthy()

    await user.click(within(group).getByRole('button', { name: '7일' }))
    expect(await screen.findByText(/7\/7일 기록/)).toBeTruthy()
  })

  it('오늘이 차트 구간에 포함됩니다 (v3 회귀)', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '기록')

    const chart = await screen.findByRole('img')
    expect(chart.getAttribute('aria-label')).toContain('30일 중 30일 기록됨')
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
    await findHome()
    await goToTab(user, '기록')

    const toggle = await screen.findByRole('button', { name: '수면' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('적게 잠')).toBeNull()
  })

  it('더보기로 나머지 기록을 펼칩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '기록')

    await screen.findByRole('heading', { name: '기록 목록' })
    const before = document.querySelectorAll('.record-row').length
    expect(before).toBe(8)
    await user.click(screen.getByRole('button', { name: /더보기/ }))
    expect(document.querySelectorAll('.record-row').length).toBeGreaterThan(before)
  })

  it('진료용 리포트를 열 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '기록')
    await user.click(await screen.findByRole('button', { name: /리포트/ }))

    expect(await screen.findByRole('heading', { name: '기분·에너지·수면 기록 요약' })).toBeTruthy()
  })
})

describe('전체 기록 화면 — 기존 입력 기능이 유지됩니다', () => {
  it('한 화면에 모든 항목이 펼쳐집니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    await openFullLog(user)

    for (const section of ['기분', '에너지', '수면', '태그', '메모']) {
      expect(await screen.findByRole('heading', { name: section })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: '저장하기' })).toBeNull()
  })

  it('기분을 선택하면 자동으로 저장됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    await openFullLog(user)

    await user.click(await screen.findByRole('radio', { name: '기분 4 — 좋음' }))
    await waitFor(() => expect(repo.state.entries[TODAY]?.mood).toBe(4), { timeout: 3000 })
    expect(await screen.findByText('저장됨')).toBeTruthy()
  })

  it('같은 값을 다시 누르면 기록이 지워집니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    await openFullLog(user)

    const button = await screen.findByRole('radio', { name: '기분 3 — 보통' })
    await user.click(button)
    await waitFor(() => expect(repo.state.entries[TODAY]?.mood).toBe(3), { timeout: 3000 })
    await user.click(button)
    await waitFor(() => expect(repo.state.entries[TODAY]).toBeUndefined(), { timeout: 3000 })
  })

  it('자해 관련 항목을 고르면 위기 자원을 안내합니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    await openFullLog(user)

    await user.click(await screen.findByRole('button', { name: '자해/자살충동' }))
    expect(await screen.findByText(/지금 힘드시다면 도움을 받으실 수 있습니다/)).toBeTruthy()
    expect(screen.getByText('자살예방 상담전화')).toBeTruthy()
  })

  it('생리주기를 켜면 시작 기록을 만들 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({
      tags,
      categories,
      profile: { modules: { mood: true, energy: true, sleep: true, cycle: true } },
    })
    renderApp(repo)
    await findHome()
    await openFullLog(user)

    await user.click(await screen.findByRole('button', { name: /이 날 생리 시작/ }))
    await waitFor(() => expect(repo.state.cycles).toHaveLength(1))
    expect(repo.state.cycles[0]?.startDate).toBe(TODAY)
  })

  it('기록을 삭제할 수 있습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await openFullLog(user)

    await user.click(await screen.findByRole('button', { name: /이 날 기록 삭제/ }))
    await user.click(await screen.findByRole('button', { name: '삭제' }))
    await waitFor(() => expect(repo.state.entries[TODAY]).toBeUndefined())
  })
})

describe('설정 — 관찰 항목 관리', () => {
  it('태그 관리가 설정 아래 관찰 항목으로 들어갔습니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()

    // 주 내비게이션에는 더 이상 태그가 없습니다.
    const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
    expect(within(nav).queryByRole('button', { name: '태그' })).toBeNull()

    await goToTab(user, '설정')
    await user.click(await screen.findByRole('button', { name: /관찰 항목 관리/ }))
    expect(await screen.findByRole('heading', { name: '관찰 항목' })).toBeTruthy()
  })

  it('이름 변경이 과거 기록을 다시 쓰지 않습니다 (v3는 전량 재기록)', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '설정')
    await user.click(await screen.findByRole('button', { name: /관찰 항목 관리/ }))

    await user.click(await screen.findByRole('button', { name: '짜증 편집' }))
    const input = await screen.findByLabelText('이름')
    await user.clear(input)
    await user.type(input, '과민/짜증')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() =>
      expect(repo.state.tags.find((t) => t.id === 'tag-irritable')?.name).toBe('과민/짜증'),
    )
    expect(repo.calls.filter((c) => c.startsWith('saveEntry'))).toHaveLength(0)
  })

  it('기록 항목을 끄면 프로필에 반영됩니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '설정')

    await user.click(await screen.findByRole('switch', { name: '수면 기록' }))
    await waitFor(() => expect(repo.state.profile.modules.sleep).toBe(false))
  })

  it('계정 삭제는 비밀번호 확인을 요구합니다', async () => {
    const user = userEvent.setup()
    const repo = createFakeRepository({ entries: seedEntries(), tags, categories })
    renderApp(repo)
    await findHome()
    await goToTab(user, '설정')

    await user.click(await screen.findByRole('button', { name: /계정 삭제/ }))
    expect(await screen.findByLabelText(/확인을 위해 비밀번호를 입력해주세요/)).toBeTruthy()
  })
})
