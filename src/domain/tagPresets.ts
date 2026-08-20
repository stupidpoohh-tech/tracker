/**
 * 기본 태그 프리셋.
 *
 * v3는 71개 임상 태그를 신규 사용자에게 전부 노출했습니다. 처음 쓰는 사람에게는
 * 과부하이므로 작은 기본 세트를 먼저 주고, 전체 목록은 '임상 상세 팩'으로
 * 언제든 추가할 수 있게 분리했습니다. 원본 71개는 하나도 빠짐없이 팩에 있습니다.
 */

export interface PresetCategory {
  name: string
  tags: string[]
}

export interface TagPreset {
  id: string
  name: string
  description: string
  categories: PresetCategory[]
}

const STARTER: PresetCategory[] = [
  { name: '정서', tags: ['불안/초조', '우울/좌절', '짜증', '행복/만족', '무기력/탈진', '사랑/감사'] },
  { name: '신체', tags: ['두통', '피로', '소화불량', '생리통'] },
  { name: '행동', tags: ['야식', '과소비'] },
  { name: '인지', tags: ['집중력저하', '브레인포그'] },
]

/** v3 `DEFAULT_TAGS` 전체(71개). 순서까지 원본 그대로 유지합니다. */
const CLINICAL: PresetCategory[] = [
  {
    name: '신체',
    tags: [
      '흉통/속쓰림', '손저림', '근육/관절통', '두통', '발한', '식욕저하', '홍조', '어지러움',
      '졸림', '피로', '시야흐림', '심계항진', '떨림', '현기증', '기침', '생리통', '유방통',
      '생리요통', '소화불량', '구역감', '경련', '설사', '복부팽만', '발열',
    ],
  },
  {
    name: '정서',
    tags: [
      '들뜸', '불쾌', '얼어붙음', '자해/자살충동', '눈물', '과민', '공포/두려움', '죄책감',
      '무관심/무감각', '무료/지루', '우울/좌절', '짜증', '기분변동/혼재', '불안/초조',
      '사랑/감사', '지침/압도', '창의적/모험적', '의욕적', '무기력/탈진', '급변감',
      '행복/만족', '자신감/희망', '그저그럼', '안좋음', '혼란', '공허/외로움', '화남',
    ],
  },
  {
    name: '행동',
    tags: [
      '야식', '말과다', '결근', '사회기능저하', '과소비', '부적절발언', '충동적만남',
      '성관련이슈', '성적대화', '충동성', '안절부절', '손톱물기', '갈망/탐식',
    ],
  },
  {
    name: '인지',
    tags: ['이인증/해리/마비', '브레인포그', '집중력저하', '사고과속', '건망', '비관/냉소', '긍정적'],
  },
]

export const TAG_PRESETS: readonly TagPreset[] = [
  {
    id: 'starter',
    name: '기본 세트',
    description: '자주 쓰는 14개로 시작합니다. 나중에 얼마든지 추가할 수 있습니다.',
    categories: STARTER,
  },
  {
    id: 'clinical',
    name: '임상 상세 팩',
    description: '신체·정서·행동·인지 71개 전체. 진료 기록을 상세히 남기려는 경우에 적합합니다.',
    categories: CLINICAL,
  },
]

export function findPreset(id: string): TagPreset | undefined {
  return TAG_PRESETS.find((p) => p.id === id)
}

// ─── 위기 자원 안내 트리거 ────────────────────────────────────────────────────
/**
 * 자해·자살 관련 태그가 선택되면 상담 자원을 안내합니다. 불특정 다수에게
 * 제공하는 서비스에서는 선택 기능이 아니라 요건에 가깝습니다.
 * 사용자가 직접 만든 태그도 걸리도록 이름 기반 키워드 매칭을 씁니다.
 */
const RISK_PATTERNS = [/자해/, /자살/, /죽고\s*싶/, /죽음/, /suicide/i, /self[-\s]?harm/i]

export function isRiskTagName(name: string): boolean {
  return RISK_PATTERNS.some((re) => re.test(name))
}

export interface CrisisResource {
  name: string
  contact: string
  detail: string
  href?: string
}

/** 대한민국 기준 공공 상담 창구. */
export const CRISIS_RESOURCES: readonly CrisisResource[] = [
  {
    name: '자살예방 상담전화',
    contact: '109',
    detail: '24시간 무료 상담',
    href: 'tel:109',
  },
  {
    name: '정신건강 상담전화',
    contact: '1577-0199',
    detail: '24시간, 지역 정신건강복지센터 연결',
    href: 'tel:15770199',
  },
  {
    name: '청소년 전화',
    contact: '1388',
    detail: '24시간 청소년 상담',
    href: 'tel:1388',
  },
  {
    name: '생명의전화',
    contact: '1588-9191',
    detail: '24시간 위기 상담',
    href: 'tel:15889191',
  },
]
