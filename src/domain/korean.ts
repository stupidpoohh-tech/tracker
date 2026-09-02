/**
 * 한국어 조사 처리.
 *
 * 패턴 문구는 태그 이름 같은 사용자 데이터를 문장에 끼워 넣어 만듭니다.
 * 조사를 고정해두면 "에너지이 더 높게", "두통를 기록한 날" 같은 문장이 나옵니다.
 * 앞 글자의 받침 유무로 조사를 고릅니다.
 */

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3
/** 받침 없이 끝나는 것으로 취급할 숫자·영문 끝소리. */
const OPEN_ENDINGS = new Set(['2', '4', '5', '9', 'a', 'e', 'i', 'o', 'u'])

/** 마지막 글자에 받침이 있는지. 판단할 수 없으면 null입니다. */
export function hasFinalConsonant(word: string): boolean | null {
  const trimmed = word.replace(/[)\]"'」』\s]+$/u, '')
  const last = trimmed.at(-1)
  if (!last) return null

  const code = last.codePointAt(0) as number
  if (code >= HANGUL_START && code <= HANGUL_END) return (code - HANGUL_START) % 28 !== 0

  const lower = last.toLowerCase()
  if (/[0-9a-z]/.test(lower)) return !OPEN_ENDINGS.has(lower)
  return null
}

function pick(word: string, withFinal: string, withoutFinal: string): string {
  const final = hasFinalConsonant(word)
  // 판단할 수 없으면 받침 있는 쪽을 씁니다. 어느 쪽도 완벽하지 않지만
  // '이/은/을'이 더 자연스럽게 읽히는 경우가 많습니다.
  return final === false ? withoutFinal : withFinal
}

/** 주격 조사: 기분이 / 에너지가 */
export function subjectParticle(word: string): string {
  return pick(word, '이', '가')
}

/** 목적격 조사: 두통을 / 짜증를 → 짜증을 */
export function objectParticle(word: string): string {
  return pick(word, '을', '를')
}

/** 보조사: 기분은 / 에너지는 */
export function topicParticle(word: string): string {
  return pick(word, '은', '는')
}

/** 접속 조사: 수면과 / 에너지와 */
export function withParticle(word: string): string {
  return pick(word, '과', '와')
}

/** `기분이`처럼 단어와 조사를 붙여 돌려줍니다. */
export function withSubject(word: string): string {
  return `${word}${subjectParticle(word)}`
}
export function withObject(word: string): string {
  return `${word}${objectParticle(word)}`
}
export function withTopic(word: string): string {
  return `${word}${topicParticle(word)}`
}
export function withConjunction(word: string): string {
  return `${word}${withParticle(word)}`
}
