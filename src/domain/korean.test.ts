import { describe, expect, it } from 'vitest'
import {
  hasFinalConsonant,
  withConjunction,
  withObject,
  withSubject,
  withTopic,
} from './korean'

describe('받침 판정', () => {
  it('한글 받침 유무를 가립니다', () => {
    expect(hasFinalConsonant('기분')).toBe(true)
    expect(hasFinalConsonant('에너지')).toBe(false)
    expect(hasFinalConsonant('두통')).toBe(true)
    expect(hasFinalConsonant('짜증')).toBe(true)
    expect(hasFinalConsonant('피로')).toBe(false)
    expect(hasFinalConsonant('수면')).toBe(true)
  })

  it('따옴표나 괄호로 끝나도 앞 글자를 봅니다', () => {
    expect(hasFinalConsonant("'두통'")).toBe(true)
    expect(hasFinalConsonant("'에너지'")).toBe(false)
  })

  it('숫자·영문도 소리 나는 대로 처리합니다', () => {
    expect(hasFinalConsonant('3')).toBe(true) // 삼
    expect(hasFinalConsonant('2')).toBe(false) // 이
    expect(hasFinalConsonant('5')).toBe(false) // 오
  })

  it('판단할 수 없으면 null입니다', () => {
    expect(hasFinalConsonant('')).toBeNull()
    expect(hasFinalConsonant('★')).toBeNull()
  })
})

describe('조사 결합', () => {
  it('주격', () => {
    expect(withSubject('기분')).toBe('기분이')
    expect(withSubject('에너지')).toBe('에너지가')
  })

  it('목적격', () => {
    expect(withObject('두통')).toBe('두통을')
    expect(withObject('피로')).toBe('피로를')
  })

  it('보조사', () => {
    expect(withTopic('짜증')).toBe('짜증은')
    expect(withTopic('에너지')).toBe('에너지는')
  })

  it('접속', () => {
    expect(withConjunction('수면')).toBe('수면과')
    expect(withConjunction('에너지')).toBe('에너지와')
  })

  it('사용자가 만든 태그 이름에도 적용됩니다', () => {
    expect(withSubject('브레인포그')).toBe('브레인포그가')
    expect(withSubject('사고과속')).toBe('사고과속이')
    expect(withObject('이인증/해리/마비')).toBe('이인증/해리/마비를')
  })
})
