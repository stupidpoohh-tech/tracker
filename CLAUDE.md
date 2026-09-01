# Dada Tracker

기분·에너지·수면·생리주기를 한 화면에서 기록하고 그 사이의 관계를 읽어내는 트래커.
v4에서 개인용에서 다인 서비스로 전환했습니다.

## 스택

- React 18 + TypeScript(strict) + Vite
- Firebase Auth(이메일/비밀번호) + Firestore(오프라인 영속성)
- 배포: Cloudflare Pages (GitHub 연동, push 시 자동 빌드)
- 스타일: CSS 변수 토큰 + 전역 클래스. CSS 프레임워크 없음.
- 테스트: Vitest (도메인 단위 + jsdom 화면 통합)

## 디렉토리

```
src/
├── main.tsx                   # 진입점: ErrorBoundary → Toast → AppProvider → App
├── app/
│   ├── App.tsx                # 인증 분기, 온보딩 게이트, 탭 라우팅
│   ├── store.tsx              # 전역 상태 + 액션. 저장소 호출은 전부 여기를 거칩니다
│   └── App.test.tsx           # 화면 통합 테스트 (가짜 저장소 사용)
├── domain/                    # 순수 로직. React·Firebase 의존 없음. 테스트 대상
│   ├── date.ts                # 시간대 안전 날짜 산술 ⚠️ 아래 '날짜' 항목 필독
│   ├── models.ts              # 엔티티 타입 + zod 스키마
│   ├── cycle.ts               # 생리주기 통계·예측·단계 계산
│   ├── insights.ts            # 상관·집계·인사이트 카드 생성
│   └── tagPresets.ts          # 기본 태그 세트 + 위기 태그 판정
├── data/
│   ├── repository.ts          # 저장소 인터페이스 (백엔드 교체 지점)
│   ├── firestore.ts           # Firestore 구현
│   ├── migration.ts           # v3→v4 변환 (순수 함수, 테스트 대상)
│   ├── migrationRunner.ts     # 위 변환을 Firestore에 적용
│   └── exporters.ts           # JSON/CSV 내보내기, 가져오기 검증
├── features/
│   ├── auth/ onboarding/ legal/ safety/
│   ├── log/                   # 단일 화면 기록 + 자동 저장
│   ├── dashboard/             # 구간 계산, 추세 차트
│   ├── insights/              # 인사이트 카드 + 진료용 리포트
│   ├── tags/ cycle/ settings/
├── ui/                        # 토큰 CSS, 공용 컴포넌트, 아이콘
├── lib/                       # firebase.ts, env.ts, pwa.ts
└── test/harness.tsx           # 가짜 저장소 + Firebase 목
```

## 데이터 구조

```
users/{uid}                       프로필 (modules, theme, reminder, consent, schemaVersion)
users/{uid}/entries/{YYYY-MM-DD}  일일 기록
users/{uid}/tags/{tagId}          태그 (id가 안정적, 이름은 속성)
users/{uid}/tagCategories/{catId} 태그 분류
users/{uid}/cycles/{cycleId}      생리 시작/종료 이벤트
users/{uid}/meta/legacyV3         v3 원본 백업 (마이그레이션 시 생성)
```

```ts
interface Entry {
  date: DateKey          // 문서 ID와 동일. 범위 질의를 위해 필드로도 둡니다
  mood?: 1..5
  energy?: 1..5
  sleep?: 'little' | 'good' | 'too_much'
  sleepHours?: number
  ovulationMark?: boolean
  tagIds: string[]
  legacyTags?: string[]  // v3 이름 기반 태그. 손실 방지용으로 남깁니다
  memo: string
  createdAt?: number
  updatedAt?: number
}
```

값이 없으면 필드 자체를 넣지 않습니다. `null` 저장 금지 — `data/firestore.ts`의
`compact()`가 이를 강제합니다. (v3에서는 이 규약이 문서에만 있고 코드에는 없어
실제로는 `null`이 저장되고 있었습니다.)

## 설계 결정 (변경 시 주의)

### 날짜 — 가장 중요합니다

모든 날짜 키는 `YYYY-MM-DD` 형식의 **로컬 달력 날짜**입니다.

**`toISOString()`을 잘라 날짜 키를 만들지 마세요.** KST(UTC+9)에서 로컬 자정은
전날 15:00Z이므로 하루가 밀립니다. v3의 `addDays`/`getDatesInRange`가 이 방식이었고,
그 결과 7·30·90일 차트에서 **오늘 기록이 표시되지 않았고** 생리전·배란기 구간이
하루씩 어긋나 있었습니다.

`domain/date.ts`의 산술은 전부 `Date.UTC` 기반이라 시간대·서머타임과 무관합니다.
ESLint의 `no-restricted-syntax` 규칙이 `.toISOString().slice(...)` 형태를 막습니다.
전체 타임스탬프(`exportedAt` 등)에 `toISOString()`을 쓰는 것은 정상입니다.

### 태그

- **ID가 정체성이고 이름은 속성입니다.** 이름을 바꿔도 과거 기록을 건드리지
  않습니다. v3는 이름 자체가 ID여서 이름 변경 시 기록 700건이면 700회 순차
  쓰기가 발생했습니다.
- 삭제 대신 **보관(archived)** 이 기본입니다. 통계가 사라지지 않습니다. 완전
  삭제는 명시적 확인을 거칩니다.
- 읽기 경로는 `resolveEntryTagIds()`를 씁니다. `tagIds`를 우선하고 없을 때만
  `legacyTags`를 이름으로 해석합니다.

