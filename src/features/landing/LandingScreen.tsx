import { useCallback, useState } from 'react'
import { Icon, type IconName } from '@/ui/Icon'
import { useToast } from '@/ui/components'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { InsightsScreen } from '@/features/insights/InsightsScreen'
import { LegalSheet } from '@/features/legal/LegalSheet'
import { MEDICAL_DISCLAIMER, PRIVACY, TERMS, type LegalDocument } from '@/features/legal/content'
import { CRISIS_RESOURCES } from '@/domain/tagPresets'
import { APP_VERSION } from '@/lib/env'
import { DemoAppProvider } from './DemoAppProvider'

type PreviewTab = 'dashboard' | 'insights'

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'pencil',
    title: '한 화면에서 1분이면 끝',
    body: '기분·에너지·수면·생리주기·태그·메모가 한 화면에 있습니다. 누르는 즉시 저장되고 저장 버튼이 없습니다.',
  },
  {
    icon: 'chart',
    title: '따로 보면 안 보이던 관계',
    body: '기분과 에너지가 같은 축 위에 놓입니다. 둘이 어긋난 날은 따로 표시되고, 주기 구간이 배경에 깔립니다.',
  },
  {
    icon: 'sparkles',
    title: '근거가 있을 때만 말합니다',
    body: '수면과 기분, 주기 단계와 태그의 관계를 계산합니다. 표본이 부족하면 카드를 만들지 않습니다.',
  },
  {
    icon: 'print',
    title: '진료실에서 한 장으로',
    body: '“지난 3개월 어떠셨어요”에 답할 요약을 만듭니다. 인쇄하거나 PDF로 저장해 가져가실 수 있습니다.',
  },
]

/**
 * 로그인 전 첫 화면.
 *
 * 빈 로그인 폼부터 보여주면 방문자는 이 앱이 무엇인지 알 수 없습니다. 여기서는
 * 예시 데이터를 넣은 **실제 대시보드·인사이트 컴포넌트**를 그대로 렌더링합니다.
 * 스크린샷이 아니므로 화면을 고치면 이 미리보기도 함께 바뀝니다.
 */
export function LandingScreen({
  onSignUp,
  onSignIn,
}: {
  onSignUp: () => void
  onSignIn: () => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<PreviewTab>('dashboard')
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null)

  const handleWriteAttempt = useCallback(() => {
    toast.show('예시 화면입니다. 계정을 만들면 내 기록을 남길 수 있습니다.')
  }, [toast])

  return (
    <div className="landing">
      <nav className="landing-nav">
        <span className="landing-brand">
          <span className="landing-mark">
            <Icon name="chart" size={17} strokeWidth={2.2} />
          </span>
          Dada Tracker
        </span>
        <button type="button" className="btn btn-sm" onClick={onSignIn}>
          로그인
        </button>
      </nav>

      <header className="landing-hero">
        <h1>
          기분·에너지·수면·생리주기를
          <br />한 곳에서 봅니다
        </h1>
        <p className="lede">
          따로 기록하면 보이지 않던 관계가 함께 놓으면 드러납니다. 잘 잔 날의 기분, 생리전 구간에
          몰리는 증상 같은 것들입니다.
        </p>
        <div className="landing-cta">
          <button type="button" className="btn btn-primary" onClick={onSignUp}>
            무료로 시작하기
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            화면 둘러보기
          </button>
        </div>
      </header>

      <section className="landing-section" id="preview">
        <h2>실제 화면입니다</h2>
        <p className="lede">
          아래는 이미지가 아니라 예시 기록을 넣고 돌린 진짜 화면입니다. 구간을 바꾸거나 날짜를
          눌러보실 수 있습니다.
        </p>

        <div className="preview-tabs" role="tablist" aria-label="화면 미리보기">
          {(
            [
              ['dashboard', '대시보드'],
              ['insights', '인사이트'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="chip"
              aria-selected={tab === id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="preview-frame">
          <div className="preview-viewport">
            <DemoAppProvider onWriteAttempt={handleWriteAttempt}>
              {tab === 'dashboard' ? <Dashboard onEdit={handleWriteAttempt} /> : <InsightsScreen />}
            </DemoAppProvider>
          </div>
          <div className="preview-fade" aria-hidden />
        </div>

        <p className="hint" style={{ marginTop: 10 }}>
          예시 기록 100일치로 계산한 화면입니다. 저장은 되지 않습니다.
        </p>
      </section>

      <section className="landing-section">
        <h2>무엇이 다른가</h2>
        <div className="landing-features">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="feature-card">
              <span className="feature-icon">
                <Icon name={feature.icon} size={17} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>기록은 본인 것입니다</h2>
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="card stack-sm">
            <span className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}>
              <Icon name="lock" size={16} />
              광고도, 프로파일링도, 모델 학습도 없습니다
            </span>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75 }}>
              정신건강과 생리주기 기록은 민감정보입니다. 저장과 본인에게 보여줄 통계 계산에만
              사용합니다. 언제든 전체 데이터를 JSON·CSV로 내려받고, 계정을 삭제하실 수 있습니다.
            </p>
          </div>
          <div className="card stack-sm">
            <span className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}>
              <Icon name="heart" size={16} />
              힘든 날을 위한 안내
            </span>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75 }}>
              자해·자살과 관련된 기록을 남기시면 24시간 상담 창구를 함께 보여드립니다.
              지금 도움이 필요하시면 {CRISIS_RESOURCES[0]?.name} {CRISIS_RESOURCES[0]?.contact}로
              연락하실 수 있습니다.
            </p>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          {MEDICAL_DISCLAIMER}
        </p>
      </section>

      <section className="landing-section" style={{ textAlign: 'center' }}>
        <h2>오늘부터 기록해보세요</h2>
        <p className="lede">이메일만 있으면 됩니다. 무엇을 기록할지는 직접 고르실 수 있습니다.</p>
        <div className="landing-cta" style={{ justifyContent: 'center', marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={onSignUp}>
            무료로 시작하기
          </button>
          <button type="button" className="btn" onClick={onSignIn}>
            이미 계정이 있어요
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLegalDoc(TERMS)}>
          이용약관
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLegalDoc(PRIVACY)}>
          개인정보처리방침
        </button>
        <span className="hint">v{APP_VERSION}</span>
      </footer>

      {legalDoc && <LegalSheet document={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
