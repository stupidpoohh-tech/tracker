# Dada Tracker

기분·에너지·수면·생리주기를 한 화면에서 기록하고, 그 사이의 관계를 읽어내는 트래커입니다.

개발 규약과 설계 결정은 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 시작하기

```bash
npm install
npm run dev
```

`.env.example`을 복사해 `.env`를 만들면 다른 Firebase 프로젝트를 가리킬 수 있습니다.
값을 비워두면 기존 `dadatracker` 프로젝트를 사용합니다.

```bash
npm run verify   # typecheck + lint + test + build. 커밋 전에 실행하세요.
```

## v3에서 달라진 점

| | v3 | v4 |
|---|---|---|
| 대상 | 개인용 단일 사용자 | 다인 서비스 |
| 기록 흐름 | 7단계 위저드, 저장 버튼 | 단일 화면, 자동 저장 |
| 태그 | 이름이 곧 ID, localStorage | 안정적 ID, Firestore 동기화 |
| 태그 이름 변경 | 기록 전량 재기록 | 문서 1건 수정 |
| 생리주기 | 두 곳에 이중 저장, 예측 불가 | 이벤트 단일 원본, 미래 예측 |
| 데이터 로드 | 앱 열 때마다 전량 재조회 | 실시간 구독 + 오프라인 캐시 |
| 분석 | 태그 빈도 막대 | 상관 인사이트 + 진료용 리포트 |
| 보안 규칙 | 저장소에 없음 | `firestore.rules`로 버전 관리 |
| 타입·테스트 | 없음 | TypeScript strict + 125개 테스트 |
| 테마 | 라이트 고정 | 라이트/다크/시스템 |

기존 데이터는 첫 로그인 시 자동으로 이관됩니다. v3 원본은 `users/{uid}/meta/legacyV3`에
백업되며, 태그 이름은 각 기록의 `legacyTags`에 그대로 남습니다.

## 배포

### Cloudflare Pages

빌드 명령 `npm run build`, 출력 디렉토리 `dist`. SPA이므로 리다이렉트가 필요합니다.

```
# public/_redirects
/*  /index.html  200
```

### Firestore 보안 규칙 — 필수

```bash
firebase deploy --only firestore:rules
```

규칙 없이 배포하면 임의 계정이 다른 사용자의 기록을 읽을 수 있습니다.
정신건강·생리주기 데이터는 민감정보이므로 배포 전 반드시 적용하세요.

## 상용 서비스 개시 전 체크리스트

아래 항목은 코드에 자리만 만들어 두었습니다. 실제 값 입력과 검토가 필요합니다.

- [ ] `firestore.rules` 배포 및 Firebase 콘솔에서 적용 확인
- [ ] `src/features/legal/content.ts`의 `[운영자명]`, `[문의 이메일]` 채우기
- [ ] 이용약관·개인정보처리방침 법률 검토 (민감정보 처리 고지가 요건입니다)
- [ ] `src/lib/env.ts`의 messagingSenderId 불일치 확인
      (`400037233155` vs appId 내 `400037233255`)
- [ ] Firebase Auth의 비밀번호 재설정·이메일 확인 템플릿을 한국어로 설정
- [ ] Firebase Auth 승인된 도메인에 배포 도메인 추가
- [ ] 만 14세 미만 가입 처리 방침 결정 (약관 제3조)
- [ ] 위기 자원 연락처가 최신인지 확인 (`src/domain/tagPresets.ts`)
- [ ] Firestore 리전 확인 및 개인정보처리방침의 국외 이전 고지와 일치시키기

## 라이선스

비공개 프로젝트입니다.