### 생리주기

- **생리 시작/종료 이벤트가 유일한 원본**입니다. 생리전·배란기는 전부 파생
  계산입니다. v3는 `entries[].cycle`과 `meta/periods`에 같은 사실이 이중으로
  들어 있었고 서로 동기화되지 않았습니다.
- 생리전은 시작 5일 전부터, 배란기는 다음 생리 시작 14일 전 ±1일입니다.
- 평균 주기로 **미래를 예측**합니다. v3는 "다음 생리 시작 -14일"로만 계산해서
  이미 지난 구간에만 값이 나왔습니다. 예측 구간은 UI에서 빗금으로 구분합니다.
- 우선순위: 생리 > 사용자 표시 배란일 > 생리전 > 파생 배란기.
- `buildPhaseIndex()`는 구간을 한 번만 칠합니다. O(날짜수 + 주기수)입니다.
- 사용자가 **끌 수 있습니다**(`profile.modules.cycle`). 기본값은 꺼짐입니다.

### 기분·에너지

- **같은 Y축을 공유**합니다. 형태로 구분하며(기분 ●, 에너지 ◆) 각각 단색입니다.
  수치별로 색을 바꾸지 않습니다 — 높낮이가 이미 값을 표현하기 때문입니다.
- **혼재 상태**는 `|기분 - 에너지| >= 2`이고 노란 링으로 표시합니다.
- 데이터 간격이 14일을 넘으면 추세선을 잇지 않습니다 (`MAX_GAP_DAYS`).

### 인사이트

- 표본이 부족하면 카드를 만들지 않습니다. 그룹당 5일, 전체 14일이 최소입니다.
- 1~5 척도에서 0.5점 미만 차이는 언급하지 않습니다.
- 문구는 관찰·가능성 수준으로 유지합니다. 상관을 인과로 쓰지 않습니다.

### 저장소

- 화면은 Firestore를 직접 부르지 않습니다. `app/store.tsx`의 액션 → `TrackerRepository`
  인터페이스 → 구현체 순서입니다. 백엔드 교체 지점이자 테스트 주입 지점입니다.
- `onSnapshot` + IndexedDB 영속 캐시를 씁니다. 기기당 최초 1회만 전량을 받고
  이후에는 변경분만 내려받습니다. v3의 `fsGetAll`은 앱을 열 때마다 전량을
  다시 읽었습니다.
- 저장 실패는 반드시 사용자에게 알립니다(`store.tsx`의 `guard`). v3는
  `console.error`만 하고 넘어가 사용자는 저장된 줄 알았습니다.
- 기록량이 수천 건을 넘으면 월 단위 버킷팅(`users/{uid}/months/{YYYY-MM}`)이
  다음 카드입니다. 지금은 복잡도 대비 이득이 없다고 판단했습니다.

### 안전·법적 사항

- 자해·자살 관련 태그 선택 또는 기분 1점 입력 시 위기 자원을 노출합니다.
  키워드 매칭이라 사용자가 만든 태그도 걸립니다(`isRiskTagName`).
- 민감정보 동의 없이는 기록 화면에 진입할 수 없습니다(`App.tsx`의 온보딩 게이트).
- `features/legal/content.ts`의 대괄호 항목은 배포 전에 실제 운영자 정보로
  채워야 합니다.

## 작업 규칙

- 정리·통합 요청 시 취사선택하지 않습니다. 중복만 제거하고 전부 살립니다.
  이견이 있으면 결과물을 먼저 낸 뒤 맨 끝에 짧게 별항으로 붙입니다.
- 교정을 받으면 변론 없이 반영 결과만 냅니다.
- 격식 있는 표준어, 입니다 경어체. 요청하지 않은 조언이나 막연한 칭찬은 넣지 않습니다.
- 단정보다 가설과 가능성으로 제시합니다.
- 터미널 명령어를 드리고 직접 실행하라고 안내하지 않습니다(CLI 안내 금지).
  코드·git·빌드·테스트처럼 제가 할 수 있는 일은 제가 직접 하고 결과만 보고합니다.
  Firebase 콘솔처럼 사용자 계정으로만 가능한 일은 화면 클릭 경로로 안내합니다
  (메뉴 이름 → 탭 이름 → 버튼 이름 순서).

## 명령어

```
npm run dev         # 로컬 개발 서버
npm run build       # 타입 검사 후 dist/ 생성
npm run preview     # 빌드 결과 확인
npm run typecheck   # 타입만 검사
npm run lint        # ESLint (경고 0 기준)
npm run test        # Vitest 전체
npm run verify      # typecheck + lint + test + build
```

`firestore.rules` 배포는 별도입니다: `firebase deploy --only firestore:rules`

## 미해결 / 검토 중

- 결제·구독. 기능 게이트를 붙일 자리는 `profile`에 있으나 아직 비어 있습니다.
- 서버 푸시(FCM). 지금 리마인더는 Periodic Background Sync + 포그라운드
  폴백이라 iOS에서는 앱이 열려 있을 때만 동작합니다. FCM을 붙이기 전에
  `lib/env.ts`에 적어둔 messagingSenderId 불일치를 먼저 확인해야 합니다.
- 소셜 로그인(Google/Apple). Apple 로그인은 iOS 앱스토어 배포 시 필수입니다.
- 다국어. 지금은 한국어 전용이고 문자열이 컴포넌트에 인라인되어 있습니다.
- 하루 여러 번 기록. 현재 모델은 날짜당 문서 하나입니다.
